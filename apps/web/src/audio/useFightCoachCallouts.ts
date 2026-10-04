import { useEffect, useRef } from 'react';
import type { MatchSnapshot, Seat } from '@wb/core';
import type { MatchAssignment } from '../net/MultiplayerProvider';
import { createGameSocket } from '../net/socket';
import type { CoachVoice } from './useCoachVoice';

interface CombatResolution {
  outcome: 'HIT' | 'BLOCK' | 'MISS';
  attack: { attackerSeat: Seat; requestedAt: number };
}

const otherSeat = (seat: Seat): Seat => (seat === 'A' ? 'B' : 'A');

export function useFightCoachCallouts(
  socket: ReturnType<typeof createGameSocket>,
  assignment: MatchAssignment | null,
  snapshot: MatchSnapshot | null,
  fightActive: boolean,
  voice: CoachVoice,
) {
  const alerts = useRef({ matchId: '', half: false, critical: false, finished: false });
  const { cancel, speak } = voice;

  useEffect(() => {
    alerts.current = {
      matchId: assignment?.matchId ?? '',
      half: false,
      critical: false,
      finished: false,
    };
    cancel('fight');
  }, [assignment?.matchId, cancel]);

  useEffect(() => {
    if (!assignment || !fightActive) return;
    let combo = 0;
    let lastCleanHitAt = -Infinity;
    let comboAnnounced = false;
    let lastComboCueAt = -Infinity;
    const onHit = (event: CombatResolution) => {
      if (event.outcome !== 'HIT' || event.attack.attackerSeat !== assignment.seat) return;
      if (event.attack.requestedAt - lastCleanHitAt > 2_500) {
        combo = 0;
        comboAnnounced = false;
      }
      combo++;
      lastCleanHitAt = event.attack.requestedAt;
      if (combo >= 3 && !comboAnnounced && event.attack.requestedAt - lastComboCueAt >= 8_000) {
        comboAnnounced = true;
        lastComboCueAt = event.attack.requestedAt;
        speak('combo', 'fight', 1);
      }
    };
    const onInterruptedCombo = (event: CombatResolution) => {
      if (event.attack.attackerSeat !== assignment.seat) return;
      combo = 0;
      comboAnnounced = false;
      lastCleanHitAt = event.attack.requestedAt;
    };
    socket.on('game.hit', onHit);
    socket.on('game.block', onInterruptedCombo);
    socket.on('game.miss', onInterruptedCombo);
    return () => {
      socket.off('game.hit', onHit);
      socket.off('game.block', onInterruptedCombo);
      socket.off('game.miss', onInterruptedCombo);
    };
  }, [assignment, fightActive, socket, speak]);

  useEffect(() => {
    if (!assignment || !snapshot || snapshot.id !== assignment.matchId) return;
    const state = alerts.current;
    if (state.matchId !== assignment.matchId) return;

    if (snapshot.state === 'FINISHED') {
      if (!state.finished) {
        state.finished = true;
        speak('fightFinished', 'fight', 3);
      }
      return;
    }
    if (snapshot.state !== 'ACTIVE') return;

    const opponentHealth = snapshot.players[otherSeat(assignment.seat)].hp;
    if (opponentHealth <= 25 && !state.critical) {
      state.half = true;
      state.critical = true;
      speak('opponentCritical', 'fight', 3);
    } else if (opponentHealth <= 50 && !state.half) {
      state.half = true;
      speak('opponentBelowHalf', 'fight', 2);
    }
  }, [assignment, snapshot, speak]);
}
