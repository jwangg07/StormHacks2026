import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { avatarSkinSchema, AVATAR_SKIN_MAX_BYTES } = await loadTs(new URL('../src/protocol.ts', import.meta.url));
const jpeg = (size) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};

test('accepts a JPEG up to the size limit', () => {
  assert.ok(avatarSkinSchema.safeParse({ jpeg: jpeg(AVATAR_SKIN_MAX_BYTES) }).success);
});

test('rejects oversized, non-JPEG, empty and non-binary skins', () => {
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: jpeg(AVATAR_SKIN_MAX_BYTES + 1) }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: new Uint8Array(0) }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: 'ffd8ff' }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: jpeg(10), extra: true }).success);
});
