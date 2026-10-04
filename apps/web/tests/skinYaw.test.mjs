import { URL } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { observeYaw, YawTracker } = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const FRONT = 0.8;
const rad = (deg) => (deg * Math.PI) / 180;
const angleError = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Deterministic uniform noise in [-1, 1] (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/**
 * What observeYaw reports at a true turn of `deg` (0–360) in `direction`:
 * - ratio: shoulder width shrinks with |cos|, never below `floor`×front (landmarks rarely fully overlap);
 * - turn: world-landmark vote only while the chest clearly turns in the front quadrant (`turnSign`, 0 = none);
 * - nose: nose x offset from the shoulder midpoint over torso height, toward the chest side in the
 *   front half; in the back half BlazePose invents a front-facing head, so it is weak and mirrored;
 * - face: nose/eye visibility, fading past the side view (or always high when `faceAtBack`).
 */
function observation(deg, { direction = 1, turnSign = direction, noseSign = direction, floor = 0, noise = 0, rand, faceAtBack = false } = {}) {
  const cos = Math.cos(rad(deg));
  const sin = Math.sin(rad(deg));
  return {
    ratio: FRONT * Math.max(floor, Math.abs(cos)) + (noise ? noise * rand() : 0),
    turn: deg > 10 && deg < 80 ? turnSign : 0,
    nose: (cos > 0 ? 0.2 : -0.1) * sin * noseSign,
    face: faceAtBack ? 0.9 : clamp01(0.5 + 1.25 * cos) * 0.9 + 0.05,
  };
}

function calibrated(options = {}) {
  const tracker = new YawTracker();
  for (let i = 0; i < 10; i++) tracker.calibrate(observation(0, options));
  assert.equal(tracker.start(), true);
  return tracker;
}

/** Turn once in `step`° frames; `drop(deg)` hides frames the worker would not feed. */
function sweep(options = {}, { step = 4, drop = () => false } = {}) {
  const tracker = calibrated(options);
  const reports = [];
  for (let deg = 0; deg <= 372; deg += step) {
    if (drop(deg)) continue;
    const report = { deg, ...tracker.update(observation(deg, options)) };
    reports.push(report);
    if (report.done) break;
  }
  return { tracker, reports };
}

/** Realistic-turn invariants. `exempt(deg)` skips the accuracy check only. */
function assertTurn({ tracker, reports }, { direction = 1, exempt = () => false, label = '' } = {}) {
  const log = () => `${label}\n${reports.map((r) => `${r.deg}:${r.yawDeg.toFixed(0)}`).join(' ')}`;
  for (let i = 1; i < reports.length; i++)
    assert.ok(reports[i].yawDeg >= reports[i - 1].yawDeg, `yaw decreased at ${reports[i].deg}° ${log()}`);
  for (const { deg, yawDeg } of reports) {
    if (!exempt(deg)) assert.ok(angleError(yawDeg, deg) <= 35, `at ${deg}° reported ${yawDeg.toFixed(1)}° ${log()}`);
    if (deg >= 100 && deg <= 260)
      assert.ok(yawDeg > 45 && yawDeg < 315, `back view at ${deg}° reported as front ${yawDeg.toFixed(1)}° ${log()}`);
  }
  const done = reports.find((report) => report.done);
  assert.ok(done, `turn never completed ${log()}`);
  assert.ok(done.deg >= 330, `completed early at ${done.deg}° ${log()}`);
  assert.equal(tracker.direction, direction, label);
}

const STEPS = [2, 4];

test('tracks a full counter-clockwise turn within one slot', () => {
  for (const step of STEPS) {
    const turn = sweep({}, { step });
    assertTurn(turn, { label: `step ${step}` });
    for (const { deg, yawDeg, done } of turn.reports)
      if (!done) assert.ok(angleError(yawDeg, deg) <= 30, `step ${step}: at ${deg}° reported ${yawDeg}°`);
    assert.ok(turn.reports.find((report) => report.done).deg >= 344, `step ${step}: no early completion`);
  }
});

test('reports the turn direction from world landmarks', () => {
  assert.equal(sweep({ direction: -1, noseSign: 0 }).tracker.direction, -1);
});

test('reports the turn direction from the nose when world landmarks give no vote', () => {
  assert.equal(sweep({ direction: -1, turnSign: 0 }).tracker.direction, -1);
  assert.equal(sweep({ direction: 1, turnSign: 0 }).tracker.direction, 1);
});

const SIDE = 0.35;
const sideHidden = (deg) => Math.abs(Math.cos(rad(deg))) < SIDE;
/** Within 20° of a dropped side-view frame. */
const nearSide = (deg) => [-20, -10, 0, 10, 20].some((d) => sideHidden(deg + d));

test('(a) keeps turning when side-view frames are dropped', () => {
  for (const step of STEPS)
    assertTurn(sweep({}, { step, drop: sideHidden }), { exempt: nearSide, label: `step ${step}` });
});

test('(b) keeps turning when side views never get narrower than 0.35× the front', () => {
  for (const step of STEPS) assertTurn(sweep({ floor: SIDE }, { step }), { label: `step ${step}` });
});

test('(c) tolerates ±0.03 noise on the shoulder ratio', () => {
  for (const step of STEPS)
    for (const seed of [1, 2, 3, 4, 5])
      assertTurn(sweep({ noise: 0.03, rand: seeded(seed) }, { step }), { label: `step ${step} seed ${seed}` });
});

test('(d) tracks a clockwise turn', () => {
  for (const step of STEPS)
    for (const options of [{}, { floor: SIDE }, { noise: 0.03, rand: seeded(7) }])
      assertTurn(sweep({ direction: -1, ...options }, { step }), { direction: -1, label: `step ${step} ${JSON.stringify(options)}` });
  assertTurn(sweep({ direction: -1 }, { drop: sideHidden }), { direction: -1, exempt: nearSide, label: 'dropped' });
});

test('back views labelled as front (face always visible) still advance', () => {
  for (const step of STEPS)
    assertTurn(sweep({ faceAtBack: true, noise: 0.03, rand: seeded(11) }, { step }), { label: `step ${step}` });
});

test('standing still with noise does not ratchet the yaw forward', () => {
  const rand = seeded(3);
  const tracker = calibrated();
  let last = 0;
  for (let i = 0; i < 300; i++) {
    const { yawDeg, done } = tracker.update(observation(0, { noise: 0.03, rand }));
    assert.ok(yawDeg >= last && yawDeg <= 20 && !done, `frame ${i}: ${yawDeg}`);
    last = yawDeg;
  }
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
  image[0] = { x: 0.53, y: 0.3, z: 0, visibility: 0.9 };
  image[2] = { x: 0.52, y: 0.28, z: 0, visibility: 0.6 };
  image[5] = { x: 0.48, y: 0.28, z: 0, visibility: 0.3 };
  const result = observeYaw(image, world, 16 / 9);
  assert.ok(Math.abs(result.ratio - (0.1 * 16) / 9 / 0.3) < 1e-9);
  assert.equal(result.turn, 1);
  assert.ok(Math.abs(result.nose - (0.03 * 16) / 9 / 0.3) < 1e-9, `nose ${result.nose}`);
  assert.ok(Math.abs(result.face - 0.6) < 1e-9, `face ${result.face}`);
  assert.equal(observeYaw([], world, 1), null);
});
