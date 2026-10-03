import { useEffect, useId, useRef } from 'react';
import { useCamera } from './useCamera';
import './camera.css';

export function CameraPreview() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
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
      <p className="camera-help">Mirrored preview · No microphone · Video stays on your device</p>
    </section>
  );
}
