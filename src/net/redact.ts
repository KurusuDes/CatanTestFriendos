// What a guest is allowed to know. The host used to broadcast (almost) the whole GameState, which
// contains the development deck order, the RNG state (=> the next dice / shuffles), every hand,
// other players' dev cards and secret (blindfold) placements. `redactFor` removes all of that for a
// given seat; it is pure and never mutates `state`. The client UI only needs counts for what is
// blanked (hand sizes, dev counts, deck size), see tests/redact.test.ts for the field audit.
import { viewFor } from '@engine/game';
import { RES } from '@engine/constants';
import type { Fx, GameState, Hand, Player, Tile } from '@engine/types';
import { STATIC_KEYS, type WireState } from './messages';

/** Stand-in for a hidden dev card / deck card: same count, no information. */
const BLANK_DEV = 'knight' as const;

function blankHand(total: number): Hand {
  const h = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } as Hand;
  h.wood = total; // only the size is public (`handSize`)
  return h;
}

function redactPlayer(p: Player): Player {
  let total = 0;
  for (const r of RES) total += p.res[r];
  return { ...p, res: blankHand(total), dev: p.dev.map(c => ({ type: BLANK_DEV, turn: c.turn })) };
}

function redactTile(t: Tile): Tile {
  // face-down / fogged tiles: neither kind nor number may leave the host. The desert stays: the robber
  // starts on it, so its position already gives it away.
  if (!t.revealed && t.res !== 'desert') return { ...t, res: 'wood', num: null };
  if (!t.numRevealed && t.num !== null) return { ...t, num: null };
  return t;
}

function redactFx(f: Fx, me: number): Fx {
  switch (f.kind) {
    case 'devBought': return f.pid === me ? f : { ...f, type: BLANK_DEV };
    case 'steal': return f.from === me || f.to === me ? f : { ...f, res: 'wood' };
    case 'build': return f.hidden && f.pid !== me ? { ...f, at: -1 } : f;
    default: return f;
  }
}

/**
 * The state as `seat` may see it (`null`/-1 = spectator: sees nothing private).
 * Fog of war follows `viewFor` (pieces and tiles outside the seat's vision are removed).
 */
export function redactFor(state: GameState, seat: number | null | undefined): GameState {
  const me = seat == null ? -1 : seat;
  const over = state.phase === 'gameOver';
  let s: GameState = state;
  if (state.config.modes.fog && me >= 0 && !over) {
    const { vision, ...v } = viewFor(state, me);
    void vision;
    const { robberHidden, ...board } = v.board;
    void robberHidden;
    s = { ...v, board };
  }
  const discovered = s.discovered && me >= 0 && s.discovered[me] ? { [me]: s.discovered[me]! } : s.discovered ? {} : undefined;
  const hiding = !over;
  const out: GameState = {
    ...s,
    rng: { s: 0 },
    diceDeck: [],
    devDeck: Array.from({ length: s.devDeck.length }, () => BLANK_DEV),
    players: hiding ? s.players.map(p => (p.id === me ? p : redactPlayer(p))) : s.players,
    blind: s.blind.filter(b => b.pid === me),
    board: hiding ? { ...s.board, tiles: s.board.tiles.map(redactTile) } : s.board,
    setup: s.setup.blindActive && s.setup.queue[s.setup.idx]?.pid !== me ? { ...s.setup, lastVid: null } : s.setup,
    fx: s.fx.map(f => redactFx(f, me)),
  };
  if (discovered) out.discovered = discovered;
  else delete out.discovered;
  return out;
}

/** Slim a redacted state for the wire: no config / flags / static board geometry, last 40 log lines, deck as a count. */
export function toWire(s: GameState, withTiles: boolean): WireState {
  const board: Record<string, unknown> = {};
  for (const k of Object.keys(s.board)) {
    if ((STATIC_KEYS as readonly string[]).includes(k) || (k === 'tiles' && !withTiles)) continue;
    board[k] = (s.board as unknown as Record<string, unknown>)[k];
  }
  const { config, devDeck, players, board: _b, ...rest } = s;
  void config;
  void _b;
  return {
    ...rest,
    board: board as WireState['board'],
    log: s.log.slice(-40),
    players: players.map(({ flag, ...p }) => (void flag, p)),
    devDeckN: devDeck.length,
  };
}
