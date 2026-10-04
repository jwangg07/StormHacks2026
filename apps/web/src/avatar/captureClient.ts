import type { CaptureRequest, CaptureResponse, CaptureStatus } from './captureMessages';
import type { ModelData } from './skin/parts';

export const SKIN_TEXTURE_SIZE = 1024;
const FRAME_WIDTH = 640;

export interface CaptureCallbacks {
  onLoading(message: string): void;
  onReady(): void;
  onStatus(status: CaptureStatus): void;
  onBaking(): void;
  onBaked(jpeg: Blob): void;
  onError(message: string, recoverable: boolean): void;
}

/** Feeds camera frames to the capture worker one at a time. Kept frames and the bake stay in the worker. */
export class CaptureClient {
  private readonly worker: Worker;
  private ready = false;
  private busy = false;
  private paused = false;
  private disposed = false;
  private lastVideoTime = -1;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    model: ModelData,
    private readonly callbacks: CaptureCallbacks,
  ) {
    this.worker = new Worker(new URL('./capture.worker.ts', import.meta.url), {
      type: 'module',
      name: 'wb-skin-capture',
    });
    this.worker.onmessage = ({ data }: MessageEvent<CaptureResponse>) => {
      if (this.disposed) return;
      switch (data.type) {
        case 'loading':
          callbacks.onLoading(data.message);
          break;
        case 'ready':
          clearTimeout(this.timeout);
          this.ready = true;
          callbacks.onReady();
          break;
        case 'status':
          this.busy = false;
          callbacks.onStatus(data.status);
          break;
        case 'baking':
          // No frames are needed until the player cancels or retakes.
          this.paused = true;
          callbacks.onBaking();
          break;
        case 'baked':
          callbacks.onBaked(data.jpeg);
          break;
        case 'error':
          if (!data.recoverable) this.fail(data.message);
          else {
            this.paused = false;
            callbacks.onError(data.message, true);
          }
          break;
      }
    };
    this.worker.onerror = () =>
      this.fail('The body scanner could not run. Use desktop Chrome or Edge, then retry.');
    const assets = new URL(`${import.meta.env.BASE_URL}models/`, window.location.origin);
    this.post({
      type: 'init',
      modelUrl: new URL('pose_landmarker_lite.task', assets).href,
      wasmUrl: new URL('wasm', assets).href,
      model,
      textureSize: SKIN_TEXTURE_SIZE,
    });
    this.timeout = setTimeout(() => this.fail('The body scanner timed out while loading. Retry.'), 45000);
  }

  pump(video: HTMLVideoElement) {
    if (
      !this.ready ||
      this.busy ||
      this.paused ||
      this.disposed ||
      video.readyState < 2 ||
      !video.videoWidth ||
      video.currentTime === this.lastVideoTime
    )
      return;
    this.busy = true;
    this.lastVideoTime = video.currentTime;
    const resizeWidth = Math.min(FRAME_WIDTH, video.videoWidth);
    const resizeHeight = Math.max(1, Math.round((video.videoHeight * resizeWidth) / video.videoWidth));
    void createImageBitmap(video, { resizeWidth, resizeHeight })
      .then((bitmap) => {
        if (this.disposed) {
          bitmap.close();
          return;
        }
        this.post({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
      })
      .catch(() => {
        this.busy = false;
      });
  }

  start() {
    this.paused = false;
    this.post({ type: 'start' });
  }

  cancel() {
    this.paused = false;
    this.post({ type: 'cancel' });
  }

  finish() {
    this.post({ type: 'finish' });
  }

  private post(message: CaptureRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  private fail(message: string) {
    if (this.disposed) return;
    this.dispose();
    this.callbacks.onError(message, false);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timeout);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.post({ type: 'dispose' });
    setTimeout(() => this.worker.terminate(), 100);
  }
}
