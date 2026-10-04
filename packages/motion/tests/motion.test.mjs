import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const { Calibration, CALIBRATION_MS } = await loadMotion('calibration');
const { FeatureNormalizer } = await loadMotion('normalize');
const { ActionDetector } = await loadMotion('detectors');
const { MotionController } = await loadMotion('controller');
const { PoseSmoother } = await loadMotion('smoothing');
const { PracticeAdapter } = await loadMotion('practice');
const { ArmPoseEstimator } = await loadMotion('arms');
const point = (x, y, z = 0, visibility = 1) => ({ x, y, z, visibility });
const neutral = {
  nose: point(0.5, 0.25),
  leftShoulder: point(0.62, 0.45),
  rightShoulder: point(0.38, 0.45),
  leftElbow: point(0.76, 0.6),
  rightElbow: point(0.24, 0.6),
  leftWrist: point(0.66, 0.52),
  rightWrist: point(0.34, 0.52),
  leftHip: point(0.6, 0.75),
  rightHip: point(0.4, 0.75),
};
function sample(timestamp, changes = {}, transform = (p) => p, world = []) {
  const input = Array.from({ length: 33 }, () => point(0.5, 0.5, 0, 0));
  for (const [name, p] of Object.entries({ ...neutral, ...changes }))
    input[POSE_LANDMARKS[name]] = transform(p);
  return createPoseSample(input, timestamp, 480, 480, world);
}
function calibrate(calibration = new Calibration()) {
  calibration.start();
  for (let t = 0; t <= 3000; t += 50) calibration.update(sample(t));
  assert.equal(calibration.snapshot().phase, 'checks');
  return calibration;
}
function features(timestamp, changes = {}) {
  const arm = {
    wrist: point(0.65, 0.3),
    shoulder: point(0.5, 0),
    elbowAngle: 60,
    imageElbowAngle: 60,
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
    neutral: true,
    ...changes,
    arms: {
      left: {
        ...arm,
        ...changes.left,
        imageElbowAngle:
          changes.left?.imageElbowAngle ?? changes.left?.elbowAngle ?? arm.elbowAngle,
      },
      right: {
        ...arm,
        wrist: point(-0.65, 0.3),
        shoulder: point(-0.5, 0),
        ...changes.right,
        imageElbowAngle:
          changes.right?.imageElbowAngle ?? changes.right?.elbowAngle ?? arm.elbowAngle,
      },
    },
  };
}
const extended = { wrist: point(1.7, 0), elbowAngle: 175, restDistance: 1, reach: 1.2 };
const rightExtended = { ...extended, wrist: point(-1.7, 0) };
const guardArms = { left: { wrist: point(0.35, -0.8) }, right: { wrist: point(-0.35, -0.8) } };

test('calibration automatically starts on a valid pose once and preserves completed baseline across tracking loss', () => {
  const c = new MotionController();
  c.update(sample(0, { leftWrist: point(0.66, 0.52, 0, 0.1) }));
  assert.equal(c.diagnostics().calibration.phase, 'idle');
  c.update(sample(50));
  assert.equal(c.diagnostics().calibration.phase, 'collecting');
  for (let t = 100; t <= 3050; t += 50) c.update(sample(t));
  assert.equal(c.diagnostics().calibration.phase, 'checks');
  const baseline = c.calibration.baseline;
  c.update(sample(3100, { leftWrist: point(0.66, 0.52, 0, 0.1) }));
  c.update(sample(3150));
  assert.equal(c.calibration.baseline, baseline);
  assert.equal(c.diagnostics().calibration.nextCheck, 'leftPunch');
});

test('calibration needs a continuous neutral hold, rejects occlusion and finishes after both punches and guard', () => {
  const c = new Calibration();
  c.start();
  for (let t = 0; t < CALIBRATION_MS; t += 20) c.update(sample(t));
  c.update(sample(CALIBRATION_MS - 10, { leftWrist: point(0.66, 0.52, 0, 0.1) }));
  assert.equal(c.snapshot().progress, 0);
  for (let t = CALIBRATION_MS; t < CALIBRATION_MS * 2; t += 20) c.update(sample(t));
  assert.equal(c.baseline, null);
  c.update(sample(CALIBRATION_MS * 2));
  assert.ok(Math.abs(c.baseline.shoulderWidth - 0.24) < 1e-8);
  assert.ok(c.baseline.segmentRatios.left.upper > 0.35);
  assert.ok(c.baseline.torso.y > c.baseline.shoulderCenter.y);
  c.check('guard');
  assert.equal(c.snapshot().checks.guard, false);
  for (const action of ['leftPunch', 'rightPunch', 'guard']) c.check(action);
  assert.equal(c.snapshot().phase, 'ready');
  assert.deepEqual(c.snapshot().checks, { leftPunch: true, rightPunch: true, guard: true });
});

test('neutral calibration tolerates small sway, wrist adjustments and scale jitter', () => {
  const c = new Calibration();
  c.start();
  for (let t = 0; t <= 1600; t += 40) {
    const movement = Math.sin(t / 120);
    c.update(
      sample(t, {
        nose: point(0.5 + movement * 0.03, 0.25),
        leftShoulder: point(0.62 + movement * 0.012, 0.45),
        rightShoulder: point(0.38 - movement * 0.012, 0.45),
        leftWrist: point(0.66 + movement * 0.05, 0.52),
        rightWrist: point(0.34 - movement * 0.05, 0.52),
      }),
    );
  }
  assert.equal(c.snapshot().phase, 'checks');
  assert.ok(Math.abs(c.baseline.shoulderWidth - 0.24) < 0.015);
});

test('large head or wrist movements and distance changes restart the neutral hold', () => {
  for (const changes of [
    { nose: point(0.56, 0.25) },
    { leftWrist: point(0.74, 0.52) },
    { rightWrist: point(0.26, 0.52) },
    { leftShoulder: point(0.64, 0.45), rightShoulder: point(0.36, 0.45) },
  ]) {
    const c = new Calibration();
    c.start();
    for (let t = 0; t <= 600; t += 40) c.update(sample(t));
    assert.ok(c.snapshot().progress > 0);
    c.update(sample(640, changes));
    assert.equal(c.snapshot().progress, 0);
    assert.equal(c.baseline, null);
  }
});

test('changing camera distance preserves body-relative coordinates and does not create a duck', () => {
  const baseline = calibrate().baseline;
  const a = new FeatureNormalizer().update(sample(3100), baseline);
  const b = new FeatureNormalizer().update(
    sample(3100, {}, (p) => ({ ...p, x: 0.5 + (p.x - 0.5) * 0.7, y: 0.5 + (p.y - 0.5) * 0.7 })),
    baseline,
  );
  assert.ok(Math.abs(a.arms.left.wrist.x - b.arms.left.wrist.x) < 1e-8);
  assert.ok(Math.abs(a.arms.left.wrist.y - b.arms.left.wrist.y) < 1e-8);
  assert.ok(Math.abs(b.headDrop) < 1e-8);
  assert.ok(Math.abs(b.shoulderDrop) < 1e-8);
});

test('velocities use elapsed time and reset across a tracking gap', () => {
  const baseline = calibrate().baseline;
  const n = new FeatureNormalizer();
  n.update(sample(3100), baseline);
  const f = n.update(sample(3200, { leftWrist: point(0.76, 0.52) }), baseline);
  assert.ok(f.arms.left.wristSpeed > 4 && f.arms.left.wristSpeed < 4.2);
  assert.equal(n.update(sample(3600), baseline).arms.left.wristSpeed, 0);
});

test('punches are one-shot, recover per hand, need return to rest and ignore duplicate timestamps', () => {
  const d = new ActionDetector();
  d.update(features(0));
  d.update(features(50));
  assert.equal(d.update(features(150, { left: extended })).punch, 'left');
  assert.equal(d.update(features(150, { left: extended })).punch, undefined);
  assert.equal(d.update(features(200, { left: extended, right: rightExtended })).punch, undefined);
  assert.equal(d.update(features(250, { left: extended, right: rightExtended })).punch, 'right');
  for (let t = 300; t < 700; t += 50)
    assert.equal(d.update(features(t, { left: extended, right: rightExtended })).punch, undefined);
  d.update(features(700));
  assert.equal(d.update(features(800, { right: rightExtended })).punch, 'right');
  d.update(features(850));
  assert.equal(d.update(features(950, { left: extended })).punch, 'left');
});

test('simultaneous punches choose strongest then left on a tie; depth alone cannot attack', () => {
  for (const [right, expected] of [
    [{ ...extended, wrist: point(-1.7, 0) }, 'left'],
    [{ ...extended, wrist: point(-2.2, 0), reach: 1.8 }, 'right'],
  ]) {
    const d = new ActionDetector();
    d.update(features(0));
    assert.equal(d.update(features(100, { left: extended, right })).punch, expected);
  }
  const d = new ActionDetector();
  d.update(features(0, { left: { depthReliable: true } }));
  assert.equal(
    d.update(
      features(100, {
        left: { depthReliable: true, forwardSpeed: 5, elbowAngle: 175, reach: 1.2 },
      }),
    ).punch,
    undefined,
  );
});

test('guard uses entry/exit hysteresis and attacks suppress duck', () => {
  const d = new ActionDetector();
  assert.equal(d.update(features(0, guardArms)).guard, false);
  assert.equal(d.update(features(50, guardArms)).guard, false);
  assert.equal(d.update(features(100, guardArms)).guard, true);
  assert.equal(d.update(features(150)).guard, true);
  assert.equal(d.update(features(250)).guard, true);
  assert.equal(d.update(features(300)).guard, false);
  d.update(features(350, { left: extended, headDrop: 0.5, shoulderDrop: 0.5 }));
  const frame = d.update(features(400, { left: extended, headDrop: 0.5, shoulderDrop: 0.5 }));
  assert.equal(frame.punch, 'left');
  assert.equal(frame.guard, false);
  assert.equal(frame.duck, false);
});

test('a held block has no timer and releases only after hands lower', () => {
  const d = new ActionDetector();
  for (let t = 0; t <= 3000; t += 50) {
    const frame = d.update(features(t, guardArms));
    if (t >= 100) assert.equal(frame.guard, true);
  }
  d.update(features(3050));
  d.update(features(3150));
  assert.equal(d.update(features(3200)).guard, false);
});

test('shoulder balance and head movement select a held left or right dodge', () => {
  const d = new ActionDetector();
  const lean = (time, balance, headX) =>
    features(time, { shoulderBalance: balance, headOffset: { x: headX, y: 0, z: 0 } });
  assert.equal(d.update(lean(0, 0.2, 0)).dodge, undefined, 'shoulder motion alone');
  assert.equal(d.update(lean(50, 0, 0.2)).dodge, undefined, 'head motion alone');
  for (let t = 100; t <= 300; t += 50)
    assert.equal(d.update(lean(t, 0.2, 0.2)).dodge, undefined, 'small sway is ignored');
  d.update(lean(350, 0.35, 0.35));
  assert.equal(d.update(lean(400, 0.35, 0.35)).dodge, undefined, 'brief lean is ignored');
  assert.equal(d.update(lean(450, 0.35, 0.35)).dodge, 'left', 'responds after 100ms');
  for (let t = 600; t <= 850; t += 50)
    assert.equal(d.update(lean(t, 0.2, 0.2)).dodge, 'left', 'hold continues');
  d.update(lean(900, 0, 0));
  assert.equal(d.update(lean(1000, 0, 0)).dodge, undefined, 're-centers within 100ms');
  d.update(lean(1150, -0.35, -0.35));
  assert.equal(d.update(lean(1250, -0.35, -0.35)).dodge, 'right');
});

test('block remains latched through elbow noise and wide raised hands', () => {
  const d = new ActionDetector();
  for (let t = 0; t <= 150; t += 50) d.update(features(t, guardArms));
  for (let t = 200; t <= 2500; t += 50) {
    const noise = Math.sin(t) * 0.1;
    const frame = d.update(
      features(t, {
        left: { wrist: point(0.8 + noise, -0.5), elbowAngle: 175, depthReliable: t % 100 === 0 },
        right: { wrist: point(-0.8 - noise, -0.5), elbowAngle: 175, depthReliable: t % 100 === 0 },
      }),
    );
    assert.equal(frame.guard, true, 'raised wrists keep the block regardless of elbow estimates');
  }
  const frame = d.update(
    features(2600, {
      left: { ...extended, wrist: point(1.7, -0.5) },
      right: guardArms.right,
    }),
  );
  // A strike can animate one arm while the other continues to cover the face.
  assert.equal(frame.guard, true);
  for (let t = 2650; t <= 3000; t += 50) assert.equal(d.update(features(t, guardArms)).guard, true);
  d.update(features(3050));
  assert.equal(d.update(features(3200)).guard, false);
});

test('a punch from block keeps the other hand blocking throughout recovery', () => {
  const d = new ActionDetector();
  for (let t = 0; t <= 150; t += 50) d.update(features(t, guardArms));
  const attack = {
    left: { ...extended, wrist: point(1.7, -0.5) },
    right: guardArms.right,
  };
  d.update(features(200, attack));
  const frame = d.update(features(250, attack));
  assert.equal(frame.punch, 'left');
  assert.equal(frame.guard, true);
  for (let t = 300; t <= 1000; t += 50) assert.equal(d.update(features(t, guardArms)).guard, true);
});

test('calibrated shoulder tilt keeps left and right dodge evidence directional', () => {
  const baseline = calibrate().baseline;
  const left = new FeatureNormalizer().update(
    sample(3200, {
      nose: point(0.54, 0.25),
      leftShoulder: point(0.62, 0.49),
      rightShoulder: point(0.38, 0.41),
    }),
    baseline,
  );
  const right = new FeatureNormalizer().update(
    sample(3200, {
      nose: point(0.46, 0.25),
      leftShoulder: point(0.62, 0.41),
      rightShoulder: point(0.38, 0.49),
    }),
    baseline,
  );
  assert.ok(left.shoulderBalance > 0.13 && left.headOffset.x > 0.14);
  assert.ok(right.shoulderBalance < -0.13 && right.headOffset.x < -0.14);
});

test('duck ignores head nods, expires at 800ms and requires 400ms neutral before rearming', () => {
  const d = new ActionDetector();
  for (let t = 0; t <= 200; t += 50)
    assert.equal(d.update(features(t, { headDrop: 0.5 })).duck, false);
  const low = { headDrop: 0.5, shoulderDrop: 0.5 };
  for (let t = 250; t <= 350; t += 50) d.update(features(t, low));
  assert.equal(d.update(features(400, low)).duck, true);
  for (let t = 450; t <= 1100; t += 50) assert.equal(d.update(features(t, low)).duck, true);
  assert.equal(d.update(features(1150, low)).duck, false);
  for (let t = 1200; t <= 1500; t += 50) assert.equal(d.update(features(t, low)).duck, false);
  for (let t = 1550; t <= 1950; t += 50) d.update(features(t));
  d.update(features(2000, low));
  d.update(features(2050, low));
  assert.equal(d.update(features(2100, low)).duck, true);
});

test('tracking invalidation cancels defense and does not replay a held punch on return', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(d.update(features(100, { left: extended })).punch, 'left');
  d.invalidate();
  for (let t = 600; t <= 900; t += 50) {
    const frame = d.update(features(t, { left: extended }));
    assert.equal(frame.punch, undefined);
    assert.equal(frame.guard, false);
  }
});

test('smoothing reduces stationary jitter, follows fast motion and resets instead of sweeping across gaps', () => {
  const smoother = new PoseSmoother();
  smoother.update(sample(0));
  let last;
  for (let t = 20; t <= 400; t += 20)
    last = smoother.update(sample(t, { leftWrist: point(0.66 + (t % 40 ? 0.005 : -0.005), 0.52) }));
  assert.ok(Math.abs(last.frame.landmarks.leftWrist.x - 0.66) < 0.003);
  last = smoother.update(sample(450, { leftWrist: point(0.92, 0.43) }));
  assert.ok(last.frame.landmarks.leftWrist.x > 0.9);
  last = smoother.update(sample(900));
  assert.equal(last.frame.landmarks.leftWrist.x, 0.66);
});

test('estimated world pose supports depth, invalid world joints fall back without NaNs', () => {
  const world = Array.from({ length: 33 }, () => point(0, 0, 0, 0));
  for (const [name, p] of Object.entries({
    leftShoulder: point(0.15, 0),
    rightShoulder: point(-0.15, 0),
    leftElbow: point(0.25, 0.15, -0.1),
    leftWrist: point(0.15, 0.05, -0.2),
  }))
    world[POSE_LANDMARKS[name]] = p;
  const s = sample(3100, {}, (p) => p, world);
  const f = new FeatureNormalizer().update(s, calibrate().baseline);
  assert.equal(f.arms.left.depthReliable, true);
  assert.equal(f.arms.right.depthReliable, false);
  const pose = new ArmPoseEstimator().update(s);
  assert.ok(Number.isFinite(pose.left.fore.z));
  assert.ok(pose.left.fore.z > 0);
  world[POSE_LANDMARKS.leftWrist] = point(100, 100, 100);
  assert.equal(
    new FeatureNormalizer().update(
      sample(3200, {}, (p) => p, world),
      calibrate().baseline,
    ).arms.left.depthReliable,
    false,
  );
});

test('full landmark sequence completes calibration after the two punches and guard', () => {
  const c = new MotionController();
  c.startCalibration();
  for (let t = 0; t <= 3100; t += 50) c.update(sample(t));
  const punch = (hand) => ({
    [`${hand}Elbow`]: point(hand === 'left' ? 0.78 : 0.22, 0.44),
    [`${hand}Wrist`]: point(hand === 'left' ? 0.92 : 0.08, 0.43),
  });
  assert.equal(c.update(sample(3200, punch('left'))).punch, 'left');
  for (let t = 3250; t <= 3800; t += 50) c.update(sample(t));
  assert.equal(c.update(sample(3900, punch('right'))).punch, 'right');
  const guard = { leftWrist: point(0.57, 0.3), rightWrist: point(0.43, 0.3) };
  for (let t = 3950; t <= 4750; t += 50) c.update(sample(t, guard));
  assert.equal(c.diagnostics().calibration.checks.guard, true);
  assert.equal(c.diagnostics().calibration.phase, 'ready');
  const lost = c.update(sample(5250, { leftWrist: point(0.66, 0.52, 0, 0) }));
  assert.equal(lost.guard, false);
  assert.equal(lost.duck, false);
  assert.equal(lost.punch, undefined);
});

test('practice consumes only normalized controls and counts edges once', () => {
  const p = new PracticeAdapter();
  const frame = {
    timestamp: 0,
    tracking: 'VALID',
    headOffset: { x: 0, y: 0 },
    guard: false,
    duck: false,
    punch: 'left',
  };
  p.consume(frame);
  p.consume(frame);
  p.consume({ ...frame, timestamp: 50, punch: undefined, guard: true });
  p.consume({ ...frame, timestamp: 100, punch: undefined, guard: true });
  p.consume({ ...frame, timestamp: 150, tracking: 'LOST', punch: undefined, guard: false });
  assert.deepEqual(p.snapshot(), { leftPunches: 1, rightPunches: 0, guards: 1, ducks: 0 });
});

test('thirty seconds of idle and guard jitter produce no false punches', () => {
  const d = new ActionDetector();
  for (let t = 0; t <= 30000; t += 50) {
    const guarding = t % 6000 > 3000;
    const jitter = Math.sin(t * 0.037) * 0.03;
    const frame = d.update(
      features(t, {
        left: { wrist: point(0.35 + jitter, guarding ? -0.8 : 0.3), elbowAngle: 65 + jitter * 100 },
        right: {
          wrist: point(-0.35 - jitter, guarding ? -0.8 : 0.3),
          elbowAngle: 65 - jitter * 100,
        },
        headDrop: jitter,
        shoulderDrop: -jitter,
      }),
    );
    assert.equal(frame.punch, undefined);
    assert.equal(frame.duck, false);
  }
});

test('actions keep calibration fixed; only quiet neutral samples adapt it slowly', () => {
  const c = new MotionController();
  c.startCalibration();
  for (let t = 0; t <= 3000; t += 50) c.update(sample(t));
  for (const action of ['leftPunch', 'rightPunch', 'guard']) c.calibration.check(action);
  const baselineY = c.calibration.baseline.head.y;
  c.update(sample(3050, {}, (p) => ({ ...p, y: p.y + 0.1 })));
  assert.equal(c.calibration.baseline.head.y, baselineY);
  for (let t = 3100; t <= 4000; t += 50) c.update(sample(t, {}, (p) => ({ ...p, y: p.y + 0.01 })));
  const adapted = c.calibration.baseline.head.y;
  assert.ok(adapted > baselineY && adapted < baselineY + 0.001);
});
