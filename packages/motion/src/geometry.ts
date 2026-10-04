import type { Landmark } from './types';
import type { PoseSample } from './pose';

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const distance2 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
export const distance3 = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const midpoint = (a: Landmark, b: Landmark): Landmark => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  z: (a.z + b.z) / 2,
  visibility: Math.min(a.visibility, b.visibility),
});
export function jointAngle(a: Landmark, b: Landmark, c: Landmark, depth = false) {
  const u = [a.x - b.x, a.y - b.y, depth ? a.z - b.z : 0];
  const v = [c.x - b.x, c.y - b.y, depth ? c.z - b.z : 0];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  if (lengths < 1e-6) return 0;
  return (
    (Math.acos(clamp(u.reduce((sum, value, index) => sum + value * v[index], 0) / lengths, -1, 1)) *
      180) /
    Math.PI
  );
}
export function reliableWorldArm(sample: PoseSample, hand: 'left' | 'right') {
  const p = sample.worldLandmarks;
  if (!p?.leftShoulder || !p.rightShoulder) return null;
  const shoulder = p[`${hand}Shoulder`],
    elbow = p[`${hand}Elbow`],
    wrist = p[`${hand}Wrist`];
  if (!shoulder || !elbow || !wrist) return null;
  const width = distance3(p.leftShoulder, p.rightShoulder);
  const upper = distance3(shoulder, elbow),
    fore = distance3(elbow, wrist);
  if (
    width < 0.05 ||
    upper / width < 0.25 ||
    upper / width > 1.8 ||
    fore / width < 0.2 ||
    fore / width > 1.8
  )
    return null;
  return { shoulder, elbow, wrist, width, upper, fore };
}
export function elbowAngle(sample: PoseSample, hand: 'left' | 'right') {
  const world = reliableWorldArm(sample, hand);
  if (world) return jointAngle(world.shoulder, world.elbow, world.wrist, true);
  const p = sample.aspectLandmarks;
  return jointAngle(p[`${hand}Shoulder`], p[`${hand}Elbow`], p[`${hand}Wrist`]);
}
export function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
