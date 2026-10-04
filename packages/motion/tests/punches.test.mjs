import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ActionDetector } = await loadMotion('detectors');
const { MotionController } = await loadMotion('controller');
const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
function features(timestamp, left = {}) {
  const arm = {
    wrist: point(0.65, 0.3),
    shoulder: point(0.5, 0),
    elbowAngle: 95,
    imageElbowAngle: 95,
    projectedForearm: 0.6,
    wristSpeed: 0,
    forwardSpeed: 0,
    restDistance: 0,
    reach: 0.3,
    depthReliable: false,
  };
  return {
    version: 3,
    timestamp,
    confidence: 1,
    head: point(0, -0.9),
    headOffset: { x: 0, y: 0, z: 0 },
    headDrop: 0,
    shoulderDrop: 0,
    neutral: false,
    arms: {
      left: { ...arm, ...left },
      right: { ...arm, wrist: point(-0.65, 0.3), shoulder: point(-0.5, 0) },
    },
  };
}
const punch = {
  wrist: point(1.15, 0.3),
  elbowAngle: 135,
  imageElbowAngle: 135,
  restDistance: 0.5,
  reach: 0.65,
};

test('rising extension punches need not lock the elbow to 150 degrees', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(d.update(features(200, punch)).punch, 'left');
});
test('returning to face-level guard rearms after a punch', () => {
  const d = new ActionDetector();
  d.update(features(0));
  d.update(features(100, { ...punch, elbowAngle: 175, imageElbowAngle: 175 }));
  for (let t = 150; t <= 600; t += 50)
    d.update(features(t, { wrist: point(0.35, -0.8), restDistance: 1.05 }));
  assert.equal(
    d.update(
      features(700, { ...punch, wrist: point(1.15, -0.5), elbowAngle: 175, imageElbowAngle: 175 }),
    ).punch,
    'left',
  );
});
test('image geometry still detects punches when estimated depth drops out mid-extension', () => {
  const d = new ActionDetector();
  d.update(features(0, { depthReliable: true }));
  assert.equal(
    d.update(features(150, { ...punch, elbowAngle: 175, imageElbowAngle: 175 })).punch,
    'left',
  );
});
test('forward punches can shorten projected reach when extension and image foreshortening agree', () => {
  const d = new ActionDetector();
  d.update(features(0, { depthReliable: true, worldReach: 0.6, wrist: point(0.65, 0.3, -0.2) }));
  const end = {
    depthReliable: true,
    worldReach: 1.1,
    wrist: point(0.68, 0.28, -0.65),
    elbowAngle: 145,
    imageElbowAngle: 70,
    projectedForearm: 0.2,
    restDistance: 0.1,
    reach: 0.2,
  };
  assert.equal(d.update(features(200, end)).punch, 'left');
  for (let t = 250; t <= 900; t += 50) assert.equal(d.update(features(t, end)).punch, undefined);
});
test('a depth spike with unchanged image geometry cannot create a punch', () => {
  const d = new ActionDetector();
  d.update(features(0, { depthReliable: true, worldReach: 0.6, wrist: point(0.65, 0.3, -0.2) }));
  assert.equal(
    d.update(
      features(200, {
        depthReliable: true,
        worldReach: 1.1,
        wrist: point(0.65, 0.3, -0.65),
        elbowAngle: 145,
      }),
    ).punch,
    undefined,
  );
});
test('retraction that expands the image projection is not an outward punch', () => {
  const d = new ActionDetector();
  // An unconsumed hand may still be armed from the initial stance.
  d.update(features(0, { depthReliable: true }));
  d.update(
    features(100, {
      depthReliable: true,
      elbowAngle: 170,
      imageElbowAngle: 40,
      wrist: point(0.6, 0.1, -0.8),
      reach: 0.2,
    }),
  );
  const frame = d.update(
    features(200, {
      depthReliable: true,
      elbowAngle: 100,
      imageElbowAngle: 100,
      wrist: point(0.8, 0.4, -0.2),
      reach: 0.6,
    }),
  );
  assert.equal(frame.punch, undefined);
});

function pose(timestamp, fraction = 0, hand = 'left', includeWorld = true) {
  const mix = (a, b) => a + (b - a) * fraction;
  const image = {
    nose: point(0.5, 0.25),
    leftShoulder: point(0.62, 0.45),
    rightShoulder: point(0.38, 0.45),
    leftElbow: point(0.76, 0.6),
    rightElbow: point(0.24, 0.6),
    leftWrist: point(0.66, 0.52),
    rightWrist: point(0.34, 0.52),
  };
  const world = {
    nose: point(0, -0.25),
    leftShoulder: point(0.15, 0),
    rightShoulder: point(-0.15, 0),
    leftElbow: point(0.2, 0.2, -0.08),
    rightElbow: point(-0.2, 0.2, -0.08),
    leftWrist: point(0.15, 0.05, -0.16),
    rightWrist: point(-0.15, 0.05, -0.16),
  };
  const sign = hand === 'left' ? 1 : -1;
  image[`${hand}Elbow`] = point(mix(0.5 + sign * 0.26, 0.5 + sign * 0.15), mix(0.6, 0.49));
  image[`${hand}Wrist`] = point(mix(0.5 + sign * 0.16, 0.5 + sign * 0.15), mix(0.52, 0.5));
  world[`${hand}Elbow`] = point(mix(sign * 0.2, sign * 0.15), mix(0.2, 0), mix(-0.08, -0.2));
  world[`${hand}Wrist`] = point(sign * 0.15, mix(0.05, 0), mix(-0.16, -0.4));
  const points = (named) => {
    const result = Array.from({ length: 33 }, () => ({ ...point(0.5, 0.5), visibility: 0 }));
    for (const [name, p] of Object.entries(named)) result[POSE_LANDMARKS[name]] = p;
    return result;
  };
  return createPoseSample(points(image), timestamp, 480, 480, includeWorld ? points(world) : []);
}
test('front-camera landmark trajectories detect each hand at 15Hz through normalization', () => {
  for (const hand of ['left', 'right']) {
    const c = new MotionController();
    c.startCalibration();
    for (let t = 0; t <= 3100; t += 50) c.update(pose(t));
    assert.equal(c.diagnostics().calibration.phase, 'checks');
    const actions = [];
    for (let i = 1; i <= 7; i++) {
      const frame = c.update(pose(3100 + i * 67, Math.min(1, i / 3), hand));
      if (frame.punch) actions.push(frame.punch);
    }
    assert.deepEqual(actions, [hand]);
  }
});
