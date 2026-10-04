import { Canvas } from '@react-three/fiber';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Texture } from 'three';
import { FighterPortrait } from '../avatar/FighterPortrait';
import { useSkin } from '../avatar/skinStore';
import { Ring } from '../game/Ring';
import { MusicToggle } from '../ui/MusicToggle';

const stats = [
  { label: 'Record', value: '07 - 03' },
  { label: 'Clean hits', value: '68%' },
  { label: 'Blocks', value: '24' },
  { label: 'Best round', value: '43 sec' },
];

function GymRoom({ hot, skin }: { hot: boolean; skin: Texture | null }) {
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
      <Ring active={hot} skins={{ A: skin }} />
    </>
  );
}

export function LobbyPage() {
  const [hot, setHot] = useState(false);
  const skin = useSkin();

  return (
    <main className="gym-lobby">
      <div className="gym-render" aria-hidden="true">
        <Canvas
          camera={{ position: [0, 4.7, 13.2], fov: 39 }}
          dpr={[1, 1]}
          shadows
          gl={{ antialias: false, powerPreference: 'high-performance' }}
        >
          <GymRoom hot={hot} skin={skin} />
        </Canvas>
      </div>
      <div className="gym-grain" aria-hidden="true" />

      <div className="gym-sound">
        <MusicToggle />
      </div>

      <aside className="corner-board" aria-labelledby="stats-title">
        <div className="board-heading">
          <span>FIGHTER CARD</span>
          <span className="board-stamp">01</span>
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
      </aside>

      <Link
        className="arena-hit-target"
        to="/game"
        aria-label="Enter the boxing ring and start practice"
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => setHot(false)}
      >
        <span className="sr-only">Enter the ring</span>
      </Link>

      <Link className="avatar-bay" to="/avatar" aria-label="Open fighter studio">
        <div className="avatar-copy">
          <span className="avatar-eyebrow">IN YOUR CORNER</span>
          <strong>
            THE NEXT
            <br />
            CONTENDER
          </strong>
          <span className="avatar-action">
            Fighter details <b aria-hidden="true">+</b>
          </span>
        </div>
        <FighterPortrait skin={skin} />
      </Link>

      <div className="gym-floor-label" aria-hidden="true">
        <span>ROUND 01</span>
        <i /> <span>OPEN SPARRING</span>
      </div>
    </main>
  );
}
