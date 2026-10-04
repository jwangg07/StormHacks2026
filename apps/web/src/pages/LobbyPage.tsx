import { Canvas, useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Vector3 } from 'three';
import type { Texture } from 'three';
import { useSkin } from '../avatar/skinStore';
import { Ring } from '../game/Ring';
import { MusicToggle } from '../ui/MusicToggle';
import {
  AvatarPodium,
  BOARD_SHOT,
  BulletinBoard,
  PODIUM_SHOT,
  RING_SHOT,
  RingHotspot,
} from './LobbyProps';
import type { CameraShot, StatLine } from './LobbyProps';

const stats: StatLine[] = [
  { label: 'Record', value: '07 - 03' },
  { label: 'Clean hits', value: '68%' },
  { label: 'Blocks', value: '24' },
  { label: 'Best round', value: '43 sec' },
];

const CAMERA_DISTANCE = 13.2;
const CAMERA_HEIGHT = 4.7;
/** Widest orbit, in radians, when the pointer reaches a screen edge. */
const MAX_PAN_YAW = 0.22;
const PAN_SMOOTHING_S = 0.35;
/** Length of the camera's fly-in to a prop, and back out to the orbit. */
const FLY_S = 0.9;
const MAX_FLY_STEP_S = 1 / 30;

type Spot = 'ring' | 'card' | 'avatar';

const SPOT_LABELS: Record<Spot, string> = {
  ring: 'SPARRING ROOM',
  card: 'FIGHTER CARD',
  avatar: 'FIGHTER STUDIO',
};

const SPOT_SHOTS: Record<Spot, CameraShot> = {
  ring: RING_SHOT,
  card: BOARD_SHOT,
  avatar: PODIUM_SHOT,
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const ORIGIN = new Vector3();
const fromPosition = new Vector3();
const fromTarget = new Vector3();
const goalPosition = new Vector3();
const lookTarget = new Vector3();

/**
 * Orbits the camera around the ring with the pointer. When a spot is focused, flies head-on
 * to that prop's shot and reports arrival; when focus clears, flies back to the live orbit.
 */
function LobbyCamera({ focus, onArrive }: { focus: Spot | null; onArrive: (spot: Spot) => void }) {
  const goal = useRef(0);
  const yaw = useRef(0);
  const flight = useRef({ spot: null as Spot | null, t: 1, arrived: true });

  useEffect(() => {
    if (prefersReducedMotion()) return;
    // The HUD covers most of the canvas, so track the pointer on the window, not the canvas.
    const onMove = (event: PointerEvent) => {
      goal.current = (1 - (event.clientX / window.innerWidth) * 2) * MAX_PAN_YAW;
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  useFrame(({ camera }, dt) => {
    yaw.current += (goal.current - yaw.current) * (1 - Math.exp(-dt / PAN_SMOOTHING_S));
    const leg = flight.current;
    if (leg.spot !== focus) {
      // Start each leg from wherever the camera is, so a mid-flight change never jumps.
      fromPosition.copy(camera.position);
      fromTarget.copy(lookTarget);
      leg.spot = focus;
      leg.t = 0;
      leg.arrived = false;
    }
    // Cap the step so a stalled frame cannot skip the flight the UI waits on.
    leg.t = Math.min(1, leg.t + Math.min(dt, MAX_FLY_STEP_S) / FLY_S);
    const k = easeInOutCubic(leg.t);
    const shot = focus ? SPOT_SHOTS[focus] : null;
    if (shot) goalPosition.copy(shot.position);
    else
      goalPosition.set(
        Math.sin(yaw.current) * CAMERA_DISTANCE,
        CAMERA_HEIGHT,
        Math.cos(yaw.current) * CAMERA_DISTANCE,
      );
    camera.position.lerpVectors(fromPosition, goalPosition, k);
    // R3F aims the default camera at the origin; steering a look target keeps the pitch from rolling.
    lookTarget.lerpVectors(fromTarget, shot ? shot.target : ORIGIN, k);
    camera.lookAt(lookTarget);
    if (focus && leg.t === 1 && !leg.arrived) {
      leg.arrived = true;
      onArrive(focus);
    }
  });

  return null;
}

interface GymRoomProps {
  hovered: Spot | null;
  skin: Texture | null;
  onHover: (spot: Spot, on: boolean) => void;
  onSelect: (spot: Spot) => void;
}

function GymRoom({ hovered, skin, onHover, onSelect }: GymRoomProps) {
  const hot = hovered === 'ring';
  const spot = (name: Spot) => ({
    hot: hovered === name,
    onHover: (on: boolean) => onHover(name, on),
    onSelect: () => onSelect(name),
  });
  return (
    <>
      <color attach="background" args={['#161817']} />
      <fog attach="fog" args={['#161817', 12, 29]} />
      <hemisphereLight args={['#d7c9a5', '#171b1b', 1.05]} />
      <ambientLight intensity={0.34} />
      <directionalLight position={[-5, 8, 4]} intensity={1.45} color="#e5c99a" />
      <spotLight
        position={[0, 9, 1]}
        angle={0.62}
        penumbra={0.55}
        intensity={hot ? 100 : 74}
        distance={25}
        color="#ffc978"
        castShadow
      />
      <spotLight position={[-7, 6, -3]} angle={0.8} intensity={24} color="#8b9ca0" distance={23} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]} receiveShadow>
        <planeGeometry args={[34, 28]} />
        <meshStandardMaterial color="#302e28" roughness={1} />
      </mesh>

      {/* Scuffed back wall, old gym windows and ceiling joists give the ring a place to live. */}
      <mesh position={[0, 5.1, -11]} receiveShadow>
        <boxGeometry args={[31, 11, 0.8]} />
        <meshStandardMaterial color="#343633" roughness={1} flatShading />
      </mesh>
      <mesh position={[-15.2, 4.8, 0]} receiveShadow>
        <boxGeometry args={[0.8, 10, 24]} />
        <meshStandardMaterial color="#292d2b" roughness={1} flatShading />
      </mesh>
      <mesh position={[15.2, 4.8, 0]} receiveShadow>
        <boxGeometry args={[0.8, 10, 24]} />
        <meshStandardMaterial color="#292d2b" roughness={1} flatShading />
      </mesh>
      {[-9, -4, 1, 6, 11].map((x) => (
        <group key={x} position={[x, 5.9, -10.48]}>
          <mesh>
            <boxGeometry args={[3.8, 2.5, 0.08]} />
            <meshStandardMaterial color="#66716b" emissive="#435149" emissiveIntensity={0.22} />
          </mesh>
          <mesh position={[0, 0, 0.06]}>
            <boxGeometry args={[0.08, 2.8, 0.1]} />
            <meshStandardMaterial color="#202522" />
          </mesh>
        </group>
      ))}
      {[-9, -4, 1, 6, 11].map((x) => (
        <mesh key={`beam-${x}`} position={[x, 9, -1]} rotation={[0, 0, -0.03]} castShadow>
          <boxGeometry args={[0.28, 0.28, 22]} />
          <meshStandardMaterial color="#252927" roughness={0.94} flatShading />
        </mesh>
      ))}
      {[-7, 0, 7].map((x) => (
        <group key={`lamp-${x}`} position={[x, 8.35, 1]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.6, 6]} />
            <meshStandardMaterial color="#181c1b" roughness={0.9} />
          </mesh>
          <mesh rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.65, 0.32, 6]} />
            <meshStandardMaterial color="#4d4c42" roughness={0.85} flatShading />
          </mesh>
          <mesh position={[0, -0.16, 0]}>
            <boxGeometry args={[0.78, 0.06, 0.4]} />
            <meshStandardMaterial color="#edc889" emissive="#edbd75" emissiveIntensity={0.8} />
          </mesh>
        </group>
      ))}

      {/* Shadowed benches and a sparse, deliberately blocky gym crowd. */}
      {[-1, 1].map((side) => (
        <group key={`bleachers-${side}`} position={[side * 10, 0, -4.2]}>
          {[0, 1, 2].map((row) => (
            <group key={row} position={[0, row * 0.48, -row * 0.28]}>
              <mesh position={[0, 0.18, 0]}>
                <boxGeometry args={[5.4, 0.35, 0.55]} />
                <meshStandardMaterial color="#343a38" roughness={0.98} flatShading />
              </mesh>
              {Array.from({ length: 7 }, (_, index) => (
                <mesh key={index} position={[-2.25 + index * 0.74, 0.68, 0]}>
                  <boxGeometry args={[0.35, 0.58, 0.32]} />
                  <meshStandardMaterial
                    color={['#4e5150', '#6c5744', '#48545a', '#61524a'][index % 4]}
                    roughness={1}
                    flatShading
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      ))}
      <RingHotspot {...spot('ring')}>
        <Ring active={hot} skins={{ A: skin }} />
      </RingHotspot>
      <BulletinBoard {...spot('card')} stats={stats} />
      <AvatarPodium {...spot('avatar')} skin={skin} />
    </>
  );
}

function FighterCard({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="card-backdrop" onClick={onClose}>
      <section
        className="corner-board"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="board-heading">
          <span>FIGHTER CARD</span>
          <button ref={closeButton} className="board-close" type="button" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close fighter card</span>
          </button>
        </div>
        <h1 id="stats-title">Your corner</h1>
        <p className="board-subtitle">LOCAL RECORD · SEASON ZERO</p>
        <ul className="stats-list">
          {stats.map((stat, index) => (
            <li className="stat-row" key={stat.label}>
              <span className="stat-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="stat-label">{stat.label}</span>
              <strong>{stat.value}</strong>
            </li>
          ))}
        </ul>
        <p className="board-footnote">Sparring data is a placeholder.</p>
      </section>
    </div>
  );
}

export function LobbyPage() {
  const [hovered, setHovered] = useState<Spot | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  // The spot the camera is flying to or parked at; its UI opens once the camera arrives.
  const [focus, setFocus] = useState<Spot | null>(null);
  const skin = useSkin();
  const navigate = useNavigate();

  const hover = useCallback((spot: Spot, on: boolean) => {
    setHovered((current) => (on ? spot : current === spot ? null : current));
  }, []);
  const open = useCallback(
    (spot: Spot) => {
      if (spot === 'card') setCardOpen(true);
      else void navigate(spot === 'ring' ? '/game' : '/avatar');
    },
    [navigate],
  );
  const select = useCallback(
    (spot: Spot) => {
      if (focus) return;
      if (prefersReducedMotion()) open(spot);
      else setFocus(spot);
    },
    [focus, open],
  );
  const closeCard = useCallback(() => {
    setCardOpen(false);
    setFocus(null);
  }, []);
  const choose = (spot: Spot) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    select(spot);
  };
  // Keyboard users reach the same three spots through these controls; focus lights the prop.
  const focusProps = (spot: Spot) => ({
    onFocus: () => hover(spot, true),
    onBlur: () => hover(spot, false),
  });

  return (
    <main className="gym-lobby" data-hover={focus ? undefined : (hovered ?? undefined)}>
      <div className="gym-render" aria-hidden="true">
        <Canvas
          camera={{ position: [0, 2.7, CAMERA_DISTANCE], fov: 39 }}
          dpr={[1, 1]}
          shadows
          gl={{ antialias: false, powerPreference: 'high-performance' }}
        >
          <GymRoom hovered={focus ?? hovered} skin={skin} onHover={hover} onSelect={select} />
          <LobbyCamera focus={focus} onArrive={open} />
        </Canvas>
      </div>
      <div className="gym-grain" aria-hidden="true" />

      <div className="gym-sound">
        <MusicToggle />
      </div>

      <nav className="gym-keys" aria-label="Gym">
        <Link to="/game" onClick={choose('ring')} {...focusProps('ring')}>
          Enter the ring
        </Link>
        <button type="button" onClick={choose('card')} {...focusProps('card')}>
          Fighter card
        </button>
        <Link to="/avatar" onClick={choose('avatar')} {...focusProps('avatar')}>
          Fighter studio
        </Link>
      </nav>

      {hovered && !focus ? (
        <p className="gym-hover-label" aria-hidden="true">
          {SPOT_LABELS[hovered]}
        </p>
      ) : null}

      {cardOpen ? <FighterCard onClose={closeCard} /> : null}

      <div className="gym-floor-label" aria-hidden="true">
        <span>ROUND 01</span>
        <i /> <span>WEBCAM BOXER</span>
      </div>
    </main>
  );
}
