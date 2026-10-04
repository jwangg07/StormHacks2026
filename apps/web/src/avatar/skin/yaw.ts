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
}

/** World-landmark chest angle below which the turn direction is too noisy to vote. */
const TURN_SIGNAL_RAD = (10 * Math.PI) / 180;

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
  return { ratio: shoulderWidth / torso, turn: Math.abs(angle) > TURN_SIGNAL_RAD ? Math.sign(angle) : 0 };
}

const CALIBRATION_FRAMES = 30;
const MIN_CALIBRATION_FRAMES = 5;
const SMOOTHING = 0.4;
/** Side-on: narrowest shoulders. A rise of LOW_HYSTERESIS past the minimum means the side view has passed. */
const LOW = 0.3;
const LOW_HYSTERESIS = 0.12;
/** Facing away: widest shoulders again. A drop of HIGH_HYSTERESIS past the maximum means the back view has passed. */
const HIGH = 0.8;
const HIGH_HYSTERESIS = 0.06;
const DONE = 0.97;
const VOTE_BELOW = 0.95;

/**
 * Turns shoulder-width observations into degrees turned (0–360) for one continuous turn.
 * Width only gives |cos(yaw)|, so the tracker walks quadrants: narrowing to the side,
 * widening to the back, narrowing to the other side, widening to the front. Readings
 * just past a turning point report that point (90/180/270°) until the turn has clearly passed it.
 */
export class YawTracker {
  direction: 1 | -1 = 1;
  private samples: number[] = [];
  private front = 0;
  private quadrant = 0;
  private smoothed = 1;
  private extreme = 1;
  private votes = 0;

  get calibrated() {
    return this.samples.length >= MIN_CALIBRATION_FRAMES;
  }

  /** Feed front-facing frames while the player stands still. */
  calibrate(observation: YawObservation) {
    this.samples.push(observation.ratio);
    if (this.samples.length > CALIBRATION_FRAMES) this.samples.shift();
  }

  start(): boolean {
    if (!this.calibrated) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.front = sorted[Math.floor(sorted.length / 2)];
    this.quadrant = 0;
    this.smoothed = 1;
    this.extreme = 1;
    this.votes = 0;
    this.direction = 1;
    return true;
  }

  update(observation: YawObservation): { yawDeg: number; done: boolean } {
    const c = Math.min(1, observation.ratio / this.front);
    this.smoothed += (c - this.smoothed) * SMOOTHING;
    const s = this.smoothed;
    if (this.quadrant === 0 && s < VOTE_BELOW) {
      this.votes += observation.turn;
      this.direction = this.votes < 0 ? -1 : 1;
    }
    let plateau: boolean;
    if (this.quadrant % 2 === 0) {
      // Q0 and Q2 narrow toward a side view.
      this.extreme = Math.min(this.extreme, s);
      // Just past the narrowest point: still the side view until the rise is clear.
      plateau = this.extreme < LOW && s > this.extreme && s <= this.extreme + LOW_HYSTERESIS;
      if (this.extreme < LOW && s > this.extreme + LOW_HYSTERESIS) {
        this.quadrant += 1;
        this.extreme = s;
        plateau = false;
      }
    } else {
      // Q1 widens toward the back view; Q3 widens back to the front.
      this.extreme = Math.max(this.extreme, s);
      // Just past the widest point: still the back view until the drop is clear.
      plateau = this.quadrant === 1 && this.extreme > HIGH && s < this.extreme && s >= this.extreme - HIGH_HYSTERESIS;
      if (this.quadrant === 1 && this.extreme > HIGH && s < this.extreme - HIGH_HYSTERESIS) {
        this.quadrant = 2;
        this.extreme = s;
        plateau = false;
      }
    }
    const angle = (Math.acos(s) * 180) / Math.PI;
    const yawDeg = plateau
      ? [90, 180, 270, 360][this.quadrant]
      : [angle, 180 - angle, 180 + angle, 360 - angle][this.quadrant];
    return { yawDeg, done: this.quadrant === 3 && s >= DONE };
  }
}
