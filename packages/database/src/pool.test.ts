import { describe, expect, it } from 'vitest';
import { normalizeDatabaseUrl } from './pool';

describe('normalizeDatabaseUrl', () => {
  it('uses encrypted libpq-compatible semantics for sslmode=require', () => {
    const normalized = normalizeDatabaseUrl(
      'postgresql://user:password@example.test:5432/database?sslmode=require',
    );
    const url = new URL(normalized);
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('uselibpqcompat')).toBe('true');
  });

  it('does not weaken verify-full', () => {
    const normalized = normalizeDatabaseUrl(
      'postgresql://user:password@example.test:5432/database?sslmode=verify-full',
    );
    expect(new URL(normalized).searchParams.has('uselibpqcompat')).toBe(false);
  });
});
