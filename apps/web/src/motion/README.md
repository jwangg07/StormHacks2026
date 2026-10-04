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
Optional hips are retained only when visible. Nose and shoulders must meet 0.5
visibility and be inside the image for VALID. Elbows and wrists use 0.35 visibility;
a missing wrist disables only that hand. Hooks and uppercuts need a wrist but can
work without its elbow. Calibration still requires both elbows and wrists for the
baseline. An absent pose is LOST; missing head/shoulders are LOW_CONFIDENCE.
Credible model-estimated world joints are
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
and guard. The dialog closes automatically and enables local practice.
The movement setup drawer retains camera controls, sensitivity,
counts, and diagnostics; Recalibrate opens the guided dialog again. Incomplete
tracking asks the player to step into frame and cannot advance setup.
`useMotionControls` combines this with calibration: hold a visible neutral stance
with elbows bent and fists near the chest until the progress bar fills (at least
one second and 30 valid samples). Small movements are tolerated; larger movements
or invalid tracking restart the hold. Then demonstrate left punch, right punch,
and guard in order. Completion enables local practice controls automatically. Camera
changes discard calibration; tracking loss cancels defense and gesture history,
and resumes automatically after stable tracking. Reappearing wrists establish a
fresh anchor, so a held pose cannot invent a punch on tracking recovery.

`MotionController` owns the pure calibration/feature/detector pipeline in
`packages/motion`. Median calibration captures shoulder width, head/torso rest,
arm proportions, and jitter. Features compensate camera scale around the image
center and use shoulder-width units. Baseline position adapts slowly only during
quiet neutral stance after setup; actions never update it. Velocities use actual
sample timestamps. Adaptive pose smoothing damps rest jitter, follows fast arm
motion, filters depth more strongly, and resets across long gaps.

Punch recognition uses one movement burst per hand. Wrist and elbow travel are
measured relative to that arm's shoulder in shoulder-width units, so ordinary body
sway and camera scale do not create attacks. Wrist-led bursts start at 1.25 shoulder
widths/s; elbow/depth-led bursts start at 1.0 to capture compact camera-facing jabs.
Jab/cross average speed must reach 1.0, while hooks/uppercuts still require 1.25. Sensitivity
scales speed and travel thresholds together. Hand smoothing uses a 12 ms time
constant for image coordinates and 40 ms for estimated depth.

Classification checks visible directions before straight-punch evidence:

- Uppercut: upward wrist travel of at least 0.45 shoulder widths, exceeding
  lateral travel by 1.25 times. Smaller vertical rises keep accumulating instead
  of falling back to a jab. This works from chest or raised stances.
- Hook: inward lateral wrist travel of at least 0.18 shoulder widths, with
  horizontal travel at least 0.9 times vertical travel. Anatomical shoulder order
  determines inward direction; preview mirroring never reverses it.
- Horizontal hook: a bent-arm wrist sweep in either direction of at least 0.18
  shoulder widths, with horizontal travel at least 1.25 times vertical travel.
  Clear outward extensions with a straight arm still identify jabs/crosses.
- Jab/cross: an elbow rising toward wrist height from chest or comfortable guard
  (up to 0.35 shoulder widths above the shoulder). This accepts 0.12 of elbow travel,
  a gap closing by more than 0.1, and a final gap within 0.3; exact alignment is not
  required. Clear outward extensions need 0.18 of wrist travel. Corroborated forward
  movement can use 0.12 of depth or a moving elbow with forearm foreshortening, even
  if the wrist barely moves in the image. Estimated depth alone cannot start a strike.
  Small straight-looking outward wind-ups from a raised stance remain unclassified
  so they can develop into hooks.

Clear movement emits immediately, without a confirmation timer. Each hand emits
once per burst and tracks its follow-through using the joint that started it. A
return halfway toward the launch position consumes recoil; the next outward
movement or a brief quiet recovery rearms it. A 150 ms pause also allows a new
movement from the current pose without requiring an exact calibrated rest position.
Unclassified wind-ups can reverse into a new path. Held positions, small fidgets,
slow deliberate movement, downward releases, and coordinated guard raises do not
attack. Each hand has a 180 ms cooldown; opposite-hand attacks can follow after
40 ms. When both hands qualify together, movement speed selects the hand.

Before normalization, the worker's ArmIdentityTracker compares overlapping wrists
with their recent trajectories and their anatomical elbow chains.
When both hands meet, trajectory extrapolation pauses and elbow attachment helps
resolve their separation, allowing the hands to reverse direction without swapping.
It corrects a wrist-label swap only when the alternate assignment fits clearly better; it never
assigns hands by which side of the image they occupy. Image and world wrists are
corrected together, and identity history resets after invalid tracking or long gaps.
Guard enters immediately with both fists at upper chest height or higher (up to
0.2 shoulder widths below each shoulder), within 1.1 shoulder widths of body center.
There is no face-distance or elbow-angle requirement. It tolerates small movements
and stays latched during raised-arm punches. It exits after a wrist drops at least
0.3 shoulder widths below its shoulder for 80 ms, or immediately if a wrist is lost.
A left or right dodge requires matching shoulder tilt of at least
0.26 and head travel of at least 0.28 shoulder widths for 100 ms. Lower hold thresholds
and a 90 ms exit delay prevent jitter; the first-person camera leans and rolls until
the player re-centers. Right rolls clockwise and left rolls counterclockwise.
Duck needs both head and shoulder
drop, enters after 100 ms, uses a smaller exit threshold, expires at 800 ms, and
requires 400 ms neutral to rearm. Attacks suppress duck during recovery; left and right
dodges can continue while punching.
In multiplayer, dodge direction is sent with controls and mirrored on the opponent
model. An opponent dodging left moves to your right and avoids your left punch;
an opponent dodging right moves to your left and avoids your right punch. The other
hand still uses the usual hit and block rules. Dodge is checked at server impact time.

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

Movement diagnostics include per-hand detector status, burst speed, wrist speed,
and wrist visibility, so a missed candidate can be distinguished from
cooldown, lack of rearm, inadequate motion, and tracking loss. These
features and model depth stay local. Normalized feature contract version is 3;
the `MotionFrame` control contract is unchanged.

Target: >=15 inference samples/s on both intended demo laptops, measured alongside
the arena. The panel shows actual completion rate and inference duration, not a
claim that the performance target has passed. Run the device checklist in
`../cam/README.md` before the hour-2 motion gate is considered complete.
