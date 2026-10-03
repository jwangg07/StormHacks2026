import { Canvas } from '@react-three/fiber';
import { Ring } from '../game/Ring';

export function App() {
  return (
    <main className="shell">
      <header className="masthead">
        <a className="brand" href="/" aria-label="WebcamBoxer home">
          WebcamBoxer
        </a>
        <span className="mode">Prototype setup</span>
      </header>
      <section className="intro" aria-labelledby="title">
        <div className="copy">
          <p className="kicker">A local motion game</p>
          <h1 id="title">Step into the ring.</h1>
          <p className="lede">
            Use your webcam to spar with a friend. Your camera stays on this device.
          </p>
          <div className="actions">
            <button type="button">Create a room</button>
            <button className="quiet" type="button">
              Join a room
            </button>
          </div>
          <p className="note">Camera access starts after you choose setup.</p>
        </div>
        <div className="stage" aria-label="3D arena preview">
          <Canvas camera={{ position: [0, 3, 8], fov: 42 }}>
            <color attach="background" args={['#111a25']} />
            <ambientLight intensity={1.5} />
            <directionalLight position={[3, 6, 4]} intensity={2.5} />
            <Ring />
          </Canvas>
        </div>
      </section>
      <footer>Two players · One camera each · No controller required</footer>
    </main>
  );
}
