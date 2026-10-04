export type Hand = 'left' | 'right';
export type TrackingState = 'VALID' | 'LOW_CONFIDENCE' | 'LOST';

export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  timestamp: number;
  width: number;
  height: number;
  landmarks: Record<string, Landmark>;
}

export interface MotionFrame {
  timestamp: number;
  tracking: TrackingState;
  headOffset: { x: number; y: number; z?: number };
  guard: boolean;
  duck: boolean;
  punch?: Hand;
}
