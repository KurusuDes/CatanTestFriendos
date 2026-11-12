// Shared plumbing of an online session: PeerJS loading, ICE/TURN servers, persistent device token,
// storage keys and the types both roles use.
import type { Peer, PeerOptions } from 'peerjs';
import { storage } from '@ui/dom';
import type { Conn, VoteChoice } from './messages';

export const PREFIX = 'kchx-v1-';
export const HOST_SESSION = 'katanittes.hostSession';
export const GUEST_SESSION = 'katanittes.guestSession';
const TOKEN_KEY = 'katanittes.token';
export const GRACE_MS = 12000; // time to come back before the table votes
export const PING_MS = 3000;
export const DEAD_MS = 10000; // heartbeat: abrupt signal loss is noticed in ~10s
export const VOTE_MS = 45000;
export const WAIT_MS = 60000; // a "wait" result gives this much extra time
export const CONNECT_MS = 12000;

type PeerCtor = new (id?: string | PeerOptions, options?: PeerOptions) => Peer;

export interface Guest {
  token: string;
  name: string;
  flag: string | null;
  color: string | null;
  conn: Conn | null;
  seat: number | null;
  connected: boolean;
  replaced?: boolean;
  leaving?: boolean;
  lastPong?: number;
  sentStatic?: boolean;
  /** what this guest last received as `board.tiles` (see BoardVersion) */
  tilesKey?: string | number | null;
  pings?: number[];
}

export interface HostVote {
  id: string;
  seat: number;
  name: string;
  votes: Record<string, VoteChoice>;
  voters: number[];
  deadline: number;
}

// TURN relay for friends whose network blocks direct P2P (CGNAT, mobile data, campus wifi).
// PeerJS's bundled TURN hosts no longer resolve, so without our own relay those players can't join.
// Free key: dashboard.metered.ca -> TURN Server -> create app -> API key.
const METERED_APP = ''; // "<app>" in <app>.metered.live
const METERED_KEY = '';
const STUN: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
let iceList: Promise<RTCIceServer[]> | null = null;

export function peerOptions(): Promise<PeerOptions> {
  iceList ||= (async () => {
    if (!METERED_APP || !METERED_KEY) return STUN;
    try {
      const r = await fetch(`https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_KEY}`);
      const turn: unknown = await r.json();
      if (!r.ok || !Array.isArray(turn)) throw new Error('TURN ' + r.status);
      return [...STUN, ...(turn as RTCIceServer[])];
    } catch (e) {
      console.warn('Không có TURN, chỉ P2P trực tiếp:', e);
      iceList = null;
      return STUN;
    }
  })();
  return iceList.then(iceServers => ({ config: { iceServers } }));
}

export function myToken(): string {
  let t = storage(TOKEN_KEY) as string | null;
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    storage(TOKEN_KEY, t);
  }
  return t;
}

let peerLib: Promise<PeerCtor> | null = null;
export function loadPeer(): Promise<PeerCtor> {
  if (peerLib) return peerLib;
  peerLib = import('peerjs')
    .then(m => (m.Peer || (m as unknown as { default: PeerCtor }).default) as PeerCtor)
    .catch(() => {
      peerLib = null;
      throw new Error('Không tải được PeerJS');
    });
  return peerLib;
}

export const makeCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Best-effort close (a dead connection may throw). */
export function safeClose(c: { close(): void } | null | undefined) {
  try {
    c && c.close();
  } catch {
    /* already closed */
  }
}
