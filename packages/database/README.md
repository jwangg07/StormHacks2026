# `@wb/database`

Server-only Tiger Cloud persistence for WebcamBoxer. The package does not belong in a browser bundle and database writes are intentionally kept outside the combat loop.

## Tiger Cloud setup

1. Create a Tiger Cloud service and copy its PostgreSQL connection string.
2. Paste that string into this package's ignored `.env` file as `DATABASE_URL`, including `sslmode=require`. Never commit this file.
3. Keep `ENABLE_TIGER_DATA=true`. Set `DATABASE_REQUIRED=true` only in an environment that must fail startup when persistence is unavailable.
4. Install this package's dependencies with `npm install --workspaces=false` from this directory.
5. Apply the schema with `npm run migrate --workspaces=false`.

The migration creates `matches`, `combat_events`, and `movement_data`. The two time-series tables are Tiger/Timescale hypertables and use time-inclusive primary keys compatible with hypertable uniqueness rules.

## API integration

At server startup, call `readDatabaseConfig()`, then `createPersistence(config)`. Construct `AsyncPersistenceWriter` with the returned persistence adapter and call `start()`. Combat code should only enqueue records; it must not await PostgreSQL.

Use `MovementSampler` before enqueueing optional movement samples to keep approximately 5 Hz per player. Call `clearMatch()` after a match is retired.

On shutdown, await `writer.stop()`. If Tiger Cloud is disabled or unavailable, `createPersistence` returns `NoopPersistence` unless persistence was explicitly marked required. Connection errors are sanitized and never include `DATABASE_URL`.

## Commands

```text
npm run typecheck --workspaces=false
npm test --workspaces=false
npm run build --workspaces=false
npm run migrate --workspaces=false
```
