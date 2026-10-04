import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../src/config/env';
import { addVoiceRoutes } from '../src/http/voice';

let server: Server | undefined;

async function startVoiceApi(config: Partial<ApiConfig> = {}) {
  const app = express();
  app.use(express.json());
  addVoiceRoutes(app, {
    port: 3001,
    webOrigin: 'http://localhost:5173',
    elevenLabsApiKey: 'test-key',
    elevenLabsVoiceId: 'test-voice',
    ...config,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server!.close((error) => (error ? reject(error) : resolve())),
  );
  server = undefined;
});

describe('ElevenLabs voice route', () => {
  it('generates only fixed cues, keeps credentials server-side, and caches the clip', async () => {
    const audio = Uint8Array.from([0x49, 0x44, 0x33, 0x01, 0x02]);
    const clientFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain('/v1/text-to-speech/test-voice/stream');
      expect(new Headers(init?.headers).get('xi-api-key')).toBe('test-key');
      expect(JSON.parse(String(init?.body))).toMatchObject({ model_id: 'eleven_multilingual_v2' });
      return new Response(audio, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const baseUrl = await startVoiceApi();

    const requestCue = (cue: string) =>
      clientFetch(`${baseUrl}/voice/cue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cue }),
      });

    const first = await requestCue('cameraOn');
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('audio/mpeg');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(audio);

    const second = await requestCue('cameraOn');
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    const invalid = await requestCue('arbitrary user text');
    expect(invalid.status).toBe(400);
    await invalid.arrayBuffer();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports an unconfigured provider without calling ElevenLabs', async () => {
    const clientFetch = globalThis.fetch;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const baseUrl = await startVoiceApi({ elevenLabsApiKey: '' });
    const response = await clientFetch(`${baseUrl}/voice/cue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cue: 'cameraOn' }),
    });

    expect(response.status).toBe(503);
    await response.arrayBuffer();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
