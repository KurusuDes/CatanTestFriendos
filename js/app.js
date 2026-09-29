// Application controller: owns the current game state, routes actions (locally,
// or through the online host), drives bots and persists the game.
import { createGame, applyAction, pendingActors } from './engine/game.js';
import { botAct } from './engine/bot.js';
import { toast, storage } from './ui/dom.js';
import { sfx } from './ui/sfx.js';

export const SAVE_KEY = 'kchudites.save.v1';

export const App = {
  screens: {},
  screen: null,
  state: null,
  config: null,
  net: null, // online session (see net.js)
  mySeat: null,
  viewer: -1,
  speed: +(storage('kchudites.speed') || 650),
  botTimer: null,
  listeners: [],

  go(name, arg) {
    if (this.onLeave) this.onLeave();
    this.onLeave = null;
    this.screen = name;
    const root = document.getElementById('app');
    root.innerHTML = '';
    window.scrollTo(0, 0);
    this.screens[name](root, arg);
  },

  isOnline() {
    return !!(this.net && this.net.active);
  },
  isClient() {
    return this.isOnline() && this.net.role === 'client';
  },

  startGame(config) {
    this.config = config;
    this.state = createGame(config);
    this.viewer = -1;
    this.go('game');
    this.changed();
  },

  resume() {
    const saved = storage(SAVE_KEY);
    if (!saved) return false;
    this.state = saved;
    this.config = saved.config;
    this.go('game');
    this.changed();
    return true;
  },

  dispatch(action) {
    if (!this.state) return false;
    if (this.isClient()) {
      this.net.sendAction(action);
      return true;
    }
    const r = applyAction(this.state, action);
    if (!r.ok) {
      toast(r.error, 'error');
      return false;
    }
    this.changed();
    return true;
  },

  // called after every state change (local apply, or state received from host)
  changed() {
    const st = this.state;
    if (!this.isClient() && !this.isOnline()) {
      if (st.phase === 'gameOver') storage(SAVE_KEY, null);
      else storage(SAVE_KEY, st);
    }
    if (this.isOnline() && this.net.role === 'host') this.net.broadcastState(st);
    for (const fn of this.listeners) fn(st);
    this.scheduleBots();
  },

  scheduleBots() {
    clearTimeout(this.botTimer);
    const st = this.state;
    if (!st || this.isClient() || st.phase === 'gameOver' || this.screen !== 'game') return;
    const actors = pendingActors(st).filter(pid => st.players[pid].kind === 'bot');
    for (const pid of actors) {
      const a = botAct(st, pid);
      if (!a) continue;
      const quick = a.type === 'respondTrade' || a.type === 'discard' || a.type === 'placeRoad';
      const delay = quick ? this.speed * 0.6 : a.type === 'endTurn' ? this.speed * 0.8 : this.speed;
      this.botTimer = setTimeout(() => {
        if (this.state !== st) return;
        const r = applyAction(st, a);
        if (!r.ok) {
          console.warn('bot error', a, r.error);
          // fail-safe so a buggy bot can never freeze the table
          if (st.phase === 'main' && st.current === pid) applyAction(st, { type: 'endTurn', pid });
        }
        this.changed();
      }, delay);
      return;
    }
  },

  leaveGame() {
    clearTimeout(this.botTimer);
    if (this.isOnline()) this.net.close();
    this.net = null;
    this.mySeat = null;
    this.state = null;
    this.listeners = [];
    this.go('menu');
  },

  rematch() {
    const cfg = JSON.parse(JSON.stringify(this.state.config));
    cfg.seed = (Math.random() * 2 ** 31) | 0;
    this.startGame(cfg);
  },

  setSpeed(ms) {
    this.speed = ms;
    storage('kchudites.speed', ms);
  },

  toggleSound() {
    sfx.on = !sfx.on;
    storage('kchudites.sound', sfx.on);
    return sfx.on;
  },
};

const snd = storage('kchudites.sound');
if (snd === false) sfx.on = false;
