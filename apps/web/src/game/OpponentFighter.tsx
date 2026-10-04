import type { GameInput } from '@wb/core';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import { Group, MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { Texture } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { DEFAULT_SKIN_COLOR } from '../avatar/FighterModel';
import { FIGHTER_URL } from '../avatar/fighterAsset';
import { addGloves, aim, findRig, GUARD, restPose, SIDES } from '../avatar/rig';
import type { Side } from '../avatar/rig';
import { opponentDodgeView } from './boxingAnimation';

const rootRotation = new Quaternion();
const target = new Vector3();
const targetPosition = new Vector3();
const MAT_Y = 0.17;
// Roughly arm's length from the eye camera: close enough to read as face-to-face.
const OPPONENT_Z = -1.75;
const SMOOTHING_SECONDS = 0.02;
const MAX_PREDICTION_MS = 50;
const MIN_DIRECTION_LENGTH_SQ = 1e-6;

function safePredictedDirection(
  output: Vector3,
  current: { x: number; y: number; z: number },
  previous: { x: number; y: number; z: number } | undefined,
  prediction: number,
  fallback: Vector3,
) {
  output.set(
    current.x + (current.x - (previous?.x ?? current.x)) * prediction,
    current.y + (current.y - (previous?.y ?? current.y)) * prediction,
    current.z + (current.z - (previous?.z ?? current.z)) * prediction,
  );
  return Number.isFinite(output.x) &&
    Number.isFinite(output.y) &&
    Number.isFinite(output.z) &&
    output.lengthSq() >= MIN_DIRECTION_LENGTH_SQ
    ? output.normalize()
    : output.copy(fallback);
}

export function OpponentFighter({
  input,
  skin,
}: {
  input: GameInput | null;
  skin: Texture | null;
}) {
  const { scene } = useGLTF(FIGHTER_URL);
  const fighter = useMemo(() => cloneSkinned(scene), [scene]);
  const rig = useMemo(() => findRig(fighter), [fighter]);
  const root = useRef<Group>(null);
  const samples = useRef<{
    previous: GameInput | null;
    current: GameInput | null;
    receivedAt: number;
  }>({ previous: null, current: null, receivedAt: 0 });
  const smooth = useMemo(() => {
    const arm = (side: Side) => ({
      upper: new Vector3(GUARD[side].upper.x, GUARD[side].upper.y, GUARD[side].upper.z).normalize(),
      fore: new Vector3(GUARD[side].fore.x, GUARD[side].fore.y, GUARD[side].fore.z).normalize(),
    });
    return { left: arm('left'), right: arm('right') };
  }, []);

  useEffect(() => {
    const material = new MeshStandardMaterial({
      map: skin,
      color: skin ? '#ffffff' : DEFAULT_SKIN_COLOR,
      roughness: 0.75,
    });
    fighter.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        object.material = material;
        object.frustumCulled = false;
      }
    });
    return () => material.dispose();
  }, [fighter, skin]);

  useEffect(() => addGloves(fighter, rig, '#ed9850'), [fighter, rig]);

  useEffect(() => {
    if (!input || input.sequence === samples.current.current?.sequence) return;
    samples.current = {
      previous: samples.current.current,
      current: input,
      receivedAt: performance.now(),
    };
  }, [input]);

  useFrame((_, delta) => {
    if (!root.current) return;
    const { previous, current, receivedAt } = samples.current;
    const sampleInterval = Math.max(
      8,
      (current?.clientTimestamp ?? 0) - (previous?.clientTimestamp ?? 0),
    );
    const prediction = current
      ? Math.min(
          1.5,
          Math.min(MAX_PREDICTION_MS, Math.max(0, performance.now() - receivedAt)) / sampleInterval,
        )
      : 0;
    const predicted = (value: number, before: number | undefined) =>
      value + (value - (before ?? value)) * prediction;
    const currentHead = current?.head ?? { x: 0, y: 0, z: 0 };
    const head = {
      x: predicted(currentHead.x, previous?.head.x),
      y: predicted(currentHead.y, previous?.head.y),
      z: predicted(currentHead.z, previous?.head.z),
    };
    const punchIsFresh = Boolean(current?.punchAttempt && performance.now() - receivedAt < 100);
    const alpha = punchIsFresh ? 1 : 1 - Math.exp(-delta / SMOOTHING_SECONDS);
    const dodge = current?.tracking === 'VALID' && !current.duck ? current.dodge : undefined;
    const dodgePose = opponentDodgeView(dodge);
    targetPosition.set(
      dodge ? dodgePose.x : head.x * 1.05,
      MAT_Y + head.y * 0.32 - (current?.duck ? 0.34 : 0),
      OPPONENT_Z + head.z * 0.45,
    );
    root.current.position.lerp(targetPosition, alpha);
    const roll = dodge ? dodgePose.roll : head.x * (current?.duck ? -0.18 : -0.1);
    root.current.rotation.z += (roll - root.current.rotation.z) * alpha;

    restPose(rig);
    root.current.getWorldQuaternion(rootRotation);
    for (const side of SIDES) {
      const arm = rig.arms[side];
      const tracked = current?.avatarPose?.[side];
      const old = previous?.avatarPose?.[side];
      // Hold the last valid arm through a brief landmark dropout. Never feed a zero or
      // non-finite direction into the skeleton, which can collapse skinned arm geometry.
      if (tracked) {
        smooth[side].upper.lerp(
          safePredictedDirection(target, tracked.upper, old?.upper, prediction, smooth[side].upper),
          alpha,
        );
        smooth[side].fore.lerp(
          safePredictedDirection(target, tracked.fore, old?.fore, prediction, smooth[side].fore),
          alpha,
        );
      }
      if (smooth[side].upper.lengthSq() < MIN_DIRECTION_LENGTH_SQ)
        smooth[side].upper.set(GUARD[side].upper.x, GUARD[side].upper.y, GUARD[side].upper.z);
      if (smooth[side].fore.lengthSq() < MIN_DIRECTION_LENGTH_SQ)
        smooth[side].fore.set(GUARD[side].fore.x, GUARD[side].fore.y, GUARD[side].fore.z);
      smooth[side].upper.normalize();
      smooth[side].fore.normalize();
      aim(arm.upper, arm.fore, target.copy(smooth[side].upper).applyQuaternion(rootRotation));
      aim(arm.fore, arm.hand, target.copy(smooth[side].fore).applyQuaternion(rootRotation));
    }
  });

  return (
    <group ref={root} position={[0, MAT_Y, OPPONENT_Z]} scale={1.02}>
      <primitive object={fighter} />
    </group>
  );
}
