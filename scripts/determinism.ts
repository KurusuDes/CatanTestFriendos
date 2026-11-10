// Determinism proof: plays N seeded bot-only games and prints a hash of every final state.
// Usage: pnpm determinism [games]   (hash must not change across behaviour-preserving refactors)
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGame, applyAction, pendingActors } from '@engine/game';
import { botAct } from '@engine/bot';
import { makeConfig } from './sim';

export function determinismHash(games: number): string {
  const h = createHash('sha256');
  for (let i = 0; i < games; i++) {
    const s = createGame(makeConfig(i));
    let guard = 0;
    while (s.phase !== 'gameOver' && s.turn < 1500 && ++guard < 200000) {
      let acted = false;
      for (const pid of pendingActors(s)) {
        const a = botAct(s, pid);
        if (!a) continue;
        applyAction(s, a);
        acted = true;
        break;
      }
      if (!acted) break;
    }
    h.update(JSON.stringify(s));
  }
  return h.digest('hex');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const n = +(process.argv[2] ?? 0) || 200;
  console.log(`games=${n} sha256=${determinismHash(n)}`);
}
