import type { Express } from 'express';

export function addHealthRoutes(app: Express, isReady: () => boolean) {
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'webcamboxer-api' });
  });

  app.get('/ready', (_request, response) => {
    const ready = isReady();
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
  });
}
