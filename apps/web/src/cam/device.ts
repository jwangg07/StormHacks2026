export async function openCamera(deviceId?: string) {
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
