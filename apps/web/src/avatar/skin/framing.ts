import type { FrameLandmark } from './project';

/** Nose, shoulders, elbows, wrists, hips, knees, ankles: head to ankles in view. */
export const FULL_BODY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
export const TORSO = [11, 12, 23, 24] as const;
export const VISIBLE = 0.6;
/** Score lost per unit of mean landmark movement (normalized image units) between frames. */
const MOTION_PENALTY = 8;

const onScreen = (point: FrameLandmark | undefined): point is FrameLandmark =>
  !!point && point.visibility >= VISIBLE && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

export function visible(landmarks: readonly FrameLandmark[], indices: readonly number[]): boolean {
  return indices.every((index) => onScreen(landmarks[index]));
}

export function meanVisibility(landmarks: readonly FrameLandmark[], indices: readonly number[]): number {
  return indices.reduce((sum, index) => sum + (landmarks[index]?.visibility ?? 0), 0) / indices.length;
}

export function landmarkMotion(
  previous: readonly FrameLandmark[],
  next: readonly FrameLandmark[],
  indices: readonly number[],
): number {
  let total = 0;
  for (const index of indices) {
    const a = previous[index];
    const b = next[index];
    total += a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  }
  return total / indices.length;
}

/** Sharp, confident frames win a slot: visibility minus a blur proxy (landmark motion). */
export function frameScore(visibility: number, motion: number): number {
  return visibility - MOTION_PENALTY * motion;
}
