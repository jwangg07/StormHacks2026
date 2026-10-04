import { describe, expect, it, vi } from 'vitest';
import {
  INVITE_ALPHABET,
  INVITE_TTL_MS,
  InviteService,
  generateInviteCode,
} from '../src/invites/service';

describe('InviteService', () => {
  it('creates unique six-character codes from the unambiguous alphabet', () => {
    const service = new InviteService();
    const codes = new Set<string>();
    for (let index = 0; index < 1_000; index++) {
      const invite = service.create(`creator-${index}`);
      expect(invite.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      codes.add(invite.code);
    }
    expect(codes.size).toBe(1_000);
    expect(INVITE_ALPHABET).toHaveLength(32);
    expect(generateInviteCode()).toHaveLength(6);
  });

  it('expires invites after ten minutes and retains an expiration tombstone', () => {
    const now = vi.fn(() => 1_000);
    const service = new InviteService(now);
    const invite = service.create('creator');
    expect(invite.expiresAt).toBe(1_000 + INVITE_TTL_MS);
    now.mockReturnValue(invite.expiresAt);
    expect(service.lookup(invite.code)).toEqual({ status: 'EXPIRED', invite });
    expect(service.lookup(invite.code)).toEqual({ status: 'EXPIRED' });
  });

  it('allows only one active invite per creator', () => {
    const service = new InviteService();
    expect(service.create('creator')).toBe(service.create('creator'));
  });
});
