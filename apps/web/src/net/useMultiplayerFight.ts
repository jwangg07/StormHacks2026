import type { GameInput, MatchSnapshot, Seat } from '@wb/core';
import type { MotionFrame } from '@wb/motion';
import { useEffect, useRef, useState } from 'react';
import type { MotionControls } from '../motion/useMotionControls';
import { createGameSocket } from './socket';

export type FightConnectionState =
  | 'CONNECTING'
  | 'SEARCHING'
  | 'CALIBRATING'
  | 'READY'
  | 'COUNTDOWN'
  | 'FIGHTING'
  | 'FINISHED'
  | 'ERROR';

interface MatchAssignment {
  roomId: string;
  matchId: string;
  seat: Seat;
}

function inputFromMotion(matchId: string, sequence: number, frame: MotionFrame): GameInput {
  const clamp = (value: number) => Math.max(-2, Math.min(2, value));
  const head = {
    x: clamp(frame.headOffset.x),
    y: clamp(frame.headOffset.y),
    z: clamp(frame.headOffset.z ?? 0),
  };
  return {
    protocolVersion: 1,
    matchId,
    sequence,
    inputId: crypto.randomUUID(),
    clientTimestamp: Date.now(),
    tracking: frame.tracking,
    head,
    // P0 motion output does not expose hand coordinates yet. Keeping gloves at
    // the canonical head-relative origin supports deterministic hit/guard rules.
    leftHand: { x: 0, y: 0, z: 0 },
    rightHand: { x: 0, y: 0, z: 0 },
    body: { x: 0, z: 0 },
    guard: frame.guard,
    duck: frame.duck,
    punchAttempt: frame.punch,
  };
}

export function useMultiplayerFight(motion: MotionControls) {
  const [connectionState, setConnectionState] = useState<FightConnectionState>('CONNECTING');
  const [assignment, setAssignment] = useState<MatchAssignment | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const matchId = useRef<string | null>(null);
  const active = useRef(false);
  const sequence = useRef(0);
  const lastInputAt = useRef(-Infinity);
  const socketRef = useRef<ReturnType<typeof createGameSocket> | null>(null);

  useEffect(() => {
    const socket = createGameSocket();
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnectionState('SEARCHING');
      socket.emit('matchmaking.join', {});
    });
    socket.on('matchmaking.matched', (matched: MatchAssignment) => {
      matchId.current = matched.matchId;
      sequence.current = 0;
      setAssignment(matched);
      setConnectionState('CALIBRATING');
    });
    socket.on('match.countdown', () => setConnectionState('COUNTDOWN'));
    socket.on('match.started', (initial: MatchSnapshot) => {
      active.current = true;
      setSnapshot(initial);
      setConnectionState('FIGHTING');
    });
    socket.on('match.snapshot', (next: MatchSnapshot) => setSnapshot(next));
    socket.on('match.finished', (finalSnapshot: MatchSnapshot) => {
      active.current = false;
      setSnapshot(finalSnapshot);
      setConnectionState('FINISHED');
    });
    socket.on('connect_error', () => setConnectionState('ERROR'));
    socket.connect();
    return () => {
      socket.emit('matchmaking.leave', {});
      socket.disconnect();
      socketRef.current = null;
      matchId.current = null;
      active.current = false;
    };
  }, []);

  const calibrated = motion.snapshot?.calibration.phase === 'ready';
  const ready = motion.snapshot?.ready === true;
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !assignment || !calibrated) return;
    socket.emit('room.calibrated', { calibrated: true });
    if (!ready) return;
    socket.emit('room.ready', { ready: true });
    setConnectionState('READY');
  }, [assignment, calibrated, ready]);

  useEffect(
    () =>
      motion.subscribeControls((frame) => {
        const socket = socketRef.current;
        const currentMatchId = matchId.current;
        if (!socket || !currentMatchId || !active.current) return;
        if (!frame.punch && frame.timestamp - lastInputAt.current < 1_000 / 30) return;
        lastInputAt.current = frame.timestamp;
        sequence.current += 1;
        socket.emit('game.input', inputFromMotion(currentMatchId, sequence.current, frame));
      }),
    [motion.subscribeControls],
  );

  return { connectionState, assignment, snapshot };
}
