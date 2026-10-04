import { describe, expect, it } from 'vitest';
import { MovementSampler } from './movement-sampler';
import type { MovementSample } from './types';

function sample(time: number): MovementSample {
  return {
    time: new Date(time),
    matchId: 'match-1',
    sessionId: 'session-1',
    seat: 'A',
    sequence: time,
  };
}

describe('MovementSampler', () => {
  it('keeps at most about five samples per second per player', () => {
    const sampler = new MovementSampler(5);
    expect(sampler.shouldKeep(sample(0))).toBe(true);
    expect(sampler.shouldKeep(sample(199))).toBe(false);
    expect(sampler.shouldKeep(sample(200))).toBe(true);
  });

  it('releases per-match sampling state', () => {
    const sampler = new MovementSampler(5);
    expect(sampler.shouldKeep(sample(0))).toBe(true);
    sampler.clearMatch('match-1');
    expect(sampler.shouldKeep(sample(1))).toBe(true);
  });
});
