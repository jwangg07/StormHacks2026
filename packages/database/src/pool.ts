import { Pool } from 'pg';
import type { DatabaseConfig } from './config';

export function normalizeDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.searchParams.get('sslmode') === 'require') {
    url.searchParams.set('uselibpqcompat', 'true');
  }
  return url.toString();
}

export function createTigerDataPool(config: DatabaseConfig): Pool {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required to create a Tiger Data pool');
  }

  return new Pool({
    connectionString: normalizeDatabaseUrl(config.databaseUrl),
    max: config.poolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'webcamboxer-api',
  });
}

export async function checkDatabaseConnection(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
