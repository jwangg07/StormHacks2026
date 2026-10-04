import {
  Bone,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import type { ArmDirections } from '@wb/motion';

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];
const SUFFIX: Record<Side, string> = { left: 'L', right: 'R' };

/** Avatar space (+Z forward, +X the fighter's left): elbows down and out, gloves up by the chin. */
export const GUARD: Record<Side, ArmDirections> = {
  left: { upper: { x: 0.35, y: -0.85, z: 0.4 }, fore: { x: -0.2, y: 0.35, z: 0.9 } },
  right: { upper: { x: -0.35, y: -0.85, z: 0.4 }, fore: { x: 0.2, y: 0.35, z: 0.9 } },
};
/** Arms hanging loosely, slightly away from the body. */
const RELAXED: Record<Side, ArmDirections> = {
  left: { upper: { x: 0.18, y: -1, z: 0 }, fore: { x: 0.1, y: -1, z: 0.15 } },
  right: { upper: { x: -0.18, y: -1, z: 0 }, fore: { x: -0.1, y: -1, z: 0.15 } },
};
export type ArmPoseName = 'guard' | 'relaxed';
export const ARM_POSES: Record<ArmPoseName, Record<Side, ArmDirections>> = { guard: GUARD, relaxed: RELAXED };

export interface ArmBones {
  upper: Bone;
  fore: Bone;
  hand: Bone;
}
export interface FighterRig {
  rest: Map<Bone, Quaternion>;
  arms: Record<Side, ArmBones>;
  head: Bone;
}

export function findRig(root: Object3D): FighterRig {
  const bone = (name: string) => {
    const found = root.getObjectByName(name);
    if (!(found instanceof Bone)) throw new Error(`Fighter model is missing bone ${name}`);
    return found;
  };
  const rest = new Map<Bone, Quaternion>();
  root.traverse((object) => {
    if (object instanceof Bone) rest.set(object, object.quaternion.clone());
  });
  const arm = (side: Side): ArmBones => ({
    upper: bone(`upper_arm_${SUFFIX[side]}`),
    fore: bone(`forearm_${SUFFIX[side]}`),
    hand: bone(`hand_${SUFFIX[side]}`),
  });
  return { rest, arms: { left: arm('left'), right: arm('right') }, head: bone('head') };
}

export function restPose(rig: FighterRig) {
  for (const [bone, quaternion] of rig.rest) bone.quaternion.copy(quaternion);
}

const from = new Vector3();
const to = new Vector3();
const delta = new Quaternion();
const parentRotation = new Quaternion();
const localDelta = new Quaternion();

/** Rotate `bone` in world space so the ray from it to `child` points along `direction`. */
export function aim(bone: Bone, child: Object3D, direction: Vector3) {
  bone.getWorldPosition(from);
  child.getWorldPosition(to);
  delta.setFromUnitVectors(to.sub(from).normalize(), direction);
  bone.parent!.getWorldQuaternion(parentRotation);
  // local' = parent⁻¹ · delta · parent · local
  bone.quaternion.premultiply(localDelta.copy(parentRotation).invert().multiply(delta).multiply(parentRotation));
  bone.updateMatrixWorld(true);
}

/** Attach boxing gloves to both hands; returns the cleanup. */
export function addGloves(root: Object3D, rig: FighterRig, color: string): () => void {
  root.updateWorldMatrix(true, true);
  const fistGeometry = new SphereGeometry(0.065, 20, 14);
  const cuffGeometry = new CylinderGeometry(0.05, 0.055, 0.07, 16);
  const cuffMaterial = new MeshStandardMaterial({ color: '#f2efe6', roughness: 0.6 });
  const fistMaterial = new MeshStandardMaterial({ color, roughness: 0.35 });
  const gloves: Group[] = [];
  for (const side of SIDES) {
    const { fore, hand } = rig.arms[side];
    const fist = new Mesh(fistGeometry, fistMaterial);
    fist.scale.set(1, 1.2, 1.05);
    fist.position.y = 0.06;
    const glove = new Group();
    glove.add(fist, new Mesh(cuffGeometry, cuffMaterial));
    // Align glove +Y with the forearm direction, starting at the wrist, in hand-local space.
    const wrist = hand.getWorldPosition(new Vector3());
    const along = wrist.clone().sub(fore.getWorldPosition(new Vector3())).normalize();
    const handRotation = hand.getWorldQuaternion(new Quaternion()).invert();
    glove.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), along.applyQuaternion(handRotation));
    hand.add(glove);
    gloves.push(glove);
  }
  return () => {
    for (const glove of gloves) glove.removeFromParent();
    for (const owned of [fistGeometry, cuffGeometry, cuffMaterial, fistMaterial]) owned.dispose();
  };
}
