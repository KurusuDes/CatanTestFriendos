// Grass and wheat tuft placement: pure, returns the instance lists. Runs in the terrain worker.
import { INR, NORMALS, pixelToHex, prng, type GenTile } from './terrainBase';
import type { TerrainField } from './terrainGen';

type GrassLists = Record<string, [number, number, number, number, number][]>;

export function computeGrass(field: TerrainField, tiles: GenTile[], dens: number): GrassLists {
  const lists: GrassLists = { grass: [], wheat: [] };
  if (dens <= 0) return lists; // weak machines: no tufts at all
  const kinds: Record<string, [string, number]> = { sheep: ['grass', Math.round(320 * dens)], wheat: ['wheat', Math.round(420 * dens)], wood: ['grass', Math.round(60 * dens)], ore: ['grass', Math.round(50 * dens)], gold: ['grass', Math.round(20 * dens)] };
  for (const t of tiles) {
    const spec = t.revealed && kinds[t.res];
    if (!spec) continue;
    const rnd = prng(t.id * 1543 + 17);
    const look = field.lookOf(t);
    // the woodcutter's clearing and the oak grove are grassier
    const count = t.res === 'wood' && (look === 2 || look === 3) ? spec[1] * 4 : spec[1];
    for (let i = 0; i < count; i++) {
      const x = t.x + (rnd() - 0.5) * 1.8, z = t.y + (rnd() - 0.5) * 1.8;
      const [q, r] = pixelToHex(x, z);
      if (q !== t.q || r !== t.r) continue;
      const dx = x - t.x, dz = z - t.y;
      const e = INR - Math.max(...NORMALS.map(n => Math.abs(dx * n[0] + dz * n[1])));
      if (e < 0.09) continue; // keep roads and corners clear
      if (field.nearClay(t, x, z)) continue;
      if (t.res === 'ore' && field.sample(x, z) > 0.55) continue;
      lists[spec[0]]!.push([x, field.sample(x, z), z, 0.7 + rnd() * 0.7, rnd() * 6.3]);
    }
  }
  return lists;
}
