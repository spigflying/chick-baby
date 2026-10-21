import { describe, expect, it } from 'vitest';
import { createRace, stepRace, raceRanking, setRaceInput, carStats, STOCK_PARTS, PARTS, PART_KINDS, TRACKS, COUNTRIES, buildTrack, prizeFor, pointsFor, NITRO_PER_RACE, RACE_SLOTS, fillField, settleCup, newCup, cupTrack, ME, condition, condFactor, seasonOf, segAt, type Parts } from '../src/racing';

const run = (s: ReturnType<typeof createRace>, f?: (s: any) => void) => { while (!s.over) { f?.(s); stepRace(s); } return s; };
const drive = (s: any, id: string, nitro = false) => { const me = s.cars.find((c: any) => c.id === id); let tgt = segAt(s, me.z + 40).curve * 0.12;
  for (const o of s.cars) { const dz = o.z - me.z; if (o !== me && dz > 0 && dz < 35 && Math.abs(o.x - me.x) < 0.45) tgt = o.x > 0 ? o.x - 0.7 : o.x + 0.7; }
  setRaceInput(s, id, { gas: true, left: me.x > tgt + 0.1, right: me.x < tgt - 0.1, nitro }); };
const steer = (id: string) => (s: any) => drive(s, id);
describe('racing engine v5', () => {
  it('4 countries × 4 races; tracks loop; a full 20-car AI field finishes every track', () => {
    expect(COUNTRIES.length).toBe(4); expect(TRACKS.length).toBe(16);
    for (const t of TRACKS) {
      const segs = buildTrack(t); expect(Math.abs(segs[segs.length - 1].y)).toBeLessThan(1e-6);
      const s = run(createRace(7, t.id, fillField([])));
      expect(s.cars.length).toBe(RACE_SLOTS - 1);
      expect(s.cars.filter((c) => c.finishedTick !== null).length, t.id).toBeGreaterThanOrEqual(18);
    }
  });
  it('humans start at the back of a 20-car grid; AI fill uses the grey generic car', () => {
    const s = createRace(1, 'tw1', fillField([{ id: 'me', name: 'me', car: 'f1' }, { id: 'b', name: 'b', car: 'arrow' }]));
    expect(s.cars.length).toBe(20);
    const zs = s.cars.map((c) => c.z); const me = s.cars.find((c) => c.id === 'me')!;
    expect(me.z).toBeLessThanOrEqual(Math.min(...s.cars.filter((c) => c.ai).map((c) => c.z)));
    expect(s.cars.filter((c) => c.ai).every((c) => c.car === 'ai')).toBe(true); expect(me.car).toBe('f1'); void zs;
  });
  it('deterministic', () => {
    const go = () => run(createRace(42, 'jp1', fillField([{ id: 'me', name: 'me' }])), steer('me'));
    expect(JSON.stringify(go().cars)).toBe(JSON.stringify(go().cars));
  });
  it('exactly 3 nitro per race', () => {
    const s = createRace(1, 'us1', [{ id: 'me', name: 'me' }]);
    run(s, (st) => setRaceInput(st, 'me', { gas: true, nitro: st.tick % 100 === 50 }));
    expect(s.cars[0].nitro).toBe(0); expect(NITRO_PER_RACE).toBe(3);
  });
  it('every hit lowers condition; lower condition lowers top speed; side armour reduces roadside loss', () => {
    const crash = (parts: Partial<Parts>) => { const s = createRace(3, 'tw1', [{ id: 'me', name: 'me', parts }]); for (let i = 0; i < 400; i++) { setRaceInput(s, 'me', { gas: true, right: true }); stepRace(s); } return s.cars[0]; };
    const a = crash(STOCK_PARTS), b = crash({ armorS: 3 });
    expect(a.hits).toBeGreaterThan(0); expect(condition(a)).toBeLessThan(100); expect(b.damage).toBeLessThan(a.damage);
    expect(condFactor(30)).toBeLessThan(condFactor(10)); expect(condFactor(10)).toBeLessThan(1);
  });
  it('rear-end hit damages both cars (front of hitter, rear of victim)', () => {
    const s = createRace(5, 'us1', [{ id: 'a', name: 'a' }, { id: 'b', name: 'b', parts: { armorR: 3 } }]);
    s.countdown = 0; const [a, b] = s.cars; a.x = b.x = 0; a.z = 0; b.z = 4.5; a.speed = 60; b.speed = 20;
    stepRace(s); expect(a.damage).toBeGreaterThan(0); expect(b.damage).toBeGreaterThan(0); expect(b.damage).toBeLessThan(a.damage);
  });
  it('TG2-style shop: 3 tiers, prices rise; gearbox needs engine; wet tyres matter in rain', () => {
    for (const k of PART_KINDS) { expect(PARTS[k].tiers.length).toBe(4); PARTS[k].tiers.forEach((t, i) => { if (i) expect(t.price).toBeGreaterThan(PARTS[k].tiers[i - 1].price); }); }
    expect(PARTS.engine.tiers[3].price).toBe(80000); expect(PARTS.dry.tiers[1].price).toBe(1000);
    expect(carStats({ gearbox: 3 }).topSpeed).toBeLessThan(carStats({ gearbox: 3, engine: 3 }).topSpeed);
    expect(carStats({ gearbox: 3, engine: 2 }).topSpeed).toBeGreaterThan(carStats({ engine: 2 }).topSpeed);
    expect(carStats({ wet: 3 }).wetGrip).toBeGreaterThan(carStats({}).wetGrip);
  });
  it('prizes/points top 6 only', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(prizeFor)).toEqual([10000, 6000, 4000, 3000, 2000, 1000, 0]);
    expect([1, 6, 7, 10].map(pointsFor)).toEqual([10, 1, 0, 0]);
  });
  it('cup: only current track counts, DNQ (>10) restarts country, winning 4 races unlocks next country', () => {
    let cup = newCup(0); let unlocked = 1;
    const rk = (me: number) => [{ key: ME, rank: me }, { key: '阿飛', rank: me === 1 ? 2 : 1 }];
    expect(settleCup(cup, unlocked, 'jp1', rk(1)).counted).toBe(false);
    const dnq = settleCup({ ...cup, race: 2, points: { [ME]: 12 } }, unlocked, cupTrack({ ...cup, race: 2 })!.id, rk(11));
    expect(dnq.qualified).toBe(false); expect(dnq.cup.race).toBe(0); expect(dnq.cup.points).toEqual({});
    for (let i = 0; i < 4; i++) { const r = settleCup(cup, unlocked, cupTrack(cup)!.id, rk(1)); cup = r.cup; unlocked = r.unlocked; if (i === 3) { expect(r.champion).toBe(true); expect(r.countryDone).toBe(true); } }
    expect(unlocked).toBe(2); expect(cup.country).toBe(1); expect(cup.race).toBe(0);
    // 4 站都第 2 名：國家冠軍是別人 → 重跑
    let c2 = newCup(0); let last: any;
    for (let i = 0; i < 4; i++) { last = settleCup(c2, 1, cupTrack(c2)!.id, [{ key: '阿飛', rank: 1 }, { key: ME, rank: 2 }]); c2 = last.cup; }
    expect(last.champion).toBe(false); expect(last.unlocked).toBe(1); expect(c2.country).toBe(0);
  });
  it('a steering player with mid upgrades can place top 10 on the first track; AI varies', () => {
    const s = run(createRace(9, 'tw1', fillField([{ id: 'me', name: 'me', parts: { engine: 1, gearbox: 1, dry: 2, nitro: 1 } }])), (st) => drive(st, 'me', st.tick % 400 === 200));
    const r = raceRanking(s); const me = s.cars.find((c) => c.id === 'me')!;
    expect(r.indexOf(me) + 1).toBeLessThanOrEqual(10);
    expect(new Set(s.cars.filter((c) => c.ai).map((c) => c.stats.topSpeed.toFixed(1))).size).toBeGreaterThan(10);
  });
  it('season = Taipei calendar month', () => {
    expect(seasonOf(Date.UTC(2026, 9, 31, 16, 30))).toBe('2026-11'); expect(seasonOf(Date.UTC(2026, 9, 31, 15, 0))).toBe('2026-10');
  });
});
