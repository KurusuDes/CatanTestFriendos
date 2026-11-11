// 6. Rocket (the last one, no Auto): the multiplier climbs from x0.00, cash out before it blows.
// It mostly blows early: past x5 it's rare and the moon (x10, paid on its own) is 1 in 100. Cash out and a
// ghost rocket keeps going, so you see how far it would have gone.
import { play } from '@ui/sfx.js';
import { canvas, drawSprite, text } from './canvas';
import { h } from './dom';
import { betButton, cell, fmt, note, notEnough, rnd, round, say, type MachineCore, type Purse } from './machine';

type Spark = [number, number];
interface Fly {
  bet: number;
  t0: number;
  crash: number;
}
interface Last {
  m: number;
  ok: boolean;
  t: number;
  moon?: boolean;
  parts?: Spark[];
}
interface Ghost {
  t0: number;
  crash: number;
  end: number;
  parts?: Spark[];
}

export const ROCKET_MAX = 10;
export const ROCKET_MOON = 0.01;
export const rocketAt = (s: number): number => Math.min(ROCKET_MAX, 0.35 * s + 0.07 * s * s);
// P(it gets past xm) = (1 - m/10)^2.5: the best cash-out pays about x1.23 on average, like the old x5 rocket
export const rocketCrashAt = (): number => (Math.random() < ROCKET_MOON ? ROCKET_MAX : Math.floor(ROCKET_MAX * (1 - Math.random() ** 0.4) * 100) / 100);

export function rocket(K: Purse): MachineCore {
  const W = 90, H = 50, MAX = ROCKET_MAX;
  const stars: [number, number, number][] = Array.from({ length: 24 }, () => [rnd(W), rnd(H - 8), Math.random() * 6]);
  const mAt = rocketAt;
  const crashAt = rocketCrashAt;
  const [cv, g] = canvas(W, H);
  let bet = 10, fly: Fly | null = null, last: Last | null = null, ghost: Ghost | null = null, V = 2.5, calm = true;
  // the chart zooms out as the rocket climbs, so it never leaves the screen
  const px = (m: number) => 5 + (m / V) * 74, py = (m: number) => H - 6 - (m / V) ** 1.25 * (H - 16);
  const btn = h('button', { class: 'btn sm primary', onclick: act }, 'Cất cánh');
  const msg = note('Có thể lên tới x10… hiếm lắm');
  const el = cell('Tên lửa', cv, h('div', { class: 'adhd-row' }, betButton(() => bet, b => (bet = b)), btn), msg);
  let msgText = 'Có thể lên tới x10… hiếm lắm';
  const set = (s: string) => say(msg, (msgText = s));

  const at = (f: { t0: number }, now: number) => mAt((now - f.t0) / 1000);
  const cut = (m: number) => Math.floor(m * 100) / 100;
  function setBtn(flying: boolean) {
    btn.textContent = flying ? 'Rút' : 'Cất cánh';
    btn.classList.toggle('primary', !flying);
    btn.classList.toggle('green', flying);
  }
  const resolve = (now: number) => (at(fly!, now) < fly!.crash ? cashout(now) : fly!.crash >= MAX ? cashout(now, true) : boom(now));
  function act() {
    const now = performance.now();
    if (fly) return resolve(now);
    if (!K.spend(bet)) return notEnough();
    fly = { bet, t0: now, crash: crashAt() };
    last = ghost = null;
    setBtn(true);
    set('Rút kịp lúc nhé!');
  }
  function cashout(now: number, moon?: boolean) {
    const f = fly!, m = moon ? MAX : cut(at(f, now)), won = round(f.bet * m);
    fly = null;
    last = { m, ok: true, t: now, moon };
    // the rest of the flight goes on without you
    if (!moon) ghost = { t0: f.t0, crash: f.crash, end: 0 };
    setBtn(false);
    set(moon ? `🌕 Bạn lên tới Mặt Trăng! x10 → ${fmt(won)}` : `Bạn rút ở x${m.toFixed(2)} → ${fmt(won)}`);
    moon ? play.event() : play.gain();
    K.pay(won);
  }
  function boom(now: number) {
    const f = fly!;
    fly = null;
    last = { m: f.crash, ok: false, t: now, parts: sparks() };
    setBtn(false);
    set(`Nổ ở x${f.crash.toFixed(2)}!`);
    play.boom();
    K.done();
  }
  const sparks = (): Spark[] => Array.from({ length: 18 }, (): Spark => [Math.random() * 6.3, 8 + Math.random() * 22]);
  function curve(m0: number, m: number, color: string) {
    g.fillStyle = color;
    for (let i = 0; i <= 40; i++) {
      const k = m0 + ((m - m0) * i) / 40;
      g.fillRect(Math.round(px(k)), Math.round(py(k)), 2, 2);
    }
  }
  function blast(m: number, parts: Spark[], k: number) {
    for (const [ang, sp] of parts) {
      g.fillStyle = k < 0.3 ? '#f4f4f4' : Math.random() < 0.5 ? '#ef7d57' : '#ffcd75';
      g.fillRect(Math.round(px(m) + Math.cos(ang) * sp * k), Math.round(py(m) + Math.sin(ang) * sp * k + 10 * k * k), 2, 2);
    }
  }
  return {
    el,
    busy: () => !!fly,
    fps(now) {
      const moving = fly || !calm || (ghost && (!ghost.end || now - ghost.end < 800)) || (last && !last.ok && now - last.t < 800);
      return moving ? 60 : 8; // idle: only the stars twinkle
    },
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
        set(msgText + (ghost.crash >= MAX ? ' · lẽ ra đã lên tới Mặt Trăng! 🌕' : ` · lẽ ra đã tới x${ghost.crash.toFixed(2)}`));
      }
      const gm = ghost && (ghost.end ? ghost.crash : at(ghost, now));
      const top = fly ? at(fly, now) : Math.max(last ? last.m : 0, gm || 0);
      const dV = Math.max(2.5, top * 1.2) - V;
      V += dV * (fly || (ghost && !ghost.end) ? 1 : 0.15);
      calm = Math.abs(dV) < 0.01;
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
      if (!last.ok && last.parts && now - last.t < 800) blast(last.m, last.parts, (now - last.t) / 800);
      if (ghost && gm != null) {
        // what you left on the table: a faded rocket that keeps climbing until it blows
        curve(last.m, gm, '#566c86');
        g.fillStyle = '#a7f070';
        g.fillRect(Math.round(px(last.m)) - 1, Math.round(py(last.m)) - 1, 4, 4);
        if (!ghost.end) {
          g.globalAlpha = 0.45;
          drawSprite(g, '🚀', px(gm) - 4, py(gm) - 10, 13);
          g.globalAlpha = 1;
        } else if (ghost.parts && now - ghost.end < 800) blast(gm, ghost.parts, (now - ghost.end) / 800);
        if (ghost.end) text(g, 'x' + ghost.crash.toFixed(2), W - 16, H - 11, '#94b0c2', 8);
      }
      text(g, 'x' + last.m.toFixed(2), W / 2, 9, last.ok ? '#a7f070' : '#b13e53', 10);
    },
  };
}
