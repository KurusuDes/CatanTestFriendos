// Online play over WebRTC (PeerJS public broker). The host runs the rules engine
// and the bots; guests only send actions and receive the authoritative state.
//
// Robustness:
//  - every device has a persistent token, so a player who loses signal gets their
//    seat back when they reconnect (guests retry automatically for 10 minutes);
//  - when someone stays disconnected the table votes: wait, replace with a bot or
//    retire them (a bot seat is handed back if the player returns);
//  - the host autosaves the session and can reopen the room with the same code.
import { App } from './app.js';
import { applyAction, createGame } from './engine/game.js';
import { toast, storage } from './ui/dom.js';

const PREFIX = 'kchx-v1-';
export const HOST_SESSION = 'kchudites.hostSession';
export const GUEST_SESSION = 'kchudites.guestSession';
const TOKEN_KEY = 'kchudites.token';
const GRACE_MS = 12000; // time to come back before the table votes
const PING_MS = 3000, DEAD_MS = 10000; // heartbeat: abrupt signal loss is noticed in ~10s
const VOTE_MS = 45000;
const WAIT_MS = 60000; // a "wait" result gives this much extra time
const ADMIN = new Set(['retirePlayer', 'setController']);
let peerLib = null;

export function myToken() {
  let t = storage(TOKEN_KEY);
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    storage(TOKEN_KEY, t);
  }
  return t;
}

function loadPeer() {
  if (peerLib) return peerLib;
  peerLib = new Promise((res, rej) => {
    if (window.Peer) return res(window.Peer);
    const sc = document.createElement('script');
    sc.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    sc.onload = () => res(window.Peer);
    sc.onerror = () => {
      peerLib = null;
      rej(new Error('No se pudo cargar PeerJS'));
    };
    document.head.append(sc);
  });
  return peerLib;
}

const makeCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the board geometry never changes during a game: send it once per connection
const STATIC_KEYS = ['vertices', 'edges', 'sea', 'ports', 'bounds'];
function slim(st) {
  const board = {};
  for (const k in st.board) if (!STATIC_KEYS.includes(k)) board[k] = st.board[k];
  // painted flags are images: they travel once in 'init', not with every move
  return { ...st, board, log: st.log.slice(-40), players: st.players.map(({ flag, ...p }) => (void flag, p)) };
}
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h + ':' + str.length;
}
function staticBoard(st) {
  const b = {};
  for (const k of STATIC_KEYS) b[k] = st.board[k];
  return b;
}

export class Net {
  constructor() {
    this.active = false;
    this.role = null;
    this.peer = null;
    this.code = null;
    this.guests = []; // host: {token, name, flag, color, conn, seat, connected, replaced}
    this.vote = null; // host: {id, seat, name, votes, voters, deadline}
    this.meta = { presence: {}, vote: null }; // what clients see
    this.conn = null;
    this.onChange = () => {};
    this.timers = new Map();
  }

  // ================= HOST =================
  async host(code) {
    const Peer = await loadPeer();
    this.role = 'host';
    this.active = true;
    const reopening = !!code;
    for (let attempt = 0; attempt < (reopening ? 25 : 4); attempt++) {
      const c = code || makeCode();
      try {
        await new Promise((res, rej) => {
          const p = new Peer(PREFIX + c);
          p.on('open', () => {
            this.peer = p;
            this.code = c;
            res();
          });
          p.on('error', e => {
            if (!this.peer) {
              p.destroy();
              rej(e);
            } else if (e.type !== 'peer-unavailable') toast('Red: ' + e.type, 'error');
          });
        });
        break;
      } catch (e) {
        // the broker keeps a dropped id for a little while: wait and retry the same code
        if (reopening && e.type === 'unavailable-id') {
          await sleep(3000);
          continue;
        }
        if (attempt >= (reopening ? 24 : 3)) throw e;
      }
    }
    if (!this.peer) throw new Error('No se pudo abrir la sala');
    clearInterval(this.hb);
    this.hb = setInterval(() => {
      const now = Date.now();
      for (const g of this.guests) {
        if (!g.conn) continue;
        if (g.connected && now - (g.lastPong || now) > DEAD_MS) {
          const c = g.conn;
          try {
            c.close();
          } catch {}
          this.lost(c);
          continue;
        }
        if (g.conn.open) g.conn.send({ type: 'ping', t: now });
      }
    }, PING_MS);
    this.peer.on('connection', conn => {
      conn.on('data', msg => this.onHostData(conn, msg));
      conn.on('close', () => this.lost(conn));
      conn.on('error', () => this.lost(conn));
    });
    this.peer.on('disconnected', () => {
      // lost the broker (not the guests): try to get the id back
      if (this.active) setTimeout(() => this.peer && !this.peer.destroyed && this.peer.reconnect(), 2000);
    });
    this.onChange();
    return this.code;
  }

  guestBySeat(seat) {
    return this.guests.find(g => g.seat === seat);
  }

  onHostData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') return this.hello(conn, msg);
    const g = this.guests.find(x => x.conn === conn);
    if (!g) return;
    g.lastPong = Date.now();
    if (msg.type === 'pong') return;
    if (msg.type === 'action') {
      const st = App.state;
      if (g.seat == null || !st) return;
      const a = msg.action;
      if (!a || ADMIN.has(a.type) || a.pid !== g.seat) return conn.send({ type: 'error', msg: 'Esa acción no es tuya.' });
      if (st.players[g.seat].retired) return conn.send({ type: 'error', msg: 'Te retiraron de la partida.' });
      const r = applyAction(st, a);
      if (!r.ok) conn.send({ type: 'error', msg: r.error });
      else App.changed();
    } else if (msg.type === 'vote') this.castVote(g.seat, msg.choice, msg.voteId);
    else if (msg.type === 'bye') {
      g.leaving = true;
      try {
        conn.close();
      } catch {}
      this.lost(conn, true);
    }
  }

  hello(conn, msg) {
    const token = String(msg.token || '').slice(0, 40);
    const name = String(msg.name || 'Amigo').slice(0, 16);
    let g = token && this.guests.find(x => x.token === token);
    const inGame = App.state && App.state.phase !== 'gameOver';
    if (g) {
      // same device coming back: re-attach to its seat
      if (g.conn && g.conn !== conn) {
        try {
          g.conn.close();
        } catch {}
      }
      g.conn = conn;
      g.connected = true;
      g.lastPong = Date.now();
      g.sentStatic = false;
      g.leaving = false;
      if (!inGame) Object.assign(g, { name, flag: msg.flag || g.flag, color: msg.color || g.color });
      toast(`🟢 ${g.name} ${inGame ? 'volvió' : 'entró'} a la sala`, 'good');
      this.cancelVote(g.seat);
      clearTimeout(this.timers.get(g.seat));
      if (inGame && g.seat != null) {
        const p = App.state.players[g.seat];
        if (p.retired) conn.send({ type: 'error', msg: 'La mesa votó retirarte de esta partida. Puedes mirar.' });
        else if (p.kind === 'bot' && g.replaced) {
          g.replaced = false;
          applyAction(App.state, { type: 'setController', pid: g.seat, kind: 'human' });
        }
      }
    } else {
      if (inGame) {
        conn.send({ type: 'error', msg: 'La partida ya empezó.' });
        return;
      }
      if (this.guests.length >= 7) {
        conn.send({ type: 'error', msg: 'La sala está llena (8 jugadores).' });
        return;
      }
      g = { token, name, flag: msg.flag || null, color: msg.color || null, conn, seat: null, connected: true, lastPong: Date.now() };
      this.guests.push(g);
      toast(`🟢 ${name} entró a la sala`, 'good');
    }
    conn.send({ type: 'welcome', code: this.code });
    if (App.state && g.seat != null) App.changed();
    else this.pushMeta();
    this.onChange();
  }

  lost(conn, now = false) {
    const g = this.guests.find(x => x.conn === conn);
    if (!g) return;
    g.conn = null;
    g.connected = false;
    const inGame = App.state && App.state.phase !== 'gameOver';
    if (!inGame) {
      if (g.seat == null) this.guests = this.guests.filter(x => x !== g);
      toast(`🔌 ${g.name} salió de la sala`, 'error');
    } else {
      toast(`🔌 ${g.name} se desconectó`, 'error');
      const p = App.state.players[g.seat];
      if (p && !p.retired && p.kind === 'human') this.timers.set(g.seat, setTimeout(() => this.startVote(g.seat), now ? 0 : GRACE_MS));
    }
    this.pushMeta();
    this.onChange();
  }

  // ---------- votes ----------
  voters() {
    const st = App.state;
    const seats = [0, ...this.guests.filter(g => g.connected && g.seat != null).map(g => g.seat)];
    return seats.filter(s => st.players[s] && !st.players[s].retired && st.players[s].kind === 'human');
  }

  startVote(seat) {
    const g = this.guestBySeat(seat);
    const st = App.state;
    if (!g || g.connected || !st || st.phase === 'gameOver' || st.players[seat].retired || st.players[seat].kind !== 'human') return;
    if (this.vote && this.vote.seat === seat) return;
    if (this.vote) {
      // one vote at a time: queue this one
      this.timers.set(seat, setTimeout(() => this.startVote(seat), 3000));
      return;
    }
    const voters = this.voters().filter(s => s !== seat);
    this.vote = { id: Math.random().toString(36).slice(2, 8), seat, name: st.players[seat].name, votes: {}, voters, deadline: Date.now() + VOTE_MS };
    this.voteTimer = setInterval(() => this.checkVote(), 1000);
    this.pushMeta();
  }

  castVote(seat, choice, voteId) {
    const v = this.vote;
    if (!v || (voteId && voteId !== v.id) || !v.voters.includes(seat) || !['wait', 'bot', 'remove'].includes(choice)) return;
    v.votes[seat] = choice;
    this.pushMeta();
    this.checkVote();
  }

  checkVote() {
    const v = this.vote;
    if (!v) return;
    const g = this.guestBySeat(v.seat);
    if (g && g.connected) return this.cancelVote(v.seat);
    v.voters = v.voters.filter(s => this.voters().includes(s));
    const tally = { wait: 0, bot: 0, remove: 0 };
    for (const s of v.voters) if (v.votes[s]) tally[v.votes[s]]++;
    const need = Math.floor(v.voters.length / 2) + 1;
    const decided = Object.entries(tally).find(([, n]) => n >= need);
    const allIn = v.voters.every(s => v.votes[s]);
    if (!decided && !allIn && Date.now() < v.deadline) return this.pushMeta();
    let result = decided ? decided[0] : null;
    if (!result) {
      const max = Math.max(...Object.values(tally));
      const top = Object.keys(tally).filter(k => tally[k] === max);
      result = max === 0 || top.length > 1 ? 'bot' : top[0];
    }
    this.finishVote(result);
  }

  finishVote(result) {
    const v = this.vote;
    clearInterval(this.voteTimer);
    this.vote = null;
    const st = App.state;
    const g = this.guestBySeat(v.seat);
    const label = { wait: '⏳ esperar', bot: '🤖 que juegue un bot', remove: '🚪 retirarlo' }[result];
    toast(`🗳️ La mesa decidió ${label} (${v.name})`, 'good', 4000);
    if (result === 'remove') {
      const r = applyAction(st, { type: 'retirePlayer', pid: v.seat });
      if (!r.ok) result = 'bot';
    }
    if (result === 'bot') {
      applyAction(st, { type: 'setController', pid: v.seat, kind: 'bot' });
      if (g) g.replaced = true;
    }
    if (result === 'wait') this.timers.set(v.seat, setTimeout(() => this.startVote(v.seat), WAIT_MS));
    st.fx = [];
    App.changed();
  }

  cancelVote(seat) {
    if (!this.vote || this.vote.seat !== seat) return;
    clearInterval(this.voteTimer);
    this.vote = null;
    this.pushMeta();
  }

  // ---------- state ----------
  metaFor() {
    const presence = { 0: true };
    for (const g of this.guests) if (g.seat != null) presence[g.seat] = g.connected;
    const v = this.vote;
    return { presence, vote: v && { id: v.id, seat: v.seat, name: v.name, votes: v.votes, voters: v.voters, left: Math.max(0, Math.round((v.deadline - Date.now()) / 1000)) } };
  }

  pushMeta() {
    this.meta = this.metaFor();
    for (const g of this.guests) if (g.conn && g.conn.open) g.conn.send({ type: 'meta', meta: this.meta });
    if (App.onMeta) App.onMeta();
  }

  startGame(config) {
    // connected guests take the online seats, in order, with their own name/flag/colour
    const free = this.guests.filter(g => g.connected && g.seat == null);
    const used = new Set(config.players.filter(p => p.kind !== 'remote').map(p => p.color));
    const palette = ['#e53935', '#1e88e5', '#ff9800', '#f5f5f5', '#43a047', '#8e24aa', '#00acc1', '#795548', '#fdd835', '#ec407a'];
    config.players.forEach((p, i) => {
      if (p.kind !== 'remote') return;
      const g = free.shift();
      if (!g) return;
      g.seat = i;
      p.name = g.name;
      p.kind = 'human';
      p.remote = true;
      if (g.flag) p.flag = g.flag;
      let color = g.color || p.color;
      if (used.has(color)) color = palette.find(c => !used.has(c)) || color;
      used.add(color);
      p.color = color;
    });
    this.guests = this.guests.filter(g => g.seat != null);
    App.mySeat = 0;
    App.config = config;
    App.state = createGame(config);
    App.go('game');
    App.changed();
  }

  broadcastState(st) {
    this.meta = this.metaFor();
    const light = slim(st);
    // tiles only change on reveals / earthquakes / tierra viva, config never: skip them when unchanged
    const th = hashStr(JSON.stringify(st.board.tiles));
    for (const g of this.guests) {
      if (!g.conn || !g.conn.open) continue;
      if (!g.sentStatic) {
        g.conn.send({ type: 'init', board: staticBoard(st), config: st.config, flags: st.players.map(p => p.flag || null) });
        g.sentStatic = true;
        g.tilesHash = null;
      }
      const board = { ...light.board };
      if (g.tilesHash === th) delete board.tiles;
      g.tilesHash = th;
      const { config, ...rest } = light;
      void config;
      g.conn.send({ type: 'state', state: { ...rest, board }, seat: g.seat, meta: this.meta });
    }
    // autosave so the host can reopen the room after a crash / refresh
    if (st.phase === 'gameOver') storage(HOST_SESSION, null);
    else storage(HOST_SESSION, { code: this.code, state: st, guests: this.guests.map(({ token, name, flag, color, seat, replaced }) => ({ token, name, flag, color, seat, replaced })), at: Date.now() });
  }

  static async reopen() {
    const s = storage(HOST_SESSION);
    if (!s) throw new Error('No hay sala guardada');
    const net = new Net();
    App.net = net;
    await net.host(s.code);
    net.guests = s.guests.map(g => ({ ...g, conn: null, connected: false }));
    App.mySeat = 0;
    App.state = s.state;
    App.config = s.state.config;
    App.go('game');
    App.changed();
    // anyone who does not come back gets the usual grace period + vote
    for (const g of net.guests) {
      const p = s.state.players[g.seat];
      if (p && !p.retired && p.kind === 'human') net.timers.set(g.seat, setTimeout(() => net.startVote(g.seat), GRACE_MS * 2));
    }
    return net;
  }

  // ================= GUEST =================
  async join(code, name, kingdom, onStatus) {
    await loadPeer();
    this.role = 'client';
    this.active = true;
    this.code = code.toUpperCase().trim();
    this.name = name;
    this.kingdom = kingdom || {};
    this.onStatus = onStatus || (() => {});
    storage(GUEST_SESSION, { code: this.code, name, at: Date.now() });
    await this.connect(true);
  }

  async connect(first) {
    const Peer = await loadPeer();
    if (!this.peer || this.peer.destroyed) {
      await new Promise((res, rej) => {
        const p = new Peer();
        this.peer = p;
        p.on('open', res);
        p.on('error', e => {
          if (e.type === 'peer-unavailable') {
            if (first && !this.everConnected) rej(new Error('No existe una sala con ese código'));
          } else if (!this.everConnected && first) rej(new Error('Error de red: ' + e.type));
        });
        p.on('disconnected', () => this.active && !p.destroyed && setTimeout(() => p.reconnect(), 1500));
      });
    }
    return new Promise((res, rej) => {
      const c = this.peer.connect(PREFIX + this.code, { reliable: true });
      const timer = setTimeout(() => {
        if (first && !this.everConnected) rej(new Error('No se encontró la sala'));
        else {
          try {
            c.close();
          } catch {}
          this.retry();
        }
        res();
      }, 12000);
      c.on('open', () => {
        clearTimeout(timer);
        this.conn = c;
        this.everConnected = true;
        this.reconnecting = false;
        this.lastPing = Date.now();
        clearInterval(this.hb);
        this.hb = setInterval(() => {
          // the host vanished without closing the channel (crash / signal loss)
          if (this.active && this.conn === c && !this.reconnecting && Date.now() - this.lastPing > DEAD_MS) {
            try {
              c.close();
            } catch {}
            this.retry();
          }
        }, PING_MS);
        c.send({ type: 'hello', name: this.name, token: myToken(), flag: this.kingdom.flag, color: this.kingdom.color });
        this.onStatus('connected');
        if (App.onMeta) App.onMeta();
        res();
      });
      c.on('data', msg => this.onClientData(msg));
      c.on('close', () => {
        if (!this.active || this.conn !== c) return;
        this.retry();
      });
    });
  }

  retry() {
    if (!this.active) return;
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.retryUntil = Date.now() + 10 * 60000;
      toast('📡 Se perdió la conexión. Reconectando...', 'error', 4000);
      this.onStatus('reconnecting');
      if (App.onMeta) App.onMeta();
    }
    if (Date.now() > this.retryUntil) {
      this.reconnecting = false;
      this.onStatus('closed');
      toast('🔌 No se pudo volver a la sala', 'error', 6000);
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(false).catch(() => this.retry()), 3000);
  }

  onClientData(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.lastPing = Date.now();
    if (msg.type === 'ping') {
      if (this.conn && this.conn.open) this.conn.send({ type: 'pong' });
      return;
    }
    if (msg.type === 'welcome') this.onStatus('waiting');
    else if (msg.type === 'error') toast(msg.msg, 'error', 5000);
    else if (msg.type === 'init') {
      this.static = msg.board;
      this.config = msg.config;
      this.flags = msg.flags || [];
      this.tiles = null;
    }
    else if (msg.type === 'meta') {
      this.meta = msg.meta;
      if (App.onMeta) App.onMeta();
    } else if (msg.type === 'state') {
      if (!this.static) return;
      const st = msg.state;
      if (st.board.tiles) this.tiles = st.board.tiles;
      else if (this.tiles) st.board.tiles = this.tiles;
      else return;
      st.config = this.config;
      st.players.forEach((p, i) => (p.flag = (this.flags || [])[i] || null));
      st.board = { ...this.static, ...st.board };
      this.meta = msg.meta || this.meta;
      App.mySeat = msg.seat;
      App.state = st;
      App.config = st.config;
      if (App.screen !== 'game') App.go('game');
      App.changed();
    }
  }

  sendAction(a) {
    if (this.conn && this.conn.open) this.conn.send({ type: 'action', action: a });
    else toast('Sin conexión con el anfitrión: reconectando...', 'error');
  }

  // ================= both =================
  sendVote(choice) {
    const v = this.meta.vote || (this.vote && this.metaFor().vote);
    if (!v) return;
    if (this.role === 'host') this.castVote(App.mySeat, choice, v.id);
    else if (this.conn && this.conn.open) this.conn.send({ type: 'vote', choice, voteId: v.id });
  }

  presence(seat) {
    const m = this.role === 'host' ? this.metaFor() : this.meta;
    return m.presence ? m.presence[seat] : undefined;
  }

  currentVote() {
    return this.role === 'host' ? this.metaFor().vote : this.meta.vote;
  }

  close() {
    this.active = false;
    clearTimeout(this.retryTimer);
    clearInterval(this.voteTimer);
    clearInterval(this.hb);
    for (const t of this.timers.values()) clearTimeout(t);
    try {
      if (this.role === 'client' && this.conn && this.conn.open) this.conn.send({ type: 'bye' });
    } catch {}
    setTimeout(() => {
      try {
        this.peer && this.peer.destroy();
      } catch {}
    }, 150);
  }
}
