// Wire protocol between host and guests: typed unions + hand-written runtime guards.
// Anything arriving over the data channel is untrusted: `parseHostMessage` / `parseClientMessage`
// return null for malformed messages (callers ignore and log them).
import type { Action, ActionType, Board, Config, GameState, Player } from '@engine/types';

// ---------- shared shapes ----------
export interface Presence {
  [seat: number]: boolean;
}
export interface VoteInfo {
  id: string;
  seat: number;
  name: string;
  votes: Record<string, VoteChoice>;
  voters: number[];
  left: number;
}
export interface Meta {
  presence: Presence;
  vote: VoteInfo | null;
}
export type VoteChoice = 'wait' | 'bot' | 'remove';
const VOTE_CHOICES: readonly VoteChoice[] = ['wait', 'bot', 'remove'];

export interface LobbyPlayer {
  name: string;
  flag: string | null;
  color: string | null;
}
export interface HostInfo {
  name: string;
  flag: string | null;
  color: string;
}
export interface LobbyInfo {
  code: string | null;
  capacity: number;
  open: boolean;
  host: HostInfo;
  players: LobbyPlayer[];
}

/** Board geometry: constant during a game, sent once per connection in `init`. */
export type StaticBoard = Pick<Board, 'vertices' | 'edges' | 'sea' | 'ports' | 'bounds'>;
export const STATIC_KEYS = ['vertices', 'edges', 'sea', 'ports', 'bounds'] as const;

/** A redacted + slimmed state as it travels: no config/flags/static board, deck as a count, tiles only when changed. */
export type WireState = Omit<GameState, 'config' | 'board' | 'players' | 'devDeck'> & {
  board: Omit<Board, (typeof STATIC_KEYS)[number] | 'tiles'> & { tiles?: Board['tiles'] };
  players: Omit<Player, 'flag'>[];
  devDeckN: number;
};

// ---------- host -> client ----------
export type HostMessage =
  | { type: 'ping'; t: number }
  | { type: 'welcome'; code: string | null }
  | { type: 'lobby'; lobby: LobbyInfo }
  | { type: 'refused'; msg: string }
  | { type: 'kicked' }
  | { type: 'closed' }
  | { type: 'error'; msg: string }
  | { type: 'init'; board: StaticBoard; config: Config; flags: (string | null)[] }
  | { type: 'mark'; seat: number; x: number; z: number }
  | { type: 'meta'; meta: Meta }
  | { type: 'state'; state: WireState; seat: number | null; meta: Meta };

// ---------- client -> host ----------
export type ClientMessage =
  | { type: 'hello'; name: string; token: string; flag?: string | null; color?: string | null }
  | { type: 'pong' }
  | { type: 'action'; action: Action }
  | { type: 'mark'; x: number; z: number }
  | { type: 'vote'; choice: VoteChoice; voteId?: string }
  | { type: 'bye' };

// ---------- guards ----------
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

const ACTION_TYPES: ReadonlySet<string> = new Set<ActionType>([
  'placeSettlement', 'placeRoad', 'roll', 'discard', 'moveRobber', 'build', 'endRoadBuilding', 'buyDev', 'playDev',
  'bankTrade', 'proposeTrade', 'respondTrade', 'confirmTrade', 'cancelTrade', 'endTurn', 'setController', 'retirePlayer',
]);

/** Shape check only (type known, pid numeric): the engine validates the rest and rejects garbage with an error. */
function isAction(v: unknown): v is Action {
  return isRec(v) && isStr(v.type) && ACTION_TYPES.has(v.type) && isNum(v.pid);
}

function isMeta(v: unknown): v is Meta {
  return isRec(v) && isRec(v.presence) && (v.vote === null || v.vote === undefined || (isRec(v.vote) && isStr(v.vote.id) && isNum(v.vote.seat)));
}

function isLobby(v: unknown): v is LobbyInfo {
  return isRec(v) && isNum(v.capacity) && typeof v.open === 'boolean' && isRec(v.host) && isArr(v.players);
}

function isWireState(v: unknown): v is WireState {
  return (
    isRec(v) && isRec(v.board) && isArr(v.players) && v.players.every(isRec) && isArr(v.log) && isArr(v.fx) &&
    isStr(v.phase) && isNum(v.current) && isNum(v.devDeckN) && isRec(v.setup) && isRec(v.bank) &&
    isRec(v.buildings) && isRec(v.roads) && isArr(v.blind) && isRec(v.pendingDiscards) &&
    (v.board.tiles === undefined || isArr(v.board.tiles))
  );
}

function isStaticBoard(v: unknown): v is StaticBoard {
  return isRec(v) && STATIC_KEYS.every(k => v[k] !== undefined && v[k] !== null);
}

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isRec(raw) || !isStr(raw.type)) return null;
  const m = raw;
  switch (m.type) {
    case 'ping': return isNum(m.t) ? (m as HostMessage) : null;
    case 'welcome': return m.code === null || isStr(m.code) ? (m as HostMessage) : null;
    case 'lobby': return isLobby(m.lobby) ? (m as HostMessage) : null;
    case 'refused':
    case 'error': return isStr(m.msg) ? (m as HostMessage) : null;
    case 'kicked':
    case 'closed': return m as HostMessage;
    case 'init': return isStaticBoard(m.board) && isRec(m.config) && (m.flags === undefined || isArr(m.flags)) ? ({ ...m, flags: m.flags ?? [] } as HostMessage) : null;
    case 'mark': return isNum(m.seat) && isNum(m.x) && isNum(m.z) ? (m as HostMessage) : null;
    case 'meta': return isMeta(m.meta) ? (m as HostMessage) : null;
    case 'state': return isWireState(m.state) && (m.seat === null || m.seat === undefined || isNum(m.seat)) && (m.meta === undefined || isMeta(m.meta)) ? ({ ...m, seat: m.seat ?? null } as HostMessage) : null;
    default: return null;
  }
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRec(raw) || !isStr(raw.type)) return null;
  const m = raw;
  switch (m.type) {
    case 'hello': return (m.token === undefined || isStr(m.token)) && (m.name === undefined || isStr(m.name)) ? ({ ...m, token: m.token ?? '', name: m.name ?? '' } as ClientMessage) : null;
    case 'pong':
    case 'bye': return m as ClientMessage;
    case 'action': return isAction(m.action) ? (m as ClientMessage) : null;
    case 'mark': return isNum(m.x) && isNum(m.z) ? (m as ClientMessage) : null;
    case 'vote': return isStr(m.choice) && (VOTE_CHOICES as readonly string[]).includes(m.choice) && (m.voteId === undefined || isStr(m.voteId)) ? (m as ClientMessage) : null;
    default: return null;
  }
}

/** Minimal slice of PeerJS' DataConnection the net layer uses (lets tests plug an in-memory pipe in). */
export interface Conn {
  open: boolean;
  send(data: unknown): void;
  close(): void;
  on(event: 'data', cb: (data: unknown) => void): void;
  on(event: 'open' | 'close' | 'error', cb: (arg?: unknown) => void): void;
}
