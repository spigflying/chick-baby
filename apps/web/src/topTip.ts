/** 頂部狀態列的中文提示（hover / 點一下才顯示，不常駐）。 */
export type TopKey = 'name' | 'stage' | 'coins' | 'age';
export const TOP_TIP_LABEL: Record<TopKey, string> = { name: '名字', stage: '階段', coins: '金幣', age: '年齡' };
export const TIP_HIDE_MS = 2000;

export function tipText(k: TopKey, value: string, isEgg = false): string {
  const label = k === 'age' && isEgg ? '孵化倒數' : TOP_TIP_LABEL[k];
  const v = (k === 'coins' ? value.replace(/^◎/, '') : value).trim();
  return v && v !== '—' ? `${label} ${v}` : label;
}

type Timers = { set: (f: () => void, ms: number) => number; clear: (id: number) => void };
const realTimers: Timers = { set: (f, ms) => window.setTimeout(f, ms), clear: (id) => window.clearTimeout(id) };

/** 狀態機：hover 顯示/離開隱藏；tap 切換並約 2 秒自動隱藏；點別處隱藏。 */
export class TopTip {
  shown: TopKey | null = null;
  private by: 'hover' | 'tap' | null = null;
  private t: number | null = null;
  constructor(private onChange: (k: TopKey | null) => void, private timers: Timers = realTimers) {}
  private set(k: TopKey | null, by: 'hover' | 'tap' | null) {
    if (this.t !== null) { this.timers.clear(this.t); this.t = null; }
    this.shown = k; this.by = k ? by : null; this.onChange(k);
    if (k && by === 'tap') this.t = this.timers.set(() => { this.t = null; this.set(null, null); }, TIP_HIDE_MS);
  }
  hover(k: TopKey) { this.set(k, 'hover'); }
  leave(k: TopKey) { if (this.shown === k && this.by === 'hover') this.set(null, null); }
  tap(k: TopKey) { if (this.shown === k && this.by === 'tap') this.set(null, null); else this.set(k, 'tap'); }
  outside() { if (this.shown) this.set(null, null); }
}
