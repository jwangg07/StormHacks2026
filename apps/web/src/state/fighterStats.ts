import type { MatchSnapshot, Seat } from '@wb/core';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'webcam-boxer.fighter-stats.v2';
const LEGACY_STORAGE_KEY = 'webcam-boxer.fighter-stats.v1';
const RECENT_MATCH_LIMIT = 500;

export interface SoloStats {
  totalPunches: number;
  bestRoundPunches: number;
  completedRounds: number;
  bestCombo: number;
  guardReps: number;
  duckReps: number;
}

export interface MultiplayerStats {
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  cleanHits: number;
  attempts: number;
  blocks: number;
  bestWinMs: number | null;
  recentMatchIds: string[];
}

export interface FighterStats {
  solo: SoloStats;
  multiplayer: MultiplayerStats;
}

const EMPTY_STATS: FighterStats = {
  solo: {
    totalPunches: 0,
    bestRoundPunches: 0,
    completedRounds: 0,
    bestCombo: 0,
    guardReps: 0,
    duckReps: 0,
  },
  multiplayer: {
    wins: 0,
    losses: 0,
    draws: 0,
    matches: 0,
    cleanHits: 0,
    attempts: 0,
    blocks: 0,
    bestWinMs: null,
    recentMatchIds: [],
  },
};

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

function readStats(): FighterStats {
  if (typeof window === 'undefined') return EMPTY_STATS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) return EMPTY_STATS;
      const legacy: unknown = JSON.parse(legacyRaw);
      if (!legacy || typeof legacy !== 'object') return EMPTY_STATS;
      const old = legacy as {
        wins?: unknown;
        losses?: unknown;
        draws?: unknown;
        cleanHits?: unknown;
        attempts?: unknown;
        bestRoundMs?: unknown;
        recentMatchIds?: unknown;
      };
      const wins = count(old.wins);
      const losses = count(old.losses);
      const draws = count(old.draws);
      return {
        solo: EMPTY_STATS.solo,
        multiplayer: {
          wins,
          losses,
          draws,
          matches: wins + losses + draws,
          cleanHits: count(old.cleanHits),
          attempts: count(old.attempts),
          // The old counter credited blocked punches to the attacker, so it cannot be
          // safely reused as the player's own successful blocks.
          blocks: 0,
          bestWinMs:
            typeof old.bestRoundMs === 'number' && Number.isFinite(old.bestRoundMs) && old.bestRoundMs > 0
              ? old.bestRoundMs
              : null,
          recentMatchIds: Array.isArray(old.recentMatchIds)
            ? old.recentMatchIds
                .filter((id): id is string => typeof id === 'string')
                .slice(-RECENT_MATCH_LIMIT)
            : [],
        },
      };
    }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return EMPTY_STATS;
    const stored = value as Partial<FighterStats>;
    const solo = stored.solo ?? EMPTY_STATS.solo;
    const multiplayer = stored.multiplayer ?? EMPTY_STATS.multiplayer;
    return {
      solo: {
        totalPunches: count(solo.totalPunches),
        bestRoundPunches: count(solo.bestRoundPunches),
        completedRounds: count(solo.completedRounds),
        bestCombo: count(solo.bestCombo),
        guardReps: count(solo.guardReps),
        duckReps: count(solo.duckReps),
      },
      multiplayer: {
        wins: count(multiplayer.wins),
        losses: count(multiplayer.losses),
        draws: count(multiplayer.draws),
        matches: count(multiplayer.matches),
        cleanHits: count(multiplayer.cleanHits),
        attempts: count(multiplayer.attempts),
        blocks: count(multiplayer.blocks),
        bestWinMs:
          typeof multiplayer.bestWinMs === 'number' &&
          Number.isFinite(multiplayer.bestWinMs) &&
          multiplayer.bestWinMs > 0
            ? multiplayer.bestWinMs
            : null,
        recentMatchIds: Array.isArray(multiplayer.recentMatchIds)
          ? multiplayer.recentMatchIds
              .filter((id): id is string => typeof id === 'string')
              .slice(-RECENT_MATCH_LIMIT)
          : [],
      },
    };
  } catch {
    return EMPTY_STATS;
  }
}

let currentStats = readStats();
const listeners = new Set<() => void>();

function publish(next: FighterStats) {
  currentStats = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep this session usable if browser storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY) return;
  currentStats = readStats();
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFighterStats() {
  return useSyncExternalStore(subscribe, () => currentStats, () => EMPTY_STATS);
}

export function recordSoloPunch(combo: number) {
  publish({
    ...currentStats,
    solo: {
      ...currentStats.solo,
      totalPunches: currentStats.solo.totalPunches + 1,
      bestCombo: Math.max(currentStats.solo.bestCombo, combo),
    },
  });
}

export function recordSoloDefenseAction(action: 'guard' | 'duck') {
  const field = action === 'guard' ? 'guardReps' : 'duckReps';
  publish({
    ...currentStats,
    solo: { ...currentStats.solo, [field]: currentStats.solo[field] + 1 },
  });
}

export function recordCompletedSoloRound(punches: number) {
  publish({
    ...currentStats,
    solo: {
      ...currentStats.solo,
      completedRounds: currentStats.solo.completedRounds + 1,
      bestRoundPunches: Math.max(currentStats.solo.bestRoundPunches, punches),
    },
  });
}

/** Add a server-finalized multiplayer bout once, using the local player's seat. */
export function recordCompletedMultiplayerMatch(snapshot: MatchSnapshot, seat: Seat | undefined) {
  if (!seat || snapshot.state !== 'FINISHED' || !snapshot.result) return;
  if (snapshot.result.reason === 'ABANDONED') return;
  if (currentStats.multiplayer.recentMatchIds.includes(snapshot.id)) return;

  const player = snapshot.stats[seat];
  const won = snapshot.result.winnerSeat === seat;
  const drawn = snapshot.result.draw;
  const roundMs =
    snapshot.startedAt !== undefined && snapshot.finishedAt !== undefined
      ? Math.max(0, snapshot.finishedAt - snapshot.startedAt)
      : null;
  const multiplayer = currentStats.multiplayer;

  publish({
    ...currentStats,
    multiplayer: {
      ...multiplayer,
      wins: multiplayer.wins + (won ? 1 : 0),
      losses: multiplayer.losses + (!won && !drawn ? 1 : 0),
      draws: multiplayer.draws + (drawn ? 1 : 0),
      matches: multiplayer.matches + 1,
      cleanHits: multiplayer.cleanHits + player.cleanHits,
      attempts: multiplayer.attempts + player.attempts,
      blocks: multiplayer.blocks + player.blocks,
      bestWinMs:
        won && roundMs !== null
          ? multiplayer.bestWinMs === null
            ? roundMs
            : Math.min(multiplayer.bestWinMs, roundMs)
          : multiplayer.bestWinMs,
      recentMatchIds: [...multiplayer.recentMatchIds, snapshot.id].slice(-RECENT_MATCH_LIMIT),
    },
  });
}
