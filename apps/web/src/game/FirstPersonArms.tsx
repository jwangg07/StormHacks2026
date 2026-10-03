import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  Bone,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { ArmPoseEstimator } from '@wb/motion';
import type { ArmDirections, PoseSample } from '@wb/motion';

export const FIGHTER_URL = `${import.meta.env.BASE_URL}models/fighter.glb`;

/** Eye position in avatar space (+Z forward). The scene turns the avatar to face -Z. */
export const EYE_HEIGHT = 1.64;
export const EYE_FORWARD = 0.08;

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];
const SUFFIX: Record<Side, string> = { left: 'L', right: 'R' };
/** Player A blue, per the PRD's glove color convention. */
const GLOVE_COLOR = '#4284bd';

/** Held when an arm is not tracked: elbows down and out, gloves up by the chin. */
const GUARD: Record<Side, ArmDirections> = {
  left: { upper: { x: 0.35, y: -0.85, z: 0.4 }, fore: { x: -0.2, y: 0.35, z: 0.9 } },
  right: { upper: { x: -0.35, y: -0.85, z: 0.4 }, fore: { x: 0.2, y: 0.35, z: 0.9 } },
};
const TRACKED_SMOOTHING_S = 0.05;
const RELEASE_SMOOTHING_S = 0.25;

interface ArmRig {
  upper: Bone;
  fore: Bone;
  hand: Bone;
  smoothUpper: Vector3;
  smoothFore: Vector3;
}

const from = new Vector3();
const to = new Vector3();
const target = new Vector3();
const delta = new Quaternion();
const parentRotation = new Quaternion();
const localDelta = new Quaternion();
const rootRotation = new Quaternion();

/** Rotate `bone` in world space so the ray from it to `child` points along `direction`. */
function aim(bone: Bone, child: Object3D, direction: Vector3) {
  bone.getWorldPosition(from);
  child.getWorldPosition(to);
  delta.setFromUnitVectors(to.sub(from).normalize(), direction);
  bone.parent!.getWorldQuaternion(parentRotation);
  // local' = parent⁻¹ · delta · parent · local
  bone.quaternion.premultiply(
    localDelta.copy(parentRotation).invert().multiply(delta).multiply(parentRotation),
  );
  bone.updateMatrixWorld(true);
}

export function FirstPersonArms({ sampleRef }: { sampleRef: RefObject<PoseSample | null> }) {
  const { scene } = useGLTF(FIGHTER_URL);
  const root = useRef<Group>(null);
  const estimator = useMemo(() => new ArmPoseEstimator(), []);
  const lastSample = useRef<PoseSample | null>(null);
  const pose = useRef<ReturnType<ArmPoseEstimator['update']>>({ left: null, right: null });

  const rig = useMemo(() => {
    const bone = (name: string) => {
      const found = scene.getObjectByName(name);
      if (!(found instanceof Bone)) throw new Error(`Fighter model is missing bone ${name}`);
      return found;
    };
    const rest = new Map<Bone, Quaternion>();
    scene.traverse((object) => {
      if (object instanceof Bone) rest.set(object, object.quaternion.clone());
    });
    const arms = {} as Record<Side, ArmRig>;
    for (const side of SIDES) {
      const s = SUFFIX[side];
      const guard = GUARD[side];
      arms[side] = {
        upper: bone(`upper_arm_${s}`),
        fore: bone(`forearm_${s}`),
        hand: bone(`hand_${s}`),
        smoothUpper: new Vector3(guard.upper.x, guard.upper.y, guard.upper.z).normalize(),
        smoothFore: new Vector3(guard.fore.x, guard.fore.y, guard.fore.z).normalize(),
      };
    }
    return { rest, arms, head: bone('head') };
  }, [scene]);

  useEffect(() => {
    const material = new MeshStandardMaterial({ color: '#c58c69', roughness: 0.75 });
    const gloves: Object3D[] = [];
    scene.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        object.material = material;
        // Bounds come from the rest pose; posed arms swing outside them.
        object.frustumCulled = false;
      }
    });
    // Hide the head so the eye camera never renders its inside faces.
    rig.head.scale.setScalar(0.001);
    scene.updateMatrixWorld(true);
    const fistGeometry = new SphereGeometry(0.065, 20, 14);
    const cuffGeometry = new CylinderGeometry(0.05, 0.055, 0.07, 16);
    const cuffMaterial = new MeshStandardMaterial({ color: '#f2efe6', roughness: 0.6 });
    const fistMaterial = new MeshStandardMaterial({ color: GLOVE_COLOR, roughness: 0.35 });
    for (const side of SIDES) {
      const { fore, hand } = rig.arms[side];
      const fist = new Mesh(fistGeometry, fistMaterial);
      fist.scale.set(1, 1.2, 1.05);
      fist.position.y = 0.06;
      const cuff = new Mesh(cuffGeometry, cuffMaterial);
      const glove = new Group();
      glove.add(fist, cuff);
      // Align glove +Y with the forearm direction, starting at the wrist, in hand-local space.
      const wrist = hand.getWorldPosition(new Vector3());
      const along = wrist.clone().sub(fore.getWorldPosition(new Vector3())).normalize();
      const handRotation = hand.getWorldQuaternion(new Quaternion()).invert();
      glove.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        along.applyQuaternion(handRotation),
      );
      hand.add(glove);
      gloves.push(glove);
    }
    return () => {
      for (const glove of gloves) glove.removeFromParent();
      for (const owned of [material, cuffMaterial, fistMaterial, fistGeometry, cuffGeometry])
        owned.dispose();
      rig.head.scale.setScalar(1);
    };
  }, [scene, rig]);

  useFrame((_, dt) => {
    const sample = sampleRef.current;
    if (sample !== lastSample.current) {
      lastSample.current = sample;
      pose.current = estimator.update(sample);
    }
    if (!root.current) return;
    for (const [bone, quaternion] of rig.rest)
      if (bone !== rig.head) bone.quaternion.copy(quaternion);
    root.current.getWorldQuaternion(rootRotation);
    for (const side of SIDES) {
      const arm = rig.arms[side];
      const tracked = pose.current[side];
      const goal = tracked ?? GUARD[side];
      const alpha = 1 - Math.exp(-dt / (tracked ? TRACKED_SMOOTHING_S : RELEASE_SMOOTHING_S));
      arm.smoothUpper
        .lerp(target.set(goal.upper.x, goal.upper.y, goal.upper.z).normalize(), alpha)
        .normalize();
      arm.smoothFore
        .lerp(target.set(goal.fore.x, goal.fore.y, goal.fore.z).normalize(), alpha)
        .normalize();
      aim(arm.upper, arm.fore, target.copy(arm.smoothUpper).applyQuaternion(rootRotation));
      aim(arm.fore, arm.hand, target.copy(arm.smoothFore).applyQuaternion(rootRotation));
    }
  });

  return (
    <group ref={root} rotation={[0, Math.PI, 0]}>
      <primitive object={scene} />
    </group>
  );
}
useGLTF.preload(FIGHTER_URL);
