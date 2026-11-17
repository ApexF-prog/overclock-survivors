/* audio.js — 纯 Web Audio 程序化音效 / BGM，零音频资源 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var A = NS.Audio = {};
  var U = NS.U;

  var ctx = null, master = null;
  var volume = 0.6, enabled = true, ready = false;
  var musicTimer = null, step = 0;
  var lastAt = Object.create(null);
  var paused = false;

  A.init = function (vol) {
    if (vol != null) volume = vol;
    if (ready) return;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { enabled = false; ready = true; return; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      ready = true;
    } catch (e) { enabled = false; ctx = null; ready = true; }
  };
  A.resume = function () {
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
  };
  A.setVolume = function (v) { volume = v; if (master) master.gain.value = v; };
  A.setPaused = function (p) { paused = !!p; };

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  function noise(dur, vol, cutoff, delay) {
    if (!ctx || !enabled) return;
    var t = ctx.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(Math.max(120, cutoff || 1400), t);
    f.frequency.exponentialRampToValueAtTime(140, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.03);
  }

  var SOUNDS = {
    /* 轻微音高抖动，避免高频重复射击产生听觉疲劳 */
    shoot:   function () { var f = 540 * U.rand(0.94, 1.07); tone(f, 0.06, 'square', 0.030, f * 0.46); },
    hit:     function () { noise(0.045, 0.035, 2400); },
    kill:    function () { noise(0.10, 0.055, 1500); tone(190, 0.11, 'triangle', 0.035, 80); },
    explode: function () { noise(0.30, 0.13, 900); tone(95, 0.28, 'sawtooth', 0.055, 38); },
    pickup:  function () { tone(880, 0.07, 'sine', 0.030, 1320); },
    hurt:    function () { tone(155, 0.20, 'sawtooth', 0.085, 62); noise(0.11, 0.05, 700); },
    dash:    function () { noise(0.14, 0.05, 3200); tone(300, 0.13, 'sine', 0.028, 720); },
    select:  function () { tone(680, 0.08, 'square', 0.035, 1020); },
    boss:    function () { tone(72, 0.85, 'sawtooth', 0.10, 44); tone(108, 0.85, 'square', 0.035, 62); },
    levelup: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.20, 'triangle', 0.055, null, i * 0.085); }); },
    start:   function () { tone(330, 0.14, 'square', 0.045, 660); tone(660, 0.18, 'square', 0.035, 990, 0.11); },
    victory: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.40, 'triangle', 0.055, null, i * 0.13); }); },
    gameover:function () { [440, 349, 262].forEach(function (f, i) { tone(f, 0.34, 'sawtooth', 0.05, null, i * 0.19); }); },
    /* v2 新增 */
    combo:    function (n) { var f = 520 + Math.min(12, n || 1) * 42; tone(f, 0.09, 'sine', 0.032, f * 1.35); },
    chest:    function () { [523, 784, 1047, 1568].forEach(function (f, i) { tone(f, 0.26, 'triangle', 0.055, null, i * 0.075); }); noise(0.18, 0.04, 5200, 0.02); },
    evolve:   function () { [220, 330, 440, 660, 880].forEach(function (f, i) { tone(f, 0.55, 'sawtooth', 0.032, null, i * 0.10); }); tone(110, 0.9, 'sine', 0.085, 55); },
    ultimate: function () { noise(0.55, 0.17, 1800); tone(140, 0.7, 'sawtooth', 0.095, 40); tone(880, 0.5, 'sine', 0.045, 220); },
    event:    function () { tone(440, 0.14, 'square', 0.042, 660); tone(660, 0.20, 'square', 0.038, 990, 0.13); },
    prop:     function () { noise(0.20, 0.07, 2600); tone(300, 0.18, 'triangle', 0.045, 120); },
    item:     function () { tone(740, 0.10, 'sine', 0.042, 1180); tone(1180, 0.14, 'triangle', 0.032, 1480, 0.07); },
    shield:   function () { tone(1200, 0.07, 'square', 0.032, 700); noise(0.05, 0.025, 4000); },
    lowhp:    function () { tone(70, 0.22, 'sine', 0.055, 48); },
    /* v4：首领入场三连警报，比普通 boss 音更刺耳，确保「BOSS 没看到」不再发生 */
    warning:  function () {
      tone(740, 0.20, 'square', 0.055, 520);
      tone(520, 0.24, 'square', 0.050, 360, 0.22);
      tone(740, 0.20, 'square', 0.048, 520, 0.48);
    }
  };
  /* 同一音效的短间隔节流，避免敌群同时死亡时爆音 */
  var THROTTLE = { shoot: 0.045, hit: 0.035, kill: 0.055, pickup: 0.045, explode: 0.09, combo: 0.07, shield: 0.06 };
  A.play = function (name, arg) {
    if (!ctx || !enabled || paused) return;
    var f = SOUNDS[name];
    if (!f) return;
    var now = ctx.currentTime, gap = THROTTLE[name] || 0;
    if (gap && lastAt[name] && now - lastAt[name] < gap) return;
    lastAt[name] = now;
    try { f(arg); } catch (e) { /* 忽略音频异常，绝不影响游戏 */ }
  };

  var SCALE = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66];
  A.startMusic = function () {
    if (!ctx || !enabled || musicTimer) return;
    step = 0;
    musicTimer = root.setInterval(function () {
      if (!ctx || !enabled || paused) return;
      var s = step % 16;
      if (s % 4 === 0) tone(55, 0.17, 'sine', 0.055, 38);
      if (s % 2 === 1) noise(0.025, 0.010, 6500);
      var n = SCALE[(s * 3 + (step >> 4)) % SCALE.length];
      tone(n * 2, 0.15, 'triangle', 0.016, null, 0);
      step++;
    }, 250);
  };
  A.stopMusic = function () {
    if (musicTimer) { root.clearInterval(musicTimer); musicTimer = null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
