import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const source = await readFile(new URL('../src/game/boxingAnimation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const {
  dodgeView,
  opponentDodgeView,
  punchPose,
  strikeStrength,
  BLOCK_POSE,
  PUNCH_IMPACT_MS,
  PUNCH_DURATION_MS,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('right dodge rolls clockwise, left rolls counterclockwise, neutral re-centers', () => {
  assert.ok(dodgeView('right').roll < 0 && dodgeView('right').x > 0);
  assert.ok(dodgeView('left').roll > 0 && dodgeView('left').x < 0);
  assert.equal(dodgeView().roll, 0);
  assert.equal(dodgeView().x, 0);
});
test('opponent dodge mirrors direction and rolls the model toward its movement', () => {
  const left = opponentDodgeView('left');
  const right = opponentDodgeView('right');
  assert.ok(left.x > 0 && left.roll < 0, 'opponent left moves to viewer right');
  assert.ok(right.x < 0 && right.roll > 0, 'opponent right moves to viewer left');
  assert.equal(left.x, -right.x);
  assert.equal(left.roll, -right.roll);
  assert.equal(opponentDodgeView().x, 0);
  assert.equal(opponentDodgeView().roll, 0);
});
const guard = {
  upper: { x: 0.35, y: -0.85, z: 0.4 },
  fore: { x: -0.2, y: 0.35, z: 0.9 },
};

test('each classified move has a distinct strike pose and returns to guard', () => {
  const peak = ['jab', 'cross', 'hook', 'uppercut'].map((move) =>
    punchPose(move, 'left', PUNCH_IMPACT_MS, guard),
  );
  assert.ok(peak[0].upper.z > 0.98, 'jab reaches forward');
  assert.ok(peak[1].upper.z > 0.98, 'cross reaches forward');
  assert.ok(peak[2].upper.x > 0.6 && peak[2].fore.x < -0.6, 'hook bends across the body');
  assert.ok(peak[3].fore.y > 0.75, 'uppercut rises');
  for (const move of ['jab', 'cross', 'hook', 'uppercut']) {
    const start = punchPose(move, 'left', 0, guard);
    const nearlyDone = punchPose(move, 'left', PUNCH_DURATION_MS - 1, guard);
    assert.ok(Math.abs(start.upper.z - guard.upper.z) < 0.02, `${move} starts in guard`);
    assert.ok(Math.abs(nearlyDone.upper.z - start.upper.z) < 0.02, `${move} returns to guard`);
    assert.equal(punchPose(move, 'left', PUNCH_DURATION_MS, guard), null);
  }
});

test('blocking pose stays above guard and attack strength peaks at contact', () => {
  assert.ok(BLOCK_POSE.left.fore.y > guard.fore.y + 0.5);
  assert.ok(BLOCK_POSE.right.fore.y > guard.fore.y + 0.5);
  assert.equal(strikeStrength(0), 0);
  assert.equal(strikeStrength(PUNCH_IMPACT_MS), 1);
  assert.equal(strikeStrength(PUNCH_DURATION_MS), 0);
});
