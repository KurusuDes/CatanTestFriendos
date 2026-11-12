// App controller: debounced save (UI-8), bots computed inside their timer, signal store.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const db = vi.hoisted(() => ({ store: new Map<string, string>(), writes: [] as string[] }));
vi.mock('@ui/dom', () => ({
  toast: vi.fn(),
  storage: (k: string, v?: unknown) => {
    if (v === undefined) return db.store.has(k) ? JSON.parse(db.store.get(k)!) : null;
    db.writes.push(k);
    if (v === null) db.store.delete(k);
    else db.store.set(k, JSON.stringify(v));
    return undefined;
  },
}));

import { applyAction, createGame, pendingActors } from '@engine/game';
import { botAct } from '@engine/bot';
import type { Config, GameState } from '@engine/types';
import { App, SAVE_KEY, createSaver, store } from '@app/index';
import { makeConfig } from '../scripts/sim.ts';

const handlers: Record<string, (() => void)[]> = {};
let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  db.store.clear();
  db.writes.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  hidden = false;
  Object.assign(globalThis, {
    document: {
      getElementById: () => ({ innerHTML: '' }),
      addEventListener: (ev: string, f: () => void) => (handlers[ev] ||= []).push(f),
      get visibilityState() {
        return hidden ? 'hidden' : 'visible';
      },
    },
    window: { scrollTo() {}, addEventListener: (ev: string, f: () => void) => (handlers[ev] ||= []).push(f) },
  });
  App.screens.game = () => {};
  App.screens.menu = () => {};
  App.net = null;
  App.speed = 650;
});
afterEach(() => {
  if (App.botTimer) clearTimeout(App.botTimer);
  App.botTimer = null;
  App.state = null;
  App.screen = null;
  vi.useRealTimers();
});

describe('debounced saver', () => {
  test('at most one write per 1.5 s, latest value wins, flush on hidden / pagehide, clear is immediate', () => {
    const out: (number | null)[] = [];
    const s = createSaver<number>(v => out.push(v));
    s.schedule(1);
    s.schedule(2);
    expect(out).toEqual([]); // deferred
    vi.advanceTimersByTime(10);
    expect(out).toEqual([2]);
    s.schedule(3);
    vi.advanceTimersByTime(1000);
    expect(out).toEqual([2]); // still inside the 1.5 s window
    s.schedule(4);
    vi.advanceTimersByTime(600);
    expect(out).toEqual([2, 4]);
    // hidden tab flushes whatever is pending
    s.schedule(5);
    hidden = true;
    handlers.visibilitychange!.forEach(f => f());
    expect(out).toEqual([2, 4, 5]);
    s.schedule(6);
    handlers.pagehide!.forEach(f => f());
    expect(out).toEqual([2, 4, 5, 6]);
    // game over: cleared immediately and nothing pending is written afterwards
    s.schedule(7);
    s.clear();
    vi.advanceTimersByTime(5000);
    expect(out).toEqual([2, 4, 5, 6, null]);
    s.dispose();
  });

  test('uses requestIdleCallback when available', () => {
    const idle: (() => void)[] = [];
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => idle.push(cb);
    const out: number[] = [];
    const s = createSaver<number>(v => v !== null && out.push(v));
    s.schedule(1);
    vi.advanceTimersByTime(5);
    expect(out).toEqual([]);
    idle.forEach(f => f());
    expect(out).toEqual([1]);
    delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    s.dispose();
  });
});

function botConfig(): Config {
  const c = makeConfig(8);
  c.players.forEach(p => (p.kind = 'bot'));
  return c;
}

describe('local game with bots through App', () => {
  test('timer-computed bot moves produce exactly the same game as computing them directly; save writes are rare and resume works', () => {
    const cfg = botConfig();
    const ref = createGame(JSON.parse(JSON.stringify(cfg)));
    let steps = 0;
    while (ref.phase !== 'gameOver' && steps < 2500) {
      const st = ref;
      const pid = pendingActors(st).find(p => st.players[p]!.kind === 'bot' && botAct(st, p));
      if (pid === undefined) break;
      const a = botAct(st, pid)!;
      if (!applyAction(st, a).ok && st.phase === 'main' && st.current === pid) applyAction(st, { type: 'endTurn', pid });
      steps++;
    }

    App.startGame(JSON.parse(JSON.stringify(cfg)));
    let stateAtSomePoint: GameState | null = null;
    const t0 = Date.now();
    let n = 0;
    while (App.state && App.state.phase !== 'gameOver' && n++ < 20000) {
      vi.advanceTimersByTime(700);
      if (n === 300) stateAtSomePoint = JSON.parse(JSON.stringify(App.state));
    }
    const virtualSeconds = (Date.now() - t0) / 1000;
    expect(App.state!.phase).toBe('gameOver');
    expect(JSON.stringify(App.state)).toBe(JSON.stringify(ref));

    const writes = db.writes.filter(k => k === SAVE_KEY).length;
    const actions = App.state!.actions;
    console.log(`Partida bot-vs-bot: ${actions} acciones en ${virtualSeconds.toFixed(0)} s virtuales -> ${writes} escrituras de ${SAVE_KEY} (antes: ${actions}, una por acción; máx. ahora 1 cada 1,5 s)`);
    expect(writes).toBeLessThanOrEqual(Math.ceil(virtualSeconds / 1.5) + 2);
    expect(writes).toBeLessThan(actions);
    // game over cleared the save
    expect(db.store.has(SAVE_KEY)).toBe(false);
    expect(stateAtSomePoint).not.toBeNull();
  }, 120000);

  test('resume gives back the last state (leaving the game flushes the pending save)', () => {
    App.startGame(botConfig());
    vi.advanceTimersByTime(20000);
    const mid = App.state!;
    expect(mid.phase).not.toBe('gameOver');
    const snapshot = JSON.stringify(mid);
    App.leaveGame(); // goes through localSaver.flush()
    expect(App.state).toBeNull();
    expect(db.store.get(SAVE_KEY)).toBe(snapshot);
    expect(App.resume()).toBe(true);
    expect(JSON.stringify(App.state)).toBe(snapshot);
    expect(App.config).toEqual(mid.config);
  });

  test('store: `view` is computed once per state change and follows the viewer', () => {
    App.startGame(botConfig());
    const v1 = store.view.value;
    expect(store.view.value).toBe(v1); // memoised
    const before = App.state!.actions;
    vi.advanceTimersByTime(2000);
    expect(App.state!.actions).toBeGreaterThan(before);
    expect(store.view.value).toBe(App.state); // non-fog: view is the state itself
    expect(store.state.value).toBe(App.state);
  });

  test('typed events fire alongside the callback slots', () => {
    App.startGame(botConfig());
    const slot = vi.fn(), ev = vi.fn();
    App.onPing = slot;
    const off = App.events.on('ping', ev);
    App.ping(0, 1.234, 2);
    expect(slot).toHaveBeenCalledWith(0, 1.23, 2);
    expect(ev).toHaveBeenCalledWith(0, 1.23, 2);
    off();
    App.ping(0, 3, 4);
    expect(ev).toHaveBeenCalledTimes(1);
    App.onPing = null;
  });
});
