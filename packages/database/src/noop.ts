import type { MatchPersistence } from './types';

export class NoopPersistence implements MatchPersistence {
  async saveMatchStarted(): Promise<void> {}
  async saveCombatEvents(): Promise<void> {}
  async saveMovementSamples(): Promise<void> {}
  async saveMatchFinished(): Promise<void> {}
  async close(): Promise<void> {}
}
