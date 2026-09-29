// Online play over WebRTC (PeerJS public broker). The host runs the rules engine
// and the bots; guests only send actions and receive the authoritative state.
import { App } from './app.js';
import { applyAction, createGame } from './engine/game.js';
import { toast } from './ui/dom.js';

const PREFIX = 'kchx-v1-';
let peerLib = null;

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

export class Net {
  constructor() {
    this.active = false;
    this.role = null;
    this.peer = null;
    this.code = null;
    this.guests = []; // host: {conn, name, seat}
    this.conn = null; // client connection to host
    this.onChange = () => {};
  }

  async host() {
    const Peer = await loadPeer();
    this.role = 'host';
    this.active = true;
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      try {
        await new Promise((res, rej) => {
          const p = new Peer(PREFIX + code);
          p.on('open', () => {
            this.peer = p;
            this.code = code;
            res();
          });
          p.on('error', e => {
            if (!this.peer) {
              p.destroy();
              rej(e);
            } else toast('Red: ' + e.type, 'error');
          });
        });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
      }
    }
    this.peer.on('connection', conn => {
      conn.on('data', msg => this.onHostData(conn, msg));
      conn.on('close', () => {
        const g = this.guests.find(x => x.conn === conn);
        if (g) {
          g.conn = null;
          toast(`🔌 ${g.name} se desconectó`, 'error');
          if (g.seat == null) this.guests = this.guests.filter(x => x !== g);
          this.onChange();
        }
      });
    });
    this.onChange();
    return this.code;
  }

  onHostData(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      const name = String(msg.name || 'Amigo').slice(0, 16);
      // reconnect to an existing seat by name
      let g = this.guests.find(x => x.name === name && !x.conn);
      if (g) g.conn = conn;
      else {
        if (App.state && App.state.phase !== 'gameOver') {
          conn.send({ type: 'error', msg: 'La partida ya empezó.' });
          return;
        }
        g = { conn, name, seat: null };
        this.guests.push(g);
      }
      toast(`🟢 ${name} entró a la sala`, 'good');
      conn.send({ type: 'welcome', code: this.code });
      if (App.state && g.seat != null) conn.send({ type: 'state', state: App.state, seat: g.seat });
      this.onChange();
      return;
    }
    if (msg.type === 'action') {
      const g = this.guests.find(x => x.conn === conn);
      if (!g || g.seat == null || !App.state) return;
      const a = msg.action;
      if (!a || a.pid !== g.seat) {
        conn.send({ type: 'error', msg: 'Ese no es tu asiento.' });
        return;
      }
      const r = applyAction(App.state, a);
      if (!r.ok) conn.send({ type: 'error', msg: r.error });
      else App.changed();
    }
  }

  startGame(config) {
    // assign connected guests to remote seats, in order
    const free = this.guests.filter(g => g.conn);
    config.players.forEach((p, i) => {
      if (p.kind !== 'remote') return;
      const g = free.shift();
      g.seat = i;
      p.name = g.name;
      p.kind = 'human';
      p.remote = true;
    });
    this.guests = this.guests.filter(g => g.seat != null);
    App.mySeat = 0;
    App.config = config;
    App.state = createGame(config);
    App.go('game');
    App.changed();
  }

  broadcastState(st) {
    for (const g of this.guests) if (g.conn && g.conn.open) g.conn.send({ type: 'state', state: st, seat: g.seat });
  }

  async join(code, name, onStatus) {
    const Peer = await loadPeer();
    this.role = 'client';
    this.active = true;
    this.code = code.toUpperCase().trim();
    await new Promise((res, rej) => {
      const p = new Peer();
      this.peer = p;
      p.on('open', () => {
        const c = p.connect(PREFIX + this.code, { reliable: true });
        this.conn = c;
        const timer = setTimeout(() => rej(new Error('No se encontró la sala')), 12000);
        c.on('open', () => {
          clearTimeout(timer);
          c.send({ type: 'hello', name });
          res();
        });
        c.on('data', msg => this.onClientData(msg, onStatus));
        c.on('close', () => {
          if (this.active) {
            toast('🔌 Se perdió la conexión con el anfitrión', 'error');
            onStatus && onStatus('closed');
          }
        });
      });
      p.on('error', e => rej(new Error(e.type === 'peer-unavailable' ? 'No existe una sala con ese código' : 'Error de red: ' + e.type)));
    });
  }

  onClientData(msg, onStatus) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'welcome') onStatus && onStatus('waiting');
    else if (msg.type === 'error') toast(msg.msg, 'error');
    else if (msg.type === 'state') {
      App.mySeat = msg.seat;
      App.state = msg.state;
      App.config = msg.state.config;
      if (App.screen !== 'game') App.go('game');
      App.changed();
    }
  }

  sendAction(a) {
    if (this.conn && this.conn.open) this.conn.send({ type: 'action', action: a });
    else toast('Sin conexión con el anfitrión', 'error');
  }

  close() {
    this.active = false;
    try {
      this.peer && this.peer.destroy();
    } catch {}
  }
}
