import { Suspense, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Link } from 'react-router';
import { useCamera } from '../cam/useCamera';
import { useVideoStream } from '../cam/useVideoStream';
import { FighterModel } from '../avatar/FighterModel';
import { MIN_SLOTS_TO_FINISH } from '../avatar/skin/slots';
import { clearSkin, saveSkin, useBlobTexture, useSkinBlob } from '../avatar/skinStore';
import { TurnDial } from '../avatar/TurnDial';
import { useSkinCapture } from '../avatar/useSkinCapture';
import './avatarStudio.css';

const STEPS = ['Camera on', 'Step back', 'Turn around', 'Save'] as const;

export function AvatarPage() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, fail, start } = camera;
  useVideoStream(videoRef, stream, fail);
  const capture = useSkinCapture(videoRef, stream);
  const { state } = capture;
  const savedBlob = useSkinBlob();
  const preview = useBlobTexture(state.result ?? savedBlob);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const saved = state.result !== null && state.result === savedBlob;
  const filled = state.slots.filter(Boolean).length;

  const step = !stream
    ? 0
    : state.phase === 'capturing'
      ? 2
      : state.phase === 'baking' || state.phase === 'review'
        ? 3
        : 1;
  const message = !stream
    ? camera.message
    : saved
      ? (storageNote ?? 'Saved. Your fighter wears this skin in the lobby and the ring.')
      : capture.message;

  async function save() {
    if (!state.result) return;
    const persisted = await saveSkin(state.result);
    setStorageNote(persisted ? null : 'Saved for this session only. This browser is blocking local storage.');
  }

  let actions: ReactNode = null;
  if (!stream)
    actions = (
      <button className="studio-primary" type="button" disabled={camera.status === 'requesting'} onClick={() => void start()}>
        {camera.status === 'error' ? 'Retry camera' : 'Turn camera on'}
      </button>
    );
  else if (state.phase === 'framing')
    actions = state.armed ? (
      <button className="studio-secondary" type="button" onClick={capture.disarm}>
        Cancel
      </button>
    ) : (
      <button className="studio-primary" type="button" onClick={capture.arm}>
        Start scan
      </button>
    );
  else if (state.phase === 'capturing')
    actions = (
      <>
        {filled >= MIN_SLOTS_TO_FINISH ? (
          <button className="studio-primary" type="button" onClick={capture.finish}>
            Finish now
          </button>
        ) : null}
        <button className="studio-secondary" type="button" onClick={capture.cancel}>
          Cancel
        </button>
      </>
    );
  else if (state.phase === 'review')
    actions = (
      <>
        {saved ? null : (
          <button className="studio-primary" type="button" onClick={() => void save()}>
            Save skin
          </button>
        )}
        <button className="studio-secondary" type="button" onClick={capture.retake}>
          Scan again
        </button>
      </>
    );
  else if (state.phase === 'error')
    actions = (
      <button className="studio-primary" type="button" onClick={capture.retry}>
        Retry
      </button>
    );

  return (
    <main className="subpage">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="Return to lobby">
          <span className="wordmark-mark" aria-hidden="true" />
          WebcamBoxer
        </Link>
        <Link className="back-link" to="/">
          ← Back to lobby
        </Link>
      </header>
      <section className="studio">
        <div className="studio-panel">
          <span className="section-kicker">AVATAR STUDIO</span>
          <h1>Scan yourself in.</h1>
          <p className="studio-lede">
            Turn on your camera, step back so your whole body is in frame, and turn slowly in a full
            circle. Your look is painted onto your fighter. Camera frames stay on this device.
          </p>
          <ol className="studio-steps">
            {STEPS.map((label, index) => (
              <li
                key={label}
                data-state={index < step || (index === 3 && saved) ? 'done' : index === step ? 'current' : 'todo'}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {label}
              </li>
            ))}
          </ol>
          <div className="studio-camera">
            <video ref={videoRef} autoPlay muted playsInline aria-label="Mirrored camera preview" hidden={!stream} />
            {stream ? (
              <TurnDial slots={state.slots} yawDeg={state.phase === 'capturing' ? state.yawDeg : null} />
            ) : (
              <span className="studio-camera-off">CAMERA OFF</span>
            )}
          </div>
          <p className="studio-status" role="status" aria-live="polite">
            {message}
          </p>
          <div className="studio-actions">
            {actions}
            {savedBlob ? (
              <button className="studio-link" type="button" onClick={() => void clearSkin()}>
                Use default skin
              </button>
            ) : null}
          </div>
        </div>
        <div className="studio-stage" aria-label="Preview of your fighter">
          <Canvas camera={{ position: [0, 1.1, 3.6], fov: 35 }} dpr={[1, 1.5]}>
            <hemisphereLight args={['#f5f3eb', '#2a3440', 1.3]} />
            <directionalLight position={[2, 4, 3]} intensity={2} color="#f4d4a5" />
            <directionalLight position={[-3, 2, -3]} intensity={0.8} color="#53a9d7" />
            <Suspense fallback={null}>
              <FighterModel skin={preview} pose="relaxed" />
            </Suspense>
            <OrbitControls
              target={[0, 0.95, 0]}
              autoRotate
              autoRotateSpeed={1.2}
              enablePan={false}
              enableZoom={false}
              minPolarAngle={1.2}
              maxPolarAngle={1.9}
            />
          </Canvas>
          <span className="studio-stage-note">
            {!preview ? 'DEFAULT SKIN' : state.result && !saved ? 'PREVIEW · NOT SAVED' : 'YOUR SKIN'} · DRAG TO SPIN
          </span>
        </div>
      </section>
    </main>
  );
}
