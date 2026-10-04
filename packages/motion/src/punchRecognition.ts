import { clamp, distance2 } from './geometry';
import type { ArmFeatures, NormalizedFeatures } from './normalize';
import type { Hand, PunchMove } from './types';

export const MIN_PUNCH_SPEED = 2;
export const MIN_PUNCH_TRAVEL = 0.16;
export const MIN_STRAIGHT_SPEED = 3;
export const MIN_STRAIGHT_TRAVEL = 0.22;

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

function swingArc(before: ArmFeatures, after: ArmFeatures) {
  const ax = before.wrist.x - before.shoulder.x,
    ay = before.wrist.y - before.shoulder.y;
  const bx = after.wrist.x - after.shoulder.x,
    by = after.wrist.y - after.shoulder.y;
  const length = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return length < 1e-6
    ? 0
    : (Math.acos(clamp((ax * bx + ay * by) / length, -1, 1)) * 180) / Math.PI;
}

/** Detect a fast attacking limb first, then classify the path of that same limb. */
export function recognizePunch(
  before: NormalizedFeatures,
  current: NormalizedFeatures,
  previous: NormalizedFeatures,
  hand: Hand,
  sensitivity: number,
  confirmedMotion: PunchMove | false = false,
) {
  const arm = current.arms[hand],
    old = before.arms[hand],
    last = previous.arms[hand];
  const dt = current.timestamp - before.timestamp,
    recentDt = current.timestamp - previous.timestamp;
  const path = wristTravel(old, arm),
    recent = wristTravel(last, arm);
  const speed = (path.distance * 1000) / dt,
    recentSpeed = (recent.distance * 1000) / recentDt;
  const elbowDistance = elbowTravel(old, arm);
  const elbowSpeed = (elbowDistance * 1000) / dt;
  const recentElbowSpeed = (elbowTravel(last, arm) * 1000) / recentDt;
  const sameWorld = old.depthReliable && arm.depthReliable;
  const forwardTravel = sameWorld ? old.wrist.z - arm.wrist.z : 0;
  const forwardSpeed = Math.max(0, (forwardTravel * 1000) / dt);
  const recentForwardSpeed =
    last.depthReliable && arm.depthReliable
      ? Math.max(0, ((last.wrist.z - arm.wrist.z) * 1000) / recentDt)
      : 0;
  const extension = sameWorld
    ? arm.elbowAngle - old.elbowAngle
    : arm.imageElbowAngle - old.imageElbowAngle;
  const arc = swingArc(old, arm);
  const diagnostic = {
    extension,
    imageSpeed: Math.max(speed, elbowSpeed),
    forwardSpeed,
    swingArc: arc,
  };

  // Depth alone cannot choose a hand. Require visible movement of that arm,
  // or a shortening forearm projection, to corroborate an estimated depth push.
  const forearmShortening = old.projectedForearm - arm.projectedForearm;
  const visibleForward =
    forearmShortening >= 0.04 || path.distance >= 0.04 || elbowDistance >= 0.06;
  const forward =
    forwardTravel >= Math.max(0.12, 0.12 / sensitivity) &&
    (confirmedMotion ||
      (forwardSpeed >= MIN_PUNCH_SPEED && recentForwardSpeed >= MIN_PUNCH_SPEED)) &&
    visibleForward;
  const projectedForward =
    forearmShortening >= 0.08 &&
    elbowDistance >= Math.max(0.12, 0.12 / sensitivity) &&
    path.distance + elbowDistance >= Math.max(0.18, 0.18 / sensitivity) &&
    path.distance >= 0.02 &&
    (confirmedMotion || (elbowSpeed >= MIN_PUNCH_SPEED && recentElbowSpeed >= MIN_PUNCH_SPEED));

  const returningToRest = arm.restDistance < 0.3 && old.restDistance > arm.restDistance + 0.04;
  const dx = Math.abs(path.x),
    dy = Math.abs(path.y);
  const imageExtension = arm.imageElbowAngle - old.imageElbowAngle;
  const straightening = imageExtension >= 30 && arm.imageElbowAngle >= 140;
  const curvedSweep =
    path.distance >= 0.24 &&
    arc >= 20 &&
    arm.imageElbowAngle < 155 &&
    !straightening &&
    arm.reach >= old.reach * 0.65 &&
    arm.reach - old.reach < path.distance * 0.55 &&
    Math.abs(arm.reach - old.reach) < path.distance * 0.65;
  const retracting =
    (sameWorld && forwardTravel < -0.08 && extension < -8) ||
    (arm.reach < old.reach - 0.15 && !curvedSweep);
  const downward =
    (path.y > 0.12 && path.y > Math.abs(path.x) * 1.15) ||
    (recent.y > 0 && recent.y > Math.abs(recent.x) * 1.15);
  const raisingGuard = (['left', 'right'] as const).every((side) => {
    const now = current.arms[side];
    return (
      wristTravel(before.arms[side], now).y < -0.02 &&
      now.wrist.y < now.shoulder.y - 0.2 &&
      distance2(now.wrist, current.head) <= 0.8 * sensitivity
    );
  });
  // A camera-directed extension can shorten the 2D shoulder-to-wrist distance
  // and approach the calibrated wrist position without being a return stroke.
  if (
    raisingGuard ||
    ((returningToRest || retracting || downward) && !forward && !projectedForward)
  )
    return { diagnostic, candidate: null };

  // Fast outward wrist travel is sufficient even when elbow/depth estimates
  // are flat or inconsistent. A larger travel floor rejects rest jitter.
  const image =
    (confirmedMotion || (speed >= MIN_PUNCH_SPEED && recentSpeed >= MIN_PUNCH_SPEED)) &&
    path.distance >= Math.max(MIN_PUNCH_TRAVEL, MIN_PUNCH_TRAVEL / sensitivity);
  if (!image && !forward && !projectedForward) return { diagnostic, candidate: null };

  const bent = arm.imageElbowAngle < 155;
  const uppercut =
    !forward &&
    !projectedForward &&
    bent &&
    old.wrist.y - old.shoulder.y >= 0.15 &&
    path.y <= -0.35 / sensitivity &&
    dy >= dx * 2 &&
    (old.reach < 0.65 || arm.reach > old.reach + 0.08);
  const hook = image && curvedSweep;
  // Straight attacks need a predominantly outward path or a corroborated
  // forward push. An unfinished curved swing is not a default jab.
  const radialGain = arm.reach - old.reach;
  const straight =
    forward ||
    projectedForward ||
    (image && radialGain >= path.distance * 0.55) ||
    (image && straightening) ||
    (image && !bent && dx > dy * 1.25);
  if (!uppercut && !hook && !straight) return { diagnostic, candidate: null };
  const move: PunchMove = uppercut ? 'uppercut' : hook ? 'hook' : hand === 'left' ? 'jab' : 'cross';
  if (move === 'jab' || move === 'cross') {
    // A generic fast swing is not enough to start a straight. Small wind-ups
    // can exceed the swing threshold without being an attacking extension.
    const pulse = (average: number, latest: number) =>
      average + 1e-6 >= MIN_STRAIGHT_SPEED && latest + 1e-6 >= MIN_STRAIGHT_SPEED;
    const straightPulse =
      (image &&
        path.distance + 1e-6 >= Math.max(MIN_STRAIGHT_TRAVEL, MIN_STRAIGHT_TRAVEL / sensitivity) &&
        pulse(speed, recentSpeed)) ||
      (forward &&
        forwardTravel >= Math.max(0.16, 0.16 / sensitivity) &&
        pulse(forwardSpeed, recentForwardSpeed)) ||
      (projectedForward &&
        path.distance + elbowDistance >= Math.max(0.24, 0.24 / sensitivity) &&
        pulse(elbowSpeed, recentElbowSpeed));
    const alreadyStraight = confirmedMotion === 'jab' || confirmedMotion === 'cross';
    if (!straightPulse && !alreadyStraight) return { diagnostic, candidate: null };
  }
  const currentSpeed = Math.max(
    image ? recentSpeed : 0,
    forward ? recentForwardSpeed : 0,
    projectedForward ? recentElbowSpeed : 0,
  );
  const score =
    Math.max(
      image ? path.distance * speed : 0,
      forward ? forwardTravel * forwardSpeed : 0,
      projectedForward ? elbowDistance * elbowSpeed : 0,
    ) * current.confidence;
  return { diagnostic, candidate: { hand, move, speed: currentSpeed, score } };
}
