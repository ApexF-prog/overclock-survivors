/* systems.js — v2 玩法系统（在 game.js 之后加载）
 * 采用「包装 / 覆盖原型方法」的方式接入，保持原主循环不变：
 *   连杀倍率 · EMP 主动技 · 宝箱与开箱 · 武器进化 · 随机事件 · 阶段
 *   地图物件（数据核心 / 增益圈 / 警戒区）· 掉落道具 · 精英 · 新敌人
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, D = NS.DEFS, C = NS.CONTENT;
  var G = NS.Game.prototype;
  var A = NS.Audio;
  var TAU = U.TAU;

  var _reset = G.reset;
  var _update = G.update;
  var _killEnemy = G.killEnemy;
  var _damageEnemy = G.damageEnemy;
  var _collectGem = G.collectGem;
  var _getChoices = G.getChoices;
  var _getHud = G.getHud;
  var _hurtPlayer = G.hurtPlayer;
  var _enemyUpdate = NS.Enemy.prototype.update;

  /* ---------------- 状态初始化 ---------------- */
  G.reset = function () {
    _reset.call(this);
    this.combo = 0; this.comboTimer = 0; this.maxCombo = 0; this.comboMul = 1;
    this.energy = 0; this.slowmo = 0; this.ultCount = 0;
    this.chests = []; this.pickups = []; this.props = []; this.zones = [];
    this.evolved = {}; this.evolutionCount = 0; this.chestCount = 0;
    this.eventTimer = 32; this.activeEvent = null; this.eventCount = 0;
    this.stage = 0;
    /* v4 无尽炼狱：层状态机（wave 准备波 → boss 首领战 → 击破进入下一层，无限循环） */
    this.floor = 1; this.floorTime = 0; this.floorState = 'wave';
    this.floorWaveTime = 42; this.bossKills = 0;
    this.bossWarning = 0; this.floorScale = 1; this.enemyCap = 100;
    this.evHaste = 1; this.evSpeed = 1; this.evXp = 1; this.evScore = 1; this.evSpawn = 1;
    this._crystalT = 0; this._itemT = 14; this._lowhpT = 0;
    this._propT = 16; this._zoneT = 20; this._hazardT = 0; this._shieldT = 0;
    /* v3：决斗窗口、里程碑保底、自适应画质、重掷次数 */
    this.duelTimer = 0; this._milestoneT = 60;
    this.zoneDmg = 1; this.rerolls = 2;
    this.perfLevel = 0; this._perfLowT = 0; this._perfRecT = 0;
    this._baseFxLimit = this.fx.limit;

    var p = this.player, i, a, r;
    for (i = 0; i < 3; i++) {
      a = U.rand(0, TAU); r = U.rand(270, 620);
      this.props.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r, r: 20, hp: 60, maxHp: 60, dead: false });
    }
    this.spawnZone(p.x + U.rand(-380, 380), p.y + U.rand(-280, 280), 'buff');
    this.spawnZone(p.x + U.rand(-480, 480), p.y + U.rand(-330, 330), 'hazard');
  };

  /* ---------------- 主更新包装 ---------------- */
  G.update = function (dt) {
    if (this.state !== 'playing') return _update.call(this, dt);
    this.preUpdate(dt);
    _update.call(this, dt);
    this.postUpdate(dt);
  };

  G.preUpdate = function (dt) {
    var p = this.player, i, z;
    /* v5：DPS 采样（指数滑动平均，约 2 秒窗口）——首领血量据此自适应玩家成长 */
    var _sample = (this.dmgAcc || 0) / Math.max(dt, 0.0001);
    this.dmgAcc = 0;
    this.emaDps = (this.emaDps || 0) + (_sample - (this.emaDps || 0)) * Math.min(1, dt * 0.35);
    if (this.emaDps < 0) this.emaDps = 0;
    /* 首领每秒伤害闸门回充（上限累计 0.25 秒的量，避免蓄爆） */
    if (this.boss && !this.boss.dead && this.boss.maxDps) {
      this.boss.dmgBudget = Math.min(this.boss.maxDps * 0.25,
        (this.boss.dmgBudget || 0) + this.boss.maxDps * dt);
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.comboMul = 1; }
    }
    if (this.slowmo > 0) this.slowmo -= dt;

    /* v4：层驱动。每层先打一段准备波，时间到强制召出该层首领；
       首领被击破才进下一层（见 nextFloor），阶段配色按层循环，无终点。 */
    this.floorTime += dt;
    if (this.bossWarning > 0) this.bossWarning -= dt;
    if (this.floorState === 'wave' && this.floorTime >= this.floorWaveTime) this.spawnBoss();
    this.updateEvents(dt);

    var id = this.activeEvent ? this.activeEvent.def.id : null;
    this.evHaste = id === 'overclock' ? 0.68 : 1;
    this.evSpeed = id === 'overclock' ? 1.15 : 1;
    this.evXp = id === 'swarm' ? 1.5 : 1;
    this.evScore = id === 'storm' ? 2 : 1;
    this.evSpawn = id === 'swarm' ? 0.52 : 1;
    /* 增益力场：圈内攻速 + 伤害 + EMP 充能（回血在 updateWorldObjects） */
    this.zoneDmg = 1;
    var inBuff = false;
    for (i = 0; i < this.zones.length; i++) {
      z = this.zones[i];
      if (z.kind === 'buff' && U.dist2(p.x, p.y, z.x, z.y) < z.r * z.r) { inBuff = true; break; }
    }
    if (inBuff) {
      this.evHaste *= 0.72;
      this.zoneDmg = 1.18;
      this.energy = Math.min(100, this.energy + 3 * dt);
    }

    /* 自适应画质：连续掉帧自动降级粒子/辉光/Bloom，稳定后缓慢恢复 */
    var fps = this.fps || 60;
    if (this.enemies.length > 100) fps = Math.min(fps, 40);
    if (fps < 46) { this._perfLowT += dt; this._perfRecT = 0; }
    else {
      this._perfLowT = Math.max(0, this._perfLowT - dt * 0.6);
      if (fps > 55) this._perfRecT += dt; else this._perfRecT = 0;
    }
    if (this._perfLowT > 1.2 && this.perfLevel < 2) { this.perfLevel++; this._perfLowT = 0; }
    if (this._perfRecT > 7 && this.perfLevel > 0) { this.perfLevel--; this._perfRecT = 0; }
    this.fx.limit = Math.max(120, Math.round(this._baseFxLimit * [1, 0.5, 0.26][this.perfLevel]));
    this.fx.glow = this.quality !== 'low' && this.perfLevel === 0;

    /* 首领决斗窗口计时 + 每阶段保底稀有宝箱（保证每局都有质变手段） */
    if (this.duelTimer > 0) this.duelTimer -= dt;
    this._milestoneT -= dt;
    if (this._milestoneT <= 0) {
      this._milestoneT = Math.max(34, 60 - ((this.floor || 1) - 1) * 3);
      var ma = U.rand(0, TAU);
      this.spawnChest(p.x + Math.cos(ma) * 90, p.y + Math.sin(ma) * 90, 2);
      this.onEvent('toast', { text: '阶段奖励 // 稀有宝箱已投放', long: true });
    }

    if (this.input.consume('KeyQ')) this.tryUltimate();

    if (p.hp / p.maxHp < 0.3) {
      this._lowhpT -= dt;
      if (this._lowhpT <= 0) { A.play('lowhp'); this._lowhpT = 1.1; }
    }
    if (id === 'crystal') {
      this._crystalT -= dt;
      if (this._crystalT <= 0) {
        this._crystalT = 1.1;
        for (i = 0; i < 3; i++) {
          var ca = U.rand(0, TAU), cr = U.rand(120, 420);
          this.spawnGem(p.x + Math.cos(ca) * cr, p.y + Math.sin(ca) * cr, U.randInt(1, 3));
        }
      }
    }
  };

  G.postUpdate = function (dt) {
    if (this.state !== 'playing') return;
    this.updateWorldObjects(dt);
  };

  /* ---------------- 世界物件 ---------------- */
  G.spawnZone = function (x, y, kind) {
    var buff = kind === 'buff';
    this.zones.push({
      x: x, y: y, r: buff ? 112 : 96, kind: kind, life: 26,
      color: buff ? '#7dffb0' : '#ff4d6d', label: buff ? '增益力场' : '警戒区'
    });
    this.fx.ring(x, y, 10, buff ? 112 : 96, buff ? '#7dffb0' : '#ff4d6d', 2, 0.6);
  };
  G.spawnPickup = function (x, y, id) {
    if (!id) id = U.pick(['magnet', 'bomb', 'heal', 'shield']);
    this.pickups.push({ x: x, y: y, id: id, life: 32 });
  };
  G.spawnChest = function (x, y, rarity) {
    if (this.chests.length >= 12) return;
    rarity = rarity || 1;
    this.chests.push({ x: x, y: y, rarity: rarity, life: 70, t: 0 });
    this.fx.ring(x, y, 6, 52, rarity >= 2 ? '#ffe14d' : '#ffc44d', 3, 0.5);
  };

  G.updateWorldObjects = function (dt) {
    var p = this.player, i, j, o;
    var zones = this.zones || [], props = this.props || [], items = this.pickups || [], chests = this.chests || [];

    /* 区域：回血 / 警戒伤害 / 过期补充 */
    for (i = 0; i < zones.length; i++) {
      var z = zones[i];
      z.life -= dt;
      if (U.dist2(p.x, p.y, z.x, z.y) < z.r * z.r) {
        if (z.kind === 'buff') p.hp = Math.min(p.maxHp, p.hp + 9 * dt);
        else {
          this._hazardT -= dt;
          if (this._hazardT <= 0) { this.hurtPlayer(6); this._hazardT = 0.9; }
        }
      }
    }
    for (i = zones.length - 1; i >= 0; i--) if (zones[i].life <= 0) zones.splice(i, 1);
    this._zoneT -= dt;
    if (this._zoneT <= 0) {
      this._zoneT = 22;
      if (zones.length < 3) {
        var za = U.rand(0, TAU), zr = U.rand(280, 640);
        this.spawnZone(p.x + Math.cos(za) * zr, p.y + Math.sin(za) * zr, Math.random() < 0.6 ? 'buff' : 'hazard');
      }
    }

    /* 数据核心补充生成 */
    this._propT -= dt;
    if (this._propT <= 0) {
      this._propT = 18;
      if (props.length < 5) {
        var pa = U.rand(0, TAU), pr = U.rand(360, 760);
        props.push({ x: p.x + Math.cos(pa) * pr, y: p.y + Math.sin(pa) * pr, r: 20, hp: 60, maxHp: 60, dead: false });
      }
    }

    /* 道具掉落 */
    this._itemT -= dt;
    if (this._itemT <= 0) {
      this._itemT = 26;
      this.spawnPickup(p.x + U.rand(-420, 420), p.y + U.rand(-320, 320));
    }

    /* 数据核心被子弹击破 */
    for (i = props.length - 1; i >= 0; i--) {
      var pr2 = props[i];
      if (pr2.dead) { props.splice(i, 1); continue; }
      for (j = this.bullets.length - 1; j >= 0; j--) {
        var b = this.bullets[j];
        var rr = pr2.r + b.r;
        if (U.dist2(b.x, b.y, pr2.x, pr2.y) < rr * rr) {
          pr2.hp -= b.damage;
          this.fx.spark(b.x, b.y, '#22e6ff', 5, 150, 0.25, 2);
          this.bullets[j] = this.bullets[this.bullets.length - 1]; this.bullets.pop();
          if (pr2.hp <= 0) { this.breakProp(pr2); props.splice(i, 1); }
          break;
        }
      }
    }

    /* 宝箱拾取 */
    for (i = chests.length - 1; i >= 0; i--) {
      var c = chests[i];
      c.life -= dt; c.t += dt;
      if (U.dist2(p.x, p.y, c.x, c.y) < 34 * 34) { this.openChest(c); chests.splice(i, 1); continue; }
      if (c.life <= 0) chests.splice(i, 1);
    }
    /* 道具拾取 */
    for (i = items.length - 1; i >= 0; i--) {
      o = items[i]; o.life -= dt;
      if (U.dist2(p.x, p.y, o.x, o.y) < 26 * 26) { this.collectPickup(o); items.splice(i, 1); continue; }
      if (o.life <= 0) items.splice(i, 1);
    }
  };

  G.breakProp = function (pr) {
    this.fx.burst(pr.x, pr.y, '#22e6ff', 22, 320);
    this.fx.ring(pr.x, pr.y, 8, 92, '#22e6ff', 4, 0.5);
    this.fx.addShake(5);
    A.play('prop');
    for (var i = 0; i < 7; i++) {
      var a = U.rand(0, TAU), r = U.rand(10, 55);
      this.spawnGem(pr.x + Math.cos(a) * r, pr.y + Math.sin(a) * r, U.randInt(2, 4));
    }
    this.score += 250;
    if (Math.random() < 0.5) this.spawnPickup(pr.x, pr.y);
    this.onEvent('toast', { text: '数据核心已破译 // +经验' });
  };

  G.collectPickup = function (o) {
    var p = this.player, def = C.pickupDefs[o.id] || { name: '未知', color: '#fff' };
    A.play('item');
    this.fx.burst(o.x, o.y, def.color, 12, 200);
    this.onEvent('toast', { text: '拾取 // ' + def.name });
    switch (o.id) {
      case 'magnet': this.magnetPull(); break;
      case 'bomb': this.screenBomb(); break;
      case 'heal': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3); break;
      case 'shield': p.invuln = Math.max(p.invuln, 3.2); break;
    }
  };
  G.magnetPull = function () {
    var p = this.player;
    for (var i = 0; i < this.gems.length; i++) {
      this.gems[i].x = U.lerp(this.gems[i].x, p.x, 0.75);
      this.gems[i].y = U.lerp(this.gems[i].y, p.y, 0.75);
    }
    this.fx.ring(p.x, p.y, 20, 340, '#a68bff', 4, 0.5);
    this.fx.addFlash(0.15, '168,139,255');
  };
  G.screenBomb = function () {
    var p = this.player, R = Math.max(this.W, this.H) * 0.62;
    this.fx.ring(p.x, p.y, 20, R, '#ffc44d', 7, 0.55);
    this.fx.addFlash(0.35, '255,196,77');
    this.fx.addShake(11); this.fx.punch(0.035);
    A.play('ultimate');
    this.eBullets.length = 0;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead || U.dist2(p.x, p.y, e.x, e.y) >= R * R) continue;
      /* v5：炸弹不再直接抹掉首领（这正是「boss 一出场就没了」的元凶之一），
         改为按血量百分比重击，仍受首领每秒伤害闸门约束 */
      if (e.boss) this.damageEnemy(e, e.maxHp * 0.06, '#ffc44d', e.x - p.x, e.y - p.y, 120);
      else this.killEnemy(e);
    }
    this.hitstop = 0.05;
  };

  /* ---------------- 主动技：EMP 过载 ---------------- */
  G.tryUltimate = function () {
    if (this.energy < 100 || this.state !== 'playing') return;
    var p = this.player;
    this.energy = 0; this.ultCount++;
    var R = Math.max(this.W, this.H) * 0.72;
    this.fx.ring(p.x, p.y, 20, R, '#7df9ff', 9, 0.65);
    this.fx.ring(p.x, p.y, 10, R * 0.7, '#ffffff', 4, 0.5);
    this.fx.addFlash(0.5, '120,240,255');
    this.fx.addShake(16); this.fx.punch(0.05);
    this.hitstop = 0.09; this.slowmo = 1.8;
    A.play('ultimate');
    this.eBullets.length = 0;
    var dmg = (55 + p.level * 7) * (this.hex ? this.hex.empDmgMul : 1);
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.dead && U.dist2(p.x, p.y, e.x, e.y) < R * R) {
        this.damageEnemy(e, dmg, '#7df9ff', e.x - p.x, e.y - p.y, 180);
      }
    }
    this.onEvent('toast', { text: 'EMP 过载 // 全域净化', long: true });
    this.onEvent('ult', {});
  };

  /* ---------------- 宝箱 / 进化 / 奖励 ---------------- */
  G.rollLoot = function () {
    var total = 0, i;
    for (i = 0; i < C.loot.length; i++) total += C.loot[i].weight;
    var r = Math.random() * total;
    for (i = 0; i < C.loot.length; i++) { r -= C.loot[i].weight; if (r <= 0) return C.loot[i]; }
    return C.loot[0];
  };
  G.applyLoot = function (id) {
    var p = this.player, i;
    switch (id) {
      case 'xp':
        for (i = 0; i < 6; i++) {
          var a = U.rand(0, TAU), r = U.rand(25, 80);
          this.spawnGem(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, U.randInt(2, 5));
        }
        break;
      case 'heal': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3); break;
      case 'magnet': this.magnetPull(); break;
      case 'bomb': this.screenBomb(); break;
      case 'energy': this.energy = Math.min(100, this.energy + 45); break;
      case 'score': this.score += 600; break;
      case 'weapon':
        if (p.weapons.length) {
          var w = U.pick(p.weapons), d = D.weaponById[w.id];
          if (d && w.level < d.max) w.level++;
        }
        break;
      case 'shield': p.invuln = Math.max(p.invuln, 3.5); break;
    }
  };
  G.findEvolutionReady = function () {
    var p = this.player;
    for (var i = 0; i < C.evolutions.length; i++) {
      var ev = C.evolutions[i];
      if (this.evolved[ev.weapon]) continue;
      for (var j = 0; j < p.weapons.length; j++) {
        var w = p.weapons[j];
        if (w.id === ev.weapon && w.level >= D.evolutionReadyLevel && (p.passives[ev.passive] || 0) >= 1) return ev;
      }
    }
    return null;
  };
  G.applyEvolution = function (ev) {
    this.evolved[ev.weapon] = true;
    this.evolutionCount++;
    var p = this.player;
    for (var i = 0; i < p.weapons.length; i++) {
      if (p.weapons[i].id === ev.weapon) { p.weapons[i].evolved = true; break; }
    }
    p.dmgMul *= 1.18; p.maxHp += 15; p.hp = Math.min(p.maxHp, p.hp + 15);
    this.fx.text(p.x, p.y - 40, ev.name, ev.color, 22, true);
    this.fx.ring(p.x, p.y, 10, 150, ev.color, 5, 0.7);
    this.fx.addFlash(0.4, '255,255,255');
    A.play('evolve');
    this.onEvent('toast', { text: '超武进化 // ' + ev.name, long: true });
  };
  G.openChest = function (c) {
    this.chestCount++;
    var rewards = [];
    var n = c.rarity >= 2 ? U.randInt(2, 4) : U.randInt(1, 3);
    var ev = this.findEvolutionReady();
    if (ev && Math.random() < 0.8) {
      this.applyEvolution(ev);
      rewards.push({ name: '武器进化 // ' + ev.name, color: ev.color });
      n--;
    }
    for (var i = 0; i < n; i++) {
      var loot = this.rollLoot();
      this.applyLoot(loot.id);
      rewards.push({ name: loot.name, color: loot.color });
    }
    this.fx.burst(c.x, c.y, '#ffe14d', 26, 320);
    this.fx.ring(c.x, c.y, 8, 112, '#ffe14d', 5, 0.55);
    this.fx.addFlash(0.3, '255,225,77');
    this.fx.addShake(6); this.fx.punch(0.025);
    this.hitstop = 0.05;
    A.play('chest');
    this.onEvent('chest', { rewards: rewards, rarity: c.rarity });
  };

  /* ---------------- 随机事件 / 阶段 ---------------- */
  G.updateEvents = function (dt) {
    if (this.activeEvent) {
      this.activeEvent.left -= dt;
      if (this.activeEvent.left <= 0) {
        this.onEvent('eventEnd', {});
        this.activeEvent = null;
      }
    } else {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) { this.startEvent(); this.eventTimer = 45; }
    }
  };
  G.startEvent = function () {
    var def = U.pick(C.events);
    this.activeEvent = { def: def, left: def.dur, total: def.dur };
    this.eventCount++;
    A.play('event');
    this.fx.addFlash(0.16, '255,255,255');
    this.onEvent('event', { name: def.name, text: def.text, color: def.color, duration: def.dur });
  };

  /* ---------------- 战斗反馈包装 ---------------- */
  G.damageEnemy = function (e, dmg, color, kx, ky, knock) {
    if (e.dead) return;
    var p = this.player;
    dmg *= this.zoneDmg || 1;   // 增益力场内的伤害加成
    /* v4：首领单次受伤上限（约 29 次有效命中才击破），后期超高 DPS 也不会把 BOSS 瞬秒到看不见 */
    if (e.boss) dmg = Math.min(dmg, Math.max(1, e.maxHp * 0.035));
    /* 护盾兵：正面来的攻击大幅减伤，逼玩家绕后或用范围武器 */
    if (e.type === 'shield') {
      var fxv = p.x - e.x, fyv = p.y - e.y, fl = U.hypot(fxv, fyv) || 1;
      var hl = U.hypot(kx, ky) || 1;
      var dot = (fxv / fl) * (kx / hl) + (fyv / fl) * (ky / hl);
      if (dot < -0.35) {
        dmg *= 0.28;
        if (!this._shieldT || this.time > this._shieldT) {
          A.play('shield'); this._shieldT = this.time + 0.25;
        }
        this.fx.spark(e.x, e.y, '#bfe4ff', 4, 120, 0.25, 2);
      }
    }
    /* 分级顿帧：只有重击 / 首领命中才短暂冻结，避免每次命中都卡顿 */
    var heavy = dmg > 55 || e.boss;
    if (heavy && Math.random() < 0.22) {
      this.hitstop = Math.max(this.hitstop, 0.028);
      this.fx.addShake(1.4, kx, ky);
    }
    return _damageEnemy.call(this, e, dmg, color, kx, ky, knock);
  };

  G.killEnemy = function (e) {
    if (e.dead) return;
    var wasBoss = e.boss, wasElite = e.elite, ex = e.x, ey = e.y, etype = e.type;
    _killEnemy.call(this, e);

    this.combo++; this.comboTimer = 3.2;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.comboMul = 1 + Math.min(2, Math.floor(this.combo / 8) * 0.5);
    this.score += Math.round(e.score * (this.comboMul - 1) * this.evScore);
    /* v4：小怪给的能量减半（3.2→1.7），EMP 不再能靠割草无限刷屏 */
    this.energy = Math.min(100, this.energy + (wasBoss ? 34 : (wasElite ? 9 : 1.7)));

    if (this.combo > 1 && this.combo % 4 === 0) A.play('combo', this.combo);
    if (this.combo === 15 || this.combo === 30 || this.combo === 60) {
      this.fx.text(ex, ey - 34, this.combo + ' COMBO', '#ffe14d', 20, true);
      this.fx.ring(ex, ey, 10, 92, '#ffe14d', 3, 0.5);
      this.fx.punch(0.02);
    }
    var evId = this.activeEvent ? this.activeEvent.def.id : null;
    if (wasBoss || wasElite || (evId === 'elite' && Math.random() < 0.12)) {
      this.spawnChest(ex, ey, wasBoss ? 2 : 1);
    }
    if (etype === 'bomber' && !e.exploded) this.bomberExplode(e, true);
    if (wasBoss) { this.fx.punch(0.05); this.nextFloor(); }
    else if (wasElite) this.fx.punch(0.02);
  };

  G.bomberExplode = function (e, alreadyDead) {
    if (e.exploded) return;
    e.exploded = true;
    if (!alreadyDead) e.dead = true;
    var p = this.player, R = 78;
    this.fx.ring(e.x, e.y, 6, R, '#ffb03a', 5, 0.42);
    this.fx.burst(e.x, e.y, '#ffb03a', 18, 300);
    this.fx.smoke(e.x, e.y, '#8a5a20', 5);
    this.fx.addShake(7);
    A.play('explode');
    this.spawnGem(e.x, e.y, 1);
    if (U.dist2(e.x, e.y, p.x, p.y) < (R + p.radius) * (R + p.radius)) this.hurtPlayer(14);
    for (var i = 0; i < this.enemies.length; i++) {
      var o = this.enemies[i];
      if (o.dead || o === e) continue;
      if (U.dist2(e.x, e.y, o.x, o.y) < (R + o.radius) * (R + o.radius)) {
        o.hp -= 18; o.hitFlash = 0.08;
        if (o.hp <= 0) this.killEnemy(o);
      }
    }
  };

  G.collectGem = function (g) {
    g.value = Math.max(1, Math.round(g.value * this.evXp * (1 + (this.comboMul - 1) * 0.35)));
    return _collectGem.call(this, g);
  };

  G.hurtPlayer = function (amount) {
    var p = this.player;
    if (p.invuln > 0 || p.dashTime > 0 || this.state !== 'playing') return;
    _hurtPlayer.call(this, amount);
    this.fx.punch(0.025);
  };

  /* EMP 后短时间敌人减速 */
  NS.Enemy.prototype.update = function (dt, game) {
    return _enemyUpdate.call(this, game.slowmo > 0 ? dt * 0.35 : dt, game);
  };

  /* ---------------- 刷怪 / 首领（v4 无尽炼狱：逐层递增） ---------------- */
  G.spawnWave = function () {
    var t = this.time, p = this.player, f = this.floor || 1;
    var tier = U.clamp(Math.min(5, Math.floor((f - 1) / 2) + Math.floor(t / 180)), 0, 5);
    /* 密度上限按层微增但封顶 140：强度靠单体成长，不靠堆数量，避免卡顿与围死 */
    var cap = this.enemyCap || 100;
    var budget = cap - this.enemies.length;
    if (budget <= 0) return;
    var n = Math.min(5, 1 + Math.floor((f - 1) / 2) + (Math.random() < 0.30 ? 1 : 0));
    var evId = this.activeEvent ? this.activeEvent.def.id : null;
    if (evId === 'swarm') n += 2;
    if (this.duelTimer > 0) n = Math.min(n, 2);   // 首领战压制刷怪
    n = Math.min(n, budget);
    var diag = U.hypot(this.W, this.H) * 0.62;
    var eliteChance = evId === 'elite' ? 0.30 : Math.min(0.22, 0.02 + (f - 1) * 0.025);
    /* 单体 HP / 移速 / 接触伤害按层成长（统一曲线 NS.floorScale） */
    var sc = NS.floorScale(f);
    for (var i = 0; i < n; i++) {
      var a = U.rand(0, TAU), dist = diag + U.rand(50, 190);
      var type = this.rollEnemyType(tier);
      if (f >= 2 && Math.random() < 0.14) type = 'charger';
      if (f >= 3 && Math.random() < 0.12) type = 'bomber';
      if (f >= 3 && Math.random() < 0.10) type = 'shield';
      if (evId === 'storm' && Math.random() < 0.30) type = 'shooter';
      var e = new NS.Enemy(type, p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist,
        sc.hp, sc.speed, sc.damage);
      if (Math.random() < eliteChance) e.makeElite();
      this.enemies.push(e);
    }
  };

  /* 击破首领 → 进入下一层：层数无上限，奖励与场景同时刷新 */
  G.nextFloor = function () {
    var p = this.player;
    this.bossKills++;
    this.floor++;
    this.floorTime = 0;
    this.floorState = 'wave';
    this.floorWaveTime = Math.max(26, 42 - (this.floor - 1) * 1.4);
    this.floorScale = NS.floorScale(this.floor).hp;
    this.enemyCap = Math.min(140, 100 + (this.floor - 1) * 5);
    this.stage = (this.floor - 1) % C.stages.length;
    this.eBullets.length = 0;
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.28);
    p.invuln = Math.max(p.invuln, 1.2);
    this.energy = Math.min(100, this.energy + 45);
    this.score += 1200 * (this.floor - 1);
    var ma = U.rand(0, TAU);
    this.spawnChest(p.x + Math.cos(ma) * 80, p.y + Math.sin(ma) * 80, 2);
    this.fx.addFlash(0.35, '120,255,220');
    this.fx.ring(p.x, p.y, 20, 260, '#7dffb0', 5, 0.7);
    A.play('levelup');
    this.onEvent('floorClear', { floor: this.floor - 1, next: this.floor, bossKills: this.bossKills });
    this.onEvent('toast', {
      text: '第 ' + (this.floor - 1) + ' 层净化完成 // 进入第 ' + this.floor + ' 层 · 敌群与首领强化',
      long: true
    });
  };

  G.spawnBoss = function () {
    var p = this.player, i;
    if (this.floorState === 'boss' && this.boss && !this.boss.dead) return;
    this.bossIndex++;
    var f = this.floor || 1;
    this.floorState = 'boss';
    this.floorTime = 0;
    this.enemyCap = Math.min(140, 100 + (f - 1) * 5);
    var a = U.rand(0, TAU), dist = U.hypot(this.W, this.H) * 0.45;
    /* v5：首领强度 = 指数基准 × 玩家实测输出包络
       - 指数基准 2.2×1.32^(层-1)：保证低层 / 低输出时也有成长曲线
       - 玩家 DPS 包络：血量至少追平「DPS × 目标时长」，且不超过其 1.45 倍，
         否则深层的 1.32^n 会把血量抬成天文数字，一场首领战打十几分钟。 */
    var wantSec = Math.min(26, 10 + f * 1.0);            // 目标交战秒数：越往后越久
    var hpMul = 2.2 * Math.pow(1.32, f - 1);
    /* v6：难度与契约倍率在这里一次性算进血量，bossIncoming 事件拿到的就是最终数值，
       避免上层再改血条造成重复警报。 */
    var dif = this.diff || null;
    if (dif) hpMul *= dif.bossHp;
    hpMul *= (this.contractBossHp || 1);
    var dps = this.emaDps || 0;
    if (dps > 10) {
      var target = dps * wantSec * 0.40 / 1000;           // 首领基础血 1000
      /* 夹在「目标值 0.75 ~ 1.3 倍」之间：太高会打成持久战，太低会被秒 */
      hpMul = Math.min(Math.max(hpMul, target * 0.75), target * 1.30);
    }
    /* 同一局内每层至少 +12%：即使玩家这层输出没涨，首领也会缓慢变强 */
    if (this._lastBossHp > 0) {
      var monotonic = this._lastBossHp * 1.12 / 1000;
      if (hpMul < monotonic) hpMul = monotonic;
    }
    var spdMul = Math.min(1.85, 1 + (f - 1) * 0.075);
    var dmgMul = Math.min(4.2, 1 + (f - 1) * 0.26) * (dif ? dif.bossDmg : 1);
    var e = new NS.Enemy('boss', p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist,
      hpMul, spdMul, dmgMul);
    e.fs = f; e.floor = f;
    e.radius = 52 * Math.min(1.5, 1 + (f - 1) * 0.035);
    e.name = (NS.bossName ? NS.bossName(f) : D.bossNames[(f - 1) % D.bossNames.length]) + ' · L' + f;
    /* v12：本函数覆盖了 game.js 的 spawnBoss。原先只按 4 取模轮换 4 种造型，深层必然重复；
       现在改为「按层号确定性生成基因」：骨架族 4 选 1，再叠体型/配色/眼数/牙数/腿数/节数/
       触手/角冠/斑纹/棘刺等十来个参数，同一层恒定、不同层unique，无限层都有新样子。 */
    var dna = NS.bossDNA ? NS.bossDNA(f) : null;
    e.dna = dna;
    e.arch = dna ? dna.fam : (f - 1) % 4;
    e.gen = dna ? dna.gen : Math.floor((f - 1) / 4);
    if (dna) e.color = dna.color;
    /* v5：奖励随血量同步指数成长，避免「打半天只掉几颗宝石」 */
    var hpk = Math.pow(Math.max(1, hpMul) / 2.2, 0.36);
    e.xp = Math.round(70 * hpk);
    e.score = Math.round(1200 * Math.pow(hpk, 1.25));
    /* v5：每秒伤害闸门 —— 原先「单次受伤上限 3.5% 血量」等于打中 29 下必死，
       堆血毫无意义。改成按秒限伤后，血量才有意义，交战时长稳定在 wantSec 附近。 */
    e.maxDps = e.maxHp / (wantSec * 1.15);
    e.dmgBudget = e.maxDps * 0.12;
    e.wantSec = wantSec;
    this._lastBossHp = e.maxHp;
    this.bossStartAt = this.time;
    /* v6 首领词缀：第 2 层起随机附带，层数越深越多；同步写进实体供战斗层读取 */
    var affList = NS.rollBossAffixes ? NS.rollBossAffixes(f, dif ? dif.id : 'normal') : [];
    e.aff = {}; e.affList = affList;
    for (var ai = 0; ai < affList.length; ai++) e.aff[affList[ai].id] = 1;
    this.enemies.push(e); this.boss = e;

    /* 决斗领域只推开一圈并短时压制刷怪，保留小怪陪衬，BOSS 不再孤立被秒 */
    this.duelTimer = 6;
    var R = 240, R2 = R * R;
    for (i = 0; i < this.enemies.length; i++) {
      var o = this.enemies[i];
      if (o.dead || o === e || o.boss) continue;
      var dx = o.x - p.x, dy = o.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        var dd = Math.sqrt(d2) || 1;
        var push = (R - dd) * 1.25;
        o.x += dx / dd * push; o.y += dy / dd * push;
        o.kx += dx / dd * 220; o.ky += dy / dd * 220;
      }
    }
    this.fx.ring(p.x, p.y, 60, R, '#ff2f8e', 3, 0.8);
    this.fx.addFlash(0.45, '255,60,140');
    this.fx.addShake(11);
    this.bossWarning = 2.8;
    A.play('boss'); A.play('warning');
    this.onEvent('bossIncoming', {
      floor: f, name: e.name, hp: e.maxHp, damage: e.damage, scale: +hpMul.toFixed(2),
      affixes: affList.map(function (a) { return a.name; })
    });
    /* 横幅已经承载层数/名字/血量，toast 只给战术提示，避免重复刷屏 */
    this.onEvent('toast', {
      text: '决斗领域展开 // 6 秒压制刷怪 · 击破首领进入下一层',
      danger: true, long: true
    });
  };

  /* ---------------- 武器：进化效果 + 事件攻速 ---------------- */
  G.updateWeapons = function (dt) {
    var p = this.player, i, w;
    var saved = p.haste;
    p.haste = saved * this.evHaste;
    for (i = 0; i < p.weapons.length; i++) {
      w = p.weapons[i];
      if (w.id === 'orbit') continue;
      w.timer -= dt;
      if (w.timer <= 0) {
        var base = { pulse: 0.62, laser: 2.15, chain: 1.55, nova: 2.70, missile: 1.40 }[w.id] || 1;
        var lvBonus = { pulse: 0.055, laser: 0.100, chain: 0.080, nova: 0.090, missile: 0.070 }[w.id] || 0;
        w.timer = Math.max(0.06, base / (1 + lvBonus * (w.level - 1)) * p.haste);
        this.fire(w);
      }
    }
    p.haste = saved;

    var ow = null;
    for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === 'orbit') ow = p.weapons[i];
    if (!ow) { this.blades.length = 0; return; }
    var evoOrbit = !!this.evolved.orbit;
    var count = Math.min(12, 2 + Math.floor((ow.level + 1) / 2) + Math.floor(p.extraProj / 2) + (evoOrbit ? 3 : 0));
    while (this.blades.length < count) this.blades.push({ a: 0, x: 0, y: 0, r: 13, hit: Object.create(null) });
    while (this.blades.length > count) this.blades.pop();
    this._orbitAngle += dt * (2.2 + ow.level * 0.12 + (evoOrbit ? 1.1 : 0));
    var R = 78 + ow.level * 7 + (evoOrbit ? 22 : 0);
    for (i = 0; i < count; i++) {
      var b = this.blades[i];
      b.a = this._orbitAngle + i * TAU / count;
      b.x = p.x + Math.cos(b.a) * R;
      b.y = p.y + Math.sin(b.a) * R;
    }
  };

  G.hitBlades = function () {
    var ow = null, p = this.player, i;
    for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === 'orbit') ow = p.weapons[i];
    if (!ow) return;
    var dmg = (7 + 3 * (ow.level - 1)) * p.dmgMul * (this.evolved.orbit ? 1.7 : 1);
    for (var b = 0; b < this.blades.length; b++) {
      var bl = this.blades[b];
      var list = this.grid.query(bl.x, bl.y, bl.r + 34, this._bladeTmp);
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (e.dead || (bl.hit[e.id] && this.time < bl.hit[e.id])) continue;
        var rr = bl.r + e.radius;
        if (U.dist2(bl.x, bl.y, e.x, e.y) < rr * rr) {
          bl.hit[e.id] = this.time + 0.34;
          this.damageEnemy(e, dmg, '#b6ff3c', e.x - bl.x, e.y - bl.y, 130);
        }
      }
    }
  };

  G.fire = function (w) {
    var p = this.player, fx = this.fx, L = w.level, i;
    var evo = !!this.evolved[w.id];
    var target = this.nearestEnemy(p.x, p.y, 950);
    var ang = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.facing;
    p.facing = ang;
    var dmg;

    switch (w.id) {
      case 'pulse': {
        var count = 1 + p.extraProj + (L >= 4 ? 1 : 0) + (L >= 7 ? 1 : 0) + (evo ? 2 : 0);
        var spread = count > 1 ? 0.13 : 0;
        dmg = (9 + 4 * (L - 1)) * p.dmgMul * (evo ? 1.3 : 1);
        for (i = 0; i < count; i++) {
          var a = ang + (i - (count - 1) / 2) * spread;
          this.addBullet({
            x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
            vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
            r: evo ? 6 : 5, damage: dmg,
            pierce: (L >= 5 ? 1 : 0) + (evo ? 1 : 0),
            color: evo ? '#8bf6ff' : '#22e6ff', life: 1.5, kind: 'pulse'
          });
        }
        A.play('shoot');
        break;
      }
      case 'missile': {
        var mn = 1 + Math.floor(p.extraProj / 2) + (L >= 6 ? 1 : 0) + (evo ? 2 : 0);
        dmg = (24 + 8 * (L - 1)) * p.dmgMul * (evo ? 1.5 : 1);
        for (i = 0; i < mn; i++) {
          var ma = ang + (i - (mn - 1) / 2) * 0.5 + U.rand(-0.12, 0.12);
          this.addBullet({
            x: p.x + Math.cos(ma) * 16, y: p.y + Math.sin(ma) * 16,
            vx: Math.cos(ma) * 330, vy: Math.sin(ma) * 330,
            r: 6, damage: dmg, pierce: 0, color: evo ? '#ffd87a' : '#ffc44d',
            life: 2.4, kind: 'missile', expR: (52 + 6 * L) * (evo ? 1.8 : 1)
          });
        }
        break;
      }
      case 'laser': {
        var len = 720;
        var x2 = p.x + Math.cos(ang) * len, y2 = p.y + Math.sin(ang) * len;
        var wid = evo ? 12 : 7;
        fx.beam(p.x, p.y, x2, y2, evo ? '#ff77d0' : '#ff3cac', wid, 0.22);
        fx.ring(p.x, p.y, 8, 42, '#ff3cac', 2, 0.24);
        fx.addShake(1.5);
        dmg = (22 + 9 * (L - 1)) * p.dmgMul * (evo ? 1.8 : 1);
        this.lineDamage(p.x, p.y, x2, y2, 15 * (evo ? 1.6 : 1), dmg, '#ff3cac');
        if (L >= 5 || evo) {
          var b2x = p.x - Math.cos(ang) * len, b2y = p.y - Math.sin(ang) * len;
          fx.beam(p.x, p.y, b2x, b2y, '#ff3cac', wid * 0.75, 0.22);
          this.lineDamage(p.x, p.y, b2x, b2y, 12 * (evo ? 1.6 : 1), dmg * 0.8, '#ff3cac');
        }
        A.play('explode');
        break;
      }
      case 'chain': {
        var cur = this.nearestEnemy(p.x, p.y, 540);
        if (!cur) break;
        var jumps = 2 + Math.floor(L / 2) + (evo ? 4 : 0);
        var hit = Object.create(null), from = { x: p.x, y: p.y };
        var cdmg = (16 + 6 * (L - 1)) * p.dmgMul * (evo ? 1.8 : 1);
        for (var s = 0; s < jumps && cur; s++) {
          fx.arc(from.x, from.y, cur.x, cur.y, evo ? '#fff36b' : '#f5ff5c', 0.2, 3.5);
          fx.spark(cur.x, cur.y, '#f5ff5c', 6, 170, 0.3, 2.5);
          this.damageEnemy(cur, cdmg * Math.pow(0.85, s), '#f5ff5c', cur.x - from.x, cur.y - from.y, 55);
          hit[cur.id] = 1;
          from = cur;
          var best = null, bd = 300 * 300;
          for (i = 0; i < this.enemies.length; i++) {
            var ee = this.enemies[i];
            if (ee.dead || hit[ee.id]) continue;
            var dd = U.dist2(cur.x, cur.y, ee.x, ee.y);
            if (dd < bd) { bd = dd; best = ee; }
          }
          cur = best;
        }
        break;
      }
      case 'nova': {
        var R = 95 + 14 * L + (evo ? 45 : 0);
        fx.ring(p.x, p.y, 10, R, '#8b7cff', 5, 0.42);
        fx.spark(p.x, p.y, '#b9a8ff', 18, R * 2.2, 0.4, 3);
        fx.addShake(2.5);
        dmg = (18 + 8 * (L - 1)) * p.dmgMul * (evo ? 1.6 : 1);
        for (i = 0; i < this.enemies.length; i++) {
          var ne = this.enemies[i];
          if (ne.dead) continue;
          var nd = U.dist2(p.x, p.y, ne.x, ne.y);
          if (nd < (R + ne.radius) * (R + ne.radius)) {
            if (evo) { /* 奇点牵引 */
              var nl = U.hypot(p.x - ne.x, p.y - ne.y) || 1;
              ne.kx += (p.x - ne.x) / nl * 160;
              ne.ky += (p.y - ne.y) / nl * 160;
            }
            this.damageEnemy(ne, dmg, '#8b7cff', ne.x - p.x, ne.y - p.y, 260);
          }
        }
        break;
      }
    }
  };

  /* ---------------- 升级卡提示 / HUD / 结算 ---------------- */
  G.getChoices = function () {
    var out = _getChoices.call(this), p = this.player;
    for (var i = 0; i < out.length; i++) {
      var c = out[i];
      if (c.kind === 'weaponUp' || c.kind === 'weaponNew') {
        var ev = C.evoByWeapon[c.id], ps = ev ? D.passiveById[ev.passive] : null;
        if (ev && !this.evolved[c.id] && ps && (p.passives[ev.passive] || 0) > 0) {
          c.evoHint = '已具备「' + ps.name + '」· 宝箱可进化为 ' + ev.name;
        } else if (ev && !this.evolved[c.id] && ps) {
          c.evoHint = '进化需要：LV' + D.evolutionReadyLevel + ' + 「' + ps.name + '」';
        }
      }
    }
    return out;
  };

  G.getHud = function () {
    var d = _getHud.call(this), i;
    d.combo = this.combo; d.comboMul = this.comboMul; d.maxCombo = this.maxCombo;
    d.energy = this.energy;
    d.stage = this.stage;
    d.stageName = C.stages[d.stage] ? C.stages[d.stage].name : '';
    d.stageSub = C.stages[d.stage] ? C.stages[d.stage].sub : '';
    /* v4：阶段条在准备波显示「距首领还有多久」，首领战显示「首领已削血量」 */
    d.stageProgress = this.floorState === 'boss'
      ? U.clamp(this.boss && !this.boss.dead ? 1 - this.boss.hp / this.boss.maxHp : 0, 0, 1)
      : U.clamp((this.floorTime || 0) / (this.floorWaveTime || 42), 0, 1);
    d.event = this.activeEvent ? {
      name: this.activeEvent.def.name, text: this.activeEvent.def.text,
      color: this.activeEvent.def.color, left: this.activeEvent.left, total: this.activeEvent.total
    } : null;
    d.evolutionCount = this.evolutionCount;
    d.chestCount = this.chestCount;
    d.ultReady = this.energy >= 100;
    d.hex = this.hexSummary ? this.hexSummary() : null;
    d.rerolls = this.rerolls;
    d.perfLevel = this.perfLevel;
    d.enemyCount = this.enemies.length;
    d.duelTimer = this.duelTimer;
    d.hpRatio = this.player.hp / this.player.maxHp;
    /* v4 无尽层数据 */
    d.floor = this.floor || 1;
    d.floorState = this.floorState || 'wave';
    d.floorTime = this.floorTime || 0;
    d.floorWaveTime = this.floorWaveTime || 42;
    d.floorLeft = this.floorState === 'wave'
      ? Math.max(0, (this.floorWaveTime || 42) - (this.floorTime || 0)) : 0;
    d.bossWarning = this.bossWarning || 0;
    d.bossKills = this.bossKills || 0;
    d.enemyCap = this.enemyCap || 100;
    d.endless = true;
    for (i = 0; i < d.weapons.length; i++) {
      var ev = C.evoByWeapon[d.weapons[i].id];
      if (ev && this.evolved[d.weapons[i].id]) {
        d.weapons[i].name = ev.name; d.weapons[i].icon = ev.icon;
        d.weapons[i].color = ev.color; d.weapons[i].evolved = true;
      }
    }
    return d;
  };

  G.finish = function (win) {
    if (this.state === 'result') return;
    this.state = 'result';
    var p = this.player, best = null, i;
    for (i = 0; i < p.weapons.length; i++) if (!best || p.weapons[i].level > best.level) best = p.weapons[i];
    var bestName = '—';
    if (best) {
      var ev = C.evoByWeapon[best.id], base = D.weaponById[best.id];
      bestName = (this.evolved[best.id] && ev ? ev.name : (base ? base.name : best.id)) + ' LV' + best.level;
    }
    this.result = {
      /* v4 无尽炼狱：没有「通关」，只有阵亡；结算核心指标是抵达层数 */
      win: false, endless: true, floor: this.floor || 1, bossKills: this.bossKills || 0,
      time: this.time, kills: this.kills,
      score: Math.round(this.score), level: p.level,
      maxCombo: this.maxCombo, chests: this.chestCount,
      evolutions: this.evolutionCount, ults: this.ultCount,
      events: this.eventCount, bestWeapon: bestName,
      hexCount: this.hex ? this.hex.count : 0,
      hexItems: this.hexSummary ? this.hexSummary().items : []
    };
    A.stopMusic(); A.setPaused(false);
    A.play(win ? 'victory' : 'gameover');
    this.fx.addFlash(win ? 0.6 : 0.4, win ? '120,255,220' : '255,60,90');
    this.onEvent('result', this.result);
  };

  /* ---------------- 渲染管线（阶段背景 + 世界物件 + 镜头推近 + Bloom） ---------------- */
  G.render = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    var W = this.W, H = this.H, dpr = this.dpr, fx = this.fx;
    var sd = this.stageDef ? this.stageDef() : { bgTop: '#070b1a', bgBot: '#050811' };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, sd.bgTop); bg.addColorStop(0.55, sd.bgTop); bg.addColorStop(1, sd.bgBot);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    this.drawBackground(ctx, W, H);

    ctx.save();
    if (fx.zoom > 0.001) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(1 + fx.zoom, 1 + fx.zoom);
      ctx.translate(-W / 2, -H / 2);
    }
    ctx.translate(-this.cam.x + fx._sx, -this.cam.y + fx._sy);
    this.drawFloor(ctx);
    if (this.drawWorldObjects) this.drawWorldObjects(ctx);
    this.drawGems(ctx);
    this.drawEBullets(ctx);
    this.drawEnemies(ctx);
    this.drawBlades(ctx);
    this.drawBullets(ctx);
    this.drawPlayer(ctx);
    fx.draw(ctx);
    ctx.restore();

    fx.drawScreen(ctx, W, H);
    this.drawBossMarker(ctx, W, H);
    if (this.applyBloom) this.applyBloom(ctx, W, H);
  };
})(typeof window !== 'undefined' ? window : globalThis);
