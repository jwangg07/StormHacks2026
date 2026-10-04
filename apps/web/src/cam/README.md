# Camera preview (A — Motion)

`CameraPreview` is mounted on `/game`. It requests video only after **Start camera** is clicked. A worker runs local
MediaPipe pose inference once the stream starts. No microphone, recording, or
network transfer of camera data is attached to the stream.

Unmounting it releases every media track. `useCamera()` exposes the stream, status,
message, camera choices, and start/stop methods. Mirror only the video element; the
source stream is unchanged. `/game` and `/practice` share guided calibration and
local action feedback; they do not send gameplay inputs to the server.

Run `npm run dev:web` and open the printed localhost URL in desktop Chrome or
Edge. A remote deployment needs HTTPS; a plain HTTP LAN address cannot capture.

Manual device checks:

1. On load, confirm no permission prompt and no camera indicator.
2. Start and allow permission. Confirm a live mirrored preview and no microphone
   indicator. Camera names should appear after permission.
3. Switch devices, if available. Confirm the old camera releases and the selected
   preview starts. Stop, then restart.
4. Deny permission. Confirm the recovery message and Retry camera button. Allow
   permission in site settings and retry.
5. Cancel while a permission request is pending, then allow the prompt. Confirm
   the late stream is stopped and the preview stays off.
6. Hide the tab, navigate away, or unmount the panel. Confirm the camera indicator
   turns off. Returning to the tab requires an explicit start.
7. Disconnect the active camera or revoke permission. Confirm an actionable error
   and successful retry after restoring access.

8. Confirm the upper-body landmarks align with the mirrored video, including a
   4:3 camera in the 16:9 preview. L/R are anatomical labels. Turning off **Show
   landmarks** must hide only the overlay without restarting model inference.
9. Open developer diagnostics and record measured inference Hz/ms on both demo
   laptops. Confirm VALID with all required points visible. Hide a wrist to get
   LOW_CONFIDENCE; leave the frame to get LOST. The overlay holds the last valid
   pose for at most 200 ms. Input gate pauses after 500 ms of invalid tracking.
10. Restore tracking for one second, then choose **Confirm Ready** after setup. A camera
    stop or hidden tab releases inference resources and requires a fresh start.
11. Block the local model/WASM URLs and retry tracking. Confirm a useful error;
    camera playback must remain available. Restore the files and retry.

12. Step into frame: calibration starts automatically on a VALID pose. Follow the
    large gray instruction overlay and hold neutral for three seconds. Moving or hiding a required landmark resets
    the hold. Perform each prompted action; Ready stays disabled until all four
    are recognized. Confirm Ready and verify local practice counts update once
    per punch and once per defense entry.
13. Hold an extended arm, return it to rest, and punch again. Test rapid alternating
    hands and simultaneous punches; confirm the shared 450 ms cooldown and no
    duplicate attack. Test guard entry/release and attack/defense exclusivity.
14. Duck with head and shoulders together, then try a head nod. A nod must not
    count. Hold a crouch: duck expires after 800 ms and cannot rearm until at least
    400 ms near neutral. Test changed camera distance and low lighting.
15. Record 20 deliberate punches per hand, 10 guards, 10 ducks, and 30 seconds
    idle/guard for each teammate. Targets: >=17/20 punches per hand, >=8/10 each
    defense, <=1 false punch per idle trial. Record environment, misses, duplicates,
    false positives, and sensitivity; sanitized fixtures do not replace this gate.
16. With the arena active, measure inference >=15 Hz, actual arena FPS >=30,
    and action-to-animation p95 <120 ms on both demo laptops. The display-loop
    diagnostic is requestAnimationFrame frequency, not proof of arena FPS.

See `../motion/README.md` for the normalized local control contract. Local Ready
is not server match readiness. Actual device trials remain required.
