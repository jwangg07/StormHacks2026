import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group, Texture } from 'three';
import { FighterModel } from './FighterModel';

function Sway({ skin }: { skin: Texture | null }) {
  const turn = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (turn.current) turn.current.rotation.y = 0.35 + Math.sin(clock.elapsedTime * 0.6) * 0.45;
  });
  return (
    <group ref={turn} position={[0, -0.95, 0]}>
      <FighterModel skin={skin} pose="guard" glove="#48a8d8" />
    </group>
  );
}

/** Small live render of the player's fighter for the lobby's avatar bay. */
export function FighterPortrait({ skin }: { skin: Texture | null }) {
  return (
    <div className="fighter-portrait" aria-hidden="true">
      <Canvas camera={{ position: [0, 0, 3.8], fov: 30 }} dpr={[1, 1.5]} gl={{ alpha: true }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[2, 4, 3]} intensity={2.2} color="#f4d4a5" />
        <directionalLight position={[-3, 1, -2]} intensity={0.7} color="#53a9d7" />
        <Suspense fallback={null}>
          <Sway skin={skin} />
        </Suspense>
      </Canvas>
    </div>
  );
}
