import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@chick/'));
await build({ entryPoints: ['src/index.ts', 'src/migrate-cli.ts'], outdir: 'dist', bundle: true, platform: 'node', format: 'esm', target: 'node22', external, sourcemap: true });
console.log('server built');
