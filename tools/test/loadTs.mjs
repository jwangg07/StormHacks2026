import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundle a TS module and its local imports with the esbuild Vite already ships, then import it. */
export async function loadTs(url) {
  const result = await build({
    entryPoints: [fileURLToPath(url)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  });
  const code = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${code}`);
}
