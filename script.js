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
function fx(e) { const f = $('fx'); f.textContent = e; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); }

function render() {
  const st = stage();
  const pet = $('pet');
  pet.className = 'pet stage-' + st + (state.sleeping ? ' sleeping' : '') + (state.sick ? ' sick' : '') + (state.dead ? ' dead' : '');
  $('petName').textContent = state.name;
  $('stage').textContent = state.dead ? '天堂' : { egg: '蛋', chick: '小雞', adult: '大雞' }[st];
  const a = Math.floor(ageMin());
  $('age').textContent = a < 60 ? a + ' 分鐘' : a < 1440 ? Math.floor(a / 60) + ' 小時' : Math.floor(a / 1440) + ' 天';
  STATS.forEach(s => $('s-' + s).value = state[s]);
  $('screen').classList.toggle('night', state.sleeping);
  $('zzz').style.display = state.sleeping && !state.dead ? 'block' : 'none';
  $('sickIcon').style.display = state.sick && !state.dead ? 'block' : 'none';
  $('poop').textContent = state.dead ? '' : '💩'.repeat(state.poop);
  $('sleepBtn').textContent = state.sleeping ? '☀️ 起床' : '😴 睡覺';
  document.querySelectorAll('.actions button').forEach(b => b.disabled = state.dead || st === 'egg');
  $('restart').classList.toggle('show', state.dead);
  if (state.dead) say(`${state.name} 去當小天使了…😢 按「重新開始」再養一隻吧。`);
  else if (st === 'egg') say('蛋蛋正在孵化中…再等一下下！');
}

const ACTIONS = {
  feed() { if (state.hunger > 95) return say('吃不下了啦～'); state.hunger = clamp(state.hunger + 25); state.cleanliness = clamp(state.cleanliness - 5);
    if (Math.random() < 0.3) state.poop = Math.min(3, state.poop + 1); fx('🍗'); say('好吃！啾啾～'); },
  play() { if (state.energy < 15) return say('太累了，想睡覺…'); state.happiness = clamp(state.happiness + 20);
    state.energy = clamp(state.energy - 15); state.hunger = clamp(state.hunger - 8); fx('🎾'); say('好好玩！'); $('pet').classList.add('happy'); },
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
  setTimeout(() => $('pet').classList.remove('happy'), 1300);
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
