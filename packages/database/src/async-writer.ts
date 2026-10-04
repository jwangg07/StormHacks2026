import type { DatabaseConfig } from './config';
import type { CombatEvent, MatchPersistence, MovementSample, PersistedMatch } from './types';

export interface AsyncWriterLogger {
  error(message: string): void;
}

type QueueItem =
  | { kind: 'match-started'; value: PersistedMatch }
  | { kind: 'combat-event'; value: CombatEvent }
  | { kind: 'movement-sample'; value: MovementSample }
  | { kind: 'match-finished'; value: PersistedMatch; retriesRemaining: number };

export class AsyncPersistenceWriter {
  private queue: QueueItem[] = [];
  private timer?: NodeJS.Timeout;
  private flushing = false;
  private stopped = false;

  constructor(
    private readonly persistence: MatchPersistence,
    private readonly config: DatabaseConfig,
    private readonly logger: AsyncWriterLogger = console,
  ) {}

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
    this.timer.unref();
  }

  enqueueMatchStarted(match: PersistedMatch): boolean {
    return this.enqueue({ kind: 'match-started', value: match }, false);
  }

  enqueueCombatEvent(event: CombatEvent): boolean {
    return this.enqueue({ kind: 'combat-event', value: event }, false);
  }

  enqueueMovementSample(sample: MovementSample): boolean {
    return this.enqueue({ kind: 'movement-sample', value: sample }, true);
  }

  enqueueMatchFinished(match: PersistedMatch): boolean {
    return this.enqueue(
      { kind: 'match-finished', value: match, retriesRemaining: this.config.finalMatchRetries },
      false,
    );
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.config.batchSize);

    const starts = batch.filter((item) => item.kind === 'match-started');
    const combat = batch.filter((item) => item.kind === 'combat-event').map((item) => item.value);
    const movement = batch.filter((item) => item.kind === 'movement-sample').map((item) => item.value);
    const finishes = batch.filter((item) => item.kind === 'match-finished');

    const operations = [
      ...starts.map((item) => this.persistence.saveMatchStarted(item.value)),
      this.persistence.saveCombatEvents(combat),
      this.persistence.saveMovementSamples(movement),
      ...finishes.map((item) => this.saveFinishedWithRetry(item)),
    ];
    const results = await Promise.allSettled(operations);
    if (results.some((result) => result.status === 'rejected')) {
      this.logger.error('Persistence batch failed; gameplay remains available');
    }
    this.flushing = false;

    if (this.queue.length >= this.config.batchSize) void this.flush();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.queue.length > 0) await this.flush();
    await this.persistence.close();
  }

  private enqueue(item: QueueItem, droppable: boolean): boolean {
    if (this.stopped) return false;
    if (this.queue.length >= this.config.queueCapacity) {
      if (droppable) return false;
      const movementIndex = this.queue.findIndex((queued) => queued.kind === 'movement-sample');
      if (movementIndex === -1) return false;
      this.queue.splice(movementIndex, 1);
    }
    this.queue.push(item);
    if (this.queue.length >= this.config.batchSize) void this.flush();
    return true;
  }

  private async saveFinishedWithRetry(
    item: Extract<QueueItem, { kind: 'match-finished' }>,
  ): Promise<void> {
    try {
      await this.persistence.saveMatchFinished(item.value);
    } catch (error) {
      if (item.retriesRemaining > 0) {
        this.queue.push({ ...item, retriesRemaining: item.retriesRemaining - 1 });
        return;
      }
      throw error;
    }
  }
}
