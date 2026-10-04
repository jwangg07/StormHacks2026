import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three';
import type { Group, MeshStandardMaterial, Texture } from 'three';
import { FighterModel } from '../avatar/FighterModel';
import { useSurface } from '../game/surfaces';

/** Top of the gym floor the ring sits on. */
const FLOOR_Y = -0.22;
const PLAYER_GLOVE = '#48a8d8';
const HOVER_SMOOTHING_S = 0.12;

const BOARD_AT: [number, number, number] = [-6.0, FLOOR_Y, 1.1];
const BOARD_YAW = 0.5;
const PODIUM_AT: [number, number, number] = [6.0, FLOOR_Y, 1.1];
const PODIUM_YAW = -0.5;
const PODIUM_SCALE = 1.15;

/** Where the camera stands and what it looks at when it flies in to a prop. */
export interface CameraShot {
  position: Vector3;
  target: Vector3;
}

/** A shot squarely in front of a prop placed at `at` and turned by `yaw`. */
function headOnShot(
  at: [number, number, number],
  yaw: number,
  height: number,
  distance: number,
  rise = 0,
): CameraShot {
  const target = new Vector3(at[0], at[1] + height, at[2]);
  const position = new Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    .multiplyScalar(distance)
    .add(target);
  position.y += rise;
  return { position, target };
}

export const BOARD_SHOT = headOnShot(BOARD_AT, BOARD_YAW, 1.78, 2.9);
export const PODIUM_SHOT = headOnShot(PODIUM_AT, PODIUM_YAW, 0.95 * PODIUM_SCALE, 4.8, 0.7);
export const RING_SHOT: CameraShot = {
  position: new Vector3(0, 2.4, 7.4),
  target: new Vector3(0, 0.75, 0),
};

export interface StatLine {
  label: string;
  value: string;
}

interface HotspotProps {
  hot: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}

/** Eases a 0..1 value toward whether the prop is hovered. */
function useHoverEnergy(hot: boolean) {
  const energy = useRef(0);
  useFrame((_, dt) => {
    energy.current += ((hot ? 1 : 0) - energy.current) * (1 - Math.exp(-dt / HOVER_SMOOTHING_S));
  });
  return energy;
}

/**
 * An invisible box that owns a prop's pointer events. Raycasting ignores `visible`, so
 * one simple volume stands in for many small meshes and hover never flickers between them.
 */
function HitBox({
  hot,
  onHover,
  onSelect,
  size,
  position,
}: Omit<HotspotProps, 'hot'> & {
  hot?: boolean;
  size: [number, number, number];
  position: [number, number, number];
}) {
  const over = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    if (!hot) onHover(true);
  };
  return (
    <mesh
      visible={false}
      position={position}
      onPointerOver={over}
      onPointerMove={over}
      onPointerOut={() => onHover(false)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <boxGeometry args={size} />
    </mesh>
  );
}

/** Flips true once the page's web fonts can be drawn onto a canvas. */
function useWebFontsReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all([
      document.fonts.load('700 64px "Barlow Condensed"'),
      document.fonts.load('500 32px "IBM Plex Mono"'),
    ]).then(
      () => live && setReady(true),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

/** A canvas-drawn texture, repainted once the page's web fonts have loaded. */
function usePaintedTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const fontsReady = useWebFontsReady();
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) paint(ctx, width, height);
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    result.anisotropy = 4;
    result.userData.fontsReady = fontsReady;
    return result;
  }, [width, height, paint, fontsReady]);

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function paintStatSheet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stats: StatLine[],
) {
  ctx.fillStyle = '#e4d9bf';
  ctx.fillRect(0, 0, width, height);
  // Coffee ring and fold line: a sheet that has hung in a gym for a season.
  ctx.strokeStyle = 'rgb(120 82 44 / 18%)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.86, 48, 0.3, Math.PI * 1.8);
  ctx.stroke();
  ctx.fillStyle = 'rgb(90 70 40 / 9%)';
  ctx.fillRect(0, height * 0.48, width, 3);

  ctx.fillStyle = '#7a3f27';
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText('FIGHTER CARD', 36, 58);
  ctx.fillStyle = '#211d18';
  ctx.font = '700 84px "Barlow Condensed", Impact, sans-serif';
  ctx.fillText('YOUR CORNER', 32, 140);
  ctx.fillStyle = '#6d6252';
  ctx.font = '500 18px "IBM Plex Mono", monospace';
  ctx.fillText('LOCAL RECORD · SEASON ZERO', 36, 176);

  stats.forEach((stat, index) => {
    const y = 236 + index * 82;
    ctx.fillStyle = 'rgb(33 29 24 / 22%)';
    ctx.fillRect(36, y - 34, width - 72, 2);
    ctx.fillStyle = '#9b5a36';
    ctx.font = '500 20px "IBM Plex Mono", monospace';
    ctx.fillText(String(index + 1).padStart(2, '0'), 36, y + 14);
    ctx.fillStyle = '#3b342b';
    ctx.font = '500 26px "IBM Plex Mono", monospace';
    ctx.fillText(stat.label, 92, y + 14);
    ctx.fillStyle = '#211d18';
    ctx.font = '700 46px "Barlow Condensed", Impact, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(stat.value, width - 36, y + 18);
    ctx.textAlign = 'left';
  });
}

function paintNote(lines: string[], paper: string, ink: string) {
  return (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = ink;
    ctx.font = '700 56px "Barlow Condensed", Impact, sans-serif';
    lines.forEach((line, index) => ctx.fillText(line, 26, 82 + index * 62));
  };
}

const paintBoutNote = paintNote(['NEXT BOUT', 'TBD'], '#d8b25c', '#3a2a14');
const paintTrainNote = paintNote(['JAB.', 'BLOCK.', 'REPEAT.'], '#8fb3c4', '#1a2a33');

function Pin({
  position,
  color = '#b2402c',
}: {
  position: [number, number, number];
  color?: string;
}) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.028, 6, 4]} />
      <meshStandardMaterial color={color} roughness={0.5} />
    </mesh>
  );
}

function Paper({
  texture,
  size,
  position,
  tilt,
  pin,
}: {
  texture: Texture;
  size: [number, number];
  position: [number, number, number];
  tilt: number;
  pin?: string;
}) {
  return (
    <group position={position} rotation={[0, 0, tilt]}>
      <mesh>
        <planeGeometry args={size} />
        <meshStandardMaterial map={texture} roughness={0.95} />
      </mesh>
      <Pin position={[0, size[1] / 2 - 0.06, 0.02]} color={pin} />
    </group>
  );
}

/** Cork board on legs, left of the ring. Shows the fighter card stats. */
export function BulletinBoard({
  hot,
  onHover,
  onSelect,
  stats,
}: HotspotProps & { stats: StatLine[] }) {
  const lift = useRef<Group>(null);
  const frame = useRef<MeshStandardMaterial>(null);
  const energy = useHoverEnergy(hot);
  const paintStats = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) =>
      paintStatSheet(ctx, width, height, stats),
    [stats],
  );
  const sheet = usePaintedTexture(512, 640, paintStats);
  const bout = usePaintedTexture(320, 240, paintBoutNote);
  const train = usePaintedTexture(320, 260, paintTrainNote);
  const leg = useSurface('wood', 0.1, 2.4, { vertical: true });
  const rail = useSurface('wood', 1.96, 0.07);
  const frameWood = useSurface('wood', 2.2, 1.6);
  const cork = useSurface('cork', 2.02, 1.42);

  useFrame(() => {
    if (lift.current) lift.current.position.y = energy.current * 0.06;
    if (frame.current) frame.current.emissiveIntensity = energy.current * 0.55;
  });

  return (
    // Turned to face the default camera across the ring.
    <group position={BOARD_AT} rotation={[0, BOARD_YAW, 0]}>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * 0.98, 1.2, -0.04]}
          rotation={[0, 0, side * -0.03]}
          castShadow
        >
          <boxGeometry args={[0.1, 2.4, 0.1]} />
          <meshStandardMaterial map={leg} color="#3b3029" roughness={1} flatShading />
        </mesh>
      ))}
      <mesh position={[0, 0.55, -0.04]}>
        <boxGeometry args={[1.96, 0.07, 0.07]} />
        <meshStandardMaterial map={rail} color="#3b3029" roughness={1} flatShading />
      </mesh>
      <group ref={lift}>
        <mesh position={[0, 1.78, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.2, 1.6, 0.1]} />
          <meshStandardMaterial
            ref={frame}
            map={frameWood}
            color="#5b4030"
            emissive="#d89a4e"
            emissiveIntensity={0}
            roughness={1}
            flatShading
          />
        </mesh>
        <mesh position={[0, 1.78, 0.052]} receiveShadow>
          <boxGeometry args={[2.02, 1.42, 0.01]} />
          <meshStandardMaterial map={cork} color="#a2744b" roughness={1} />
        </mesh>
        <Paper texture={sheet} size={[0.94, 1.18]} position={[-0.42, 1.76, 0.062]} tilt={-0.025} />
        <Paper
          texture={bout}
          size={[0.6, 0.45]}
          position={[0.54, 2.12, 0.064]}
          tilt={0.07}
          pin="#2f6f8f"
        />
        <Paper texture={train} size={[0.56, 0.46]} position={[0.5, 1.48, 0.064]} tilt={-0.05} />
      </group>
      <HitBox
        hot={hot}
        onHover={onHover}
        onSelect={onSelect}
        size={[2.3, 2.7, 0.5]}
        position={[0, 1.3, 0]}
      />
    </group>
  );
}

function paintPlaque(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = '#22272a';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#d89a4e';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.fillStyle = '#e8dfc9';
  ctx.font = '700 58px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FIGHTER STUDIO', width / 2, height / 2 + 20);
}

/** Turntable podium, right of the ring, with the player's fighter rotating on top. */
export function AvatarPodium({
  hot,
  onHover,
  onSelect,
  skin,
}: HotspotProps & { skin: Texture | null }) {
  const turntable = useRef<Group>(null);
  const trim = useRef<MeshStandardMaterial>(null);
  const energy = useHoverEnergy(hot);
  const plaque = usePaintedTexture(512, 112, paintPlaque);
  // Whole repeats around each tier, so the pattern meets itself at the cylinder's UV seam.
  const plinth = useSurface('concrete', 6, 0.18);
  const tier = useSurface('concrete', 5, 0.24);
  const plate = useSurface('diamondPlate', 1.5, 1.5);

  useFrame((_, dt) => {
    // Spin faster while hovered, as if the studio is showing the fighter off.
    if (turntable.current) turntable.current.rotation.y += dt * (0.45 + energy.current * 1.1);
    if (trim.current) trim.current.emissiveIntensity = 0.35 + energy.current * 1.6;
  });

  return (
    <group position={PODIUM_AT} rotation={[0, PODIUM_YAW, 0]} scale={PODIUM_SCALE}>
      <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.02, 1.1, 0.18, 8]} />
        <meshStandardMaterial map={plinth} color="#2f3331" roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.84, 0.9, 0.24, 8]} />
        <meshStandardMaterial map={tier} color="#454238" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 0.43, 0]} rotation={[Math.PI / 2, 0, Math.PI / 8]}>
        <torusGeometry args={[0.85, 0.025, 4, 8]} />
        <meshStandardMaterial
          ref={trim}
          color="#1d4458"
          emissive={PLAYER_GLOVE}
          emissiveIntensity={0.35}
        />
      </mesh>
      <mesh position={[0, 0.3, 0.875]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[0.92, 0.2]} />
        <meshStandardMaterial map={plaque} roughness={0.7} />
      </mesh>
      <group ref={turntable} position={[0, 0.42, 0]}>
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <cylinderGeometry args={[0.7, 0.7, 0.04, 16]} />
          <meshStandardMaterial map={plate} color="#5c5547" roughness={0.8} />
        </mesh>
        <Suspense fallback={null}>
          <FighterModel
            skin={skin}
            pose="guard"
            glove={PLAYER_GLOVE}
            scale={0.8}
            position={[0, 0.04, 0]}
          />
        </Suspense>
      </group>
      <HitBox
        hot={hot}
        onHover={onHover}
        onSelect={onSelect}
        size={[2.1, 2.1, 2.1]}
        position={[0, 1.0, 0]}
      />
    </group>
  );
}

/** Pointer target for the ring itself, so the wide floor plane around it is not clickable. */
export function RingHotspot({
  hot,
  onHover,
  onSelect,
  children,
}: HotspotProps & { children: ReactNode }) {
  return (
    <group>
      {children}
      <HitBox
        hot={hot}
        onHover={onHover}
        onSelect={onSelect}
        size={[8.4, 2.2, 5.5]}
        position={[0, 0.9, 0]}
      />
    </group>
  );
}
