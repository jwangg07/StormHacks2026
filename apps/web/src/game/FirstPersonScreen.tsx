import { Component, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { Link } from 'react-router';
import { PerspectiveCamera } from '@react-three/drei';
import { useCamera } from '../cam/useCamera';
import { CameraView } from '../cam/CameraView';
import { useVideoStream } from '../cam/useVideoStream';
import { MotionSetup } from '../cam/MotionSetup';
import { CalibrationDialog } from '../cam/CalibrationDialog';
import { usePoseLandmarker } from '../motion/usePoseLandmarker';
import { useMotionControls } from '../motion/useMotionControls';
import { EYE_FORWARD, EYE_HEIGHT, FirstPersonArms } from './FirstPersonArms';
import { useSkin } from '../avatar/skinStore';
import { useMultiplayerFight } from '../net/useMultiplayerFight';
import './firstPerson.css';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fp-error" role="alert">
        <p>The 3D view could not load. Check WebGL support and the fighter model, then retry.</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          Retry view
        </button>
      </div>
    );
  }
}

function HeavyBag() {
  const bag = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (bag.current) bag.current.rotation.z = Math.sin(clock.elapsedTime * 0.55) * 0.035;
  });
  return (
    <group ref={bag} position={[0, 1.38, -7.1]}>
      <mesh position={[0, 1.45, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.15, 6]} />
        <meshStandardMaterial color="#6d6654" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.56, 1.55, 9, 1]} />
        <meshStandardMaterial color="#75452f" roughness={0.98} flatShading />
      </mesh>
      {[-0.53, 0.55].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <torusGeometry args={[y < 0 ? 0.43 : 0.41, 0.035, 4, 9]} />
          <meshStandardMaterial color="#aa7952" roughness={1} flatShading />
        </mesh>
      ))}
      {[-0.27, 0.28].map((x) => (
        <mesh key={x} position={[x, -0.24, 0.425]} rotation={[0, 0, -0.15]}>
          <boxGeometry args={[0.12, 0.42, 0.025]} />
          <meshStandardMaterial color="#c4a980" roughness={1} flatShading />
        </mesh>
      ))}
      <mesh position={[0, -0.8, 0]}>
        <cylinderGeometry args={[0.18, 0.26, 0.13, 8]} />
        <meshStandardMaterial color="#392c26" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <torusGeometry args={[0.32, 0.045, 4, 8]} />
        <meshStandardMaterial color="#4a392f" roughness={1} flatShading />
      </mesh>
    </group>
  );
}

function SparringRoom() {
  const sides = [-1, 1];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, -7]} receiveShadow>
        <planeGeometry args={[22, 27]} />
        <meshStandardMaterial color="#282925" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, -0.13, -6]} receiveShadow castShadow>
        <boxGeometry args={[10.5, 0.3, 12]} />
        <meshStandardMaterial color="#473f33" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, 0.03, -6]} receiveShadow>
        <boxGeometry args={[10.1, 0.05, 11.6]} />
        <meshStandardMaterial color="#81745c" roughness={1} flatShading />
      </mesh>
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={`seam-${index}`} position={[-4.45 + index * 1.1, 0.058, -6]}>
          <boxGeometry args={[0.016, 0.006, 11.35]} />
          <meshStandardMaterial color="#574e3f" roughness={1} />
        </mesh>
      ))}
      {[-8.2, -3.8, 1.5].map((z, index) => (
        <mesh key={`wear-${z}`} position={[0, 0.061, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.48 + index * 0.06, 0.51 + index * 0.06, 8]} />
          <meshBasicMaterial color="#615843" transparent opacity={0.45} />
        </mesh>
      ))}

      {sides.flatMap((side) =>
        [-10.9, -6, -1.1].map((z) => (
          <group key={`post-${side}-${z}`} position={[side * 5.1, 0, z]}>
            <mesh position={[0, 1.02, 0]} castShadow>
              <boxGeometry args={[0.2, 2.1, 0.2]} />
              <meshStandardMaterial color="#343735" roughness={0.9} flatShading />
            </mesh>
            <mesh position={[0, 1.86, 0.09]}>
              <boxGeometry args={[0.31, 0.42, 0.12]} />
              <meshStandardMaterial color="#784d37" roughness={1} flatShading />
            </mesh>
          </group>
        )),
      )}
      {[0.52, 0.91, 1.3, 1.69].map((y, index) => (
        <group key={`rope-${y}`}>
          <mesh position={[0, y, -10.9]}>
            <boxGeometry args={[10.2, 0.055, 0.055]} />
            <meshStandardMaterial
              color={index % 2 ? '#75634b' : '#a49679'}
              roughness={1}
              flatShading
            />
          </mesh>
          {sides.map((side) => (
            <mesh key={side} position={[side * 5.1, y, -6]}>
              <boxGeometry args={[0.055, 0.055, 9.8]} />
              <meshStandardMaterial color="#85755a" roughness={1} flatShading />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[0, 3.4, -14.2]} receiveShadow>
        <boxGeometry args={[23, 7, 0.5]} />
        <meshStandardMaterial color="#393b35" roughness={1} flatShading />
      </mesh>
      <mesh position={[-5.1, 2.2, -13.92]}>
        <boxGeometry args={[1.4, 2.15, 0.05]} />
        <meshStandardMaterial color="#8a563d" roughness={1} flatShading />
      </mesh>
      <mesh position={[-5.1, 2.2, -13.88]}>
        <boxGeometry args={[1.16, 1.88, 0.03]} />
        <meshStandardMaterial color="#b89464" roughness={1} flatShading />
      </mesh>
      <mesh position={[-5.1, 2.4, -13.84]}>
        <boxGeometry args={[0.72, 0.08, 0.02]} />
        <meshStandardMaterial color="#794d37" roughness={1} flatShading />
      </mesh>
      {[-8.5, 8.5].map((x) => (
        <group key={`bench-${x}`} position={[x, 0, -10]}>
          <mesh position={[0, 0.44, 0]}>
            <boxGeometry args={[2.4, 0.16, 0.55]} />
            <meshStandardMaterial color="#4b4034" roughness={1} flatShading />
          </mesh>
          {[-0.8, 0.8].map((leg) => (
            <mesh key={leg} position={[leg, 0.22, 0]}>
              <boxGeometry args={[0.09, 0.44, 0.42]} />
              <meshStandardMaterial color="#343735" roughness={1} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      <HeavyBag />
      {[-4.2, 4.2].map((x) => (
        <group key={`lamp-${x}`} position={[x, 4.4, -4.5]}>
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.3, 6]} />
            <meshStandardMaterial color="#242724" roughness={1} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <coneGeometry args={[0.45, 0.25, 6]} />
            <meshStandardMaterial color="#4f4b40" roughness={1} flatShading />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <boxGeometry args={[0.5, 0.035, 0.24]} />
            <meshStandardMaterial color="#ddba7e" emissive="#d5a85f" emissiveIntensity={0.42} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function FirstPersonScreen() {
  const [setupOpen, setSetupOpen] = useState(false);
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, fail, start } = camera;
  const pose = usePoseLandmarker(videoRef, canvasRef, stream, true);
  const diagnostics = pose.diagnostics;
  const skin = useSkin();
  const motion = useMotionControls(pose, stream);
  const calibrationOpen = motion.snapshot?.ready !== true;
  useVideoStream(videoRef, stream, fail, calibrationOpen ? 'dialog' : 'panel');
  const fight = useMultiplayerFight(motion);

  // Entering this screen is the player's choice to set up, so request the camera now.
  const startOnce = useRef(start);

  useEffect(() => {
    void startOnce.current();
  }, []);

  const status = !stream
    ? camera.message
    : !diagnostics || diagnostics.phase === 'loading'
      ? (diagnostics?.message ?? 'Loading local pose model...')
      : diagnostics.phase === 'error'
        ? diagnostics.message
        : diagnostics.tracking === 'VALID'
          ? 'Tracking both arms.'
          : 'Keep your shoulders, elbows, and wrists in frame.';

  return (
    <main className="fp-screen">
      <div className="fp-scene" aria-label="First-person view of your fighter in the ring">
        <SceneBoundary>
          <Canvas
            dpr={[1, 1]}
            shadows
            gl={{ antialias: false, powerPreference: 'high-performance' }}
          >
            <PerspectiveCamera
              makeDefault
              position={[0, EYE_HEIGHT, -EYE_FORWARD]}
              rotation={[-0.2, 0, 0]}
              fov={70}
              near={0.02}
              far={50}
            />
            <color attach="background" args={['#171a18']} />
            <fog attach="fog" args={['#171a18', 12, 27]} />
            <hemisphereLight args={['#c9b58c', '#171918', 0.95]} />
            <ambientLight intensity={0.3} />
            <directionalLight position={[2, 6, 1]} intensity={1.4} color="#f0d4a5" />
            <spotLight
              position={[-1, 5, -3]}
              angle={0.62}
              penumbra={0.65}
              intensity={42}
              distance={18}
              color="#e5bc7e"
            />
            <SparringRoom />
            <Suspense fallback={null}>
              <FirstPersonArms sampleRef={pose.latestSample} skin={skin} />
            </Suspense>
          </Canvas>
        </SceneBoundary>
      </div>
      <div className="fp-film-grain" aria-hidden="true" />

      <header className="fp-hud" aria-label="Sparring controls">
        <Link className="fp-back" to="/">
          LEAVE THE RING
        </Link>
        <div className="fp-session-display">
          <span className="fp-session-mark">
            WEBCAM BOXER
            <i /> TEST ENVIRONMENT
          </span>
          <p className="fp-title">
            {fight.connectionState === 'FIGHTING'
              ? `Fight · ${fight.snapshot?.players.A.hp ?? 100}–${fight.snapshot?.players.B.hp ?? 100}`
              : `Multiplayer · ${fight.connectionState.toLowerCase()}`}
          </p>
        </div>
        <button
          className="fp-setup-toggle"
          type="button"
          aria-expanded={setupOpen}
          aria-controls="fp-camera-panel"
          onClick={() => setSetupOpen((open) => !open)}
        >
          <span className="fp-toggle-mark" aria-hidden="true">
            {setupOpen ? '[-]' : '[+]'}
          </span>
          {setupOpen ? 'HIDE SETUP' : 'MOVEMENT SETUP'}
        </button>
      </header>

      <aside
        id="fp-camera-panel"
        className="fp-camera"
        aria-label="Camera and movement controls"
        hidden={!setupOpen}
      >
        <div className="fp-panel-heading">
          <div>
            <span className="fp-panel-kicker">TRAINER'S CORNER</span>
            <h1>Movement controls</h1>
          </div>
          <span className="fp-step-stamp">01</span>
        </div>
        {!calibrationOpen ? (
          <CameraView videoRef={videoRef} canvasRef={canvasRef} stream={stream} />
        ) : null}
        <div className="fp-camera-bar">
          <span
            className="fp-dot"
            data-state={diagnostics?.phase === 'ready' ? diagnostics.tracking : 'LOST'}
            aria-hidden="true"
          />
          <p role="status" aria-live="polite">
            {status}
          </p>
          {camera.status === 'active' || camera.status === 'requesting' ? null : (
            <button type="button" onClick={() => void start()}>
              {camera.status === 'error' ? 'RETRY CAMERA' : 'START CAMERA'}
            </button>
          )}
          {diagnostics?.phase === 'error' ? (
            <button type="button" onClick={pose.retry}>
              RETRY TRACKING
            </button>
          ) : null}
        </div>
        {stream ? <MotionSetup motion={motion} pose={pose} /> : null}
      </aside>

      {calibrationOpen ? (
        <CalibrationDialog
          camera={camera}
          motion={motion}
          pose={pose}
          videoRef={videoRef}
          canvasRef={canvasRef}
        />
      ) : null}

      <div className="fp-floor-mark" aria-hidden="true">
        <span>WEBCAM BOXER</span>
        <i /> <span>PRE-ALPHA 2026-10-03</span>
      </div>
    </main>
  );
}
