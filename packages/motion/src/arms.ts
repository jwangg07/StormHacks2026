import type { ArmDirections, Landmark } from './types';
import type { PoseSample } from './pose';
import { reliableWorldArm } from './geometry';

/**
 * Body-relative direction: x = player's left, y = up, z = forward (toward the camera).
 * This matches a glTF humanoid facing +Z with its left side on +X.
 */
export interface Direction {
  x: number;
  y: number;
  z: number;
}

export interface ArmPose {
  left: ArmDirections | null;
  right: ArmDirections | null;
}

/** Initial segment length floors as a fraction of 2D shoulder width; tunable. */
export const UPPER_ARM_SHOULDER_RATIO = 0.75;
export const FOREARM_SHOULDER_RATIO = 0.65;
/** How quickly a remembered segment length relaxes after the player steps back. */
export const SEGMENT_LENGTH_DECAY_MS = 8000;
/** MediaPipe depth must exceed this fraction of segment length to count as "behind". */
const BEHIND_THRESHOLD = 0.3;

type Segment = 'upper' | 'fore';
type Side = 'left' | 'right';

function hypot2(a: Landmark, b: Landmark) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Recover a 3D direction for one segment from its 2D projection. A segment of
 * length L that appears d long points sqrt(L² - d²) toward or away from the
 * camera; MediaPipe depth only chooses the sign, biased forward for boxing.
 */
export function segmentDirection(from: Landmark, to: Landmark, length: number): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const projected = Math.hypot(dx, dy);
  const full = Math.max(length, projected, 1e-6);
  const depth = Math.sqrt(Math.max(0, full * full - projected * projected));
  const behind = to.z - from.z > BEHIND_THRESHOLD * full;
  // Image x grows toward the player's left; image y and MediaPipe z grow down and away.
  return { x: dx / full, y: -dy / full, z: (behind ? -depth : depth) / full };
}

/**
 * Converts pose samples into per-arm segment directions. Segment lengths are the
 * longest recently observed 2D length (when the segment lay flat to the camera),
 * floored by a shoulder-width ratio so a fresh session starts sensible.
 */
export class ArmPoseEstimator {
  private lengths: Record<Side, Record<Segment, number>> = {
    left: { upper: 0, fore: 0 },
    right: { upper: 0, fore: 0 },
  };
  private lastTimestamp = -Infinity;

  update(sample: PoseSample | null): ArmPose {
    if (!sample) return { left: null, right: null };
    const points = sample.aspectLandmarks;
    const timestamp = sample.frame.timestamp;
    if (timestamp - this.lastTimestamp > 300) this.reset();
    const elapsed = Math.max(0, timestamp - this.lastTimestamp);
    this.lastTimestamp = timestamp;
    const decay = Number.isFinite(elapsed) ? Math.exp(-elapsed / SEGMENT_LENGTH_DECAY_MS) : 0;
    const shoulderWidth =
      points.leftShoulder && points.rightShoulder
        ? hypot2(points.leftShoulder, points.rightShoulder)
        : 0;
    const arm = (side: Side): ArmDirections | null => {
      const shoulder = points[`${side}Shoulder`];
      const elbow = points[`${side}Elbow`];
      const wrist = points[`${side}Wrist`];
      if (!shoulder || !elbow || !wrist) return null;
      const lengths = this.lengths[side];
      const calibrated = sample.segmentRatios?.[side];
      lengths.upper = calibrated
        ? Math.max(hypot2(shoulder, elbow), calibrated.upper * shoulderWidth)
        : Math.max(
            hypot2(shoulder, elbow),
            lengths.upper * decay,
            UPPER_ARM_SHOULDER_RATIO * shoulderWidth,
          );
      lengths.fore = calibrated
        ? Math.max(hypot2(elbow, wrist), calibrated.fore * shoulderWidth)
        : Math.max(
            hypot2(elbow, wrist),
            lengths.fore * decay,
            FOREARM_SHOULDER_RATIO * shoulderWidth,
          );
      const upper = segmentDirection(shoulder, elbow, lengths.upper);
      const fore = segmentDirection(elbow, wrist, lengths.fore);
      const world = reliableWorldArm(sample, side);
      const blend = (direction: Direction, from: Landmark, to: Landmark): Direction => {
        const dx = to.x - from.x,
          dy = from.y - to.y,
          dz = from.z - to.z;
        const magnitude = Math.hypot(dx, dy, dz);
        if (magnitude < 1e-6) return direction;
        const measured = { x: dx / magnitude, y: dy / magnitude, z: dz / magnitude };
        if (direction.x * measured.x + direction.y * measured.y + direction.z * measured.z < -0.25)
          return direction;
        const x = direction.x * 0.45 + measured.x * 0.55;
        const y = direction.y * 0.45 + measured.y * 0.55;
        const z = direction.z * 0.45 + measured.z * 0.55;
        const length = Math.hypot(x, y, z);
        return { x: x / length, y: y / length, z: z / length };
      };
      return world
        ? {
            upper: blend(upper, world.shoulder, world.elbow),
            fore: blend(fore, world.elbow, world.wrist),
          }
        : { upper, fore };
    };
    return { left: arm('left'), right: arm('right') };
  }

  reset() {
    this.lengths = { left: { upper: 0, fore: 0 }, right: { upper: 0, fore: 0 } };
    this.lastTimestamp = -Infinity;
  }
}
