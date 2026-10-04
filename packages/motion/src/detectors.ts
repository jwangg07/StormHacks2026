import type { NormalizedFeatures } from './normalize';
import type { Hand, MotionFrame } from './types';
import { distance2 } from './geometry';

export const PUNCH_COOLDOWN_MS = 450;
export interface PunchDiagnostic {
  status: 'return-to-rest' | 'cooldown' | 'need-extension' | 'need-motion' | 'detected';
  extension: number;
  imageSpeed: number;
  forwardSpeed: number;
}
const emptyDiagnostic = (): PunchDiagnostic => ({
  status: 'return-to-rest',
  extension: 0,
  imageSpeed: 0,
  forwardSpeed: 0,
});
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
  private punches: Record<Hand, PunchDiagnostic> = {
    left: emptyDiagnostic(),
    right: emptyDiagnostic(),
  };
  constructor(private sensitivity = 1) {}

  update(features: NormalizedFeatures): MotionFrame {
    const now = features.timestamp;
    const last = this.history.at(-1);
    if (last && now <= last.timestamp) return this.frame(features);
    if (last && now - last.timestamp > 200) this.invalidate();
    this.history = this.history.filter((frame) => now - frame.timestamp <= 300);
    for (const hand of ['left', 'right'] as const) {
      const arm = features.arms[hand];
      const atRest =
        arm.restDistance < 0.65 || distance2(arm.wrist, features.head) <= 0.8 * this.sensitivity;
      if (arm.elbowAngle < 140 && atRest) this.armed[hand] = true;
      this.punches[hand] = {
        ...emptyDiagnostic(),
        status:
          now - this.punchAt < PUNCH_COOLDOWN_MS
            ? 'cooldown'
            : this.armed[hand]
              ? 'need-extension'
              : 'return-to-rest',
      };
    }
    const candidates: { hand: Hand; score: number }[] = [];
    if (now - this.punchAt >= PUNCH_COOLDOWN_MS) {
      for (const hand of ['left', 'right'] as const) {
        if (!this.armed[hand]) continue;
        const arm = features.arms[hand];
        let bestScore = 0;
        for (const before of this.history) {
          const elapsed = now - before.timestamp,
            oldArm = before.arms[hand];
          if (elapsed < 50 || elapsed > 250) continue;
          const sameWorld = arm.depthReliable && oldArm.depthReliable;
          const imageExtension =
            oldArm.imageElbowAngle <= 145 ? arm.imageElbowAngle - oldArm.imageElbowAngle : 0;
          const worldExtension =
            sameWorld && oldArm.elbowAngle <= 145 ? arm.elbowAngle - oldArm.elbowAngle : 0;
          // Projected elbow angles can rise on retraction after foreshortening.
          // When both world samples are credible, use their consistent angle.
          const extension = sameWorld ? worldExtension : imageExtension;
          const speed = (distance2(arm.wrist, oldArm.wrist) * 1000) / elapsed;
          const forwardTravel = sameWorld ? oldArm.wrist.z - arm.wrist.z : 0;
          const forwardSpeed = Math.max(0, (forwardTravel * 1000) / elapsed);
          const diagnostic = this.punches[hand];
          diagnostic.extension = Math.max(diagnostic.extension, extension);
          diagnostic.imageSpeed = Math.max(diagnostic.imageSpeed, speed);
          diagnostic.forwardSpeed = Math.max(diagnostic.forwardSpeed, forwardSpeed);
          if (extension < 25 / this.sensitivity) continue;
          diagnostic.status = 'need-motion';
          const imageMotion = speed > 1.5 / this.sensitivity && arm.reach > oldArm.reach + 0.12;
          // A forward punch may shrink in 2D. Require independent image forearm
          // foreshortening PLUS rising elbow extension and outward world reach;
          // a depth spike or body lean cannot trigger an attack by itself.
          const forwardMotion =
            sameWorld &&
            worldExtension >= 25 / this.sensitivity &&
            forwardTravel >= 0.2 / this.sensitivity &&
            forwardSpeed > 1.5 / this.sensitivity &&
            arm.worldReach !== undefined &&
            oldArm.worldReach !== undefined &&
            arm.worldReach > oldArm.worldReach + 0.12 &&
            oldArm.projectedForearm - arm.projectedForearm >= 0.12 / this.sensitivity;
          if (imageMotion || forwardMotion)
            bestScore = Math.max(
              bestScore,
              extension * (imageMotion ? speed : forwardSpeed) * features.confidence,
            );
        }
        if (bestScore > 0) candidates.push({ hand, score: bestScore });
      }
    }
    // Stable left-first tie break, with confidence-weighted strongest extension winning.
    candidates.sort((a, b) => b.score - a.score || (a.hand === 'left' ? -1 : 1));
    const punch = candidates[0]?.hand;
    if (punch) {
      this.punchAt = now;
      this.armed[punch] = false;
      this.punches[punch].status = 'detected';
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
    this.punches = { left: emptyDiagnostic(), right: emptyDiagnostic() };
  }
  diagnostics() {
    return { left: { ...this.punches.left }, right: { ...this.punches.right } };
  }
  isAttacking(now: number) {
    return now - this.punchAt < PUNCH_COOLDOWN_MS;
  }
}
