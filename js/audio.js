/* audio.js — 纯 Web Audio 程序化音效 + 多轨背景音乐，零音频资源
 * 结构：master ─┬─ sfxBus   （音效）
 *                └─ musicBus （背景音乐，独立音量 / 可单独淡出）
 * 音乐：极简步进音序器（16 分音符网格 + lookahead 调度），三首曲子
 *   menu   门户 / 结算：慢速氛围，无鼓
 *   battle 局内战斗：132 BPM 驱动型
 *   boss   首领战：150 BPM，重鼓 + 半音冲突
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var A = NS.Audio = {};
  var U = NS.U;

  var ctx = null, master = null, sfxBus = null, musicBus = null, makeup = null;
  var volume = 0.85, musicVol = 0.9, sfxVol = 1, musicOn = true;
  var muted = false;          /* 全局静音（M 键 / 切后台），只压 master，不丢各轨音量设置 */
  var ready = false, enabled = true;
  var sfxPaused = false;      /* 只静音音效（升级三选一时用，音乐继续） */
  var allPaused = false;      /* 整体暂停（暂停菜单 / 切后台） */
  var ducked = false;
  var lastAt = Object.create(null);

  /* v11 响度整改：程序化音原本电平极低（0.02~0.1），叠加两级衰减后几乎听不见。
     现在分三层抬：① 音效/乐器原始电平抬升 ② 总线抬升 ③ 压缩后 makeup 增益，
     再由「响度增强」三档统一乘在 master 上。默认 0.85 × 增强档，实际感知响度约为旧版 6~8 倍。 */
  var SFX_BOOST = 2.6;        /* 音效表内所有 tone/noise 电平倍数 */
  var MUSIC_BOOST = 2.0;      /* 音乐乐器电平倍数 */
  var LOUD = { normal: 1.0, loud: 1.7, max: 2.6 };
  var loudness = 'loud';
  function loudMul() { return LOUD[loudness] || LOUD.loud; }

  /* ---------------- 初始化 ---------------- */
  A.init = function (vol, mv, sv) {
    if (vol != null) volume = vol;
    if (mv != null) musicVol = mv;
    if (sv != null) sfxVol = sv;
    if (ready) { applyGain(); return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) { enabled = false; ready = true; return; }
    try {
      ctx = new AC();
      /* master → 压缩器 → makeup → 输出：先压峰值再整体补足，响度上去了也不会削顶爆音 */
      master = ctx.createGain();
      master.gain.value = muted ? 0 : volume * 2.2 * loudMul();
      var comp = ctx.createDynamicsCompressor();
      /* 阈值不能压得太低，否则「越响越被压回去」；这里只削尖峰，响度靠 makeup 补 */
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      makeup = ctx.createGain();
      makeup.gain.value = 2.2;
      master.connect(comp);
      comp.connect(makeup);
      makeup.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 2.2 * sfxVol;
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicGain();
      musicBus.connect(master);
      ready = true;
    } catch (e) { enabled = false; ctx = null; ready = true; }
  };

  function musicGain() {
    if (!musicOn) return 0;
    /* 音乐总线不再因子链路衰减，给足电平，压低只在 duck 时发生 */
    return musicVol * 1.25 * (ducked ? 0.34 : 1);
  }
  function applyGain() {
    if (master) master.gain.value = muted ? 0 : volume * 2.2 * loudMul();
    if (musicBus) musicBus.gain.value = musicGain();
    if (sfxBus) sfxBus.gain.value = 2.2 * sfxVol;
  }

  A.resume = function () {
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
  };
  A.setVolume = function (v) { volume = Math.max(0, Math.min(1, v)); applyGain(); };
  A.setMusicVolume = function (v) { musicVol = Math.max(0, Math.min(1, v)); applyGain(); };
  A.setSfxVolume = function (v) { sfxVol = Math.max(0, Math.min(1, v)); applyGain(); };
  A.setLoudness = function (id) { loudness = LOUD[id] ? id : 'loud'; applyGain(); return loudness; };
  A.getLoudness = function () { return loudness; };
  A.levels = function () { return { volume: volume, musicVol: musicVol, sfxVol: sfxVol, loudness: loudness, muted: muted }; };
  A.setMusicEnabled = function (on) {
    musicOn = !!on; applyGain();
    if (!musicOn) stopScheduler();
    else if (curTrack) { resumeScheduler(); }
  };
  A.isMusicEnabled = function () { return musicOn; };
  /* 全局静音：保留 volume/musicVol 设定，只把 master 拉到 0，取消静音即恢复原音量 */
  A.setMute = function (on) { muted = !!on; applyGain(); return muted; };
  A.isMuted = function () { return muted; };
  A.toggleMute = function () { return A.setMute(!muted); };

  /* 整体暂停：音乐停摆 + 音效静音 */
  A.setPaused = function (p) {
    allPaused = !!p;
    if (allPaused) stopScheduler();
    else if (curTrack) resumeScheduler();
  };
  /* 只静音音效，音乐继续（升级三选一 / 契约面板用，避免把提示音一起掐掉） */
  A.setSfxPaused = function (p) { sfxPaused = !!p; };
  /* 音乐压低（不中断），适合弹窗压住音乐又保留节奏 */
  A.duckMusic = function (on) { ducked = !!on; applyGain(); };

  /* ---------------- 基础发声 ---------------- */
  function osc(freq, dur, type, vol, slideTo, when, bus) {
    if (!ctx || !enabled) return;
    var t = when == null ? ctx.currentTime : when;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + (when == null ? 0.006 : 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || sfxBus);
    o.start(t); o.stop(t + dur + 0.04);
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!ctx || !enabled) return;
    osc(freq, dur, type, vol * SFX_BOOST, slideTo, ctx.currentTime + (delay || 0), sfxBus);
  }
  function noise(dur, vol, cutoff, delay, type, bus) {
    if (!ctx || !enabled) return;
    vol = vol * SFX_BOOST;
    var t = ctx.currentTime + (delay || 0);
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.setValueAtTime(Math.max(120, cutoff || 1400), t);
    if (!type) f.frequency.exponentialRampToValueAtTime(140, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || sfxBus);
    src.start(t); src.stop(t + dur + 0.03);
  }

  /* ---------------- 音效表 ---------------- */
  var SOUNDS = {
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
    combo:    function (n) { var f = 520 + Math.min(12, n || 1) * 42; tone(f, 0.09, 'sine', 0.032, f * 1.35); },
    chest:    function () { [523, 784, 1047, 1568].forEach(function (f, i) { tone(f, 0.26, 'triangle', 0.055, null, i * 0.075); }); noise(0.18, 0.04, 5200, 0.02); },
    evolve:   function () { [220, 330, 440, 660, 880].forEach(function (f, i) { tone(f, 0.55, 'sawtooth', 0.032, null, i * 0.10); }); tone(110, 0.9, 'sine', 0.085, 55); },
    ultimate: function () { noise(0.55, 0.17, 1800); tone(140, 0.7, 'sawtooth', 0.095, 40); tone(880, 0.5, 'sine', 0.045, 220); },
    event:    function () { tone(440, 0.14, 'square', 0.042, 660); tone(660, 0.20, 'square', 0.038, 990, 0.13); },
    prop:     function () { noise(0.20, 0.07, 2600); tone(300, 0.18, 'triangle', 0.045, 120); },
    item:     function () { tone(740, 0.10, 'sine', 0.042, 1180); tone(1180, 0.14, 'triangle', 0.032, 1480, 0.07); },
    shield:   function () { tone(1200, 0.07, 'square', 0.032, 700); noise(0.05, 0.025, 4000); },
    lowhp:    function () { tone(70, 0.22, 'sine', 0.055, 48); },
    /* 残血心跳：两段低频闷响，随血量比例加快（由 ui 控制间隔） */
    heart:    function () { tone(64, 0.16, 'sine', 0.085, 42); tone(54, 0.20, 'sine', 0.060, 34, 0.16); },
    warning:  function () {
      tone(740, 0.20, 'square', 0.055, 520);
      tone(520, 0.24, 'square', 0.050, 360, 0.22);
      tone(740, 0.20, 'square', 0.048, 520, 0.48);
    },
    /* ---- 门户 / UI ---- */
    click:    function () { tone(520, 0.05, 'square', 0.022, 700); },
    hover:    function () { tone(920, 0.03, 'sine', 0.012, 1100); },
    login:    function () { [392, 523, 659, 784].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.040, null, i * 0.07); }); },
    purchase: function () { tone(1046, 0.07, 'square', 0.030, 1568); tone(1318, 0.12, 'triangle', 0.026, 1760, 0.06); },
    /* ---- 海克斯（强化）三选一 ---- */
    hexOpen:  function () {
      /* 面板弹出：上扬扫频 + 高频闪光，明显但不刺耳 */
      tone(300, 0.30, 'sine', 0.045, 900);
      tone(600, 0.34, 'triangle', 0.028, 1400, 0.04);
      noise(0.24, 0.026, 6200, 0.02, 'highpass');
      [1046, 1318, 1568].forEach(function (f, i) { tone(f, 0.16, 'sine', 0.020, null, 0.14 + i * 0.05); });
    },
    hexPick:  function () {
      /* 选中：干脆的双音确认音 */
      tone(880, 0.09, 'square', 0.042, 1320);
      tone(1320, 0.16, 'triangle', 0.032, 1760, 0.06);
      noise(0.10, 0.022, 5200, 0, 'highpass');
    },
    hexGold:  function () {
      tone(660, 0.10, 'square', 0.045, 990);
      tone(990, 0.14, 'triangle', 0.036, 1320, 0.06);
      tone(1320, 0.26, 'sine', 0.030, 1980, 0.12);
      noise(0.16, 0.026, 6400, 0.02, 'highpass');
    },
    hexPrism: function () {
      /* 棱彩：整段上行琶音 + 亮闪 */
      [523, 659, 784, 1047, 1319, 1568].forEach(function (f, i) { tone(f, 0.30, 'triangle', 0.036, null, i * 0.055); });
      tone(110, 0.55, 'sine', 0.060, 55);
      noise(0.34, 0.032, 7200, 0, 'highpass');
    },
    reroll:   function () { noise(0.10, 0.03, 4200, 0, 'highpass'); tone(760, 0.10, 'square', 0.028, 420); },
    /* ---- v11 UI 交互（每次点击 / 开关 / 切换都有明确反馈） ---- */
    uiTap:    function () { tone(820, 0.05, 'square', 0.055, 1120); noise(0.028, 0.022, 5600, 0, 'highpass'); },
    uiOpen:   function () { tone(420, 0.10, 'triangle', 0.055, 900); tone(700, 0.13, 'sine', 0.04, 1180, 0.05); noise(0.10, 0.018, 5200, 0, 'highpass'); },
    uiClose:  function () { tone(700, 0.09, 'triangle', 0.05, 360); noise(0.06, 0.016, 3600, 0, 'highpass'); },
    uiHover:  function () { tone(1080, 0.028, 'sine', 0.022, 1320); },
    uiStep:   function () { tone(620, 0.04, 'square', 0.045, 880); },
    uiBig:    function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.16, 'triangle', 0.05, null, i * 0.05); }); noise(0.14, 0.03, 6400, 0, 'highpass'); },
    uiDeny:   function () { tone(220, 0.12, 'square', 0.06, 150); }
  };
  var THROTTLE = { shoot: 0.045, hit: 0.035, kill: 0.055, pickup: 0.045, explode: 0.09, combo: 0.07, shield: 0.06, click: 0.04, hover: 0.06, heart: 0.34, uiTap: 0.035, uiHover: 0.05, uiStep: 0.04 };

  A.play = function (name, arg) {
    if (!ctx || !enabled || allPaused || sfxPaused) return;
    var f = SOUNDS[name];
    if (!f) return;
    var now = ctx.currentTime, gap = THROTTLE[name] || 0;
    if (gap && lastAt[name] && now - lastAt[name] < gap) return;
    lastAt[name] = now;
    A._lastMs = Date.now();
    try { f(arg); } catch (e) { /* 音频异常绝不影响游戏 */ }
  };
  /* 最近是否刚响过音效：给「通用点击音」去重，避免与专属音效叠在一起 */
  A.recent = function (ms) { return !!A._lastMs && (Date.now() - A._lastMs) < (ms || 80); };

  /* ---------------- 背景音乐 ---------------- */
  /* v11：从 3 首单循环扩到 5 首 + 每首 4 段变奏。
   * 每首 = 和声进行(roots) + 低音型 + 琶音型 + 主旋律(mel) + 鼓型，
   * 每 4 小节插入 fill（军鼓过门 / 镲片 / 八度跳进），避免「一直重复同一句」。 */
  var TRACKS = {
    /* 门户 / 结算：慢速氛围，无鼓，旋律留白多 */
    menu: {
      bpm: 78, bass: 0, drums: 0, pad: 1, arp: 1, mel: 1,
      roots: [0, -4, 3, -2], arpPat: [0, 7, 12, 15, 12, 7, 3, 7],
      melPat: [12, null, null, 15, null, 19, null, null, 17, null, 15, null, 12, null, null, null],
      melType: 'triangle', melVol: 0.10
    },
    /* 局内 1~3 层 */
    battle: {
      bpm: 132, bass: 1, drums: 1, pad: 1, arp: 1, mel: 1,
      roots: [0, -4, 3, -2], arpPat: [0, 7, 12, 15, 12, 7, 3, 7],
      melPat: [12, null, 15, 19, null, 15, 12, null, 10, null, 12, 15, null, 12, 10, null],
      melType: 'square', melVol: 0.075
    },
    /* 局内 4 层起：升调 + 更快 + 加切分低音与密集踩镲 */
    battle2: {
      bpm: 142, bass: 3, drums: 3, pad: 1, arp: 1, mel: 1,
      roots: [2, -2, 5, 0], arpPat: [0, 7, 10, 12, 15, 12, 10, 7],
      melPat: [14, null, 17, null, 19, 17, 14, null, 12, 14, null, 17, 19, null, 17, null],
      melType: 'square', melVol: 0.08
    },
    /* 首领 1~5 层：重鼓 + 半音冲突 */
    boss: {
      bpm: 150, bass: 2, drums: 2, pad: 1, arp: 1, mel: 1,
      roots: [0, -2, -4, -5], arpPat: [0, 6, 12, 15, 12, 6, 1, 6],
      melPat: [11, null, 12, null, 15, null, 11, 10, null, 8, null, 7, null, 6, null, null],
      melType: 'sawtooth', melVol: 0.055
    },
    /* 首领 6 层起：更快的双踩 + 上行半音阶，压迫感最强 */
    boss2: {
      bpm: 164, bass: 4, drums: 4, pad: 1, arp: 1, mel: 1,
      roots: [1, -1, -3, -4], arpPat: [0, 6, 11, 13, 18, 13, 11, 6],
      melPat: [12, 13, 14, 15, null, 18, 17, 16, null, 15, 14, 13, null, 12, 11, null],
      melType: 'sawtooth', melVol: 0.06
    }
  };
  var curTrack = null, schedTimer = null, stepIdx = 0, nextTime = 0;
  var LOOKAHEAD = 0.28, TICK_MS = 40;

  function mtone(freq, dur, type, vol, when, slideTo) {
    osc(freq, dur, type, vol * MUSIC_BOOST, slideTo, when, musicBus);
  }
  function kick(when, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, when);
    o.frequency.exponentialRampToValueAtTime(40, when + 0.15);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime((vol || 0.34) * MUSIC_BOOST, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    o.connect(g); g.connect(musicBus);
    o.start(when); o.stop(when + 0.26);
  }
  function snare(when, vol) {
    var len = Math.floor(ctx.sampleRate * 0.14);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    var g = ctx.createGain();
    g.gain.setValueAtTime((vol || 0.11) * MUSIC_BOOST, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(when); src.stop(when + 0.16);
  }
  function hat(when, vol, open) {
    var dur = open ? 0.16 : 0.04;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7600;
    var g = ctx.createGain();
    g.gain.setValueAtTime((vol || 0.032) * MUSIC_BOOST, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(when); src.stop(when + dur + 0.02);
  }
  function crash(when, vol) {
    var len = Math.floor(ctx.sampleRate * 0.5);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.6);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime((vol || 0.10) * MUSIC_BOOST, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(when); src.stop(when + 0.52);
  }

  function scheduleStep(step, when) {
    var tr = TRACKS[curTrack];
    if (!tr) return;
    var barNo = Math.floor(step / 16);
    var bar = barNo % tr.roots.length;
    var s = step % 16;
    var root = tr.roots[bar];
    var fRoot = 110 * Math.pow(2, root / 12);
    var beat = 60 / tr.bpm;
    var phrasePos = barNo % 4;          /* 4 小节一句，最后小节做过门 */

    /* 低音：0=无 1=四分 2=八分锯齿 3=切分 4=双踩 */
    if (tr.bass === 1) {
      if (s % 4 === 0 || s === 6 || s === 14) mtone(fRoot, 0.20, 'sawtooth', 0.13, when);
    } else if (tr.bass === 2) {
      if (s % 2 === 0) mtone(fRoot, s % 8 === 0 ? 0.16 : 0.08, 'sawtooth', s % 8 === 0 ? 0.15 : 0.09, when);
    } else if (tr.bass === 3) {
      if (s % 4 === 0) mtone(fRoot, 0.18, 'sawtooth', 0.16, when);
      if (s === 6 || s === 11 || s === 14) mtone(fRoot * 2, 0.09, 'sawtooth', 0.085, when);
    } else if (tr.bass === 4) {
      if (s % 2 === 0) mtone(fRoot * (s % 8 === 0 ? 1 : 2), 0.09, 'sawtooth', 0.13, when);
      if (s % 8 === 4) mtone(fRoot * 1.5, 0.07, 'square', 0.07, when);
    }

    /* 铺底：每小节换和弦，第三音做大小调色彩差 */
    if (tr.pad && s === 0) {
      var third = tr.drums >= 3 ? 4 : 3;      /* 深层首领用大三度，更刺 */
      [0, third, 7].forEach(function (iv, i) {
        mtone(fRoot * 2 * Math.pow(2, iv / 12) * (1 + (i - 1) * 0.002), beat * 4, 'triangle', 0.05, when);
      });
    }

    /* 琶音：按 arpPat 走，每句最后一小节升八度做变化 */
    if (tr.arp) {
      var every = tr.drums ? 1 : 2;
      if (s % every === 0) {
        var idx = (step >> (tr.drums ? 0 : 1)) % tr.arpPat.length;
        var oct = phrasePos === 3 ? 2 : 1;
        mtone(fRoot * 4 * oct * Math.pow(2, tr.arpPat[idx] / 12), 0.13, 'triangle',
          (tr.drums ? 0.055 : 0.04) * (idx % 2 ? 0.8 : 1), when);
      }
    }

    /* 主旋律：每小节一句，隔小节换气，句尾拖长音 */
    if (tr.mel) {
      var note = tr.melPat[s];
      if (note != null) {
        var long = (s === 0 || s === 8);
        mtone(fRoot * 4 * Math.pow(2, note / 12), long ? 0.34 : 0.15, tr.melType, tr.melVol, when);
      }
    }

    /* 鼓 */
    if (tr.drums) {
      var heavy = tr.drums >= 2;
      if (s === 0 || s === 8 || (heavy && s === 11) || (tr.drums === 4 && s === 6)) kick(when, heavy ? 0.42 : 0.34);
      if (s === 4 || s === 12) snare(when, heavy ? 0.15 : 0.11);
      if (tr.drums >= 3) {
        if (s % 2 === 1) hat(when, 0.042);
        if (s === 14) hat(when, 0.05, true);
      } else if (s % 4 === 2) hat(when, 0.032);

      /* 过门：每 4 小节末尾加军鼓滚奏，第 4 小节开头加镲片 */
      if (phrasePos === 3 && (s === 13 || s === 14 || s === 15)) snare(when, 0.09 + s * 0.004);
      if (phrasePos === 0 && s === 0) crash(when, heavy ? 0.11 : 0.08);
      if (tr.drums === 4 && phrasePos === 2 && s === 15) kick(when, 0.36);
    }
  }

  function pump() {
    if (!ctx || !enabled || !curTrack || allPaused || !musicOn) return;
    var tr = TRACKS[curTrack];
    var stepDur = 60 / tr.bpm / 4;
    var guard = 0;
    while (nextTime < ctx.currentTime + LOOKAHEAD && guard++ < 64) {
      try { scheduleStep(stepIdx, nextTime); } catch (e) {}
      nextTime += stepDur;
      stepIdx++;
    }
  }
  function resumeScheduler() {
    if (!ctx || schedTimer) return;
    nextTime = Math.max(nextTime, ctx.currentTime + 0.05);
    schedTimer = root.setInterval(pump, TICK_MS);
    pump();
  }
  function stopScheduler() {
    if (schedTimer) { root.clearInterval(schedTimer); schedTimer = null; }
  }

  /* 切换音轨；同名重复调用不打断 */
  A.music = function (name) {
    if (!ctx || !enabled) return;
    if (!name) { A.stopMusic(); return; }
    if (!TRACKS[name]) return;
    if (curTrack === name && schedTimer) return;
    curTrack = name;
    stepIdx = 0;
    nextTime = ctx.currentTime + 0.08;
    resumeScheduler();
  };
  A.currentMusic = function () { return curTrack; };
  A.startMusic = function (name) { A.music(typeof name === 'string' ? name : 'battle'); };
  /* v11：按层数自动升级曲目，避免整局听同一段循环 */
  A.battleMusic = function (floor) { A.music((floor || 1) >= 4 ? 'battle2' : 'battle'); };
  A.bossMusic = function (floor) { A.music((floor || 1) >= 6 ? 'boss2' : 'boss'); };
  A.trackCount = function () { return Object.keys(TRACKS).length; };
  A.stopMusic = function () {
    curTrack = null;
    stopScheduler();
  };
})(typeof window !== 'undefined' ? window : globalThis);
