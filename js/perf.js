/* perf.js — v9 性能层：帧率档位 + 动态分辨率 + 渲染负载自适应
 * 目标：解决「密集场景卡顿」，而不是盲目锁高帧率。
 * 原理：rAF 本就跟随屏幕刷新率；这里的「帧率档位」是上限节流 + 渲染负载自适应，
 *       自动档按真实帧时间动态调 dpr / Bloom，抖动的尖峰被削平，流畅度反而更高。
 * 全部通过包装实现，不改主状态机。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var G = NS.Game.prototype, U = NS.U;

  var FPS_OPTIONS = [
    { id: 'auto', label: '自动 · 流畅优先（推荐）', cap: 0 },
    { id: '60',   label: '60 FPS · 省电稳定',       cap: 60 },
    { id: '90',   label: '90 FPS · 均衡',           cap: 90 },
    { id: '120',  label: '120 FPS · 高刷',          cap: 120 },
    { id: '144',  label: '144 FPS · 极致',          cap: 144 }
  ];

  var P = NS.Perf = {
    options: FPS_OPTIONS,
    mode: 'auto',
    cap: 0,
    /* 运行时状态 */
    ft: 16.7,          // EMA 帧时间(ms)
    renderMs: 0,       // EMA 渲染耗时(ms)
    dynScale: 1,       // 动态分辨率倍率(相对基础 dpr)
    stress: 0,         // 负载指数 0..1
    _lastRender: 0,
    _lastTick: 0,
    _frameAcc: 0,
    _sampleN: 0,

    setMode: function (id) {
      var found = FPS_OPTIONS[0];
      for (var i = 0; i < FPS_OPTIONS.length; i++) if (FPS_OPTIONS[i].id === id) { found = FPS_OPTIONS[i]; break; }
      this.mode = found.id;
      this.cap = found.cap;
      return found;
    },
    /* 由 tick 采样：dtMs = 本帧真实间隔毫秒 */
    sample: function (dtMs) {
      if (dtMs > 0 && dtMs < 500) this.ft += (dtMs - this.ft) * 0.12;
      this._sampleN++;
    },
    /* 当前屏幕理论刷新率（用前若干帧的最小间隔估计，粗略） */
    refreshHint: function () {
      var f = this.ft;
      if (f < 8) return 144;
      if (f < 11.5) return 120;
      if (f < 15) return 90;
      return 60;
    }
  };

  /* ---------- 包装 resize：引入动态分辨率倍率 ---------- */
  var _resize = G.resize;
  G.resize = function () {
    var w = root.innerWidth || 1280, h = root.innerHeight || 720;
    var quality = this.quality || 'high';
    var baseCap = quality === 'low' ? 1 : 2;
    var dpr = Math.min(root.devicePixelRatio || 1, baseCap);
    /* 自动/高刷模式允许动态降分辨率抗尖峰；低画质已经锁 1 */
    dpr = dpr * (P.mode === 'auto' || P.cap >= 90 ? P.dynScale : 1);
    dpr = Math.max(0.75, Math.min(2, dpr));
    this.W = w; this.H = h; this.dpr = dpr;
    if (this.canvas) {
      var cw = Math.max(1, Math.floor(w * dpr)), ch = Math.max(1, Math.floor(h * dpr));
      if (this.canvas.width !== cw || this.canvas.height !== ch) {
        this.canvas.width = cw; this.canvas.height = ch;
        if (this.canvas.style) { this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; }
      }
    }
  };

  /* ---------- 包装 applyBloom：负载高时减轻模糊半径与网格 ---------- */
  var _applyBloom = G.applyBloom;
  G.applyBloom = function (ctx, W, H) {
    var stress = P.stress;
    var perf = this.perfLevel || 0;
    /* 高负载：用更激进的降采样与更浅的模糊，显著省填充 */
    if (stress > 0.55 && this._bloom && this._bloom.supported) {
      var b = this._bloom;
      if (b.enabled && perf < 2) {
        var savedScale = this._bloom_fast;
        /* 通过临时提高 perf 级别走 Bloom 内部的轻量分支（0.18 网格 + blur4 + alpha0.18） */
        b.apply(ctx, W, H, this.canvas, Math.max(1, perf));
      }
      return;
    }
    _applyBloom.call(this, ctx, W, H);
  };

  /* ---------- 包装 tick：帧率节流 + 帧时间采样 + 动态分辨率决策 ---------- */
  var _tick = G.tick;
  G.tick = function (ts) {
    if (this.manualTick) { _tick.call(this, ts); return; }
    var dtMs = this.last ? (ts - this.last) : 16.7;
    P.sample(dtMs);

    /* 帧率上限节流：目标间隔未到则跳过本帧（仅重排下一次 rAF） */
    if (P.cap > 0) {
      var interval = 1000 / P.cap;
      if (this.last && dtMs < interval - 1.2) {
        this._raf = root.requestAnimationFrame(this._loop);
        return;
      }
    }

    /* 每 ~0.5 秒根据帧时间与负载调整动态分辨率 */
    if (P._sampleN >= 30) {
      P._sampleN = 0;
      var target = 1;
      var ft = P.ft, stress = 0;
      if (ft > 22) { target = 0.72; stress = 1; }
      else if (ft > 19) { target = 0.82; stress = 0.75; }
      else if (ft > 17.2) { target = 0.9; stress = 0.5; }
      else if (ft < 14 && P.dynScale < 1) { target = Math.min(1, P.dynScale + 0.1); }
      else target = P.dynScale;
      /* 平滑逼近，避免分辨率跳变造成观感抖动 */
      if (Math.abs(target - P.dynScale) > 0.02) {
        P.dynScale += (target - P.dynScale) * 0.5;
        this.resize();
      }
      P.stress += (stress - P.stress) * 0.5;
    }

    var t0 = (root.performance && performance.now) ? performance.now() : Date.now();
    _tick.call(this, ts);
    var t1 = (root.performance && performance.now) ? performance.now() : Date.now();
    P.renderMs += ((t1 - t0) - P.renderMs) * 0.15;
  };

  /* ---------- HUD 暴露性能信息 ---------- */
  var _getHud = G.getHud;
  G.getHud = function () {
    var d = _getHud.call(this);
    d.perf = {
      mode: P.mode, cap: P.cap, ft: Math.round(P.ft * 10) / 10,
      renderMs: Math.round(P.renderMs * 10) / 10,
      dynScale: Math.round(P.dynScale * 100),
      stress: Math.round(P.stress * 100)
    };
    return d;
  };

  NS.Perf._installed = true;
})(typeof window !== 'undefined' ? window : globalThis);
