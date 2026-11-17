/* daily.js — v9 每日挑战 + 进化图鉴
 * 每日挑战：以本地日期为确定性种子，同一天全机同题（难度 + 三条修饰），
 *           成绩写入独立「日榜」存档（按日期分档），与总榜隔离。
 * 进化图鉴：跨局记录玩家进化过的超武，供门户可视化进度。
 * 纯逻辑层，无 DOM 依赖；通过 Game.prototype 包装接入，不改主状态机。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, G = NS.Game.prototype;
  var KEY = 'os_daily_v9', CODEX_KEY = 'os_codex_v9';

  function today(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  /* FNV-1a 确定性哈希：同一日期字符串永远得到同一挑战 */
  function hash(s) {
    var h = 2166136261, i;
    s = String(s) + ':os-daily-v9';
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function readJSON(k) { try { var r = root.localStorage && root.localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function writeJSON(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式容错 */ } }

  /* 修饰池：全部作用于 game 实例已有字段或本模块私有倍率（不污染全局 diff） */
  var MODIFIERS = [
    { id: 'hp',    name: '强化装甲',   text: '敌人生命 +30%',       apply: function (g) { g.daily.mul.enemyHp *= 1.3; } },
    { id: 'dmg',   name: '高危交战',   text: '敌人伤害 +35%',       apply: function (g) { g.daily.mul.enemyDmg *= 1.35; } },
    { id: 'spd',   name: '极速猎杀',   text: '敌人移速 +18%',       apply: function (g) { g.daily.mul.enemySpd *= 1.18; } },
    { id: 'spawn', name: '潮涌',       text: '刷怪密度 +25%',       apply: function (g) { g.daily.mul.spawn *= 1.25; } },
    { id: 'boss',  name: '首领强化',   text: '首领生命 +45%',       apply: function (g) { g.daily.mul.bossHp *= 1.45; } },
    { id: 'noemp', name: 'EMP 封锁',   text: '禁用 EMP 清屏',       apply: function (g) { g.contractNoEmp = true; } },
    { id: 'glass', name: '玻璃大炮',   text: '生命 -30% · 伤害 +40%', apply: function (g) { g.daily.mul.glass = true; } },
    { id: 'score', name: '荣耀',       text: '分数 ×1.6',          apply: function (g) { g.daily.mul.score *= 1.6; } },
    { id: 'vamp',  name: '汲取',       text: '击杀回复 +2 生命',    apply: function (g) { g.contractKillHeal += 2; } },
    { id: 'swift', name: '轻装',       text: '移速 +20% · 生命 -15%', apply: function (g) { g.daily.mul.swift = true; } }
  ];
  var DIFF_IDS = ['normal', 'elite', 'inferno', 'nightmare'];
  var GOALS = [3, 4, 5, 6];

  var D = NS.Daily = {
    KEY: KEY, CODEX_KEY: CODEX_KEY, today: today, modifiers: MODIFIERS,
    challenge: function (date) {
      date = date || today();
      var h = hash(date), rand = rng(h), i;
      var pool = MODIFIERS.slice();
      for (i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      var mods = [pool[0], pool[1], pool[2]];
      return {
        date: date, seed: h,
        diff: DIFF_IDS[Math.floor(rand() * DIFF_IDS.length)],
        goal: GOALS[Math.floor(rand() * GOALS.length)],
        mods: mods
      };
    },
    isDaily: function () { return !!(NS.game && NS.game.daily); },
    board: function (date) {
      date = date || today();
      var db = readJSON(KEY), list = (db && db[date]) || [];
      list.sort(function (a, b) { return (b.floor - a.floor) || (b.score - a.score) || (a.time - b.time); });
      return list;
    },
    mine: function (date) {
      date = date || today();
      var list = D.board(date);
      for (var i = 0; i < list.length; i++) if (list[i].me) return list[i];
      return null;
    },
    submit: function (result, acc) {
      if (!result || !acc) return false;
      var date = today(), ch = D.challenge(date);
      var db = readJSON(KEY) || {}, list = db[date] || [];
      var me = null, idx = -1, i;
      for (i = 0; i < list.length; i++) {
        if (list[i].uid === acc.id) { me = list[i]; idx = i; break; }
      }
      var rec = {
        uid: acc.id, name: acc.name, avatar: acc.avatar, guest: !!acc.guest,
        floor: result.floor || 1, score: result.score || 0, kills: result.kills || 0,
        time: result.time || 0, bossKills: result.bossKills || 0,
        diff: ch.diff, goal: ch.goal, reached: (result.floor || 0) >= ch.goal, at: Date.now()
      };
      var better = !me || rec.floor > me.floor || (rec.floor === me.floor && rec.score > me.score);
      if (!better) return false;
      if (idx >= 0) list[idx] = rec; else list.push(rec);
      list.sort(function (a, b) { return (b.floor - a.floor) || (b.score - a.score) || (a.time - b.time); });
      list = list.slice(0, 20);
      for (i = 0; i < list.length; i++) list[i].me = (list[i].uid === acc.id);
      db[date] = list;
      writeJSON(KEY, db);
      return true;
    },
    arm: function () { D._pending = D.challenge(); return D._pending; },
    clear: function () { D._pending = null; }
  };

  /* ---------- 包装 reset：注入当日规则到 game 实例 ---------- */
  var _reset = G.reset;
  G.reset = function () {
    _reset.call(this);
    this.daily = null;
    var ch = D._pending;
    if (!ch) return;
    D._pending = null;
    var A = NS.Account, diffObj = null;
    if (A && A.diffs) for (var i = 0; i < A.diffs.length; i++) if (A.diffs[i].id === ch.diff) { diffObj = A.diffs[i]; break; }
    /* diff 克隆，避免污染 A.diffs 共享对象 */
    if (diffObj) {
      var dc = {};
      for (var k in diffObj) if (Object.prototype.hasOwnProperty.call(diffObj, k)) dc[k] = diffObj[k];
      this.diff = dc;
    }
    this.daily = {
      date: ch.date, goal: ch.goal, diff: ch.diff,
      mul: { enemyHp: 1, enemyDmg: 1, enemySpd: 1, spawn: 1, bossHp: 1, score: 1, glass: false, swift: false },
      mods: ch.mods.map(function (m) { return { id: m.id, name: m.name, text: m.text }; })
    };
    for (var j = 0; j < ch.mods.length; j++) ch.mods[j].apply(this);
    var p = this.player, mul = this.daily.mul;
    if (p) {
      if (mul.glass) { p.maxHp = Math.max(30, Math.round(p.maxHp * 0.7)); p.hp = p.maxHp; p.dmgMul = (p.dmgMul || 1) * 1.4; }
      if (mul.swift) { p.speed = (p.speed || 0) * 1.2; p.maxHp = Math.max(30, Math.round(p.maxHp * 0.85)); p.hp = p.maxHp; }
    }
    /* 分数倍率并入 diffScore（不污染 diff 本体） */
    this.diffScore = (this.diffScore || 1) * mul.score;
  };

  /* ---------- 包装 scaling：把每日倍率作用于新刷出的敌人 ---------- */
  var _spawnWave = G.spawnWave, _spawnBoss = G.spawnBoss, _spawnMinions = G.spawnMinions;
  function applyDaily(g, list, from) {
    if (!g || !g.daily || !list) return;
    var m = g.daily.mul, i, e;
    for (i = from; i < list.length; i++) {
      e = list[i];
      if (m.enemyHp !== 1) { e.maxHp = Math.round(e.maxHp * m.enemyHp); e.hp = e.maxHp; }
      if (m.enemyDmg !== 1) e.damage = Math.round(e.damage * m.enemyDmg);
      if (m.enemySpd !== 1) e.speed = e.speed * m.enemySpd;
      if (e.boss && m.bossHp !== 1) { e.maxHp = Math.round(e.maxHp * m.bossHp); e.hp = e.maxHp; }
    }
  }
  G.spawnWave = function () {
    var before = this.enemies.length;
    _spawnWave.call(this);
    applyDaily(this, this.enemies, before);
  };
  G.spawnBoss = function () {
    var before = this.enemies.length;
    _spawnBoss.call(this);
    applyDaily(this, this.enemies, before);
  };
  G.spawnMinions = function (boss, n) {
    var before = this.enemies.length;
    if (this.daily && this.daily.mul.spawn !== 1) n = Math.round((n || 0) * this.daily.mul.spawn);
    _spawnMinions.call(this, boss, n);
    applyDaily(this, this.enemies, before);
  };

  /* ---------- HUD 与结算：暴露每日挑战信息 ---------- */
  var _getHud = G.getHud;
  G.getHud = function () {
    var d = _getHud.call(this);
    if (this.daily) {
      var m = this.daily.mul;
      d.daily = {
        goal: this.daily.goal, floor: this.floor || 1, diff: this.daily.diff,
        mods: this.daily.mods,
        reached: (this.floor || 1) >= this.daily.goal,
        scoreMul: m.score
      };
    } else d.daily = null;
    return d;
  };
  var _finish = G.finish;
  G.finish = function (win) {
    if (this.state !== 'result' && this.daily) {
      /* 上报日榜 + 进化图鉴（结算事件发出前完成，UI 可读） */
      var Ac = NS.Account;
      if (this.result) {
        if (Ac && Ac.current()) D.submit(this.result, Ac.current());
        Codex.record(this);
        this.result.daily = JSON.parse(JSON.stringify(this.daily));
        this.result.daily.reached = (this.result.floor || 0) >= this.daily.goal;
      }
    }
    _finish.call(this, win);
  };

  /* ---------- 进化图鉴：跨局记录 ---------- */
  var Codex = NS.Codex = {
    KEY: CODEX_KEY,
    unlocked: function () {
      var db = readJSON(CODEX_KEY);
      return (db && db.evolved) ? db.evolved : [];
    },
    record: function (g) {
      if (!g || !g.evolved) return false;
      var db = readJSON(CODEX_KEY) || { evolved: [] };
      db.evolved = db.evolved || [];
      var added = false;
      for (var id in g.evolved) {
        if (g.evolved[id] && db.evolved.indexOf(id) < 0) { db.evolved.push(id); added = true; }
      }
      if (added) writeJSON(CODEX_KEY, db);
      return added;
    },
    progress: function () {
      var ev = (NS.CONTENT && NS.CONTENT.evolutions) || [];
      var got = Codex.unlocked();
      var items = ev.map(function (e) {
        return { id: e.weapon, weapon: e.weapon, name: e.name, icon: e.icon, color: e.color,
          desc: e.desc, got: got.indexOf(e.weapon) >= 0 };
      });
      var n = 0;
      for (var i = 0; i < items.length; i++) if (items[i].got) n++;
      return { items: items, count: n, total: items.length };
    }
  };

  NS.Daily._Codex = Codex;
})(typeof window !== 'undefined' ? window : globalThis);
