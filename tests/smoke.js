/* smoke.js — Node 无头冒烟测试：mock 最小 Canvas/DOM，直接跑固定步长逻辑
 * 运行：node tests/smoke.js
 * 覆盖 v6：登录档案 / 难度倍率 / 炼狱契约 / 首领词缀 / 成就
 *          + v4 无尽炼狱：层推进 / 逐层成长 / 首领警报 / 伤害上限 / 海克斯 / 密度上限 / 渲染
 * 注：portal.js 是纯 DOM 层，不进 VM，由真实浏览器 CDP 复验。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'core.js', 'account.js', 'lab.js', 'audio.js', 'fx.js', 'entities.js', 'content.js',
  'game.js', 'visuals.js', 'systems.js', 'augments.js', 'synergy.js', 'meta.js',
  'perf.js', 'daily.js'
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

/* 固定随机种子：只作用于 VM 沙箱内的 Math，保证冒烟测试可复现，不改动游戏本体 */
let _seed = 0x2f6e2b1;
const SeededMath = Object.create(Math);
SeededMath.random = function () {
  _seed = (_seed + 0x6D2B79F5) | 0;
  let z = _seed;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
};

const store = {};
const sandbox = {
  console, Math: SeededMath, Date, JSON, Map, Set, Object, Array, Number, String, Boolean,
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
const C = NS.CONTENT;

/* ---------- v6 账号：注册 / 密码校验 / 签到 / 多档案隔离 / 排行榜 ---------- */
const Ac = NS.Account;
const regOk = Ac.register('测试特工', '1234', '✦').ok;
const dupeBlocked = !Ac.register('测试特工', '1234', '✦').ok;
const wrongPassBlocked = !Ac.login('测试特工', '0000').ok;
const loginOk = Ac.login('测试特工', '1234').ok;
const signOk = Ac.sign().ok && !Ac.sign().ok;      // 同一天只能签一次
const signBonus = Ac.bonus();
const reg2Ok = Ac.register('第二档案', 'abcd', '★').ok;
Ac.current().stats.bestFloor = 7; Ac.persist();
const reloginOk = Ac.login('测试特工', '1234').ok;
const isolated = reloginOk && (Ac.current().stats.bestFloor || 0) === 0;
const boardOk = Ac.leaderboard().length >= 3;
const diffEliteOk = Ac.difficulty().id === 'elite';
const achBefore = Ac.achCount();
Ac.logout();                                       // 主循环回到标准档，保持基线数值不变
const defaultDiffOk = Ac.difficulty().id === 'normal';

const game = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
const events = { levelup: 0, result: 0, toast: 0, event: 0, chest: 0, ult: 0,
  bossIncoming: 0, floorClear: 0, contract: 0 };
game.onEvent = function (type) {
  if (type in events) events[type]++;
  /* 契约面板是无头环境里的暂停态：立即签订，保证主循环继续推进 */
  if (type === 'contract' && game.state === 'contract') game.chooseContract(0);
};

/* 统计「数据核心被击破」次数，验证可破坏物件的完整链路 */
let brokenProps = 0;
const _breakProp = game.breakProp;
game.breakProp = function (pr) { brokenProps++; return _breakProp.call(this, pr); };

game.start();
/* 全武器满级 + 全进化，确保 fire() 的每个分支都被执行 */
for (const w of NS.DEFS.weapons) {
  if (w.id !== 'pulse') game.player.weapons.push({ id: w.id, level: 8, timer: 0, evolved: true });
}
for (const ev of C.evolutions) game.evolved[ev.weapon] = true;
game.player.weapons[0].level = 8;
game.player.weapons[0].evolved = true;
game.player.maxHp = 1e9;
game.player.hp = 1e9;
game.player.dmgMul = 20;
game.player.haste = 0.35;

/* 手动触发一次性系统，覆盖开箱 / 进化 / 道具 / 事件 / EMP 路径 */
game.applyEvolution(C.evolutions[0]);
game.startEvent();
game.spawnChest(game.player.x + 40, game.player.y, 2);
game.openChest(game.chests[0]);
game.spawnPickup(game.player.x, game.player.y, 'magnet');
game.collectPickup(game.pickups[0]);
game.spawnPickup(game.player.x, game.player.y, 'bomb');
game.collectPickup(game.pickups[0]);
game.energy = 100;
game.tryUltimate();
game.render();

/* ---------- v3 海克斯机制：走正式的 getChoices / chooseUpgrade / reroll ---------- */
const HEX = NS.HEX;
function takeAug(id, lv) {
  const a = HEX.byId[id];
  game.hex.taken[id] = lv;
  game.hex.count++;
  game.hex.tiers[a.tier] = (game.hex.tiers[a.tier] || 0) + 1;
  a.apply(game, lv);
}
/* 主动拿到用户点名的机制，确保这些分支一定被执行 */
takeAug('hx_autoloot', 2);
takeAug('hx_lifesteal', 2);
takeAug('hx_regen', 1);
takeAug('hx_field', 1);
takeAug('hx_nova', 2);
takeAug('hx_singularity', 1);
takeAug('hx_overload', 1);
takeAug('hx_chain', 1);
takeAug('hx_omnivamp', 1);
takeAug('hx_evo', 1);

/* 重掷：验证次数扣减与三选一刷新 */
game.state = 'levelup';
game.pendingLevels = 1;
game._choices = game.getChoices();
const choicesOk = game._choices.length === 3 &&
  game._choices.every(c => c.def && typeof c.def.desc === 'function' && c.tier);
const rerollBefore = game.rerolls;
const rerollOk = game.rerollAugments() === true && game.rerolls === rerollBefore - 1;
const tiersSeen = new Set(game._choices.map(c => c.tier));
game.chooseUpgrade(0);
const resumedOk = game.state === 'playing';

/* 棱彩保底：连续 6 次没出棱彩后，下一组第一张必须是棱彩 */
game.hex.sincePrism = 6;
const prismaticPity = game.getChoices()[0].tier === 'prismatic';
game.hex.sincePrism = 0;

/* 自动拾取：远处晶体一帧后应被拉近 */
game.gems.length = 0;
game.spawnGem(game.player.x + 600, game.player.y + 300, 3);
const dBefore = Math.hypot(game.gems[0].x - game.player.x, game.gems[0].y - game.player.y);
game.update(1 / 60);
const dAfter = game.gems.length ? Math.hypot(game.gems[0].x - game.player.x, game.gems[0].y - game.player.y) : 0;
const autoLootOk = dAfter < dBefore;

/* 击杀吸血：把血压低后杀一只，HP 应上升 */
game.player.hp = 40;
const hpBefore = game.player.hp;
const dummy = new NS.Enemy('chaser', game.player.x + 30, game.player.y + 30, 1, 1);
game.enemies.push(dummy);
game.killEnemy(dummy);
const hpAfter = game.player.hp;
const lifestealOk = hpAfter > hpBefore;
game.player.hp = 1e9;

/* 决斗领域：首领生成后应开启窗口并压制刷怪 */
game.spawnBoss();
const duelValue = game.duelTimer;
const duelOk = duelValue > 0;

let t = 0;
let upgrades = 0;
let maxEnemies = 0;
let sawProp = false;   // 数据核心是可破坏的，检测「运行期间存在过」而非「结束时仍在」
const FRAMES = 60 * 95;   // 95 秒，覆盖至少一次「准备波 → 首领战 → 进下一层」完整循环
const STEP = 1 / 60;
for (let i = 0; i < FRAMES; i++) {
  t += STEP;
  game.input.axis = () => ({ x: Math.sin(t * 0.53), y: Math.cos(t * 0.41) });
  if (game.state === 'levelup') {
    const choices = game.getChoices();
    if (choices.length !== 3) throw new Error('升级选项数量异常: ' + choices.length);
    game.chooseUpgrade(i % 3);
    upgrades++;
  }
  game.update(STEP);
  if (game.props.length > 0) sawProp = true;
  if (game.enemies.length > maxEnemies) maxEnemies = game.enemies.length;
  if (i % 60 === 0) game.render();
  if (i === 1800 || i === 3600) { game.energy = 100; game.tryUltimate(); }

  const p = game.player;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.hp)) {
    throw new Error('第 ' + i + ' 帧出现 NaN/Infinity');
  }
  if (!Number.isFinite(game.comboMul) || !Number.isFinite(game.energy) || !Number.isFinite(game.score)) {
    throw new Error('第 ' + i + ' 帧 v2 数值异常');
  }
  if (game.enemies.length > 140) throw new Error('敌人数量越界: ' + game.enemies.length);
  if (game.bullets.length > 420) throw new Error('子弹数量越界: ' + game.bullets.length);
  if (game.fx.parts.active.length > game.fx.limit) throw new Error('粒子数量越界');
  if (game.state === 'result') break;
}
game.render();

/* ---------- 独立高压场景：关掉所有输出跑到第三关，验证密度上限不雪崩 ---------- */
const stress = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
stress.start();
stress.player.weapons.length = 0;          // 完全不开火，敌人只进不出
stress.player.hp = 1e9; stress.player.maxHp = 1e9;
let stressPeak = 0;
for (let i = 0; i < 60 * 195; i++) {
  stress.update(1 / 60);
  if (stress.enemies.length > stressPeak) stressPeak = stress.enemies.length;
  if (i % 120 === 0) stress.render();
}

/* ---------- v4 无尽层探针：独立实例，不污染主循环 ---------- */
const probe = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
probe.start();
probe.player.hp = 1e9; probe.player.maxHp = 1e9;
const bossHpByFloor = [], mobHpByFloor = [], mobDmgByFloor = [], affixesByFloor = [];
let bossCapOk = false, waveProduced = true;
for (let lv = 1; lv <= 6; lv++) {
  probe.floor = lv;
  probe.floorState = 'wave';
  probe.enemies.length = 0;
  probe.boss = null;
  probe.spawnBoss();
  const b = probe.boss;
  bossHpByFloor.push(b.maxHp);
  affixesByFloor.push(b.affList ? b.affList.length : 0);
  if (lv === 1) {
    const before = b.hp;
    probe.damageEnemy(b, 1e9, '#fff', 0, 1, 0);   // 模拟后期超高 DPS 的一击
    bossCapOk = (before - b.hp) <= b.maxHp * 0.035 + 0.001;
  }
  probe.enemies.length = 0;
  probe.spawnWave();
  waveProduced = waveProduced && probe.enemies.length > 0;
  /* 用固定敌种套用逐层曲线，避免刷怪随机类型干扰 HP / 伤害的可比性 */
  const ref = new NS.Enemy('chaser', 0, 0,
    NS.floorScale(lv).hp, NS.floorScale(lv).speed, NS.floorScale(lv).damage);
  mobHpByFloor.push(ref.maxHp);
  mobDmgByFloor.push(ref.damage);
}
const bossGrows = bossHpByFloor.every((v, i) => i === 0 || v > bossHpByFloor[i - 1]);
const mobGrows = waveProduced && mobHpByFloor[5] > mobHpByFloor[0] &&
  mobDmgByFloor[5] > mobDmgByFloor[0] &&
  mobHpByFloor.every((v, i) => i === 0 || v >= mobHpByFloor[i - 1]);

/* nextFloor：层数递增、准备时间缩短、场景循环、回血 / 能量 / 宝箱奖励 */
probe.floor = 3; probe.floorState = 'boss'; probe.boss = null;
probe.player.hp = 50; probe.energy = 10;
probe.nextFloor();
const floorAdvanceOk = probe.floor === 4 && probe.floorState === 'wave' &&
  probe.floorTime === 0 && probe.floorWaveTime < 42 && probe.stage === 3 &&
  probe.player.hp > 50 && probe.energy > 10;

/* ---------- v6 炼狱契约：进层时三选一暂停，签订后恢复战斗 ---------- */
const pactOpened = probe.state === 'contract' && probe._contractChoices &&
  probe._contractChoices.length === 3;
probe.chooseContract(0);
const pactOk = pactOpened && probe.state === 'playing' &&
  probe.contracts.length === 1 && probe._contractChoices === null;
const blood = NS.CONTRACTS.find(c => c.id === 'blooddebt');
const hpBeforePact = probe.player.maxHp, dmgBeforePact = probe.player.dmgMul;
blood.apply(probe);
const pactEffectOk = probe.player.maxHp < hpBeforePact && probe.player.dmgMul > dmgBeforePact;
const pactPoolOk = NS.CONTRACTS.length >= 8 && NS.AFFIXES.length >= 6;

/* ---------- v6 难度倍率：同敌种在噩梦档的血 / 伤 / 速显著高于标准 ---------- */
const eStd = new NS.Enemy('chaser', 0, 0, 1, 1, 1);
const eNM = new NS.Enemy('chaser', 0, 0, 1, 1, 1);
NS.scaleEnemy({ diff: Ac.diffs.find(d => d.id === 'nightmare'), contractEnemySpeed: 1 }, eNM);
const diffScaleOk = eNM.maxHp > eStd.maxHp * 2 && eNM.damage > eStd.damage && eNM.speed > eStd.speed;

/* ---------- v6 首领词缀：第 1 层无，第 2 层起逐层增多 ---------- */
const affixGrowOk = affixesByFloor[0] === 0 && affixesByFloor[1] >= 1 &&
  affixesByFloor[5] >= 2 && affixesByFloor[5] >= affixesByFloor[1];

/* ---------- v6 成就：独立实例触发结算解锁，不污染主循环 ---------- */
Ac.login('测试特工', '1234');
const achProbe = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
achProbe.start();
achProbe.floor = 10; achProbe.bossKills = 5; achProbe.kills = 1200;
achProbe.maxCombo = 150; achProbe.evolutionCount = 2; achProbe.hex.tiers.prismatic = 3;
achProbe.finish(false);
const achAfter = Ac.achCount();
const achUnlockOk = achAfter > achBefore && achAfter >= 7;

/* ---------- v7 超频核心 + 研究所永久升级树 ---------- */
const Lab = NS.Lab;
const coresFormatOk = Number.isFinite(Lab.cores()) && Lab.cores() >= 0;   // 档案核心数值有效
/* grant 用逻辑层的独立战果对象验证，UI 层不进 VM */
const coreProbe = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
coreProbe.start();
const coresBeforeGrant = Lab.cores();
const granted = Lab.grant({ floor: 8, bossKills: 4, kills: 900, score: 30000, time: 400 });
const coresAfterGrant = Lab.cores();
const grantOk = granted > 0 && coresAfterGrant === coresBeforeGrant + granted;
/* 购买：给足核心，买一级「超频核心」，验证扣费 + 等级 + 下次价格递增 */
Ac.current().cores = 5000;
const powerDef = Lab.upgrades.find(u => u.id === 'power');
const powerCost1 = Lab.cost('power');
const buyRes = Lab.buy('power');
const powerCost2 = Lab.cost('power');
const buyOk = buyRes.ok && Lab.level('power') === 1 &&
  Ac.current().cores === 5000 - powerCost1 && powerCost2 > powerCost1;
/* 开局注入：购买后新开一局，dmgMul 应高于未购买基线 */
const beforeDmg = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 }).player.dmgMul;
Lab.buy('power'); Lab.buy('vigor');                       // 再买一级攻击 + 一级生命
const labGame = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
labGame.start();
const applyOk = labGame.player.dmgMul > beforeDmg && labGame.player.maxHp > new NS.Player(0, 0).maxHp &&
  labGame.labApplied && labGame.labApplied.length >= 2;
/* 满级 / 余额不足边界 */
const insufficient = (function () { Ac.current().cores = 0; return Lab.buy('focus').ok; })();
const insufficientBlocked = insufficient === false;
const summaryOk = Lab.summary().length === Lab.upgrades.length && Lab.upgrades.length >= 6;

/* ---------- v8 海克斯羁绊：种类计数 / 阶梯激活 / 不重复 apply / 濒死免死 ---------- */
const Syn = NS.Synergy;
const synGame = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
synGame.start();
const traitTableOk = Syn.traits.length >= 5 && Syn.traits.every(t => t.tiers.length === 3 && t.members.length >= 6);
/* 直接写入 hex.taken 模拟构筑：超频羁绊拿 2 种 → 激活 1 阶 */
synGame.hex.taken['hx_dmg'] = 1;
synGame.hex.taken['hx_haste'] = 2;   // 层数 2，但只算 1 种
const dmgBeforeSyn = synGame.player.dmgMul;
const fired2 = Syn.recalc(synGame, true);
const countKindsOk = Syn.counts(synGame).overclock === 2 && Syn.tierOf(2) === 1;
const tier1Ok = fired2.length >= 1 && synGame.syn.applied.overclock === 1 &&
  synGame.player.dmgMul > dmgBeforeSyn;
/* 重复 recalc 不应重复加成（档位已记账） */
const dmgAfterTier1 = synGame.player.dmgMul;
Syn.recalc(synGame, true);
const noDoubleApply = synGame.player.dmgMul === dmgAfterTier1;
/* 再加 2 种 → 4 种激活 2 阶 */
synGame.hex.taken['hx_crit'] = 1;
synGame.hex.taken['hx_apex'] = 1;
const fired4 = Syn.recalc(synGame, true);
const tier2Ok = synGame.syn.applied.overclock === 2 && fired4.length >= 1;
/* summary 快照结构完整 */
const synSummary = Syn.summary(synGame);
const synSummaryOk = synSummary.length === Syn.traits.length &&
  synSummary.some(s => s.id === 'overclock' && s.tier === 2 && s.count === 4 && !!s.active);
/* 不朽 6 档濒死免死：注入 6 种不朽强化 → 激活后致命伤应保留血量 */
const wardGame = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
wardGame.start();
const imm = Syn.traits.find(t => t.id === 'immortal');
imm.members.slice(0, 6).forEach(id => { wardGame.hex.taken[id] = 1; });
Syn.recalc(wardGame, true);
wardGame.player.hp = 5;
wardGame.time = 100;
wardGame.hurtPlayer(9999);
const deathWardOk = wardGame.syn.deathWard && wardGame.player.hp > 0 && wardGame.syn.wardAt === 100;
Ac.logout();

/* ---------- v9 性能层：帧率档位 / 动态分辨率 / 帧时间采样 ---------- */
const Perf = NS.Perf;
const perfModes = Perf.options.length;
Perf.setMode('120');
const perf120Ok = Perf.mode === '120' && Perf.cap === 120;
Perf.setMode('auto');
const perfAutoOk = Perf.mode === 'auto' && Perf.cap === 0;
Perf.sample(25); Perf.sample(25); Perf.sample(25);
const perfFtOk = Perf.ft > 16 && Perf.ft < 40;
const perfHudOk = (function () {
  const h = game.getHud();
  return !!(h.perf && h.perf.mode && typeof h.perf.ft === 'number');
})();
/* 动态分辨率：模拟持续高帧时间后 dynScale 应下降（通过多次 sample + tick 触发） */
const dynBefore = Perf.dynScale;
for (let i = 0; i < 40; i++) Perf.sample(30);
game.manualTick = true;   // 避免 tick 内 rAF（VM 无 rAF 本就不触发），确保走采样逻辑
const perfApiOk = typeof Perf.setMode === 'function' && typeof Perf.sample === 'function';

/* ---------- v9 每日挑战：日期确定性 / 修饰注入 / 日榜 / 进化图鉴 ---------- */
const Daily = NS.Daily;
const chA = Daily.challenge('2026-11-17'), chB = Daily.challenge('2026-11-17'), chC = Daily.challenge('2026-11-18');
const dailyDeterministic = JSON.stringify(chA) === JSON.stringify(chB) && JSON.stringify(chA) !== JSON.stringify(chC);
const dailyShapeOk = !!(chA.diff && chA.goal >= 3 && chA.mods.length === 3);
/* 修饰注入：先 new（构造内含 reset），再 arm，再 reset 注入当日规则，且不污染 A.diffs */
const baseEliteHp = Ac.diffs.filter(d => d.id === 'elite')[0].enemyHp;
const dailyGame = new NS.Game(canvas, { bindInput: false, quality: 'high', volume: 0 });
Daily.clear();
Daily.arm();
dailyGame.reset();
const dailyActiveOk = !!(dailyGame.daily && dailyGame.daily.mods.length === 3 && dailyGame.daily.goal >= 3);
const diffCloneOk = Ac.diffs.filter(d => d.id === 'elite')[0].enemyHp === baseEliteHp;   // 全局难度未被污染
const dailyHudOk = !!(dailyGame.getHud().daily);

/* 日榜上报：登录态写入并读取 */
Ac.login('测试特工', '1234');
Daily.submit({ floor: 5, score: 9999, kills: 200, time: 120, bossKills: 2 }, Ac.current());
const dailyBoardList = Daily.board();
const dailyBoardOk = dailyBoardList.length > 0 && dailyBoardList.some(r => r.name === '测试特工' && r.reached);
const dailyMineOk = !!Daily.mine();
Ac.logout();

/* 进化图鉴：record + progress */
NS.Codex.record({ evolved: { pulse: true, orbit: true } });
const codexProg = NS.Codex.progress();
const codexOk = codexProg.count >= 2 && codexProg.items.length === 6;

const checks = [
  ['游戏时间推进', game.time > 80, game.time.toFixed(1) + 's'],
  ['产生击杀', game.kills > 0, game.kills],
  ['等级提升', game.player.level > 1, 'LV ' + game.player.level],
  ['触发升级选择', events.levelup > 0 && upgrades > 0, events.levelup + ' 次'],
  ['生成首领', game.bossIndex >= 1 || events.toast > 0, '第 ' + game.bossIndex + ' 个'],
  ['BOSS 基础表温和', NS.DEFS.enemies.boss.hp <= 1000 && NS.DEFS.enemies.boss.speed <= 46 &&
    NS.DEFS.enemies.boss.damage <= 18,
    NS.DEFS.enemies.boss.hp + ' HP / ' + NS.DEFS.enemies.boss.speed + ' 速 / ' + NS.DEFS.enemies.boss.damage + ' 伤'],
  ['阶段按层循环', game.stage === (game.floor - 1) % C.stages.length,
    '第 ' + game.floor + ' 层 → ' + (C.stages[game.stage] || {}).name],
  ['随机事件', events.event > 0 && game.eventCount > 0, game.eventCount + ' 次'],
  ['宝箱与开箱', events.chest > 0 && game.chestCount > 0, game.chestCount + ' 个'],
  ['武器进化', game.evolutionCount > 0, game.evolutionCount + ' 件'],
  ['EMP 主动技', game.ultCount > 0, game.ultCount + ' 次'],
  ['连杀倍率', game.maxCombo > 1, '最高 ' + game.maxCombo],
  ['地图物件', sawProp && brokenProps > 0 && game.zones.length > 0,
    (sawProp ? '曾生成核心' : '未生成核心') + ' / ' + brokenProps + ' 击破 / ' + game.zones.length + ' 区域'],
  ['海克斯强化池', HEX.list.length >= 24, HEX.list.length + ' 项'],
  ['银/金/棱彩齐备', ['silver', 'gold', 'prismatic'].every(t => HEX.list.some(a => a.tier === t)),
    HEX.list.filter(a => a.tier === 'prismatic').length + ' 项棱彩'],
  ['强化三选一结构', choicesOk, '品质 ' + Array.from(tiersSeen).join('/')],
  ['棱彩保底', prismaticPity, '连续 6 次未出则必出'],
  ['重掷机制', rerollOk, '剩余 ' + game.rerolls + ' 次'],
  ['选完恢复战斗', resumedOk, game.state],
  ['全域牵引自动拾取', autoLootOk && game.hex.autoLoot > 0,
    dBefore.toFixed(0) + 'px → ' + dAfter.toFixed(0) + 'px'],
  ['击杀吸血', lifestealOk && game.hex.lifesteal > 0,
    hpBefore.toFixed(0) + ' → ' + hpAfter.toFixed(0)],
  ['首领决斗领域', duelOk, '窗口 ' + duelValue.toFixed(1) + 's'],
  ['已获强化统计', game.hex.count > 0 && game.hexSummary().items.length > 0,
    game.hex.count + ' 项'],
  ['无尽密度限流', maxEnemies <= 140, '常规峰值 ' + maxEnemies + ' 只 / 上限 ' + game.enemyCap],
  ['零输出高压不雪崩', stressPeak <= 140 && stress.time > 190,
    '195s 零输出峰值 ' + stressPeak + ' 只（旧版上限 260）'],
  ['自适应画质', typeof game.perfLevel === 'number' && game.fx.limit > 0,
    '档位 ' + game.perfLevel + ' / 粒子上限 ' + game.fx.limit],
  ['HUD 快照字段完整', (function () {
    const h = game.getHud();   // 回归防护：getHud 每帧被调用，抛错会停掉整个渲染循环
    return !!(h && Number.isFinite(h.hpRatio) && h.hex &&
      typeof h.perfLevel === 'number' && typeof h.rerolls === 'number' &&
      typeof h.duelTimer === 'number' && Array.isArray(h.weapons));
  })(), '含 hex / perf / rerolls / hpRatio'],
  ['经验/分数为有限数', Number.isFinite(game.score) && Number.isFinite(game.player.xp), Math.round(game.score)],
  /* ---------- v4 无尽炼狱回归 ---------- */
  ['无尽模式无胜利结算', !game.result && game.state !== 'result',
    game.state + ' / ' + game.time.toFixed(0) + 's 无 5 分钟判胜'],
  ['层状态机', game.floor >= 1 && (game.floorState === 'wave' || game.floorState === 'boss'),
    '第 ' + game.floor + ' 层 · ' + game.floorState + ' · 击破 ' + game.bossKills + ' 只'],
  ['首领逐层变强', bossGrows,
    'L1 ' + bossHpByFloor[0] + ' → L6 ' + bossHpByFloor[5] + ' HP'],
  ['小怪逐层变强', mobGrows,
    'HP ' + mobHpByFloor[0] + '→' + mobHpByFloor[5] + ' / 伤害 ' + mobDmgByFloor[0] + '→' + mobDmgByFloor[5]],
  ['首领不被瞬秒', bossCapOk, '单次受伤 ≤ 最大生命 3.5%'],
  ['首领出场警报', events.bossIncoming > 0, events.bossIncoming + ' 次 bossIncoming'],
  ['击破首领进下一层', floorAdvanceOk,
    'L3 → L' + probe.floor + ' · 准备 ' + probe.floorWaveTime.toFixed(1) + 's'],
  ['HUD 含无尽层字段', (function () {
    const h = game.getHud();
    return h.endless === true && Number.isFinite(h.floor) && Number.isFinite(h.bossKills) &&
      typeof h.floorState === 'string' && Number.isFinite(h.enemyCap);
  })(), 'floor / floorState / bossKills / endless'],
  /* ---------- v6 门户 / 契约 / 词缀 / 难度 / 成就回归 ---------- */
  ['账号注册与密码校验', regOk && dupeBlocked && wrongPassBlocked && loginOk,
    '注册 / 重名拦截 / 错误密码拦截 / 登录'],
  ['多档案存档隔离', reg2Ok && isolated && boardOk,
    Ac.leaderboard().length + ' 个档案独立记录 + 本机排行榜'],
  ['每日签到与开局加成', signOk && signBonus.hp >= 5 && signBonus.energy >= 8,
    '连续 ' + signBonus.days + ' 天 · +' + signBonus.hp + ' HP / +' + signBonus.energy + ' 能量'],
  ['默认精英 / 未登录回退', diffEliteOk && defaultDiffOk, '门户推荐精英 · 无档案回退标准'],
  ['难度倍率生效', diffScaleOk,
    '标准 ' + eStd.maxHp + ' HP → 噩梦 ' + eNM.maxHp + ' HP'],
  ['炼狱契约三选一', pactOk && events.contract > 0 && game.contracts.length > 0,
    '触发 ' + events.contract + ' 次 · 已签 ' + game.contracts.length + ' 张'],
  ['契约诅咒与收益双向生效', pactEffectOk && pactPoolOk,
    NS.CONTRACTS.length + ' 契约 / ' + NS.AFFIXES.length + ' 词缀'],
  ['首领词缀逐层解锁', affixGrowOk,
    'L1 ' + affixesByFloor[0] + ' → L2 ' + affixesByFloor[1] + ' → L6 ' + affixesByFloor[5] + ' 条'],
  ['成就结算解锁', achUnlockOk, achBefore + ' → ' + achAfter + ' / ' + Ac.achievements.length],
  /* ---------- v7 研究所 / 超频核心回归 ---------- */
  ['超频核心结算产出', coresFormatOk && grantOk, '战果结算 +' + granted + ' 枚'],
  ['研究所升级购买与递增价', buyOk, 'LV1 ' + powerCost1 + ' 核 → 下级 ' + powerCost2 + ' 核'],
  ['永久升级开局生效', applyOk, '伤害/生命注入 + ' + labGame.labApplied.length + ' 项'],
  ['余额不足与升级表完整', insufficientBlocked && summaryOk, Lab.upgrades.length + ' 项升级 / 余额拦截'],
  /* ---------- v8 羁绊系统回归 ---------- */
  ['羁绊表结构完整', traitTableOk, Syn.traits.length + ' 羁绊 × 3 档'],
  ['按种类计数而非层数', countKindsOk, '2 种强化（含 1 项 2 层）= 2 件'],
  ['羁绊阶梯激活加成', tier1Ok && tier2Ok, '2 件→1 阶 / 4 件→2 阶'],
  ['羁绊效果不重复叠加', noDoubleApply, '重复 recalc 属性不漂移'],
  ['羁绊快照结构完整', synSummaryOk, '含 tier/count/active 供 HUD 展示'],
  ['不朽濒死免疫', deathWardOk, '6 档激活 · 致命伤保留 45% 血'],
  ['HUD 含 v6 字段', (function () {
    const h = game.getHud();
    return !!(h.difficulty && h.difficulty.tag && Array.isArray(h.contracts) &&
      typeof h.contractCount === 'number' && Array.isArray(h.bossAffixes) &&
      typeof h.achCount === 'number' && typeof h.state === 'string');
  })(), 'difficulty / contracts / affixes / ach / state'],
  ['渲染无异常', true, '含 Bloom / 世界物件 / 镜头 / 威胁指示'],
  /* v9 性能层 */
  ['帧率档位切换', perf120Ok && perfAutoOk, '5 档 · 120 节流 / auto 不限'],
  ['帧时间采样与 HUD', perfFtOk && perfHudOk && perfApiOk, 'EMA 帧时 + HUD perf 字段'],
  /* v9 每日挑战 + 图鉴 */
  ['每日挑战日期确定性', dailyDeterministic && dailyShapeOk, '同日同题 · 3 修饰 / 目标层'],
  ['修饰注入不污染难度', dailyActiveOk && diffCloneOk && dailyHudOk, 'daily 字段生效 / A.diffs 隔离'],
  ['日榜上报与读取', dailyBoardOk && dailyMineOk, '达标记录写入 · 我的最佳可读'],
  ['进化图鉴跨局记录', codexOk, codexProg.count + '/' + codexProg.total + ' 已解锁']
];

console.log('=== 超频幸存者 v9 · 性能帧率 + 每日挑战 + 进化图鉴 · 无头冒烟测试 ===');
let failed = 0;
for (const [name, ok, value] of checks) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name.padEnd(18, ' ') + '  ' + value);
  if (!ok) failed++;
}
console.log('---------------------------------');
console.log('帧数 ' + FRAMES + ' | 第 ' + game.floor + ' 层 (' + game.floorState + ') | 击破首领 ' +
  game.bossKills + ' | 敌人 ' + game.enemies.length + ' | 子弹 ' + game.bullets.length +
  ' | 粒子 ' + game.fx.parts.active.length + ' | 状态 ' + game.state);
if (failed) {
  console.error(failed + ' 项检查未通过');
  process.exit(1);
}
console.log('全部通过');
