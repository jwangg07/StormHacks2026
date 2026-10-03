# Local vision assets

All pose assets are served from this directory on the app's origin. Camera frames
never leave the browser. The runtime is copied from the locked
`@mediapipe/tasks-vision` **0.10.35** npm package (Apache-2.0). The ES module runtime
requires SIMD, available in the targeted current desktop Chrome/Edge browsers.

Model: Google's Pose Landmarker Lite, float16, version **1**.
Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
Model documentation/card: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#models

| File                                    | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `pose_landmarker_lite.task`             | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `wasm/vision_wasm_module_internal.js`   | `1f1d6215324a1fe62f6742d49a3db911170987ca18ad8c1b75f1a1c82acf2b44` |
| `wasm/vision_wasm_module_internal.wasm` | `617b8e0248dbd27e9d7ece4218004eae4cefb499196d1bb4fa0e3fef21708756` |

Runtime sources:
https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_module_internal.js
https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm/vision_wasm_module_internal.wasm

Keep these files and the npm library at the same runtime version when updating.
Model and WASM assets are copied into Vite's production output automatically.

## Fighter model

`fighter.glb` is exported from the team's `StormHacks_Base.blend` (Rigify humanoid) by
`tools/blender/export_fighter.py`. The script rebuilds a plain 22-bone deform skeleton
(`hips`, `upper_arm_L`, `forearm_L`, `hand_L`, …), merges Rigify twist segments into their
parent bones, and exports only the `Body` mesh with no materials or animations. Re-run it
after editing the .blend:

```sh
"/mnt/c/Program Files/Blender Foundation/Blender 5.1/blender.exe" -b "<path to StormHacks_Base.blend>" \
  --python "$(wslpath -w tools/blender/export_fighter.py)" -- \
  "$(wslpath -w apps/web/public/models)\\fighter.glb"
```
