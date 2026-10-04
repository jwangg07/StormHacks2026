import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { observeYaw, YawTracker } = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const FRONT = 0.8;
const rad = (deg) => (deg * Math.PI) / 180;
const angleError = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** What observeYaw reports at a true turn of `deg`: shoulder width shrinks with |cos|. */
function observation(deg, turnSign) {
  return { ratio: FRONT * Math.abs(Math.cos(rad(deg))), turn: deg > 10 && deg < 80 ? turnSign : 0 };
}

function sweep(turnSign) {
  const tracker = new YawTracker();
  for (let i = 0; i < 10; i++) tracker.calibrate({ ratio: FRONT, turn: 0 });
  assert.equal(tracker.start(), true);
  const reports = [];
  for (let deg = 0; deg <= 360; deg += 4) reports.push({ deg, ...tracker.update(observation(deg, turnSign)) });
  return { tracker, reports };
}

test('tracks a full counter-clockwise turn within one slot', () => {
  const { tracker, reports } = sweep(1);
  for (const { deg, yawDeg, done } of reports)
    if (!done) assert.ok(angleError(yawDeg, deg) <= 30, `at ${deg}° reported ${yawDeg}°`);
  assert.equal(tracker.direction, 1);
  assert.ok(reports.at(-1).done, 'turn completes back at the front');
  assert.ok(!reports.slice(0, -5).some((report) => report.done), 'no early completion');
});

test('reports the turn direction from world landmarks', () => {
  assert.equal(sweep(-1).tracker.direction, -1);
});

test('refuses to start without calibration', () => {
  assert.equal(new YawTracker().start(), false);
});

test('observeYaw measures shoulder width against torso height, aspect corrected', () => {
  const image = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  image[11] = { x: 0.55, y: 0.4, z: 0 };
  image[12] = { x: 0.45, y: 0.4, z: 0 };
  image[23] = { x: 0.53, y: 0.7, z: 0 };
  image[24] = { x: 0.47, y: 0.7, z: 0 };
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[11] = { x: 0.15, y: 0, z: 0.15 };
  world[12] = { x: -0.15, y: 0, z: -0.15 };
  const result = observeYaw(image, world, 16 / 9);
  assert.ok(Math.abs(result.ratio - (0.1 * 16) / 9 / 0.3) < 1e-9);
  assert.equal(result.turn, 1);
  assert.equal(observeYaw([], world, 1), null);
});
