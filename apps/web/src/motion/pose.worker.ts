import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { createPoseSample } from '@wb/motion';
import type { WorkerRequest, WorkerResponse } from './messages';

// The web tsconfig also includes DOM globals. Keep the worker boundary explicit.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
  close(): void;
};
let landmarker: PoseLandmarker | null = null;
let initializing = false;
let disposed = false;

function send(message: WorkerResponse) {
  if (!disposed) scope.postMessage(message);
}

async function initialize(modelUrl: string, wasmUrl: string) {
  if (initializing || landmarker || disposed) return;
  initializing = true;
  try {
    send({ type: 'loading', message: 'Loading local pose model…' });
    const response = await fetch(modelUrl);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
      throw new Error('Local pose model is missing. Check public/models and retry tracking.');
    }
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    if (disposed) return;
    send({ type: 'loading', message: 'Starting local vision runtime…' });
    const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
    const next = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    if (disposed) {
      next.close();
      return;
    }
    landmarker = next;
    send({ type: 'ready' });
  } catch (error) {
    send({
      type: 'error',
      message: `Pose model initialization failed. Check local model/WASM assets and WebGL support, then retry. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    initializing = false;
  }
}

scope.onmessage = ({ data }) => {
  if (data.type === 'dispose') {
    disposed = true;
    landmarker?.close();
    landmarker = null;
    scope.close();
  } else if (data.type === 'init') {
    void initialize(data.modelUrl, data.wasmUrl);
  } else {
    const { bitmap, timestamp } = data;
    try {
      if (!landmarker || disposed) throw new Error('Pose worker is not ready. Retry tracking.');
      const started = performance.now();
      const result = landmarker.detectForVideo(bitmap, timestamp);
      const inferenceMs = performance.now() - started;
      send({
        type: 'result',
        sample: createPoseSample(result.landmarks[0] ?? [], timestamp, bitmap.width, bitmap.height),
        inferenceMs,
      });
    } catch (error) {
      send({
        type: 'error',
        message: `Pose inference failed. Retry tracking. ${error instanceof Error ? error.message : ''}`,
      });
    } finally {
      bitmap.close();
    }
  }
};
