// Tiles change only on reveals / chaos / flip, so the host sends them to a guest only when they did.
// Instead of `hashStr(JSON.stringify(tiles))` on every broadcast this keeps a version counter driven
// by a cheap numeric fingerprint (a few dozen integers) that is itself memoised on `state.actions`.
import type { GameState, Tile } from '@engine/types';

const RES_CODE: Record<string, number> = { wood: 1, brick: 2, sheep: 3, wheat: 4, ore: 5, desert: 6, gold: 7 };

export function tilesFingerprint(tiles: readonly Tile[]): number {
  let h = tiles.length | 0;
  for (const t of tiles) {
    const code = (RES_CODE[t.res] ?? 0) | ((t.revealed ? 1 : 0) << 4) | ((t.numRevealed ? 1 : 0) << 5) | (((t.num ?? 0) & 31) << 6);
    h = (Math.imul(h, 31) + code) | 0;
  }
  return h;
}

export class BoardVersion {
  private actions = -1;
  private tiles: readonly Tile[] | null = null;
  private fp = 0;
  version = 0;

  /** Current version of the tile layout; it increases whenever the tiles (as the UI sees them) changed. */
  update(s: GameState): number {
    if (this.tiles === s.board.tiles && this.actions === s.actions) return this.version;
    const fp = tilesFingerprint(s.board.tiles);
    if (this.tiles !== s.board.tiles || fp !== this.fp) this.version++;
    this.tiles = s.board.tiles;
    this.fp = fp;
    this.actions = s.actions;
    return this.version;
  }
}
