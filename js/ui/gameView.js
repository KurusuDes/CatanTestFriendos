import { App } from '../app.js';
import { h, clear, rich, toast, storage } from './dom.js';
import { BoardView } from './boardView.js';
import { RES, TILE_INFO, COSTS, DEV_INFO, EVENTS } from '../engine/constants.js';
import * as G from '../engine/game.js';
import { hint } from '../engine/bot.js';
import { play } from './sfx.js';
import { showHelp } from './help.js';

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
    h('div', { class: 'brand' }, 'Catan ', h('i', null, 'x'), ' Kchudites'),
    els.turn, els.event, els.dice,
    h('div', { class: 'top-actions' },
      h('button', { class: 'btn sm', title: 'Ayuda', onclick: () => showHelp() }, '❔'),
      h('button', { class: 'btn sm', title: 'Menú', onclick: () => openMenu() }, '☰')));
  boardWrap.append(els.banner, els.offer,
    h('div', { class: 'zoom-ctrl' },
      h('button', { class: 'btn', title: 'Acercar', onclick: () => ui.board.setZoom(ui.board.zoom * 1.25) }, '+'),
      h('button', { class: 'btn', title: 'Alejar', onclick: () => ui.board.setZoom(ui.board.zoom / 1.25) }, '−'),
      h('button', { class: 'btn', title: 'Centrar', onclick: () => ui.board.resetView() }, '⤢'),
      h('button', { class: 'btn', id: 'viewToggle', title: 'Cambiar vista 2D / 3D', style: { fontSize: '13px', fontWeight: 900 }, onclick: () => setView3D(!ui.is3D) }, '3D')));
  root.append(h('div', { class: 'game screen' },
    topbar,
    h('main', { class: 'game-main' }, boardWrap, h('aside', { class: 'side' }, els.players, els.bank, els.log)),
    els.actionbar), els.overlay, els.pass);
  ui = {
    els, pick: null, modal: null, draft: null, unlockedFor: null, rolledAt: 0, rolled: null,
    pulseTiles: new Set(), pulseAt: 0, lastCurrent: null, gains: [], lastWinnerShown: false,
  };
  ui.board2d = ui.board = new BoardView(boardWrap);
  ui.boardWrap = boardWrap;
  if (storage('kchudites.view3d') !== false) setView3D(true);
  boardWrap.addEventListener('click', e => {
    if (ui.pick && e.target.tagName !== 'CANVAS') {
      ui.pick = null;
      render(App.state);
    }
  });
  document.onkeydown = e => {
    if (App.screen !== 'game') return;
    if (e.key === 'Escape') {
      ui.pick = null;
      closeModal();
      render(App.state);
    }
  };
  App.listeners = [st => {
    handleFx(st);
    render(st);
  }];
  App.onLeave = () => {
    App.listeners = [];
    disposeGameView();
  };
}

// ---------------- 2D / 3D ----------------
async function setView3D(on) {
  const u = ui;
  storage('kchudites.view3d', on);
  if (on && !u.is3D) {
    try {
      const { Board3D } = await import('./board3d.js');
      if (ui !== u) return;
      u.board3d = u.board3d || (await Board3D.create(u.boardWrap));
      if (ui !== u) return u.board3d.dispose();
      u.board2d.svg.style.display = 'none';
      u.board3d.canvas.style.display = '';
      u.board = u.board3d;
      u.is3D = true;
    } catch (e) {
      console.error(e);
      toast('No se pudo cargar la vista 3D (¿sin conexión o WebGL?)', 'error');
      storage('kchudites.view3d', false);
      return;
    }
  } else if (!on && u.is3D) {
    u.board3d.canvas.style.display = 'none';
    u.board2d.svg.style.display = '';
    u.board = u.board2d;
    u.is3D = false;
  }
  const b = document.getElementById('viewToggle');
  if (b) b.textContent = u.is3D ? '2D' : '3D';
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
  for (const f of st.fx || []) {
    switch (f.kind) {
      case 'dice': {
        ui.rolled = f.dice[0] + f.dice[1];
        ui.rolledAt = Date.now();
        ui.diceAnim = true;
        play.dice();
        if (ui.rolled === 7) setTimeout(() => play.robber(), 350);
        break;
      }
      case 'gain':
        ui.gains.push({ pid: f.pid, text: `+${f.n}${TILE_INFO[f.res].icon}`, at: Date.now() });
        if (f.pid === v) {
          ui.bumpRes = ui.bumpRes || new Set();
          ui.bumpRes.add(f.res);
          play.gain();
        }
        break;
      case 'build':
        if (!f.hidden || f.pid === v) play.build();
        break;
      case 'steal':
        if (f.from === v) toast(h('span', null, rich(`🫳 @${f.to} te robó `, st.players), TILE_INFO[f.res].icon), 'error');
        else if (f.to === v) toast(h('span', null, rich(`🫳 Le robaste a @${f.from}: `, st.players), TILE_INFO[f.res].icon), 'good');
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
      case 'devBought':
        if (f.pid === v) toast(`🃏 Compraste: ${DEV_INFO[f.type].icon} ${DEV_INFO[f.type].name}`, 'good');
        break;
      case 'win':
        play.win();
        confetti();
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

// ---------------- render ----------------
export function render(st) {
  if (!ui || !st) return;
  const v = computeViewer(st);
  App.viewer = v;
  const locked = privacyOn(st) && v >= 0 && ui.unlockedFor !== v;
  renderPass(st, v, locked);
  renderTop(st);
  renderBoard(st, v, locked);
  renderPlayers(st, v);
  renderLog(st);
  renderActions(st, v, locked);
  renderOffer(st, v, locked);
  renderModal(st, v, locked);
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
  const acting = new Set(G.pendingActors(st));
  const now = Date.now();
  ui.gains = ui.gains.filter(g => now - g.at < 1600);
  for (const p of st.players) {
    const pub = G.victoryPoints(st, p.id, false);
    const all = G.victoryPoints(st, p.id, true);
    const me = p.id === v;
    const tag = p.kind === 'bot' ? `bot ${{ easy: 'fácil', normal: 'normal', hard: 'difícil' }[p.level] || ''}` : me ? 'tú' : '';
    const card = h('div', { class: 'pcard' + (st.current === p.id ? ' current' : '') + (st.winner === p.id ? ' winner' : ''), style: { '--pc': p.color } },
      h('div', { class: 'top' },
        h('div', { class: 'avatar' }, p.kind === 'bot' ? '🤖' : p.name.slice(0, 1).toUpperCase()),
        h('div', { class: 'name' }, p.name, tag && h('small', null, tag)),
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
  const bar = clear(ui.els.actionbar);
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
    else acts.append(h('div', { class: 'waiting' }, st.phase === 'setup' && G.pendingActors(st)[0] === v ? '👆 Toca el tablero' : `⏳ Esperando a ${st.players[G.pendingActors(st)[0]].name}...`));
    return;
  }
  if (st.phase === 'roll') {
    acts.append(h('button', { class: 'btn primary big', onclick: () => App.dispatch({ type: 'roll', pid: v }) }, '🎲 Tirar dados'));
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
    }, icon, h('span', null, label, h('span', { class: 'cost' }, costIcons(COSTS[what]))));
  };
  acts.append(
    buildBtn('road', 'Camino', '🛤️', p.roadsLeft, () => G.legalRoads(st, v)),
    buildBtn('settlement', 'Poblado', '🏠', p.settlementsLeft, () => G.legalSettlements(st, v)),
    buildBtn('city', 'Ciudad', '🏰', p.citiesLeft, () => G.legalCities(st, v)),
    h('button', {
      class: 'btn', disabled: !st.devDeck.length || !G.canAfford(p.res, COSTS.dev), title: `Carta de desarrollo — cuesta ${costIcons(COSTS.dev)}`,
      onclick: () => App.dispatch({ type: 'buyDev', pid: v }),
    }, '🃏', h('span', null, 'Carta', h('span', { class: 'cost' }, costIcons(COSTS.dev)))),
    h('button', { class: 'btn', disabled: !!st.trade, onclick: () => openTrade(v) }, '🤝 Comerciar'),
    h('button', { class: 'btn sm ghost', title: 'Pista', onclick: () => showHint(st, v) }, '💡'),
    h('button', { class: 'btn green', onclick: () => App.dispatch({ type: 'endTurn', pid: v }) }, '✅ Terminar'));
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

function renderOffer(st, v, locked) {
  const box = clear(ui.els.offer);
  const t = st.trade;
  if (!t || locked || st.phase === 'gameOver') return;
  const from = st.players[t.from];
  const mine = localHumans(st);
  const iAmProposer = mine.includes(t.from);
  const pendingMe = t.to.filter(pid => mine.includes(pid) && t.responses[pid] == null);
  if (!iAmProposer && !pendingMe.length && !(v >= 0 && t.to.includes(v))) return;
  const panel = h('div', { class: 'offer' },
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
  box.append(panel);
}

// ---------------- modals ----------------
function openModal(fn) {
  ui.modal = fn;
  renderModal(App.state);
}
function closeModal() {
  ui.modal = null;
  ui.draft = null;
  clear(ui.els.overlay);
}

function renderModal(st, v = App.viewer, locked = false) {
  const box = clear(ui.els.overlay);
  if (locked) return;
  // forced modals
  if (st.phase === 'discard' && st.pendingDiscards[v] && localHumans(st).includes(v)) {
    if (!ui.discard || ui.discard.pid !== v) ui.discard = { pid: v, res: G.zeroRes() };
    box.append(h('div', { class: 'overlay' }, h('div', { class: 'modal' }, discardModal(st, v))));
    return;
  }
  ui.discard = null;
  if (st.phase === 'gameOver' && !ui.lastWinnerShown) {
    ui.lastWinnerShown = true;
    setTimeout(() => openGameOver(App.state), 1200);
  }
  if (!ui.modal) return;
  const content = ui.modal(st);
  if (!content) return;
  box.append(h('div', { class: 'overlay', onclick: e => { if (e.target === e.currentTarget) closeModal(); } }, h('div', { class: 'modal' }, content)));
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
      h('button', { class: 'btn', onclick: () => { closeModal(); setView3D(!ui.is3D); } }, ui.is3D ? '🗺️ Vista plano 2D' : '🏔️ Vista mapa 3D'),
      ui.is3D && ui.board3d ? h('div', null, h('div', { class: 'section-label' }, 'Gráficos 3D'), h('div', { class: 'gfx-row' },
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_TILT() ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ tiltShift: !ui.board3d.constructor.SETTINGS_TILT() }); renderModal(App.state); } }, '📷 Tilt-shift'),
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_PIXEL() > 1 ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ pixel: ui.board3d.constructor.SETTINGS_PIXEL() > 1 ? 1 : 3 }); renderModal(App.state); } }, '👾 Filtro pixel'),
        h('button', { class: 'chip' + (ui.board3d.constructor.SETTINGS_Q() === 'high' ? ' on' : ''), onclick: () => { ui.board3d.setGraphics({ quality: ui.board3d.constructor.SETTINGS_Q() === 'high' ? 'low' : 'high' }); toast('Calidad cambiada: se aplica al recargar el mapa'); renderModal(App.state); } }, '✨ Alta calidad'))) : null,
      h('button', { class: 'btn', onclick: () => { closeModal(); showHelp(); } }, '📖 Cómo se juega'),
      h('button', { class: 'btn', onclick: () => { const on = App.toggleSound(); toast(on ? '🔊 Sonido activado' : '🔇 Sonido desactivado'); } }, '🔊 Sonido on/off'),
      h('div', null, h('div', { class: 'section-label' }, 'Velocidad de los bots'), speedControl()),
      h('div', { class: 'section-label' }, 'Partida'),
      h('div', { class: 'pill' }, `Semilla: ${App.state.config.seed}`),
      !App.isClient() ? h('button', { class: 'btn', onclick: () => { closeModal(); App.rematch(); } }, '🔁 Nueva partida con la misma configuración') : null,
      h('button', { class: 'btn pink', onclick: () => { closeModal(); App.leaveGame(); } }, App.isOnline() ? '🚪 Salir de la sala' : '💾 Guardar y salir al menú')),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Cerrar'))));
}
