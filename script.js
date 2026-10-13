'use strict';
const KEY = 'chickBabyState';
const MIN = 60000;
// 每分鐘衰減量
const DECAY = { hunger: 0.8, happiness: 0.6, energy: 0.5, cleanliness: 0.4 };
const STAGES = { eggUntil: 2, chickUntil: 60 }; // 分鐘
const STATS = ['hunger', 'happiness', 'energy', 'cleanliness', 'health'];
const $ = id => document.getElementById(id);
let state = null;

function newState(name) {
  return { name, born: Date.now(), last: Date.now(), hunger: 80, happiness: 80, energy: 80,
    cleanliness: 100, health: 100, sick: false, sleeping: false, dead: false, poop: 0 };
}
const clamp = v => Math.max(0, Math.min(100, v));
const ageMin = () => ((state.dead ? state.last : Date.now()) - state.born) / MIN;
function stage() {
  const a = ageMin();
  return a < STAGES.eggUntil ? 'egg' : a < STAGES.chickUntil ? 'chick' : 'adult';
}

// 以每分鐘為步長模擬（含離線時間）
function simulate(minutes) {
  while (minutes > 0 && !state.dead) {
    const m = Math.min(1, minutes); minutes -= m;
    if (stage() === 'egg' && (Date.now() - state.born) / MIN < STAGES.eggUntil) continue;
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
  const mins = (now - state.last) / MIN;
  if (!state.dead) { simulate(mins); state.last = now; }
  save(); render();
}

function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

function say(t) { $('msg').textContent = t; }
let fxT = 0, fxKind = null, frame = 0, happyT = 0;
function fx(e) { fxKind = { '🍗': 'food', '🎾': 'ball', '🫧': 'bubble', '💉': 'syringe' }[e]; fxT = 6; }

// ===== 像素精靈 (0=最亮 1 2 3=最暗) =====
const PAL = ['#9bbc0f', '#8bac0f', '#306230', '#0f380f'];
const S = {
  egg: ['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','311211111113','311111112113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  egg2:['....3333....','..33111133..','.3111111113.','.3112111213.','311111111113','3113.3.31113','3111.3.11113','311111111113','.3111211113.','.3111111113.','..33111133..','....3333....'],
  chick: ['....3333....','...311113...','..31111113..','.3113113113.','.3111221113.','.3111331113.','311111111113','312111111213','312211112213','311111111113','.3111111113.','..33333333..','...3....3...','..33....33..'],
  chick2:['............','....3333....','...311113...','..31111113..','.3113113113.','.3111221113.','311111331113','321111111123','322111111223','311111111113','.3111111113.','..33333333..','...3....3...','..33....33..'],
  adult: ['.....3.3........','....32323.......','...3333333......','..31111111333...','.311311111113...','.31111111111133.','322111111111113','.3311111111111113','..3111112221113.','..31112222211113','..3111111111113.','...311111111113.','....3333333333..','......3...3.....','.....33..33.....'],
  adult2:['................','.....3.3........','....32323.......','...3333333......','..31111111333...','.311311111113...','.31111111111133.','3221111111111113','.3311111111111113','..311112222211113','..3111111111113.','...311111111113.','....3333333333..','......3...3.....','.....33..33.....'],
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
  i_health: ['3.3.','3333','3333','.33.']
};
const cv = $('screen'), ctx = cv.getContext('2d');
function spr(name, x, y, flip) {
  const rows = S[name];
  rows.forEach((r, j) => [...r].forEach((c, i) => {
    if (c === '.') return; ctx.fillStyle = PAL[+c];
    ctx.fillRect(Math.round(x + (flip ? r.length - 1 - i : i)), Math.round(y + j), 1, 1);
  }));
}
function bar(x, y, icon, v) {
  spr(icon, x, y); ctx.fillStyle = PAL[3]; ctx.fillRect(x + 6, y, 11, 5);
  ctx.fillStyle = PAL[0]; ctx.fillRect(x + 7, y + 1, 9, 3);
  ctx.fillStyle = PAL[2]; ctx.fillRect(x + 7, y + 1, Math.round(9 * v / 100), 3);
}
function draw() {
  if (!state) return;
  frame++;
  const f = Math.floor(frame / 4) % 2, st = stage();
  ctx.fillStyle = state.sleeping ? PAL[2] : PAL[0]; ctx.fillRect(0, 0, 96, 80);
  ctx.fillStyle = PAL[1]; ctx.fillRect(0, 58, 96, 1);
  for (let i = 0; i < 96; i += 6) ctx.fillRect(i, 60 + (i / 6 % 2), 2, 1);
  if (state.dead) {
    spr('ghost', 43, 18 + (f ? 0 : 2)); spr('skull', 46, 50);
  } else {
    const walk = state.sleeping ? 0 : Math.round(Math.sin(frame / 12) * 10);
    let jump = happyT > 0 ? (happyT % 4 < 2 ? -6 : 0) : 0; if (happyT > 0) happyT--;
    if (st === 'egg') spr(f ? 'egg2' : 'egg', 42 + (f ? 1 : -1), 46);
    else if (st === 'chick') spr(state.sleeping ? 'chick2' : (f ? 'chick2' : 'chick'), 42 + walk, 44 + jump, walk < 0 && !state.sleeping);
    else spr(state.sleeping ? 'adult2' : (f ? 'adult2' : 'adult'), 40 + walk, 43 + jump, walk < 0 && !state.sleeping);
    if (state.sleeping) { spr('z', 66, 30 - f * 3); spr('z', 72, 22 - f * 3); }
    if (state.sick) { spr('skull', 22, 34 + f); }
    for (let i = 0; i < state.poop; i++) spr('poop', 74 + i * 7 - (i % 2) * 2, 53 - (i % 2) * 3);
    if (fxT > 0 && fxKind) { spr(fxKind, 46, 30 - (6 - fxT) * 2); if (frame % 3 === 0) fxT--; }
  }
  ctx.fillStyle = PAL[3]; ctx.fillRect(0, 63, 96, 1);
  bar(2, 66, 'i_hunger', state.hunger); bar(21, 66, 'i_happy', state.happiness); bar(40, 66, 'i_energy', state.energy);
  bar(59, 66, 'i_clean', state.cleanliness); bar(77, 66, 'i_health', state.health);
  ctx.fillStyle = PAL[1]; ctx.fillRect(0, 73, 96, 7);
  spr('heart', 2, 74); ctx.fillStyle = PAL[3];
  for (let i = 0; i < 10; i++) if (i < Math.round(state.health / 10)) ctx.fillRect(9 + i * 4, 75, 3, 3);
  if (state.sick) spr('skull', 89, 74);
}
setInterval(draw, 125);

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
  $('sleepBtn').textContent = state.sleeping ? '起床' : '睡覺';
  document.querySelectorAll('.actions button').forEach(b => b.disabled = state.dead || st === 'egg');
  $('restart').classList.toggle('show', state.dead);
  if (state.dead) say(`${state.name} 去當小天使了…按「重新開始」再養一隻吧。`);
  else if (st === 'egg') say('蛋蛋正在孵化中…再等一下下！');
}

const ACTIONS = {
  feed() { if (state.hunger > 95) return say('吃不下了啦～'); state.hunger = clamp(state.hunger + 25); state.cleanliness = clamp(state.cleanliness - 5);
    if (Math.random() < 0.3) state.poop = Math.min(3, state.poop + 1); fx('🍗'); say('好吃！啾啾～'); },
  play() { if (state.energy < 15) return say('太累了，想睡覺…'); state.happiness = clamp(state.happiness + 20);
    state.energy = clamp(state.energy - 15); state.hunger = clamp(state.hunger - 8); fx('🎾'); say('好好玩！'); happyT = 12; },
  sleep() { state.sleeping = !state.sleeping; say(state.sleeping ? '晚安～ 💤' : '早安！'); },
  clean() { state.cleanliness = 100; state.poop = 0; fx('🫧'); say('洗香香，好舒服～'); },
  doctor() { if (!state.sick && state.health > 90) return say('很健康，不用看醫生喔！');
    state.sick = false; state.health = clamp(state.health + 30); state.happiness = clamp(state.happiness - 10); fx('💉'); say('打針好痛…但病好了！'); }
};

document.querySelectorAll('.actions button').forEach(b => b.addEventListener('click', () => {
  tick(); if (state.dead) return;
  const act = b.dataset.act;
  if (state.sleeping && act !== 'sleep') return say('噓…牠在睡覺，先叫醒牠吧。');
  ACTIONS[act](); save(); render();
}));

function askName() { $('nameInput').value = ''; $('nameDialog').showModal(); }
$('nameForm').addEventListener('submit', () => {
  state = newState($('nameInput').value.trim() || '小黃'); save(); render(); say(`${state.name} 的蛋來了！`);
});
$('restart').addEventListener('click', () => { localStorage.removeItem(KEY); askName(); });

try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
if (state && state.born) {
  const away = (Date.now() - state.last) / MIN;
  tick();
  if (!state.dead && away > 5) say(`歡迎回來！你離開了 ${Math.round(away)} 分鐘。`);
} else askName();
setInterval(tick, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
