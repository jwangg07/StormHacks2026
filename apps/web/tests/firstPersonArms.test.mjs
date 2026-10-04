import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { Quaternion, Vector3 } from 'three';
import { loadFighterScene } from './fixtures/loadFighter.mjs';
import { loadMotion } from '../../../packages/motion/tests/loadMotion.mjs';

const source = await readFile(new URL('../src/avatar/rig.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const code = outputText.replace(
  /from ['"]three['"]/g,
  `from ${JSON.stringify(import.meta.resolve('three'))}`,
);
const { findRig, restPose, aim, GUARD } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);
const { ArmPoseEstimator } = await loadMotion('arms');
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });

test('front-camera straight punch reaches the actual fighter wrist at full arm length for both hands', async () => {
  const scene = await loadFighterScene();
  const rig = findRig(scene);
  const image = {
    leftShoulder: point(0.6, 0.4),
    rightShoulder: point(0.4, 0.4),
    leftElbow: point(0.61, 0.52),
    rightElbow: point(0.39, 0.52),
    leftWrist: point(0.6, 0.48),
    rightWrist: point(0.4, 0.48),
  };
  const world = {
    leftShoulder: point(0.2, 0),
    rightShoulder: point(-0.2, 0),
    leftElbow: point(0.2, 0, -0.3),
    rightElbow: point(-0.2, 0, -0.3),
    leftWrist: point(0.2, 0, -0.6),
    rightWrist: point(-0.2, 0, -0.6),
  };
  const pose = new ArmPoseEstimator().update({
    frame: { timestamp: 0, width: 480, height: 480, landmarks: image },
    aspectLandmarks: image,
    worldLandmarks: world,
    tracking: 'VALID',
    confidence: 1,
    missingLandmarks: [],
  });
  const projected = {
    ...image,
    leftElbow: point(0.6, 0.4, -0.15),
    rightElbow: point(0.4, 0.4, -0.15),
    leftWrist: point(0.6, 0.4, -0.35),
    rightWrist: point(0.4, 0.4, -0.35),
  };
  const corrected = new ArmPoseEstimator().update({
    frame: { timestamp: 0, width: 480, height: 480, landmarks: projected },
    aspectLandmarks: projected,
    worldLandmarks: {
      ...world,
      leftElbow: point(0.2, 0.3),
      rightElbow: point(-0.2, 0.3),
      leftWrist: point(0.2, 0.05, -0.2),
      rightWrist: point(-0.2, 0.05, -0.2),
    },
    tracking: 'VALID',
    confidence: 1,
    missingLandmarks: [],
  });
  for (const tracked of [pose, corrected]) {
    restPose(rig);
    for (const side of ['left', 'right']) {
      const { upper, fore, hand } = rig.arms[side];
      const shoulder = upper.getWorldPosition(new Vector3());
      const elbow = fore.getWorldPosition(new Vector3());
      const wrist = hand.getWorldPosition(new Vector3());
      const length = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
      const direction = (segment) => new Vector3(segment.x, segment.y, segment.z);
      aim(upper, fore, direction(tracked[side].upper));
      aim(fore, hand, direction(tracked[side].fore));
      const extended = hand.getWorldPosition(new Vector3()).sub(shoulder);
      assert.ok(extended.z > length * 0.99, `${side} glove extends through the entire arm`);
      assert.ok(Math.abs(extended.x) < 0.001 && Math.abs(extended.y) < 0.001);
    }
  }
});

test('aiming either arm independently does not move the opposite wrist on the rotated fighter rig', async () => {
  const scene = await loadFighterScene();
  scene.rotation.y = Math.PI;
  const rig = findRig(scene);
  const rotation = scene.getWorldQuaternion(new Quaternion());
  const render = (pose) => {
    restPose(rig);
    for (const side of ['left', 'right']) {
      const arm = rig.arms[side];
      const dir = (segment) =>
        new Vector3(segment.x, segment.y, segment.z).normalize().applyQuaternion(rotation);
      aim(arm.upper, arm.fore, dir(pose[side].upper));
      aim(arm.fore, arm.hand, dir(pose[side].fore));
    }
  };
  for (const active of ['left', 'right']) {
    const still = active === 'left' ? 'right' : 'left';
    render(GUARD);
    const resting = rig.arms[still].hand.getWorldPosition(new Vector3());
    render({
      ...GUARD,
      [active]: { upper: { x: 0, y: 0, z: 1 }, fore: { x: 0, y: 0, z: 1 }, extended: true },
    });
    const unchanged = rig.arms[still].hand.getWorldPosition(new Vector3());
    assert.ok(unchanged.distanceTo(resting) < 1e-6, `${active} punch cannot move ${still} wrist`);
    const punching = rig.arms[active].hand.getWorldPosition(new Vector3());
    const shoulder = rig.arms[active].upper.getWorldPosition(new Vector3());
    assert.ok(
      punching.z < shoulder.z - 0.5,
      'active wrist extends forward in the first-person scene',
    );
  }
});
