# Camera preview (A — Motion)

`CameraPreview` is mounted below the landing page arena for the initial camera
spike. It requests video only after **Start camera** is clicked. A worker runs local
MediaPipe pose inference once the stream starts. No microphone, recording, or
network transfer of camera data is attached to the stream.

Frontend handoff: mount `<CameraPreview />` on the future setup screen. Unmounting
it releases every media track. `useCamera()` exposes the stream, status, message,
camera choices, and start/stop methods for later preview or inference integration.
Mirror only the video element; the source stream is unchanged.

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
10. Restore tracking for one second, then choose **Confirm tracking**. A camera
    stop or hidden tab releases inference resources and requires a fresh start.
11. Block the local model/WASM URLs and retry tracking. Confirm a useful error;
    camera playback must remain available. Restore the files and retry.

See `../motion/README.md` for the local inference contract. Calibration and action
detectors are subsequent work; current tracking readiness is not match readiness.
