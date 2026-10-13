'use strict';
// ===== 資料結構（schema v3，可直接同步至 Firestore 文件）=====
const KEY = 'chickBabyState';
const SCHEMA = 3;
const MIN = 60000;
const DECAY = { hunger: 0.8, happiness: 0.6, energy: 0.5, cleanliness: 0.4 };
const STAGES = { eggUntil: 2, chickUntil: 60 };
const $ = id => document.getElementById(id);
let state = null;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

function newState(name) {
  const now = Date.now();
  return { schemaVersion: SCHEMA, id: uid(), name, born: now, birthTime: new Date(now).toISOString(), last: now, updatedAt: now,
    hunger: 80, happiness: 80, energy: 80, cleanliness: 100, health: 100, sick: false, sleeping: false, dead: false, poop: 0,
    traits: { strength: 10, speed: 10, stamina: 10, weight: 20, personality: '溫和' },
    coins: 0, bestFloor: 0,
    counters: { feeds: 0, snacks: 0, plays: 0, sleeps: 0, cleans: 0, doctor: 0 } };
}
function migrate(s) {
  if (!s || !s.born) return null;
  if (!s.schemaVersion || s.schemaVersion < 2) {
    s.id = s.id || uid();
    s.birthTime = s.birthTime || new Date(s.born).toISOString();
    s.traits = s.traits || { strength: 10, speed: 10, stamina: 10, weight: 20, personality: '溫和' };
    s.counters = s.counters || { feeds: 0, snacks: 0, plays: 0, sleeps: 0, cleans: 0, doctor: 0 };
    s.schemaVersion = 2;
  }
  if (s.schemaVersion < 3) { s.coins = s.coins || 0; s.bestFloor = s.bestFloor || 0; s.schemaVersion = 3; }
  return s;
}
const clamp = v => Math.max(0, Math.min(100, v));
const ageMin = () => ((state.dead ? state.last : Date.now()) - state.born) / MIN;
function stage() { const a = ageMin(); return a < STAGES.eggUntil ? 'egg' : a < STAGES.chickUntil ? 'chick' : 'adult'; }

function simulate(minutes) {
  while (minutes > 0 && !state.dead) {
    const m = Math.min(1, minutes); minutes -= m;
    if ((Date.now() - state.born) / MIN < STAGES.eggUntil) continue;
    const sleep = state.sleeping;
    state.hunger = clamp(state.hunger - DECAY.hunger * m * (sleep ? 0.5 : 1));
    state.happiness = clamp(state.happiness - DECAY.happiness * m * (sleep ? 0.3 : 1));
    state.energy = clamp(state.energy + (sleep ? 2 : -DECAY.energy) * m);
    state.cleanliness = clamp(state.cleanliness - DECAY.cleanliness * m);
    if (Math.random() < 0.02 * m) state.poop = Math.min(3, state.poop + 1);
    state.cleanliness = clamp(state.cleanliness - state.poop * 0.3 * m);
    if (sleep && state.energy >= 100) state.sleeping = false;
    const bad = [state.hunger, state.happiness, state.energy, state.cleanliness].filter(v => v < 20).length;
    if (!state.sick && (state.cleanliness < 25 || state.hunger < 15) && Math.random() < 0.05 * m) state.sick = true;
    let dh = bad * -0.6 + (state.sick ? -0.8 : 0);
    if (!bad && !state.sick) dh = 0.3;
    state.health = clamp(state.health + dh * m);
    if (state.health <= 0) state.dead = true;
  }
}
function tick() {
  if (!state) return;
  const now = Date.now();
  if (!state.dead) { simulate((now - state.last) / MIN); state.last = now; }
  save(); render();
}
function save() { state.updatedAt = Date.now(); localStorage.setItem(KEY, JSON.stringify(state)); }
function say(t) { $('msg').textContent = t; }

// ===== 性格與能力 =====
function trait(k, d, max = 999) { state.traits[k] = Math.max(1, Math.min(max, Math.round((state.traits[k] + d) * 10) / 10)); }
function updatePersonality() {
  const c = state.counters, t = state.traits;
  let p = '溫和';
  if (t.weight > 60 || c.snacks > c.feeds * 0.5 + 2) p = '貪吃';
  else if (c.plays > c.feeds && c.plays > 4) p = '活潑';
  else if (c.sleeps > c.plays + 3) p = '懶散';
  else if (t.strength > t.speed + 8) p = '勇敢';
  else if (t.speed > t.strength + 8) p = '機靈';
  t.personality = p;
}

// ===== 食物 =====
const FOODS = [
  { id: 'rice', name: '米粒', stage: 'chick', price: 0, sprite: 'rice', hunger: 20, happiness: 2, health: 1, weight: 1, strength: 0, speed: 0, stamina: 0.5 },
  { id: 'worm', name: '蟲蟲', stage: 'chick', price: 5, sprite: 'worm', hunger: 20, happiness: 8, health: 3, weight: 1, strength: 4, speed: 1, stamina: 1 },
  { id: 'candy', name: '糖果', stage: 'chick', price: 3, sprite: 'candy', snack: true, hunger: 5, happiness: 20, health: -3, weight: 2, strength: 0, speed: 1, stamina: 0 },
  { id: 'corn', name: '玉米', stage: 'adult', price: 10, sprite: 'corn', hunger: 35, happiness: 6, health: 4, weight: 2, strength: 2, speed: 3, stamina: 4 },
  { id: 'cake', name: '蛋糕', stage: 'adult', price: 15, sprite: 'cake', snack: true, hunger: 10, happiness: 35, health: -5, weight: 4, strength: 2, speed: 0, stamina: 2 }
];
const unlocked = f => f.stage === 'chick' || stage() === 'adult';

const PAL = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'];
const S = {
  egg: ['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','311211111113','311111112113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  egg2:['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','3113.3.31113','3111.3.11113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  chick: ['....3333....','...311113...','..31111113..','.3131111113.','322111111113','.33111111113','.31111111113','311112211113','311112221113','311111111113','.3111111113.','..33333333..','...3....3...','..33....33..'],
  chick2: ['............','....3333....','...311113...','..31111113..','.3131111113.','322111111113','.33111111113','.31111111113','311112211113','311112221113','311111111113','..33333333..','...3....3...','..33....33..'],
  adult: ['......3.3.......','.....32323......','....3333333.....','...311111113....','..31111111113...','..31131111113...','..311111111113..','.3222111111113..','..33311111111133','...311112221113.','...311122222113.','...31111111113..','....3111111113..','.....33333333...','......3....3....','.....33...33....'],
  adult2: ['................','......3.3.......','.....32323......','....3333333.....','...311111113....','..31111111113...','..31131111113...','..311111111113..','.3222111111113..','..33311111111133','...311112221113.','...311122222113.','...31111111113..','....3111111113..','......3....3....','.....33...33....'],
  ghost: ['...3333...','..311113..','.31111113.','.31311313.','.31111113.','.31133113.','.31111113.','.31111113.','.3131313..','.3.3.3.3..'],
  poop: ['...3...','..323..','.32223.','3222223','3333333'],
  z: ['3333','..3.','.3..','3333'],
  skull: ['.333.','31313','33333','.3.3.'],
  heart: ['.3.3.','33333','33333','.333.','..3..'],
  food: ['..33.','.3223','.3223','.333.','3....'],
  ball: ['.333.','32123','31213','32123','.333.'],
  bubble: ['.33.','3..3','3..3','.33.'],
  syringe: ['3.....','.3333.','.3222.3','.3333.','3.....'],
  i_hunger: ['..3333.....','.322223....','3211223....','3212223....','32222223...','32222223...','.3332203.3.','....3330303','.......3003','......3003.','.......33..'],
  i_happy: ['..3333..','.311113.','31311313','31111113','31311313','31133113','.311113.','..3333..'],
  i_energy: ['....333.','...333..','..333...','.3333333','.....33.','....33..','...33...','..3.....'],
  i_clean: ['....3....','....3....','...323...','...323...','..30223..','.3002223.','301222223','312222223','322222223','.3222223.','..33333..'],
  i_feed: ['..3333.....','.322223....','3211223....','3212223....','32222223...','32222223...','.3332203.3.','....3330303','.......3003','......3003.','.......33..'],
  i_play: ['.......33','.......3.','.....333.','.....3...','...333...','...3.....','.333.....','.3.......'],
  i_sleep: ['...3333..','..33.....','.33......','.33......','.33......','.33......','..33.....','...3333..'],
  i_wash: ['....3....','....3....','...323...','...323...','..30223..','.3002223.','301222223','312222223','322222223','.3222223.','..33333..'],
  i_doc: ['...333...','...323...','.3333333.','.3222223.','.3333333.','...323...','...333...','.........'],
  i_stat: ['3..........33','3..........33','3.......33.33','3.......33.33','3....33.33.33','3....33.33.33','3.33.33.33.33','3.33.33.33.33','3.33.33.33.33','3333333333333'],
  rice: ['.3.3.','3.3.3','.3.3.'],
  worm: ['.33....','3223.33','3..3223','....33.'],
  corn: ['..33..','.3223.','.3223.','.3223.','.3223.','..33..','.3..3.'],
  cake: ['..3...','.333..','322223','311113','322223','333333'],
  candy: ['3.333.3','.32223.','3.333.3'],
  sparkle: ['..3..','..3..','33.33','..3..','..3..'],
  i_health: ['.33..33.','32233223','32122223','32222223','.322223.','..3223..','...33...','........']
};

const cv = $('screen'), ctx = cv.getContext('2d');
const W = 120, H = 100, GROUND = 86, HUD = 14;
function spr(name, x, y, flip, cut = 0) {
  const rows = S[name];
  rows.forEach((r, j) => [...r].forEach((c, i) => {
    if (c === '.') return;
    const xi = flip ? r.length - 1 - i : i;
    if (cut && i >= r.length - cut) return;
    ctx.fillStyle = PAL[+c]; ctx.fillRect(Math.round(x + xi), Math.round(y + j), 1, 1);
  }));
}
const sw = n => S[n][0].length;
const BAR_N = 9;
function bar(x, y, icon, v) {
  const iw = sw(icon), ih = S[icon].length, n = BAR_N, f = Math.round(n * v / 100);
  spr(icon, x + Math.floor((11 - iw) / 2), y + Math.floor((11 - ih) / 2));
  ctx.fillStyle = PAL[3]; ctx.fillRect(x + 12, y + 3, n + 2, 6);
  ctx.fillStyle = PAL[0]; ctx.fillRect(x + 13, y + 4, n, 4);
  ctx.fillStyle = PAL[2]; ctx.fillRect(x + 13, y + 4, f, 4);
}

// ===== 選單 / 輸入 =====
const ICONS = [
  { act: 'feed', icon: 'i_feed', label: '餵食' }, { act: 'play', icon: 'i_play', label: '樓梯' },
  { act: 'sleep', icon: 'i_sleep', label: '睡覺' }, { act: 'clean', icon: 'i_wash', label: '清潔' },
  { act: 'doctor', icon: 'i_doc', label: '看醫生' }, { act: 'status', icon: 'i_stat', label: '狀態' }];
let sel = 0, menu = null, menuSel = 0;
let frame = 0, petX = 42, petDir = 1, anim = null, fxT = 0, fxKind = null, happyT = 0;
function fx(k) { fxKind = k; fxT = 6; }

function openMenu(m) { menu = m; menuSel = 0; renderMenu(); }
function closeMenu() { menu = null; renderMenu(); }
function renderMenu() {
  const el = $('menu');
  if (!menu) { el.hidden = true; return; }
  el.hidden = false;
  if (menu === 'feed') {
    el.innerHTML = `<div class="mt">— 餵食 —  ◎${state.coins}</div>` + FOODS.map((f, i) => {
      const u = unlocked(f), off = u && f.price > state.coins ? ' off' : '';
      return `<div class="mi${i === menuSel ? ' on' : ''}${off}" data-i="${i}">${i === menuSel ? '▶' : '　'}${u ? f.name + (f.snack ? '<small>點心</small>' : '') + `<em>${f.price ? '◎' + f.price : '免費'}</em>` : '???'}</div>`;
    }).join('') +
      '<div class="mi back" data-i="-1">✕ 關閉</div>';
  } else if (menu === 'status') {
    const t = state.traits, born = new Date(state.born);
    const row = (k, v) => `<div><b>${k}</b><span>${v}</span></div>`;
    el.innerHTML = '<div class="mt">— 狀態 —</div><div class="grid">' + row('名字', esc(state.name)) + row('性格', t.personality) +
      row('力量', t.strength) + row('速度', t.speed) + row('體力', t.stamina) + row('體重', t.weight + 'g') + row('金幣', '◎' + state.coins) + row('最深', (state.bestFloor || 0) + '樓') + '</div>' +
      `<div class="wide"><b>出生</b><span>${born.getMonth() + 1}/${born.getDate()} ${String(born.getHours()).padStart(2, '0')}:${String(born.getMinutes()).padStart(2, '0')}</span></div>` +
      `<div class="wide"><b>ID</b><span class="id">${state.id.slice(0, 8)}</span></div><div class="mi back on">✕ 關閉</div>`;
  }
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('menu').addEventListener('click', e => {
  if (game) return;
  const it = e.target.closest('.mi');
  if (menu !== 'feed' || !it) return closeMenu();
  const i = +it.dataset.i; if (i < 0) return closeMenu();
  menuSel = i; chooseFood(FOODS[i]);
});
function chooseFood(f) {
  if (!unlocked(f)) return say('還沒解鎖，長大一點再說！');
  if (state.hunger > 95) { closeMenu(); return say('吃不下了啦～'); }
  if (f.price > state.coins) return say(`金幣不夠！${f.name} 要 ◎${f.price}，玩下樓梯賺金幣吧。`);
  state.coins -= f.price; save(); render();
  closeMenu();
  anim = { type: 'eat', food: f, phase: 'drop', fx: Math.max(14, Math.min(W - 18, petX + (petX > 48 ? -20 : 24))), fy: -8, t: 0, bite: 0 };
  say(`${f.name} 掉下來了！`);
}
function finishEat(f) {
  state.hunger = clamp(state.hunger + f.hunger); state.happiness = clamp(state.happiness + f.happiness);
  state.health = clamp(state.health + f.health); state.cleanliness = clamp(state.cleanliness - 4);
  trait('weight', f.weight); trait('strength', f.strength); trait('speed', f.speed); trait('stamina', f.stamina);
  state.counters.feeds++; if (f.snack) state.counters.snacks++;
  if (Math.random() < 0.3) state.poop = Math.min(3, state.poop + 1);
  updatePersonality(); save(); render(); say(`好吃！${f.name} 吃光光～`);
}

const ACTIONS = {
  feed() { openMenu('feed'); },
  play() { if (state.energy < 15) return say('太累了，想睡覺…'); startGame(); },
  sleep() { state.sleeping = !state.sleeping; if (state.sleeping) { state.counters.sleeps++; trait('stamina', 0.5); } say(state.sleeping ? '晚安～' : '早安！'); },
  clean() { closeMenu(); anim = { type: 'clean', phase: 'tornado', t: 0, tx: -16, items: Array.from({ length: state.poop }, (_, i) => ({ x: W - 9 - i * 7, y: GROUND - 5 - (i % 2) * 3, lifted: false, ang: i * 2 })), bubbles: [] }; say('龍捲風來打掃囉！'); },
  doctor() { if (!state.sick && state.health > 90) return say('很健康，不用看醫生喔！');
    state.sick = false; state.health = clamp(state.health + 30); state.happiness = clamp(state.happiness - 10); state.counters.doctor++; fx('syringe'); say('打針好痛…但病好了！'); },
  status() { openMenu('status'); }
};
function activate(i) {
  if (game) return;
  tick();
  if (state.dead) return restart();
  sel = i; const act = ICONS[i].act;
  if (act === 'status') return ACTIONS.status();
  if (stage() === 'egg') return say('蛋蛋還在孵化中…');
  if (anim) return say(anim.type === 'clean' ? '正在洗澎澎，等一下～' : '正在吃東西，等一下～');
  if (state.sleeping && act !== 'sleep') return say('噓…牠在睡覺，先叫醒牠吧。');
  ACTIONS[act](); if (act !== 'feed') { updatePersonality(); save(); render(); }
}
$('labels').addEventListener('click', e => {
  const c = e.target.closest('.cell'); if (!c || !state) return;
  const i = +c.dataset.i;
  if (menu) { const was = menu; closeMenu(); if (ICONS[i].act === was) { sel = i; return; } }
  activate(i);
});
cv.addEventListener('click', () => { if (!state || game) return; if (state.dead) return restart(); if (menu) closeMenu(); });
document.addEventListener('keydown', e => {
  if (!state || $('nameDialog').open) return;
  const k = e.key;
  if (game) { gameKey(e, true); return; }
  if (menu) {
    const n = menu === 'feed' ? FOODS.length : 0;
    if (k === 'Escape' || k === 'Backspace') closeMenu();
    else if (k === 'ArrowUp' && n) { menuSel = (menuSel + n - 1) % n; renderMenu(); }
    else if (k === 'ArrowDown' && n) { menuSel = (menuSel + 1) % n; renderMenu(); }
    else if (k === 'Enter' || k === ' ') { if (menu === 'feed') chooseFood(FOODS[menuSel]); else closeMenu(); }
    else return;
  } else if (k === 'ArrowLeft') sel = (sel + 5) % 6;
  else if (k === 'ArrowRight') sel = (sel + 1) % 6;
  else if (k === 'Enter' || k === ' ') activate(sel);
  else return;
  e.preventDefault();
});


// ===== 小雞下樓梯 =====
let game = null;
const GH = 90, PLAT_W = 24, GAP = 16, TOP = 10;
const DIG = ['333','3.3','3.3','3.3','333','.3.','33.','.3.','.3.','333','333','..3','333','3..','333','333','..3','333','..3','333','3.3','3.3','333','..3','..3','333','3..','333','..3','333','333','3..','333','3.3','333','333','..3','..3','..3','..3','333','3.3','333','3.3','333','333','3.3','333','..3','333'];
function num(n, x, y, c = 3) { String(n).split('').forEach((d, i) => { for (let j = 0; j < 5; j++) [...DIG[+d * 5 + j]].forEach((ch, k) => { if (ch === '3') { ctx.fillStyle = PAL[c]; ctx.fillRect(x + i * 4 + k, y + j, 1, 1); } }); }); }
function pickType(n) {
  if (n < 4) return 'normal';
  const r = Math.random(), hard = Math.min(0.12, n * 0.003);
  return r < 0.46 - hard ? 'normal' : r < 0.58 ? 'spiky' : r < 0.72 ? 'conveyor' : r < 0.85 ? 'bouncy' : 'fragile';
}
function startGame() {
  closeMenu();
  const t = state.traits, st = stage(), spr0 = chickSprite(st);
  const maxHp = 10 + Math.min(4, Math.max(0, Math.floor((t.stamina - 10) / 5)));
  game = { st, pw: sw(spr0), ph: S[spr0].length, x: 40, y: 20, vy: 0, hp: maxHp, maxHp, floor: 0, made: 0, t: 0,
    speed: 1.2 + Math.min(0.5, Math.max(0, (t.speed - 10) * 0.03)), scroll: 0.32, plats: [], left: false, right: false,
    dir: -1, inv: 0, on: null, over: false };
  for (let y = 30; y < GH + GAP; y += GAP) addPlat(y);
  const sp = game.plats.find(p => p.y >= 60); sp.type = 'normal'; game.x = sp.x + PLAT_W / 2 - game.pw / 2; game.y = sp.y - game.ph; game.on = sp; sp.counted = true;
  // 遊戲時換成較高的畫面，但 LCD 總高度不變（仍在蛋殼內）
  const h0 = cv.offsetHeight + $('labels').offsetHeight;
  $('labels').hidden = true; $('gamebar').hidden = false; document.body.classList.add('playing');
  const hh = Math.min(h0 - $('gamebar').offsetHeight + 22, Math.round(cv.offsetWidth * GH / 96));
  cv.width = 96; cv.height = GH; cv.style.height = hh + 'px'; cv.style.width = Math.round(hh * 96 / GH) + 'px';
  say('←→ 移動，往下跳！小心尖刺～');
}
function addPlat(y) {
  const g = game; g.made++;
  const prev = g.plats[g.plats.length - 1], px = prev ? Math.max(0, Math.min(96 - PLAT_W, prev.x + Math.round((Math.random() * 2 - 1) * 44))) : Math.floor(Math.random() * (96 - PLAT_W));
  g.plats.push({ x: px, y, type: pickType(g.made), dir: Math.random() < 0.5 ? -1 : 1, brk: -1, counted: false, hurt: false });
}
function hurt(n) { const g = game; if (g.inv > 0) return; g.hp = Math.max(0, g.hp - n); g.inv = 30; }
function gameStep() {
  const g = game; frame++;
  if (!g.over) {
    g.t++;
    g.scroll = 0.25 + Math.min(0.35, g.floor * 0.006);
    for (const p of g.plats) p.y -= g.scroll;
    g.plats = g.plats.filter(p => p.y > TOP - 4 && p.brk !== 0);
    const last = g.plats[g.plats.length - 1];
    if (!last || last.y < GH + 4 - GAP) addPlat((last ? last.y : GH) + GAP);
    // 移動
    let dx = (g.right ? 1 : 0) - (g.left ? 1 : 0);
    if (dx) g.dir = dx;
    let mx = dx * g.speed;
    if (g.on) {
      const p = g.on;
      if (!g.plats.includes(p) || g.x + g.pw - 3 < p.x || g.x + 3 > p.x + PLAT_W) g.on = null;
      else {
        g.y = p.y - g.ph;
        if (p.type === 'conveyor') mx += p.dir * 0.7;
        if (p.type === 'fragile' && p.brk > 0 && --p.brk === 0) g.on = null;
      }
    }
    g.x = Math.max(0, Math.min(96 - g.pw, g.x + mx));
    if (!g.on) {
      const prevBottom = g.y + g.ph;
      g.vy = Math.min(2.6, g.vy + 0.2); g.y += g.vy;
      const bottom = g.y + g.ph;
      for (const p of g.plats) {
        if (g.vy >= 0 && prevBottom <= p.y + 1 && bottom >= p.y && g.x + g.pw - 3 >= p.x && g.x + 3 <= p.x + PLAT_W && p.brk !== 0) {
          g.y = p.y - g.ph; g.vy = 0;
          if (p.type === 'bouncy') { g.vy = -3.2; break; }
          g.on = p;
          if (p.type === 'spiky') { if (!p.hurt) { p.hurt = true; hurt(4); } }
          else if (!p.counted) g.hp = Math.min(g.maxHp, g.hp + 1);
          if (p.type === 'fragile' && p.brk < 0) p.brk = 12;
          break;
        }
      }
    }
    for (const p of g.plats) if (!p.counted && p.y + 2 < g.y) { p.counted = true; g.floor++; }
    if (g.y < TOP + 1) { hurt(4); g.y = TOP + 2; g.vy = 1; if (g.on) { g.on.counted = true; g.on = null; } }
    if (g.inv > 0) g.inv--;
    if (g.hp <= 0 || g.y > GH) endGame();
  }
  drawGame();
}
function drawGame() {
  const g = game;
  ctx.fillStyle = PAL[0]; ctx.fillRect(0, 0, 96, GH);
  // HUD
  ctx.fillStyle = PAL[3]; ctx.fillRect(0, 0, 96, 7);
  spr('heart', 1, 1); for (let i = 0; i < g.maxHp; i++) { ctx.fillStyle = i < g.hp ? PAL[0] : PAL[2]; ctx.fillRect(8 + i * 3, 2, 2, 3); }
  num(g.floor, 96 - String(g.floor).length * 4 - 1, 1, 0);
  // 天花板尖刺
  ctx.fillStyle = PAL[2]; for (let x = 0; x < 96; x += 4) { ctx.fillRect(x, 7, 4, 1); ctx.fillRect(x + 1, 8, 2, 1); ctx.fillRect(x + 1, 9, 1, 1); }
  for (const p of g.plats) {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (p.type === 'normal') { ctx.fillStyle = PAL[3]; ctx.fillRect(x, y, PLAT_W, 3); ctx.fillStyle = PAL[1]; ctx.fillRect(x + 1, y + 1, PLAT_W - 2, 1); }
    else if (p.type === 'spiky') { ctx.fillStyle = PAL[3]; ctx.fillRect(x, y + 1, PLAT_W, 2); for (let i = 0; i < PLAT_W; i += 3) { ctx.fillRect(x + i + 1, y - 1, 1, 2); } }
    else if (p.type === 'conveyor') { ctx.fillStyle = PAL[3]; ctx.fillRect(x, y, PLAT_W, 3); ctx.fillStyle = PAL[0];
      for (let i = 0; i < PLAT_W; i += 4) ctx.fillRect(x + ((i + Math.floor(frame / 3) * p.dir) % PLAT_W + PLAT_W) % PLAT_W, y + 1, 2, 1); }
    else if (p.type === 'bouncy') { ctx.fillStyle = PAL[3]; ctx.fillRect(x, y, PLAT_W, 1); ctx.fillStyle = PAL[2];
      for (let i = 1; i < PLAT_W; i += 3) { ctx.fillRect(x + i, y + 1, 1, 1); ctx.fillRect(x + i + 1, y + 2, 1, 1); } ctx.fillStyle = PAL[3]; ctx.fillRect(x, y + 3, PLAT_W, 1); }
    else { ctx.fillStyle = p.brk > 0 && frame % 2 ? PAL[1] : PAL[2]; for (let i = 0; i < PLAT_W; i += 3) ctx.fillRect(x + i, y + (p.brk > 0 ? (i % 2) : 0), 2, 3); }
  }
  if (!(g.inv > 0 && frame % 4 < 2)) spr(chickSprite(g.st, g.on && (g.left || g.right) ? Math.floor(frame / 4) % 2 : 0), g.x, g.y, g.dir > 0);
  if (g.over) { ctx.fillStyle = PAL[3]; ctx.fillRect(18, 34, 60, 22); ctx.fillStyle = PAL[0]; ctx.fillRect(19, 35, 58, 20);
    num(g.floor, 48 - String(g.floor).length * 2, 38); spr('heart', 45, 47); }
}
function endGame() {
  const g = game; g.over = true; g.left = g.right = false;
  const coins = g.floor;
  state.coins = (state.coins || 0) + coins; state.bestFloor = Math.max(state.bestFloor || 0, g.floor);
  state.energy = clamp(state.energy - 15); state.hunger = clamp(state.hunger - 8);
  state.happiness = clamp(state.happiness + 10 + Math.min(15, Math.floor(g.floor / 2)));
  trait('speed', Math.min(2, 0.5 + g.floor * 0.03)); trait('weight', -1); state.counters.plays++;
  updatePersonality(); save(); render();
  $('menu').hidden = false;
  $('menu').innerHTML = `<div class="mt">— 遊戲結束 —</div><div class="wide"><b>下了</b><span>${g.floor} 樓</span></div><div class="wide"><b>獲得</b><span>◎${coins} 金幣</span></div><div class="wide"><b>目前</b><span>◎${state.coins}</span></div><div class="wide"><b>最深</b><span>${state.bestFloor} 樓</span></div><div class="mi back on" id="gameOk">✕ 離開</div>`;
  say(`下了 ${g.floor} 樓，賺到 ◎${coins}！`);
}
function quitGame() {
  if (!game) return;
  if (!game.over) endGame();
  game = null; cv.width = W; cv.height = H; cv.style.width = cv.style.height = ''; $('menu').hidden = true; $('labels').hidden = false; $('gamebar').hidden = true; document.body.classList.remove('playing');
  draw();
}
function gameKey(e, down) {
  const k = e.key;
  if (k === 'ArrowLeft') game.left = down; else if (k === 'ArrowRight') game.right = down;
  else if (down && (k === 'Escape' || (game.over && (k === 'Enter' || k === ' ')))) quitGame();
  else return;
  e.preventDefault();
}
document.addEventListener('keyup', e => { if (game) gameKey(e, false); });
document.querySelectorAll('#gamebar [data-dir]').forEach(b => {
  const d = b.dataset.dir;
  const set = v => e => { e.preventDefault(); if (game && !game.over) game[d] = v; };
  b.addEventListener('pointerdown', set(true)); ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, set(false)));
});
$('quitBtn').addEventListener('click', quitGame);
$('menu').addEventListener('click', () => { if (game && game.over) quitGame(); });


// ===== 清潔動畫 =====
function drawTornado(tx, top, bot) {
  const hgt = bot - top;
  for (let j = 0; j < hgt; j++) {
    const w = Math.max(2, Math.round(16 - j * 14 / hgt)), cx = tx + 8 + Math.round(Math.sin(j / 4 + frame * 0.9) * 2);
    for (let i = 0; i < w; i++) {
      const k = (i + j + frame) % 4; if (k === 3) continue;
      ctx.fillStyle = k === 0 ? PAL[3] : PAL[2]; ctx.fillRect(cx - (w >> 1) + i, top + j, 1, 1);
    }
  }
}
function drawClean(a, pw, ph, baseY) {
  if (a.phase === 'tornado') {
    for (const it of a.items) if (!it.lifted) spr('poop', it.x, it.y);
    drawTornado(a.tx, HUD + 2, GROUND);
    for (const it of a.items) if (it.lifted) { it.ang += 0.7;
      const px = a.tx + 5 + Math.cos(it.ang) * 15, py = HUD + 4 + Math.sin(it.ang) * 5;
      ctx.fillStyle = PAL[0]; ctx.fillRect(px - 1, py - 1, 9, 7); spr('poop', px, py); }
    return;
  }
  const front = a.phase === 'soap' || a.phase === 'rinse' ? -10 + a.t * 12 : W + 20;
  const bubbles = [[1, 3], [pw - 4, 2], [2, ph - 6], [pw - 5, ph - 7], [pw / 2 - 2, -2], [pw / 2, ph / 2 - 2]];
  if (a.phase === 'soap') {
    // 泡泡水浪
    for (let x = 0; x < Math.min(W, front); x++) {
      const crest = GROUND - 2 - (x > front - 6 ? (front - x) : 0) + Math.round(Math.sin((x + frame * 3) / 3));
      ctx.fillStyle = PAL[1]; ctx.fillRect(x, crest, 1, H - crest);
      if ((x + frame) % 7 === 0) spr('bubble', x - 1, crest - 3 - ((x * 3 + frame) % 5));
    }
    if (front > petX + pw / 2) bubbles.forEach(([bx, by], i) => { if ((frame + i) % 6 !== 0) spr('bubble', petX + bx, baseY + by); else { ctx.fillStyle = PAL[2]; ctx.fillRect(petX + bx + 1, baseY + by + 1, 2, 2); } });
  } else if (a.phase === 'rinse') {
    for (let x = 0; x < Math.min(W, front); x++) {
      const crest = GROUND - 7 + Math.round(Math.sin((x + frame * 4) / 2.5));
      ctx.fillStyle = (x + frame) % 3 ? PAL[2] : PAL[1]; ctx.fillRect(x, crest, 1, 1);
      ctx.fillStyle = PAL[1]; for (let y = crest + 2; y < H; y += 2) if ((x + y + frame) % 4 === 0) ctx.fillRect(x, y, 1, 1);
    }
    if (front <= petX + pw / 2) bubbles.forEach(([bx, by]) => spr('bubble', petX + bx, baseY + by));
    else bubbles.slice(0, Math.max(0, 6 - Math.floor((front - petX) / 6))).forEach(([bx, by]) => spr('bubble', petX + bx, baseY + by - 3));
  } else if (a.phase === 'shake') {
    for (let k = 0; k < 4; k++) { const d = (a.t + k * 2) % 6; ctx.fillStyle = PAL[2]; ctx.fillRect(petX + (k % 2 ? pw + d : -d - 1), baseY + 3 + k * 3, 1, 1); }
    spr('sparkle', petX + pw - 1, baseY - 6 + (a.t % 2)); if (a.t > 3) spr('sparkle', petX - 5, baseY - 2);
  }
}
// ===== 繪圖 =====
function chickSprite(st, alt) { return st === 'chick' ? (alt ? 'chick2' : 'chick') : (alt ? 'adult2' : 'adult'); }
function draw() {
  if (!state) return;
  frame++;
  const f = Math.floor(frame / 4) % 2, st = stage();
  ctx.fillStyle = state.sleeping ? PAL[2] : PAL[0]; ctx.fillRect(0, 0, W, H);
  // 狀態列
  ['i_hunger', 'i_happy', 'i_energy', 'i_clean', 'i_health'].forEach((ic, i) => bar(1 + i * 24, 1, ic, state[['hunger', 'happiness', 'energy', 'cleanliness', 'health'][i]]));
  ctx.fillStyle = PAL[3]; ctx.fillRect(0, HUD - 1, W, 1);
  // 地面
  ctx.fillStyle = PAL[1]; ctx.fillRect(0, GROUND, W, 1);
  for (let i = 0; i < W; i += 6) ctx.fillRect(i, GROUND + 2 + (i / 6 % 2), 2, 1);
  if (state.dead) { spr('ghost', W / 2 - 5, HUD + 26 + (f ? 0 : 2)); spr('skull', W / 2 - 2, GROUND - 6); }
  else if (st === 'egg') spr(f ? 'egg2' : 'egg', W / 2 - 6 + (f ? 1 : -1), GROUND - 12);
  else {
    const pw = sw(chickSprite(st)), ph = S[chickSprite(st)].length, baseY = GROUND - ph;
    let alt = f, py = baseY, flip = petDir > 0; // 精靈預設面向左，翻轉 = 面向右
    if (anim && anim.type === 'eat') {
      const a = anim; a.t++;
      if (a.phase === 'drop') { a.fy += 1 + a.t * 0.15; const land = GROUND - S[a.food.sprite].length; if (a.fy >= land) { a.fy = land; a.phase = 'walk'; a.t = 0; } }
      else if (a.phase === 'walk') {
        if (a.target === undefined) {
          const fw = sw(a.food.sprite), L = a.fx - pw + 2, R = a.fx + fw - 2;
          let left = petX + pw / 2 <= a.fx + fw / 2;
          if (left && L < 0) left = false; if (!left && R > W - pw) left = true;
          a.target = left ? L : R; a.faceRight = left;
        }
        if (Math.abs(petX - a.target) <= 1) { petX = a.target; a.phase = 'peck'; a.t = 0; petDir = a.faceRight ? 1 : -1; }
        else { petDir = a.target > petX ? 1 : -1; petX += petDir; }
        flip = petDir > 0; alt = Math.floor(a.t / 2) % 2;
      } else if (a.phase === 'peck') {
        flip = a.faceRight; petDir = flip ? 1 : -1;
        const cyc = Math.floor(a.t / 3) % 2; py = baseY + (cyc ? 2 : 0); alt = cyc;
        if (a.t % 6 === 5) a.bite++;
        if (a.bite >= 4) { a.phase = 'hearts'; a.t = 0; finishEat(a.food); }
      } else if (a.phase === 'hearts' && a.t > 24) anim = null;
      if (anim && a.phase !== 'hearts') {
        const fwid = sw(a.food.sprite);
        spr(a.food.sprite, a.fx, a.fy, false, Math.ceil(fwid * a.bite / 4));
      }
      if (anim && a.phase === 'hearts') for (let k = 0; k < 3; k++) {
        const hy = GROUND - ph - 4 - a.t * 0.8 - k * 6; if (hy > HUD + 1) spr('heart', petX + pw / 2 - 2 + (k - 1) * 6 + (Math.floor((a.t + k * 3) / 4) % 2), hy);
      }
    } else if (anim && anim.type === 'clean') {
      const a = anim; a.t++;
      if (a.phase === 'tornado') { a.tx += 5; py = baseY; alt = f; if (Math.abs(a.tx + 7 - (petX + pw / 2)) < 14) petX += (a.t % 2 ? 1 : -1);
        for (const it of a.items) if (!it.lifted && a.tx + 12 >= it.x) it.lifted = true;
        if (a.tx > W + 4) { a.phase = 'soap'; a.t = 0; say('泡泡水沖過來～'); } }
      else if (a.phase === 'soap') { if (a.t > 11) { a.phase = 'rinse'; a.t = 0; say('清水沖乾淨！'); } }
      else if (a.phase === 'rinse') { if (a.t > 11) { a.phase = 'shake'; a.t = 0; } }
      else if (a.phase === 'shake') { petX += a.t % 2 ? 2 : -2; flip = a.t % 4 < 2; if (a.t > 8) { anim = null;
        state.cleanliness = 100; state.poop = 0; state.counters.cleans++; updatePersonality(); save(); render(); say('洗香香，好舒服～'); } }
    } else if (!state.sleeping && !menu) {
      if (frame % 3 === 0) { petX += petDir; if (petX < 8 || petX > W - pw - 22 || Math.random() < 0.02) petDir *= -1; petX = Math.max(8, Math.min(W - pw - 22, petX)); }
    }
    if (happyT > 0) { py += happyT % 4 < 2 ? -6 : 0; happyT--; }
    spr(state.sleeping ? chickSprite(st, 1) : chickSprite(st, alt), petX, py, flip && !state.sleeping);
    if (state.sleeping) { spr('z', petX + pw + 2, baseY - 6 - f * 3); spr('z', petX + pw + 8, baseY - 14 - f * 3); }
    if (state.sick) spr('skull', petX - 7, baseY - 6 + f);
    if (!(anim && anim.type === 'clean')) for (let i = 0; i < state.poop; i++) spr('poop', W - 9 - i * 7, GROUND - 5 - (i % 2) * 3);
    if (anim && anim.type === 'clean') drawClean(anim, pw, ph, baseY);
    if (fxT > 0 && fxKind) { spr(fxKind, petX + pw / 2 - 3, baseY - 8 - (6 - fxT) * 2); if (frame % 3 === 0) fxT--; }
  }
  const ls = $('labels').children;
  for (let i = 0; i < 6; i++) { const on = i === sel && !state.dead; if (ls[i].classList.contains('on') !== on) { ls[i].classList.toggle('on', on); drawIcon(i); } }
  const sl = state.sleeping ? '起床' : '睡覺', sp = ls[2].querySelector('span'); if (sp.textContent !== sl) sp.textContent = sl;
}
function drawIcon(i) {
  const cell = $('labels').children[i], c = cell.querySelector('canvas'), g = c.getContext('2d'), on = cell.classList.contains('on');
  g.clearRect(0, 0, 13, 11); const iw = sw(ICONS[i].icon), ih = S[ICONS[i].icon].length, ox = Math.floor((13 - iw) / 2), oy = Math.floor((11 - ih) / 2);
  S[ICONS[i].icon].forEach((r, j) => [...r].forEach((ch, k) => { if (ch === '.') return;
    g.fillStyle = on ? (ch === '3' ? PAL[0] : PAL[1]) : PAL[+ch]; g.fillRect(ox + k, oy + j, 1, 1); }));
}
for (let i = 0; i < 6; i++) drawIcon(i);
let sub = 0;
setInterval(() => { if (game) gameStep(); else if (++sub % 3 === 0) draw(); }, 33);

// ===== 彩色像素蛋殼 =====
function drawShell() {
  const c = $('shell'), W = 40, H = 56; c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cols = ['#ff5c8a', '#ffd23f', '#3ec6ff', '#7ee07e', '#b48cff', '#ff9f43'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + .5 - W / 2) / (W / 2), ny = (y + .5 - H * .54) / (H * .46);
    const r = nx * nx / (ny < 0 ? 0.62 : 1) + ny * ny;
    const r2 = nx * nx + ny * ny * (ny < 0 ? 1 : 1);
    if (ny < 0 ? nx * nx / (1 + ny * 0.08) ** 2 + ny * ny > 1 : nx * nx + ny * ny > 1) continue;
    const e = ny < 0 ? nx * nx / (1 + ny * 0.08) ** 2 + ny * ny : nx * nx + ny * ny;
    let col;
    if (e > 0.88) col = '#1a1030';
    else if (e > 0.78) col = '#ff3d7f';
    else {
      const d = ((x >> 2) + (y >> 2)) % 2 === 0 && x % 4 < 3 && y % 4 < 3;
      col = d ? cols[((x >> 2) * 3 + (y >> 2)) % cols.length] : '#fff4d6';
    }
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = '#ffffff'; [[11, 8], [12, 8], [10, 9], [10, 10]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
}
drawShell();

function render() {
  const st = stage();
  $('petName').textContent = state.name;
  $('stage').textContent = state.dead ? '天堂' : { egg: '蛋', chick: '小雞', adult: '大雞' }[st];
  const a = Math.floor(ageMin());
  $('coins').textContent = '◎' + (state.coins || 0);
  $('age').textContent = a < 60 ? a + '分' : a < 1440 ? Math.floor(a / 60) + '時' : Math.floor(a / 1440) + '天';
  if (state.dead) say(`${state.name} 去當小天使了…點畫面重新開始。`);
  else if (st === 'egg') say('蛋蛋正在孵化中…再等一下下！');
  if (menu === 'status') renderMenu();
}

function askName() { $('nameInput').value = ''; $('nameDialog').showModal(); }
function restart() { localStorage.removeItem(KEY); anim = null; closeMenu(); askName(); }
$('nameForm').addEventListener('submit', () => {
  state = newState($('nameInput').value.trim() || '小黃'); petX = 42; save(); render(); say(`${state.name} 的蛋來了！`);
});

try { state = migrate(JSON.parse(localStorage.getItem(KEY))); } catch { state = null; }
if (state) {
  const away = (Date.now() - state.last) / MIN;
  tick();
  if (!state.dead && away > 5) say(`歡迎回來！你離開了 ${Math.round(away)} 分鐘。`);
} else askName();
setInterval(tick, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

// 下樓梯：滑鼠左鍵按住往左、右鍵按住往右
const scrEl = document.querySelector('.scr');
scrEl.addEventListener('pointerdown', e => {
  if (!game || game.over || e.pointerType !== 'mouse') return;
  if (e.button === 0) game.left = true; else if (e.button === 2) game.right = true; else return;
  e.preventDefault();
});
window.addEventListener('pointerup', e => {
  if (!game || e.pointerType !== 'mouse') return;
  if (e.button === 0) game.left = false; else if (e.button === 2) game.right = false;
});
scrEl.addEventListener('contextmenu', e => { if (game) e.preventDefault(); });
window.addEventListener('blur', () => { if (game) game.left = game.right = false; });
