import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ActionDetector } = await loadMotion('detectors');
const { MotionController } = await loadMotion('controller');
const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const { PoseSmoother } = await loadMotion('smoothing');
const { ArmIdentityTracker } = await loadMotion('armIdentity');
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });

function features(timestamp, hand, changes = {}, reflected = false) {
  const arm = (sign) => ({
    shoulder: point(sign * 0.5, 0),
    elbow: point(sign * 0.85, 0.55),
    wrist: point(sign * 0.65, 0.05),
    elbowAngle: 95,
    imageElbowAngle: 95,
    projectedForearm: 0.6,
    wristSpeed: 0,
    forwardSpeed: 0,
    restDistance: 0,
    reach: Math.hypot(0.15, 0.05),
    depthReliable: false,
  });
  const arms = { left: arm(1), right: arm(-1) };
  arms[hand] = { ...arms[hand], ...changes };
  for (const a of Object.values(arms)) {
    a.reach = Math.hypot(a.wrist.x - a.shoulder.x, a.wrist.y - a.shoulder.y);
    if (reflected) for (const joint of ['shoulder', 'elbow', 'wrist']) a[joint].x *= -1;
  }
  return {
    timestamp,
    version: 3,
    confidence: 1,
    head: point(0, -0.9),
    headOffset: { x: 0, y: 0, z: 0 },
    headDrop: 0,
    shoulderDrop: 0,
    neutral: false,
    arms,
  };
}

test('front-camera straights use fast elbow-to-wrist alignment with almost no wrist travel or depth', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    d.update(features(0, hand));
    const end = { elbow: point(sign * 0.7, 0.05), wrist: point(sign * 0.7, 0.05) };
    const result = d.update(features(100, hand, end));
    assert.equal(result.punch, hand);
    assert.equal(result.move, hand === 'left' ? 'jab' : 'cross');
    for (let t = 233; t <= 400; t += 33)
      assert.equal(d.update(features(t, hand, end)).punch, undefined, 'held extension is one shot');
  }
});

test('slow alignment, a wrist lowering toward the elbow, and an already level arm are not jabs', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    for (const [start, end, elapsed] of [
      [{}, { elbow: point(sign * 0.7, 0.05), wrist: point(sign * 0.7, 0.05) }, 1000],
      [{}, { wrist: point(sign * 0.65, 0.55) }, 100],
      [{ elbow: point(sign * 0.85, 0.05) }, { elbow: point(sign * 0.7, 0.05) }, 100],
    ]) {
      const d = new ActionDetector();
      d.update(features(0, hand, start));
      assert.equal(d.update(features(elapsed, hand, end)).punch, undefined);
    }
  }
});

test('hooks use inward lateral wrist travel without needing a large arc, in either screen orientation', () => {
  for (const hand of ['left', 'right'])
    for (const reflected of [false, true])
      for (const depthReliable of [false, true]) {
        const sign = hand === 'left' ? 1 : -1;
        const d = new ActionDetector();
        const start = { wrist: point(sign * 0.7, -0.8, -0.2), depthReliable };
        d.update(features(0, hand, start, reflected));
        const end = { ...start, wrist: point(sign * 0.42, -0.79, -0.6), restDistance: 0.28 };
        const result = d.update(features(100, hand, end, reflected));
        assert.equal(result.punch, hand);
        assert.equal(result.move, 'hook', 'lateral image evidence wins over noisy forward depth');
      }
});

test('slow or tiny lateral sweeps do not become hooks', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    for (const [x, elapsed] of [
      [0.42, 1000],
      [0.6, 33],
    ]) {
      const d = new ActionDetector();
      const start = { wrist: point(sign * 0.7, -0.8) };
      d.update(features(0, hand, start));
      assert.equal(
        d.update(
          features(elapsed, hand, {
            wrist: point(sign * x, -0.79),
            restDistance: Math.abs(x - 0.7),
          }),
        ).punch,
        undefined,
      );
    }
  }
});

test('uppercuts require the larger vertical travel floor at each sensitivity', () => {
  for (const hand of ['left', 'right'])
    for (const sensitivity of [0.7, 1, 1.3]) {
      const sign = hand === 'left' ? 1 : -1;
      const d = new ActionDetector(sensitivity);
      d.update(features(0, hand));
      const floor = 0.45 / sensitivity;
      const below = { wrist: point(sign * 0.65, 0.05 - floor + 0.02) };
      assert.equal(d.update(features(100, hand, below)).punch, undefined);
      const result = d.update(
        features(133, hand, { wrist: point(sign * 0.65, 0.05 - floor - 0.02) }),
      );
      assert.equal(result.punch, hand);
      assert.equal(result.move, 'uppercut');
      assert.equal(
        d.update(features(200, hand, { wrist: point(sign * 0.65, 0.05 - floor - 0.02) })).punch,
        undefined,
      );
    }
});

test('an unfinished vertical rise with noisy depth waits instead of becoming a jab', () => {
  const d = new ActionDetector();
  d.update(features(0, 'left', { wrist: point(0.65, 0.05, -0.2), depthReliable: true }));
  const below = { wrist: point(0.65, -0.25, -0.6), projectedForearm: 0.4, depthReliable: true };
  assert.equal(d.update(features(100, 'left', below)).punch, undefined);
  const result = d.update(features(150, 'left', { ...below, wrist: point(0.65, -0.5, -0.6) }));
  assert.equal(result.move, 'uppercut');
});

test('horizontal bent-arm swings in either direction register once as hooks for both hands and orientations', () => {
  for (const hand of ['left', 'right'])
    for (const direction of [-1, 1])
      for (const reflected of [false, true])
        for (const depthReliable of [false, true]) {
          const sign = hand === 'left' ? 1 : -1;
          const d = new ActionDetector();
          d.update(features(0, hand, { depthReliable }, reflected));
          const end = { wrist: point(sign * (0.65 + direction * 0.35), 0.07, -0.5), depthReliable };
          const result = d.update(features(100, hand, end, reflected));
          assert.equal(result.punch, hand);
          assert.equal(result.move, 'hook');
          assert.equal(d.update(features(150, hand, end, reflected)).punch, undefined);
          for (let t = 200; t <= 350; t += 50)
            assert.equal(
              d.update(features(t, hand, { depthReliable }, reflected)).punch,
              undefined,
              'recoil does not attack',
            );
        }
});

test('clear upward wrist motion from chest height is an uppercut despite noisy forward depth', () => {
  for (const hand of ['left', 'right'])
    for (const depthReliable of [false, true]) {
      const sign = hand === 'left' ? 1 : -1;
      const d = new ActionDetector();
      d.update(features(0, hand, { wrist: point(sign * 0.65, 0.05, -0.2), depthReliable }));
      const result = d.update(
        features(100, hand, {
          wrist: point(sign * 0.67, -0.55, -0.6),
          elbow: point(sign * 0.85, -0.1),
          depthReliable,
          restDistance: 0.6,
        }),
      );
      assert.equal(result.punch, hand);
      assert.equal(result.move, 'uppercut');
    }
});

test('slow rises, short vertical fidgets and downward releases are not uppercuts', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    for (const [y, elapsed] of [
      [-0.3, 1000],
      [-0.05, 33],
      [0.55, 100],
    ]) {
      const d = new ActionDetector();
      d.update(features(0, hand));
      assert.equal(
        d.update(
          features(elapsed, hand, {
            wrist: point(sign * 0.65, y),
            restDistance: Math.abs(y - 0.05),
          }),
        ).punch,
        undefined,
      );
    }
  }
});

function pose(timestamp, hand, move, fraction = 0, scale = 1, hidden = []) {
  const named = {
    nose: point(0.5, 0.25),
    leftShoulder: point(0.62, 0.45),
    rightShoulder: point(0.38, 0.45),
    leftElbow: point(0.72, 0.6),
    rightElbow: point(0.28, 0.6),
    leftWrist: point(0.68, 0.5),
    rightWrist: point(0.32, 0.5),
  };
  const sign = hand === 'left' ? 1 : -1;
  if (move === 'straight') named[`${hand}Elbow`].y -= 0.1 * fraction;
  if (move === 'hook') named[`${hand}Wrist`].x -= sign * 0.11 * fraction;
  if (move === 'outwardHook') {
    named[`${hand}Wrist`].x += sign * 0.11 * fraction;
    named[`${hand}Elbow`].x += sign * 0.11 * fraction;
  }
  if (move === 'uppercut') {
    named[`${hand}Wrist`].y -= 0.12 * fraction;
    named[`${hand}Elbow`].y -= 0.1 * fraction;
  }
  if (move === 'bigHook') {
    named[`${hand}Wrist`].x -= sign * 0.2 * fraction;
    named[`${hand}Wrist`].y -= 0.1 * fraction;
    named[`${hand}Elbow`].y -= 0.18 * fraction;
  }
  if (move === 'bigUppercut') {
    named[`${hand}Wrist`].x += sign * 0.04 * fraction;
    named[`${hand}Wrist`].y -= 0.25 * fraction;
    named[`${hand}Elbow`].y -= 0.27 * fraction;
  }
  if (move === 'guard')
    for (const [side, s] of [
      ['left', 1],
      ['right', -1],
    ]) {
      named[`${side}Wrist`].x -= s * 0.11 * fraction;
      named[`${side}Wrist`].y -= 0.2 * fraction;
    }
  const input = Array.from({ length: 33 }, () => ({ ...point(0.5, 0.5), visibility: 0 }));
  for (const [name, p] of Object.entries(named))
    input[POSE_LANDMARKS[name]] = point(0.5 + (p.x - 0.5) * scale, 0.5 + (p.y - 0.5) * scale);
  for (const name of hidden) input[POSE_LANDMARKS[name]].visibility = 0.1;
  return createPoseSample(input, timestamp, 480, 480);
}

test('camera landmark cues classify both hands at 15 and 30Hz across camera distances', () => {
  for (const hand of ['left', 'right'])
    for (const interval of [33, 67])
      for (const scale of [0.7, 1, 1.2])
        for (const move of [
          'straight',
          'hook',
          'outwardHook',
          'uppercut',
          'bigHook',
          'bigUppercut',
        ]) {
          const c = new MotionController();
          for (let t = 0; t <= 3100; t += 50) c.update(pose(t, hand, move, 0, scale));
          const actions = [];
          for (let i = 1; i <= 10; i++) {
            const f = c.update(
              pose(3100 + i * interval, hand, move, Math.min((i * interval) / 100, 1), scale),
            );
            if (f.punch) actions.push({ hand: f.punch, move: f.move });
          }
          const expected =
            move === 'straight'
              ? hand === 'left'
                ? 'jab'
                : 'cross'
              : move === 'bigHook' || move === 'outwardHook'
                ? 'hook'
                : move === 'bigUppercut'
                  ? 'uppercut'
                  : move;
          assert.deepEqual(
            actions,
            [{ hand, move: expected }],
            `${hand} ${move}, ${interval}ms, scale ${scale}`,
          );
        }
});

test('coordinated camera guard raises still block without emitting an uppercut or jab', () => {
  for (const interval of [33, 67]) {
    const c = new MotionController();
    for (let t = 0; t <= 3100; t += 50) c.update(pose(t, 'left', 'guard'));
    let last;
    for (let i = 1; i <= 10; i++) {
      last = c.update(
        pose(3100 + i * interval, 'left', 'guard', Math.min((i * interval) / 100, 1)),
      );
      assert.equal(last.punch, undefined);
    }
    assert.equal(last.guard, true);
  }
});

test('a raised hook wind-up emits no jab, and a return after a pause permits the next hook', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const actions = [];
    const trajectory = [
      [0, 0.7, -0.4, 0.9, 0.2],
      [33, 0.75, -0.4, 0.7, -0.4],
      [67, 0.95, -0.35, 0.8, -0.35],
      [100, 1.05, -0.3, 0.9, -0.3],
      [134, 0.75, -0.3, 0.7, -0.3],
      [167, 0.25, -0.32, 0.4, -0.3],
      [200, 0.25, -0.32, 0.4, -0.3],
      [267, 0.25, -0.32, 0.4, -0.3],
      [334, 0.26, -0.32, 0.4, -0.3],
      [367, 0.6, -0.35, 0.65, -0.35],
      [400, 0.25, -0.32, 0.4, -0.3],
      [467, 0.25, -0.32, 0.4, -0.3],
    ];
    let previous;
    for (const [t, x, y, ex, ey] of trajectory) {
      const wristSpeed = previous
        ? (Math.hypot(x - previous.x, y - previous.y) * 1000) / (t - previous.t)
        : 0;
      const f = features(t, hand, {
        wrist: point(sign * x, y),
        elbow: point(sign * ex, ey),
        imageElbowAngle: t ? 165 : 95,
        elbowAngle: t ? 165 : 95,
        wristSpeed,
        restDistance: Math.hypot(x - 0.65, y - 0.05),
      });
      const result = d.update(f);
      if (result.punch) actions.push({ hand: result.punch, move: result.move });
      previous = { t, x, y };
    }
    assert.deepEqual(actions, [
      { hand, move: 'hook' },
      { hand, move: 'hook' },
    ]);
  }
});

test('large uppercuts from a raised stance override elbow alignment and unreliable angles', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    d.update(
      features(0, hand, {
        wrist: point(sign * 0.7, -0.3, -0.2),
        elbow: point(sign * 0.85, 0.3),
        depthReliable: true,
      }),
    );
    const frame = d.update(
      features(100, hand, {
        wrist: point(sign * 0.78, -1, -0.65),
        elbow: point(sign * 0.8, -0.95),
        imageElbowAngle: 175,
        elbowAngle: 175,
        depthReliable: true,
        wristSpeed: 7,
        restDistance: 0.7,
      }),
    );
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, 'uppercut');
  }
});

test('guard activates within one follow-up camera frame despite noisy elbow angles', () => {
  for (const interval of [33, 67]) {
    const d = new ActionDetector();
    const guard = (t) => {
      const f = features(t, 'left');
      for (const [hand, sign] of [
        ['left', 1],
        ['right', -1],
      ]) {
        f.arms[hand].wrist = point(sign * 0.3, -0.65);
        f.arms[hand].imageElbowAngle = 160;
      }
      return f;
    };
    d.update(guard(0));
    const frame = d.update(guard(interval));
    assert.equal(frame.guard, true);
    assert.equal(frame.punch, undefined);
  }
});

test('large hooks rearm after a genuine return and never during the held follow-through', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const actions = [];
    for (const t of [0, 100, 133, 200, 267, 300, 367]) {
      const resting = t === 0 || t === 300;
      const f = features(
        t,
        hand,
        resting
          ? {}
          : {
              wrist: point(sign * 0.05, 0.1),
              imageElbowAngle: 170,
              elbowAngle: 170,
              wristSpeed: t === 100 || t === 367 ? 6 : 0,
              restDistance: 0.6,
            },
      );
      const result = d.update(f);
      if (result.punch) actions.push({ hand: result.punch, move: result.move });
    }
    assert.deepEqual(actions, [
      { hand, move: 'hook' },
      { hand, move: 'hook' },
    ]);
  }
});

test('a raised outward wind-up can develop into one hook without an early jab', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const actions = [];
    for (const [t, x, y, ex, ey] of [
      [0, 0.7, -0.4, 1.1, 0.4],
      [33, 0.95, -0.4, 1, -0.4],
      [67, 1.05, -0.4, 1.1, -0.3],
      [100, 0.65, -0.45, 0.8, -0.3],
      [134, 0.2, -0.5, 0.4, -0.3],
      [200, 0.2, -0.5, 0.4, -0.3],
      [267, 0.2, -0.5, 0.4, -0.3],
    ]) {
      const f = features(t, hand, {
        wrist: point(sign * x, y),
        elbow: point(sign * ex, ey),
        imageElbowAngle: t ? 165 : 95,
        elbowAngle: t ? 165 : 95,
        restDistance: Math.hypot(x - 0.65, y - 0.05),
      });
      const frame = d.update(f);
      if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
    }
    assert.deepEqual(actions, [{ hand, move: 'hook' }]);
  }
});

test('guard accepts upper chest height immediately and tolerates small wrist jitter', () => {
  const d = new ActionDetector();
  const guard = (t) => {
    const f = features(t, 'left');
    for (const hand of ['left', 'right']) f.arms[hand].wrist.y = 0.18;
    return f;
  };
  assert.equal(d.update(guard(0)).guard, true);
  for (let t = 33; t <= 330; t += 33) {
    const f = guard(t);
    f.arms.left.wrist.y = 0.21 + Math.sin(t) * 0.03;
    assert.equal(d.update(f).guard, true);
  }
  const lowered = features(363, 'left');
  lowered.arms.left.wrist.y = 0.4;
  assert.equal(d.update(lowered).guard, true);
  assert.equal(d.update({ ...lowered, timestamp: 462 }).guard, false);
});

test('tracking and smoothing keep the visible hand responsive when the other wrist is occluded', () => {
  for (const hand of ['left', 'right']) {
    const c = new MotionController(),
      smoother = new PoseSmoother(),
      identity = new ArmIdentityTracker();
    const update = (sample) => c.update(smoother.update(identity.update(sample)));
    for (let t = 0; t <= 3100; t += 50) update(pose(t, hand, 'hook'));
    const other = hand === 'left' ? 'right' : 'left';
    update(pose(3133, hand, 'hook', 0, 1, [`${other}Wrist`]));
    const attack = update(pose(3200, hand, 'hook', 1, 1, [`${other}Wrist`]));
    assert.equal(attack.tracking, 'VALID');
    assert.equal(attack.punch, hand);
    assert.equal(attack.move, 'hook');
    assert.equal(attack.guard, false);
    assert.equal(c.diagnostics().features.arms[other].tracked, false);
  }
});

test('visible wrist hooks and uppercuts do not require a visible elbow', () => {
  for (const hand of ['left', 'right'])
    for (const move of ['hook', 'uppercut']) {
      const c = new MotionController();
      for (let t = 0; t <= 3100; t += 50) c.update(pose(t, hand, move));
      c.update(pose(3133, hand, move, 0, 1, [`${hand}Elbow`]));
      const f = c.update(pose(3200, hand, move, 1, 1, [`${hand}Elbow`]));
      assert.equal(f.punch, hand);
      assert.equal(f.move, move);
    }
});

test('a reappearing wrist is a new tracking anchor and never an invented attack', () => {
  for (const hand of ['left', 'right']) {
    const c = new MotionController(),
      smoother = new PoseSmoother(),
      identity = new ArmIdentityTracker();
    const update = (sample) => c.update(smoother.update(identity.update(sample)));
    for (let t = 0; t <= 3100; t += 50) update(pose(t, hand, 'hook'));
    update(pose(3133, hand, 'hook', 0, 1, [`${hand}Wrist`]));
    for (let t = 3200; t <= 3500; t += 50)
      assert.equal(update(pose(t, hand, 'hook', 1)).punch, undefined);
    assert.equal(c.diagnostics().features.arms[hand].tracked, true);
  }
});

test('after an elbow-led jab settles, a new wrist-led movement is responsive', () => {
  const d = new ActionDetector();
  d.update(features(0, 'left'));
  const extended = { elbow: point(0.7, 0.05), wrist: point(0.7, 0.05) };
  assert.equal(d.update(features(100, 'left', extended)).move, 'jab');
  for (let t = 133; t <= 333; t += 33)
    assert.equal(d.update(features(t, 'left', extended)).punch, undefined);
  const swing = d.update(features(400, 'left', { ...extended, wrist: point(0.2, 0.05) }));
  assert.equal(swing.punch, 'left');
  assert.equal(swing.move, 'hook');
});

test('slow continuous hooks and rises are ignored without relying on a tracking gap', () => {
  for (const hand of ['left', 'right'])
    for (const move of ['hook', 'uppercut']) {
      const sign = hand === 'left' ? 1 : -1;
      const d = new ActionDetector();
      for (let t = 0; t <= 1200; t += 50) {
        const delta = (t / 1200) * 0.6;
        const wrist =
          move === 'hook' ? point(sign * (0.65 - delta), 0.05) : point(sign * 0.65, 0.05 - delta);
        assert.equal(d.update(features(t, hand, { wrist })).punch, undefined);
      }
    }
});

test('calibration accepts an already held comfortable guard after both punch checks', () => {
  const c = new MotionController();
  const comfortable = (t, hand = 'left', fraction = 0) => {
    const s = pose(t, hand, 'straight', fraction);
    for (const side of ['left', 'right']) {
      s.frame.landmarks[`${side}Wrist`].y = 0.49;
      s.aspectLandmarks[`${side}Wrist`].y = 0.49;
    }
    return s;
  };
  for (let t = 0; t <= 3100; t += 50) c.update(comfortable(t));
  assert.equal(c.diagnostics().calibration.nextCheck, 'leftPunch');
  assert.equal(c.update(comfortable(3200, 'left', 1)).punch, 'left');
  for (let t = 3250; t <= 3400; t += 50) c.update(comfortable(t));
  assert.equal(c.update(comfortable(3500, 'right', 1)).punch, 'right');
  assert.equal(c.diagnostics().calibration.nextCheck, 'guard');
  assert.equal(c.update(comfortable(3550, 'right', 1)).guard, true);
  assert.equal(c.diagnostics().calibration.phase, 'ready');
});

test('independent hands can register a straight followed by a hook without a classification wait', () => {
  const d = new ActionDetector();
  d.update(features(0, 'left'));
  const input = (t, hooking = false) => {
    const f = features(t, 'right', {
      wrist: point(-1.75, 0.05),
      imageElbowAngle: 175,
      elbowAngle: 175,
      restDistance: 1.1,
      wristSpeed: 22,
    });
    if (hooking) {
      f.arms.left.wrist = point(-0.1, 0);
      f.arms.left.imageElbowAngle = 170;
      f.arms.left.restDistance = 0.75;
      f.arms.left.wristSpeed = 15;
    }
    return f;
  };
  assert.equal(d.update(input(50)).punch, 'right');
  assert.equal(d.update(input(100)).punch, undefined);
  const frame = d.update(input(167, true));
  assert.equal(frame.punch, 'left');
  assert.equal(frame.move, 'hook');
});
