import { Canvas } from '@react-three/fiber';
import { Link } from 'react-router';
import { CameraPreview } from '../cam/CameraPreview';
import { Ring } from '../game/Ring';
import { useSkin } from '../avatar/skinStore';

export function GamePage() {
  const skin = useSkin();
  return (
    <main className="subpage">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="Return to lobby">
          <span className="wordmark-mark" aria-hidden="true" />
          WebcamBoxer
        </Link>
        <span className="room-chip">LOCAL PRACTICE</span>
        <Link className="back-link" to="/">Back to lobby</Link>
      </header>
      <section className="game-room" aria-label="Camera practice and ring preview">
        <div className="game-scene">
          <div className="game-scene-heading">
            <div>
              <span className="section-kicker">TRAINING FLOOR</span>
              <h1>Step into the ring</h1>
            </div>
            <span className="room-chip">CAMERA INPUT</span>
          </div>
          <div className="game-preview" aria-label="Preview of the boxing ring">
            <Canvas camera={{ position: [0, 4.2, 9], fov: 42 }} dpr={[1, 1.5]}>
              <color attach="background" args={['#111921']} />
              <ambientLight intensity={1.3} />
              <directionalLight position={[-3, 7, 5]} intensity={2} color="#f4d4a5" />
              <Ring active skins={{ A: skin }} />
            </Canvas>
          </div>
          <p className="game-note">Camera frames stay on this device. Use small, controlled movements.</p>
        </div>
        <CameraPreview />
      </section>
    </main>
  );
}
