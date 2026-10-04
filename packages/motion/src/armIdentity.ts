import { distance2 } from './geometry';
import type { PoseSample } from './pose';
import type { Hand, Landmark } from './types';

const HANDS = ['left', 'right'] as const;
const opposite = (hand: Hand): Hand => (hand === 'left' ? 'right' : 'left');

/** Preserve wrist ownership when the pose model swaps two overlapping hands. */
export class ArmIdentityTracker {
  private previous: PoseSample | null = null;
  private older: PoseSample | null = null;
  private swapped = false;

  update(sample: PoseSample): PoseSample {
    if (
      HANDS.some(
        (hand) =>
          !sample.aspectLandmarks[`${hand}Wrist`] || !sample.aspectLandmarks[`${hand}Elbow`],
      )
    ) {
      this.reset();
      return sample;
    }
    const previous = this.previous;
    const dt = previous ? sample.frame.timestamp - previous.frame.timestamp : 0;
    if (sample.tracking !== 'VALID' || (previous && (dt <= 0 || dt > 200))) {
      this.reset();
      if (sample.tracking !== 'VALID') return sample;
    }
    let stabilized = sample;
    if (this.previous) {
      const before = this.previous;
      const points = sample.aspectLandmarks;
      const width = Math.max(0.08, distance2(points.leftShoulder, points.rightShoulder));
      const separation = distance2(
        before.aspectLandmarks.leftWrist,
        before.aspectLandmarks.rightWrist,
      );
      const older = this.older;
      const bothMoving =
        older &&
        HANDS.every(
          (hand) =>
            distance2(
              before.aspectLandmarks[`${hand}Wrist`],
              older.aspectLandmarks[`${hand}Wrist`],
            ) >
            width * 0.02,
        );
      const met = separation < width * 0.08 || (separation < width * 0.25 && bothMoving);
      const overlapping =
        distance2(points.leftWrist, points.rightWrist) < width * 0.8 ||
        distance2(before.aspectLandmarks.leftWrist, before.aspectLandmarks.rightWrist) <
          width * 0.8;
      if (overlapping || this.swapped) {
        const predict = (hand: Hand): Landmark => {
          const point = before.aspectLandmarks[`${hand}Wrist`];
          // At contact, velocity cannot distinguish crossing from bouncing apart.
          // Reacquire from the elbow chains instead of extrapolating through contact.
          if (!this.older || met) return point;
          const older = this.older.aspectLandmarks[`${hand}Wrist`];
          const elapsed = before.frame.timestamp - this.older.frame.timestamp;
          // Limit extrapolation so a fast last frame cannot dictate identity forever.
          const amount = Math.min(1, dt / elapsed);
          const dx = point.x - older.x,
            dy = point.y - older.y;
          const limit = Math.min(1, (width * 0.5) / (Math.hypot(dx, dy) || 1));
          return { ...point, x: point.x + dx * amount * limit, y: point.y + dy * amount * limit };
        };
        const cost = (swap: boolean) =>
          HANDS.reduce((total, hand) => {
            const wrist = points[`${swap ? opposite(hand) : hand}Wrist`];
            const elbow = points[`${hand}Elbow`];
            const prior = before.aspectLandmarks;
            const priorLength = distance2(prior[`${hand}Elbow`], prior[`${hand}Wrist`]);
            const continuity = distance2(wrist, predict(hand));
            const chain = Math.abs(distance2(elbow, wrist) - priorLength);
            const contactAnchor = met ? distance2(elbow, wrist) * 0.8 : 0;
            return total + (continuity + chain * 0.35 + contactAnchor) / width;
          }, 0);
        const direct = cost(false),
          swapped = cost(true);
        if (swapped + 0.18 < direct) {
          const swapWrists = (landmarks: Record<string, Landmark>) => {
            if (!landmarks.leftWrist || !landmarks.rightWrist) {
              const safe = { ...landmarks };
              delete safe.leftWrist;
              delete safe.rightWrist;
              return safe;
            }
            return {
              ...landmarks,
              leftWrist: landmarks.rightWrist,
              rightWrist: landmarks.leftWrist,
            };
          };
          stabilized = {
            ...sample,
            frame: { ...sample.frame, landmarks: swapWrists(sample.frame.landmarks) },
            aspectLandmarks: swapWrists(sample.aspectLandmarks),
            ...(sample.worldLandmarks ? { worldLandmarks: swapWrists(sample.worldLandmarks) } : {}),
          };
          this.swapped = true;
        } else this.swapped = false;
      }
    }
    this.older = this.previous;
    this.previous = stabilized;
    return stabilized;
  }

  reset() {
    this.previous = null;
    this.older = null;
    this.swapped = false;
  }
}
