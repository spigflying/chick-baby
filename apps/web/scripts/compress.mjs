// 建置後把 dist 裡的文字檔預先壓成 .br / .gz，伺服器（@fastify/static preCompressed）直接送，不用每次即時壓縮。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const TEXT = /\.(html|js|mjs|css|svg|json|txt|webmanifest)$/;
let n = 0, before = 0, after = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const f = path.join(dir, name);
    if (statSync(f).isDirectory()) { walk(f); continue; }
    if (!TEXT.test(name)) continue;
    const buf = readFileSync(f);
    if (buf.length < 1024) continue; // 太小不值得
    const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    const gz = gzipSync(buf, { level: 9 });
    if (br.length < buf.length) writeFileSync(`${f}.br`, br);
    if (gz.length < buf.length) writeFileSync(`${f}.gz`, gz);
    n++; before += buf.length; after += br.length;
  }
};
walk(root);
console.log(`compressed ${n} files: ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB (br)`);
