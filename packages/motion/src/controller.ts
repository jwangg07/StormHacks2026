import { Calibration } from './calibration';
import type { ActionCheck, CalibrationStatus } from './calibration';
import { ActionDetector } from './detectors';
import type { PunchDiagnostic } from './detectors';
import { FeatureNormalizer } from './normalize';
import type { NormalizedFeatures } from './normalize';
import type { MotionFrame, TrackingState } from './types';
import type { PoseSample } from './pose';
import { clamp } from './geometry';
import { ArmPoseEstimator } from './arms';

export const idleControls = (timestamp: number, tracking: TrackingState): MotionFrame => ({
  timestamp,
  tracking,
  headOffset: { x: 0, y: 0 },
  guard: false,
  duck: false,
});
export interface MotionDiagnostics {
  calibration: CalibrationStatus;
  features: NormalizedFeatures | null;
  lastAction: { action: ActionCheck | 'duck'; timestamp: number } | null;
  sensitivity: number;
  punches: Record<'left' | 'right', PunchDiagnostic>;
}
export class MotionController {
  readonly calibration = new Calibration();
  private normalizer = new FeatureNormalizer();
  private detector = new ActionDetector();
  private sensitivity = 1;
  private lastAction: MotionDiagnostics['lastAction'] = null;
  private lastFrame: MotionFrame | null = null;
  private features: NormalizedFeatures | null = null;
  private lastTimestamp = -Infinity;
  private armPose = new ArmPoseEstimator();

  startCalibration() {
    this.calibration.start();
    this.normalizer.reset();
    this.detector = new ActionDetector(this.sensitivity);
    this.lastFrame = null;
    this.features = null;
    this.lastAction = null;
    this.armPose.reset();
  }
  setSensitivity(value: number) {
    this.sensitivity = clamp(Number.isFinite(value) ? value : 1, 0.7, 1.3);
    this.detector = new ActionDetector(this.sensitivity);
    this.normalizer.reset();
    this.lastFrame = null;
  }
  update(sample: PoseSample): MotionFrame {
    if (sample.frame.timestamp <= this.lastTimestamp)
      return idleControls(sample.frame.timestamp, sample.tracking);
    this.lastTimestamp = sample.frame.timestamp;
    if (sample.tracking !== 'VALID') {
      this.invalidate();
      return idleControls(sample.frame.timestamp, sample.tracking);
    }
    if (this.calibration.snapshot().phase === 'idle') this.startCalibration();
    const baselineBefore = this.calibration.baseline;
    this.calibration.update(sample);
    const baseline = this.calibration.baseline;
    if (!baseline) return idleControls(sample.frame.timestamp, sample.tracking);
    if (!baselineBefore) {
      this.normalizer.reset();
      this.detector.invalidate();
    }
    const features = this.normalizer.update(sample, baseline);
    const frame = { ...this.detector.update(features), arms: this.armPose.update(sample) },
      previous = this.lastFrame;
    this.features = features;
    const actions: (ActionCheck | 'duck')[] = [];
    if (frame.punch) actions.push(frame.punch === 'left' ? 'leftPunch' : 'rightPunch');
    if (frame.guard && (!previous?.guard || this.calibration.snapshot().nextCheck === 'guard'))
      actions.push('guard');
    if (frame.duck && !previous?.duck) actions.push('duck');
    const action =
      actions.find((name) => name === this.calibration.snapshot().nextCheck) ?? actions[0];
    if (action) {
      this.lastAction = { action, timestamp: frame.timestamp };
      if (action !== 'duck') this.calibration.check(action);
    }
    if (
      this.calibration.snapshot().phase === 'ready' &&
      features.neutral &&
      !frame.guard &&
      !frame.duck &&
      !this.detector.isAttacking(frame.timestamp) &&
      previous
    ) {
      const rate = Math.min(0.005, Math.max(0, frame.timestamp - previous.timestamp) / 30000);
      const blend = (a: number, b: number) => a + (b - a) * rate;
      // Only quiet neutral samples may adapt. Never learn a punch, guard, or crouch as the baseline.
      const p = sample.aspectLandmarks;
      for (const axis of ['x', 'y', 'z'] as const) {
        baseline.head[axis] = blend(baseline.head[axis], p.nose[axis]);
        baseline.shoulderCenter[axis] = blend(
          baseline.shoulderCenter[axis],
          (p.leftShoulder[axis] + p.rightShoulder[axis]) / 2,
        );
      }
    }
    this.lastFrame = frame;
    return frame;
  }
  invalidate() {
    this.calibration.invalidate();
    this.normalizer.reset();
    this.detector.invalidate();
    this.features = null;
    this.lastFrame = null;
    this.armPose.reset();
  }
  diagnostics(): MotionDiagnostics {
    return {
      calibration: this.calibration.snapshot(),
      features: this.features,
      lastAction: this.lastAction,
      sensitivity: this.sensitivity,
      punches: this.detector.diagnostics(),
    };
  }
}
