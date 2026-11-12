// The wallet: one per seat, kept for this match in localStorage (same key and format as the pre-Preact version).
// Saves are debounced (a machine pays out many times a second); `flush` writes right away.
import { App } from '@app/index';
import { storage } from '@ui/dom';

export const KEY = 'katanittes.adhd.v2';
export const START = 100;
/** reaching GOALS[i] adds machine i+1; the last one wins */
export const GOALS = [150, 250, 400, 650, 1000, 1600];

export interface Wallet {
  money: number;
  level: number;
  wins: number;
}
interface Store {
  id: number;
  seats: Record<number, Wallet>;
}

export const freshWallet = (wins = 0): Wallet => ({ money: START, level: 1, wins });

/** the match seed: a wallet saved for another match is not ours */
function gameId(): number {
  return App.state && App.state.config ? App.state.config.seed : 0;
}

export function loadStore(): Store {
  const s = storage(KEY) as Store | null;
  return s && s.id === gameId() ? s : { id: gameId(), seats: {} };
}

export function loadWallet(seat: number): Wallet {
  return loadStore().seats[seat] || freshWallet();
}

export function saveWallet(seat: number, w: Wallet): void {
  const s = loadStore();
  s.seats[seat] = w;
  storage(KEY, s);
}

export interface Saver {
  /** debounced (400 ms) */
  save(): void;
  flush(): void;
}

/** `current` says whose wallet is open right now (null seat: nothing to save) */
export function walletSaver(current: () => { seat: number | null; w: Wallet | null }): Saver {
  let t: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(t);
    const { seat, w } = current();
    if (seat == null || !w) return;
    saveWallet(seat, w);
  };
  return {
    flush,
    save() {
      clearTimeout(t);
      t = setTimeout(flush, 400);
    },
  };
}
