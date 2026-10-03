import type { Landmark, PoseFrame, TrackingState } from './types';

export const POSE_VISIBILITY_THRESHOLD = 0.6;
export const POSE_HISTORY_MS = 300;
export const VISUAL_HOLD_MS = 200;
export const TRACKING_PAUSE_MS = 500;
export const TRACKING_RESUME_MS = 1000;

export const POSE_LANDMARKS = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export const REQUIRED_LANDMARKS = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
] as const;

export interface PoseSample {
  frame: PoseFrame;
  /** Coordinates in image-height units: x/z *= width / height, y remains downward. */
  aspectLandmarks: Record<string, Landmark>;
  tracking: TrackingState;
  confidence: number;
  missingLandmarks: string[];
}

export function createPoseSample(
  landmarks: readonly Landmark[],
  timestamp: number,
  width: number,
  height: number,
): PoseSample {
  const frame: PoseFrame = { timestamp, width, height, landmarks: {} };
  const aspectLandmarks: Record<string, Landmark> = {};
  const validDimensions = width > 0 && height > 0 && Number.isFinite(width / height);
  const aspect = validDimensions ? width / height : 1;
  for (const [name, index] of Object.entries(POSE_LANDMARKS)) {
    const point = landmarks[index];
    if (
      !validDimensions ||
      !point ||
      ![point.x, point.y, point.z, point.visibility].every(Number.isFinite) ||
      point.visibility < POSE_VISIBILITY_THRESHOLD ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    )
      continue;
    frame.landmarks[name] = { ...point };
    aspectLandmarks[name] = { ...point, x: point.x * aspect, z: point.z * aspect };
  }
  const missingLandmarks = REQUIRED_LANDMARKS.filter((name) => !frame.landmarks[name]);
  const confidence = Math.min(
    ...REQUIRED_LANDMARKS.map((name) => {
      const point = landmarks[POSE_LANDMARKS[name]];
      return point && Number.isFinite(point.visibility)
        ? Math.max(0, Math.min(1, point.visibility))
        : 0;
    }),
  );
  return {
    frame,
    aspectLandmarks,
    confidence,
    missingLandmarks,
    tracking:
      landmarks.length === 0 || !validDimensions
        ? 'LOST'
        : missingLandmarks.length
          ? 'LOW_CONFIDENCE'
          : 'VALID',
  };
}
