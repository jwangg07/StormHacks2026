import { useEffect, useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Texture } from 'three';

/**
 * Procedural, tileable surface textures for the gym scenes.
 *
 * Every surface is painted in near-white greyscale so it multiplies with the mesh's own
 * `color`: the palette stays in the JSX, and code that animates `color` keeps working.
 */

type Rand = () => number;
type Painter = (ctx: CanvasRenderingContext2D, size: number, rand: Rand) => void;

interface Surface {
  /** Canvas edge in pixels; a power of two so the GPU can mipmap it. */
  size: number;
  /** World size, in metres, that one copy of the texture covers: [u, v]. */
  tile: [number, number];
  paint: Painter;
}

/** Small seeded PRNG, so every load paints the same scuffs in the same places. */
function mulberry32(seed: number): Rand {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: Rand, min: number, max: number) => min + rand() * (max - min);

/**
 * Draws a mark, plus a copy on the far side of any edge it comes within `reach` of, so marks
 * crossing an edge wrap. `draw` must not consume `rand`: each copy has to be identical.
 */
function wrapped(
  size: number,
  x: number,
  y: number,
  reach: number,
  draw: (x: number, y: number) => void,
) {
  const shifts = (v: number) => [
    0,
    ...(v < reach ? [size] : []),
    ...(v > size - reach ? [-size] : []),
  ];
  for (const dx of shifts(x)) for (const dy of shifts(y)) draw(x + dx, y + dy);
}

function fill(ctx: CanvasRenderingContext2D, size: number, shade: string) {
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: Rand,
  count: number,
  radius: [number, number],
  colors: string[],
) {
  for (let i = 0; i < count; i++) {
    const r = between(rand, radius[0], radius[1]);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    wrapped(size, rand() * size, rand() * size, r, (x, y) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/** Large soft stains: sweat, chalk, rust, wear. */
function blotches(
  ctx: CanvasRenderingContext2D,
  size: number,
  rand: Rand,
  count: number,
  radius: [number, number],
  rgb: string,
  alpha: [number, number],
) {
  for (let i = 0; i < count; i++) {
    const r = between(rand, radius[0], radius[1]);
    const a = between(rand, alpha[0], alpha[1]);
    wrapped(size, rand() * size, rand() * size, r, (x, y) => {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, `rgb(${rgb} / ${a})`);
      glow.addColorStop(1, `rgb(${rgb} / 0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    });
  }
}

function stitches(ctx: CanvasRenderingContext2D, from: [number, number], to: [number, number]) {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgb(255 255 255 / 30%)';
  ctx.beginPath();
  ctx.moveTo(...from);
  ctx.lineTo(...to);
  ctx.stroke();
  ctx.restore();
}

function paintCanvas(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#efefef');
  // Coarse weave: alternating light and dark threads both ways.
  for (let i = 0; i < size; i += 3) {
    ctx.fillStyle = `rgb(0 0 0 / ${between(rand, 0.02, 0.07)})`;
    ctx.fillRect(0, i, size, 1);
    ctx.fillStyle = `rgb(255 255 255 / ${between(rand, 0.03, 0.08)})`;
    ctx.fillRect(i, 0, 1, size);
  }
  blotches(ctx, size, rand, 36, [24, 90], '70 58 40', [0.05, 0.13]);
  // Footwork scuffs.
  ctx.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const angle = rand() * Math.PI;
    const length = between(rand, 12, 46);
    ctx.lineWidth = between(rand, 2, 6);
    ctx.strokeStyle = `rgb(40 34 28 / ${between(rand, 0.06, 0.14)})`;
    const bendX = between(rand, -6, 6);
    const bendY = between(rand, -6, 6);
    wrapped(size, x, y, length + 12, (wx, wy) => {
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(
        wx + Math.cos(angle) * length * 0.5 + bendX,
        wy + Math.sin(angle) * length * 0.5 + bendY,
        wx + Math.cos(angle) * length,
        wy + Math.sin(angle) * length,
      );
      ctx.stroke();
    });
  }
  speckle(ctx, size, rand, 1400, [0.5, 1.3], ['rgb(30 25 20 / 12%)', 'rgb(255 255 255 / 10%)']);
}

/** Canvas with a stitched panel seam down one edge, for the training mat. */
function paintCanvasPanel(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  paintCanvas(ctx, size, rand);
  ctx.fillStyle = 'rgb(40 32 22 / 38%)';
  ctx.fillRect(0, 0, 4, size);
  ctx.fillStyle = 'rgb(255 255 255 / 12%)';
  ctx.fillRect(4, 0, 2, size);
  stitches(ctx, [12, 0], [12, size]);
  stitches(ctx, [size - 8, 0], [size - 8, size]);
}

function paintPadding(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#ebebeb');
  // Quilted ribs: each column bulges, lit on one side.
  const rib = size / 8;
  for (let x = 0; x < size; x += rib) {
    const shade = ctx.createLinearGradient(x, 0, x + rib, 0);
    shade.addColorStop(0, 'rgb(0 0 0 / 16%)');
    shade.addColorStop(0.35, 'rgb(255 255 255 / 10%)');
    shade.addColorStop(1, 'rgb(0 0 0 / 10%)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, 0, rib, size);
  }
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = `rgb(0 0 0 / ${between(rand, 0.01, 0.05)})`;
    ctx.fillRect(0, y, size, 1);
  }
  ctx.fillStyle = 'rgb(0 0 0 / 22%)';
  ctx.fillRect(0, 22, size, 2);
  ctx.fillRect(0, size - 24, size, 2);
  stitches(ctx, [0, 28], [size, 28]);
  stitches(ctx, [0, size - 28], [size, size - 28]);
  blotches(ctx, size, rand, 14, [20, 60], '60 50 40', [0.05, 0.1]);
}

function paintPaintedMetal(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#e6e6e6');
  // Vertical brush strokes left in the paint.
  for (let i = 0; i < 260; i++) {
    const light = rand() < 0.5;
    ctx.fillStyle = light
      ? `rgb(255 255 255 / ${between(rand, 0.03, 0.09)})`
      : `rgb(0 0 0 / ${between(rand, 0.03, 0.08)})`;
    ctx.fillRect(rand() * size, 0, between(rand, 0.5, 2), size);
  }
  // Chips knocked out of the paint, each ringed with a little rust.
  for (let i = 0; i < 22; i++) {
    const r = between(rand, 2, 7);
    const jag = Array.from({ length: 6 }, () => r * between(rand, 0.6, 1.2));
    wrapped(size, rand() * size, rand() * size, r * 3, (x, y) => {
      const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6);
      halo.addColorStop(0, 'rgb(150 82 40 / 22%)');
      halo.addColorStop(1, 'rgb(150 82 40 / 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
      ctx.fillStyle = 'rgb(70 62 56 / 55%)';
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2;
        ctx.lineTo(x + Math.cos(angle) * jag[k], y + Math.sin(angle) * jag[k]);
      }
      ctx.fill();
    });
  }
}

function paintRope(ctx: CanvasRenderingContext2D, size: number) {
  fill(ctx, size, '#f0f0f0');
  // Diagonal twists; a run of `size` across the height keeps the strands tiling vertically.
  const pitch = size / 4;
  for (let x = -size; x < size * 2; x += pitch) {
    ctx.lineWidth = pitch * 0.45;
    ctx.strokeStyle = 'rgb(0 0 0 / 18%)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size, size);
    ctx.stroke();
    ctx.lineWidth = pitch * 0.12;
    ctx.strokeStyle = 'rgb(255 255 255 / 30%)';
    ctx.beginPath();
    ctx.moveTo(x + pitch * 0.4, 0);
    ctx.lineTo(x + pitch * 0.4 + size, size);
    ctx.stroke();
  }
}

function paintPlanks(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#000');
  const planks = 8;
  const width = size / planks;
  for (let p = 0; p < planks; p++) {
    const x = p * width;
    // Two boards per column, butted at a staggered joint.
    const joint = rand() * size;
    for (const [from, to] of [
      [joint - size, joint],
      [joint, joint + size],
    ]) {
      const tone = Math.round(between(rand, 205, 245));
      ctx.fillStyle = `rgb(${tone} ${tone - 4} ${tone - 10})`;
      for (const shift of [0, -size]) ctx.fillRect(x + 1, from + shift, width - 2, to - from - 2);
    }
    // Grain running the length of the board.
    for (let g = 0; g < 9; g++) {
      const gx = x + between(rand, 3, width - 3);
      const amplitude = between(rand, 0.5, 2.5);
      const waves = 1 + Math.floor(rand() * 3);
      ctx.strokeStyle = `rgb(60 40 20 / ${between(rand, 0.05, 0.13)})`;
      ctx.lineWidth = between(rand, 0.6, 1.6);
      ctx.beginPath();
      for (let y = 0; y <= size; y += 8)
        ctx.lineTo(gx + Math.sin((y / size) * Math.PI * 2 * waves) * amplitude, y);
      ctx.stroke();
    }
  }
  blotches(ctx, size, rand, 30, [30, 110], '50 40 30', [0.06, 0.16]);
  speckle(ctx, size, rand, 600, [0.6, 1.6], ['rgb(20 15 10 / 18%)']);
}

function paintCinderBlock(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#b4b4b4');
  const blockW = size / 4;
  const blockH = size / 8;
  for (let row = 0; row < 8; row++) {
    // Running bond: every other course shifts half a block.
    const offset = row % 2 ? -blockW / 2 : 0;
    for (let col = 0; col <= 4; col++) {
      const tone = Math.round(between(rand, 214, 240));
      ctx.fillStyle = `rgb(${tone} ${tone} ${tone - 3})`;
      ctx.fillRect(offset + col * blockW + 3, row * blockH + 3, blockW - 6, blockH - 6);
    }
  }
  speckle(ctx, size, rand, 2200, [0.5, 1.8], ['rgb(0 0 0 / 14%)', 'rgb(255 255 255 / 12%)']);
  // Water stains running down from the windows.
  for (let i = 0; i < 12; i++) {
    const x = rand() * size;
    const top = rand() * size;
    const length = between(rand, 60, 220);
    const width = between(rand, 4, 18);
    wrapped(size, x, top, Math.max(length, width), (wx, wy) => {
      const drip = ctx.createLinearGradient(0, wy, 0, wy + length);
      drip.addColorStop(0, 'rgb(50 42 32 / 14%)');
      drip.addColorStop(1, 'rgb(50 42 32 / 0)');
      ctx.fillStyle = drip;
      ctx.fillRect(wx, wy, width, length);
    });
  }
}

function paintSteel(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#dcdcdc');
  blotches(ctx, size, rand, 26, [10, 50], '0 0 0', [0.04, 0.1]);
  blotches(ctx, size, rand, 18, [8, 40], '160 82 36', [0.14, 0.32]);
  speckle(ctx, size, rand, 900, [0.5, 1.5], ['rgb(120 60 30 / 22%)', 'rgb(0 0 0 / 14%)']);
}

function paintWood(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#ece6dc');
  // Grain lines with a whole number of waves across the tile, so they meet at the seam.
  for (let i = 0; i < 46; i++) {
    const y0 = rand() * size;
    const amplitude = between(rand, 1, 6);
    const waves = 1 + Math.floor(rand() * 3);
    const phase = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgb(70 45 20 / ${between(rand, 0.05, 0.15)})`;
    ctx.lineWidth = between(rand, 0.7, 2.2);
    for (const shift of [-size, 0, size]) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += 4)
        ctx.lineTo(x, y0 + shift + Math.sin((x / size) * Math.PI * 2 * waves + phase) * amplitude);
      ctx.stroke();
    }
  }
  // A couple of knots.
  for (let i = 0; i < 2; i++) {
    const rx = between(rand, 6, 12);
    const ry = rx * 0.45;
    wrapped(size, rand() * size, rand() * size, rx * 1.8, (x, y) => {
      for (let ring = 3; ring >= 1; ring--) {
        ctx.strokeStyle = `rgb(70 40 15 / ${0.12 + (3 - ring) * 0.08})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(x, y, rx * ring * 0.6, ry * ring * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }
}

function paintCloth(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#ebebeb');
  for (let i = 0; i < size; i += 2) {
    ctx.fillStyle = `rgb(0 0 0 / ${between(rand, 0.03, 0.08)})`;
    ctx.fillRect(0, i, size, 1);
    ctx.fillRect(i, 0, 1, size);
  }
  blotches(ctx, size, rand, 10, [10, 30], '0 0 0', [0.05, 0.12]);
}

function paintCork(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#e2e2e2');
  speckle(
    ctx,
    size,
    rand,
    4200,
    [0.6, 2.1],
    ['rgb(60 38 18 / 26%)', 'rgb(90 60 30 / 20%)', 'rgb(255 240 210 / 22%)'],
  );
  // Pin holes from notices long gone.
  speckle(ctx, size, rand, 40, [0.8, 1.3], ['rgb(20 12 6 / 60%)']);
}

function paintConcrete(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#e3e3e3');
  blotches(ctx, size, rand, 40, [16, 70], '0 0 0', [0.03, 0.08]);
  blotches(ctx, size, rand, 24, [16, 60], '255 255 255', [0.04, 0.1]);
  speckle(ctx, size, rand, 900, [0.4, 1.4], ['rgb(0 0 0 / 22%)', 'rgb(255 255 255 / 18%)']);
  // Hairline cracks.
  for (let i = 0; i < 4; i++) {
    let x = rand() * size;
    let y = rand() * size;
    let angle = rand() * Math.PI * 2;
    ctx.strokeStyle = 'rgb(0 0 0 / 20%)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 14; step++) {
      angle += between(rand, -0.6, 0.6);
      x += Math.cos(angle) * 5;
      y += Math.sin(angle) * 5;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintDiamondPlate(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#d6d6d6');
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = `rgb(255 255 255 / ${between(rand, 0.02, 0.06)})`;
    ctx.fillRect(0, rand() * size, size, 1);
  }
  const cell = size / 4;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const x = col * cell + cell / 2;
      const y = row * cell + cell / 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((row + col) % 2 ? Math.PI / 4 : -Math.PI / 4);
      ctx.fillStyle = 'rgb(0 0 0 / 30%)';
      ctx.fillRect(-cell * 0.32 + 1, -cell * 0.08 + 1, cell * 0.64, cell * 0.16);
      ctx.fillStyle = 'rgb(255 255 255 / 45%)';
      ctx.fillRect(-cell * 0.32, -cell * 0.08, cell * 0.64, cell * 0.16);
      ctx.restore();
    }
  }
}

function paintLeather(ctx: CanvasRenderingContext2D, size: number, rand: Rand) {
  fill(ctx, size, '#ededed');
  blotches(ctx, size, rand, 30, [20, 80], '0 0 0', [0.05, 0.12]);
  blotches(ctx, size, rand, 14, [16, 50], '255 255 255', [0.06, 0.12]);
  // Fine crazing in the hide.
  for (let i = 0; i < 260; i++) {
    let x = rand() * size;
    let y = rand() * size;
    let angle = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgb(0 0 0 / ${between(rand, 0.06, 0.16)})`;
    ctx.lineWidth = between(rand, 0.5, 1.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < 4; step++) {
      angle += between(rand, -0.9, 0.9);
      x += Math.cos(angle) * between(rand, 2, 6);
      y += Math.sin(angle) * between(rand, 2, 6);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // One stitched panel seam per tile.
  ctx.fillStyle = 'rgb(0 0 0 / 35%)';
  ctx.fillRect(0, 0, 3, size);
  stitches(ctx, [10, 0], [10, size]);
  stitches(ctx, [size - 7, 0], [size - 7, size]);
}

const SURFACES = {
  canvas: { size: 512, tile: [1.6, 1.6], paint: paintCanvas },
  canvasPanel: { size: 512, tile: [1.1, 1.1], paint: paintCanvasPanel },
  padding: { size: 256, tile: [0.9, 0.36], paint: paintPadding },
  paintedMetal: { size: 256, tile: [0.4, 0.4], paint: paintPaintedMetal },
  rope: { size: 64, tile: [0.12, 0.12], paint: paintRope },
  planks: { size: 512, tile: [2.4, 2.4], paint: paintPlanks },
  cinderBlock: { size: 512, tile: [1.6, 1.6], paint: paintCinderBlock },
  steel: { size: 256, tile: [0.8, 0.8], paint: paintSteel },
  wood: { size: 256, tile: [1, 0.5], paint: paintWood },
  cloth: { size: 128, tile: [0.3, 0.3], paint: paintCloth },
  cork: { size: 256, tile: [0.5, 0.5], paint: paintCork },
  concrete: { size: 256, tile: [1, 1], paint: paintConcrete },
  diamondPlate: { size: 128, tile: [0.25, 0.25], paint: paintDiamondPlate },
  leather: { size: 512, tile: [0.8, 0.8], paint: paintLeather },
} satisfies Record<string, Surface>;

export type SurfaceKind = keyof typeof SURFACES;

const painted = new Map<SurfaceKind, CanvasTexture>();

/** Paints each surface once; every mesh using it shares the same canvas and GPU upload. */
function baseTexture(kind: SurfaceKind) {
  let texture = painted.get(kind);
  if (!texture) {
    const { size, paint } = SURFACES[kind];
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) paint(ctx, size, mulberry32([...kind].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)));
    texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    painted.set(kind, texture);
  }
  return texture;
}

/**
 * A surface texture tiled to real-world scale on a face `width` x `height` metres
 * (the face's U and V extents). `vertical` turns the pattern a quarter turn, for grain or
 * brushing that should run up a post instead of across it.
 */
export function useSurface(
  kind: SurfaceKind,
  width: number,
  height: number,
  { vertical = false }: { vertical?: boolean } = {},
): Texture {
  const texture = useMemo(() => {
    const [tileU, tileV] = SURFACES[kind].tile;
    // A clone shares the painted image, so this only costs a new UV transform.
    const result = baseTexture(kind).clone();
    if (vertical) {
      // The rotation runs before the repeat, so the texture's U now spans the face's V.
      result.rotation = Math.PI / 2;
      result.repeat.set(height / tileU, width / tileV);
    } else {
      result.repeat.set(width / tileU, height / tileV);
    }
    return result;
  }, [kind, width, height, vertical]);

  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}
