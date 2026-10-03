import { z } from 'zod';

export const protocolVersion = 1;
export const seatSchema = z.enum(['A', 'B']);
export const matchPhaseSchema = z.enum([
  'LOBBY',
  'CALIBRATING',
  'READY',
  'COUNTDOWN',
  'ACTIVE',
  'PAUSED',
  'FINISHED',
  'CLOSED',
]);

export const controlSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  matchId: z.string().min(1).max(64),
  sequence: z.number().int().nonnegative(),
  inputId: z.string().max(64).optional(),
  tracking: z.enum(['VALID', 'LOW_CONFIDENCE', 'LOST']),
  guard: z.boolean(),
  duck: z.boolean(),
  headOffset: z.object({
    x: z.number().finite().min(-1).max(1),
    y: z.number().finite().min(-1).max(1),
  }),
  punch: z.enum(['left', 'right']).optional(),
});

export type Seat = z.infer<typeof seatSchema>;
export type MatchPhase = z.infer<typeof matchPhaseSchema>;
export type ControlInput = z.infer<typeof controlSchema>;
