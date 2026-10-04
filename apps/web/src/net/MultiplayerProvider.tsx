import type { Seat, ServerErrorPayload } from '@wb/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createGameSocket } from './socket';

export interface MatchAssignment {
  roomId: string;
  matchId: string;
  seat: Seat;
}

export interface ActiveInvite {
  inviteId: string;
  code: string;
  expiresAt: number;
}

type LobbyConnectionState = 'CONNECTING' | 'IDLE' | 'SEARCHING' | 'MATCHED' | 'ERROR';

interface MultiplayerContextValue {
  socket: ReturnType<typeof createGameSocket>;
  connectionState: LobbyConnectionState;
  assignment: MatchAssignment | null;
  invite: ActiveInvite | null;
  error: ServerErrorPayload | null;
  createInvite: () => void;
  acceptInvite: (code: string) => void;
  declineInvite: () => void;
  joinRandom: () => void;
  leaveFight: () => void;
  clearError: () => void;
}

const MultiplayerContext = createContext<MultiplayerContextValue | null>(null);

export function MultiplayerProvider({ children }: { children: ReactNode }) {
  const socket = useMemo(() => createGameSocket(), []);
  const [connectionState, setConnectionState] = useState<LobbyConnectionState>('CONNECTING');
  const [assignment, setAssignment] = useState<MatchAssignment | null>(null);
  const [invite, setInvite] = useState<ActiveInvite | null>(null);
  const [error, setError] = useState<ServerErrorPayload | null>(null);

  useEffect(() => {
    const connected = () => setConnectionState('IDLE');
    const disconnected = () => setConnectionState('CONNECTING');
    const matched = (next: MatchAssignment) => {
      setAssignment(next);
      setInvite(null);
      setError(null);
      setConnectionState('MATCHED');
    };
    const created = (next: ActiveInvite) => {
      setInvite(next);
      setError(null);
    };
    const expired = ({ inviteId }: { inviteId: string }) =>
      setInvite((current) => (current?.inviteId === inviteId ? null : current));
    const declined = ({ inviteId }: { inviteId: string }) =>
      setInvite((current) => (current?.inviteId === inviteId ? null : current));
    const failed = (next: ServerErrorPayload) => {
      setError(next);
      if (!next.recoverable) setConnectionState('ERROR');
    };

    socket.on('connect', connected);
    socket.on('disconnect', disconnected);
    socket.on('matchmaking.queued', () => setConnectionState('SEARCHING'));
    socket.on('matchmaking.matched', matched);
    socket.on('invite.created', created);
    socket.on('invite.expired', expired);
    socket.on('invite.declined', declined);
    socket.on('error', failed);
    socket.on('connect_error', () => setConnectionState('ERROR'));
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  const clearError = useCallback(() => setError(null), []);
  const createInvite = useCallback(() => {
    setError(null);
    socket.emit('matchmaking.leave', {});
    socket.emit('invite.create', {});
  }, [socket]);
  const acceptInvite = useCallback(
    (code: string) => {
      setError(null);
      socket.emit('matchmaking.leave', {});
      socket.emit('invite.accept', { code: code.trim().toUpperCase() });
    },
    [socket],
  );
  const declineInvite = useCallback(() => {
    if (!invite) return;
    socket.emit('invite.decline', { inviteId: invite.inviteId });
  }, [invite, socket]);
  const joinRandom = useCallback(() => {
    if (assignment) return;
    setError(null);
    setConnectionState('SEARCHING');
    socket.emit('matchmaking.join', {});
  }, [assignment, socket]);
  const leaveFight = useCallback(() => {
    socket.disconnect();
    setAssignment(null);
    setInvite(null);
    setError(null);
    setConnectionState('CONNECTING');
    socket.connect();
  }, [socket]);

  const value = useMemo(
    () => ({
      socket,
      connectionState,
      assignment,
      invite,
      error,
      createInvite,
      acceptInvite,
      declineInvite,
      joinRandom,
      leaveFight,
      clearError,
    }),
    [
      socket,
      connectionState,
      assignment,
      invite,
      error,
      createInvite,
      acceptInvite,
      declineInvite,
      joinRandom,
      leaveFight,
      clearError,
    ],
  );

  return <MultiplayerContext.Provider value={value}>{children}</MultiplayerContext.Provider>;
}

export function useMultiplayer() {
  const context = useContext(MultiplayerContext);
  if (!context) throw new Error('useMultiplayer must be used within MultiplayerProvider');
  return context;
}
