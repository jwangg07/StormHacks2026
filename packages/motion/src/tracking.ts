import { TRACKING_PAUSE_MS, TRACKING_RESUME_MS, VISUAL_HOLD_MS } from './pose';
import type { TrackingState } from './types';

export interface TrackingStatus {
  tracking: TrackingState;
  pauseRequired: boolean;
  canResume: boolean;
}

/** Local tracking gate. A multiplayer adapter must forward pauseRequired to the server. */
export class TrackingMonitor {
  private tracking: TrackingState = 'LOST';
  private lastSampleAt = -Infinity;
  private invalidSince: number | null = null;
  private validSince: number | null = null;
  private paused = true;

  observe(tracking: TrackingState, now: number): TrackingStatus {
    this.refresh(now);
    this.lastSampleAt = now;
    this.tracking = tracking;
    if (tracking === 'VALID') {
      this.validSince ??= now;
      this.invalidSince = null;
    } else {
      this.validSince = null;
      this.invalidSince ??= now;
    }
    return this.refresh(now);
  }

  refresh(now: number): TrackingStatus {
    if (now - this.lastSampleAt > VISUAL_HOLD_MS) {
      this.tracking = 'LOST';
      this.validSince = null;
      this.invalidSince ??= Number.isFinite(this.lastSampleAt)
        ? this.lastSampleAt + VISUAL_HOLD_MS
        : now;
    }
    if (this.invalidSince !== null && now - this.invalidSince >= TRACKING_PAUSE_MS)
      this.paused = true;
    return {
      tracking: this.tracking,
      pauseRequired: this.paused,
      canResume:
        this.paused &&
        this.tracking === 'VALID' &&
        this.validSince !== null &&
        now - this.validSince >= TRACKING_RESUME_MS,
    };
  }

  confirmResume(now: number): boolean {
    if (!this.refresh(now).canResume) return false;
    this.paused = false;
    return true;
  }

  stop(now: number): TrackingStatus {
    this.tracking = 'LOST';
    this.lastSampleAt = -Infinity;
    this.validSince = null;
    this.invalidSince = now;
    this.paused = true;
    return this.refresh(now);
  }
}
