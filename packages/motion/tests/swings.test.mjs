import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ActionDetector } = await loadMotion('detectors');
const { MotionController } = await loadMotion('controller');
const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const p = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
function features(timestamp, hand = 'left', degrees = 0, radius = 0.8) {
  const sign = hand === 'left' ? 1 : -1;
  const a = (degrees * Math.PI) / 180;
  const start = { x: 0.7, y: 0.4 },
    rotated = {
      x: start.x * Math.cos(a) - start.y * Math.sin(a),
      y: start.x * Math.sin(a) + start.y * Math.cos(a),
    };
  const arm = (s) => ({
    wrist: p(s * 1.2, 0.4),
    shoulder: p(s * 0.5, 0),
    elbowAngle: 90,
    imageElbowAngle: 90,
    projectedForearm: 0.6,
    wristSpeed: 0,
    forwardSpeed: 0,
    restDistance: 0,
    reach: 0.8,
    depthReliable: false,
  });
  const arms = { left: arm(1), right: arm(-1) };
  arms[hand] = {
    ...arms[hand],
    wrist: p(sign * (0.5 + rotated.x), rotated.y),
    reach: radius,
    restDistance: degrees ? 1 : 0,
  };
  return {
    version: 3,
    timestamp,
    confidence: 1,
    head: p(0, -0.9),
    headOffset: { x: 0, y: 0, z: 0 },
    headDrop: 0,
    shoulderDrop: 0,
    neutral: false,
    arms,
  };
}
test('bent-arm wide and diagonal swings detect both hands without elbow extension', () => {
  for (const hand of ['left', 'right'])
    for (const angle of [-60, 60, -170]) {
      const d = new ActionDetector();
      d.update(features(0, hand));
      assert.equal(d.update(features(200, hand, angle)).punch, hand);
    }
});
test('a held swing is one-shot and needs return to rest before another swing', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(d.update(features(150, 'left', 60)).punch, 'left');
  for (let t = 200; t <= 800; t += 50)
    assert.equal(d.update(features(t, 'left', 60)).punch, undefined);
  assert.equal(d.update(features(900, 'left', 120)).punch, undefined);
  d.update(features(1000));
  assert.equal(d.update(features(1050)).punch, undefined);
  assert.equal(d.update(features(1150, 'left', -60)).punch, 'left');
});
test('slow broad motion, short jitter, and pulling an arm inward do not count as swings', () => {
  const slow = new ActionDetector();
  for (let i = 0; i <= 20; i++)
    assert.equal(slow.update(features(i * 100, 'left', i * 3)).punch, undefined);
  const jitter = new ActionDetector();
  jitter.update(features(0));
  for (let t = 50; t <= 1000; t += 50)
    assert.equal(jitter.update(features(t, 'left', Math.sin(t) * 8)).punch, undefined);
  const retract = new ActionDetector();
  retract.update(features(0));
  assert.equal(retract.update(features(100, 'left', 60, 0.3)).punch, undefined);
});
test('quick guard raises do not count as swings', () => {
  const d = new ActionDetector();
  const start = features(0);
  d.update(start);
  const guard = features(150);
  for (const [hand, s] of [
    ['left', 1],
    ['right', -1],
  ])
    guard.arms[hand] = {
      ...guard.arms[hand],
      wrist: p(s * 0.3, -0.8),
      restDistance: 1.2,
      reach: 0.85,
    };
  assert.equal(d.update(guard).punch, undefined);
});
function swingPose(timestamp, hand = 'left', degrees = 0) {
  const image = {
    nose: p(0.5, 0.25),
    leftShoulder: p(0.62, 0.45),
    rightShoulder: p(0.38, 0.45),
    leftElbow: p(0.68, 0.58),
    rightElbow: p(0.32, 0.58),
    leftWrist: p(0.81, 0.52),
    rightWrist: p(0.19, 0.52),
  };
  const shoulder = image[hand + 'Shoulder'];
  const sign = hand === 'left' ? 1 : -1;
  const a = (degrees * Math.PI) / 180;
  for (const joint of ['Elbow', 'Wrist']) {
    const v = image[hand + joint],
      x = (v.x - shoulder.x) * sign,
      y = v.y - shoulder.y;
    image[hand + joint] = p(
      shoulder.x + sign * (x * Math.cos(a) - y * Math.sin(a)),
      shoulder.y + x * Math.sin(a) + y * Math.cos(a),
    );
  }
  const input = Array.from({ length: 33 }, () => ({ ...p(0.5, 0.5), visibility: 0 }));
  for (const [name, q] of Object.entries(image)) input[POSE_LANDMARKS[name]] = q;
  return createPoseSample(input, timestamp, 480, 480);
}
test('curved landmark swings pass through calibration and normalization at 15Hz', () => {
  for (const hand of ['left', 'right']) {
    const c = new MotionController();
    c.startCalibration();
    for (let t = 0; t <= 3100; t += 50) c.update(swingPose(t));
    assert.equal(c.diagnostics().calibration.phase, 'checks');
    const punches = [];
    for (let i = 1; i <= 10; i++) {
      const frame = c.update(swingPose(3100 + i * 67, hand, Math.min(i, 3) * -20));
      if (frame.punch) punches.push(frame.punch);
    }
    assert.deepEqual(punches, [hand]);
  }
});
test('raising and releasing a guard does not become a punch when returning to calibrated rest', () => {
  const c = new MotionController();
  c.startCalibration();
  for (let t = 0; t <= 3100; t += 50) c.update(swingPose(t));
  for (let t = 3150; t <= 3600; t += 50) {
    const pose = swingPose(t);
    pose.frame.landmarks.leftWrist = p(0.57, 0.3);
    pose.frame.landmarks.rightWrist = p(0.43, 0.3);
    pose.aspectLandmarks = pose.frame.landmarks;
    assert.equal(c.update(pose).punch, undefined);
  }
  for (let t = 3650; t <= 3950; t += 50) assert.equal(c.update(swingPose(t)).punch, undefined);
});
