import type { GameInput, MatchSnapshot, OpponentInputPayload } from '@wb/core';
import type { MotionFrame } from '@wb/motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MotionControls } from '../motion/useMotionControls';
import { recordCompletedMultiplayerMatch } from '../state/fighterStats';
import { useMultiplayer } from './MultiplayerProvider';
import { usePeerPoseTransport } from './usePeerPoseTransport';

export type FightConnectionState =
  | 'CONNECTING'
  | 'SOLO'
  | 'CALIBRATING'
  | 'READY'
  | 'COUNTDOWN'
  | 'FIGHTING'
  | 'PAUSED'
  | 'FINISHED'
  | 'ERROR';

export interface FightImpact {
  attack: { id: string; defenderSeat: 'A' | 'B' };
  outcome: 'HIT' | 'BLOCK';
  damage: number;
}

interface MatchCountdown {
  matchId: string;
  startsAt: number;
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
    dodge: frame.dodge,
    punchAttempt: frame.punch,
    avatarPose: frame.arms,
  };
}

export function useMultiplayerFight(motion: MotionControls) {
  const [matchState, setMatchState] = useState<FightConnectionState | null>(null);
  const { socket, connectionState: lobbyState, assignment } = useMultiplayer();
  const assignmentRef = useRef(assignment);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [countdownStartsAt, setCountdownStartsAt] = useState<number | null>(null);
  const [opponentInput, setOpponentInput] = useState<OpponentInputPayload | null>(null);
  const [lastImpact, setLastImpact] = useState<FightImpact | null>(null);
  const matchId = useRef<string | null>(null);
  const active = useRef(false);
  const sequence = useRef(0);
  const latestOpponentSequence = useRef(-1);
  const lastInputAt = useRef(-Infinity);
  const socketRef = useRef(socket);
  const receiveOpponentInput = useCallback((next: OpponentInputPayload) => {
    if (next.input.matchId !== matchId.current) return;
    if (next.input.sequence <= latestOpponentSequence.current) return;
    latestOpponentSequence.current = next.input.sequence;
    setOpponentInput(next);
  }, []);
  const sendPeerPose = usePeerPoseTransport(socket, assignment, receiveOpponentInput);

  useEffect(() => {
    assignmentRef.current = assignment;
  }, [assignment]);

  useEffect(() => {
    socketRef.current = socket;
    socket.on('match.countdown', (countdown: MatchCountdown) => {
      setCountdownStartsAt(countdown.startsAt);
      setMatchState('COUNTDOWN');
    });
    socket.on('match.started', (initial: MatchSnapshot) => {
      active.current = true;
      setSnapshot(initial);
      setMatchState('FIGHTING');
    });
    socket.on('match.snapshot', (next: MatchSnapshot) => setSnapshot(next));
    socket.on('match.paused', (next: MatchSnapshot) => {
      setSnapshot(next);
      setMatchState('PAUSED');
    });
    socket.on('match.resumed', (next: MatchSnapshot) => {
      setSnapshot(next);
      setMatchState('FIGHTING');
    });
    socket.on('game.opponentInput', receiveOpponentInput);
    socket.on('game.hit', setLastImpact);
    socket.on('game.block', setLastImpact);
    socket.on('match.countdownCancelled', () => {
      setCountdownStartsAt(null);
      setMatchState(null);
    });
    socket.on('match.finished', (finalSnapshot: MatchSnapshot) => {
      active.current = false;
      setSnapshot(finalSnapshot);
      setMatchState('FINISHED');
      recordCompletedMultiplayerMatch(finalSnapshot, assignmentRef.current?.seat);
    });
    return () => {
      socket.off('match.countdown');
      socket.off('match.started');
      socket.off('match.snapshot');
      socket.off('match.paused');
      socket.off('match.resumed');
      socket.off('game.opponentInput', receiveOpponentInput);
      socket.off('game.hit', setLastImpact);
      socket.off('game.block', setLastImpact);
      socket.off('match.countdownCancelled');
      socket.off('match.finished');
      matchId.current = null;
      active.current = false;
    };
  }, [receiveOpponentInput, socket]);

  // Entering the ring without a friend-fight assignment is solo bag work, so no match to join.
  useEffect(() => {
    if (!assignment) return;
    matchId.current = assignment.matchId;
    sequence.current = 0;
    latestOpponentSequence.current = -1;
  }, [assignment]);

  const calibrated = motion.snapshot?.calibration.phase === 'ready';
  const ready = motion.snapshot?.ready === true;
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !assignment) return;
    socket.emit('room.calibrated', { calibrated });
    socket.emit('room.ready', { ready: calibrated && ready });
  }, [assignment, calibrated, ready, socket]);

  const subscribeControls = motion.subscribeControls;
  useEffect(
    () =>
      subscribeControls((frame) => {
        const socket = socketRef.current;
        const currentMatchId = matchId.current;
        if (!socket || !currentMatchId) return;
        if (!frame.punch && frame.timestamp - lastInputAt.current < 1_000 / 30) return;
        lastInputAt.current = frame.timestamp;
        sequence.current += 1;
        const input = inputFromMotion(currentMatchId, sequence.current, frame);
        // Pose animation is presentation data, not combat state. Keep it flowing throughout
        // calibration/countdown and after the round so match lifecycle events cannot freeze it.
        // An RTC data channel can remain "open" while its network path is black-holed.
        // Hedge every disposable pose over Socket.IO; sequence de-duplication means the
        // receiver uses whichever copy arrives first without rendering twice.
        sendPeerPose(input);
        socket.volatile.emit('game.pose', input);
        if (!active.current) return;
        if (frame.punch) socket.emit('game.input', input);
        else socket.volatile.emit('game.input', input);
      }),
    [sendPeerPose, subscribeControls],
  );

  const connectionState: FightConnectionState =
    matchState ??
    (lobbyState === 'ERROR'
      ? 'ERROR'
      : !assignment
        ? 'SOLO'
        : calibrated && ready
          ? 'READY'
          : 'CALIBRATING');
  return {
    connectionState,
    assignment,
    snapshot,
    countdownStartsAt,
    lastImpact,
    opponentInput: opponentInput?.input.matchId === assignment?.matchId ? opponentInput : null,
  };
}
