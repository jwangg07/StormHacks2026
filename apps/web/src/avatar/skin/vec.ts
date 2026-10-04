export type Vec3 = readonly [number, number, number];

export const FORWARD: Vec3 = [0, 0, 1];
export const UP: Vec3 = [0, 1, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const size = length(a);
  return size > 0 ? scale(a, 1 / size) : a;
};
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/** Turn a body-frame vector by the player's yaw (radians about +Y; positive swings +Z toward +X). */
export const rotateY = (a: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
};
