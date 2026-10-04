import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { SkinRelay } = await loadTs(new URL('../src/avatar/skinRelay.ts', import.meta.url));
const { addAvatarHandlers } = await loadTs(new URL('../src/avatar/socket.ts', import.meta.url));
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 1]);

test('each seat sees the other seat’s latest skin', () => {
  const relay = new SkinRelay();
  assert.equal(relay.opponentOf('r1', 'A'), null);
  relay.set('r1', 'B', jpeg);
  assert.deepEqual(relay.opponentOf('r1', 'A'), { seat: 'B', jpeg });
  assert.equal(relay.opponentOf('r1', 'B'), null);
  relay.closeRoom('r1');
  assert.equal(relay.opponentOf('r1', 'A'), null);
});

function fakeSocket(data) {
  const handlers = {};
  const emitted = [];
  return {
    data,
    emitted,
    on: (event, handler) => (handlers[event] = handler),
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
    fire: (event, ...args) => handlers[event](...args),
  };
}

test('a valid skin is stored and relayed to the room', () => {
  const relay = new SkinRelay();
  const socket = fakeSocket({ roomId: 'r1', seat: 'A' });
  addAvatarHandlers(socket, relay);
  let ack;
  socket.fire('avatar:skin', { jpeg }, (result) => (ack = result));
  assert.deepEqual(ack, { ok: true });
  assert.deepEqual(socket.emitted, [{ room: 'r1', event: 'avatar:opponentSkin', payload: { seat: 'A', jpeg } }]);
  assert.deepEqual(relay.opponentOf('r1', 'B'), { seat: 'A', jpeg });
});

test('invalid skins and players outside a room are rejected without relaying', () => {
  const relay = new SkinRelay();
  const outside = fakeSocket({});
  addAvatarHandlers(outside, relay);
  let ack;
  outside.fire('avatar:skin', { jpeg }, (result) => (ack = result));
  assert.equal(ack.ok, false);
  assert.equal(ack.error.code, 'NOT_IN_ROOM');
  const inside = fakeSocket({ roomId: 'r1', seat: 'A' });
  addAvatarHandlers(inside, relay);
  inside.fire('avatar:skin', { jpeg: Uint8Array.from([1, 2, 3]) }, (result) => (ack = result));
  assert.equal(ack.error.code, 'INVALID_SKIN');
  assert.equal(ack.error.recoverable, true);
  assert.equal(inside.emitted.length, 0);
  inside.fire('avatar:skin', { jpeg }); // no ack callback must not throw
});

test('a non-function ack is ignored instead of throwing', () => {
  const relay = new SkinRelay();
  const inside = fakeSocket({ roomId: 'r1', seat: 'A' });
  addAvatarHandlers(inside, relay);
  assert.doesNotThrow(() => inside.fire('avatar:skin', { jpeg }, 'x'));
  assert.equal(inside.emitted.length, 1);
  const outside = fakeSocket({});
  addAvatarHandlers(outside, relay);
  assert.doesNotThrow(() => outside.fire('avatar:skin', { jpeg }, {}));
});
