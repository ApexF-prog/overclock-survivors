/* core.js — 基础工具、对象池、空间哈希、输入、存档 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U = {};

  U.TAU = Math.PI * 2;
  U.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.rand = function (a, b) { return a + Math.random() * (b - a); };
  U.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
  U.pick = function (arr) { return arr[(Math.random() * arr.length) | 0]; };
  U.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0, t = arr[i];
      arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  U.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  U.hypot = function (x, y) { return Math.sqrt(x * x + y * y); };
  U.fmtTime = function (sec) {
    var s = Math.max(0, Math.floor(sec));
    var m = Math.floor(s / 60);
    return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  };

  /* ---------- 对象池 ---------- */
  function Pool(factory, cap) {
    this.factory = factory;
    this.cap = cap || 2000;
    this.free = [];
    this.active = [];
  }
  Pool.prototype.obtain = function () {
    var o = this.free.pop() || this.factory();
    this.active.push(o);
    return o;
  };
  /* 用 swap-remove 避免 O(n) 的 splice */
  Pool.prototype.releaseAt = function (i) {
    var o = this.active[i];
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
    if (this.free.length < this.cap) this.free.push(o);
    return o;
  };
  Pool.prototype.clear = function () {
    for (var i = 0; i < this.active.length; i++) {
      if (this.free.length < this.cap) this.free.push(this.active[i]);
    }
    this.active.length = 0;
  };
  U.Pool = Pool;

  /* ---------- 均匀网格：把碰撞检测从 O(n*m) 降到近似 O(n) ---------- */
  function SpatialHash(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  SpatialHash.prototype.clear = function () { this.map.clear(); };
  SpatialHash.prototype.insert = function (o) {
    var cx = Math.floor(o.x / this.cell), cy = Math.floor(o.y / this.cell);
    var k = cx + ',' + cy;
    var b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(o);
  };
  SpatialHash.prototype.query = function (x, y, r, out) {
    out.length = 0;
    var c = this.cell;
    var x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    var y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (var cx = x0; cx <= x1; cx++) {
      for (var cy = y0; cy <= y1; cy++) {
        var b = this.map.get(cx + ',' + cy);
        if (b) for (var i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  };
  U.SpatialHash = SpatialHash;

  /* ---------- 输入 ---------- */
  function Input() {
    this.keys = new Set();
    this.touch = { x: 0, y: 0, active: false };
    this.mouse = { x: 0, y: 0 };
    this._axis = { x: 0, y: 0 };
    this.onKey = null;
  }
  Input.prototype.init = function () {
    var self = this;
    root.addEventListener('keydown', function (e) {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
      if (!self.keys.has(e.code) && self.onKey) self.onKey(e.code);
      self.keys.add(e.code);
    });
    root.addEventListener('keyup', function (e) { self.keys.delete(e.code); });
    root.addEventListener('blur', function () { self.keys.clear(); self.touch.active = false; self.touch.x = self.touch.y = 0; });
  };
  Input.prototype.axis = function () {
    var k = this.keys;
    var x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    var y = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    if (this.touch.active) { x += this.touch.x; y += this.touch.y; }
    var l = U.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this._axis.x = x; this._axis.y = y;
    return this._axis;
  };
  Input.prototype.consume = function (code) {
    if (this.keys.has(code)) { this.keys.delete(code); return true; }
    return false;
  };
  U.Input = Input;

  /* ---------- 本地存档（file:// 下 localStorage 可能受限，全部容错） ---------- */
  var KEY = 'neon_survivors_v1';
  var DEFAULTS = {
    bestScore: 0, bestTime: 0, bestFloor: 0, totalKills: 0, totalRuns: 0, wins: 0,
    settings: { volume: 0.6, shake: true, quality: 'high', bloom: true, fps: 'auto' }
  };
  U.Save = {
    data: null,
    load: function () {
      var d = JSON.parse(JSON.stringify(DEFAULTS));
      try {
        var raw = root.localStorage && root.localStorage.getItem(KEY);
        if (raw) {
          var p = JSON.parse(raw);
          for (var k in DEFAULTS) if (p[k] !== undefined && k !== 'settings') d[k] = p[k];
          if (p.settings) for (var s in DEFAULTS.settings) if (p.settings[s] !== undefined) d.settings[s] = p.settings[s];
        }
      } catch (e) { /* 使用默认值 */ }
      this.data = d;
      return d;
    },
    save: function () {
      try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 忽略 */ }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
