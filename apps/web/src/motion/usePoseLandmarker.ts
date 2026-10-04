import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { POSE_HISTORY_MS, PoseSmoother, TrackingMonitor, VISUAL_HOLD_MS } from '@wb/motion';
import type { PoseSample, TrackingStatus } from '@wb/motion';
import { InferenceClient } from './inferenceClient';
import { drawPose } from './drawPose';

export interface PoseObservation {
  kind: 'sample' | 'tracking' | 'stop';
  sample: PoseSample | null;
  state: TrackingStatus;
  receivedAt: number;
}
interface PoseDiagnostics extends TrackingStatus {
  stream: MediaStream | null;
  phase: 'loading' | 'ready' | 'error';
  message: string;
  inferenceHz: number;
  inferenceMs: number;
  confidence: number;
  renderHz: number;
  missingLandmarks: string[];
}

export function usePoseLandmarker(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  stream: MediaStream | null,
  showOverlay: boolean,
) {
  const [attempt, setAttempt] = useState(0);
  const [diagnostics, setDiagnostics] = useState<PoseDiagnostics | null>(null);
  const latestSample = useRef<PoseSample | null>(null);
  const history = useRef<PoseSample[]>([]);
  const monitor = useRef<TrackingMonitor | null>(null);
  const overlayEnabled = useRef(showOverlay);
  const observers = useRef(new Set<(event: PoseObservation) => void>());
  const geometry = useRef<PoseSample['segmentRatios']>(undefined);
  const subscribeSamples = useCallback((observer: (event: PoseObservation) => void) => {
    observers.current.add(observer);
    return () => {
      observers.current.delete(observer);
    };
  }, []);
  const setGeometry = useCallback((ratios: PoseSample['segmentRatios']) => {
    geometry.current = ratios;
  }, []);

  useEffect(() => {
    overlayEnabled.current = showOverlay;
  }, [showOverlay]);

  useEffect(() => {
    latestSample.current = null;
    history.current = [];
    const tracking = new TrackingMonitor();
    const smoother = new PoseSmoother();
    const notify = (event: PoseObservation) => {
      for (const observer of observers.current) observer(event);
    };
    monitor.current = tracking;
    if (!stream) return;
    const canvas = canvasRef.current;
    let disposed = false;
    let client: InferenceClient | undefined;
    let animation = 0;
    let lastPublished = -Infinity;
    let lastSafePose: PoseSample | null = null;
    let lastSafeAt = -Infinity;
    let lastResultAt = -Infinity;
    let displayFrames = 0;
    let displayWindow = performance.now();
    let current: PoseDiagnostics = {
      stream,
      phase: 'loading',
      message: 'Loading local pose model…',
      ...tracking.stop(performance.now()),
      inferenceHz: 0,
      inferenceMs: 0,
      confidence: 0,
      renderHz: 0,
      missingLandmarks: [],
    };
    const publish = () => {
      if (disposed) return;
      lastPublished = performance.now();
      setDiagnostics({ ...current });
    };
    const error = (message: string) => {
      if (disposed) return;
      latestSample.current = null;
      history.current = [];
      lastSafePose = null;
      smoother.reset();
      current = {
        ...current,
        phase: 'error',
        message,
        ...tracking.stop(performance.now()),
        inferenceHz: 0,
      };
      publish();
      notify({
        kind: 'stop',
        sample: null,
        state: tracking.stop(performance.now()),
        receivedAt: performance.now(),
      });
    };
    try {
      if (
        typeof Worker === 'undefined' ||
        typeof OffscreenCanvas === 'undefined' ||
        typeof createImageBitmap === 'undefined'
      ) {
        throw new Error(
          'Pose tracking needs workers, OffscreenCanvas, and camera frame capture. Try desktop Chrome or Edge.',
        );
      }
      client = new InferenceClient({
        onLoading(message) {
          current.message = message;
          publish();
        },
        onReady() {
          current.phase = 'ready';
          current.message = 'Pose model ready.';
          publish();
        },
        onError: error,
        onResult(result) {
          if (disposed) return;
          lastResultAt = result.receivedAt;
          const state = tracking.observe(result.sample.tracking, result.receivedAt);
          const changed =
            current.tracking !== state.tracking ||
            current.pauseRequired !== state.pauseRequired ||
            current.canResume !== state.canResume;
          current = {
            ...current,
            ...state,
            inferenceHz: result.inferenceHz,
            inferenceMs: result.inferenceMs,
            confidence: result.sample.confidence,
            missingLandmarks: result.sample.missingLandmarks,
          };
          history.current = history.current.filter(
            (sample) => result.sample.frame.timestamp - sample.frame.timestamp <= POSE_HISTORY_MS,
          );
          if (result.sample.tracking === 'VALID') {
            history.current.push(result.sample);
            lastSafePose = smoother.update(result.sample);
            latestSample.current = lastSafePose;
            lastSafeAt = result.receivedAt;
          }
          notify({ kind: 'sample', sample: result.sample, state, receivedAt: result.receivedAt });
          if (lastSafePose) {
            lastSafePose.segmentRatios = geometry.current;
          }
          if (changed || result.receivedAt - lastPublished >= 250) publish();
          // Start the next available frame on completion; rAF remains the fallback
          // for duplicate/not-yet-decoded video frames and never queues work.
          if (videoRef.current && !document.hidden) client?.capture(videoRef.current);
        },
      });
    } catch (cause) {
      // Defer publication so starting the effect does not synchronously update React state.
      queueMicrotask(() =>
        error(
          cause instanceof Error ? cause.message : 'Pose tracking could not start. Retry tracking.',
        ),
      );
    }
    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      displayFrames++;
      if (now - displayWindow >= 1000) {
        current.renderHz = (displayFrames * 1000) / (now - displayWindow);
        displayFrames = 0;
        displayWindow = now;
      }
      if (current.phase === 'ready') {
        const state = tracking.refresh(now);
        const changed =
          current.tracking !== state.tracking ||
          current.pauseRequired !== state.pauseRequired ||
          current.canResume !== state.canResume;
        current = { ...current, ...state };
        if (changed) notify({ kind: 'tracking', sample: null, state, receivedAt: now });
        if (now - lastSafeAt > VISUAL_HOLD_MS) latestSample.current = null;
        if (now - lastResultAt > VISUAL_HOLD_MS) {
          latestSample.current = null;
          history.current = [];
          smoother.reset();
          current.inferenceHz = 0;
        }
        if (changed || now - lastPublished >= 250) publish();
        if (videoRef.current && !document.hidden) client?.capture(videoRef.current);
      }
      if (canvasRef.current)
        drawPose(
          canvasRef.current,
          overlayEnabled.current && now - lastSafeAt <= VISUAL_HOLD_MS ? lastSafePose : null,
        );
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(animation);
      client?.dispose();
      tracking.stop(performance.now());
      notify({
        kind: 'stop',
        sample: null,
        state: tracking.stop(performance.now()),
        receivedAt: performance.now(),
      });
      latestSample.current = null;
      history.current = [];
      if (canvas) drawPose(canvas, null);
    };
  }, [stream, attempt, videoRef, canvasRef]);

  const confirmTracking = useCallback(() => monitor.current?.confirmResume(performance.now()), []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    diagnostics: diagnostics?.stream === stream ? diagnostics : null,
    latestSample,
    history,
    confirmTracking,
    retry,
    subscribeSamples,
    setGeometry,
  };
}
