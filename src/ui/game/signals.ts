// Reactive state of the in-game screen. Everything here is derived from the app store (`state` + `rev`
// + `viewer` + `meta`) or is UI-local (typed signals instead of the old ad-hoc `ui` object).
//
// Rules of the road:
//  * the engine mutates `state` in place, so every computed that depends on the game reads `rev` first
//    (a computed returning the same object would otherwise never notify);
//  * heavy per-state work (`viewFor`, pending actors, legal moves) lives in ONE computed each and is
//    shared by every component;
//  * components subscribe through `select()`: a computed that hands back its previous value while the new
//    one is equal, so a bot move only re-renders the components whose slice really changed.
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import * as G from '@engine/game';
import { COSTS, EVENTS, TILE_INFO } from '@engine/constants';
import type { BuildKind, GameState, GameView, Hand } from '@engine/types';
import type { Interaction } from '@board/types';
import type { BoardRenderer } from '@board/BoardRenderer';
import type { Board3D } from '@board/Board3D';
import { App, store } from '@app/index';

const { state, rev, viewer } = store;

// ---------- render counting (test / perf hook) ----------
export const renders: Record<string, number> = {};
export const countRender = (name: string): void => {
  renders[name] = (renders[name] || 0) + 1;
};

// ---------- select(): narrow subscriptions ----------
function shallowEq<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
export const jsonEq = <T,>(a: T, b: T): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** a computed that keeps returning the previous value while `eq(prev, next)` */
export function select<T>(fn: () => T, eq: (a: T, b: T) => boolean = shallowEq): ReadonlySignal<T> {
  let prev: T | undefined;
  let has = false;
  return computed(() => {
    const next = fn();
    if (has && eq(prev as T, next)) return prev as T;
    has = true;
    prev = next;
    return next;
  });
}

/** the live game, tracked by `rev`: call inside computed / component bodies */
export const cur = (): GameState | null => {
  void rev.value;
  return state.value;
};

// ---------- UI-local signals ----------
type ModalSpec =
  | { kind: 'trade' }
  | { kind: 'menu' }
  | { kind: 'gameOver' }
  | { kind: 'victims'; tile: number; v: number; victims: number[] }
  | { kind: 'monopoly'; v: number }
  | { kind: 'yop'; v: number };

export const modal = signal<ModalSpec | null>(null);
/** the build button armed on the toolbar (road / settlement / city), picked on the board next */
export const pick = signal<BuildKind | null>(null);
/** hot-seat: whose turn the privacy screen was unlocked for */
export const unlockedFor = signal<number | null>(null);
/** bumped when presence / vote / reconnect state of the online table changes */
export const metaTick = signal(0);
/** the 3D dice play their roll animation (the topbar dice shake) on each new throw; 0 = none yet */
export const diceAnim = signal(0);
export const topView = signal(false);

interface Gain { id: number; pid: number; text: string }
export const gains = signal<Gain[]>([]);
interface Announcement { id: number; icon: string; title: string; desc: string }
export const announces = signal<Announcement[]>([]);
export const confettiOn = signal(0);
/** forces the board to render again (icon set / graphics changed) */
export const boardNudge = signal(0);

// ---------- boards ----------
export const boards: { any: BoardRenderer | null; d3: Board3D | null } = { any: null, d3: null };
export const boardSig = signal<BoardRenderer | null>(null);

// ---------- viewer & privacy ----------
export function localHumans(st: GameState): number[] {
  if (App.isOnline()) return App.mySeat != null ? [App.mySeat] : [];
  return st.players.filter(p => p.kind === 'human').map(p => p.id);
}

function computeViewer(st: GameState, prev: number, actors: number[]): number {
  if (App.isOnline()) return App.mySeat ?? -1;
  const humans = localHumans(st);
  if (!humans.length) return -1;
  const mine = actors.filter(p => humans.includes(p));
  if (st.phase === 'discard' && mine.length) return mine.includes(prev) ? prev : mine[0]!;
  if (mine.includes(st.current)) return st.current;
  if (st.phase === 'setup' && mine.length) return mine[0]!;
  if (humans.includes(prev)) return prev;
  return humans[0]!;
}

function privacyOn(st: GameState): boolean {
  if (App.isOnline() || localHumans(st).length < 2) return false;
  const mode = st.config.modes.privacy || 'auto';
  if (mode === 'off') return false;
  if (mode === 'on') return st.phase !== 'gameOver';
  // each player has their own vision in the fog, so always hide the screen between humans
  if (st.config.modes.fog) return st.phase !== 'gameOver';
  return st.phase === 'setup' && st.setup.blindActive;
}

/** seats that may act right now (computed once per state) */
export const actors = computed<number[]>(() => {
  const st = cur();
  return st ? G.pendingActors(st) : [];
});

/** whose eyes the screen renders with (an `effect` in the controller mirrors it into `store.viewer`) */
export const seat = computed<number>(() => {
  const st = cur();
  return st ? computeViewer(st, viewer.peek(), actors.value) : -1;
});

export const locked = computed<boolean>(() => {
  const st = cur();
  if (!st) return false;
  const v = seat.value;
  return privacyOn(st) && v >= 0 && unlockedFor.value !== v;
});

/** what this seat may see (fog filter): one `viewFor` per state, shared by the board, the toolbar... */
export const gv = computed<GameView | null>(() => {
  const st = cur();
  return st ? G.viewFor(st, seat.value) : null;
});

const legal = (fn: (s: GameState, v: number) => number[]) =>
  computed<number[]>(() => {
    void rev.value;
    const g = gv.value, v = seat.value;
    return g && v >= 0 ? fn(g, v) : [];
  });
export const legalRoads = legal(G.legalRoads);
export const legalSettlements = legal(G.legalSettlements);
export const legalCities = legal(G.legalCities);

// ---------- board interaction ----------
function robberPick(v: number, tile: number): void {
  const st = state.peek();
  if (!st) return;
  const victims = G.stealTargets(G.viewFor(st, v), v, tile);
  if (victims.length <= 1) {
    App.dispatch({ type: 'moveRobber', pid: v, tile, victim: victims[0] });
    return;
  }
  modal.value = { kind: 'victims', tile, v, victims };
}

export const inter = computed<Interaction | null>(() => {
  const st = cur();
  const v = seat.value;
  const g = gv.value;
  if (!st || !g || v < 0 || locked.value) return null;
  const color = g.players[v]!.color;
  const mk = (kind: string, list: number[], onPick: (id: number) => void): Interaction => ({ kind, legal: new Set(list), onPick, color });
  if (st.phase === 'setup') {
    if (actors.value[0] !== v) return null;
    if (st.setup.step === 'settlement') return mk('settlement', G.legalSetupSettlements(g, v), vid => App.dispatch({ type: 'placeSettlement', pid: v, vid }));
    return mk('road', G.legalSetupRoads(g, v), eid => App.dispatch({ type: 'placeRoad', pid: v, eid }));
  }
  if (st.current !== v) return null;
  if (st.phase === 'robber') return mk('robber', G.legalRobberTiles(g, v), tile => robberPick(v, tile));
  if (st.phase === 'roadBuilding') return mk('road', legalRoads.value, at => App.dispatch({ type: 'build', pid: v, what: 'road', at }));
  const what = pick.value;
  if (st.phase === 'main' && what) {
    const list = what === 'road' ? legalRoads.value : what === 'settlement' ? legalSettlements.value : legalCities.value;
    return mk(what, list, at => {
      if (App.dispatch({ type: 'build', pid: v, what, at })) {
        const p = state.peek()!.players[v]!;
        if (!G.canAfford(p.res, COSTS[what])) pick.value = null;
      }
    });
  }
  return null;
});

// ---------- texts ----------
export const PHASE_TEXT: Record<string, string> = {
  setup: 'Đặt nhà đầu ván', roll: 'Tung xúc xắc', main: 'Xây dựng và giao dịch', discard: 'Bỏ thẻ',
  robber: 'Di chuyển kẻ trộm', roadBuilding: 'Xây đường miễn phí', gameOver: 'Kết thúc ván',
};
export const costIcons = (c: Partial<Record<string, number>>): string =>
  Object.entries(c).map(([r, n]) => TILE_INFO[r as keyof typeof TILE_INFO].icon.repeat(n || 0)).join('');

function bannerText(st: GameState, v: number, interKind: string | undefined): string {
  const cur = st.players[st.current]!;
  if (st.phase === 'gameOver') return `🏆 ${st.players[st.winner!]!.name} thắng!`;
  if (st.phase === 'setup') {
    const who = st.players[G.pendingActors(st)[0]!]!;
    const blind = st.setup.blindActive ? '🙈 Bí mật: ' : st.setup.fixing ? '💥 Dời nhà: ' : '';
    if (who.id !== v) return `${blind}${who.name} đang đặt nhà...`;
    return `${blind}${st.setup.step === 'settlement' ? (st.config.rules.setupCity && st.setup.queue[st.setup.idx]!.round === st.setup.lastRound ? 'Đặt thành phố của bạn' : 'Đặt nhà của bạn') : 'Đặt đường của bạn'}`;
  }
  if (st.phase === 'discard') {
    const n = Object.keys(st.pendingDiscards).length;
    return `🗑️ Ra 7! Đang bỏ thẻ (còn ${n} người)`;
  }
  if (st.current !== v) return st.trade ? `🤝 ${cur.name} mời giao dịch` : `Lượt của ${cur.name}`;
  if (st.phase === 'robber') return '🦹 Chọn chỗ đặt kẻ trộm';
  if (st.phase === 'roadBuilding') return `🛤️ Đặt ${st.freeRoads} đoạn đường miễn phí`;
  if (st.phase === 'roll') return '🎲 Tới lượt bạn! Tung xúc xắc đi';
  if (interKind) return ({ road: 'Chọn chỗ làm đường (Esc để hủy)', settlement: 'Chọn chỗ xây nhà (Esc để hủy)', city: 'Chọn nhà để nâng cấp (Esc để hủy)' } as Record<string, string>)[interKind] || '';
  return '';
}

export const banner = select<string>(() => {
  const st = cur();
  if (!st || locked.value) return '';
  return bannerText(st, seat.value, inter.value?.kind);
});

export const eventDesc = (id: string): string => EVENTS.find(e => e.id === id)?.desc || '';

// ---------- the trade offer panel ----------
interface OfferInfo {
  id: number;
  from: number;
  fromName: string;
  fromColor: string;
  give: Hand;
  get: Hand;
  iAmProposer: boolean;
  online: boolean;
  /** one row per invited seat */
  rows: { pid: number; name: string; r: 'accept' | 'reject' | null; mine: boolean; can: boolean }[];
}

export const offer = select<OfferInfo | null>(() => {
  const st = cur();
  if (!st) return null;
  const tr = st.trade;
  if (!tr || locked.value || st.phase === 'gameOver') return null;
  const v = seat.value;
  const mine = localHumans(st);
  const iAmProposer = mine.includes(tr.from);
  const pendingMe = tr.to.filter(pid => mine.includes(pid) && tr.responses[pid] == null);
  if (!iAmProposer && !pendingMe.length && !(v >= 0 && tr.to.includes(v))) return null;
  const from = st.players[tr.from]!;
  return {
    id: tr.id, from: tr.from, fromName: from.name, fromColor: from.color, give: tr.give, get: tr.get, iAmProposer, online: App.isOnline(),
    rows: tr.to.map(pid => {
      const o = st.players[pid]!;
      return { pid, name: o.name, r: tr.responses[pid] ?? null, mine: mine.includes(pid), can: G.canAfford(o.res, tr.get) };
    }),
  };
}, jsonEq);
