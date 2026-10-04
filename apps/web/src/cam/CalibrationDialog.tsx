import { useId } from 'react';
import type { RefObject } from 'react';
import { ACTION_CHECKS } from '@wb/motion';
import { CameraView } from './CameraView';
import type { useCamera } from './useCamera';
import type { useMotionControls } from '../motion/useMotionControls';
import type { usePoseLandmarker } from '../motion/usePoseLandmarker';

const LABELS = { leftPunch: 'Left punch', rightPunch: 'Right punch', guard: 'Guard', duck: 'Duck' };

export function CalibrationDialog({
  camera,
  motion,
  pose,
  videoRef,
  canvasRef,
}: {
  camera: ReturnType<typeof useCamera>;
  motion: ReturnType<typeof useMotionControls>;
  pose: ReturnType<typeof usePoseLandmarker>;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const id = useId();
  const status = motion.snapshot;
  const calibration = status?.calibration;
  const tracking = pose.diagnostics;
  const usable = tracking?.phase === 'ready' && tracking.tracking === 'VALID';
  const title = !camera.stream
    ? camera.status === 'error'
      ? 'Camera needs attention'
      : 'Automatic calibration: enable the camera'
    : tracking?.phase === 'loading'
      ? 'Warming up the camera'
      : tracking?.phase === 'error'
        ? 'Tracking needs a retry'
        : !usable
          ? 'Find your mark'
          : calibration?.phase === 'collecting'
            ? 'Hold your stance'
            : calibration?.nextCheck
              ? `Show your ${LABELS[calibration.nextCheck].toLowerCase()}`
              : calibration?.phase === 'ready'
                ? 'Tracking is steady'
                : 'Find your neutral stance';
  const instruction = !camera.stream
    ? 'Allow camera access to let your corner trainer read your stance. Video stays on this device.'
    : tracking?.phase === 'loading'
      ? 'The local trainer is getting the old gym camera ready. Keep your upper body in view.'
      : tracking?.phase === 'error'
        ? tracking.message
        : !usable
          ? 'Keep your head, shoulders, elbows, and wrists inside the camera frame.'
          : calibration?.phase === 'collecting'
            ? 'Relax your shoulders and hold still while the trainer records your stance.'
            : calibration?.nextCheck === 'leftPunch'
              ? 'Extend your left arm once, then bring your glove back to guard.'
              : calibration?.nextCheck === 'rightPunch'
                ? 'Extend your right arm once, then bring your glove back to guard.'
                : calibration?.nextCheck === 'guard'
                  ? 'Bring both hands up near your face and hold your guard.'
                  : calibration?.nextCheck === 'duck'
                    ? 'Bend your knees and lower your head and shoulders together.'
                    : calibration?.phase === 'ready'
                      ? 'Hold valid tracking briefly. The ring opens automatically.'
                      : 'Stand comfortably with your hands near chest height.';
  const complete = calibration ? Object.values(calibration.checks).filter(Boolean).length : 0;
  const cameraStatus = !camera.stream
    ? camera.status === 'error'
      ? 'CAMERA UNAVAILABLE'
      : camera.status === 'requesting'
        ? 'WAITING FOR CAMERA'
        : 'CAMERA OFF'
    : tracking?.phase === 'loading'
      ? 'STARTING LOCAL TRACKER'
      : tracking?.phase === 'error'
        ? 'TRACKER NEEDS A RETRY'
        : tracking?.tracking === 'VALID'
          ? 'UPPER BODY IN FRAME'
          : tracking?.tracking === 'LOW_CONFIDENCE'
            ? `FIND: ${tracking.missingLandmarks.join(', ') || 'MOVE INTO FRAME'}`
            : 'NO FIGHTER IN FRAME';

  return (
    <div className="fp-calibration-scrim">
      <section
        className="fp-calibration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-instruction`}
      >
        <div className="fp-dialog-topline">
          <span>CALIBRATION DIALOG · TRAINER</span>
          <span>·</span>
        </div>
        <div className="fp-dialog-title-row">
          <div>
            <p className="fp-dialog-kicker">AUTOMATIC CALIBRATION</p>
            <h1 id={`${id}-title`}>{title}</h1>
          </div>
        </div>
        <div className="fp-dialog-layout">
          <div className="fp-dialog-guidance">
            <p
              className="fp-dialog-instruction"
              id={`${id}-instruction`}
              role="status"
              aria-live="polite"
            >
              {instruction}
            </p>

            {calibration?.phase === 'collecting' ? (
              <div className="fp-dialog-progress" aria-label="Neutral stance calibration">
                <div>
                  <span>NEUTRAL STANCE</span>
                  <strong>{Math.round(calibration.progress * 100)}%</strong>
                </div>
                <progress
                  value={calibration.progress}
                  max={1}
                  aria-label="Three-second neutral calibration"
                />
              </div>
            ) : null}

            <div className="fp-dialog-check-heading">
              <span>SHOW THE TRAINER</span>
              <span>{complete} / 4</span>
            </div>
            <ol className="fp-dialog-checks">
              {ACTION_CHECKS.map((action, index) => (
                <li
                  key={action}
                  data-complete={calibration?.checks[action] ?? false}
                  data-current={calibration?.nextCheck === action}
                >
                  <span className="fp-dialog-check-number">0{index + 1}</span>
                  <span>{LABELS[action]}</span>
                  <small>
                    {calibration?.checks[action]
                      ? 'DONE'
                      : calibration?.nextCheck === action
                        ? 'NOW'
                        : 'WAIT'}
                  </small>
                </li>
              ))}
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
                    ? 'WAITING FOR CAMERA…'
                    : camera.status === 'error'
                      ? 'RETRY CAMERA'
                      : 'START CAMERA'}
                </button>
              ) : tracking?.phase === 'error' ? (
                <button type="button" className="fp-dialog-primary" onClick={pose.retry}>
                  RETRY TRACKING
                </button>
              ) : calibration?.phase === 'ready' ? (
                <span className="fp-dialog-wait" role="status">
                  <i /> ENTERING THE RING
                </span>
              ) : (
                <span className="fp-dialog-wait" role="status">
                  <i /> TRAINER IS WATCHING
                </span>
              )}
            </div>
            <p className="fp-dialog-footnote">LOCAL CAMERA ONLY</p>
          </div>

          <aside className="fp-dialog-camera" aria-label="Camera framing check">
            <div className="fp-dialog-camera-heading">
              <span>CALIBRATING CAMERA...</span>
              <span>MIRRORED VIEW</span>
            </div>
            <CameraView videoRef={videoRef} canvasRef={canvasRef} stream={camera.stream} />
            <div
              className="fp-dialog-camera-status"
              data-state={tracking?.phase === 'ready' ? tracking.tracking : 'LOST'}
              role="status"
              aria-live="polite"
            >
              <i aria-hidden="true" />
              <span>{cameraStatus}</span>
            </div>
            <p className="fp-dialog-camera-tip">
              Keep your head, shoulders, elbows, and wrists inside the corner marks.
            </p>
          </aside>
        </div>
      </section>
    </div>
  );
}
