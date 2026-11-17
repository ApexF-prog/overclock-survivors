/* boss_balance.js — v5 首领强度回归测试
 * 运行：node tests/boss_balance.js
 * 验证三件事：
 *   1) 首领血量随层数指数成长（×1.32/层），且会被玩家实测 DPS 追平；
 *   2) 「单次受伤 3.5% 上限」不再等于「打 29 下必死」——按秒限伤后交战时长落在目标区间；
 *   3) 高等级（全强化满级）也有海克斯可选，不再出现三张「紧急修复」。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'core.js', 'audio.js', 'fx.js', 'entities.js', 'content.js',
  'game.js', 'visuals.js', 'systems.js', 'augments.js'
];

function mockContext() {
  const grad = { addColorStop() {} };
  const base = {
    canvas: { width: 1280, height: 720 },
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: () => ({ width: 10 })
  };
  return new Proxy(base, {
    get(t, k) { return k in t ? t[k] : function () {}; },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const ctx = mockContext();
const canvas = { width: 1280, height: 720, style: {}, getContext: () => ctx };

const store = {};
const sandbox = {
  console, Math, Date, JSON, Map, Set, Object, Array, Number, String, Boolean,
  Error, isNaN, parseInt, parseFloat, setTimeout, clearTimeout, setInterval, clearInterval,
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
  navigator: { maxTouchPoints: 0 },
  localStorage: {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  },
  performance: { now: () => Date.now() }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), context, { filename: f });
}

const NS = sandbox.NS;
const HEX = NS.HEX;
const C = NS.CONTENT;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '                ' + detail : ''));
  if (!ok) failures++;
}

/* 全强化点满（模拟用户 LV108 那张截图的状态） */
function maxOut(g) {
  for (const a of HEX.list) {
    if (a.tier === 'endless') continue;
    g.hex.taken[a.id] = a.max;
    g.hex.count++;
    g.hex.tiers[a.tier] = (g.hex.tiers[a.tier] || 0) + 1;
    a.apply(g, a.max);
  }
  for (const w of NS.DEFS.weapons) {
    if (w.id === 'pulse') continue;
    g.player.weapons.push({ id: w.id, level: 8, timer: 0, evolved: true });
  }
  for (const ev of C.evolutions) g.evolved[ev.weapon] = true;
}

/* 跑一段真实战斗，等 DPS 收敛后召首领，测交战时长 */
function fight(floor, maxed, warmupSec) {
  const g = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
  g.onEvent = function () {};
  g.start();
  g.player.maxHp = 1e12; g.player.hp = 1e12;
  if (maxed) { maxOut(g); g.player.level = 108; }
  else {
    /* 中期玩家：全武器 LV5、若干属性，代表「第 1/6 层」的真实水平 */
    for (const w of NS.DEFS.weapons) {
      if (w.id === 'pulse') continue;
      g.player.weapons.push({ id: w.id, level: 5, timer: 0 });
    }
    g.player.level = 55;
    g.player.dmgMul = 2.6; g.player.haste = 0.75; g.player.crit = 0.25;
  }
  g.floor = floor; g.floorState = 'wave'; g.floorWaveTime = 1e9; g.floorTime = 0;

  const STEP = 1 / 60;
  let t = 0;
  for (let i = 0; i < Math.round(warmupSec / STEP); i++) {
    t += STEP;
    g.input.axis = () => ({ x: Math.sin(t * 0.53), y: Math.cos(t * 0.41) });
    if (g.state === 'levelup') g.chooseUpgrade(0);
    g.update(STEP);
  }
  const dps = g.emaDps;
  g.spawnBoss();
  /* 首领贴脸生成，且玩家站定对轰 —— 排除「玩家跑得比首领快、弹道全落空」的干扰，
     这里测的是纯粹的伤害闸门与血量。 */
  if (g.boss) { g.boss.x = g.player.x + 78; g.boss.y = g.player.y; }
  g.input.axis = () => ({ x: 0, y: 0 });
  const hp = g.boss ? g.boss.maxHp : 0;
  const budget = g.boss ? g.boss.maxDps : 0;
  let sec = 0;
  while (g.boss && !g.boss.dead && sec < 120) {
    if (g.state === 'levelup') g.chooseUpgrade(0);
    g.update(STEP);
    sec += STEP;
  }
  return { dps: Math.round(dps), hp: Math.round(hp), budget: Math.round(budget), sec: +sec.toFixed(1), killed: !g.boss };
}

console.log('======== v5 首领强度回归 ========');
const low = fight(1, false, 1.0);
const mid = fight(6, false, 20);
const high = fight(18, true, 25);
const veryHigh = fight(30, true, 25);

console.log('\n[普通玩家] 第 1 层：DPS ' + low.dps + ' → 血量 ' + low.hp + ' · 交战 ' + low.sec + 's');
console.log('[普通玩家] 第 6 层：DPS ' + mid.dps + ' → 血量 ' + mid.hp + ' · 交战 ' + mid.sec + 's');
console.log('[满配 LV108] 第 18 层：DPS ' + high.dps + ' → 血量 ' + high.hp + ' · 交战 ' + high.sec + 's');
console.log('[满配 LV108] 第 30 层：DPS ' + veryHigh.dps + ' → 血量 ' + veryHigh.hp + ' · 交战 ' + veryHigh.sec + 's\n');

check('首领血量能被玩家 DPS 追平', high.hp > high.dps * 11 * 0.8,
  '血量 ' + high.hp + ' ≈ DPS ' + high.dps + ' × 秒数');
check('满配玩家不会秒掉首领', high.sec >= 8, '交战 ' + high.sec + 's');
check('深层首领交战时长有上限', veryHigh.sec <= 70, '交战 ' + veryHigh.sec + 's');
check('普通玩家首领战不失控', mid.sec < 90, '交战 ' + mid.sec + 's');

/* 固定同一输出水平，验证血量随层数单调递增（指数基准 + 目标时长递增） */
function bossHpAt(floor, dps) {
  const g = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
  g.onEvent = function () {};
  g.start();
  g.player.maxHp = 1e12; g.player.hp = 1e12;
  g.emaDps = dps; g.floor = floor; g.floorState = 'wave';
  g.spawnBoss();
  return g.boss ? g.boss.maxHp : 0;
}
const sameDps = 3000;
const seq = [1, 4, 8, 12, 18, 25].map(f => bossHpAt(f, sameDps));
const mono = seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq[seq.length - 1] > seq[0] * 2;
check('同输出下血量随层数单调递增', mono, seq.map(v => Math.round(v / 1000) + 'k').join(' → ') + '（wantSec 封顶 26s）');

/* ---------- 高等级海克斯池 ---------- */
const g2 = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
g2.onEvent = function () {};
g2.start();
g2.player.level = 108;
maxOut(g2);                      // 银/金/棱彩全部点满
const ch = g2.getChoices();
const names = ch.map(c => c.def.name);
const allEndless = ch.every(c => c.tier === 'endless');
const dup = new Set(names).size !== names.length;
console.log('\n[LV108 三选一]', names.join(' / '));
check('池子抽空后仍有真强化', !ch.some(c => c.kind === 'heal'), '含保底卡=' + ch.some(c => c.kind === 'heal'));
check('高等级必出无尽层', allEndless, ch.map(c => c.tier).join(','));
check('三张卡互不重复', !dup, names.join('/'));

/* 连拿 200 次无尽层，确认不会抽空、数值不炸 */
let steps = 0;
for (let i = 0; i < 200; i++) {
  const cs = g2.getChoices();
  if (cs.some(c => c.kind === 'heal')) break;
  g2._choices = cs;
  g2.state = 'levelup';
  g2.pendingLevels = 1;
  g2.chooseUpgrade(0);
  steps++;
}
check('无尽层可连续叠加 200 次', steps === 200, '实际 ' + steps + ' 次');
check('叠加后数值仍有限', Number.isFinite(g2.player.dmgMul) && Number.isFinite(g2.player.haste) &&
  g2.player.haste >= 0.18 && g2.player.speed <= 380,
  'dmg×' + g2.player.dmgMul.toFixed(1) + ' haste×' + g2.player.haste.toFixed(2) +
  ' speed ' + Math.round(g2.player.speed));

console.log('\n---------------------------------');
if (failures) { console.log(failures + ' 项未通过'); process.exit(1); }
console.log('全部通过');
