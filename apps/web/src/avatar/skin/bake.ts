import { TORSO_PART } from './parts';
import { imageParts, pixelsPerMeter, projectTexel } from './project';
import type { CapturedFrame, Projection } from './project';
import { UNCOVERED } from './texelMap';
import type { TexelMap } from './texelMap';

export const MASK_THRESHOLD = 0.5;
/** Texels painted outside UV islands so texture filtering never pulls in black. */
export const GUTTER_PX = 4;

/** Blend every frame into the texture: each texel takes colour from the frames that saw it most squarely. */
export function bakeSkin(map: TexelMap, frames: readonly CapturedFrame[], direction: 1 | -1): Uint8ClampedArray<ArrayBuffer> {
  const count = map.size * map.size;
  const sum = new Float32Array(count * 3);
  const weight = new Float32Array(count);
  const hit: Projection = { x: 0, y: 0, weight: 0 };
  for (const frame of frames) {
    const yaw = (direction * frame.yawDeg * Math.PI) / 180;
    const parts = imageParts(frame, yaw, map.frames);
    const scalePx = pixelsPerMeter(frame, map.frames[TORSO_PART]);
    if (!(scalePx > 0)) continue;
    for (let i = 0; i < count; i++) {
      const partIndex = map.part[i];
      if (partIndex === UNCOVERED) continue;
      const part = parts[partIndex];
      if (!part) continue;
      projectTexel(part, scalePx, map.t[i], map.du[i], map.dw[i], hit);
      if (!(hit.weight > 0) || !onPerson(frame, hit.x, hit.y)) continue;
      addSample(frame, hit.x, hit.y, hit.weight, sum, i * 3);
      weight[i] += hit.weight;
    }
  }
  return finishTexture(map, sum, weight);
}

function onPerson(frame: CapturedFrame, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > frame.width - 1 || y > frame.height - 1) return false;
  return !frame.mask || frame.mask[Math.round(y) * frame.width + Math.round(x)] >= MASK_THRESHOLD;
}

function addSample(frame: CapturedFrame, x: number, y: number, weight: number, sum: Float32Array, offset: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, frame.width - 1);
  const y1 = Math.min(y0 + 1, frame.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const { pixels, width } = frame;
  for (let c = 0; c < 3; c++) {
    const top = pixels[(y0 * width + x0) * 4 + c] * (1 - fx) + pixels[(y0 * width + x1) * 4 + c] * fx;
    const bottom = pixels[(y1 * width + x0) * 4 + c] * (1 - fx) + pixels[(y1 * width + x1) * 4 + c] * fx;
    sum[offset + c] += (top * (1 - fy) + bottom * fy) * weight;
  }
}

/** Resolve weighted sums to colours, fill unseen texels from neighbours, then pad the UV gutter. */
export function finishTexture(map: TexelMap, sum: Float32Array, weight: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const { size } = map;
  const count = size * size;
  const rgb = new Float32Array(count * 3);
  const known = new Uint8Array(count);
  const mean = [0, 0, 0];
  let seen = 0;
  for (let i = 0; i < count; i++) {
    if (weight[i] <= 0) continue;
    for (let c = 0; c < 3; c++) {
      rgb[i * 3 + c] = sum[i * 3 + c] / weight[i];
      mean[c] += rgb[i * 3 + c];
    }
    known[i] = 1;
    seen += 1;
  }
  if (seen) for (let c = 0; c < 3; c++) mean[c] /= seen;
  else mean.splice(0, 3, 197, 140, 105);

  const covered = Uint8Array.from(map.part, (part) => (part === UNCOVERED ? 0 : 1));
  grow(size, rgb, known, covered, Infinity);
  for (let i = 0; i < count; i++)
    if (covered[i] && !known[i]) {
      rgb.set(mean, i * 3);
      known[i] = 1;
    }
  grow(size, rgb, known, new Uint8Array(count).fill(1), GUTTER_PX);

  const rgba = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const source = known[i] ? rgb.subarray(i * 3, i * 3 + 3) : mean;
    rgba[i * 4] = source[0];
    rgba[i * 4 + 1] = source[1];
    rgba[i * 4 + 2] = source[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Breadth-first fill: each ring of unknown eligible texels averages its known 8-neighbours. */
function grow(size: number, rgb: Float32Array, known: Uint8Array, eligible: Uint8Array, maxRings: number) {
  const queued = new Uint8Array(size * size);
  const neighbours = (i: number, visit: (n: number) => void) => {
    const x = i % size;
    const y = (i - x) / size;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < size && ny < size) visit(ny * size + nx);
      }
  };
  let ring: number[] = [];
  for (let i = 0; i < known.length; i++)
    if (known[i])
      neighbours(i, (n) => {
        if (!known[n] && eligible[n] && !queued[n]) {
          queued[n] = 1;
          ring.push(n);
        }
      });
  for (let depth = 0; ring.length && depth < maxRings; depth++) {
    for (const i of ring) {
      let r = 0, g = 0, b = 0, n = 0;
      neighbours(i, (j) => {
        if (!known[j]) return;
        r += rgb[j * 3];
        g += rgb[j * 3 + 1];
        b += rgb[j * 3 + 2];
        n += 1;
      });
      rgb[i * 3] = r / n;
      rgb[i * 3 + 1] = g / n;
      rgb[i * 3 + 2] = b / n;
    }
    for (const i of ring) known[i] = 1;
    const next: number[] = [];
    for (const i of ring)
      neighbours(i, (n) => {
        if (!known[n] && eligible[n] && !queued[n]) {
          queued[n] = 1;
          next.push(n);
        }
      });
    ring = next;
  }
}
