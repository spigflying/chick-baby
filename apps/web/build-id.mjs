// 建置 id（只給程式比對用，不顯示給玩家）：BUILD_ID 環境變數 → git commit → 前端/引擎原始碼＋更新說明的內容雜湊。
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
export const NOTES_FILE = path.resolve(here, '../server/release-notes.json');
function walk(dir, out) { if (!existsSync(dir)) return; for (const n of readdirSync(dir).sort()) { const p = path.join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } }
export function contentHash() {
  const files = []; for (const d of ['src', 'index.html', '../../packages/engine/src']) { const p = path.resolve(here, d); if (existsSync(p) && statSync(p).isFile()) files.push(p); else walk(p, files); }
  files.push(NOTES_FILE);
  const h = createHash('sha256'); for (const f of files) if (existsSync(f)) { h.update(path.relative(here, f)); h.update(readFileSync(f)); }
  return h.digest('hex').slice(0, 10);
}
export function buildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  let sha = ''; try { sha = execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* Docker 裡沒有 .git */ }
  return (sha ? sha + '-' : '') + contentHash();
}
export function readNotes() { try { const j = JSON.parse(readFileSync(NOTES_FILE, 'utf8')); return Array.isArray(j.notes) ? j.notes.map(String).slice(0, 8) : []; } catch { return []; } }
