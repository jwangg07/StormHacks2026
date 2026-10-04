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
import { useSurface } from '../game/surfaces';
import './avatarStudio.css';

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

  const message = !stream
    ? camera.message
    : saved
      ? (storageNote ?? 'Saved. Your fighter wears this skin in the lobby and the ring.')
      : capture.message;

  async function save() {
    if (!state.result) return;
    const persisted = await saveSkin(state.result);
    setStorageNote(
      persisted ? null : 'Saved for this session only. This browser is blocking local storage.',
    );
  }

  let actions: ReactNode = null;
  if (!stream) {
    actions = (
      <button
        className="avatar-primary"
        type="button"
        disabled={camera.status === 'requesting'}
        onClick={() => void start()}
      >
        {camera.status === 'requesting'
          ? 'Waiting for camera'
          : camera.status === 'error'
            ? 'Retry camera'
            : 'Turn camera on'}
      </button>
    );
  } else if (state.phase === 'framing') {
    actions = state.armed ? (
      <button className="avatar-secondary" type="button" onClick={capture.disarm}>
        Cancel scan
      </button>
    ) : (
      <button className="avatar-primary" type="button" onClick={capture.arm}>
        Start scan
      </button>
    );
  } else if (state.phase === 'capturing') {
    actions = (
      <>
        {filled >= MIN_SLOTS_TO_FINISH ? (
          <button className="avatar-primary" type="button" onClick={capture.finish}>
            Finish scan
          </button>
        ) : null}
        <button className="avatar-secondary" type="button" onClick={capture.cancel}>
          Cancel scan
        </button>
      </>
    );
  } else if (state.phase === 'review') {
    actions = (
      <>
        {saved ? null : (
          <button className="avatar-primary" type="button" onClick={() => void save()}>
            Save fighter skin
          </button>
        )}
        <button className="avatar-secondary" type="button" onClick={capture.retake}>
          Scan again
        </button>
      </>
    );
  } else if (state.phase === 'error') {
    actions = (
      <button className="avatar-primary" type="button" onClick={capture.retry}>
        Retry scan
      </button>
    );
  }

  const scanActive = state.phase === 'capturing' || state.phase === 'baking';
  const phaseLabel =
    state.phase === 'capturing'
      ? `ANGLE CAPTURE ${String(filled).padStart(2, '0')} / 08`
      : state.phase === 'baking'
        ? 'BUILDING FIGHTER SKIN'
        : state.phase === 'review'
          ? saved
            ? 'FIGHTER SKIN SAVED'
            : 'PREVIEW READY'
          : state.phase === 'error'
            ? 'SCAN INTERRUPTED'
            : stream
              ? state.armed
                ? 'FIND YOUR FRAME'
                : 'READY TO SCAN'
              : 'SCAN IDENTITY';

  return (
    <main className="avatar-room">
      <Link className="avatar-back" to="/" aria-label="Back to lobby">
        <span aria-hidden="true">&lt;</span> LOBBY
      </Link>
      <section
        className={`avatar-stage${scanActive ? ' is-scanning' : ''}`}
        aria-label="Interactive fighter preview"
      >
        <div className="avatar-stage-grid" aria-hidden="true" />
        <div className="avatar-stage-halo" aria-hidden="true" />
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ position: [0, 1.15, 3.8], fov: 31 }}
        >
          <color attach="background" args={['#181c1a']} />
          <fog attach="fog" args={['#181c1a', 8, 19]} />
          <hemisphereLight args={['#d7c9a5', '#171b1b', 1.05]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[2, 5, 4]} intensity={1.6} color="#f0d3a0" castShadow />
          <spotLight
            position={[-1, 6, 1]}
            angle={0.52}
            penumbra={0.7}
            intensity={52}
            distance={14}
            color="#e6bd80"
            castShadow
          />
          <directionalLight position={[-3, 2, -3]} intensity={0.85} color="#81908b" />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
            <planeGeometry args={[18, 18]} />
            <meshStandardMaterial color="#272a26" roughness={1} flatShading />
          </mesh>
          <Pedestal />
          <Suspense fallback={null}>
            <FighterModel skin={preview} pose="relaxed" />
          </Suspense>
          <OrbitControls
            target={[0, 0.95, 0]}
            autoRotate
            autoRotateSpeed={0.4}
            enableDamping
            dampingFactor={0.06}
            enablePan={false}
            enableZoom
            minDistance={2.8}
            maxDistance={5.4}
            minPolarAngle={1.1}
            maxPolarAngle={1.95}
          />
        </Canvas>

        {scanActive ? (
          <>
            <div className="avatar-scan-reticle" aria-hidden="true">
              <span />
            </div>
            <div className="avatar-scan-sweep" aria-hidden="true" />
          </>
        ) : null}
        <span className="avatar-stage-index">AVATAR EDITOR</span>
        <div className="avatar-stage-corners" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="avatar-rotate-hint">
          DRAG TO ROTATE <i /> SCROLL TO ZOOM
        </span>
        <div
          className={`avatar-instruction${state.phase === 'review' ? ' is-transient' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span key={phaseLabel} className="avatar-instruction-kicker">
            {phaseLabel}
          </span>
          <p key={message} className="avatar-instruction-text">
            {message}
          </p>
        </div>
      </section>

      <aside
        className={`avatar-scan-console${stream ? ' has-camera' : ''}`}
        aria-label="Fighter skin scan"
      >
        <div className="avatar-console-copy">
          <div className="avatar-actions">
            {actions}
            {savedBlob ? (
              <button
                className="avatar-default-action"
                type="button"
                onClick={() => void clearSkin()}
              >
                Default skin
              </button>
            ) : null}
          </div>
        </div>

        {stream ? (
          <div className="avatar-live-preview">
            <span className="avatar-live-label">
              <i /> LIVE CAMERA
            </span>
            <div className="avatar-camera-view">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                aria-label="Mirrored full-body camera preview"
              />
              <span className="avatar-camera-corner avatar-camera-a" aria-hidden="true" />
              <span className="avatar-camera-corner avatar-camera-b" aria-hidden="true" />
            </div>
          </div>
        ) : null}

        {scanActive ? (
          <div className="avatar-scan-progress" aria-label={`${filled} of 8 scan angles captured`}>
            <TurnDial slots={state.slots} yawDeg={state.yawDeg} />
            <span>
              <b>{String(filled).padStart(2, '0')}</b>
              <small>/ 08 ANGLES</small>
            </span>
          </div>
        ) : null}
      </aside>
    </main>
  );
}

/** Same concrete plinth and diamond-plate top as the lobby's avatar podium. */
function Pedestal() {
  const plinth = useSurface('concrete', 7, 0.18);
  const plate = useSurface('diamondPlate', 2, 2);
  return (
    <>
      <mesh position={[0, -0.08, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.08, 1.18, 0.18, 10]} />
        <meshStandardMaterial map={plinth} color="#4d483c" roughness={0.94} flatShading />
      </mesh>
      <mesh position={[0, 0.018, 0]} receiveShadow>
        <cylinderGeometry args={[1.02, 1.08, 0.035, 10]} />
        <meshStandardMaterial map={plate} color="#88785c" roughness={0.9} flatShading />
      </mesh>
    </>
  );
}
