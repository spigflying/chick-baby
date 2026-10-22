import { afterEach, describe, expect, it, vi } from 'vitest';
import { initRacing, onRaceBus, raceBusy } from '../src/racing';

// 不需要資料庫：用假的 db（每個查詢都丟錯）模擬「發起一起賽車時資料庫剛好出錯」
const failingDb: any = new Proxy({}, { get: () => () => { throw new Error('db down'); } });
const presence: any = { users: () => [{ id: 'u1', display_name: '阿明' }, { id: 'u2', display_name: '小美' }], instances: () => ['i1'] };

afterEach(() => { vi.restoreAllMocks(); });

describe('racing: invite when the database fails', () => {
  it('does not leave an unhandled rejection (would exit the process); the inviter gets INTERNAL and the home is free again', async () => {
    const sent: any[] = [], unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      initRacing({ db: failingDb, bus: { publish: async () => {} } as any, presence, instance: () => 'i1', local: (m) => sent.push(m) });
      onRaceBus({ t: 'rrace.invite', home: 'h1', user: 'u1', name: '阿明' });
      expect(raceBusy('h1')).toBe(true); // 讀檔中
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
      expect(sent).toEqual([{ t: 'rrace.notice', home: 'h1', user: 'u1', code: 'INTERNAL' }]);
      expect(raceBusy('h1')).toBe(false);
    } finally { process.off('unhandledRejection', onUnhandled); }
  });
});
