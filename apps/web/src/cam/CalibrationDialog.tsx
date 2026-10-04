import { useEffect, useId } from 'react';
import type { RefObject } from 'react';
import { ACTION_CHECKS } from '@wb/motion';
import type { CalibrationCueId } from '@wb/core';
import { CameraView } from './CameraView';
import type { useCamera } from './useCamera';
import type { useMotionControls } from '../motion/useMotionControls';
import type { usePoseLandmarker } from '../motion/usePoseLandmarker';
import type { CoachVoice } from '../audio/useCoachVoice';

const LABELS = { leftPunch: 'Left punch', rightPunch: 'Right punch', guard: 'Guard' };

export function CalibrationDialog({
  camera,
  motion,
  pose,
  videoRef,
  canvasRef,
  voice,
}: {
  camera: ReturnType<typeof useCamera>;
  motion: ReturnType<typeof useMotionControls>;
  pose: ReturnType<typeof usePoseLandmarker>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  voice: CoachVoice;
}) {
  const id = useId();
  const { cancel, speak } = voice;
  const status = motion.snapshot;
  const calibration = status?.calibration;
  const tracking = pose.diagnostics;
  const usable = tracking?.phase === 'ready' && tracking.tracking === 'VALID';
  const title = !camera.stream
    ? camera.status === 'error'
      ? 'Camera needs attention'
      : 'Turn on your camera'
    : tracking?.phase === 'loading'
      ? 'Warming up'
      : tracking?.phase === 'error'
        ? 'Tracking stopped'
        : !usable
          ? 'Find your mark'
          : calibration?.phase === 'collecting'
            ? 'Hold your stance'
            : calibration?.nextCheck
              ? `Show your ${LABELS[calibration.nextCheck].toLowerCase()}`
              : calibration?.phase === 'ready'
                ? "You're set"
                : 'Find your neutral stance';
  const instruction = !camera.stream
    ? 'Allow camera access so the trainer can read your stance. Video never leaves this device.'
    : tracking?.phase === 'loading'
      ? 'Starting the tracker. Keep your upper body in view.'
      : tracking?.phase === 'error'
        ? tracking.message
        : !usable
          ? 'Step back until your head, shoulders, elbows, and wrists are inside the corner marks.'
          : calibration?.phase === 'collecting'
            ? calibration.message
            : calibration?.nextCheck === 'leftPunch'
              ? 'Throw one controlled left punch, then bring your fist back near your chest.'
              : calibration?.nextCheck === 'rightPunch'
                ? 'Throw one controlled right punch, then bring your fist back near your chest.'
                : calibration?.nextCheck === 'guard'
                  ? 'Raise both fists to upper chest or shoulder height to block. You can keep your elbows relaxed.'
                  : calibration?.phase === 'ready'
                    ? 'Stay in view. The ring opens automatically.'
                    : 'Stand relaxed with elbows bent and fists near your chest, below your face.';
  const cameraStatus = !camera.stream
    ? camera.status === 'error'
      ? 'Camera unavailable'
      : camera.status === 'requesting'
        ? 'Waiting for camera'
        : 'Camera off'
    : tracking?.phase === 'loading'
      ? 'Starting tracker'
      : tracking?.phase === 'error'
        ? 'Tracker stopped'
        : tracking?.tracking === 'VALID'
          ? 'Upper body in frame'
          : tracking?.tracking === 'LOW_CONFIDENCE' && tracking.missingLandmarks.length
            ? `Can't see your ${tracking.missingLandmarks.map(spaced).join(', ')}`
            : 'No one in frame';
  const voiceCue: CalibrationCueId = !camera.stream
    ? camera.status === 'requesting'
      ? 'cameraWaiting'
      : 'cameraOn'
    : tracking?.phase === 'loading'
      ? 'trackerLoading'
      : tracking?.phase === 'error'
        ? 'trackerRetry'
        : !usable
          ? 'findFrame'
          : calibration?.phase === 'collecting'
            ? 'neutral'
            : calibration?.nextCheck ?? 'calibrationReady';

  useEffect(() => {
    cancel('calibration');
    speak(voiceCue, 'calibration', 0);
    if (voiceCue === 'calibrationReady') return;
    const repeat = window.setInterval(() => speak(voiceCue, 'calibration', 0), 7_500);
    return () => {
      window.clearInterval(repeat);
      cancel('calibration');
    };
  }, [cancel, speak, voiceCue]);

  return (
    <div className="fp-calibration-scrim">
      <section
        className="fp-calibration-dialog"
        role="dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-instruction`}
      >
        <figure className="fp-dialog-camera" aria-label="Camera framing check">
          <CameraView videoRef={videoRef} canvasRef={canvasRef} stream={camera.stream} />
          <figcaption
            className="fp-dialog-camera-status"
            data-state={tracking?.phase === 'ready' ? tracking.tracking : 'LOST'}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            {cameraStatus}
          </figcaption>
        </figure>

        <div className="fp-dialog-guidance">
          <div className="fp-dialog-titlebar">
            <p className="fp-dialog-kicker">Calibration</p>
            <button
              className="fp-dialog-voice"
              type="button"
              onClick={voice.toggle}
              aria-pressed={voice.enabled}
              title={
                voice.status === 'offline'
                  ? 'Set ELEVENLABS_API_KEY on the API server'
                  : undefined
              }
            >
              <span aria-hidden="true">{voice.enabled ? '♪' : '×'}</span>
              {voice.status === 'locked'
                ? 'TAP TO ENABLE VOICE'
                : voice.enabled
                  ? 'VOICE COACH ON'
                  : 'VOICE COACH OFF'}
              {voice.status === 'offline' ? ' · OFFLINE' : null}
            </button>
          </div>
          <h1 id={`${id}-title`}>{title}</h1>
          <p
            className="fp-dialog-instruction"
            id={`${id}-instruction`}
            role="status"
            aria-live="polite"
          >
            {instruction}
          </p>

          {calibration?.phase === 'collecting' ? (
            <progress
              className="fp-dialog-progress"
              value={calibration.progress}
              max={1}
              aria-label="Neutral stance"
            />
          ) : null}

          <ol className="fp-dialog-checks" aria-label="Moves to show the trainer">
            {ACTION_CHECKS.map((action, index) => {
              const done = calibration?.checks[action] ?? false;
              const current = calibration?.nextCheck === action;
              return (
                <li key={action} data-complete={done} data-current={current}>
                  <span className="fp-dialog-check-number">{index + 1}</span>
                  <span>{LABELS[action]}</span>
                  <small>{done ? 'Done' : current ? 'Now' : null}</small>
                </li>
              );
            })}
          </ol>

          <div className="fp-dialog-actions">
            {!camera.stream ? (
              <button
                type="button"
                className="fp-dialog-primary"
                onClick={() => void camera.start()}
                disabled={camera.status === 'requesting'}
              >
                {camera.status === 'requesting'
                  ? 'Waiting for camera…'
                  : camera.status === 'error'
                    ? 'Retry camera'
                    : 'Turn on camera'}
              </button>
            ) : tracking?.phase === 'error' ? (
              <button type="button" className="fp-dialog-primary" onClick={pose.retry}>
                Retry tracking
              </button>
            ) : (
              <span className="fp-dialog-wait">
                <i aria-hidden="true" />
                {calibration?.phase === 'ready' ? 'Entering the ring' : 'Trainer is watching'}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/** `leftWrist` → `left wrist` for the framing hint. */
function spaced(landmark: string) {
  return landmark.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}
