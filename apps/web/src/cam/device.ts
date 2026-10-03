export async function openCamera(deviceId?: string) {
  if (!window.isSecureContext)
    throw new Error('Open the site over HTTPS or localhost to use your camera.');
  if (!navigator.mediaDevices?.getUserMedia)
    throw new Error('Camera access is unavailable. Try desktop Chrome or Edge.');
  const video = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };

  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export function closeCamera(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function listCameras() {
  return (await navigator.mediaDevices.enumerateDevices()).filter(
    (device) => device.kind === 'videoinput',
  );
}

export function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Camera permission was denied. Allow camera access in your browser site settings, then retry.';
      case 'NotFoundError':
        return 'No camera was found. Connect a webcam, then retry.';
      case 'NotReadableError':
      case 'AbortError':
        return 'The camera could not start. Close other apps using it, then retry.';
      case 'OverconstrainedError':
        return 'The selected camera is unavailable. Choose another camera or use the default, then retry.';
    }
  }
  return error instanceof Error
    ? error.message
    : 'Camera access failed. Check your camera and retry.';
}
