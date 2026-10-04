# Avatar skin capture — design

Date: 2026-10-03
Status: approved in chat, pending spec review

## Goal

On `/avatar`, a player turns on their camera, turns slowly through 360°, and their
appearance is baked into a texture ("skin") on the team's fighter model
(`StormHacks_Base.blend` → `fighter.glb`). Every fighter avatar — the lobby/main menu
fighter, the ring fighters, and the first-person arms — uses this model and shows the
relevant player's skin. In a two-player room each player sees the opponent's skin.

## Decisions (from the user)

- **Mapping:** pose-guided, per body part (not a cylindrical panorama, not front/back only).
- **Sharing:** skin is saved locally and relayed to the opponent through the room socket.
- **Capture:** automatic by detected turning angle (not timed or manual shutter).

## Current state (relevant facts)

- `fighter.glb` is exported from the .blend by `tools/blender/export_fighter.py`
  (22-bone deform skeleton, `Body` mesh only, no materials).
- The `Body` mesh (508 verts, 613 faces, T-pose, 1.33 m wide) has **no UV layers**.
- `FirstPersonArms.tsx` already loads `fighter.glb` and aims arm bones from pose samples.
- The lobby and `/avatar` show the CSS `RobotAvatar`; `Ring.tsx` draws capsule robots.
- `pose.worker.ts` runs MediaPipe Pose Landmarker Lite with `outputSegmentationMasks: false`.
- The API socket layer only handles `connection`; there is no client match flow yet.

## 1. Model pipeline

`export_fighter.py` gains a UV step before export: Smart UV Project on `Body`
(angle limit ~66°, island margin ~0.02), exporting `TEXCOORD_0`. The .blend file is
never modified; the script works on the loaded copy. `fighter.glb` is re-exported and
committed. `public/models/README.md` documents the UV step.

## 2. Capture (`/avatar`)

States: `idle → camera → framing → capturing → baking → review`.

- **camera:** reuse `useCamera`/`useVideoStream` and the existing pose worker.
- **framing:** require VALID landmarks for shoulders, elbows, wrists, hips, knees,
  ankles, nose (full body visible) for ~1 s before **Start** is enabled. Show guidance
  ("step back", "move into frame").
- **capturing:** the worker runs with segmentation masks enabled for this page only
  (a worker init option; the game keeps them off).
  - **Yaw estimate:** from world landmarks, `yaw = atan2(Δz, Δx)` of the
    left→right shoulder vector (hip vector as a secondary signal when shoulders
    are occluded). Front/back is disambiguated by nose/eye visibility; yaw is unwrapped
    over time and assumed to move in one direction once the turn starts.
  - **Slots:** 8 slots at 0°, 45°, …, 315°. A frame qualifies for the nearest slot when
    within ±15° of it. Each slot keeps the best frame by score = mean landmark
    visibility − motion penalty (landmark displacement since the previous frame).
  - Per kept frame: a 640-px-wide `ImageBitmap` of the raw (unmirrored) frame, 2D
    landmarks (normalized), the segmentation mask (downscaled to match), and the yaw.
  - UI: mirrored live preview, a dial showing filled slots and current yaw.
    Completes automatically when all 8 slots are filled; **Finish anyway** appears
    once 6 are filled; **Cancel** returns to framing.
- Raw frames stay in memory on the page and are released after baking.

## 3. Bake (Web Worker)

Output: 1024×1024 texture, encoded as JPEG (quality ~0.85, target ≤150 KB).

**Texel map** (once per model, cached in the worker): rasterize each `Body` triangle
in UV space. For each covered texel, record from barycentric interpolation in the
rest pose:
- dominant bone (largest summed skin weight over the triangle's vertices),
- `t` — projection of the point onto the bone's head→tail segment, clamped 0..1,
- `θ` — angle of the point's perpendicular offset around the bone axis, measured
  from the model's forward (+Z) direction,
- `r` — perpendicular distance divided by the mesh's max radius for that bone at `t`
  (so `r ∈ [0, 1]`).

**Bone → landmark segment** (MediaPipe indices):

| Bones | Segment A → B | Width source |
| --- | --- | --- |
| hips, spine, chest, upper_chest | hip midpoint → shoulder midpoint (`t` remapped across the four bones) | shoulder / hip spread, mask |
| neck, head | shoulder midpoint → nose (extended past the nose to cover the crown) | ear spread, mask |
| shoulder, upper_arm | shoulder → elbow | mask |
| forearm | elbow → wrist | mask |
| hand | wrist → index | mask |
| thigh | hip → knee | mask |
| shin | knee → ankle | mask |
| foot, toe | ankle → foot index | mask |

**Projection** for texel (bone, t, θ, r) in frame k with yaw `ψk`:
`p = lerp(A, B, t) + n̂ · sin(θ + ψk) · r · halfWidth_k(t)`, where `n̂` is the 2D unit
normal of the segment and `halfWidth_k(t)` is measured by scanning the segmentation
mask along `n̂` from the segment centerline (falling back to a fixed ratio of segment
length when the mask scan fails). Samples whose `p` lands outside the mask are rejected.

**Blend:** weight `w = max(0, cos(θ + ψk))²`. Texel color = Σ w·c / Σ w over frames.
Texels with Σ w = 0 are filled by iterative dilation from neighbours (and across UV
seams as far as dilation reaches), then a neutral base color.

## 4. `FighterModel` component

`apps/web/src/avatar/FighterModel.tsx`:
- Loads `fighter.glb` with `useGLTF`, clones per instance with `SkeletonUtils.clone`.
- Props: `skin?: Texture | null` (null → default material), `pose?: 'idle' | 'guard'`,
  `bob?: boolean`.
- Exposes bones for callers that drive them (FirstPersonArms).

Used by:
- **LobbyPage**: replaces the `RobotAvatar` fighter with a small Canvas and the player's skin.
- **AvatarPage**: a large live preview, auto-rotating, drag to spin; it updates when baking finishes.
- **Ring**: both fighters, local skin for the local seat and opponent skin for the other
  seat (default skin when unknown); the existing bob motion is kept.
- **FirstPersonArms**: applies the local skin to the existing model instance.

`RobotAvatar` is removed once there are no usages left.

## 5. Storage and sync

- `apps/web/src/avatar/skinStore.ts`: IndexedDB database `webcamboxer`, store `skin`,
  key `local` → JPEG `Blob`. `useSkin()` returns `{ texture, save, clear }` and updates
  all mounted users via a small event emitter.
- `/avatar` review state: **Save** (persists), **Retake**, **Reset to default**.
- Protocol (`packages/core/src/protocol.ts`): `avatarSkinSchema =
  { jpeg: binary ≤ 256 KB }`; event names `avatar:skin` (client → server) and
  `avatar:opponentSkin` (server → client, `{ seat, jpeg }`).
- Server: keeps the latest skin per seat in room memory only; relays to the other
  seat and replays to a player who joins later. Discarded when the room closes.
  Oversized or invalid payloads are rejected with a recoverable error.
- Client: `net/socket.ts` sends the local skin on room join and on save, and
  `useOpponentSkin()` exposes the decoded texture.

## Error handling

- Camera denied/unavailable: reuse the existing camera error UI; capture is not offered.
- Pose model fails: the existing retryable error state.
- Tracking lost mid-capture: pause the dial ("can't see you"), keep the filled slots.
- Bake failure: show an error with **Retake**; the previous saved skin is unchanged.
- IndexedDB unavailable (private mode): skin works for the session only, with a notice.

## Testing

`node --test` units (matching the existing `*.test.mjs` style), pure modules only:
- yaw estimation and unwrap (synthetic landmarks at known rotations, wraparound),
- slot assignment and best-frame selection,
- projection math (known segment and θ/ψ produce the expected pixel),
- texel-map rasterization on a tiny synthetic mesh,
- protocol schema rejects payloads over 256 KB.

Export check: a Blender headless run asserts `Body` has a UV layer and the GLB
contains `TEXCOORD_0`.

Manual hardware checklist: a full turn in normal lighting, a fast turn, partial
occlusion, baggy clothing, skin appears in lobby/ring/first-person, opponent skin
visible across two browsers.

## Known limitations

- Armpits, inner arms and the soles of the feet are never visible; they come out as
  blended/dilated color.
- Hands and face get few pixels at webcam distance; the face will be low detail.
- Per-bone projection assumes roughly cylindrical limbs; loose clothing smears at edges.

## Out of scope

- Editing or painting the skin by hand, multiple saved skins, server-side persistence,
  face-specific high-res capture, reshaping the mesh to the user's body proportions.
