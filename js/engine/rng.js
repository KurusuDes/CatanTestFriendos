// Deterministic, serializable RNG (mulberry32). The generator state lives in a
// plain object `{ s }` so it can be stored inside the game state and sent over the network.
export function rand(r) {
  let t = (r.s = (r.s + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randInt = (r, n) => Math.floor(rand(r) * n);

export function shuffle(r, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(r, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const pick = (r, arr) => arr[randInt(r, arr.length)];

export const newSeed = () => (Math.random() * 2 ** 31) | 0;
