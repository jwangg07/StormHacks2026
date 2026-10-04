import { readDatabaseConfig } from '../config';
import { runMigrations } from '../migrate';
import { createTigerDataPool } from '../pool';

function sanitizedError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown database error';
  const code = 'code' in error && typeof error.code === 'string' ? ` [${error.code}]` : '';
  const message = error.message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL]')
    .replace(/password=[^\s]+/gi, 'password=[REDACTED]');
  return `${message}${code}`;
}

const config = readDatabaseConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required to run migrations');

const pool = createTigerDataPool(config);
try {
  await runMigrations(pool);
  console.log('Tiger Data migrations applied');
} catch (error) {
  console.error(`Tiger Data migration failed: ${sanitizedError(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
