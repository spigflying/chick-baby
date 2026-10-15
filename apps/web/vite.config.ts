import { defineConfig } from 'vite';
// @ts-ignore 純 JS 建置腳本
import { buildId, readNotes } from './build-id.mjs';
const BUILD = buildId();
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [{
    name: 'build-json',
    // dist/build.json：伺服器讀這個檔，/api/status 回傳 build 與更新說明（和前端內嵌的 id 一定一致）
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ build: BUILD, notes: readNotes() }) }); },
  }],
});
