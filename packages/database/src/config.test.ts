import { describe, expect, it } from 'vitest';
import { readDatabaseConfig } from './config';

describe('readDatabaseConfig', () => {
  it('defaults to optional disabled persistence', () => {
    const config = readDatabaseConfig({});
    expect(config.enabled).toBe(false);
    expect(config.required).toBe(false);
    expect(config.databaseUrl).toBeUndefined();
  });

  it('rejects required persistence without a connection URL', () => {
    expect(() =>
      readDatabaseConfig({ ENABLE_TIGER_DATA: 'true', DATABASE_REQUIRED: 'true' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('never includes the connection string in validation errors', () => {
    const secret = 'postgresql://secret:password@example.test/db';
    expect(() =>
      readDatabaseConfig({
        ENABLE_TIGER_DATA: 'true',
        DATABASE_URL: secret,
        DATABASE_POOL_MAX: '0',
      }),
    ).toThrow('DATABASE_POOL_MAX');
  });
});
