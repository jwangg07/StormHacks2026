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
200 ms become LOST. One second of continuous valid samples clears the gate
automatically once calibration is complete.
`MotionController` starts calibration automatically on the first VALID pose of a
camera session, without a Start calibration click. `/game` presents the initial
calibration guide as a trainer dialog: neutral countdown, left punch, right punch,
guard, and duck. The dialog closes automatically and enables local practice.
The movement setup drawer retains camera controls, sensitivity,
counts, and diagnostics; Recalibrate opens the guided dialog again. Incomplete
tracking asks the player to step into frame and cannot advance setup.
`useMotionControls` combines this with calibration: hold a visible neutral stance
for three uninterrupted seconds, then demonstrate left punch, right punch, guard,
and duck in order. Completion enables local practice controls automatically. Camera
changes discard calibration; tracking loss cancels defense and gesture history,
requires a fresh bent-arm rearm, and resumes automatically after stable tracking.

`MotionController` owns the pure calibration/feature/detector pipeline in
`packages/motion`. Median calibration captures shoulder width, head/torso rest,
arm proportions, and jitter. Features compensate camera scale around the image
center and use shoulder-width units. Baseline position adapts slowly only during
quiet neutral stance after setup; actions never update it. Velocities use actual
sample timestamps. Adaptive pose smoothing damps rest jitter, follows fast arm
motion, filters depth more strongly, and resets across long gaps.

Punch recognition selects a fast attacking limb, then classifies that limb's path.
Wrist and elbow travel are measured relative to the arm's own shoulder. Current speed
must reach 2 shoulder widths/s to start a curved strike. Straight jab/cross attacks
require 3 shoulder widths/s in both the launch window and latest movement sample,
plus at least 0.22 of image travel, 0.16 of corroborated forward depth travel, or
0.24 of combined wrist/elbow travel with foreshortening. A generic curved strike's
confirmation cannot bypass these stricter straight requirements.
Fast outward wrist movement can register without elbow extension or consistent world
angles. Image movement needs at least 0.16 shoulder widths of travel to reject
small fast movements. Hooks need 0.24 travel and a 20-degree arc with a bent arm.
Uppercuts must start below shoulder level and rise at least 0.35, with vertical
travel at least twice lateral travel. An extending diagonal jab stays a straight.
Credible forward depth pushes require at least 0.12 of depth travel plus visible movement or
forearm foreshortening. When world depth is missing, a fast elbow plus a shrinking
forearm projection and some wrist movement can still identify a forward punch.
This corroborated extension may shrink image reach without being treated as recoil.
Depth spikes alone, body sway, retractions, downward block releases, and coordinated
raises into guard are rejected. A clear return toward the strike's launch pose rearms
the hand immediately, including moving recovery in fast combinations. Quiet chest
rest or face-level guard is a fallback after 80 ms; elbow locking is not required.

The current motion speed selects the hand before path confidence breaks ties. Straight
left/right attacks use jab/cross, rising close bent arms use uppercuts, and curved
sweeps use hooks. A 60 ms window from the launch sample lets the path develop before
emitting one label, including short strikes that stop or return to their launch pose
during confirmation. Completed out-and-back strikes retain their observed attack
instead of disappearing during recoil. The launch
point stays fixed as a hook develops; uncertain paths do not default to jabs.
Each hand has a 160 ms cooldown. A fresh opposite-hand strike can
register after a 60 ms gap. Both hands are analyzed during recovery so a brief
opposite-hand attack can survive the gap rather than being dropped.
These attacks retain the canonical game damage, hitboxes, and packet types.

Before normalization, the worker's ArmIdentityTracker compares overlapping wrists
with their recent trajectories and their anatomical elbow chains.
When both hands meet, trajectory extrapolation pauses and elbow attachment helps
resolve their separation, allowing the hands to reverse direction without swapping.
It corrects a wrist-label swap only when the alternate assignment fits clearly better; it never
assigns hands by which side of the image they occupy. Image and world wrists are
corrected together, and identity history resets after invalid tracking or long gaps.
Guard enters after 100 ms and stays latched regardless of elbow-angle noise or punch
cooldown. It exits only after a hand visibly drops below its shoulder for 150 ms, or
tracking is lost. A left or right dodge requires matching shoulder tilt of at least
0.26 and head travel of at least 0.28 shoulder widths for 100 ms. Lower hold thresholds
and a 90 ms exit delay prevent jitter; the first-person camera leans and rolls until
the player re-centers. Right rolls clockwise and left rolls counterclockwise.
Duck needs both head and shoulder
drop, enters after 100 ms, uses a smaller exit threshold, expires at 800 ms, and
requires 400 ms neutral to rearm. Attacks suppress duck and dodge during recovery.

`/game` exposes guided calibration in a dialog, a live camera preview at the bottom left,
and sensitivity, local feedback, counts, and developer diagnostics in the movement setup drawer.
Detected straight left/right punches play jab/cross clips; broad bent swings play hooks,
and outward rising swings play uppercuts. The first-person arms use these scripted clips
from guard rather than continuous pose retargeting. Only the selected arm animates;
the root stays fixed and the opposite arm retains its guard throughout the clip.
Punch clips reach contact at 75 ms and finish at 220 ms. The selected arm reaches
55% farther at contact and restores its original length during recovery.
The nearby bag flashes and displays
a hit marker at the animation's impact time. `latestControls` and `subscribeControls`
expose only normalized `MotionFrame` values; `PracticeAdapter` counts action edges.
The future SocketInputAdapter must forward pause requests and attach the shared
packet envelope. This change does not connect combat or multiplayer inputs; the
server remains responsible for match readiness, pause/resume, and accepted attacks.

Movement diagnostics include per-hand detector status, best recent extension,
image speed, and forward speed, so a missed candidate can be distinguished from
cooldown, lack of rearm, inadequate motion, and tracking loss. These
features and model depth stay local. Normalized feature contract version is 3;
the `MotionFrame` control contract is unchanged.

Target: >=15 inference samples/s on both intended demo laptops, measured alongside
the arena. The panel shows actual completion rate and inference duration, not a
claim that the performance target has passed. Run the device checklist in
`../cam/README.md` before the hour-2 motion gate is considered complete.
