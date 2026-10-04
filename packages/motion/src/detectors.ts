import type { NormalizedFeatures } from './normalize';
import type { Hand, MotionFrame } from './types';
import { distance2 } from './geometry';

export const PUNCH_COOLDOWN_MS = 450;
export class ActionDetector {
  private history: NormalizedFeatures[] = [];
  private armed: Record<Hand, boolean> = { left: false, right: false };
  private punchAt = -Infinity;
  private guard = false;
  private guardEnter: number | null = null;
  private guardExit: number | null = null;
  private duck = false;
  private duckEnter: number | null = null;
  private duckExit: number | null = null;
  private duckAt = -Infinity;
  private duckNeedsRearm = false;
  private neutralAt: number | null = null;
  constructor(private sensitivity = 1) {}

  update(features: NormalizedFeatures): MotionFrame {
    const now = features.timestamp;
    const last = this.history.at(-1);
    if (last && now <= last.timestamp) return this.frame(features);
    if (last && now - last.timestamp > 200) this.invalidate();
    this.history = this.history.filter((frame) => now - frame.timestamp <= 300);
    for (const hand of ['left', 'right'] as const) {
      const arm = features.arms[hand];
      if (arm.elbowAngle < 140 && arm.restDistance < 0.65) this.armed[hand] = true;
    }
    const candidates: { hand: Hand; score: number }[] = [];
    if (now - this.punchAt >= PUNCH_COOLDOWN_MS) {
      for (const hand of ['left', 'right'] as const) {
        if (!this.armed[hand]) continue;
        const arm = features.arms[hand];
        for (const before of this.history) {
          const elapsed = now - before.timestamp,
            oldArm = before.arms[hand];
          if (
            elapsed < 50 ||
            elapsed > 250 ||
            oldArm.elbowAngle > 145 ||
            oldArm.depthReliable !== arm.depthReliable
          )
            continue;
          const extension = arm.elbowAngle - oldArm.elbowAngle;
          const speed = (distance2(arm.wrist, oldArm.wrist) * 1000) / elapsed;
          // Depth can strengthen a candidate but cannot produce an attack alone.
          const speedEvidence =
            speed + (arm.depthReliable ? Math.max(0, arm.forwardSpeed) * 0.25 : 0);
          if (
            extension >= 25 / this.sensitivity &&
            arm.elbowAngle >= 150 &&
            speedEvidence > 1.5 / this.sensitivity &&
            speed > 0.75 / this.sensitivity &&
            arm.reach > oldArm.reach + 0.12
          ) {
            candidates.push({ hand, score: extension * speedEvidence * features.confidence });
            break;
          }
        }
      }
    }
    // Stable left-first tie break, with confidence-weighted strongest extension winning.
    candidates.sort((a, b) => b.score - a.score || (a.hand === 'left' ? -1 : 1));
    const punch = candidates[0]?.hand;
    if (punch) {
      this.punchAt = now;
      this.armed[punch] = false;
    }
    const attacking = now - this.punchAt < PUNCH_COOLDOWN_MS;
    const guardEvidence =
      !attacking &&
      (['left', 'right'] as const).every(
        (hand) =>
          distance2(features.arms[hand].wrist, features.head) <= 0.8 * this.sensitivity &&
          features.arms[hand].elbowAngle < 145,
      );
    if (attacking) {
      this.guard = false;
      this.guardEnter = null;
      this.guardExit = null;
    } else if (guardEvidence) {
      this.guardExit = null;
      this.guardEnter ??= now;
      if (now - this.guardEnter >= 100) this.guard = true;
    } else {
      this.guardEnter = null;
      this.guardExit ??= now;
      if (now - this.guardExit >= 150) this.guard = false;
    }
    const lowered =
      features.headDrop >= 0.35 / this.sensitivity &&
      features.shoulderDrop >= 0.35 / this.sensitivity;
    const neutral =
      features.headDrop < 0.2 / this.sensitivity && features.shoulderDrop < 0.2 / this.sensitivity;
    if (neutral) {
      this.neutralAt ??= now;
      if (now - this.neutralAt >= 400) this.duckNeedsRearm = false;
    } else this.neutralAt = null;
    if (attacking) {
      this.duck = false;
      this.duckEnter = null;
      this.duckExit = null;
    } else if (this.duck) {
      if (now - this.duckAt >= 800) {
        this.duck = false;
        this.duckNeedsRearm = true;
        this.duckEnter = null;
      } else if (neutral) {
        this.duckExit ??= now;
        if (now - this.duckExit >= 100) {
          this.duck = false;
          this.duckNeedsRearm = true;
          this.duckEnter = null;
        }
      } else this.duckExit = null;
    } else if (lowered && !this.duckNeedsRearm) {
      this.duckEnter ??= now;
      if (now - this.duckEnter >= 100) {
        this.duck = true;
        this.duckAt = now;
        this.duckExit = null;
      }
    } else this.duckEnter = null;
    this.history.push(features);
    return { ...this.frame(features), ...(punch ? { punch } : {}) };
  }
  private frame(features: NormalizedFeatures): MotionFrame {
    return {
      timestamp: features.timestamp,
      tracking: 'VALID',
      headOffset: features.headOffset,
      guard: this.guard,
      duck: this.duck,
    };
  }
  invalidate() {
    this.history = [];
    this.armed = { left: false, right: false };
    this.guard = false;
    this.guardEnter = null;
    this.guardExit = null;
    if (this.duck) this.duckNeedsRearm = true;
    this.duck = false;
    this.duckEnter = null;
    this.duckExit = null;
    this.neutralAt = null;
  }
  isAttacking(now: number) {
    return now - this.punchAt < PUNCH_COOLDOWN_MS;
  }
}
