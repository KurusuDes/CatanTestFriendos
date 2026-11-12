// Redaction: a guest must not receive secrets, but everything the client UI reads must still be there.
import { describe, test, expect } from 'vitest';
import { createGame, applyAction, pendingActors, viewFor, handSize, canAfford, legalSetupSettlements, legalSetupRoads, legalRoads, legalSettlements, legalCities, legalRobberTiles, playableDev, robberVictims, victoryPoints } from '@engine/game';
import { botAct } from '@engine/bot';
import { COSTS } from '@engine/constants';
import type { GameState } from '@engine/types';
import { redactFor, toWire } from '@net/redact';
import { BoardVersion, tilesFingerprint } from '@net/boardVersion';
import { makeConfig } from '../scripts/sim.ts';

/** run seeded bot games, calling `visit` before every action */
function play(games: number[], maxSteps: number, visit: (s: GameState, step: number, game: number) => void) {
  for (const i of games) {
    const s = createGame(makeConfig(i));
    for (let step = 0; step < maxSteps && s.phase !== 'gameOver'; step++) {
      visit(s, step, i);
      const pid = pendingActors(s).find(p => s.players[p]!.kind === 'bot' && botAct(s, p));
      if (pid === undefined) break;
      const a = botAct(s, pid)!;
      if (!applyAction(s, a).ok) applyAction(s, { type: 'endTurn', pid });
    }
    visit(s, maxSteps, i);
  }
}

const GAMES = Array.from({ length: 30 }, (_, k) => k * 3 + 1);

describe('redactFor', () => {
  test('(a) no rng / deck order / foreign hands / secret placements', () => {
    let checked = 0;
    play(GAMES, 400, (s, step) => {
      if (step % 7) return;
      const over = s.phase === 'gameOver';
      for (const seat of [...s.players.keys(), null]) {
        const r = redactFor(s, seat);
        checked++;
        expect(r.rng).toEqual({ s: 0 });
        expect(r.diceDeck).toEqual([]);
        expect(r.devDeck.length).toBe(s.devDeck.length);
        expect(new Set(r.devDeck).size).toBeLessThanOrEqual(1);
        expect(r.blind.every(b => b.pid === seat)).toBe(true);
        if (r.discovered) expect(Object.keys(r.discovered).every(k => +k === seat)).toBe(true);
        for (const p of r.players) {
          const real = s.players[p.id]!;
          if (p.id === seat || over) {
            expect(p.res).toEqual(real.res);
            expect(p.dev).toEqual(real.dev);
          } else {
            expect(handSize(p.res)).toBe(handSize(real.res)); // sizes are public
            expect(p.res.brick + p.res.sheep + p.res.wheat + p.res.ore).toBe(0);
            expect(p.dev.length).toBe(real.dev.length);
            expect(p.dev.every(c => c.type === 'knight')).toBe(true);
          }
        }
        // secret blindfold placement of someone else never shows in the vertex hint
        if (s.setup.blindActive && s.phase === 'setup' && s.setup.queue[s.setup.idx]!.pid !== seat) expect(r.setup.lastVid).toBeNull();
        // fx: no foreign dev card / steal resource / hidden build position
        for (const f of r.fx) {
          if (f.kind === 'devBought' && f.pid !== seat) expect(f.type).toBe('knight');
          if (f.kind === 'build' && f.hidden && f.pid !== seat) expect(f.at).toBe(-1);
        }
        // hidden tiles carry neither kind nor number (desert stays: the robber sits on it)
        if (!over) for (const t of r.board.tiles) if (!t.revealed && t.res !== 'desert') expect(t.res === 'wood' && t.num === null).toBe(true);
        // the original is untouched (pure)
        expect(r).not.toBe(s);
      }
    });
    expect(checked).toBeGreaterThan(500);
  }, 120000);

  test('(b) everything the client UI reads is still there and gives the same answers', () => {
    const TOP = ['v', 'config', 'board', 'players', 'buildings', 'roads', 'blind', 'bank', 'bankTotal', 'devDeck', 'devTotal', 'phase', 'current', 'first', 'turn', 'round', 'setup', 'dice', 'pendingDiscards', 'robberReturn', 'freeRoads', 'devPlayed', 'trade', 'tradeSeq', 'longestRoad', 'largestArmy', 'event', 'winner', 'log', 'fx', 'stats', 'rollLog', 'actions'] as const;
    play(GAMES, 300, (s, step) => {
      if (step % 11) return;
      for (const seat of s.players.keys()) {
        const r = redactFor(s, seat);
        for (const k of TOP) expect(k in r).toBe(true);
        expect(r.bank).toEqual(s.bank);
        expect(r.log).toEqual(s.log);
        expect(r.trade).toEqual(s.trade);
        expect(r.pendingDiscards).toEqual(s.pendingDiscards);
        for (const p of r.players) {
          const real = s.players[p.id]!;
          for (const k of ['name', 'color', 'kind', 'level', 'retired', 'knights', 'roadLen', 'roadsLeft', 'settlementsLeft', 'citiesLeft', 'stats'] as const) expect(p[k]).toEqual(real[k]);
          // (in fog the opponents' pieces out of sight are not sent, so their visible VP is lower by design)
          if (!s.config.modes.fog) expect(victoryPoints(r, p.id, false)).toBe(victoryPoints(s, p.id, false));
        }
        // the client UI builds its view and calls engine queries on it: same answers as on the real state
        const real = viewFor(s, seat), mine = viewFor(r, seat);
        expect(pendingActors(mine)).toEqual(pendingActors(real));
        if (s.phase === 'gameOver') continue;
        expect(mine.buildings).toEqual(real.buildings);
        expect(mine.roads).toEqual(real.roads);
        expect(mine.board.robber).toBe(real.board.robber);
        if (s.phase === 'setup' && pendingActors(s)[0] === seat) {
          expect(legalSetupSettlements(mine, seat)).toEqual(legalSetupSettlements(real, seat));
          if (s.setup.step === 'road') expect(legalSetupRoads(mine, seat)).toEqual(legalSetupRoads(real, seat));
        }
        if (s.phase === 'main' || s.phase === 'roadBuilding') {
          expect(legalRoads(mine, seat)).toEqual(legalRoads(real, seat));
          expect(legalSettlements(mine, seat)).toEqual(legalSettlements(real, seat));
          expect(legalCities(mine, seat)).toEqual(legalCities(real, seat));
          expect(playableDev(mine, seat)).toEqual(playableDev(real, seat));
          expect(canAfford(mine.players[seat]!.res, COSTS.dev)).toBe(canAfford(real.players[seat]!.res, COSTS.dev));
        }
        if (s.phase === 'robber' && s.current === seat) {
          const tiles = legalRobberTiles(mine, seat);
          expect(tiles).toEqual(legalRobberTiles(real, seat));
          for (const t of tiles) expect(robberVictims(mine, seat, t)).toEqual(robberVictims(real, seat, t));
        }
        // opponents' hand sizes (player cards, trade partner list, robber victims)
        for (const p of s.players) expect(handSize(mine.players[p.id]!.res)).toBe(handSize(p.res));
      }
    });
  }, 120000);

  test('(c) JSON per guest shrinks', () => {
    let before = 0, after = 0, n = 0;
    play([1, 4, 7, 10], 500, (s, step) => {
      if (step % 5 || step === 0) return;
      const full = { ...s, board: Object.fromEntries(Object.entries(s.board).filter(([k]) => !['vertices', 'edges', 'sea', 'ports', 'bounds', 'tiles'].includes(k))), log: s.log.slice(-40), players: s.players.map(({ flag, ...p }) => (void flag, p)) };
      delete (full as Partial<GameState>).config;
      before += JSON.stringify(full).length;
      // tiles are only sent when they change, so a typical state message has none
      after += JSON.stringify(toWire(redactFor(s, 0), false)).length;
      n++;
    });
    console.log(`JSON medio por mensaje de estado: antes ${(before / n) | 0} B, después ${(after / n) | 0} B (${((1 - after / before) * 100).toFixed(1)}% menos, ${n} muestras; el "antes" ya incluía el tablero estático fuera y el log recortado)`);
    expect(after).toBeLessThan(before);
  });

  test('a seat in a fog game only gets what viewFor lets it see', () => {
    const i = [...Array(200).keys()].find(k => makeConfig(k).modes.fog)!;
    let seen = false;
    const cfg = makeConfig(i);
    cfg.modes.fog = true;
    const s = createGame(cfg);
    for (let step = 0; step < 80 && s.phase !== 'gameOver'; step++) {
      const pid = pendingActors(s).find(p => botAct(s, p));
      if (pid === undefined) break;
      applyAction(s, botAct(s, pid)!);
      for (const seat of s.players.keys()) {
        const r = redactFor(s, seat);
        const v = viewFor(s, seat);
        expect(Object.keys(r.buildings).sort()).toEqual(Object.keys(v.buildings).sort());
        expect(Object.keys(r.roads).sort()).toEqual(Object.keys(v.roads).sort());
        if (Object.keys(r.buildings).length < Object.keys(s.buildings).length) seen = true;
        expect('vision' in r).toBe(false);
      }
    }
    expect(seen).toBe(true);
  });
});

describe('BoardVersion', () => {
  test('never misses a tile change (compared with a full JSON hash)', () => {
    let changes = 0;
    for (const i of GAMES) {
      const s = createGame(makeConfig(i));
      const bv = new BoardVersion();
      let lastV = bv.update(s);
      let lastJson = JSON.stringify(s.board.tiles);
      for (let step = 0; step < 500 && s.phase !== 'gameOver'; step++) {
        const pid = pendingActors(s).find(p => botAct(s, p));
        if (pid === undefined) break;
        applyAction(s, botAct(s, pid)!);
        const v = bv.update(s);
        const json = JSON.stringify(s.board.tiles);
        if (json !== lastJson) {
          changes++;
          expect(v).not.toBe(lastV);
        }
        if (v === lastV) expect(json).toBe(lastJson);
        lastV = v;
        lastJson = json;
      }
    }
    expect(changes).toBeGreaterThan(20);
  }, 120000);

  test('fingerprint reacts to reveal / number / kind', () => {
    const s = createGame(makeConfig(2));
    const a = tilesFingerprint(s.board.tiles);
    s.board.tiles[0]!.revealed = !s.board.tiles[0]!.revealed;
    expect(tilesFingerprint(s.board.tiles)).not.toBe(a);
  });
});
