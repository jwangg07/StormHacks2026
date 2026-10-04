import type { ArmDirections, Hand, PunchMove } from '@wb/motion';

export interface PunchCue {
  id: number;
  hand: Hand;
  move: PunchMove;
  at: number;
}

export const PUNCH_IMPACT_MS = 75;
export const PUNCH_DURATION_MS = 320;
const PUNCH_WINDUP_MS = 25;
const PUNCH_HOLD_MS = 95;
export const PUNCH_REACH_BOOST = 0.55;

export function dodgeView(dodge?: Hand) {
  const side = dodge === 'left' ? -1 : dodge === 'right' ? 1 : 0;
  return { x: side * 0.15, roll: side === 0 ? 0 : -side * 0.12 };
}

type Direction = ArmDirections['upper'];

const unit = (direction: Direction): Direction => {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
};

const blend = (from: Direction, to: Direction, amount: number): Direction =>
  unit({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  });

export const mixPose = (from: ArmDirections, to: ArmDirections, amount: number): ArmDirections => ({
  upper: blend(from.upper, to.upper, amount),
  fore: blend(from.fore, to.fore, amount),
});

export const BLOCK_POSE: Record<Hand, ArmDirections> = {
  left: {
    upper: unit({ x: 0.18, y: -0.43, z: 0.88 }),
    fore: unit({ x: -0.34, y: 0.88, z: 0.34 }),
  },
  right: {
    upper: unit({ x: -0.18, y: -0.43, z: 0.88 }),
    fore: unit({ x: 0.34, y: 0.88, z: 0.34 }),
  },
};

export function strikeStrength(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= PUNCH_DURATION_MS) return 0;
  if (elapsedMs < PUNCH_WINDUP_MS) return 0;
  if (elapsedMs < PUNCH_IMPACT_MS)
    return (elapsedMs - PUNCH_WINDUP_MS) / (PUNCH_IMPACT_MS - PUNCH_WINDUP_MS);
  if (elapsedMs < PUNCH_HOLD_MS) return 1;
  return Math.max(0, 1 - (elapsedMs - PUNCH_HOLD_MS) / (PUNCH_DURATION_MS - PUNCH_HOLD_MS));
}

function keyPoses(move: PunchMove, hand: Hand): [ArmDirections, ArmDirections] {
  const side = hand === 'left' ? 1 : -1;
  switch (move) {
    case 'jab':
    case 'cross':
      return [
        {
          upper: unit({ x: side * 0.55, y: -0.75, z: 0.24 }),
          fore: unit({ x: -side * 0.18, y: 0.28, z: 0.94 }),
        },
        {
          upper: unit({ x: side * 0.02, y: 0.02, z: 1 }),
          fore: unit({ x: side * 0.01, y: 0.03, z: 1 }),
        },
      ];
    case 'hook':
      return [
        {
          upper: unit({ x: side * 0.99, y: -0.2, z: 0.12 }),
          fore: unit({ x: -side * 0.2, y: 0.1, z: 0.95 }),
        },
        {
          upper: unit({ x: side * 0.89, y: -0.06, z: 0.52 }),
          fore: unit({ x: -side * 0.92, y: 0.1, z: 0.43 }),
        },
      ];
    case 'uppercut':
      return [
        {
          upper: unit({ x: side * 0.28, y: -0.95, z: 0.1 }),
          fore: unit({ x: -side * 0.08, y: 0.1, z: 0.99 }),
        },
        {
          upper: unit({ x: side * 0.1, y: -0.3, z: 0.95 }),
          fore: unit({ x: -side * 0.1, y: 0.95, z: 0.3 }),
        },
      ];
  }
}

/** A short guard-to-strike-to-guard clip in avatar space. */
export function punchPose(
  move: PunchMove,
  hand: Hand,
  elapsedMs: number,
  guard: ArmDirections,
): ArmDirections | null {
  if (elapsedMs < 0 || elapsedMs >= PUNCH_DURATION_MS) return null;
  const [windup, strike] = keyPoses(move, hand);
  if (elapsedMs < PUNCH_WINDUP_MS) return mixPose(guard, windup, elapsedMs / PUNCH_WINDUP_MS);
  if (elapsedMs < PUNCH_IMPACT_MS)
    return mixPose(
      windup,
      strike,
      (elapsedMs - PUNCH_WINDUP_MS) / (PUNCH_IMPACT_MS - PUNCH_WINDUP_MS),
    );
  if (elapsedMs < PUNCH_HOLD_MS) return strike;
  return mixPose(
    strike,
    guard,
    Math.min(1, (elapsedMs - PUNCH_HOLD_MS) / (PUNCH_DURATION_MS - PUNCH_HOLD_MS)),
  );
}
