import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group, MeshStandardMaterial } from 'three';

interface RingProps {
  active?: boolean;
}

function Fighter({ x, color, glove }: { x: number; color: string; glove: string }) {
  const boxer = useRef<Group>(null);
  const gloves = useRef<Group>(null);

  useFrame(({ clock }, delta) => {
    if (!boxer.current || !gloves.current) return;
    boxer.current.position.y = 0.03 + Math.sin(clock.elapsedTime * 2.1 + x) * 0.035;
    gloves.current.rotation.z = Math.sin(clock.elapsedTime * 1.8 + x) * 0.045;
    gloves.current.rotation.y +=
      (Math.sin(clock.elapsedTime + x) * 0.035 - gloves.current.rotation.y) * delta * 2;
  });

  return (
    <group ref={boxer} position={[x, 0, 0]}>
      <mesh position={[0, 0.66, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.48, 6, 10]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.15} />
      </mesh>
      <mesh position={[0, 1.18, 0]} castShadow>
        <sphereGeometry args={[0.23, 20, 16]} />
        <meshStandardMaterial color="#d8d9d5" metalness={0.35} roughness={0.38} />
      </mesh>
      <mesh position={[0.035, 1.2, 0.2]}>
        <boxGeometry args={[0.14, 0.045, 0.018]} />
        <meshStandardMaterial color="#b9d6de" emissive="#65c6eb" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[-0.13, 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.3, 4, 8]} />
        <meshStandardMaterial color="#343d45" roughness={0.75} />
      </mesh>
      <mesh position={[0.13, 0.15, 0]} castShadow>
        <capsuleGeometry args={[0.09, 0.3, 4, 8]} />
        <meshStandardMaterial color="#343d45" roughness={0.75} />
      </mesh>
      <group ref={gloves}>
        <mesh position={[-0.38, 0.78, 0.04]} castShadow>
          <capsuleGeometry args={[0.075, 0.36, 4, 8]} />
          <meshStandardMaterial color="#bac2c5" metalness={0.2} roughness={0.5} />
        </mesh>
        <mesh position={[0.38, 0.78, 0.04]} castShadow>
          <capsuleGeometry args={[0.075, 0.36, 4, 8]} />
          <meshStandardMaterial color="#bac2c5" metalness={0.2} roughness={0.5} />
        </mesh>
        <mesh position={[-0.43, 0.56, 0.12]} castShadow>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color={glove} roughness={0.4} metalness={0.08} />
        </mesh>
        <mesh position={[0.43, 0.56, 0.12]} castShadow>
          <sphereGeometry args={[0.16, 16, 12]} />
          <meshStandardMaterial color={glove} roughness={0.4} metalness={0.08} />
        </mesh>
      </group>
    </group>
  );
}

export function Ring({ active = false }: RingProps) {
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
        <meshStandardMaterial color="#17212a" roughness={0.94} />
      </mesh>
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[8.3, 0.36, 5.4]} />
        <meshStandardMaterial color="#293541" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[7.8, 0.08, 4.9]} />
        <meshStandardMaterial color={active ? '#b7c2bf' : '#929e9e'} roughness={0.9} />
      </mesh>
      {[-1, 1].map((side) => (
        <Fighter
          key={side}
          x={side * 1.55}
          color={side < 0 ? '#397da7' : '#9e5834'}
          glove={side < 0 ? '#48a8d8' : '#ed9850'}
        />
      ))}
      {[-1, 1].map((x) =>
        [-1, 1].map((z) => (
          <mesh key={`post-${x}-${z}`} position={[x * 4, 0.82, z * 2.5]} castShadow>
            <boxGeometry args={[0.13, 1.65, 0.13]} />
            <meshStandardMaterial color="#b7b9b2" metalness={0.4} roughness={0.42} />
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
                color="#e5e4dc"
                emissive="#f2a451"
                emissiveIntensity={0.05}
              />
            </mesh>
          ))}
          {[-1, 1].map((x) => (
            <mesh key={`short-${x}`} position={[x * 4, y, 0]}>
              <boxGeometry args={[0.035, 0.035, 5]} />
              <meshStandardMaterial color="#e5e4dc" emissive="#f2a451" emissiveIntensity={0.05} />
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
