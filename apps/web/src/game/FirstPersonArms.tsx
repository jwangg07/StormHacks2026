import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { Group, Texture } from 'three';
import { ArmPoseEstimator } from '@wb/motion';
import type { PoseSample } from '@wb/motion';
import { FIGHTER_URL } from '../avatar/fighterAsset';
import { DEFAULT_SKIN_COLOR } from '../avatar/FighterModel';
import { addGloves, aim, findRig, GUARD, restPose, SIDES } from '../avatar/rig';
import type { Side } from '../avatar/rig';

/** Eye position in avatar space (+Z forward). The scene turns the avatar to face -Z. */
export const EYE_HEIGHT = 1.64;
export const EYE_FORWARD = 0.08;

/** Player A blue, per the PRD's glove color convention. */
const GLOVE_COLOR = '#4284bd';
const TRACKED_SMOOTHING_S = 0.05;
const RELEASE_SMOOTHING_S = 0.25;

const target = new Vector3();
const rootRotation = new Quaternion();

export function FirstPersonArms({
  sampleRef,
  skin = null,
}: {
  sampleRef: RefObject<PoseSample | null>;
  skin?: Texture | null;
}) {
  const { scene } = useGLTF(FIGHTER_URL);
  const root = useRef<Group>(null);
  const estimator = useMemo(() => new ArmPoseEstimator(), []);
  const lastSample = useRef<PoseSample | null>(null);
  const pose = useRef<ReturnType<ArmPoseEstimator['update']>>({ left: null, right: null });
  const rig = useMemo(() => findRig(scene), [scene]);
  const smooth = useMemo(() => {
    const start = (side: Side) => ({
      upper: new Vector3(GUARD[side].upper.x, GUARD[side].upper.y, GUARD[side].upper.z).normalize(),
      fore: new Vector3(GUARD[side].fore.x, GUARD[side].fore.y, GUARD[side].fore.z).normalize(),
    });
    return { left: start('left'), right: start('right') };
  }, []);

  useEffect(() => {
    const material = new MeshStandardMaterial({
      map: skin,
      color: skin ? '#ffffff' : DEFAULT_SKIN_COLOR,
      roughness: 0.75,
    });
    scene.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        object.material = material;
        // Bounds come from the rest pose; posed arms swing outside them.
        object.frustumCulled = false;
      }
    });
    return () => material.dispose();
  }, [scene, skin]);

  useEffect(() => {
    // Hide the head so the eye camera never renders its inside faces.
    rig.head.scale.setScalar(0.001);
    const removeGloves = addGloves(scene, rig, GLOVE_COLOR);
    return () => {
      removeGloves();
      rig.head.scale.setScalar(1);
      // The GLTF scene is cached and cloned by other fighters; leave it in its rest pose.
      restPose(rig);
    };
  }, [scene, rig]);

  useFrame((_, dt) => {
    const sample = sampleRef.current;
    if (sample !== lastSample.current) {
      lastSample.current = sample;
      pose.current = estimator.update(sample);
    }
    if (!root.current) return;
    restPose(rig);
    root.current.getWorldQuaternion(rootRotation);
    for (const side of SIDES) {
      const arm = rig.arms[side];
      const tracked = pose.current[side];
      const goal = tracked ?? GUARD[side];
      const alpha = 1 - Math.exp(-dt / (tracked ? TRACKED_SMOOTHING_S : RELEASE_SMOOTHING_S));
      const current = smooth[side];
      current.upper.lerp(target.set(goal.upper.x, goal.upper.y, goal.upper.z).normalize(), alpha).normalize();
      current.fore.lerp(target.set(goal.fore.x, goal.fore.y, goal.fore.z).normalize(), alpha).normalize();
      aim(arm.upper, arm.fore, target.copy(current.upper).applyQuaternion(rootRotation));
      aim(arm.fore, arm.hand, target.copy(current.fore).applyQuaternion(rootRotation));
    }
  });

  return (
    <group ref={root} rotation={[0, Math.PI, 0]}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(FIGHTER_URL);
