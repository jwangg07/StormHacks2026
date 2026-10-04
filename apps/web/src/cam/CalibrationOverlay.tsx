import { useId } from 'react';
import { createPortal } from 'react-dom';
import type { useMotionControls } from '../motion/useMotionControls';
import type { usePoseLandmarker } from '../motion/usePoseLandmarker';
import './calibrationOverlay.css';

const PROMPTS = {
  leftPunch: 'Throw punch left',
  rightPunch: 'Throw punch right',
  guard: 'Raise your guard',
  duck: 'Duck down',
};

export function CalibrationOverlay({
  motion,
  pose,
}: {
  motion: ReturnType<typeof useMotionControls>;
  pose: ReturnType<typeof usePoseLandmarker>;
}) {
  const id = useId();
  const status = motion.snapshot;
  const calibration = status?.calibration;
  const tracking = pose.diagnostics;
  if (status?.ready || tracking?.phase === 'error') return null;
  const visible = tracking?.phase === 'ready' && tracking.tracking === 'VALID';
  const complete = calibration?.phase === 'ready';
  const collecting = visible && calibration?.phase === 'collecting';
  const canReady = complete && visible && (tracking.canResume || !tracking.pauseRequired);
  const title = !visible
    ? 'Step into frame'
    : collecting
      ? 'Hold still for 3 seconds'
      : calibration?.nextCheck
        ? PROMPTS[calibration.nextCheck]
        : complete
          ? 'Calibration complete'
          : 'Hold a neutral stance';
  const instruction = !visible
    ? 'Keep your head, shoulders, elbows, and wrists visible.'
    : complete
      ? canReady
        ? 'Confirm Ready to start practice.'
        : 'Hold tracking steady for one second.'
      : (calibration?.message ?? 'Bend your elbows and hold your hands at chest height.');

  return createPortal(
    <section className="calibration-overlay" aria-labelledby={`${id}-title`}>
      <span className="calibration-overlay-label">Movement setup</span>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{instruction}</p>
      </div>
      {collecting ? (
        <div className="calibration-overlay-progress">
          <span className="calibration-overlay-countdown" aria-hidden="true">
            {Math.max(1, Math.ceil(3 * (1 - calibration.progress)))}
          </span>
          <progress value={calibration.progress} max={1} aria-label="Neutral stance calibration" />
        </div>
      ) : null}
      {complete ? (
        <button type="button" onClick={motion.confirmReady} disabled={!canReady}>
          Confirm Ready
        </button>
      ) : null}
    </section>,
    document.body,
  );
}
