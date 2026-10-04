import { z } from 'zod';

const apiConfigSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
});

export interface ApiConfig {
  port: number;
  webOrigin: string;
}

export function readApiConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = apiConfigSchema.parse(source);
  return { port: parsed.PORT, webOrigin: parsed.WEB_ORIGIN };
}
