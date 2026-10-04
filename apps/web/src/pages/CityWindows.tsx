import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, ShaderMaterial } from 'three';
import type { PointLight } from 'three';

/**
 * The gym's back windows, looking out on a city that keeps living while the menu sits idle.
 *
 * The sky runs a slow dusk → night → small hours → blue hour loop. Office and flat windows
 * switch on and off one by one, beacons blink on the towers, and an elevated train goes by now
 * and then. The palette and the train schedule are worked out on the CPU once a frame and
 * passed in as uniforms, so the glass, the light shafts and the room lights always agree.
 */

const WINDOW_XS = [-9, -4, 1, 6, 11];
const WINDOW_Y = 5.9;
const WALL_FACE_Z = -10.48;
const PANE_W = 3.8;
const PANE_H = 2.5;

/** One full trip around the day loop, in seconds. */
const CYCLE_S = 240;
/** Where in the loop the menu opens: just past dusk, while the city is busiest. */
const START_PHASE = 0.20;

/** Seconds between train passes, how fast it runs (m/s), and how long it is (m). */
const TRAIN_PERIOD_S = 38;
const TRAIN_SPEED = 15;
const TRAIN_LENGTH = 34;
/** The train runs this far either side of x = 0 on its track, 22 m behind the wall. */
const TRAIN_REACH = 70;
const TRAIN_FIRST_S = 9;

interface Mood {
  at: number;
  skyTop: string;
  horizon: string;
  /** Light pollution: the glow the street throws up onto the low sky. */
  glow: string;
  /** Colour of the light that falls through the glass into the gym. */
  spill: string;
  spillStrength: number;
  /** Share of the city's windows that are lit. */
  occupancy: number;
  stars: number;
}

const MOODS: Mood[] = [
  {
    at: 0.0,
    skyTop: '#1d2445',
    horizon: '#c0684a',
    glow: '#e08a52',
    spill: '#e39462',
    spillStrength: 1,
    occupancy: 0.5,
    stars: 0,
  },
  {
    at: 0.22,
    skyTop: '#0b1029',
    horizon: '#3a3462',
    glow: '#b0705a',
    spill: '#8e8ed2',
    spillStrength: 0.75,
    occupancy: 0.72,
    stars: 0.6,
  },
  {
    at: 0.52,
    skyTop: '#04060d',
    horizon: '#161b2e',
    glow: '#5b4a4a',
    spill: '#5568a0',
    spillStrength: 0.45,
    occupancy: 0.22,
    stars: 1,
  },
  {
    at: 0.8,
    skyTop: '#172241',
    horizon: '#6a80aa',
    glow: '#8b8fa8',
    spill: '#9db4dc',
    spillStrength: 0.8,
    occupancy: 0.32,
    stars: 0.25,
  },
];

const parsed = MOODS.map((mood) => ({
  ...mood,
  skyTop: new Color(mood.skyTop),
  horizon: new Color(mood.horizon),
  glow: new Color(mood.glow),
  spill: new Color(mood.spill),
}));

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Writes the mood at `phase` (0..1, wrapping) into `out`, eased between neighbours. */
function sampleMood(phase: number, out: (typeof parsed)[number]) {
  const p = ((phase % 1) + 1) % 1;
  let i = parsed.length - 1;
  while (parsed[i].at > p) i -= 1;
  const a = parsed[i];
  const b = parsed[(i + 1) % parsed.length];
  const span = (b.at > a.at ? b.at : b.at + 1) - a.at;
  const k = smooth((p - a.at) / span);
  out.skyTop.lerpColors(a.skyTop, b.skyTop, k);
  out.horizon.lerpColors(a.horizon, b.horizon, k);
  out.glow.lerpColors(a.glow, b.glow, k);
  out.spill.lerpColors(a.spill, b.spill, k);
  out.spillStrength = a.spillStrength + (b.spillStrength - a.spillStrength) * k;
  out.occupancy = a.occupancy + (b.occupancy - a.occupancy) * k;
  out.stars = a.stars + (b.stars - a.stars) * k;
}

/** Where the train's head is and which way it runs, or `null` between passes. */
function trainAt(t: number) {
  if (t < TRAIN_FIRST_S) return null;
  const since = t - TRAIN_FIRST_S;
  const pass = Math.floor(since / TRAIN_PERIOD_S);
  const run = (since % TRAIN_PERIOD_S) * TRAIN_SPEED;
  if (run > TRAIN_REACH * 2 + TRAIN_LENGTH) return null;
  const dir = pass % 2 === 0 ? 1 : -1;
  return { head: dir * (run - TRAIN_REACH), dir };
}

const COMMON_GLSL = /* glsl */ `
  float hash1(float n) { return fract(sin(n) * 43758.5453123); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

const GLASS_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 view = viewMatrix * world;
    vFogDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const GLASS_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSkyTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uOccupancy;
  uniform float uStars;
  uniform float uTrainHead;
  uniform float uTrainDir;
  uniform float uTrainOn;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vFogDepth;

  ${COMMON_GLSL}

  // Follows the view ray through the glass to a plane \`depth\` metres behind the wall, so each
  // layer of the city shifts with the camera like a real view out of a window.
  vec2 beyond(vec3 dir, float depth) {
    return vWorld.xy + dir.xy * (depth / max(-dir.z, 0.05));
  }

  // Anti-aliased 0..1 mask for lo < x < hi, so small far windows do not shimmer as the camera pans.
  float band(float x, float lo, float hi, float aa) {
    return smoothstep(lo - aa, lo + aa, x) * (1.0 - smoothstep(hi - aa, hi + aa, x));
  }

  // One row of buildings. rgb is the lit-window light and a is how much the silhouette covers.
  vec4 skyline(vec2 p, float colW, float base, float range, float gap, float seed, vec2 cell) {
    float col = floor(p.x / colW);
    float id = hash1(col * 1.31 + seed);
    float h = id < gap ? -1.0 : base + hash1(col * 7.7 + seed) * range;
    float aaY = fwidth(p.y);
    float body = 1.0 - smoothstep(h - aaY, h + aaY, p.y);

    vec2 g = p / cell;
    vec2 cid = floor(g);
    vec2 f = fract(g);
    vec2 aa = fwidth(g) * 0.75;
    float pane = band(f.x, 0.22, 0.78, aa.x) * band(f.y, 0.28, 0.72, aa.y);
    // Each window rerolls on its own clock, every 15 to 60 seconds, so the city never blinks in step.
    float wid = hash2(cid + seed);
    float epoch = floor(uTime / (15.0 + wid * 45.0) + wid * 13.0);
    float lit = step(1.0 - uOccupancy, hash2(cid * 1.7 + epoch * 3.1 + seed));
    // Keep the top floor and the stretch below the roof line dark, which reads as a parapet.
    lit *= step(p.y, h - cell.y * 0.6);
    vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.9, 0.7), hash1(wid * 91.0));
    // A few are blue, flickering TVs.
    float tv = step(0.9, wid);
    float flicker = 0.65 + 0.35 * sin(uTime * (7.0 + wid * 9.0) + wid * 40.0);
    vec3 light = mix(warm, vec3(0.45, 0.6, 1.0) * flicker, tv) * lit * pane;
    // Red aviation beacons on the tallest towers.
    float tall = step(base + range * 0.82, h);
    vec2 beacon = vec2((col + 0.5) * colW, h + 0.25) - p;
    float blink = step(0.55, fract(uTime * 0.45 + id * 3.0));
    light += vec3(1.0, 0.15, 0.08) * tall * blink * smoothstep(0.32, 0.0, length(beacon)) * 3.0;
    return vec4(light, body);
  }

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);

    // Sky: gradient over the height reached 60 m out, glowing above the street.
    float skyY = beyond(dir, 60.0).y;
    float up = smoothstep(9.0, 30.0, skyY);
    vec3 color = mix(uHorizon, uSkyTop, up);
    color += uGlow * exp(-max(skyY - 8.0, 0.0) / 5.0) * 0.35;

    vec2 starP = beyond(dir, 240.0) * 0.7;
    float star = step(0.985, hash2(floor(starP)));
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.3 + hash2(floor(starP) + 9.0) * 30.0);
    color += vec3(0.9, 0.92, 1.0) * star * twinkle * uStars * smoothstep(0.35, 0.0, length(fract(starP) - 0.5)) * up;

    // Far towers: hazy, tall, picked out mostly by their lit windows.
    vec4 far = skyline(beyond(dir, 40.0), 3.0, 9.5, 12.0, 0.08, 3.0, vec2(0.62, 0.78));
    vec3 farBody = mix(uHorizon, uSkyTop, 0.55) * 0.32;
    color = mix(color, farBody + far.rgb * 0.55, far.a);

    // The elevated line, 22 m out, with its lit carriages.
    vec2 tp = beyond(dir, 22.0);
    float deck = band(tp.y, 7.25, 7.55, fwidth(tp.y));
    color = mix(color, vec3(0.02, 0.025, 0.03), deck * 0.9);
    float along = (uTrainHead - tp.x) * uTrainDir;
    float car = band(along, 0.0, ${TRAIN_LENGTH.toFixed(1)}, fwidth(tp.x)) * band(tp.y, 7.55, 8.55, fwidth(tp.y)) * uTrainOn;
    float carWin = band(fract(along / 1.6), 0.15, 0.85, 0.05) * band(tp.y, 7.85, 8.3, fwidth(tp.y));
    color = mix(color, vec3(0.05, 0.055, 0.06), car);
    color += vec3(1.0, 0.92, 0.75) * car * carWin * 1.3;

    // Near blocks: darker roofs low in the frame, with gaps the train shows through.
    vec4 near = skyline(beyond(dir, 12.0), 4.2, 4.2, 3.4, 0.25, 11.0, vec2(0.85, 0.72));
    color = mix(color, uSkyTop * 0.18 + near.rgb * 0.6, near.a);

    // Old glass: a steel glazing grid, grime, and a little frost towards the frame.
    float grime = vnoise(vUv * vec2(9.0, 6.0)) * 0.6 + vnoise(vUv * vec2(31.0, 22.0)) * 0.4;
    color *= 0.72 + 0.28 * grime;
    vec2 edge = min(vUv, 1.0 - vUv);
    color *= smoothstep(0.0, 0.08, min(edge.x * 0.66, edge.y));
    float barAa = fwidth(vUv.y) * 1.5;
    float bars = band(vUv.y, 0.49, 0.51, barAa) + band(vUv.x, 0.245, 0.255, barAa) + band(vUv.x, 0.745, 0.755, barAa);
    color = mix(color, vec3(0.03, 0.035, 0.033), clamp(bars, 0.0, 1.0));

    // Fog the glass only part way: the view outside should still read across the gym.
    float fog = smoothstep(uFogNear, uFogFar, vFogDepth) * 0.45;
    gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const SHAFT_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SHAFT_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec2 vUv;
  varying vec3 vWorld;

  ${COMMON_GLSL}

  void main() {
    // v runs from the glass (1) to the floor (0): bright at the window, gone before it lands.
    float along = pow(vUv.y, 1.6);
    float across = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    // Dust drifting through the beam, and a softer slow breathing on top.
    float dust = vnoise(vWorld.xz * 2.2 + vec2(uTime * 0.08, -uTime * 0.05));
    float breathe = vnoise(vec2(vWorld.x * 0.3, uTime * 0.07));
    float a = along * across * (0.55 + 0.45 * dust) * (0.7 + 0.3 * breathe) * uStrength;
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The city's live state. Module-level because there is only ever one city: per-frame writes go
 * here, and the memoised materials below just hold references to these objects.
 */
const mood = {
  ...parsed[0],
  skyTop: new Color(),
  horizon: new Color(),
  glow: new Color(),
  spill: new Color(),
};
const city = {
  uTime: { value: 0 },
  uSkyTop: { value: mood.skyTop },
  uHorizon: { value: mood.horizon },
  uGlow: { value: mood.glow },
  uOccupancy: { value: 0.5 },
  uStars: { value: 0 },
  uTrainHead: { value: 0 },
  uTrainDir: { value: 1 },
  uTrainOn: { value: 0 },
};
const beam = {
  uTime: city.uTime,
  uColor: { value: mood.spill },
  uStrength: { value: 0.3 },
};

export function CityWindows({ fog }: { fog: { color: string; near: number; far: number } }) {
  const glass = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: GLASS_VERTEX,
        fragmentShader: GLASS_FRAGMENT,
        uniforms: {
          ...city,
          uFogColor: { value: new Color(fog.color) },
          uFogNear: { value: fog.near },
          uFogFar: { value: fog.far },
        },
      }),
    [fog.color, fog.near, fog.far],
  );
  const shaft = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: SHAFT_VERTEX,
        fragmentShader: SHAFT_FRAGMENT,
        uniforms: beam,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  useEffect(
    () => () => {
      glass.dispose();
      shaft.dispose();
    },
    [glass, shaft],
  );

  const wash = useRef<PointLight>(null);
  const trainLight = useRef<PointLight>(null);
  const clock = useRef(0);
  const still = useMemo(() => prefersReducedMotion(), []);

  useFrame((_, dt) => {
    // Reduced motion freezes the city on one calm moment instead of animating it.
    if (!still) clock.current += Math.min(dt, 0.1);
    const t = clock.current;
    sampleMood(START_PHASE + t / CYCLE_S, mood);
    const train = trainAt(t);

    city.uTime.value = t;
    city.uOccupancy.value = mood.occupancy;
    city.uStars.value = mood.stars;
    city.uTrainOn.value = train ? 1 : 0;
    if (train) {
      city.uTrainHead.value = train.head;
      city.uTrainDir.value = train.dir;
    }
    beam.uStrength.value = 0.17 * mood.spillStrength;

    if (wash.current) {
      wash.current.color.copy(mood.spill);
      wash.current.intensity = 34 * mood.spillStrength;
    }
    if (trainLight.current) {
      // The carriages' glow slides along the wall in step with the train in the glass.
      const centre = train ? train.head - (train.dir * TRAIN_LENGTH) / 2 : 0;
      const onWall = Math.max(0, 1 - Math.abs(centre) / 40);
      trainLight.current.position.x = Math.max(-14, Math.min(14, centre * 0.55));
      trainLight.current.intensity = train ? 22 * onWall : 0;
    }
  });

  return (
    <>
      {WINDOW_XS.map((x) => (
        <group key={x} position={[x, WINDOW_Y, WALL_FACE_Z]}>
          <mesh position={[0, 0, 0.02]}>
            <boxGeometry args={[PANE_W + 0.24, PANE_H + 0.24, 0.06]} />
            <meshStandardMaterial color="#1c201e" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0, 0.06]} material={glass}>
            <planeGeometry args={[PANE_W, PANE_H]} />
          </mesh>
          <mesh position={[0, 0, 0.1]}>
            <boxGeometry args={[0.08, PANE_H + 0.3, 0.1]} />
            <meshStandardMaterial color="#202522" />
          </mesh>
          {/* Light falling from the glass down towards the floor; additive, so it costs no sorting. */}
          <mesh position={[0, -2.6, 2.8]} rotation={[-1.05, 0, 0]} material={shaft}>
            <planeGeometry args={[PANE_W * 1.1, 6.2]} />
          </mesh>
        </group>
      ))}
      <pointLight ref={wash} position={[1, 6.4, -9.2]} distance={18} decay={2} />
      <pointLight
        ref={trainLight}
        position={[0, 6.2, -9.6]}
        distance={12}
        decay={2}
        color="#ffe2b0"
      />
    </>
  );
}
