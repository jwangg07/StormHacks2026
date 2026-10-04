import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MeshStandardMaterial, SkinnedMesh } from 'three';
import type { Group, Texture } from 'three';
import type { MotionFrame } from '@wb/motion';
import { FIGHTER_URL } from '../avatar/fighterAsset';
import { DEFAULT_SKIN_COLOR } from '../avatar/FighterModel';
import { addGloves, findRig, restPose, SIDES } from '../avatar/rig';
import { PUNCH_DURATION_MS } from './boxingAnimation';
import type { PunchCue } from './boxingAnimation';
import { poseBoxingArms } from './poseBoxingArms';

/** Eye position in avatar space (+Z forward). The scene turns the avatar to face -Z. */
export const EYE_HEIGHT = 1.64;
export const EYE_FORWARD = 0.08;

/** Player A blue, per the PRD's glove color convention. */
const GLOVE_COLOR = '#4284bd';

export function FirstPersonArms({
  punch,
  controlsRef,
  skin = null,
}: {
  punch: PunchCue | null;
  controlsRef: RefObject<MotionFrame>;
  skin?: Texture | null;
}) {
  const { scene } = useGLTF(FIGHTER_URL);
  const root = useRef<Group>(null);
  const rig = useMemo(() => findRig(scene), [scene]);
  const armScales = useMemo(
    () => ({ left: rig.arms.left.upper.scale.clone(), right: rig.arms.right.upper.scale.clone() }),
    [rig],
  );
  const blockBlend = useRef(0);

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
      for (const side of SIDES) rig.arms[side].upper.scale.copy(armScales[side]);
      // The GLTF scene is cached and cloned by other fighters; leave it in its rest pose.
      restPose(rig);
    };
  }, [scene, rig, armScales]);

  useFrame((_, dt) => {
    if (!root.current) return;
    const elapsed = punch ? performance.now() - punch.at : -1;
    const blockTarget = controlsRef.current.guard ? 1 : 0;
    const blockSpeed = blockTarget ? 0.12 : 0.2;
    // Keep the other glove steady throughout the clip, including guard transitions.
    if (!punch || elapsed >= PUNCH_DURATION_MS)
      blockBlend.current += (blockTarget - blockBlend.current) * (1 - Math.exp(-dt / blockSpeed));
    poseBoxingArms(root.current, rig, armScales, punch, elapsed, blockBlend.current);
  });

  return (
    <group ref={root} rotation={[0, Math.PI, 0]}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(FIGHTER_URL);
