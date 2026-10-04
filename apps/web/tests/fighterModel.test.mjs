import assert from 'node:assert/strict';
import test from 'node:test';
import { findSkinned, loadFighterScene } from './fixtures/loadFighter.mjs';

test('fighter.glb has UVs inside the unit square for every vertex', async () => {
  const mesh = findSkinned(await loadFighterScene());
  const uv = mesh.geometry.getAttribute('uv');
  assert.ok(uv, 'TEXCOORD_0 missing: re-run tools/blender/export_fighter.py');
  assert.equal(uv.count, mesh.geometry.getAttribute('position').count);
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1, `u out of range at ${i}`);
    assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1, `v out of range at ${i}`);
  }
});

test('fighter.glb keeps the 22-bone deform skeleton', async () => {
  const mesh = findSkinned(await loadFighterScene());
  assert.equal(mesh.skeleton.bones.length, 22);
  assert.ok(mesh.skeleton.bones.some((bone) => bone.name === 'upper_arm_L'));
});
