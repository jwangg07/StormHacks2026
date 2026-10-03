# Camera preview (A — Motion)

`CameraPreview` is mounted below the landing page arena for the initial camera
spike. It requests video only after **Start camera** is clicked. No microphone,
recording, inference, or network transfer is attached to the stream.

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

Live device checks have not been performed by browser automation. Skeletons,
MediaPipe inference, calibration, and gesture detection are subsequent work.
