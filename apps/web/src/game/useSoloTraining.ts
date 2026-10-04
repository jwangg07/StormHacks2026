import { useEffect, useState } from 'react';
import type { MotionControls } from '../motion/useMotionControls';
import {
  recordCompletedSoloRound,
  recordSoloDefenseAction,
  recordSoloPunch,
} from '../state/fighterStats';

export const SOLO_ROUND_MS = 60_000;
const COMBO_GAP_MS = 2_000;

interface WorkoutView {
  round: number;
  punches: number;
  secondsLeft: number;
  started: boolean;
}

const idleWorkout: WorkoutView = {
  round: 1,
  punches: 0,
  secondsLeft: SOLO_ROUND_MS / 1_000,
  started: false,
};

/** Tracks bag-work actions and completed 60-second rounds, independently of multiplayer. */
export function useSoloTraining(motion: MotionControls, enabled: boolean) {
  const [workout, setWorkout] = useState(idleWorkout);
  const { subscribeControls } = motion;

  useEffect(() => {
    if (!enabled) return;

    let roundStartedAt: number | null = null;
    let lastFrameAt = -Infinity;
    let lastPunchAt = -Infinity;
    let roundPunches = 0;
    let roundNumber = 1;
    let combo = 0;
    let wasGuarding = false;
    let wasDucking = false;

    const completeElapsedRounds = (now: number) => {
      if (roundStartedAt === null) return;
      while (now - roundStartedAt >= SOLO_ROUND_MS) {
        recordCompletedSoloRound(roundPunches);
        roundPunches = 0;
        combo = 0;
        lastPunchAt = -Infinity;
        roundNumber++;
        roundStartedAt += SOLO_ROUND_MS;
      }
    };

    const updateClock = (now: number) => {
      completeElapsedRounds(now);
      const elapsed = roundStartedAt === null ? 0 : now - roundStartedAt;
      setWorkout({
        round: roundNumber,
        punches: roundPunches,
        secondsLeft: Math.max(0, Math.ceil((SOLO_ROUND_MS - elapsed) / 1_000)),
        started: roundStartedAt !== null,
      });
    };

    setWorkout(idleWorkout);
    const timer = window.setInterval(() => updateClock(performance.now()), 200);
    const unsubscribe = subscribeControls((frame) => {
      if (frame.timestamp <= lastFrameAt) return;
      lastFrameAt = frame.timestamp;
      completeElapsedRounds(frame.timestamp);

      const valid = frame.tracking === 'VALID';
      if (valid && frame.punch) {
        if (roundStartedAt === null) roundStartedAt = frame.timestamp;
        combo = frame.timestamp - lastPunchAt <= COMBO_GAP_MS ? combo + 1 : 1;
        lastPunchAt = frame.timestamp;
        roundPunches++;
        recordSoloPunch(combo);
        const elapsed = frame.timestamp - roundStartedAt;
        setWorkout({
          round: roundNumber,
          punches: roundPunches,
          secondsLeft: Math.max(0, Math.ceil((SOLO_ROUND_MS - elapsed) / 1_000)),
          started: true,
        });
      } else if (!valid || frame.timestamp - lastPunchAt > COMBO_GAP_MS) {
        combo = 0;
      }

      if (valid && frame.guard && !wasGuarding) recordSoloDefenseAction('guard');
      if (valid && frame.duck && !wasDucking) recordSoloDefenseAction('duck');
      wasGuarding = valid && frame.guard;
      wasDucking = valid && frame.duck;
    });

    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [enabled, subscribeControls]);

  return workout;
}
