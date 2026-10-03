import type { Express } from 'express';

export function addHealthRoutes(app: Express) {
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'webcamboxer-api' });
  });
}
