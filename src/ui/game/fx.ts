// Imperative effects of the game screen: sounds, toasts, cards flying between tiles / hands / the bank
// (Web Animations), emote balloons on the 3D board, pings. Everything here runs ONCE per new state
// (`processFx`, keyed by the identity of `state.fx`, which the engine replaces on every action), never
// per re-render; the DOM it builds lives outside Preact (appended to <body>, like the old screen did)
// and is pixelized explicitly on creation.
import { RES, TILE_INFO, DEV_INFO, EVENTS } from '@engine/constants';
import type { GameState, Fx, Res } from '@engine/types';
import { App, store } from '@app/index';
import { h, rich, toast } from '../dom.js';
import { pxIcon, pixelize } from '../pixel.js';
import { play } from '../sfx.js';
import { celebrate } from '../adhd.js';
import { announces, boards, boardNudge, cardEmotes, confettiOn, diceAnim, gains, localHumans, modal, pick } from './signals';

export const S = {
  /** bumped on mount/unmount: delayed callbacks of a previous game screen check it and give up */
  epoch: 0,
  rolled: 0,
  rolledAt: 0,
  diceLand: 1150,
  pulseTiles: new Set<number>(),
  pulseAt: 0,
  flipAt: 0,
  flipPending: false,
  lastCurrent: null as number | null,
  lastFx: null as Fx[] | null,
  winnerShown: false,
  sent: [] as number[],
  pinged: [] as number[],
  seq: 0,
};

export function resetFx(): void {
  S.epoch++;
  S.rolled = S.rolledAt = S.pulseAt = S.flipAt = 0;
  S.diceLand = 1150;
  S.pulseTiles = new Set();
  S.flipPending = false;
  S.lastCurrent = null;
  S.lastFx = null;
  S.winnerShown = false;
  S.sent = [];
  S.pinged = [];
}

/** run `fn` later, unless the screen was left meanwhile */
const later = (ms: number, fn: () => void): void => {
  const e = S.epoch;
  setTimeout(() => e === S.epoch && fn(), ms);
};

// ---------------- entry point: once per new state ----------------
export function processFx(st: GameState): void {
  if (st.fx !== S.lastFx) {
    S.lastFx = st.fx;
    handleFx(st);
  }
  if (st.current !== S.lastCurrent) {
    S.lastCurrent = st.current;
    pick.value = null;
    if (st.phase !== 'setup' && localHumans(st).includes(st.current)) play.turn();
  }
  if (st.phase === 'gameOver' && !S.winnerShown) {
    S.winnerShown = true;
    // a rematch may have started in the meantime: `later` drops it when the screen was remounted
    later(1200, openGameOver);
  }
}

export function openGameOver(): void {
  const st = store.state.peek();
  if (st && st.phase === 'gameOver' && st.winner != null) modal.value = { kind: 'gameOver' };
}

const spread = (o: Partial<Record<Res, number>>): Res[] => RES.flatMap(r => Array<Res>(o[r] || 0).fill(r));

function handleFx(st: GameState): void {
  if (!st.fx || !st.fx.length) return;
  const v = store.viewer.peek();
  // the cards wait for the 3D dice to land before flying off the tiles
  const rolledNow = st.fx.some(f => f.kind === 'dice');
  const host = !App.isClient();
  for (const f of st.fx) {
    switch (f.kind) {
      case 'dice': {
        S.rolled = f.dice[0] + f.dice[1];
        S.rolledAt = Date.now();
        diceAnim.value++;
        // the cards take off from the tiles once the dice have settled (later for a hard throw)
        S.diceLand = (boards.d3 ? boards.d3.rollDice(f.dice, S.rolledAt, f.power) : 1250) - 100;
        play.dice(f.power);
        if (S.rolled === 7) later(350, () => play.robber());
        const cur = st.players[st.current];
        if (host && S.rolled === 7 && cur && cur.kind === 'bot' && Math.random() < 0.3) botEmote(st.current, ['😈', '🦹', '😏']);
        break;
      }
      case 'gain': {
        const id = ++S.seq;
        gains.value = [...gains.value, { id, pid: f.pid, text: `+${f.n}${TILE_INFO[f.res].icon}` }];
        later(1600, () => (gains.value = gains.value.filter(g => g.id !== id)));
        if (!flyGain(st, f, v, rolledNow ? S.diceLand : 0) && f.pid === v) {
          bumpHand(f.res);
          play.gain();
        }
        break;
      }
      case 'build':
        if (!f.hidden || f.pid === v) play.build();
        break;
      case 'steal': {
        // only the two involved see which card it was
        const res = f.res;
        flyCards(res ? [res] : ['wood'], f.from, f.to, v, { hidden: res == null || (f.from !== v && f.to !== v) });
        if (res && f.from === v) toast(h('span', null, rich(`🫳 @${f.to} cướp của bạn ${TILE_INFO[res].icon}`, st.players)), 'error');
        else if (res && f.to === v) toast(h('span', null, rich(`🫳 Bạn cướp của @${f.from}: ${TILE_INFO[res].icon}`, st.players)), 'good');
        if (host && st.players[f.from]!.kind === 'bot' && Math.random() < 0.45) botEmote(f.from, ['😡', '😤', '💀', '😭']);
        break;
      }
      case 'robber':
        play.robber();
        break;
      case 'event': {
        const def = EVENTS.find(e => e.id === f.event.id);
        announce(f.event.icon, f.event.name, def ? def.desc : '');
        play.event();
        break;
      }
      case 'chaos':
        announce('🌀', 'Đất chuyển mình!', 'Bản đồ vừa bị xáo trộn');
        play.event();
        break;
      case 'blindReveal': {
        const bad = f.placements.filter(p => !p.ok).length;
        announce('🙈', 'LẬT MỞ!', bad ? `${bad} chỗ bị trùng: phải dời nhà` : 'Không ai trùng chỗ. May ghê!');
        play.reveal();
        break;
      }
      case 'revealTile':
        S.pulseTiles.add(f.tile);
        S.pulseAt = Date.now();
        break;
      case 'award':
        toast(rich(f.what === 'road' ? `🛣️ Con đường dài nhất: @${f.pid}` : `⚔️ Đội quân lớn nhất: @${f.pid}`, st.players), 'good');
        break;
      case 'trade':
        flyCards(spread(f.give), f.a, f.b, v);
        flyCards(spread(f.get), f.b, f.a, v, { delay: 160 });
        break;
      case 'bankTrade':
        flyCards(Array<Res>(f.n).fill(f.give), f.pid, 'bank', v);
        flyCards([f.get], 'bank', f.pid, v, { delay: 420 + Math.min(f.n, 6) * 90 });
        break;
      case 'discard':
        flyCards(spread(f.res), f.pid, 'bank', v);
        break;
      case 'fromBank':
        flyCards(f.res, 'bank', f.pid, v);
        break;
      case 'monopoly':
        f.from.forEach(([o, n], i) => flyCards(Array<Res>(n).fill(f.res), o, f.pid, v, { delay: i * 200 }));
        break;
      case 'devBought':
        if (f.pid === v) toast(`🃏 Bạn mua được: ${DEV_INFO[f.type].icon} ${DEV_INFO[f.type].name}`, 'good');
        break;
      case 'win':
        play.win();
        confetti();
        if (host && st.players[f.pid] && st.players[f.pid]!.kind === 'bot') botEmote(f.pid, ['😎', '🏆', '🎉']);
        break;
      case 'cheer':
        celebrate(f.pid, f.n);
        break;
      case 'flipAll':
        S.flipAt = Date.now();
        S.flipPending = true;
        announce('🙈', 'LẬT BÀN CỜ!', 'Giờ ai cũng thấy bên dưới có gì');
        play.reveal();
        break;
      case 'relocated':
        if (f.pid === v) toast('🌑 Có người trong sương mù! Công trình của bạn bị dời sang chỗ trống gần nhất.', 'error', 3500);
        break;
      case 'blocked':
        if (f.pid === v) toast('🌑 Bạn đụng phải ai đó trong sương mù! Không còn chỗ trống: bạn không mất gì.', 'error', 3500);
        break;
    }
  }
}

function announce(icon: string, title: string, desc: string): void {
  const id = ++S.seq;
  announces.value = [...announces.value, { id, icon, title, desc }];
  setTimeout(() => (announces.value = announces.value.filter(a => a.id !== id)), 2700);
}

function confetti(): void {
  confettiOn.value++;
  const n = confettiOn.value;
  setTimeout(() => confettiOn.value === n && (confettiOn.value = 0), 5500);
}

// ---------------- resources flying from the tiles to the hands ----------------
// returns false when there is nothing to fly (no 3D map), so the caller bumps the card right away
function flyGain(st: GameState, f: Extract<Fx, { kind: 'gain' }>, v: number, delay: number): boolean {
  const b = boards.d3;
  if (!b || !f.tiles || !f.tiles.length) return false;
  if (st.config.modes.fog && f.pid !== v) return true; // don't reveal where the others produce
  const mine = f.pid === v, tiles = f.tiles;
  later(delay, () => {
    for (let i = 0; i < Math.min(f.n, 5); i++) later(i * 120, () => flyOne(f.res, tiles[i % tiles.length]!, f.pid, mine, i === 0));
  });
  return true;
}

function flyOne(res: Res, tile: number, pid: number, mine: boolean, first: boolean): void {
  const b = boards.d3, pt = b && b.tilePoint(tile);
  const from = pt && b!.toScreen(pt.x, pt.y, pt.z);
  if (from) flyCard(res, from, () => cardsOf(pid, res, mine), { mine, sound: mine && first });
}

// ---------------- cards flying between hands, players and the bank ----------------
interface Pt { x: number; y: number }

// centre of an element on screen, null when it isn't laid out (hidden panel on a phone)
function centre(el: Element | null | undefined): Pt | null {
  const r = el && el.getBoundingClientRect();
  return r && (r.width || r.height) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

// where a player's cards are drawn: the card of that resource in your own hand, or their card in the list
function cardsOf(pid: number, res: Res, mine: boolean): Element | null {
  const hand = mine ? document.querySelectorAll('.actionbar .hand .rcard') : null;
  return hand && hand.length ? hand[RES.indexOf(res)] || null : (document.querySelector('.players')?.children[pid] ?? null);
}
function bankOf(res: Res): Element | null {
  const bank = document.querySelector('.bank-info');
  return centre(bank) ? bank!.children[1 + RES.indexOf(res)] || bank : document.querySelector('.board-wrap');
}

// a card's "bump" when something lands on it; a Web Animation restarts without forcing a layout
export function bumpEl(c: Element): void {
  const small = c.classList.contains('pcard');
  c.animate(
    [{ transform: 'none' }, { transform: small ? 'translateY(-4px) scale(1.03)' : 'translateY(-10px) scale(1.12)', offset: 0.4 }, { transform: 'none' }],
    small ? 450 : c.classList.contains('rcard') ? 500 : 450
  );
}

function bumpHand(res: Res): void {
  requestAnimationFrame(() => {
    const c = document.querySelectorAll('.actionbar .hand .rcard')[RES.indexOf(res)];
    if (c) bumpEl(c);
  });
}

// cards travel one after another from `a` to `b` (a player id or 'bank'); `hidden` shows their backs
function flyCards(list: Res[], a: number | 'bank', b: number | 'bank', v: number, o: { hidden?: boolean; delay?: number } = {}): void {
  const spot = (who: number | 'bank', res: Res) => (who === 'bank' ? bankOf(res) : cardsOf(who, res, who === v));
  later(o.delay || 0, () => {
    // one read pass for every source/target rect, then the cards go in (staggered with the animation delay)
    const batch: { res: Res; i: number; from: Pt; to: Pt }[] = [];
    list.slice(0, 7).forEach((res, i) => {
      const from = centre(spot(a, res));
      const to = from && centre(spot(b, res));
      if (from && to) batch.push({ res, i, from, to });
    });
    for (const { res, i, from, to } of batch)
      flyCard(res, from, () => spot(b, res), { mine: b === v, sound: b === v && i === 0, hidden: o.hidden, short: true, to, delay: i * 90 });
  });
}

interface FlyOpts { mine?: boolean; sound?: boolean; hidden?: boolean; short?: boolean; to?: Pt; delay?: number }

function flyCard(res: Res, from: Pt, target: () => Element | null, o: FlyOpts = {}): void {
  const to = o.to || centre(target());
  if (!to) return;
  const delay = o.delay || 0;
  const lift = o.short ? 16 : 34;
  const mid = { x: (from.x + to.x) / 2 + (Math.random() - 0.5) * (o.short ? 60 : 120), y: Math.min(from.y, to.y) - (o.short ? 40 : 70) - Math.random() * 40 };
  const at = (p: Pt, s: number) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
  const el = h('div', { class: 'fly-res' + (o.mine ? ' mine' : '') }, o.hidden ? h('i', { class: 'fly-back' }) : pxIcon(TILE_INFO[res].icon.replace(/️/g, ''), 32));
  document.body.append(el);
  const e = S.epoch;
  const anim = el.animate([
    { transform: at(from, 0.3), opacity: 0 },
    { transform: at({ x: from.x, y: from.y - lift }, o.short ? 1.1 : 1.35), opacity: 1, offset: 0.18 },
    { transform: at(mid, 1.05), opacity: 1, offset: 0.58 },
    { transform: at(to, o.mine ? 0.95 : 0.55), opacity: o.mine ? 1 : 0.4 },
  ], { duration: o.short ? 800 : 950, delay, fill: 'backwards', easing: 'cubic-bezier(.4,0,.6,1)' });
  setTimeout(() => el.remove(), 2500 + delay); // hidden tabs may never finish the animation
  anim.onfinish = () => {
    el.remove();
    const c = e === S.epoch ? target() : null;
    if (!c) return;
    bumpEl(c);
    if (o.sound) play.gain();
  };
}

// ---------------- reactions: emojis that float up from your buildings ----------------
export const EMOTES = ['😂', '🤣', '😎', '😡', '😭', '😱', '🤔', '🙏', '👏', '🔥', '💀', '😈', '👀', '❤️', '🤝', '🎉', '🐑', '🌾', '🧱', '🌲', '⛰️', '🎲', '🦹', '🏆'];
export const ONLY_EMOJI = /^(\p{Extended_Pictographic}|️|‍){1,4}$/u;

function botEmote(pid: number, options: string[]): void {
  const e = options[Math.floor(Math.random() * options.length)]!;
  later(500 + Math.random() * 900, () => store.state.peek() && App.emote(pid, e));
}

export function sendEmote(e: string): void {
  const v = store.viewer.peek();
  if (v == null || v < 0) return toast('Chỉ người chơi mới thả cảm xúc được', 'error');
  const now = Date.now();
  S.sent = S.sent.filter(t => now - t < 4000);
  if (S.sent.length >= 5) return toast('Từ từ thôi 😅', 'error', 1500);
  S.sent.push(now);
  App.emote(v, e);
}

export function showEmote(seat: number, e: string): void {
  const st = store.state.peek();
  if (!st || !st.players[seat]) return;
  const p = st.players[seat]!;
  const short = ONLY_EMOJI.test(e);
  play.pop();
  // on the player's card (always visible, even when their buildings are off screen)
  const entry = { pid: seat, e, at: Date.now() };
  cardEmotes.value = [...cardEmotes.value.filter(x => x.pid !== seat), entry];
  later(3100, () => (cardEmotes.value = cardEmotes.value.filter(x => x !== entry)));
  // and as balloons rising from all their buildings at once (a little staggered, so it ripples)
  const b = boards.d3;
  const pts = b ? b.playerPoints(seat) : [];
  pts.forEach((pt, i) => later(i && 60 + Math.random() * 260, () => {
    if (!b || !b.alive) return;
    const el = h('div', { class: 'balloon ' + (short ? 'emoji' : 'talk'), style: { '--pc': p.color } },
      h('div', { class: 'balloon-body' }, h('span', null, e)),
      h('i', { class: 'balloon-knot' }), h('i', { class: 'balloon-string' }));
    b.float(el, pt, short ? { rise: 110 + Math.random() * 30, life: 3300 } : { rise: 70, life: 4600, wobble: 3 });
    pixelize(el);
  }));
}

export function showPing(seat: number, x: number, z: number): void {
  const b = boards.d3;
  if (!b) return;
  const p = store.state.peek()?.players[seat];
  b.ping(x, z, p ? p.color : '#f4f4f4');
  play.click();
}

/** the 3D board's own middle-click ping, rate limited (6 per 3 s) */
export function boardPing(x: number, z: number): void {
  const now = Date.now();
  S.pinged = S.pinged.filter(t => now - t < 3000);
  if (S.pinged.length >= 6) return;
  S.pinged.push(now);
  const v = store.viewer.peek();
  if (v == null || v < 0) return showPing(-1, x, z); // spectator: only on this screen
  App.ping(v, x, z);
}

/** the island must be redrawn (icon set changed) */
export const redrawBoard = (): void => {
  if (boards.d3) boards.d3.staticKey = '';
  boardNudge.value++;
};
