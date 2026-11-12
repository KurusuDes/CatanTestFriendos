// Host side of an online room: runs the rules engine and the bots, admits guests, sends each one a
// redacted state, runs the "someone dropped" votes and autosaves the session.
import type { Peer } from 'peerjs';
import { applyAction, createGame } from '@engine/game';
import type { Config, GameState } from '@engine/types';
import { App } from '@app/index';
import { toast, storage } from '@ui/dom';
import { tilesFingerprint } from './boardVersion';
import { parseClientMessage, type ClientMessage, type Conn, type Meta } from './messages';
import { redactFor, toWire } from './redact';
import type { Net } from './index';
import {
  DEAD_MS, GRACE_MS, HOST_SESSION, PING_MS, PREFIX, VOTE_MS, WAIT_MS,
  loadPeer, makeCode, peerOptions, safeClose, sleep, type Guest,
} from './session';

const ADMIN = new Set(['retirePlayer', 'setController']);
const PALETTE = ['#e53935', '#1e88e5', '#ff9800', '#f5f5f5', '#43a047', '#8e24aa', '#00acc1', '#795548', '#fdd835', '#ec407a'];

const inGame = () => !!App.state && App.state.phase !== 'gameOver';
const live = (g: Guest): g is Guest & { conn: Conn } => !!g.conn && g.conn.open;

export async function hostOpen(net: Net, code?: string): Promise<string> {
  const Peer = await loadPeer();
  const opts = await peerOptions();
  net.role = 'host';
  net.active = true;
  const reopening = !!code;
  for (let attempt = 0; attempt < (reopening ? 25 : 4); attempt++) {
    const c = code || makeCode();
    try {
      await new Promise<void>((res, rej) => {
        const p: Peer = new Peer(PREFIX + c, opts);
        p.on('open', () => {
          net.peer = p;
          net.code = c;
          res();
        });
        p.on('error', e => {
          if (!net.peer) {
            p.destroy();
            rej(e);
          } else if (e.type !== 'peer-unavailable') toast(`Mạng: ${e.type}`, 'error');
        });
      });
      break;
    } catch (e) {
      // the broker keeps a dropped id for a little while: wait and retry the same code
      if (reopening && (e as { type?: string }).type === 'unavailable-id') {
        await sleep(3000);
        continue;
      }
      if (attempt >= (reopening ? 24 : 3)) throw e;
    }
  }
  const peer = net.peer;
  if (!peer) throw new Error('Không mở được phòng');
  clearInterval(net.hb);
  net.hb = setInterval(() => {
    const now = Date.now();
    for (const g of net.guests) {
      if (!g.conn) continue;
      if (g.connected && now - (g.lastPong || now) > DEAD_MS) {
        const c = g.conn;
        safeClose(c);
        lost(net, c);
        continue;
      }
      if (g.conn.open) g.conn.send({ type: 'ping', t: now });
    }
  }, PING_MS);
  peer.on('connection', dc => attachGuest(net, dc as unknown as Conn));
  peer.on('disconnected', () => {
    // lost the broker (not the guests): try to get the id back
    if (net.active) setTimeout(() => net.peer && !net.peer.destroyed && net.peer.reconnect(), 2000);
  });
  net.onChange();
  return net.code!;
}

/** wire a freshly opened connection (PeerJS or an in-memory pipe in tests) */
export function attachGuest(net: Net, conn: Conn) {
  conn.on('data', msg => onHostData(net, conn, msg));
  conn.on('close', () => lost(net, conn));
  conn.on('error', () => lost(net, conn));
}

function onHostData(net: Net, conn: Conn, raw: unknown) {
  const msg = parseClientMessage(raw);
  if (!msg) {
    console.warn('[net] mensaje de cliente inválido, se ignora:', raw);
    return;
  }
  if (msg.type === 'hello') return hello(net, conn, msg);
  const g = net.guests.find(x => x.conn === conn);
  if (!g) return;
  g.lastPong = Date.now();
  switch (msg.type) {
    case 'pong':
      return;
    case 'action': {
      const st = App.state;
      if (g.seat == null || !st) return;
      const a = msg.action;
      if (ADMIN.has(a.type) || a.pid !== g.seat) return conn.send({ type: 'error', msg: 'Đó không phải lượt của bạn.' });
      if (st.players[g.seat]!.retired) return conn.send({ type: 'error', msg: 'Bạn đã bị cho rời ván.' });
      const r = applyAction(st, a);
      if (!r.ok) conn.send({ type: 'error', msg: r.error });
      else App.changed();
      return;
    }
    case 'mark': {
      if (g.seat == null || !App.state) return;
      const now = Date.now();
      g.pings = (g.pings || []).filter(t => now - t < 3000);
      if (g.pings.length >= 6) return;
      g.pings.push(now);
      App.ping(g.seat, msg.x, msg.z);
      return;
    }
    case 'vote':
      if (g.seat != null) castVote(net, g.seat, msg.choice, msg.voteId);
      return;
    case 'bye':
      g.leaving = true;
      safeClose(conn);
      lost(net, conn, true);
      return;
  }
}

function hello(net: Net, conn: Conn, msg: Extract<ClientMessage, { type: 'hello' }>) {
  const token = String(msg.token || '').slice(0, 40);
  const name = String(msg.name || 'Bạn bè').slice(0, 16);
  let g = token ? net.guests.find(x => x.token === token) : undefined;
  const playing = inGame();
  if (g) {
    // same device coming back: re-attach to its seat
    if (g.conn && g.conn !== conn) safeClose(g.conn);
    g.conn = conn;
    g.connected = true;
    g.lastPong = Date.now();
    g.sentStatic = false;
    g.leaving = false;
    if (!playing) Object.assign(g, { name, flag: msg.flag || g.flag, color: msg.color || g.color });
    toast(playing ? `🟢 ${g.name} đã quay lại phòng` : `🟢 ${g.name} đã vào phòng`, 'good');
    if (g.seat != null) cancelVote(net, g.seat);
    if (g.seat != null) clearTimeout(net.timers.get(g.seat));
    if (playing && g.seat != null) {
      const p = App.state!.players[g.seat]!;
      if (p.retired) conn.send({ type: 'error', msg: 'Cả bàn đã bỏ phiếu cho bạn rời ván này. Bạn vẫn có thể xem.' });
      else if (p.kind === 'bot' && g.replaced) {
        g.replaced = false;
        applyAction(App.state!, { type: 'setController', pid: g.seat, kind: 'human' });
      }
    }
  } else {
    // someone new was turned away: tell the guest why, and tell the host so they can make room
    const refuse = (why: string, text: string) => {
      conn.send({ type: 'refused', msg: text });
      if (net.onRefused) net.onRefused(why, name);
      else toast(`🚪 ${name} định vào: ${text}`, 'error', 6000);
    };
    if (playing) return refuse('started', 'Ván đã bắt đầu rồi.');
    if (!net.open) return refuse('closed', '🔒 Phòng đã đóng: chủ phòng không nhận thêm người.');
    if (net.guests.filter(x => x.connected).length >= net.capacity - 1) return refuse('full', `Phòng đã đầy (${net.capacity} người).`);
    g = { token, name, flag: msg.flag || null, color: msg.color || null, conn, seat: null, connected: true, lastPong: Date.now() };
    net.guests.push(g);
    toast(`🟢 ${name} đã vào phòng`, 'good');
  }
  conn.send({ type: 'welcome', code: net.code });
  if (App.state && g.seat != null) App.changed();
  else {
    pushMeta(net);
    net.pushLobby();
  }
  net.onChange();
}

function lost(net: Net, conn: Conn, now = false) {
  const g = net.guests.find(x => x.conn === conn);
  if (!g) return;
  g.conn = null;
  g.connected = false;
  const st = App.state;
  if (!(st && st.phase !== 'gameOver')) {
    if (g.seat == null) net.guests = net.guests.filter(x => x !== g);
    toast(`🔌 ${g.name} đã rời phòng`, 'error');
    net.pushLobby();
  } else {
    toast(`🔌 ${g.name} bị mất kết nối`, 'error');
    const seat = g.seat;
    const p = seat != null ? st.players[seat] : undefined;
    if (seat != null && p && !p.retired && p.kind === 'human') net.timers.set(seat, setTimeout(() => startVote(net, seat), now ? 0 : GRACE_MS));
  }
  pushMeta(net);
  net.onChange();
}

// ---------- votes ----------
function voters(net: Net): number[] {
  const st = App.state!;
  const seats = [0, ...net.guests.filter(g => g.connected && g.seat != null).map(g => g.seat!)];
  return seats.filter(s => st.players[s] && !st.players[s]!.retired && st.players[s]!.kind === 'human');
}

export function startVote(net: Net, seat: number) {
  const g = net.guests.find(x => x.seat === seat);
  const st = App.state;
  if (!g || g.connected || !st || st.phase === 'gameOver' || st.players[seat]!.retired || st.players[seat]!.kind !== 'human') return;
  if (net.vote && net.vote.seat === seat) return;
  if (net.vote) {
    // one vote at a time: queue this one
    net.timers.set(seat, setTimeout(() => startVote(net, seat), 3000));
    return;
  }
  const vs = voters(net).filter(s => s !== seat);
  net.vote = { id: Math.random().toString(36).slice(2, 8), seat, name: st.players[seat]!.name, votes: {}, voters: vs, deadline: Date.now() + VOTE_MS };
  net.voteTimer = setInterval(() => checkVote(net), 1000);
  pushMeta(net);
}

export function castVote(net: Net, seat: number, choice: string, voteId?: string) {
  const v = net.vote;
  if (!v || (voteId && voteId !== v.id) || !v.voters.includes(seat) || !(choice === 'wait' || choice === 'bot' || choice === 'remove')) return;
  v.votes[seat] = choice;
  pushMeta(net);
  checkVote(net);
}

function checkVote(net: Net) {
  const v = net.vote;
  if (!v) return;
  const g = net.guests.find(x => x.seat === v.seat);
  if (g && g.connected) return cancelVote(net, v.seat);
  const current = voters(net);
  v.voters = v.voters.filter(s => current.includes(s));
  const tally: Record<'wait' | 'bot' | 'remove', number> = { wait: 0, bot: 0, remove: 0 };
  for (const s of v.voters) {
    const c = v.votes[s];
    if (c) tally[c]++;
  }
  const need = Math.floor(v.voters.length / 2) + 1;
  const decided = (Object.entries(tally) as ['wait' | 'bot' | 'remove', number][]).find(([, n]) => n >= need);
  const allIn = v.voters.every(s => v.votes[s]);
  if (!decided && !allIn && Date.now() < v.deadline) return pushMeta(net);
  let result: 'wait' | 'bot' | 'remove';
  if (decided) result = decided[0];
  else {
    const max = Math.max(...Object.values(tally));
    const top = (Object.keys(tally) as (keyof typeof tally)[]).filter(k => tally[k] === max);
    result = max === 0 || top.length > 1 ? 'bot' : top[0]!;
  }
  finishVote(net, result);
}

function finishVote(net: Net, result: 'wait' | 'bot' | 'remove') {
  const v = net.vote!;
  clearInterval(net.voteTimer);
  net.vote = null;
  const st = App.state!;
  const g = net.guests.find(x => x.seat === v.seat);
  const name = v.name;
  const said = { wait: `🗳️ Cả bàn quyết định ⏳ chờ (${name})`, bot: `🗳️ Cả bàn quyết định 🤖 để bot chơi thay (${name})`, remove: `🗳️ Cả bàn quyết định 🚪 cho rời ván (${name})` }[result];
  toast(said, 'good', 4000);
  if (result === 'remove') {
    const r = applyAction(st, { type: 'retirePlayer', pid: v.seat });
    if (!r.ok) result = 'bot';
  }
  if (result === 'bot') {
    applyAction(st, { type: 'setController', pid: v.seat, kind: 'bot' });
    if (g) g.replaced = true;
  }
  if (result === 'wait') net.timers.set(v.seat, setTimeout(() => startVote(net, v.seat), WAIT_MS));
  st.fx = [];
  App.changed();
}

function cancelVote(net: Net, seat: number) {
  if (!net.vote || net.vote.seat !== seat) return;
  clearInterval(net.voteTimer);
  net.vote = null;
  pushMeta(net);
}

// ---------- state ----------
export function metaFor(net: Net): Meta {
  const presence: Meta['presence'] = { 0: true };
  for (const g of net.guests) if (g.seat != null) presence[g.seat] = g.connected;
  const v = net.vote;
  return {
    presence,
    vote: v && { id: v.id, seat: v.seat, name: v.name, votes: v.votes, voters: v.voters, left: Math.max(0, Math.round((v.deadline - Date.now()) / 1000)) },
  };
}

export function pushMeta(net: Net) {
  net.meta = metaFor(net);
  for (const g of net.guests) if (live(g)) g.conn.send({ type: 'meta', meta: net.meta });
  App.notifyMeta(net.meta);
}

export function startHostGame(net: Net, config: Config) {
  // connected guests take the online seats, in order, with their own name/flag/colour
  const free = net.guests.filter(g => g.connected && g.seat == null);
  const used = new Set(config.players.filter(p => (p.kind as string) !== 'remote').map(p => p.color));
  config.players.forEach((p, i) => {
    if ((p.kind as string) !== 'remote') return;
    const g = free.shift();
    if (!g) return;
    g.seat = i;
    p.name = g.name;
    p.kind = 'human';
    (p as { remote?: boolean }).remote = true;
    if (g.flag) p.flag = g.flag;
    let color = g.color || p.color;
    if (used.has(color)) color = PALETTE.find(c => !used.has(c)) || color;
    used.add(color);
    p.color = color;
  });
  // a friend left right before the start: a bot takes the empty online seat
  config.players.forEach(p => {
    if ((p.kind as string) === 'remote') {
      p.kind = 'bot';
      p.level = 'normal';
    }
  });
  net.guests = net.guests.filter(g => g.seat != null);
  App.mySeat = 0;
  App.config = config;
  App.state = createGame(config);
  App.go('game');
  App.changed();
}

/** Each guest gets its own redacted view; tiles travel only when they changed for that guest. */
export function broadcastState(net: Net, st: GameState) {
  net.meta = metaFor(net);
  const bv = net.boardVersion.update(st);
  const over = st.phase === 'gameOver';
  const fog = st.config.modes.fog && !over;
  for (const g of net.guests) {
    if (!live(g)) continue;
    if (!g.sentStatic) {
      const b = st.board;
      g.conn.send({ type: 'init', board: { vertices: b.vertices, edges: b.edges, sea: b.sea, ports: b.ports, bounds: b.bounds }, config: st.config, flags: st.players.map(p => p.flag || null) });
      g.sentStatic = true;
      g.tilesKey = null;
    }
    const red = redactFor(st, g.seat);
    // fog shows each seat different tiles: compare what this seat would see; otherwise the board version is enough
    const key = fog ? tilesFingerprint(red.board.tiles) : `${bv}:${over ? 1 : 0}`;
    const withTiles = g.tilesKey !== key;
    g.tilesKey = key;
    g.conn.send({ type: 'state', state: toWire(red, withTiles), seat: g.seat, meta: net.meta });
  }
  // autosave (debounced) so the host can reopen the room after a crash / refresh
  if (over) net.saver.clear();
  else net.saver.schedule(net);
}

/** What the host session save contains (built when it is written, not on every action). */
function hostSnapshot(net: Net) {
  return {
    code: net.code,
    state: App.state,
    guests: net.guests.map(({ token, name, flag, color, seat, replaced }) => ({ token, name, flag, color, seat, replaced })),
    at: Date.now(),
  };
}

export function writeHostSession(net: Net | null) {
  storage(HOST_SESSION, net ? hostSnapshot(net) : null);
}
