import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Attach a camera stream to a video element and detach it on change or unmount. */
export function useVideoStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  fail: (reason: string) => void,
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    let cancelled = false;
    video.srcObject = stream;
    void video.play().catch(() => {
      if (!cancelled) fail('Camera playback failed. Retry to restart the preview.');
    });
    return () => {
      cancelled = true;
      video.pause();
      video.srcObject = null;
    };
  }, [videoRef, stream, fail]);
}
