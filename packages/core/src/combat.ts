import type { FighterState, Hand, Seat } from './protocol';

export type CombatOutcome = 'HIT' | 'BLOCK' | 'MISS';

function distanceSquared(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

/** Canonical, bounded P0 geometry. Client speed never affects damage. */
export function resolveAttack(
  attacker: FighterState,
  defender: FighterState,
  hand: Hand,
): CombatOutcome {
  // Fighters face each other: the defender's left is the attacker's right.
  // Slipping away from that hand's strike lane avoids it, even with guard raised.
  if (defender.dodge === hand) return 'MISS';
  const glove = hand === 'left' ? attacker.leftHand : attacker.rightHand;
  const head = defender.headOffset;
  const headInPath =
    !defender.duck && Math.abs(head.y) < 0.65 && distanceSquared(glove, head) <= 2.25;
  if (!headInPath) return 'MISS';
  if (defender.guard) {
    const leftGuard = distanceSquared(defender.leftHand, head) <= 0.64;
    const rightGuard = distanceSquared(defender.rightHand, head) <= 0.64;
    if (leftGuard || rightGuard) return 'BLOCK';
  }
  return 'HIT';
}

export function otherSeat(seat: Seat): Seat {
  return seat === 'A' ? 'B' : 'A';
}
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
