/* lab.js — v7 元成长：超频核心 + 研究所永久升级树（在 account.js 之后、meta.js 之前加载）
 * 结算按层数/首领/击杀/分数产出「超频核心」，在门户研究所兑换永久属性，
 * 每局开局由 meta.js 调用 Lab.applyToGame 注入。纯本地档案隔离，零联网。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var A = NS.Account;

  /* 升级项：per 为每级增量，base 为 1 级价格基数，max 为满级 */
  var UPS = [
    { id: 'vigor',  name: '生命矩阵', icon: '❤', color: '#ff5c7a', base: 40, max: 6,
      desc: function (l) { return '初始生命 +' + (l * 18); },
      apply: function (g, l) { g.player.maxHp += l * 18; g.player.hp = g.player.maxHp; } },
    { id: 'power',  name: '超频核心', icon: '⚡', color: '#ffb84d', base: 55, max: 6,
      desc: function (l) { return '全局伤害 +' + (l * 6) + '%'; },
      apply: function (g, l) { g.player.dmgMul *= 1 + l * 0.06; } },
    { id: 'focus',  name: '精准校准', icon: '✦', color: '#4dd8ff', base: 60, max: 5,
      desc: function (l) { return '暴击率 +' + (l * 3) + '%'; },
      apply: function (g, l) { g.player.crit = Math.min(1, g.player.crit + l * 0.03); } },
    { id: 'repair', name: '纳米修复', icon: '✚', color: '#9dff5c', base: 50, max: 5,
      desc: function (l) { return '每秒回血 +' + (l * 0.2).toFixed(1); },
      apply: function (g, l) { g.player.regen += l * 0.2; } },
    { id: 'charge', name: '能量电容', icon: '◎', color: '#8bf6ff', base: 45, max: 5,
      desc: function (l) { return '开局能量 +' + (l * 14) + '%'; },
      apply: function (g, l) { g.energy = Math.min(100, g.energy + l * 14); } },
    { id: 'fortune', name: '幸运回路', icon: '✹', color: '#c2a8ff', base: 70, max: 4,
      desc: function (l) { return '分数 +' + (l * 6) + '% · 开局重掷 +' + Math.floor(l / 2); },
      apply: function (g, l) { g.diffScore *= 1 + l * 0.06; g.rerolls += Math.floor(l / 2); } }
  ];

  function u() { return A && A.current ? A.current() : null; }
  function ensure() {
    var p = u();
    if (!p) return null;
    if (typeof p.cores !== 'number' || !isFinite(p.cores) || p.cores < 0) p.cores = 0;
    if (!p.lab || typeof p.lab !== 'object' || Array.isArray(p.lab)) p.lab = {};
    return p;
  }
  function def(id) { for (var i = 0; i < UPS.length; i++) if (UPS[i].id === id) return UPS[i]; return null; }
  function lv(id) { var p = u(); return p && p.lab ? (p.lab[id] || 0) : 0; }
  function cost(id) {
    var d = def(id); if (!d) return Infinity;
    var L = lv(id);
    if (L >= d.max) return Infinity;
    return Math.round(d.base * (1 + L * 0.85));
  }

  var Lab = NS.Lab = {
    upgrades: UPS,
    cores: function () { var p = ensure(); return p ? p.cores : 0; },
    level: lv,
    cost: cost,
    maxed: function (id) { var d = def(id); return !!d && lv(id) >= d.max; },
    desc: function (id, level) {
      var d = def(id); if (!d) return '';
      return d.desc(level === undefined ? (lv(id) + 1) : level);
    },

    /* 结算产出：层数为主，首领/击杀/分数/时间辅助，再乘难度系数 */
    grant: function (r) {
      var p = ensure();
      if (!p || !r) return 0;
      var diff = NS.Account.difficulty();
      var mul = diff && diff.score ? diff.score : 1;
      var raw = (r.floor || 1) * 3 + (r.bossKills || 0) * 6 +
        Math.floor((r.kills || 0) / 40) + Math.floor((r.score || 0) / 1500) +
        Math.floor((r.time || 0) / 60);
      var gained = Math.max(1, Math.round(raw * mul));
      p.cores = (p.cores || 0) + gained;
      A.persist();
      return gained;
    },

    buy: function (id) {
      var p = ensure(), d = def(id);
      if (!p || !d) return { ok: false, msg: '无效升级' };
      var L = lv(id);
      if (L >= d.max) return { ok: false, msg: '已满级' };
      var c = cost(id);
      if (p.cores < c) return { ok: false, msg: '超频核心不足' };
      p.cores -= c;
      p.lab[id] = L + 1;
      A.persist();
      return { ok: true, msg: d.name + ' 升至 LV' + (L + 1), level: L + 1, cost: c };
    },

    /* 开局注入：必须在 meta.reset 应用难度/签到之后调用 */
    applyToGame: function (g) {
      var applied = [];
      for (var i = 0; i < UPS.length; i++) {
        var d = UPS[i], L = lv(d.id);
        if (L > 0) { d.apply(g, L); applied.push({ id: d.id, name: d.name, level: L }); }
      }
      return applied;
    },

    summary: function () {
      var out = [];
      for (var i = 0; i < UPS.length; i++) {
        var d = UPS[i], L = lv(d.id);
        out.push({ id: d.id, name: d.name, icon: d.icon, color: d.color,
          level: L, max: d.max, cost: cost(d.id), maxed: L >= d.max,
          desc: L > 0 ? d.desc(L) : '未激活', next: L >= d.max ? '' : d.desc(L + 1) });
      }
      return out;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
