// Application controller (compatibility facade over the signal store): owns the current game,
// routes actions (locally, or through the online host), drives bots and persists the game.
// `App` keeps the exact surface the UI has always used; the data lives in `./store`.
import { createGame, applyAction, pendingActors } from '@engine/game';
import { botAct } from '@engine/bot';
import type { Action, Config, GameState } from '@engine/types';
import type { Net } from '@net/index';
import type { Meta } from '@net/messages';
import { toast, storage } from '@ui/dom';
import { sfx } from '@ui/sfx';
import { Emitter, type AppEvents } from './events';
import { createSaver } from './persist';
import * as store from './store';

export { store };
export { createSaver } from './persist';
export type { Saver } from './persist';

export const SAVE_KEY = 'katanittes.save.v1';
const SPEED_KEY = 'katanittes.speed';
const SOUND_KEY = 'katanittes.sound';

export type ScreenFn = (root: HTMLElement, arg?: unknown) => void;

/** The public surface of `App` (what src/ui and src/main.ts rely on). */
interface AppApi {
  screens: Record<string, ScreenFn>;
  screen: string | null;
  state: GameState | null;
  config: Config | null;
  net: Net | null;
  mySeat: number | null;
  viewer: number;
  speed: number;
  botTimer: ReturnType<typeof setTimeout> | null;
  listeners: Array<(st: GameState) => void>;
  // callback slots (set by the UI)
  onLeave: (() => void) | null;
  onPing: ((seat: number, x: number, z: number) => void) | null;
  onMeta: (() => void) | null;
  onLobby: (() => void) | null;
  /** typed events, fired in addition to the callback slots */
  events: Emitter<AppEvents>;

  go(name: string, arg?: unknown): void;
  isOnline(): boolean;
  isClient(): boolean;
  startGame(config: Config): void;
  resume(): boolean;
  dispatch(action: Action): boolean;
  ping(seat: number, x: number, z: number): void;
  changed(): void;
  scheduleBots(): void;
  leaveGame(): void;
  rematch(): void;
  setSpeed(ms: number): void;
  toggleSound(): boolean;
  /** net layer: the table meta (presence / vote) changed */
  notifyMeta(m?: Meta): void;
  notifyLobby(): void;
  /** hand a ping to the UI (callback slot + typed event) */
  deliverPing(seat: number, x: number, z: number): void;
}

/** Local (single device) game save: debounced, flushed when the tab hides. */
const localSaver = createSaver<GameState>(v => storage(SAVE_KEY, v));

/** fx kinds after which bots wait longer (see scheduleBots) */
const DRAMA_FX = ['flipAll', 'blindReveal', 'event', 'chaos', 'win'];

export const App: AppApi = {
  screens: {},
  botTimer: null,
  listeners: [],
  net: null,
  config: null,
  mySeat: null,
  onLeave: null,
  onPing: null,
  onMeta: null,
  onLobby: null,
  events: new Emitter<AppEvents>(),

  get screen() {
    return store.screen.value;
  },
  set screen(v) {
    store.screen.value = v;
  },
  get state() {
    return store.state.value;
  },
  set state(s) {
    store.setState(s);
  },
  get viewer() {
    return store.viewer.value;
  },
  set viewer(v) {
    store.viewer.value = v;
  },
  get speed() {
    return store.speed.value;
  },
  set speed(v) {
    store.speed.value = v;
  },

  go(name, arg) {
    if (App.onLeave) App.onLeave();
    App.onLeave = null;
    // leaving a game screen: make sure the (debounced) save is on disk before the menu looks for it
    if (App.screen === 'game' && name !== 'game') localSaver.flush();
    App.screen = name;
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = '';
    window.scrollTo(0, 0);
    App.screens[name]!(root, arg);
  },

  isOnline() {
    return !!(App.net && App.net.active);
  },
  isClient() {
    return App.isOnline() && App.net!.role === 'client';
  },

  startGame(config) {
    App.config = config;
    App.state = createGame(config);
    App.viewer = -1;
    App.go('game');
    App.changed();
  },

  resume() {
    localSaver.flush();
    const saved = storage(SAVE_KEY) as GameState | null;
    if (!saved) return false;
    App.state = saved;
    App.config = saved.config;
    App.go('game');
    App.changed();
    return true;
  },

  dispatch(action) {
    const st = App.state;
    if (!st) return false;
    if (App.isClient()) {
      App.net!.sendAction(action);
      return true;
    }
    const r = applyAction(st, action);
    if (!r.ok) {
      toast(r.error, 'error');
      return false;
    }
    App.changed();
    return true;
  },

  // a 1 s marker a seat drops on the map (middle click), shared the same way
  ping(seat, x, z) {
    if (!App.state || !Number.isFinite(x) || !Number.isFinite(z)) return;
    x = Math.round(x * 100) / 100;
    z = Math.round(z * 100) / 100;
    if (App.isClient()) return App.net!.sendPing(x, z);
    if (App.isOnline()) App.net!.relayPing(seat, x, z);
    App.deliverPing(seat, x, z);
  },

  // called after every state change (local apply, or state received from host)
  changed() {
    const st = App.state;
    if (!st) return;
    store.commit();
    if (!App.isClient() && !App.isOnline()) {
      if (st.phase === 'gameOver') localSaver.clear();
      else localSaver.schedule(st);
    }
    if (App.isOnline() && App.net!.role === 'host') App.net!.broadcastState(st);
    for (const fn of App.listeners) fn(st);
    App.scheduleBots();
  },

  // Bots: the move is computed when the timer fires, not on every change (decisions are a pure function
  // of the state, and any change of state reschedules). The wait is the same as before: the shortest
  // wait elapses first; when the chosen action turns out to deserve a longer pause the rest is waited after.
  scheduleBots() {
    if (App.botTimer) clearTimeout(App.botTimer);
    App.botTimer = null;
    const st = App.state;
    if (!st || App.isClient() || st.phase === 'gameOver' || App.screen !== 'game') return;
    const bots = pendingActors(st).filter(pid => st.players[pid]!.kind === 'bot');
    if (!bots.length) return;
    const speed = App.speed;
    // give big moments (reveal, flip, events) time to breathe before bots continue
    const drama = (st.fx || []).some(f => DRAMA_FX.includes(f.kind)) ? 2200 : 0;
    const first = drama + speed * 0.6;
    App.botTimer = setTimeout(() => {
      if (App.state !== st) return;
      for (const pid of bots) {
        const a = botAct(st, pid);
        if (!a) continue;
        const quick = a.type === 'respondTrade' || a.type === 'discard' || a.type === 'placeRoad';
        const total = drama + (quick ? speed * 0.6 : a.type === 'endTurn' ? speed * 0.8 : speed);
        const apply = () => {
          if (App.state !== st) return;
          const r = applyAction(st, a);
          if (!r.ok) {
            console.warn('bot error', a, r.error);
            // fail-safe so a buggy bot can never freeze the table
            if (st.phase === 'main' && st.current === pid) applyAction(st, { type: 'endTurn', pid });
          }
          App.changed();
        };
        if (total > first) App.botTimer = setTimeout(apply, total - first);
        else apply();
        return;
      }
    }, first);
  },

  leaveGame() {
    if (App.botTimer) clearTimeout(App.botTimer);
    App.botTimer = null;
    localSaver.flush();
    if (App.net) App.net.close();
    App.net = null;
    App.mySeat = null;
    App.state = null;
    App.listeners = [];
    App.go('menu');
  },

  rematch() {
    const cfg: Config = JSON.parse(JSON.stringify(App.state!.config));
    cfg.seed = (Math.random() * 2 ** 31) | 0;
    App.startGame(cfg);
  },

  setSpeed(ms) {
    App.speed = ms;
    storage(SPEED_KEY, ms);
  },

  toggleSound() {
    sfx.on = !sfx.on;
    store.sound.value = sfx.on;
    storage(SOUND_KEY, sfx.on);
    return sfx.on;
  },

  notifyMeta(m) {
    if (m) store.meta.value = m;
    if (App.onMeta) App.onMeta();
    App.events.emit('meta');
  },

  notifyLobby() {
    if (App.onLobby) App.onLobby();
  },

  deliverPing(seat, x, z) {
    if (App.onPing) App.onPing(seat, x, z);
    App.events.emit('ping', seat, x, z);
  },
};

if (storage(SOUND_KEY) === false) sfx.on = false;
