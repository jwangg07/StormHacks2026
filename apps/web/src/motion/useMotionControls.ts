import { useCallback, useEffect, useRef, useState } from 'react';
import { idleControls, MotionController, PracticeAdapter } from '@wb/motion';
import type { MotionDiagnostics, MotionFrame } from '@wb/motion';
import type { usePoseLandmarker } from './usePoseLandmarker';

export interface MotionSnapshot extends MotionDiagnostics {
  stream: MediaStream | null;
  ready: boolean;
  counts: ReturnType<PracticeAdapter['snapshot']>;
  controls: MotionFrame;
  feedback: string;
}
export function useMotionControls(
  pose: ReturnType<typeof usePoseLandmarker>,
  stream: MediaStream | null,
) {
  const processor = useRef(new MotionController());
  const practice = useRef(new PracticeAdapter());
  const latestControls = useRef<MotionFrame>(idleControls(0, 'LOST'));
  const listeners = useRef(new Set<(frame: MotionFrame) => void>());
  const [snapshot, setSnapshot] = useState<MotionSnapshot | null>(null);
  const { subscribeSamples, setGeometry } = pose;
  const currentStream = useRef<MediaStream | null>(null);
  const confirmed = useRef(false);
  const autoReadyPending = useRef(true);
  const lastMove = useRef<{ label: string; timestamp: number } | null>(null);
  const { confirmTracking } = pose;
  const publish = useCallback(() => {
    const current = processor.current.diagnostics();
    const controls = latestControls.current;
    const last = current.lastAction;
    const labels = {
      leftPunch: 'Left punch',
      rightPunch: 'Right punch',
      guard: 'Guard',
      duck: 'Duck',
    };
    setSnapshot({
      ...current,
      stream: currentStream.current,
      ready: confirmed.current,
      controls,
      counts: practice.current.snapshot(),
      feedback:
        lastMove.current && performance.now() - lastMove.current.timestamp < 400
          ? lastMove.current.label
          : controls.dodge
            ? `Dodge ${controls.dodge}`
            : controls.guard
              ? 'Block'
              : controls.duck
                ? 'Duck'
                : lastMove.current && performance.now() - lastMove.current.timestamp < 1200
                  ? lastMove.current.label
                  : last && performance.now() - last.timestamp < 1200
                    ? labels[last.action]
                    : 'Neutral',
    });
  }, []);
  useEffect(() => {
    processor.current = new MotionController();
    practice.current = new PracticeAdapter();
    latestControls.current = idleControls(performance.now(), 'LOST');
    currentStream.current = stream;
    confirmed.current = false;
    autoReadyPending.current = true;
    lastMove.current = null;
    setGeometry(undefined);
    let lastPublished = -Infinity;
    let lastPhase = 'idle';
    let lastAction = -Infinity;
    const send = (frame: MotionFrame) => {
      latestControls.current = frame;
      if (frame.punch && frame.move)
        lastMove.current = {
          label: `${frame.punch === 'left' ? 'Left' : 'Right'} ${frame.move}`,
          timestamp: performance.now(),
        };
      practice.current.consume(frame);
      for (const listener of listeners.current) listener(frame);
    };
    return subscribeSamples((event) => {
      if (event.state.pauseRequired) {
        confirmed.current = false;
        autoReadyPending.current = true;
      }
      const controller = processor.current;
      if (event.kind === 'sample' && event.sample) {
        const candidate = controller.update(event.sample);
        const status = controller.diagnostics();
        setGeometry(controller.calibration.baseline?.segmentRatios);
        const activate =
          autoReadyPending.current &&
          status.calibration.phase === 'ready' &&
          candidate.tracking === 'VALID' &&
          (!event.state.pauseRequired || (event.state.canResume && confirmTracking()));
        if (activate) {
          confirmed.current = true;
          autoReadyPending.current = false;
        }
        send(
          !activate &&
            status.calibration.phase === 'ready' &&
            confirmed.current &&
            !event.state.pauseRequired &&
            candidate.tracking === 'VALID'
            ? candidate
            : idleControls(candidate.timestamp, event.state.tracking),
        );
      } else if (event.state.pauseRequired || event.state.tracking !== 'VALID') {
        controller.invalidate();
        send(idleControls(event.receivedAt, event.state.tracking));
      }
      const status = controller.diagnostics();
      const actionAt = status.lastAction?.timestamp ?? -Infinity;
      if (
        event.kind !== 'sample' ||
        event.receivedAt - lastPublished >= 250 ||
        lastPhase !== status.calibration.phase ||
        actionAt !== lastAction
      ) {
        lastPublished = event.receivedAt;
        lastPhase = status.calibration.phase;
        lastAction = actionAt;
        publish();
      }
    });
  }, [stream, subscribeSamples, setGeometry, confirmTracking, publish]);
  const startCalibration = useCallback(() => {
    processor.current.startCalibration();
    practice.current = new PracticeAdapter();
    confirmed.current = false;
    autoReadyPending.current = true;
    lastMove.current = null;
    latestControls.current = idleControls(performance.now(), 'VALID');
    for (const listener of listeners.current) listener(latestControls.current);
    setGeometry(undefined);
    publish();
  }, [publish, setGeometry]);
  const setSensitivity = useCallback(
    (value: number) => {
      processor.current.setSensitivity(value);
      latestControls.current = idleControls(performance.now(), 'VALID');
      for (const listener of listeners.current) listener(latestControls.current);
      publish();
    },
    [publish],
  );
  const subscribeControls = useCallback((listener: (frame: MotionFrame) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  // Stream identity is stored with state so the UI never shows an old camera's calibration.
  return {
    snapshot: snapshot?.stream === stream ? snapshot : null,
    latestControls,
    subscribeControls,
    startCalibration,
    setSensitivity,
  };
}

export type MotionControls = ReturnType<typeof useMotionControls>;
