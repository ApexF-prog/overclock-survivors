/* game.js — 主状态机、固定时间步、战斗/碰撞/波次/渲染 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, D = NS.DEFS;
  var STEP = 1 / 60;
  /* v4 无尽炼狱：没有固定通关时间，难度由「层」驱动（层状态机在 systems.js） */
  var TAU = U.TAU;

  var BASE_CD = {
    pulse:   function (l) { return 0.62 / (1 + 0.055 * (l - 1)); },
    laser:   function (l) { return 2.15 / (1 + 0.100 * (l - 1)); },
    chain:   function (l) { return 1.55 / (1 + 0.080 * (l - 1)); },
    nova:    function (l) { return 2.70 / (1 + 0.090 * (l - 1)); },
    missile: function (l) { return 1.40 / (1 + 0.070 * (l - 1)); }
  };

  function segDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    var t = l2 ? U.clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
    return U.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function rm(arr, i) { arr[i] = arr[arr.length - 1]; arr.pop(); }

  function Game(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    this.onEvent = opts.onEvent || function () {};
    this.volume = opts.volume == null ? 0.6 : opts.volume;
    this.quality = opts.quality || 'high';
    this.input = new U.Input();
    if (opts.bindInput !== false && root.addEventListener) this.input.init();
    this.fx = new NS.FX(this.quality);
    this.W = root.innerWidth || 1280;
    this.H = root.innerHeight || 720;
    this.dpr = 1;
    this.cam = { x: 0, y: 0 };
    this.grid = new U.SpatialHash(90);
    this._near = []; this._find = []; this._sepTmp = []; this._bladeTmp = [];
    this.state = 'menu';
    this.hitstop = 0; this.acc = 0; this.last = 0;
    this.fps = 60; this._fpsAcc = 0; this._fpsFrames = 0;
    this._menuT = 0;
    this.stars = [];
    for (var i = 0; i < 170; i++) {
      this.stars.push({ x: U.rand(-2600, 2600), y: U.rand(-2000, 2000), z: U.rand(0.2, 1), s: U.rand(0.6, 1.9) });
    }
    this.resize();
    this.reset();
    this.manualTick = !!opts.manualTick;
    var self = this;
    this._loop = function (ts) { self.tick(ts); };
    if (root.requestAnimationFrame && !this.manualTick) this._raf = root.requestAnimationFrame(this._loop);
  }

  Game.WIN_TIME = Infinity;   // 兼容旧字段：无尽模式无终点

  Game.prototype.resize = function () {
    var w = root.innerWidth || 1280, h = root.innerHeight || 720;
    var dpr = Math.min(root.devicePixelRatio || 1, this.quality === 'low' ? 1 : 2);
    this.W = w; this.H = h; this.dpr = dpr;
    if (this.canvas) {
      this.canvas.width = Math.max(1, Math.floor(w * dpr));
      this.canvas.height = Math.max(1, Math.floor(h * dpr));
      if (this.canvas.style) { this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; }
    }
  };
  Game.prototype.setQuality = function (q) {
    this.quality = q; this.fx.setQuality(q); this.resize();
  };
  Game.prototype.setVolume = function (v) { this.volume = v; NS.Audio.setVolume(v); };
  Game.prototype.setShake = function (on) { this.fx.shakeEnabled = !!on; };
  Game.prototype.setFxPower = function (v) { this.fx.setPower(v); };

  Game.prototype.reset = function () {
    var p = this.player = new NS.Player(0, 0);
    p.weapons.push({ id: 'pulse', level: 1, timer: 0.2 });
    this.enemies = []; this.bullets = []; this.eBullets = []; this.gems = []; this.blades = [];
    this.fx.clear();
    this.time = 0; this.kills = 0; this.score = 0; this.wave = 1;
    this.spawnTimer = 0.6; this.nextBoss = Infinity; this.bossIndex = 0; this.boss = null;
    this.pendingLevels = 0; this._choices = null; this.result = null;
    this._orbitAngle = 0;
    /* v5：实测输出（指数滑动平均 DPS），供首领血量自适应 —— 玩家越强，首领越厚 */
    this.dmgAcc = 0; this.emaDps = 0; this._lastBossHp = 0; this.bossStartAt = 0;
    this.hitstop = 0; this.acc = 0;
    this.cam.x = p.x - this.W / 2; this.cam.y = p.y - this.H / 2;
  };

  Game.prototype.start = function () {
    this.reset();
    this.state = 'playing';
    NS.Audio.init(this.volume);
    NS.Audio.resume();
    NS.Audio.setPaused(false);
    NS.Audio.duckMusic(false);
    NS.Audio.battleMusic(this.floor || 1);
    NS.Audio.play('start');
    this.onEvent('start', {});
  };
  Game.prototype.pause = function () {
    if (this.state === 'playing') {
      this.state = 'paused'; NS.Audio.setPaused(true); this.onEvent('pause', {});
    } else if (this.state === 'paused') this.resume();
  };
  Game.prototype.resume = function () {
    if (this.state === 'paused') {
      this.state = 'playing'; NS.Audio.setPaused(false); this.onEvent('resume', {});
    }
  };
  Game.prototype.toMenu = function () {
    this.state = 'menu'; NS.Audio.stopMusic(); NS.Audio.setPaused(false);
    this.reset(); this.onEvent('menu', {});
  };
  Game.prototype.tryDash = function () {
    var p = this.player;
    if (p.dashCd > 0 || this.state !== 'playing') return;
    var a = this.input.axis();
    var ang = (Math.abs(a.x) + Math.abs(a.y) > 0.05) ? Math.atan2(a.y, a.x) : p.facing;
    p.vx = Math.cos(ang) * p.speed * 3.4;
    p.vy = Math.sin(ang) * p.speed * 3.4;
    p.dashTime = 0.17; p.dashCd = p.dashCdMax; p.invuln = Math.max(p.invuln, 0.42);
    /* v3：冲刺撞开贴身敌群，被包围时有真正的脱身手段 */
    var R = 92, R2 = R * R;
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      var dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        var dd = Math.sqrt(d2) || 1;
        e.kx += dx / dd * (e.boss ? 160 : 520);
        e.ky += dy / dd * (e.boss ? 160 : 520);
        e.hitFlash = Math.max(e.hitFlash, 0.08);
      }
    }
    this.fx.ring(p.x, p.y, 8, R, '#22e6ff', 3, 0.3);
    this.fx.spark(p.x, p.y, '#22e6ff', 14, 240, 0.4, 3);
    NS.Audio.play('dash');
  };
  Game.prototype.finish = function (win) {
    if (this.state === 'result') return;
    this.state = 'result';
    this.result = {
      win: !!win, time: this.time, kills: this.kills,
      score: Math.round(this.score), level: this.player.level
    };
    NS.Audio.stopMusic(); NS.Audio.setPaused(false);
    NS.Audio.play(win ? 'victory' : 'gameover');
    this.fx.addFlash(win ? 0.6 : 0.4, win ? '120,255,220' : '255,60,90');
    this.onEvent('result', this.result);
  };

  /* ---------------- 帧循环 ---------------- */
  Game.prototype.tick = function (ts) {
    var dt = this.last ? Math.min((ts - this.last) / 1000, 0.1) : 0;
    this.last = ts;
    this._fpsAcc += dt; this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / Math.max(0.001, this._fpsAcc));
      this._fpsAcc = 0; this._fpsFrames = 0;
    }
    if (this.state === 'playing') {
      if (this.hitstop > 0) this.hitstop -= dt;
      else {
        this.acc += dt;
        var guard = 0;
        while (this.acc >= STEP && guard++ < 6) { this.update(STEP); this.acc -= STEP; }
      }
    } else if (this.state === 'menu') {
      this._menuT += dt;
      if (Math.random() < 0.35) {
        this.fx._spawn(U.rand(-this.W / 2, this.W / 2), U.rand(-this.H / 2, this.H / 2),
          U.rand(-8, 8), U.rand(-30, -6), U.rand(1.2, 2.6), U.rand(1, 2.6),
          Math.random() < 0.3 ? '#ff3cac' : '#22e6ff', 1, 0.995, 0);
      }
      this.fx.update(dt);
    }
    this.render();
    if (this.state !== 'menu') this.onEvent('frame', this.getHud());
    if (root.requestAnimationFrame && !this.manualTick) this._raf = root.requestAnimationFrame(this._loop);
  };

  /* ---------------- 固定步长更新 ---------------- */
  Game.prototype.update = function (dt) {
    var p = this.player, fx = this.fx, i, e;
    this.time += dt;

    if (this.input.consume('KeyP') || this.input.consume('Escape')) { this.pause(); return; }
    if (this.input.consume('Space')) this.tryDash();

    var ax = this.input.axis();
    var spd = p.speed * (p.dashTime > 0 ? 2.7 : 1);
    var smooth = 1 - Math.pow(0.0006, dt);
    p.vx = U.lerp(p.vx, ax.x * spd, smooth);
    p.vy = U.lerp(p.vy, ax.y * spd, smooth);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (Math.abs(ax.x) + Math.abs(ax.y) > 0.02) p.facing = Math.atan2(ax.y, ax.x);
    if (p.dashTime > 0) { p.dashTime -= dt; fx.afterimage(p.x, p.y, p.facing, '#22e6ff'); }
    if (p.dashCd > 0) p.dashCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    this.cam.x = U.lerp(this.cam.x, p.x - this.W / 2, 1 - Math.pow(0.002, dt));
    this.cam.y = U.lerp(this.cam.y, p.y - this.H / 2, 1 - Math.pow(0.002, dt));
    this.wave = 1 + Math.floor(this.time / 60);

    /* 刷怪 */
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = Math.max(0.72, 1.2 - ((this.floor || 1) - 1) * 0.055);
    }
    /* v4：每层末尾的 BOSS 由 systems.js 层状态机召唤，不再按固定时间点刷；
       也没有「撑过 5 分钟通关」，只有阵亡才会 finish(false)，层数无上限。 */

    this.buildGrid();

    /* 武器 */
    this.updateWeapons(dt);

    /* 敌人 AI */
    for (i = 0; i < this.enemies.length; i++) this.enemies[i].update(dt, this);

    /* 玩家子弹 */
    for (i = this.bullets.length - 1; i >= 0; i--) {
      var b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) { rm(this.bullets, i); continue; }
      if (b.kind === 'missile') {
        var tgt = this.nearestEnemy(b.x, b.y, 460, b.lock);
        if (tgt) {
          b.lock = tgt;
          var want = Math.atan2(tgt.y - b.y, tgt.x - b.x);
          var cur = Math.atan2(b.vy, b.vx);
          var diff = want - cur;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          var na = cur + U.clamp(diff, -4.8 * dt, 4.8 * dt);
          var bs = U.hypot(b.vx, b.vy);
          b.vx = Math.cos(na) * bs; b.vy = Math.sin(na) * bs;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.trailT -= dt;
      if (b.trailT <= 0) { fx.trail(b.x, b.y, b.color, b.r * 0.9); b.trailT = 0.035; }
    }

    /* 用更新后的位置重建网格 */
    this.buildGrid();

    /* 子弹 × 敌人 */
    for (i = this.bullets.length - 1; i >= 0; i--) {
      var bb = this.bullets[i];
      var list = this.grid.query(bb.x, bb.y, bb.r + 46, this._near);
      var removed = false;
      for (var j = 0; j < list.length; j++) {
        var en = list[j];
        if (en.dead || bb.hits.has(en.id)) continue;
        var rr = bb.r + en.radius;
        if (U.dist2(bb.x, bb.y, en.x, en.y) > rr * rr) continue;
        bb.hits.add(en.id);
        this.damageEnemy(en, bb.damage, bb.color, bb.vx, bb.vy, 95);
        if (bb.kind === 'missile') {
          this.explode(bb.x, bb.y, bb.expR, bb.damage * 0.7, '#ffc44d');
          rm(this.bullets, i); removed = true; break;
        }
        if (bb.pierce > 0) bb.pierce--;
        else { rm(this.bullets, i); removed = true; break; }
      }
      if (removed) continue;
    }

    /* 环绕光刃 × 敌人 */
    this.hitBlades();

    /* 敌人 × 玩家 */
    var nearP = this.grid.query(p.x, p.y, p.radius + 60, this._near);
    for (i = 0; i < nearP.length; i++) {
      e = nearP[i];
      if (e.dead) continue;
      var pr = p.radius + e.radius;
      if (U.dist2(p.x, p.y, e.x, e.y) < pr * pr) this.hurtPlayer(e.damage);
    }

    /* 敌方弹幕 × 玩家 */
    for (i = this.eBullets.length - 1; i >= 0; i--) {
      var eb = this.eBullets[i];
      eb.life -= dt;
      eb.x += eb.vx * dt; eb.y += eb.vy * dt;
      var er = eb.r + p.radius;
      if (U.dist2(eb.x, eb.y, p.x, p.y) < er * er) {
        this.hurtPlayer(eb.damage);
        fx.spark(eb.x, eb.y, eb.color, 6, 150, 0.3, 2.5);
        rm(this.eBullets, i); continue;
      }
      if (eb.life <= 0) rm(this.eBullets, i);
    }

    /* 经验晶体 */
    for (i = this.gems.length - 1; i >= 0; i--) {
      var g = this.gems[i];
      g.life -= dt;
      var gd = U.hypot(p.x - g.x, p.y - g.y);
      if (gd < p.pickup) {
        var pull = 260 + (p.pickup - gd) * 7;
        g.x += (p.x - g.x) / (gd || 1) * pull * dt;
        g.y += (p.y - g.y) / (gd || 1) * pull * dt;
      }
      g.t += dt;
      if (gd < 20) { this.collectGem(g); rm(this.gems, i); continue; }
      if (g.life <= 0) rm(this.gems, i);
    }

    /* 清理死亡敌人 / 过期数据 */
    for (i = this.enemies.length - 1; i >= 0; i--) if (this.enemies[i].dead) rm(this.enemies, i);
    if (this.boss && this.boss.dead) this.boss = null;

    fx.update(dt);

    if (this.pendingLevels > 0 && this.state === 'playing') {
      this.state = 'levelup';
      /* 只压低音乐、不静音音效：否则三选一的提示音会被自己掐掉（旧 bug） */
      NS.Audio.duckMusic(true);
      NS.Audio.play('levelup');
      NS.Audio.play('hexOpen');
      this._choices = this.getChoices();
      this.onEvent('levelup', { choices: this._choices, level: p.level });
    }
  };

  /* ---------------- 网格 / 查询 ---------------- */
  Game.prototype.buildGrid = function () {
    this.grid.clear();
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (!e.dead) this.grid.insert(e);
    }
  };
  Game.prototype.nearestEnemy = function (x, y, range, exclude) {
    var list = this.grid.query(x, y, range, this._find);
    var best = null, bd = range * range;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e === exclude) continue;
      var d = U.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  /* ---------------- 波次 / 首领 ---------------- */
  Game.prototype.rollEnemyType = function (tier) {
    var pool = ['chaser', 'chaser', 'chaser', 'fast'];
    if (tier >= 1) pool.push('fast', 'orbiter', 'splitter');
    if (tier >= 2) pool.push('tank', 'shooter');
    if (tier >= 3) pool.push('tank', 'shooter', 'orbiter');
    if (tier >= 4) pool.push('tank', 'shooter', 'fast');
    return U.pick(pool);
  };
  Game.prototype.spawnWave = function () {
    var t = this.time, p = this.player;
    var tier = Math.min(5, Math.floor(t / 60));
    var n = Math.min(6, 1 + Math.floor(t / 55) + (Math.random() < 0.35 ? 1 : 0));
    var diag = U.hypot(this.W, this.H) * 0.62;
    for (var i = 0; i < n; i++) {
      if (this.enemies.length >= (this.enemyCap || 120)) break;
      var a = U.rand(0, TAU), dist = diag + U.rand(50, 190);
      var type = this.rollEnemyType(tier);
      var sc = NS.floorScale(this.floor || 1);
      this.enemies.push(new NS.Enemy(type,
        p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist,
        sc.hp, sc.speed, sc.damage));
    }
  };
  /* 注意：本函数随后被 systems.js 的 G.spawnBoss 整体覆盖（后者才是实际生效的版本）。
     保留仅作早期版本回退参考，修改首领生成请改 systems.js，否则改动不会生效。 */
  Game.prototype.spawnBoss = function () {
    var p = this.player;
    this.bossIndex++;
    var a = U.rand(0, TAU), dist = U.hypot(this.W, this.H) * 0.60;
    var e = new NS.Enemy('boss', p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist,
      1 + this.bossIndex * 0.55, 1 + this.time / 900);
    e.name = D.bossNames[Math.min(D.bossNames.length - 1, this.bossIndex - 1)];
    /* v12：与 systems.js 保持一致——形态来自按层号生成的基因，而不是 4 种循环 */
    var dna0 = NS.bossDNA ? NS.bossDNA(this.bossIndex) : null;
    e.dna = dna0;
    e.arch = dna0 ? dna0.fam : (this.bossIndex - 1) % 4;
    e.gen = dna0 ? dna0.gen : Math.floor((this.bossIndex - 1) / 4);
    if (dna0) e.color = dna0.color;
    this.enemies.push(e);
    this.boss = e;
    this.fx.addFlash(0.35, '255,60,140');
    this.fx.addShake(12);
    if (this.fx.shock) this.fx.shock(e.x, e.y, 260, '#ff2f8e');
    else this.fx.ring(e.x, e.y, 10, 240, '#ff2f8e', 5, 0.6);
    NS.Audio.play('boss');
    NS.Audio.bossMusic(this.floor || 1);
    this.onEvent('toast', { text: 'WARNING // 首领来袭 · ' + e.name, danger: true, long: true });
  };
  Game.prototype.spawnMinions = function (boss, n) {
    var sc = NS.floorScale(this.floor || 1);
    for (var i = 0; i < n; i++) {
      if (this.enemies.length >= (this.enemyCap || 120)) break;
      var a = U.rand(0, TAU);
      this.enemies.push(new NS.Enemy('spawn',
        boss.x + Math.cos(a) * (boss.radius + 20), boss.y + Math.sin(a) * (boss.radius + 20),
        sc.hp, sc.speed, sc.damage));
    }
    this.fx.ring(boss.x, boss.y, 10, boss.radius + 70, '#ff2f8e', 3, 0.45);
  };

  /* ---------------- 玩家武器 ---------------- */
  Game.prototype.updateWeapons = function (dt) {
    var p = this.player;
    for (var i = 0; i < p.weapons.length; i++) {
      var w = p.weapons[i];
      if (w.id === 'orbit') continue;
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = Math.max(0.06, (BASE_CD[w.id] ? BASE_CD[w.id](w.level) : 1) * p.haste);
        this.fire(w);
      }
    }
    /* 光刃只更新位置，碰撞在 hitBlades() */
    var ow = null;
    for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === 'orbit') ow = p.weapons[i];
    if (!ow) { this.blades.length = 0; return; }
    var count = Math.min(9, 2 + Math.floor((ow.level + 1) / 2) + Math.floor(p.extraProj / 2));
    while (this.blades.length < count) this.blades.push({ a: 0, x: 0, y: 0, r: 13, hit: Object.create(null) });
    while (this.blades.length > count) this.blades.pop();
    this._orbitAngle += dt * (2.2 + ow.level * 0.12);
    var R = 78 + ow.level * 7;
    for (i = 0; i < count; i++) {
      var b = this.blades[i];
      b.a = this._orbitAngle + i * TAU / count;
      b.x = p.x + Math.cos(b.a) * R;
      b.y = p.y + Math.sin(b.a) * R;
    }
  };

  Game.prototype.fire = function (w) {
    var p = this.player, fx = this.fx, L = w.level, i;
    var target = this.nearestEnemy(p.x, p.y, 950);
    var ang = target ? Math.atan2(target.y - p.y, target.x - p.x) : p.facing;
    p.facing = ang;
    var dmg;

    switch (w.id) {
      case 'pulse': {
        var count = 1 + p.extraProj + (L >= 4 ? 1 : 0) + (L >= 7 ? 1 : 0);
        var spread = count > 1 ? 0.13 : 0;
        dmg = (9 + 4 * (L - 1)) * p.dmgMul;
        for (i = 0; i < count; i++) {
          var a = ang + (i - (count - 1) / 2) * spread;
          this.addBullet({
            x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
            vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
            r: 5, damage: dmg, pierce: L >= 5 ? 1 : 0, color: '#22e6ff',
            life: 1.5, kind: 'pulse'
          });
        }
        NS.Audio.play('shoot');
        /* 枪口闪光：让每次开火都有可见的起手反馈 */
        this.fx.spark(p.x + Math.cos(ang) * 20, p.y + Math.sin(ang) * 20, '#9df6ff', 3, 170, 0.14, 2.4);
        break;
      }
      case 'missile': {
        var mn = 1 + Math.floor(p.extraProj / 2) + (L >= 6 ? 1 : 0);
        dmg = (24 + 8 * (L - 1)) * p.dmgMul;
        for (i = 0; i < mn; i++) {
          var ma = ang + (i - (mn - 1) / 2) * 0.5 + U.rand(-0.12, 0.12);
          this.addBullet({
            x: p.x + Math.cos(ma) * 16, y: p.y + Math.sin(ma) * 16,
            vx: Math.cos(ma) * 330, vy: Math.sin(ma) * 330,
            r: 6, damage: dmg, pierce: 0, color: '#ffc44d',
            life: 2.4, kind: 'missile', expR: 52 + 6 * L
          });
        }
        break;
      }
      case 'laser': {
        var len = 720;
        var x2 = p.x + Math.cos(ang) * len, y2 = p.y + Math.sin(ang) * len;
        fx.beam(p.x, p.y, x2, y2, '#ff3cac', 7, 0.22);
        fx.ring(p.x, p.y, 8, 42, '#ff3cac', 2, 0.24);
        fx.addShake(1.5);
        dmg = (22 + 9 * (L - 1)) * p.dmgMul;
        this.lineDamage(p.x, p.y, x2, y2, 15, dmg, '#ff3cac');
        if (L >= 5) {
          var b2x = p.x - Math.cos(ang) * len, b2y = p.y - Math.sin(ang) * len;
          fx.beam(p.x, p.y, b2x, b2y, '#ff3cac', 5, 0.22);
          this.lineDamage(p.x, p.y, b2x, b2y, 12, dmg * 0.8, '#ff3cac');
        }
        NS.Audio.play('explode');
        break;
      }
      case 'chain': {
        var cur = this.nearestEnemy(p.x, p.y, 540);
        if (!cur) break;
        var jumps = 2 + Math.floor(L / 2);
        var hit = Object.create(null), from = { x: p.x, y: p.y };
        var cdmg = (16 + 6 * (L - 1)) * p.dmgMul;
        for (var s = 0; s < jumps && cur; s++) {
          fx.beam(from.x, from.y, cur.x, cur.y, '#f5ff5c', 4, 0.2);
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
        var R = 95 + 14 * L;
        fx.ring(p.x, p.y, 10, R, '#8b7cff', 5, 0.42);
        fx.spark(p.x, p.y, '#b9a8ff', 18, R * 2.2, 0.4, 3);
        fx.addShake(2.5);
        dmg = (18 + 8 * (L - 1)) * p.dmgMul;
        for (i = 0; i < this.enemies.length; i++) {
          var ne = this.enemies[i];
          if (ne.dead) continue;
          if (U.dist2(p.x, p.y, ne.x, ne.y) < (R + ne.radius) * (R + ne.radius)) {
            this.damageEnemy(ne, dmg, '#8b7cff', ne.x - p.x, ne.y - p.y, 260);
          }
        }
        break;
      }
    }
  };

  Game.prototype.lineDamage = function (x1, y1, x2, y2, width, dmg, color) {
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      if (segDist(e.x, e.y, x1, y1, x2, y2) < width + e.radius) {
        this.damageEnemy(e, dmg, color, e.x - x1, e.y - y1, 80);
      }
    }
  };

  Game.prototype.hitBlades = function () {
    var ow = null, p = this.player;
    for (var i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === 'orbit') ow = p.weapons[i];
    if (!ow) return;
    var dmg = (7 + 3 * (ow.level - 1)) * p.dmgMul;
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

  Game.prototype.addBullet = function (o) {
    if (this.bullets.length >= 420) return;
    o.hits = new Set();
    o.trailT = 0;
    o.pierce = o.pierce || 0;
    this.bullets.push(o);
  };
  Game.prototype.addEBullet = function (x, y, vx, vy, r, damage, color, life) {
    if (this.eBullets.length >= 320) return;
    this.eBullets.push({ x: x, y: y, vx: vx, vy: vy, r: r, damage: damage, color: color, life: life });
  };
  Game.prototype.explode = function (x, y, r, dmg, color) {
    this.fx.ring(x, y, 6, r, color, 4, 0.34);
    this.fx.burst(x, y, color, 14, 250);
    this.fx.addShake(2.5);
    NS.Audio.play('explode');
    for (var i = 0; i < this.enemies.length; i++) {
      var e = this.enemies[i];
      if (e.dead) continue;
      if (U.dist2(x, y, e.x, e.y) < (r + e.radius) * (r + e.radius)) {
        this.damageEnemy(e, dmg, color, e.x - x, e.y - y, 210);
      }
    }
  };

  /* ---------------- 伤害 / 死亡 ---------------- */
  Game.prototype.damageEnemy = function (e, dmg, color, kx, ky, knock) {
    if (e.dead) return;
    var p = this.player;
    var crit = Math.random() < p.crit;
    var d = dmg * (crit ? p.critMul : 1);
    /* v4：首领单次受伤的最终上限（暴击同样受限），保证 BOSS 一定有一段可见的交战时间 */
    if (e.boss) {
      d = Math.min(d, Math.max(1, e.maxHp * 0.035));
      /* v5：首领每秒伤害闸门。预算耗尽即本帧不再吃伤害，
         否则「多弹体同帧命中」会各自结算，闸门形同虚设。 */
      if (typeof e.dmgBudget === 'number') {
        if (e.dmgBudget <= 0) return;
        if (d > e.dmgBudget) d = e.dmgBudget;
        e.dmgBudget -= d;
      }
    }
    var _before = e.hp;
    e.hp -= d;
    /* v5：累计真实造成的伤害，用于估算 DPS（首领自适应血量） */
    var _dealt = _before - Math.max(e.hp, 0);
    if (_dealt > 0) this.dmgAcc += _dealt;
    e.hitFlash = 0.13;
    var kl = U.hypot(kx, ky) || 1;
    e.kx += kx / kl * (knock || 80);
    e.ky += ky / kl * (knock || 80);
    /* v3：敌群密集时按概率跳过伤害数字/火花/命中音，这是掉帧的主要来源 */
    var dense = this.enemies.length > 55, perf = this.perfLevel || 0;
    var showText = !dense || crit || d > 45 || Math.random() < (perf > 0 ? 0.08 : 0.22);
    if (showText) this.fx.text(e.x, e.y - e.radius, String(Math.round(d)), crit ? '#ffe14d' : '#eaf6ff', crit ? 17 : 13, crit);
    /* 暴击：额外金色迸溅 + 小冲击环 + 顿帧感，打击反馈更明确 */
    if (crit && (!dense || Math.random() < 0.5)) {
      this.fx.spark(e.x, e.y, '#ffe14d', 8, 300, 0.34, 3.2);
      this.fx.ring(e.x, e.y, 3, 34, '#ffe14d', 2.5, 0.28);
      this.fx.addShake(1.8, kx, ky);
      NS.Audio.play('hit');
    } else if (this.fx.glow && (!dense || Math.random() < 0.16)) {
      this.fx.spark(e.x, e.y, color || '#ffffff', 3, 130, 0.22, 2.2);
    }
    if (!dense || Math.random() < 0.12) NS.Audio.play('hit');
    if (e.hp <= 0) this.killEnemy(e);
  };
  Game.prototype.killEnemy = function (e) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    this.score += e.score;
    var boss = e.boss;
    this.fx.burst(e.x, e.y, e.color, boss ? 40 : 12, boss ? 430 : 230);
    this.fx.ring(e.x, e.y, 4, boss ? 200 : 48, e.color, boss ? 6 : 2.5, boss ? 0.6 : 0.3);
    this.fx.debris(e.x, e.y, e.color, boss ? 22 : 6);
    this.fx.addShake(boss ? 16 : 1.1);
    if (boss) {
      this.fx.addFlash(0.55, '255,60,140');
      this.fx.text(e.x, e.y - 70, 'BOSS DOWN', '#ffe14d', 22, true);
      this.hitstop = 0.06;
      /* 首领死亡：三重冲击波 + 慢动作，收束感更强 */
      if (this.fx.shock) this.fx.shock(e.x, e.y, 300, '#ffb03a');
      this.fx.ring(e.x, e.y, 20, 380, '#ffe14d', 4, 0.75);
      this.fx.addShake(9);
      NS.Audio.battleMusic(this.floor || 1);
      NS.Audio.play('explode');
      this.onEvent('toast', {
        text: this.bossStartAt
          ? '首领已击破 · 交战 ' + Math.max(1, Math.round(this.time - this.bossStartAt)) + ' 秒'
          : '首领已击破',
        danger: false
      });
      for (var i = 0; i < 12; i++) {
        var a = U.rand(0, TAU), r = U.rand(10, 80);
        this.spawnGem(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, Math.ceil(e.xp / 12));
      }
    } else {
      NS.Audio.play('kill');
      this.spawnGem(e.x, e.y, e.xp);
      if (e.type === 'splitter' && this.enemies.length < (this.enemyCap || 120)) {
        var sc = NS.floorScale(this.floor || 1);
        var aa = U.rand(0, TAU);
        this.enemies.push(new NS.Enemy('spawn', e.x + Math.cos(aa) * 14, e.y + Math.sin(aa) * 14,
          sc.hp, sc.speed, sc.damage));
      }
    }
  };
  Game.prototype.hurtPlayer = function (amount) {
    var p = this.player;
    if (p.invuln > 0 || p.dashTime > 0 || this.state !== 'playing') return;
    var d = Math.max(1, amount - p.armor);
    p.hp -= d;
    p.invuln = 0.85;
    this.fx.addShake(7);
    this.fx.addFlash(0.30, '255,40,80');
    this.fx.text(p.x, p.y - 24, '-' + Math.round(d), '#ff5c7a', 16, true);
    this.fx.spark(p.x, p.y, '#ff5c7a', 12, 210, 0.4, 3);
    NS.Audio.play('hurt');
    if (p.hp <= 0) { p.hp = 0; this.finish(false); }
  };

  /* ---------------- 经验 / 升级 ---------------- */
  Game.prototype.spawnGem = function (x, y, value) {
    if (this.gems.length >= 320) return;
    var color = value >= 8 ? '#ffc44d' : (value >= 3 ? '#c07aff' : '#22e6ff');
    this.gems.push({ x: x + U.rand(-6, 6), y: y + U.rand(-6, 6), value: value, color: color, life: 24, t: U.rand(0, 6) });
  };
  Game.prototype.collectGem = function (g) {
    var p = this.player;
    p.xp += g.value * p.xpMul;
    this.score += g.value * 2;
    this.fx.spark(g.x, g.y, g.color, 4, 90, 0.25, 2);
    NS.Audio.play('pickup');
    while (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed;
      p.level++;
      p.xpNeed = Math.floor(12 + Math.pow(p.level, 1.85) * 6);
      this.pendingLevels++;
    }
  };
  Game.prototype.getChoices = function () {
    var p = this.player, pool = [], i, j;
    for (i = 0; i < D.weapons.length; i++) {
      var w = D.weapons[i], owned = null;
      for (j = 0; j < p.weapons.length; j++) if (p.weapons[j].id === w.id) owned = p.weapons[j];
      if (!owned || owned.level < w.max) {
        pool.push({ kind: owned ? 'weaponUp' : 'weaponNew', id: w.id, def: w,
          level: owned ? owned.level + 1 : 1, weight: owned ? 3 : 6 });
      }
    }
    for (i = 0; i < D.passives.length; i++) {
      var ps = D.passives[i], lv = p.passives[ps.id] || 0;
      if (lv < ps.max) pool.push({ kind: 'passive', id: ps.id, def: ps, level: lv + 1, weight: 2 });
    }
    var out = [];
    while (out.length < 3 && pool.length) {
      var total = 0;
      for (i = 0; i < pool.length; i++) total += pool[i].weight;
      var r = Math.random() * total, idx = pool.length - 1;
      for (i = 0; i < pool.length; i++) { r -= pool[i].weight; if (r <= 0) { idx = i; break; } }
      out.push(pool.splice(idx, 1)[0]);
    }
    while (out.length < 3) out.push({ kind: 'heal', id: 'heal', def: D.heal, level: 1 });
    return out;
  };
  Game.prototype.chooseUpgrade = function (idx) {
    if (this.state !== 'levelup') return;
    var c = this._choices && this._choices[idx];
    if (!c) return;
    var p = this.player, i;
    if (c.kind === 'weaponNew') {
      p.weapons.push({ id: c.id, level: 1, timer: 0.12 });
      this.onEvent('toast', { text: '新武器 // ' + c.def.name });
    } else if (c.kind === 'weaponUp') {
      for (i = 0; i < p.weapons.length; i++) if (p.weapons[i].id === c.id) { p.weapons[i].level++; break; }
      this.onEvent('toast', { text: c.def.name + ' // LV ' + c.level });
    } else if (c.kind === 'passive') {
      p.addPassive(c.id);
    } else {
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
      this.score += 200;
    }
    NS.Audio.play('select');
    this.fx.addFlash(0.18, '180,240,255');
    this.pendingLevels--;
    if (this.pendingLevels > 0) {
      this._choices = this.getChoices();
      this.onEvent('levelup', { choices: this._choices, level: p.level });
    } else {
      this.state = 'playing';
      NS.Audio.setPaused(false);
      this.onEvent('resume', {});
    }
  };

  /* ---------------- HUD 快照 ---------------- */
  Game.prototype.getHud = function () {
    var p = this.player;
    var ws = [];
    for (var i = 0; i < p.weapons.length; i++) {
      var w = p.weapons[i], d = D.weaponById[w.id];
      ws.push({ id: w.id, name: d ? d.name : w.id, icon: d ? d.icon : '?', color: d ? d.color : '#fff', level: w.level });
    }
    return {
      hp: p.hp, maxHp: p.maxHp, xp: p.xp, xpNeed: p.xpNeed, level: p.level,
      time: this.time, target: 0, wave: this.wave, floor: this.floor || 1,
      kills: this.kills, score: Math.round(this.score), fps: this.fps,
      dash: 1 - U.clamp(p.dashCd / p.dashCdMax, 0, 1),
      weapons: ws,
      boss: this.boss && !this.boss.dead ? {
        name: this.boss.name, ratio: U.clamp(this.boss.hp / this.boss.maxHp, 0, 1),
        hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp,
        floor: this.boss.floor || (this.floor || 1)
      } : null
    };
  };

  /* ---------------- 渲染 ---------------- */
  function poly(ctx, sides, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = rot + i * TAU / sides;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  Game.prototype.render = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    var W = this.W, H = this.H, dpr = this.dpr, fx = this.fx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#070b1a'); bg.addColorStop(0.55, '#0a1022'); bg.addColorStop(1, '#050811');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    this.drawBackground(ctx, W, H);

    ctx.save();
    ctx.translate(-this.cam.x + fx._sx, -this.cam.y + fx._sy);
    this.drawFloor(ctx);
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
  };

  Game.prototype.drawBackground = function (ctx, W, H) {
    var cam = this.cam, spanW = W + 200, spanH = H + 200;
    ctx.save();
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      var x = ((s.x - cam.x * 0.12 * s.z) % spanW + spanW) % spanW - 100;
      var y = ((s.y - cam.y * 0.12 * s.z) % spanH + spanH) % spanH - 100;
      ctx.globalAlpha = 0.12 + s.z * 0.48;
      ctx.fillStyle = i % 7 === 0 ? '#ff6ec7' : '#7fdcff';
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.restore();
    var g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(24,80,132,.17)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };

  Game.prototype.drawFloor = function (ctx) {
    var c = this.cam, W = this.W, H = this.H, step = 80;
    var x0 = Math.floor(c.x / step) * step, x1 = c.x + W + step;
    var y0 = Math.floor(c.y / step) * step, y1 = c.y + H + step;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(52,150,200,.075)';
    ctx.beginPath();
    for (var x = x0; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (var y = y0; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    step = 400;
    x0 = Math.floor(c.x / step) * step; y0 = Math.floor(c.y / step) * step;
    ctx.strokeStyle = 'rgba(60,190,225,.13)';
    ctx.beginPath();
    for (x = x0; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (y = y0; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(34,230,255,.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.moveTo(0, -26); ctx.lineTo(0, 26); ctx.stroke();
    ctx.restore();
  };

  Game.prototype.drawGems = function (ctx) {
    var a = this.gems;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var g = a[i], s = 4 + Math.min(5, g.value * 0.5);
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.t * 2);
      ctx.fillStyle = g.color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(0, 0, s * 2.4, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  Game.prototype.drawEBullets = function (ctx) {
    var a = this.eBullets;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var b = a[i];
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  Game.prototype.drawEnemies = function (ctx) {
    var a = this.enemies, glow = this.fx.glow;
    for (var i = 0; i < a.length; i++) {
      var e = a[i];
      if (e.dead) continue;
      var col = e.hitFlash > 0 ? '#ffffff' : e.color;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (glow && (e.boss || i < 45)) { ctx.shadowBlur = e.boss ? 30 : 12; ctx.shadowColor = e.color; }
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2;
      switch (e.shape) {
        case 1: poly(ctx, 3, e.radius * 1.3, e.t * 3); ctx.fill(); break;
        case 2: poly(ctx, 6, e.radius, e.t * 0.4); ctx.fill(); break;
        case 3: poly(ctx, 4, e.radius * 1.2, e.t * 2); ctx.fill(); break;
        case 4: ctx.strokeRect(-e.radius * 0.8, -e.radius * 0.8, e.radius * 1.6, e.radius * 1.6);
                ctx.fillRect(-e.radius * 0.3, -e.radius * 0.3, e.radius * 0.6, e.radius * 0.6); break;
        case 5: poly(ctx, 5, e.radius, e.t * 0.8); ctx.fill(); break;
        case 6:
          ctx.rotate(e.t * 0.5);
          ctx.globalAlpha = 0.35; poly(ctx, 8, e.radius * 1.35, -e.t * 0.8); ctx.stroke();
          ctx.globalAlpha = 1; poly(ctx, 6, e.radius, 0); ctx.fill();
          ctx.fillStyle = '#1a0410'; poly(ctx, 6, e.radius * 0.62, 0); ctx.fill();
          ctx.fillStyle = e.phase ? '#ffe14d' : '#ffffff';
          ctx.beginPath(); ctx.arc(0, 0, e.radius * 0.24 + Math.sin(e.t * 5) * 2, 0, TAU); ctx.fill();
          break;
        default:
          ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, TAU); ctx.fill();
          ctx.fillStyle = '#2a0410'; ctx.beginPath(); ctx.arc(0, 0, e.radius * 0.45, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (!e.boss && e.hp < e.maxHp) {
        var w = e.radius * 2;
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 10, w, 3);
        ctx.fillStyle = e.color;
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 10, w * U.clamp(e.hp / e.maxHp, 0, 1), 3);
      }
    }
  };

  Game.prototype.drawBlades = function (ctx) {
    if (!this.blades.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.blades.length; i++) {
      var b = this.blades[i];
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a + Math.PI / 2);
      ctx.fillStyle = '#b6ff3c';
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(7, 0); ctx.lineTo(0, 18); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(182,255,60,.18)'; ctx.lineWidth = 1;
    var p = this.player;
    ctx.beginPath(); ctx.arc(p.x, p.y, 78 + (this.blades.length ? 7 : 0), 0, TAU); ctx.stroke();
    ctx.restore();
  };

  Game.prototype.drawBullets = function (ctx) {
    var a = this.bullets;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var b = a[i];
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2.6, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  Game.prototype.drawPlayer = function (ctx) {
    var p = this.player, fx = this.fx;
    if (!p) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = 'rgba(34,230,255,.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, p.pickup, 0, TAU); ctx.stroke();
    ctx.strokeStyle = p.dashTime > 0 ? 'rgba(255,255,255,.8)' : 'rgba(34,230,255,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, p.radius + 9, 0, TAU); ctx.stroke();
    var blink = p.invuln > 0 && Math.floor(p.invuln * 22) % 2 === 0;
    ctx.rotate(p.facing);
    if (fx.glow) { ctx.shadowBlur = 24; ctx.shadowColor = '#22e6ff'; }
    ctx.fillStyle = blink ? '#ffffff' : '#22e6ff';
    ctx.beginPath();
    ctx.moveTo(19, 0); ctx.lineTo(-12, -12); ctx.lineTo(-6, 0); ctx.lineTo(-12, 12);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaffff'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
    ctx.restore();
    /* 低血量警示环 */
    if (p.hp / p.maxHp < 0.3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,60,90,' + (0.25 + Math.sin(this.time * 6) * 0.2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 16, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  };

  Game.prototype.drawBossMarker = function (ctx, W, H) {
    var e = this.boss;
    if (!e || e.dead) return;
    var sx = e.x - this.cam.x, sy = e.y - this.cam.y;
    if (sx > 50 && sx < W - 50 && sy > 50 && sy < H - 50) return;
    var a = Math.atan2(sy - H / 2, sx - W / 2);
    var rad = Math.min(W, H) / 2 - 48;
    var x = W / 2 + Math.cos(a) * rad, y = H / 2 + Math.sin(a) * rad;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(255,47,142,.85)';
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-9, -8); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  NS.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
