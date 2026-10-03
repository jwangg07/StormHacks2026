# Local pose pipeline (A — Motion)

`usePoseLandmarker(videoRef, canvasRef, stream, showOverlay)` starts inference only
for an explicitly acquired camera stream. `pose.worker.ts` owns the MediaPipe
task: CPU delegate, VIDEO mode, one person, no segmentation. It loads the versioned
local lite model and ES module WASM runtime under `public/models`. Vite's base URL
is included in all asset paths, including deployments below a subpath.

`InferenceClient` captures at most 30 frames/s, downscales to at most 640 pixels
wide while preserving aspect ratio, and transfers an `ImageBitmap` to the worker.
Only one capture/inference is in flight; frames arriving while busy are dropped.
Duplicate video frames are skipped. Every bitmap is closed after processing or
cancellation. Loading and frame watchdogs surface stalled workers as retryable
errors. Stop, camera switch, hidden tab, or unmount disposes the task and worker.
Pose initialization/inference failure keeps camera playback usable.

Worker results contain camera-relative normalized image landmarks and timestamp,
image dimensions, filtered aspect-corrected landmarks, validity, missing required
points, and minimum required-landmark visibility. Anatomical labels are preserved.
Use aspect-corrected points before computing distances/angles; y increases down.
Optional hips are retained only when visible. Nose, shoulders, elbows, and wrists
must each meet 0.6 visibility and be inside the image for VALID. An absent pose is
LOST; a partial pose is LOW_CONFIDENCE. This does not provide calibration or
shoulder-width normalization yet.

The hook exposes `latestSample` and a bounded 300 ms history as refs so pose data
does not drive per-frame React renders. Only VALID samples enter history. History
is cleared after long gaps or teardown. DOM diagnostics update at most four times
per second, except tracking state transitions. The canvas overlay runs separately
on the display loop, aligns with object-fit contain, and mirrors display x only.
A safe pose may be held for at most 200 ms; it is never passed off as a new sample.

`TrackingMonitor` exposes `pauseRequired` and `canResume`. Invalid tracking for
500 ms latches a pause; a camera stop pauses immediately. Samples stopping for
200 ms become LOST. One second of continuous valid samples plus explicit
`confirmTracking()` is required to clear the gate, including initial startup.
The future SocketInputAdapter must forward pause requests to the server. This
spike has no gameplay/socket adapter and emits no attacks. The server remains
responsible for shared match state, readiness, and pause/resume.

Target: >=15 inference samples/s on both intended demo laptops, measured alongside
the arena. The panel shows actual completion rate and inference duration, not a
claim that the performance target has passed. Run the device checklist in
`../cam/README.md` before the hour-2 motion gate is considered complete.
