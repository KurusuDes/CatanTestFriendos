// @ts-nocheck
// Chạy 300 ván bot đấu bot (cùng logic với scripts/sim.ts), kiểm tra bất biến sau mỗi hành động.
import { test, expect } from 'vitest';
import { runSim } from '../scripts/sim.ts';

test('sim 300 ván không lỗi', () => {
  const summary = runSim(300);
  expect(summary.errors).toBe(0);
  expect(summary.games).toBe(300);
  expect(summary.finished).toBe(300);
}, 300000);
