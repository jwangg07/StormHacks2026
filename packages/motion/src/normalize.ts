import type { CalibrationBaseline } from './calibration';
import type { PoseSample } from './pose';
import type { Landmark } from './types';
import {
  clamp,
  distance2,
  distance3,
  elbowAngle,
  jointAngle,
  midpoint,
  reliableWorldArm,
} from './geometry';

export const MOTION_FEATURE_VERSION = 3;
export interface ArmFeatures {
  /** A missing wrist disables this hand only, without inventing a motion sample. */
  tracked?: boolean;
  wrist: Landmark;
  shoulder: Landmark;
  elbow?: Landmark;
  elbowAngle: number;
  imageElbowAngle: number;
  projectedForearm: number;
  worldReach?: number;
  wristSpeed: number;
  forwardSpeed: number;
  restDistance: number;
  reach: number;
  depthReliable: boolean;
}
export interface NormalizedFeatures {
  version: typeof MOTION_FEATURE_VERSION;
  timestamp: number;
  confidence: number;
  head: Landmark;
  headOffset: { x: number; y: number; z: number };
  headDrop: number;
  shoulderDrop: number;
  shoulderBalance: number;
  arms: Record<'left' | 'right', ArmFeatures>;
  neutral: boolean;
}

export class FeatureNormalizer {
  private previous: NormalizedFeatures | null = null;
  update(sample: PoseSample, baseline: CalibrationBaseline): NormalizedFeatures {
    const points = sample.aspectLandmarks;
    const center = midpoint(points.leftShoulder, points.rightShoulder);
    const width = Math.max(0.08, distance2(points.leftShoulder, points.rightShoulder));
    // Project the current camera scale onto the fixed calibration scale. This
    // compensates ordinary distance changes without learning actions into the baseline.
    const scale = clamp(baseline.shoulderWidth / width, 0.5, 2);
    const aspect = sample.frame.width / sample.frame.height;
    const project = (p: Landmark): Landmark => ({
      ...p,
      x: (p.x - aspect / 2) * scale + aspect / 2,
      y: (p.y - 0.5) * scale + 0.5,
      z: (p.z - center.z) * scale,
    });
    const projectedCenter = project(center);
    const relative = (p: Landmark): Landmark => ({
      ...p,
      x: (p.x - projectedCenter.x) / baseline.shoulderWidth,
      y: (p.y - projectedCenter.y) / baseline.shoulderWidth,
      z: clamp(p.z / baseline.shoulderWidth, -2.5, 2.5),
    });
    const head = relative(project(points.nose));
    const projectedHead = project(points.nose);
    let headDrop = (projectedHead.y - baseline.head.y) / baseline.shoulderWidth;
    let shoulderDrop = (projectedCenter.y - baseline.shoulderCenter.y) / baseline.shoulderWidth;
    const shoulderBalance =
      (points.leftShoulder.y - points.rightShoulder.y) / width - (baseline.shoulderTilt ?? 0);
    const old = this.previous;
    const dt = old ? sample.frame.timestamp - old.timestamp : 0;
    const continuous = dt > 0 && dt <= 200;
    const xyAlpha = continuous ? 1 - Math.exp(-dt / 12) : 1;
    const zAlpha = continuous ? 1 - Math.exp(-dt / 40) : 1;
    const headAlpha = continuous
      ? 1 - Math.exp(-dt / clamp(35 + baseline.jitter * 500, 35, 70))
      : 1;
    if (continuous && old) {
      head.x = old.head.x + (head.x - old.head.x) * headAlpha;
      head.y = old.head.y + (head.y - old.head.y) * headAlpha;
      head.z = old.head.z + (head.z - old.head.z) * zAlpha;
      headDrop = old.headDrop + (headDrop - old.headDrop) * headAlpha;
      shoulderDrop = old.shoulderDrop + (shoulderDrop - old.shoulderDrop) * headAlpha;
    }
    const arms = {} as NormalizedFeatures['arms'];
    for (const hand of ['left', 'right'] as const) {
      const shoulder = relative(project(points[`${hand}Shoulder`]));
      if (!points[`${hand}Wrist`]) {
        arms[hand] = {
          tracked: false,
          shoulder,
          wrist: { ...shoulder },
          elbowAngle: 0,
          imageElbowAngle: 0,
          projectedForearm: 0,
          wristSpeed: 0,
          forwardSpeed: 0,
          restDistance: Infinity,
          reach: 0,
          depthReliable: false,
        };
        continue;
      }
      const wrist = relative(project(points[`${hand}Wrist`]));
      const world = reliableWorldArm(sample, hand);
      if (world) wrist.z = clamp((world.wrist.z - world.shoulder.z) / world.width, -2.5, 2.5);
      const elbow = points[`${hand}Elbow`] ? relative(project(points[`${hand}Elbow`])) : undefined;
      const before = old?.arms[hand].tracked === false ? undefined : old?.arms[hand];
      if (continuous && before) {
        for (const axis of ['x', 'y'] as const) {
          const previous = before.wrist[axis] - before.shoulder[axis];
          wrist[axis] =
            shoulder[axis] + previous + (wrist[axis] - shoulder[axis] - previous) * xyAlpha;
          if (before.elbow && elbow) {
            const oldElbow = before.elbow[axis] - before.shoulder[axis];
            elbow[axis] =
              shoulder[axis] + oldElbow + (elbow[axis] - shoulder[axis] - oldElbow) * xyAlpha;
          }
        }
        if (before.depthReliable === !!world)
          wrist.z = before.wrist.z + (wrist.z - before.wrist.z) * zAlpha;
      }
      const angle = elbow ? elbowAngle(sample, hand) : 0;
      const smoothedAngle =
        continuous && before && before.depthReliable === !!world
          ? before.elbowAngle + (angle - before.elbowAngle) * xyAlpha
          : angle;
      // Keep image evidence continuous when estimated world geometry comes and goes.
      const imageAngle = elbow
        ? jointAngle(points[`${hand}Shoulder`], points[`${hand}Elbow`], points[`${hand}Wrist`])
        : 0;
      const imageElbowAngle =
        continuous && before
          ? before.imageElbowAngle + (imageAngle - before.imageElbowAngle) * xyAlpha
          : imageAngle;
      const forearm = elbow
        ? (distance2(points[`${hand}Elbow`], points[`${hand}Wrist`]) * scale) /
          baseline.shoulderWidth
        : 0;
      const projectedForearm =
        continuous && before
          ? before.projectedForearm + (forearm - before.projectedForearm) * xyAlpha
          : forearm;
      const reach = world ? distance3(world.shoulder, world.wrist) / world.width : undefined;
      const worldReach =
        reach === undefined
          ? undefined
          : continuous && before?.worldReach !== undefined && before.depthReliable
            ? before.worldReach + (reach - before.worldReach) * xyAlpha
            : reach;
      arms[hand] = {
        tracked: true,
        wrist,
        shoulder,
        elbow,
        elbowAngle: smoothedAngle,
        imageElbowAngle,
        projectedForearm,
        worldReach,
        wristSpeed:
          continuous && before
            ? (Math.hypot(
                wrist.x - shoulder.x - (before.wrist.x - before.shoulder.x),
                wrist.y - shoulder.y - (before.wrist.y - before.shoulder.y),
              ) *
                1000) /
              dt
            : 0,
        forwardSpeed:
          continuous && before && !!world === before.depthReliable
            ? clamp(((before.wrist.z - wrist.z) * 1000) / dt, -5, 5)
            : 0,
        restDistance: distance2(wrist, baseline.restWrists[hand]),
        reach: distance2(wrist, shoulder),
        depthReliable: !!world,
      };
    }
    const neutral =
      Math.abs(headDrop) < 0.12 &&
      Math.abs(shoulderDrop) < 0.12 &&
      (['left', 'right'] as const).every(
        (hand) =>
          arms[hand].elbowAngle < 145 &&
          arms[hand].restDistance < 0.3 &&
          arms[hand].wristSpeed < 0.3,
      );
    const result: NormalizedFeatures = {
      version: MOTION_FEATURE_VERSION,
      timestamp: sample.frame.timestamp,
      confidence: sample.confidence,
      head,
      headDrop,
      shoulderDrop,
      shoulderBalance,
      arms,
      neutral,
      headOffset: {
        x: clamp((projectedHead.x - baseline.head.x) / baseline.shoulderWidth, -0.45, 0.45),
        y: clamp(-headDrop, -0.65, 0.3),
        z: clamp(
          (baseline.head.z - baseline.shoulderCenter.z) / baseline.shoulderWidth - head.z,
          -0.5,
          0.5,
        ),
      },
    };
    if (continuous && old)
      result.headOffset.x = old.headOffset.x + (result.headOffset.x - old.headOffset.x) * headAlpha;
    this.previous = result;
    return result;
  }
  reset() {
    this.previous = null;
  }
}
