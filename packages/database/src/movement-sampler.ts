import type { MovementSample } from './types';

export class MovementSampler {
  private readonly lastSampleAt = new Map<string, number>();
  private readonly intervalMs: number;

  constructor(samplesPerSecond = 5) {
    if (!Number.isFinite(samplesPerSecond) || samplesPerSecond <= 0) {
      throw new Error('samplesPerSecond must be a positive finite number');
    }
    this.intervalMs = 1_000 / samplesPerSecond;
  }

  shouldKeep(sample: MovementSample): boolean {
    const timestamp = sample.time.getTime();
    if (!Number.isFinite(timestamp)) return false;
    const key = `${sample.matchId}:${sample.sessionId}`;
    const previous = this.lastSampleAt.get(key);
    if (previous !== undefined && timestamp - previous < this.intervalMs) return false;
    this.lastSampleAt.set(key, timestamp);
    return true;
  }

  clearMatch(matchId: string): void {
    const prefix = `${matchId}:`;
    for (const key of this.lastSampleAt.keys()) {
      if (key.startsWith(prefix)) this.lastSampleAt.delete(key);
    }
  }
}
