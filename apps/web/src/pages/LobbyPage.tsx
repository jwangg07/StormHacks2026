import { Canvas } from '@react-three/fiber';
import { useState } from 'react';
import { Link } from 'react-router';
import { Ring } from '../game/Ring';
import { MusicToggle } from '../ui/MusicToggle';
import { FighterPortrait } from '../avatar/FighterPortrait';
import { useSkin } from '../avatar/skinStore';

const stats = [
  { label: 'Fight record', value: '07—03', note: 'demo profile' },
  { label: 'Clean strikes', value: '68%', note: 'of attempts' },
  { label: 'Blocks', value: '24', note: 'this week' },
  { label: 'Best round', value: '43s', note: 'without a pause' },
];

export function LobbyPage() {
  const [hot, setHot] = useState(false);
  const skin = useSkin();

  return (
    <main className="lobby">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="WebcamBoxer lobby">
          <span className="wordmark-mark" aria-hidden="true" />
          WebcamBoxer
        </Link>
        <div className="broadcast-status">
          <span /> Training floor open
        </div>
        <nav className="top-actions" aria-label="Main navigation">
          <Link className="avatar-link" to="/practice">
            First-person practice
          </Link>
          <Link className="avatar-link" to="/avatar">
            Avatar studio
          </Link>
          <MusicToggle />
        </nav>
      </header>

      <section className="lobby-grid" aria-label="Game lobby">
        <aside className="stats-rail" aria-labelledby="stats-title">
          <div className="section-head">
            <span className="section-kicker">PLAYER ONE</span>
            <h1 id="stats-title">Corner stats</h1>
            <p>Season zero · local profile</p>
          </div>
          <ul className="stats-list">
            {stats.map((stat, index) => (
              <li className="stat-row" key={stat.label}>
                <span className="stat-index">0{index + 1}</span>
                <div>
                  <span className="stat-label">{stat.label}</span>
                  <strong>{stat.value}</strong>
                  <span className="stat-note">{stat.note}</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="rail-footnote">
            Stats are placeholders. Camera motion stays on your device.
          </p>
        </aside>

        <section className={`arena-panel${hot ? ' is-hot' : ''}`} aria-label="Boxing ring">
          <div className="arena-topline">
            <div>
              <span className="live-dot" /> OPEN GYM
            </div>
            <span className="room-chip">ROOM · WAITING</span>
          </div>
          <Link
            className="arena-stage"
            to="/game"
            aria-label="Enter the ring"
            onPointerEnter={() => setHot(true)}
            onPointerLeave={() => setHot(false)}
          >
            <Canvas
              camera={{ position: [0, 4.4, 9.5], fov: 39 }}
              dpr={[1, 1.5]}
              gl={{ antialias: true, powerPreference: 'high-performance' }}
            >
              <color attach="background" args={['#111921']} />
              <fog attach="fog" args={['#111921', 10, 22]} />
              <ambientLight intensity={1.35} />
              <directionalLight position={[-4, 8, 5]} intensity={2.2} color="#f4d4a5" />
              <spotLight
                position={[1, 8, -1]}
                angle={0.52}
                penumbra={0.75}
                intensity={hot ? 65 : 44}
                color="#ffc779"
              />
              <Ring active={hot} skins={{ A: skin }} />
            </Canvas>
            <div className="arena-enter" aria-hidden="true">
              <span className="enter-icon" aria-hidden="true">
                ↗
              </span>
              <span>Enter the ring</span>
              <span className="enter-hint">CLICK TO CONTINUE</span>
            </div>
          </Link>
          <div className="arena-caption">
            <div>
              <span className="caption-kicker">NEXT UP</span>
              <strong>Open sparring</strong>
            </div>
            <p>Two fighters · 60 second round</p>
          </div>
        </section>

        <Link className="avatar-bay" to="/avatar" aria-label="Open avatar studio">
          <div className="avatar-copy">
            <span className="section-kicker">YOUR CORNER</span>
            <strong>Build your fighter</strong>
            <span>
              Avatar studio <b aria-hidden="true">↗</b>
            </span>
          </div>
          <FighterPortrait skin={skin} />
        </Link>
      </section>
      <footer className="lobby-footer">
        <span>
          WEBCAMBOXER <i>©</i> 2026
        </span>
        <span>CAMERA FRAMES STAY ON THIS DEVICE</span>
        <span>USE SMALL, CONTROLLED MOVEMENTS</span>
      </footer>
    </main>
  );
}
