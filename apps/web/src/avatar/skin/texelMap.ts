import { bonePartIndex, dominantPart, partFrames } from './parts';
import type { ModelData, PartFrame } from './parts';

export const UNCOVERED = 255;
/** Barycentric slack so texel centres on shared edges are never dropped. */
const EDGE_EPSILON = 1e-4;

/** For every texture texel: which body part it shows and where on that part, in the part's frame. */
export interface TexelMap {
  size: number;
  part: Uint8Array;
  /** Position along the part axis: 0 at the segment start, 1 at the end. */
  t: Float32Array;
  /** Perpendicular offset (m) toward the part's front. */
  du: Float32Array;
  /** Perpendicular offset (m) toward axis × front. */
  dw: Float32Array;
  frames: PartFrame[];
}

export function buildTexelMap(model: ModelData, size: number): TexelMap {
  const frames = partFrames(model);
  const boneParts = bonePartIndex(model);
  const count = size * size;
  const map: TexelMap = {
    size,
    part: new Uint8Array(count).fill(UNCOVERED),
    t: new Float32Array(count),
    du: new Float32Array(count),
    dw: new Float32Array(count),
    frames,
  };
  const { positions: p, uvs, indices } = model;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    const part = dominantPart(model, boneParts, [ia, ib, ic]);
    const { a, axis, length, u, w } = frames[part];
    // glTF UVs put (0, 0) at the image's top-left, so v maps straight to rows.
    const ax = uvs[ia * 2] * size, ay = uvs[ia * 2 + 1] * size;
    const bx = uvs[ib * 2] * size, by = uvs[ib * 2 + 1] * size;
    const cx = uvs[ic * 2] * size, cy = uvs[ic * 2 + 1] * size;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < -EDGE_EPSILON || wb < -EDGE_EPSILON || wc < -EDGE_EPSILON) continue;
        const rx = wa * p[ia * 3] + wb * p[ib * 3] + wc * p[ic * 3] - a[0];
        const ry = wa * p[ia * 3 + 1] + wb * p[ib * 3 + 1] + wc * p[ic * 3 + 1] - a[1];
        const rz = wa * p[ia * 3 + 2] + wb * p[ib * 3 + 2] + wc * p[ic * 3 + 2] - a[2];
        const along = rx * axis[0] + ry * axis[1] + rz * axis[2];
        const qx = rx - along * axis[0];
        const qy = ry - along * axis[1];
        const qz = rz - along * axis[2];
        const index = y * size + x;
        map.part[index] = part;
        map.t[index] = along / length;
        map.du[index] = qx * u[0] + qy * u[1] + qz * u[2];
        map.dw[index] = qx * w[0] + qy * w[1] + qz * w[2];
      }
    }
  }
  return map;
}
