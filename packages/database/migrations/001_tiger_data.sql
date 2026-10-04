CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  player_a_session_id TEXT,
  player_b_session_id TEXT,
  winner_seat TEXT CHECK (winner_seat IS NULL OR winner_seat IN ('A', 'B', 'DRAW')),
  final_hp_a INTEGER CHECK (final_hp_a IS NULL OR final_hp_a BETWEEN 0 AND 100),
  final_hp_b INTEGER CHECK (final_hp_b IS NULL OR final_hp_b BETWEEN 0 AND 100),
  match_type TEXT NOT NULL,
  config_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS combat_events (
  time TIMESTAMPTZ NOT NULL,
  event_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  attacker_seat TEXT CHECK (attacker_seat IS NULL OR attacker_seat IN ('A', 'B')),
  defender_seat TEXT CHECK (defender_seat IS NULL OR defender_seat IN ('A', 'B')),
  hand TEXT CHECK (hand IS NULL OR hand IN ('left', 'right')),
  event_type TEXT NOT NULL,
  outcome TEXT,
  damage INTEGER CHECK (damage IS NULL OR damage >= 0),
  simulation_tick BIGINT,
  metadata JSONB,
  PRIMARY KEY (time, event_id)
);

SELECT create_hypertable('combat_events', by_range('time'), if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS combat_events_match_time_idx ON combat_events (match_id, time DESC);

CREATE TABLE IF NOT EXISTS movement_data (
  time TIMESTAMPTZ NOT NULL,
  match_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seat TEXT NOT NULL CHECK (seat IN ('A', 'B')),
  sequence BIGINT NOT NULL,
  head_x DOUBLE PRECISION,
  head_y DOUBLE PRECISION,
  head_z DOUBLE PRECISION,
  left_hand_x DOUBLE PRECISION,
  left_hand_y DOUBLE PRECISION,
  left_hand_z DOUBLE PRECISION,
  right_hand_x DOUBLE PRECISION,
  right_hand_y DOUBLE PRECISION,
  right_hand_z DOUBLE PRECISION,
  body_x DOUBLE PRECISION,
  body_z DOUBLE PRECISION,
  left_velocity DOUBLE PRECISION,
  right_velocity DOUBLE PRECISION,
  tracking_confidence DOUBLE PRECISION,
  guard BOOLEAN,
  duck BOOLEAN,
  PRIMARY KEY (time, match_id, session_id, sequence)
);

SELECT create_hypertable('movement_data', by_range('time'), if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS movement_data_match_time_idx ON movement_data (match_id, time DESC);
