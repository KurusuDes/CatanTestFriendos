// Online play over WebRTC (PeerJS public broker). The host runs the rules engine and the bots;
// guests only send actions and receive their own redacted view of the state.
//
// Robustness:
//  - every device has a persistent token, so a player who loses signal gets their seat back when
//    they reconnect (guests retry automatically for 10 minutes);
//  - when someone stays disconnected the table votes: wait, replace with a bot or retire them
//    (a bot seat is handed back if the player returns);
//  - the host autosaves the session and can reopen the room with the same code.
//
// `Net` is the object the UI holds (`App.net`); the role-specific logic lives in host.ts / client.ts.
import type { Peer } from 'peerjs';
import type { Action, Config, GameState, Tile } from '@engine/types';
import { App, createSaver, type Saver } from '@app/index';
import { toast, storage } from '@ui/dom';
import { BoardVersion } from './boardVersion';
import { attachClient, clientConnect, clientJoin } from './client';
import {
  broadcastState, castVote, hostOpen, metaFor, pushMeta, startHostGame, startVote, writeHostSession, attachGuest,
} from './host';
import type { Conn, HostInfo, LobbyInfo, Meta, StaticBoard } from './messages';
import { GRACE_MS, HOST_SESSION, safeClose, type Guest, type HostVote } from './session';

export { HOST_SESSION, GUEST_SESSION } from './session';
export * from './messages';
export { redactFor } from './redact';

interface SavedHostSession {
  code: string;
  state: GameState;
  guests: Pick<Guest, 'token' | 'name' | 'flag' | 'color' | 'seat' | 'replaced'>[];
  at: number;
}

export class Net {
  active = false;
  role: 'host' | 'client' | null = null;
  peer: Peer | null = null;
  code: string | null = null;
  guests: Guest[] = []; // host
  vote: HostVote | null = null; // host
  meta: Meta = { presence: {}, vote: null }; // what clients see
  conn: Conn | null = null; // client -> host
  onChange: () => void = () => {};
  onRefused?: (why: string, name: string) => void;
  timers = new Map<number, ReturnType<typeof setTimeout>>();
  hb: ReturnType<typeof setInterval> | undefined;
  voteTimer: ReturnType<typeof setInterval> | undefined;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  // room settings (host) / what the waiting room shows (guest)
  capacity = 4;
  open = true;
  hostInfo: HostInfo = { name: 'Chủ phòng', flag: null, color: '#e53935' };
  lobby: LobbyInfo | null = null;
  // host: debounced session autosave + tile change tracking
  readonly saver: Saver<Net> = createSaver<Net>(n => writeHostSession(n));
  readonly boardVersion = new BoardVersion();
  // client
  name = '';
  kingdom: { flag?: string | null; color?: string | null } = {};
  onStatus: (s: string) => void = () => {};
  everConnected = false;
  reconnecting = false;
  lastPing = 0;
  retryUntil = 0;
  static: StaticBoard | null = null;
  config: Config | null = null;
  flags: (string | null)[] = [];
  tiles: Tile[] | null = null;

  // ---------- room management (host) ----------
  setRoom({ capacity, open, hostInfo }: { capacity?: number; open?: boolean; hostInfo?: HostInfo } = {}) {
    if (capacity) this.capacity = Math.max(2, Math.min(8, capacity));
    if (open != null) this.open = open;
    if (hostInfo) this.hostInfo = hostInfo;
    this.pushLobby();
    this.onChange();
  }

  lobbyInfo(): LobbyInfo {
    return {
      code: this.code, capacity: this.capacity, open: this.open, host: this.hostInfo,
      players: this.guests.filter(g => g.connected).map(g => ({ name: g.name, flag: g.flag, color: g.color })),
    };
  }

  pushLobby() {
    if (this.role !== 'host' || (App.state && App.state.phase !== 'gameOver')) return;
    const info = this.lobbyInfo();
    for (const g of this.guests) if (g.conn && g.conn.open) g.conn.send({ type: 'lobby', lobby: info });
  }

  kick(token: string) {
    const g = this.guests.find(x => x.token === token);
    if (!g) return;
    try {
      g.conn && g.conn.send({ type: 'kicked' });
    } catch {
      /* gone already */
    }
    setTimeout(() => safeClose(g.conn), 150);
    this.guests = this.guests.filter(x => x !== g);
    toast(`👢 ${g.name} đã bị đuổi khỏi phòng`);
    this.pushLobby();
    this.onChange();
  }

  closeRoom() {
    for (const g of this.guests)
      try {
        g.conn && g.conn.open && g.conn.send({ type: 'closed' });
      } catch {
        /* gone already */
      }
    this.saver.clear();
    storage(HOST_SESSION, null);
    this.close();
  }

  // ================= HOST =================
  host(code?: string): Promise<string> {
    return hostOpen(this, code);
  }
  /** an already-open connection from a guest (PeerJS does this itself; tests use it) */
  acceptGuest(conn: Conn) {
    attachGuest(this, conn);
  }
  startGame(config: Config) {
    startHostGame(this, config);
  }
  broadcastState(st: GameState) {
    broadcastState(this, st);
  }
  pushMeta() {
    pushMeta(this);
  }
  metaFor(): Meta {
    return metaFor(this);
  }
  startVote(seat: number) {
    startVote(this, seat);
  }
  castVote(seat: number, choice: string, voteId?: string) {
    castVote(this, seat, choice, voteId);
  }

  static async reopen(): Promise<Net> {
    const s = storage(HOST_SESSION) as SavedHostSession | null;
    if (!s) throw new Error('Không có phòng nào được lưu');
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
      if (g.seat == null) continue;
      const seat = g.seat;
      const p = s.state.players[seat];
      if (p && !p.retired && p.kind === 'human') net.timers.set(seat, setTimeout(() => net.startVote(seat), GRACE_MS * 2));
    }
    return net;
  }

  // ================= GUEST =================
  join(code: string, name: string, kingdom?: Net['kingdom'], onStatus?: (s: string) => void) {
    return clientJoin(this, code, name, kingdom, onStatus);
  }
  connect(first: boolean) {
    return clientConnect(this, first);
  }
  /** an already-open connection to the host (tests) */
  attachConn(conn: Conn) {
    this.role = 'client';
    this.active = true;
    attachClient(this, conn);
  }

  sendPing(x: number, z: number) {
    if (this.conn && this.conn.open) this.conn.send({ type: 'mark', x, z });
  }
  relayPing(seat: number, x: number, z: number) {
    for (const g of this.guests) if (g.conn && g.conn.open) g.conn.send({ type: 'mark', seat, x, z });
  }
  sendAction(a: Action) {
    if (this.conn && this.conn.open) this.conn.send({ type: 'action', action: a });
    else toast('Mất kết nối với chủ phòng: đang kết nối lại...', 'error');
  }

  // ================= both =================
  sendVote(choice: string) {
    const v = this.meta.vote || (this.vote && this.metaFor().vote);
    if (!v) return;
    if (this.role === 'host') this.castVote(App.mySeat!, choice, v.id);
    else if (this.conn && this.conn.open) this.conn.send({ type: 'vote', choice, voteId: v.id });
  }

  presence(seat: number): boolean | undefined {
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
    this.saver.flush();
    this.saver.dispose();
    try {
      if (this.role === 'client' && this.conn && this.conn.open) this.conn.send({ type: 'bye' });
    } catch {
      /* gone already */
    }
    setTimeout(() => {
      try {
        this.peer && this.peer.destroy();
      } catch {
        /* already destroyed */
      }
    }, 150);
  }
}
