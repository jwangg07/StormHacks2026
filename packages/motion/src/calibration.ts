import type { PoseSample } from './pose';
import type { Landmark } from './types';
import {
  clamp,
  distance2,
  distance3,
  elbowAngle,
  median,
  midpoint,
  reliableWorldArm,
} from './geometry';

export const CALIBRATION_MS = 1000;
export const ACTION_CHECKS = ['leftPunch', 'rightPunch', 'guard'] as const;
export type ActionCheck = (typeof ACTION_CHECKS)[number];
export interface CalibrationBaseline {
  shoulderWidth: number;
  head: Landmark;
  shoulderCenter: Landmark;
  shoulderTilt?: number;
  torso: Landmark;
  restWrists: Record<'left' | 'right', Landmark>;
  segmentRatios: NonNullable<PoseSample['segmentRatios']>;
  jitter: number;
}
export interface CalibrationStatus {
  phase: 'idle' | 'collecting' | 'checks' | 'ready';
  progress: number;
  message: string;
  checks: Record<ActionCheck, boolean>;
  nextCheck: ActionCheck | null;
}
export class Calibration {
  baseline: CalibrationBaseline | null = null;
  private samples: PoseSample[] = [];
  private status: CalibrationStatus = this.initial();
  private initial(): CalibrationStatus {
    return {
      phase: 'idle',
      progress: 0,
      message: 'Calibrate your neutral stance before practice.',
      checks: { leftPunch: false, rightPunch: false, guard: false },
      nextCheck: null,
    };
  }
  snapshot(): CalibrationStatus {
    return { ...this.status, checks: { ...this.status.checks } };
  }
  start() {
    this.baseline = null;
    this.samples = [];
    this.status = {
      ...this.initial(),
      phase: 'collecting',
      message:
        'Stand in a relaxed neutral position. Bend both elbows and hold your fists near your chest, below your face, until the bar fills. Small movements are okay.',
    };
  }
  invalidate() {
    if (this.status.phase === 'collecting') {
      this.samples = [];
      this.status.progress = 0;
      this.status.message =
        'Keep your head and both arms in view, then hold your fists near your chest to restart the neutral hold.';
    }
  }
  update(sample: PoseSample) {
    if (this.status.phase !== 'collecting') return this.snapshot();
    if (sample.tracking !== 'VALID') {
      this.invalidate();
      return this.snapshot();
    }
    const p = sample.aspectLandmarks,
      width = distance2(p.leftShoulder, p.rightShoulder);
    if (
      width < 0.08 ||
      elbowAngle(sample, 'left') > 145 ||
      elbowAngle(sample, 'right') > 145 ||
      p.leftWrist.y < p.nose.y + 0.03 ||
      p.rightWrist.y < p.nose.y + 0.03
    ) {
      this.samples = [];
      this.status.progress = 0;
      this.status.message =
        'Bend both elbows and hold your fists near your chest, below your face. Relax your shoulders.';
      return this.snapshot();
    }
    const last = this.samples.at(-1);
    if (
      last &&
      (sample.frame.timestamp <= last.frame.timestamp ||
        sample.frame.timestamp - last.frame.timestamp > 200)
    )
      this.samples = [];
    const first = this.samples[0];
    if (first) {
      const base = first.aspectLandmarks,
        firstWidth = distance2(base.leftShoulder, base.rightShoulder);
      if (
        Math.abs(width / firstWidth - 1) > 0.12 ||
        distance2(p.nose, base.nose) / firstWidth > 0.15 ||
        distance2(p.leftWrist, base.leftWrist) / firstWidth > 0.25 ||
        distance2(p.rightWrist, base.rightWrist) / firstWidth > 0.25
      )
        this.samples = [];
    }
    this.samples.push(sample);
    this.status.message =
      'Stand in a relaxed neutral position. Bend both elbows and hold your fists near your chest, below your face, until the bar fills. Small movements are okay.';
    this.status.progress = Math.min(
      1,
      (sample.frame.timestamp - this.samples[0].frame.timestamp) / CALIBRATION_MS,
    );
    if (this.status.progress < 1 || this.samples.length < 30) return this.snapshot();
    const shoulderWidth = median(
      this.samples.map((s) =>
        distance2(s.aspectLandmarks.leftShoulder, s.aspectLandmarks.rightShoulder),
      ),
    );
    const meanPoint = (name: string) => {
      const points = this.samples.map((s) => s.aspectLandmarks[name]).filter(Boolean);
      return {
        x: median(points.map((v) => v.x)),
        y: median(points.map((v) => v.y)),
        z: median(points.map((v) => v.z)),
        visibility: Math.min(...points.map((v) => v.visibility)),
      };
    };
    const shoulderCenter = midpoint(meanPoint('leftShoulder'), meanPoint('rightShoulder')),
      head = meanPoint('nose');
    const torsoSamples = this.samples.map((s) => {
      const q = s.aspectLandmarks,
        center = midpoint(q.leftShoulder, q.rightShoulder);
      return q.leftHip && q.rightHip ? midpoint(center, midpoint(q.leftHip, q.rightHip)) : center;
    });
    const torso = {
      ...shoulderCenter,
      x: median(torsoSamples.map((v) => v.x)),
      y: median(torsoSamples.map((v) => v.y)),
    };
    const restWrists = {} as CalibrationBaseline['restWrists'],
      segmentRatios = {} as CalibrationBaseline['segmentRatios'];
    for (const hand of ['left', 'right'] as const) {
      const wrist = meanPoint(`${hand}Wrist`);
      restWrists[hand] = {
        ...wrist,
        x: (wrist.x - shoulderCenter.x) / shoulderWidth,
        y: (wrist.y - shoulderCenter.y) / shoulderWidth,
        z: (wrist.z - shoulderCenter.z) / shoulderWidth,
      };
      const ratios = this.samples.map((s) => {
        const world = reliableWorldArm(s, hand),
          q = s.aspectLandmarks;
        return world
          ? { upper: world.upper / world.width, fore: world.fore / world.width }
          : {
              upper: distance3(q[`${hand}Shoulder`], q[`${hand}Elbow`]) / shoulderWidth,
              fore: distance3(q[`${hand}Elbow`], q[`${hand}Wrist`]) / shoulderWidth,
            };
      });
      segmentRatios[hand] = {
        upper: clamp(median(ratios.map((v) => v.upper)), 0.35, 1.8),
        fore: clamp(median(ratios.map((v) => v.fore)), 0.3, 1.8),
      };
    }
    const jitter = median(
      this.samples.map((s) => distance2(s.aspectLandmarks.nose, head) / shoulderWidth),
    );
    this.baseline = {
      shoulderWidth,
      shoulderCenter,
      shoulderTilt: median(
        this.samples.map((s) => {
          const shoulders = s.aspectLandmarks;
          const width = distance2(shoulders.leftShoulder, shoulders.rightShoulder);
          return (shoulders.leftShoulder.y - shoulders.rightShoulder.y) / Math.max(0.08, width);
        }),
      ),
      head,
      torso,
      restWrists,
      segmentRatios,
      jitter,
    };
    this.samples = [];
    this.status = {
      ...this.status,
      phase: 'checks',
      nextCheck: 'leftPunch',
      message: 'Throw one controlled left punch, then bring your fist back near your chest.',
    };
    return this.snapshot();
  }
  check(action: ActionCheck) {
    if (this.status.phase !== 'checks' || this.status.nextCheck !== action) return;
    this.status.checks[action] = true;
    const next = ACTION_CHECKS.find((name) => !this.status.checks[name]) ?? null;
    const messages = {
      leftPunch: 'Throw one controlled left punch, then bring your fist back near your chest.',
      rightPunch: 'Throw one controlled right punch, then bring your fist back near your chest.',
      guard: 'Raise both hands near your face with elbows bent.',
    };
    this.status = {
      ...this.status,
      phase: next ? 'checks' : 'ready',
      nextCheck: next,
      message: next
        ? messages[next]
        : 'Both punches and guard recognized. Entering the ring automatically.',
    };
  }
}
