// 4. Sheep race: bet on one of four sheep; the long shot pays more (Auto backs the same one)
import { play } from '@ui/sfx';
import { canvas, drawSprite } from './canvas';
import { h } from './dom';
import { BG, autoButton, betButton, cell, fmt, note, notEnough, rnd, round, say, type MachineCore, type Purse } from './machine';

interface Race {
  pick: number;
  win: number;
  bet: number;
  t0: number;
  T: number[];
  wob: number[];
  k: number[];
}

const SHEEP_ODDS = [0.4, 0.3, 0.2, 0.1];
const SHEEP_PAY = [2.6, 3.5, 5, 10];

export function sheep(K: Purse): MachineCore {
  const W = 90, H = 44, LANE = 10, TOP = 2, START = 12, END = W - 12;
  const ODDS = SHEEP_ODDS, PAY = SHEEP_PAY;
  const SCARF = ['#f4f4f4', '#ffcd75', '#41a6f6', '#b13e53'];
  const [cv, g] = canvas(W, H);
  let bet = 10, race: Race | null = null, last: Race | null = null, pick = 0;
  const auto = autoButton();
  const msg = note('Con nào về đích trước?');
  const picks = PAY.map((m, i) => h('button', { class: 'btn sm', style: { boxShadow: `inset 0 -4px 0 ${SCARF[i]}` }, title: `Cừu ${i + 1}`, onclick: () => go(i) }, 'x' + m));
  const el = cell('Đua cừu', cv, h('div', { class: 'adhd-row' }, betButton(() => bet, b => (bet = b)), auto.el), h('div', { class: 'adhd-row adhd-picks' }, picks), msg);
  // each sheep finishes at its own time (the winner first) and wobbles on the way, so it looks close
  const at = (r: Race, i: number, now: number) => {
    const u = Math.min(1, (now - r.t0) / r.T[i]!);
    return u + r.wob[i]! * Math.sin(u * Math.PI * r.k[i]!) * Math.sin(u * Math.PI);
  };

  function go(i: number, byAuto?: boolean) {
    if (race) return;
    if (!K.spend(bet)) {
      auto.set(false);
      return byAuto || notEnough();
    }
    pick = i;
    let r = Math.random(), win = 0;
    while (win < 3 && (r -= ODDS[win]!) > 0) win++;
    const T = SCARF.map((_, j) => (j === win ? 2400 : 2400 * (1.03 + Math.random() * 0.22)));
    race = { pick: i, win, bet, t0: performance.now(), T, wob: T.map(() => 0.05 + Math.random() * 0.07), k: T.map(() => 2 + rnd(3)) };
    say(msg, 'Xuất phát!');
    play.click();
  }
  function end() {
    const r = race!;
    race = null;
    last = r;
    auto.at = performance.now() + 700;
    if (r.pick !== r.win) {
      say(msg, `Cừu ${r.win + 1} thắng: -${fmt(r.bet)}`);
      play.bad();
      return K.done();
    }
    say(msg, `Cừu của bạn thắng! x${PAY[r.win]} → +${fmt(round(r.bet * PAY[r.win]!))}`);
    PAY[r.win]! >= 5 ? play.event() : play.gain();
    K.pay(round(r.bet * PAY[r.win]!));
  }
  return {
    el,
    busy: () => !!race,
    fps: () => (race || auto.on ? 60 : last ? 8 : 0), // the winner blinks (250 ms)
    sync() {
      auto.show(K.passed());
    },
    settle() {
      auto.set(false);
      if (race) end();
    },
    dispose() {
      K.dead = true;
    },
    frame(now) {
      if (!race && auto.due(now)) go(pick, true);
      if (race && now - race.t0 >= race.T[race.win]!) end();
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 4; i++) {
        const y = TOP + i * LANE;
        g.fillStyle = i % 2 ? '#257179' : '#38b764';
        g.fillRect(0, y, W, LANE);
        // the finish line, checkered
        for (let k = 0; k < LANE; k += 2) {
          g.fillStyle = (k / 2 + i) % 2 ? '#f4f4f4' : '#1a1c2c';
          g.fillRect(END + 4, y + k, 2, 2);
        }
        const r = race || last;
        const u = race ? Math.min(1, at(race, i, now)) : last ? (i === last.win ? 1 : Math.min(0.97, at(last, i, last.t0 + last.T[last.win]!))) : 0;
        const x = START + (END - START) * u;
        if (r && !race && i === r.win && Math.floor(now / 250) % 2) {
          g.fillStyle = '#ffcd75';
          g.fillRect(Math.round(x) - 7, y, 14, LANE);
        }
        g.save();
        g.scale(-1, 1); // the sprite faces left: mirror it so it runs towards the finish line
        drawSprite(g, '🐑', -x - 4, y + (race && Math.floor((now - race.t0) / 90 + i) % 2 ? 0 : 1), 10, 9);
        g.restore();
        g.fillStyle = SCARF[i]!;
        g.fillRect(Math.round(x) - 1, y + 6, 3, 2);
        if (i === pick && (race || last)) {
          g.fillStyle = '#f4f4f4';
          g.fillRect(1, y + 4, 3, 2);
        }
      }
    },
  };
}
