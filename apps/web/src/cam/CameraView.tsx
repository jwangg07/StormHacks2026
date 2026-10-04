import type { RefObject } from 'react';

export function CameraView({
  videoRef,
  canvasRef,
  stream,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stream: MediaStream | null;
}) {
  return (
    <div className="fp-camera-frame">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Mirrored local camera preview"
        hidden={!stream}
      />
      <canvas ref={canvasRef} className="fp-camera-pose" aria-hidden="true" />
      {!stream ? <span className="fp-preview-placeholder">CAMERA PREVIEW OFF</span> : null}
      <span className="fp-frame-corner fp-frame-corner-a" aria-hidden="true" />
      <span className="fp-frame-corner fp-frame-corner-b" aria-hidden="true" />
    </div>
  );
}
