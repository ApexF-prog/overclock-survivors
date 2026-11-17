/* visuals.js — v2 渲染层：Bloom 后处理、阶段化背景、全物体重绘
 * 在 game.js 之后加载，覆盖 Game.prototype 的绘制方法，不改动游戏逻辑。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, C = NS.CONTENT;
  var TAU = U.TAU;
  var G = NS.Game.prototype;

  function poly(ctx, sides, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < sides; i++) {
      var a = rot + i * TAU / sides;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function diamond(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.72, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.72, 0);
    ctx.closePath();
  }

  /* ---------------- Bloom：低分辨率亮部提取 + 模糊加色回叠 ---------------- */
  function Bloom() {
    this.canvas = null; this.ctx = null; this.enabled = false;
    this.supported = false;
    try {
      if (!root.document || !root.document.createElement) return;
      var probe = root.document.createElement('canvas').getContext('2d');
      if (!probe || !('filter' in probe)) return;
      this.canvas = root.document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.supported = !!(this.canvas && this.ctx);
    } catch (e) { this.supported = false; }
  }
  Bloom.prototype.apply = function (ctx, W, H, src, perf) {
    if (!this.enabled || !this.supported || !src || !ctx) return;
    /* v3：自适应画质降级时减小缓冲、模糊半径与叠加强度 */
    var scale = perf > 0 ? 0.18 : 0.26;
    var gw = Math.max(1, Math.round(W * scale)), gh = Math.max(1, Math.round(H * scale));
    if (this.canvas.width !== gw || this.canvas.height !== gh) {
      this.canvas.width = gw; this.canvas.height = gh;
    }
    var g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, gw, gh);
    g.filter = 'brightness(1.45) contrast(1.75) saturate(1.25)';
    g.drawImage(src, 0, 0, gw, gh);
    g.filter = 'none';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = perf > 0 ? 0.18 : 0.30;
    ctx.filter = perf > 0 ? 'blur(4px)' : 'blur(7px)';
    ctx.drawImage(this.canvas, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.restore();
  };

  G.setBloom = function (on) { this.bloomUser = !!on; };
  G.applyBloom = function (ctx, W, H) {
    var b = this._bloom || (this._bloom = new Bloom());
    if (this.bloomUser === undefined) this.bloomUser = this.quality !== 'low';
    b.enabled = !!this.bloomUser && this.quality !== 'low' && b.supported;
    b.alpha = this.quality === 'medium' ? 0.2 : 0.3;
    /* 性能降到第 2 档时彻底跳过泛光，稳定后再恢复 */
    if (b.enabled && (this.perfLevel || 0) < 2) b.apply(ctx, W, H, this.canvas, this.perfLevel || 0);
  };
  G.stageDef = function () {
    var s = C.stages;
    return s[U.clamp(this.stage | 0, 0, s.length - 1)] || s[0];
  };

  /* ---------------- 背景：多层视差 + 星云 + 光带 ---------------- */
  G.drawBackground = function (ctx, W, H) {
    var sd = this.stageDef(), cam = this.cam, t = this.time;
    ctx.save();
    for (var k = 0; k < 3; k++) {
      var nx = W * 0.5 + Math.sin(t * 0.055 + k * 2.1) * W * 0.30 - cam.x * 0.025;
      var ny = H * 0.45 + Math.cos(t * 0.047 + k * 1.7) * H * 0.24 - cam.y * 0.025;
      var rr = Math.max(W, H) * (0.34 + k * 0.13);
      var g = ctx.createRadialGradient(nx, ny, 0, nx, ny, rr);
      g.addColorStop(0, sd.nebula);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    var spanW = W + 240, spanH = H + 240;
    ctx.save();
    var stars = this.stars || [];
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var depth = 0.05 + s.z * 0.14;
      var x = ((s.x - cam.x * depth) % spanW + spanW) % spanW - 120;
      var y = ((s.y - cam.y * depth) % spanH + spanH) % spanH - 120;
      var tw = 0.75 + Math.sin(t * (1 + s.z * 2) + i) * 0.25;
      ctx.globalAlpha = (0.12 + s.z * 0.55) * tw;
      ctx.fillStyle = i % 9 === 0 ? sd.accent : (i % 5 === 0 ? '#ff8ad8' : '#a8dcff');
      var ss = s.s * (0.7 + s.z);
      ctx.fillRect(x, y, ss, ss);
      if (s.z > 0.85 && this.quality === 'high') {
        ctx.globalAlpha *= 0.35;
        ctx.fillRect(x - 2, y + ss / 2 - 0.5, ss + 4, 1);
        ctx.fillRect(x + ss / 2 - 0.5, y - 2, 1, ss + 4);
      }
    }
    ctx.restore();

    /* 缓慢扫过的远景光带 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var band = ((t * 26) % (H + 400)) - 200;
    var lg = ctx.createLinearGradient(0, band - 90, 0, band + 90);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(0.5, sd.accent);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = lg; ctx.fillRect(0, band - 90, W, 180);
    ctx.restore();
  };

  /* ---------------- 地面：网格 + 交叉节点 + 扫描光栅 ---------------- */
  G.drawFloor = function (ctx) {
    var sd = this.stageDef(), c = this.cam, W = this.W, H = this.H, t = this.time;
    var step = 80;
    var x0 = Math.floor(c.x / step) * step, x1 = c.x + W + step;
    var y0 = Math.floor(c.y / step) * step, y1 = c.y + H + step;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = sd.grid;
    ctx.beginPath();
    for (var x = x0; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (var y = y0; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();

    step = 400;
    x0 = Math.floor(c.x / step) * step; y0 = Math.floor(c.y / step) * step;
    ctx.strokeStyle = sd.accent;
    ctx.globalAlpha = 0.13;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (x = x0; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (y = y0; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    /* 节点 */
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = sd.accent;
    for (x = x0; x < x1; x += step) for (y = y0; y < y1; y += step) ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.restore();

    /* 流动扫描光栅（屏幕空间，极淡） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = sd.accent;
    var off = (t * 34) % 46;
    for (var sy = c.y - 46 + off; sy < c.y + H + 46; sy += 46) ctx.fillRect(c.x, sy, W, 1);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = sd.accent; ctx.globalAlpha = 0.30; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.moveTo(0, -26); ctx.lineTo(0, 26); ctx.stroke();
    ctx.globalAlpha = 0.10; ctx.beginPath(); ctx.arc(0, 0, 46, 0, TAU); ctx.stroke();
    ctx.restore();
  };

  /* ---------------- 经验晶体：多层 + 光柱 + 呼吸 ---------------- */
  G.drawGems = function (ctx) {
    var a = this.gems || [], t = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var g = a[i], s = 4 + Math.min(5, g.value * 0.5);
      var pulse = 1 + Math.sin(g.t * 4 + i) * 0.13;
      ctx.save(); ctx.translate(g.x, g.y); ctx.scale(pulse, pulse);
      ctx.fillStyle = g.color;
      ctx.globalAlpha = 0.10;
      ctx.fillRect(-1.2, -s * 3.4, 2.4, s * 6.8);
      ctx.globalAlpha = 0.22;
      ctx.beginPath(); ctx.arc(0, 0, s * 2.5, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.save(); ctx.rotate(g.t * 1.6);
      diamond(ctx, s); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.save(); ctx.rotate(-g.t * 1.1);
      diamond(ctx, s * 1.55); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, s * 0.32, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------------- 敌方弹幕 ---------------- */
  G.drawEBullets = function (ctx) {
    var a = this.eBullets || [], t = this.time;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var b = a[i];
      var ang = Math.atan2(b.vy, b.vx);
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(0, 0, b.r * 2.8, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(-b.r * 3.4, -b.r * 0.5); ctx.lineTo(0, -b.r * 0.5);
      ctx.lineTo(0, b.r * 0.5); ctx.lineTo(-b.r * 3.4, b.r * 0.5); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, b.r * 0.38, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------------- 玩家子弹：按武器类型分弹头 ---------------- */
  G.drawBullets = function (ctx) {
    var a = this.bullets || [];
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var b = a[i], ang = Math.atan2(b.vy, b.vx), r = b.r;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.20; ctx.beginPath(); ctx.arc(0, 0, r * 3.2, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(-r * (b.kind === 'missile' ? 5.5 : 4.2), -r * 0.55);
      ctx.lineTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55);
      ctx.lineTo(-r * (b.kind === 'missile' ? 5.5 : 4.2), r * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      if (b.kind === 'missile') {
        ctx.beginPath();
        ctx.moveTo(r * 1.7, 0); ctx.lineTo(-r * 0.9, -r * 0.85);
        ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r * 0.9, r * 0.85);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff7a3a'; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(-r, -r * 0.45); ctx.lineTo(-r * 3.1, 0); ctx.lineTo(-r, r * 0.45); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(r * 1.5, 0); ctx.lineTo(-r * 0.8, -r * 0.8);
        ctx.lineTo(-r * 0.3, 0); ctx.lineTo(-r * 0.8, r * 0.8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------------- 敌人：多层结构 + 阴影 + 形变 + 词缀 ---------------- */
  G.drawEnemies = function (ctx) {
    var a = this.enemies || [], glow = this.fx.glow, t = this.time, p = this.player;
    var cam = this.cam, W = this.W, H = this.H;
    /* v10：怪物形态随层数进化（每 3 层升一档），越深越狰狞 */
    var mobTier = Math.min(3, Math.floor(((this.floor || 1) - 1) / 3));
    var mx = cam.x - 70, my = cam.y - 70, MX = cam.x + W + 70, MY = cam.y + H + 70;
    for (var i = 0; i < a.length; i++) {
      var e = a[i];
      if (e.dead) continue;
      var r = e.radius;
      /* v3：屏外敌人直接跳过绘制，密集团战省掉大量路径与 save/restore */
      if (e.x + r < mx || e.x - r > MX || e.y + r < my || e.y - r > MY) continue;
      /* 地面投影 */
      ctx.save();
      ctx.translate(e.x + 3, e.y + r * 0.55);
      ctx.globalAlpha = 0.30; ctx.fillStyle = '#000308';
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.48, 0, 0, TAU); ctx.fill();
      ctx.restore();

      var flash = e.hitFlash > 0;
      var col = flash ? '#ffffff' : e.color;
      var sq = flash ? 1.20 : 1;
      var pa = Math.atan2(p.y - e.y, p.x - e.x);
      ctx.save();
      ctx.translate(e.x, e.y);
      if (e.elite) {
        ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55 + Math.sin(t * 8 + e.id) * 0.2;
        ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      /* shadowBlur 是 Canvas 最贵的操作之一：只给首领和少量前排敌人 */
      if (glow && (e.boss || (i < 18 && a.length < 70))) {
        ctx.shadowBlur = e.boss ? 34 : 12; ctx.shadowColor = e.color;
      }
      ctx.scale(sq, 1 / sq);
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2;

      switch (e.shape) {
        case 1: /* 高速：箭头 */
          ctx.rotate(pa);
          ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.lineTo(-r, -r * 0.9);
          ctx.lineTo(-r * 0.45, 0); ctx.lineTo(-r, r * 0.9); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#fff3d0'; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(r * 0.7, 0); ctx.lineTo(-r * 0.5, 0); ctx.stroke();
          break;
        case 2: /* 重甲：双六边形 */
          poly(ctx, 6, r, e.t * 0.3); ctx.fill();
          ctx.fillStyle = '#1a0b2e'; poly(ctx, 6, r * 0.66, -e.t * 0.5); ctx.fill();
          ctx.fillStyle = col; ctx.fillRect(-r * 0.22, -r * 0.22, r * 0.44, r * 0.44);
          ctx.fillStyle = '#e8d5ff';
          for (var q = 0; q < 6; q++) {
            var qa = q * TAU / 6 + e.t * 0.3;
            ctx.beginPath(); ctx.arc(Math.cos(qa) * r * 0.85, Math.sin(qa) * r * 0.85, 1.6, 0, TAU); ctx.fill();
          }
          break;
        case 3: /* 绕行：菱形 + 内环 */
          ctx.rotate(e.t * 2);
          diamond(ctx, r * 1.15); ctx.fill();
          ctx.fillStyle = '#04231c'; diamond(ctx, r * 0.6); ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.65; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 0.4, 2.2); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, 0, r * 1.45, 3.5, 5.3); ctx.stroke();
          break;
        case 4: /* 远程：炮台 */
          ctx.rotate(pa);
          ctx.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
          ctx.fillStyle = '#0a1c33'; ctx.fillRect(-r * 0.55, -r * 0.55, r * 1.1, r * 1.1);
          ctx.fillStyle = col; ctx.fillRect(r * 0.5, -r * 0.24, r * 0.85, r * 0.48);
          ctx.fillStyle = '#d8f3ff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fill();
          break;
        case 5: /* 分裂：五边形 + 分裂点 */
          poly(ctx, 5, r, e.t * 0.7); ctx.fill();
          ctx.fillStyle = '#2a0a24';
          for (var s = 0; s < 3; s++) {
            var sa = e.t * 1.3 + s * TAU / 3;
            ctx.beginPath(); ctx.arc(Math.cos(sa) * r * 0.48, Math.sin(sa) * r * 0.48, r * 0.17, 0, TAU); ctx.fill();
          }
          break;
        case 6: /* 首领：按层数轮换四种怪兽形态 */
          var arch = e.arch || 0, ph = e.phase;
          ctx.save(); ctx.rotate(e.t * 0.45);
          ctx.globalAlpha = 0.30; ctx.lineWidth = 3;
          poly(ctx, 8, r * 1.45, -e.t * 0.8); ctx.stroke();
          ctx.globalAlpha = 0.65; ctx.lineWidth = 1.5;
          poly(ctx, 12, r * 1.24, e.t * 0.6); ctx.stroke();
          ctx.restore();
          ctx.save(); ctx.rotate(pa);
          var iris = ph ? '#ffe14d' : (arch === 1 ? '#ff7ae0' : (arch === 3 ? '#7dffb0' : '#ff5c7a'));
          if (arch === 0) {
            /* 巨口兽：楔形头 + 会张合的大嘴 + 两排獠牙 */
            ctx.beginPath();
            ctx.moveTo(r * 1.42, 0);
            ctx.lineTo(r * 0.30, -r * 1.18);
            ctx.lineTo(-r * 1.06, -r * 0.80);
            ctx.quadraticCurveTo(-r * 1.40, 0, -r * 1.06, r * 0.80);
            ctx.lineTo(r * 0.30, r * 1.18);
            ctx.closePath(); ctx.fill();
            var jaw = 0.16 + Math.abs(Math.sin(e.t * 1.8)) * 0.34;
            ctx.fillStyle = '#1a0008';
            ctx.beginPath();
            ctx.moveTo(r * 1.20, 0);
            ctx.lineTo(r * 0.10, -Math.sin(jaw) * r * 0.95);
            ctx.lineTo(r * 0.10, Math.sin(jaw) * r * 0.95);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#fff6dc';
            for (var th = 0; th < 5; th++) {
              var tt = 0.22 + th * 0.16;
              var tx = r * (1.20 - tt * r * 0.78);
              var ty = Math.sin(jaw) * r * 0.92 * (1 - tt * 0.85);
              ctx.beginPath(); ctx.moveTo(tx, -ty); ctx.lineTo(tx - r * 0.10, -ty * 0.45); ctx.lineTo(tx - r * 0.02, -ty * 0.92); ctx.closePath(); ctx.fill();
              ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - r * 0.10, ty * 0.45); ctx.lineTo(tx - r * 0.02, ty * 0.92); ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = iris;
            ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.52, r * 0.16, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(-r * 0.35, r * 0.52, r * 0.16, 0, TAU); ctx.fill();
            ctx.fillStyle = '#12000a';
            ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.52, r * 0.07, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(-r * 0.35, r * 0.52, r * 0.07, 0, TAU); ctx.fill();
          } else if (arch === 1) {
            /* 多眼体：球体 + 眼球群 + 摆动的触须 */
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.fillStyle = '#160018';
            ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, TAU); ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, r * 0.10);
            ctx.globalAlpha = 0.75;
            for (var tb2 = 0; tb2 < 6; tb2++) {
              var ta2 = tb2 * TAU / 6 + Math.sin(e.t * 2.4 + tb2) * 0.22;
              ctx.beginPath();
              ctx.moveTo(Math.cos(ta2) * r * 0.85, Math.sin(ta2) * r * 0.85);
              ctx.quadraticCurveTo(Math.cos(ta2) * r * 1.35, Math.sin(ta2) * r * 1.35,
                                   Math.cos(ta2 + 0.25) * r * 1.75, Math.sin(ta2 + 0.25) * r * 1.75);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            for (var ey = 0; ey < 7; ey++) {
              var ea = ey * TAU / 7 + e.t * 0.6;
              var er = ey === 0 ? r * 0.34 : r * 0.72;
              var es = ey === 0 ? r * 0.30 : r * 0.17;
              ctx.fillStyle = '#fff8e8';
              ctx.beginPath(); ctx.arc(Math.cos(ea) * er, Math.sin(ea) * er, es, 0, TAU); ctx.fill();
              ctx.fillStyle = iris;
              ctx.beginPath(); ctx.arc(Math.cos(ea) * er, Math.sin(ea) * er, es * 0.6, 0, TAU); ctx.fill();
              ctx.fillStyle = '#0b0010';
              ctx.beginPath(); ctx.arc(Math.cos(ea) * er, Math.sin(ea) * er, es * 0.28, 0, TAU); ctx.fill();
            }
          } else if (arch === 2) {
            /* 蛛形：甲壳 + 八条节肢 + 螯牙 */
            ctx.fillStyle = col;
            for (var lg = 0; lg < 8; lg++) {
              var side = lg % 2 ? 1 : -1, li = Math.floor(lg / 2);
              var la = (-0.9 + li * 0.6) * side;
              var sway = Math.sin(e.t * 6 + lg) * 0.18;
              var kx1 = Math.cos(la) * r * 1.15, ky1 = Math.sin(la) * r * 1.15;
              var kx2 = Math.cos(la + sway) * r * 1.95, ky2 = Math.sin(la + sway) * r * 1.95;
              ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, r * 0.14);
              ctx.beginPath();
              ctx.moveTo(Math.cos(la) * r * 0.55, Math.sin(la) * r * 0.55);
              ctx.lineTo(kx1, ky1);
              ctx.lineTo(kx2, ky2);
              ctx.stroke();
            }
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.82, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = '#1a0614';
            ctx.beginPath(); ctx.ellipse(r * 0.12, 0, r * 0.66, r * 0.54, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = iris;
            ctx.beginPath(); ctx.arc(r * 0.52, -r * 0.26, r * 0.14, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(r * 0.52, r * 0.26, r * 0.14, 0, TAU); ctx.fill();
            ctx.strokeStyle = '#fff2d4'; ctx.lineWidth = Math.max(2, r * 0.10);
            for (var mg = 0; mg < 2; mg++) {
              var ms = mg ? 1 : -1;
              ctx.beginPath();
              ctx.moveTo(r * 0.72, ms * r * 0.22);
              ctx.quadraticCurveTo(r * 1.18, ms * r * 0.40, r * 1.34, ms * r * 0.06);
              ctx.stroke();
            }
          } else {
            /* 蛇形：分节躯体 + 三角蛇头 + 分叉信子 */
            ctx.fillStyle = col;
            for (var sg = 5; sg >= 1; sg--) {
              var sd = r * 0.62 * sg;
              var off = Math.sin(e.t * 3.2 - sg * 0.7) * r * 0.30;
              ctx.globalAlpha = 0.85 - sg * 0.07;
              ctx.beginPath();
              ctx.ellipse(-sd, off, r * (0.72 - sg * 0.07), r * (0.56 - sg * 0.05), 0, 0, TAU); ctx.fill();
            }
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.moveTo(r * 1.34, 0);
            ctx.lineTo(-r * 0.10, -r * 0.86);
            ctx.lineTo(-r * 0.62, 0);
            ctx.lineTo(-r * 0.10, r * 0.86);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#0d1a10';
            ctx.beginPath();
            ctx.moveTo(r * 1.20, 0); ctx.lineTo(-r * 0.02, -r * 0.48);
            ctx.lineTo(-r * 0.02, r * 0.48); ctx.closePath(); ctx.fill();
            ctx.fillStyle = iris;
            ctx.beginPath(); ctx.arc(r * 0.42, -r * 0.32, r * 0.15, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(r * 0.42, r * 0.32, r * 0.15, 0, TAU); ctx.fill();
            var fl = Math.sin(e.t * 9);
            if (fl > 0.2) {
              ctx.strokeStyle = '#ff5c7a'; ctx.lineWidth = Math.max(1.6, r * 0.07);
              ctx.beginPath();
              ctx.moveTo(r * 1.30, 0); ctx.lineTo(r * 1.60, 0);
              ctx.moveTo(r * 1.60, 0); ctx.lineTo(r * 1.78, -r * 0.14);
              ctx.moveTo(r * 1.60, 0); ctx.lineTo(r * 1.78, r * 0.14);
              ctx.stroke();
            }
          }
          /* 进化世代：额外棘刺 + 外环裂纹，越深的同名形态也不一样 */
          if (e.gen > 0) {
            ctx.strokeStyle = col; ctx.lineWidth = 2.2;
            ctx.globalAlpha = 0.75;
            var spikes = 6 + e.gen * 2;
            for (var gs = 0; gs < spikes; gs++) {
              var ga = gs * TAU / spikes + e.t * 0.5;
              ctx.beginPath();
              ctx.moveTo(Math.cos(ga) * r * 1.02, Math.sin(ga) * r * 1.02);
              ctx.lineTo(Math.cos(ga + 0.06) * r * (1.32 + e.gen * 0.06), Math.sin(ga + 0.06) * r * (1.32 + e.gen * 0.06));
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          /* 核心光点（狂暴时更亮） */
          ctx.fillStyle = ph ? '#ffe14d' : '#ffffff';
          ctx.globalAlpha = 0.55 + Math.sin(e.t * 5) * 0.25;
          ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
          break;
        case 7: /* 冲锋兵：带蓄力尖角 */
          ctx.rotate(pa);
          ctx.beginPath();
          ctx.moveTo(r * 1.55, 0); ctx.lineTo(-r * 0.35, -r * 1.05);
          ctx.lineTo(-r * 0.95, -r * 0.5); ctx.lineTo(-r * 0.95, r * 0.5);
          ctx.lineTo(-r * 0.35, r * 1.05); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#3a1105'; ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, TAU); ctx.fill();
          if (e.windup > 0) {
            ctx.fillStyle = '#fff1a8'; ctx.globalAlpha = 0.55 + Math.sin(t * 28) * 0.4;
            ctx.beginPath(); ctx.arc(r * 0.9, 0, r * 0.42, 0, TAU); ctx.fill();
          }
          break;
        case 8: /* 自爆兵：闪烁内核 */
          ctx.rotate(-e.t * 1.8);
          poly(ctx, 8, r, 0); ctx.fill();
          ctx.fillStyle = '#3a2600'; ctx.beginPath(); ctx.arc(0, 0, r * 0.66, 0, TAU); ctx.fill();
          var fu = e.fuse > 0 ? 0.5 + Math.sin(t * 40) * 0.5 : 0.55 + Math.sin(t * 6 + e.id) * 0.3;
          ctx.fillStyle = e.fuse > 0 ? '#ffffff' : '#ffe14d'; ctx.globalAlpha = fu;
          ctx.beginPath(); ctx.arc(0, 0, r * (e.fuse > 0 ? 0.55 : 0.36), 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffb03a'; ctx.lineWidth = 1.5;
          for (var b8 = 0; b8 < 4; b8++) {
            var b8a = b8 * TAU / 4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(b8a) * r * 0.75, Math.sin(b8a) * r * 0.75);
            ctx.lineTo(Math.cos(b8a) * r * 1.3, Math.sin(b8a) * r * 1.3);
            ctx.stroke();
          }
          break;
        case 9: /* 护盾兵：正面护盾弧 */
          poly(ctx, 6, r, e.t * 0.25); ctx.fill();
          ctx.fillStyle = '#07182e'; poly(ctx, 6, r * 0.64, -e.t * 0.4); ctx.fill();
          ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
          ctx.save(); ctx.rotate(pa);
          ctx.strokeStyle = '#bfe4ff'; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
          ctx.beginPath(); ctx.arc(0, 0, r * 1.22, -0.85, 0.85); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
          ctx.beginPath(); ctx.arc(0, 0, r * 1.38, -0.7, 0.7); ctx.stroke();
          ctx.restore();
          break;
        default: /* 直冲：圆 + 内核 + 旋刺 */
          ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
          ctx.fillStyle = '#2a0410'; ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, TAU); ctx.fill();
          ctx.fillStyle = col;
          for (var sp = 0; sp < 4; sp++) {
            var spa = sp * TAU / 4 + e.t * 1.6;
            ctx.beginPath();
            ctx.moveTo(Math.cos(spa) * r * 0.9, Math.sin(spa) * r * 0.9);
            ctx.lineTo(Math.cos(spa) * r * 1.3, Math.sin(spa) * r * 1.3);
            ctx.lineTo(Math.cos(spa + 0.25) * r * 0.9, Math.sin(spa + 0.25) * r * 0.9);
            ctx.closePath(); ctx.fill();
          }
      }
      /* v10：怪兽五官 —— 眼睛常朝玩家，随层数长出獠牙 / 甲刺 / 触须 */
      if (!e.boss) {
        ctx.save();
        ctx.rotate(pa);
        var eyeR = Math.max(1.5, r * 0.20);
        ctx.fillStyle = '#fff8e0';
        ctx.beginPath(); ctx.arc(r * 0.40, -r * 0.24, eyeR, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.40, r * 0.24, eyeR, 0, TAU); ctx.fill();
        ctx.fillStyle = mobTier >= 3 ? '#ff2f6e' : (mobTier >= 2 ? '#ffcf4d' : '#22e6ff');
        ctx.beginPath(); ctx.arc(r * 0.46, -r * 0.24, eyeR * 0.55, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.46, r * 0.24, eyeR * 0.55, 0, TAU); ctx.fill();
        if (mobTier >= 1) {
          ctx.strokeStyle = '#f4f9ff'; ctx.lineWidth = Math.max(1, r * 0.10);
          ctx.beginPath();
          ctx.moveTo(r * 0.66, -r * 0.40); ctx.lineTo(r * 1.04, -r * 0.12);
          ctx.moveTo(r * 0.66, r * 0.40); ctx.lineTo(r * 1.04, r * 0.12);
          ctx.stroke();
        }
        if (mobTier >= 2) {
          ctx.fillStyle = col;
          for (var msp = 0; msp < 5; msp++) {
            var msa = -Math.PI * 0.80 + msp * 0.40;
            ctx.beginPath();
            ctx.moveTo(Math.cos(msa) * r * 0.88, Math.sin(msa) * r * 0.88);
            ctx.lineTo(Math.cos(msa) * r * 1.46, Math.sin(msa) * r * 1.46);
            ctx.lineTo(Math.cos(msa + 0.17) * r * 0.88, Math.sin(msa + 0.17) * r * 0.88);
            ctx.closePath(); ctx.fill();
          }
        }
        if (mobTier >= 3) {
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, r * 0.13);
          ctx.globalAlpha = 0.85;
          for (var mtb = 0; mtb < 3; mtb++) {
            var mta = Math.PI * (0.72 + mtb * 0.28) + Math.sin(t * 4 + mtb + e.id) * 0.16;
            ctx.beginPath();
            ctx.moveTo(Math.cos(mta) * r * 0.86, Math.sin(mta) * r * 0.86);
            ctx.quadraticCurveTo(Math.cos(mta) * r * 1.48, Math.sin(mta) * r * 1.48,
                                 Math.cos(mta + 0.22) * r * 1.92, Math.sin(mta + 0.22) * r * 1.92);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
      ctx.restore();

      /* 冲锋预警线 */
      if (e.type === 'charger' && e.windup > 0) {
        ctx.save();
        ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 2;
        ctx.globalAlpha = 0.35 + Math.sin(t * 22) * 0.2;
        ctx.setLineDash([12, 9]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.cx ? Math.atan2(e.cy, e.cx) : pa) * 340,
                   e.y + Math.sin(e.cx ? Math.atan2(e.cy, e.cx) : pa) * 340);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      /* 血条 */
      if (!e.boss && e.hp < e.maxHp) {
        var w = r * 2.1;
        ctx.fillStyle = 'rgba(0,0,0,.7)';
        ctx.fillRect(e.x - w / 2, e.y - r - 13, w, 4);
        ctx.fillStyle = e.elite ? '#ffe14d' : e.color;
        ctx.fillRect(e.x - w / 2, e.y - r - 13, w * U.clamp(e.hp / e.maxHp, 0, 1), 4);
      }
    }
  };

  /* ---------------- 光刃 ---------------- */
  G.drawBlades = function (ctx) {
    var a = this.blades || [];
    if (!a.length) return;
    var p = this.player;
    ctx.save();
    ctx.strokeStyle = 'rgba(182,255,60,.16)'; ctx.lineWidth = 1;
    ctx.setLineDash([5, 9]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 78 + 7 * (this.player.weapons.filter(function (w) { return w.id === 'orbit'; })[0] || { level: 1 }).level, 0, TAU);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < a.length; i++) {
      var b = a[i];
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a + Math.PI / 2);
      ctx.fillStyle = '#b6ff3c'; ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, -20); ctx.lineTo(6, -3); ctx.lineTo(0, 20); ctx.lineTo(-6, 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(2, 0); ctx.lineTo(0, 13); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------------- 玩家：多层飞船 + 尾焰 + 护盾 ---------------- */
  G.drawPlayer = function (ctx) {
    var p = this.player, fx = this.fx, t = this.time;
    if (!p) return;
    var sd = this.stageDef();

    ctx.save();
    ctx.translate(p.x + 3, p.y + 8);
    ctx.globalAlpha = 0.34; ctx.fillStyle = '#000308';
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 9, 0, 0, TAU); ctx.fill();
    ctx.restore();

    /* 拾取范围 */
    ctx.save();
    ctx.strokeStyle = 'rgba(120,220,255,.10)'; ctx.lineWidth = 1;
    ctx.setLineDash([3, 10]); ctx.lineDashOffset = -t * 12;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.pickup, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* 护盾环（外部，带旋转刻度） */
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(t * 0.6);
    ctx.strokeStyle = p.dashTime > 0 ? 'rgba(255,255,255,.85)' : 'rgba(34,230,255,.30)';
    ctx.lineWidth = 2;
    for (var k = 0; k < 4; k++) {
      ctx.beginPath(); ctx.arc(0, 0, p.radius + 10, k * TAU / 4, k * TAU / 4 + 0.75); ctx.stroke();
    }
    ctx.restore();

    var blink = p.invuln > 0 && Math.floor(p.invuln * 22) % 2 === 0;
    var thrust = U.clamp(U.hypot(p.vx, p.vy) / Math.max(1, p.speed), 0, 1.6);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.facing);
    var breathe = 1 + Math.sin(t * 7) * 0.025;
    ctx.scale(breathe, 1 / breathe);
    if (fx.glow) { ctx.shadowBlur = 26; ctx.shadowColor = '#22e6ff'; }

    /* 引擎尾焰 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var fl = 12 + thrust * 17 + Math.sin(t * 30) * 3;
    ctx.fillStyle = '#ff3cac'; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(-12, -5); ctx.lineTo(-12 - fl * 1.5, 0); ctx.lineTo(-12, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#22e6ff'; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.moveTo(-11, -3.2); ctx.lineTo(-11 - fl, 0); ctx.lineTo(-11, 3.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(-11, -1.6); ctx.lineTo(-11 - fl * 0.5, 0); ctx.lineTo(-11, 1.6); ctx.closePath(); ctx.fill();
    ctx.restore();

    /* 后掠机翼 */
    ctx.fillStyle = blink ? '#ffffff' : '#0f9fc4';
    ctx.beginPath();
    ctx.moveTo(4, -4); ctx.lineTo(-13, -17); ctx.lineTo(-8, -4); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, 4); ctx.lineTo(-13, 17); ctx.lineTo(-8, 4); ctx.closePath(); ctx.fill();

    /* 主体 */
    ctx.fillStyle = blink ? '#ffffff' : '#22e6ff';
    ctx.beginPath();
    ctx.moveTo(21, 0); ctx.lineTo(2, -8); ctx.lineTo(-12, -6);
    ctx.lineTo(-7, 0); ctx.lineTo(-12, 6); ctx.lineTo(2, 8);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;

    /* 机翼发光条 + 驾驶舱 */
    ctx.strokeStyle = '#bff6ff'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(-9, -14); ctx.lineTo(2, -6); ctx.moveTo(-9, 14); ctx.lineTo(2, 6); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#041a26';
    ctx.beginPath(); ctx.ellipse(4, 0, 6.5, 3.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#eaffff';
    ctx.beginPath(); ctx.ellipse(5, 0, 3.4, 2.1, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = sd.accent;
    ctx.beginPath(); ctx.arc(-4, 0, 2.2, 0, TAU); ctx.fill();
    ctx.restore();

    /* 低血警示 */
    if (p.hp / p.maxHp < 0.3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,60,90,' + (0.25 + Math.sin(t * 6) * 0.2) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 18, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  };

  /* ---------------- 世界物件：区域 / 核心 / 道具 / 宝箱 ---------------- */
  G.drawWorldObjects = function (ctx) {
    var t = this.time, i, o;
    var zones = this.zones || [], props = this.props || [], items = this.pickups || [], chests = this.chests || [];

    /* 增益 / 危险区域 */
    for (i = 0; i < zones.length; i++) {
      var z = zones[i];
      var pulse = 0.5 + Math.sin(t * 2.4 + i) * 0.18;
      ctx.save(); ctx.translate(z.x, z.y);
      ctx.fillStyle = z.color; ctx.globalAlpha = 0.055;
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = pulse; ctx.strokeStyle = z.color; ctx.lineWidth = 2;
      ctx.setLineDash([9, 8]); ctx.lineDashOffset = -t * 16;
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, z.r * 0.72, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.8; ctx.fillStyle = z.color;
      ctx.font = '700 13px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(z.label, 0, 4);
      ctx.restore();
    }

    /* 可破坏数据核心 */
    for (i = 0; i < props.length; i++) {
      var pr = props[i];
      ctx.save(); ctx.translate(pr.x, pr.y);
      ctx.strokeStyle = '#22e6ff'; ctx.globalAlpha = 0.20; ctx.lineWidth = 2;
      ctx.fillRect(-2, -34, 4, 68);
      ctx.globalAlpha = 0.55; ctx.save(); ctx.rotate(t * 0.8 + i);
      poly(ctx, 6, pr.r + 9, 0); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1; ctx.fillStyle = '#0b3d58';
      poly(ctx, 6, pr.r, -t * 0.5); ctx.fill();
      ctx.strokeStyle = '#22e6ff'; ctx.lineWidth = 2;
      poly(ctx, 6, pr.r, -t * 0.5); ctx.stroke();
      ctx.fillStyle = '#8bf6ff'; ctx.globalAlpha = 0.5 + Math.sin(t * 4 + i) * 0.3;
      poly(ctx, 3, pr.r * 0.5, t * 1.2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(-18, -pr.r - 13, 36, 3);
      ctx.fillStyle = '#22e6ff'; ctx.fillRect(-18, -pr.r - 13, 36 * U.clamp(pr.hp / pr.maxHp, 0, 1), 3);
      ctx.restore();
    }

    /* 地面道具 */
    for (i = 0; i < items.length; i++) {
      o = items[i];
      var def = C.pickupDefs[o.id] || { color: '#fff', icon: '?' };
      var bob = Math.sin(t * 3 + i) * 4;
      ctx.save(); ctx.translate(o.x, o.y + bob);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = def.color; ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.85; ctx.strokeStyle = def.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
      ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1; ctx.fillStyle = '#04121a';
      ctx.font = '800 13px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(def.icon, 0, 5);
      ctx.restore();
    }

    /* 宝箱 */
    for (i = 0; i < chests.length; i++) {
      var c = chests[i];
      var cb = Math.sin(t * 2.6 + i) * 5;
      var gold = c.rarity >= 2 ? '#ffe14d' : '#ffc44d';
      ctx.save(); ctx.translate(c.x, c.y + cb);
      ctx.globalAlpha = 0.10; ctx.fillStyle = gold;
      ctx.fillRect(-4, -46, 8, 92);
      ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#2a1a08'; ctx.strokeStyle = gold; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(-17, -11, 34, 23); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.rect(-17, -18, 34, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = gold; ctx.fillRect(-4, -12, 8, 10);
      ctx.fillStyle = '#fff6d0'; ctx.globalAlpha = 0.6 + Math.sin(t * 6 + i) * 0.35;
      ctx.beginPath(); ctx.arc(0, -3, 3.2, 0, TAU); ctx.fill();
      ctx.restore();
    }
  };
  /* ---------------- v3：决斗领域可视化 ---------------- */
  var _dwo = G.drawWorldObjects;
  G.drawWorldObjects = function (ctx) {
    _dwo.call(this, ctx);
    if (this.duelTimer > 0 && this.boss && !this.boss.dead) {
      var p = this.player, R = 300;
      ctx.save();
      ctx.globalAlpha = 0.13 + Math.sin(this.time * 3) * 0.05;
      ctx.strokeStyle = '#ff2f8e'; ctx.lineWidth = 2;
      ctx.setLineDash([12, 10]);
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  /* ---------------- v3：屏外威胁指示（首领 + 精英） ---------------- */
  G.drawBossMarker = function (ctx, W, H) {
    var i, e, sx, sy, a, rad, x, y;
    function off(sx, sy) { return sx < 50 || sx > W - 50 || sy < 50 || sy > H - 50; }
    var shown = 0;
    for (i = 0; i < this.enemies.length && shown < 3; i++) {
      e = this.enemies[i];
      if (e.dead || !e.elite || e.boss) continue;
      sx = e.x - this.cam.x; sy = e.y - this.cam.y;
      if (!off(sx, sy)) continue;
      a = Math.atan2(sy - H / 2, sx - W / 2);
      rad = Math.min(W, H) / 2 - 68;
      x = W / 2 + Math.cos(a) * rad; y = H / 2 + Math.sin(a) * rad;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.globalAlpha = 0.72; ctx.fillStyle = '#ffc44d';
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
      shown++;
    }
    var b = this.boss;
    if (!b || b.dead) return;
    sx = b.x - this.cam.x; sy = b.y - this.cam.y;
    if (!off(sx, sy)) return;
    a = Math.atan2(sy - H / 2, sx - W / 2);
    rad = Math.min(W, H) / 2 - 48;
    x = W / 2 + Math.cos(a) * rad; y = H / 2 + Math.sin(a) * rad;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(255,47,142,.9)';
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-9, -8); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = 'rgba(255,190,220,.85)';
    ctx.font = '11px Consolas,monospace'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(U.hypot(b.x - this.player.x, b.y - this.player.y)) + 'm', x, y + 26);
    ctx.restore();
  };
})(typeof window !== 'undefined' ? window : globalThis);
