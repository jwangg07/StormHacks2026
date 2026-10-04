import type { NormalizedFeatures } from './normalize';
import type { Hand, MotionFrame } from './types';
import {
  jointTravel,
  movingJoint,
  MIN_PUNCH_SPEED,
  MIN_STRAIGHT_SPEED,
  recognizePunch,
  wristTravel,
  type MotionJoint,
} from './punchRecognition';
export { MIN_PUNCH_SPEED } from './punchRecognition';
export const PUNCH_COOLDOWN_MS = 180;
export const PUNCH_COMBO_GAP_MS = 40;
const QUIET_MS = 150;
type Stroke = {
  origin: NormalizedFeatures;
  peak: NormalizedFeatures;
  joint: MotionJoint;
  emitted: boolean;
  quietSince: number | null;
};
type Recovery = { x: number; y: number; z: number; joint: MotionJoint; quietSince: number | null };
export interface PunchDiagnostic {
  status: 'return-to-rest' | 'cooldown' | 'need-motion' | 'detected';
  speed: number;
}
const emptyDiagnostic = (): PunchDiagnostic => ({ status: 'need-motion', speed: 0 });
export class ActionDetector {
  private previous: NormalizedFeatures | null = null;
  private strokes: Record<Hand, Stroke | null> = { left: null, right: null };
  private recovering: Record<Hand, Recovery | null> = { left: null, right: null };
  private handPunchAt: Record<Hand, number> = { left: -Infinity, right: -Infinity };
  private punchAt = -Infinity;
  private guard = false;
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
    if (this.previous && now <= this.previous.timestamp) return this.frame(features);
    if (this.previous && now - this.previous.timestamp > 250) this.invalidate();
    const last = this.previous;
    const hands = ['left', 'right'] as const;
    const visible = hands.every((hand) => features.arms[hand].tracked !== false);
    // Upper chest / shoulder height is enough; no face-distance or elbow-angle gate.
    const guardEvidence =
      visible &&
      hands.every(
        (hand) =>
          features.arms[hand].wrist.y - features.arms[hand].shoulder.y <= 0.2 &&
          Math.abs(features.arms[hand].wrist.x) <= 1.1,
      );
    const loweredHands =
      !visible ||
      hands.some((hand) => features.arms[hand].wrist.y - features.arms[hand].shoulder.y >= 0.3);
    if (guardEvidence) {
      this.guard = true;
      this.guardExit = null;
    } else if (loweredHands) {
      this.guardExit ??= now;
      if (!visible || now - this.guardExit >= 80) this.guard = false;
    } else this.guardExit = null;
    const wristSteps = Object.fromEntries(hands.map(hand => [hand,
      last && last.arms[hand].tracked !== false && features.arms[hand].tracked !== false
        ? wristTravel(last.arms[hand], features.arms[hand]) : { x: 0, y: 0, distance: 0 },
    ])) as Record<Hand, ReturnType<typeof wristTravel>>;
    const rises = hands.map(hand => -wristSteps[hand].y);
    const bothRaising = visible && Math.min(...rises) >= 0.06 &&
      Math.min(...rises) >= Math.max(...rises) * 0.6 &&
      hands.every(hand => Math.abs(features.arms[hand].wrist.x) <= 1.1);
    const dominantHand = hands.find(hand => {
      const other = hand === 'left' ? 'right' : 'left';
      const step = wristSteps[hand], stroke = this.strokes[hand];
      if (this.recovering[hand]) return false;
      if (stroke?.emitted) {
        const launch = wristTravel(stroke.origin.arms[hand], stroke.peak.arms[hand]);
        if (launch.x * step.x + launch.y * step.y < -0.002) return false;
      }
      return step.distance >= 0.08 && step.distance > wristSteps[other].distance * 2.5;
    });
    const candidates: NonNullable<ReturnType<typeof recognizePunch>['candidate']>[] = [];
    for (const hand of hands) {
      const arm = features.arms[hand],
        before = last?.arms[hand];
      this.punches[hand] = emptyDiagnostic();
      if (!before || before.tracked === false || arm.tracked === false) {
        this.strokes[hand] = null;
        this.recovering[hand] = null;
        continue;
      }
      if (dominantHand && hand !== dominantHand && !this.strokes[hand]?.emitted) {
        // Covering-arm noise cannot launch an attack ahead of the visible swing.
        this.strokes[hand] = null;
        continue;
      }
      const dt = now - last!.timestamp;
      const activityJoint = movingJoint(before, arm);
      const activity = jointTravel(before, arm, activityJoint);
      const joint = this.strokes[hand]?.joint ?? this.recovering[hand]?.joint ?? activityJoint;
      const step = jointTravel(before, arm, joint);
      const speed = (activity.distance * 1000) / dt;
      if (bothRaising) {
        this.strokes[hand] = null;
        continue;
      }
      const recovery = this.recovering[hand];
      if (recovery) {
        if (activityJoint !== recovery.joint && activity.distance >= 0.1 && step.distance < 0.03)
          this.recovering[hand] = null;
        else if (activity.distance < 0.03) recovery.quietSince ??= now;
        else if (step.x * recovery.x + step.y * recovery.y + step.z * recovery.z < -0.002)
          this.recovering[hand] = null;
        else recovery.quietSince = null;
        if (recovery.quietSince !== null && now - recovery.quietSince >= 40)
          this.recovering[hand] = null;
        if (this.recovering[hand]) {
          this.punches[hand].status = 'return-to-rest';
          continue;
        }
      }
      let stroke = this.strokes[hand];
      if (stroke) {
        const settled = stroke.quietSince !== null && now - stroke.quietSince >= QUIET_MS;
        const excursion = jointTravel(stroke.origin.arms[hand], arm, stroke.joint).distance;
        const peak = jointTravel(
          stroke.origin.arms[hand],
          stroke.peak.arms[hand],
          stroke.joint,
        ).distance;
        const launch = jointTravel(stroke.origin.arms[hand], stroke.peak.arms[hand], stroke.joint);
        const reversing = step.distance >= 0.04 &&
          launch.x * step.x + launch.y * step.y + launch.z * step.z < -0.002;
        if (excursion > peak) stroke.peak = features;
        if (activity.distance < 0.03) stroke.quietSince ??= now;
        else stroke.quietSince = null;
        if (peak > 0.1 && (excursion <= peak * 0.5 || (stroke.emitted && reversing))) {
          if (stroke.emitted) {
            this.strokes[hand] = null;
            this.recovering[hand] = {
              x: step.x,
              y: step.y,
              z: step.z,
              joint: stroke.joint,
              quietSince: null,
            };
            continue;
          }
          // An unclassified wind-up can reverse into a hook. Start its path at the turn.
          stroke = {
            origin: last!,
            peak: features,
            joint: movingJoint(before, arm),
            emitted: false,
            quietSince: null,
          };
          this.strokes[hand] = stroke;
        }
        if (settled && (!stroke.emitted || activity.distance >= 0.03)) {
          this.strokes[hand] = null;
          stroke = null;
        }
      }
      // Camera-facing jabs can move the elbow more than the visible wrist.
      const onsetSpeed = activityJoint === 'wrist' ? MIN_PUNCH_SPEED : MIN_STRAIGHT_SPEED;
      if (!stroke && speed >= onsetSpeed / this.sensitivity) {
        stroke = {
          origin: last!,
          peak: features,
          joint: activityJoint,
          emitted: false,
          quietSince: null,
        };
        this.strokes[hand] = stroke;
      }
      if (!stroke) continue;
      if (stroke.emitted) {
        this.punches[hand].status = 'return-to-rest';
        continue;
      }
      if (now - this.handPunchAt[hand] < PUNCH_COOLDOWN_MS) {
        this.punches[hand].status = 'cooldown';
        continue;
      }
      const result = recognizePunch(stroke.origin, features, last!, hand, this.sensitivity);
      this.punches[hand] = {
        ...result.diagnostic,
        status: result.candidate ? 'detected' : 'need-motion',
      };
      if (result.candidate) candidates.push(result.candidate);
    }
    candidates.sort((a, b) => b.score - a.score || b.speed - a.speed);
    const strike = now - this.punchAt >= PUNCH_COMBO_GAP_MS ? candidates[0] : undefined;
    if (strike) {
      this.strokes[strike.hand]!.emitted = true;
      this.handPunchAt[strike.hand] = this.punchAt = now;
    }
    const attacking = this.isAttacking(now);
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

    this.previous = features;
    return {
      ...this.frame(features),
      ...(strike ? { punch: strike.hand, move: strike.move } : {}),
    };
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
    this.previous = null;
    this.strokes = { left: null, right: null };
    this.recovering = { left: null, right: null };
    this.guard = false;
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
