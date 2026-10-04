import { Component, Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Link } from 'react-router';
import { PerspectiveCamera } from '@react-three/drei';
import { useCamera } from '../cam/useCamera';
import { useVideoStream } from '../cam/useVideoStream';
import { usePoseLandmarker } from '../motion/usePoseLandmarker';
import { useMotionControls } from '../motion/useMotionControls';
import { MotionSetup } from '../cam/MotionSetup';
import { EYE_FORWARD, EYE_HEIGHT, FirstPersonArms } from './FirstPersonArms';
import { useSkin } from '../avatar/skinStore';
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
          Retry
        </button>
      </div>
    );
  }
}

/** Minimal ring around the player: canvas floor, ropes ahead, and a passive dummy. */
function SparringRoom() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#d8d8cb" roughness={0.9} />
      </mesh>
      {[0.55, 0.95, 1.35].map((y, index) => (
        <mesh key={y} position={[0, y, -3.4]}>
          <boxGeometry args={[7, 0.04, 0.04]} />
          <meshStandardMaterial color={index % 2 ? '#5f98c7' : '#d78342'} />
        </mesh>
      ))}
      {[-3.5, 3.5].map((x) => (
        <mesh key={x} position={[x, 0.8, -3.4]}>
          <cylinderGeometry args={[0.08, 0.08, 1.6, 12]} />
          <meshStandardMaterial color="#2a3440" />
        </mesh>
      ))}
      <group position={[0, 0, -2]}>
        <mesh position={[0, 1.15, 0]}>
          <capsuleGeometry args={[0.24, 0.55, 6, 16]} />
          <meshStandardMaterial color="#da823f" roughness={0.55} />
        </mesh>
        <mesh position={[0, 1.72, 0]}>
          <sphereGeometry args={[0.15, 20, 14]} />
          <meshStandardMaterial color="#da823f" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[0.06, 0.12, 0.9, 12]} />
          <meshStandardMaterial color="#2a3440" />
        </mesh>
      </group>
    </group>
  );
}

export function FirstPersonScreen() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, fail, start } = camera;
  useVideoStream(videoRef, stream, fail);
  const pose = usePoseLandmarker(videoRef, canvasRef, stream, true);
  const diagnostics = pose.diagnostics;
  const skin = useSkin();
  const motion = useMotionControls(pose, stream);

  // Entering this screen is the player's choice to set up, so request the camera now.
  const startOnce = useRef(start);
  useEffect(() => {
    void startOnce.current();
  }, []);

  const status = !stream
    ? camera.message
    : !diagnostics || diagnostics.phase === 'loading'
      ? (diagnostics?.message ?? 'Loading local pose model…')
      : diagnostics.phase === 'error'
        ? diagnostics.message
        : diagnostics.tracking === 'VALID'
          ? 'Tracking both arms.'
          : 'Keep your shoulders, elbows, and wrists in frame.';

  return (
    <main className="fp-screen">
      <div className="fp-scene" aria-label="First-person view of your fighter's arms">
        <SceneBoundary>
          <Canvas dpr={[1, 1.5]}>
            <PerspectiveCamera
              makeDefault
              position={[0, EYE_HEIGHT, -EYE_FORWARD]}
              rotation={[-0.2, 0, 0]}
              fov={70}
              near={0.02}
              far={50}
            />
            <color attach="background" args={['#111a25']} />
            <hemisphereLight args={['#f5f3eb', '#2a3440', 1.2]} />
            <directionalLight position={[2, 5, 2]} intensity={2.2} />
            <SparringRoom />
            <Suspense fallback={null}>
              <FirstPersonArms sampleRef={pose.latestSample} skin={skin} />
            </Suspense>
          </Canvas>
        </SceneBoundary>
      </div>

      <header className="fp-hud">
        <Link className="fp-back" to="/">
          ← Leave practice
        </Link>
        <p className="fp-title">First-person practice</p>
      </header>

      <aside className="fp-camera" aria-label="Camera and tracking">
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
        </div>
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
              {camera.status === 'error' ? 'Retry' : 'Start camera'}
            </button>
          )}
          {diagnostics?.phase === 'error' ? (
            <button type="button" onClick={pose.retry}>
              Retry tracking
            </button>
          ) : null}
        </div>
        {stream ? <MotionSetup motion={motion} pose={pose} /> : null}
      </aside>
    </main>
  );
}
