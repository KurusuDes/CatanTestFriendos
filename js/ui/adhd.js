// ADHD: a tiny arcade to kill time while the others play (🧠 button next to the reactions).
// Per player and purely local: one wallet that starts at $100, and every goal reached adds the
// next machine to the grid (Plinko → slots → coin → rocket), all playable at once; a machine you
// have already beaten gets an Auto button (all but the rocket). Going broke sends you back to the Plinko. Only the final win is shared:
// it is a game action, so everyone sees the fireworks and the banner, and the winner's pieces get gold trims (up to 5 wins).
import { App } from '../app.js';
import { h, clear, toast, storage } from './dom.js';
import { pxURL } from './pixel.js';
import { play } from './sfx.js';
import { pendingActors } from '../engine/game.js';

const KEY = 'kchudites.adhd.v1';
const START = 100;
const GOALS = [200, 400, 800, 1600]; // reaching GOALS[i] adds machine i+1; the last one wins
const BETS = [5, 10, 25, 50, 100];
const BG = '#0f1020';

const round = n => Math.round(n * 100) / 100;
const fmt = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
const rnd = n => Math.floor(Math.random() * n);

let A = null;

// ---------------- mounting & the window ----------------
export function mountAdhd(wrap, getBoard) {
  disposeAdhd();
  A = { wrap, getBoard, seat: null, w: null, games: [], open: false, forced: false, mustAct: null, visible: false, raf: 0 };
  // clicks inside must not reach the board (they would cancel a pending pick)
  A.win = h('div', { class: 'adhd hidden', onclick: e => e.stopPropagation(), onpointerdown: e => e.stopPropagation() });
  wrap.append(A.win);
}

export function disposeAdhd() {
  cheers.length = 0;
  clearTimeout(cheerT);
  cheerT = 0;
  if (!A) return;
  settleAll();
  saveNow();
  cancelAnimationFrame(A.raf);
  for (const g of A.games) g && g.dispose();
  A.win.remove();
  A = null;
}

export function adhdButton() {
  return h('button', {
    class: 'btn adhd-toggle' + (A && A.visible ? ' on' : ''),
    title: 'ADHD: minijuegos mientras esperas',
    onclick: e => {
      e.stopPropagation();
      toggleAdhd();
    },
  }, '🧠');
}

// called on every render: whose wallet, whether it's your turn (out of the way) and whether a
// trade offer is up (the arcade goes behind it)
export function updateAdhd(st, v, offerUp) {
  if (!A) return;
  const seat = v >= 0 && st.phase !== 'gameOver' ? v : null;
  if (seat !== A.seat) setSeat(seat);
  const must = seat != null && pendingActors(st).includes(seat);
  if (must !== A.mustAct) {
    A.mustAct = must;
    A.forced = must; // your turn: it hides, and comes back by itself when you're done
  }
  A.win.classList.toggle('behind', !!offerUp);
  apply();
}

function toggleAdhd() {
  if (!A || A.seat == null) return;
  if (A.open && !A.forced) A.open = false;
  else {
    A.open = true;
    A.forced = false; // opened by hand during your turn: your call
  }
  apply();
}

function apply() {
  const vis = A.seat != null && A.open && !A.forced;
  if (!vis && A.visible) settleAll(); // closing it cashes out anything still in the air
  A.visible = vis;
  A.win.classList.toggle('hidden', !vis);
  const btn = document.querySelector('.adhd-toggle');
  if (btn) btn.classList.toggle('on', vis);
  if (vis && !A.raf) A.raf = requestAnimationFrame(loop);
}

function loop(now) {
  if (!A) return;
  if (!A.visible) return (A.raf = 0);
  for (const g of A.games) g && g.frame(now);
  A.raf = requestAnimationFrame(loop);
}

function settleAll() {
  for (const g of A.games) g && g.settle();
}

// ---------------- the wallet (one per seat, kept for this match) ----------------
function gameId() {
  return App.state && App.state.config ? App.state.config.seed : 0;
}

function loadStore() {
  const s = storage(KEY);
  return s && s.id === gameId() ? s : { id: gameId(), seats: {} };
}

function saveNow() {
  if (!A) return;
  clearTimeout(A.saveT);
  if (A.seat == null || !A.w) return;
  const s = loadStore();
  s.seats[A.seat] = A.w;
  storage(KEY, s);
}

function save() {
  clearTimeout(A.saveT);
  A.saveT = setTimeout(saveNow, 400);
}

function setSeat(seat) {
  settleAll();
  saveNow();
  A.seat = seat;
  A.w = seat == null ? null : loadStore().seats[seat] || { money: START, level: 1, wins: 0 };
  A.mustAct = null;
  build();
}

function build() {
  for (const g of A.games) g && g.dispose();
  A.games = [];
  clear(A.win);
  if (A.seat == null) return;
  A.money = h('b', { class: 'adhd-money nopx' });
  A.bar = h('i');
  A.goal = h('span', { class: 'adhd-goal nopx' });
  A.wins = h('span', { class: 'adhd-wins' });
  A.grid = h('div', { class: 'adhd-grid' });
  for (let i = 0; i < GOALS.length; i++) A.grid.append(h('div', { class: 'adhd-slot' })); // empty until earned: a surprise
  A.win.append(
    h('div', { class: 'adhd-head' },
      h('span', { class: 'adhd-title' }, '🧠 ADHD'), A.money, h('div', { class: 'adhd-prog' }, A.bar), A.goal, A.wins,
      h('button', { class: 'btn sm adhd-min', title: 'Minimizar', onclick: toggleAdhd }, '—')),
    A.grid);
  for (let i = 0; i < A.w.level; i++) addGame(i, false);
  refresh();
}

function addGame(i, fresh) {
  const g = [plinko, slots, coin, rocket][i](purse(i));
  A.games[i] = g;
  if (fresh) g.el.classList.add('fresh');
  A.grid.children[i].replaceWith(g.el);
}

// what a machine sees of the wallet; a machine thrown away (win, bust, seat change) can't pay any more
function purse(i) {
  const K = {
    dead: false,
    spend(n) {
      if (K.dead || A.w.money < n - 1e-9) return false;
      A.w.money = round(A.w.money - n);
      // no bust check here: the bet is still in play, it gets checked when it resolves
      refresh();
      save();
      return true;
    },
    pay(n) {
      if (K.dead) return;
      A.w.money = round(A.w.money + n);
      changed();
    },
    done() {
      if (!K.dead) changed();
    },
    money: () => A.w.money,
    passed: () => A.w.level > i + 1, // the next machine is out: this one may run on Auto
  };
  return K;
}

function changed() {
  const w = A.w;
  while (w.level < GOALS.length && w.money >= GOALS[w.level - 1]) {
    w.level++;
    addGame(w.level - 1, true);
    play.unlock();
  }
  if (w.level === GOALS.length && w.money >= GOALS[GOALS.length - 1]) return win();
  if (w.money < 1 && !A.games.some(g => g && g.busy())) return bust();
  refresh();
  save();
}

function refresh() {
  const w = A.w;
  const goal = GOALS[w.level - 1];
  A.money.textContent = fmt(w.money);
  A.goal.textContent = '/ ' + fmt(goal);
  A.bar.style.width = Math.min(100, (w.money / goal) * 100) + '%';
  A.wins.textContent = w.wins ? `🏆${w.wins}` : '';
  for (const g of A.games) g && g.sync();
}

function bust() {
  A.w = { money: START, level: 1, wins: A.w.wins };
  saveNow();
  build();
  play.bad();
  toast('💸 ¡Quebraste! De vuelta al Plinko con $100', 'error', 3000);
}

function win() {
  A.w = { money: START, level: 1, wins: A.w.wins + 1 };
  saveNow();
  build();
  App.cheer(A.seat);
}

// ---------------- shared bits for the machines ----------------
function canvas(w, hh) {
  const c = h('canvas', { width: w, height: hh, class: 'adhd-cv' });
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

const IMGS = {};
function sprite(e) {
  let i = IMGS[e];
  if (!i) {
    i = IMGS[e] = new Image();
    i.src = pxURL(e, 32);
  }
  return i;
}
function drawSprite(g, e, x, y, w, hh = w) {
  const i = sprite(e);
  if (i.complete && i.naturalWidth) g.drawImage(i, Math.round(x), Math.round(y), Math.round(w), Math.round(hh));
}

function text(g, s, x, y, color, size = 8) {
  g.font = `${size}px Silkscreen, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#1a1c2c';
  g.fillText(s, x + 1, y + 1);
  g.fillStyle = color;
  g.fillText(s, x, y);
}

function betButton(get, set) {
  const b = h('button', {
    class: 'btn sm nopx',
    title: 'Cambiar apuesta',
    onclick: () => {
      set(BETS[(BETS.indexOf(get()) + 1) % BETS.length]);
      b.textContent = fmt(get());
    },
  }, fmt(get()));
  return b;
}

// Auto shows up once you've beaten the machine; it plays for you until you stop it or can't pay
function autoButton() {
  const a = {
    on: false,
    at: 0, // next automatic play (ms)
    set(v) {
      a.on = v;
      a.at = 0;
      a.el.classList.toggle('pink', v);
    },
    show(v) {
      a.el.style.display = v ? '' : 'none';
      if (!v && a.on) a.set(false);
    },
    due(now) {
      return a.on && now >= a.at;
    },
  };
  a.el = h('button', { class: 'btn sm', style: { display: 'none' }, onclick: () => a.set(!a.on) }, 'Auto');
  return a;
}

function cell(title, ...kids) {
  return h('div', { class: 'adhd-cell' }, h('h4', null, title), ...kids);
}

// ---------------- 1. Plinko: $1 a ball ----------------
function plinko(K) {
  const W = 90, H = 72, ROWS = 8, DX = 10, DY = 7, TOP = 6, SEG = 85;
  const MULT = [25, 5, 2, 1.2, 0.4, 1.2, 2, 5, 25];
  const COL = ['#b13e53', '#ef7d57', '#ffcd75', '#38b764', '#566c86'];
  const binCol = k => COL[Math.min(k, 8 - k)];
  const [cv, g] = canvas(W, H);
  let balls = [], flashes = [];
  const auto = autoButton();
  const el = cell('Plinko', cv,
    h('div', { class: 'adhd-bins nopx' }, MULT.map(m => h('span', null, m < 1 ? String(m).slice(1) : m))),
    h('div', { class: 'adhd-row' }, h('button', { class: 'btn sm primary', onclick: drop }, 'Soltar $1'), auto.el));

  function drop() {
    if (balls.length >= 40) return;
    if (!K.spend(1)) return auto.set(false);
    const xs = [];
    let r = 0;
    for (let row = 0; row <= ROWS; row++) {
      xs.push(W / 2 + (r - row / 2) * DX);
      if (row < ROWS && Math.random() < 0.5) r++;
    }
    balls.push({ xs, k: r, t0: performance.now() });
  }
  const point = (b, i) => (i < 0 ? [W / 2, -3] : [b.xs[i], i < ROWS ? TOP + i * DY - 2 : H - 7]);
  function land(b) {
    balls.splice(balls.indexOf(b), 1);
    flashes.push({ k: b.k, t: performance.now() });
    if (MULT[b.k] >= 5) play.gain();
    K.pay(MULT[b.k]);
  }
  return {
    el,
    busy: () => balls.length > 0,
    sync() {
      auto.show(K.passed());
    },
    settle() {
      auto.set(false);
      for (const b of [...balls]) land(b);
    },
    dispose() {
      K.dead = true;
    },
    frame(now) {
      if (auto.due(now)) {
        drop();
        auto.at = now + 230;
      }
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#566c86';
      for (let r = 0; r < ROWS; r++) for (let j = 0; j <= r; j++) g.fillRect(Math.round(W / 2 + (j - r / 2) * DX) - 1, TOP + r * DY, 2, 2);
      flashes = flashes.filter(f => now - f.t < 700);
      for (let k = 0; k < 9; k++) {
        const lit = flashes.some(f => f.k === k && now - f.t < 160);
        g.fillStyle = lit ? '#f4f4f4' : binCol(k);
        g.fillRect(k * DX + 1, H - 6, DX - 2, 6);
      }
      g.fillStyle = '#ffcd75';
      for (const b of [...balls]) {
        const e = (now - b.t0) / SEG, i = Math.floor(e);
        if (i > ROWS) {
          land(b);
          continue;
        }
        const [x0, y0] = point(b, i - 1), [x1, y1] = point(b, i), t = e - i;
        g.fillRect(Math.round(x0 + (x1 - x0) * t) - 1, Math.round(y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * 3) - 1, 3, 3);
      }
      for (const f of flashes) if (MULT[f.k] >= 2) text(g, '+' + MULT[f.k], f.k * DX + DX / 2, H - 12 - (now - f.t) / 50, '#a7f070', 7);
    },
  };
}

// ---------------- 2. Slots: three reels ----------------
function slots(K) {
  const SYM = ['🍒', '🍋', '🍀', '🔔', '⭐', '💎'], TRIO = [5, 5, 8, 10, 15, 30], N = SYM.length;
  const W = 90, H = 34, RW = 26, STEP = 20;
  const [cv, g] = canvas(W, H);
  const pos = [0, 2, 4];
  let bet = 10, spin = null;
  const auto = autoButton();
  const note = h('div', { class: 'adhd-note nopx' }, 'Par x2 · Trío x5 a x30');
  const el = cell('Tragamonedas', cv,
    h('div', { class: 'adhd-row' }, betButton(() => bet, b => (bet = b)), h('button', { class: 'btn sm primary', onclick: () => go() }, 'Girar'), auto.el), note);
  const ease = t => 1 + 1.8 * (t - 1) ** 3 + 0.8 * (t - 1) ** 2; // stops with a little bounce

  function go(byAuto) {
    if (spin) return;
    if (!K.spend(bet)) {
      auto.set(false);
      return byAuto || toast('No te alcanza', 'error', 1500);
    }
    const res = [rnd(N), rnd(N), rnd(N)];
    spin = {
      bet, res, t0: performance.now(),
      reels: res.map((r, i) => {
        const base = Math.ceil(pos[i]) + N * (3 + i);
        return { p0: pos[i], p1: base + (((r - base) % N) + N) % N, d: 800 + 350 * i, stopped: false };
      }),
    };
    note.textContent = '...';
  }
  function finish() {
    const s = spin;
    spin = null;
    s.reels.forEach((r, i) => (pos[i] = r.p1));
    auto.at = performance.now() + 450;
    const [a, b, c] = s.res;
    const m = a === b && b === c ? TRIO[a] : a === b || b === c || a === c ? 2 : 0;
    note.textContent = m ? `x${m} → +${fmt(s.bet * m)}` : 'Nada...';
    if (!m) return K.done();
    m >= 5 ? play.event() : play.gain();
    K.pay(s.bet * m);
  }
  return {
    el,
    busy: () => !!spin,
    sync() {
      auto.show(K.passed());
    },
    settle() {
      auto.set(false);
      if (spin) finish();
    },
    dispose() {
      K.dead = true;
    },
    frame(now) {
      if (!spin && auto.due(now)) go(true);
      if (spin) {
        for (const R of spin.reels) {
          const t = Math.min(1, (now - spin.t0) / R.d);
          pos[spin.reels.indexOf(R)] = R.p0 + (R.p1 - R.p0) * ease(t);
          if (t >= 1 && !R.stopped) {
            R.stopped = true;
            play.click();
          }
        }
        if (spin.reels.every(r => r.stopped)) finish();
      }
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 3; i++) {
        const x = 5 + i * (RW + 1.5);
        g.fillStyle = '#f4f4f4';
        g.fillRect(Math.round(x), 4, RW, H - 8);
        g.save();
        g.beginPath();
        g.rect(Math.round(x), 4, RW, H - 8);
        g.clip();
        const p = pos[i];
        for (let k = Math.floor(p) - 1; k <= Math.floor(p) + 2; k++) drawSprite(g, SYM[((k % N) + N) % N], x + RW / 2 - 8, H / 2 + (p - k) * STEP - 8, 16);
        g.restore();
      }
      g.fillStyle = '#b13e53';
      g.fillRect(1, H / 2 - 1, 3, 2);
      g.fillRect(W - 4, H / 2 - 1, 3, 2);
    },
  };
}

// ---------------- 4. Rocket (the last one, no Auto): the multiplier climbs from x0.00, cash out before it blows ----------------
// It mostly blows early: past x5 it's rare and the moon (x10, paid on its own) is 1 in 100. Cash out and a
// ghost rocket keeps going, so you see how far it would have gone.
function rocket(K) {
  const W = 90, H = 50, MAX = 10, MOON = 0.01;
  const stars = Array.from({ length: 24 }, () => [rnd(W), rnd(H - 8), Math.random() * 6]);
  const mAt = s => Math.min(MAX, 0.35 * s + 0.07 * s * s);
  // P(it gets past xm) = (1 - m/10)^2.5: the best cash-out pays about x1.23 on average, like the old x5 rocket
  const crashAt = () => (Math.random() < MOON ? MAX : Math.floor(MAX * (1 - Math.random() ** 0.4) * 100) / 100);
  const [cv, g] = canvas(W, H);
  let bet = 10, fly = null, last = null, ghost = null, V = 2.5;
  // the chart zooms out as the rocket climbs, so it never leaves the screen
  const px = m => 5 + (m / V) * 74, py = m => H - 6 - (m / V) ** 1.25 * (H - 16);
  const btn = h('button', { class: 'btn sm primary', onclick: act }, 'Despegar');
  const note = h('div', { class: 'adhd-note nopx' }, 'Puede llegar a x10… casi nunca');
  const el = cell('Cohete', cv, h('div', { class: 'adhd-row' }, betButton(() => bet, b => (bet = b)), btn), note);

  const at = (f, now) => mAt((now - f.t0) / 1000);
  const cut = m => Math.floor(m * 100) / 100;
  function setBtn(flying) {
    btn.textContent = flying ? 'Retirar' : 'Despegar';
    btn.classList.toggle('primary', !flying);
    btn.classList.toggle('green', flying);
  }
  const resolve = now => (at(fly, now) < fly.crash ? cashout(now) : fly.crash >= MAX ? cashout(now, true) : boom(now));
  function act() {
    const now = performance.now();
    if (fly) return resolve(now);
    if (!K.spend(bet)) return toast('No te alcanza', 'error', 1500);
    fly = { bet, t0: now, crash: crashAt() };
    last = ghost = null;
    setBtn(true);
    note.textContent = '¡Retírate a tiempo!';
  }
  function cashout(now, moon) {
    const f = fly, m = moon ? MAX : cut(at(f, now)), won = round(f.bet * m);
    fly = null;
    last = { m, ok: true, t: now, moon };
    // the rest of the flight goes on without you
    if (!moon) ghost = { t0: f.t0, crash: f.crash, end: 0 };
    setBtn(false);
    note.textContent = moon ? `🌕 ¡Llegaste a la Luna! x10 → ${fmt(won)}` : `Retiraste en x${m.toFixed(2)} → ${fmt(won)}`;
    moon ? play.event() : play.gain();
    K.pay(won);
  }
  function boom(now) {
    const f = fly;
    fly = null;
    last = { m: f.crash, ok: false, t: now, parts: sparks() };
    setBtn(false);
    note.textContent = `¡Boom en x${f.crash.toFixed(2)}!`;
    play.boom();
    K.done();
  }
  const sparks = () => Array.from({ length: 18 }, () => [Math.random() * 6.3, 8 + Math.random() * 22]);
  function curve(m0, m, color) {
    g.fillStyle = color;
    for (let i = 0; i <= 40; i++) {
      const k = m0 + ((m - m0) * i) / 40;
      g.fillRect(Math.round(px(k)), Math.round(py(k)), 2, 2);
    }
  }
  function blast(m, parts, k) {
    for (const [ang, sp] of parts) {
      g.fillStyle = k < 0.3 ? '#f4f4f4' : Math.random() < 0.5 ? '#ef7d57' : '#ffcd75';
      g.fillRect(Math.round(px(m) + Math.cos(ang) * sp * k), Math.round(py(m) + Math.sin(ang) * sp * k + 10 * k * k), 2, 2);
    }
  }
  return {
    el,
    busy: () => !!fly,
    sync() {},
    settle() {
      if (fly) resolve(performance.now());
      ghost = null;
    },
    dispose() {
      K.dead = true;
    },
    frame(now) {
      if (fly && at(fly, now) >= fly.crash) fly.crash >= MAX ? cashout(now, true) : boom(now);
      if (ghost && !ghost.end && at(ghost, now) >= ghost.crash) {
        ghost.end = now;
        ghost.parts = sparks();
        note.textContent += ghost.crash >= MAX ? ' · ¡llegaba a la Luna! 🌕' : ` · llegaba a x${ghost.crash.toFixed(2)}`;
      }
      const gm = ghost && (ghost.end ? ghost.crash : at(ghost, now));
      const top = fly ? at(fly, now) : Math.max(last ? last.m : 0, gm || 0);
      V += (Math.max(2.5, top * 1.2) - V) * (fly || (ghost && !ghost.end) ? 1 : 0.15);
      g.fillStyle = '#1a1c2c';
      g.fillRect(0, 0, W, H);
      for (const [x, y, ph] of stars) {
        g.fillStyle = Math.sin(now / 400 + ph) > 0.2 ? '#94b0c2' : '#333c57';
        g.fillRect(x, y, 1, 1);
      }
      g.fillStyle = '#29366f';
      g.fillRect(0, H - 4, W, 4);
      if (fly) {
        const m = at(fly, now);
        curve(0, m, '#ffcd75');
        drawSprite(g, '🚀', px(m) - 4, py(m) - 10, 13);
        text(g, 'x' + m.toFixed(2), W / 2, 9, m < 1 ? '#ef7d57' : '#f4f4f4', 10);
        return;
      }
      if (!last) return text(g, 'x0.00', W / 2, 9, '#566c86', 10);
      curve(0, last.m, last.ok ? '#38b764' : '#566c86');
      if (last.moon) drawSprite(g, '🌕', px(last.m) - 6, py(last.m) - 8, 13);
      if (!last.ok && now - last.t < 800) blast(last.m, last.parts, (now - last.t) / 800);
      if (ghost) {
        // what you left on the table: a faded rocket that keeps climbing until it blows
        curve(last.m, gm, '#566c86');
        g.fillStyle = '#a7f070';
        g.fillRect(Math.round(px(last.m)) - 1, Math.round(py(last.m)) - 1, 4, 4);
        if (!ghost.end) {
          g.globalAlpha = 0.45;
          drawSprite(g, '🚀', px(gm) - 4, py(gm) - 10, 13);
          g.globalAlpha = 1;
        } else if (now - ghost.end < 800) blast(gm, ghost.parts, (now - ghost.end) / 800);
        if (ghost.end) text(g, 'x' + ghost.crash.toFixed(2), W - 16, H - 11, '#94b0c2', 8);
      }
      text(g, 'x' + last.m.toFixed(2), W / 2, 9, last.ok ? '#a7f070' : '#b13e53', 10);
    },
  };
}

// ---------------- 3. Coin flip: slide how much, pick a side, double or nothing (Auto repeats your last side) ----------------
function coin(K) {
  const W = 90, H = 44, R = 12, CY = 26, FACES = ['👑', '🌾'], COLORS = ['#ffcd75', '#94b0c2'];
  const [cv, g] = canvas(W, H);
  let flip = null, face = 0, bet = 1, lastSide = 0;
  const auto = autoButton();
  const lab = h('b', { class: 'nopx' }, fmt(bet));
  const slider = h('input', {
    type: 'range', min: 1, max: 1, step: 1, value: 1,
    oninput: () => {
      bet = +slider.value;
      lab.textContent = fmt(bet);
    },
  });
  const note = h('div', { class: 'adhd-note nopx' }, 'Doble o nada');
  const el = cell('Moneda', cv,
    h('div', { class: 'adhd-row' }, slider, lab, auto.el),
    h('div', { class: 'adhd-row' },
      h('button', { class: 'btn sm primary', onclick: () => go(0) }, '👑 Cara'),
      h('button', { class: 'btn sm primary', onclick: () => go(1) }, '🌾 Cruz')),
    note);
  const ease = t => 1 - (1 - t) ** 3;

  function go(side) {
    if (flip) return;
    const b = Math.min(bet, Math.floor(K.money()));
    if (b < 1 || !K.spend(b)) return auto.set(false);
    lastSide = side;
    const res = rnd(2);
    flip = { side, res, bet: b, t0: performance.now(), from: face, turns: 10 + ((res - face + 2) % 2) };
    note.textContent = '...';
    play.click();
  }
  function end() {
    const f = flip;
    flip = null;
    face = f.res;
    auto.at = performance.now() + 500;
    if (f.side !== f.res) {
      note.textContent = `Salió ${f.res ? 'cruz' : 'cara'}: -${fmt(f.bet)}`;
      play.bad();
      return K.done();
    }
    note.textContent = `¡Salió ${f.res ? 'cruz' : 'cara'}! +${fmt(f.bet)}`;
    play.gain();
    K.pay(f.bet * 2);
  }
  return {
    el,
    busy: () => !!flip,
    sync() {
      auto.show(K.passed());
      const max = Math.max(1, Math.floor(K.money()));
      slider.max = max;
      if (bet > max) bet = max;
      slider.value = bet;
      lab.textContent = fmt(bet);
    },
    settle() {
      auto.set(false);
      if (flip) end();
    },
    dispose() {
      K.dead = true;
    },
    frame(now) {
      if (!flip && auto.due(now)) go(lastSide);
      let t = 1;
      if (flip) {
        t = Math.min(1, (now - flip.t0) / 1100);
        if (t >= 1) end();
      }
      const ang = flip ? (flip.from + ease(t) * flip.turns) * Math.PI : face * Math.PI;
      const c = Math.cos(ang), sx = Math.max(0.08, Math.abs(c)), side = c >= 0 ? 0 : 1;
      const cy = Math.round(CY - (flip ? Math.sin(Math.PI * t) * 13 : 0));
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#333c57';
      const sh = Math.round(R * (1 - (CY - cy) / 26));
      g.fillRect(W / 2 - sh, H - 4, sh * 2, 2);
      for (let dy = -R - 1; dy <= R + 1; dy++) {
        const o = Math.sqrt(Math.max(0, (R + 1) ** 2 - dy * dy)) * sx, i = Math.sqrt(Math.max(0, R * R - dy * dy)) * sx;
        g.fillStyle = '#1a1c2c';
        g.fillRect(Math.round(W / 2 - o), cy + dy, Math.round(o * 2), 1);
        if (Math.abs(dy) <= R) {
          g.fillStyle = COLORS[side];
          g.fillRect(Math.round(W / 2 - i), cy + dy, Math.round(i * 2), 1);
        }
      }
      if (sx > 0.35) drawSprite(g, FACES[side], W / 2 - 7 * sx, cy - 7, 14 * sx, 14);
    },
  };
}

// ---------------- the win: fireworks from the winner's buildings + a banner (everyone sees it) ----------------
// Winners that land together wait their turn: one banner and one round of fireworks each, in order
const cheers = [];
let cheerT = 0;
export function celebrate(seat, n = 1) {
  cheers.push({ seat, n });
  if (!cheerT) nextCheer();
}

function nextCheer() {
  cheerT = 0;
  const st = App.state;
  if (!cheers.length || !st) return void (cheers.length = 0);
  const { seat, n } = cheers.shift(), p = st.players[seat];
  if (!p) return nextCheer();
  const queued = cheers.filter(c => st.players[c.seat]).map(c => st.players[c.seat].name);
  const band = h('div', { class: 'adhd-band', style: { '--pc': p.color } },
    h('div', null, '🎆 ¡', h('b', null, p.name), ' venció el ADHD! 🧠', n > 1 ? h('span', { class: 'adhd-band-n' }, ` ×${n}`) : null),
    queued.length ? h('small', { class: 'nopx' }, `Después: ${queued.join(', ')}`) : null);
  document.body.append(band);
  setTimeout(() => band.remove(), 5200);
  play.win();
  fireworks(seat, p.color);
  cheerT = setTimeout(nextCheer, 5400);
}

function fireworks(seat, color) {
  const S = 3; // one canvas pixel = 3 screen pixels, like the rest of the pixel art
  const cv = h('canvas', { class: 'adhd-fw', width: Math.ceil(innerWidth / S), height: Math.ceil(innerHeight / S) });
  document.body.append(cv);
  const g = cv.getContext('2d');
  const b = A && A.getBoard ? A.getBoard() : null;
  const pts = b && b.alive ? b.playerPoints(seat) : [];
  const COLORS = [color, color, '#ffcd75', '#f4f4f4', '#ef7d57', '#73eff7', '#a7f070'];
  const rockets = [], sparks = [];
  const t0 = performance.now();
  let next = t0, n = 0, last = t0, lastSnd = 0;
  // launch spots follow the camera: each rocket takes its building's screen position when it lifts off
  const origin = () => {
    if (pts.length) {
      const pt = pts[n % pts.length];
      const s = b.alive && b.toScreen(pt.x, pt.y, pt.z);
      if (s) return s;
    }
    const r = (A ? A.wrap : document.body).getBoundingClientRect();
    return { x: r.left + Math.random() * r.width, y: r.bottom - 12 };
  };
  const done = () => cv.remove();
  setTimeout(done, 12000); // hidden tabs never run the animation
  const frame = now => {
    if (!cv.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (now - t0 < 6500 && now >= next) {
      const o = origin();
      n++;
      rockets.push({ x: o.x / S, y: o.y / S, top: o.y / S - 30 - Math.random() * 45, vx: (Math.random() - 0.5) * 12, c: COLORS[rnd(COLORS.length)] });
      next = now + 110 + Math.random() * 170;
    }
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.y -= 95 * dt;
      r.x += r.vx * dt;
      g.fillStyle = '#ffcd75';
      g.fillRect(Math.round(r.x), Math.round(r.y), 1, 2);
      if (r.y > r.top) continue;
      rockets.splice(i, 1);
      const k = 26 + rnd(16);
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2 + Math.random() * 0.2, sp = 18 + Math.random() * 30;
        sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.6, age: 0, c: Math.random() < 0.7 ? r.c : '#f4f4f4' });
      }
      if (now - lastSnd > 90) {
        lastSnd = now;
        play.firework();
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += dt;
      if (s.age > s.life) {
        sparks.splice(i, 1);
        continue;
      }
      s.vx *= 0.97;
      s.vy = s.vy * 0.97 + 40 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age > s.life * 0.7 && Math.random() < 0.4) continue; // twinkle out
      g.fillStyle = s.c;
      g.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    if (now - t0 > 6500 && !rockets.length && !sparks.length) return done();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
