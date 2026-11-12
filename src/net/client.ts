// Guest side of an online room: sends actions and renders the (redacted) state the host sends.
// A guest never runs the rules engine: it only needs `viewFor`-style queries on the received state.
import type { GameState } from '@engine/types';
import { App } from '@app/index';
import { toast, storage } from '@ui/dom';
import { parseHostMessage, type Conn, type HostMessage, type WireState } from './messages';
import type { Net } from './index';
import { CONNECT_MS, DEAD_MS, GUEST_SESSION, PING_MS, PREFIX, loadPeer, myToken, peerOptions, safeClose } from './session';

export async function clientJoin(net: Net, code: string, name: string, kingdom: Net['kingdom'] | undefined, onStatus?: (s: string) => void) {
  await loadPeer();
  net.role = 'client';
  net.active = true;
  net.code = code.toUpperCase().trim();
  net.name = name;
  net.kingdom = kingdom || {};
  net.onStatus = onStatus || (() => {});
  storage(GUEST_SESSION, { code: net.code, name, at: Date.now() });
  await clientConnect(net, true);
}

export async function clientConnect(net: Net, first: boolean): Promise<void> {
  const Peer = await loadPeer();
  const opts = await peerOptions();
  if (!net.peer || net.peer.destroyed) {
    await new Promise<void>((res, rej) => {
      const p = new Peer(opts);
      net.peer = p;
      p.on('open', () => res());
      p.on('error', e => {
        if (e.type === 'peer-unavailable') {
          if (first && !net.everConnected) rej(new Error('Không có phòng nào mang mã này'));
        } else if (!net.everConnected && first) rej(new Error(`Lỗi mạng: ${e.type}`));
      });
      p.on('disconnected', () => net.active && !p.destroyed && setTimeout(() => p.reconnect(), 1500));
    });
  }
  return new Promise<void>((res, rej) => {
    const c = net.peer!.connect(PREFIX + net.code, { reliable: true }) as unknown as Conn;
    const timer = setTimeout(() => {
      if (first && !net.everConnected) rej(new Error('Phòng có tồn tại nhưng không kết nối được: mạng của bạn chặn kết nối trực tiếp. Hãy thử wifi khác hoặc dữ liệu di động.'));
      else {
        safeClose(c);
        clientRetry(net);
      }
      res();
    }, CONNECT_MS);
    attachClient(net, c, () => {
      clearTimeout(timer);
      res();
    });
  });
}

/** wire a connection to the host (PeerJS or an in-memory pipe in tests); `done` fires once it is open */
export function attachClient(net: Net, c: Conn, done: () => void = () => {}) {
  const onOpen = () => {
    net.conn = c;
    net.everConnected = true;
    net.reconnecting = false;
    net.lastPing = Date.now();
    clearInterval(net.hb);
    net.hb = setInterval(() => {
      // the host vanished without closing the channel (crash / signal loss)
      if (net.active && net.conn === c && !net.reconnecting && Date.now() - net.lastPing > DEAD_MS) {
        safeClose(c);
        clientRetry(net);
      }
    }, PING_MS);
    c.send({ type: 'hello', name: net.name, token: myToken(), flag: net.kingdom.flag, color: net.kingdom.color });
    net.onStatus('connected');
    App.notifyMeta();
    done();
  };
  c.on('open', onOpen);
  c.on('data', msg => onClientData(net, msg));
  c.on('close', () => {
    if (!net.active || net.conn !== c) return;
    clientRetry(net);
  });
  if (c.open) onOpen();
}

function clientRetry(net: Net) {
  if (!net.active) return;
  if (!net.reconnecting) {
    net.reconnecting = true;
    net.retryUntil = Date.now() + 10 * 60000;
    toast('📡 Mất kết nối. Đang kết nối lại...', 'error', 4000);
    net.onStatus('reconnecting');
    App.notifyMeta();
  }
  if (Date.now() > net.retryUntil) {
    net.reconnecting = false;
    net.onStatus('closed');
    toast('🔌 Không quay lại phòng được', 'error', 6000);
    return;
  }
  clearTimeout(net.retryTimer);
  net.retryTimer = setTimeout(() => clientConnect(net, false).catch(() => clientRetry(net)), 3000);
}

/** rebuild a full-shaped GameState (for the UI's queries) from what the host sent */
function fromWire(net: Net, w: WireState, tiles: NonNullable<Net['tiles']>): GameState {
  const { devDeckN, players, board, ...rest } = w;
  return {
    ...rest,
    config: net.config!,
    devDeck: Array.from({ length: devDeckN }, () => 'knight' as const),
    players: players.map((p, i) => ({ ...p, flag: net.flags[i] || null })),
    board: { ...net.static!, ...board, tiles },
  };
}

function onClientData(net: Net, raw: unknown) {
  const msg: HostMessage | null = parseHostMessage(raw);
  if (!msg) {
    console.warn('[net] mensaje del host inválido, se ignora:', raw);
    return;
  }
  net.lastPing = Date.now();
  switch (msg.type) {
    case 'ping':
      if (net.conn && net.conn.open) net.conn.send({ type: 'pong' });
      return;
    case 'welcome':
      net.onStatus('waiting');
      return;
    case 'lobby':
      net.lobby = msg.lobby;
      App.notifyLobby();
      return;
    case 'refused':
    case 'kicked':
    case 'closed': {
      const text = msg.type === 'refused' ? msg.msg : msg.type === 'kicked' ? '👢 Chủ phòng đã mời bạn ra khỏi phòng.' : '🚪 Chủ phòng đã đóng phòng.';
      toast(text, 'error', 6000);
      storage(GUEST_SESSION, null);
      net.close();
      if (App.net === net) App.net = null;
      if (App.screen === 'game') App.leaveGame();
      else App.go('online');
      return;
    }
    case 'error':
      toast(msg.msg, 'error', 5000);
      return;
    case 'init':
      net.static = msg.board;
      net.config = msg.config;
      net.flags = msg.flags;
      net.tiles = null;
      return;
    case 'mark':
      App.deliverPing(msg.seat, msg.x, msg.z);
      return;
    case 'meta':
      net.meta = msg.meta;
      App.notifyMeta(msg.meta);
      return;
    case 'state': {
      if (!net.static || !net.config) return;
      if (msg.state.board.tiles) net.tiles = msg.state.board.tiles;
      else if (!net.tiles) return;
      const st = fromWire(net, msg.state, net.tiles!);
      net.meta = msg.meta || net.meta;
      App.mySeat = msg.seat;
      App.state = st;
      App.config = st.config;
      if (App.screen !== 'game') App.go('game');
      App.changed();
      return;
    }
  }
}
