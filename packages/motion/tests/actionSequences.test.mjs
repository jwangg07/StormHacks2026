import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ActionDetector } = await loadMotion('detectors');
const p = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
const handArm = sign => ({
  tracked: true, shoulder: p(sign * 0.5, 0), elbow: p(sign * 0.85, 0.6),
  wrist: p(sign * 0.65, 0.1), imageElbowAngle: 95, elbowAngle: 95,
  projectedForearm: 0.6, wristSpeed: 0, forwardSpeed: 0, restDistance: 0,
  reach: 0.3, depthReliable: false,
});
function frame(timestamp, hand, active = {}, other = {}) {
  const arms = { left: handArm(1), right: handArm(-1) };
  arms[hand] = { ...arms[hand], ...active };
  const opposite = hand === 'left' ? 'right' : 'left';
  arms[opposite] = { ...arms[opposite], ...other };
  return { version: 3, timestamp, confidence: 1, head: p(0, -0.9),
    headOffset: { x: 0, y: 0, z: 0 }, headDrop: 0, shoulderDrop: 0,
    shoulderBalance: 0, neutral: false, arms };
}

test('repeated jabs rearm on a partial recoil and next extension without a pause', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const actions = [];
    d.update(frame(0, hand));
    for (let cycle = 0; cycle < 6; cycle++) {
      for (const [offset, elbowY] of [[33, 0.1], [66, 0.1], [99, 0.27], [132, 0.27], [165, 0.27], [198, 0.27]]) {
        const end = { elbow: p(sign * 0.85, elbowY), projectedForearm: elbowY === 0.1 ? 0.2 : 0.4 };
        const f = d.update(frame(cycle * 198 + offset, hand, end));
        if (f.punch) actions.push({ hand: f.punch, move: f.move });
      }
    }
    assert.deepEqual(actions, Array.from({ length: 6 }, () => ({ hand, move: hand === 'left' ? 'jab' : 'cross' })));
  }
});

test('a rising wrist with stronger elbow extension and foreshortening is a straight punch', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    d.update(frame(0, hand));
    const f = d.update(frame(100, hand, { wrist: p(sign * 0.67, -0.4), elbow: p(sign * 0.7, -0.37), projectedForearm: 0.1 }));
    assert.equal(f.punch, hand);
    assert.equal(f.move, hand === 'left' ? 'jab' : 'cross');
  }
});

test('a large hook remains detectable when the covering hand rises slightly', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    d.update(frame(0, hand));
    const f = d.update(frame(100, hand, { wrist: p(sign * 0.05, -0.2) }, { wrist: p(-sign * 0.65, 0.05) }));
    assert.equal(f.punch, hand);
    assert.equal(f.move, 'hook');
  }
});

test('large outward horizontal hooks do not depend on a reliable elbow angle', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    d.update(frame(0, hand, { wrist: p(sign * 0.7, -0.6) }));
    const f = d.update(frame(100, hand, { wrist: p(sign * 1.3, -0.55), imageElbowAngle: 175, elbowAngle: 175 }));
    assert.equal(f.punch, hand);
    assert.equal(f.move, 'hook');
  }
});

test('a small faster elbow movement in the covering arm cannot steal a developing hook', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const startOther = { elbow: p(-sign * 0.85, 0.35), wrist: p(-sign * 0.65, 0.1) };
    d.update(frame(0, hand, {}, startOther));
    const actions = [];
    const other = { elbow: p(-sign * 0.85, 0.2), wrist: p(-sign * 0.67, 0.08) };
    for (const [t, x] of [[33, 0.55], [66, 0.3], [99, 0.05], [132, 0.05], [165, 0.05]]) {
      const f = d.update(frame(t, hand, { wrist: p(sign * x, 0.1) }, other));
      if (f.punch) actions.push({ hand: f.punch, move: f.move });
    }
    assert.deepEqual(actions, [{ hand, move: 'hook' }]);
  }
});

test('a small fast outward wrist displacement and noisy angle alone do not produce a jab', () => {
  const d = new ActionDetector();
  d.update(frame(0, 'left'));
  const end = { wrist: p(0.84, 0.1), wristSpeed: 20, imageElbowAngle: 175, elbowAngle: 175 };
  for (const t of [33, 66, 99, 132]) assert.equal(d.update(frame(t, 'left', end)).punch, undefined);
});
