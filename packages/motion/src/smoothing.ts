import type { PoseSample } from './pose';
import type { Landmark } from './types';
import { POSE_HISTORY_MS } from './pose';

/** Timestamp-based adaptive EMA: more damping at rest, less lag during fast motion. */
export class PoseSmoother {
  private previous: PoseSample | null = null;
  update(sample: PoseSample): PoseSample {
    const previous = this.previous;
    const dt = previous ? sample.frame.timestamp - previous.frame.timestamp : Infinity;
    if (sample.tracking !== 'VALID') return sample;
    if (dt <= 0) return previous ?? sample;
    const aspect = sample.frame.width / sample.frame.height;
    const filter = (
      next: Record<string, Landmark>,
      old: Record<string, Landmark> = {},
      horizontalScale = 1,
    ) => {
      const output: Record<string, Landmark> = {};
      for (const [name, point] of Object.entries(next)) {
        const before = old[name];
        if (!before || dt > POSE_HISTORY_MS) {
          output[name] = { ...point };
          continue;
        }
        const speed =
          (Math.hypot((point.x - before.x) * horizontalScale, point.y - before.y) * 1000) / dt;
        const motionSpeed = Math.max(0, speed - 0.4);
        const xyAlpha = 1 - Math.exp(-dt / Math.max(12, 55 / (1 + motionSpeed * 8)));
        const zAlpha = 1 - Math.exp(-dt / Math.max(35, 100 / (1 + speed * 4)));
        output[name] = {
          ...point,
          x: before.x + (point.x - before.x) * xyAlpha,
          y: before.y + (point.y - before.y) * xyAlpha,
          z: before.z + (point.z - before.z) * zAlpha,
        };
      }
      return output;
    };
    const landmarks = filter(sample.frame.landmarks, previous?.frame.landmarks, aspect);
    const aspectLandmarks = Object.fromEntries(
      Object.entries(landmarks).map(([name, p]) => [
        name,
        { ...p, x: p.x * aspect, z: p.z * aspect },
      ]),
    );
    const smoothed = {
      ...sample,
      frame: { ...sample.frame, landmarks },
      aspectLandmarks,
      ...(sample.worldLandmarks
        ? { worldLandmarks: filter(sample.worldLandmarks, previous?.worldLandmarks) }
        : {}),
    };
    this.previous = smoothed;
    return smoothed;
  }
  reset() {
    this.previous = null;
  }
}
