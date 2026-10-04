import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import ts from 'typescript';

const urls = new Map();
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  for (const match of [...outputText.matchAll(/from ['"]\.\/(\w+)['"]/g)]) {
    outputText = outputText.replace(match[0], `from ${JSON.stringify(await moduleUrl(match[1]))}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  urls.set(name, url);
  return url;
}
export const loadMotion = async (name) => import(await moduleUrl(name));
