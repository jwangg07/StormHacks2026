import { createApiServer } from './server';

const runtime = await createApiServer();
const port = await runtime.start();
console.log(`WebcamBoxer API listening on ${port}`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`WebcamBoxer API received ${signal}; shutting down`);
  try {
    await runtime.stop();
    process.exitCode = 0;
  } catch {
    console.error('WebcamBoxer API shutdown failed');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
