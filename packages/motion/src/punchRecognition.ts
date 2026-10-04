import type { ArmFeatures, NormalizedFeatures } from './normalize';
import type { Hand, PunchMove } from './types';
export const MIN_PUNCH_SPEED = 1.25;
export const MIN_PUNCH_TRAVEL = 0.22;
export const MIN_STRAIGHT_SPEED = 1;
const MIN_STRAIGHT_TRAVEL = 0.12;
export const MIN_UPPERCUT_TRAVEL = 0.45;
export function wristTravel(before: ArmFeatures, after: ArmFeatures) {
  const x = after.wrist.x - after.shoulder.x - (before.wrist.x - before.shoulder.x);
  const y = after.wrist.y - after.shoulder.y - (before.wrist.y - before.shoulder.y);
  return { x, y, distance: Math.hypot(x, y) };
}
export function elbowTravel(before: ArmFeatures, after: ArmFeatures) {
  return before.elbow && after.elbow
    ? Math.hypot(
        after.elbow.x - after.shoulder.x - (before.elbow.x - before.shoulder.x),
        after.elbow.y - after.shoulder.y - (before.elbow.y - before.shoulder.y),
      )
    : 0;
}
export type MotionJoint = 'wrist' | 'elbow' | 'depth';
/** The same moving joint measures launch, follow-through, and return. */
export function jointTravel(before: ArmFeatures, after: ArmFeatures, joint: MotionJoint) {
  if (joint === 'depth') {
    const z = before.depthReliable && after.depthReliable ? after.wrist.z - before.wrist.z : 0;
    return { x: 0, y: 0, z, distance: Math.abs(z) };
  }
  const a = before[joint],
    b = after[joint];
  if (!a || !b) return { x: 0, y: 0, z: 0, distance: 0 };
  const x = b.x - after.shoulder.x - (a.x - before.shoulder.x);
  const y = b.y - after.shoulder.y - (a.y - before.shoulder.y);
  return { x, y, z: 0, distance: Math.hypot(x, y) };
}
export function movingJoint(before: ArmFeatures, after: ArmFeatures): MotionJoint {
  const wrist = wristTravel(before, after).distance;
  const elbow = elbowTravel(before, after);
  // Estimated depth alone cannot start a strike.
  if (
    before.projectedForearm - after.projectedForearm > 0.04 &&
    jointTravel(before, after, 'depth').distance > Math.max(wrist, elbow)
  )
    return 'depth';
  return elbow > wrist ? 'elbow' : 'wrist';
}
/** Classify one movement burst. Image direction wins over uncertain pose depth. */
export function recognizePunch(
  before: NormalizedFeatures,
  current: NormalizedFeatures,
  previous: NormalizedFeatures,
  hand: Hand,
  sensitivity: number,
) {
  const old = before.arms[hand],
    arm = current.arms[hand];
  const path = wristTravel(old, arm),
    step = wristTravel(previous.arms[hand], arm);
  const dt = Math.max(1, current.timestamp - before.timestamp);
  const travel = MIN_PUNCH_TRAVEL / sensitivity;
  const straightTravel = MIN_STRAIGHT_TRAVEL / sensitivity;
  const inward = Math.sign(
    before.arms[hand === 'left' ? 'right' : 'left'].shoulder.x - old.shoulder.x,
  );
  const rise = -path.y,
    lateral = path.x * inward;
  const elbowDistance = elbowTravel(old, arm);
  const depth = old.depthReliable && arm.depthReliable ? old.wrist.z - arm.wrist.z : 0;
  const shortening = old.projectedForearm - arm.projectedForearm;
  const radialGain = Math.hypot(arm.wrist.x - arm.shoulder.x, arm.wrist.y - arm.shoulder.y) -
    Math.hypot(old.wrist.x - old.shoulder.x, old.wrist.y - old.shoulder.y);
  const elbowRise = old.elbow && arm.elbow ?
    old.elbow.y - old.shoulder.y - (arm.elbow.y - arm.shoulder.y) : 0;
  // A rising camera-facing extension lifts the elbow faster than the fist and
  // shortens the forearm projection. Wrist rise by itself is an uppercut cue.
  const risingStraight = !!(old.elbow && arm.elbow && shortening >= 0.1 &&
    elbowRise > rise + 0.12 && Math.abs(arm.elbow.y - arm.wrist.y) <= 0.2);
  const aligned = !!(
    old.elbow &&
    arm.elbow &&
    old.wrist.y - old.shoulder.y >= -0.35 &&
    old.elbow.y - old.wrist.y > 0.12 &&
    Math.abs(arm.elbow.y - arm.wrist.y) < 0.3 &&
    old.elbow.y - old.wrist.y - (arm.elbow.y - arm.wrist.y) > 0.1 &&
    elbowDistance >= straightTravel &&
    path.distance < 0.25
  );
  let move: PunchMove | null = null;
  const continuing = path.x * step.x + path.y * step.y >= -0.005;
  const verticalRise = rise >= travel && rise > Math.abs(path.x) * 1.25;
  const straightExtension =
    arm.imageElbowAngle >= 135 || arm.imageElbowAngle - old.imageElbowAngle >= 20;
  // Keep accumulating a vertical strike until it reaches the uppercut travel floor.
  if (continuing && verticalRise) {
    if (risingStraight) move = hand === 'left' ? 'jab' : 'cross';
    else if (rise >= MIN_UPPERCUT_TRAVEL / sensitivity) move = 'uppercut';
  } else if (
    continuing &&
    ((lateral >= travel && Math.abs(path.x) >= Math.abs(path.y) * 0.9) ||
      (Math.abs(path.x) >= travel &&
        Math.abs(path.x) >= Math.abs(path.y) * 1.25 &&
        (arm.imageElbowAngle < 135 ||
          // Broad arcs remain hooks even when the elbow angle estimate looks straight.
          (Math.abs(path.x) >= 0.4 / sensitivity && radialGain < path.distance * 0.65))))
  )
    move = 'hook';
  else if (
    continuing &&
    path.y <= Math.max(travel, Math.abs(path.x) * 0.75) &&
    (aligned ||
      (path.x * -inward + 1e-6 >= 0.3 / sensitivity &&
        (old.wrist.y - old.shoulder.y >= -0.1 || path.distance >= 0.5) &&
        straightExtension) ||
      (depth >= straightTravel && (shortening > 0.04 || elbowDistance >= straightTravel)) ||
      (shortening > 0.05 && elbowDistance >= straightTravel))
  )
    move = hand === 'left' ? 'jab' : 'cross';
  const speed =
    (Math.max(
      path.distance,
      move === 'jab' || move === 'cross' ? Math.max(elbowDistance, depth) : 0,
    ) *
      1000) /
    dt;
  const diagnostic = { speed };
  return {
    diagnostic,
    candidate:
      move &&
      speed >=
        (move === 'jab' || move === 'cross' ? MIN_STRAIGHT_SPEED : MIN_PUNCH_SPEED) / sensitivity
        ? { hand, move, speed, score: Math.max(path.distance, elbowDistance * 0.5, depth * 0.5) }
        : null,
  };
}
