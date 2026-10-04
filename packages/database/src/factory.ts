import type { DatabaseConfig } from './config';
import { NoopPersistence } from './noop';
import { checkDatabaseConnection, createTigerDataPool } from './pool';
import { TigerDataPersistence } from './tiger-data';
import type { MatchPersistence } from './types';

export interface PersistenceLogger {
  info(message: string): void;
  error(message: string): void;
}

export async function createPersistence(
  config: DatabaseConfig,
  logger: PersistenceLogger = console,
): Promise<MatchPersistence> {
  if (!config.enabled || !config.databaseUrl) {
    logger.info('Tiger Data persistence disabled; using in-memory gameplay only');
    return new NoopPersistence();
  }

  const pool = createTigerDataPool(config);
  try {
    await checkDatabaseConnection(pool);
    logger.info('Tiger Data connected');
    return new TigerDataPersistence(pool);
  } catch {
    await pool.end().catch(() => undefined);
    logger.error('Tiger Data unavailable; gameplay will continue without persistence');
    if (config.required) {
      throw new Error('Required Tiger Data connection is unavailable');
    }
    return new NoopPersistence();
  }
}
