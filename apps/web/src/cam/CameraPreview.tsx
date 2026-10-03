import { useEffect, useId, useRef, useState } from 'react';
import { useCamera } from './useCamera';
import { usePoseLandmarker } from '../motion/usePoseLandmarker';
import './camera.css';

export function CameraPreview() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const id = useId();
  const { stream, fail } = camera;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    let cancelled = false;
    video.srcObject = stream;
    void video.play().catch(() => {
      if (!cancelled) fail('Camera playback failed. Retry to restart the preview.');
    });
    return () => {
      cancelled = true;
      video.pause();
      video.srcObject = null;
    };
  }, [stream, fail]);

  const pose = usePoseLandmarker(videoRef, canvasRef, stream, showOverlay);
  const diagnostics = pose.diagnostics;

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
