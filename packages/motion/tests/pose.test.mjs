import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

// Compile these pure TS modules with the existing toolchain; no extra test dependency.
function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const poseUrl = moduleUrl(await readFile(new URL('../src/pose.ts', import.meta.url), 'utf8'));
const { createPoseSample, POSE_LANDMARKS } = await import(poseUrl);
const trackingSource = await readFile(new URL('../src/tracking.ts', import.meta.url), 'utf8');
const { TrackingMonitor } = await import(
  moduleUrl(trackingSource.replace("'./pose'", JSON.stringify(poseUrl)))
);
const points = () =>
  Array.from({ length: 33 }, () => ({ x: 0.25, y: 0.5, z: -0.1, visibility: 0.9 }));

test('aspect correction preserves image coordinates and anatomical labels', () => {
  const input = points();
  input[POSE_LANDMARKS.leftWrist].x = 0.1;
  input[POSE_LANDMARKS.rightWrist].x = 0.8;
  const sample = createPoseSample(input, 100, 640, 360);
  assert.equal(sample.tracking, 'VALID');
  assert.equal(sample.frame.timestamp, 100);
  assert.equal(sample.frame.landmarks.leftWrist.x, 0.1);
  assert.equal(sample.frame.landmarks.rightWrist.x, 0.8);
  assert.equal(sample.aspectLandmarks.leftWrist.x, (0.1 * 640) / 360);
  assert.equal(sample.aspectLandmarks.leftWrist.y, 0.5);
  assert.equal(sample.aspectLandmarks.leftWrist.z, (-0.1 * 640) / 360);
  assert.notEqual(sample.frame.landmarks.leftWrist, input[15]);
});

test('rejects low visibility wrists while optional occluded hips do not invalidate upper body', () => {
  const input = points();
  input[23].visibility = 0.1;
  assert.equal(createPoseSample(input, 0, 640, 480).tracking, 'VALID');
  input[15].visibility = 0.59;
  const sample = createPoseSample(input, 0, 640, 480);
  assert.equal(sample.tracking, 'LOW_CONFIDENCE');
  assert.deepEqual(sample.missingLandmarks, ['leftWrist']);
  assert.equal(sample.frame.landmarks.leftWrist, undefined);
  assert.equal(sample.aspectLandmarks.leftHip, undefined);
  assert.equal(sample.confidence, 0.59);
  input[15].visibility = 0.6;
  assert.equal(createPoseSample(input, 0, 640, 480).tracking, 'VALID');
});

test('missing pose, invalid dimensions, nonfinite and offscreen landmarks fail safely', () => {
  assert.equal(createPoseSample([], 0, 640, 480).tracking, 'LOST');
  assert.equal(createPoseSample(points(), 0, 640, 0).tracking, 'LOST');
  const input = points();
  input[11].x = NaN;
  input[16].y = 1.1;
  const sample = createPoseSample(input, 0, 640, 480);
  assert.equal(sample.tracking, 'LOW_CONFIDENCE');
  assert.deepEqual(sample.missingLandmarks, ['leftShoulder', 'rightWrist']);
});

function establishTracking() {
  const monitor = new TrackingMonitor();
  for (let now = 0; now <= 1000; now += 50) monitor.observe('VALID', now);
  assert.equal(monitor.confirmResume(1000), true);
  return monitor;
}

test('one second of continuous validity and confirmation is required at startup', () => {
  const monitor = new TrackingMonitor();
  for (let now = 0; now <= 950; now += 50) monitor.observe('VALID', now);
  assert.equal(monitor.confirmResume(950), false);
  assert.equal(monitor.observe('VALID', 1000).canResume, true);
  assert.equal(monitor.refresh(1000).pauseRequired, true);
  assert.equal(monitor.confirmResume(1000), true);
  assert.equal(monitor.refresh(1000).pauseRequired, false);
});

test('transient confidence loss does not pause; 500ms loss does and recovery cannot auto-resume', () => {
  const monitor = establishTracking();
  monitor.observe('LOW_CONFIDENCE', 1050);
  assert.equal(monitor.observe('VALID', 1200).pauseRequired, false);
  for (let now = 1250; now <= 1700; now += 50) monitor.observe('LOW_CONFIDENCE', now);
  assert.equal(monitor.refresh(1749).pauseRequired, false);
  assert.equal(monitor.observe('LOW_CONFIDENCE', 1750).pauseRequired, true);
  for (let now = 1800; now <= 2800; now += 50) monitor.observe('VALID', now);
  assert.equal(monitor.refresh(2800).canResume, true);
  assert.equal(monitor.refresh(2800).pauseRequired, true);
  assert.equal(monitor.confirmResume(2800), true);
});

test('a stalled sample stream becomes LOST and cannot pass the recovery gate', () => {
  const monitor = establishTracking();
  assert.equal(monitor.refresh(1200).tracking, 'VALID');
  assert.equal(monitor.refresh(1201).tracking, 'LOST');
  assert.equal(monitor.refresh(1699).pauseRequired, false);
  assert.equal(monitor.refresh(1700).pauseRequired, true);
  monitor.observe('VALID', 1800);
  assert.equal(monitor.confirmResume(2800), false);
});

test('voluntary stop pauses immediately and interrupted recovery resets the one-second timer', () => {
  const monitor = establishTracking();
  assert.equal(monitor.stop(1050).pauseRequired, true);
  assert.equal(monitor.refresh(1050).tracking, 'LOST');
  for (let now = 1100; now <= 2000; now += 50) monitor.observe('VALID', now);
  monitor.observe('LOW_CONFIDENCE', 2050);
  for (let now = 2100; now <= 3050; now += 50) monitor.observe('VALID', now);
  assert.equal(monitor.confirmResume(3050), false);
  assert.equal(monitor.observe('VALID', 3100).canResume, true);
});
