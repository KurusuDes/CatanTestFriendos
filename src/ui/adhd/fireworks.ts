// The win: fireworks from the winner's buildings + a banner (everyone sees it).
// Winners that land together wait their turn: one banner and one round of fireworks each, in order.
import { App } from '@app/index';
import { play } from '@ui/sfx.js';
import { h, rich } from './dom';
import { rnd } from './machine';

export interface BoardLike {
  alive: boolean;
  playerPoints(seat: number): { x: number; y: number; z: number }[];
  toScreen(x: number, y: number, z: number): { x: number; y: number } | null;
}
interface Ctx {
  wrap: HTMLElement;
  getBoard: () => BoardLike | null | undefined;
}

// the window tells us where the board is (launch spots follow the camera)
let ctx: Ctx | null = null;
export function setFxContext(c: Ctx | null): void {
  ctx = c;
}

const cheers: { seat: number; n: number }[] = [];
let cheerT: ReturnType<typeof setTimeout> | 0 = 0;

export function resetCheers(): void {
  cheers.length = 0;
  clearTimeout(cheerT || undefined);
  cheerT = 0;
}

export function celebrate(seat: number, n = 1): void {
  cheers.push({ seat, n });
  if (!cheerT) nextCheer();
}

function nextCheer(): void {
  cheerT = 0;
  const st = App.state;
  if (!cheers.length || !st) return void (cheers.length = 0);
  const { seat, n } = cheers.shift()!, p = st.players[seat];
  if (!p) return nextCheer();
  const queued = cheers.filter(c => st.players[c.seat]).map(c => st.players[c.seat]!.name);
  // font-size is clamp(18px, 4vw, 34px) in the CSS; sprites are 1.15x that
  const s = Math.round(Math.min(34, Math.max(18, innerWidth * 0.04)) * 1.15);
  const band = h('div', { class: 'adhd-band', style: { '--pc': p.color } },
    h('div', null, ...rich('🎆 ', s), h('b', null, ...rich(p.name, s)), ...rich(' đã chinh phục ADHD! 🧠', s), n > 1 ? h('span', { class: 'adhd-band-n' }, ` ×${n}`) : null),
    queued.length ? h('small', { class: 'nopx' }, `Tiếp theo: ${queued.join(', ')}`) : null);
  document.body.append(band);
  setTimeout(() => band.remove(), 5200);
  play.win();
  fireworks(seat, p.color);
  cheerT = setTimeout(nextCheer, 5400);
}

interface Rocket {
  x: number;
  y: number;
  top: number;
  vx: number;
  c: string;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  c: string;
}

function fireworks(seat: number, color: string): void {
  const S = 3; // one canvas pixel = 3 screen pixels, like the rest of the pixel art
  const cv = h('canvas', { class: 'adhd-fw', width: Math.ceil(innerWidth / S), height: Math.ceil(innerHeight / S) });
  document.body.append(cv);
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  const b = ctx && ctx.getBoard ? ctx.getBoard() : null;
  const pts = b && b.alive ? b.playerPoints(seat) : [];
  const COLORS = [color, color, '#ffcd75', '#f4f4f4', '#ef7d57', '#73eff7', '#a7f070'];
  const rockets: Rocket[] = [], sparks: Spark[] = [];
  const t0 = performance.now();
  let next = t0, n = 0, last = t0, lastSnd = 0;
  // launch spots follow the camera: each rocket takes its building's screen position when it lifts off
  const origin = () => {
    if (b && pts.length) {
      const pt = pts[n % pts.length]!;
      const s = b.alive && b.toScreen(pt.x, pt.y, pt.z);
      if (s) return s;
    }
    const r = (ctx ? ctx.wrap : document.body).getBoundingClientRect();
    return { x: r.left + Math.random() * r.width, y: r.bottom - 12 };
  };
  const done = () => cv.remove();
  setTimeout(done, 12000); // hidden tabs never run the animation
  const frame = (now: number) => {
    if (!cv.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (now - t0 < 6500 && now >= next) {
      const o = origin();
      n++;
      rockets.push({ x: o.x / S, y: o.y / S, top: o.y / S - 30 - Math.random() * 45, vx: (Math.random() - 0.5) * 12, c: COLORS[rnd(COLORS.length)]! });
      next = now + 110 + Math.random() * 170;
    }
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'source-over';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]!;
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
      const s = sparks[i]!;
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
