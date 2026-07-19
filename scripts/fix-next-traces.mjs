import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const projectRoot = process.cwd();
const serverRoot = resolve(projectRoot, '.next/server');
const chunksRoot = join(serverRoot, 'chunks');

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

const [serverFiles, chunkFiles] = await Promise.all([
  filesUnder(serverRoot),
  filesUnder(chunksRoot),
]);
const traceFiles = serverFiles.filter((path) => path.endsWith('.nft.json'));

await Promise.all(traceFiles.map(async (tracePath) => {
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  const fromTrace = dirname(tracePath);
  const requiredChunks = chunkFiles.map((path) => relative(fromTrace, path));
  trace.files = [...new Set([...trace.files, ...requiredChunks])];
  await writeFile(tracePath, `${JSON.stringify(trace)}\n`);
}));

console.log(`[trace-fix] Added ${chunkFiles.length} server chunks to ${traceFiles.length} traces.`);
