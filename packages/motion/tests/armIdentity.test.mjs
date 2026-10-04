import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ArmIdentityTracker } = await loadMotion('armIdentity');
const { MotionController } = await loadMotion('controller');
const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
function sample(time, left, right = 0.4, swapped = false) {
  const named = {
    nose: point(0.5, 0.2),
    leftShoulder: point(0.65, 0.45),
    rightShoulder: point(0.35, 0.45),
    leftElbow: point(0.7, 0.5),
    rightElbow: point(0.3, 0.5),
    leftWrist: point(swapped ? right : left, 0.35),
    rightWrist: point(swapped ? left : right, 0.35),
  };
  const points = Array.from({ length: 33 }, () => ({ ...point(0.5, 0.5), visibility: 0 }));
  for (const [name, p] of Object.entries(named)) points[POSE_LANDMARKS[name]] = p;
  return createPoseSample(points, time, 1000, 1000, points);
}

test('hands can meet and reverse direction without being mistaken for a crossing', () => {
  for (const modelSwaps of [false, true]) {
    const tracker = new ArmIdentityTracker();
    for (const [time, left, right] of [
      [0, 0.6, 0.4],
      [33, 0.54, 0.46],
      [66, 0.5, 0.5],
      [99, 0.56, 0.44],
      [132, 0.62, 0.38],
      [165, 0.68, 0.32],
    ]) {
      const stable = tracker.update(sample(time, left, right, modelSwaps && time >= 99));
      assert.equal(
        stable.aspectLandmarks.leftWrist.x,
        left,
        `left at ${time}, swapped ${modelSwaps}`,
      );
      assert.equal(
        stable.aspectLandmarks.rightWrist.x,
        right,
        `right at ${time}, swapped ${modelSwaps}`,
      );
    }
  }
});

test('overlapping wrist label swaps retain the moving hand and corresponding world wrist', () => {
  const tracker = new ArmIdentityTracker();
  tracker.update(sample(0, 0.6));
  tracker.update(sample(50, 0.52));
  tracker.update(sample(100, 0.44));
  for (const [time, left] of [
    [150, 0.36],
    [200, 0.28],
  ]) {
    const raw = sample(time, left, 0.4, true);
    const stable = tracker.update(raw);
    assert.equal(stable.frame.landmarks.leftWrist.x, left);
    assert.equal(stable.frame.landmarks.rightWrist.x, 0.4);
    assert.equal(stable.aspectLandmarks.leftWrist.x, left);
    assert.equal(stable.worldLandmarks.leftWrist.x, left);
    assert.equal(raw.frame.landmarks.leftWrist.x, 0.4, 'the original sample is not mutated');
    assert.equal(stable.frame.landmarks.leftElbow.x, 0.7, 'anatomical elbow labels stay fixed');
  }
  assert.equal(
    tracker.update(sample(250, 0.2)).frame.landmarks.leftWrist.x,
    0.2,
    'model labels can recover',
  );
});

test('genuine hand crossing keeps anatomical labels even after crossing screen sides', () => {
  const tracker = new ArmIdentityTracker();
  for (const [time, left] of [
    [0, 0.6],
    [50, 0.52],
    [100, 0.44],
    [150, 0.36],
    [200, 0.28],
  ]) {
    const raw = sample(time, left);
    const stable = tracker.update(raw);
    assert.equal(stable.frame.landmarks.leftWrist.x, left);
    assert.equal(stable.frame.landmarks.rightWrist.x, 0.4);
  }
});

test('right hand crossing also retains ownership through temporary model swaps', () => {
  const tracker = new ArmIdentityTracker();
  tracker.update(sample(0, 0.6, 0.4));
  tracker.update(sample(50, 0.6, 0.48));
  tracker.update(sample(100, 0.6, 0.56));
  const stable = tracker.update(sample(150, 0.6, 0.64, true));
  assert.equal(stable.frame.landmarks.leftWrist.x, 0.6);
  assert.equal(stable.frame.landmarks.rightWrist.x, 0.64);
});

test('overlap correction feeds only the actual attacking hand through calibration and detection', () => {
  const tracker = new ArmIdentityTracker();
  const controller = new MotionController();
  controller.startCalibration();
  for (let t = 0; t <= 3100; t += 50) controller.update(tracker.update(sample(t, 0.6)));
  const actions = [];
  for (const [time, x, swap] of [
    [3150, 0.52, false],
    [3200, 0.44, false],
    [3250, 0.36, true],
    [3300, 0.28, true],
    [3350, 0.2, false],
  ]) {
    const frame = controller.update(tracker.update(sample(time, x, 0.4, swap)));
    if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
  }
  // The wrist sweeps inward across the image at a constant height: a hook.
  assert.deepEqual(actions, [{ hand: 'left', move: 'hook' }]);
});

test('identity correction resets on loss or a gap rather than guessing from stale motion', () => {
  const tracker = new ArmIdentityTracker();
  tracker.update(sample(0, 0.6));
  tracker.update(sample(50, 0.52));
  const afterGap = sample(400, 0.2);
  assert.equal(tracker.update(afterGap), afterGap);
  const invalid = { ...sample(450, 0.2), tracking: 'LOW_CONFIDENCE' };
  assert.equal(tracker.update(invalid), invalid);
  const recovered = sample(500, 0.7);
  assert.equal(tracker.update(recovered), recovered);
});

test('a corrected image pair never keeps a world wrist belonging to the wrong arm', () => {
  const tracker = new ArmIdentityTracker();
  tracker.update(sample(0, 0.6));
  tracker.update(sample(50, 0.52));
  tracker.update(sample(100, 0.44));
  const raw = sample(150, 0.36, 0.4, true);
  delete raw.worldLandmarks.rightWrist;
  const stable = tracker.update(raw);
  assert.equal(stable.frame.landmarks.leftWrist.x, 0.36);
  assert.equal(stable.worldLandmarks.leftWrist, undefined);
  assert.equal(stable.worldLandmarks.rightWrist, undefined);
});
