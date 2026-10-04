import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { MPMask } from '@mediapipe/tasks-vision';
import { AVATAR_SKIN_MAX_BYTES } from '@wb/core';
import type { CaptureRequest, CaptureResponse, CaptureStatus } from './captureMessages';
import { bakeSkin } from './skin/bake';
import { FULL_BODY, frameScore, landmarkMotion, meanVisibility, TORSO, visible } from './skin/framing';
import type { ModelData } from './skin/parts';
import type { CapturedFrame, FrameLandmark } from './skin/project';
import { MIN_SLOTS_TO_FINISH, SLOT_COUNT, SlotBuffer, slotFor } from './skin/slots';
import { buildTexelMap } from './skin/texelMap';
import type { TexelMap } from './skin/texelMap';
import { observeYaw, YawTracker } from './skin/yaw';

// The web tsconfig also includes DOM globals. Keep the worker boundary explicit.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CaptureRequest>) => void) | null;
  postMessage(message: CaptureResponse): void;
  close(): void;
};
const JPEG_QUALITIES = [0.85, 0.72, 0.6, 0.48];

let landmarker: PoseLandmarker | null = null;
let initializing = false;
let disposed = false;
let model: ModelData | null = null;
let textureSize = 1024;
let texelMap: TexelMap | null = null;
let phase: 'framing' | 'capturing' | 'baking' | 'done' = 'framing';
let tracker = new YawTracker();
const slots = new SlotBuffer<CapturedFrame>();
let previous: FrameLandmark[] | null = null;
let snapshotCanvas: OffscreenCanvas | null = null;
let lastStatus: CaptureStatus = { phase: 'framing', fullBody: false, visible: false, yawDeg: null, slots: slots.filled };

function send(message: CaptureResponse) {
  if (!disposed) scope.postMessage(message);
}

async function initialize(modelUrl: string, wasmUrl: string) {
  if (initializing || landmarker || disposed) return;
  initializing = true;
  try {
    send({ type: 'loading', message: 'Loading the body scanner…' });
    const response = await fetch(modelUrl);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html'))
      throw new Error('Local pose model is missing. Check public/models.');
    const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
    if (disposed) return;
    const fileset = await FilesetResolver.forVisionTasks(wasmUrl, true);
    const next = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer, delegate: 'CPU' },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: true,
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
      recoverable: false,
      message: `The body scanner could not start. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    initializing = false;
  }
}

function snapshot(bitmap: ImageBitmap, landmarks: FrameLandmark[], mask: MPMask | undefined, yawDeg: number): CapturedFrame {
  const { width, height } = bitmap;
  if (!snapshotCanvas || snapshotCanvas.width !== width || snapshotCanvas.height !== height)
    snapshotCanvas = new OffscreenCanvas(width, height);
  const context = snapshotCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable in the capture worker.');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  const maskData = mask && mask.width === width && mask.height === height ? mask.getAsFloat32Array().slice() : null;
  return { width, height, pixels, mask: maskData, landmarks, yawDeg };
}

function handleFrame(bitmap: ImageBitmap, timestamp: number) {
  try {
    if (!landmarker || (phase !== 'framing' && phase !== 'capturing')) return;
    const result = landmarker.detectForVideo(bitmap, timestamp);
    try {
      const raw = result.landmarks[0] ?? [];
      const landmarks: FrameLandmark[] = raw.map(({ x, y, visibility }) => ({ x, y, visibility: visibility ?? 0 }));
      const fullBody = visible(landmarks, FULL_BODY);
      const torso = visible(landmarks, TORSO);
      const observation = torso ? observeYaw(raw, result.worldLandmarks[0] ?? [], bitmap.width / bitmap.height) : null;
      let yawDeg: number | null = null;
      if (phase === 'framing') {
        if (fullBody && observation) tracker.calibrate(observation);
      } else if (observation) {
        const turn = tracker.update(observation);
        yawDeg = turn.yawDeg;
        const slot = slotFor(turn.yawDeg);
        const motion = previous ? landmarkMotion(previous, landmarks, FULL_BODY) : 0;
        const score = frameScore(meanVisibility(landmarks, FULL_BODY), motion);
        if (slot !== null && slots.accepts(slot, score))
          slots.put(slot, score, snapshot(bitmap, landmarks, result.segmentationMasks?.[0], turn.yawDeg));
        if (turn.done || slots.count === SLOT_COUNT) queueMicrotask(() => void bake());
      }
      previous = landmarks.length ? landmarks : null;
      lastStatus = { phase, fullBody, visible: torso, yawDeg, slots: slots.filled };
    } finally {
      result.close();
    }
  } catch (error) {
    send({
      type: 'error',
      recoverable: false,
      message: `Body tracking failed. Retry. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    bitmap.close();
    send({ type: 'status', status: lastStatus });
  }
}

async function bake() {
  if (phase !== 'capturing' || !model) return;
  phase = 'baking';
  send({ type: 'baking' });
  try {
    texelMap ??= buildTexelMap(model, textureSize);
    const pixels = bakeSkin(texelMap, slots.values(), tracker.direction);
    const canvas = new OffscreenCanvas(textureSize, textureSize);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable in the capture worker.');
    context.putImageData(new ImageData(pixels, textureSize, textureSize), 0, 0);
    let jpeg: Blob | null = null;
    for (const quality of JPEG_QUALITIES) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= AVATAR_SKIN_MAX_BYTES) {
        jpeg = blob;
        break;
      }
    }
    if (!jpeg) throw new Error('The skin image came out too large. Scan again in even lighting.');
    phase = 'done';
    send({ type: 'baked', jpeg });
  } catch (error) {
    phase = 'framing';
    send({
      type: 'error',
      recoverable: true,
      message: `Painting the skin failed. Scan again. ${error instanceof Error ? error.message : ''}`,
    });
  } finally {
    slots.clear();
  }
}

scope.onmessage = ({ data }) => {
  switch (data.type) {
    case 'init':
      model = data.model;
      textureSize = data.textureSize;
      texelMap = null;
      void initialize(data.modelUrl, data.wasmUrl);
      break;
    case 'frame':
      handleFrame(data.bitmap, data.timestamp);
      break;
    case 'start':
      if (phase !== 'framing') break;
      if (!tracker.start()) {
        send({ type: 'error', recoverable: true, message: 'Hold still with your whole body in view, then start again.' });
        break;
      }
      slots.clear();
      previous = null;
      phase = 'capturing';
      break;
    case 'cancel':
      if (phase === 'baking') break;
      phase = 'framing';
      slots.clear();
      tracker = new YawTracker();
      previous = null;
      break;
    case 'finish':
      if (phase === 'capturing' && slots.count >= MIN_SLOTS_TO_FINISH) void bake();
      break;
    case 'dispose':
      disposed = true;
      landmarker?.close();
      landmarker = null;
      slots.clear();
      scope.close();
      break;
  }
};
