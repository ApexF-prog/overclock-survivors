/* account.js — 本地多档案账号系统（4399 风格门户的账号层）
 * 纯前端 localStorage：账号/密码/头像/签到/成就/难度/排行榜全部保存在本机，不联网。
 * 密码只存不可逆摘要，仅用于本地校验，不是联网账号系统。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U;
  var KEY = 'os_accounts_v1';
  var LEGACY = 'neon_survivors_v1';

  var AVATARS = ['◈', '◆', '✦', '☠', '⚡', '✹', '◎', '☯', '✧', '★', '☢', '❖'];

  /* 挑战难度：直接乘在敌人 / 首领 / 节奏 / 分数上，解决「全程碾压」 */
  var DIFFS = [
    { id: 'normal',    name: '标准',     tag: 'NORMAL',    color: '#4dd8ff', enemyHp: 1,    enemyDmg: 1,    enemySpd: 1,    bossHp: 1,    bossDmg: 1,    spawn: 1,    prep: 1,    score: 1,    desc: '原汁原味的无尽炼狱，适合熟悉机制' },
    { id: 'elite',     name: '精英',     tag: 'ELITE',     color: '#7dffb0', enemyHp: 1.4,  enemyDmg: 1.3,  enemySpd: 1.08, bossHp: 1.4,  bossDmg: 1.25, spawn: 1.15, prep: 0.9,  score: 1.4,  desc: '推荐 · 敌群与首领明显强化，需要认真构筑' },
    { id: 'inferno',   name: '炼狱',     tag: 'INFERNO',   color: '#ffb84d', enemyHp: 1.9,  enemyDmg: 1.65, enemySpd: 1.16, bossHp: 1.85, bossDmg: 1.55, spawn: 1.3,  prep: 0.8,  score: 2.0,  desc: '高密度高强度，失误两次就得重开' },
    { id: 'nightmare', name: '无尽噩梦', tag: 'NIGHTMARE', color: '#ff5c7a', enemyHp: 2.6,  enemyDmg: 2.15, enemySpd: 1.26, bossHp: 2.4,  bossDmg: 1.95, spawn: 1.45, prep: 0.72, score: 3.0,  desc: '硬核 · 首领词缀提前解锁，分数三倍' }
  ];

  var ACHS = [
    { id: 'first_blood', name: '初次净化', icon: '⚔', desc: '击破 1 只首领' },
    { id: 'floor5',      name: '深入炼狱', icon: '▼', desc: '单局抵达第 5 层' },
    { id: 'floor10',     name: '深渊行者', icon: '∞', desc: '单局抵达第 10 层' },
    { id: 'kill1000',    name: '千人斩',   icon: '✹', desc: '单局击杀 1000' },
    { id: 'combo100',    name: '连锁反应', icon: '⚡', desc: '达成 100 连杀' },
    { id: 'prism',       name: '棱彩构筑', icon: '✦', desc: '单局获得 3 项棱彩强化' },
    { id: 'evo',         name: '超武觉醒', icon: '✧', desc: '单局进化 2 件超武' },
    { id: 'nightmare5',  name: '噩梦征服', icon: '☠', desc: '无尽噩梦难度抵达第 5 层' }
  ];

  function blank() {
    return {
      bestScore: 0, bestTime: 0, bestFloor: 0, totalKills: 0, totalRuns: 0, wins: 0,
      settings: { volume: 0.85, shake: true, quality: 'high', bloom: true, fps: 'auto', musicVol: 0.9, musicOn: true, muted: false }
    };
  }
  function merge(dst, src) {
    if (!src || typeof src !== 'object') return dst;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var v = src[k], d = dst[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) merge(d, v);
      else if (d !== undefined || k === 'ach') dst[k] = v;
    }
    return dst;
  }
  function hash(s) {
    var h = 5381, i;
    s = String(s || '') + ':overclock-salt-v6';
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function today(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return today(d); }
  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function readJSON(k) { try { var r = root.localStorage && root.localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }

  function newUser(name, pass, avatar, guest) {
    var u = {
      id: uid(), name: name, pass: pass ? hash(name + ':' + pass) : '', avatar: avatar || '◈',
      guest: !!guest, created: today(), lastLogin: today(),
      signDays: 0, signDate: '', difficulty: 'elite', ach: {}, stats: blank(),
      cores: 0, lab: {}   // v7 超频核心与研究所永久升级
    };
    return u;
  }

  var A = NS.Account = {
    db: null, avatars: AVATARS, diffs: DIFFS, achievements: ACHS,

    load: function () {
      var db = readJSON(KEY);
      if (!db || !db.users || !db.users.length) {
        var legacy = readJSON(LEGACY);
        var g = newUser('游客玩家', '', '☠', true);
        g.difficulty = 'elite';
        if (legacy) merge(g.stats, legacy);   // 迁移 v5 单档记录，老玩家不丢进度
        db = { users: [g], currentId: null, lastId: g.id };
      }
      for (var i = 0; i < db.users.length; i++) {
        var u = db.users[i];
        u.stats = merge(blank(), u.stats);
        u.ach = u.ach || {};
        if (!u.difficulty) u.difficulty = 'elite';
        if (typeof u.cores !== 'number' || !isFinite(u.cores) || u.cores < 0) u.cores = 0;
        if (!u.lab || typeof u.lab !== 'object' || Array.isArray(u.lab)) u.lab = {};
      }
      this.db = db;
      return db;
    },
    persist: function () {
      try { if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(this.db)); } catch (e) { /* 容量/隐私模式容错 */ }
    },
    current: function () {
      if (!this.db) this.load();
      var id = this.db.currentId, us = this.db.users, i;
      if (!id) return null;
      for (i = 0; i < us.length; i++) if (us[i].id === id) return us[i];
      return null;
    },
    last: function () {
      if (!this.db) this.load();
      var id = this.db.lastId, us = this.db.users, i;
      for (i = 0; i < us.length; i++) if (us[i].id === id) return us[i];
      return us[0] || null;
    },
    byName: function (name) {
      var us = this.db.users;
      for (var i = 0; i < us.length; i++) if (us[i].name === name) return us[i];
      return null;
    },
    register: function (name, pass, avatar) {
      name = String(name || '').trim();
      if (name.length < 2 || name.length > 12) return { ok: false, msg: '昵称需 2~12 个字符' };
      if (String(pass || '').length < 4) return { ok: false, msg: '密码至少 4 位' };
      if (this.byName(name)) return { ok: false, msg: '该昵称已被注册' };
      var u = newUser(name, pass, avatar || '◈', false);
      u.difficulty = 'elite';
      this.db.users.push(u);
      this.db.currentId = u.id; this.db.lastId = u.id;
      this.persist();
      return { ok: true, msg: '注册成功', user: u };
    },
    login: function (name, pass) {
      var u = this.byName(String(name || '').trim());
      if (!u) return { ok: false, msg: '账号不存在，请先注册' };
      if (u.guest) return { ok: false, msg: '游客档案请用「游客试玩」进入' };
      if (u.pass !== hash(u.name + ':' + String(pass || ''))) return { ok: false, msg: '密码不正确' };
      u.lastLogin = today();
      this.db.currentId = u.id; this.db.lastId = u.id;
      this.persist();
      return { ok: true, msg: '欢迎回来', user: u };
    },
    guest: function () {
      if (!this.db) this.load();
      var us = this.db.users, i, g = null;
      for (i = 0; i < us.length; i++) if (us[i].guest) { g = us[i]; break; }
      if (!g) { g = newUser('游客玩家', '', '☠', true); us.push(g); }
      g.lastLogin = today();
      this.db.currentId = g.id; this.db.lastId = g.id;
      this.persist();
      return g;
    },
    logout: function () {
      if (!this.db) this.load();
      this.db.currentId = null;
      this.persist();
    },

    /* 每日签到：连续天数越高，开局加成越明显 */
    sign: function () {
      var u = this.current();
      if (!u) return { ok: false, msg: '请先登录', days: 0 };
      if (u.signDate === today()) return { ok: false, msg: '今日已签到，明天再来', days: u.signDays };
      u.signDays = (u.signDate === yesterday() ? (u.signDays || 0) + 1 : 1);
      u.signDate = today();
      this.persist();
      return { ok: true, msg: '签到成功 · 连续 ' + u.signDays + ' 天', days: u.signDays, bonus: this.bonus() };
    },
    bonus: function () {
      var u = this.current(), d = u ? (u.signDays || 0) : 0;
      var achN = u ? Object.keys(u.ach || {}).length : 0;
      return {
        days: d,
        hp: Math.min(45, d * 5),
        energy: Math.min(60, d * 8),
        rerolls: d >= 5 ? 1 : 0,
        scoreMul: 1 + Math.min(0.35, d * 0.04) + Math.min(0.20, achN * 0.025),
        achN: achN
      };
    },
    setDifficulty: function (id) {
      var u = this.current();
      if (!u) return null;
      for (var i = 0; i < DIFFS.length; i++) if (DIFFS[i].id === id) { u.difficulty = id; this.persist(); return DIFFS[i]; }
      return null;
    },
    difficulty: function () {
      var u = this.current(), id = u ? u.difficulty : 'normal';
      for (var i = 0; i < DIFFS.length; i++) if (DIFFS[i].id === id) return DIFFS[i];
      return DIFFS[0];
    },
    unlock: function (id) {
      var u = this.current();
      if (!u || u.ach[id]) return false;
      u.ach[id] = today();
      this.persist();
      return true;
    },
    achCount: function () {
      var u = this.current();
      return u ? Object.keys(u.ach || {}).length : 0;
    },
    title: function () {
      var u = this.current(), s = u ? u.stats : blank(), f = s.bestFloor || 0;
      if (f >= 12) return '深渊主宰';
      if (f >= 8) return '炼狱统帅';
      if (f >= 5) return '裂隙行者';
      if (f >= 3) return '超频先锋';
      if ((s.totalRuns || 0) > 0) return '见习特工';
      return '新晋特工';
    },
    leaderboard: function () {
      if (!this.db) this.load();
      var out = [], us = this.db.users;
      for (var i = 0; i < us.length; i++) {
        var s = us[i].stats || {};
        out.push({ name: us[i].name, avatar: us[i].avatar, guest: !!us[i].guest,
          floor: s.bestFloor || 0, score: s.bestScore || 0, kills: s.totalKills || 0,
          me: us[i].id === this.db.currentId });
      }
      out.sort(function (a, b) { return b.floor - a.floor || b.score - a.score; });
      return out;
    }
  };

  A.load();

  /* ---------- 把原单档 U.Save 接到「当前登录档案」上 ----------
   * ui.js 里 `var save = U.Save.load()` 无需改动，切换账号时由 portal 调 setSave 重新绑定。 */
  U.Save.load = function () {
    var prof = A.current(), d = blank();
    if (prof && prof.stats) merge(d, prof.stats);
    this.data = d;
    return d;
  };
  U.Save.save = function () {
    var prof = A.current();
    if (prof) {
      prof.stats = JSON.parse(JSON.stringify(this.data || blank()));
      A.persist();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
