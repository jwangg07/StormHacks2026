import { useId } from 'react';
import type { useMotionControls } from '../motion/useMotionControls';
import type { usePoseLandmarker } from '../motion/usePoseLandmarker';
import './motionSetup.css';

const PUNCH_STATUS = {
  'return-to-rest': 'Return to guard',
  cooldown: 'Shared punch cooldown',
  'need-extension': 'Waiting for extension',
  'need-motion': 'Waiting for sufficient motion',
  detected: 'Punch recognized',
};

export function MotionSetup({
  motion,
  pose,
}: {
  motion: ReturnType<typeof useMotionControls>;
  pose: ReturnType<typeof usePoseLandmarker>;
}) {
  const id = useId();
  const status = motion.snapshot;
  const tracking = pose.diagnostics;
  const usable = tracking?.phase === 'ready' && tracking.tracking === 'VALID';

  return (
    <section className="motion-setup" aria-labelledby={`${id}-heading`}>
      <div className="motion-meta">
        <span id={`${id}-heading`}>RING-SIDE CONTROLS</span>
        <span>{status?.ready ? 'INPUT LIVE' : 'SETUP REQUIRED'}</span>
      </div>
      <div className="motion-tool-card">
        <div>
          <span className="motion-tool-label">TRACKING PROFILE</span>
          <strong>
            {status?.ready
              ? 'Stance confirmed'
              : usable
                ? 'Camera is tracking'
                : 'Waiting for camera'}
          </strong>
          <p>Restart the trainer's movement check at any time.</p>
        </div>
        <button type="button" onClick={motion.startCalibration} disabled={!usable}>
          RECALIBRATE
        </button>
      </div>

      <label className="motion-sensitivity" htmlFor={`${id}-sensitivity`}>
        <span>Detection sensitivity</span>
        <strong>{(status?.sensitivity ?? 1).toFixed(1)}x</strong>
      </label>
      <input
        id={`${id}-sensitivity`}
        type="range"
        min="0.7"
        max="1.3"
        step="0.1"
        value={status?.sensitivity ?? 1}
        onChange={(event) => motion.setSensitivity(Number(event.target.value))}
      />

      <div className="motion-feedback" aria-live="polite">
        <span>LIVE INPUT</span>
        <strong>{status?.feedback ?? 'Neutral stance'}</strong>
      </div>
      <p className="motion-counts">
        LEFT {status?.counts.leftPunches ?? 0} <i /> RIGHT {status?.counts.rightPunches ?? 0}
        <i /> GUARD {status?.counts.guards ?? 0} <i /> DUCK {status?.counts.ducks ?? 0}
      </p>

      <details className="motion-diagnostics">
        <summary>Motion diagnostics</summary>
        <dl>
          {(['left', 'right'] as const).map((hand) => (
            <div key={hand}>
              <dt>{hand === 'left' ? 'Left punch' : 'Right punch'}</dt>
              <dd>{status ? PUNCH_STATUS[status.punches[hand].status] : 'Calibrate first'}</dd>
              <dt>Extension / swing arc / forward speed</dt>
              <dd>
                {(status?.punches[hand].extension ?? 0).toFixed(0)} deg /{' '}
                {(status?.punches[hand].swingArc ?? 0).toFixed(0)} deg /{' '}
                {(status?.punches[hand].forwardSpeed ?? 0).toFixed(2)} shoulder widths/s
              </dd>
            </div>
          ))}
          <dt>Left wrist speed</dt>
          <dd>{(status?.features?.arms.left.wristSpeed ?? 0).toFixed(2)} shoulder widths/s</dd>
          <dt>Right wrist speed</dt>
          <dd>{(status?.features?.arms.right.wristSpeed ?? 0).toFixed(2)} shoulder widths/s</dd>
          <dt>Depth evidence</dt>
          <dd>
            {status?.features?.arms.left.depthReliable && status.features.arms.right.depthReliable
              ? 'Estimated 3D pose'
              : 'Image geometry fallback'}
          </dd>
          <dt>Inference</dt>
          <dd>
            {(tracking?.inferenceHz ?? 0).toFixed(1)} Hz / {(tracking?.inferenceMs ?? 0).toFixed(1)}{' '}
            ms
          </dd>
          <dt>Display loop</dt>
          <dd>{(tracking?.renderHz ?? 0).toFixed(1)} Hz</dd>
        </dl>
      </details>
      <p className="motion-tip">
        Use compact movements. Turn slightly if a wrist disappears during a straight punch.
      </p>
    </section>
  );
}
