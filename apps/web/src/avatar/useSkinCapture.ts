import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CaptureClient } from './captureClient';
import { loadFighterModelData } from './fighterAsset';
import { SLOT_COUNT } from './skin/slots';

export type CapturePhase = 'loading' | 'framing' | 'capturing' | 'baking' | 'review' | 'error';

export interface SkinCaptureState {
  phase: CapturePhase;
  /** The player pressed Start scan; capture begins once they are fully in view. */
  armed: boolean;
  fullBody: boolean;
  visible: boolean;
  yawDeg: number | null;
  slots: boolean[];
  result: Blob | null;
  error: string | null;
  loadingMessage: string;
}

/** Whole body must stay in view this long after Start scan before capture begins. */
const AUTO_START_MS = 1500;
const EMPTY_SLOTS: boolean[] = Array(SLOT_COUNT).fill(false);
const INITIAL: SkinCaptureState = {
  phase: 'loading',
  armed: false,
  fullBody: false,
  visible: false,
  yawDeg: null,
  slots: EMPTY_SLOTS,
  result: null,
  error: null,
  loadingMessage: 'Loading the body scanner…',
};

export function describeCapture(state: SkinCaptureState): string {
  const filled = state.slots.filter(Boolean).length;
  switch (state.phase) {
    case 'loading':
      return state.loadingMessage;
    case 'framing':
      if (state.error) return state.error;
      if (!state.armed) return 'Press Start scan, then step back until your whole body is in view.';
      return state.fullBody
        ? 'Hold still…'
        : 'Step back until your head, hands, and ankles are all in view.';
    case 'capturing':
      return state.visible
        ? `Turn slowly in one direction, arms relaxed. ${filled} of ${SLOT_COUNT} angles captured.`
        : "Can't see you. Step back into the frame.";
    case 'baking':
      return 'Painting your skin…';
    case 'review':
      return 'Here is your fighter. Save the skin or scan again.';
    case 'error':
      return state.error ?? 'Something went wrong. Retry.';
  }
}

export function useSkinCapture(videoRef: RefObject<HTMLVideoElement | null>, stream: MediaStream | null) {
  const [state, setState] = useState<SkinCaptureState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const client = useRef<CaptureClient | null>(null);
  const armed = useRef(false);
  const fullBodySince = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;
    let disposed = false;
    let frame = 0;
    let local: CaptureClient | null = null;
    const update = (patch: (state: SkinCaptureState) => SkinCaptureState) => {
      if (!disposed) setState(patch);
    };
    armed.current = false;
    fullBodySince.current = null;
    // Defer so starting the effect does not synchronously update React state.
    queueMicrotask(() => update(() => INITIAL));
    loadFighterModelData()
      .then((model) => {
        if (disposed) return;
        local = new CaptureClient(model, {
          onLoading: (message) => update((s) => ({ ...s, loadingMessage: message })),
          onReady: () => update((s) => ({ ...s, phase: 'framing' })),
          onStatus(status) {
            const now = performance.now();
            fullBodySince.current = status.fullBody ? (fullBodySince.current ?? now) : null;
            const startNow =
              status.phase === 'framing' &&
              armed.current &&
              fullBodySince.current !== null &&
              now - fullBodySince.current >= AUTO_START_MS;
            if (startNow) {
              armed.current = false;
              local?.start();
            }
            update((s) =>
              s.phase !== 'framing' && s.phase !== 'capturing'
                ? s
                : {
                    ...s,
                    phase: startNow ? 'capturing' : status.phase,
                    armed: startNow ? false : s.armed,
                    error: startNow ? null : s.error,
                    fullBody: status.fullBody,
                    visible: status.visible,
                    yawDeg: startNow ? 0 : status.yawDeg,
                    slots: startNow ? EMPTY_SLOTS : status.slots,
                  },
            );
          },
          onBaking: () => update((s) => ({ ...s, phase: 'baking' })),
          onBaked: (jpeg) => update((s) => ({ ...s, phase: 'review', result: jpeg })),
          onError: (message, recoverable) =>
            update((s) => ({
              ...s,
              phase: recoverable ? 'framing' : 'error',
              armed: false,
              slots: EMPTY_SLOTS,
              yawDeg: null,
              error: message,
            })),
        });
        client.current = local;
      })
      .catch((error: unknown) =>
        update((s) => ({
          ...s,
          phase: 'error',
          error: `The fighter model could not load. ${error instanceof Error ? error.message : ''}`,
        })),
      );
    const tick = () => {
      if (videoRef.current && !document.hidden) local?.pump(videoRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      local?.dispose();
      client.current = null;
    };
  }, [stream, attempt, videoRef]);

  const arm = useCallback(() => {
    armed.current = true;
    fullBodySince.current = null;
    setState((s) => ({ ...s, armed: true, error: null }));
  }, []);
  const disarm = useCallback(() => {
    armed.current = false;
    setState((s) => ({ ...s, armed: false }));
  }, []);
  const cancel = useCallback(() => {
    armed.current = false;
    fullBodySince.current = null;
    client.current?.cancel();
    setState((s) => ({ ...s, phase: 'framing', armed: false, slots: EMPTY_SLOTS, yawDeg: null }));
  }, []);
  const finish = useCallback(() => client.current?.finish(), []);
  const retake = useCallback(() => {
    armed.current = false;
    fullBodySince.current = null;
    client.current?.cancel();
    setState((s) => ({ ...s, phase: 'framing', armed: false, slots: EMPTY_SLOTS, yawDeg: null, result: null }));
  }, []);
  const retry = useCallback(() => {
    setState(INITIAL);
    setAttempt((value) => value + 1);
  }, []);

  return { state, message: describeCapture(state), arm, disarm, cancel, finish, retake, retry };
}
