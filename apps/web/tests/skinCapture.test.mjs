import { URL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const skin = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const close = (actual, expected, message, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);
import { frontLandmarks } from './fixtures/syntheticFighter.mjs';

const lm = (x, y, visibility = 1) => ({ x, y, visibility });

test('slots snap to the nearest 45° within ±20° and wrap at 360', () => {
  assert.equal(skin.slotFor(0), 0);
  assert.equal(skin.slotFor(350), 0);
  assert.equal(skin.slotFor(200), 4);
  assert.equal(skin.slotFor(67), null);
  assert.equal(skin.slotFor(-45), 7);
});

test('slot buffer keeps the best-scoring frame per slot', () => {
  const buffer = new skin.SlotBuffer();
  assert.ok(buffer.accepts(2, 0.5));
  buffer.put(2, 0.5, 'first');
  assert.ok(!buffer.accepts(2, 0.4));
  buffer.put(2, 0.9, 'better');
  assert.deepEqual(buffer.values(), ['better']);
  assert.equal(buffer.count, 1);
  assert.deepEqual(buffer.filled, [false, false, true, false, false, false, false, false]);
  buffer.clear();
  assert.equal(buffer.count, 0);
});

test('a finished turn bakes only with enough slots, otherwise asks for a slower rescan', () => {
  assert.equal(skin.captureStep({ done: false, filled: 5 }), 'continue');
  assert.equal(skin.captureStep({ done: false, filled: 8 }), 'bake', 'all slots filled completes the scan');
  assert.equal(skin.captureStep({ done: true, filled: skin.MIN_SLOTS_TO_FINISH }), 'bake');
  assert.equal(skin.captureStep({ done: true, filled: skin.MIN_SLOTS_TO_FINISH - 1 }), 'too-few');
});

test('yaw tracking needs only one visible shoulder and one visible hip', () => {
  const side = Array.from({ length: 33 }, () => lm(0.5, 0.5, 0.1));
  side[11] = lm(0.5, 0.3, 0.9);
  side[24] = lm(0.5, 0.6, 0.55);
  assert.equal(skin.yawTrackable(side), true, 'side view: far shoulder and hip hidden');
  assert.equal(skin.visible(side, skin.TORSO), false, 'framing still needs the whole torso');
  side[24] = lm(0.5, 0.6, 0.4);
  assert.equal(skin.yawTrackable(side), false, 'no hip visible');
  assert.equal(skin.yawTrackable([]), false, 'no pose');
});

test('framing requires every full-body landmark on screen and visible', () => {
  const points = frontLandmarks();
  assert.ok(skin.visible(points, skin.FULL_BODY));
  points[27] = lm(0.55, 1.02);
  assert.ok(!skin.visible(points, skin.FULL_BODY));
  assert.ok(skin.visible(points, skin.TORSO));
  points[11] = lm(0.6, 0.4, 0.3);
  assert.ok(!skin.visible(points, skin.TORSO));
});

test('steady frames outscore moving ones', () => {
  const still = frontLandmarks();
  const moved = still.map((point) => ({ ...point, x: point.x + 0.02 }));
  close(skin.landmarkMotion(still, moved, skin.FULL_BODY), 0.02, 'motion');
  assert.ok(skin.frameScore(1, 0) > skin.frameScore(1, 0.02));
});

test('back views with front-style labels get their sides swapped', () => {
  const points = frontLandmarks();
  assert.equal(skin.orientLandmarks(points, 0)[11].x, 0.6, 'front view kept');
  const back = skin.orientLandmarks(points, Math.PI);
  assert.equal(back[11].x, 0.4, 'left shoulder moved to image left');
  assert.equal(back[15].x, 0.37, 'wrists swapped with shoulders');
  assert.equal(skin.orientLandmarks(points, Math.PI / 2)[11].x, 0.6, 'side views untouched');
});

const frame = (landmarks) => ({ width: 200, height: 200, pixels: new Uint8ClampedArray(200 * 200 * 4), mask: null, landmarks, yawDeg: 0 });
const torsoFrame = { a: [0, 0.92, 0], b: [0, 1.4, 0], axis: [0, 1, 0], length: 0.48, u: [0, 0, 1], w: [1, 0, 0] };

test('facing the camera, the fighter left lands on image right', () => {
  const part = skin.imageParts(frame(frontLandmarks()), 0, [torsoFrame])[0];
  const scalePx = skin.pixelsPerMeter(frame(frontLandmarks()), torsoFrame);
  close(scalePx, 80 / 0.48, 'torso height in px per meter', 1e-3);
  const hit = skin.projectTexel(part, scalePx, 0.5, 0.1, 0.05, { x: 0, y: 0, weight: 0 });
  close(hit.x, 100 + 0.05 * scalePx, 'x');
  close(hit.y, 120, 'y halfway between hips (160) and shoulders (80)');
  close(hit.weight, (0.1 / Math.hypot(0.1, 0.05)) ** 2, 'front-facing weight');
});

test('turned +90°, the chest front faces image right and the left side faces away', () => {
  const part = skin.imageParts(frame(frontLandmarks()), Math.PI / 2, [torsoFrame])[0];
  const out = { x: 0, y: 0, weight: 0 };
  const chest = skin.projectTexel(part, 100, 0.5, 0.1, 0, out);
  close(chest.x, 100 + 10, 'front offset goes to +x');
  close(chest.weight, 0, 'front is edge-on');
  close(skin.projectTexel(part, 100, 0.5, 0, 0.1, out).weight, 0, 'left side hidden');
  close(skin.projectTexel(part, 100, 0.5, 0, -0.1, out).weight, 1, 'right side faces camera');
});
