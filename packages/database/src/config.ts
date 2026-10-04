export interface DatabaseConfig {
  enabled: boolean;
  required: boolean;
  databaseUrl?: string;
  poolMax: number;
  flushIntervalMs: number;
  batchSize: number;
  queueCapacity: number;
  finalMatchRetries: number;
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Expected a boolean environment value');
}

function integerValue(name: string, value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer greater than or equal to ${min}`);
  }
  return parsed;
}

export function readDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const enabled = booleanValue(env.ENABLE_TIGER_DATA, false);
  const required = booleanValue(env.DATABASE_REQUIRED, false);
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;

  if (required && (!enabled || !databaseUrl)) {
    throw new Error('Tiger Data is required but ENABLE_TIGER_DATA or DATABASE_URL is missing');
  }

  return {
    enabled,
    required,
    databaseUrl,
    poolMax: integerValue('DATABASE_POOL_MAX', env.DATABASE_POOL_MAX, 5, 1),
    flushIntervalMs: integerValue(
      'PERSISTENCE_FLUSH_INTERVAL_MS',
      env.PERSISTENCE_FLUSH_INTERVAL_MS,
      1_000,
      50,
    ),
    batchSize: integerValue('PERSISTENCE_BATCH_SIZE', env.PERSISTENCE_BATCH_SIZE, 100, 1),
    queueCapacity: integerValue(
      'PERSISTENCE_QUEUE_CAPACITY',
      env.PERSISTENCE_QUEUE_CAPACITY,
      5_000,
      1,
    ),
    finalMatchRetries: integerValue(
      'PERSISTENCE_FINAL_MATCH_RETRIES',
      env.PERSISTENCE_FINAL_MATCH_RETRIES,
      3,
      0,
    ),
  };
}
