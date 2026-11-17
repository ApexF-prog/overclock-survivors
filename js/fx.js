/* fx.js — 粒子、冲击环、伤害数字、光束、屏幕震动 / 闪白 / 命中顿帧 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U;

  var LIMIT = { high: 1400, medium: 700, low: 280 };

  function FX(quality) {
    this.quality = quality || 'high';
    this.limit = LIMIT[this.quality] || LIMIT.high;
    this.glow = this.quality !== 'low';
    this.shakeEnabled = true;
    this.parts = new U.Pool(function () {
      return { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff', drag: 0.92, grav: 0, type: 0 };
    }, 1600);
    this.rings = [];
    this.texts = [];
    this.beams = [];
    this.afterimages = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255,255,255';
    this._sx = 0; this._sy = 0;
    this._dx = 0; this._dy = 0;   // 方向性震动
    this.zoom = 0;                // 镜头推近
    this.arcs = [];               // 电弧折线
  }

  FX.prototype.setQuality = function (q) {
    this.quality = q;
    this.limit = LIMIT[q] || LIMIT.high;
    this.glow = q !== 'low';
  };

  FX.prototype._spawn = function (x, y, vx, vy, life, size, color, type, drag, grav) {
    if (this.parts.active.length >= this.limit) return null;
    var p = this.parts.obtain();
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = p.max = life; p.size = size; p.color = color;
    p.type = type; p.drag = drag == null ? 0.92 : drag; p.grav = grav || 0;
    return p;
  };

  /* type 0 = 火花线段, 1 = 柔光圆, 2 = 碎片方块 */
  FX.prototype.spark = function (x, y, color, n, speed, life, size) {
    n = Math.min(n || 8, this.quality === 'low' ? 5 : n || 8);
    for (var i = 0; i < n; i++) {
      var a = U.rand(0, U.TAU), v = U.rand(speed * 0.35, speed);
      this._spawn(x, y, Math.cos(a) * v, Math.sin(a) * v,
        U.rand(life * 0.5, life), U.rand(size * 0.5, size), color, 0, 0.90, 0);
    }
  };
  FX.prototype.burst = function (x, y, color, n, power) {
    n = n || 14; power = power || 220;
    this.spark(x, y, color, n, power, 0.55, 3.5);
    var soft = this.quality === 'low' ? 2 : 6;
    for (var i = 0; i < soft; i++) {
      var a = U.rand(0, U.TAU), v = U.rand(20, power * 0.35);
      this._spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, U.rand(0.28, 0.6), U.rand(9, 22), color, 1, 0.88, 0);
    }
  };
  FX.prototype.trail = function (x, y, color, size) {
    this._spawn(x, y, U.rand(-16, 16), U.rand(-16, 16), U.rand(0.16, 0.32), size || 4, color, 1, 0.9, 0);
  };
  FX.prototype.debris = function (x, y, color, n) {
    for (var i = 0; i < (n || 6); i++) {
      var a = U.rand(0, U.TAU), v = U.rand(60, 260);
      this._spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, U.rand(0.3, 0.7), U.rand(2, 5), color, 2, 0.94, 180);
    }
  };
  FX.prototype.ring = function (x, y, r0, r1, color, width, life) {
    if (this.rings.length > 60) this.rings.shift();
    this.rings.push({ x: x, y: y, r0: r0, r1: r1, r: r0, t: 0, life: life || 0.35, color: color, w: width || 3 });
  };
  FX.prototype.text = function (x, y, str, color, size, crit) {
    if (this.texts.length > 45) this.texts.shift();
    this.texts.push({ x: x + U.rand(-6, 6), y: y - 8, str: str, color: color, size: size || 13, t: 0, life: crit ? 0.85 : 0.62, vy: crit ? -58 : -42, crit: !!crit });
  };
  FX.prototype.beam = function (x1, y1, x2, y2, color, width, life) {
    if (this.beams.length > 30) this.beams.shift();
    this.beams.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: color, w: width || 3, t: 0, life: life || 0.16 });
  };
  FX.prototype.afterimage = function (x, y, angle, color) {
    if (this.quality === 'low') return;
    if (this.afterimages.length > 12) this.afterimages.shift();
    this.afterimages.push({ x: x, y: y, a: angle, color: color, t: 0, life: 0.24 });
  };
  /* 方向性震动：传入冲击方向时，画面沿受力方向偏移而非纯随机抖动 */
  FX.prototype.addShake = function (v, dx, dy) {
    if (!this.shakeEnabled) return;
    this.shake = Math.min(26, this.shake + v);
    if (dx !== undefined && dy !== undefined) {
      var l = U.hypot(dx, dy) || 1;
      this._dx = dx / l; this._dy = dy / l;
    } else { this._dx = 0; this._dy = 0; }
  };
  FX.prototype.punch = function (v) { this.zoom = Math.min(0.075, this.zoom + v); };
  FX.prototype.arc = function (x1, y1, x2, y2, color, life, width) {
    var pts = [], n = 6, nx = -(y2 - y1), ny = x2 - x1, l = U.hypot(nx, ny) || 1;
    for (var i = 0; i <= n; i++) {
      var t = i / n, px = U.lerp(x1, x2, t), py = U.lerp(y1, y2, t);
      if (i > 0 && i < n) { var off = U.rand(-11, 11); px += nx / l * off; py += ny / l * off; }
      pts.push({ x: px, y: py });
    }
    if (this.arcs.length > 24) this.arcs.shift();
    this.arcs.push({ pts: pts, color: color, t: 0, life: life || 0.17, w: width || 2.5 });
  };
  FX.prototype.smoke = function (x, y, color, n) {
    for (var i = 0; i < (n || 4); i++) {
      this._spawn(x + U.rand(-8, 8), y + U.rand(-8, 8), U.rand(-24, 24), U.rand(-55, -12),
        U.rand(0.4, 0.85), U.rand(10, 24), color, 1, 0.9, -10);
    }
  };
  FX.prototype.addFlash = function (v, rgb) { this.flash = Math.min(1, this.flash + v); if (rgb) this.flashColor = rgb; };

  /* ---- v10 新增打击 / 技能特效原语 ---- */
  /* 冲击波：一圈快环 + 一圈慢环 + 放射状火花，用于首领登场、EMP、升级 */
  FX.prototype.shock = function (x, y, r, color) {
    this.ring(x, y, 6, r, color, 5, 0.38);
    this.ring(x, y, 2, r * 0.62, '#ffffff', 2.5, 0.5);
    var n = this.quality === 'low' ? 6 : 14;
    for (var i = 0; i < n; i++) {
      var a = i / n * U.TAU + U.rand(-0.1, 0.1), v = U.rand(r * 1.4, r * 2.6);
      this._spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, U.rand(0.24, 0.46), U.rand(1.6, 3.4), color, 0, 0.90, 0);
    }
    this.addShake(3.5);
  };
  /* 斩击弧：绕中心扫过一段弧形亮带，用于近战 / 冲刺 / 爆发技能 */
  FX.prototype.slash = function (x, y, angle, radius, color, spread, life) {
    if (this.blades === undefined) this.blades = [];
    if (this.blades.length > 20) this.blades.shift();
    this.blades.push({
      x: x, y: y, a: angle, r: radius || 60,
      spread: spread == null ? 1.5 : spread,
      color: color || '#bff8ff', t: 0, life: life || 0.22
    });
  };
  /* 星芒爆裂：十字长条闪光，暴击 / 击杀的瞬间高光 */
  FX.prototype.star = function (x, y, color, size, life) {
    if (this.stars === undefined) this.stars = [];
    if (this.stars.length > 24) this.stars.shift();
    this.stars.push({ x: x, y: y, color: color || '#ffe14d', s: size || 22, t: 0, life: life || 0.26, rot: U.rand(0, 1.6) });
  };

  FX.prototype.clear = function () {
    this.parts.clear(); this.rings.length = 0; this.texts.length = 0;
    this.beams.length = 0; this.afterimages.length = 0; this.arcs.length = 0;
    if (this.blades) this.blades.length = 0;
    if (this.stars) this.stars.length = 0;
    this.shake = 0; this.flash = 0; this.zoom = 0; this._dx = this._dy = 0;
  };

  FX.prototype.update = function (dt) {
    var a = this.parts.active;
    for (var i = a.length - 1; i >= 0; i--) {
      var p = a[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.releaseAt(i); continue; }
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (i = this.rings.length - 1; i >= 0; i--) {
      var r = this.rings[i]; r.t += dt;
      if (r.t >= r.life) { this.rings.splice(i, 1); continue; }
      r.r = U.lerp(r.r0, r.r1, r.t / r.life);
    }
    for (i = this.texts.length - 1; i >= 0; i--) {
      var t = this.texts[i]; t.t += dt; t.y += t.vy * dt; t.vy *= 0.94;
      if (t.t >= t.life) this.texts.splice(i, 1);
    }
    for (i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].t += dt;
      if (this.beams[i].t >= this.beams[i].life) this.beams.splice(i, 1);
    }
    for (i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].t += dt;
      if (this.afterimages[i].t >= this.afterimages[i].life) this.afterimages.splice(i, 1);
    }
    for (i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].t += dt;
      if (this.arcs[i].t >= this.arcs[i].life) this.arcs.splice(i, 1);
    }
    if (this.blades) for (i = this.blades.length - 1; i >= 0; i--) {
      this.blades[i].t += dt;
      if (this.blades[i].t >= this.blades[i].life) this.blades.splice(i, 1);
    }
    if (this.stars) for (i = this.stars.length - 1; i >= 0; i--) {
      this.stars[i].t += dt;
      if (this.stars[i].t >= this.stars[i].life) this.stars.splice(i, 1);
    }
    this.shake *= Math.pow(0.86, dt * 60);
    if (this.shake < 0.15) this.shake = 0;
    this.flash *= Math.pow(0.83, dt * 60);
    if (this.flash < 0.01) this.flash = 0;
    this.zoom *= Math.pow(0.87, dt * 60);
    if (this.zoom < 0.001) this.zoom = 0;
    var s = this.shake;
    this._sx = U.rand(-s, s) * 0.55 + this._dx * s * 0.65;
    this._sy = U.rand(-s, s) * 0.55 + this._dy * s * 0.65;
    if (s === 0) { this._dx = 0; this._dy = 0; }
  };

  /* 世界坐标层（调用方已 translate 到相机坐标） */
  FX.prototype.draw = function (ctx) {
    var a = this.parts.active, i, p;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < a.length; i++) {
      p = a[i];
      var k = p.life / p.max;
      ctx.globalAlpha = k < 0.35 ? k / 0.35 : 1;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.type === 1) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.35 + k * 0.65), 0, U.TAU); ctx.fill();
      } else if (p.type === 2) {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.lineWidth = Math.max(1, p.size * k * 0.6);
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    for (i = 0; i < this.rings.length; i++) {
      var r = this.rings[i], rk = 1 - r.t / r.life;
      ctx.globalAlpha = rk * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.w * rk + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, U.TAU); ctx.stroke();
    }
    for (i = 0; i < this.beams.length; i++) {
      var b = this.beams[i], bk = 1 - b.t / b.life;
      ctx.globalAlpha = bk;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.w * bk;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
      ctx.globalAlpha = bk * 0.45;
      ctx.lineWidth = b.w * bk * 3;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    }
    for (i = 0; i < this.arcs.length; i++) {
      var ar = this.arcs[i], ak = 1 - ar.t / ar.life;
      ctx.globalAlpha = ak; ctx.strokeStyle = ar.color; ctx.lineWidth = ar.w * ak;
      ctx.beginPath(); ctx.moveTo(ar.pts[0].x, ar.pts[0].y);
      for (var q = 1; q < ar.pts.length; q++) ctx.lineTo(ar.pts[q].x, ar.pts[q].y);
      ctx.stroke();
      ctx.globalAlpha = ak * 0.35; ctx.lineWidth = ar.w * ak * 3.5; ctx.stroke();
    }
    /* 斩击弧 */
    if (this.blades) {
      ctx.lineCap = 'round';
      for (i = 0; i < this.blades.length; i++) {
        var bl = this.blades[i], bk = 1 - bl.t / bl.life;
        ctx.globalAlpha = bk * 0.9;
        ctx.strokeStyle = bl.color;
        ctx.lineWidth = 2 + 8 * bk;
        ctx.beginPath();
        ctx.arc(bl.x, bl.y, bl.r, bl.a - bl.spread / 2, bl.a + bl.spread / 2);
        ctx.stroke();
        ctx.globalAlpha = bk * 0.30;
        ctx.lineWidth = (2 + 8 * bk) * 2.6;
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    /* 星芒爆裂 */
    if (this.stars) {
      for (i = 0; i < this.stars.length; i++) {
        var st = this.stars[i], sk = 1 - st.t / st.life;
        var L = st.s * (0.35 + sk * 0.85);
        ctx.globalAlpha = sk;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = 2 + 3.5 * sk;
        ctx.beginPath();
        ctx.moveTo(st.x - L, st.y); ctx.lineTo(st.x + L, st.y);
        ctx.moveTo(st.x, st.y - L); ctx.lineTo(st.x, st.y + L);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    /* 残影 */
    for (i = 0; i < this.afterimages.length; i++) {
      var g = this.afterimages[i], gk = 1 - g.t / g.life;
      ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.a);
      ctx.globalAlpha = gk * 0.35; ctx.fillStyle = g.color;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-11, -10); ctx.lineTo(-6, 0); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* 伤害数字 */
    for (i = 0; i < this.texts.length; i++) {
      var t = this.texts[i], tk = 1 - t.t / t.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, tk * 2);
      ctx.font = '800 ' + (t.crit ? t.size * 1.5 : t.size) + 'px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(2,6,14,.9)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.str, t.x, t.y);
      ctx.restore();
    }
  };

  /* 屏幕坐标层 */
  FX.prototype.drawScreen = function (ctx, w, h) {
    if (this.flash > 0.01) {
      ctx.save();
      ctx.fillStyle = 'rgba(' + this.flashColor + ',' + (this.flash * 0.5) + ')';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  };

  NS.FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
