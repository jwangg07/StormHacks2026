import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { env } from './config/env';
import { addHealthRoutes } from './http/health';
import { addSockets } from './net/socket';

const app = express();
app.use(cors({ origin: env.webOrigin }));
app.use(express.json({ limit: '16kb' }));
addHealthRoutes(app);

const server = createServer(app);
addSockets(server, env.webOrigin);

server.listen(env.port, '0.0.0.0', () => {
  console.log(`WebcamBoxer API listening on ${env.port}`);
});
