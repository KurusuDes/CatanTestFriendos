// 2. Slots: three reels
import { play } from '@ui/sfx';
import { canvas, drawSprite } from './canvas';
import { h } from './dom';
import { BG, autoButton, betButton, cell, fmt, note, notEnough, rnd, say, type MachineCore, type Purse } from './machine';

interface Reel {
  p0: number;
  p1: number;
  d: number;
  stopped: boolean;
}
interface Spin {
  bet: number;
  res: number[];
  t0: number;
  reels: Reel[];
}

export function slots(K: Purse): MachineCore {
  const SYM = ['🍒', '🍋', '🍀', '🔔', '⭐', '💎'], TRIO = [5, 5, 8, 10, 15, 30], N = SYM.length;
  const W = 90, H = 34, RW = 26, STEP = 20;
  const [cv, g] = canvas(W, H);
  const pos = [0, 2, 4];
  let bet = 10, spin: Spin | null = null;
  const auto = autoButton();
  const msg = note('Đôi x2 · Bộ ba x5 tới x30');
  const el = cell('Máy đánh bạc', cv,
    h('div', { class: 'adhd-row' }, betButton(() => bet, b => (bet = b)), h('button', { class: 'btn sm primary', onclick: () => go() }, 'Xoay'), auto.el), msg);
  const ease = (t: number) => 1 + 1.8 * (t - 1) ** 3 + 0.8 * (t - 1) ** 2; // stops with a little bounce

  function go(byAuto?: boolean) {
    if (spin) return;
    if (!K.spend(bet)) {
      auto.set(false);
      return byAuto || notEnough();
    }
    const res = [rnd(N), rnd(N), rnd(N)];
    spin = {
      bet, res, t0: performance.now(),
      reels: res.map((r, i) => {
        const base = Math.ceil(pos[i]!) + N * (3 + i);
        return { p0: pos[i]!, p1: base + (((r - base) % N) + N) % N, d: 800 + 350 * i, stopped: false };
      }),
    };
    say(msg, '...');
  }
  function finish() {
    const s = spin!;
    spin = null;
    s.reels.forEach((r, i) => (pos[i] = r.p1));
    auto.at = performance.now() + 450;
    const [a, b, c] = s.res as [number, number, number];
    const m = a === b && b === c ? TRIO[a]! : a === b || b === c || a === c ? 2 : 0;
    say(msg, m ? `x${m} → +${fmt(s.bet * m)}` : 'Chẳng có gì...');
    if (!m) return K.done();
    m >= 5 ? play.event() : play.gain();
    K.pay(s.bet * m);
  }
  return {
    el,
    busy: () => !!spin,
    fps: () => (spin || auto.on ? 60 : 0),
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
        const p = pos[i]!;
        for (let k = Math.floor(p) - 1; k <= Math.floor(p) + 2; k++) drawSprite(g, SYM[((k % N) + N) % N]!, x + RW / 2 - 8, H / 2 + (p - k) * STEP - 8, 16);
        g.restore();
      }
      g.fillStyle = '#b13e53';
      g.fillRect(1, H / 2 - 1, 3, 2);
      g.fillRect(W - 4, H / 2 - 1, 3, 2);
    },
  };
}
