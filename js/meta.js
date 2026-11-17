/* meta.js — v6 门户联动玩法层（在 augments.js 之后加载）
 * 难度倍率 · 层间炼狱契约 · 首领词缀 · 每日签到加成 · 成就
 * 全部通过「保存原函数 + 包装 Game.prototype」接入，不改主状态机。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, G = NS.Game.prototype, A = NS.Audio;
  var TAU = U.TAU;

  var NORMAL_DIFF = { id: 'normal', name: '标准', tag: 'NORMAL', color: '#4dd8ff',
    enemyHp: 1, enemyDmg: 1, enemySpd: 1, bossHp: 1, bossDmg: 1, spawn: 1, prep: 1, score: 1 };

  /* ---------------- 炼狱契约：每层击破首领后三选一，诅咒换收益 ---------------- */
  var CONTRACTS = [
    { id: 'blooddebt', name: '血债', icon: '债', color: '#ff5c7a',
      curse: '最大生命 -22%', boon: '全局伤害 +45%',
      apply: function (g) { var p = g.player; p.maxHp = Math.max(45, Math.round(p.maxHp * 0.78)); p.hp = Math.min(p.hp, p.maxHp); p.dmgMul *= 1.45; } },
    { id: 'plague', name: '疾疫', icon: '疫', color: '#9dff5c',
      curse: '敌群移速 +25%', boon: '经验 +40% · 分数 ×1.3',
      apply: function (g) { g.contractEnemySpeed *= 1.25; g.player.xpMul *= 1.4; g.contractScore *= 1.3; } },
    { id: 'sacrifice', name: '献祭', icon: '祭', color: '#ffb84d',
      curse: '立刻失去 30% 当前生命', boon: '重掷 +3 · 能量充满 · 稀有宝箱 ×2',
      apply: function (g) {
        g.player.hp = Math.max(1, g.player.hp * 0.7); g.rerolls += 3; g.energy = 100;
        for (var i = 0; i < 2; i++) { var a = U.rand(0, TAU); g.spawnChest(g.player.x + Math.cos(a) * 100, g.player.y + Math.sin(a) * 100, 2); }
      } },
    { id: 'ironlaw', name: '铁律', icon: '律', color: '#8bf6ff',
      curse: '首领血量 +40%', boon: '分数 ×1.6 · 每层额外宝箱',
      apply: function (g) { g.contractBossHp *= 1.4; g.contractScore *= 1.6; g.contractChestBonus += 1; } },
    { id: 'solo', name: '孤注', icon: '孤', color: '#ff2f8e',
      curse: 'EMP 过载被永久封印', boon: '武器伤害 +60% · 攻速 +18%',
      apply: function (g) { g.contractNoEmp = true; g.player.dmgMul *= 1.6; g.player.haste *= 0.82; } },
    { id: 'glass', name: '琉璃', icon: '璃', color: '#ff8ad8',
      curse: '受到伤害 ×1.5', boon: '暴击率 +18% · 暴击伤害 +0.8',
      apply: function (g) { g.contractHurtMul *= 1.5; g.player.crit = Math.min(1, g.player.crit + 0.18); g.player.critMul += 0.8; } },
    { id: 'horde', name: '虫潮', icon: '潮', color: '#c2a8ff',
      curse: '刷怪密度 +30%', boon: '击杀回血 +2 · 能量获取 +50%',
      apply: function (g) { g.contractSpawnMul *= 1.3; g.contractKillHeal += 2; if (g.hex) g.hex.energyMul *= 1.5; } },
    { id: 'greed', name: '贪噬', icon: '贪', color: '#ffe14d',
      curse: '经验获取 -25%', boon: '分数 ×2.2 · 宝箱掉率 +12%',
      apply: function (g) { g.player.xpMul *= 0.75; g.contractScore *= 2.2; if (g.hex) g.hex.chestChance += 0.12; } }
  ];

  /* ---------------- 首领词缀：按层数解锁，越深越多 ---------------- */
  var AFFIXES = [
    { id: 'bulwark',  name: '壁垒', desc: '受到伤害 -32%' },
    { id: 'vampire',  name: '噬主', desc: '命中玩家时回血' },
    { id: 'volatile', name: '崩解', desc: '死亡爆发环形弹幕' },
    { id: 'frenzy',   name: '狂血', desc: '半血后弹幕频率 +40%' },
    { id: 'summoner', name: '群噬', desc: '召唤数量翻倍' },
    { id: 'eclipse',  name: '蚀界', desc: '靠近时持续灼烧' }
  ];
  function affixCount(f, diffId) {
    var n = f <= 1 ? 0 : (f <= 3 ? 1 : (f <= 6 ? 2 : 3));
    if (diffId === 'nightmare') n = Math.min(4, n + 1);
    else if (diffId === 'inferno' && f >= 4) n = Math.min(4, n + 1);
    return n;
  }
  function rollAffixes(n) {
    var pool = U.shuffle(AFFIXES.slice()), out = [];
    for (var i = 0; i < Math.min(n, pool.length); i++) out.push(pool[i]);
    return out;
  }

  /* ---------------- 包装链 ---------------- */
  /* 词缀roll供 systems.spawnBoss 在生成首领时同步调用，保证警报事件拿到词缀 */
  NS.rollBossAffixes = function (f, diffId) { return rollAffixes(affixCount(f, diffId)); };

  var _reset = G.reset;
  var _spawnWave = G.spawnWave;
  var _spawnMinions = G.spawnMinions;
  var _nextFloor = G.nextFloor;
  var _killEnemy = G.killEnemy;
  var _damageEnemy = G.damageEnemy;
  var _hurtPlayer = G.hurtPlayer;
  var _tryUltimate = G.tryUltimate;
  var _postUpdate = G.postUpdate;
  var _getHud = G.getHud;
  var _finish = G.finish;
  var _enemyUpdate = NS.Enemy.prototype.update;

  function scaleEnemy(g, e) {
    var d = g.diff || NORMAL_DIFF;
    e.maxHp = Math.max(1, Math.round(e.maxHp * d.enemyHp)); e.hp = e.maxHp;
    e.damage = Math.round(e.damage * d.enemyDmg);
    e.speed = e.speed * d.enemySpd * (g.contractEnemySpeed || 1);
  }

  /* 开局：应用难度、签到加成，初始化契约 / 词缀状态 */
  G.reset = function () {
    _reset.call(this);
    var Ac = NS.Account;
    this.diff = Ac ? Ac.difficulty() : NORMAL_DIFF;
    this.signBonus = Ac ? Ac.bonus() : { days: 0, hp: 0, energy: 0, rerolls: 0, scoreMul: 1, achN: 0 };
    this.diffScore = this.diff.score * (this.signBonus.scoreMul || 1);
    this.contracts = []; this._contractChoices = null;
    this.contractScore = 1; this.contractEnemySpeed = 1; this.contractBossHp = 1;
    this.contractHurtMul = 1; this.contractNoEmp = false;
    this.contractKillHeal = 0; this.contractChestBonus = 0; this.contractSpawnMul = 1;
    this.bossAffixCount = 0;
    this.floorWaveTime = Math.max(18, Math.round((this.floorWaveTime || 42) * this.diff.prep));
    var p = this.player, b = this.signBonus;
    if (b.hp) { p.maxHp += b.hp; p.hp = p.maxHp; }
    if (b.energy) this.energy = Math.min(100, b.energy);
    if (b.rerolls) this.rerolls += b.rerolls;
    /* v7：研究所永久升级在难度/签到之后注入，叠加到玩家属性 */
    this.labApplied = NS.Lab ? NS.Lab.applyToGame(this) : [];
    this._eclipseT = 0;
  };

  G.spawnWave = function () {
    var before = this.enemies.length, cap = this.enemyCap || 100;
    this.enemyCap = Math.min(180, Math.round(cap * (this.diff ? this.diff.spawn : 1) * (this.contractSpawnMul || 1)));
    _spawnWave.call(this);
    this.enemyCap = cap;
    for (var i = before; i < this.enemies.length; i++) scaleEnemy(this, this.enemies[i]);
  };

  G.spawnMinions = function (boss, n) {
    if (this.boss && this.boss.aff && this.boss.aff.summoner) n = Math.round(n * 1.8);
    var before = this.enemies.length;
    _spawnMinions.call(this, boss, n);
    for (var i = before; i < this.enemies.length; i++) scaleEnemy(this, this.enemies[i]);
  };

  G.damageEnemy = function (e, dmg, color, kx, ky, knock) {
    if (e && e.boss && e.aff && e.aff.bulwark) dmg *= 0.68;
    return _damageEnemy.call(this, e, dmg, color, kx, ky, knock);
  };

  G.hurtPlayer = function (amount) {
    var e = this.boss;
    if (e && !e.dead && e.aff && e.aff.vampire) e.hp = Math.min(e.maxHp, e.hp + amount * 1.6);
    return _hurtPlayer.call(this, amount * (this.contractHurtMul || 1));
  };

  G.tryUltimate = function () {
    if (this.contractNoEmp) {
      this.onEvent('toast', { text: '契约「孤注」生效 // EMP 已封印', danger: true });
      return;
    }
    return _tryUltimate.call(this);
  };

  G.killEnemy = function (e) {
    var volatile = !!(e && e.boss && e.aff && e.aff.volatile);
    var bx = e.x, by = e.y, es = e.score || 0;
    _killEnemy.call(this, e);
    if (volatile) {
      for (var i = 0; i < 16; i++) {
        var a = i * TAU / 16 + this.time * 0.3;
        this.addEBullet(bx + Math.cos(a) * 30, by + Math.sin(a) * 30,
          Math.cos(a) * 210, Math.sin(a) * 210, 7, 11, '#ff8a3d', 3.6);
      }
      this.fx.ring(bx, by, 20, 190, '#ff8a3d', 4, 0.6);
    }
    if (this.contractKillHeal > 0) {
      var p = this.player;
      p.hp = Math.min(p.maxHp, p.hp + this.contractKillHeal);
    }
    var sm = (this.contractScore || 1) * (this.diffScore || 1);
    if (sm > 1) this.score += Math.round(es * (sm - 1));
  };

  /* 蚀界词缀：贴近首领会被持续灼烧（绕过无敌帧） */
  G.postUpdate = function (dt) {
    _postUpdate.call(this, dt);
    if (this.state !== 'playing') return;
    var e = this.boss;
    if (!e || e.dead || !e.aff || !e.aff.eclipse) return;
    var p = this.player, dx = p.x - e.x, dy = p.y - e.y;
    if (dx * dx + dy * dy > 300 * 300) return;
    p.hp = Math.max(0, p.hp - dt * 3.5);
    this._eclipseT = (this._eclipseT || 0) - dt;
    if (this._eclipseT <= 0) {
      this._eclipseT = 1.4;
      this.fx.text(p.x, p.y - 34, '蚀界', '#ff9f40', 13, false);
    }
  };

  NS.Enemy.prototype.update = function (dt, game) {
    if (this.boss && this.aff && this.aff.frenzy && this.hp < this.maxHp * 0.5) dt *= 1.4;
    return _enemyUpdate.call(this, dt, game);
  };

  /* ---------------- 层间契约选择（暂停态 'contract'） ---------------- */
  G.nextFloor = function () {
    _nextFloor.call(this);
    if (this.contractChestBonus > 0) {
      var p = this.player;
      for (var i = 0; i < this.contractChestBonus; i++) {
        var a = U.rand(0, TAU);
        this.spawnChest(p.x + Math.cos(a) * 110, p.y + Math.sin(a) * 110, 2);
      }
    }
    this.openContract();
  };

  G.openContract = function () {
    var pool = U.shuffle(CONTRACTS.slice()).slice(0, 3);
    this._contractChoices = pool;
    this.state = 'contract';
    if (A && A.setPaused) A.setPaused(true);
    this.onEvent('contract', {
      floor: this.floor,
      choices: pool.map(function (c) {
        return { id: c.id, name: c.name, icon: c.icon, color: c.color, curse: c.curse, boon: c.boon };
      }),
      taken: (this.contracts || []).length
    });
  };

  G.chooseContract = function (idx) {
    if (this.state !== 'contract') return false;
    var c = this._contractChoices && this._contractChoices[idx];
    if (c && c.apply) {
      c.apply(this);
      this.contracts.push(c.id);
      this.onEvent('toast', { text: '炼狱契约 // ' + c.name + ' 已生效', long: true });
      if (A) A.play('evolve');
    }
    this._contractChoices = null;
    this.state = 'playing';
    if (A && A.setPaused) A.setPaused(false);
    this.onEvent('resume', {});
    return true;
  };

  /* ---------------- HUD 数据 ---------------- */
  G.getHud = function () {
    var d = _getHud.call(this), e = this.boss;
    d.difficulty = this.diff ? { name: this.diff.name, tag: this.diff.tag, color: this.diff.color } : { name: '标准', tag: 'NORMAL', color: '#4dd8ff' };
    d.contractCount = (this.contracts || []).length;
    d.contracts = (this.contracts || []).slice();
    d.bossAffixes = (e && !e.dead && e.affList) ? e.affList.map(function (a) { return { name: a.name, desc: a.desc }; }) : [];
    d.signDays = this.signBonus ? (this.signBonus.days || 0) : 0;
    d.achCount = NS.Account ? NS.Account.achCount() : 0;
    d.state = this.state;
    return d;
  };

  /* ---------------- 结算：成就解锁 + 难度记录 ---------------- */
  G.finish = function (win) {
    _finish.call(this, win);
    var Ac = NS.Account;
    if (!Ac || !Ac.current()) return;
    var r = this.result || {}, hex = this.hex || {}, tiers = hex.tiers || {}, diff = this.diff || NORMAL_DIFF;
    var defs = Ac.achievements, got = [];
    function chk(id, cond) {
      if (cond && Ac.unlock(id)) {
        for (var i = 0; i < defs.length; i++) if (defs[i].id === id) got.push(defs[i].name);
      }
    }
    chk('first_blood', (r.bossKills || 0) >= 1);
    chk('floor5', (r.floor || 1) >= 5);
    chk('floor10', (r.floor || 1) >= 10);
    chk('kill1000', (r.kills || 0) >= 1000);
    chk('combo100', (r.maxCombo || 0) >= 100);
    chk('prism', (tiers.prismatic || 0) >= 3);
    chk('evo', (r.evolutions || 0) >= 2);
    chk('nightmare5', diff.id === 'nightmare' && (r.floor || 1) >= 5);
    for (var i = 0; i < got.length; i++) {
      this.onEvent('toast', { text: '★ 成就解锁 // ' + got[i], long: true });
    }
    if (this.result) {
      this.result.difficulty = diff.name;
      this.result.contracts = (this.contracts || []).slice();
      this.result.achCount = Ac.achCount();
    }
  };

  NS.CONTRACTS = CONTRACTS;
  NS.AFFIXES = AFFIXES;
  NS.scaleEnemy = scaleEnemy;   // 供回归测试直接验证难度倍率
})(typeof window !== 'undefined' ? window : globalThis);
