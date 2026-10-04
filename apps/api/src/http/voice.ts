import { COACH_CUES } from '@wb/core';
import type { CoachCueId } from '@wb/core';
import type { Express } from 'express';
import { z } from 'zod';
import type { ApiConfig } from '../config/env';

const cueIds = Object.keys(COACH_CUES) as [CoachCueId, ...CoachCueId[]];
const requestSchema = z.object({ cue: z.enum(cueIds) }).strict();
const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 24;

interface RateWindow {
  startedAt: number;
  requests: number;
}

export function addVoiceRoutes(app: Express, config: ApiConfig) {
  const clips = new Map<CoachCueId, Buffer>();
  const pending = new Map<CoachCueId, Promise<Buffer>>();
  const rateWindows = new Map<string, RateWindow>();

  const clipFor = (cue: CoachCueId) => {
    const cached = clips.get(cue);
    if (cached) return Promise.resolve(cached);
    const underway = pending.get(cue);
    if (underway) return underway;

    const generation = (async () => {
      const endpoint = new URL(
        `/v1/text-to-speech/${encodeURIComponent(config.elevenLabsVoiceId)}/stream`,
        'https://api.elevenlabs.io',
      );
      endpoint.searchParams.set('output_format', OUTPUT_FORMAT);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': config.elevenLabsApiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: COACH_CUES[cue],
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.52,
            similarity_boost: 0.8,
            style: 0.12,
            use_speaker_boost: true,
            speed: 0.96,
          },
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > 4 * 1024 * 1024)
        throw new Error('ElevenLabs audio response had an unexpected size');
      clips.set(cue, bytes);
      return bytes;
    })();
    pending.set(cue, generation);
    void generation.finally(() => pending.delete(cue)).catch(() => undefined);
    return generation;
  };

  app.post('/voice/cue', async (request, response) => {
    const now = Date.now();
    if (rateWindows.size > 2_000) {
      for (const [ip, entry] of rateWindows) {
        if (now - entry.startedAt >= RATE_WINDOW_MS) rateWindows.delete(ip);
      }
    }
    const address = request.ip || request.socket.remoteAddress || 'unknown';
    let window = rateWindows.get(address);
    if (!window || now - window.startedAt >= RATE_WINDOW_MS) {
      window = { startedAt: now, requests: 0 };
      rateWindows.set(address, window);
    }
    if (window.requests >= RATE_LIMIT) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'Voice cue limit reached. Try again shortly.' });
      return;
    }
    window.requests++;

    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Unknown coach cue.' });
      return;
    }
    if (!config.elevenLabsApiKey || !config.elevenLabsVoiceId) {
      response.status(503).json({ error: 'Voice coach is not configured.' });
      return;
    }

    try {
      const bytes = await clipFor(parsed.data.cue);
      response
        .status(200)
        .set({
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'private, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        })
        .send(bytes);
    } catch {
      response.status(502).json({ error: 'Voice generation is temporarily unavailable.' });
    }
  });
}
