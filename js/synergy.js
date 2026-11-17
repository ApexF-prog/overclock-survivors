/* synergy.js — v8 海克斯羁绊系统（在 augments.js 之后、meta.js 之前加载）
 * 把强化按「羁绊归属」归类，凑齐 2/4/6 种不同强化触发阶梯效果——
 * 补上原 synergy 字段只有抽取权重、没有真实构筑奖励的深度缺口。
 * 档位单调递增：每次跨档 apply 一次增量并记账，避免乘法撤销的数值漂移。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, G = NS.Game.prototype, A = NS.Audio;

  /* ---------------- 羁绊定义：每种羁绊指定成员强化 id + 3 档效果 ---------------- */
  var TRAITS = [
    { id: 'overclock', name: '超频', icon: '频', color: '#ff6b6b',
      desc: '极致输出， stacks 越多伤害越爆炸',
      members: ['hx_dmg', 'hx_haste', 'hx_crit', 'hx_apex', 'hx_rune_dmg', 'hx_rune_haste', 'hx_rune_crit'],
      tiers: [
        { n: 2, text: '伤害 +14%', apply: function (g) { g.player.dmgMul *= 1.14; } },
        { n: 4, text: '攻速 -8% · 暴击 +8%', apply: function (g) { g.player.haste *= 0.92; g.player.crit = Math.min(1, g.player.crit + 0.08); } },
        { n: 6, text: '伤害再 +35%', apply: function (g) { g.player.dmgMul *= 1.35; } }
      ] },
    { id: 'immortal', name: '不朽', icon: '生', color: '#9dff5c',
      desc: '续航与容错的极致，血越厚越难被磨死',
      members: ['hx_hp', 'hx_regen', 'hx_armor', 'hx_lifesteal', 'hx_omnivamp', 'hx_immortal', 'hx_rune_hp', 'hx_rune_regen'],
      tiers: [
        { n: 2, text: '每秒回血 +1.5', apply: function (g) { g.player.regen += 1.5; } },
        { n: 4, text: '生命 +40 · 减伤 +2', apply: function (g) { var p = g.player; p.maxHp += 40; p.hp = Math.min(p.maxHp, p.hp + 40); p.armor += 2; } },
        { n: 6, text: '濒死免疫一次（每 30 秒）', apply: function (g) { g.syn.deathWard = true; } }
      ] },
    { id: 'arsenal', name: '军械', icon: '军', color: '#ffd45c',
      desc: '弹幕与兵工厂，把屏幕铺满火力',
      members: ['hx_weapon', 'hx_weaponup', 'hx_proj', 'hx_evo', 'hx_arsenal', 'hx_chain', 'hx_rune_proj'],
      tiers: [
        { n: 2, text: '额外弹体 +1', apply: function (g) { g.player.extraProj += 1; } },
        { n: 4, text: '全武器 +1 级', apply: function (g) {
          var p = g.player, D = NS.DEFS;
          for (var i = 0; i < p.weapons.length; i++) {
            var w = p.weapons[i], d = D && D.weaponById[w.id];
            w.level = Math.min(d ? d.max : 8, w.level + 1);
          }
        } },
        { n: 6, text: '伤害 +30% · 弹体再 +1', apply: function (g) { g.player.dmgMul *= 1.30; g.player.extraProj += 1; } }
      ] },
    { id: 'gravity', name: '引力', icon: '引', color: '#a68bff',
      desc: '资源掠夺，经验、晶体与分数三重滚雪球',
      members: ['hx_magnet', 'hx_xp', 'hx_autoloot', 'hx_chest', 'hx_greed', 'hx_rune_xp'],
      tiers: [
        { n: 2, text: '拾取范围 +25%', apply: function (g) { g.player.pickup *= 1.25; } },
        { n: 4, text: '经验 +28%', apply: function (g) { g.player.xpMul *= 1.28; } },
        { n: 6, text: '宝箱率 +10% · 分数 +35%', apply: function (g) {
          g.hex.chestChance += 0.10; g.hex.scoreMul *= 1.35;
        } }
      ] },
    { id: 'singularity', name: '奇点', icon: '奇', color: '#7df9ff',
      desc: '领域掌控，减速、清场与 EMP 的终极形态',
      members: ['hx_speed', 'hx_field', 'hx_nova', 'hx_energy', 'hx_singularity', 'hx_overload', 'hx_rune_speed'],
      tiers: [
        { n: 2, text: '移速 +7% · EMP 充能 +25%', apply: function (g) { g.player.speed *= 1.07; g.hex.energyMul *= 1.25; } },
        { n: 4, text: '常驻脉冲护环', apply: function (g) { g.hex.nova = Math.max(1, g.hex.nova); g.hex.novaT = 0.5; } },
        { n: 6, text: '常驻奇点领域', apply: function (g) { g.hex.singularity = Math.max(1, g.hex.singularity); } }
      ] },
    { id: 'phantom', name: '幻影', icon: '影', color: '#ff7ae0',
      desc: '暴击与连锁的暗杀艺术',
      members: ['hx_chain', 'hx_immortal', 'hx_overload', 'hx_apex', 'hx_rune_crit', 'hx_rune_dmg'],
      tiers: [
        { n: 2, text: '暴击伤害 +0.5', apply: function (g) { g.player.critMul += 0.5; } },
        { n: 4, text: '连锁湮灭强化', apply: function (g) { g.hex.chain = Math.max(1, g.hex.chain); } },
        { n: 6, text: '暴击率 +20% · 伤害 +25%', apply: function (g) { g.player.crit = Math.min(1, g.player.crit + 0.20); g.player.dmgMul *= 1.25; } }
      ] }
  ];

  /* 反查表：强化 id → 羁绊（一个强化可属于多个羁绊，但每个羁绊内部按成员计） */
  var BY_AUG = {};
  TRAITS.forEach(function (t) {
    t.members.forEach(function (id) {
      (BY_AUG[id] || (BY_AUG[id] = [])).push(t.id);
    });
  });
  function traitById(id) { for (var i = 0; i < TRAITS.length; i++) if (TRAITS[i].id === id) return TRAITS[i]; return null; }

  var S = NS.Synergy = {
    traits: TRAITS,
    byAugment: function (id) { return (BY_AUG[id] || []).slice(); },

    /* 当前每种羁绊的「不同强化种类数」 */
    counts: function (g) {
      var taken = (g.hex && g.hex.taken) || {}, out = {};
      TRAITS.forEach(function (t) {
        var n = 0;
        for (var i = 0; i < t.members.length; i++) if ((taken[t.members[i]] || 0) > 0) n++;
        out[t.id] = n;
      });
      return out;
    },

    /* 达到的最高档位序号（0=未激活）；tierIndex 0/1/2 对应 tiers[0..2] */
    tierOf: function (n) {
      return n >= 6 ? 3 : (n >= 4 ? 2 : (n >= 2 ? 1 : 0));
    },

    /* 供 UI 展示的羁绊进度快照 */
    summary: function (g) {
      var counts = this.counts(g), out = [];
      TRAITS.forEach(function (t) {
        var n = counts[t.id], tier = S.tierOf(n), next = null;
        for (var k = 0; k < t.tiers.length; k++) if (n < t.tiers[k].n) { next = t.tiers[k].n; break; }
        out.push({ id: t.id, name: t.name, icon: t.icon, color: t.color, desc: t.desc,
          count: n, tier: tier, maxTier: t.tiers.length, next: next,
          active: tier > 0 ? t.tiers[tier - 1].text : null,
          tiers: t.tiers.map(function (x) { return { n: x.n, text: x.text, on: n >= x.n }; }) });
      });
      return out;
    },

    /* 重算：只 apply 新增跨过的档位，不撤销旧档位 */
    recalc: function (g, silent) {
      if (!g.hex) return [];
      var counts = this.counts(g), fired = [];
      TRAITS.forEach(function (t) {
        var n = counts[t.id], want = S.tierOf(n), applied = (g.syn.applied[t.id] || 0);
        while (applied < want) {
          var tierDef = t.tiers[applied];
          if (tierDef && tierDef.apply) {
            tierDef.apply(g);
            fired.push({ trait: t.name, icon: t.icon, color: t.color, level: applied + 1, text: tierDef.text });
          }
          applied++;
        }
        g.syn.applied[t.id] = want;
      });
      if (fired.length && !silent) {
        var top = fired[fired.length - 1];
        g.onEvent('synergy', { fired: fired, top: top });
        g.onEvent('toast', { text: '羁绊激活 // ' + top.icon + ' ' + top.name + ' ' + top.level + ' · ' + top.text, long: true });
        if (A && A.play) A.play('evolve');
        if (g.fx) g.fx.addFlash(0.28, '180,240,255');
      }
      return fired;
    }
  };

  /* ---------------- 包装链 ---------------- */
  var _reset = G.reset;
  G.reset = function () {
    _reset.call(this);
    this.syn = { applied: {}, deathWard: false, wardAt: -1e9, guard: false };
  };

  var _chooseUpgrade = G.chooseUpgrade;
  G.chooseUpgrade = function (idx) {
    var c = this._choices && this._choices[idx], hadAug = !!(c && c.aug);
    _chooseUpgrade.call(this, idx);
    if (hadAug && this.state !== 'result') S.recalc(this);
  };

  /* 卡片增加羁绊归属提示 */
  var _getChoices = G.getChoices;
  G.getChoices = function () {
    var cards = _getChoices.call(this), self = this;
    cards.forEach(function (c) {
      if (c.kind !== 'augment' || !c.id) return;
      var tags = S.byAugment(c.id), counts = S.counts(self), best = null;
      tags.forEach(function (tid) {
        var t = traitById(tid), n = counts[tid];
        if (!best || n > best.n) best = { t: t, n: n };
      });
      if (best && best.t) {
        c.synergyTag = { name: best.t.name, color: best.t.color, count: best.n,
          next: best.t.tiers[0].n, near: best.n >= best.t.tiers[0].n - 1 };
      }
    });
    return cards;
  };

  /* 羁绊 HUD 数据并入 hexSummary（经 getHud → d.hex.synergies） */
  var _hexSummary = G.hexSummary;
  G.hexSummary = function () {
    var s = _hexSummary.call(this);
    if (s) s.synergies = S.summary(this);
    return s;
  };

  /* 不朽 6 档：濒死免死，每 30 秒一次（绕过无敌帧的直接回血） */
  var _hurtPlayer = G.hurtPlayer;
  G.hurtPlayer = function (amount) {
    if (this.syn && this.syn.deathWard && !this.syn.guard) {
      var p = this.player, now = this.time || 0;
      if (p && p.hp - amount <= 0 && (now - (this.syn.wardAt || -1e9)) >= 30) {
        this.syn.guard = true;
        p.hp = Math.max(p.hp, p.maxHp * 0.45);
        this.syn.wardAt = now;
        this.onEvent('toast', { text: '羁绊「不朽」// 濒死免疫', long: true });
        if (this.fx) this.fx.addFlash(0.5, '157,255,92');
        if (A && A.play) A.play('shield');
        /* 用 0 伤害走一遍原始受击流程（闪白 / 震屏 / 无敌帧），但不真正扣血 */
        _hurtPlayer.call(this, 0);
        this.syn.guard = false;
        return;
      }
    }
    return _hurtPlayer.call(this, amount);
  };

  NS.TRAITS = TRAITS;
})(typeof window !== 'undefined' ? window : globalThis);
