import type { ModelData } from './skin/parts';

export interface CaptureStatus {
  phase: 'framing' | 'capturing';
  /** Head to ankles visible: required before capture starts. */
  fullBody: boolean;
  /** Shoulders and hips visible: required for capture to progress. */
  visible: boolean;
  yawDeg: number | null;
  slots: boolean[];
}

export type CaptureRequest =
  | { type: 'init'; modelUrl: string; wasmUrl: string; model: ModelData; textureSize: number }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'start' }
  | { type: 'cancel' }
  | { type: 'finish' }
  | { type: 'dispose' };

export type CaptureResponse =
  | { type: 'loading'; message: string }
  | { type: 'ready' }
  | { type: 'status'; status: CaptureStatus }
  | { type: 'baking' }
  | { type: 'baked'; jpeg: Blob }
  | { type: 'error'; message: string; recoverable: boolean };
