import { useCallback, useEffect, useRef, useState } from 'react';
import { COACH_CUES } from '@wb/core';
import type { CoachCueId } from '@wb/core';

const ENABLED_KEY = 'webcam-boxer.voice-coach-enabled';
const MAX_QUEUE = 2;

export type CoachChannel = 'calibration' | 'fight';
export type CoachVoiceStatus = 'ready' | 'loading' | 'speaking' | 'muted' | 'locked' | 'offline';

interface QueuedCue {
  id: CoachCueId;
  channel: CoachChannel;
  priority: number;
  generation: number;
}

interface ActiveSpeech extends QueuedCue {
  source: AudioBufferSourceNode;
}

export interface CoachVoice {
  enabled: boolean;
  status: CoachVoiceStatus;
  caption: string | null;
  toggle: () => void;
  speak: (cue: CoachCueId, channel: CoachChannel, priority?: number) => void;
  cancel: (channel: CoachChannel) => void;
}

function readPreference() {
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

const voiceUrl = () => {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  return apiUrl ? new URL('/voice/cue', apiUrl).toString() : '/voice/cue';
};

export function useCoachVoice(): CoachVoice {
  const [enabled, setEnabled] = useState(readPreference);
  const [status, setStatus] = useState<CoachVoiceStatus>('ready');
  const [caption, setCaption] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  const statusRef = useRef(status);
  const contextRef = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<CoachCueId, Promise<AudioBuffer>>());
  const queue = useRef<QueuedCue[]>([]);
  const active = useRef<ActiveSpeech | null>(null);
  const generations = useRef<Record<CoachChannel, number>>({ calibration: 0, fight: 0 });
  const draining = useRef(false);
  const drainRef = useRef<() => void>(() => undefined);

  const updateStatus = useCallback((next: CoachVoiceStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const canContinueDraining = useCallback(() => {
    const currentStatus: CoachVoiceStatus = statusRef.current;
    return currentStatus !== 'locked' && currentStatus !== 'offline';
  }, []);

  const getContext = useCallback(() => {
    if (contextRef.current?.state === 'closed') contextRef.current = null;
    if (!contextRef.current) {
      const AudioContextConstructor = window.AudioContext;
      contextRef.current = new AudioContextConstructor();
    }
    return contextRef.current;
  }, []);

  const loadBuffer = useCallback(
    (cue: CoachCueId) => {
      const existing = buffers.current.get(cue);
      if (existing) return existing;
      const loading = (async () => {
        const response = await fetch(voiceUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cue }),
        });
        if (!response.ok) throw new Error(response.status === 503 ? 'offline' : 'generation');
        const audioContext = getContext();
        return audioContext.decodeAudioData(await response.arrayBuffer());
      })();
      buffers.current.set(cue, loading);
      void loading.catch(() => buffers.current.delete(cue));
      return loading;
    },
    [getContext],
  );

  const drain = useCallback(async () => {
    if (draining.current || active.current || !enabledRef.current || !queue.current.length) return;
    if (statusRef.current === 'offline' || statusRef.current === 'locked') return;
    draining.current = true;
    const item = queue.current.shift()!;
    try {
      updateStatus('loading');
      const buffer = await loadBuffer(item.id);
      if (!enabledRef.current || item.generation !== generations.current[item.channel]) return;
      const audioContext = getContext();
      const resumed = audioContext.resume().catch(() => undefined);
      await Promise.race([resumed, new Promise((resolve) => window.setTimeout(resolve, 350))]);
      if (audioContext.state !== 'running') {
        queue.current.unshift(item);
        updateStatus('locked');
        return;
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (active.current?.source !== source) return;
        active.current = null;
        setCaption(null);
        updateStatus('ready');
        drainRef.current();
      };
      active.current = { ...item, source };
      setCaption(COACH_CUES[item.id]);
      updateStatus('speaking');
      source.start();
    } catch {
      queue.current = queue.current.filter((queued) => queued.priority > 0);
      updateStatus('offline');
    } finally {
      draining.current = false;
      if (!active.current && queue.current.length && enabledRef.current && canContinueDraining())
        window.setTimeout(() => drainRef.current(), 0);
    }
  }, [canContinueDraining, getContext, loadBuffer, updateStatus]);

  useEffect(() => {
    drainRef.current = () => void drain();
    drainRef.current();
    return () => {
      drainRef.current = () => undefined;
    };
  }, [drain]);

  const speak = useCallback(
    (cue: CoachCueId, channel: CoachChannel, priority = channel === 'fight' ? 1 : 0) => {
      if (!enabledRef.current || statusRef.current === 'offline') return;
      const generation = generations.current[channel];
      if (
        (active.current?.id === cue && active.current.channel === channel) ||
        queue.current.some(
          (queued) =>
            queued.id === cue && queued.channel === channel && queued.generation === generation,
        )
      )
        return;
      queue.current.push({ id: cue, channel, priority, generation });
      queue.current.sort((a, b) => b.priority - a.priority);
      if (queue.current.length > MAX_QUEUE) queue.current.length = MAX_QUEUE;
      drainRef.current();
    },
    [],
  );

  const cancel = useCallback(
    (channel: CoachChannel) => {
      generations.current[channel]++;
      queue.current = queue.current.filter((item) => item.channel !== channel);
      if (active.current?.channel === channel) {
        const source = active.current.source;
        active.current = null;
        source.onended = null;
        try {
          source.stop();
        } catch {
          // It may have ended between the state check and stop.
        }
        setCaption(null);
        if (statusRef.current === 'speaking') updateStatus('ready');
        drainRef.current();
      }
    },
    [updateStatus],
  );

  const toggle = useCallback(() => {
    if (enabledRef.current && statusRef.current !== 'locked') {
      enabledRef.current = false;
      setEnabled(false);
      try {
        active.current?.source.stop();
      } catch {
        // The source may have ended already.
      }
      active.current = null;
      queue.current = [];
      setCaption(null);
      updateStatus('muted');
      try {
        window.localStorage.setItem(ENABLED_KEY, 'false');
      } catch {
        // Audio still mutes when browser storage is disabled.
      }
      return;
    }

    enabledRef.current = true;
    setEnabled(true);
    try {
      window.localStorage.setItem(ENABLED_KEY, 'true');
    } catch {
      // Audio remains enabled for this page.
    }
    updateStatus('ready');
    try {
      const audioContext = getContext();
      void audioContext
        .resume()
        .then(() => drainRef.current())
        .catch(() => updateStatus('locked'));
    } catch {
      updateStatus('offline');
    }
  }, [getContext, updateStatus]);

  useEffect(
    () => () => {
      try {
        active.current?.source.stop();
      } catch {
        // The source may have ended already.
      }
    },
    [],
  );

  return { enabled, status, caption, toggle, speak, cancel };
}
