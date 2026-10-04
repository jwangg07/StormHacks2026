export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface YawObservation {
  /** Shoulder width over torso height: largest facing the camera or facing away, smallest side-on. */
  ratio: number;
  /** +1 / -1 when world landmarks clearly show which way the chest turns, else 0. */
  turn: number;
  /** Nose x minus the shoulder-midpoint x, over torso height (+ = image right). The face leads the turn. */
  nose: number;
  /** Mean visibility of the nose and eyes (0–1): high facing the camera, low facing away. */
  face: number;
}

/** World-landmark chest angle below which the turn direction is too noisy to vote. */
const TURN_SIGNAL_RAD = (10 * Math.PI) / 180;
const NOSE = 0;
const EYES = [2, 5];

export function observeYaw(
  image: readonly PoseLandmark[],
  world: readonly PoseLandmark[],
  aspect: number,
): YawObservation | null {
  const [ls, rs, lh, rh] = [image[11], image[12], image[23], image[24]];
  if (!ls || !rs || !lh || !rh) return null;
  const shoulderWidth = Math.abs(ls.x - rs.x) * aspect;
  const torso = Math.hypot(((ls.x + rs.x - lh.x - rh.x) / 2) * aspect, (ls.y + rs.y - lh.y - rh.y) / 2);
  if (torso < 1e-3) return null;
  const wl = world[11];
  const wr = world[12];
  // MediaPipe world z grows away from the camera, so this is +yaw when the chest swings to image right.
  const angle = wl && wr ? Math.atan2(wl.z - wr.z, wl.x - wr.x) : 0;
  const nose = image[NOSE];
  const face = [NOSE, ...EYES].reduce((sum, index) => sum + (image[index]?.visibility ?? 0), 0) / (EYES.length + 1);
  return {
    ratio: shoulderWidth / torso,
    turn: Math.abs(angle) > TURN_SIGNAL_RAD ? Math.sign(angle) : 0,
    nose: nose ? ((nose.x - (ls.x + rs.x) / 2) * aspect) / torso : 0,
    face,
  };
}

const CALIBRATION_FRAMES = 30;
const MIN_CALIBRATION_FRAMES = 5;
/** Per-frame EMA weight for the shoulder ratio and face visibility. */
const SMOOTHING = 0.4;
/** A side view needs shoulders at least this much narrower (relative) than the wide view before it. */
const NARROWING = 0.25;
/** A turning point has passed once the ratio has moved back this share of the current range. */
const TURN_BACK = 0.2;
/** The back view has passed once the width has fallen back this share of the range (smaller: the back is flat). */
const PEAK_TURN_BACK = 0.06;
/** Width this close to the wide level (normalized) is "the back view": |cos| can't tell 160° from 200°. */
const BACK_BAND = 0.94;
/** A back view (Q1 peak) counts only after the ratio has climbed this share of the way back from the side. */
const BACK_RISE = 0.5;
/** A second side view (Q2 low) must come at least this share of the way back down to the first side's floor. */
const SIDE_FALL = 0.5;
/** Face hidden: smoothed face visibility below this share of its calibrated front level. */
const FACE_HIDDEN = 0.5;
/** Face visibility at the front must be at least this for the face cue to be trusted at all. */
const FACE_TRUSTED = 0.5;
/** Direction votes: nose offset change (torso heights) that counts as the head turning. */
const NOSE_VOTE = 0.03;
const VOTE_BELOW = 0.95;
/** Backlash: reported yaw = max(reported, estimate − HOLD_DEG), so noise can't ratchet it forward. */
const HOLD_DEG = 3;
/** Done once back at the front: normalized width this close to the calibrated front. */
const DONE = 0.95;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const acosDeg = (value: number) => (Math.acos(clamp01(value)) * 180) / Math.PI;

/**
 * Turns per-frame observations into degrees turned (0–360) for one continuous turn.
 *
 * Shoulder width over torso height only gives |cos(yaw)|, so the tracker walks four quadrants
 * in order — narrowing to the first side (Q0, 0–90°), widening to the back (Q1, 90–180°),
 * narrowing to the second side (Q2, 180–270°), widening to the front (Q3, 270–360°) — and never
 * goes back. Real side views rarely get very narrow, so nothing uses absolute width thresholds:
 * - The ratio is EMA-smoothed and divided by the calibrated front width.
 * - Inside a quadrant, the width is mapped to an angle between the levels actually seen: the
 *   side "floor" is the narrowest width seen at the side view (assumed 0 before the first side
 *   view), the wide level is the front (1) or the observed back peak.
 * - A side view has passed once the width has narrowed by ≥25% from the wide level and has
 *   since risen back by 20% of the range. A back view has passed once the width has climbed at
 *   least halfway back from the side and has since fallen 6% of the range (the back is flat, so
 *   a smaller margin is needed to commit before the estimate falls behind).
 * - Width barely changes within ~20° of the back, so any width in the top 6% of the range
 *   while widening (Q1) is reported as the back view, 180°.
 * - Face cue: when nose/eye visibility drops to half its front level during the first narrowing,
 *   the player is facing away, so the tracker moves to Q1 even if the width never rose. When the
 *   face reappears after having been hidden, the second side view has passed (Q2 → Q3). BlazePose
 *   often draws a face on a back view; then the face cue stays silent and the width rules decide.
 * - The reported yaw never decreases and trails the estimate by HOLD_DEG (backlash), so noise
 *   around a steady pose can't ratchet it forward. `done` fires back at the front in Q3.
 * Direction: during the first narrowing, world-landmark chest-angle votes and nose-offset votes
 * (the face swings toward the turn) are summed; the sign wins, +1 on a tie.
 */
export class YawTracker {
  direction: 1 | -1 = 1;
  private ratios: number[] = [];
  private noses: number[] = [];
  private faces: number[] = [];
  private front = 0;
  private noseFront = 0;
  private faceFront = 0;
  private quadrant = 0;
  private smoothed = 1;
  private face = 1;
  private faceHidden = false;
  /** Narrowest width at the first side view, and in the current Q2 narrowing. */
  private floor = 1;
  private floor2 = 1;
  /** Widest width at the back view. */
  private peak = 0;
  private votes = 0;
  private yaw = 0;

  get calibrated() {
    return this.ratios.length >= MIN_CALIBRATION_FRAMES;
  }

  /** Feed front-facing frames while the player stands still. */
  calibrate(observation: YawObservation) {
    for (const [list, value] of [
      [this.ratios, observation.ratio],
      [this.noses, observation.nose],
      [this.faces, observation.face],
    ] as const) {
      list.push(value);
      if (list.length > CALIBRATION_FRAMES) list.shift();
    }
  }

  start(): boolean {
    if (!this.calibrated) return false;
    this.front = median(this.ratios);
    this.noseFront = median(this.noses);
    this.faceFront = median(this.faces);
    this.quadrant = 0;
    this.smoothed = 1;
    this.face = this.faceFront;
    this.faceHidden = false;
    this.floor = 1;
    this.floor2 = 1;
    this.peak = 0;
    this.votes = 0;
    this.yaw = 0;
    this.direction = 1;
    return this.front > 0;
  }

  update(observation: YawObservation): { yawDeg: number; done: boolean } {
    // Smooth before clamping so noise around the front width averages out instead of only pulling down.
    this.smoothed += (observation.ratio / this.front - this.smoothed) * SMOOTHING;
    this.face += (observation.face - this.face) * SMOOTHING;
    const s = Math.min(1, this.smoothed);
    const faceTrusted = this.faceFront >= FACE_TRUSTED;
    const faceGone = faceTrusted && this.face < this.faceFront * FACE_HIDDEN;
    if (faceGone) this.faceHidden = true;

    if (this.quadrant === 0) {
      this.vote(observation, s);
      this.floor = Math.min(this.floor, s);
      const narrowed = this.floor <= 1 - NARROWING;
      if (narrowed && (s >= this.floor + TURN_BACK * (1 - this.floor) || faceGone)) this.quadrant = 1;
    } else if (this.quadrant === 1) {
      // The face cue can fire before the narrowest frame; keep lowering the floor until the width rises.
      this.floor = Math.min(this.floor, s);
      this.peak = Math.max(this.peak, s);
      const range = this.peak - this.floor;
      if (range >= BACK_RISE * (1 - this.floor) && s <= this.peak - PEAK_TURN_BACK * range) {
        this.quadrant = 2;
        this.floor2 = s;
      }
    } else if (this.quadrant === 2) {
      this.floor2 = Math.min(this.floor2, s);
      const fallen = this.floor2 <= this.floor + SIDE_FALL * (this.peak - this.floor);
      const risen = s >= this.floor2 + TURN_BACK * (this.peak - this.floor2);
      const faceBack = this.faceHidden && faceTrusted && !faceGone;
      if (fallen && (risen || faceBack)) this.quadrant = 3;
    }

    const estimate = this.estimate(s);
    if (estimate - HOLD_DEG > this.yaw) this.yaw = Math.min(360, estimate - HOLD_DEG);
    const done = this.quadrant === 3 && this.normalized(s, this.floor2, 1) >= DONE;
    if (done) this.yaw = 360;
    return { yawDeg: this.yaw, done };
  }

  /** Width mapped to |cos| between the side floor and the wide level that bound this quadrant. */
  private normalized(s: number, low: number, high: number) {
    return high - low > 1e-6 ? clamp01((s - low) / (high - low)) : 0;
  }

  private estimate(s: number): number {
    switch (this.quadrant) {
      case 0:
        // The side floor is unknown until the side view passes; assume the shoulders can fully overlap.
        return acosDeg(s);
      case 1: {
        // Width barely changes around the back view, so anywhere near the top of the range says "back".
        const n = this.normalized(s, this.floor, 1);
        return n >= BACK_BAND ? 180 : 180 - acosDeg(n);
      }
      case 2:
        return 180 + acosDeg(this.normalized(s, this.floor, this.peak));
      default:
        return 360 - acosDeg(this.normalized(s, this.floor2, 1));
    }
  }

  private vote(observation: YawObservation, s: number) {
    if (s >= VOTE_BELOW) return;
    const nose = observation.nose - this.noseFront;
    this.votes += observation.turn + (Math.abs(nose) > NOSE_VOTE ? Math.sign(nose) : 0);
    this.direction = this.votes < 0 ? -1 : 1;
  }
}
