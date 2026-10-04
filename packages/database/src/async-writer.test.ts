import { describe, expect, it, vi } from 'vitest';
import type { DatabaseConfig } from './config';
import { AsyncPersistenceWriter } from './async-writer';
import type { MatchPersistence, PersistedMatch } from './types';

function config(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
  return {
    enabled: true,
    required: false,
    databaseUrl: 'redacted',
    poolMax: 1,
    flushIntervalMs: 1_000,
    batchSize: 100,
    queueCapacity: 10,
    finalMatchRetries: 2,
    ...overrides,
  };
}

function match(): PersistedMatch {
  return {
    id: 'match-1',
    createdAt: new Date(0),
    status: 'FINISHED',
    matchType: 'RANDOM',
    configVersion: 'p0',
  };
}

function persistence(): MatchPersistence {
  return {
    saveMatchStarted: vi.fn(async () => undefined),
    saveCombatEvents: vi.fn(async () => undefined),
    saveMovementSamples: vi.fn(async () => undefined),
    saveMatchFinished: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe('AsyncPersistenceWriter', () => {
  it('flushes final match records outside the gameplay caller', async () => {
    const store = persistence();
    const writer = new AsyncPersistenceWriter(store, config());
    expect(writer.enqueueMatchFinished(match())).toBe(true);
    expect(store.saveMatchFinished).not.toHaveBeenCalled();
    await writer.flush();
    expect(store.saveMatchFinished).toHaveBeenCalledOnce();
  });

  it('drops optional movement before important records under pressure', () => {
    const store = persistence();
    const writer = new AsyncPersistenceWriter(store, config({ queueCapacity: 1 }));
    expect(
      writer.enqueueMovementSample({
        time: new Date(0),
        matchId: 'match-1',
        sessionId: 'session-1',
        seat: 'A',
        sequence: 1,
      }),
    ).toBe(true);
    expect(writer.enqueueMatchFinished(match())).toBe(true);
    expect(writer.pendingCount).toBe(1);
  });

  it('retries final match records with a bounded retry count', async () => {
    const store = persistence();
    vi.mocked(store.saveMatchFinished)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const writer = new AsyncPersistenceWriter(store, config({ finalMatchRetries: 1 }));
    writer.enqueueMatchFinished(match());
    await writer.flush();
    expect(writer.pendingCount).toBe(1);
    await writer.flush();
    expect(store.saveMatchFinished).toHaveBeenCalledTimes(2);
    expect(writer.pendingCount).toBe(0);
  });

  it('still processes a final record when another analytics write fails', async () => {
    const store = persistence();
    vi.mocked(store.saveCombatEvents).mockRejectedValueOnce(new Error('offline'));
    const writer = new AsyncPersistenceWriter(store, config());
    writer.enqueueCombatEvent({
      time: new Date(0),
      eventId: 'event-1',
      matchId: 'match-1',
      eventType: 'HIT',
    });
    writer.enqueueMatchFinished(match());
    await writer.flush();
    expect(store.saveMatchFinished).toHaveBeenCalledOnce();
  });
});
