import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ActionDetector } = await loadMotion('detectors');
const { MotionController } = await loadMotion('controller');
const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const { ArmIdentityTracker } = await loadMotion('armIdentity');
const { PoseSmoother } = await loadMotion('smoothing');
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
  for (const angle of [95, 175]) {
    const d = new ActionDetector();
    d.update(frame(0, 'left'));
    const end = { wrist: p(0.84, 0.1), wristSpeed: 20, imageElbowAngle: angle, elbowAngle: angle };
    for (const t of [33, 66, 99, 132]) assert.equal(d.update(frame(t, 'left', end)).punch, undefined);
  }
});

function cameraPose(timestamp, hand, move, fraction = 0, worldDepth = false) {
  const image = {
    nose: p(0.5, 0.25), leftShoulder: p(0.62, 0.45), rightShoulder: p(0.38, 0.45),
    leftElbow: p(0.76, 0.6), rightElbow: p(0.24, 0.6), leftWrist: p(0.66, 0.52), rightWrist: p(0.34, 0.52),
  };
  const sign = hand === 'left' ? 1 : -1;
  const world = {
    leftShoulder: p(0.15, 0), rightShoulder: p(-0.15, 0),
    leftElbow: p(0.2, 0.2, -0.08), rightElbow: p(-0.2, 0.2, -0.08),
    leftWrist: p(0.15, 0.05, -0.16), rightWrist: p(-0.15, 0.05, -0.16),
  };
  if (move === 'jab' || move === 'risingJab') {
    const rise = move === 'risingJab';
    image[`${hand}Elbow`] = p(0.5 + sign * (0.26 - fraction * 0.11), 0.6 - fraction * (rise ? 0.21 : 0.11));
    image[`${hand}Wrist`] = p(0.5 + sign * (0.16 - fraction * 0.01), 0.52 - fraction * (rise ? 0.12 : 0.02));
    world[`${hand}Elbow`] = p(sign * (0.2 - fraction * 0.05), 0.2 * (1 - fraction), -0.08 - fraction * 0.12);
    world[`${hand}Wrist`] = p(sign * 0.15, 0.05 * (1 - fraction), -0.16 - fraction * 0.24);
  } else if (move === 'hookWithCover') {
    image[`${hand}Wrist`].x -= sign * 0.14 * fraction;
    image[`${hand}Wrist`].y -= 0.05 * fraction;
    image[`${hand}Elbow`].x -= sign * 0.14 * fraction;
    const other = hand === 'left' ? 'right' : 'left';
    image[`${other}Wrist`].x += sign * 0.005 * fraction;
    image[`${other}Wrist`].y -= 0.01 * fraction;
    image[`${other}Elbow`].y -= 0.04 * fraction;
  }
  const landmarks = named => {
    const input = Array.from({ length: 33 }, () => ({ ...p(0.5, 0.5), visibility: 0 }));
    for (const [name, value] of Object.entries(named)) input[POSE_LANDMARKS[name]] = value;
    return input;
  };
  return createPoseSample(landmarks(image), timestamp, 480, 480, worldDepth ? landmarks(world) : []);
}
function pipeline(hand, move, worldDepth = false) {
  const controller = new MotionController(), identity = new ArmIdentityTracker(), smoother = new PoseSmoother();
  const update = sample => controller.update(smoother.update(identity.update(sample)));
  for (let t = 0; t <= 3100; t += 50) update(cameraPose(t, hand, move, 0, worldDepth));
  return update;
}

test('partial-recoil jab sequences survive identity tracking, smoothing and normalization at 15 and 30Hz', () => {
  for (const hand of ['left', 'right']) for (const interval of [33, 67]) for (const worldDepth of [false, true]) {
    const update = pipeline(hand, 'jab', worldDepth);
    const actions = [];
    for (let i = 1; i <= 36; i++) {
      const fraction = (i - 1) % 6 < 2 ? 1 : 0.65;
      const f = update(cameraPose(3100 + i * interval, hand, 'jab', fraction, worldDepth));
      if (f.punch) actions.push({ hand: f.punch, move: f.move });
    }
    assert.deepEqual(actions, Array.from({ length: 6 }, () => ({ hand, move: hand === 'left' ? 'jab' : 'cross' })), `${hand}, ${interval}ms, world ${worldDepth}`);
  }
});

test('rising straight camera trajectories produce one jab rather than an uppercut', () => {
  for (const hand of ['left', 'right']) for (const interval of [33, 67]) {
    const update = pipeline(hand, 'risingJab');
    const actions = [];
    for (let i = 1; i <= 12; i++) {
      const fraction = i <= 6 ? Math.min(1, i * interval / 100) : 0;
      const f = update(cameraPose(3100 + i * interval, hand, 'risingJab', fraction));
      if (f.punch) actions.push({ hand: f.punch, move: f.move });
    }
    assert.deepEqual(actions, [{ hand, move: hand === 'left' ? 'jab' : 'cross' }]);
  }
});

test('camera hooks with covering-arm movement keep the correct hand and do not emit ghost jabs', () => {
  for (const hand of ['left', 'right']) for (const interval of [33, 67]) {
    const update = pipeline(hand, 'hookWithCover');
    const actions = [];
    for (let i = 1; i <= 12; i++) {
      const fraction = i <= 6 ? Math.min(1, i * interval / 100) : 0;
      const f = update(cameraPose(3100 + i * interval, hand, 'hookWithCover', fraction));
      if (f.punch) actions.push({ hand: f.punch, move: f.move });
    }
    assert.deepEqual(actions, [{ hand, move: 'hook' }]);
  }
});
