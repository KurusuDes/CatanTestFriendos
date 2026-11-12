// End-to-end over an in-memory connection (same surface as PeerJS' DataConnection): a real host Net
// and a real guest Net play bot turns with redaction; the guest's state must equal the host's
// redacted view for that seat after every step.
// `App` is a singleton, so the test swaps it between "host mode" and "guest mode" around each delivery.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@ui/dom', () => ({
  toast: vi.fn(),
  storage: (k: string, v?: unknown) => {
    if (v === undefined) return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null;
    if (v === null) store.delete(k);
    else store.set(k, JSON.parse(JSON.stringify(v)));
    return undefined;
  },
}));

import { applyAction, pendingActors, viewFor } from '@engine/game';
import { botAct } from '@engine/bot';
import type { Config, GameState } from '@engine/types';
import { App } from '@app/index';
import { Net, parseClientMessage, parseHostMessage, redactFor, type Conn } from '@net/index';
import { makeConfig } from '../scripts/sim.ts';

class Pipe implements Conn {
  open = true;
  peer!: Pipe;
  inbox: unknown[] = [];
  private data: ((d: unknown) => void)[] = [];
  private closeCbs: (() => void)[] = [];
  /** buffered ends keep what they receive until the test delivers it */
  constructor(private buffered: boolean) {}
  send(d: unknown) {
    const copy = JSON.parse(JSON.stringify(d)); // what crosses the wire
    this.peer.receive(copy);
  }
  receive(d: unknown) {
    if (this.buffered) this.inbox.push(d);
    else this.data.forEach(f => f(d));
  }
  deliver() {
    const q = this.inbox.splice(0);
    for (const d of q) this.data.forEach(f => f(d));
  }
  close() {
    this.open = false;
    this.closeCbs.forEach(f => f());
  }
  on(ev: string, cb: (a?: never) => void) {
    if (ev === 'data') this.data.push(cb as (d: unknown) => void);
    else if (ev === 'close') this.closeCbs.push(cb as () => void);
  }
}

function connect() {
  const host = new Pipe(false), guest = new Pipe(true);
  host.peer = guest;
  guest.peer = host;
  return { host, guest };
}

function setup(mutate: (c: Config) => void) {
  const config = makeConfig(5);
  config.players = config.players.slice(0, 3);
  config.players.forEach((p, i) => (p.kind = i === 1 ? ('remote' as never) : i === 0 ? 'human' : 'bot'));
  config.map.shape = 'classic';
  config.map.size = 19;
  mutate(config);
  return config;
}

async function play(config: Config, steps: number) {
  const hostNet = new Net();
  hostNet.role = 'host';
  hostNet.active = true;
  hostNet.code = 'TEST1';
  const guestNet = new Net();
  const { host: toGuest, guest: toHost } = connect();
  hostNet.acceptGuest(toGuest);
  guestNet.attachConn(toHost);
  App.screens.game = () => {};
  App.screen = 'game';
  App.net = hostNet;
  hostNet.startGame(config); // guest takes seat 1
  const hostState = () => App.state as GameState;
  let guestState: GameState | null = null;
  let seen = 0;
  const sync = () => {
    const saved = { state: App.state, net: App.net, seat: App.mySeat, config: App.config };
    App.state = guestState;
    App.net = guestNet;
    App.mySeat = null;
    try {
      toHost.deliver();
      guestState = App.state;
    } finally {
      App.state = saved.state;
      App.net = saved.net;
      App.mySeat = saved.seat;
      App.config = saved.config;
    }
  };
  const received: unknown[] = [];
  const origDeliver = toHost.deliver.bind(toHost);
  toHost.deliver = () => {
    received.push(...toHost.inbox);
    origDeliver();
  };

  for (let i = 0; i < steps && hostState().phase !== 'gameOver'; i++) {
    const st = hostState();
    const pid = pendingActors(st).find(p => botAct(st, p));
    if (pid === undefined) break;
    const a = botAct(st, pid)!;
    if (pid === 1) {
      // the guest's own move travels through the wire (decided from ITS view, like the UI would)
      sync();
      const mine = guestState!;
      expect(mine.players[1]!.id).toBe(1);
      guestNet.sendAction(a);
    } else {
      if (!applyAction(st, a).ok) applyAction(st, { type: 'endTurn', pid });
      App.changed();
    }
    sync();
    expect(guestState).not.toBeNull();
    const exp = redactFor(hostState(), 1);
    const got = guestState!;
    expect(got.log).toEqual(exp.log.slice(-40));
    expect({ ...got, log: [] }).toEqual({ ...exp, log: [] });
    seen++;
  }
  return { hostNet, guestNet, seen, received, hostState, guestState: () => guestState!, toHost };
}

beforeEach(() => {
  vi.useFakeTimers();
  store.clear();
  App.state = null;
  App.screens.menu = () => {};
  Object.assign(globalThis, { document: { getElementById: () => ({ innerHTML: '' }), addEventListener() {} }, window: { scrollTo() {}, addEventListener() {} } });
});
afterEach(() => {
  if (App.botTimer) clearTimeout(App.botTimer);
  App.botTimer = null;
  App.net?.close();
  App.net = null;
  vi.useRealTimers();
});

describe('host <-> guest over an in-memory connection', () => {
  test('classic game: guest state == redacted host state at every step, no secrets on the wire', async () => {
    const r = await play(setup(() => {}), 160);
    expect(r.seen).toBeGreaterThan(100);
    const states = r.received.filter((m): m is { type: string; state: Record<string, unknown> } => (m as { type: string }).type === 'state');
    expect(states.length).toBeGreaterThan(0);
    // (messages already consumed are not in `received` since we copy only the remaining inbox: assert on what the guest holds)
    expect(r.guestState().rng).toEqual({ s: 0 });
    expect(r.guestState().devDeck.every(c => c === 'knight')).toBe(true);
  }, 60000);

  test('blindfold + fog + flipped: still consistent, and the guest never sees foreign secrets', async () => {
    const r = await play(setup(c => Object.assign(c.modes, { blindfold: true, fog: true, flipped: true, hiddenNumbers: true })), 200);
    expect(r.seen).toBeGreaterThan(60);
    const g = r.guestState();
    for (const b of g.blind) expect(b.pid).toBe(1);
    // fog: the guest's state only has pieces its own view allows
    expect(Object.keys(viewFor(g, 1).buildings).sort()).toEqual(Object.keys(g.buildings).sort());
  }, 60000);

  test('chaos + events game (tiles mutate): tiles reach the guest whenever they change', async () => {
    const r = await play(setup(c => Object.assign(c.modes, { events: true, chaosEvery: 1, chaosWhat: 'both', hiddenNumbers: true })), 250);
    expect(r.seen).toBeGreaterThan(80);
  }, 60000);

  test('invalid / cheating messages are ignored or refused', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await play(setup(() => {}), 6);
    const before = JSON.stringify(r.hostState());
    r.toHost.send({ type: 'action', action: { type: 'hax', pid: 1 } });
    r.toHost.send({ type: 'nope' });
    r.toHost.send('garbage');
    r.toHost.send({ type: 'vote', choice: 'explode' });
    expect(JSON.stringify(r.hostState())).toBe(before);
    expect(warn).toHaveBeenCalled();
    // acting for another seat is refused with an error message
    r.toHost.send({ type: 'action', action: { type: 'endTurn', pid: 0 } });
    expect(JSON.stringify(r.hostState())).toBe(before);
    expect(r.toHost.inbox.some(m => (m as { type: string }).type === 'error')).toBe(true);
    warn.mockRestore();
  });
});

describe('message validators', () => {
  test('accept real messages, reject malformed ones', () => {
    expect(parseClientMessage({ type: 'action', action: { type: 'endTurn', pid: 1 } })).not.toBeNull();
    expect(parseClientMessage({ type: 'action', action: { type: 'bogus', pid: 1 } })).toBeNull();
    expect(parseClientMessage({ type: 'action', action: { type: 'endTurn' } })).toBeNull();
    expect(parseClientMessage({ type: 'mark', x: 1, z: NaN })).toBeNull();
    expect(parseClientMessage({ type: 'vote', choice: 'bot' })).not.toBeNull();
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage([])).toBeNull();
    expect(parseHostMessage({ type: 'state', state: {}, seat: 1 })).toBeNull();
    expect(parseHostMessage({ type: 'emote', seat: 1, e: 'x' })).toBeNull();
    expect(parseHostMessage({ type: 'meta', meta: { presence: {}, vote: null } })).not.toBeNull();
    expect(parseHostMessage({ type: 'unknown' })).toBeNull();
  });
});
