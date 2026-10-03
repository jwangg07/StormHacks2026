import type { InferenceResult, WorkerRequest, WorkerResponse } from './messages';

interface InferenceCallbacks {
  onLoading(message: string): void;
  onReady(): void;
  onResult(result: InferenceResult): void;
  onError(message: string): void;
}

/** Owns a single frame from bitmap capture through worker completion. No pending queue. */
export class InferenceClient {
  private readonly worker: Worker;
  private ready = false;
  private busy = false;
  private disposed = false;
  private lastVideoTime = -1;
  private lastCaptureAt = -Infinity;
  private completions: number[] = [];
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly callbacks: InferenceCallbacks) {
    this.worker = new Worker(new URL('./pose.worker.ts', import.meta.url), {
      type: 'module',
      name: 'wb-pose',
    });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (this.disposed) return;
      if (data.type === 'loading') callbacks.onLoading(data.message);
      else if (data.type === 'ready') {
        clearTimeout(this.timeout);
        this.ready = true;
        callbacks.onReady();
      } else if (data.type === 'result') {
        clearTimeout(this.timeout);
        this.busy = false;
        const now = performance.now();
        this.completions.push(now);
        this.completions = this.completions.filter((time) => now - time <= 1000);
        const elapsed = now - this.completions[0];
        callbacks.onResult({
          sample: data.sample,
          inferenceMs: data.inferenceMs,
          receivedAt: now,
          inferenceHz: elapsed > 0 ? ((this.completions.length - 1) * 1000) / elapsed : 0,
        });
      } else this.fail(data.message);
    };
    this.worker.onerror = () =>
      this.fail(
        'Pose worker could not run. Check browser worker/WebGL support and local assets, then retry.',
      );
    this.worker.onmessageerror = () =>
      this.fail('Pose worker communication failed. Retry tracking.');
    const assets = new URL(`${import.meta.env.BASE_URL}models/`, window.location.origin);
    this.send({
      type: 'init',
      modelUrl: new URL('pose_landmarker_lite.task', assets).href,
      wasmUrl: new URL('wasm', assets).href,
    });
    this.timeout = setTimeout(
      () => this.fail('Pose model loading timed out. Check local assets and retry tracking.'),
      45000,
    );
  }

  private send(message: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  capture(video: HTMLVideoElement): boolean {
    const timestamp = performance.now();
    if (
      !this.ready ||
      this.busy ||
      this.disposed ||
      video.readyState < 2 ||
      !video.videoWidth ||
      video.currentTime === this.lastVideoTime ||
      timestamp - this.lastCaptureAt < 1000 / 30
    )
      return false;
    this.busy = true;
    this.lastVideoTime = video.currentTime;
    this.lastCaptureAt = timestamp;
    const resizeWidth = Math.min(640, video.videoWidth);
    const resizeHeight = Math.max(
      1,
      Math.round((video.videoHeight * resizeWidth) / video.videoWidth),
    );
    this.timeout = setTimeout(() => this.fail('Pose inference stalled. Retry tracking.'), 5000);
    void createImageBitmap(video, { resizeWidth, resizeHeight })
      .then((bitmap) => {
        if (this.disposed) {
          bitmap.close();
          return;
        }
        try {
          this.send({ type: 'frame', bitmap, timestamp }, [bitmap]);
        } catch {
          bitmap.close();
          this.fail('Camera frame transfer failed. Retry tracking.');
        }
      })
      .catch(() =>
        this.fail('Camera frame capture failed. Restart the camera and retry tracking.'),
      );
    return true;
  }

  private fail(message: string) {
    if (this.disposed) return;
    this.dispose();
    this.callbacks.onError(message);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    clearTimeout(this.timeout);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    // Allow the worker to close its task; force termination if initialization/inference is stuck.
    this.send({ type: 'dispose' });
    setTimeout(() => this.worker.terminate(), 100);
  }
}
