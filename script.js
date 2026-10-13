'use strict';
// ===== 資料結構（schema v2，可直接同步至 Firestore 文件）=====
const KEY = 'chickBabyState';
const SCHEMA = 2;
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
  { id: 'rice', name: '米粒', stage: 'chick', sprite: 'rice', hunger: 20, happiness: 2, health: 1, weight: 1, strength: 0, speed: 0, stamina: 1 },
  { id: 'worm', name: '蟲蟲', stage: 'chick', sprite: 'worm', hunger: 15, happiness: 6, health: 2, weight: 1, strength: 2, speed: 0.5, stamina: 0 },
  { id: 'candy', name: '糖果', stage: 'chick', sprite: 'candy', snack: true, hunger: 5, happiness: 15, health: -3, weight: 2, strength: 0, speed: 0, stamina: 0 },
  { id: 'corn', name: '玉米', stage: 'adult', sprite: 'corn', hunger: 30, happiness: 4, health: 2, weight: 2, strength: 1, speed: 1, stamina: 2 },
  { id: 'cake', name: '蛋糕', stage: 'adult', sprite: 'cake', snack: true, hunger: 10, happiness: 25, health: -5, weight: 4, strength: 0, speed: -0.5, stamina: 0 }
];
const unlocked = f => f.stage === 'chick' || stage() === 'adult';

const PAL = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'];
const S = {
  egg: ['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','311211111113','311111112113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  egg2:['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','3113.3.31113','3111.3.11113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  chick: ['....3333....','...311113...','..31111113..','.3113113113.','.3111221113.','.3111331113.','311111111113','312111111213','312211112213','311111111113','.3111111113.','..33333333..','...3....3...','..33....33..'],
  chick2:['............','....3333....','...311113...','..31111113..','.3113113113.','.3111221113.','311111331113','321111111123','322111111223','311111111113','.3111111113.','..33333333..','...3....3...','..33....33..'],
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
  i_hunger: ['.33.','3223','3223','.33.','3...'],
  i_happy: ['.333.','3.3.3','33333','3...3','.333.'],
  i_energy: ['..33','.33.','3333','.33.','33..'],
  i_clean: ['..3..','.323.','32223','32223','.333.'],
  i_feed: ['....33...','...3223..','..32223..','..32223..','...333...','..3......','.3.......','3........'],
  i_play: ['..33333..','.3211123.','321111123','311222113','311222113','321111123','.3211123.','..33333..'],
  i_sleep: ['...3333..','..33.....','.33......','.33......','.33......','.33......','..33.....','...3333..'],
  i_wash: ['....3....','...323...','..32223..','.3222223.','.3222223.','.3221223.','..32223..','...333...'],
  i_doc: ['...333...','...323...','.3333333.','.3222223.','.3333333.','...323...','...333...','.........'],
  i_stat: ['.......3.','.......3.','....3..3.','....3..3.','.3..3..3.','.3..3..3.','.3..3..3.','333333333'],
  rice: ['.3.3.','3.3.3','.3.3.'],
  worm: ['.33....','3223.33','3..3223','....33.'],
  corn: ['..33..','.3223.','.3223.','.3223.','.3223.','..33..','.3..3.'],
  cake: ['..3...','.333..','322223','311113','322223','333333'],
  candy: ['3.333.3','.32223.','3.333.3'],
  i_health: ['3.3.','3333','3333','.33.']
};

const cv = $('screen'), ctx = cv.getContext('2d');
const W = 96, H = 96, GROUND = 60, ICON_Y = 78;
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
function bar(x, y, icon, v) {
  spr(icon, x, y); ctx.fillStyle = PAL[3]; ctx.fillRect(x + 6, y, 11, 5);
  ctx.fillStyle = PAL[0]; ctx.fillRect(x + 7, y + 1, 9, 3);
  ctx.fillStyle = PAL[2]; ctx.fillRect(x + 7, y + 1, Math.round(9 * v / 100), 3);
}

// ===== 選單 / 輸入 =====
const ICONS = [
  { act: 'feed', icon: 'i_feed', label: '餵食' }, { act: 'play', icon: 'i_play', label: '玩耍' },
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
    el.innerHTML = '<div class="mt">— 餵食 —</div>' + FOODS.map((f, i) =>
      `<div class="mi${i === menuSel ? ' on' : ''}" data-i="${i}">${i === menuSel ? '▶' : '　'}${unlocked(f) ? f.name + (f.snack ? '<small>點心</small>' : '') : '???'}</div>`).join('') +
      '<div class="mi back" data-i="-1">✕ 返回</div>';
  } else if (menu === 'status') {
    const t = state.traits, born = new Date(state.born);
    el.innerHTML = `<div class="mt">— 狀態 —</div><table>
      <tr><td>名字</td><td>${esc(state.name)}</td></tr><tr><td>性格</td><td>${t.personality}</td></tr>
      <tr><td>力量</td><td>${t.strength}</td></tr><tr><td>速度</td><td>${t.speed}</td></tr>
      <tr><td>體力</td><td>${t.stamina}</td></tr><tr><td>體重</td><td>${t.weight}g</td></tr>
      <tr><td>出生</td><td>${born.getMonth() + 1}/${born.getDate()} ${String(born.getHours()).padStart(2, '0')}:${String(born.getMinutes()).padStart(2, '0')}</td></tr>
      <tr><td>ID</td><td class="id">${state.id.slice(0, 8)}</td></tr></table><div class="mi back on" data-i="-1">✕ 返回</div>`;
  }
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('menu').addEventListener('click', e => {
  const it = e.target.closest('.mi'); if (!it) return;
  const i = +it.dataset.i; if (i < 0) return closeMenu();
  menuSel = i; chooseFood(FOODS[i]);
});
function chooseFood(f) {
  if (!unlocked(f)) return say('還沒解鎖，長大一點再說！');
  if (state.hunger > 95) { closeMenu(); return say('吃不下了啦～'); }
  closeMenu();
  anim = { type: 'eat', food: f, phase: 'drop', fx: Math.max(14, Math.min(78, petX + (petX > 48 ? -20 : 24))), fy: -8, t: 0, bite: 0 };
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
  play() { if (state.energy < 15) return say('太累了，想睡覺…'); state.happiness = clamp(state.happiness + 20);
    state.energy = clamp(state.energy - 15); state.hunger = clamp(state.hunger - 8);
    trait('speed', 1); trait('stamina', 0.5); trait('weight', -1); state.counters.plays++; fx('ball'); happyT = 12; say('好好玩！'); },
  sleep() { state.sleeping = !state.sleeping; if (state.sleeping) { state.counters.sleeps++; trait('stamina', 0.5); } say(state.sleeping ? '晚安～' : '早安！'); },
  clean() { state.cleanliness = 100; state.poop = 0; state.counters.cleans++; fx('bubble'); say('洗香香，好舒服～'); },
  doctor() { if (!state.sick && state.health > 90) return say('很健康，不用看醫生喔！');
    state.sick = false; state.health = clamp(state.health + 30); state.happiness = clamp(state.happiness - 10); state.counters.doctor++; fx('syringe'); say('打針好痛…但病好了！'); },
  status() { openMenu('status'); }
};
function activate(i) {
  tick();
  if (state.dead) return restart();
  sel = i; const act = ICONS[i].act;
  if (act === 'status') return ACTIONS.status();
  if (stage() === 'egg') return say('蛋蛋還在孵化中…');
  if (anim) return say('正在吃東西，等一下～');
  if (state.sleeping && act !== 'sleep') return say('噓…牠在睡覺，先叫醒牠吧。');
  ACTIONS[act](); if (act !== 'feed') { updatePersonality(); save(); render(); }
}
cv.addEventListener('click', e => {
  if (!state) return;
  const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
  if (state.dead) return restart();
  if (menu) return;
  if (y >= ICON_Y - 2) activate(Math.min(5, Math.floor(x / 16)));
});
document.addEventListener('keydown', e => {
  if (!state || $('nameDialog').open) return;
  const k = e.key;
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

// ===== 繪圖 =====
function chickSprite(st, alt) { return st === 'chick' ? (alt ? 'chick2' : 'chick') : (alt ? 'adult2' : 'adult'); }
function draw() {
  if (!state) return;
  frame++;
  const f = Math.floor(frame / 4) % 2, st = stage();
  ctx.fillStyle = state.sleeping ? PAL[2] : PAL[0]; ctx.fillRect(0, 0, W, H);
  // 狀態列
  bar(2, 2, 'i_hunger', state.hunger); bar(21, 2, 'i_happy', state.happiness); bar(40, 2, 'i_energy', state.energy);
  bar(59, 2, 'i_clean', state.cleanliness); bar(77, 2, 'i_health', state.health);
  ctx.fillStyle = PAL[3]; ctx.fillRect(0, 9, W, 1);
  // 地面
  ctx.fillStyle = PAL[1]; ctx.fillRect(0, GROUND, W, 1);
  for (let i = 0; i < W; i += 6) ctx.fillRect(i, GROUND + 2 + (i / 6 % 2), 2, 1);
  if (state.dead) { spr('ghost', 43, 22 + (f ? 0 : 2)); spr('skull', 46, GROUND - 6); }
  else if (st === 'egg') spr(f ? 'egg2' : 'egg', 42 + (f ? 1 : -1), GROUND - 12);
  else {
    const pw = sw(chickSprite(st)), ph = S[chickSprite(st)].length, baseY = GROUND - ph;
    let alt = f, py = baseY, flip = petDir < 0;
    if (anim && anim.type === 'eat') {
      const a = anim; a.t++;
      if (a.phase === 'drop') { a.fy += 1 + a.t * 0.15; const land = GROUND - S[a.food.sprite].length; if (a.fy >= land) { a.fy = land; a.phase = 'walk'; a.t = 0; } }
      else if (a.phase === 'walk') {
        const target = a.fx > petX ? a.fx - pw + 1 : a.fx + sw(a.food.sprite) - 1;
        if (Math.abs(petX - target) <= 1) { petX = target; a.phase = 'peck'; a.t = 0; }
        else { petDir = target > petX ? 1 : -1; petX += petDir; }
        flip = petDir < 0; alt = Math.floor(a.t / 2) % 2;
      } else if (a.phase === 'peck') {
        flip = a.fx < petX; petDir = flip ? -1 : 1;
        const cyc = Math.floor(a.t / 3) % 2; py = baseY + (cyc ? 2 : 0); alt = cyc;
        if (a.t % 6 === 5) a.bite++;
        if (a.bite >= 4) { a.phase = 'hearts'; a.t = 0; finishEat(a.food); }
      } else if (a.phase === 'hearts' && a.t > 24) anim = null;
      if (anim && a.phase !== 'hearts') {
        const fwid = sw(a.food.sprite);
        spr(a.food.sprite, a.fx, a.fy, false, Math.ceil(fwid * a.bite / 4));
      }
      if (anim && a.phase === 'hearts') for (let k = 0; k < 3; k++) {
        const hy = GROUND - ph - 4 - a.t * 0.8 - k * 6; if (hy > 10) spr('heart', petX + pw / 2 - 2 + (k - 1) * 6 + (Math.floor((a.t + k * 3) / 4) % 2), hy);
      }
    } else if (!state.sleeping && !menu) {
      if (frame % 3 === 0) { petX += petDir; if (petX < 8 || petX > W - pw - 22 || Math.random() < 0.02) petDir *= -1; petX = Math.max(8, Math.min(W - pw - 22, petX)); }
    }
    if (happyT > 0) { py += happyT % 4 < 2 ? -6 : 0; happyT--; }
    spr(state.sleeping ? chickSprite(st, 1) : chickSprite(st, alt), petX, py, flip && !state.sleeping);
    if (state.sleeping) { spr('z', petX + pw + 2, baseY - 6 - f * 3); spr('z', petX + pw + 8, baseY - 14 - f * 3); }
    if (state.sick) spr('skull', petX - 7, baseY - 6 + f);
    for (let i = 0; i < state.poop; i++) spr('poop', W - 9 - i * 7, GROUND - 5 - (i % 2) * 3);
    if (fxT > 0 && fxKind) { spr(fxKind, petX + pw / 2 - 3, baseY - 8 - (6 - fxT) * 2); if (frame % 3 === 0) fxT--; }
  }
  // 圖示列
  ctx.fillStyle = PAL[3]; ctx.fillRect(0, ICON_Y - 3, W, 1);
  ICONS.forEach((ic, i) => {
    const x = i * 16;
    if (i === sel && !state.dead) { ctx.fillStyle = PAL[3]; ctx.fillRect(x + 1, ICON_Y - 1, 14, 14);
      ctx.fillStyle = PAL[0]; ctx.fillRect(x + 2, ICON_Y, 12, 12); ctx.fillStyle = PAL[3]; ctx.fillRect(x + 3, ICON_Y + 1, 10, 10); }
    S[ic.icon].forEach((r, j) => [...r].forEach((c, k) => { if (c === '.') return;
      ctx.fillStyle = i === sel && !state.dead ? (c === '3' ? PAL[0] : PAL[1]) : PAL[+c];
      ctx.fillRect(x + 4 + k, ICON_Y + 2 + j, 1, 1); }));
  });
  const lbl = $('sel'); const t = state.dead ? '點畫面重新開始' : ICONS[sel].label + (ICONS[sel].act === 'sleep' && state.sleeping ? '(起床)' : '');
  if (lbl.textContent !== t) lbl.textContent = t;
}
setInterval(draw, 100);

// ===== 彩色像素蛋殼 =====
function drawShell() {
  const c = $('shell'), W = 40, H = 54; c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cols = ['#ff5c8a', '#ffd23f', '#3ec6ff', '#7ee07e', '#b48cff', '#ff9f43'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + .5 - W / 2) / (W / 2), ny = (y + .5 - H * .54) / (H * .46);
    const r = nx * nx / (ny < 0 ? 0.62 : 1) + ny * ny;
    const r2 = nx * nx + ny * ny * (ny < 0 ? 1 : 1);
    if (ny < 0 ? nx * nx / (1 + ny * 0.2) ** 2 + ny * ny > 1 : nx * nx + ny * ny > 1) continue;
    const e = ny < 0 ? nx * nx / (1 + ny * 0.2) ** 2 + ny * ny : nx * nx + ny * ny;
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
window.__chick = { get state() { return state; }, chooseFood, FOODS, get anim() { return anim; } };
