import { randomBytes, randomUUID } from 'node:crypto';

export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_TTL_MS = 10 * 60 * 1_000;
const TOMBSTONE_TTL_MS = INVITE_TTL_MS;

export interface Invite {
  id: string;
  code: string;
  creatorSessionId: string;
  createdAt: number;
  expiresAt: number;
}

export type InviteLookup =
  | { status: 'ACTIVE'; invite: Invite }
  | { status: 'EXPIRED'; invite?: Invite }
  | { status: 'USED' }
  | { status: 'CREATOR_DISCONNECTED' }
  | { status: 'NOT_FOUND' };

interface Tombstone {
  status: 'EXPIRED' | 'USED' | 'CREATOR_DISCONNECTED';
  deleteAt: number;
}

export function generateInviteCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) code += INVITE_ALPHABET[byte & 31];
  return code;
}

export class InviteService {
  private readonly invitesById = new Map<string, Invite>();
  private readonly invitesByCode = new Map<string, Invite>();
  private readonly inviteIdByCreator = new Map<string, string>();
  private readonly tombstonesByCode = new Map<string, Tombstone>();

  constructor(private readonly now: () => number = Date.now) {}

  create(creatorSessionId: string): Invite {
    const existingId = this.inviteIdByCreator.get(creatorSessionId);
    if (existingId) {
      const existing = this.invitesById.get(existingId);
      if (existing && existing.expiresAt > this.now()) return existing;
      if (existing) this.expire(existing);
    }

    let code: string;
    do code = generateInviteCode();
    while (this.invitesByCode.has(code) || this.tombstonesByCode.has(code));

    const createdAt = this.now();
    const invite: Invite = {
      id: randomUUID(),
      code,
      creatorSessionId,
      createdAt,
      expiresAt: createdAt + INVITE_TTL_MS,
    };
    this.invitesById.set(invite.id, invite);
    this.invitesByCode.set(invite.code, invite);
    this.inviteIdByCreator.set(creatorSessionId, invite.id);
    return invite;
  }

  lookup(code: string): InviteLookup {
    const normalized = code.toUpperCase();
    const invite = this.invitesByCode.get(normalized);
    if (invite) {
      if (invite.expiresAt <= this.now()) {
        this.expire(invite);
        return { status: 'EXPIRED', invite };
      }
      return { status: 'ACTIVE', invite };
    }
    const tombstone = this.tombstonesByCode.get(normalized);
    if (!tombstone) return { status: 'NOT_FOUND' };
    if (tombstone.deleteAt <= this.now()) {
      this.tombstonesByCode.delete(normalized);
      return { status: 'NOT_FOUND' };
    }
    if (tombstone.status === 'USED') return { status: 'USED' };
    if (tombstone.status === 'CREATOR_DISCONNECTED') return { status: 'CREATOR_DISCONNECTED' };
    return { status: 'EXPIRED' };
  }

  consume(invite: Invite): boolean {
    if (this.invitesById.get(invite.id) !== invite) return false;
    this.remove(invite);
    this.tombstonesByCode.set(invite.code, {
      status: 'USED',
      deleteAt: this.now() + TOMBSTONE_TTL_MS,
    });
    return true;
  }

  decline(inviteId: string, creatorSessionId: string): Invite | undefined {
    const invite = this.invitesById.get(inviteId);
    if (!invite || invite.creatorSessionId !== creatorSessionId) return undefined;
    this.remove(invite);
    this.tombstonesByCode.set(invite.code, {
      status: 'USED',
      deleteAt: this.now() + TOMBSTONE_TTL_MS,
    });
    return invite;
  }

  removeForCreator(
    creatorSessionId: string,
    status?: 'USED' | 'CREATOR_DISCONNECTED',
  ): Invite | undefined {
    const inviteId = this.inviteIdByCreator.get(creatorSessionId);
    const invite = inviteId ? this.invitesById.get(inviteId) : undefined;
    if (invite) {
      this.remove(invite);
      if (status)
        this.tombstonesByCode.set(invite.code, {
          status,
          deleteAt: this.now() + TOMBSTONE_TTL_MS,
        });
    }
    return invite;
  }

  cleanupExpired(): Invite[] {
    const now = this.now();
    const expired: Invite[] = [];
    for (const invite of this.invitesById.values()) {
      if (invite.expiresAt <= now) {
        this.expire(invite);
        expired.push(invite);
      }
    }
    for (const [code, tombstone] of this.tombstonesByCode) {
      if (tombstone.deleteAt <= now) this.tombstonesByCode.delete(code);
    }
    return expired;
  }

  private expire(invite: Invite): void {
    this.remove(invite);
    this.tombstonesByCode.set(invite.code, {
      status: 'EXPIRED',
      deleteAt: this.now() + TOMBSTONE_TTL_MS,
    });
  }

  private remove(invite: Invite): void {
    this.invitesById.delete(invite.id);
    this.invitesByCode.delete(invite.code);
    if (this.inviteIdByCreator.get(invite.creatorSessionId) === invite.id)
      this.inviteIdByCreator.delete(invite.creatorSessionId);
  }
}
