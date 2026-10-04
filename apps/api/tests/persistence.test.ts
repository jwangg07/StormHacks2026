import { NoopPersistence, type MatchPersistence, type PersistedMatch } from '@wb/database';
import type { GameInput } from '@wb/core';
import { describe, expect, it, vi } from 'vitest';
import { addHealthRoutes } from '../src/http/health';
import { createApiServer } from '../src/server';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PORT: '0',
    WEB_ORIGIN: 'http://localhost:5173',
    PERSISTENCE_FLUSH_INTERVAL_MS: '60000',
    PERSISTENCE_BATCH_SIZE: '100',
    PERSISTENCE_QUEUE_CAPACITY: '10',
    ...overrides,
  };
}

function logger() {
  return { info: vi.fn(), error: vi.fn() };
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

function createMatch(runtime: Awaited<ReturnType<typeof createApiServer>>) {
  return runtime.createMatch({
    id: 'match-1',
    roomId: 'room-1',
    playerASessionId: 'session-a',
    playerBSessionId: 'session-b',
    matchType: 'RANDOM',
    createdAt: 1_000,
  });
}

function input(matchId: string, sequence: number): GameInput {
  return {
    protocolVersion: 1,
    matchId,
    sequence,
    inputId: `input-${sequence}`,
    clientTimestamp: sequence,
    tracking: 'VALID',
    head: { x: 0, y: 0, z: 0 },
    leftHand: { x: 0, y: 0, z: 0 },
    rightHand: { x: 0, y: 0, z: 0 },
    body: { x: 0, z: 0 },
    guard: false,
    duck: false,
  };
}

describe('API persistence integration', () => {
  it('reports API readiness independently of optional persistence', () => {
    const handlers = new Map<string, (request: unknown, response: unknown) => void>();
    const app = {
      get: (path: string, handler: (request: unknown, response: unknown) => void) => {
        handlers.set(path, handler);
      },
    };
    let ready = true;
    addHealthRoutes(app as never, () => ready);
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const handler = handlers.get('/ready');
    handler?.({}, { status, json });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ready' });

    ready = false;
    handler?.({}, { status, json });
    expect(status).toHaveBeenLastCalledWith(503);
    expect(json).toHaveBeenLastCalledWith({ status: 'not_ready' });
  });

  it('starts and reports ready without DATABASE_URL', async () => {
    const runtime = await createApiServer({ environment: environment(), logger: logger() });
    expect(runtime.isReady()).toBe(true);
    await runtime.stop();
  });

  it('starts when optional persistence is unavailable and falls back to no-op', async () => {
    const log = logger();
    const runtime = await createApiServer({
      environment: environment({
        ENABLE_TIGER_DATA: 'true',
        DATABASE_URL: 'postgresql://redacted.invalid/database',
      }),
      logger: log,
      persistenceFactory: async (_config, suppliedLogger) => {
        suppliedLogger.error('Tiger Data unavailable; gameplay will continue without persistence');
        return new NoopPersistence();
      },
    });
    expect(runtime.isReady()).toBe(true);
    expect(log.error).toHaveBeenCalledWith(
      'Tiger Data unavailable; gameplay will continue without persistence',
    );
    await runtime.stop();
  });

  it('only enqueues from gameplay and persists a completed match once', async () => {
    const store = persistence();
    const runtime = await createApiServer({
      environment: environment(),
      logger: logger(),
      persistenceFactory: async () => store,
    });
    const match = createMatch(runtime);

    expect(match.start(2_000)).toBe(true);
    expect(store.saveMatchStarted).not.toHaveBeenCalled();
    expect(match.resolvePunch('A', 'right', 2_100)).toBe('HIT');
    expect(store.saveCombatEvents).not.toHaveBeenCalled();
    expect(match.finish({ reason: 'TIMEOUT', winnerSeat: 'A', draw: false }, 3_000)).toBe(true);
    expect(match.finish({ reason: 'TIMEOUT', winnerSeat: 'A', draw: false }, 3_001)).toBe(false);
    expect(store.saveMatchFinished).not.toHaveBeenCalled();

    await runtime.stop();
    expect(store.saveMatchStarted).toHaveBeenCalledOnce();
    expect(store.saveCombatEvents).toHaveBeenCalledOnce();
    expect(store.saveMatchFinished).toHaveBeenCalledOnce();
    const finished = vi.mocked(store.saveMatchFinished).mock.calls[0]?.[0] as PersistedMatch;
    expect(finished.status).toBe('FINISHED');
    expect(store.close).toHaveBeenCalledOnce();
  });

  it('drops optional sampled movement safely when the bounded queue is full', async () => {
    const store = persistence();
    const runtime = await createApiServer({
      environment: environment({ PERSISTENCE_QUEUE_CAPACITY: '1' }),
      logger: logger(),
      persistenceFactory: async () => store,
    });
    const match = createMatch(runtime);
    match.start(2_000);
    const first = runtime.matchPersistence.recordMovement(
      match.state,
      'session-a',
      'A',
      input(match.state.id, 1),
      2_000,
    );
    const dropped = runtime.matchPersistence.recordMovement(
      match.state,
      'session-b',
      'B',
      input(match.state.id, 1),
      2_000,
    );
    expect(first).toBe(false);
    expect(dropped).toBe(false);
    await runtime.stop();
    expect(store.saveMovementSamples).toHaveBeenCalledWith([]);
  });

  it('graceful shutdown flushes queued match records before closing persistence', async () => {
    const store = persistence();
    const runtime = await createApiServer({
      environment: environment(),
      logger: logger(),
      persistenceFactory: async () => store,
    });
    const match = createMatch(runtime);
    match.start(2_000);
    expect(store.saveMatchStarted).not.toHaveBeenCalled();
    await runtime.stop();
    expect(store.saveMatchStarted).toHaveBeenCalledOnce();
    expect(store.close).toHaveBeenCalledOnce();
    expect(runtime.isReady()).toBe(false);
  });
});
