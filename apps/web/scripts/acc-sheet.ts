import { S, ANCHOR, PAL, speciesSprite, frontSprite } from '../src/sprites';
import { ACCESSORIES } from '@chick/engine';
import { deflateSync } from 'zlib'; import { writeFileSync } from 'fs';
const items = process.env.IT ? process.env.IT.split(',') : Object.keys(ACCESSORIES); const sps = (process.env.SP ?? 'chicken,duck,penguin,dino').split(',');
const SC = +(process.env.SC ?? 3), CW = 34, CH = 34, cols = items.length + 1, VN = (process.env.V ?? '1,s,front').split(',').length, rowsN = sps.length * VN;
const W = cols * CW * SC, H = rowsN * CH * SC; const img = Buffer.alloc(W * H * 3, 0xff);
const hex = (c: string) => { const m = c.match(/#?(..)(..)(..)/)!; return [1, 2, 3].map((i) => parseInt(m[i], 16)); };
const pal = PAL.map((c: any) => hex(String(c)));
function draw(name: string, cx: number, cy: number) {
  const rows = S[name], an = ANCHOR[name] ?? { ox: 0, oy: 0 };
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '.' || ch === ' ') return; const col = pal[+ch] ?? [255, 0, 0];
    const px = cx + x - an.ox + 9, py = cy + y - an.oy + 12;
    for (let a = 0; a < SC; a++) for (let b = 0; b < SC; b++) { const X = px * SC + a, Y = py * SC + b; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const o = (Y * W + X) * 3; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; } }));
}
// grid lines
for (let r = 0; r <= rowsN; r++) for (let x = 0; x < W; x++) { const Y = Math.min(H - 1, r * CH * SC); img.fill(200, (Y * W + x) * 3, (Y * W + x) * 3 + 3); }
for (let c = 0; c <= cols; c++) for (let y = 0; y < H; y++) { const X = Math.min(W - 1, c * CW * SC); img.fill(200, (y * W + X) * 3, (y * W + X) * 3 + 3); }
sps.forEach((sp, i) => (process.env.V ?? '1,s,front').split(',').forEach((v, j) => {
  const r = i * VN + j;
  [null, ...items].forEach((it, c) => { const key = it ? `${sp}|${it}` : sp; const n = v === 'front' ? frontSprite(key) : speciesSprite(key, v as any); draw(n, c * CW, r * CH); });
}));
const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(process.argv[2] ?? '/workspace/species-acc-all.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(items.join(' '), W, H);
