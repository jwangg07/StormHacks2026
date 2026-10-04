import type { CalibrationBaseline } from './calibration';
import type { PoseSample } from './pose';
import type { Landmark } from './types';
import { clamp, distance2, elbowAngle, midpoint, reliableWorldArm } from './geometry';

export const MOTION_FEATURE_VERSION = 1;
export interface ArmFeatures {
  wrist: Landmark;
  elbowAngle: number;
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
    const old = this.previous;
    const dt = old ? sample.frame.timestamp - old.timestamp : 0;
    const continuous = dt > 0 && dt <= 200;
    const xyAlpha = continuous ? 1 - Math.exp(-dt / 20) : 1;
    const zAlpha = continuous ? 1 - Math.exp(-dt / 80) : 1;
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
      const wrist = relative(project(points[`${hand}Wrist`]));
      const world = reliableWorldArm(sample, hand);
      if (world) wrist.z = clamp((world.wrist.z - world.shoulder.z) / world.width, -2.5, 2.5);
      const before = old?.arms[hand];
      if (continuous && before) {
        wrist.x = before.wrist.x + (wrist.x - before.wrist.x) * xyAlpha;
        wrist.y = before.wrist.y + (wrist.y - before.wrist.y) * xyAlpha;
        if (before.depthReliable === !!world)
          wrist.z = before.wrist.z + (wrist.z - before.wrist.z) * zAlpha;
      }
      const angle = elbowAngle(sample, hand);
      const smoothedAngle =
        continuous && before ? before.elbowAngle + (angle - before.elbowAngle) * xyAlpha : angle;
      const shoulder = relative(project(points[`${hand}Shoulder`]));
      arms[hand] = {
        wrist,
        elbowAngle: smoothedAngle,
        wristSpeed: continuous && before ? (distance2(wrist, before.wrist) * 1000) / dt : 0,
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
