import type { PoseSample } from '@wb/motion';

const CONNECTIONS = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
] as const;

/** Match object-fit: contain, then mirror display coordinates without swapping anatomical labels. */
export function drawPose(canvas: HTMLCanvasElement, sample: PoseSample | null) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.round(canvas.clientWidth * pixelRatio);
  const height = Math.round(canvas.clientHeight * pixelRatio);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  if (!sample) return;
  const scale = Math.min(width / sample.frame.width, height / sample.frame.height);
  const displayWidth = sample.frame.width * scale;
  const displayHeight = sample.frame.height * scale;
  const offsetX = (width - displayWidth) / 2;
  const offsetY = (height - displayHeight) / 2;
  const points = sample.frame.landmarks;
  const x = (name: string) => offsetX + (1 - points[name].x) * displayWidth;
  const y = (name: string) => offsetY + points[name].y * displayHeight;
  context.lineWidth = 3 * pixelRatio;
  context.strokeStyle = '#f5c76d';
  for (const [from, to] of CONNECTIONS) {
    if (!points[from] || !points[to]) continue;
    context.beginPath();
    context.moveTo(x(from), y(from));
    context.lineTo(x(to), y(to));
    context.stroke();
  }
  for (const name of Object.keys(points)) {
    context.beginPath();
    context.arc(x(name), y(name), 5 * pixelRatio, 0, Math.PI * 2);
    context.fillStyle = name.startsWith('left') ? '#72bfff' : '#ffab70';
    context.fill();
    context.strokeStyle = '#101722';
    context.lineWidth = pixelRatio;
    context.stroke();
  }
  context.font = `bold ${14 * pixelRatio}px sans-serif`;
  context.fillStyle = '#ffffff';
  for (const [name, label] of [
    ['leftWrist', 'L'],
    ['rightWrist', 'R'],
  ]) {
    if (points[name]) context.fillText(label, x(name) + 9 * pixelRatio, y(name) - 9 * pixelRatio);
  }
}
