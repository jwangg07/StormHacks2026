import { add, cross, dot, FORWARD, length, midpoint, normalize, scale, sub, UP } from './vec';
import type { Vec3 } from './vec';

/** Rest-pose fighter geometry for baking. Model space: +Y up, +Z forward, +X is the fighter's left. */
export interface ModelData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Bind-pose joint positions, indexed like skinIndex. */
  bones: { name: string; head: Vec3 }[];
}

/** A body region textured from the image segment between two landmark groups. */
export interface PartSpec {
  name: string;
  bones: readonly string[];
  /** MediaPipe pose landmark indices averaged into the segment's start and end. */
  from: readonly number[];
  to: readonly number[];
  /** Body-frame direction treated as the part's front. Feet point forward, so theirs is up. */
  front: 'forward' | 'up';
  /** Feet foreshorten toward the camera, so their axis comes from the model turned by yaw. */
  axisFromModel: boolean;
}

function limbs(side: 'L' | 'R', offset: 0 | 1): PartSpec[] {
  const limb = (name: string, bones: string[], from: number, to: number, foot = false): PartSpec => ({
    name: `${name}_${side}`,
    bones: bones.map((bone) => `${bone}_${side}`),
    from: [from + offset],
    to: [to + offset],
    front: foot ? 'up' : 'forward',
    axisFromModel: foot,
  });
  return [
    limb('upperArm', ['upper_arm'], 11, 13),
    limb('forearm', ['forearm'], 13, 15),
    limb('hand', ['hand'], 15, 19),
    limb('thigh', ['thigh'], 23, 25),
    limb('shin', ['shin'], 25, 27),
    limb('foot', ['foot', 'toe'], 27, 31, true),
  ];
}

export const PARTS: readonly PartSpec[] = [
  {
    name: 'torso',
    bones: ['hips', 'spine', 'chest', 'upper_chest', 'shoulder_L', 'shoulder_R'],
    from: [23, 24],
    to: [11, 12],
    front: 'forward',
    axisFromModel: false,
  },
  { name: 'head', bones: ['neck', 'head'], from: [11, 12], to: [7, 8], front: 'forward', axisFromModel: false },
  ...limbs('L', 0),
  ...limbs('R', 1),
];
export const TORSO_PART = 0;

/** Anatomical left/right landmark pairs: eyes, ears, mouth, arms, hands, legs, feet. */
export const LANDMARK_PAIRS: readonly (readonly [number, number])[] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

/** Ear height as a fraction of the head bone's base-of-skull → crown span. */
export const HEAD_EAR_FRACTION = 0.45;
/** Shortest hand/foot reach, so a part with no dominant vertices still has an axis. */
const MIN_TIP = 0.05;

/** A part's segment in model space and its orthonormal frame: axis, front (u), side (w = axis × u). */
export interface PartFrame {
  a: Vec3;
  b: Vec3;
  axis: Vec3;
  length: number;
  u: Vec3;
  w: Vec3;
}

export function bonePartIndex(model: ModelData): Uint8Array {
  return Uint8Array.from(model.bones, ({ name }) => {
    const index = PARTS.findIndex((part) => part.bones.includes(name));
    if (index < 0) throw new Error(`Fighter bone ${name} belongs to no body part`);
    return index;
  });
}

/** The part with the largest summed skin weight over the given vertices. */
export function dominantPart(model: ModelData, boneParts: Uint8Array, vertices: readonly number[]): number {
  const totals = new Float32Array(PARTS.length);
  for (const vertex of vertices)
    for (let k = 0; k < 4; k++)
      totals[boneParts[model.skinIndex[vertex * 4 + k]]] += model.skinWeight[vertex * 4 + k];
  let best = 0;
  for (let part = 1; part < totals.length; part++) if (totals[part] > totals[best]) best = part;
  return best;
}

export function partFrames(model: ModelData): PartFrame[] {
  const boneParts = bonePartIndex(model);
  const joint = (name: string): Vec3 => {
    const bone = model.bones.find((candidate) => candidate.name === name);
    if (!bone) throw new Error(`Fighter model is missing bone ${name}`);
    return bone.head;
  };
  const vertexCount = model.positions.length / 3;
  const vertexParts = Array.from({ length: vertexCount }, (_, v) => dominantPart(model, boneParts, [v]));
  /** Farthest reach of a part's vertices from `origin` along `direction`. */
  const reach = (part: number, origin: Vec3, direction: Vec3) => {
    let best = 0;
    for (let v = 0; v < vertexCount; v++) {
      if (vertexParts[v] !== part) continue;
      const p: Vec3 = [model.positions[v * 3], model.positions[v * 3 + 1], model.positions[v * 3 + 2]];
      best = Math.max(best, dot(sub(p, origin), direction));
    }
    return best;
  };
  const tip = (part: number, origin: Vec3, direction: Vec3): [Vec3, Vec3] => [
    origin,
    add(origin, scale(direction, Math.max(MIN_TIP, reach(part, origin, direction)))),
  ];
  const shoulders = midpoint(joint('upper_arm_L'), joint('upper_arm_R'));

  const anchors = PARTS.map((part, index): [Vec3, Vec3] => {
    const s = part.name.slice(-1);
    switch (part.name.replace(/_[LR]$/, '')) {
      case 'torso':
        return [midpoint(joint('thigh_L'), joint('thigh_R')), shoulders];
      case 'head': {
        const base = joint('head');
        return [shoulders, add(base, scale(UP, HEAD_EAR_FRACTION * reach(index, base, UP)))];
      }
      case 'upperArm':
        return [joint(`upper_arm_${s}`), joint(`forearm_${s}`)];
      case 'forearm':
        return [joint(`forearm_${s}`), joint(`hand_${s}`)];
      case 'hand':
        return tip(index, joint(`hand_${s}`), normalize(sub(joint(`hand_${s}`), joint(`forearm_${s}`))));
      case 'thigh':
        return [joint(`thigh_${s}`), joint(`shin_${s}`)];
      case 'shin':
        return [joint(`shin_${s}`), joint(`foot_${s}`)];
      case 'foot':
        return tip(index, joint(`foot_${s}`), normalize(sub(joint(`toe_${s}`), joint(`foot_${s}`))));
      default:
        throw new Error(`No anchors for body part ${part.name}`);
    }
  });

  return anchors.map(([a, b], index) => {
    const axis = normalize(sub(b, a));
    const front = PARTS[index].front === 'up' ? UP : FORWARD;
    const u = normalize(sub(front, scale(axis, dot(front, axis))));
    return { a, b, axis, length: length(sub(b, a)), u, w: cross(axis, u) };
  });
}
