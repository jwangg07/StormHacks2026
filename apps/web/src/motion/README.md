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
LOST; a partial pose is LOW_CONFIDENCE. Credible model-estimated world joints are
retained locally for arm direction and elbow geometry; missing, nonfinite, or
implausible world segments use image geometry instead. Depth is an estimate, not
a measured physical distance or punching power.

The hook exposes smoothed `latestSample` and a bounded raw 300 ms history as refs so pose data
does not drive per-frame React renders. Only VALID samples enter history. History
is cleared after long gaps or teardown. DOM diagnostics update at most four times
per second, except tracking state transitions. The canvas overlay runs separately
on the display loop, aligns with object-fit contain, and mirrors display x only.
A safe pose may be held for at most 200 ms; it is never passed off as a new sample.

`TrackingMonitor` exposes `pauseRequired` and `canResume`. Invalid tracking for
500 ms latches a pause; a camera stop pauses immediately. Samples stopping for
200 ms become LOST. One second of continuous valid samples plus explicit
confirmation is required to clear the gate, including initial startup.
`MotionController` starts calibration automatically on the first VALID pose of a
camera session, without a Start calibration click. `CalibrationOverlay` displays
large instructions on a gray card over either view, with neutral countdown, left
punch, right punch, guard, duck, and completion prompts. The overlay disappears
after Confirm Ready; Recalibrate restarts it. Incomplete tracking asks the player
to step into frame and cannot advance setup.
`useMotionControls` combines this with calibration: hold a visible neutral stance
for three uninterrupted seconds, then demonstrate left punch, right punch, guard,
and duck in order. Only **Confirm Ready** enables local practice controls. Camera
changes discard calibration; tracking loss cancels defense and gesture history,
requires a fresh bent-arm rearm, and requires confirmation after recovery.

`MotionController` owns the pure calibration/feature/detector pipeline in
`packages/motion`. Median calibration captures shoulder width, head/torso rest,
arm proportions, and jitter. Features compensate camera scale around the image
center and use shoulder-width units. Baseline position adapts slowly only during
quiet neutral stance after setup; actions never update it. Velocities use actual
sample timestamps. Adaptive pose smoothing damps rest jitter, follows fast arm
motion, filters depth more strongly, and resets across long gaps.

Straight punches require wrist motion and elbow extension within 250 ms. Depth can support
evidence but never trigger an attack alone. Image-plane punches require projected
speed and outward reach. Front-camera punches instead require consistent estimated
3D elbow extension and outward reach, forward travel/speed, and independently
visible forearm foreshortening. There is no mandatory 150-degree elbow lockout.
Image elbow evidence remains continuous across world-landmark dropouts; credible
world angles prevent a retracting foreshortened arm being classified as a punch.
Both calibrated chest rest and a bent face-level guard can rearm a hand.
A fast bent-arm swing can also emit the existing left/right punch action without
elbow opening: at least 35 degrees of shoulder-relative wrist arc, 0.45 shoulder
widths of travel, and 2 shoulder widths/s within 250 ms at default sensitivity.
It requires maintained reach rather than arm retraction. Vertical guard raises
ending near the face and motion back into calibrated rest are rejected. Rearming
starts a fresh per-hand detection window so the return stroke cannot replay an
old candidate. These wider/diagonal gestures use the same canonical game attacks;
they do not introduce separate hook damage, hitboxes, or packet types.
A shared 450 ms cooldown, per-hand
rest rearm, and deterministic strongest/left-tie selection prevent repeat events.
Guard enters after 100 ms and exits after 150 ms. Duck needs both head and shoulder
drop, enters after 100 ms, uses a smaller exit threshold, expires at 800 ms, and
requires 400 ms neutral to rearm. Attacks suppress both defenses during recovery.

Both `/game` and `/practice` expose guided setup, sensitivity, local feedback,
counts, and developer diagnostics. First-person arms consume smoothed estimated
directions and calibrated segment ratios. `latestControls` and `subscribeControls`
expose only normalized `MotionFrame` values; `PracticeAdapter` counts action edges.
The future SocketInputAdapter must forward pause requests and attach the shared
packet envelope. This change does not connect combat or multiplayer inputs; the
server remains responsible for match readiness, pause/resume, and accepted attacks.

Movement diagnostics include per-hand detector status, best recent extension,
image speed, and forward speed, so a missed candidate can be distinguished from
cooldown, lack of rearm, inadequate extension/motion, and tracking loss. These
features and model depth stay local. Normalized feature contract version is 3;
the `MotionFrame` control contract is unchanged.

Target: >=15 inference samples/s on both intended demo laptops, measured alongside
the arena. The panel shows actual completion rate and inference duration, not a
claim that the performance target has passed. Run the device checklist in
`../cam/README.md` before the hour-2 motion gate is considered complete.
