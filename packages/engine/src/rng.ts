/** mulberry32：決定性 PRNG。state 是 32-bit 整數，可序列化。 */
export interface Rng { state: number }
export function createRng(seed: number): Rng { return { state: seed >>> 0 }; }
export function nextFloat(r: Rng): number {
  r.state = (r.state + 0x6d2b79f5) >>> 0;
  let t = r.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function nextInt(r: Rng, maxExclusive: number): number { return Math.floor(nextFloat(r) * maxExclusive); }
