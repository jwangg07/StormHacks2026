import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { Group, Texture } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FIGHTER_URL } from './fighterAsset';
import { addGloves, aim, ARM_POSES, findRig, restPose, SIDES } from './rig';
import type { ArmPoseName } from './rig';

/** Worn until the player bakes a skin. */
export const DEFAULT_SKIN_COLOR = '#c58c69';

type FighterModelProps = ThreeElements['group'] & {
  skin?: Texture | null;
  pose?: ArmPoseName;
  glove?: string;
};

const rootRotation = new Quaternion();
const target = new Vector3();

/** The team's fighter (fighter.glb), wearing a camera-baked skin when one is given. */
export function FighterModel({ skin = null, pose = 'relaxed', glove, ...props }: FighterModelProps) {
  const { scene } = useGLTF(FIGHTER_URL);
  const fighter = useMemo(() => cloneSkinned(scene), [scene]);
  const rig = useMemo(() => findRig(fighter), [fighter]);
  const root = useRef<Group>(null);

  useEffect(() => {
    const material = new MeshStandardMaterial({
      map: skin,
      color: skin ? '#ffffff' : DEFAULT_SKIN_COLOR,
      roughness: 0.75,
    });
    fighter.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        object.material = material;
        // Bounds come from the rest pose; posed arms swing outside them.
        object.frustumCulled = false;
      }
    });
    return () => material.dispose();
  }, [fighter, skin]);

  useEffect(() => (glove ? addGloves(fighter, rig, glove) : undefined), [fighter, rig, glove]);

  useFrame(() => {
    if (!root.current) return;
    restPose(rig);
    root.current.getWorldQuaternion(rootRotation);
    const goal = ARM_POSES[pose];
    for (const side of SIDES) {
      const arm = rig.arms[side];
      const { upper, fore } = goal[side];
      aim(arm.upper, arm.fore, target.set(upper.x, upper.y, upper.z).normalize().applyQuaternion(rootRotation));
      aim(arm.fore, arm.hand, target.set(fore.x, fore.y, fore.z).normalize().applyQuaternion(rootRotation));
    }
  });

  return (
    <group ref={root} {...props}>
      <primitive object={fighter} />
    </group>
  );
}

useGLTF.preload(FIGHTER_URL);
