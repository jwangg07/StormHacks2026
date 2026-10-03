import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraErrorMessage, closeCamera, listCameras, openCamera } from './device';

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'stopped' | 'error';

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [message, setMessage] = useState('Start your camera when you are ready.');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const activeStream = useRef<MediaStream | null>(null);
  const request = useRef(0);

  const release = useCallback(() => {
    request.current += 1;
    if (activeStream.current) closeCamera(activeStream.current);
    activeStream.current = null;
  }, []);

  const stop = useCallback(
    (reason = 'Camera stopped. Start it again when you are ready.') => {
      release();
      setStream(null);
      setStatus('stopped');
      setMessage(reason);
    },
    [release],
  );

  const fail = useCallback(
    (reason: string) => {
      release();
      setStream(null);
      setStatus('error');
      setMessage(reason);
    },
    [release],
  );

  const start = useCallback(
    async (selectedDeviceId = deviceId) => {
      release();
      const currentRequest = request.current;
      setStream(null);
      setDeviceId(selectedDeviceId);
      setStatus('requesting');
      setMessage('Waiting for camera access. Allow the browser permission request.');
      try {
        const nextStream = await openCamera(selectedDeviceId || undefined);
        // Permission can resolve after Stop, a newer request, or unmount.
        if (request.current !== currentRequest) {
          closeCamera(nextStream);
          return;
        }
        activeStream.current = nextStream;
        const track = nextStream.getVideoTracks()[0];
        track.addEventListener(
          'ended',
          () => {
            if (activeStream.current === nextStream)
              fail('Camera disconnected or access was revoked. Check the camera, then retry.');
          },
          { once: true },
        );
        setStream(nextStream);
        setDeviceId(track.getSettings().deviceId ?? selectedDeviceId);
        setStatus('active');
        setMessage('Camera on. Keep your head, shoulders, elbows, and wrists visible.');
        // Device enumeration failure should not stop a working preview.
        const cameras = await listCameras().catch(() => null);
        if (request.current === currentRequest && cameras) setDevices(cameras);
      } catch (error) {
        if (request.current === currentRequest) fail(cameraErrorMessage(error));
      }
    },
    [deviceId, fail, release],
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden)
        stop('Camera stopped while the tab was hidden. Start it again to continue.');
    };
    const onPageHide = () => stop();
    const onDeviceChange = async () => {
      const currentRequest = request.current;
      const cameras = await listCameras().catch(() => null);
      if (request.current === currentRequest && cameras) setDevices(cameras);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
      release();
    };
  }, [release, stop]);

  return { stream, status, message, devices, deviceId, setDeviceId, start, stop, fail };
}
