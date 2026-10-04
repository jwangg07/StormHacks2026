import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';
import { chestQuad, frontLandmarks } from './fixtures/syntheticFighter.mjs';

const skin = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const SIZE = 16;
const map = skin.buildTexelMap(chestQuad(), SIZE);
const RED = [220, 40, 40];
const BLUE = [40, 60, 220];

/** 200×200 frame: image-left half red, image-right half blue. */
function splitFrame({ yawDeg = 0, landmarks = frontLandmarks(), mask = null } = {}) {
  const pixels = new Uint8ClampedArray(200 * 200 * 4);
  for (let y = 0; y < 200; y++)
    for (let x = 0; x < 200; x++) pixels.set([...(x < 100 ? RED : BLUE), 255], (y * 200 + x) * 4);
  return { width: 200, height: 200, pixels, mask, landmarks, yawDeg };
}
const texel = (rgba, x, y) => Array.from(rgba.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));
const near = (actual, expected) => actual.every((value, i) => Math.abs(value - expected[i]) <= 2);

test('front view paints the fighter left from image right', () => {
  const rgba = skin.bakeSkin(map, [splitFrame()], 1);
  // In the chest quad, u > 0.5 is model +x (fighter left).
  assert.ok(near(texel(rgba, SIZE - 2, SIZE / 2), BLUE), `left: ${texel(rgba, SIZE - 2, SIZE / 2)}`);
  assert.ok(near(texel(rgba, 1, SIZE / 2), RED), `right: ${texel(rgba, 1, SIZE / 2)}`);
});

test('a back view mislabeled as front still paints the correct sides', () => {
  // The back frame's labels look front-facing; the fighter front (chest quad) faces away, so it gets no weight.
  const rgba = skin.bakeSkin(map, [splitFrame(), splitFrame({ yawDeg: 180 })], 1);
  assert.ok(near(texel(rgba, SIZE - 2, SIZE / 2), BLUE));
});

test('pixels outside the person mask are never sampled', () => {
  const mask = new Float32Array(200 * 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 100; x++) mask[y * 200 + x] = 1;
  const rgba = skin.bakeSkin(map, [splitFrame({ mask })], 1);
  // The blue half is "background"; its texels are filled from red neighbours instead.
  assert.ok(near(texel(rgba, SIZE - 2, SIZE / 2), RED), `${texel(rgba, SIZE - 2, SIZE / 2)}`);
});

test('turn direction mirrors which side faces the camera at 90°', () => {
  const side = (direction) => skin.bakeSkin(map, [splitFrame({ yawDeg: 90 })], direction);
  // +90°: chest front swings to image right (blue), -90°: to image left (red). Front faces are edge-on,
  // so only the axis-weighted texels sample; check the overall tint of the quad's centre column.
  assert.notDeepEqual(texel(side(1), SIZE / 2, SIZE / 2), texel(side(-1), SIZE / 2, SIZE / 2));
});

test('unseen texels take neighbour colours and the gutter is filled', () => {
  const size = 4;
  const holeMap = {
    size,
    part: Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? skin.UNCOVERED : 0)),
    t: new Float32Array(16), du: new Float32Array(16), dw: new Float32Array(16), frames: [],
  };
  const sum = new Float32Array(48);
  const weight = new Float32Array(16);
  sum.set([200, 100, 50], 0);
  weight[0] = 1;
  const rgba = skin.finishTexture(holeMap, sum, weight);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual(Array.from(rgba.slice(i * 4, i * 4 + 4)), [200, 100, 50, 255], `texel ${i}`);
  }
});
