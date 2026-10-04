import { LANDMARK_PAIRS, PARTS } from './parts';
import type { PartFrame } from './parts';
import { cross, dot, FORWARD, length, normalize, rotateY, scale, sub, UP } from './vec';
import type { Vec3 } from './vec';

/** Normalized image landmark (0–1 of width/height, y down). */
export interface FrameLandmark {
  x: number;
  y: number;
  visibility: number;
}

/** One kept camera frame, raw (unmirrored), with its MediaPipe landmarks and person mask. */
export interface CapturedFrame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** Person probability per pixel, or null when segmentation was unavailable. */
  mask: Float32Array | null;
  landmarks: FrameLandmark[];
  /** Degrees turned along the capture (0–360), before applying the turn direction. */
  yawDeg: number;
}

/** Below this |cos(yaw)| the shoulders overlap and left/right can't be checked. */
const ORIENT_MIN_FACING = 0.35;
/** Shorter image segments give no usable direction; fall back to the model axis. */
const MIN_SEGMENT_PX = 4;
/** Weight for texels on the part axis, where no surface direction exists. */
const AXIS_FACING = 0.5;

/**
 * BlazePose assumes it sees a front. With the back to the camera it can label the
 * image-right arm "left". Put anatomical left on the side the turn says it must be.
 */
export function orientLandmarks(landmarks: readonly FrameLandmark[], yawRad: number): FrameLandmark[] {
  const out = landmarks.slice();
  const facing = Math.cos(yawRad);
  if (Math.abs(facing) < ORIENT_MIN_FACING || !out[11] || !out[12] || !out[23] || !out[24]) return out;
  const spread = out[11].x - out[12].x + (out[23].x - out[24].x);
  if (spread === 0 || Math.sign(spread) === Math.sign(facing)) return out;
  for (const [left, right] of LANDMARK_PAIRS) [out[left], out[right]] = [out[right], out[left]];
  return out;
}

/** A body part as seen in one frame: its image segment (px) and camera-space front/side axes. */
export interface ImagePart {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  u: Vec3;
  w: Vec3;
  confidence: number;
}

function average(landmarks: readonly FrameLandmark[], indices: readonly number[], width: number, height: number) {
  let x = 0;
  let y = 0;
  let visibility = 1;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) return null;
    x += point.x;
    y += point.y;
    visibility = Math.min(visibility, point.visibility);
  }
  return { x: (x / indices.length) * width, y: (y / indices.length) * height, visibility };
}

export function imageParts(frame: CapturedFrame, yawRad: number, frames: readonly PartFrame[]): (ImagePart | null)[] {
  const landmarks = orientLandmarks(frame.landmarks, yawRad);
  return frames.map((model, index) => {
    const spec = PARTS[index];
    const a = average(landmarks, spec.from, frame.width, frame.height);
    const b = average(landmarks, spec.to, frame.width, frame.height);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const axis =
      spec.axisFromModel || Math.hypot(dx, dy) < MIN_SEGMENT_PX
        ? rotateY(model.axis, yawRad)
        : normalize([dx, -dy, 0]);
    const front = rotateY(spec.front === 'up' ? UP : FORWARD, yawRad);
    const across = sub(front, scale(axis, dot(front, axis)));
    if (length(across) < 1e-3) return null;
    const u = normalize(across);
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, u, w: cross(axis, u), confidence: Math.min(a.visibility, b.visibility) };
  });
}

/** Image pixels per model meter, from the torso's height (unchanged by turning). */
export function pixelsPerMeter(frame: CapturedFrame, torso: PartFrame): number {
  const shoulders = average(frame.landmarks, [11, 12], frame.width, frame.height);
  const hips = average(frame.landmarks, [23, 24], frame.width, frame.height);
  if (!shoulders || !hips) return 0;
  return Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) / torso.length;
}

export interface Projection {
  x: number;
  y: number;
  weight: number;
}

/** Where a texel (t along the part, du/dw across it) appears in the frame, and how squarely it faces the camera. */
export function projectTexel(part: ImagePart, scalePx: number, t: number, du: number, dw: number, out: Projection): Projection {
  const ox = du * part.u[0] + dw * part.w[0];
  const oy = du * part.u[1] + dw * part.w[1];
  const oz = du * part.u[2] + dw * part.w[2];
  out.x = part.ax + (part.bx - part.ax) * t + ox * scalePx;
  out.y = part.ay + (part.by - part.ay) * t - oy * scalePx;
  const size = Math.hypot(ox, oy, oz);
  const facing = size > 1e-4 ? Math.max(0, oz / size) : AXIS_FACING;
  out.weight = facing * facing * part.confidence;
  return out;
}
