import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';
import { loadFighterScene } from './fixtures/loadFighter.mjs';

const { extractModelData, findSkinnedMesh } = await loadTs(new URL('../src/avatar/skin/model.ts', import.meta.url));
const { PARTS, partFrames, rotateY } = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const model = extractModelData(findSkinnedMesh(await loadFighterScene()));
const frames = partFrames(model);
const frame = (name) => frames[PARTS.findIndex((part) => part.name === name)];
const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);

test('extracts bind-pose geometry with UVs and named joints', () => {
  assert.equal(model.positions.length / 3, model.uvs.length / 2);
  assert.equal(model.skinIndex.length, (model.positions.length / 3) * 4);
  assert.equal(model.indices.length % 3, 0);
  const hips = model.bones.find((bone) => bone.name === 'hips');
  close(hips.head[1], 0.92, 0.01, 'hips height');
});

test('every bone belongs to exactly one part', () => {
  const names = model.bones.map((bone) => bone.name).sort();
  const owned = PARTS.flatMap((part) => part.bones).sort();
  assert.deepEqual(owned, names);
});

test('torso runs up from the hips with its front facing +Z', () => {
  const torso = frame('torso');
  close(torso.axis[1], 1, 0.02, 'torso axis up');
  close(torso.u[2], 1, 0.02, 'torso front');
  close(torso.w[0], 1, 0.02, 'torso side is the fighter left');
  close(torso.length, 0.48, 0.02, 'hips to shoulders');
});

test('left upper arm points out to +X and down in the A-pose', () => {
  const arm = frame('upperArm_L');
  assert.ok(arm.axis[0] > 0.6 && arm.axis[1] < -0.5, `axis ${arm.axis}`);
  close(arm.u[2], 1, 0.05, 'arm front');
});

test('feet use up as their front because they point forward', () => {
  const foot = frame('foot_L');
  assert.ok(foot.axis[2] > 0.8, `foot axis ${foot.axis}`);
  assert.ok(foot.u[1] > 0.85, `foot front ${foot.u}`);
  assert.ok(foot.axis[1] < 0, `foot pitches down toward the toe ${foot.axis}`);
  assert.ok(foot.length > 0.08);
});

test('head reaches from the shoulders to ear height', () => {
  const head = frame('head');
  close(head.b[1], 1.66, 0.04, 'ear height');
});

test('rotateY turns forward toward +X for positive yaw', () => {
  const turned = rotateY([0, 0, 1], Math.PI / 2);
  close(turned[0], 1, 1e-9, 'x');
  close(turned[2], 0, 1e-9, 'z');
});
