// 3. Coin flip: slide how much, pick a side, double or nothing (Auto repeats your last side)
import { play } from '@ui/sfx';
import { canvas, drawSprite } from './canvas';
import { h } from './dom';
import { BG, autoButton, btnRich, cell, fmt, note, rnd, say, type MachineCore, type Purse } from './machine';

interface Flip {
  side: number;
  res: number;
  bet: number;
  t0: number;
  from: number;
  turns: number;
}

export function coin(K: Purse): MachineCore {
  const W = 90, H = 44, R = 12, CY = 26, FACES = ['👑', '🌾'], COLORS = ['#ffcd75', '#94b0c2'];
  const [cv, g] = canvas(W, H);
  let flip: Flip | null = null, face = 0, bet = 1, lastSide = 0;
  const auto = autoButton();
  const lab = h('b', { class: 'nopx' }, fmt(bet));
  const slider = h('input', { type: 'range', min: 1, max: 1, step: 1, value: 1 });
  slider.addEventListener('input', () => {
    bet = +slider.value;
    lab.textContent = fmt(bet);
  });
  const msg = note('Gấp đôi hoặc trắng tay');
  const el = cell('Tung đồng xu', cv,
    h('div', { class: 'adhd-row' }, slider, lab, auto.el),
    h('div', { class: 'adhd-row' }, btnRich('btn sm primary', '👑 Ngửa', () => go(0)), btnRich('btn sm primary', '🌾 Sấp', () => go(1))),
    msg);
  const ease = (t: number) => 1 - (1 - t) ** 3;

  function go(side: number) {
    if (flip) return;
    const b = Math.min(bet, Math.floor(K.money()));
    if (b < 1 || !K.spend(b)) return auto.set(false);
    lastSide = side;
    const res = rnd(2);
    flip = { side, res, bet: b, t0: performance.now(), from: face, turns: 10 + ((res - face + 2) % 2) };
    say(msg, '...');
    play.click();
  }
  function end() {
    const f = flip!;
    flip = null;
    face = f.res;
    auto.at = performance.now() + 500;
    if (f.side !== f.res) {
      say(msg, f.res ? `Ra sấp: -${fmt(f.bet)}` : `Ra ngửa: -${fmt(f.bet)}`);
      play.bad();
      return K.done();
    }
    say(msg, f.res ? `Ra sấp! +${fmt(f.bet)}` : `Ra ngửa! +${fmt(f.bet)}`);
    play.gain();
    K.pay(f.bet * 2);
  }
  return {
    el,
    busy: () => !!flip,
    fps: () => (flip || auto.on ? 60 : 0),
    sync() {
      auto.show(K.passed());
      const max = Math.max(1, Math.floor(K.money()));
      slider.max = String(max);
      if (bet > max) bet = max;
      slider.value = String(bet);
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
          g.fillStyle = COLORS[side]!;
          g.fillRect(Math.round(W / 2 - i), cy + dy, Math.round(i * 2), 1);
        }
      }
      if (sx > 0.35) drawSprite(g, FACES[side]!, W / 2 - 7 * sx, cy - 7, 14 * sx, 14);
    },
  };
}
