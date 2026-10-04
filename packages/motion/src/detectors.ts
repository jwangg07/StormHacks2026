import type { NormalizedFeatures } from './normalize';
import type { Hand, MotionFrame, PunchMove } from './types';
import { distance2 } from './geometry';
import { elbowTravel, recognizePunch, wristTravel } from './punchRecognition';
export { MIN_PUNCH_SPEED } from './punchRecognition';

export const PUNCH_COOLDOWN_MS = 160;
export const PUNCH_COMBO_GAP_MS = 60;
export const PUNCH_CLASSIFICATION_MS = 60;
const PUNCH_REARM_MS = 80;
type PunchCandidate = { hand: Hand; move: PunchMove; speed: number; score: number };
interface PendingPunch {
  origin: NormalizedFeatures;
  candidate: PunchCandidate;
  seenAt: number;
  completed: boolean;
  peak: NormalizedFeatures;
}
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
export class ActionDetector {
  private history: NormalizedFeatures[] = [];
  private armed: Record<Hand, boolean> = { left: false, right: false };
  private armedAt: Record<Hand, number> = { left: Infinity, right: Infinity };
  private needsRearm: Record<Hand, boolean> = { left: false, right: false };
  private rearmSince: Record<Hand, number | null> = { left: null, right: null };
  private punchAt = -Infinity;
  private handPunchAt: Record<Hand, number> = { left: -Infinity, right: -Infinity };
  private pending: Record<Hand, PendingPunch | null> = { left: null, right: null };
  private recovery: Record<Hand, { origin: NormalizedFeatures; peak: NormalizedFeatures } | null> =
    { left: null, right: null };
  private guard = false;
  private guardEnter: number | null = null;
  private guardExit: number | null = null;
  private duck = false;
  private duckEnter: number | null = null;
  private duckExit: number | null = null;
  private duckAt = -Infinity;
  private duckNeedsRearm = false;
  private dodge: Hand | null = null;
  private dodgeEnter: { hand: Hand; since: number } | null = null;
  private dodgeExit: number | null = null;
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
      if (!this.armed[hand]) {
        const recovery = this.recovery[hand];
        const launch = recovery?.origin.arms[hand],
          peak = recovery?.peak.arms[hand];
        const returned =
          launch &&
          peak &&
          ((wristTravel(launch, peak).distance >= 0.16 &&
            wristTravel(peak, arm).distance >= 0.1 &&
            wristTravel(launch, arm).distance <= wristTravel(launch, peak).distance * 0.65) ||
            (launch.depthReliable &&
              peak.depthReliable &&
              arm.depthReliable &&
              launch.wrist.z - peak.wrist.z >= 0.12 &&
              arm.wrist.z - peak.wrist.z >= 0.06 &&
              launch.wrist.z - arm.wrist.z <= (launch.wrist.z - peak.wrist.z) * 0.65) ||
            (launch.elbow &&
              peak.elbow &&
              arm.elbow &&
              elbowTravel(launch, peak) >= 0.12 &&
              elbowTravel(peak, arm) >= 0.08 &&
              elbowTravel(launch, arm) <= elbowTravel(launch, peak) * 0.65 &&
              arm.projectedForearm >= peak.projectedForearm + 0.06));
        if (returned) {
          this.armed[hand] = true;
          this.armedAt[hand] = now;
          this.needsRearm[hand] = false;
          this.recovery[hand] = null;
        } else if ((!this.needsRearm[hand] || atRest) && arm.wristSpeed < 1.2) {
          this.rearmSince[hand] ??= now;
          if (!this.needsRearm[hand] || now - this.rearmSince[hand] >= PUNCH_REARM_MS) {
            this.armed[hand] = true;
            this.armedAt[hand] = now;
            this.needsRearm[hand] = false;
          }
        } else this.rearmSince[hand] = null;
      }
      this.punches[hand] = {
        ...emptyDiagnostic(),
        status:
          now - this.handPunchAt[hand] < PUNCH_COOLDOWN_MS
            ? 'cooldown'
            : this.armed[hand]
              ? 'need-motion'
              : 'return-to-rest',
      };
    }
    const candidates: PunchCandidate[] = [];
    // Separate hand recovery allows a fresh opposite-hand strike during a combination.
    if (last) {
      for (const hand of ['left', 'right'] as const) {
        if (!this.armed[hand]) continue;
        let pending = this.pending[hand];
        let classificationReady = false;
        if (pending && now - pending.seenAt > 100) pending = null;
        let best: PunchCandidate | null = null;
        let origin: NormalizedFeatures | null = null;
        for (const before of this.history) {
          const elapsed = now - before.timestamp;
          if (
            elapsed < 25 ||
            elapsed > 250 ||
            before.timestamp < this.armedAt[hand] ||
            before.timestamp < this.handPunchAt[hand]
          )
            continue;
          const { diagnostic, candidate } = recognizePunch(
            before,
            features,
            last,
            hand,
            this.sensitivity,
          );
          const current = this.punches[hand];
          current.extension = Math.max(current.extension, diagnostic.extension);
          current.imageSpeed = Math.max(current.imageSpeed, diagnostic.imageSpeed);
          current.forwardSpeed = Math.max(current.forwardSpeed, diagnostic.forwardSpeed);
          current.swingArc = Math.max(current.swingArc, diagnostic.swingArc);
          if (candidate && (!best || candidate.score > best.score)) {
            best = candidate;
            origin = before;
          }
        }
        if (!pending && best && origin) {
          pending = { origin, candidate: best, seenAt: now, completed: false, peak: features };
          classificationReady = true;
        } else if (pending) {
          // Keep the launch point fixed so a hook's developing arc cannot be
          // replaced by a short straight-looking segment from later in the swing.
          const evolving = recognizePunch(
            pending.origin,
            features,
            last,
            hand,
            this.sensitivity,
            pending.candidate.move,
          ).candidate;
          if (!pending.completed && evolving && now - pending.origin.timestamp <= 250) {
            pending.candidate = {
              ...evolving,
              speed: Math.max(pending.candidate.speed, evolving.speed),
            };
            classificationReady = true;
            const launch = pending.origin.arms[hand];
            const excursion = (f: NormalizedFeatures) =>
              wristTravel(launch, f.arms[hand]).distance +
              elbowTravel(launch, f.arms[hand]) +
              Math.max(0, launch.wrist.z - f.arms[hand].wrist.z);
            if (excursion(features) > excursion(pending.peak)) pending.peak = features;
          }
          // Preserve an observed strike when a quick out-and-back jab finishes
          // before the classification window. Recoil is never a second attack.
          const launch = pending.origin.arms[hand];
          const current = features.arms[hand];
          if (
            !evolving &&
            wristTravel(launch, current).distance < 0.1 &&
            (!launch.depthReliable ||
              !current.depthReliable ||
              Math.abs(current.wrist.z - launch.wrist.z) < 0.08 ||
              (launch.elbow &&
                current.elbow &&
                elbowTravel(launch, current) < 0.1 &&
                Math.abs(current.projectedForearm - launch.projectedForearm) < 0.04))
          )
            pending.completed = true;
          classificationReady ||= pending.completed;
          if (best) pending.seenAt = now;
        }
        this.pending[hand] = pending;
        if (
          pending &&
          classificationReady &&
          now - this.punchAt >= PUNCH_COMBO_GAP_MS &&
          now - this.handPunchAt[hand] >= PUNCH_COOLDOWN_MS &&
          now - pending.origin.timestamp >= PUNCH_CLASSIFICATION_MS
        )
          candidates.push(pending.candidate);
      }
    }
    // Choose the active arm by CURRENT motion, before comparing path confidence.
    // A long/noisy path from the other arm must not steal a fresh fast jab.
    candidates.sort(
      (a, b) => b.speed - a.speed || b.score - a.score || (a.hand === 'left' ? -1 : 1),
    );
    const punch = candidates[0]?.hand;
    const move = candidates[0]?.move;
    if (punch) {
      const strike = this.pending[punch]!;
      this.recovery[punch] = { origin: strike.origin, peak: strike.peak };
      this.punchAt = now;
      this.handPunchAt[punch] = now;
      this.armed[punch] = false;
      this.needsRearm[punch] = true;
      this.rearmSince[punch] = null;
      this.pending[punch] = null;
      this.punches[punch].status = 'detected';
    }
    const attacking = now - this.punchAt < PUNCH_COOLDOWN_MS;
    const guardEvidence = (['left', 'right'] as const).every(
      (hand) =>
        distance2(features.arms[hand].wrist, features.head) <= 0.8 * this.sensitivity &&
        features.arms[hand].imageElbowAngle < 150 &&
        features.arms[hand].wrist.y < features.arms[hand].shoulder.y - 0.2,
    );
    const handsLowered = (['left', 'right'] as const).some(
      (hand) => features.arms[hand].wrist.y > features.arms[hand].shoulder.y + 0.1,
    );
    if (guardEvidence || (this.guard && !handsLowered)) {
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
    const balance = features.shoulderBalance ?? 0;
    const leanHand = balance > 0 ? 'left' : 'right';
    const holdingDodge = this.dodge === leanHand;
    const lean =
      Math.abs(balance) >= (holdingDodge ? 0.16 : 0.26) &&
      Math.abs(features.headOffset.x) >= (holdingDodge ? 0.18 : 0.28) &&
      Math.sign(balance) === Math.sign(features.headOffset.x)
        ? leanHand
        : null;
    if (attacking || this.duck) {
      this.dodge = null;
      this.dodgeEnter = null;
      this.dodgeExit = null;
    } else if (lean) {
      this.dodgeExit = null;
      if (this.dodge !== lean) {
        this.dodge = null;
        if (this.dodgeEnter?.hand !== lean) this.dodgeEnter = { hand: lean, since: now };
        else if (now - this.dodgeEnter.since >= 100) this.dodge = lean;
      }
    } else {
      this.dodgeEnter = null;
      if (this.dodge) {
        this.dodgeExit ??= now;
        if (now - this.dodgeExit >= 90) this.dodge = null;
      }
    }
    this.history.push(features);
    return { ...this.frame(features), ...(punch ? { punch, move } : {}) };
  }
  private frame(features: NormalizedFeatures): MotionFrame {
    return {
      timestamp: features.timestamp,
      tracking: 'VALID',
      headOffset: features.headOffset,
      guard: this.guard,
      duck: this.duck,
      ...(this.dodge ? { dodge: this.dodge } : {}),
    };
  }
  invalidate() {
    this.recovery = { left: null, right: null };
    this.pending = { left: null, right: null };
    this.history = [];
    this.armed = { left: false, right: false };
    this.armedAt = { left: Infinity, right: Infinity };
    this.needsRearm = { left: false, right: false };
    this.rearmSince = { left: null, right: null };
    this.guard = false;
    this.guardEnter = null;
    this.guardExit = null;
    if (this.duck) this.duckNeedsRearm = true;
    this.duck = false;
    this.duckEnter = null;
    this.duckExit = null;
    this.neutralAt = null;
    this.dodge = null;
    this.dodgeEnter = null;
    this.dodgeExit = null;
    this.punches = { left: emptyDiagnostic(), right: emptyDiagnostic() };
  }
  diagnostics() {
    return { left: { ...this.punches.left }, right: { ...this.punches.right } };
  }
  isAttacking(now: number) {
    return now - this.punchAt < PUNCH_COOLDOWN_MS;
  }
}
