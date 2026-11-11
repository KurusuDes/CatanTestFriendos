// Builds the static island (terrain field, heightfield mesh, seabed, hex grid, props and grass placements)
// off the main thread. Pure typed arrays in, typed arrays out; every buffer is transferred back (no copy).
import { expose, transfer } from 'comlink';
import { generate, resultBuffers, type GenInput, type GenResult } from '../board/terrainGen';

const api = {
  generate(input: GenInput): GenResult {
    const res = generate(input);
    return transfer(res, resultBuffers(res));
  },
};

export type TerrainWorkerApi = typeof api;
expose(api);
