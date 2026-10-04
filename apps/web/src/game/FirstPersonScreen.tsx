import { Component, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group, MeshStandardMaterial } from 'three';
import { Link } from 'react-router';
import { Html, PerspectiveCamera } from '@react-three/drei';
import type { MotionFrame } from '@wb/motion';
import { useCamera } from '../cam/useCamera';
import { CameraView } from '../cam/CameraView';
import { useVideoStream } from '../cam/useVideoStream';
import { MotionSetup } from '../cam/MotionSetup';
import { CalibrationDialog } from '../cam/CalibrationDialog';
import { usePoseLandmarker } from '../motion/usePoseLandmarker';
import { useMotionControls } from '../motion/useMotionControls';
import { EYE_FORWARD, EYE_HEIGHT, FirstPersonArms } from './FirstPersonArms';
import { useSkin } from '../avatar/skinStore';
import { useBlobTexture, useSkinBlob } from '../avatar/skinStore';
import { useMultiplayer } from '../net/MultiplayerProvider';
import { publishSkin, useOpponentSkinBlob } from '../net/skinSync';
import { useMultiplayerFight } from '../net/useMultiplayerFight';
import { dodgeView, PUNCH_IMPACT_MS } from './boxingAnimation';
import { useSurface } from './surfaces';
import { useSoloTraining } from './useSoloTraining';
import type { PunchCue } from './boxingAnimation';
import { OpponentFighter } from './OpponentFighter';
import './firstPerson.css';

const COUNTDOWN_STEP_MS = 1_140;

function FightStartSequence({
  connectionState,
  countdownStartsAt,
}: {
  connectionState: ReturnType<typeof useMultiplayerFight>['connectionState'];
  countdownStartsAt: number | null;
}) {
  const introAudio = useRef<HTMLAudioElement>(null);
  const loopAudio = useRef<HTMLAudioElement>(null);
  const introStarted = useRef(false);
  const [cueTime, setCueTime] = useState(() => Date.now());

  useEffect(() => {
    if (countdownStartsAt === null) return;
    if (connectionState === 'COUNTDOWN') {
      const timer = window.setInterval(() => setCueTime(Date.now()), 50);
      return () => window.clearInterval(timer);
    }
    if (connectionState === 'FIGHTING') {
      const remaining = Math.max(0, countdownStartsAt + COUNTDOWN_STEP_MS - Date.now());
      const timer = window.setTimeout(() => setCueTime(Date.now()), remaining);
      return () => window.clearTimeout(timer);
    }
  }, [connectionState, countdownStartsAt]);

  useEffect(() => {
    const intro = introAudio.current;
    const loop = loopAudio.current;

    if (connectionState === 'COUNTDOWN' && !introStarted.current) {
      introStarted.current = true;
      if (intro) {
        intro.currentTime = 0;
        void intro.play().catch(() => {
          // Browsers can still deny audible autoplay despite the earlier setup interaction.
        });
      }
      return;
    }

    if (connectionState === 'READY' || connectionState === 'CALIBRATING') {
      introStarted.current = false;
      if (intro) {
        intro.pause();
        intro.currentTime = 0;
      }
      if (loop) {
        loop.pause();
        loop.currentTime = 0;
      }
    }
  }, [connectionState]);

  const startLoop = () => {
    const loop = loopAudio.current;
    if (!loop) return;
    loop.currentTime = 0;
    void loop.play().catch(() => {
      // Leave playback stopped if the browser revokes media permission.
    });
  };

  const elapsed =
    countdownStartsAt === null ? 0 : 3 * COUNTDOWN_STEP_MS - (countdownStartsAt - cueTime);
  const cueIndex = Math.max(0, Math.min(2, Math.floor(elapsed / COUNTDOWN_STEP_MS)));
  const countdownCue = connectionState === 'COUNTDOWN' ? String(3 - cueIndex) : null;
  const fightCue =
    connectionState === 'FIGHTING' &&
    countdownStartsAt !== null &&
    cueTime < countdownStartsAt + COUNTDOWN_STEP_MS;

  return (
    <>
      <audio ref={introAudio} src="/fight-intro.mp3" preload="auto" onEnded={startLoop} />
      <audio ref={loopAudio} src="/fight-loop.mp3" preload="auto" loop />
      {countdownCue || fightCue ? (
        <div
          className="fp-fight-countdown"
          data-fight={fightCue || undefined}
          role="status"
          aria-live="assertive"
          aria-atomic="true"
        >
          <span key={countdownCue ?? 'fight'}>{countdownCue ?? 'FIGHT'}</span>
        </div>
      ) : null}
    </>
  );
}

const CAMERA_POSITION: [number, number, number] = [0, EYE_HEIGHT, -EYE_FORWARD];
const CAMERA_ROTATION: [number, number, number] = [-0.2, 0, 0];
const formatWorkoutClock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function HealthBar({
  label,
  hp,
  opponent = false,
}: {
  label: string;
  hp: number;
  opponent?: boolean;
}) {
  const bounded = Math.max(0, Math.min(100, hp));
  return (
    <div className="fp-health" data-opponent={opponent || undefined}>
      <div className="fp-health-label">
        <span>{label}</span>
        <strong>{Number.isInteger(bounded) ? bounded : bounded.toFixed(1)}</strong>
      </div>
      <div
        className="fp-health-track"
        role="progressbar"
        aria-label={`${label} health`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
      >
        <i style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

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

function DodgeCamera({ controlsRef }: { controlsRef: RefObject<MotionFrame> }) {
  useFrame(({ camera }, dt) => {
    const target = dodgeView(controlsRef.current.dodge);
    const alpha = 1 - Math.exp(-dt / 0.07);
    camera.position.x += (target.x - camera.position.x) * alpha;
    camera.rotation.z += (target.roll - camera.rotation.z) * alpha;
  });
  return (
    <PerspectiveCamera
      makeDefault
      position={CAMERA_POSITION}
      rotation={CAMERA_ROTATION}
      fov={70}
      near={0.02}
      far={50}
    />
  );
}

function HeavyBag({ impact }: { impact: PunchCue | null }) {
  const bag = useRef<Group>(null);
  const bodyMaterial = useRef<MeshStandardMaterial>(null);
  const lastImpact = useRef<number | null>(null);
  const flashAt = useRef(-Infinity);
  // Four stitched panels around the bag, two courses high.
  const hide = useSurface('leather', 3.2, 1.6);
  useFrame(({ clock }) => {
    if (impact && lastImpact.current !== impact.id) {
      lastImpact.current = impact.id;
      flashAt.current = performance.now();
    }
    const age = performance.now() - flashAt.current;
    const flash = Math.max(0, 1 - age / 240);
    if (bodyMaterial.current) {
      bodyMaterial.current.color
        .set('#75452f')
        .lerp(bodyMaterial.current.emissive.set('#ff2128'), flash * 0.85);
      bodyMaterial.current.emissiveIntensity = flash * 2;
    }
    if (bag.current) {
      const recoil = age < 650 ? Math.sin(age / 85) * Math.exp(-age / 260) * 0.18 : 0;
      bag.current.rotation.z =
        Math.sin(clock.elapsedTime * 0.55) * 0.035 + recoil * (impact?.hand === 'left' ? 1 : -1);
    }
  });
  return (
    <group ref={bag} position={[0, 1.38, -1.3]}>
      <mesh position={[0, 1.45, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.15, 6]} />
        <meshStandardMaterial color="#6d6654" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.42, 0.56, 1.55, 9, 1]} />
        <meshStandardMaterial
          ref={bodyMaterial}
          map={hide}
          color="#75452f"
          roughness={0.98}
          flatShading
        />
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
      {impact ? (
        <Html
          key={impact.id}
          center
          position={[impact.hand === 'left' ? -0.2 : 0.2, 0.16, 0.6]}
          distanceFactor={1.9}
        >
          <span className="fp-hit-marker">Hit!</span>
        </Html>
      ) : null}
    </group>
  );
}

function SparringRoom({
  impact,
  showPracticeBag,
}: {
  impact: PunchCue | null;
  showPracticeBag: boolean;
}) {
  const sides = [-1, 1];
  const floor = useSurface('planks', 22, 27);
  const platform = useSurface('padding', 10.5, 0.3);
  // The panel seams in the canvas run the length of the mat.
  const mat = useSurface('canvasPanel', 10.1, 11.6);
  const post = useSurface('paintedMetal', 0.2, 2.1);
  const backRope = useSurface('rope', 10.2, 0.055);
  const sideRope = useSurface('rope', 9.8, 0.055);
  const wall = useSurface('cinderBlock', 23, 7);
  const doorFrame = useSurface('wood', 1.4, 2.15, { vertical: true });
  const doorPanel = useSurface('wood', 1.16, 1.88, { vertical: true });
  const seat = useSurface('wood', 2.4, 0.55);
  const benchLeg = useSurface('paintedMetal', 0.42, 0.44);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, -7]} receiveShadow>
        <planeGeometry args={[22, 27]} />
        <meshStandardMaterial map={floor} color="#282925" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, -0.13, -6]} receiveShadow castShadow>
        <boxGeometry args={[10.5, 0.3, 12]} />
        <meshStandardMaterial map={platform} color="#473f33" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, 0.03, -6]} receiveShadow>
        <boxGeometry args={[10.1, 0.05, 11.6]} />
        <meshStandardMaterial map={mat} color="#81745c" roughness={1} flatShading />
      </mesh>
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
              <meshStandardMaterial map={post} color="#343735" roughness={0.9} flatShading />
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
              map={backRope}
              color={index % 2 ? '#75634b' : '#a49679'}
              roughness={1}
              flatShading
            />
          </mesh>
          {sides.map((side) => (
            <mesh key={side} position={[side * 5.1, y, -6]}>
              <boxGeometry args={[0.055, 0.055, 9.8]} />
              <meshStandardMaterial map={sideRope} color="#85755a" roughness={1} flatShading />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[0, 3.4, -14.2]} receiveShadow>
        <boxGeometry args={[23, 7, 0.5]} />
        <meshStandardMaterial map={wall} color="#393b35" roughness={1} flatShading />
      </mesh>
      <mesh position={[-5.1, 2.2, -13.92]}>
        <boxGeometry args={[1.4, 2.15, 0.05]} />
        <meshStandardMaterial map={doorFrame} color="#8a563d" roughness={1} flatShading />
      </mesh>
      <mesh position={[-5.1, 2.2, -13.88]}>
        <boxGeometry args={[1.16, 1.88, 0.03]} />
        <meshStandardMaterial map={doorPanel} color="#b89464" roughness={1} flatShading />
      </mesh>
      <mesh position={[-5.1, 2.4, -13.84]}>
        <boxGeometry args={[0.72, 0.08, 0.02]} />
        <meshStandardMaterial color="#794d37" roughness={1} flatShading />
      </mesh>
      {[-8.5, 8.5].map((x) => (
        <group key={`bench-${x}`} position={[x, 0, -10]}>
          <mesh position={[0, 0.44, 0]}>
            <boxGeometry args={[2.4, 0.16, 0.55]} />
            <meshStandardMaterial map={seat} color="#4b4034" roughness={1} flatShading />
          </mesh>
          {[-0.8, 0.8].map((leg) => (
            <mesh key={leg} position={[leg, 0.22, 0]}>
              <boxGeometry args={[0.09, 0.44, 0.42]} />
              <meshStandardMaterial map={benchLeg} color="#343735" roughness={1} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      {showPracticeBag ? <HeavyBag impact={impact} /> : null}
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
  const [punch, setPunch] = useState<PunchCue | null>(null);
  const [impact, setImpact] = useState<PunchCue | null>(null);
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stream, fail, start } = camera;
  const pose = usePoseLandmarker(videoRef, canvasRef, stream, true);
  const diagnostics = pose.diagnostics;
  const skin = useSkin();
  const skinBlob = useSkinBlob();
  const motion = useMotionControls(pose, stream);
  const { subscribeControls } = motion;
  const calibrationOpen = motion.snapshot?.ready !== true;
  useVideoStream(videoRef, stream, fail, calibrationOpen ? 'dialog' : 'ring');
  const fight = useMultiplayerFight(motion);
  const soloWorkout = useSoloTraining(motion, !fight.assignment);
  const { socket, assignment, leaveFight } = useMultiplayer();
  const opponentSkin = useBlobTexture(useOpponentSkinBlob(socket));
  const ownSeat = assignment?.seat;
  const opponentSeat = ownSeat === 'A' ? 'B' : 'A';
  const ownHealth = ownSeat ? (fight.snapshot?.players[ownSeat].hp ?? 100) : 100;
  const opponentHealth = ownSeat ? (fight.snapshot?.players[opponentSeat].hp ?? 100) : 100;
  const winnerSeat = fight.snapshot?.result?.winnerSeat;
  const trackingLostSeat = fight.snapshot
    ? (['A', 'B'] as const).find((seat) => fight.snapshot?.players[seat].tracking !== 'VALID')
    : undefined;

  useEffect(() => {
    if (assignment && skinBlob) void publishSkin(socket, skinBlob);
  }, [assignment, skinBlob, socket]);

  useEffect(
    () =>
      subscribeControls((frame) => {
        if (frame.tracking !== 'VALID' || !frame.punch) return;
        setPunch({
          id: frame.timestamp,
          hand: frame.punch,
          move: frame.move ?? (frame.punch === 'left' ? 'jab' : 'cross'),
          at: performance.now(),
        });
      }),
    [subscribeControls],
  );

  useEffect(() => {
    if (!punch) return;
    const contact = window.setTimeout(() => setImpact(punch), PUNCH_IMPACT_MS);
    const clear = window.setTimeout(() => setImpact(null), PUNCH_IMPACT_MS + 650);
    const release = window.setTimeout(() => setPunch(null), 1000);
    return () => {
      window.clearTimeout(contact);
      window.clearTimeout(clear);
      window.clearTimeout(release);
    };
  }, [punch]);

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
          ? diagnostics.missingLandmarks.length
            ? 'Tracking visible movements. Keep both arms in view.'
            : 'Tracking both arms.'
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
            <DodgeCamera controlsRef={motion.latestControls} />
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
            <SparringRoom impact={impact} showPracticeBag={!fight.assignment} />
            <Suspense fallback={null}>
              <OpponentFighter input={fight.opponentInput?.input ?? null} skin={opponentSkin} />
              <FirstPersonArms punch={punch} controlsRef={motion.latestControls} skin={skin} />
            </Suspense>
          </Canvas>
        </SceneBoundary>
      </div>
      <div className="fp-film-grain" aria-hidden="true" />

      <FightStartSequence
        connectionState={fight.connectionState}
        countdownStartsAt={fight.countdownStartsAt}
      />

      {assignment ? (
        <section className="fp-health-hud" aria-label="Fighter health">
          <HealthBar label="YOU" hp={ownHealth} />
          <HealthBar label="OPPONENT" hp={opponentHealth} opponent />
        </section>
      ) : null}

      {fight.lastImpact ? (
        <div
          className="fp-damage-callout"
          data-defender={fight.lastImpact.attack.defenderSeat === ownSeat ? 'self' : 'opponent'}
          key={fight.lastImpact.attack.id}
          role="status"
        >
          {fight.lastImpact.outcome === 'BLOCK' ? 'GUARDED' : 'HIT'} −{fight.lastImpact.damage}
        </div>
      ) : null}

      {fight.connectionState === 'PAUSED' ? (
        <div className="fp-match-overlay" role="status" aria-live="assertive">
          <span>ROUND PAUSED</span>
          <h2>
            {trackingLostSeat === ownSeat ? 'STEP BACK INTO FRAME' : 'OPPONENT TRACKING LOST'}
          </h2>
          <p>The clock and combat resume when both fighters are tracked.</p>
        </div>
      ) : null}

      {fight.connectionState === 'FINISHED' && winnerSeat && ownSeat ? (
        <div className="fp-match-overlay fp-result" role="dialog" aria-modal="true">
          <span>OFFICIAL RESULT</span>
          <h2>{winnerSeat === ownSeat ? 'YOU WIN' : 'YOU LOSE'}</h2>
          <p>
            {ownHealth.toFixed(1)} HP · {opponentHealth.toFixed(1)} opponent HP
          </p>
          <Link className="fp-result-action" to="/" onClick={leaveFight}>
            RETURN TO THE GYM
          </Link>
        </div>
      ) : null}

      {!calibrationOpen ? (
        <aside className="fp-ring-preview" aria-label="Live camera preview">
          <div className="fp-ring-preview-heading">LIVE CAMERA</div>
          <CameraView videoRef={videoRef} canvasRef={canvasRef} stream={stream} />
          <div className="fp-ring-preview-status" data-state={diagnostics?.tracking ?? 'LOST'}>
            <span
              className="fp-dot"
              data-state={diagnostics?.tracking ?? 'LOST'}
              aria-hidden="true"
            />
            {status}
          </div>
        </aside>
      ) : null}

      {punch ? (
        <div className="fp-move-callout" key={punch.id} role="status">
          {punch.hand.toUpperCase()} {punch.move.toUpperCase()}
        </div>
      ) : null}

      <header
        className={`fp-hud${calibrationOpen ? ' is-calibrating' : ''}`}
        aria-label="Sparring controls"
      >
        <Link className="fp-back" to="/" onClick={leaveFight}>
          LEAVE THE RING
        </Link>
        <div className="fp-session-display">
          <span className="fp-session-mark">
            OBOXLE
            <i /> TEST ENVIRONMENT
          </span>
          <p className="fp-title">
            {fight.connectionState === 'FIGHTING'
              ? `Fight · ${fight.snapshot?.players.A.hp ?? 100}–${fight.snapshot?.players.B.hp ?? 100}`
              : fight.connectionState === 'SOLO'
                ? 'Solo · bag work'
                : `Multiplayer · ${fight.connectionState.toLowerCase()}`}
          </p>
          {!fight.assignment && !calibrationOpen ? (
            <p className="fp-round-readout">
              ROUND {String(soloWorkout.round).padStart(2, '0')} <i />
              {soloWorkout.started
                ? formatWorkoutClock(soloWorkout.secondsLeft)
                : 'THROW TO START'}{' '}
              <i />
              {soloWorkout.punches} PUNCHES
            </p>
          ) : null}
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
        <span>OBOXLE</span>
        <i /> <span>PRE-ALPHA 2026-10-04</span>
      </div>
    </main>
  );
}
