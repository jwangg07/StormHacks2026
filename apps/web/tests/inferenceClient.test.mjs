import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const sourceUrl = new URL('../src/motion/inferenceClient.ts', import.meta.url);
const source = (await readFile(sourceUrl, 'utf8'))
  .replaceAll('import.meta.env.BASE_URL', "'/'")
  .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { InferenceClient } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

function harness(t, capture) {
  let now = 100;
  class FakeWorker {
    messages = [];
    constructor() {
      this.constructor.instance = this;
    }
    postMessage(message, transfer) {
      this.messages.push({ message, transfer });
    }
    terminate() {
      this.terminated = true;
    }
    deliver(data) {
      this.onmessage?.({ data });
    }
  }
  t.mock.method(globalThis.performance, 'now', () => now);
  for (const [name, value] of Object.entries({
    Worker: FakeWorker,
    window: { location: { origin: 'http://localhost:5173' } },
    createImageBitmap: capture,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  const results = [];
  const errors = [];
  const client = new InferenceClient({
    onLoading() {},
    onReady() {},
    onResult: (result) => results.push(result),
    onError: (error) => errors.push(error),
  });
  t.after(() => client.dispose());
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 1 };
  return {
    client,
    worker: FakeWorker.instance,
    video,
    results,
    errors,
    advance(ms = 40) {
      now += ms;
      video.currentTime += ms / 1000;
    },
  };
}

const flush = () => new Promise((resolve) => globalThis.queueMicrotask(resolve));

test('one frame in flight covers asynchronous capture and worker processing; duplicate frames are skipped', async (t) => {
  let resolveBitmap;
  let captureSize;
  const h = harness(t, (_video, options) => {
    captureSize = options;
    return new Promise((resolve) => {
      resolveBitmap = resolve;
    });
  });
  assert.equal(h.client.capture(h.video), false);
  h.worker.deliver({ type: 'ready' });
  assert.equal(h.client.capture(h.video), true);
  h.advance();
  assert.equal(h.client.capture(h.video), false);
  assert.deepEqual(captureSize, { resizeWidth: 640, resizeHeight: 360 });
  const bitmap = { close() {} };
  resolveBitmap(bitmap);
  await flush();
  assert.equal(h.worker.messages.filter(({ message }) => message.type === 'frame').length, 1);
  assert.deepEqual(h.worker.messages.at(-1).transfer, [bitmap]);
  assert.equal(h.client.capture(h.video), false);
  h.worker.deliver({ type: 'result', sample: { tracking: 'LOST' }, inferenceMs: 10 });
  assert.equal(h.client.capture(h.video), true);
  resolveBitmap(bitmap);
  await flush();
  h.worker.deliver({ type: 'result', sample: { tracking: 'LOST' }, inferenceMs: 12 });
  assert.equal(h.client.capture(h.video), false);
  assert.equal(h.results.length, 2);
});

test('a bitmap resolving after disposal is closed and never sent', async (t) => {
  let resolveBitmap;
  const h = harness(
    t,
    () =>
      new Promise((resolve) => {
        resolveBitmap = resolve;
      }),
  );
  h.worker.deliver({ type: 'ready' });
  h.client.capture(h.video);
  h.client.dispose();
  let closed = false;
  resolveBitmap({
    close() {
      closed = true;
    },
  });
  await flush();
  assert.equal(closed, true);
  assert.equal(
    h.worker.messages.some(({ message }) => message.type === 'frame'),
    false,
  );
  assert.equal(h.worker.messages.at(-1).message.type, 'dispose');
});

test('capture failure disposes the worker and emits one actionable error', async (t) => {
  const h = harness(t, () => Promise.reject(new Error('camera stopped')));
  h.worker.deliver({ type: 'ready' });
  h.client.capture(h.video);
  await flush();
  await flush();
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /Restart the camera/);
  assert.equal(h.worker.messages.at(-1).message.type, 'dispose');
  assert.equal(h.client.capture(h.video), false);
});

test('completion rate measures inference even when no pose is found', async (t) => {
  const h = harness(t, () => Promise.resolve({ close() {} }));
  h.worker.deliver({ type: 'ready' });
  for (let index = 0; index < 5; index++) {
    h.client.capture(h.video);
    await flush();
    h.worker.deliver({ type: 'result', sample: { tracking: 'LOST' }, inferenceMs: 8 });
    h.advance(50);
  }
  assert.equal(h.results.at(-1).inferenceHz, 20);
});

test('local WASM assets match the installed pinned MediaPipe version and model checksum', async () => {
  const packageJson = JSON.parse(
    await readFile(
      new URL('../../../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(packageJson.version, '0.10.35');
  for (const name of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
    const local = await readFile(new URL(`../public/models/wasm/${name}`, import.meta.url));
    const installed = await readFile(
      new URL(`../../../node_modules/@mediapipe/tasks-vision/wasm/${name}`, import.meta.url),
    );
    assert.equal(
      createHash('sha256').update(local).digest('hex'),
      createHash('sha256').update(installed).digest('hex'),
    );
  }
  const model = await readFile(
    new URL('../public/models/pose_landmarker_lite.task', import.meta.url),
  );
  assert.equal(
    createHash('sha256').update(model).digest('hex'),
    '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  );
});
