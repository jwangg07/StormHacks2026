import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, MeshStandardMaterial, Texture } from 'three';
import type { Seat } from '@wb/core';
import { FighterModel } from '../avatar/FighterModel';

interface RingProps {
  active?: boolean;
  skins?: Partial<Record<Seat, Texture | null>>;
}

/** The fighter model is 1.8 m tall; this keeps it in proportion with the ropes. */
const FIGHTER_SCALE = 0.8;
/** Top of the canvas mat. */
const MAT_Y = 0.19;

function Fighter({ x, glove, skin }: { x: number; glove: string; skin: Texture | null }) {
  const boxer = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (boxer.current)
      boxer.current.position.y = MAT_Y + (1 + Math.sin(clock.elapsedTime * 2.1 + x)) * 0.0175;
  });

  // Player A (left, x < 0) faces +x; player B faces -x.
  return (
    <group
      ref={boxer}
      position={[x, MAT_Y, 0]}
      rotation={[0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
    >
      <FighterModel skin={skin} pose="guard" glove={glove} scale={FIGHTER_SCALE} />
    </group>
  );
}

export function Ring({ active = false, skins = {} }: RingProps) {
  const ropeMaterial = useRef<MeshStandardMaterial>(null);
  const energy = useRef(0);

  useFrame((_, delta) => {
    energy.current += ((active ? 1 : 0) - energy.current) * Math.min(1, delta * 5);
    if (ropeMaterial.current) ropeMaterial.current.emissiveIntensity = 0.05 + energy.current * 0.8;
  });

  const ropeLevels = [0.35, 0.66, 0.97, 1.28];

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.22, 0]} receiveShadow>
        <planeGeometry args={[24, 16]} />
        <meshStandardMaterial color="#282a26" roughness={1} flatShading />
      </mesh>
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[8.3, 0.36, 5.4]} />
        <meshStandardMaterial color="#403e37" roughness={0.97} flatShading />
      </mesh>
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[7.8, 0.08, 4.9]} />
        <meshStandardMaterial color={active ? '#aaa28e' : '#827e70'} roughness={1} flatShading />
      </mesh>
      <Suspense fallback={null}>
        {(['A', 'B'] as const).map((seat) => (
          <Fighter
            key={seat}
            x={seat === 'A' ? -1.55 : 1.55}
            glove={seat === 'A' ? '#48a8d8' : '#ed9850'}
            skin={skins[seat] ?? null}
          />
        ))}
      </Suspense>
      {[-1, 1].map((x) =>
        [-1, 1].map((z) => (
          <mesh key={`post-${x}-${z}`} position={[x * 4, 0.82, z * 2.5]} castShadow>
            <boxGeometry args={[0.13, 1.65, 0.13]} />
            <meshStandardMaterial color="#77766c" metalness={0.18} roughness={0.82} flatShading />
          </mesh>
        )),
      )}
      {ropeLevels.map((y) => (
        <group key={y}>
          {[-1, 1].map((z) => (
            <mesh key={`long-${z}`} position={[0, y, z * 2.5]}>
              <boxGeometry args={[8, 0.035, 0.035]} />
              <meshStandardMaterial
                ref={ropeMaterial}
                color="#c9c0a9"
                emissive="#f2a451"
                emissiveIntensity={0.05}
              />
            </mesh>
          ))}
          {[-1, 1].map((x) => (
            <mesh key={`short-${x}`} position={[x * 4, y, 0]}>
              <boxGeometry args={[0.035, 0.035, 5]} />
              <meshStandardMaterial color="#c9c0a9" emissive="#d89a4e" emissiveIntensity={0.05} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.205, 0]}>
        <ringGeometry args={[5.2, 5.25, 64]} />
        <meshBasicMaterial
          color={active ? '#f2a451' : '#597080'}
          transparent
          opacity={active ? 0.8 : 0.35}
        />
      </mesh>
    </group>
  );
}
