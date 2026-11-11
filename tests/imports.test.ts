import { describe, expect, it } from 'vitest';
import { findProblems } from '../scripts/check-imports';

describe('quy ước import', () => {
  const { layer, cycles } = findProblems();
  it('engine không import app/ui/net/board/workers', () => expect(layer).toEqual([]));
  it('không có vòng import tĩnh trong src/', () => expect(cycles.map(c => c.join(' -> '))).toEqual([]));
});
