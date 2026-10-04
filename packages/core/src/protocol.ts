import { z } from 'zod';

export const protocolVersion = 1;
export const seatSchema = z.enum(['A', 'B']);
export const trackingSchema = z.enum(['VALID', 'LOW_CONFIDENCE', 'LOST']);
export const roomPhaseSchema = z.enum([
  'LOBBY',
  'CALIBRATING',
  'READY',
  'COUNTDOWN',
  'ACTIVE',
  'PAUSED',
  'FINISHED',
  'CLOSED',
]);
export const matchPhaseSchema = z.enum(['COUNTDOWN', 'ACTIVE', 'PAUSED', 'FINISHED']);
const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
export const vector3Schema = z
  .object({ x: finite(-2, 2), y: finite(-2, 2), z: finite(-2, 2) })
  .strict();
const kinematicsSchema = z
  .object({ x: finite(-20, 20), y: finite(-20, 20), z: finite(-20, 20) })
  .strict();
export const handStateSchema = vector3Schema
  .extend({
    velocity: kinematicsSchema.optional(),
    acceleration: kinematicsSchema.optional(),
    angle: finite(-360, 360).optional(),
  })
  .strict();

export const gameInputSchema = z
  .object({
    protocolVersion: z.literal(protocolVersion),
    matchId: z.string().min(1).max(64),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    inputId: z.string().min(1).max(64),
    clientTimestamp: z.number().finite().nonnegative(),
    tracking: trackingSchema,
    head: vector3Schema,
    leftHand: handStateSchema,
    rightHand: handStateSchema,
    body: z.object({ x: finite(-1, 1), y: finite(-1, 1).optional(), z: finite(-1, 1) }).strict(),
    guard: z.boolean(),
    duck: z.boolean(),
    punchAttempt: z.enum(['left', 'right']).optional(),
  })
  .strict();

export const controlSchema = gameInputSchema;
export const readySchema = z.object({ ready: z.boolean().default(true) }).strict();
export const calibratedSchema = z.object({ calibrated: z.boolean() }).strict();
export const trackingUpdateSchema = z.object({ tracking: trackingSchema }).strict();
export const inviteAcceptSchema = z.object({ code: z.string().length(6) }).strict();
export const inviteActionSchema = z.object({ inviteId: z.string().min(1).max(64) }).strict();
export const sessionResumeSchema = z
  .object({ sessionId: z.string().min(1).max(64), reconnectToken: z.string().min(32).max(128) })
  .strict();

export type Seat = z.infer<typeof seatSchema>;
export type TrackingState = z.infer<typeof trackingSchema>;
export type RoomPhase = z.infer<typeof roomPhaseSchema>;
export type MatchPhase = z.infer<typeof matchPhaseSchema>;
export type GameInput = z.infer<typeof gameInputSchema>;
export type ControlInput = GameInput;
export type Hand = 'left' | 'right';
export interface ServerErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}
export interface ScheduledAttack {
  id: string;
  attackerSeat: Seat;
  defenderSeat: Seat;
  hand: Hand;
  requestedAt: number;
  windupEndsAt: number;
  activeEndsAt: number;
  recoveryEndsAt: number;
  resolved: boolean;
}
export interface PlayerMatchStats {
  attempts: number;
  leftAttempts: number;
  rightAttempts: number;
  cleanHits: number;
  blocks: number;
  misses: number;
  damageDealt: number;
  damageReceived: number;
  successfulDucks: number;
  trackingPauseMs: number;
}
export interface FighterState {
  hp: number;
  guard: boolean;
  duck: boolean;
  tracking: TrackingState;
  headOffset: { x: number; y: number; z: number };
  leftHand: { x: number; y: number; z: number };
  rightHand: { x: number; y: number; z: number };
  bodyPosition: { x: number; z: number };
  lastAcceptedSequence: number;
  lastPunchAt: number;
}
export interface MatchResult {
  reason: 'KO' | 'TIMEOUT' | 'ABANDONED';
  winnerSeat?: Seat;
  draw: boolean;
}
export interface MatchState {
  id: string;
  roomId: string;
  state: MatchPhase;
  revision: number;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  remainingTimeMs: number;
  players: Record<Seat, FighterState>;
  attacks: ScheduledAttack[];
  stats: Record<Seat, PlayerMatchStats>;
  result?: MatchResult;
}
export interface MatchSnapshot extends MatchState {
  serverTimestamp: number;
}

/** Largest camera-baked fighter skin (JPEG) a client may share. */
export const AVATAR_SKIN_MAX_BYTES = 256 * 1024;

const isJpeg = (bytes: Uint8Array) =>
  bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
export const avatarSkinSchema = z
  .object({
    jpeg: z.custom<Uint8Array>(
      (value: unknown) =>
        value instanceof Uint8Array && value.byteLength <= AVATAR_SKIN_MAX_BYTES && isJpeg(value),
      'Skin must be a JPEG of at most 256 KB.',
    ),
  })
  .strict();
export type AvatarSkin = z.infer<typeof avatarSkinSchema>;
export interface OpponentSkinPayload {
  seat: Seat;
  jpeg: Uint8Array;
}
