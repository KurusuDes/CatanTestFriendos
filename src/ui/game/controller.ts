// The game screen's one long-lived effect + its global listeners. Created when the screen is mounted,
// disposed on leave (no `document.onpointerdown = ...` globals, no `App.listeners` slot).
//
// On every commit (a move, a bot move, a state from the host) the effect, in this order:
//   1. mirrors the seat we render for into `store.viewer`,
//   2. runs the imperative fx ONCE for the new state (sounds, flying cards, announcements...),
//   3. repaints the board (one `render(view, boardView)` call) and tells the ADHD arcade what changed.
import { effect, untracked } from '@preact/signals';
import type { BlindPiece } from '@board/types';
import { App, store } from '@app/index';
import { updateAdhd } from '@ui/adhd';
import {
  announces, boardNudge, boardSig, boards, cardEmotes, confettiOn, cur, diceAnim, emoteOpen, gains, gv, inter, locked,
  metaTick, modal, offer, pick, seat, topView, unlockedFor,
} from './signals';
import { S, processFx, resetFx, showEmote, showPing } from './fx';

function resetSignals(): void {
  modal.value = null;
  pick.value = null;
  unlockedFor.value = null;
  gains.value = [];
  cardEmotes.value = [];
  announces.value = [];
  confettiOn.value = 0;
  diceAnim.value = 0;
  topView.value = false;
  emoteOpen.value = null;
  boardSig.value = null;
  boards.any = boards.d3 = null;
}

/** one `board.render` for the current state (called from the controller effect) */
function paintBoard(): void {
  const b = boardSig.value;
  void boardNudge.value;
  const st = cur();
  if (!b || !st) return;
  const v = seat.value, lock = locked.value, g = gv.value!;
  const it = inter.value;
  if (Date.now() - S.pulseAt > 2600) S.pulseTiles.clear();
  let blindOwn: BlindPiece[] = [];
  if (st.phase === 'setup' && st.setup.blindActive) blindOwn = v < 0 ? st.blind : lock ? [] : st.blind.filter(x => x.pid === v);
  const vst = lock ? { ...g, buildings: {}, roads: {}, vision: { circles: [], caps: [] } } : g;
  const flipAt = S.flipPending ? S.flipAt : 0;
  S.flipPending = false;
  untracked(() => b.render(vst, {
    vision: st.config.modes.fog && v >= 0 ? vst.vision || { circles: [], caps: [] } : null,
    faceDown: st.config.modes.flipped,
    flipAt,
    interaction: it,
    rolled: Date.now() - S.rolledAt < 2600 ? S.rolled : null,
    rolledAt: S.rolledAt,
    pulseTiles: S.pulseTiles,
    blindOwn,
  }));
}

/** whose wallet the arcade shows, and whether something in the game wants your attention */
export function syncAdhd(): void {
  const st = cur();
  if (!st) return;
  updateAdhd(st, locked.value ? -1 : seat.value, offer.value != null);
}

export function startController(): () => void {
  resetFx();
  resetSignals();
  const seed0 = store.state.peek()?.config.seed;
  let first = true;
  const stopMain = effect(() => {
    const st = cur();
    const v = seat.value;
    // a rematch swaps the state while this screen is still up (it is replaced right after): do nothing
    if (!st || st.config.seed !== seed0) return;
    untracked(() => {
      store.viewer.value = v;
      if (!first) processFx(st);
    });
    first = false;
    paintBoard();
    syncAdhd();
  });
  const stopEvents = [
    App.events.on('emote', showEmote),
    App.events.on('ping', showPing),
    App.events.on('meta', () => void metaTick.value++),
  ];
  const onKey = (e: KeyboardEvent) => {
    if (App.screen !== 'game' || e.key !== 'Escape') return;
    if (emoteOpen.value) emoteOpen.value = null;
    else {
      pick.value = null;
      modal.value = null;
    }
  };
  document.addEventListener('keydown', onKey);
  return () => {
    stopMain();
    stopEvents.forEach(f => f());
    document.removeEventListener('keydown', onKey);
    resetFx();
    resetSignals();
  };
}
