import { useId } from 'react';
import { ACTION_CHECKS } from '@wb/motion';
import type { useMotionControls } from '../motion/useMotionControls';
import type { usePoseLandmarker } from '../motion/usePoseLandmarker';
import './motionSetup.css';

const LABELS = { leftPunch: 'Left punch', rightPunch: 'Right punch', guard: 'Guard', duck: 'Duck' };
const PUNCH_STATUS = {
  'return-to-rest': 'Return to rest or face-level guard',
  cooldown: 'Shared punch cooldown',
  'need-extension': 'Waiting for a punch or arm swing',
  'need-motion': 'Gesture seen; waiting for sufficient motion',
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
  const calibration = status?.calibration;
  const tracking = pose.diagnostics;
  const usable = tracking?.phase === 'ready' && tracking.tracking === 'VALID';
  const canReady =
    calibration?.phase === 'ready' && usable && (tracking.canResume || !tracking.pauseRequired);
  return (
    <section className="motion-setup" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>Calibrate your movement</h3>
      <p role="status" aria-live="polite">
        {status?.ready
          ? 'Calibration complete. Local practice controls enabled.'
          : (calibration?.message ??
            'Start with a neutral stance: elbows bent, hands at chest height.')}
      </p>
      {calibration?.phase === 'collecting' ? (
        <label className="motion-progress">
          Neutral hold: {Math.round(calibration.progress * 100)}%
          <progress
            value={calibration.progress}
            max={1}
            aria-label="Three-second neutral calibration"
          />
        </label>
      ) : null}
      <ol className="motion-checks" aria-label="Required calibration actions">
        {ACTION_CHECKS.map((action) => (
          <li key={action} data-complete={calibration?.checks[action] ?? false}>
            <span aria-hidden="true">{calibration?.checks[action] ? '✓' : '○'}</span>{' '}
            {LABELS[action]}
            <span className="motion-check-label">
              {calibration?.checks[action]
                ? 'Recognized'
                : calibration?.nextCheck === action
                  ? 'Try now'
                  : 'Pending'}
            </span>
          </li>
        ))}
      </ol>
      <div className="motion-buttons">
        <button type="button" onClick={motion.startCalibration} disabled={!usable}>
          {calibration?.phase === 'idle' || !calibration ? 'Start calibration' : 'Recalibrate'}
        </button>
        <button type="button" onClick={motion.confirmReady} disabled={!canReady || status?.ready}>
          {status?.ready ? 'Ready' : 'Confirm Ready'}
        </button>
      </div>
      {calibration?.phase === 'ready' && !canReady && !status?.ready ? (
        <p>Keep tracking valid for one second before confirming Ready.</p>
      ) : null}
      <label className="motion-sensitivity" htmlFor={`${id}-sensitivity`}>
        Detection sensitivity: {(status?.sensitivity ?? 1).toFixed(1)}×
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
      <p className="motion-feedback" aria-live="polite">
        {status?.ready ? 'Local practice' : 'Calibration practice'}: {status?.feedback ?? 'Neutral'}
      </p>
      <p className="motion-counts">
        Left {status?.counts.leftPunches ?? 0} · Right {status?.counts.rightPunches ?? 0} · Guards{' '}
        {status?.counts.guards ?? 0} · Ducks {status?.counts.ducks ?? 0}
      </p>
      <details>
        <summary>Movement diagnostics</summary>
        <dl>
          {(['left', 'right'] as const).map((hand) => (
            <div key={hand}>
              <dt>{hand === 'left' ? 'Left punch' : 'Right punch'}</dt>
              <dd>{status ? PUNCH_STATUS[status.punches[hand].status] : 'Calibrate first'}</dd>
              <dt>Extension / swing arc / forward speed</dt>
              <dd>
                {(status?.punches[hand].extension ?? 0).toFixed(0)}° /{' '}
                {(status?.punches[hand].swingArc ?? 0).toFixed(0)}° /{' '}
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
            {(tracking?.inferenceHz ?? 0).toFixed(1)} Hz · {(tracking?.inferenceMs ?? 0).toFixed(1)}{' '}
            ms
          </dd>
          <dt>Display loop</dt>
          <dd>{(tracking?.renderHz ?? 0).toFixed(1)} Hz</dd>
        </dl>
      </details>
      <p className="motion-tip">
        Use small controlled movements and a slight camera angle if your wrist disappears during a
        straight punch.
      </p>
    </section>
  );
}
