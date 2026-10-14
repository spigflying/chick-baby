import { describe, expect, it } from 'vitest';
import { createDbGate } from '../src/gate';

function fakeBus() {
  const b = { starts: 0, stops: 0, async start() { b.starts++; }, async stop() { b.stops++; } };
  return b;
}

describe('db gate', () => {
  it('runs migration and LISTEN once even when many requests arrive together (09:00 rush)', async () => {
    const bus = fakeBus(); let migrations = 0;
    const gate = createDbGate({} as any, bus as any, async () => { migrations++; await new Promise((r) => setTimeout(r, 20)); });
    await Promise.all(Array.from({ length: 20 }, () => gate.ensure()));
    expect(migrations).toBe(1);
    expect(bus.starts).toBe(1);
  });
  it('retries on the next request after a failure', async () => {
    const bus = fakeBus(); let calls = 0;
    const gate = createDbGate({} as any, bus as any, async () => { calls++; if (calls === 1) throw new Error('db down'); });
    await expect(gate.ensure()).rejects.toThrow('db down');
    await gate.ensure();
    expect(calls).toBe(2);
    expect(bus.starts).toBe(1);
  });
  it('release() stops LISTEN and the next ensure() reconnects', async () => {
    const bus = fakeBus();
    const gate = createDbGate({} as any, bus as any, async () => {});
    await gate.ensure(); await gate.release(); await gate.ensure();
    expect(bus.stops).toBe(1);
    expect(bus.starts).toBe(2);
  });
});
