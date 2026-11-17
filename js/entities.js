/* entities.js — 数据表、玩家、敌人与 AI */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U;
  var D = NS.DEFS = {};

  /* ---------------- 武器 ---------------- */
  D.weapons = [
    { id: 'pulse', name: '脉冲炮', icon: '脉', color: '#22e6ff', max: 8,
      desc: function (l) { return '自动锁定最近目标发射能量弹' + (l === 1 ? '' : '；伤害与弹数提升'); } },
    { id: 'orbit', name: '环绕光刃', icon: '刃', color: '#b6ff3c', max: 8,
      desc: function (l) { return '环绕自身的光刃持续切割靠近的敌人' + (l === 1 ? '' : '；数量与转速提升'); } },
    { id: 'laser', name: '贯穿激光', icon: '激', color: '#ff3cac', max: 8,
      desc: function (l) { return '周期性释放穿透整条直线的高能光束' + (l === 1 ? '' : '；频率与伤害提升'); } },
    { id: 'chain', name: '闪电链', icon: '电', color: '#f5ff5c', max: 8,
      desc: function (l) { return '闪电在敌群间连续跳跃' + (l === 1 ? '' : '；跳跃次数提升'); } },
    { id: 'nova', name: '冲击新星', icon: '爆', color: '#8b7cff', max: 8,
      desc: function (l) { return '以自身为中心爆发环形冲击波并击退敌人' + (l === 1 ? '' : '；范围与伤害提升'); } },
    { id: 'missile', name: '追踪导弹', icon: '弹', color: '#ffc44d', max: 8,
      desc: function (l) { return '发射自动追踪的导弹，命中后范围爆炸' + (l === 1 ? '' : '；数量与威力提升'); } }
  ];
  D.weaponById = {};
  D.weapons.forEach(function (w) { D.weaponById[w.id] = w; });

  /* ---------------- 被动 ---------------- */
  D.passives = [
    { id: 'dmg', name: '超频核心', icon: '核', color: '#ff6b6b', max: 6, desc: function () { return '全武器伤害 +12%'; } },
    { id: 'haste', name: '冷却矩阵', icon: '频', color: '#4dd8ff', max: 6, desc: function () { return '全武器攻击间隔 -10%'; } },
    { id: 'speed', name: '疾行引擎', icon: '速', color: '#7dffb0', max: 5, desc: function () { return '移动速度 +8%'; } },
    { id: 'hp', name: '装甲镀层', icon: '甲', color: '#ffb84d', max: 6, desc: function () { return '最大生命 +25，并立即回复 25'; } },
    { id: 'magnet', name: '引力场', icon: '引', color: '#a68bff', max: 4, desc: function () { return '经验拾取范围 +25%'; } },
    { id: 'xp', name: '数据解析', icon: '析', color: '#5cffd6', max: 4, desc: function () { return '经验获取 +15%'; } },
    { id: 'crit', name: '弱点扫描', icon: '暴', color: '#ff8ad8', max: 5, desc: function () { return '暴击率 +6%（暴击 2 倍伤害）'; } },
    { id: 'regen', name: '纳米修复', icon: '修', color: '#9dff5c', max: 4, desc: function () { return '每秒回复 0.4 生命'; } },
    { id: 'proj', name: '分裂协议', icon: '增', color: '#ffd45c', max: 3, desc: function () { return '额外弹体 +1，光刃数量也会增加'; } },
    { id: 'armor', name: '能量护盾', icon: '盾', color: '#7fa8ff', max: 4, desc: function () { return '每次受到的伤害 -1'; } }
  ];
  D.passiveById = {};
  D.passives.forEach(function (p) { D.passiveById[p.id] = p; });
  D.heal = { id: 'heal', name: '紧急修复', icon: '愈', color: '#ffffff', max: 99,
    desc: function () { return '立即回复 35% 最大生命，并获得 200 分'; } };

  /* ---------------- 敌人 ---------------- */
  /* shape: 0圆 1三角 2六边形 3菱形 4方框 5五边形 6首领 */
  D.enemies = {
    chaser:   { r: 13, hp: 12,   speed: 78,  damage: 8,  xp: 1,  score: 10,   color: '#ff4d6d', shape: 0 },
    fast:     { r: 9,  hp: 8,    speed: 142, damage: 6,  xp: 1,  score: 14,   color: '#ffb03a', shape: 1 },
    tank:     { r: 22, hp: 72,   speed: 48,  damage: 16, xp: 4,  score: 45,   color: '#a45cff', shape: 2 },
    orbiter:  { r: 12, hp: 22,   speed: 104, damage: 10, xp: 2,  score: 26,   color: '#3affc0', shape: 3 },
    shooter:  { r: 15, hp: 34,   speed: 64,  damage: 9,  xp: 3,  score: 34,   color: '#38b6ff', shape: 4 },
    splitter: { r: 17, hp: 36,   speed: 72,  damage: 10, xp: 3,  score: 30,   color: '#ff7ae0', shape: 5 },
    spawn:    { r: 7,  hp: 6,    speed: 152, damage: 5,  xp: 1,  score: 6,    color: '#ff9ff0', shape: 1 },
    boss:     { r: 52, hp: 1000, speed: 46,  damage: 18, xp: 70, score: 1200, color: '#ff2f8e', shape: 6, boss: true }
  };
  D.bossNames = ['数据吞噬者', '相位撕裂者', '零日核心', '深渊回响', '终焉协议'];

  /* ---------------- 玩家 ---------------- */
  function Player(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = 14;
    this.facing = 0;
    /* v3：基础生存能力上调，配合吸血/回复强化，中后期不再被小怪磨死 */
    this.maxHp = 130; this.hp = 130;
    this.speed = 210;
    this.pickup = 100;
    this.dmgMul = 1; this.haste = 1; this.crit = 0.05; this.critMul = 2;
    this.regen = 0.4; this.armor = 0; this.extraProj = 0; this.xpMul = 1;
    this.dashCdMax = 3.2;
    this.dashCd = 0; this.dashTime = 0; this.invuln = 0;
    this.level = 1; this.xp = 0; this.xpNeed = 12;
    this.weapons = [];
    this.passives = {};
  }
  Player.prototype.addPassive = function (id) {
    this.passives[id] = (this.passives[id] || 0) + 1;
    switch (id) {
      case 'dmg':   this.dmgMul *= 1.12; break;
      case 'haste': this.haste *= 0.90; break;
      case 'speed': this.speed *= 1.08; break;
      case 'hp':    this.maxHp += 25; this.hp = Math.min(this.maxHp, this.hp + 25); break;
      case 'magnet':this.pickup *= 1.25; break;
      case 'xp':    this.xpMul *= 1.15; break;
      case 'crit':  this.crit += 0.06; break;
      case 'regen': this.regen += 0.4; break;
      case 'proj':  this.extraProj += 1; break;
      case 'armor': this.armor += 1; break;
    }
  };
  NS.Player = Player;

  /* ---------------- 敌人 ---------------- */
  var seq = 0;
  function Enemy(type, x, y, hpMul, spdMul, dmgMul) {
    var d = D.enemies[type] || D.enemies.chaser;
    this.id = ++seq;
    this.type = type;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.kx = 0; this.ky = 0;
    this.radius = d.r;
    this.maxHp = Math.max(1, Math.round(d.hp * hpMul));
    this.hp = this.maxHp;
    this.speed = d.speed * spdMul;
    this.damage = Math.round(d.damage * (dmgMul || 1));
    this.xp = d.xp; this.score = d.score;
    this.color = d.color; this.shape = d.shape;
    this.boss = !!d.boss;
    this.name = '';
    this.t = U.rand(0, 6);
    this.cd = U.rand(0.6, 1.8);
    this.cd2 = U.rand(1.0, 2.0);
    this.cd3 = U.rand(4, 7);
    this.charge = 0; this.cx = 0; this.cy = 0;
    this.phase = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.spin = U.rand(0, U.TAU);
    this.windup = 0;      // 冲锋兵蓄力
    this.fuse = 0;        // 自爆兵引信
    this.elite = false;   // 精英词缀
    this.exploded = false;
    /* v4：所属层数与强度系数，供 BOSS AI 缩放弹幕/召唤/移速 */
    this.floor = 1; this.fs = 1;
  }

  Enemy.prototype.makeElite = function () {
    if (this.elite) return;
    this.elite = true;
    this.maxHp = Math.round(this.maxHp * 2.1); this.hp = this.maxHp;
    this.speed *= 1.15; this.radius *= 1.2;
    this.xp = Math.ceil(this.xp * 2); this.score *= 3;
    this.damage = Math.round(this.damage * 1.2);
  };

  Enemy.prototype.update = function (dt, game) {
    var p = game.player;
    var dx = p.x - this.x, dy = p.y - this.y;
    var d = U.hypot(dx, dy) || 1;
    var nx = dx / d, ny = dy / d;
    this.t += dt;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    switch (this.type) {
      case 'shooter': {
        var want = 285;
        var mv = d > want + 40 ? 1 : (d < want - 45 ? -0.85 : 0);
        var side = Math.sin(this.t * 0.9) * 0.45;
        this.vx = (nx * mv - ny * side) * this.speed;
        this.vy = (ny * mv + nx * side) * this.speed;
        this.cd -= dt;
        if (this.cd <= 0 && d < 700) {
          var a = Math.atan2(ny, nx);
          for (var k = -1; k <= 1; k++) {
            var aa = a + k * 0.17;
            game.addEBullet(this.x + Math.cos(aa) * 16, this.y + Math.sin(aa) * 16,
              Math.cos(aa) * 235, Math.sin(aa) * 235, 6, this.damage, '#38b6ff', 3.2);
          }
          this.cd = 2.1;
        }
        break;
      }
      case 'orbiter': {
        var tang = Math.sin(this.t * 1.7) * 0.95;
        var pull = d > 210 ? 0.72 : 0.18;
        this.vx = (nx * pull - ny * tang) * this.speed;
        this.vy = (ny * pull + nx * tang) * this.speed;
        this.cd -= dt;
        if (this.cd <= 0 && d < 330) { this.vx *= 3.1; this.vy *= 3.1; this.cd = U.rand(2.4, 3.6); }
        break;
      }
      case 'charger': {
        if (this.windup > 0) {
          this.windup -= dt;
          this.vx = nx * this.speed * 0.10; this.vy = ny * this.speed * 0.10;
          if (this.windup <= 0) this.charge = 0.5;
        } else if (this.charge > 0) {
          this.charge -= dt;
          this.vx = this.cx * this.speed * 3.9; this.vy = this.cy * this.speed * 3.9;
        } else {
          this.cd -= dt;
          this.vx = nx * this.speed * 0.85; this.vy = ny * this.speed * 0.85;
          if (this.cd <= 0 && d < 460) {
            this.windup = 0.72; this.cx = nx; this.cy = ny; this.cd = 3.8;
          }
        }
        break;
      }
      case 'bomber': {
        this.vx = nx * this.speed; this.vy = ny * this.speed;
        if (this.fuse > 0) {
          this.fuse -= dt;
          if (this.fuse <= 0) {
            if (game.bomberExplode) game.bomberExplode(this);
            else this.dead = true;
          }
        } else if (d < this.radius + 30) {
          this.fuse = 0.55;
          game.fx.ring(this.x, this.y, 4, 64, '#ffb03a', 2, 0.5);
        }
        break;
      }
      case 'boss': {
        /* v4 无尽炼狱：弹幕密度/弹速/弹伤/召唤量/攻击频率/冲锋倍率全部随层数递增。
           第 1 层保持温和，越往下越接近弹幕地狱；半血 / 残血再各进一阶段。 */
        var f = this.fs || 1;
        var prevPhase = this.phase;
        if (this.hp < this.maxHp * 0.5) this.phase = 1;
        if (this.hp < this.maxHp * 0.22) this.phase = 2;
        var ph = this.phase;
        /* 阶段跃迁：整圈弹幕 + 闪白 + 震屏，明确宣告 BOSS 进入狂暴，不再无声无息 */
        if (ph > prevPhase) {
          var burst = Math.min(30, 14 + Math.round(f * 1.8));
          for (var bi = 0; bi < burst; bi++) {
            var bra = bi * U.TAU / burst + this.t * 0.4;
            game.addEBullet(this.x + Math.cos(bra) * this.radius, this.y + Math.sin(bra) * this.radius,
              Math.cos(bra) * 210, Math.sin(bra) * 210, 8, Math.round(11 + f * 1.8), '#ffe14d', 4.0);
          }
          game.fx.addFlash(0.30, '255,220,120');
          game.fx.addShake(10);
          game.fx.ring(this.x, this.y, 30, 240, '#ffe14d', 5, 0.7);
          NS.Audio.play('boss');
        }
        this.cd -= dt; this.cd2 -= dt; this.cd3 -= dt;
        if (this.charge > 0) {
          this.charge -= dt;
          var cs = Math.min(4.2, 2.8 + f * 0.12);
          this.vx = this.cx * this.speed * cs;
          this.vy = this.cy * this.speed * cs;
        } else {
          var bs = this.speed * (ph ? Math.min(1.55, 1.20 + f * 0.03) : 1);
          this.vx = nx * bs; this.vy = ny * bs;
        }
        if (this.cd <= 0 && d < 900) {
          var bn = Math.min(32, Math.round((ph ? 15 : 10) + f * 1.6 + ph * 2));
          var rs = Math.min(340, 175 + f * 13);
          var rd = Math.round(9 + f * 1.7);
          var off = this.t * 0.7;
          for (var i = 0; i < bn; i++) {
            var ra = off + i * U.TAU / bn;
            game.addEBullet(this.x + Math.cos(ra) * this.radius, this.y + Math.sin(ra) * this.radius,
              Math.cos(ra) * rs, Math.sin(ra) * rs, 7, rd, '#ff5ba6', 4.2);
          }
          this.cd = Math.max(1.25, (ph === 2 ? 2.1 : (ph ? 2.5 : 3.4)) - f * 0.12);
          game.fx.ring(this.x, this.y, 20, 96, '#ff2f8e', 4, 0.4);
        }
        if (this.cd2 <= 0 && d < 900) {
          var ba = Math.atan2(ny, nx);
          var spread = f >= 4 ? 3 : 2;
          var ss = Math.min(430, 300 + f * 10);
          var sd = Math.round(10 + f * 1.6);
          for (var j = -spread; j <= spread; j++) {
            var ja = ba + j * 0.15;
            game.addEBullet(this.x + Math.cos(ja) * 40, this.y + Math.sin(ja) * 40,
              Math.cos(ja) * ss, Math.sin(ja) * ss, 6, sd, '#ffc44d', 3.0);
          }
          this.cd2 = Math.max(0.9, 2.2 - f * 0.11);
        }
        if (this.cd3 <= 0) {
          game.spawnMinions(this, Math.min(10, 3 + Math.floor(f * 0.8) + (ph ? 1 : 0)));
          this.cx = nx; this.cy = ny; this.charge = 0.45;
          this.cd3 = Math.max(4.6, 9.0 - f * 0.35);
        }
        break;
      }
      default:
        this.vx = nx * this.speed;
        this.vy = ny * this.speed;
    }

    /* 轻量分离力，避免敌群完全重叠成一坨 */
    if (!this.boss) {
      var near = game.grid.query(this.x, this.y, this.radius * 2.1, game._sepTmp);
      var sx = 0, sy = 0, cnt = 0;
      for (var q = 0; q < near.length && cnt < 10; q++) {
        var o = near[q];
        if (o === this || o.dead) continue;
        var ddx = this.x - o.x, ddy = this.y - o.y;
        var dd = U.hypot(ddx, ddy);
        var min = this.radius + o.radius;
        if (dd > 0.001 && dd < min) {
          sx += ddx / dd * (min - dd); sy += ddy / dd * (min - dd); cnt++;
        }
      }
      this.vx += sx * 2.4; this.vy += sy * 2.4;
    }

    var damp = Math.pow(0.86, dt * 60);
    this.kx *= damp; this.ky *= damp;
    this.x += (this.vx + this.kx) * dt;
    this.y += (this.vy + this.ky) * dt;
  };
  NS.Enemy = Enemy;

  /* v4：逐层强度曲线（唯一真相源）。刷怪、分裂体、BOSS 召唤的小怪都走这里，
     避免 game.js 与 systems.js 各写一份公式导致后续改歪。 */
  NS.floorScale = function (floor) {
    var k = Math.max(0, (floor || 1) - 1);
    return {
      /* v10：小怪成长大幅加强，深层不再「一碰就碎」 */
      hp: 1 + k * 1.05 + Math.pow(k, 1.45) * 0.32,
      speed: Math.min(1.72, 1 + k * 0.062),
      damage: Math.min(4.6, 1 + k * 0.33)
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
