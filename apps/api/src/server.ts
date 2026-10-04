import {
  AsyncPersistenceWriter,
  createPersistence,
  readDatabaseConfig,
  type DatabaseConfig,
  type MatchPersistence,
  type PersistenceLogger,
} from '@wb/database';
import cors from 'cors';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { readApiConfig, type ApiConfig } from './config/env';
import { addHealthRoutes } from './http/health';
import { AuthoritativeMatch, type MatchRuntimeOptions } from './match/state';
import { addSockets } from './net/socket';
import { MatchPersistenceService } from './services/matchPersistence';

export type PersistenceFactory = (
  config: DatabaseConfig,
  logger: PersistenceLogger,
) => Promise<MatchPersistence>;

export interface ApiServerOptions {
  environment?: NodeJS.ProcessEnv;
  logger?: PersistenceLogger;
  persistenceFactory?: PersistenceFactory;
}

export interface ApiServerRuntime {
  readonly config: ApiConfig;
  readonly server: Server;
  readonly matchPersistence: MatchPersistenceService;
  isReady(): boolean;
  createMatch(options: MatchRuntimeOptions): AuthoritativeMatch;
  start(): Promise<number>;
  stop(): Promise<void>;
}

export async function createApiServer(options: ApiServerOptions = {}): Promise<ApiServerRuntime> {
  const environment = options.environment ?? process.env;
  const logger = options.logger ?? console;
  const config = readApiConfig(environment);
  const databaseConfig = readDatabaseConfig(environment);
  const persistence = await (options.persistenceFactory ?? createPersistence)(
    databaseConfig,
    logger,
  );
  const writer = new AsyncPersistenceWriter(persistence, databaseConfig, logger);
  const matchPersistence = new MatchPersistenceService(writer);
  writer.start();

  let ready = true;
  let stopped = false;
  const app = express();
  app.use(cors({ origin: config.webOrigin }));
  app.use(express.json({ limit: '16kb' }));
  addHealthRoutes(app, () => ready);

  const server = createServer(app);
  const createMatch = (matchOptions: MatchRuntimeOptions) =>
    new AuthoritativeMatch(matchOptions, matchPersistence);
  const { io, multiplayer } = addSockets(server, config.webOrigin, createMatch);

  return {
    config,
    server,
    matchPersistence,
    isReady: () => ready,
    createMatch,
    start: () =>
      new Promise<number>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(config.port, '0.0.0.0', () => {
          server.off('error', onError);
          const address = server.address();
          resolve(typeof address === 'object' && address ? address.port : config.port);
        });
      }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      ready = false;
      multiplayer.close();
      if (server.listening) {
        await new Promise<void>((resolve) => io.close(() => resolve()));
      } else {
        io.close();
      }
      await writer.stop();
    },
  };
}
