import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';
import { chestQuad } from './fixtures/syntheticFighter.mjs';
import { loadFighterScene } from './fixtures/loadFighter.mjs';

const skin = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const { extractModelData, findSkinnedMesh } = await loadTs(new URL('../src/avatar/skin/model.ts', import.meta.url));
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-4, `${message}: ${actual} ≠ ${expected}`);

test('a chest quad covers every texel with exact torso coordinates', () => {
  const size = 8;
  const map = skin.buildTexelMap(chestQuad(), size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      assert.equal(map.part[i], skin.TORSO_PART, `texel ${x},${y} covered`);
      close(map.t[i], 1 - v, 't runs hips → shoulders');
      close(map.du[i], 0.1, 'front offset');
      close(map.dw[i], -0.2 + 0.4 * u, 'side offset is model x');
    }
});

test('the real fighter covers a healthy share of the texture with valid parts', async () => {
  const model = extractModelData(findSkinnedMesh(await loadFighterScene()));
  const map = skin.buildTexelMap(model, 128);
  let covered = 0;
  for (const part of map.part) {
    if (part === skin.UNCOVERED) continue;
    covered += 1;
    assert.ok(part < skin.PARTS.length);
  }
  assert.ok(covered / map.part.length > 0.15, `coverage ${covered / map.part.length}`);
  const seen = new Set(map.part);
  for (let part = 0; part < skin.PARTS.length; part++) assert.ok(seen.has(part), `${skin.PARTS[part].name} has texels`);
});
