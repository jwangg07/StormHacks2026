import { useEffect, useId, useRef, useState } from 'react';
import type { Landmark, PoseSample } from '@wb/motion';
import { useCamera } from './useCamera';
import { useVideoStream } from './useVideoStream';
import { usePoseLandmarker } from '../motion/usePoseLandmarker';
import './camera.css';

function angle(a: Landmark, b: Landmark, c: Landmark) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const lengths = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  return Math.acos(Math.max(-1, Math.min(1, dot / (lengths || 1)))) * (180 / Math.PI);
}

function findPunch(history: PoseSample[]) {
  const current = history.at(-1);
  if (!current || current.tracking !== 'VALID') return null;
  const shoulderWidth = Math.hypot(
    current.aspectLandmarks.leftShoulder.x - current.aspectLandmarks.rightShoulder.x,
    current.aspectLandmarks.leftShoulder.y - current.aspectLandmarks.rightShoulder.y,
  );
  if (!shoulderWidth) return null;
  const previous = [...history].reverse().find((sample) => {
    const elapsed = current.frame.timestamp - sample.frame.timestamp;
    return elapsed >= 80 && elapsed <= 250;
  });
  if (!previous) return null;
  let best: { hand: 'left' | 'right'; score: number } | null = null;
  for (const hand of ['left', 'right'] as const) {
    const shoulder = current.aspectLandmarks[`${hand}Shoulder`];
    const elbow = current.aspectLandmarks[`${hand}Elbow`];
    const wrist = current.aspectLandmarks[`${hand}Wrist`];
    const oldShoulder = previous.aspectLandmarks[`${hand}Shoulder`];
    const oldElbow = previous.aspectLandmarks[`${hand}Elbow`];
    const oldWrist = previous.aspectLandmarks[`${hand}Wrist`];
    if (!shoulder || !elbow || !wrist || !oldShoulder || !oldElbow || !oldWrist) continue;
    const elapsed = (current.frame.timestamp - previous.frame.timestamp) / 1000;
    const speed = Math.hypot(wrist.x - oldWrist.x, wrist.y - oldWrist.y) / shoulderWidth / elapsed;
    const oldAngle = angle(oldShoulder, oldElbow, oldWrist);
    const extension = angle(shoulder, elbow, wrist) - oldAngle;
    if (oldAngle <= 150 && extension >= 25 && speed > 1.5) {
      const score = speed * extension;
      if (!best || score > best.score) best = { hand, score };
    }
  }
  return best?.hand ?? null;
}

export function CameraPreview() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [lastPunch, setLastPunch] = useState<{ hand: 'left' | 'right'; at: number } | null>(null);
  const id = useId();
  const { stream, fail } = camera;
  useVideoStream(videoRef, stream, fail);

  const pose = usePoseLandmarker(videoRef, canvasRef, stream, showOverlay);
  const diagnostics = pose.diagnostics;

  useEffect(() => {
    if (!stream) return;
    let frame = 0;
    let lastSampleAt = -1;
    let lastPunchAt = -Infinity;
    const armed: Record<'left' | 'right', boolean> = { left: true, right: true };
    const tick = () => {
      const sample = pose.latestSample.current;
      if (
        sample && sample.frame.timestamp !== lastSampleAt && sample.tracking === 'VALID' &&
        diagnostics?.phase === 'ready' && !diagnostics.pauseRequired
      ) {
        lastSampleAt = sample.frame.timestamp;
        const history = pose.history.current;
        for (const hand of ['left', 'right'] as const) {
          const elbow = sample.aspectLandmarks[`${hand}Elbow`];
          const shoulder = sample.aspectLandmarks[`${hand}Shoulder`];
          const wrist = sample.aspectLandmarks[`${hand}Wrist`];
          if (elbow && shoulder && wrist && angle(shoulder, elbow, wrist) < 140) armed[hand] = true;
          if (!armed[hand]) continue;
          const detected = findPunch(history);
          if (detected === hand && sample.frame.timestamp - lastPunchAt >= 450) {
            armed[hand] = false;
            lastPunchAt = sample.frame.timestamp;
            setLastPunch({ hand, at: Date.now() });
            break;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [stream, diagnostics?.phase, diagnostics?.pauseRequired, pose.latestSample, pose.history]);

  return (
    <section className="camera-panel" aria-labelledby={`${id}-title`}>
      <div className="camera-heading">
        <h2 id={`${id}-title`}>Camera setup</h2>
        <span className="camera-badge">
          {camera.status === 'active' ? 'Camera on' : 'Camera off'}
        </span>
      </div>
      <p className="camera-help">Position yourself so your head and arms fit in the frame.</p>
      <div className="camera-frame">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-label="Mirrored local camera preview"
          hidden={!stream}
        />
        <canvas ref={canvasRef} className="camera-pose" aria-hidden="true" />
        {stream ? (
          <div className="camera-guide" aria-hidden="true" />
        ) : (
          <p>
            {camera.status === 'requesting'
              ? 'Waiting for permission…'
              : 'Your preview will appear here.'}
          </p>
        )}
      </div>
      {stream ? (
        <div className="pose-status">
          <p className="punch-feedback" role="status" aria-live="polite">
            {lastPunch && Date.now() - lastPunch.at < 1800
              ? `${lastPunch.hand === 'left' ? 'Left' : 'Right'} punch detected · local practice`
              : 'Practice input: extend one arm, then return to guard.'}
          </p>
          <p role="status" aria-live="polite">
            {!diagnostics || diagnostics.phase === 'loading'
              ? (diagnostics?.message ?? 'Loading local pose model…')
              : diagnostics.phase === 'error'
                ? diagnostics.message
                : diagnostics.tracking !== 'VALID'
                  ? 'Keep your head, shoulders, elbows, and wrists visible in good lighting.'
                  : diagnostics.pauseRequired
                    ? 'Pose detected. Hold still briefly, then confirm tracking.'
                    : 'Tracking ready.'}
          </p>
          {diagnostics?.phase === 'error' ? (
            <button type="button" onClick={pose.retry}>
              Retry tracking
            </button>
          ) : null}
          {diagnostics?.canResume ? (
            <button type="button" onClick={pose.confirmTracking}>
              Confirm tracking
            </button>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={showOverlay}
              onChange={(event) => setShowOverlay(event.target.checked)}
            />{' '}
            Show landmarks
          </label>
          <details>
            <summary>Developer pose diagnostics</summary>
            <dl>
              <dt>Tracking</dt>
              <dd>{diagnostics?.tracking ?? 'LOST'}</dd>
              <dt>Input gate</dt>
              <dd>{diagnostics?.pauseRequired === false ? 'Ready' : 'Paused'}</dd>
              <dt>Inference rate</dt>
              <dd>{(diagnostics?.inferenceHz ?? 0).toFixed(1)} Hz (target ≥15)</dd>
              <dt>Inference duration</dt>
              <dd>{(diagnostics?.inferenceMs ?? 0).toFixed(1)} ms</dd>
              <dt>Upper-body visibility</dt>
              <dd>{Math.round((diagnostics?.confidence ?? 0) * 100)}% (threshold 60%)</dd>
              <dt>Missing landmarks</dt>
              <dd>{diagnostics?.missingLandmarks.join(', ') || 'None'}</dd>
            </dl>
          </details>
        </div>
      ) : null}
      <p className="camera-status" role="status" aria-live="polite">
        {camera.message}
      </p>
      <div className="camera-controls">
        <label htmlFor={`${id}-device`}>Camera</label>
        <select
          id={`${id}-device`}
          value={camera.deviceId}
          disabled={camera.status === 'requesting'}
          onChange={(event) => {
            const next = event.target.value;
            if (camera.status === 'active') void camera.start(next);
            else camera.setDeviceId(next);
          }}
        >
          <option value="">Default camera</option>
          {camera.devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
        {camera.status === 'active' || camera.status === 'requesting' ? (
          <button type="button" onClick={() => camera.stop()}>
            {camera.status === 'requesting' ? 'Cancel' : 'Stop camera'}
          </button>
        ) : (
          <button type="button" onClick={() => void camera.start()}>
            {camera.status === 'error' ? 'Retry camera' : 'Start camera'}
          </button>
        )}
      </div>
      <p className="camera-help">
        Mirrored preview · Local pose processing · No microphone · Video stays on your device
      </p>
    </section>
  );
}
