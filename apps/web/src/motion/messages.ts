import type { PoseSample } from '@wb/motion';

export type WorkerRequest =
  | { type: 'init'; modelUrl: string; wasmUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'dispose' };

export type WorkerResponse =
  | { type: 'loading'; message: string }
  | { type: 'ready' }
  | { type: 'result'; sample: PoseSample; inferenceMs: number }
  | { type: 'error'; message: string };

export interface InferenceResult {
  sample: PoseSample;
  inferenceMs: number;
  receivedAt: number;
  inferenceHz: number;
}
