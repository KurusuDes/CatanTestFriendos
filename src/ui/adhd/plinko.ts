// 1. Plinko: $1 a ball
import { play } from '@ui/sfx';
import { canvas, text } from './canvas';
import { h } from './dom';
import { BG, autoButton, cell, type MachineCore, type Purse } from './machine';

interface Ball {
  xs: number[];
  k: number;
  t0: number;
}
interface Flash {
  k: number;
  t: number;
}

const PLINKO_MULT = [25, 5, 2, 1.2, 0.4, 1.2, 2, 5, 25];

export function plinko(K: Purse): MachineCore {
  const W = 90, H = 72, ROWS = 8, DX = 10, DY = 7, TOP = 6, SEG = 85;
  const MULT = PLINKO_MULT;
  const COL = ['#b13e53', '#ef7d57', '#ffcd75', '#38b764', '#566c86'];
  const binCol = (k: number) => COL[Math.min(k, 8 - k)]!;
  const [cv, g] = canvas(W, H);
  let balls: Ball[] = [], flashes: Flash[] = [];
  const auto = autoButton();
  const el = cell('Plinko', cv,
    h('div', { class: 'adhd-bins nopx' }, MULT.map(m => h('span', null, m < 1 ? String(m).slice(1) : m))),
    h('div', { class: 'adhd-row' }, h('button', { class: 'btn sm primary', onclick: drop }, 'Thả $1'), auto.el));

  function drop() {
    if (balls.length >= 40) return;
    if (!K.spend(1)) return auto.set(false);
    const xs: number[] = [];
    let r = 0;
    for (let row = 0; row <= ROWS; row++) {
      xs.push(W / 2 + (r - row / 2) * DX);
      if (row < ROWS && Math.random() < 0.5) r++;
    }
    balls.push({ xs, k: r, t0: performance.now() });
  }
  const point = (b: Ball, i: number): [number, number] => (i < 0 ? [W / 2, -3] : [b.xs[i]!, i < ROWS ? TOP + i * DY - 2 : H - 7]);
  function land(b: Ball) {
    balls.splice(balls.indexOf(b), 1);
    flashes.push({ k: b.k, t: performance.now() });
    if (MULT[b.k]! >= 5) play.gain();
    K.pay(MULT[b.k]!);
  }
  return {
    el,
    busy: () => balls.length > 0,
    fps: () => (balls.length || flashes.length || auto.on ? 60 : 0),
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
      for (const f of flashes) if (MULT[f.k]! >= 2) text(g, '+' + MULT[f.k], f.k * DX + DX / 2, H - 12 - (now - f.t) / 50, '#a7f070', 7);
    },
  };
}
