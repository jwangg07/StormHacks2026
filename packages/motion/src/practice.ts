import type { MotionFrame } from './types';

export class PracticeAdapter {
  private lastTimestamp = -Infinity;
  private guard = false;
  private duck = false;
  private counts = { leftPunches: 0, rightPunches: 0, guards: 0, ducks: 0 };
  consume(frame: MotionFrame) {
    if (frame.timestamp <= this.lastTimestamp) return;
    this.lastTimestamp = frame.timestamp;
    if (frame.tracking === 'VALID') {
      if (frame.punch === 'left') this.counts.leftPunches++;
      if (frame.punch === 'right') this.counts.rightPunches++;
      if (frame.guard && !this.guard) this.counts.guards++;
      if (frame.duck && !this.duck) this.counts.ducks++;
    }
    this.guard = frame.guard;
    this.duck = frame.duck;
  }
  snapshot() {
    return { ...this.counts };
  }
}
