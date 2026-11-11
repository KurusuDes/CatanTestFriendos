// 5. The mine (no Auto): 16 rocks, 3 hide the robber. Every ore you dig raises the payout; cash out before he finds you
import { play } from '@ui/sfx';
import { canvas, drawSprite } from './canvas';
import { h } from './dom';
import { BG, betButton, cell, fmt, note, notEnough, rnd, round, say, type MachineCore, type Purse } from './machine';

interface Run {
  bet: number;
  bad: Set<number>;
  dug: Set<number>;
}
interface Last extends Run {
  hit?: number;
  t: number;
}

const N = 4, CELLS = N * N, ROBBERS = 3;

// the fair payout for surviving k digs: C(16,k) / C(13,k)
export const mineMult = (k: number): number => {
  let m = 1;
  for (let i = 0; i < k; i++) m *= (CELLS - i) / (CELLS - ROBBERS - i);
  return Math.floor(m * 100) / 100;
};

export function mine(K: Purse): MachineCore {
  const C = 14, GAP = 2, W = 90, H = 66;
  const OX = Math.round((W - (N * C + (N - 1) * GAP)) / 2), OY = 2;
  const mult = mineMult;
  const [cv, g] = canvas(W, H);
  let bet = 10, run: Run | null = null, last: Last | null = null, hover = -1, rect: DOMRect | null = null; // rect: canvas box, cached while the pointer is over it
  const btn = h('button', { class: 'btn sm primary', onclick: act }, 'Vào');
  const msg = note('Đập đá, đừng đánh thức kẻ trộm');
  const el = cell('Khu mỏ', cv, h('div', { class: 'adhd-row' }, betButton(() => bet, b => (bet = b)), btn), msg);
  cv.style.cursor = 'pointer';
  const cellAt = (e: PointerEvent | MouseEvent) => {
    const r = rect || (rect = cv.getBoundingClientRect()), x = ((e.clientX - r.left) / r.width) * W - OX, y = ((e.clientY - r.top) / r.height) * H - OY;
    const cx = Math.floor(x / (C + GAP)), cy = Math.floor(y / (C + GAP));
    return cx >= 0 && cy >= 0 && cx < N && cy < N && x % (C + GAP) < C && y % (C + GAP) < C ? cy * N + cx : -1;
  };
  const onResize = () => (rect = null);
  window.addEventListener('resize', onResize);
  cv.onpointerenter = onResize;
  cv.onpointermove = e => (hover = cellAt(e));
  cv.onpointerleave = () => ((hover = -1), (rect = null));
  cv.onclick = e => (rect = null, dig(cellAt(e)));

  function setBtn() {
    const k = run ? run.dug.size : 0;
    btn.textContent = !run ? 'Vào' : k ? `Nhận ${fmt(round(run.bet * mult(k)))}` : 'Đập một viên';
    btn.classList.toggle('primary', !run);
    btn.classList.toggle('green', !!run && k > 0);
    btn.disabled = !!run && !k;
  }
  function act() {
    if (run) return run.dug.size && cash();
    if (!K.spend(bet)) return notEnough();
    const bad = new Set<number>();
    while (bad.size < ROBBERS) bad.add(rnd(CELLS));
    run = { bet, bad, dug: new Set() };
    last = null;
    say(msg, `Viên tiếp theo: x${mult(1)}`);
    setBtn();
  }
  function dig(i: number) {
    if (!run || i < 0 || run.dug.has(i)) return;
    if (run.bad.has(i)) {
      last = { ...run, hit: i, t: performance.now() };
      run = null;
      say(msg, `Kẻ trộm kìa! Bạn mất ${fmt(last.bet)}`);
      play.boom();
      setBtn();
      return K.done();
    }
    run.dug.add(i);
    play.click();
    if (run.dug.size === CELLS - ROBBERS) return cash();
    say(msg, `x${mult(run.dug.size)} · tiếp theo: x${mult(run.dug.size + 1)}`);
    setBtn();
  }
  function cash() {
    const r = run!, m = mult(r.dug.size), won = round(r.bet * m);
    run = null;
    last = { ...r, t: performance.now() };
    say(msg, `Bạn thoát ở x${m} → ${fmt(won)}`);
    m >= 3 ? play.event() : play.gain();
    setBtn();
    K.pay(won);
  }
  return {
    el,
    busy: () => !!run,
    fps: () => (run || last ? 15 : 0), // the robber's cell blinks; hover is cheap at 15 fps
    sync() {},
    settle() {
      // leaving mid-dig: you keep what you dug (or get the ticket back if you hadn't started)
      if (!run) return;
      if (run.dug.size) return cash();
      const b = run.bet;
      run = null;
      setBtn();
      K.pay(b);
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      K.dead = true;
    },
    frame(now) {
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      const s = run || last;
      for (let i = 0; i < CELLS; i++) {
        const x = OX + (i % N) * (C + GAP), y = OY + Math.floor(i / N) * (C + GAP);
        const dug = s && s.dug.has(i), open = last && !run, bad = s && s.bad.has(i);
        if (dug) {
          g.fillStyle = '#333c57';
          g.fillRect(x, y, C, C);
          drawSprite(g, '💎', x + 2, y + 2, C - 4);
        } else if (open && bad) {
          g.fillStyle = last!.hit === i && Math.floor((now - last!.t) / 150) % 2 ? '#ef7d57' : '#b13e53';
          g.fillRect(x, y, C, C);
          drawSprite(g, '🦹', x + 1, y + 1, C - 2);
        } else {
          g.fillStyle = run && hover === i ? '#94b0c2' : '#566c86';
          g.fillRect(x, y, C, C);
          g.fillStyle = run && hover === i ? '#f4f4f4' : '#94b0c2';
          g.fillRect(x, y, C, 2);
          g.fillStyle = '#333c57';
          g.fillRect(x, y + C - 2, C, 2);
          if (open) {
            g.globalAlpha = 0.35;
            drawSprite(g, '💎', x + 3, y + 3, C - 6);
            g.globalAlpha = 1;
          }
        }
      }
    },
  };
}
