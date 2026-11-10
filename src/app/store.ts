// Reactive core of the app (Preact signals). The engine mutates `GameState` in place, so the
// `state` signal alone cannot notice a move: `commit()` bumps `rev`, and `view` (what the current
// viewer is allowed to see, `viewFor`) is a computed over [state, rev, viewer], i.e. it is computed
// once per state change however many components read it.
import { computed, signal, batch } from '@preact/signals';
import { viewFor } from '@engine/game';
import type { GameState, GameView } from '@engine/types';
import type { Meta } from '@net/messages';
import { storage } from '../ui/dom.js';

export type ScreenName = string;

export const state = signal<GameState | null>(null);
/** bumped by `commit()` after every in-place mutation of `state` */
export const rev = signal(0);
/** whose eyes the UI renders with: a seat, or -1 for nobody/spectator */
export const viewer = signal(-1);
export const screen = signal<ScreenName | null>(null);
/** online presence + vote shown by the table */
export const meta = signal<Meta>({ presence: {}, vote: null });
export const speed = signal<number>(+((storage('katanittes.speed') as number | null) || 650));
export const sound = signal<boolean>(storage('katanittes.sound') !== false);

export const view = computed<GameView | null>(() => {
  void rev.value;
  const s = state.value;
  return s ? viewFor(s, viewer.value) : null;
});

/** announce that `state` was mutated in place (or replaced) */
export function commit() {
  rev.value++;
}

/** replace the game state and notify */
export function setState(s: GameState | null) {
  batch(() => {
    state.value = s;
    rev.value++;
  });
}
