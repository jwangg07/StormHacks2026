import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const poseUrl = moduleUrl(await readFile(new URL('../src/pose.ts', import.meta.url), 'utf8'));
const { createPoseSample, POSE_LANDMARKS } = await import(poseUrl);
const armsSource = await readFile(new URL('../src/arms.ts', import.meta.url), 'utf8');
const { ArmPoseEstimator, segmentDirection } = await import(
  moduleUrl(armsSource.replace("'./pose'", JSON.stringify(poseUrl)))
);

const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≠ ${expected}`);

/** Square frame so aspect correction is the identity. Player's left is image +x. */
function sample(overrides, timestamp = 0) {
  const input = Array.from({ length: 33 }, () => point(0.5, 0.5));
  const base = {
    nose: point(0.5, 0.2),
    leftShoulder: point(0.6, 0.4),
    rightShoulder: point(0.4, 0.4),
    leftElbow: point(0.6, 0.55),
    rightElbow: point(0.4, 0.55),
    leftWrist: point(0.6, 0.7),
    rightWrist: point(0.4, 0.7),
  };
  for (const [name, value] of Object.entries({ ...base, ...overrides }))
    input[POSE_LANDMARKS[name]] = value;
  return createPoseSample(input, timestamp, 480, 480);
}

test('a segment lying flat to the camera keeps its image direction with no depth', () => {
  const dir = segmentDirection(point(0, 0), point(0.3, 0), 0.3);
  close(dir.x, 1, 'x');
  close(dir.y, 0, 'y');
  close(dir.z, 0, 'z');
});

test('foreshortened segments recover forward depth from known length', () => {
  const dir = segmentDirection(point(0, 0), point(0.18, 0, -0.1), 0.3);
  close(dir.x, 0.6, 'x');
  close(dir.z, 0.8, 'forward depth');
  close(Math.hypot(dir.x, dir.y, dir.z), 1, 'unit length');
});

test('MediaPipe depth only flips the sign when clearly behind', () => {
  assert.ok(segmentDirection(point(0, 0, 0), point(0.1, 0, 0.05), 0.3).z > 0);
  assert.ok(segmentDirection(point(0, 0, 0), point(0.1, 0, 0.2), 0.3).z < 0);
});

test('hanging arms point down and left/right identity is preserved', () => {
  const pose = new ArmPoseEstimator().update(sample({}));
  close(pose.left.upper.y, -1, 'left upper down');
  close(pose.right.fore.y, -1, 'right fore down');
  const raised = new ArmPoseEstimator().update(
    sample({ leftElbow: point(0.75, 0.4), leftWrist: point(0.9, 0.4) }),
  );
  close(raised.left.upper.x, 1, 'left arm raised toward player left');
  close(raised.right.upper.y, -1, 'right arm unchanged');
});

test('a straight punch after a flat calibration reads as forward', () => {
  const estimator = new ArmPoseEstimator();
  estimator.update(sample({}, 0));
  // The wrist collapses onto the elbow in 2D as the forearm points at the camera.
  const punch = estimator.update(
    sample({ leftElbow: point(0.6, 0.45, -0.1), leftWrist: point(0.6, 0.47, -0.3) }, 100),
  );
  assert.ok(punch.left.fore.z > 0.9, `forearm forward: ${punch.left.fore.z}`);
  assert.ok(punch.left.upper.z > 0.9, `upper arm forward: ${punch.left.upper.z}`);
});

test('missing arm landmarks yield null for that arm only', () => {
  const input = sample({ rightWrist: { ...point(0.4, 0.7), visibility: 0.1 } });
  const pose = new ArmPoseEstimator().update(input);
  assert.equal(pose.right, null);
  assert.ok(pose.left);
  assert.deepEqual(new ArmPoseEstimator().update(null), { left: null, right: null });
});
