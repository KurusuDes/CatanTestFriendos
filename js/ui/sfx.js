// Tiny WebAudio synth so the game has feedback without shipping audio files.
let ctx = null;
export const sfx = { on: true };

function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.12, type = 'sine', vol = 0.15, when = 0, slide = 0) {
  const a = ac();
  if (!a || !sfx.on) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur = 0.2, vol = 0.12, when = 0) {
  const a = ac();
  if (!a || !sfx.on) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(g).connect(a.destination);
  src.start(a.currentTime + when);
}

export const play = {
  // a charged throw also thumps the table when the dice land (in step with dice3d's drop)
  dice(power = 0) {
    for (let i = 0; i < 4; i++) noise(0.05, 0.18, i * 0.07);
    if (power > 0.25) {
      const land = (0.4 * (1250 + 450 * power)) / 1000;
      tone(95, 0.22, 'sine', 0.12 + 0.18 * power, land, 0.5);
      noise(0.08, 0.1 + 0.1 * power, land);
    }
  },
  rattle(power = 0) { noise(0.03, 0.05 + 0.1 * power); },
  build() { tone(520, 0.08, 'triangle', 0.18); tone(780, 0.1, 'triangle', 0.14, 0.07); },
  gain() { tone(880, 0.07, 'sine', 0.08); tone(1320, 0.08, 'sine', 0.06, 0.05); },
  bad() { tone(220, 0.25, 'sawtooth', 0.08, 0, 0.6); },
  robber() { tone(180, 0.3, 'square', 0.07, 0, 0.5); noise(0.2, 0.08, 0.05); },
  click() { tone(660, 0.04, 'square', 0.05); },
  event() { [523, 659, 784].forEach((f, i) => tone(f, 0.14, 'triangle', 0.12, i * 0.08)); },
  reveal() { [392, 523, 659, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.13, i * 0.09)); noise(0.4, 0.07, 0.3); },
  win() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.14, i * 0.12)); },
  pop() { tone(420, 0.07, 'sine', 0.1, 0, 2.2); tone(980, 0.05, 'triangle', 0.05, 0.05); },
  turn() { tone(740, 0.1, 'sine', 0.1); tone(988, 0.14, 'sine', 0.1, 0.09); },
};
