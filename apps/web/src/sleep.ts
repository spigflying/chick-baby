/** 倒數文字：`2 天 03:04:05` 或 `03:04:05`；負數視為 0。 */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const hms = [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
  return d ? `${d} 天 ${hms}` : hms;
}
/** 開門時間（瀏覽器時區；台灣使用者即台北時間）：`星期一 09:00`。 */
export function formatOpensAt(t: number): string {
  const d = new Date(t);
  return `星期${'日一二三四五六'[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
