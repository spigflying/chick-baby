import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
describe('room ready is a single tap (no 確定準備 second step)', () => {
  for (const f of ['race.ts', 'stairs-room.ts']) it(f, () => {
    const s = src(f);
    expect(s).not.toContain('確定準備'); expect(s).not.toContain('先不要'); expect(s).not.toContain('room-ask');
    expect(s).toMatch(/(rrdy|'ready'\))[^\n]*live\?\.send\(\{ type: 'room\.ready', ready: true \}\)/);
  });
});
