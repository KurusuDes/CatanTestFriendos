import { App } from '../app.js';
import { h, clear, rich, toast, sync } from './dom.js';
import { BoardView } from './boardView.js';
import { RES, TILE_INFO, COSTS, DEV_INFO, EVENTS } from '../engine/constants.js';
import * as G from '../engine/game.js';
import { hint } from '../engine/bot.js';
import { play } from './sfx.js';
import { showHelp } from './help.js';
import { flagImg } from './flag.js';
import { iconSet, setIconSet, ICON_SETS, pxIcon, pixelize } from './pixel.js';
import { mountAdhd, updateAdhd, adhdButton, celebrate, disposeAdhd } from './adhd.js';

let ui = null;

const PHASE_TEXT = {
  setup: 'Colocación inicial', roll: 'Tirar dados', main: 'Construir y comerciar', discard: 'Descartar',
  robber: 'Mover el ladrón', roadBuilding: 'Caminos gratis', gameOver: 'Fin de la partida',
};
const costIcons = c => Object.entries(c).map(([r, n]) => TILE_INFO[r].icon.repeat(n)).join('');
const resLine = o => RES.filter(r => o[r]).map(r => `${o[r]}${TILE_INFO[r].icon}`).join(' ');

export function gameScreen(root) {
  const boardWrap = h('section', { class: 'board-wrap' });
  const els = {
    turn: h('div', { class: 'turn-info' }),
    dice: h('div', { class: 'dice' }),
    rolls: h('div', { class: 'roll-log hidden' }),
    event: h('div'),
    banner: h('div', { class: 'banner jit hidden' }),
    players: h('div', { class: 'players' }),
    bank: h('div', { class: 'bank-info' }),
    log: h('div', { class: 'log' }),
    actionbar: h('footer', { class: 'actionbar' }),
    offer: h('div'),
    overlay: h('div'),
    pass: h('div'),
  };
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, 'Katan ', h('i', null, 'x'), ' Amiguites'),
    els.turn, els.event, els.dice,
    h('div', { class: 'top-actions' },
      h('button', { class: 'btn sm', title: 'Ayuda', onclick: () => showHelp() }, '❔'),
      h('button', { class: 'btn sm', title: 'Menú', onclick: () => openMenu() }, '☰')));
  els.topView = h('button', { class: 'btn', title: 'Vista desde arriba', onclick: () => toggleTopView() }, '🗺️');
  boardWrap.append(els.banner, els.offer, els.rolls,
    h('div', { class: 'zoom-ctrl' },
      els.topView,
      h('button', { class: 'btn', title: 'Acercar', onclick: () => ui.board && ui.board.setZoom(ui.board.zoom * 1.25) }, '+'),
      h('button', { class: 'btn', title: 'Alejar', onclick: () => ui.board && ui.board.setZoom(ui.board.zoom / 1.25) }, '−'),
      h('button', { class: 'btn', title: 'Centrar', onclick: () => ui.board && ui.board.resetView() }, '⤢')));
  root.append(h('div', { class: 'game screen' },
    topbar,
    h('main', { class: 'game-main' }, boardWrap, h('aside', { class: 'side' }, els.players, els.bank, els.log)),
    els.actionbar), els.overlay, els.pass);
  ui = {
    els, pick: null, modal: null, draft: null, unlockedFor: null, rolledAt: 0, rolled: null,
    pulseTiles: new Set(), pulseAt: 0, lastCurrent: null, gains: [], lastWinnerShown: false,
  };
  ui.boardWrap = boardWrap;
  mountBoard(ui);
  mountAdhd(boardWrap, () => ui && ui.board3d);
  boardWrap.addEventListener('click', e => {
    if (ui.pick && e.target.tagName !== 'CANVAS') {
      ui.pick = null;
      render(App.state);
    }
  });
  document.onpointerdown = e => {
    if (ui && ui.emoteBox && !ui.emoteBox.contains(e.target) && !e.target.closest('.emote-toggle')) toggleEmotes(null, false);
  };
  document.onkeydown = e => {
    if (App.screen !== 'game') return;
    if (e.key === 'Escape') {
      if (ui.emoteBox) return toggleEmotes(null, false);
      ui.pick = null;
      closeModal();
      render(App.state);
    }
  };
  App.listeners = [st => {
    handleFx(st);
    render(st);
  }];
  // presence / votes / reconnection changes that don't come with a new state
  App.onMeta = () => App.state && ui && render(App.state);
  App.onEmote = (seat, e) => showEmote(seat, e);
  App.onPing = (seat, x, z) => showPing(seat, x, z);
  App.onLeave = () => {
    App.listeners = [];
    App.onMeta = null;
    App.onEmote = null;
    App.onPing = null;
    disposeAdhd();
    document.onpointerdown = null;
    if (ui && ui.emoteBox) ui.emoteBox.remove();
    disposeGameView();
  };
}

// ---------------- board (3D only; the flat 2D map is just a fallback without WebGL) ----------------
async function mountBoard(u) {
  const loading = h('div', { class: 'board-loading jit' }, '🏝️ Levantando la isla...');
  u.boardWrap.append(loading);
  try {
    const { Board3D } = await import('./board3d.js');
    if (ui !== u) return;
    const b = await Board3D.create(u.boardWrap);
    if (ui !== u) return b.dispose();
    u.board3d = u.board = b;
    b.onPing = (x, z) => {
      const now = Date.now();
      u.pinged = (u.pinged || []).filter(t => now - t < 3000);
      if (u.pinged.length >= 6) return;
      u.pinged.push(now);
      const v = App.viewer;
      if (v == null || v < 0) return showPing(-1, x, z); // spectator: only on this screen
      App.ping(v, x, z);
    };
  } catch (e) {
    console.error(e);
    if (ui !== u) return;
    toast('No se pudo cargar el mapa 3D (¿sin conexión o WebGL?): uso el plano', 'error', 4000);
    u.board = new BoardView(u.boardWrap);
  }
  loading.remove();
  if (App.state) render(App.state);
}

export function disposeGameView() {
  if (ui && ui.board3d) ui.board3d.dispose();
  ui = null;
}

// ---------------- viewer & privacy ----------------
function localHumans(st) {
  if (App.isOnline()) return App.mySeat != null ? [App.mySeat] : [];
  return st.players.filter(p => p.kind === 'human').map(p => p.id);
}

function computeViewer(st) {
  if (App.isOnline()) return App.mySeat ?? -1;
  const humans = localHumans(st);
  if (!humans.length) return -1;
  const actors = G.pendingActors(st).filter(p => humans.includes(p));
  if (st.phase === 'discard' && actors.length) return actors.includes(App.viewer) ? App.viewer : actors[0];
  if (actors.includes(st.current)) return st.current;
  if (st.phase === 'setup' && actors.length) return actors[0];
  if (humans.includes(App.viewer)) return App.viewer;
  return humans[0];
}

function privacyOn(st) {
  if (App.isOnline() || localHumans(st).length < 2) return false;
  const mode = st.config.modes.privacy || 'auto';
  if (mode === 'off') return false;
  if (mode === 'on') return st.phase !== 'gameOver';
  // each player has their own vision in the fog, so always hide the screen between humans
  if (st.config.modes.fog) return st.phase !== 'gameOver';
  return st.phase === 'setup' && st.setup.blindActive;
}

// ---------------- fx ----------------
function handleFx(st) {
  const v = computeViewer(st);
  // the cards wait for the 3D dice to land before flying off the tiles
  const rolledNow = (st.fx || []).some(f => f.kind === 'dice');
  const host = !App.isClient();
  for (const f of st.fx || []) {
    switch (f.kind) {
      case 'dice': {
        ui.rolled = f.dice[0] + f.dice[1];
        ui.rolledAt = Date.now();
        ui.diceAnim = true;
        // the cards take off from the tiles once the dice have settled (later for a hard throw)
        ui.diceLand = (ui.board3d ? ui.board3d.rollDice(f.dice, ui.rolledAt, f.power) : 1250) - 100;
        play.dice(f.power);
        if (ui.rolled === 7) setTimeout(() => play.robber(), 350);
        const cur = st.players[st.current];
        if (host && ui.rolled === 7 && cur && cur.kind === 'bot' && Math.random() < 0.3) botEmote(st.current, ['😈', '🦹', '😏']);
        break;
      }
      case 'gain':
        ui.gains.push({ pid: f.pid, text: `+${f.n}${TILE_INFO[f.res].icon}`, at: Date.now() });
        if (!flyGain(st, f, v, rolledNow ? ui.diceLand ?? 1150 : 0) && f.pid === v) {
          ui.bumpRes = ui.bumpRes || new Set();
          ui.bumpRes.add(f.res);
          play.gain();
        }
        break;
      case 'build':
        if (!f.hidden || f.pid === v) play.build();
        break;
      case 'steal':
        // only the two involved see which card it was
        flyCards([f.res], f.from, f.to, v, { hidden: f.from !== v && f.to !== v });
        if (f.from === v) toast(h('span', null, rich(`🫳 @${f.to} te robó `, st.players), TILE_INFO[f.res].icon), 'error');
        else if (f.to === v) toast(h('span', null, rich(`🫳 Le robaste a @${f.from}: `, st.players), TILE_INFO[f.res].icon), 'good');
        if (host && st.players[f.from].kind === 'bot' && Math.random() < 0.45) botEmote(f.from, ['😡', '😤', '💀', '😭']);
        break;
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
        announce('🌀', '¡Tierra viva!', 'El mapa se ha reordenado');
        play.event();
        break;
      case 'blindReveal': {
        const bad = f.placements.filter(p => !p.ok).length;
        announce('🙈', '¡REVELACIÓN!', bad ? `${bad} choque${bad > 1 ? 's' : ''}: toca reubicar` : 'Nadie chocó. ¡Qué suerte!');
        play.reveal();
        break;
      }
      case 'revealTile':
        ui.pulseTiles.add(f.tile);
        ui.pulseAt = Date.now();
        break;
      case 'award':
        toast(rich(`${f.what === 'road' ? '🛣️ Camino más largo' : '⚔️ Ejército más grande'}: @${f.pid}`, st.players), 'good');
        break;
      case 'trade':
        flyCards(spread(f.give), f.a, f.b, v);
        flyCards(spread(f.get), f.b, f.a, v, { delay: 160 });
        break;
      case 'bankTrade':
        flyCards(Array(f.n).fill(f.give), f.pid, 'bank', v);
        flyCards([f.get], 'bank', f.pid, v, { delay: 420 + Math.min(f.n, 6) * 90 });
        break;
      case 'discard':
        flyCards(spread(f.res), f.pid, 'bank', v);
        break;
      case 'fromBank':
        flyCards(f.res, 'bank', f.pid, v);
        break;
      case 'monopoly':
        f.from.forEach(([o, n], i) => flyCards(Array(n).fill(f.res), o, f.pid, v, { delay: i * 200 }));
        break;
      case 'devBought':
        if (f.pid === v) toast(`🃏 Compraste: ${DEV_INFO[f.type].icon} ${DEV_INFO[f.type].name}`, 'good');
        break;
      case 'win':
        play.win();
        confetti();
        if (host && st.players[f.pid] && st.players[f.pid].kind === 'bot') botEmote(f.pid, ['😎', '🏆', '🎉']);
        break;
      case 'cheer':
        celebrate(f.pid, f.n);
        break;
      case 'flipAll':
        ui.flipAt = Date.now();
        ui.flipPending = true;
        announce('🙈', '¡SE VOLTEA EL TABLERO!', 'Ahora todos ven qué hay debajo');
        play.reveal();
        break;
      case 'relocated':
        if (f.pid === v) toast('🌑 ¡Había alguien en la niebla! Tu pieza se desvió al hueco libre más cercano.', 'error', 3500);
        break;
      case 'blocked':
        if (f.pid === v) toast('🌑 ¡Te topaste con alguien en la niebla! No había sitio: no pagaste nada.', 'error', 3500);
        break;
    }
  }
  if (st.current !== ui.lastCurrent) {
    ui.lastCurrent = st.current;
    ui.pick = null;
    if (st.phase !== 'setup' && localHumans(st).includes(st.current)) play.turn();
  }
}

function announce(icon, title, desc) {
  const a = h('div', { class: 'announce' }, h('div', null, h('div', { class: 'ai' }, icon), h('div', { class: 'at jit' }, title), h('div', { class: 'ad' }, desc)));
  document.body.append(a);
  setTimeout(() => a.remove(), 2700);
}

function confetti() {
  const colors = ['#ffc233', '#ff5d8f', '#3ddc84', '#1e88e5', '#fff'];
  for (let i = 0; i < 90; i++) {
    const c = h('div', { class: 'confetti', style: { left: Math.random() * 100 + 'vw', background: colors[i % 5], animationDuration: 2 + Math.random() * 2.5 + 's', animationDelay: Math.random() * 0.8 + 's' } });
    document.body.append(c);
    setTimeout(() => c.remove(), 5500);
  }
}

// ---------------- resources flying from the tiles to the hands ----------------
// returns false when there is nothing to fly (no 3D map), so the caller bumps the card right away
function flyGain(st, f, v, delay) {
  const b = ui.board3d;
  if (!b || !f.tiles || !f.tiles.length) return false;
  if (st.config.modes.fog && f.pid !== v) return true; // don't reveal where the others produce
  const u = ui, mine = f.pid === v;
  setTimeout(() => {
    for (let i = 0; i < Math.min(f.n, 5); i++)
      setTimeout(() => ui === u && flyOne(f.res, f.tiles[i % f.tiles.length], f.pid, mine, i === 0), i * 120);
  }, delay);
  return true;
}

function flyOne(res, tile, pid, mine, first) {
  const b = ui.board3d, pt = b && b.tilePoint(tile);
  const from = pt && b.toScreen(pt.x, pt.y, pt.z);
  if (from) flyCard(res, from, () => cardsOf(pid, res, mine), { mine, sound: mine && first });
}

// ---------------- cards flying between hands, players and the bank ----------------
// {wood: 2, ore: 1} -> ['wood', 'wood', 'ore']
const spread = o => RES.flatMap(r => Array(o[r] || 0).fill(r));

// centre of an element on screen, null when it isn't laid out (hidden panel on a phone)
function centre(el) {
  const r = el && el.getBoundingClientRect();
  return r && (r.width || r.height) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

// where a player's cards are drawn: the card of that resource in your own hand, or their card in the list
function cardsOf(pid, res, mine) {
  const hand = mine && ui.els.actionbar.querySelectorAll('.hand .rcard');
  return hand && hand.length ? hand[RES.indexOf(res)] : ui.els.players.children[pid];
}
const bankOf = res => (centre(ui.els.bank) ? ui.els.bank.children[1 + RES.indexOf(res)] || ui.els.bank : document.querySelector('.board-wrap'));

// cards travel one after another from `a` to `b` (a player id or 'bank'); `hidden` shows their backs
function flyCards(list, a, b, v, o = {}) {
  const u = ui, spot = (who, res) => (who === 'bank' ? bankOf(res) : cardsOf(who, res, who === v));
  list.slice(0, 7).forEach((res, i) =>
    setTimeout(() => {
      if (ui !== u) return;
      const from = centre(spot(a, res));
      if (from) flyCard(res, from, () => spot(b, res), { mine: b === v, sound: b === v && i === 0, hidden: o.hidden, short: true });
    }, (o.delay || 0) + i * 90));
}

function flyCard(res, from, target, o = {}) {
  const t = target(), to = centre(t);
  if (!to) return;
  const lift = o.short ? 16 : 34;
  const mid = { x: (from.x + to.x) / 2 + (Math.random() - 0.5) * (o.short ? 60 : 120), y: Math.min(from.y, to.y) - (o.short ? 40 : 70) - Math.random() * 40 };
  const at = (p, s) => `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${s})`;
  const el = h('div', { class: 'fly-res' + (o.mine ? ' mine' : '') }, o.hidden ? h('i', { class: 'fly-back' }) : pxIcon(TILE_INFO[res].icon.replace(/️/g, ''), 32));
  document.body.append(el);
  const anim = el.animate([
    { transform: at(from, 0.3), opacity: 0 },
    { transform: at({ x: from.x, y: from.y - lift }, o.short ? 1.1 : 1.35), opacity: 1, offset: 0.18 },
    { transform: at(mid, 1.05), opacity: 1, offset: 0.58 },
    { transform: at(to, o.mine ? 0.95 : 0.55), opacity: o.mine ? 1 : 0.4 },
  ], { duration: o.short ? 800 : 950, easing: 'cubic-bezier(.4,0,.6,1)' });
  setTimeout(() => el.remove(), 2500); // hidden tabs may never finish the animation
  anim.onfinish = () => {
    el.remove();
    const c = ui && target();
    if (!c) return;
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump');
    if (o.sound) play.gain();
  };
}

// ---------------- reactions: emojis that float up from your buildings ----------------
const EMOTES = ['😂', '🤣', '😎', '😡', '😭', '😱', '🤔', '🙏', '👏', '🔥', '💀', '😈', '👀', '❤️', '🤝', '🎉', '🐑', '🌾', '🧱', '🌲', '⛰️', '🎲', '🦹', '🏆'];
const ONLY_EMOJI = /^(\p{Extended_Pictographic}|️|‍){1,4}$/u;

function botEmote(pid, options) {
  const e = options[Math.floor(Math.random() * options.length)];
  setTimeout(() => App.state && App.emote(pid, e), 500 + Math.random() * 900);
}

function sendEmote(e) {
  const v = App.viewer;
  if (v == null || v < 0) return toast('Solo los jugadores pueden reaccionar', 'error');
  const now = Date.now();
  ui.sent = (ui.sent || []).filter(t => now - t < 4000);
  if (ui.sent.length >= 5) return toast('Más despacio 😅', 'error', 1500);
  ui.sent.push(now);
  App.emote(v, e);
}

// the emoji picker opens above the 😀 button next to your hand; picking one sends it and closes it
function toggleEmotes(anchor, force) {
  const open = force ?? !ui.emoteBox;
  if (ui.emoteBox) {
    ui.emoteBox.remove();
    ui.emoteBox = null;
  }
  if (!open || !anchor) return;
  ui.emoteBox = h('div', { class: 'emote-pop', onclick: e => e.stopPropagation() },
    h('div', { class: 'emote-grid' }, EMOTES.map(e => h('button', { class: 'emote-btn', title: e, onclick: () => { sendEmote(e); toggleEmotes(null, false); } }, e))));
  document.body.append(ui.emoteBox);
  const r = anchor.getBoundingClientRect();
  ui.emoteBox.style.bottom = innerHeight - r.top + 10 + 'px';
  ui.emoteBox.style.left = Math.max(8, Math.min(r.left, innerWidth - ui.emoteBox.offsetWidth - 8)) + 'px';
}

function showEmote(seat, e) {
  const st = App.state;
  if (!ui || !st || !st.players[seat]) return;
  const p = st.players[seat];
  const short = ONLY_EMOJI.test(e);
  play.pop();
  // on the player's card (always visible, even when their buildings are off screen)
  ui.cardEmotes = (ui.cardEmotes || []).filter(x => x.pid !== seat);
  ui.cardEmotes.push({ pid: seat, e, at: Date.now() });
  renderPlayers(st, App.viewer);
  const u = ui;
  setTimeout(() => ui === u && App.state && renderPlayers(App.state, App.viewer), 3100);
  // and as balloons rising from all their buildings at once (a little staggered, so it ripples)
  const b = ui.board3d;
  const pts = b ? b.playerPoints(seat) : [];
  pts.forEach((pt, i) => setTimeout(() => {
    if (ui !== u || !b.alive) return;
    const el = h('div', { class: 'balloon ' + (short ? 'emoji' : 'talk'), style: { '--pc': p.color } },
      h('div', { class: 'balloon-body' }, h('span', null, e)),
      h('i', { class: 'balloon-knot' }), h('i', { class: 'balloon-string' }));
    b.float(el, pt, short ? { rise: 110 + Math.random() * 30, life: 3300 } : { rise: 70, life: 4600, wobble: 3 });
    pixelize(el);
  }, i && 60 + Math.random() * 260));
}

// ---------------- the dice button: tap to throw, hold to charge a harder throw ----------------
const CHARGE_DEAD = 180, CHARGE_FULL = 1100; // ms: a tap throws at once; full power after holding this long

function rollButton(v) {
  return h('button', {
    class: 'btn primary big roll-btn',
    title: 'Toca para tirar · mantén pulsado para cargar fuerza',
    onpointerdown: e => startCharge(e, v),
    onclick: e => e.detail === 0 && throwDice(v, 0), // keyboard (Enter / Space)
    oncontextmenu: e => e.preventDefault(), // long press on a phone
  }, h('i', { class: 'roll-fill' }), h('span', null, '🎲 Tirar dados'));
}

function chargePower(c, now = performance.now()) {
  return Math.max(0, Math.min(1, (now - c.t0 - CHARGE_DEAD) / CHARGE_FULL));
}

function startCharge(e, v) {
  if (e.button !== 0 || ui.charge) return;
  e.preventDefault();
  const u = ui;
  const c = (ui.charge = { v, t0: performance.now(), tick: 0 });
  const release = () => {
    removeEventListener('pointerup', release);
    removeEventListener('pointercancel', release);
    if (u.charge !== c) return;
    u.charge = null;
    const btn = u.els.actionbar.querySelector('.roll-btn');
    if (btn) btn.classList.remove('charging', 'full');
    if (ui === u) throwDice(v, chargePower(c));
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  const frame = now => {
    if (u.charge !== c) return;
    const btn = u.els.actionbar.querySelector('.roll-btn'); // the bar may have been redrawn meanwhile
    const pw = chargePower(c, now);
    if (btn) {
      btn.style.setProperty('--charge', pw.toFixed(3));
      btn.classList.toggle('charging', now - c.t0 > CHARGE_DEAD);
      btn.classList.toggle('full', pw >= 1);
    }
    // the dice rattle in your hand, faster the harder you shake them
    if (now - c.t0 > CHARGE_DEAD && now >= c.tick) {
      play.rattle(pw);
      c.tick = now + 150 - pw * 80;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function throwDice(v, power) {
  const st = App.state;
  if (!st || st.phase !== 'roll' || st.current !== v) return;
  App.dispatch({ type: 'roll', pid: v, power: Math.round(power * 100) / 100 });
}

function showPing(seat, x, z) {
  if (!ui || !ui.board3d) return;
  const p = App.state && App.state.players[seat];
  ui.board3d.ping(x, z, p ? p.color : '#f4f4f4');
  play.click();
}

// ---------------- render ----------------
export function render(st) {
  if (!ui || !st) return;
  const v = computeViewer(st);
  App.viewer = v;
  const locked = privacyOn(st) && v >= 0 && ui.unlockedFor !== v;
  renderPass(st, v, locked);
  renderTop(st);
  renderRolls(st);
  renderBoard(st, v, locked);
  renderPlayers(st, v);
  renderLog(st);
  renderActions(st, v, locked);
  renderOffer(st, v, locked);
  renderModal(st, v, locked);
  updateAdhd(st, locked ? -1 : v, !!ui.els.offer.firstElementChild);
}

function renderPass(st, v, locked) {
  clear(ui.els.pass);
  if (!locked) return;
  const p = st.players[v];
  ui.els.pass.append(h('div', { class: 'pass-screen', onclick: () => { ui.unlockedFor = v; render(App.state); } },
    h('div', null,
      h('div', { class: 'eye' }, '🙈'),
      h('div', { class: 'big', style: { color: p.color } }, p.name),
      h('p', { style: { color: '#bbb', fontWeight: 700, fontSize: '18px' } }, 'Pásale el dispositivo. Los demás, ¡no miren!'),
      h('button', { class: 'btn primary big' }, 'Soy yo, mostrar'))));
}

function dieFace(n, red) {
  const on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n] || [];
  return h('div', { class: 'die' + (red ? ' red-die' : '') }, Array.from({ length: 9 }, (_, i) => h('i', { class: on.includes(i) ? 'on' : '' })));
}

// the last rolls, newest first, each in the colour of whoever threw it
function renderRolls(st) {
  const log = st.rollLog || [];
  const el = ui.els.rolls;
  el.classList.toggle('hidden', !log.length);
  const key = log.length + ':' + log.map(r => r.sum).join(',');
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  clear(el).append(h('span', { class: 'roll-log-head', title: 'Últimas tiradas' }, '🎲'),
    ...log.slice(-12).reverse().map((r, i) => {
      const p = st.players[r.pid];
      return h('b', { class: 'roll-chip' + (r.sum === 7 ? ' seven' : '') + (i === 0 ? ' newest' : ''), style: { '--pc': p ? p.color : '#94b0c2' }, title: p ? `${p.name}: ${r.sum}` : String(r.sum) }, r.sum);
    }));
}

// the top view button: straight down onto the map and back
function toggleTopView() {
  const b = ui.board;
  if (!b || !b.setTopView) return;
  b.setTopView(!b.top);
  ui.els.topView.classList.toggle('active', !!b.top);
  ui.els.topView.title = b.top ? 'Volver a la vista inclinada' : 'Vista desde arriba';
}

function renderTop(st) {
  const cur = st.players[st.current];
  const e = ui.els;
  clear(e.turn).append(
    h('span', { class: 'turn-dot', style: { background: cur.color } }),
    h('span', null, st.phase === 'gameOver' ? `🏆 ${st.players[st.winner].name}` : cur.name),
    h('span', { class: 'phase-tag' }, `· ${PHASE_TEXT[st.phase]}${st.round ? ` · Ronda ${st.round}` : ''}`));
  clear(e.event);
  if (st.event) {
    const def = EVENTS.find(x => x.id === st.event.id);
    const extra = st.event.res ? ' ' + TILE_INFO[st.event.res].icon : '';
    e.event.append(h('div', { class: 'event-badge', title: def ? def.desc : '' }, st.event.icon, ' ', st.event.name, extra));
  }
  clear(e.dice);
  if (st.dice) {
    const sum = st.dice[0] + st.dice[1];
    e.dice.append(dieFace(st.dice[0]), dieFace(st.dice[1], true), h('div', { class: 'dice-sum' + (sum === 7 ? ' seven' : '') }, sum));
    if (ui.diceAnim) {
      e.dice.classList.remove('rolling');
      void e.dice.offsetWidth;
      e.dice.classList.add('rolling');
      ui.diceAnim = false;
    }
  }
}

function interaction(real, v) {
  if (v < 0) return null;
  const st = G.viewFor(real, v);
  const color = st.players[v].color;
  const mk = (kind, list, onPick) => ({ kind, legal: new Set(list), onPick, color });
  if (st.phase === 'setup') {
    if (G.pendingActors(st)[0] !== v) return null;
    if (st.setup.step === 'settlement') return mk('settlement', G.legalSetupSettlements(st, v), vid => App.dispatch({ type: 'placeSettlement', pid: v, vid }));
    return mk('road', G.legalSetupRoads(st, v), eid => App.dispatch({ type: 'placeRoad', pid: v, eid }));
  }
  if (st.current !== v) return null;
  if (st.phase === 'robber') return mk('robber', G.legalRobberTiles(st, v), tile => robberPick(st, v, tile));
  if (st.phase === 'roadBuilding') return mk('road', G.legalRoads(st, v), at => App.dispatch({ type: 'build', pid: v, what: 'road', at }));
  if (st.phase === 'main' && ui.pick) {
    const done = at => {
      if (App.dispatch({ type: 'build', pid: v, what: ui.pick, at })) {
        const p = App.state.players[v];
        if (!G.canAfford(p.res, COSTS[ui.pick])) ui.pick = null;
        render(App.state);
      }
    };
    const list = ui.pick === 'road' ? G.legalRoads(st, v) : ui.pick === 'settlement' ? G.legalSettlements(st, v) : G.legalCities(st, v);
    return mk(ui.pick, list, done);
  }
  return null;
}

function robberPick(st, v, tile) {
  const victims = G.stealTargets(G.viewFor(st, v), v, tile);
  if (victims.length <= 1) {
    App.dispatch({ type: 'moveRobber', pid: v, tile, victim: victims[0] });
    return;
  }
  openModal(() => h('div', null,
    h('h2', null, '🫳 ¿A quién le robas?'),
    h('div', { class: 'chips' }, victims.map(pid => {
      const p = App.state.players[pid];
      return h('button', { class: 'btn', style: { borderColor: p.color }, onclick: () => { closeModal(); App.dispatch({ type: 'moveRobber', pid: v, tile, victim: pid }); } },
        h('span', { class: 'turn-dot', style: { background: p.color } }), `${p.name} (${G.handSize(p.res)} cartas)`);
    })),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancelar'))));
}

function bannerText(st, v, inter) {
  const cur = st.players[st.current];
  if (st.phase === 'gameOver') return `🏆 ¡${st.players[st.winner].name} gana!`;
  if (st.phase === 'setup') {
    const who = st.players[G.pendingActors(st)[0]];
    const blind = st.setup.blindActive ? '🙈 En secreto: ' : st.setup.fixing ? '💥 Reubica: ' : '';
    if (who.id !== v) return `${blind}${who.name} está colocando...`;
    return `${blind}Coloca tu ${st.setup.step === 'settlement' ? (st.config.rules.setupCity && st.setup.queue[st.setup.idx].round === st.setup.lastRound ? 'ciudad' : 'poblado') : 'camino'}`;
  }
  if (st.phase === 'discard') {
    const n = Object.keys(st.pendingDiscards).length;
    return `🗑️ ¡Salió 7! Descartando (${n} pendiente${n > 1 ? 's' : ''})`;
  }
  if (st.current !== v) return st.trade ? `🤝 ${cur.name} ofrece un intercambio` : `Turno de ${cur.name}`;
  if (st.phase === 'robber') return '🦹 Elige dónde poner el ladrón';
  if (st.phase === 'roadBuilding') return `🛤️ Coloca ${st.freeRoads} camino${st.freeRoads > 1 ? 's' : ''} gratis`;
  if (st.phase === 'roll') return '🎲 ¡Tu turno! Tira los dados';
  if (inter) return { road: 'Elige dónde construir el camino', settlement: 'Elige dónde construir el poblado', city: 'Elige qué poblado mejorar' }[inter.kind] + ' (Esc para cancelar)';
  return '';
}

function renderBoard(st, v, locked) {
  if (!ui.board) return; // the 3D map is still loading
  const inter = locked ? null : interaction(st, v);
  if (Date.now() - ui.pulseAt > 2600) ui.pulseTiles.clear();
  let blindOwn = [];
  if (st.phase === 'setup' && st.setup.blindActive) blindOwn = v < 0 ? st.blind : locked ? [] : st.blind.filter(b => b.pid === v);
  const vst = locked ? { ...G.viewFor(st, v), buildings: {}, roads: {}, vision: { circles: [], caps: [] } } : G.viewFor(st, v);
  const flipAt = ui.flipPending ? ui.flipAt : 0;
  ui.flipPending = false;
  ui.board.render(vst, {
    vision: st.config.modes.fog && v >= 0 ? vst.vision || { circles: [], caps: [] } : null,
    faceDown: st.config.modes.flipped,
    flipAt,
    interaction: inter,
    rolled: Date.now() - ui.rolledAt < 2600 ? ui.rolled : null,
    rolledAt: ui.rolledAt,
    pulseTiles: ui.pulseTiles,
    blindOwn,
  });
  const txt = locked ? '' : bannerText(st, v, inter);
  if (ui.els.banner.dataset.txt !== txt) {
    ui.els.banner.dataset.txt = txt;
    delete ui.els.banner.dataset.jit;
    ui.els.banner.textContent = txt;
  }
  ui.els.banner.classList.toggle('hidden', !txt);
}

function renderPlayers(st, v) {
  const box = clear(ui.els.players);
  box.classList.toggle('compact', st.players.length > 5);
  const acting = new Set(G.pendingActors(st));
  const online = App.isOnline();
  const now = Date.now();
  ui.gains = ui.gains.filter(g => now - g.at < 1600);
  for (const p of st.players) {
    const pub = G.victoryPoints(st, p.id, false);
    const all = G.victoryPoints(st, p.id, true);
    const me = p.id === v;
    const conn = online && p.kind === 'human' ? App.net.presence(p.id) : undefined;
    const tag = p.retired ? 'retirado' : p.kind === 'bot' ? (p.remote ? 'bot sustituto' : `bot ${{ easy: 'fácil', normal: 'normal', hard: 'difícil' }[p.level] || ''}`) : me ? 'tú' : '';
    const card = h('div', { class: 'pcard' + (st.current === p.id ? ' current' : '') + (st.winner === p.id ? ' winner' : '') + (p.retired ? ' retired' : ''), style: { '--pc': p.color } },
      h('div', { class: 'top' },
        h('div', { class: 'avatar' }, p.flag ? flagImg(p.flag, 30) : p.kind === 'bot' ? '🤖' : p.name.slice(0, 1).toUpperCase()),
        h('div', { class: 'name' }, p.name, tag && h('small', null, tag), conn === false ? h('span', { class: 'conn off', title: 'Desconectado' }, ' 🔌') : null),
        acting.has(p.id) && st.phase !== 'gameOver' ? h('span', { class: 'acting-dot', title: 'Actuando' }) : null,
        h('div', { class: 'vp', title: 'Puntos de victoria' }, pub, (me || st.phase === 'gameOver') && all > pub ? h('small', null, ` +${all - pub}`) : null)),
      h('div', { class: 'stats' },
        h('span', { title: 'Cartas de recurso' }, `🂠 ${G.handSize(p.res)}`),
        h('span', { title: 'Cartas de desarrollo' }, `🃏 ${p.dev.length}`),
        h('span', { title: 'Caballeros jugados' }, `⚔️ ${p.knights}`),
        h('span', { title: 'Camino más largo propio' }, `🛣️ ${p.roadLen}`),
        st.longestRoad.owner === p.id ? h('span', { class: 'award', title: 'Camino más largo (+2)' }, '🏅Camino') : null,
        st.largestArmy.owner === p.id ? h('span', { class: 'award', title: 'Ejército más grande (+2)' }, '🏅Ejército') : null,
        st.pendingDiscards[p.id] ? h('span', { style: { color: 'var(--red)' } }, `🗑️ ${st.pendingDiscards[p.id]}`) : null));
    const g = ui.gains.filter(x => x.pid === p.id);
    if (g.length) card.append(h('div', { class: 'gainfx' }, g.map(x => x.text).join(' ')));
    const said = (ui.cardEmotes || []).find(x => x.pid === p.id && now - x.at < 3000);
    if (said) card.append(h('div', { class: 'pc-emote' + (ONLY_EMOJI.test(said.e) ? ' big' : ''), style: { animationDelay: `-${now - said.at}ms` } }, said.e));
    box.append(card);
  }
  clear(ui.els.bank).append(h('span', null, '🏦'), ...RES.map(r => h('span', { title: TILE_INFO[r].name }, `${TILE_INFO[r].icon}${st.bank[r]}`)), h('span', { title: 'Cartas de desarrollo restantes' }, `🃏${st.devDeck.length}`),
    h('span', { title: 'Meta' }, `🏆 ${st.config.rules.vpTarget}`));
}

function renderLog(st) {
  const box = ui.els.log;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  clear(box);
  for (const l of st.log.slice(-120)) box.append(h('div', null, rich(l.msg, st.players)));
  if (atBottom || !ui.logInit) box.scrollTop = box.scrollHeight;
  ui.logInit = true;
}

function resCard(r, n, bump) {
  const info = TILE_INFO[r];
  return h('div', { class: 'rcard' + (n ? '' : ' zero') + (bump ? ' bump' : ''), style: { background: `linear-gradient(160deg, ${info.color}, ${info.dark})` }, title: info.name }, info.icon, h('b', null, n));
}

function renderActions(st, v, locked) {
  const bar = h('div');
  fillActions(bar, st, v, locked);
  sync(ui.els.actionbar, ...bar.childNodes);
}

function fillActions(bar, st, v, locked) {
  if (v < 0) {
    bar.append(h('div', { class: 'waiting' }, '👀 Modo espectador: los bots juegan solos.'), speedControl());
    return;
  }
  if (locked) {
    bar.append(h('div', { class: 'waiting' }, '🙈 Esperando que el jugador mire su pantalla...'));
    return;
  }
  const p = st.players[v];
  const bump = ui.bumpRes || new Set();
  ui.bumpRes = null;
  bar.append(h('div', { class: 'hand' }, RES.map(r => resCard(r, p.res[r], bump.has(r)))));
  bar.append(h('button', { class: 'btn emote-toggle', title: 'Reaccionar con un emoji', onclick: e => { e.stopPropagation(); toggleEmotes(e.currentTarget); } }, '😀'));
  bar.append(adhdButton());

  const playable = new Set(st.current === v ? G.playableDev(st, v) : []);
  const groups = {};
  for (const c of p.dev) (groups[c.type] ||= []).push(c);
  if (p.dev.length)
    bar.append(h('div', { class: 'devcards' }, Object.entries(groups).map(([type, cards]) => {
      const info = DEV_INFO[type];
      const can = playable.has(type);
      const fresh = cards.every(c => c.turn >= st.turn);
      return h('div', {
        class: 'dcard' + (can ? ' playable' : '') + (fresh && type !== 'vp' ? ' new' : ''),
        title: `${info.name}: ${info.desc}${fresh && type !== 'vp' ? ' (recién comprada: podrás jugarla el próximo turno)' : ''}`,
        onclick: () => can && playDev(st, v, type),
      }, info.icon, h('b', null, `×${cards.length}`));
    })));

  const acts = h('div', { class: 'actions' });
  bar.append(acts);
  const myTurn = st.current === v;
  if (st.phase === 'gameOver') {
    acts.append(h('button', { class: 'btn primary', onclick: () => openGameOver(App.state) }, '🏆 Ver resultados'));
    return;
  }
  if (st.phase === 'setup' || !myTurn) {
    if (st.phase === 'discard' && st.pendingDiscards[v]) acts.append(h('button', { class: 'btn pink', onclick: () => render(App.state) }, `🗑️ Descarta ${st.pendingDiscards[v]}`));
    else {
      acts.append(h('div', { class: 'waiting' }, st.phase === 'setup' && G.pendingActors(st)[0] === v ? '👆 Toca el tablero' : `⏳ Esperando a ${st.players[G.pendingActors(st)[0]].name}...`));
      if (st.phase !== 'setup') acts.append(affordPreview(st, v));
    }
    return;
  }
  if (st.phase === 'roll') {
    acts.append(rollButton(v));
    return;
  }
  if (st.phase === 'robber') {
    acts.append(h('div', { class: 'waiting' }, '🦹 Toca una casilla del tablero'));
    return;
  }
  if (st.phase === 'roadBuilding') {
    acts.append(h('button', { class: 'btn', onclick: () => App.dispatch({ type: 'endRoadBuilding', pid: v }) }, 'Terminar caminos'));
    return;
  }
  if (st.phase !== 'main') return;
  const buildBtn = (what, label, icon, left, legalFn) => {
    const ok = left > 0 && G.canAfford(p.res, COSTS[what]) && legalFn().length > 0;
    return h('button', {
      class: 'btn' + (ui.pick === what ? ' active' : ''), disabled: !ok,
      title: `${label} — cuesta ${costIcons(COSTS[what])} (quedan ${left})`,
      onclick: e => { e.stopPropagation(); ui.pick = ui.pick === what ? null : what; render(App.state); },
    }, h('span', { class: 'bicon' }, icon), h('span', null, label, h('span', { class: 'cost' }, costIcons(COSTS[what]))));
  };
  acts.append(
    buildBtn('road', 'Camino', '🛤️', p.roadsLeft, () => G.legalRoads(st, v)),
    buildBtn('settlement', 'Poblado', '🏠', p.settlementsLeft, () => G.legalSettlements(st, v)),
    buildBtn('city', 'Ciudad', '🏰', p.citiesLeft, () => G.legalCities(st, v)),
    h('button', {
      class: 'btn', disabled: !st.devDeck.length || !G.canAfford(p.res, COSTS.dev), title: `Carta de desarrollo — cuesta ${costIcons(COSTS.dev)}`,
      onclick: () => App.dispatch({ type: 'buyDev', pid: v }),
    }, h('span', { class: 'bicon' }, '🃏'), h('span', null, 'Carta', h('span', { class: 'cost' }, costIcons(COSTS.dev)))),
    h('button', { class: 'btn', disabled: !!st.trade, onclick: () => openTrade(v) }, '🤝 Comerciar'),
    h('button', { class: 'btn sm ghost', title: 'Pista', onclick: () => showHint(st, v) }, '💡'),
    h('button', { class: 'btn green', onclick: () => App.dispatch({ type: 'endTurn', pid: v }) }, '✅ Terminar'));
}

// out of turn: what your hand already pays for, so you can plan while the others play
function affordPreview(real, v) {
  const st = G.viewFor(real, v); // fog: only count spots you can actually see
  const p = st.players[v];
  const items = [
    ['road', '🛤️', 'Camino', p.roadsLeft > 0 && G.legalRoads(st, v).length > 0],
    ['settlement', '🏠', 'Poblado', p.settlementsLeft > 0 && G.legalSettlements(st, v).length > 0],
    ['city', '🏰', 'Ciudad', p.citiesLeft > 0 && G.legalCities(st, v).length > 0],
    ['dev', '🃏', 'Carta', st.devDeck.length > 0],
  ];
  return h('div', { class: 'afford' }, items.map(([what, icon, label, room]) => {
    const ok = G.canAfford(p.res, COSTS[what]);
    const tip = ok ? (room ? `Ya puedes pagar: ${label}. Constrúyelo en tu turno.` : `Puedes pagarlo, pero ahora no hay dónde: ${label}.`) : `${label}: te falta ${missing(p.res, COSTS[what])}`;
    return h('div', { class: 'afford-item' + (ok && room ? ' ok' : ok ? ' half' : ''), title: tip },
      h('span', { class: 'bicon' }, icon), h('span', null, label, h('span', { class: 'cost' }, costIcons(COSTS[what]))), ok && room ? h('b', { class: 'tick' }, '✓') : null);
  }));
}

function missing(res, cost) {
  return Object.entries(cost).filter(([r, n]) => res[r] < n).map(([r, n]) => TILE_INFO[r].icon.repeat(n - res[r])).join('');
}

function speedControl() {
  const opts = [[1400, '🐢'], [650, '▶️'], [250, '⏩'], [60, '⚡']];
  return h('div', { class: 'chips', style: { marginLeft: 'auto' } }, opts.map(([ms, l]) => h('button', {
    class: 'chip' + (App.speed === ms ? ' on' : ''), title: 'Velocidad de los bots', onclick: () => { App.setSpeed(ms); render(App.state); App.scheduleBots(); },
  }, l)));
}

function describe(a, st) {
  if (!a) return 'Nada que hacer ahora.';
  switch (a.type) {
    case 'roll': return 'Tira los dados.';
    case 'build': return { road: '🛤️ Construye un camino (resaltado).', settlement: '🏠 Construye un poblado (resaltado).', city: '🏰 Mejora un poblado a ciudad.' }[a.what];
    case 'buyDev': return '🃏 Compra una carta de desarrollo.';
    case 'bankTrade': return `🏦 Cambia ${TILE_INFO[a.give].icon} por ${TILE_INFO[a.get].icon} con el banco.`;
    case 'proposeTrade': return `🤝 Ofrece ${resLine(a.give)} por ${resLine(a.get)} a los demás.`;
    case 'playDev': return `Juega ${DEV_INFO[a.card].icon} ${DEV_INFO[a.card].name}.`;
    case 'endTurn': return '✅ Termina el turno: no hay nada mejor.';
    default: return a.type;
  }
}

function showHint(st, v) {
  const a = hint(st, v);
  toast('💡 ' + describe(a, st), 'info', 3500);
  if (a && a.type === 'build') {
    ui.pick = a.what;
    render(App.state);
  }
}

function playDev(st, v, type) {
  if (type === 'knight' || type === 'roadBuilding') {
    App.dispatch({ type: 'playDev', pid: v, card: type });
    return;
  }
  if (type === 'monopoly') {
    openModal(() => h('div', null, h('h2', null, '👑 Monopolio'), h('p', null, 'Todos los jugadores te darán todas sus cartas de este recurso.'),
      h('div', { class: 'respick' }, RES.map(r => h('button', { class: 'btn', onclick: () => { closeModal(); App.dispatch({ type: 'playDev', pid: v, card: 'monopoly', res: r }); } }, TILE_INFO[r].icon, h('small', null, TILE_INFO[r].name)))),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancelar'))));
    return;
  }
  if (type === 'yearOfPlenty') {
    ui.draft = [];
    openModal(() => {
      const d = ui.draft;
      return h('div', null, h('h2', null, '🎁 Año de abundancia'), h('p', null, 'Elige 2 recursos del banco (pueden repetirse).'),
        h('div', { class: 'respick' }, RES.map(r => h('button', { class: 'btn', disabled: d.length >= 2 || App.state.bank[r] <= d.filter(x => x === r).length, onclick: () => { d.push(r); renderModal(App.state); } }, TILE_INFO[r].icon, h('small', null, `banco ${App.state.bank[r]}`)))),
        h('p', { class: 'res-inline' }, 'Elegidos: ', d.map(r => TILE_INFO[r].icon).join(' ') || '—'),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => { ui.draft = []; renderModal(App.state); } }, 'Borrar'),
          h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancelar'),
          h('button', { class: 'btn primary', disabled: d.length !== 2, onclick: () => { closeModal(); App.dispatch({ type: 'playDev', pid: v, card: 'yearOfPlenty', res: d }); } }, 'Tomar')));
    });
  }
}

// ---------------- trade ----------------
function openTrade(v) {
  ui.draft = { tab: 'bank', give: G.zeroRes(), get: G.zeroRes(), bankGive: null, bankGet: null, to: App.state.players.filter(p => p.id !== v).map(p => p.id) };
  openModal(() => tradeModal(App.state, v));
}

function stepper(label, obj, r, max) {
  return h('div', { class: 'stepper' },
    h('div', { class: 'ic' }, TILE_INFO[r].icon),
    h('div', { class: 'n' }, obj[r]),
    max != null ? h('div', { class: 'have' }, `tienes ${max}`) : null,
    h('div', { class: 'ctl' },
      h('button', { class: 'btn sm', disabled: obj[r] <= 0, onclick: () => { obj[r]--; renderModal(App.state); } }, '−'),
      h('button', { class: 'btn sm', disabled: max != null && obj[r] >= max, onclick: () => { obj[r]++; renderModal(App.state); } }, '+')));
}

function tradeModal(st, v) {
  const d = ui.draft;
  const p = st.players[v];
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: 'btn sm' + (d.tab === 'bank' ? ' active' : ''), onclick: () => { d.tab = 'bank'; renderModal(App.state); } }, '🏦 Banco y puertos'),
    h('button', { class: 'btn sm' + (d.tab === 'players' ? ' active' : ''), onclick: () => { d.tab = 'players'; renderModal(App.state); } }, '🤝 Jugadores'));
  if (d.tab === 'bank') {
    const ratio = r => G.tradeRatio(st, v, r);
    return h('div', null, h('h2', null, 'Comerciar'), tabs,
      h('div', { class: 'section-label' }, 'Das'),
      h('div', { class: 'respick' }, RES.map(r => h('button', {
        class: 'btn' + (d.bankGive === r ? ' active' : ''), disabled: p.res[r] < ratio(r),
        onclick: () => { d.bankGive = r; renderModal(App.state); },
      }, TILE_INFO[r].icon, h('small', null, `${ratio(r)}:1 · tienes ${p.res[r]}`)))),
      h('div', { class: 'section-label' }, 'Recibes'),
      h('div', { class: 'respick' }, RES.map(r => h('button', {
        class: 'btn' + (d.bankGet === r ? ' active' : ''), disabled: r === d.bankGive || st.bank[r] < 1,
        onclick: () => { d.bankGet = r; renderModal(App.state); },
      }, TILE_INFO[r].icon, h('small', null, `banco ${st.bank[r]}`)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: closeModal }, 'Cerrar'),
        h('button', {
          class: 'btn primary', disabled: !d.bankGive || !d.bankGet || d.bankGive === d.bankGet || p.res[d.bankGive] < ratio(d.bankGive),
          onclick: () => { App.dispatch({ type: 'bankTrade', pid: v, give: d.bankGive, get: d.bankGet }); if (App.state.players[v].res[d.bankGive] < ratio(d.bankGive)) d.bankGive = null; renderModal(App.state); },
        }, d.bankGive ? `Cambiar ${ratio(d.bankGive)}${TILE_INFO[d.bankGive].icon} → 1${d.bankGet ? TILE_INFO[d.bankGet].icon : '?'}` : 'Cambiar')));
  }
  const others = st.players.filter(o => o.id !== v);
  const valid = G.handSize(d.give) > 0 && G.handSize(d.get) > 0 && d.to.length && G.canAfford(p.res, d.give) && !RES.some(r => d.give[r] && d.get[r]);
  return h('div', null, h('h2', null, 'Comerciar'), tabs,
    h('div', { class: 'section-label' }, 'Das'),
    h('div', { class: 'steppers' }, RES.map(r => stepper('das', d.give, r, p.res[r]))),
    h('div', { class: 'section-label' }, 'Pides'),
    h('div', { class: 'steppers' }, RES.map(r => stepper('pides', d.get, r, null))),
    h('div', { class: 'section-label' }, 'Ofrecer a'),
    h('div', { class: 'chips' }, others.map(o => h('button', {
      class: 'chip' + (d.to.includes(o.id) ? ' on' : ''),
      onclick: () => { d.to = d.to.includes(o.id) ? d.to.filter(x => x !== o.id) : [...d.to, o.id]; renderModal(App.state); },
    }, `${o.kind === 'bot' ? '🤖 ' : ''}${o.name} (${G.handSize(o.res)})`))),
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Cerrar'),
      h('button', { class: 'btn primary', disabled: !valid, onclick: () => { closeModal(); App.dispatch({ type: 'proposeTrade', pid: v, give: d.give, get: d.get, to: d.to }); } }, 'Enviar oferta')));
}

// same trick as the modals: one frame per offer, so answers coming in don't replay its pop-in
function renderOffer(st, v, locked) {
  const box = ui.els.offer;
  const panel = offerPanel(st, v, locked);
  let cur = box.firstElementChild;
  if (!panel) {
    if (cur) clear(box);
    return;
  }
  if (!cur || cur.dataset.trade !== panel.dataset.trade) {
    clear(box);
    cur = h('div', { class: 'offer', 'data-trade': panel.dataset.trade });
    box.append(cur);
  }
  sync(cur, ...panel.childNodes);
}

function offerPanel(st, v, locked) {
  const t = st.trade;
  if (!t || locked || st.phase === 'gameOver') return null;
  const from = st.players[t.from];
  const mine = localHumans(st);
  const iAmProposer = mine.includes(t.from);
  const pendingMe = t.to.filter(pid => mine.includes(pid) && t.responses[pid] == null);
  if (!iAmProposer && !pendingMe.length && !(v >= 0 && t.to.includes(v))) return null;
  const panel = h('div', { class: 'offer', 'data-trade': t.id },
    h('div', { class: 'line' }, h('span', { class: 'turn-dot', style: { background: from.color } }), from.name, ' da ', h('span', { class: 'res-inline' }, resLine(t.give)), ' y pide ', h('span', { class: 'res-inline' }, resLine(t.get))));
  const resp = h('div', { class: 'resp' });
  for (const pid of t.to) {
    const o = st.players[pid];
    const r = t.responses[pid];
    if (r == null && mine.includes(pid) && !iAmProposer) {
      const can = G.canAfford(o.res, t.get);
      resp.append(h('span', { class: 'tag' }, o.name, ':'),
        h('button', { class: 'btn sm green', disabled: !can, title: can ? '' : 'No tienes lo que piden', onclick: () => App.dispatch({ type: 'respondTrade', pid, accept: true, tradeId: t.id }) }, '✓ Acepto'),
        h('button', { class: 'btn sm', onclick: () => App.dispatch({ type: 'respondTrade', pid, accept: false, tradeId: t.id }) }, '✗ No'));
    } else if (r == null && mine.includes(pid) && iAmProposer && !App.isOnline()) {
      // hotseat: another human at the table answers from here
      const can = G.canAfford(o.res, t.get);
      resp.append(h('span', { class: 'tag' }, o.name, ':'),
        h('button', { class: 'btn sm green', disabled: !can, onclick: () => App.dispatch({ type: 'respondTrade', pid, accept: true, tradeId: t.id }) }, '✓'),
        h('button', { class: 'btn sm', onclick: () => App.dispatch({ type: 'respondTrade', pid, accept: false, tradeId: t.id }) }, '✗'));
    } else {
      resp.append(h('span', { class: 'tag' + (r === 'accept' ? ' ok' : r === 'reject' ? ' no' : '') }, `${o.name} ${r === 'accept' ? '✓' : r === 'reject' ? '✗' : '…'}`));
      if (r === 'accept' && iAmProposer) resp.append(h('button', { class: 'btn sm primary', onclick: () => App.dispatch({ type: 'confirmTrade', pid: t.from, with: pid }) }, `Cambiar con ${o.name}`));
    }
  }
  if (iAmProposer) resp.append(h('button', { class: 'btn sm ghost', onclick: () => App.dispatch({ type: 'cancelTrade', pid: t.from }) }, 'Cancelar oferta'));
  panel.append(resp);
  return panel;
}

// ---------------- modals ----------------
let modalSeq = 0;
function openModal(fn) {
  ui.modal = fn;
  ui.modalId = ++modalSeq;
  renderModal(App.state);
}
function closeModal() {
  ui.modal = null;
  ui.draft = null;
  renderModal(App.state);
}

// The frame (dark backdrop + window) is kept while the same modal stays open and only its
// content is refreshed: rebuilding the frame replays the pop-in animation on every click.
function renderModal(st, v = App.viewer, locked = false) {
  const box = ui.els.overlay;
  const m = locked || !st ? null : modalContent(st, v);
  let ov = box.firstElementChild;
  if (!m) {
    if (ov) clear(box);
    return;
  }
  if (!ov || ov.dataset.kind !== m.kind) {
    clear(box);
    ov = h('div', { class: 'overlay', 'data-kind': m.kind, onclick: e => { if (m.closable && e.target === e.currentTarget) closeModal(); } },
      h('div', { class: 'modal', style: m.center ? { textAlign: 'center' } : null }));
    box.append(ov);
  }
  sync(ov.firstElementChild, m.body);
}

function modalContent(st, v) {
  // online: reconnecting / table vote about a disconnected player
  if (App.isOnline()) {
    const net = App.net;
    if (net.role === 'client' && net.reconnecting)
      return { kind: 'reconnect', center: true, body: h('div', null,
        h('h2', { class: 'jit' }, '📡 Reconectando...'),
        h('p', null, 'Se perdió la señal con el anfitrión. Tu asiento te espera: sigo intentando volver a la sala.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn ghost', onclick: () => App.leaveGame() }, 'Salir al menú'))) };
    const vote = net.currentVote();
    if (vote && vote.voters.includes(App.mySeat)) {
      const mine = vote.votes[App.mySeat];
      const count = k => Object.values(vote.votes).filter(x => x === k).length;
      const opt = (k, label, cls) => h('button', { class: 'btn ' + cls + (mine === k ? ' active' : ''), disabled: !!mine, onclick: () => { net.sendVote(k); } }, `${label} (${count(k)})`);
      return { kind: 'vote' + vote.id, center: true, body: h('div', null,
        h('h2', null, `🔌 ${vote.name} se desconectó`),
        h('p', null, mine ? `Votaste. Esperando al resto (${Object.keys(vote.votes).length}/${vote.voters.length})... ${vote.left}s` : `¿Qué hacemos? Decide la mayoría. Si vuelve antes, recupera su asiento. ${vote.left}s`),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          opt('wait', '⏳ Esperar', ''), opt('bot', '🤖 Que juegue un bot', 'green'), opt('remove', '🚪 Retirarlo', 'pink'))) };
    }
  }
  // forced modals
  if (st.phase === 'discard' && st.pendingDiscards[v] && localHumans(st).includes(v)) {
    if (!ui.discard || ui.discard.pid !== v) ui.discard = { pid: v, res: G.zeroRes() };
    return { kind: 'discard' + v, body: discardModal(st, v) };
  }
  ui.discard = null;
  if (st.phase === 'gameOver' && !ui.lastWinnerShown) {
    ui.lastWinnerShown = true;
    // a rematch may have started in the meantime: only show it for the game that ended
    const u = ui;
    setTimeout(() => ui === u && openGameOver(App.state), 1200);
  }
  if (!ui.modal) return null;
  const content = ui.modal(st);
  if (!content) return null;
  return { kind: 'm' + ui.modalId, closable: true, body: content };
}

function discardModal(st, v) {
  const need = st.pendingDiscards[v];
  const d = ui.discard.res;
  const p = st.players[v];
  const n = G.handSize(d);
  return h('div', null,
    h('h2', null, `🗑️ ${p.name}: descarta ${need}`),
    h('p', null, `¡Salió un 7 y tienes más de ${st.config.rules.handLimit} cartas! Elige ${need} para devolver al banco.`),
    h('div', { class: 'steppers' }, RES.map(r => stepper('desc', d, r, p.res[r]))),
    h('div', { class: 'row' },
      h('span', { class: 'pill' }, `${n} / ${need}`),
      h('button', { class: 'btn primary', disabled: n !== need, onclick: () => { const res = { ...d }; ui.discard = null; App.dispatch({ type: 'discard', pid: v, res }); } }, 'Descartar')));
}

export function openGameOver(st) {
  if (!st || st.phase !== 'gameOver' || st.winner == null) return;
  const ranking = [...st.players].sort((a, b) => G.victoryPoints(st, b.id) - G.victoryPoints(st, a.id));
  const w = st.players[st.winner];
  const maxRoll = Math.max(1, ...st.stats.rolls);
  openModal(() => h('div', null,
    h('div', { class: 'winner-hero' }, h('div', { class: 'trophy' }, '🏆'), h('h2', { style: { color: w.color } }, `¡${w.name} gana!`), h('p', null, `En ${st.round} rondas (${st.turn} turnos).`)),
    h('table', { class: 'score-table' },
      h('tr', null, ['Jugador', 'PV', '🏠', '🏰', '🏆🃏', '⚔️', '🛣️', 'Robó', 'Ganó'].map(x => h('th', null, x))),
      ranking.map(p => {
        const bs = Object.values(st.buildings).filter(b => b.owner === p.id);
        return h('tr', null,
          h('td', null, h('b', { class: 'pname', style: { '--pc': p.color } }, p.name)),
          h('td', null, h('b', null, G.victoryPoints(st, p.id))),
          h('td', null, bs.filter(b => b.type === 'settlement').length),
          h('td', null, bs.filter(b => b.type === 'city').length),
          h('td', null, p.dev.filter(c => c.type === 'vp').length),
          h('td', null, p.knights + (st.largestArmy.owner === p.id ? '🏅' : '')),
          h('td', null, p.roadLen + (st.longestRoad.owner === p.id ? '🏅' : '')),
          h('td', null, p.stats.stolen),
          h('td', null, p.stats.gained));
      })),
    h('div', { class: 'section-label' }, 'Dados de la partida'),
    h('div', { class: 'hist' }, st.stats.rolls.slice(2).map((n, i) => h('div', { class: i + 2 === 7 ? 's' : '', style: { height: (n / maxRoll) * 100 + '%' } }, h('em', null, n || ''), h('span', null, i + 2)))),
    h('div', { class: 'row', style: { marginTop: '28px' } },
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Ver tablero'),
      h('button', { class: 'btn', onclick: () => { closeModal(); App.leaveGame(); } }, '🏠 Menú'),
      !App.isClient() ? h('button', { class: 'btn primary', onclick: () => { closeModal(); App.rematch(); } }, '🔁 Revancha') : null)));
}

function openMenu() {
  openModal(() => h('div', null,
    h('h2', null, '☰ Menú'),
    h('div', { style: { display: 'grid', gap: '10px' } },
      ui.board3d ? h('div', null, h('div', { class: 'section-label' }, 'Gráficos 3D'), h('div', { class: 'gfx-row' },
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_TILT() ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ tiltShift: !ui.board3d.constructor.SETTINGS_TILT() }); renderModal(App.state); } }, '📷 Tilt-shift'),
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_PIXEL() > 1 ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ pixel: ui.board3d.constructor.SETTINGS_PIXEL() > 1 ? 1 : 3 }); renderModal(App.state); } }, '👾 Filtro pixel'),
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_AO() ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ ao: !ui.board3d.constructor.SETTINGS_AO() }); renderModal(App.state); } }, '🌑 Oclusión ambiental'),
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_Q() === 'high' ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ quality: ui.board3d.constructor.SETTINGS_Q() === 'high' ? 'low' : 'high' }); toast('Calidad cambiada: se aplica al recargar el mapa'); renderModal(App.state); } }, '✨ Alta calidad'),
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_OUTLINE() ? ' on' : ''), title: 'Contorno fino del color de cada jugador, visible a través de montañas y árboles', onclick: () => { ui.board3d.setGraphics({ outline: !ui.board3d.constructor.SETTINGS_OUTLINE() }); renderModal(App.state); } }, '🔲 Contorno de piezas'))) : null,
      h('div', null, h('div', { class: 'section-label' }, 'Iconos de recursos'), h('div', { class: 'gfx-row' },
        ICON_SETS.map(k => [k, { render: '🧊 3D (Blender)', pico: '🆕 Pixel PICO', classic: '🕹️ Clásicos' }[k]]).map(([k, l]) => h('button', { class: 'chip' + (iconSet() === k ? ' on' : ''), onclick: () => { setIconSet(k); if (ui.board3d) ui.board3d.staticKey = ''; render(App.state); } }, l)))),
      h('button', { class: 'btn', onclick: () => { closeModal(); showHelp(); } }, '📖 Cómo se juega'),
      h('button', { class: 'btn', onclick: () => { const on = App.toggleSound(); toast(on ? '🔊 Sonido activado' : '🔇 Sonido desactivado'); } }, '🔊 Sonido on/off'),
      h('div', null, h('div', { class: 'section-label' }, 'Velocidad de los bots'), speedControl()),
      h('div', { class: 'section-label' }, 'Partida'),
      h('div', { class: 'pill' }, `Semilla: ${App.state.config.seed}`),
      !App.isClient() ? h('button', { class: 'btn', onclick: () => { closeModal(); App.rematch(); } }, '🔁 Nueva partida con la misma configuración') : null,
      h('button', { class: 'btn pink', onclick: () => { closeModal(); App.leaveGame(); } }, App.isOnline() ? '🚪 Salir de la sala' : '💾 Guardar y salir al menú')),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Cerrar'))));
}
