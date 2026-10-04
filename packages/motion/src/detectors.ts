import type { ArmFeatures, NormalizedFeatures } from './normalize';
import type { Hand, MotionFrame } from './types';
import { clamp, distance2 } from './geometry';

export const PUNCH_COOLDOWN_MS = 450;
export interface PunchDiagnostic {
  status: 'return-to-rest' | 'cooldown' | 'need-extension' | 'need-motion' | 'detected';
  extension: number;
  imageSpeed: number;
  forwardSpeed: number;
  swingArc: number;
}
const emptyDiagnostic = (): PunchDiagnostic => ({
  status: 'return-to-rest',
  extension: 0,
  imageSpeed: 0,
  forwardSpeed: 0,
  swingArc: 0,
});
function swingArc(before: ArmFeatures, after: ArmFeatures) {
  const ax = before.wrist.x - before.shoulder.x,
    ay = before.wrist.y - before.shoulder.y;
  const bx = after.wrist.x - after.shoulder.x,
    by = after.wrist.y - after.shoulder.y;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return lengths < 1e-6
    ? 0
    : (Math.acos(clamp((ax * bx + ay * by) / lengths, -1, 1)) * 180) / Math.PI;
}
export class ActionDetector {
  private history: NormalizedFeatures[] = [];
  private armed: Record<Hand, boolean> = { left: false, right: false };
  private armedAt: Record<Hand, number> = { left: Infinity, right: Infinity };
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
      if (!this.armed[hand] && arm.elbowAngle < 140 && atRest) {
        this.armed[hand] = true;
        this.armedAt[hand] = now;
      }
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
          if (elapsed < 50 || elapsed > 250 || before.timestamp < this.armedAt[hand]) continue;
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
          const arc = swingArc(oldArm, arm);
          const diagnostic = this.punches[hand];
          diagnostic.extension = Math.max(diagnostic.extension, extension);
          diagnostic.imageSpeed = Math.max(diagnostic.imageSpeed, speed);
          diagnostic.forwardSpeed = Math.max(diagnostic.forwardSpeed, forwardSpeed);
          diagnostic.swingArc = Math.max(diagnostic.swingArc, arc);
          const extending = extension >= 25 / this.sensitivity;
          const returningToRest =
            arm.restDistance < 0.3 &&
            oldArm.restDistance > arm.restDistance + 0.15 &&
            (sameWorld ? arm.elbowAngle : arm.imageElbowAngle) < 145;
          if (extending || arc >= 35 / this.sensitivity) diagnostic.status = 'need-motion';
          const imageMotion =
            !returningToRest &&
            extending &&
            speed > 1.5 / this.sensitivity &&
            arm.reach > oldArm.reach + 0.12;
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
          const oldAngle = sameWorld ? oldArm.elbowAngle : oldArm.imageElbowAngle;
          const angle = sameWorld ? arm.elbowAngle : arm.imageElbowAngle;
          const travel = distance2(arm.wrist, oldArm.wrist);
          const dx = Math.abs(arm.wrist.x - oldArm.wrist.x),
            dy = Math.abs(arm.wrist.y - oldArm.wrist.y);
          const nearFace = distance2(arm.wrist, features.head) <= 0.8 * this.sensitivity;
          const radial =
            sameWorld && arm.worldReach !== undefined && oldArm.worldReach !== undefined
              ? arm.worldReach >= oldArm.worldReach - 0.1 && arm.worldReach >= 0.65
              : arm.reach >= oldArm.reach - 0.1 && arm.reach >= 0.5;
          // Wide bent-arm sweeps need a substantial arc and travel, not elbow
          // opening. Reject ordinary vertical guard raises and arm retractions.
          const swinging =
            !returningToRest &&
            oldAngle >= 20 &&
            oldAngle <= 145 &&
            angle >= 20 &&
            angle <= 155 &&
            angle >= oldAngle - 20 &&
            radial &&
            arc >= 35 / this.sensitivity &&
            travel >= 0.45 / this.sensitivity &&
            speed > 2 / this.sensitivity &&
            (!nearFace || (dx >= 0.45 / this.sensitivity && dx > dy * 1.25));
          if (imageMotion || forwardMotion || swinging)
            bestScore = Math.max(
              bestScore,
              Math.max(
                imageMotion ? extension * speed : 0,
                forwardMotion ? extension * forwardSpeed : 0,
                swinging ? arc * speed * 0.8 : 0,
              ) * features.confidence,
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
    this.armedAt = { left: Infinity, right: Infinity };
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
