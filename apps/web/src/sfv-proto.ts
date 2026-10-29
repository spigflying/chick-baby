// @ts-nocheck
import { SFV, SFVServer } from '@chick/engine';
import { SFVClient } from './sfv-net';


// === [BOOT: 頁面接線（鍵盤、監控面板、按鈕）] ===
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const { UP, DOWN, LEFT, RIGHT, LP, HP, LK, HK } = SFV;
  // 用 e.code（實體按鍵），開著中文輸入法也能玩
  const KEY_BITS = { KeyW: UP, KeyS: DOWN, KeyA: LEFT, KeyD: RIGHT, KeyU: LP, KeyI: HP, KeyJ: LK, KeyK: HK, KeyH: LP | LK, KeyL: HP | HK };
  const held = new Set();
  const keyMask = () => { let m = 0; for (const c of held) m |= KEY_BITS[c] ?? 0; return m; };
  const net = { rtt: 100, jitter: 10 };
  const bot = SFVClient.createBot();
  const ui = { screen: 'select', sel: { cursor: 0, lockedAt: -1 }, frame: 0, world: null, opp: 'ai', showBoxes: true, matchNo: 0, log: '' };
  const samplers = [() => keyMask(), (s, pid) => bot(ui.opp)(s, pid)];
  // 原型頁專用的假結算；正式版只在 server 的資料庫 transaction 內結算。
  const demoLedger = new Map();
  function demoSettle(matchId, outcome) {
    const prev = demoLedger.get(matchId); if (prev) return { ...prev, applied: false };
    const transfers = outcome.win === 0 || outcome.win === 1 ? [{ from: outcome.users[1 - outcome.win], to: outcome.users[outcome.win], coins: 20 }] : [];
    const result = { matchId, win: outcome.win, transfers }; demoLedger.set(matchId, result); return { ...result, applied: true };
  }

  function startMatch() {
    ui.matchNo++;
    ui.world = SFVClient.createWorld({ matchId: `proto-${Date.now()}-${ui.matchNo}`, now: performance.now(), net, samplers, users: ['你', 'CPU'] });
    ui.screen = 'fight'; ui.log = '';
  }
  function toSelect() { ui.world = null; ui.screen = 'select'; ui.sel.lockedAt = -1; }

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (KEY_BITS[e.code] !== undefined || e.code === 'Enter' || e.code === 'Escape') e.preventDefault();
    if (ui.screen === 'select') {
      if (e.repeat || ui.sel.lockedAt >= 0) return;
      const c = ui.sel.cursor;
      if (e.code === 'KeyA') ui.sel.cursor = (c + 7) % 8;
      else if (e.code === 'KeyD') ui.sel.cursor = (c + 1) % 8;
      else if (e.code === 'KeyW' || e.code === 'KeyS') ui.sel.cursor = (c + 4) % 8;
      else if (e.code === 'KeyU' || e.code === 'Enter') ui.sel.lockedAt = ui.frame;
      return;
    }
    if (KEY_BITS[e.code] !== undefined) held.add(e.code);
    const over = ui.world && ui.world.room.status !== 'playing';
    if (over && e.code === 'Enter') startMatch();
    if (e.code === 'Escape') toSelect();
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());

  $('rtt').addEventListener('input', (e) => { net.rtt = +e.target.value; $('rttOut').textContent = `${net.rtt}ms`; });
  $('jit').addEventListener('input', (e) => { net.jitter = +e.target.value; $('jitOut').textContent = `${net.jitter}ms`; });
  $('opp').addEventListener('change', (e) => { ui.opp = e.target.value; e.target.blur(); });
  $('boxes').addEventListener('change', (e) => { ui.showBoxes = e.target.checked; e.target.blur(); });
  $('close').addEventListener('click', (e) => { e.target.blur(); if (ui.world) ui.world.room.closesAt = performance.now(); });
  $('resettle').addEventListener('click', (e) => {
    e.target.blur();
    const r = ui.world?.room;
    if (!r || r.status !== 'done') { ui.log = '還沒有結算過的比賽（打完一場再試）'; return; }
    const again = demoSettle(r.matchId, r.outcome);
    ui.log = `重送結算 ${r.matchId}：applied=${again.applied}（${again.applied ? '轉帳了！' : '已結算過，忽略，不會重複轉帳'}）`;
  });
  $('toSelect').addEventListener('click', (e) => { e.target.blur(); toSelect(); });

  // 伺服器、網路、兩個客戶端每 4ms 推進一次（不綁畫面更新率）；畫面用 rAF
  setInterval(() => { if (ui.world) ui.world.pump(performance.now()); }, 4);
  function settleText(r) {
    if (!r || r.status !== 'done') return '';
    r.result ??= demoSettle(r.matchId, r.outcome);
    const t = r.result.transfers[0];
    return t ? `結算：${t.from} → ${t.to} ◎${t.coins}（冪等，只轉一次）` : '結算：平手不轉帳';
  }
  function render() {
    ui.frame++;
    if (ui.screen === 'select') {
      SFVClient.drawSelect(ctx, ui.sel, ui.frame);
      if (ui.sel.lockedAt >= 0 && ui.frame - ui.sel.lockedAt > 72) startMatch();
    } else if (ui.world) {
      const c = ui.world.clients[0];
      SFVClient.drawFight(ctx, c.predicted, { showBoxes: ui.showBoxes, me: 0, names: ['MY_CHICK_BABY（你）', `MY_CHICK_BABY（${ui.opp === 'ai' ? 'CPU' : '木樁'}）`], ended: c.ended, settleText: settleText(ui.world.room) });
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // ---------- 招式表（發生／傷害直接讀引擎的招式資料） ----------
  const MOVE_TABLE = [
    ['大招（超必殺）', [['火雞連環踢', '↓↘→↓↘→ + 腳', 'CA', '要 3 格 EX；暗場後連踢 6 段']]],
    ['必殺技', [
      ['蛋波', '↓↘→ + 拳', 'HADO_L', 'U 慢、I 快；畫面上一次一顆'],
      ['衝天啄', '→↓↘ + 拳（或 →↓→）', 'DP_H', 'I 版／EX 版：開頭 6 tick 無敵、上升中穿波；U 版沒無敵'],
      ['旋風翅', '↓↙← + 腳', 'TATSU_L', '越過下段和波'],
      ['EX 版', '必殺技改按雙拳 U+I／雙腳 J+K', null, '耗 1 格 EX，更強'],
    ]],
    ['系統', [
      ['摔', 'U+J 或 H', 'THROW', '近身，擋不住'],
      ['解摔', '被抓後 7 tick 內按 U+J', null, ''],
      ['炸毛', 'I+K 或 L', 'VT', '炸毛條滿才能用：衝刺、攻擊 +20%'],
      ['防禦', '按住後＝站防；後下＝蹲防', null, '下段要蹲防，跳攻要站防'],
      ['後退步', '←← 快按兩下', 'BDASH', '前 2 tick 不會被摔，接著小跳離地（躲摔），落地有破綻'],
      ['前衝', '→→ 快按兩下', 'FDASH', ''],
      ['取消', '普通技打中後馬上搓必殺', null, '必殺打中可再接大招'],
    ]],
    ['普通技', [
      ['站輕拳', 'U', '5LP'], ['站重拳', 'I', '5HP', '可接必殺'], ['站輕腳', 'J', '5LK'], ['站重腳', 'K', '5HK'],
      ['蹲輕拳', '↓ + U', '2LP'], ['蹲重拳', '↓ + I', '2HP', '對空'], ['蹲輕腳', '↓ + J', '2LK', '下段'], ['掃堂腿', '↓ + K', '2HK', '下段・倒地'],
      ['跳重拳', '空中 拳', '8HP', '中段'], ['跳重腳', '空中 腳', '8HK', '中段'],
    ]],
  ];
  function frameData(id) {
    if (!id) return '';
    const m = SFV.MOVE_LIST[SFV.M[id]], dmg = m.projectile !== undefined ? SFV.PROJ[m.projectile].dmg * SFV.PROJ[m.projectile].n : m.dmg.reduce((a, b) => a + b, 0);
    return dmg ? `發生 ${m.S}・傷害 ${dmg}` : `全長 ${m.total} tick`;
  }
  $('moves').innerHTML = '<h3>招式表（角色在左邊；在右邊時 ← → 相反）</h3><div class="note">拳＝U 輕／I 重　腳＝J 輕／K 重<br>↑W ↓S ←A →D；↘＝S+D 一起按</div>' +
    MOVE_TABLE.map(([title, rows]) => `<h4>${title}</h4>` + rows.map(([name, cmd, id, note = '']) =>
      `<div class="mv"><div><b>${name}</b><span class="fd">${frameData(id)}</span></div><div class="cmd">${cmd}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`).join('')).join('');

  // ---------- 即時監控面板 ----------
  const card = (label, value, cls, sub) => `<div class="card"><span>${label}</span><b class="${cls}">${value}</b><span>${sub}</span></div>`;
  function historyHtml(hist, i) {
    return SFVClient.inputRuns(hist, i).map((r) => `<li><span>${r.dir} ${r.btn}</span><i>${r.n}</i></li>`).join('');
  }
  setInterval(() => {
    $('log').textContent = ui.log;
    const w = ui.world;
    if (!w) { $('mon').innerHTML = card('狀態', '選角中', '', '—'); $('histL').innerHTML = $('histR').innerHTML = ''; return; }
    const now = performance.now(), c = w.clients[0], st = w.room.stats;
    const perSec = c.perSec(now), maxDown = Math.max(...w.down.map((l) => l.maxBytes));
    $('mon').innerHTML = [
      card('Messages/sec ↑', perSec, perSec <= 35 ? 'ok' : 'bad', `上限 35・最高 ${c.stats.maxPerSec}`),
      card('伺服器丟棄', st.dropped[0], st.dropped[0] ? 'bad' : 'ok', `本地暫緩 ${c.stats.held}`),
      card('Snapshot bytes', st.snapBytes, st.maxSnapBytes < 600 ? 'ok' : 'bad', `狀態 <600・訊息 ${st.snapMsgBytes}`),
      card('最大訊息 bytes', maxDown, maxDown < 8000 ? 'ok' : 'bad', `NOTIFY 上限 8000・超標 ${st.oversize}`),
      card('Simulated RTT', c.rtt == null ? '—' : `${Math.round(c.rtt)}ms`, '', `設定 ${net.rtt}±${net.jitter}`),
      card('Rollback Count', c.stats.rollbacks, '', `上次重算 ${c.stats.lastResim} tick`),
      card('預測領先', `${c.L - c.C} tick`, '', `提前量 ${c.lead()}（+${c.extraLead}）`),
      card('遲到輸入', st.late[0], st.late[0] ? 'warn' : 'ok', '伺服器順延到下一 tick'),
      card('Desync', c.stats.desync, c.stats.desync ? 'bad' : 'ok', `快照核對 OK ${c.stats.snapsOk}`),
      card('Tick', `${w.room.tick}`, '', `本地 ${c.L}・確認 ${c.C}・${w.room.status}`),
    ].join('');
    $('histL').innerHTML = historyHtml(c.histConf, 0);
    $('histR').innerHTML = historyHtml(c.histConf, 1);
  }, 200);
})();
