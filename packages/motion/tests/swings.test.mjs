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
test('bent-arm vertical rises are uppercuts and lateral or diagonal sweeps are hooks', () => {
  for (const hand of ['left', 'right'])
    for (const angle of [-60, 60, -170]) {
      const d = new ActionDetector();
      d.update(features(0, hand));
      const frame = d.update(features(200, hand, angle));
      assert.equal(frame.punch, hand);
      assert.equal(frame.move, angle === -60 ? 'uppercut' : 'hook');
    }
});
test('an outward rising bent-arm swing is an uppercut', () => {
  for (const hand of ['left', 'right']) {
    for (const angle of [90, 135]) {
      const d = new ActionDetector();
      const sign = hand === 'left' ? 1 : -1;
      const start = features(0, hand);
      start.arms[hand].wrist = p(sign * 0.65, 0.5);
      start.arms[hand].reach = 0.45;
      d.update(start);
      const end = features(180, hand);
      end.arms[hand].wrist = p(sign * 0.85, -0.25);
      end.arms[hand].reach = 0.9;
      end.arms[hand].restDistance = 1;
      end.arms[hand].elbowAngle = angle;
      end.arms[hand].imageElbowAngle = angle;
      const frame = d.update(end);
      assert.equal(frame.punch, hand);
      assert.equal(
        frame.move,
        'uppercut',
        'opening the elbow does not turn a rising swing into a straight',
      );
    }
  }
});
test('a bent lateral sweep remains a hook when the elbow opens slightly', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    d.update(features(0, hand));
    const end = features(180, hand, 60, 1);
    end.arms[hand].elbowAngle = 130;
    end.arms[hand].imageElbowAngle = 130;
    const frame = d.update(end);
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, 'hook');
  }
});

test('compact bent-arm sweeps are hooks without a wide exaggerated arc', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    d.update(features(0, hand));
    const f = features(66, hand);
    f.arms[hand].wrist = p(hand === 'left' ? 0.9 : -0.9, 0.3);
    f.arms[hand].reach = Math.hypot(0.4, 0.3);
    f.arms[hand].restDistance = 0.3;
    assert.equal(d.update(f).move, 'hook');
  }
});

test('dominant vertical travel identifies an uppercut even when the elbow opens', () => {
  for (const hand of ['left', 'right'])
    for (const fromGuard of [true, false]) {
      const sign = hand === 'left' ? 1 : -1;
      const d = new ActionDetector();
      const start = features(0, hand);
      const end = features(100, hand);
      const startY = fromGuard ? -0.4 : 0.3,
        endY = fromGuard ? -0.8 : -0.3;
      start.arms[hand].wrist = p(sign * 0.7, startY);
      start.arms[hand].reach = Math.hypot(0.2, startY);
      end.arms[hand].wrist = p(sign * 1.1, endY);
      end.arms[hand].reach = Math.hypot(0.6, endY);
      end.arms[hand].restDistance = 1;
      end.arms[hand].elbowAngle = 150;
      end.arms[hand].imageElbowAngle = 150;
      d.update(start);
      const frame = d.update(end);
      assert.equal(frame.punch, hand);
      assert.equal(frame.move, fromGuard ? (hand === 'left' ? 'jab' : 'cross') : 'uppercut');
    }
});
test('hooks with a straight-looking launch emit one hook without an early jab', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    const sign = hand === 'left' ? 1 : -1;
    const actions = [];
    const trajectory = [
      [0, 0.7, -0.4],
      [33, 0.9, -0.4],
      [66, 0.45, -0.65],
      [99, 0.05, -0.8],
    ];
    for (let t = 132; t <= 297; t += 33) trajectory.push([t, 0.05, -0.8]);
    for (const [timestamp, x, y] of trajectory) {
      const f = features(timestamp, hand);
      f.arms[hand].wrist = p(sign * (0.5 + x), y);
      f.arms[hand].reach = Math.hypot(x, y);
      f.arms[hand].restDistance = timestamp ? 1 : 0;
      const result = d.update(f);
      if (result.punch) actions.push({ hand: result.punch, move: result.move });
    }
    assert.deepEqual(actions, [{ hand, move: 'hook' }]);
  }
});

test('a small wind-up followed by a horizontal swing emits one hook through its hold and return', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const actions = [];
    for (const [t, x, y] of [
      [0, 0.7, -0.4],
      [67, 0.9, -0.4],
      [100, 0.9, -0.4],
      [134, 0.45, -0.65],
      [167, 0.05, -0.8],
      [200, 0.05, -0.8],
    ]) {
      const f = features(t, hand);
      f.arms[hand].wrist = p(sign * (0.5 + x), y);
      f.arms[hand].reach = Math.hypot(x, y);
      f.arms[hand].restDistance = t ? 1 : 0;
      const result = d.update(f);
      if (result.punch) actions.push({ hand: result.punch, move: result.move });
      if (t <= 100) assert.equal(result.punch, undefined);
      if (t === 134) assert.equal(result.move, 'hook');
    }
    assert.deepEqual(actions, [{ hand, move: 'hook' }]);
  }
});
test('fast small movements cannot become attacks after the classification window', () => {
  for (const hand of ['left', 'right'])
    for (const sensitivity of [0.7, 1, 1.3]) {
      const d = new ActionDetector(sensitivity);
      const sign = hand === 'left' ? 1 : -1;
      for (let cycle = 0; cycle < 4; cycle++) {
        for (const offset of [0, 33, 66, 99, 132, 165, 198]) {
          const f = features(cycle * 231 + offset, hand);
          const x = offset >= 33 && offset <= 99 ? 0.82 : 0.7;
          f.arms[hand].wrist = p(sign * (0.5 + x), 0.4);
          f.arms[hand].reach = Math.hypot(x, 0.4);
          f.arms[hand].elbowAngle = 175;
          f.arms[hand].imageElbowAngle = 175;
          assert.equal(
            d.update(f).punch,
            undefined,
            `${hand} sensitivity ${sensitivity} at ${f.timestamp}`,
          );
        }
      }
    }
});
test('tracking invalidation never replays an already detected swing', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(d.update(features(33, 'left', -60)).punch, 'left');
  d.invalidate();
  for (const t of [66, 99, 132]) assert.equal(d.update(features(t, 'left', -60)).punch, undefined);
});
test('a held swing is one shot and a pause allows a new movement without a strict neutral pose', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(d.update(features(150, 'left', 60)).punch, 'left');
  for (let t = 200; t <= 800; t += 50)
    assert.equal(d.update(features(t, 'left', 60)).punch, undefined);
  assert.equal(d.update(features(900, 'left', 120)).punch, 'left');
  for (let t = 1000; t <= 1200; t += 50) d.update(features(t));
  assert.equal(d.update(features(1300, 'left', -60)).punch, 'left');
});
test('slow broad motion and short jitter do not count; clear inward travel is a hook', () => {
  const slow = new ActionDetector();
  for (let i = 0; i <= 20; i++)
    assert.equal(slow.update(features(i * 100, 'left', i * 3)).punch, undefined);
  const jitter = new ActionDetector();
  jitter.update(features(0));
  for (let t = 50; t <= 1000; t += 50)
    assert.equal(jitter.update(features(t, 'left', Math.sin(t) * 8)).punch, undefined);
  const retract = new ActionDetector();
  retract.update(features(0));
  assert.equal(retract.update(features(100, 'left', 60, 0.3)).move, 'hook');
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
    assert.equal(c.update(pose).punch, undefined, `guard at ${t}`);
  }
  for (let t = 3650; t <= 3950; t += 50) assert.equal(c.update(swingPose(t)).punch, undefined);
});
