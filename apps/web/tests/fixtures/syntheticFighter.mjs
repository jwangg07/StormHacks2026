/** Bind-pose joints of the real fighter.glb, so synthetic models get identical part frames. */
export const JOINTS = {
  hips: [0, 0.92, 0], spine: [0, 1.05, -0.005], chest: [0, 1.18, -0.005], upper_chest: [0, 1.33, 0],
  neck: [0, 1.46, -0.005], head: [0, 1.55, 0],
  shoulder_L: [0.02, 1.41, 0.03], upper_arm_L: [0.2, 1.4, 0], forearm_L: [0.39, 1.22, -0.01], hand_L: [0.57, 1.04, 0.01],
  shoulder_R: [-0.02, 1.41, 0.03], upper_arm_R: [-0.2, 1.4, 0], forearm_R: [-0.39, 1.22, -0.01], hand_R: [-0.57, 1.04, 0.01],
  thigh_L: [0.09, 0.92, 0], shin_L: [0.1, 0.5, 0.012], foot_L: [0.1, 0.09, -0.01], toe_L: [0.1, 0.03, 0.1],
  thigh_R: [-0.09, 0.92, 0], shin_R: [-0.1, 0.5, 0.012], foot_R: [-0.1, 0.09, -0.01], toe_R: [-0.1, 0.03, 0.1],
};

/**
 * A flat quad on the chest front (z = 0.1) spanning x ∈ [-0.2, 0.2], y ∈ [0.92, 1.40],
 * UV-mapped to the whole texture with u = (x + 0.2) / 0.4 and v = (1.40 - y) / 0.48.
 * Every vertex is fully weighted to `hips`, so the whole quad is torso.
 */
export function chestQuad() {
  const bones = Object.entries(JOINTS).map(([name, head]) => ({ name, head }));
  const hips = bones.findIndex((bone) => bone.name === 'hips');
  const corners = [[-0.2, 1.4], [0.2, 1.4], [0.2, 0.92], [-0.2, 0.92]];
  return {
    positions: Float32Array.from(corners.flatMap(([x, y]) => [x, y, 0.1])),
    uvs: Float32Array.from(corners.flatMap(([x, y]) => [(x + 0.2) / 0.4, (1.4 - y) / 0.48])),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    skinIndex: Uint16Array.from(corners.flatMap(() => [hips, 0, 0, 0])),
    skinWeight: Float32Array.from(corners.flatMap(() => [1, 0, 0, 0])),
    bones,
  };
}

const lm = (x, y, visibility = 1) => ({ x, y, visibility });

/** Front-facing landmarks in a 200×200 frame: player's left on image right. */
export function frontLandmarks() {
  const points = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  Object.assign(points, {
    7: lm(0.53, 0.25), 8: lm(0.47, 0.25),
    11: lm(0.6, 0.4), 12: lm(0.4, 0.4), 13: lm(0.62, 0.55), 14: lm(0.38, 0.55),
    15: lm(0.63, 0.68), 16: lm(0.37, 0.68), 19: lm(0.63, 0.72), 20: lm(0.37, 0.72),
    23: lm(0.55, 0.8), 24: lm(0.45, 0.8), 25: lm(0.55, 0.9), 26: lm(0.45, 0.9),
    27: lm(0.55, 0.97), 28: lm(0.45, 0.97), 31: lm(0.55, 0.99), 32: lm(0.45, 0.99),
  });
  return points;
}
