import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMotion } from './loadMotion.mjs';

const { ActionDetector, MIN_PUNCH_SPEED, PUNCH_COOLDOWN_MS } = await loadMotion('detectors');
const { MotionController } = await loadMotion('controller');
const { createPoseSample, POSE_LANDMARKS } = await loadMotion('pose');
const point = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
function features(timestamp, left = {}, right = {}) {
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
      right: { ...arm, wrist: point(-0.65, 0.3), shoulder: point(-0.5, 0), ...right },
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

test('compact camera jabs accept partial elbow alignment from chest and comfortable guard', () => {
  for (const hand of ['left', 'right'])
    for (const height of [0.3, -0.25])
      for (const sensitivity of [0.7, 1, 1.3]) {
        const sign = hand === 'left' ? 1 : -1;
        const d = new ActionDetector(sensitivity);
        const start = {
          elbow: point(sign * 0.9, height + 0.37),
          wrist: point(sign * 0.65, height),
          projectedForearm: 0.4,
        };
        d.update(features(0, hand === 'left' ? start : {}, hand === 'right' ? start : {}));
        const end = {
          ...start,
          elbow: point(sign * 0.85, height + 0.2),
          wrist: point(sign * 0.66, height - 0.03),
        };
        const frame = d.update(
          features(100, hand === 'left' ? end : {}, hand === 'right' ? end : {}),
        );
        assert.equal(frame.punch, hand, `${hand}, height ${height}, sensitivity ${sensitivity}`);
        assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
        for (let t = 150; t <= 350; t += 50)
          assert.equal(
            d.update(features(t, hand === 'left' ? start : {}, hand === 'right' ? start : {}))
              .punch,
            undefined,
            'recoil never becomes another attack',
          );
      }
});

test('moderate compact elbow extensions respond while genuinely slow ones remain idle', () => {
  for (const hand of ['left', 'right'])
    for (const duration of [150, 450]) {
      const sign = hand === 'left' ? 1 : -1;
      const d = new ActionDetector();
      const actions = [];
      for (let t = 0; t <= duration; t += 50) {
        const fraction = t / duration;
        const arm = {
          elbow: point(sign * (0.9 - fraction * 0.05), 0.67 - fraction * 0.17),
          wrist: point(sign * 0.65, 0.3),
          projectedForearm: 0.4,
        };
        const frame = d.update(
          features(t, hand === 'left' ? arm : {}, hand === 'right' ? arm : {}),
        );
        if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
      }
      assert.deepEqual(
        actions,
        duration === 150 ? [{ hand, move: hand === 'left' ? 'jab' : 'cross' }] : [],
      );
    }
});

test('forward foreshortening with a moving elbow does not require visible wrist travel', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const start = { elbow: point(sign * 0.8, 0.9), projectedForearm: 0.6 };
    d.update(features(0, hand === 'left' ? start : {}, hand === 'right' ? start : {}));
    const end = { ...start, elbow: point(sign * 0.8, 0.7), projectedForearm: 0.53 };
    const frame = d.update(features(100, hand === 'left' ? end : {}, hand === 'right' ? end : {}));
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
    assert.equal(
      d.update(features(150, hand === 'left' ? start : {}, hand === 'right' ? start : {})).punch,
      undefined,
    );
  }
});

test('short outward straights require actual elbow extension rather than an angle label alone', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const start = { elbow: point(sign * 0.8, 0.6) };
    d.update(features(0, hand === 'left' ? start : {}, hand === 'right' ? start : {}));
    const end = { elbow: point(sign * 0.85, 0.32), wrist: point(sign * 0.87, 0.3), imageElbowAngle: 145, elbowAngle: 145, projectedForearm: 0.2 };
    const frame = d.update(features(100, hand === 'left' ? end : {}, hand === 'right' ? end : {}));
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
  }
});
function confirmPunch(detector, input) {
  const frame = detector.update(input);
  return frame.punch ? frame : detector.update({ ...input, timestamp: input.timestamp + 50 });
}

test('fast straight punches that recoil before confirmation still register once for either hand', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    const attack = { ...punch, wrist: point(hand === 'left' ? 1.15 : -1.15, 0.3) };
    const actions = [];
    for (const t of [0, 33, 66, 99, 132, 165, 198]) {
      const frame = d.update(
        features(
          t,
          hand === 'left' && t === 33 ? attack : {},
          hand === 'right' && t === 33 ? attack : {},
        ),
      );
      if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
    }
    assert.deepEqual(actions, [{ hand, move: hand === 'left' ? 'jab' : 'cross' }]);
  }
});

test('camera-directed straights register symmetrically despite shrinking image reach', () => {
  for (const hand of ['left', 'right']) {
    const sign = hand === 'left' ? 1 : -1;
    const d = new ActionDetector();
    const start = {
      elbow: point(sign * 0.9, 0.6),
      wrist: point(sign * 1.05, 0.3),
      reach: 0.63,
      projectedForearm: 0.39,
    };
    d.update(features(0, hand === 'left' ? start : {}, hand === 'right' ? start : {}));
    const attack = {
      ...start,
      elbow: point(sign * 0.78, 0.4),
      wrist: point(sign * 0.99, 0.3),
      reach: 0.45,
      projectedForearm: 0.12,
      restDistance: 0.06,
    };
    const frame = confirmPunch(
      d,
      features(67, hand === 'left' ? attack : {}, hand === 'right' ? attack : {}),
    );
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
  }
});

test('rising extension punches need not lock the elbow to 150 degrees', () => {
  const d = new ActionDetector();
  d.update(features(0));
  const frame = d.update(features(150, punch));
  assert.equal(frame.punch, 'left');
  assert.equal(frame.move, 'jab');
});

test('fast wrist strikes register for both hands despite flat elbow and depth estimates', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    const sign = hand === 'left' ? 1 : -1;
    const rest = { elbowAngle: 170, imageElbowAngle: 170 };
    d.update(features(0, rest, rest));
    const attack = { ...rest, wrist: point(sign * 0.95, 0.3), reach: 0.54, restDistance: 0.3 };
    const frame = d.update(
      features(100, hand === 'left' ? attack : rest, hand === 'right' ? attack : rest),
    );
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
  }
});

test('the faster hand wins even when the other hand has much larger elbow extension', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    d.update(features(0));
    const sign = hand === 'left' ? 1 : -1;
    const fast = {
      wrist: point(sign * 1.05, 0.3),
      reach: 0.63,
      restDistance: 0.4,
      elbowAngle: 135,
      imageElbowAngle: 135,
    };
    const noisy = {
      wrist: point(-sign * 0.88, 0.3),
      reach: 0.48,
      restDistance: 0.23,
      elbowAngle: 175,
      imageElbowAngle: 175,
    };
    const frame = d.update(
      features(100, hand === 'left' ? fast : noisy, hand === 'right' ? fast : noisy),
    );
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
  }
});

test('the opposite hand can strike during the first hand recovery without replaying recoil', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(confirmPunch(d, features(67, punch)).punch, 'left');
  d.update(features(117, punch));
  const right = { ...punch, wrist: point(-1.15, 0.3) };
  const combo = d.update(features(267, punch, right));
  assert.equal(combo.punch, 'right');
  assert.equal(combo.move, 'cross');
  assert.equal(d.update(features(317)).punch, undefined, 'return stroke is not a new attack');
});

test('forward camera punches can use a fast elbow and shrinking forearm when world depth is missing', () => {
  const d = new ActionDetector();
  d.update(features(0, { elbow: point(0.9, 0.6), projectedForearm: 0.39 }));
  const frame = confirmPunch(
    d,
    features(67, {
      elbow: point(0.75, 0.4),
      wrist: point(0.7, 0.3),
      projectedForearm: 0.12,
      elbowAngle: 95,
      imageElbowAngle: 95,
      reach: 0.3,
      restDistance: 0.04,
    }),
  );
  assert.equal(frame.punch, 'left');
  assert.equal(frame.move, 'jab');
});

test('a horizontal bent-arm movement identifies a hook instead of defaulting to a jab', () => {
  const d = new ActionDetector();
  d.update(features(0));
  const attack = {
    wrist: point(0.89, 0.3),
    elbowAngle: 111,
    imageElbowAngle: 111,
    reach: 0.48,
    restDistance: 0.24,
  };
  assert.equal(d.update(features(33, attack)).move, 'hook');
  const frame = d.update(features(66, attack));
  assert.equal(frame.punch, undefined);
  assert.equal(d.update(features(99, attack)).punch, undefined);
});

test('a bent horizontal sweep remains a hook despite a conflicting world elbow estimate', () => {
  const d = new ActionDetector();
  d.update(features(0, { depthReliable: true }));
  assert.equal(
    confirmPunch(
      d,
      features(67, {
        wrist: point(0.95, 0.3),
        depthReliable: true,
        elbowAngle: 103,
        imageElbowAngle: 116,
        reach: 0.45,
        restDistance: 0.24,
      }),
    ).move,
    'hook',
  );
});

test('slow extensions below the velocity boundary never become jabs', () => {
  for (const sensitivity of [0.7, 1, 1.3]) {
    const d = new ActionDetector(sensitivity);
    for (let t = 0; t <= 1200; t += 50) {
      const fraction = t / 1200;
      const frame = d.update(
        features(t, {
          wrist: point(0.65 + fraction * 0.6, 0.3),
          elbowAngle: 95 + fraction * 80,
          imageElbowAngle: 95 + fraction * 80,
          reach: 0.3 + fraction * 0.6,
          restDistance: fraction * 0.6,
        }),
      );
      assert.equal(frame.punch, undefined, 'large but slow extension is not a strike');
    }
  }
  assert.ok(MIN_PUNCH_SPEED > 0.6, 'onset rejects deliberate slow movements');
});

test('lowering a held block is not a punch even when fast and the elbows open', () => {
  for (const duration of [67, 150, 300, 600]) {
    const d = new ActionDetector();
    const guard = (sign) => ({ wrist: point(sign * 0.35, -0.8), reach: 0.82, restDistance: 1.1 });
    for (let t = 0; t <= 200; t += 50) d.update(features(t, guard(1), guard(-1)));
    const steps = Math.ceil(duration / 33);
    for (let i = 1; i <= steps; i++) {
      const fraction = i / steps;
      const lower = (sign) => ({
        wrist: point(sign * (0.35 + fraction * 0.35), -0.8 + fraction * 2),
        elbowAngle: 95 + fraction * 75,
        imageElbowAngle: 95 + fraction * 75,
        reach: Math.hypot(-0.15 + fraction * 0.35, -0.8 + fraction * 2),
        restDistance: Math.hypot(-0.3 + fraction * 0.35, -1.1 + fraction * 2),
      });
      assert.equal(
        d.update(features(200 + duration * fraction, lower(1), lower(-1))).punch,
        undefined,
      );
    }
  }
});

test('a jab can rearm and register again after the shorter cooldown', () => {
  const d = new ActionDetector();
  d.update(features(0));
  assert.equal(d.update(features(100, punch)).punch, 'left');
  for (let t = 117; t < 100 + PUNCH_COOLDOWN_MS; t += 33) d.update(features(t));
  const frame = confirmPunch(d, features(100 + PUNCH_COOLDOWN_MS, punch));
  assert.equal(frame.punch, 'left');
  assert.equal(frame.move, 'jab');
});

test('repeated same-hand attacks at five per second do not need a stationary reset', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    const sign = hand === 'left' ? 1 : -1;
    d.update(features(0));
    const actions = [];
    for (let t = 33; t <= 1188; t += 33) {
      const phase = t % 198;
      const attacking = phase === 33 || phase === 66;
      const arm = attacking
        ? { ...punch, wrist: point(sign * 1.15, 0.3), wristSpeed: 5 }
        : { wrist: point(sign * 0.8, 0.3), reach: 0.42, restDistance: 0.15, wristSpeed: 5 };
      const frame = d.update(features(t, hand === 'left' ? arm : {}, hand === 'right' ? arm : {}));
      if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
    }
    assert.deepEqual(
      actions,
      Array.from({ length: 6 }, () => ({ hand, move: hand === 'left' ? 'jab' : 'cross' })),
    );
  }
});

test('alternating attacks ninety-nine milliseconds apart are captured during the other hand recovery', () => {
  const d = new ActionDetector();
  d.update(features(0));
  const actions = [];
  for (let t = 33; t <= 990; t += 33) {
    const index = Math.floor((t - 33) / 99),
      phase = (t - 33) % 99;
    const hand = index % 2 ? 'right' : 'left';
    const attack = { ...punch, wrist: point(hand === 'left' ? 1.15 : -1.15, 0.3), wristSpeed: 5 };
    const rest = { wristSpeed: 5 };
    const frame = d.update(
      features(
        t,
        phase < 66 && hand === 'left' ? attack : rest,
        phase < 66 && hand === 'right' ? attack : rest,
      ),
    );
    if (frame.punch) actions.push(frame.punch);
  }
  assert.deepEqual(
    actions,
    Array.from({ length: 10 }, (_, i) => (i % 2 ? 'right' : 'left')),
  );
});

test('old fast movement cannot register after the wrist has stopped', () => {
  const d = new ActionDetector();
  d.update(features(0));
  // Travel first, then a delayed/noisy elbow estimate changes on a stationary wrist.
  const reached = {
    wrist: point(0.8, 0.6),
    reach: 0.67,
    restDistance: 0.34,
    elbowAngle: 95,
    imageElbowAngle: 95,
  };
  assert.equal(d.update(features(67, reached)).punch, undefined);
  assert.equal(
    d.update(features(100, { ...reached, elbowAngle: 135, imageElbowAngle: 135 })).punch,
    undefined,
  );
});

test('short forward jabs register with a fast depth push and independent foreshortening', () => {
  const d = new ActionDetector();
  d.update(features(0, { depthReliable: true, worldReach: 0.6, wrist: point(0.65, 0.3, -0.2) }));
  const frame = confirmPunch(
    d,
    features(67, {
      depthReliable: true,
      worldReach: 0.7,
      wrist: point(0.65, 0.3, -0.41),
      elbowAngle: 111,
      imageElbowAngle: 80,
      projectedForearm: 0.53,
      reach: 0.3,
      restDistance: 0,
    }),
  );
  assert.equal(frame.punch, 'left');
  assert.equal(frame.move, 'jab');
});
test('each anatomical hand wins over opposite shoulder sway and noisy elbow extension', () => {
  for (const hand of ['left', 'right']) {
    const d = new ActionDetector();
    d.update(features(0));
    const sign = hand === 'left' ? 1 : -1;
    const active = { ...punch, wrist: point(sign * 1.15, 0.3) };
    const opposite = {
      wrist: point(-sign * 0.15, 0.3),
      shoulder: point(-sign * 0.1, 0),
      elbowAngle: 175,
      imageElbowAngle: 175,
      reach: 0.7,
      restDistance: 0.7,
    };
    const frame = d.update(
      features(150, hand === 'left' ? active : opposite, hand === 'right' ? active : opposite),
    );
    assert.equal(frame.punch, hand);
    assert.equal(frame.move, hand === 'left' ? 'jab' : 'cross');
  }
});
test('moving both shoulders and wrists together cannot become a punch', () => {
  const d = new ActionDetector();
  d.update(features(0));
  const shifted = (sign) => ({
    shoulder: point(sign * 0.5, 0.55),
    wrist: point(sign * 0.65, 0.85),
    elbowAngle: 145,
    imageElbowAngle: 145,
    reach: 0.7,
    restDistance: 0.6,
  });
  assert.equal(d.update(features(150, shifted(1), shifted(-1))).punch, undefined);
});
test('returning to face-level guard rearms after a punch', () => {
  const d = new ActionDetector();
  d.update(features(0));
  d.update(features(100, { ...punch, elbowAngle: 175, imageElbowAngle: 175 }));
  for (let t = 150; t <= 600; t += 50)
    d.update(features(t, { wrist: point(0.35, -0.8), restDistance: 1.05 }));
  assert.equal(
    confirmPunch(
      d,
      features(800, { ...punch, wrist: point(1.15, -0.5), elbowAngle: 175, imageElbowAngle: 175 }),
    ).punch,
    'left',
  );
});
test('recoil does not attack and a brief recovery allows a deliberate new punch', () => {
  const d = new ActionDetector();
  const extended = { ...punch, elbowAngle: 175, imageElbowAngle: 175, restDistance: 1 };
  d.update(features(0));
  assert.equal(d.update(features(100, extended)).punch, 'left');
  for (let t = 150; t <= 600; t += 50)
    assert.equal(d.update(features(t, extended)).punch, undefined);
  d.update(features(650));
  d.update(features(700));
  assert.equal(d.update(features(750, extended)).punch, 'left');
  for (let t = 800; t <= 1100; t += 50) d.update(features(t));
  assert.equal(d.update(features(1250, extended)).punch, 'left');
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
  assert.equal(d.update(features(150, end)).punch, 'left');
  for (let t = 250; t <= 900; t += 50) assert.equal(d.update(features(t, end)).punch, undefined);
});

test('short wrist fidgets are not jabs at any supported sensitivity', () => {
  for (const hand of ['left', 'right'])
    for (const sensitivity of [0.7, 1, 1.3]) {
      for (const [travel, elapsed] of [
        [0.12, 120],
        [0.12, 33],
        [0.12, 67],
      ]) {
        const sign = hand === 'left' ? 1 : -1;
        const d = new ActionDetector(sensitivity);
        d.update(features(0));
        const arm = {
          wrist: point(sign * (0.65 + travel), 0.3),
          reach: 0.3 + travel * 0.7,
          restDistance: travel,
          imageElbowAngle: 175,
          elbowAngle: 175,
        };
        for (const t of [elapsed, elapsed + 33, elapsed + 66, elapsed + 99]) {
          assert.equal(
            d.update(features(t, hand === 'left' ? arm : {}, hand === 'right' ? arm : {})).punch,
            undefined,
            `${hand}, travel ${travel}, elapsed ${elapsed}, sensitivity ${sensitivity}`,
          );
        }
      }
    }
});

test('moderate forward pushes with visible foreshortening respond without a delayed label', () => {
  for (const hand of ['left', 'right'])
    for (const depth of [true, false]) {
      const sign = hand === 'left' ? 1 : -1;
      const d = new ActionDetector();
      const start = {
        depthReliable: depth,
        wrist: point(sign * 0.65, 0.3, -0.2),
        elbow: point(sign * 0.9, 0.6),
        projectedForearm: 0.39,
      };
      d.update(features(0, hand === 'left' ? start : {}, hand === 'right' ? start : {}));
      const end = {
        ...start,
        wrist: point(sign * 0.7, 0.3, depth ? -0.45 : -0.2),
        elbow: point(sign * 0.75, 0.4),
        projectedForearm: 0.12,
        restDistance: 0.05,
      };
      for (const t of [100, 133, 166, 199])
        assert.equal(
          d.update(features(t, hand === 'left' ? end : {}, hand === 'right' ? end : {})).punch,
          t === 100 ? hand : undefined,
        );
    }
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

test('compact landmark jabs with imperfect alignment survive normalization at both camera rates', () => {
  const compactPose = (t, fraction, hand, scale) => {
    const s = pose(t, 0, hand, false);
    const sign = hand === 'left' ? 1 : -1;
    s.frame.landmarks[`${hand}Elbow`] = point(
      0.5 + sign * (0.26 + fraction * 0.035),
      0.6 - fraction * 0.05,
    );
    s.frame.landmarks[`${hand}Wrist`] = point(0.5 + sign * 0.16, 0.52 - fraction * 0.025);
    const input = Array.from({ length: 33 }, () => point(0.5, 0.5, 0));
    for (const [name, p] of Object.entries(s.frame.landmarks))
      input[POSE_LANDMARKS[name]] = point(0.5 + (p.x - 0.5) * scale, 0.5 + (p.y - 0.5) * scale);
    return createPoseSample(input, t, 480, 480);
  };
  for (const hand of ['left', 'right'])
    for (const interval of [33, 67])
      for (const scale of [0.7, 1, 1.2]) {
        const c = new MotionController();
        for (let t = 0; t <= 3100; t += 50) c.update(compactPose(t, 0, hand, scale));
        const actions = [];
        for (let i = 1; i <= 15; i++) {
          const fraction = i <= 8 ? Math.min(1, (i * interval) / 150) : 0;
          const f = c.update(compactPose(3100 + i * interval, fraction, hand, scale));
          if (f.punch) actions.push({ hand: f.punch, move: f.move });
        }
        assert.deepEqual(
          actions,
          [{ hand, move: hand === 'left' ? 'jab' : 'cross' }],
          `${hand}, interval ${interval}, scale ${scale}`,
        );
      }
});
test('front-camera landmark trajectories detect each hand at 15Hz through normalization', () => {
  for (const hand of ['left', 'right']) {
    const c = new MotionController();
    c.startCalibration();
    for (let t = 0; t <= 3100; t += 50) c.update(pose(t));
    assert.equal(c.diagnostics().calibration.phase, 'checks');
    const actions = [];
    for (let i = 1; i <= 7; i++) {
      const frame = c.update(pose(3100 + i * 67, Math.min(1, i / 3), hand));
      if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
    }
    assert.deepEqual(actions, [{ hand, move: hand === 'left' ? 'jab' : 'cross' }]);
  }
});

test('a single-frame camera jab and immediate recoil survive normalization for both hands', () => {
  for (const hand of ['left', 'right'])
    for (const includeWorld of [false, true]) {
      const c = new MotionController();
      c.startCalibration();
      for (let t = 0; t <= 3100; t += 50) c.update(pose(t, 0, hand, includeWorld));
      const actions = [];
      for (let i = 1; i <= 7; i++) {
        const frame = c.update(pose(3100 + i * 67, i === 1 ? 1 : 0, hand, includeWorld));
        if (frame.punch) actions.push({ hand: frame.punch, move: frame.move });
      }
      assert.deepEqual(
        actions,
        [{ hand, move: hand === 'left' ? 'jab' : 'cross' }],
        `${hand}, world ${includeWorld}`,
      );
    }
});

test('camera-directed repeated attacks survive normalization at fifteen samples per second', () => {
  for (const hand of ['left', 'right'])
    for (const includeWorld of [false, true]) {
      const c = new MotionController();
      c.startCalibration();
      for (let t = 0; t <= 3100; t += 50) c.update(pose(t, 0, hand, includeWorld));
      const actions = [];
      for (let i = 1; i <= 18; i++) {
        const frame = c.update(pose(3100 + i * 67, i % 3 === 1 ? 1 : 0, hand, includeWorld));
        if (frame.punch) actions.push(frame.punch);
      }
      assert.deepEqual(actions, Array(6).fill(hand), `${hand}, world ${includeWorld}`);
    }
});
