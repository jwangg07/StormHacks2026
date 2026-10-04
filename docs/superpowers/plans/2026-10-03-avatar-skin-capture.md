# Avatar Skin Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/avatar`, the player turns 360° in front of the webcam, and their look is baked into a texture on the team's fighter model. Every fighter (lobby, ring, first-person arms) uses that model and skin, and the skin can be relayed to an opponent.

**Architecture:** Blender export adds UVs to `fighter.glb`. A dedicated capture Web Worker runs MediaPipe Pose (with segmentation masks), estimates how far the player has turned, keeps the best frame per 45° slot, and bakes a 1024² JPEG. The bake projects every texel, by body part, from the matching landmark segment in each frame. Pure math lives in `apps/web/src/avatar/skin/*` (no three.js, unit-tested in Node). A shared `FighterModel` component replaces the CSS robot and capsule fighters. IndexedDB stores the skin. Socket.IO relays it through a zod-validated `avatar:skin` event.

**Tech Stack:** React 19, @react-three/fiber 9 + drei 10, three 0.186, @mediapipe/tasks-vision 0.10.35, Socket.IO 4, zod 4, Blender 5.1 (headless), `node --test` with esbuild bundling for tests.

**Spec:** `docs/superpowers/specs/2026-10-03-avatar-skin-capture-design.md`

## Global Constraints

- Model space: +Y up, +Z forward, +X is the fighter's **left** (verified from `fighter.glb`: `upper_arm_L` at x=+0.20, toes at z=+0.10).
- Camera space used by projection: x = raw-image right, y = up, z = toward the camera. Raw (unmirrored) frames only; mirror only the on-screen preview.
- Skin texture: 1024×1024 JPEG, `flipY = false`, sRGB. glTF UV (0,0) is the image's top-left: texel row = `v * size`.
- 8 capture slots × 45°, ±20° window; "Finish now" allowed from 6 filled slots.
- Skin payload ≤ `AVATAR_SKIN_MAX_BYTES` = 262144 (256 KB), JPEG magic bytes `FF D8 FF`.
- Server keeps skins in memory only; nothing is persisted server-side.
- The .blend is never modified; only `tools/blender/export_fighter.py` changes.
- Pure modules under `apps/web/src/avatar/skin/` must not import three.js, React or DOM APIs (the worker and Node tests use them).
- Tests: `node --test` files named `*.test.mjs`, loading TS through `tools/test/loadTs.mjs`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The back view mislabels left/right.** BlazePose assumes a front view. The expected behavior is that arms are not swapped between sides in the back frames. Pinned by `orientLandmarks` tests in Task 5.
2. **The player turns clockwise instead of counter-clockwise.** The expected behavior is that the side-view frames land on the correct side of the torso, not mirrored. Pinned by the reverse-direction yaw test (Task 4) and the bake orientation test with `direction = -1` (Task 6).
3. **Background pixels (a wall behind the player) at limb edges.** The expected behavior is that they are never painted onto the fighter. Pinned by the mask-rejection bake test in Task 6.
4. **Body parts never seen in any frame (armpits, soles of the feet).** The expected behavior is that they get neighbouring colors, not black. Pinned by the hole-fill and gutter tests in Task 6.
5. **An oversized or non-JPEG payload sent to the server.** The expected behavior is rejection with a recoverable error and no relay. Pinned by the schema and relay tests in Task 11.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tools/blender/export_fighter.py` (modify) | Add Smart UV Project before export |
| `apps/web/public/models/fighter.glb` (regenerate) | Model now has `TEXCOORD_0` |
| `apps/web/public/models/README.md` (modify) | Document the UV step |
| `tools/test/loadTs.mjs` (create) | Bundle a TS module with esbuild and import it in Node tests |
| `package.json` (modify) | Add a `test` script |
| `apps/web/src/avatar/skin/vec.ts` | Tiny immutable Vec3 math |
| `apps/web/src/avatar/skin/parts.ts` | `ModelData`, body `PARTS`, landmark pairs, `partFrames` |
| `apps/web/src/avatar/skin/model.ts` | three.js `SkinnedMesh` → `ModelData` (main thread only) |
| `apps/web/src/avatar/skin/texelMap.ts` | Rasterize UV triangles into per-texel part/t/du/dw |
| `apps/web/src/avatar/skin/yaw.ts` | `observeYaw` + `YawTracker` |
| `apps/web/src/avatar/skin/framing.ts` | Landmark visibility, motion, frame score |
| `apps/web/src/avatar/skin/slots.ts` | `slotFor`, `SlotBuffer` |
| `apps/web/src/avatar/skin/project.ts` | `CapturedFrame`, `orientLandmarks`, `imageParts`, `projectTexel` |
| `apps/web/src/avatar/skin/bake.ts` | `bakeSkin`, `finishTexture` (blend, hole fill, gutter) |
| `apps/web/src/avatar/captureMessages.ts` | Worker message types |
| `apps/web/src/avatar/capture.worker.ts` | Pose + slots + bake in a worker |
| `apps/web/src/avatar/captureClient.ts` | One-frame-in-flight worker driver |
| `apps/web/src/avatar/useSkinCapture.ts` | React state machine for the studio |
| `apps/web/src/avatar/fighterAsset.ts` | `FIGHTER_URL`, `loadFighterModelData()` |
| `apps/web/src/avatar/skinStore.ts` | IndexedDB skin + `useSkin`, `useBlobTexture` |
| `apps/web/src/avatar/rig.ts` | Bone lookup, `aim`, arm poses, gloves (moved from FirstPersonArms) |
| `apps/web/src/avatar/FighterModel.tsx` | Shared skinned fighter component |
| `apps/web/src/avatar/FighterPortrait.tsx` | Small lobby canvas showing the fighter |
| `apps/web/src/avatar/TurnDial.tsx` | SVG dial of captured angles |
| `apps/web/src/pages/AvatarPage.tsx` (rewrite) + `avatarStudio.css` | Studio UI |
| `apps/web/src/game/FirstPersonArms.tsx`, `FirstPersonScreen.tsx`, `Ring.tsx`, `pages/LobbyPage.tsx`, `pages/GamePage.tsx` (modify) | Use FighterModel / skin |
| `apps/web/src/ui/RobotAvatar.tsx` (delete), `styles/base.css` (modify) | Remove robot placeholder |
| `packages/core/src/protocol.ts` (modify) | `AVATAR_SKIN_MAX_BYTES`, `avatarSkinSchema` |
| `apps/api/src/avatar/skinRelay.ts`, `apps/api/src/avatar/socket.ts` (create), `apps/api/src/net/socket.ts` (modify) | Server relay |
| `apps/web/src/net/skinSync.ts` (create) | Client publish/subscribe |

---

### Task 1: Export UVs from Blender and add the test loader

**Files:**
- Modify: `tools/blender/export_fighter.py`
- Regenerate: `apps/web/public/models/fighter.glb`
- Modify: `apps/web/public/models/README.md`
- Create: `tools/test/loadTs.mjs`, `apps/web/tests/fixtures/loadFighter.mjs`, `apps/web/tests/fighterModel.test.mjs`
- Modify: `package.json` (root)

**Interfaces:**
- Produces: `loadTs(url: URL): Promise<module>` (bundles TS + imports); `loadFighterScene(): Promise<Object3D>` (Node-loaded GLB scene).

- [ ] **Step 1: Write the failing test**

`tools/test/loadTs.mjs`:
```js
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundle a TS module and its local imports with the esbuild Vite already ships, then import it. */
export async function loadTs(url) {
  const result = await build({
    entryPoints: [fileURLToPath(url)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  });
  const code = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${code}`);
}
```

`apps/web/tests/fixtures/loadFighter.mjs`:
```js
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Parse the committed fighter.glb in Node (it has no textures, so no DOM is needed). */
export async function loadFighterScene() {
  const file = await readFile(new URL('../../public/models/fighter.glb', import.meta.url));
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(data, '', (gltf) => resolve(gltf.scene), reject));
}

export function findSkinned(root) {
  let found = null;
  root.traverse((object) => {
    if (!found && object.isSkinnedMesh) found = object;
  });
  if (!found) throw new Error('fighter.glb has no skinned mesh');
  return found;
}
```

`apps/web/tests/fighterModel.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { findSkinned, loadFighterScene } from './fixtures/loadFighter.mjs';

test('fighter.glb has UVs inside the unit square for every vertex', async () => {
  const mesh = findSkinned(await loadFighterScene());
  const uv = mesh.geometry.getAttribute('uv');
  assert.ok(uv, 'TEXCOORD_0 missing: re-run tools/blender/export_fighter.py');
  assert.equal(uv.count, mesh.geometry.getAttribute('position').count);
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1, `u out of range at ${i}`);
    assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1, `v out of range at ${i}`);
  }
});

test('fighter.glb keeps the 22-bone deform skeleton', async () => {
  const mesh = findSkinned(await loadFighterScene());
  assert.equal(mesh.skeleton.bones.length, 22);
  assert.ok(mesh.skeleton.bones.some((bone) => bone.name === 'upper_arm_L'));
});
```

Root `package.json`, add to `"scripts"`:
```json
"test": "node --test \"packages/*/tests/*.test.mjs\" \"apps/*/tests/*.test.mjs\""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/fighterModel.test.mjs`
Expected: FAIL on "TEXCOORD_0 missing" (the bone test passes).

- [ ] **Step 3: Add UV generation to the export script**

In `tools/blender/export_fighter.py` add `import math` after `import sys`. Insert this block immediately before `bpy.ops.object.select_all(action="DESELECT")` (the one that precedes `fighter.select_set(True)`):
```python
# The camera-baked skin needs non-overlapping UVs; the source mesh has none.
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
if not body.data.uv_layers:
    body.data.uv_layers.new(name="UVMap")
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
bpy.ops.object.mode_set(mode="OBJECT")
```
In the `export_scene.gltf` call add `export_texcoords=True,`.

Re-export:
```sh
"/mnt/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b "C:\\Users\\donov\\Documents\\BlenderProjects\\StormHacks_Base.blend" \
  --python "$(wslpath -w tools/blender/export_fighter.py)" -- \
  "$(wslpath -w apps/web/public/models)\\fighter.glb"
```
Expected: `Exported 22 bones to ...fighter.glb`. If the test still reports `TEXCOORD_0 missing` (the exporter drops UVs no material uses), change `export_materials="NONE"` to `export_materials="PLACEHOLDER"` and re-run.

In `apps/web/public/models/README.md`, Fighter model section, change "exports only the `Body` mesh with no materials or animations" to "generates UVs with Smart UV Project (for the camera-baked skin) and exports only the `Body` mesh with no materials or animations".

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/fighterModel.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/blender/export_fighter.py tools/test/loadTs.mjs apps/web/public/models/fighter.glb apps/web/public/models/README.md apps/web/tests/fixtures/loadFighter.mjs apps/web/tests/fighterModel.test.mjs package.json
git commit -m "feat(avatar): export fighter UVs for camera-baked skins"
```

---

### Task 2: Body parts, model extraction and part frames

**Files:**
- Create: `apps/web/src/avatar/skin/vec.ts`, `apps/web/src/avatar/skin/parts.ts`, `apps/web/src/avatar/skin/model.ts`
- Test: `apps/web/tests/skinParts.test.mjs`

**Interfaces:**
- Produces: `Vec3`, `FORWARD`, `UP`, `add/sub/scale/dot/cross/length/normalize/midpoint/rotateY`; `ModelData`; `PartSpec`; `PARTS`; `TORSO_PART = 0`; `LANDMARK_PAIRS`; `PartFrame { a, b, axis, length, u, w }`; `bonePartIndex(model): Uint8Array`; `dominantPart(model, boneParts, vertices): number`; `partFrames(model): PartFrame[]`; `findSkinnedMesh(root)`, `extractModelData(mesh): ModelData`.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/skinParts.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';
import { loadFighterScene } from './fixtures/loadFighter.mjs';

const { extractModelData, findSkinnedMesh } = await loadTs(new URL('../src/avatar/skin/model.ts', import.meta.url));
const { PARTS, partFrames, rotateY } = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const model = extractModelData(findSkinnedMesh(await loadFighterScene()));
const frames = partFrames(model);
const frame = (name) => frames[PARTS.findIndex((part) => part.name === name)];
const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);

test('extracts bind-pose geometry with UVs and named joints', () => {
  assert.equal(model.positions.length / 3, model.uvs.length / 2);
  assert.equal(model.skinIndex.length, (model.positions.length / 3) * 4);
  assert.equal(model.indices.length % 3, 0);
  const hips = model.bones.find((bone) => bone.name === 'hips');
  close(hips.head[1], 0.92, 0.01, 'hips height');
});

test('every bone belongs to exactly one part', () => {
  const names = model.bones.map((bone) => bone.name).sort();
  const owned = PARTS.flatMap((part) => part.bones).sort();
  assert.deepEqual(owned, names);
});

test('torso runs up from the hips with its front facing +Z', () => {
  const torso = frame('torso');
  close(torso.axis[1], 1, 0.02, 'torso axis up');
  close(torso.u[2], 1, 0.02, 'torso front');
  close(torso.w[0], 1, 0.02, 'torso side is the fighter left');
  close(torso.length, 0.48, 0.02, 'hips to shoulders');
});

test('left upper arm points out to +X and down in the A-pose', () => {
  const arm = frame('upperArm_L');
  assert.ok(arm.axis[0] > 0.6 && arm.axis[1] < -0.5, `axis ${arm.axis}`);
  close(arm.u[2], 1, 0.05, 'arm front');
});

test('feet use up as their front because they point forward', () => {
  const foot = frame('foot_L');
  assert.ok(foot.axis[2] > 0.8, `foot axis ${foot.axis}`);
  assert.ok(foot.u[1] > 0.9, `foot front ${foot.u}`);
  assert.ok(foot.length > 0.08);
});

test('head reaches from the shoulders to ear height', () => {
  const head = frame('head');
  close(head.b[1], 1.66, 0.04, 'ear height');
});

test('rotateY turns forward toward +X for positive yaw', () => {
  const turned = rotateY([0, 0, 1], Math.PI / 2);
  close(turned[0], 1, 1e-9, 'x');
  close(turned[2], 0, 1e-9, 'z');
});
```

`apps/web/tests/fixtures/skinIndex.ts` (one entry for all pure skin modules, so tests share one bundle):
```ts
export * from '../../src/avatar/skin/vec';
export * from '../../src/avatar/skin/parts';
export * from '../../src/avatar/skin/texelMap';
export * from '../../src/avatar/skin/yaw';
export * from '../../src/avatar/skin/framing';
export * from '../../src/avatar/skin/slots';
export * from '../../src/avatar/skin/project';
export * from '../../src/avatar/skin/bake';
```
Until later tasks exist, comment out the lines for modules that do not exist yet, and uncomment each in its own task.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/skinParts.test.mjs`
Expected: FAIL. esbuild cannot resolve `../src/avatar/skin/model.ts`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/avatar/skin/vec.ts`:
```ts
export type Vec3 = readonly [number, number, number];

export const FORWARD: Vec3 = [0, 0, 1];
export const UP: Vec3 = [0, 1, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const size = length(a);
  return size > 0 ? scale(a, 1 / size) : a;
};
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/** Turn a body-frame vector by the player's yaw (radians about +Y; positive swings +Z toward +X). */
export const rotateY = (a: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
};
```

`apps/web/src/avatar/skin/parts.ts`:
```ts
import { add, cross, dot, FORWARD, length, midpoint, normalize, scale, sub, UP } from './vec';
import type { Vec3 } from './vec';

/** Rest-pose fighter geometry for baking. Model space: +Y up, +Z forward, +X is the fighter's left. */
export interface ModelData {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Bind-pose joint positions, indexed like skinIndex. */
  bones: { name: string; head: Vec3 }[];
}

/** A body region textured from the image segment between two landmark groups. */
export interface PartSpec {
  name: string;
  bones: readonly string[];
  /** MediaPipe pose landmark indices averaged into the segment's start and end. */
  from: readonly number[];
  to: readonly number[];
  /** Body-frame direction treated as the part's front. Feet point forward, so theirs is up. */
  front: 'forward' | 'up';
  /** Feet foreshorten toward the camera, so their axis comes from the model turned by yaw. */
  axisFromModel: boolean;
}

function limbs(side: 'L' | 'R', offset: 0 | 1): PartSpec[] {
  const limb = (name: string, bones: string[], from: number, to: number, foot = false): PartSpec => ({
    name: `${name}_${side}`,
    bones: bones.map((bone) => `${bone}_${side}`),
    from: [from + offset],
    to: [to + offset],
    front: foot ? 'up' : 'forward',
    axisFromModel: foot,
  });
  return [
    limb('upperArm', ['upper_arm'], 11, 13),
    limb('forearm', ['forearm'], 13, 15),
    limb('hand', ['hand'], 15, 19),
    limb('thigh', ['thigh'], 23, 25),
    limb('shin', ['shin'], 25, 27),
    limb('foot', ['foot', 'toe'], 27, 31, true),
  ];
}

export const PARTS: readonly PartSpec[] = [
  {
    name: 'torso',
    bones: ['hips', 'spine', 'chest', 'upper_chest', 'shoulder_L', 'shoulder_R'],
    from: [23, 24],
    to: [11, 12],
    front: 'forward',
    axisFromModel: false,
  },
  { name: 'head', bones: ['neck', 'head'], from: [11, 12], to: [7, 8], front: 'forward', axisFromModel: false },
  ...limbs('L', 0),
  ...limbs('R', 1),
];
export const TORSO_PART = 0;

/** Anatomical left/right landmark pairs: eyes, ears, mouth, arms, hands, legs, feet. */
export const LANDMARK_PAIRS: readonly (readonly [number, number])[] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
];

/** Ear height as a fraction of the head bone's base-of-skull → crown span. */
export const HEAD_EAR_FRACTION = 0.45;
/** Shortest hand/foot reach, so a part with no dominant vertices still has an axis. */
const MIN_TIP = 0.05;

/** A part's segment in model space and its orthonormal frame: axis, front (u), side (w = axis × u). */
export interface PartFrame {
  a: Vec3;
  b: Vec3;
  axis: Vec3;
  length: number;
  u: Vec3;
  w: Vec3;
}

export function bonePartIndex(model: ModelData): Uint8Array {
  return Uint8Array.from(model.bones, ({ name }) => {
    const index = PARTS.findIndex((part) => part.bones.includes(name));
    if (index < 0) throw new Error(`Fighter bone ${name} belongs to no body part`);
    return index;
  });
}

/** The part with the largest summed skin weight over the given vertices. */
export function dominantPart(model: ModelData, boneParts: Uint8Array, vertices: readonly number[]): number {
  const totals = new Float32Array(PARTS.length);
  for (const vertex of vertices)
    for (let k = 0; k < 4; k++)
      totals[boneParts[model.skinIndex[vertex * 4 + k]]] += model.skinWeight[vertex * 4 + k];
  let best = 0;
  for (let part = 1; part < totals.length; part++) if (totals[part] > totals[best]) best = part;
  return best;
}

export function partFrames(model: ModelData): PartFrame[] {
  const boneParts = bonePartIndex(model);
  const joint = (name: string): Vec3 => {
    const bone = model.bones.find((candidate) => candidate.name === name);
    if (!bone) throw new Error(`Fighter model is missing bone ${name}`);
    return bone.head;
  };
  const vertexCount = model.positions.length / 3;
  const vertexParts = Array.from({ length: vertexCount }, (_, v) => dominantPart(model, boneParts, [v]));
  /** Farthest reach of a part's vertices from `origin` along `direction`. */
  const reach = (part: number, origin: Vec3, direction: Vec3) => {
    let best = 0;
    for (let v = 0; v < vertexCount; v++) {
      if (vertexParts[v] !== part) continue;
      const p: Vec3 = [model.positions[v * 3], model.positions[v * 3 + 1], model.positions[v * 3 + 2]];
      best = Math.max(best, dot(sub(p, origin), direction));
    }
    return best;
  };
  const tip = (part: number, origin: Vec3, direction: Vec3): [Vec3, Vec3] => [
    origin,
    add(origin, scale(direction, Math.max(MIN_TIP, reach(part, origin, direction)))),
  ];
  const shoulders = midpoint(joint('upper_arm_L'), joint('upper_arm_R'));

  const anchors = PARTS.map((part, index): [Vec3, Vec3] => {
    const s = part.name.slice(-1);
    switch (part.name.replace(/_[LR]$/, '')) {
      case 'torso':
        return [midpoint(joint('thigh_L'), joint('thigh_R')), shoulders];
      case 'head': {
        const base = joint('head');
        return [shoulders, add(base, scale(UP, HEAD_EAR_FRACTION * reach(index, base, UP)))];
      }
      case 'upperArm':
        return [joint(`upper_arm_${s}`), joint(`forearm_${s}`)];
      case 'forearm':
        return [joint(`forearm_${s}`), joint(`hand_${s}`)];
      case 'hand':
        return tip(index, joint(`hand_${s}`), normalize(sub(joint(`hand_${s}`), joint(`forearm_${s}`))));
      case 'thigh':
        return [joint(`thigh_${s}`), joint(`shin_${s}`)];
      case 'shin':
        return [joint(`shin_${s}`), joint(`foot_${s}`)];
      case 'foot':
        return tip(index, joint(`foot_${s}`), normalize(sub(joint(`toe_${s}`), joint(`foot_${s}`))));
      default:
        throw new Error(`No anchors for body part ${part.name}`);
    }
  });

  return anchors.map(([a, b], index) => {
    const axis = normalize(sub(b, a));
    const front = PARTS[index].front === 'up' ? UP : FORWARD;
    const u = normalize(sub(front, scale(axis, dot(front, axis))));
    return { a, b, axis, length: length(sub(b, a)), u, w: cross(axis, u) };
  });
}
```

`apps/web/src/avatar/skin/model.ts`:
```ts
import { Matrix4, Vector3 } from 'three';
import type { Object3D, SkinnedMesh } from 'three';
import type { ModelData } from './parts';

export function findSkinnedMesh(root: Object3D): SkinnedMesh {
  let found: SkinnedMesh | null = null;
  root.traverse((object) => {
    if (!found && (object as SkinnedMesh).isSkinnedMesh) found = object as SkinnedMesh;
  });
  if (!found) throw new Error('Fighter model has no skinned mesh.');
  return found;
}

/** Copy bind-pose geometry out of three.js so the worker and tests work with plain arrays. */
export function extractModelData(mesh: SkinnedMesh): ModelData {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!uv) throw new Error('Fighter model has no UVs. Re-run tools/blender/export_fighter.py.');
  const count = position.count;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const indices4 = new Uint16Array(count * 4);
  const weights4 = new Float32Array(count * 4);
  const point = new Vector3();
  for (let i = 0; i < count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
    positions.set([point.x, point.y, point.z], i * 3);
    uvs.set([uv.getX(i), uv.getY(i)], i * 2);
    indices4.set([skinIndex.getX(i), skinIndex.getY(i), skinIndex.getZ(i), skinIndex.getW(i)], i * 4);
    weights4.set([skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)], i * 4);
  }
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: count }, (_, i) => i);
  const bind = new Matrix4();
  const bones = mesh.skeleton.bones.map((bone, i) => {
    point.setFromMatrixPosition(bind.copy(mesh.skeleton.boneInverses[i]).invert());
    return { name: bone.name, head: [point.x, point.y, point.z] as const };
  });
  return { positions, uvs, indices, skinIndex: indices4, skinWeight: weights4, bones };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/skinParts.test.mjs`
Expected: PASS (7 tests). If `head reaches ... ear height` is off by more than 0.04, print `frame('head').b` and adjust `HEAD_EAR_FRACTION` so `b[1]` ≈ 1.66.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/avatar/skin/vec.ts apps/web/src/avatar/skin/parts.ts apps/web/src/avatar/skin/model.ts apps/web/tests/skinParts.test.mjs apps/web/tests/fixtures/skinIndex.ts
git commit -m "feat(avatar): body part frames for skin projection"
```

---

### Task 3: Texel map rasterizer

**Files:**
- Create: `apps/web/src/avatar/skin/texelMap.ts`
- Create: `apps/web/tests/fixtures/syntheticFighter.mjs`
- Test: `apps/web/tests/skinTexelMap.test.mjs`
- Modify: `apps/web/tests/fixtures/skinIndex.ts` (uncomment texelMap)

**Interfaces:**
- Consumes: `ModelData`, `partFrames`, `bonePartIndex`, `dominantPart`, `PartFrame`.
- Produces: `UNCOVERED = 255`; `TexelMap { size, part: Uint8Array, t, du, dw: Float32Array, frames: PartFrame[] }`; `buildTexelMap(model, size): TexelMap`.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/fixtures/syntheticFighter.mjs`:
```js
/** Bind-pose joints of the real fighter.glb, so synthetic models get identical part frames. */
export const JOINTS = {
  hips: [0, 0.92, 0], spine: [0, 1.05, -0.005], chest: [0, 1.18, -0.005], upper_chest: [0, 1.33, 0],
  neck: [0, 1.46, -0.005], head: [0, 1.55, 0],
  shoulder_L: [0.02, 1.41, 0.03], upper_arm_L: [0.2, 1.4, 0], forearm_L: [0.39, 1.22, -0.01], hand_L: [0.57, 1.04, 0.01],
  shoulder_R: [-0.02, 1.41, 0.03], upper_arm_R: [-0.2, 1.4, 0], forearm_R: [-0.39, 1.22, -0.01], hand_R: [-0.57, 1.04, 0.01],
  thigh_L: [0.09, 0.92, 0], shin_L: [0.1, 0.5, 0.012], foot_L: [0.1, 0.09, -0.01], toe_L: [0.1, 0.03, 0.1],
  thigh_R: [-0.09, 0.92, 0], shin_R: [-0.1, 0.5, 0.012], foot_R: [-0.1, 0.09, -0.01], toe_R: [-0.1, 0.03, 0.1],
};

/**
 * A flat quad on the chest front (z = 0.1) spanning x ∈ [-0.2, 0.2], y ∈ [0.92, 1.40],
 * UV-mapped to the whole texture with u = (x + 0.2) / 0.4 and v = (1.40 - y) / 0.48.
 * Every vertex is fully weighted to `hips`, so the whole quad is torso.
 */
export function chestQuad() {
  const bones = Object.entries(JOINTS).map(([name, head]) => ({ name, head }));
  const hips = bones.findIndex((bone) => bone.name === 'hips');
  const corners = [[-0.2, 1.4], [0.2, 1.4], [0.2, 0.92], [-0.2, 0.92]];
  return {
    positions: Float32Array.from(corners.flatMap(([x, y]) => [x, y, 0.1])),
    uvs: Float32Array.from(corners.flatMap(([x, y]) => [(x + 0.2) / 0.4, (1.4 - y) / 0.48])),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    skinIndex: Uint16Array.from(corners.flatMap(() => [hips, 0, 0, 0])),
    skinWeight: Float32Array.from(corners.flatMap(() => [1, 0, 0, 0])),
    bones,
  };
}

const lm = (x, y, visibility = 1) => ({ x, y, visibility });

/** Front-facing landmarks in a 200×200 frame: player's left on image right. */
export function frontLandmarks() {
  const points = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  Object.assign(points, {
    7: lm(0.53, 0.25), 8: lm(0.47, 0.25),
    11: lm(0.6, 0.4), 12: lm(0.4, 0.4), 13: lm(0.62, 0.55), 14: lm(0.38, 0.55),
    15: lm(0.63, 0.68), 16: lm(0.37, 0.68), 19: lm(0.63, 0.72), 20: lm(0.37, 0.72),
    23: lm(0.55, 0.8), 24: lm(0.45, 0.8), 25: lm(0.55, 0.9), 26: lm(0.45, 0.9),
    27: lm(0.55, 0.97), 28: lm(0.45, 0.97), 31: lm(0.55, 0.99), 32: lm(0.45, 0.99),
  });
  return points;
}
```

`apps/web/tests/skinTexelMap.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';
import { chestQuad } from './fixtures/syntheticFighter.mjs';
import { loadFighterScene } from './fixtures/loadFighter.mjs';

const skin = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const { extractModelData, findSkinnedMesh } = await loadTs(new URL('../src/avatar/skin/model.ts', import.meta.url));
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-4, `${message}: ${actual} ≠ ${expected}`);

test('a chest quad covers every texel with exact torso coordinates', () => {
  const size = 8;
  const map = skin.buildTexelMap(chestQuad(), size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      assert.equal(map.part[i], skin.TORSO_PART, `texel ${x},${y} covered`);
      close(map.t[i], 1 - v, 't runs hips → shoulders');
      close(map.du[i], 0.1, 'front offset');
      close(map.dw[i], -0.2 + 0.4 * u, 'side offset is model x');
    }
});

test('the real fighter covers a healthy share of the texture with valid parts', async () => {
  const model = extractModelData(findSkinnedMesh(await loadFighterScene()));
  const map = skin.buildTexelMap(model, 128);
  let covered = 0;
  for (const part of map.part) {
    if (part === skin.UNCOVERED) continue;
    covered += 1;
    assert.ok(part < skin.PARTS.length);
  }
  assert.ok(covered / map.part.length > 0.3, `coverage ${covered / map.part.length}`);
  const seen = new Set(map.part);
  for (let part = 0; part < skin.PARTS.length; part++) assert.ok(seen.has(part), `${skin.PARTS[part].name} has texels`);
});
```

Uncomment `export * from '../../src/avatar/skin/texelMap';` in `skinIndex.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/skinTexelMap.test.mjs`
Expected: FAIL. esbuild cannot resolve `texelMap`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/avatar/skin/texelMap.ts`:
```ts
import { bonePartIndex, dominantPart, partFrames } from './parts';
import type { ModelData, PartFrame } from './parts';

export const UNCOVERED = 255;
/** Barycentric slack so texel centres on shared edges are never dropped. */
const EDGE_EPSILON = 1e-4;

/** For every texture texel: which body part it shows and where on that part, in the part's frame. */
export interface TexelMap {
  size: number;
  part: Uint8Array;
  /** Position along the part axis: 0 at the segment start, 1 at the end. */
  t: Float32Array;
  /** Perpendicular offset (m) toward the part's front. */
  du: Float32Array;
  /** Perpendicular offset (m) toward axis × front. */
  dw: Float32Array;
  frames: PartFrame[];
}

export function buildTexelMap(model: ModelData, size: number): TexelMap {
  const frames = partFrames(model);
  const boneParts = bonePartIndex(model);
  const count = size * size;
  const map: TexelMap = {
    size,
    part: new Uint8Array(count).fill(UNCOVERED),
    t: new Float32Array(count),
    du: new Float32Array(count),
    dw: new Float32Array(count),
    frames,
  };
  const { positions: p, uvs, indices } = model;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i];
    const ib = indices[i + 1];
    const ic = indices[i + 2];
    const part = dominantPart(model, boneParts, [ia, ib, ic]);
    const { a, axis, length, u, w } = frames[part];
    // glTF UVs put (0, 0) at the image's top-left, so v maps straight to rows.
    const ax = uvs[ia * 2] * size, ay = uvs[ia * 2 + 1] * size;
    const bx = uvs[ib * 2] * size, by = uvs[ib * 2 + 1] * size;
    const cx = uvs[ic * 2] * size, cy = uvs[ic * 2 + 1] * size;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const wc = 1 - wa - wb;
        if (wa < -EDGE_EPSILON || wb < -EDGE_EPSILON || wc < -EDGE_EPSILON) continue;
        const rx = wa * p[ia * 3] + wb * p[ib * 3] + wc * p[ic * 3] - a[0];
        const ry = wa * p[ia * 3 + 1] + wb * p[ib * 3 + 1] + wc * p[ic * 3 + 1] - a[1];
        const rz = wa * p[ia * 3 + 2] + wb * p[ib * 3 + 2] + wc * p[ic * 3 + 2] - a[2];
        const along = rx * axis[0] + ry * axis[1] + rz * axis[2];
        const qx = rx - along * axis[0];
        const qy = ry - along * axis[1];
        const qz = rz - along * axis[2];
        const index = y * size + x;
        map.part[index] = part;
        map.t[index] = along / length;
        map.du[index] = qx * u[0] + qy * u[1] + qz * u[2];
        map.dw[index] = qx * w[0] + qy * w[1] + qz * w[2];
      }
    }
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/skinTexelMap.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/avatar/skin/texelMap.ts apps/web/tests/skinTexelMap.test.mjs apps/web/tests/fixtures/syntheticFighter.mjs apps/web/tests/fixtures/skinIndex.ts
git commit -m "feat(avatar): rasterize fighter UVs into a texel map"
```

---

### Task 4: Yaw tracking

**Files:**
- Create: `apps/web/src/avatar/skin/yaw.ts`
- Test: `apps/web/tests/skinYaw.test.mjs`
- Modify: `apps/web/tests/fixtures/skinIndex.ts` (uncomment yaw)

**Interfaces:**
- Produces: `PoseLandmark { x, y, z, visibility? }`; `YawObservation { ratio, turn }`; `observeYaw(image, world, aspect): YawObservation | null`; `class YawTracker { direction: 1 | -1; calibrated: boolean; calibrate(obs); start(): boolean; update(obs): { yawDeg: number; done: boolean } }`.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/skinYaw.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { observeYaw, YawTracker } = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const FRONT = 0.8;
const rad = (deg) => (deg * Math.PI) / 180;
const angleError = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** What observeYaw reports at a true turn of `deg`: shoulder width shrinks with |cos|. */
function observation(deg, turnSign) {
  return { ratio: FRONT * Math.abs(Math.cos(rad(deg))), turn: deg > 10 && deg < 80 ? turnSign : 0 };
}

function sweep(turnSign) {
  const tracker = new YawTracker();
  for (let i = 0; i < 10; i++) tracker.calibrate({ ratio: FRONT, turn: 0 });
  assert.equal(tracker.start(), true);
  const reports = [];
  for (let deg = 0; deg <= 360; deg += 4) reports.push({ deg, ...tracker.update(observation(deg, turnSign)) });
  return { tracker, reports };
}

test('tracks a full counter-clockwise turn within one slot', () => {
  const { tracker, reports } = sweep(1);
  for (const { deg, yawDeg, done } of reports)
    if (!done) assert.ok(angleError(yawDeg, deg) <= 30, `at ${deg}° reported ${yawDeg}°`);
  assert.equal(tracker.direction, 1);
  assert.ok(reports.at(-1).done, 'turn completes back at the front');
  assert.ok(!reports.slice(0, -5).some((report) => report.done), 'no early completion');
});

test('reports the turn direction from world landmarks', () => {
  assert.equal(sweep(-1).tracker.direction, -1);
});

test('refuses to start without calibration', () => {
  assert.equal(new YawTracker().start(), false);
});

test('observeYaw measures shoulder width against torso height, aspect corrected', () => {
  const image = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  image[11] = { x: 0.55, y: 0.4, z: 0 };
  image[12] = { x: 0.45, y: 0.4, z: 0 };
  image[23] = { x: 0.53, y: 0.7, z: 0 };
  image[24] = { x: 0.47, y: 0.7, z: 0 };
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  world[11] = { x: 0.15, y: 0, z: 0.15 };
  world[12] = { x: -0.15, y: 0, z: -0.15 };
  const result = observeYaw(image, world, 16 / 9);
  assert.ok(Math.abs(result.ratio - (0.1 * 16) / 9 / 0.3) < 1e-9);
  assert.equal(result.turn, 1);
  assert.equal(observeYaw([], world, 1), null);
});
```

Uncomment `export * from '../../src/avatar/skin/yaw';` in `skinIndex.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/skinYaw.test.mjs`
Expected: FAIL. esbuild cannot resolve `yaw`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/avatar/skin/yaw.ts`:
```ts
export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface YawObservation {
  /** Shoulder width over torso height: largest facing the camera or facing away, smallest side-on. */
  ratio: number;
  /** +1 / -1 when world landmarks clearly show which way the chest turns, else 0. */
  turn: number;
}

/** World-landmark chest angle below which the turn direction is too noisy to vote. */
const TURN_SIGNAL_RAD = (10 * Math.PI) / 180;

export function observeYaw(
  image: readonly PoseLandmark[],
  world: readonly PoseLandmark[],
  aspect: number,
): YawObservation | null {
  const [ls, rs, lh, rh] = [image[11], image[12], image[23], image[24]];
  if (!ls || !rs || !lh || !rh) return null;
  const shoulderWidth = Math.abs(ls.x - rs.x) * aspect;
  const torso = Math.hypot(((ls.x + rs.x - lh.x - rh.x) / 2) * aspect, (ls.y + rs.y - lh.y - rh.y) / 2);
  if (torso < 1e-3) return null;
  const wl = world[11];
  const wr = world[12];
  // MediaPipe world z grows away from the camera, so this is +yaw when the chest swings to image right.
  const angle = wl && wr ? Math.atan2(wl.z - wr.z, wl.x - wr.x) : 0;
  return { ratio: shoulderWidth / torso, turn: Math.abs(angle) > TURN_SIGNAL_RAD ? Math.sign(angle) : 0 };
}

const CALIBRATION_FRAMES = 30;
const MIN_CALIBRATION_FRAMES = 5;
const SMOOTHING = 0.4;
/** Side-on: narrowest shoulders. A rise of LOW_HYSTERESIS past the minimum means the side view has passed. */
const LOW = 0.3;
const LOW_HYSTERESIS = 0.12;
/** Facing away: widest shoulders again. A drop of HIGH_HYSTERESIS past the maximum means the back view has passed. */
const HIGH = 0.8;
const HIGH_HYSTERESIS = 0.06;
const DONE = 0.97;
const VOTE_BELOW = 0.95;

/**
 * Turns shoulder-width observations into degrees turned (0–360) for one continuous turn.
 * Width only gives |cos(yaw)|, so the tracker walks quadrants: narrowing to the side,
 * widening to the back, narrowing to the other side, widening to the front. Readings
 * just past a turning point report that point (90/180/270°) until the turn has clearly passed it.
 */
export class YawTracker {
  direction: 1 | -1 = 1;
  private samples: number[] = [];
  private front = 0;
  private quadrant = 0;
  private smoothed = 1;
  private extreme = 1;
  private votes = 0;

  get calibrated() {
    return this.samples.length >= MIN_CALIBRATION_FRAMES;
  }

  /** Feed front-facing frames while the player stands still. */
  calibrate(observation: YawObservation) {
    this.samples.push(observation.ratio);
    if (this.samples.length > CALIBRATION_FRAMES) this.samples.shift();
  }

  start(): boolean {
    if (!this.calibrated) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.front = sorted[Math.floor(sorted.length / 2)];
    this.quadrant = 0;
    this.smoothed = 1;
    this.extreme = 1;
    this.votes = 0;
    this.direction = 1;
    return true;
  }

  update(observation: YawObservation): { yawDeg: number; done: boolean } {
    const c = Math.min(1, observation.ratio / this.front);
    this.smoothed += (c - this.smoothed) * SMOOTHING;
    const s = this.smoothed;
    if (this.quadrant === 0 && s < VOTE_BELOW) {
      this.votes += observation.turn;
      this.direction = this.votes < 0 ? -1 : 1;
    }
    let plateau = false;
    if (this.quadrant % 2 === 0) {
      // Q0 and Q2 narrow toward a side view.
      this.extreme = Math.min(this.extreme, s);
      // Just past the narrowest point: still the side view until the rise is clear.
      plateau = this.extreme < LOW && s > this.extreme && s <= this.extreme + LOW_HYSTERESIS;
      if (this.extreme < LOW && s > this.extreme + LOW_HYSTERESIS) {
        this.quadrant += 1;
        this.extreme = s;
        plateau = false;
      }
    } else {
      // Q1 widens toward the back view; Q3 widens back to the front.
      this.extreme = Math.max(this.extreme, s);
      // Just past the widest point: still the back view until the drop is clear.
      plateau = this.quadrant === 1 && this.extreme > HIGH && s < this.extreme && s >= this.extreme - HIGH_HYSTERESIS;
      if (this.quadrant === 1 && this.extreme > HIGH && s < this.extreme - HIGH_HYSTERESIS) {
        this.quadrant = 2;
        this.extreme = s;
        plateau = false;
      }
    }
    const angle = (Math.acos(s) * 180) / Math.PI;
    const yawDeg = plateau
      ? [90, 180, 270, 360][this.quadrant]
      : [angle, 180 - angle, 180 + angle, 360 - angle][this.quadrant];
    return { yawDeg, done: this.quadrant === 3 && s >= DONE };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/skinYaw.test.mjs`
Expected: PASS (4 tests). If a sweep assertion fails near 180°, print `reports` around that angle. Then tune only `HIGH_HYSTERESIS` (0.04–0.08); do not widen the 30° tolerance.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/avatar/skin/yaw.ts apps/web/tests/skinYaw.test.mjs apps/web/tests/fixtures/skinIndex.ts
git commit -m "feat(avatar): track turn angle from shoulder width"
```

---

### Task 5: Framing, slots and per-frame projection

**Files:**
- Create: `apps/web/src/avatar/skin/framing.ts`, `apps/web/src/avatar/skin/slots.ts`, `apps/web/src/avatar/skin/project.ts`
- Test: `apps/web/tests/skinCapture.test.mjs`
- Modify: `apps/web/tests/fixtures/skinIndex.ts` (uncomment framing, slots, project)

**Interfaces:**
- Consumes: `PARTS`, `LANDMARK_PAIRS`, `PartFrame`, `TORSO_PART`, vec helpers.
- Produces:
  - framing: `FULL_BODY`, `TORSO`, `VISIBLE = 0.6`, `visible(lm, indices): boolean`, `meanVisibility(lm, indices): number`, `landmarkMotion(prev, next, indices): number`, `frameScore(visibility, motion): number`.
  - slots: `SLOT_COUNT = 8`, `MIN_SLOTS_TO_FINISH = 6`, `slotFor(yawDeg): number | null`, `class SlotBuffer<T> { accepts(slot, score); put(slot, score, value); filled: boolean[]; count: number; values(): T[]; clear() }`.
  - project: `FrameLandmark { x, y, visibility }`, `CapturedFrame { width, height, pixels: Uint8ClampedArray, mask: Float32Array | null, landmarks: FrameLandmark[], yawDeg }`, `orientLandmarks(lm, yawRad)`, `ImagePart { ax, ay, bx, by, u, w, confidence }`, `imageParts(frame, yawRad, frames): (ImagePart | null)[]`, `pixelsPerMeter(frame, torso: PartFrame): number`, `Projection { x, y, weight }`, `projectTexel(part, scalePx, t, du, dw, out): Projection`.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/skinCapture.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const skin = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const close = (actual, expected, message, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} ≠ ${expected}`);
import { frontLandmarks } from './fixtures/syntheticFighter.mjs';

const lm = (x, y, visibility = 1) => ({ x, y, visibility });

test('slots snap to the nearest 45° within ±20° and wrap at 360', () => {
  assert.equal(skin.slotFor(0), 0);
  assert.equal(skin.slotFor(350), 0);
  assert.equal(skin.slotFor(200), 4);
  assert.equal(skin.slotFor(67), null);
  assert.equal(skin.slotFor(-45), 7);
});

test('slot buffer keeps the best-scoring frame per slot', () => {
  const buffer = new skin.SlotBuffer();
  assert.ok(buffer.accepts(2, 0.5));
  buffer.put(2, 0.5, 'first');
  assert.ok(!buffer.accepts(2, 0.4));
  buffer.put(2, 0.9, 'better');
  assert.deepEqual(buffer.values(), ['better']);
  assert.equal(buffer.count, 1);
  assert.deepEqual(buffer.filled, [false, false, true, false, false, false, false, false]);
  buffer.clear();
  assert.equal(buffer.count, 0);
});

test('framing requires every full-body landmark on screen and visible', () => {
  const points = frontLandmarks();
  assert.ok(skin.visible(points, skin.FULL_BODY));
  points[27] = lm(0.55, 1.02);
  assert.ok(!skin.visible(points, skin.FULL_BODY));
  assert.ok(skin.visible(points, skin.TORSO));
  points[11] = lm(0.6, 0.4, 0.3);
  assert.ok(!skin.visible(points, skin.TORSO));
});

test('steady frames outscore moving ones', () => {
  const still = frontLandmarks();
  const moved = still.map((point) => ({ ...point, x: point.x + 0.02 }));
  close(skin.landmarkMotion(still, moved, skin.FULL_BODY), 0.02, 'motion');
  assert.ok(skin.frameScore(1, 0) > skin.frameScore(1, 0.02));
});

test('back views with front-style labels get their sides swapped', () => {
  const points = frontLandmarks();
  assert.equal(skin.orientLandmarks(points, 0)[11].x, 0.6, 'front view kept');
  const back = skin.orientLandmarks(points, Math.PI);
  assert.equal(back[11].x, 0.4, 'left shoulder moved to image left');
  assert.equal(back[15].x, 0.37, 'wrists swapped with shoulders');
  assert.equal(skin.orientLandmarks(points, Math.PI / 2)[11].x, 0.6, 'side views untouched');
});

const frame = (landmarks) => ({ width: 200, height: 200, pixels: new Uint8ClampedArray(200 * 200 * 4), mask: null, landmarks, yawDeg: 0 });
const torsoFrame = { a: [0, 0.92, 0], b: [0, 1.4, 0], axis: [0, 1, 0], length: 0.48, u: [0, 0, 1], w: [1, 0, 0] };

test('facing the camera, the fighter left lands on image right', () => {
  const part = skin.imageParts(frame(frontLandmarks()), 0, [torsoFrame])[0];
  const scalePx = skin.pixelsPerMeter(frame(frontLandmarks()), torsoFrame);
  close(scalePx, 80 / 0.48, 'torso height in px per meter', 1e-3);
  const hit = skin.projectTexel(part, scalePx, 0.5, 0.1, 0.05, { x: 0, y: 0, weight: 0 });
  close(hit.x, 100 + 0.05 * scalePx, 'x');
  close(hit.y, 120, 'y halfway between hips (160) and shoulders (80)');
  close(hit.weight, (0.1 / Math.hypot(0.1, 0.05)) ** 2, 'front-facing weight');
});

test('turned +90°, the chest front faces image right and the left side faces away', () => {
  const part = skin.imageParts(frame(frontLandmarks()), Math.PI / 2, [torsoFrame])[0];
  const out = { x: 0, y: 0, weight: 0 };
  const chest = skin.projectTexel(part, 100, 0.5, 0.1, 0, out);
  close(chest.x, 100 + 10, 'front offset goes to +x');
  close(chest.weight, 0, 'front is edge-on');
  close(skin.projectTexel(part, 100, 0.5, 0, 0.1, out).weight, 0, 'left side hidden');
  close(skin.projectTexel(part, 100, 0.5, 0, -0.1, out).weight, 1, 'right side faces camera');
});
```

Uncomment the framing, slots and project lines in `skinIndex.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/skinCapture.test.mjs`
Expected: FAIL. esbuild cannot resolve `framing`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/avatar/skin/framing.ts`:
```ts
import type { FrameLandmark } from './project';

/** Nose, shoulders, elbows, wrists, hips, knees, ankles: head to ankles in view. */
export const FULL_BODY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const;
export const TORSO = [11, 12, 23, 24] as const;
export const VISIBLE = 0.6;
/** Score lost per unit of mean landmark movement (normalized image units) between frames. */
const MOTION_PENALTY = 8;

const onScreen = (point: FrameLandmark | undefined): point is FrameLandmark =>
  !!point && point.visibility >= VISIBLE && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

export function visible(landmarks: readonly FrameLandmark[], indices: readonly number[]): boolean {
  return indices.every((index) => onScreen(landmarks[index]));
}

export function meanVisibility(landmarks: readonly FrameLandmark[], indices: readonly number[]): number {
  return indices.reduce((sum, index) => sum + (landmarks[index]?.visibility ?? 0), 0) / indices.length;
}

export function landmarkMotion(
  previous: readonly FrameLandmark[],
  next: readonly FrameLandmark[],
  indices: readonly number[],
): number {
  let total = 0;
  for (const index of indices) {
    const a = previous[index];
    const b = next[index];
    total += a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1;
  }
  return total / indices.length;
}

/** Sharp, confident frames win a slot: visibility minus a blur proxy (landmark motion). */
export function frameScore(visibility: number, motion: number): number {
  return visibility - MOTION_PENALTY * motion;
}
```

`apps/web/src/avatar/skin/slots.ts`:
```ts
export const SLOT_COUNT = 8;
export const SLOT_STEP_DEG = 360 / SLOT_COUNT;
export const SLOT_WINDOW_DEG = 20;
export const MIN_SLOTS_TO_FINISH = 6;

export function slotFor(yawDeg: number): number | null {
  const wrapped = ((yawDeg % 360) + 360) % 360;
  const slot = Math.round(wrapped / SLOT_STEP_DEG) % SLOT_COUNT;
  const offset = Math.abs(wrapped - slot * SLOT_STEP_DEG);
  return Math.min(offset, 360 - offset) <= SLOT_WINDOW_DEG ? slot : null;
}

/** Best value per angle slot. Check `accepts` before building an expensive value. */
export class SlotBuffer<T> {
  private slots: ({ score: number; value: T } | null)[] = Array(SLOT_COUNT).fill(null);

  accepts(slot: number, score: number): boolean {
    const current = this.slots[slot];
    return !current || score > current.score;
  }

  put(slot: number, score: number, value: T) {
    this.slots[slot] = { score, value };
  }

  get filled(): boolean[] {
    return this.slots.map(Boolean);
  }

  get count(): number {
    return this.slots.filter(Boolean).length;
  }

  values(): T[] {
    return this.slots.flatMap((entry) => (entry ? [entry.value] : []));
  }

  clear() {
    this.slots = Array(SLOT_COUNT).fill(null);
  }
}
```

`apps/web/src/avatar/skin/project.ts`:
```ts
import { LANDMARK_PAIRS, PARTS } from './parts';
import type { PartFrame } from './parts';
import { cross, dot, FORWARD, length, normalize, rotateY, scale, sub, UP } from './vec';
import type { Vec3 } from './vec';

/** Normalized image landmark (0–1 of width/height, y down). */
export interface FrameLandmark {
  x: number;
  y: number;
  visibility: number;
}

/** One kept camera frame, raw (unmirrored), with its MediaPipe landmarks and person mask. */
export interface CapturedFrame {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  /** Person probability per pixel, or null when segmentation was unavailable. */
  mask: Float32Array | null;
  landmarks: FrameLandmark[];
  /** Degrees turned along the capture (0–360), before applying the turn direction. */
  yawDeg: number;
}

/** Below this |cos(yaw)| the shoulders overlap and left/right can't be checked. */
const ORIENT_MIN_FACING = 0.35;
/** Shorter image segments give no usable direction; fall back to the model axis. */
const MIN_SEGMENT_PX = 4;
/** Weight for texels on the part axis, where no surface direction exists. */
const AXIS_FACING = 0.5;

/**
 * BlazePose assumes it sees a front. With the back to the camera it can label the
 * image-right arm "left". Put anatomical left on the side the turn says it must be.
 */
export function orientLandmarks(landmarks: readonly FrameLandmark[], yawRad: number): FrameLandmark[] {
  const out = landmarks.slice();
  const facing = Math.cos(yawRad);
  if (Math.abs(facing) < ORIENT_MIN_FACING || !out[11] || !out[12] || !out[23] || !out[24]) return out;
  const spread = out[11].x - out[12].x + (out[23].x - out[24].x);
  if (spread === 0 || Math.sign(spread) === Math.sign(facing)) return out;
  for (const [left, right] of LANDMARK_PAIRS) [out[left], out[right]] = [out[right], out[left]];
  return out;
}

/** A body part as seen in one frame: its image segment (px) and camera-space front/side axes. */
export interface ImagePart {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  u: Vec3;
  w: Vec3;
  confidence: number;
}

function average(landmarks: readonly FrameLandmark[], indices: readonly number[], width: number, height: number) {
  let x = 0;
  let y = 0;
  let visibility = 1;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) return null;
    x += point.x;
    y += point.y;
    visibility = Math.min(visibility, point.visibility);
  }
  return { x: (x / indices.length) * width, y: (y / indices.length) * height, visibility };
}

export function imageParts(frame: CapturedFrame, yawRad: number, frames: readonly PartFrame[]): (ImagePart | null)[] {
  const landmarks = orientLandmarks(frame.landmarks, yawRad);
  return frames.map((model, index) => {
    const spec = PARTS[index];
    const a = average(landmarks, spec.from, frame.width, frame.height);
    const b = average(landmarks, spec.to, frame.width, frame.height);
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const axis =
      spec.axisFromModel || Math.hypot(dx, dy) < MIN_SEGMENT_PX
        ? rotateY(model.axis, yawRad)
        : normalize([dx, -dy, 0]);
    const front = rotateY(spec.front === 'up' ? UP : FORWARD, yawRad);
    const across = sub(front, scale(axis, dot(front, axis)));
    if (length(across) < 1e-3) return null;
    const u = normalize(across);
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, u, w: cross(axis, u), confidence: Math.min(a.visibility, b.visibility) };
  });
}

/** Image pixels per model meter, from the torso's height (unchanged by turning). */
export function pixelsPerMeter(frame: CapturedFrame, torso: PartFrame): number {
  const shoulders = average(frame.landmarks, [11, 12], frame.width, frame.height);
  const hips = average(frame.landmarks, [23, 24], frame.width, frame.height);
  if (!shoulders || !hips) return 0;
  return Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) / torso.length;
}

export interface Projection {
  x: number;
  y: number;
  weight: number;
}

/** Where a texel (t along the part, du/dw across it) appears in the frame, and how squarely it faces the camera. */
export function projectTexel(part: ImagePart, scalePx: number, t: number, du: number, dw: number, out: Projection): Projection {
  const ox = du * part.u[0] + dw * part.w[0];
  const oy = du * part.u[1] + dw * part.w[1];
  const oz = du * part.u[2] + dw * part.w[2];
  out.x = part.ax + (part.bx - part.ax) * t + ox * scalePx;
  out.y = part.ay + (part.by - part.ay) * t - oy * scalePx;
  const size = Math.hypot(ox, oy, oz);
  const facing = size > 1e-4 ? Math.max(0, oz / size) : AXIS_FACING;
  out.weight = facing * facing * part.confidence;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/skinCapture.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/avatar/skin/framing.ts apps/web/src/avatar/skin/slots.ts apps/web/src/avatar/skin/project.ts apps/web/tests/skinCapture.test.mjs apps/web/tests/fixtures/skinIndex.ts
git commit -m "feat(avatar): capture slots and per-part frame projection"
```

---

### Task 6: Bake

**Files:**
- Create: `apps/web/src/avatar/skin/bake.ts`
- Test: `apps/web/tests/skinBake.test.mjs`
- Modify: `apps/web/tests/fixtures/skinIndex.ts` (uncomment bake)

**Interfaces:**
- Consumes: `TexelMap`, `UNCOVERED`, `imageParts`, `pixelsPerMeter`, `projectTexel`, `CapturedFrame`, `TORSO_PART`.
- Produces: `bakeSkin(map, frames, direction: 1 | -1): Uint8ClampedArray<ArrayBuffer>` (RGBA, size²×4); `finishTexture(map, sum: Float32Array, weight: Float32Array): Uint8ClampedArray<ArrayBuffer>`; `GUTTER_PX = 4`.

- [ ] **Step 1: Write the failing test**

`apps/web/tests/skinBake.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';
import { chestQuad, frontLandmarks } from './fixtures/syntheticFighter.mjs';

const skin = await loadTs(new URL('./fixtures/skinIndex.ts', import.meta.url));
const SIZE = 16;
const map = skin.buildTexelMap(chestQuad(), SIZE);
const RED = [220, 40, 40];
const BLUE = [40, 60, 220];

/** 200×200 frame: image-left half red, image-right half blue. */
function splitFrame({ yawDeg = 0, landmarks = frontLandmarks(), mask = null } = {}) {
  const pixels = new Uint8ClampedArray(200 * 200 * 4);
  for (let y = 0; y < 200; y++)
    for (let x = 0; x < 200; x++) pixels.set([...(x < 100 ? RED : BLUE), 255], (y * 200 + x) * 4);
  return { width: 200, height: 200, pixels, mask, landmarks, yawDeg };
}
const texel = (rgba, x, y) => Array.from(rgba.slice((y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3));
const near = (actual, expected) => actual.every((value, i) => Math.abs(value - expected[i]) <= 2);

test('front view paints the fighter left from image right', () => {
  const rgba = skin.bakeSkin(map, [splitFrame()], 1);
  // In the chest quad, u > 0.5 is model +x (fighter left).
  assert.ok(near(texel(rgba, SIZE - 2, SIZE / 2), BLUE), `left: ${texel(rgba, SIZE - 2, SIZE / 2)}`);
  assert.ok(near(texel(rgba, 1, SIZE / 2), RED), `right: ${texel(rgba, 1, SIZE / 2)}`);
});

test('a back view mislabeled as front still paints the correct sides', () => {
  // The back frame's labels look front-facing; the fighter front (chest quad) faces away, so it gets no weight.
  const rgba = skin.bakeSkin(map, [splitFrame(), splitFrame({ yawDeg: 180 })], 1);
  assert.ok(near(texel(rgba, SIZE - 2, SIZE / 2), BLUE));
});

test('pixels outside the person mask are never sampled', () => {
  const mask = new Float32Array(200 * 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 100; x++) mask[y * 200 + x] = 1;
  const rgba = skin.bakeSkin(map, [splitFrame({ mask })], 1);
  // The blue half is "background"; its texels are filled from red neighbours instead.
  assert.ok(near(texel(rgba, SIZE - 2, SIZE / 2), RED), `${texel(rgba, SIZE - 2, SIZE / 2)}`);
});

test('turn direction mirrors which side faces the camera at 90°', () => {
  const side = (direction) => skin.bakeSkin(map, [splitFrame({ yawDeg: 90 })], direction);
  // +90°: chest front swings to image right (blue), -90°: to image left (red). Front faces are edge-on,
  // so only the axis-weighted texels sample; check the overall tint of the quad's centre column.
  assert.notDeepEqual(texel(side(1), SIZE / 2, SIZE / 2), texel(side(-1), SIZE / 2, SIZE / 2));
});

test('unseen texels take neighbour colours and the gutter is filled', () => {
  const size = 4;
  const holeMap = {
    size,
    part: Uint8Array.from({ length: 16 }, (_, i) => (i % 4 === 3 ? skin.UNCOVERED : 0)),
    t: new Float32Array(16), du: new Float32Array(16), dw: new Float32Array(16), frames: [],
  };
  const sum = new Float32Array(48);
  const weight = new Float32Array(16);
  sum.set([200, 100, 50], 0);
  weight[0] = 1;
  const rgba = skin.finishTexture(holeMap, sum, weight);
  for (let i = 0; i < 16; i++) {
    assert.deepEqual(Array.from(rgba.slice(i * 4, i * 4 + 4)), [200, 100, 50, 255], `texel ${i}`);
  }
});
```

Uncomment `export * from '../../src/avatar/skin/bake';` in `skinIndex.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test apps/web/tests/skinBake.test.mjs`
Expected: FAIL. esbuild cannot resolve `bake`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/avatar/skin/bake.ts`:
```ts
import { TORSO_PART } from './parts';
import { imageParts, pixelsPerMeter, projectTexel } from './project';
import type { CapturedFrame, Projection } from './project';
import { UNCOVERED } from './texelMap';
import type { TexelMap } from './texelMap';

export const MASK_THRESHOLD = 0.5;
/** Texels painted outside UV islands so texture filtering never pulls in black. */
export const GUTTER_PX = 4;

/** Blend every frame into the texture: each texel takes colour from the frames that saw it most squarely. */
export function bakeSkin(map: TexelMap, frames: readonly CapturedFrame[], direction: 1 | -1): Uint8ClampedArray<ArrayBuffer> {
  const count = map.size * map.size;
  const sum = new Float32Array(count * 3);
  const weight = new Float32Array(count);
  const hit: Projection = { x: 0, y: 0, weight: 0 };
  for (const frame of frames) {
    const yaw = (direction * frame.yawDeg * Math.PI) / 180;
    const parts = imageParts(frame, yaw, map.frames);
    const scalePx = pixelsPerMeter(frame, map.frames[TORSO_PART]);
    if (!(scalePx > 0)) continue;
    for (let i = 0; i < count; i++) {
      const partIndex = map.part[i];
      if (partIndex === UNCOVERED) continue;
      const part = parts[partIndex];
      if (!part) continue;
      projectTexel(part, scalePx, map.t[i], map.du[i], map.dw[i], hit);
      if (hit.weight <= 0 || !onPerson(frame, hit.x, hit.y)) continue;
      addSample(frame, hit.x, hit.y, hit.weight, sum, i * 3);
      weight[i] += hit.weight;
    }
  }
  return finishTexture(map, sum, weight);
}

function onPerson(frame: CapturedFrame, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > frame.width - 1 || y > frame.height - 1) return false;
  return !frame.mask || frame.mask[Math.round(y) * frame.width + Math.round(x)] >= MASK_THRESHOLD;
}

function addSample(frame: CapturedFrame, x: number, y: number, weight: number, sum: Float32Array, offset: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, frame.width - 1);
  const y1 = Math.min(y0 + 1, frame.height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const { pixels, width } = frame;
  for (let c = 0; c < 3; c++) {
    const top = pixels[(y0 * width + x0) * 4 + c] * (1 - fx) + pixels[(y0 * width + x1) * 4 + c] * fx;
    const bottom = pixels[(y1 * width + x0) * 4 + c] * (1 - fx) + pixels[(y1 * width + x1) * 4 + c] * fx;
    sum[offset + c] += (top * (1 - fy) + bottom * fy) * weight;
  }
}

/** Resolve weighted sums to colours, fill unseen texels from neighbours, then pad the UV gutter. */
export function finishTexture(map: TexelMap, sum: Float32Array, weight: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const { size } = map;
  const count = size * size;
  const rgb = new Float32Array(count * 3);
  const known = new Uint8Array(count);
  const mean = [0, 0, 0];
  let seen = 0;
  for (let i = 0; i < count; i++) {
    if (weight[i] <= 0) continue;
    for (let c = 0; c < 3; c++) {
      rgb[i * 3 + c] = sum[i * 3 + c] / weight[i];
      mean[c] += rgb[i * 3 + c];
    }
    known[i] = 1;
    seen += 1;
  }
  if (seen) for (let c = 0; c < 3; c++) mean[c] /= seen;
  else mean.splice(0, 3, 197, 140, 105);

  const covered = Uint8Array.from(map.part, (part) => (part === UNCOVERED ? 0 : 1));
  grow(size, rgb, known, covered, Infinity);
  for (let i = 0; i < count; i++)
    if (covered[i] && !known[i]) {
      rgb.set(mean, i * 3);
      known[i] = 1;
    }
  grow(size, rgb, known, new Uint8Array(count).fill(1), GUTTER_PX);

  const rgba = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const source = known[i] ? rgb.subarray(i * 3, i * 3 + 3) : mean;
    rgba[i * 4] = source[0];
    rgba[i * 4 + 1] = source[1];
    rgba[i * 4 + 2] = source[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Breadth-first fill: each ring of unknown eligible texels averages its known 8-neighbours. */
function grow(size: number, rgb: Float32Array, known: Uint8Array, eligible: Uint8Array, maxRings: number) {
  const queued = new Uint8Array(size * size);
  const neighbours = (i: number, visit: (n: number) => void) => {
    const x = i % size;
    const y = (i - x) / size;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < size && ny < size) visit(ny * size + nx);
      }
  };
  let ring: number[] = [];
  for (let i = 0; i < known.length; i++)
    if (known[i])
      neighbours(i, (n) => {
        if (!known[n] && eligible[n] && !queued[n]) {
          queued[n] = 1;
          ring.push(n);
        }
      });
  for (let depth = 0; ring.length && depth < maxRings; depth++) {
    for (const i of ring) {
      let r = 0, g = 0, b = 0, n = 0;
      neighbours(i, (j) => {
        if (!known[j]) return;
        r += rgb[j * 3];
        g += rgb[j * 3 + 1];
        b += rgb[j * 3 + 2];
        n += 1;
      });
      rgb[i * 3] = r / n;
      rgb[i * 3 + 1] = g / n;
      rgb[i * 3 + 2] = b / n;
    }
    for (const i of ring) known[i] = 1;
    const next: number[] = [];
    for (const i of ring)
      neighbours(i, (n) => {
        if (!known[n] && eligible[n] && !queued[n]) {
          queued[n] = 1;
          next.push(n);
        }
      });
    ring = next;
  }
}
```

Note: within a ring, texels only average neighbours known *before* the ring (they are marked known after the whole ring is coloured), so every texel in the ring has at least one known neighbour (`n > 0`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/web/tests/skinBake.test.mjs`
Expected: PASS (5 tests). Also run `node --test apps/web/tests/skin*.test.mjs` and expect all to pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/avatar/skin/bake.ts apps/web/tests/skinBake.test.mjs apps/web/tests/fixtures/skinIndex.ts
git commit -m "feat(avatar): bake captured frames into a skin texture"
```

---

### Task 7: Capture worker, client and hook

**Files:**
- Create: `apps/web/src/avatar/captureMessages.ts`, `apps/web/src/avatar/capture.worker.ts`, `apps/web/src/avatar/captureClient.ts`, `apps/web/src/avatar/fighterAsset.ts`, `apps/web/src/avatar/useSkinCapture.ts`
- Modify: `packages/core/src/protocol.ts` (add only `AVATAR_SKIN_MAX_BYTES` here; the schema comes in Task 11)

**Interfaces:**
- Consumes: everything in `skin/*`; `extractModelData`, `findSkinnedMesh`.
- Produces: `FIGHTER_URL`; `loadFighterModelData(): Promise<ModelData>`; `CaptureStatus`; `CaptureClient`; `useSkinCapture(videoRef, stream) → { state: SkinCaptureState, message: string, arm, disarm, cancel, finish, retake, retry }`; `SkinCaptureState { phase: 'loading'|'framing'|'capturing'|'baking'|'review'|'error'; armed; fullBody; visible; yawDeg; slots; result: Blob | null; error: string | null; loadingMessage }`.

These modules wrap browser-only APIs (Worker, OffscreenCanvas, MediaPipe). Their logic lives in the unit-tested `skin/*` modules; here the gate is typecheck + lint, and the browser check in Task 12.

- [ ] **Step 1: Add the byte limit to core**

Append to `packages/core/src/protocol.ts`:
```ts
/** Largest camera-baked fighter skin (JPEG) a client may share. */
export const AVATAR_SKIN_MAX_BYTES = 256 * 1024;
```

- [ ] **Step 2: Write the message types and asset loader**

`apps/web/src/avatar/captureMessages.ts`:
```ts
import type { ModelData } from './skin/parts';

export interface CaptureStatus {
  phase: 'framing' | 'capturing';
  /** Head to ankles visible: required before capture starts. */
  fullBody: boolean;
  /** Shoulders and hips visible: required for capture to progress. */
  visible: boolean;
  yawDeg: number | null;
  slots: boolean[];
}

export type CaptureRequest =
  | { type: 'init'; modelUrl: string; wasmUrl: string; model: ModelData; textureSize: number }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'finish' }
  | { type: 'dispose' };

export type CaptureResponse =
  | { type: 'loading'; message: string }
  | { type: 'ready' }
  | { type: 'status'; status: CaptureStatus }
  | { type: 'baking' }
  | { type: 'baked'; jpeg: Blob }
  | { type: 'error'; message: string; recoverable: boolean };
```

`apps/web/src/avatar/fighterAsset.ts`:
```ts
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { extractModelData, findSkinnedMesh } from './skin/model';
import type { ModelData } from './skin/parts';

export const FIGHTER_URL = `${import.meta.env.BASE_URL}models/fighter.glb`;

let pending: Promise<ModelData> | null = null;

/** Bind-pose geometry for the bake worker; loaded once, retried after a failure. */
export function loadFighterModelData(): Promise<ModelData> {
  pending ??= new GLTFLoader()
    .loadAsync(FIGHTER_URL)
    .then((gltf) => extractModelData(findSkinnedMesh(gltf.scene)))
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
```

- [ ] **Step 3: Write the worker**

`apps/web/src/avatar/capture.worker.ts`:
```ts
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { MPMask } from '@mediapipe/tasks-vision';
import { AVATAR_SKIN_MAX_BYTES } from '@wb/core';
import type { CaptureRequest, CaptureResponse, CaptureStatus } from './captureMessages';
import { bakeSkin } from './skin/bake';
import { FULL_BODY, frameScore, landmarkMotion, meanVisibility, TORSO, visible } from './skin/framing';
import type { ModelData } from './skin/parts';
import type { CapturedFrame, FrameLandmark } from './skin/project';
import { MIN_SLOTS_TO_FINISH, SLOT_COUNT, SlotBuffer, slotFor } from './skin/slots';
import { buildTexelMap } from './skin/texelMap';
import type { TexelMap } from './skin/texelMap';
import { observeYaw, YawTracker } from './skin/yaw';

// The web tsconfig also includes DOM globals. Keep the worker boundary explicit.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CaptureRequest>) => void) | null;
  postMessage(message: CaptureResponse): void;
  close(): void;
};
const JPEG_QUALITIES = [0.85, 0.72, 0.6, 0.48];

let landmarker: PoseLandmarker | null = null;
let initializing = false;
let disposed = false;
let model: ModelData | null = null;
let textureSize = 1024;
let texelMap: TexelMap | null = null;
let phase: 'framing' | 'capturing' | 'baking' | 'done' = 'framing';
let tracker = new YawTracker();
const slots = new SlotBuffer<CapturedFrame>();
let previous: FrameLandmark[] | null = null;
let snapshotCanvas: OffscreenCanvas | null = null;
let lastStatus: CaptureStatus = { phase: 'framing', fullBody: false, visible: false, yawDeg: null, slots: slots.filled };

function send(message: CaptureResponse) {
  if (!disposed) scope.postMessage(message);
}

async function initialize(modelUrl: string, wasmUrl: string) {
  if (initializing || landmarker || disposed) return;
  initializing = true;
  try {
    send({ type: 'loading', message: 'Loading the body scanner…' });
    const response = await fetch(modelUrl);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html'))
      throw new Error('Local pose model is missing. Check public/models.');
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    if (disposed) return;
    const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
    const next = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: true,
    });
    if (disposed) {
      next.close();
      return;
    }
    landmarker = next;
    send({ type: 'ready' });
  } catch (error) {
    send({
      type: 'error',
      recoverable: false,
      message: `The body scanner could not start. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    initializing = false;
  }
}

function snapshot(bitmap: ImageBitmap, landmarks: FrameLandmark[], mask: MPMask | undefined, yawDeg: number): CapturedFrame {
  const { width, height } = bitmap;
  if (!snapshotCanvas || snapshotCanvas.width !== width || snapshotCanvas.height !== height)
    snapshotCanvas = new OffscreenCanvas(width, height);
  const context = snapshotCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable in the capture worker.');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  const maskData = mask && mask.width === width && mask.height === height ? mask.getAsFloat32Array().slice() : null;
  return { width, height, pixels, mask: maskData, landmarks, yawDeg };
}

function handleFrame(bitmap: ImageBitmap, timestamp: number) {
  try {
    if (!landmarker || (phase !== 'framing' && phase !== 'capturing')) return;
    const result = landmarker.detectForVideo(bitmap, timestamp);
    try {
      const raw = result.landmarks[0] ?? [];
      const landmarks: FrameLandmark[] = raw.map(({ x, y, visibility }) => ({ x, y, visibility: visibility ?? 0 }));
      const fullBody = visible(landmarks, FULL_BODY);
      const torso = visible(landmarks, TORSO);
      const observation = torso ? observeYaw(raw, result.worldLandmarks[0] ?? [], bitmap.width / bitmap.height) : null;
      let yawDeg: number | null = null;
      if (phase === 'framing') {
        if (fullBody && observation) tracker.calibrate(observation);
      } else if (observation) {
        const turn = tracker.update(observation);
        yawDeg = turn.yawDeg;
        const slot = slotFor(turn.yawDeg);
        const motion = previous ? landmarkMotion(previous, landmarks, FULL_BODY) : 0;
        const score = frameScore(meanVisibility(landmarks, FULL_BODY), motion);
        if (slot !== null && slots.accepts(slot, score))
          slots.put(slot, score, snapshot(bitmap, landmarks, result.segmentationMasks?.[0], turn.yawDeg));
        if (turn.done || slots.count === SLOT_COUNT) queueMicrotask(() => void bake());
      }
      previous = landmarks.length ? landmarks : null;
      lastStatus = { phase, fullBody, visible: torso, yawDeg, slots: slots.filled };
    } finally {
      result.close();
    }
  } catch (error) {
    send({
      type: 'error',
      recoverable: false,
      message: `Body tracking failed. Retry. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    bitmap.close();
    send({ type: 'status', status: lastStatus });
  }
}

async function bake() {
  if (phase !== 'capturing' || !model) return;
  phase = 'baking';
  send({ type: 'baking' });
  try {
    texelMap ??= buildTexelMap(model, textureSize);
    const pixels = bakeSkin(texelMap, slots.values(), tracker.direction);
    const canvas = new OffscreenCanvas(textureSize, textureSize);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable in the capture worker.');
    context.putImageData(new ImageData(pixels, textureSize, textureSize), 0, 0);
    let jpeg: Blob | null = null;
    for (const quality of JPEG_QUALITIES) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= AVATAR_SKIN_MAX_BYTES) {
        jpeg = blob;
        break;
      }
    }
    if (!jpeg) throw new Error('The skin image came out too large. Scan again in even lighting.');
    phase = 'done';
    send({ type: 'baked', jpeg });
  } catch (error) {
    phase = 'framing';
    send({
      type: 'error',
      recoverable: true,
      message: `Painting the skin failed. Scan again. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    slots.clear();
  }
}

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case 'init':
      model = data.model;
      textureSize = data.textureSize;
      texelMap = null;
      void initialize(data.modelUrl, data.wasmUrl);
      break;
    case 'frame':
      handleFrame(data.bitmap, data.timestamp);
      break;
    case 'start':
      if (phase !== 'framing') break;
      if (!tracker.start()) {
        send({ type: 'error', recoverable: true, message: 'Hold still with your whole body in view, then start again.' });
        break;
      }
      slots.clear();
      previous = null;
      phase = 'capturing';
      break;
    case 'cancel':
      if (phase === 'baking') break;
      phase = 'framing';
      slots.clear();
      tracker = new YawTracker();
      previous = null;
      break;
    case 'finish':
      if (phase === 'capturing' && slots.count >= MIN_SLOTS_TO_FINISH) void bake();
      break;
    case 'dispose':
      disposed = true;
      landmarker?.close();
      landmarker = null;
      slots.clear();
      scope.close();
      break;
  }
};
```

- [ ] **Step 4: Write the client**

`apps/web/src/avatar/captureClient.ts`:
```ts
import type { CaptureRequest, CaptureResponse, CaptureStatus } from './captureMessages';
import type { ModelData } from './skin/parts';

export const SKIN_TEXTURE_SIZE = 1024;
const FRAME_WIDTH = 640;

export interface CaptureCallbacks {
  onLoading(message: string): void;
  onReady(): void;
  onStatus(status: CaptureStatus): void;
  onBaking(): void;
  onBaked(jpeg: Blob): void;
  onError(message: string, recoverable: boolean): void;
}

/** Feeds camera frames to the capture worker one at a time. Kept frames and the bake stay in the worker. */
export class CaptureClient {
  private readonly worker: Worker;
  private ready = false;
  private busy = false;
  private paused = false;
  private disposed = false;
  private lastVideoTime = -1;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    model: ModelData,
    private readonly callbacks: CaptureCallbacks,
  ) {
    this.worker = new Worker(new URL('./capture.worker.ts', import.meta.url), {
      type: 'module',
      name: 'wb-skin-capture',
    });
    this.worker.onmessage = ({ data }: MessageEvent<CaptureResponse>) => {
      if (this.disposed) return;
      switch (data.type) {
        case 'loading':
          callbacks.onLoading(data.message);
          break;
        case 'ready':
          clearTimeout(this.timeout);
          this.ready = true;
          callbacks.onReady();
          break;
        case 'status':
          this.busy = false;
          callbacks.onStatus(data.status);
          break;
        case 'baking':
          // No frames are needed until the player cancels or retakes.
          this.paused = true;
          callbacks.onBaking();
          break;
        case 'baked':
          callbacks.onBaked(data.jpeg);
          break;
        case 'error':
          if (!data.recoverable) this.fail(data.message);
          else {
            this.paused = false;
            callbacks.onError(data.message, true);
          }
          break;
      }
    };
    this.worker.onerror = () =>
      this.fail('The body scanner could not run. Use desktop Chrome or Edge, then retry.');
    const assets = new URL(`${import.meta.env.BASE_URL}models/`, window.location.origin);
    this.post({
      type: 'init',
      modelUrl: new URL('pose_landmarker_lite.task', assets).href,
      wasmUrl: new URL('wasm', assets).href,
      model,
      textureSize: SKIN_TEXTURE_SIZE,
    });
    this.timeout = setTimeout(() => this.fail('The body scanner timed out while loading. Retry.'), 45000);
  }

  pump(video: HTMLVideoElement) {
    if (
      !this.ready ||
      this.busy ||
      this.paused ||
      this.disposed ||
      video.readyState < 2 ||
      !video.videoWidth ||
      video.currentTime === this.lastVideoTime
    )
      return;
    this.busy = true;
    this.lastVideoTime = video.currentTime;
    const resizeWidth = Math.min(FRAME_WIDTH, video.videoWidth);
    const resizeHeight = Math.max(1, Math.round((video.videoHeight * resizeWidth) / video.videoWidth));
    void createImageBitmap(video, { resizeWidth, resizeHeight })
      .then((bitmap) => {
        if (this.disposed) {
          bitmap.close();
          return;
        }
        this.post({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
      })
      .catch(() => {
        this.busy = false;
      });
  }

  start() {
    this.paused = false;
    this.post({ type: 'start' });
  }

  cancel() {
    this.paused = false;
    this.post({ type: 'cancel' });
  }

  finish() {
    this.post({ type: 'finish' });
  }

  private post(message: CaptureRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  private fail(message: string) {
    if (this.disposed) return;
    this.dispose();
    this.callbacks.onError(message, false);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timeout);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.post({ type: 'dispose' });
    setTimeout(() => this.worker.terminate(), 100);
  }
}
```

- [ ] **Step 5: Write the hook**

`apps/web/src/avatar/useSkinCapture.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CaptureClient } from './captureClient';
import { loadFighterModelData } from './fighterAsset';
import { SLOT_COUNT } from './skin/slots';

export type CapturePhase = 'loading' | 'framing' | 'capturing' | 'baking' | 'review' | 'error';

export interface SkinCaptureState {
  phase: CapturePhase;
  /** The player pressed Start scan; capture begins once they are fully in view. */
  armed: boolean;
  fullBody: boolean;
  visible: boolean;
  yawDeg: number | null;
  slots: boolean[];
  result: Blob | null;
  error: string | null;
  loadingMessage: string;
}

/** Whole body must stay in view this long after Start scan before capture begins. */
const AUTO_START_MS = 1500;
const EMPTY_SLOTS: boolean[] = Array(SLOT_COUNT).fill(false);
const INITIAL: SkinCaptureState = {
  phase: 'loading',
  armed: false,
  fullBody: false,
  visible: false,
  yawDeg: null,
  slots: EMPTY_SLOTS,
  result: null,
  error: null,
  loadingMessage: 'Loading the body scanner…',
};

export function describeCapture(state: SkinCaptureState): string {
  const filled = state.slots.filter(Boolean).length;
  switch (state.phase) {
    case 'loading':
      return state.loadingMessage;
    case 'framing':
      if (state.error) return state.error;
      if (!state.armed) return 'Press Start scan, then step back until your whole body is in view.';
      return state.fullBody
        ? 'Hold still…'
        : 'Step back until your head, hands, and ankles are all in view.';
    case 'capturing':
      return state.visible
        ? `Turn slowly in one direction, arms relaxed. ${filled} of ${SLOT_COUNT} angles captured.`
        : "Can't see you. Step back into the frame.";
    case 'baking':
      return 'Painting your skin…';
    case 'review':
      return 'Here is your fighter. Save the skin or scan again.';
    case 'error':
      return state.error ?? 'Something went wrong. Retry.';
  }
}

export function useSkinCapture(videoRef: RefObject<HTMLVideoElement | null>, stream: MediaStream | null) {
  const [state, setState] = useState<SkinCaptureState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const client = useRef<CaptureClient | null>(null);
  const armed = useRef(false);
  const fullBodySince = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) return;
    let disposed = false;
    let frame = 0;
    let local: CaptureClient | null = null;
    const update = (patch: (state: SkinCaptureState) => SkinCaptureState) => {
      if (!disposed) setState(patch);
    };
    armed.current = false;
    fullBodySince.current = null;
    // Defer so starting the effect does not synchronously update React state.
    queueMicrotask(() => update(() => INITIAL));
    loadFighterModelData()
      .then((model) => {
        if (disposed) return;
        local = new CaptureClient(model, {
          onLoading: (message) => update((s) => ({ ...s, loadingMessage: message })),
          onReady: () => update((s) => ({ ...s, phase: 'framing' })),
          onStatus(status) {
            const now = performance.now();
            fullBodySince.current = status.fullBody ? (fullBodySince.current ?? now) : null;
            const startNow =
              status.phase === 'framing' &&
              armed.current &&
              fullBodySince.current !== null &&
              now - fullBodySince.current >= AUTO_START_MS;
            if (startNow) {
              armed.current = false;
              local?.start();
            }
            update((s) =>
              s.phase !== 'framing' && s.phase !== 'capturing'
                ? s
                : {
                    ...s,
                    phase: startNow ? 'capturing' : status.phase,
                    armed: startNow ? false : s.armed,
                    error: startNow ? null : s.error,
                    fullBody: status.fullBody,
                    visible: status.visible,
                    yawDeg: startNow ? 0 : status.yawDeg,
                    slots: startNow ? EMPTY_SLOTS : status.slots,
                  },
            );
          },
          onBaking: () => update((s) => ({ ...s, phase: 'baking' })),
          onBaked: (jpeg) => update((s) => ({ ...s, phase: 'review', result: jpeg })),
          onError: (message, recoverable) =>
            update((s) => ({
              ...s,
              phase: recoverable ? 'framing' : 'error',
              armed: false,
              slots: EMPTY_SLOTS,
              yawDeg: null,
              error: message,
            })),
        });
        client.current = local;
      })
      .catch((error: unknown) =>
        update((s) => ({
          ...s,
          phase: 'error',
          error: `The fighter model could not load. ${error instanceof Error ? error.message : ''}`,
        })),
      );
    const tick = () => {
      if (videoRef.current && !document.hidden) local?.pump(videoRef.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      local?.dispose();
      client.current = null;
    };
  }, [stream, attempt, videoRef]);

  const arm = useCallback(() => {
    armed.current = true;
    fullBodySince.current = null;
    setState((s) => ({ ...s, armed: true, error: null }));
  }, []);
  const disarm = useCallback(() => {
    armed.current = false;
    setState((s) => ({ ...s, armed: false }));
  }, []);
  const cancel = useCallback(() => {
    client.current?.cancel();
    setState((s) => ({ ...s, phase: 'framing', armed: false, slots: EMPTY_SLOTS, yawDeg: null }));
  }, []);
  const finish = useCallback(() => client.current?.finish(), []);
  const retake = useCallback(() => {
    client.current?.cancel();
    setState((s) => ({ ...s, phase: 'framing', armed: false, slots: EMPTY_SLOTS, yawDeg: null, result: null }));
  }, []);
  const retry = useCallback(() => {
    setState(INITIAL);
    setAttempt((value) => value + 1);
  }, []);

  return { state, message: describeCapture(state), arm, disarm, cancel, finish, retake, retry };
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck --workspace @wb/web && npm run typecheck --workspace @wb/core && npx eslint apps/web/src/avatar packages/core/src`
Expected: no errors. Fix any `react-hooks` lint findings in place (e.g. move ref writes into callbacks) without changing behavior.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/avatar packages/core/src/protocol.ts
git commit -m "feat(avatar): capture worker, client and studio hook"
```

---

### Task 8: Skin store, rig and FighterModel

**Files:**
- Create: `apps/web/src/avatar/skinStore.ts`, `apps/web/src/avatar/rig.ts`, `apps/web/src/avatar/FighterModel.tsx`
- Modify: `apps/web/src/game/FirstPersonArms.tsx`, `apps/web/src/game/FirstPersonScreen.tsx`

**Interfaces:**
- Produces: `useSkinBlob(): Blob | null`; `saveSkin(blob): Promise<boolean>` (false = session only); `clearSkin(): Promise<void>`; `textureForBlob(blob): Promise<Texture>`; `useBlobTexture(blob): Texture | null`; `useSkin(): Texture | null`. From rig: `SIDES`, `Side`, `GUARD`, `ARM_POSES`, `ArmPoseName`, `FighterRig`, `findRig(root)`, `restPose(rig)`, `aim(bone, child, direction)`, `addGloves(root, rig, color): () => void`. `FighterModel` props: `ThreeElements['group'] & { skin?: Texture | null; pose?: ArmPoseName; glove?: string }`; `DEFAULT_SKIN_COLOR`. `FirstPersonArms` gains an optional `skin?: Texture | null` prop.

- [ ] **Step 1: Write the skin store**

`apps/web/src/avatar/skinStore.ts`:
```ts
import { useEffect, useState, useSyncExternalStore } from 'react';
import { SRGBColorSpace, Texture } from 'three';

const DB_NAME = 'webcamboxer';
const STORE = 'skin';
const KEY = 'local';

let skin: Blob | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const call = run(db.transaction(STORE, mode).objectStore(STORE));
      call.onsuccess = () => {
        resolve(call.result);
        db.close();
      };
      call.onerror = () => {
        reject(call.error);
        db.close();
      };
    };
  });
}

function subscribe(listener: () => void) {
  loading ??= request<unknown>('readonly', (store) => store.get(KEY))
    .then((stored) => {
      if (stored instanceof Blob && !skin) {
        skin = stored;
        emit();
      }
    })
    .catch(() => undefined);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The player's saved skin JPEG, or null for the default look. */
export function useSkinBlob(): Blob | null {
  return useSyncExternalStore(subscribe, () => skin, () => null);
}

/** Returns false when the browser blocks storage; the skin then lasts for this session only. */
export async function saveSkin(blob: Blob): Promise<boolean> {
  skin = blob;
  emit();
  try {
    await request('readwrite', (store) => store.put(blob, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function clearSkin(): Promise<void> {
  skin = null;
  emit();
  await request('readwrite', (store) => store.delete(KEY)).catch(() => undefined);
}

const textures = new WeakMap<Blob, Promise<Texture>>();

/** One GPU texture per skin blob, shared by every fighter showing it. */
export function textureForBlob(blob: Blob): Promise<Texture> {
  let texture = textures.get(blob);
  if (!texture) {
    texture = createImageBitmap(blob).then((bitmap) => {
      const next = new Texture(bitmap);
      next.colorSpace = SRGBColorSpace;
      // glTF UVs start at the image's top-left; ImageBitmaps upload unflipped.
      next.flipY = false;
      next.needsUpdate = true;
      return next;
    });
    textures.set(blob, texture);
  }
  return texture;
}

export function useBlobTexture(blob: Blob | null): Texture | null {
  const [loaded, setLoaded] = useState<{ blob: Blob; texture: Texture } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let live = true;
    void textureForBlob(blob).then((texture) => {
      if (live) setLoaded({ blob, texture });
    });
    return () => {
      live = false;
    };
  }, [blob]);
  return blob && loaded?.blob === blob ? loaded.texture : null;
}

export function useSkin(): Texture | null {
  return useBlobTexture(useSkinBlob());
}
```

- [ ] **Step 2: Move rigging helpers into `rig.ts`**

`apps/web/src/avatar/rig.ts`:
```ts
import {
  Bone,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import type { ArmDirections } from '@wb/motion';

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];
const SUFFIX: Record<Side, string> = { left: 'L', right: 'R' };

/** Avatar space (+Z forward, +X the fighter's left): elbows down and out, gloves up by the chin. */
export const GUARD: Record<Side, ArmDirections> = {
  left: { upper: { x: 0.35, y: -0.85, z: 0.4 }, fore: { x: -0.2, y: 0.35, z: 0.9 } },
  right: { upper: { x: -0.35, y: -0.85, z: 0.4 }, fore: { x: 0.2, y: 0.35, z: 0.9 } },
};
/** Arms hanging loosely, slightly away from the body. */
const RELAXED: Record<Side, ArmDirections> = {
  left: { upper: { x: 0.18, y: -1, z: 0 }, fore: { x: 0.1, y: -1, z: 0.15 } },
  right: { upper: { x: -0.18, y: -1, z: 0 }, fore: { x: -0.1, y: -1, z: 0.15 } },
};
export type ArmPoseName = 'guard' | 'relaxed';
export const ARM_POSES: Record<ArmPoseName, Record<Side, ArmDirections>> = { guard: GUARD, relaxed: RELAXED };

export interface ArmBones {
  upper: Bone;
  fore: Bone;
  hand: Bone;
}
export interface FighterRig {
  rest: Map<Bone, Quaternion>;
  arms: Record<Side, ArmBones>;
  head: Bone;
}

export function findRig(root: Object3D): FighterRig {
  const bone = (name: string) => {
    const found = root.getObjectByName(name);
    if (!(found instanceof Bone)) throw new Error(`Fighter model is missing bone ${name}`);
    return found;
  };
  const rest = new Map<Bone, Quaternion>();
  root.traverse((object) => {
    if (object instanceof Bone) rest.set(object, object.quaternion.clone());
  });
  const arm = (side: Side): ArmBones => ({
    upper: bone(`upper_arm_${SUFFIX[side]}`),
    fore: bone(`forearm_${SUFFIX[side]}`),
    hand: bone(`hand_${SUFFIX[side]}`),
  });
  return { rest, arms: { left: arm('left'), right: arm('right') }, head: bone('head') };
}

export function restPose(rig: FighterRig) {
  for (const [bone, quaternion] of rig.rest) bone.quaternion.copy(quaternion);
}

const from = new Vector3();
const to = new Vector3();
const delta = new Quaternion();
const parentRotation = new Quaternion();
const localDelta = new Quaternion();

/** Rotate `bone` in world space so the ray from it to `child` points along `direction`. */
export function aim(bone: Bone, child: Object3D, direction: Vector3) {
  bone.getWorldPosition(from);
  child.getWorldPosition(to);
  delta.setFromUnitVectors(to.sub(from).normalize(), direction);
  bone.parent!.getWorldQuaternion(parentRotation);
  // local' = parent⁻¹ · delta · parent · local
  bone.quaternion.premultiply(localDelta.copy(parentRotation).invert().multiply(delta).multiply(parentRotation));
  bone.updateMatrixWorld(true);
}

/** Attach boxing gloves to both hands; returns the cleanup. */
export function addGloves(root: Object3D, rig: FighterRig, color: string): () => void {
  root.updateWorldMatrix(true, true);
  const fistGeometry = new SphereGeometry(0.065, 20, 14);
  const cuffGeometry = new CylinderGeometry(0.05, 0.055, 0.07, 16);
  const cuffMaterial = new MeshStandardMaterial({ color: '#f2efe6', roughness: 0.6 });
  const fistMaterial = new MeshStandardMaterial({ color, roughness: 0.35 });
  const gloves: Group[] = [];
  for (const side of SIDES) {
    const { fore, hand } = rig.arms[side];
    const fist = new Mesh(fistGeometry, fistMaterial);
    fist.scale.set(1, 1.2, 1.05);
    fist.position.y = 0.06;
    const glove = new Group();
    glove.add(fist, new Mesh(cuffGeometry, cuffMaterial));
    // Align glove +Y with the forearm direction, starting at the wrist, in hand-local space.
    const wrist = hand.getWorldPosition(new Vector3());
    const along = wrist.clone().sub(fore.getWorldPosition(new Vector3())).normalize();
    const handRotation = hand.getWorldQuaternion(new Quaternion()).invert();
    glove.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), along.applyQuaternion(handRotation));
    hand.add(glove);
    gloves.push(glove);
  }
  return () => {
    for (const glove of gloves) glove.removeFromParent();
    for (const owned of [fistGeometry, cuffGeometry, cuffMaterial, fistMaterial]) owned.dispose();
  };
}
```

- [ ] **Step 3: Write `FighterModel`**

`apps/web/src/avatar/FighterModel.tsx`:
```tsx
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeElements } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { Group, Texture } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FIGHTER_URL } from './fighterAsset';
import { addGloves, aim, ARM_POSES, findRig, restPose, SIDES } from './rig';
import type { ArmPoseName } from './rig';

/** Worn until the player bakes a skin. */
export const DEFAULT_SKIN_COLOR = '#c58c69';

type FighterModelProps = ThreeElements['group'] & {
  skin?: Texture | null;
  pose?: ArmPoseName;
  glove?: string;
};

const rootRotation = new Quaternion();
const target = new Vector3();

/** The team's fighter (fighter.glb), wearing a camera-baked skin when one is given. */
export function FighterModel({ skin = null, pose = 'relaxed', glove, ...props }: FighterModelProps) {
  const { scene } = useGLTF(FIGHTER_URL);
  const fighter = useMemo(() => cloneSkinned(scene), [scene]);
  const rig = useMemo(() => findRig(fighter), [fighter]);
  const root = useRef<Group>(null);

  useEffect(() => {
    const material = new MeshStandardMaterial({
      map: skin,
      color: skin ? '#ffffff' : DEFAULT_SKIN_COLOR,
      roughness: 0.75,
    });
    fighter.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        object.material = material;
        // Bounds come from the rest pose; posed arms swing outside them.
        object.frustumCulled = false;
      }
    });
    return () => material.dispose();
  }, [fighter, skin]);

  useEffect(() => (glove ? addGloves(fighter, rig, glove) : undefined), [fighter, rig, glove]);

  useFrame(() => {
    if (!root.current) return;
    restPose(rig);
    root.current.getWorldQuaternion(rootRotation);
    const goal = ARM_POSES[pose];
    for (const side of SIDES) {
      const arm = rig.arms[side];
      const { upper, fore } = goal[side];
      aim(arm.upper, arm.fore, target.set(upper.x, upper.y, upper.z).normalize().applyQuaternion(rootRotation));
      aim(arm.fore, arm.hand, target.set(fore.x, fore.y, fore.z).normalize().applyQuaternion(rootRotation));
    }
  });

  return (
    <group ref={root} {...props}>
      <primitive object={fighter} />
    </group>
  );
}

useGLTF.preload(FIGHTER_URL);
```

- [ ] **Step 4: Refactor `FirstPersonArms` onto `rig.ts` and the skin**

Replace `apps/web/src/game/FirstPersonArms.tsx` with:
```tsx
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { MeshStandardMaterial, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { Group, Texture } from 'three';
import { ArmPoseEstimator } from '@wb/motion';
import type { PoseSample } from '@wb/motion';
import { FIGHTER_URL } from '../avatar/fighterAsset';
import { DEFAULT_SKIN_COLOR } from '../avatar/FighterModel';
import { addGloves, aim, findRig, GUARD, restPose, SIDES } from '../avatar/rig';
import type { Side } from '../avatar/rig';

/** Eye position in avatar space (+Z forward). The scene turns the avatar to face -Z. */
export const EYE_HEIGHT = 1.64;
export const EYE_FORWARD = 0.08;

/** Player A blue, per the PRD's glove color convention. */
const GLOVE_COLOR = '#4284bd';
const TRACKED_SMOOTHING_S = 0.05;
const RELEASE_SMOOTHING_S = 0.25;

const target = new Vector3();
const rootRotation = new Quaternion();

export function FirstPersonArms({
  sampleRef,
  skin = null,
}: {
  sampleRef: RefObject<PoseSample | null>;
  skin?: Texture | null;
}) {
  const { scene } = useGLTF(FIGHTER_URL);
  const root = useRef<Group>(null);
  const estimator = useMemo(() => new ArmPoseEstimator(), []);
  const lastSample = useRef<PoseSample | null>(null);
  const pose = useRef<ReturnType<ArmPoseEstimator['update']>>({ left: null, right: null });
  const rig = useMemo(() => findRig(scene), [scene]);
  const smooth = useMemo(() => {
    const start = (side: Side) => ({
      upper: new Vector3(GUARD[side].upper.x, GUARD[side].upper.y, GUARD[side].upper.z).normalize(),
      fore: new Vector3(GUARD[side].fore.x, GUARD[side].fore.y, GUARD[side].fore.z).normalize(),
    });
    return { left: start('left'), right: start('right') };
  }, []);

  useEffect(() => {
    const material = new MeshStandardMaterial({
      map: skin,
      color: skin ? '#ffffff' : DEFAULT_SKIN_COLOR,
      roughness: 0.75,
    });
    scene.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        object.material = material;
        // Bounds come from the rest pose; posed arms swing outside them.
        object.frustumCulled = false;
      }
    });
    return () => material.dispose();
  }, [scene, skin]);

  useEffect(() => {
    // Hide the head so the eye camera never renders its inside faces.
    rig.head.scale.setScalar(0.001);
    const removeGloves = addGloves(scene, rig, GLOVE_COLOR);
    return () => {
      removeGloves();
      rig.head.scale.setScalar(1);
      // The GLTF scene is cached and cloned by other fighters; leave it in its rest pose.
      restPose(rig);
    };
  }, [scene, rig]);

  useFrame((_, dt) => {
    const sample = sampleRef.current;
    if (sample !== lastSample.current) {
      lastSample.current = sample;
      pose.current = estimator.update(sample);
    }
    if (!root.current) return;
    restPose(rig);
    root.current.getWorldQuaternion(rootRotation);
    for (const side of SIDES) {
      const arm = rig.arms[side];
      const tracked = pose.current[side];
      const goal = tracked ?? GUARD[side];
      const alpha = 1 - Math.exp(-dt / (tracked ? TRACKED_SMOOTHING_S : RELEASE_SMOOTHING_S));
      const current = smooth[side];
      current.upper.lerp(target.set(goal.upper.x, goal.upper.y, goal.upper.z).normalize(), alpha).normalize();
      current.fore.lerp(target.set(goal.fore.x, goal.fore.y, goal.fore.z).normalize(), alpha).normalize();
      aim(arm.upper, arm.fore, target.copy(current.upper).applyQuaternion(rootRotation));
      aim(arm.fore, arm.hand, target.copy(current.fore).applyQuaternion(rootRotation));
    }
  });

  return (
    <group ref={root} rotation={[0, Math.PI, 0]}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(FIGHTER_URL);
```

Note: the original reset bone quaternions every frame except the head. Restoring the head too is harmless because only its scale changes.

In `apps/web/src/game/FirstPersonScreen.tsx`: add `import { useSkin } from '../avatar/skinStore';`, add `const skin = useSkin();` after `const diagnostics = pose.diagnostics;`, and change `<FirstPersonArms sampleRef={pose.latestSample} />` to `<FirstPersonArms sampleRef={pose.latestSample} skin={skin} />`.

- [ ] **Step 5: Typecheck, lint and test**

Run: `npm run typecheck --workspace @wb/web && npx eslint apps/web/src && npm test`
Expected: no errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/avatar apps/web/src/game/FirstPersonArms.tsx apps/web/src/game/FirstPersonScreen.tsx
git commit -m "feat(avatar): shared skinned FighterModel and skin store"
```

---

### Task 9: Fighters in the ring and lobby

**Files:**
- Create: `apps/web/src/avatar/FighterPortrait.tsx`
- Modify: `apps/web/src/game/Ring.tsx`, `apps/web/src/pages/LobbyPage.tsx`, `apps/web/src/pages/GamePage.tsx`, `apps/web/src/styles/base.css`
- Delete: `apps/web/src/ui/RobotAvatar.tsx`

**Interfaces:**
- Consumes: `FighterModel`, `useSkin`.
- Produces: `Ring` prop `skins?: Partial<Record<Seat, Texture | null>>`; `FighterPortrait({ skin })`.

- [ ] **Step 1: Replace the capsule fighters in `Ring.tsx`**

Replace the imports and the `Fighter` function at the top of `apps/web/src/game/Ring.tsx` with:
```tsx
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
    if (boxer.current) boxer.current.position.y = MAT_Y + Math.sin(clock.elapsedTime * 2.1 + x) * 0.035;
  });

  // Player A (left, x < 0) faces +x; player B faces -x.
  return (
    <group ref={boxer} position={[x, MAT_Y, 0]} rotation={[0, x < 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
      <FighterModel skin={skin} pose="guard" glove={glove} scale={FIGHTER_SCALE} />
    </group>
  );
}
```
Change the `Ring` signature to `export function Ring({ active = false, skins = {} }: RingProps) {` and replace the fighters' `.map` block with:
```tsx
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
```

- [ ] **Step 2: Add the lobby portrait**

`apps/web/src/avatar/FighterPortrait.tsx`:
```tsx
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
```

- [ ] **Step 3: Wire skins into the lobby and game pages**

`apps/web/src/pages/LobbyPage.tsx`:
- Replace `import { RobotAvatar } from '../ui/RobotAvatar';` with `import { FighterPortrait } from '../avatar/FighterPortrait';` and `import { useSkin } from '../avatar/skinStore';`.
- Add `const skin = useSkin();` under `const [hot, setHot] = useState(false);`.
- `<Ring active={hot} />` becomes `<Ring active={hot} skins={{ A: skin }} />`.
- `<RobotAvatar compact />` becomes `<FighterPortrait skin={skin} />`.

`apps/web/src/pages/GamePage.tsx`:
- Add `import { useSkin } from '../avatar/skinStore';`, and `const skin = useSkin();` as the first line of `GamePage`.
- `<Ring active />` becomes `<Ring active skins={{ A: skin }} />`.

Delete `apps/web/src/ui/RobotAvatar.tsx` (AvatarPage stops using it in Task 10; until then it is the last user, so do this deletion after Task 10 Step 1 if executing strictly in order. Otherwise run `git rm` now and accept a transient AvatarPage type error).

- [ ] **Step 4: Replace robot CSS**

In `apps/web/src/styles/base.css`:
- Delete every rule whose selector contains `.robot-`: the block from `.robot-avatar {` (≈ line 415) through the end of `.avatar-display .robot-avatar { … }` (≈ line 563), plus the media-query rules at ≈757–762, ≈826–832 and ≈859–861.
- Add after the `.avatar-copy b` rule:
```css
.fighter-portrait {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 150px;
  height: 220px;
  pointer-events: none;
  transition: transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.avatar-bay:hover .fighter-portrait {
  transform: translateY(-7px);
}
```
- In the `@media (max-width: 1120px)` block add:
```css
  .fighter-portrait {
    width: 120px;
    height: 176px;
  }
```

Run: `grep -n "robot" apps/web/src/styles/base.css`. Expected: no output.

- [ ] **Step 5: Typecheck, lint, build**

Run: `npm run typecheck --workspace @wb/web && npx eslint apps/web/src`
Expected: errors only in `AvatarPage.tsx` (RobotAvatar import), which Task 10 rewrites. No other errors.

- [ ] **Step 6: Commit (after Task 10 Step 1 if you deferred the deletion)**

```bash
git add -A apps/web/src/game/Ring.tsx apps/web/src/avatar/FighterPortrait.tsx apps/web/src/pages/LobbyPage.tsx apps/web/src/pages/GamePage.tsx apps/web/src/styles/base.css apps/web/src/ui/RobotAvatar.tsx
git commit -m "feat(avatar): fighter model with player skin in ring and lobby"
```

---

### Task 10: Avatar studio page

**Files:**
- Create: `apps/web/src/avatar/TurnDial.tsx`, `apps/web/src/pages/avatarStudio.css`
- Rewrite: `apps/web/src/pages/AvatarPage.tsx`

**Interfaces:**
- Consumes: `useCamera`, `useVideoStream`, `useSkinCapture`, `useSkinBlob`, `useBlobTexture`, `saveSkin`, `clearSkin`, `FighterModel`, `MIN_SLOTS_TO_FINISH`.

- [ ] **Step 1: Write the page**

`apps/web/src/avatar/TurnDial.tsx`:
```tsx
const RADIUS = 46;
const HALF_WEDGE = 18;

function arc(fromDeg: number, toDeg: number) {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${Math.sin(rad) * RADIUS} ${-Math.cos(rad) * RADIUS}`;
  };
  return `M ${point(fromDeg)} A ${RADIUS} ${RADIUS} 0 0 1 ${point(toDeg)}`;
}

/** Ring of capture slots (lit when captured) with a needle at the current turn angle. */
export function TurnDial({ slots, yawDeg }: { slots: readonly boolean[]; yawDeg: number | null }) {
  const step = 360 / slots.length;
  const captured = slots.filter(Boolean).length;
  const needle = yawDeg === null ? null : (yawDeg * Math.PI) / 180;
  return (
    <svg className="turn-dial" viewBox="-60 -60 120 120" role="img" aria-label={`${captured} of ${slots.length} angles captured`}>
      {slots.map((filled, index) => (
        <path
          key={index}
          className={filled ? 'is-filled' : undefined}
          d={arc(index * step - HALF_WEDGE, index * step + HALF_WEDGE)}
        />
      ))}
      {needle === null ? null : (
        <line className="turn-dial-needle" x1="0" y1="0" x2={Math.sin(needle) * 34} y2={-Math.cos(needle) * 34} />
      )}
      <circle className="turn-dial-hub" r="4" />
    </svg>
  );
}
```

`apps/web/src/pages/AvatarPage.tsx`:
```tsx
import { Suspense, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Link } from 'react-router';
import { useCamera } from '../cam/useCamera';
import { useVideoStream } from '../cam/useVideoStream';
import { FighterModel } from '../avatar/FighterModel';
import { MIN_SLOTS_TO_FINISH } from '../avatar/skin/slots';
import { clearSkin, saveSkin, useBlobTexture, useSkinBlob } from '../avatar/skinStore';
import { TurnDial } from '../avatar/TurnDial';
import { useSkinCapture } from '../avatar/useSkinCapture';
import './avatarStudio.css';

const STEPS = ['Camera on', 'Step back', 'Turn around', 'Save'] as const;

export function AvatarPage() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const { stream, fail, start } = camera;
  useVideoStream(videoRef, stream, fail);
  const capture = useSkinCapture(videoRef, stream);
  const { state } = capture;
  const savedBlob = useSkinBlob();
  const preview = useBlobTexture(state.result ?? savedBlob);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const saved = state.result !== null && state.result === savedBlob;
  const filled = state.slots.filter(Boolean).length;

  const step = !stream
    ? 0
    : state.phase === 'capturing'
      ? 2
      : state.phase === 'baking' || state.phase === 'review'
        ? 3
        : 1;
  const message = !stream
    ? camera.message
    : saved
      ? (storageNote ?? 'Saved. Your fighter wears this skin in the lobby and the ring.')
      : capture.message;

  async function save() {
    if (!state.result) return;
    const persisted = await saveSkin(state.result);
    setStorageNote(persisted ? null : 'Saved for this session only. This browser is blocking local storage.');
  }

  let actions: ReactNode = null;
  if (!stream)
    actions = (
      <button className="studio-primary" type="button" disabled={camera.status === 'requesting'} onClick={() => void start()}>
        {camera.status === 'error' ? 'Retry camera' : 'Turn camera on'}
      </button>
    );
  else if (state.phase === 'framing')
    actions = state.armed ? (
      <button className="studio-secondary" type="button" onClick={capture.disarm}>
        Cancel
      </button>
    ) : (
      <button className="studio-primary" type="button" onClick={capture.arm}>
        Start scan
      </button>
    );
  else if (state.phase === 'capturing')
    actions = (
      <>
        {filled >= MIN_SLOTS_TO_FINISH ? (
          <button className="studio-primary" type="button" onClick={capture.finish}>
            Finish now
          </button>
        ) : null}
        <button className="studio-secondary" type="button" onClick={capture.cancel}>
          Cancel
        </button>
      </>
    );
  else if (state.phase === 'review')
    actions = (
      <>
        {saved ? null : (
          <button className="studio-primary" type="button" onClick={() => void save()}>
            Save skin
          </button>
        )}
        <button className="studio-secondary" type="button" onClick={capture.retake}>
          Scan again
        </button>
      </>
    );
  else if (state.phase === 'error')
    actions = (
      <button className="studio-primary" type="button" onClick={capture.retry}>
        Retry
      </button>
    );

  return (
    <main className="subpage">
      <header className="topbar">
        <Link className="wordmark" to="/" aria-label="Return to lobby">
          <span className="wordmark-mark" aria-hidden="true" />
          WebcamBoxer
        </Link>
        <Link className="back-link" to="/">
          ← Back to lobby
        </Link>
      </header>
      <section className="studio">
        <div className="studio-panel">
          <span className="section-kicker">AVATAR STUDIO</span>
          <h1>Scan yourself in.</h1>
          <p className="studio-lede">
            Turn on your camera, step back so your whole body is in frame, and turn slowly in a full
            circle. Your look is painted onto your fighter. Camera frames stay on this device.
          </p>
          <ol className="studio-steps">
            {STEPS.map((label, index) => (
              <li
                key={label}
                data-state={index < step || (index === 3 && saved) ? 'done' : index === step ? 'current' : 'todo'}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {label}
              </li>
            ))}
          </ol>
          <div className="studio-camera">
            <video ref={videoRef} autoPlay muted playsInline aria-label="Mirrored camera preview" hidden={!stream} />
            {stream ? (
              <TurnDial slots={state.slots} yawDeg={state.phase === 'capturing' ? state.yawDeg : null} />
            ) : (
              <span className="studio-camera-off">CAMERA OFF</span>
            )}
          </div>
          <p className="studio-status" role="status" aria-live="polite">
            {message}
          </p>
          <div className="studio-actions">
            {actions}
            {savedBlob ? (
              <button className="studio-link" type="button" onClick={() => void clearSkin()}>
                Use default skin
              </button>
            ) : null}
          </div>
        </div>
        <div className="studio-stage" aria-label="Preview of your fighter">
          <Canvas camera={{ position: [0, 1.1, 3.6], fov: 35 }} dpr={[1, 1.5]}>
            <hemisphereLight args={['#f5f3eb', '#2a3440', 1.3]} />
            <directionalLight position={[2, 4, 3]} intensity={2} color="#f4d4a5" />
            <directionalLight position={[-3, 2, -3]} intensity={0.8} color="#53a9d7" />
            <Suspense fallback={null}>
              <FighterModel skin={preview} pose="relaxed" />
            </Suspense>
            <OrbitControls
              target={[0, 0.95, 0]}
              autoRotate
              autoRotateSpeed={1.2}
              enablePan={false}
              enableZoom={false}
              minPolarAngle={1.2}
              maxPolarAngle={1.9}
            />
          </Canvas>
          <span className="studio-stage-note">
            {!preview ? 'DEFAULT SKIN' : state.result && !saved ? 'PREVIEW · NOT SAVED' : 'YOUR SKIN'} · DRAG TO SPIN
          </span>
        </div>
      </section>
    </main>
  );
}
```

`apps/web/src/pages/avatarStudio.css`:
```css
.studio {
  display: grid;
  min-height: calc(100vh - 77px);
  grid-template-columns: minmax(320px, 0.9fr) 1.1fr;
  gap: 36px;
  padding: 28px 0 36px;
}
.studio-panel {
  display: flex;
  max-width: 470px;
  flex-direction: column;
  align-self: center;
  gap: 18px;
}
.studio-panel h1 {
  margin: 0;
  font:
    600 clamp(32px, 4vw, 48px) / 1 'Space Grotesk',
    sans-serif;
  letter-spacing: -0.05em;
}
.studio-lede {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}
.studio-steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.studio-steps li {
  display: grid;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: #63727a;
  font-size: 11px;
  font-weight: 600;
}
.studio-steps li span {
  font:
    600 10px 'Space Grotesk',
    sans-serif;
  letter-spacing: 0.12em;
}
.studio-steps li[data-state='current'] {
  border-color: var(--amber);
  color: var(--paper);
}
.studio-steps li[data-state='current'] span {
  color: var(--amber);
}
.studio-steps li[data-state='done'] {
  border-color: rgb(143 200 156 / 45%);
  color: var(--green);
}
.studio-camera {
  position: relative;
  display: grid;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: #0d151c;
}
.studio-camera video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);
}
.studio-camera video[hidden] {
  display: none;
}
.studio-camera-off {
  color: #4d5c64;
  font-size: 10px;
  letter-spacing: 0.16em;
}
.turn-dial {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 92px;
  height: 92px;
  filter: drop-shadow(0 4px 10px rgb(0 0 0 / 45%));
}
.turn-dial path {
  fill: none;
  stroke: rgb(231 237 240 / 22%);
  stroke-linecap: round;
  stroke-width: 9;
  transition: stroke 200ms ease;
}
.turn-dial path.is-filled {
  stroke: var(--green);
}
.turn-dial-needle {
  stroke: var(--amber);
  stroke-linecap: round;
  stroke-width: 3;
}
.turn-dial-hub {
  fill: var(--amber);
}
.studio-status {
  min-height: 40px;
  margin: 0;
  color: var(--paper);
  font-size: 13px;
  line-height: 1.5;
}
.studio-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.studio-primary,
.studio-secondary,
.studio-link {
  min-height: 40px;
  padding: 0 18px;
  border-radius: 4px;
  font:
    700 12px 'DM Sans',
    sans-serif;
  cursor: pointer;
  transition:
    filter 160ms ease,
    transform 160ms ease,
    border-color 160ms ease;
}
.studio-primary {
  border: 0;
  background: var(--amber);
  color: #1e1b17;
}
.studio-primary:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-2px);
}
.studio-primary:disabled {
  cursor: wait;
  opacity: 0.5;
}
.studio-secondary {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--paper);
}
.studio-secondary:hover {
  border-color: var(--blue);
}
.studio-link {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.studio button:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
.studio-stage {
  position: relative;
  min-height: 520px;
  overflow: hidden;
  border: 1px solid #263640;
  border-radius: 5px;
  background:
    radial-gradient(ellipse at 50% 60%, rgb(65 109 127 / 25%), transparent 65%),
    #101820;
}
.studio-stage canvas {
  touch-action: none;
}
.studio-stage-note {
  position: absolute;
  bottom: 14px;
  left: 16px;
  color: #73828a;
  font-size: 9px;
  letter-spacing: 0.16em;
}
@media (max-width: 900px) {
  .studio {
    grid-template-columns: 1fr;
  }
  .studio-panel {
    max-width: none;
  }
  .studio-stage {
    min-height: 380px;
  }
}
```

- [ ] **Step 2: Typecheck, lint, test, build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all succeed. `grep -rn RobotAvatar apps/web/src` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/avatar/TurnDial.tsx apps/web/src/pages/AvatarPage.tsx apps/web/src/pages/avatarStudio.css
git commit -m "feat(avatar): studio page for 360° skin capture"
```

---

### Task 11: Skin protocol, server relay and client sync

**Files:**
- Modify: `packages/core/src/protocol.ts`, `apps/api/src/net/socket.ts`
- Create: `apps/api/src/avatar/skinRelay.ts`, `apps/api/src/avatar/socket.ts`, `apps/web/src/net/skinSync.ts`
- Test: `packages/core/tests/avatar.test.mjs`, `apps/api/tests/skinRelay.test.mjs`

**Interfaces:**
- Produces: `avatarSkinSchema` (`{ jpeg: Uint8Array }`, ≤ 256 KB, JPEG magic); `OpponentSkinPayload { seat: Seat; jpeg: Uint8Array }`; `class SkinRelay { set(roomId, seat, jpeg); opponentOf(roomId, seat): OpponentSkinPayload | null; closeRoom(roomId) }`; `addAvatarHandlers(socket, relay)`; `sendOpponentSkin(socket, relay, roomId, seat)` (for the future room-join handler); web `publishSkin(socket, blob)`, `useOpponentSkinBlob(socket)`.

Socket events: client → server `avatar:skin` with `{ jpeg: ArrayBuffer }` and an optional ack `({ ok: true } | { ok: false, error: ServerErrorPayload })`; server → client `avatar:opponentSkin` with `{ seat, jpeg }`. Room membership is read from `socket.data.roomId` and `socket.data.seat`, which the future room-join handler sets. Until then the handler acks `NOT_IN_ROOM`.

- [ ] **Step 1: Write the failing tests**

`packages/core/tests/avatar.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { avatarSkinSchema, AVATAR_SKIN_MAX_BYTES } = await loadTs(new URL('../src/protocol.ts', import.meta.url));
const jpeg = (size) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};

test('accepts a JPEG up to the size limit', () => {
  assert.ok(avatarSkinSchema.safeParse({ jpeg: jpeg(AVATAR_SKIN_MAX_BYTES) }).success);
});

test('rejects oversized, non-JPEG, empty and non-binary skins', () => {
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: jpeg(AVATAR_SKIN_MAX_BYTES + 1) }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: new Uint8Array(0) }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: 'ffd8ff' }).success);
  assert.ok(!avatarSkinSchema.safeParse({ jpeg: jpeg(10), extra: true }).success);
});
```

`apps/api/tests/skinRelay.test.mjs`:
```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from '../../../tools/test/loadTs.mjs';

const { SkinRelay } = await loadTs(new URL('../src/avatar/skinRelay.ts', import.meta.url));
const { addAvatarHandlers } = await loadTs(new URL('../src/avatar/socket.ts', import.meta.url));
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 1]);

test('each seat sees the other seat’s latest skin', () => {
  const relay = new SkinRelay();
  assert.equal(relay.opponentOf('r1', 'A'), null);
  relay.set('r1', 'B', jpeg);
  assert.deepEqual(relay.opponentOf('r1', 'A'), { seat: 'B', jpeg });
  assert.equal(relay.opponentOf('r1', 'B'), null);
  relay.closeRoom('r1');
  assert.equal(relay.opponentOf('r1', 'A'), null);
});

function fakeSocket(data) {
  const handlers = {};
  const emitted = [];
  return {
    data,
    emitted,
    on: (event, handler) => (handlers[event] = handler),
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
    fire: (event, ...args) => handlers[event](...args),
  };
}

test('a valid skin is stored and relayed to the room', () => {
  const relay = new SkinRelay();
  const socket = fakeSocket({ roomId: 'r1', seat: 'A' });
  addAvatarHandlers(socket, relay);
  let ack;
  socket.fire('avatar:skin', { jpeg }, (result) => (ack = result));
  assert.deepEqual(ack, { ok: true });
  assert.deepEqual(socket.emitted, [{ room: 'r1', event: 'avatar:opponentSkin', payload: { seat: 'A', jpeg } }]);
  assert.deepEqual(relay.opponentOf('r1', 'B'), { seat: 'A', jpeg });
});

test('invalid skins and players outside a room are rejected without relaying', () => {
  const relay = new SkinRelay();
  const outside = fakeSocket({});
  addAvatarHandlers(outside, relay);
  let ack;
  outside.fire('avatar:skin', { jpeg }, (result) => (ack = result));
  assert.equal(ack.ok, false);
  assert.equal(ack.error.code, 'NOT_IN_ROOM');
  const inside = fakeSocket({ roomId: 'r1', seat: 'A' });
  addAvatarHandlers(inside, relay);
  inside.fire('avatar:skin', { jpeg: Uint8Array.from([1, 2, 3]) }, (result) => (ack = result));
  assert.equal(ack.error.code, 'INVALID_SKIN');
  assert.equal(ack.error.recoverable, true);
  assert.equal(inside.emitted.length, 0);
  inside.fire('avatar:skin', { jpeg }); // no ack callback must not throw
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test packages/core/tests/avatar.test.mjs apps/api/tests/skinRelay.test.mjs`
Expected: FAIL. `avatarSkinSchema` is undefined, and `skinRelay.ts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/protocol.ts` (below `AVATAR_SKIN_MAX_BYTES`):
```ts
const isJpeg = (bytes: Uint8Array) => bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
export const avatarSkinSchema = z
  .object({
    jpeg: z.custom<Uint8Array>(
      (value) => value instanceof Uint8Array && value.byteLength <= AVATAR_SKIN_MAX_BYTES && isJpeg(value),
      'Skin must be a JPEG of at most 256 KB.',
    ),
  })
  .strict();
export type AvatarSkin = z.infer<typeof avatarSkinSchema>;
export interface OpponentSkinPayload {
  seat: Seat;
  jpeg: Uint8Array;
}
```

`apps/api/src/avatar/skinRelay.ts`:
```ts
import type { OpponentSkinPayload, Seat } from '@wb/core';

/** Latest skin per seat per room, in memory only; dropped when the room closes. */
export class SkinRelay {
  private readonly rooms = new Map<string, Partial<Record<Seat, Uint8Array>>>();

  set(roomId: string, seat: Seat, jpeg: Uint8Array) {
    this.rooms.set(roomId, { ...this.rooms.get(roomId), [seat]: jpeg });
  }

  opponentOf(roomId: string, seat: Seat): OpponentSkinPayload | null {
    const other: Seat = seat === 'A' ? 'B' : 'A';
    const jpeg = this.rooms.get(roomId)?.[other];
    return jpeg ? { seat: other, jpeg } : null;
  }

  closeRoom(roomId: string) {
    this.rooms.delete(roomId);
  }
}
```

`apps/api/src/avatar/socket.ts`:
```ts
import { avatarSkinSchema } from '@wb/core';
import type { Seat, ServerErrorPayload } from '@wb/core';
import type { Socket } from 'socket.io';
import type { SkinRelay } from './skinRelay';

type SkinAck = (result: { ok: true } | { ok: false; error: ServerErrorPayload }) => void;
/** Set by the room-join handler. */
interface RoomMembership {
  roomId?: string;
  seat?: Seat;
}
type AvatarSocket = Pick<Socket, 'on' | 'to' | 'emit'> & { data: RoomMembership };

export function addAvatarHandlers(socket: AvatarSocket, relay: SkinRelay) {
  socket.on('avatar:skin', (payload: unknown, ack?: SkinAck) => {
    const { roomId, seat } = socket.data;
    if (!roomId || !seat) {
      ack?.({ ok: false, error: { code: 'NOT_IN_ROOM', message: 'Join a room before sharing a skin.', recoverable: true } });
      return;
    }
    const parsed = avatarSkinSchema.safeParse(payload);
    if (!parsed.success) {
      ack?.({ ok: false, error: { code: 'INVALID_SKIN', message: 'Skin must be a JPEG of at most 256 KB.', recoverable: true } });
      return;
    }
    relay.set(roomId, seat, parsed.data.jpeg);
    socket.to(roomId).emit('avatar:opponentSkin', { seat, jpeg: parsed.data.jpeg });
    ack?.({ ok: true });
  });
}

/** Replay the opponent's skin to a player who joins after it was shared. */
export function sendOpponentSkin(socket: AvatarSocket, relay: SkinRelay, roomId: string, seat: Seat) {
  const opponent = relay.opponentOf(roomId, seat);
  if (opponent) socket.emit('avatar:opponentSkin', opponent);
}
```

`apps/api/src/net/socket.ts`:
```ts
import type { Server } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { addAvatarHandlers } from '../avatar/socket';
import { SkinRelay } from '../avatar/skinRelay';

export function addSockets(server: Server, webOrigin: string) {
  const io = new SocketServer(server, { cors: { origin: webOrigin } });
  const skins = new SkinRelay();

  io.on('connection', (socket) => {
    socket.emit('server:ready', { connected: true });
    addAvatarHandlers(socket, skins);
  });

  return io;
}
```

`apps/web/src/net/skinSync.ts`:
```ts
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { Seat } from '@wb/core';

/** Share the local skin with the room; the server validates size and format. */
export async function publishSkin(socket: Socket, skin: Blob) {
  socket.emit('avatar:skin', { jpeg: await skin.arrayBuffer() });
}

/** The opponent's skin JPEG once they share one (pass to useBlobTexture). */
export function useOpponentSkinBlob(socket: Socket | null): Blob | null {
  const [skin, setSkin] = useState<Blob | null>(null);
  useEffect(() => {
    if (!socket) return;
    const receive = ({ jpeg }: { seat: Seat; jpeg: ArrayBuffer }) =>
      setSkin(new Blob([jpeg], { type: 'image/jpeg' }));
    socket.on('avatar:opponentSkin', receive);
    return () => {
      socket.off('avatar:opponentSkin', receive);
    };
  }, [socket]);
  return skin;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test packages/core/tests/avatar.test.mjs apps/api/tests/skinRelay.test.mjs && npm run typecheck && npm run lint`
Expected: PASS (5 tests); typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/protocol.ts packages/core/tests/avatar.test.mjs apps/api/src/avatar apps/api/src/net/socket.ts apps/api/tests/skinRelay.test.mjs apps/web/src/net/skinSync.ts
git commit -m "feat(avatar): relay fighter skins between room seats"
```

---

### Task 12: End-to-end verification

**Files:** none (fix forward in the owning file if anything fails)

- [ ] **Step 1: Full automated gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all succeed; every test passes.

- [ ] **Step 2: Browser smoke test**

Run `npm run dev:web` and open `http://localhost:5173/`. Check:
1. Lobby: the ring shows two fighters in guard pose with blue/orange gloves on the mat; the avatar bay shows a swaying fighter portrait with the default skin.
2. `/avatar`: the page renders, the preview fighter auto-rotates and can be dragged, and "Turn camera on" starts the camera with a mirrored preview and the dial.
3. Start scan → step back → capture starts automatically within ~1.5 s → turning fills the dial → baking → the preview shows the scanned skin.
4. Save → back to the lobby → both the lobby portrait and ring fighter A wear the skin; `/practice` arms wear it.
5. Reload: the skin persists. "Use default skin" restores the default look.

- [ ] **Step 3: Hand the hardware checklist to the user**

Use the `test-checklist` skill for the real-camera items: full turn in normal light, fast turn, partial occlusion, baggy clothing, clockwise vs counter-clockwise turn, skin visible in lobby/ring/first-person.

---

## Spec deviations (intentional)

- **Separate capture worker:** the spec mentions a "worker init option" for segmentation masks. The plan uses a separate capture worker instead, so the game's pose pipeline is untouched and frames never leave the worker.
- **Limb half-width from the mask:** the spec measures it by scanning the mask. The plan uses the model's limb thickness, scaled by one per-frame pixels-per-meter (torso height). The mask is then used only to reject background samples. This is simpler and needs no per-limb scan.
- **No room-join handler:** the server has none yet. The relay reads `socket.data.roomId/seat`, and `sendOpponentSkin` is exported for the join handler to call. The client sync hook exists but is not mounted until a match flow does.
