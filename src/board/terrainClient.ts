// Runs terrainGen.generate in a Web Worker (Comlink). If no Worker can be made, or it fails, the same pure
// function runs on the main thread (after a macrotask turn, so the loader can paint first).
import { wrap, type Remote } from 'comlink';
import type { TerrainWorkerApi } from '../workers/terrain.worker';
import { generate, type GenInput, type GenResult } from './terrainGen';

interface Handle { raw: Worker; api: Remote<TerrainWorkerApi>; failed: Promise<never> }
let worker: Handle | null | undefined;
function getWorker(): Handle | null {
  if (worker !== undefined) return worker;
  worker = null;
  try {
    if (typeof Worker !== 'undefined') {
      const raw = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
      // a worker that cannot load (404, blocked) only fires `error`: turn it into a rejection
      const failed = new Promise<never>((_, rej) => raw.addEventListener('error', e => rej(new Error('terrain worker error: ' + (e.message || 'load failed')))));
      failed.catch(() => {});
      worker = { raw, api: wrap<TerrainWorkerApi>(raw), failed };
    }
  } catch {
    worker = null;
  }
  return worker;
}

export async function generateIsland(input: GenInput): Promise<GenResult> {
  const w = getWorker();
  if (w) {
    try {
      return await Promise.race([w.api.generate(input), w.failed]);
    } catch (e) {
      console.warn('terrain worker failed, generating on the main thread', e);
      w.raw.terminate();
      worker = null; // do not try it again
    }
  }
  await new Promise(res => setTimeout(res, 0));
  return generate(input);
}
