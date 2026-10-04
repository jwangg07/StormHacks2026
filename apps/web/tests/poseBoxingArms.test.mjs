import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { Group, Vector3 } from 'three';
import ts from 'typescript';
import { loadFighterScene } from './fixtures/loadFighter.mjs';

const modules = new Map();
async function moduleUrl(file) {
  if (modules.has(file.href)) return modules.get(file.href);
  const source = await readFile(file, 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const match of [...outputText.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const specifier = match[1];
    const url = specifier.startsWith('.')
      ? await moduleUrl(new URL(`${specifier}.ts`, file))
      : import.meta.resolve(specifier);
    outputText = outputText.replace(match[0], `from ${JSON.stringify(url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  modules.set(file.href, url);
  return url;
}
const { findRig } = await import(await moduleUrl(new URL('../src/avatar/rig.ts', import.meta.url)));
const { poseBoxingArms } = await import(
  await moduleUrl(new URL('../src/game/poseBoxingArms.ts', import.meta.url))
);
const { PUNCH_IMPACT_MS, PUNCH_DURATION_MS } = await import(
  await moduleUrl(new URL('../src/game/boxingAnimation.ts', import.meta.url))
);

test('every scripted punch moves only its selected arm on the actual fighter rig', async () => {
  const scene = await loadFighterScene();
  const root = new Group();
  root.rotation.y = Math.PI;
  root.add(scene);
  const rig = findRig(scene);
  const scales = {
    left: rig.arms.left.upper.scale.clone(),
    right: rig.arms.right.upper.scale.clone(),
  };
  poseBoxingArms(root, rig, scales, null, -1, 0);
  assert.ok(
    rig.arms.left.hand.getWorldPosition(new Vector3()).x < 0,
    'anatomical left glove is on the left of the first-person view',
  );
  assert.ok(
    rig.arms.right.hand.getWorldPosition(new Vector3()).x > 0,
    'anatomical right glove is on the right of the first-person view',
  );
  for (const blockBlend of [0, 0.5, 1]) {
    for (const hand of ['left', 'right']) {
      const other = hand === 'left' ? 'right' : 'left';
      for (const move of ['jab', 'cross', 'hook', 'uppercut']) {
        poseBoxingArms(root, rig, scales, null, -1, blockBlend);
        const arm = rig.arms[other];
        const stationary = [arm.upper, arm.fore, arm.hand].map((bone) =>
          bone.getWorldPosition(new Vector3()),
        );
        const activeStart = rig.arms[hand].hand.getWorldPosition(new Vector3());
        const cue = { id: 1, hand, move, at: 0 };
        let maxTravel = 0;
        for (const elapsed of [
          0,
          25,
          60,
          PUNCH_IMPACT_MS,
          145,
          210,
          PUNCH_DURATION_MS - 1,
          PUNCH_DURATION_MS,
        ]) {
          poseBoxingArms(root, rig, scales, cue, elapsed, blockBlend);
          for (const [i, bone] of [arm.upper, arm.fore, arm.hand].entries())
            assert.ok(
              bone.getWorldPosition(new Vector3()).distanceTo(stationary[i]) < 1e-6,
              `${hand} ${move} at ${elapsed}ms moved the ${other} arm`,
            );
          assert.equal(root.rotation.y, Math.PI);
          assert.equal(root.position.length(), 0);
          maxTravel = Math.max(
            maxTravel,
            rig.arms[hand].hand.getWorldPosition(new Vector3()).distanceTo(activeStart),
          );
        }
        assert.ok(maxTravel > 0.2, `${move} visibly moves the active glove through its arc`);
        assert.ok(
          rig.arms[hand].hand.getWorldPosition(new Vector3()).distanceTo(activeStart) < 1e-6,
          'punch ends in its original guard pose',
        );
      }
    }
  }
});

test('straight punches extend the selected glove substantially beyond normal arm length', async () => {
  const scene = await loadFighterScene();
  const rig = findRig(scene);
  const scales = {
    left: rig.arms.left.upper.scale.clone(),
    right: rig.arms.right.upper.scale.clone(),
  };
  for (const hand of ['left', 'right']) {
    poseBoxingArms(scene, rig, scales, null, -1, 0);
    const arm = rig.arms[hand];
    const shoulder = arm.upper.getWorldPosition(new Vector3());
    const elbow = arm.fore.getWorldPosition(new Vector3());
    const wrist = arm.hand.getWorldPosition(new Vector3());
    const normalLength = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
    poseBoxingArms(
      scene,
      rig,
      scales,
      { id: 1, hand, move: hand === 'left' ? 'jab' : 'cross', at: 0 },
      PUNCH_IMPACT_MS,
      0,
    );
    const reach = arm.hand
      .getWorldPosition(new Vector3())
      .sub(arm.upper.getWorldPosition(new Vector3()));
    assert.ok(
      reach.z > normalLength * 1.5,
      `${hand} glove should reach at least 50% farther at contact`,
    );
    poseBoxingArms(scene, rig, scales, null, -1, 0);
    assert.ok(
      arm.hand.getWorldPosition(new Vector3()).distanceTo(wrist) < 1e-6,
      'normal arm length is restored',
    );
  }
});
