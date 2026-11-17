/* augments.js — 海克斯强化层（参考 LoL 海克斯大乱斗 ARAM: Mayhem）
 * 三品质构筑：银色(基础) / 金色(机制质变) / 棱彩(Build 定义级)
 * 在 systems.js 之后加载，通过包装原型方法接入，不改动主状态机。
 * 用户痛点全部做成可抽到的构筑：全域牵引(自动拾取)、血契协议(击杀吸血)、
 * 纳米修复(续航)、力场共鸣(增益力场)、脉冲护环/奇点领域(反围攻)、超武蓝图(进化保底)。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, D = NS.DEFS, C = NS.CONTENT, A = NS.Audio;
  var G = NS.Game.prototype;
  var H = NS.HEX = { list: [], byId: {}, tier: {} };

  H.tier = {
    silver:    { name: '银色', color: '#9fc6e8', tag: 'COMMON' },
    gold:      { name: '金色', color: '#ffd45c', tag: 'RARE' },
    prismatic: { name: '棱彩', color: '#ff7ae0', tag: 'PRISMATIC' },
    /* v5：池子抽空后的持续成长层，上限极高，保证永远有得选 */
    endless:   { name: '无尽', color: '#66f0ff', tag: 'ENDLESS' }
  };

  function def(o) {
    if (!o.max) o.max = 1;
    if (!o.synergy) o.synergy = [];
    if (!o.available) o.available = function () { return true; };
    H.list.push(o); H.byId[o.id] = o;
    return o;
  }

  /* ---------------- 银色：基础属性 / 武器 ---------------- */
  def({ id: 'hx_dmg', name: '超频核心', icon: '核', color: '#ff6b6b', tier: 'silver', max: 6,
    desc: function (l) { return '全武器伤害 +14%（第 ' + l + ' 层）'; },
    synergy: ['hx_apex', 'hx_arsenal'],
    apply: function (g) { g.player.dmgMul *= 1.14; } });
  def({ id: 'hx_haste', name: '冷却矩阵', icon: '频', color: '#4dd8ff', tier: 'silver', max: 6,
    desc: function (l) { return '全武器攻击间隔 -12%（第 ' + l + ' 层）'; },
    synergy: ['hx_apex', 'hx_nova'],
    apply: function (g) { g.player.haste *= 0.88; } });
  def({ id: 'hx_speed', name: '疾行引擎', icon: '速', color: '#7dffb0', tier: 'silver', max: 5,
    desc: function () { return '移动速度 +9%，更容易从包围里脱身'; },
    apply: function (g) { g.player.speed *= 1.09; } });
  def({ id: 'hx_hp', name: '装甲镀层', icon: '甲', color: '#ffb84d', tier: 'silver', max: 6,
    desc: function () { return '最大生命 +30，并立即回复 30'; },
    synergy: ['hx_immortal', 'hx_lifesteal'],
    apply: function (g) { var p = g.player; p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 30); } });
  def({ id: 'hx_magnet', name: '引力场', icon: '引', color: '#a68bff', tier: 'silver', max: 4,
    desc: function () { return '经验拾取范围 +30%'; },
    synergy: ['hx_autoloot', 'hx_greed'],
    apply: function (g) { g.player.pickup *= 1.30; } });
  def({ id: 'hx_xp', name: '数据解析', icon: '析', color: '#5cffd6', tier: 'silver', max: 4,
    desc: function () { return '经验获取 +18%，升级更快'; },
    synergy: ['hx_autoloot', 'hx_greed'],
    apply: function (g) { g.player.xpMul *= 1.18; } });
  def({ id: 'hx_crit', name: '弱点扫描', icon: '暴', color: '#ff8ad8', tier: 'silver', max: 5,
    desc: function () { return '暴击率 +7%（暴击 2 倍伤害）'; },
    apply: function (g) { g.player.crit += 0.07; } });
  def({ id: 'hx_regen', name: '纳米修复', icon: '修', color: '#9dff5c', tier: 'silver', max: 5,
    desc: function (l) { return '每秒回复 +1.2 生命（当前累计 ' + (1.2 * l + 0.4).toFixed(1) + '/秒）'; },
    synergy: ['hx_immortal', 'hx_lifesteal'],
    apply: function (g) { g.player.regen += 1.2; } });
  def({ id: 'hx_proj', name: '分裂协议', icon: '增', color: '#ffd45c', tier: 'silver', max: 3,
    desc: function () { return '额外弹体 +1，环绕光刃数量同步增加'; },
    synergy: ['hx_arsenal'],
    apply: function (g) { g.player.extraProj += 1; } });
  def({ id: 'hx_armor', name: '能量护盾', icon: '盾', color: '#7fa8ff', tier: 'silver', max: 4,
    desc: function () { return '每次受到的伤害 -2'; },
    synergy: ['hx_immortal'],
    apply: function (g) { g.player.armor += 2; } });
  def({ id: 'hx_weapon', name: '军械解锁', icon: '械', color: '#22e6ff', tier: 'silver', max: 6,
    desc: function () { return '随机获得一把尚未持有的武器；集齐后改为强化随机武器'; },
    available: function (g) { return true; },
    apply: function (g) {
      var p = g.player, i, owned = {}, free = [];
      for (i = 0; i < p.weapons.length; i++) owned[p.weapons[i].id] = 1;
      for (i = 0; i < D.weapons.length; i++) if (!owned[D.weapons[i].id]) free.push(D.weapons[i]);
      if (free.length) p.weapons.push({ id: U.pick(free).id, level: 1, timer: 0.1 });
      else if (p.weapons.length) {
        var w = U.pick(p.weapons), d = D.weaponById[w.id];
        w.level = Math.min(d ? d.max : 8, w.level + 2);
      }
    } });
  def({ id: 'hx_weaponup', name: '武器校准', icon: '校', color: '#8bf6ff', tier: 'silver', max: 8,
    desc: function () { return '随机一把已持有武器 +1 级（满级则改为伤害 +8%）'; },
    available: function (g) { return g.player.weapons.length > 0; },
    apply: function (g) {
      var p = g.player, i, cand = [];
      for (i = 0; i < p.weapons.length; i++) {
        var w = p.weapons[i], d = D.weaponById[w.id];
        if (!d || w.level < d.max) cand.push(w);
      }
      if (cand.length) U.pick(cand).level++;
      else p.dmgMul *= 1.08;
    } });

  /* ---------------- 金色：机制质变 ---------------- */
  def({ id: 'hx_autoloot', name: '全域牵引', icon: '吸', color: '#a68bff', tier: 'gold', max: 3,
    desc: function (l) { return '自动吸附全屏经验晶体、宝箱与地面道具' + (l > 1 ? '，牵引速度第 ' + l + ' 档' : '') + '；不用再回头捡'; },
    synergy: ['hx_xp', 'hx_chest', 'hx_magnet'],
    apply: function (g, l) { g.hex.autoLoot = l; } });
  def({ id: 'hx_lifesteal', name: '血契协议', icon: '血', color: '#ff5c7a', tier: 'gold', max: 4,
    desc: function (l) { return '每次击杀回复 ' + (1.5 + l * 1.2).toFixed(1) + ' 生命，精英 ×3、首领 ×12；怪越多越耐久'; },
    synergy: ['hx_omnivamp', 'hx_chain', 'hx_immortal'],
    apply: function (g, l) { g.hex.lifesteal = l; } });
  def({ id: 'hx_field', name: '力场共鸣', icon: '场', color: '#7dffb0', tier: 'gold', max: 3,
    desc: function (l) { return '增益力场内额外回复 +' + (3 + l * 4) + '/秒、持续充能 EMP，并与基础增益叠加'; },
    synergy: ['hx_nova', 'hx_singularity'],
    apply: function (g, l) { g.hex.field = l; } });
  def({ id: 'hx_nova', name: '脉冲护环', icon: '环', color: '#8b7cff', tier: 'gold', max: 3,
    desc: function (l) { return '每 ' + Math.max(1.4, 3.6 - l * 0.6).toFixed(1) + ' 秒自动爆发冲击波，击退并伤害近身敌群'; },
    synergy: ['hx_field', 'hx_singularity'],
    apply: function (g, l) { g.hex.nova = l; g.hex.novaT = 1.0; } });
  def({ id: 'hx_energy', name: '超载电芯', icon: '电', color: '#7df9ff', tier: 'gold', max: 3,
    desc: function () { return 'EMP 能量获取 ×1.8，过载伤害 +40%；按 Q 清屏更频繁'; },
    synergy: ['hx_overload'],
    apply: function (g) { g.hex.energyMul *= 1.8; g.hex.empDmgMul *= 1.4; } });
  def({ id: 'hx_chest', name: '寻宝协议', icon: '宝', color: '#ffc44d', tier: 'gold', max: 3,
    desc: function (l) { return '击杀有 ' + Math.round(7 * l) + '% 概率掉宝箱，且宝箱奖励条数提升'; },
    synergy: ['hx_autoloot', 'hx_evo'],
    apply: function (g, l) { g.hex.chestChance = 0.07 * l; g.hex.chestBonus = l; } });
  def({ id: 'hx_evo', name: '超武蓝图', icon: '武', color: '#8bf6ff', tier: 'gold', max: 6,
    desc: function () { return '立即把一把 LV3+ 武器进化为超武，无需凑指定被动；没有合适武器则武器 +2 级'; },
    synergy: ['hx_arsenal', 'hx_chest'],
    apply: function (g) {
      var p = g.player, i, cand = null;
      for (i = 0; i < p.weapons.length; i++) {
        var w = p.weapons[i], ev = C.evoByWeapon[w.id];
        if (ev && !g.evolved[w.id] && w.level >= 3) { cand = ev; break; }
      }
      if (cand) { g.applyEvolution(cand); return; }
      if (p.weapons.length) {
        var best = p.weapons[0];
        for (i = 1; i < p.weapons.length; i++) if (p.weapons[i].level > best.level) best = p.weapons[i];
        var d = D.weaponById[best.id];
        best.level = Math.min(d ? d.max : 8, best.level + 2);
      }
      p.dmgMul *= 1.1;
    } });
  def({ id: 'hx_omnivamp', name: '噬能回路', icon: '噬', color: '#ff9ff0', tier: 'gold', max: 3,
    desc: function (l) { return '造成伤害的 ' + (2.8 * l).toFixed(1) + '% 转化为生命，配合高攻速持续续航'; },
    synergy: ['hx_lifesteal', 'hx_chain'],
    apply: function (g, l) { g.hex.omnivamp = l; } });
  def({ id: 'hx_greed', name: '贪婪回路', icon: '贪', color: '#ffe14d', tier: 'gold', max: 3,
    desc: function () { return '击杀分数 ×1.4，经验 +20%'; },
    synergy: ['hx_autoloot', 'hx_xp'],
    apply: function (g) { g.hex.scoreMul *= 1.4; g.player.xpMul *= 1.2; } });

  /* ---------------- 棱彩：Build 定义级 ---------------- */
  def({ id: 'hx_singularity', name: '奇点领域', icon: '奇', color: '#b9a8ff', tier: 'prismatic', max: 2,
    desc: function (l) { return '身边常驻奇点：范围内敌人减速 44%、持续灼烧；被围攻时自动清出安全区'; },
    synergy: ['hx_field', 'hx_nova'],
    apply: function (g, l) { g.hex.singularity = l; } });
  def({ id: 'hx_overload', name: '绝对过载', icon: '绝', color: '#7df9ff', tier: 'prismatic', max: 1,
    desc: function () { return '能量满时自动释放 EMP（10 秒冷却），释放后回充 12 能量；不用记 Q 也不会无限清屏'; },
    synergy: ['hx_energy'],
    apply: function (g) { g.hex.overload = 1; } });
  def({ id: 'hx_arsenal', name: '军火协议', icon: '军', color: '#ffd45c', tier: 'prismatic', max: 1,
    desc: function () { return '全部武器 +2 级、额外弹体 +1、伤害 +25%'; },
    synergy: ['hx_evo', 'hx_apex'],
    apply: function (g) {
      var p = g.player, i;
      for (i = 0; i < p.weapons.length; i++) {
        var w = p.weapons[i], d = D.weaponById[w.id];
        if (d) w.level = Math.min(d.max, w.level + 2);
      }
      p.extraProj += 1; p.dmgMul *= 1.25;
    } });
  def({ id: 'hx_immortal', name: '不死协议', icon: '不', color: '#9dff5c', tier: 'prismatic', max: 2,
    desc: function () { return '最大生命 +90 并立即回复、受伤 -5、每秒回复 +3'; },
    synergy: ['hx_lifesteal', 'hx_hp', 'hx_regen'],
    apply: function (g) {
      var p = g.player;
      p.maxHp += 90; p.hp = Math.min(p.maxHp, p.hp + 90);
      p.armor += 5; p.regen += 3;
    } });
  def({ id: 'hx_chain', name: '连锁湮灭', icon: '链', color: '#ff7ae0', tier: 'prismatic', max: 2,
    desc: function (l) { return '击杀时 ' + Math.round(28 * l) + '% 概率引爆周围敌群，连锁清场'; },
    synergy: ['hx_lifesteal', 'hx_omnivamp'],
    apply: function (g, l) { g.hex.chain = l; } });
  def({ id: 'hx_apex', name: '终焉同调', icon: '终', color: '#ff2f8e', tier: 'prismatic', max: 1,
    desc: function () { return '伤害 +60%、攻速 +25%、拾取范围 +50%、能量获取 ×2'; },
    synergy: ['hx_dmg', 'hx_haste', 'hx_arsenal'],
    apply: function (g) {
      var p = g.player;
      p.dmgMul *= 1.6; p.haste *= 0.75; p.pickup *= 1.5;
      g.hex.energyMul *= 2; g.hex.empDmgMul *= 1.5;
    } });

  /* ---------------- 无尽：银/金/棱彩全部拿满后的持续成长（永不抽空） ---------------- */
  /* v5：此前全局只有 27 种强化、合计 102 次上限，LV100 之后池子被抽干，
     三张卡全变成「紧急修复」。这一层专门兜住高等级，上限 99 层，够打到任何等级。 */
  def({ id: 'hx_rune_dmg', name: '无尽超频', icon: '∞', color: '#ff6b6b', tier: 'endless', max: 99,
    desc: function (l) { return '全武器伤害 +10%（第 ' + l + ' 层，累计 ×' + Math.pow(1.10, l).toFixed(2) + '）'; },
    apply: function (g) { g.player.dmgMul *= 1.10; } });
  def({ id: 'hx_rune_haste', name: '无尽刻度', icon: '∞', color: '#4dd8ff', tier: 'endless', max: 99,
    desc: function (l) { return '攻击间隔 -6%（第 ' + l + ' 层，累计 ×' + Math.pow(0.94, l).toFixed(2) + '）'; },
    apply: function (g) { g.player.haste = Math.max(0.18, g.player.haste * 0.94); } });
  def({ id: 'hx_rune_hp', name: '无尽装甲', icon: '∞', color: '#ffb84d', tier: 'endless', max: 99,
    desc: function () { return '最大生命 +40、立即回复 40、每次受伤 -1'; },
    apply: function (g) {
      var p = g.player;
      p.maxHp += 40; p.hp = Math.min(p.maxHp, p.hp + 40); p.armor += 1;
    } });
  def({ id: 'hx_rune_crit', name: '无尽校准', icon: '∞', color: '#ff8ad8', tier: 'endless', max: 99,
    desc: function (l) { return '暴击率 +3%、暴击伤害 +10%（当前暴击率上限 100%）'; },
    apply: function (g) { g.player.crit = Math.min(1, g.player.crit + 0.03); g.player.critMul += 0.10; } });
  def({ id: 'hx_rune_regen', name: '无尽修复', icon: '∞', color: '#9dff5c', tier: 'endless', max: 99,
    desc: function (l) { return '每秒回复 +2 生命（第 ' + l + ' 层，累计 +' + (2 * l) + '/秒）'; },
    apply: function (g) { g.player.regen += 2; } });
  def({ id: 'hx_rune_xp', name: '无尽解析', icon: '∞', color: '#5cffd6', tier: 'endless', max: 99,
    desc: function (l) { return '经验获取 +12%（第 ' + l + ' 层，累计 ×' + Math.pow(1.12, l).toFixed(2) + '）'; },
    apply: function (g) { g.player.xpMul *= 1.12; } });
  def({ id: 'hx_rune_speed', name: '无尽疾行', icon: '∞', color: '#7dffb0', tier: 'endless', max: 99,
    desc: function () { return '移动速度 +4%（上限 380，防止漂移失控）'; },
    apply: function (g) { g.player.speed = Math.min(380, g.player.speed * 1.04); } });
  def({ id: 'hx_rune_proj', name: '无尽分裂', icon: '∞', color: '#ffd45c', tier: 'endless', max: 12,
    desc: function (l) { return '额外弹体 +1（第 ' + l + ' 层，上限 12，兼顾帧率）'; },
    apply: function (g) { g.player.extraProj += 1; } });

  /* ---------------- 抽取：品质权重随等级提升 + 协同加权 + 棱彩保底 ---------------- */
  function tierWeights(g) {
    var lv = g.player ? g.player.level : 1;
    var gold = 0.20 + Math.min(0.22, lv * 0.012);
    var pris = Math.min(0.20, Math.max(0.025, (lv - 4) * 0.014));
    return { silver: 1 - gold - pris, gold: gold, prismatic: pris };
  }
  function rollTier(w, forcePrismatic) {
    if (forcePrismatic) return 'prismatic';
    var r = Math.random();
    if (r < w.prismatic) return 'prismatic';
    if (r < w.prismatic + w.gold) return 'gold';
    return 'silver';
  }
  function pickAugment(g, tier, used) {
    var pool = [], total = 0, i, j;
    for (i = 0; i < H.list.length; i++) {
      var a = H.list[i];
      if (a.tier !== tier || used[a.id]) continue;
      if ((g.hex.taken[a.id] || 0) >= a.max) continue;
      if (!a.available(g)) continue;
      var wt = 10;
      for (j = 0; j < a.synergy.length; j++) {
        if (g.hex.taken[a.synergy[j]]) { wt = 22; break; }
      }
      pool.push({ a: a, w: wt }); total += wt;
    }
    if (!pool.length) return null;
    var r = Math.random() * total;
    for (i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return pool[i].a; }
    return pool[pool.length - 1].a;
  }
  function makeCard(g, a) {
    var lv = (g.hex.taken[a.id] || 0) + 1, syn = null, i;
    for (i = 0; i < a.synergy.length; i++) {
      var s = H.byId[a.synergy[i]];
      if (s && g.hex.taken[s.id]) { syn = s.name; break; }
    }
    return {
      kind: 'augment', id: a.id, level: lv, tier: a.tier,
      tierName: H.tier[a.tier].name, synergy: syn, aug: a,
      def: { name: a.name, icon: a.icon, color: a.color, max: a.max, desc: a.desc }
    };
  }
  function fallbackCards() {
    /* v5：保底卡不再三张一模一样，按 id 区分效果 */
    return [
      { kind: 'heal', id: 'hx_heal', level: 1, tier: 'silver', tierName: '银色', synergy: null, aug: null,
        def: { name: '紧急修复', icon: '愈', color: '#ffffff', max: 99,
          desc: function () { return '立即回复 40% 最大生命'; } } },
      { kind: 'heal', id: 'hx_energy', level: 1, tier: 'silver', tierName: '银色', synergy: null, aug: null,
        def: { name: '能量灌注', icon: '电', color: '#7df9ff', max: 99,
          desc: function () { return '立即充能 45 点 EMP，并回复 15% 生命'; } } },
      { kind: 'heal', id: 'hx_score', level: 1, tier: 'silver', tierName: '银色', synergy: null, aug: null,
        def: { name: '数据溢出', icon: '分', color: '#ffe14d', max: 99,
          desc: function () { return '分数 +1000，并回复 20% 生命'; } } }
    ];
  }

  /* ---------------- 状态初始化 ---------------- */
  var _reset = G.reset;
  G.reset = function () {
    _reset.call(this);
    this.hex = {
      taken: {}, count: 0, tiers: { silver: 0, gold: 0, prismatic: 0 }, sincePrism: 0,
      autoLoot: 0, lifesteal: 0, field: 0, nova: 0, novaT: 0,
      energyMul: 1, empDmgMul: 1, chestChance: 0, chestBonus: 0,
      omnivamp: 0, singularity: 0, overload: 0, overloadCd: 0, chain: 0, chainGuard: false,
      scoreMul: 1
    };
  };

  /* ---------------- 升级三选一 → 海克斯强化三选一 ---------------- */
  G.getChoices = function () {
    var g = this, out = [], used = {}, k, a, i;
    if (!g.hex) return fallbackCards();
    var w = tierWeights(g);
    var force = g.hex.sincePrism >= 6;
    for (k = 0; k < 3; k++) {
      /* v5：目标品质抽空后依次下探：金 → 银 → 无尽 → 棱彩，保证永远有三张真强化可选 */
      a = pickAugment(g, rollTier(w, force && k === 0), used);
      if (!a) a = pickAugment(g, 'gold', used);
      if (!a) a = pickAugment(g, 'silver', used);
      if (!a) a = pickAugment(g, 'endless', used);
      if (!a) a = pickAugment(g, 'prismatic', used);
      if (!a) break;
      used[a.id] = 1;
      out.push(makeCard(g, a));
    }
    if (out.length < 3) {
      var fb = fallbackCards();
      for (i = 0; out.length < 3; i++) out.push(fb[i % fb.length]);
    }
    return out;
  };

  G.chooseUpgrade = function (idx) {
    if (this.state !== 'levelup') return;
    var c = this._choices && this._choices[idx];
    if (!c) return;
    if (c.aug) {
      var a = c.aug, lv = (this.hex.taken[a.id] || 0) + 1;
      this.hex.taken[a.id] = lv;
      this.hex.count++;
      this.hex.tiers[a.tier] = (this.hex.tiers[a.tier] || 0) + 1;
      if (a.tier === 'prismatic') this.hex.sincePrism = 0;
      else this.hex.sincePrism++;
      a.apply(this, lv);
      this.onEvent('toast', { text: '海克斯强化 // ' + a.name, long: true });
      A.play(a.tier === 'silver' ? 'select' : 'evolve');
      this.fx.addFlash(a.tier === 'prismatic' ? 0.32 : 0.20,
        a.tier === 'prismatic' ? '255,122,224' : '180,240,255');
    } else {
      /* v5：三张保底卡效果不同 */
      var p = this.player;
      if (c.id === 'hx_energy') {
        this.energy = Math.min(100, this.energy + 45);
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15);
      } else if (c.id === 'hx_score') {
        this.score += 1000;
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.20);
      } else {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.4);
        this.score += 200;
      }
      A.play('select');
    }
    this.pendingLevels--;
    if (this.pendingLevels > 0) {
      this._choices = this.getChoices();
      this.onEvent('levelup', { choices: this._choices, level: this.player.level });
    } else {
      this.state = 'playing';
      NS.Audio.setPaused(false);
      /* 短暂防被贴身秒掉；高层升级频繁，缩短到 0.4s 避免累计成常驻无敌 */
      this.player.invuln = Math.max(this.player.invuln, 0.4);
      this.onEvent('resume', {});
    }
  };

  /* 重掷：每局有限次数，让构筑更可控（斗魂竞技场 / 云顶思路） */
  G.rerollAugments = function () {
    if (this.state !== 'levelup' || !this.hex || this.rerolls <= 0) return false;
    this.rerolls--;
    this._choices = this.getChoices();
    this.onEvent('levelup', { choices: this._choices, level: this.player.level });
    A.play('select');
    this.fx.addFlash(0.12, '180,240,255');
    return true;
  };

  /* ---------------- 击杀：吸血 / 能量 / 宝箱 / 连锁 / 分数 ---------------- */
  var _killEnemy = G.killEnemy;
  G.killEnemy = function (e) {
    if (e.dead) return;
    var g = this, hex = g.hex, p = g.player;
    var wasBoss = !!e.boss, wasElite = !!e.elite;
    _killEnemy.call(this, e);
    if (!hex) return;
    if (hex.lifesteal > 0) {
      var heal = (1.5 + hex.lifesteal * 1.2) * (wasBoss ? 12 : (wasElite ? 3 : 1));
      p.hp = Math.min(p.maxHp, p.hp + heal);
      if (wasBoss || wasElite) g.fx.text(p.x, p.y - 36, '+' + Math.round(heal), '#7dffb0', 15, true);
    }
    if (hex.energyMul > 1) {
      g.energy = Math.min(100, g.energy + (wasBoss ? 34 : (wasElite ? 9 : 2.4)) * (hex.energyMul - 1) * 0.5);
    }
    if (hex.scoreMul > 1) g.score += Math.round(e.score * (hex.scoreMul - 1));
    if (hex.chestChance > 0 && !wasBoss && Math.random() < hex.chestChance) g.spawnChest(e.x, e.y, 1);
    if (hex.chain > 0 && !hex.chainGuard && Math.random() < 0.28 * hex.chain) {
      hex.chainGuard = true;
      var R = 120 + hex.chain * 20, dmg = 24 + p.level * 3, i, o;
      g.fx.ring(e.x, e.y, 8, R, '#ff7ae0', 4, 0.4);
      for (i = 0; i < g.enemies.length; i++) {
        o = g.enemies[i];
        if (o.dead || o === e) continue;
        if (U.dist2(e.x, e.y, o.x, o.y) < R * R) {
          g.damageEnemy(o, dmg, '#ff7ae0', o.x - e.x, o.y - e.y, 120);
        }
      }
      hex.chainGuard = false;
    }
  };

  /* ---------------- 命中吸血 ---------------- */
  var _damageEnemy = G.damageEnemy;
  G.damageEnemy = function (e, dmg, color, kx, ky, knock) {
    if (e.dead) return;
    var hex = this.hex, before = e.hp;
    var r = _damageEnemy.call(this, e, dmg, color, kx, ky, knock);
    if (hex && hex.omnivamp > 0) {
      var dealt = before - e.hp;
      if (dealt > 0) {
        var p = this.player;
        p.hp = Math.min(p.maxHp, p.hp + dealt * 0.028 * hex.omnivamp);
      }
    }
    return r;
  };

  /* ---------------- 每帧：自动过载 / 脉冲护环 / 奇点灼烧 ---------------- */
  function pulseNova(g, lv) {
    var p = g.player, R = 115 + lv * 22, dmg = 18 + p.level * 3 + lv * 8, i, e;
    g.fx.ring(p.x, p.y, 12, R, '#8b7cff', 4, 0.4);
    g.fx.addShake(3);
    for (i = 0; i < g.enemies.length; i++) {
      e = g.enemies[i];
      if (e.dead) continue;
      if (U.dist2(p.x, p.y, e.x, e.y) < R * R) {
        g.damageEnemy(e, dmg, '#8b7cff', e.x - p.x, e.y - p.y, 260);
      }
    }
  }
  var _preUpdate = G.preUpdate;
  G.preUpdate = function (dt) {
    _preUpdate.call(this, dt);
    var g = this, hex = g.hex;
    if (!hex || g.state !== 'playing') return;
    /* v4：自动过载加 10 秒冷却、回充降到 12，避免「割草→满能量→自动清屏」无限循环 */
    if (hex.overloadCd > 0) hex.overloadCd -= dt;
    if (hex.overload > 0 && hex.overloadCd <= 0 && g.energy >= 100) {
      g.tryUltimate();
      hex.overloadCd = 10;
      g.energy = Math.min(100, g.energy + 12);
    }
    if (hex.nova > 0) {
      hex.novaT -= dt;
      if (hex.novaT <= 0) {
        hex.novaT = Math.max(1.4, 3.6 - hex.nova * 0.6);
        pulseNova(g, hex.nova);
      }
    }
    if (hex.singularity > 0) {
      var R = 165 + hex.singularity * 25, p = g.player;
      var dps = 8 + hex.singularity * 6, i, en;
      for (i = g.enemies.length - 1; i >= 0; i--) {
        en = g.enemies[i];
        if (en.dead) continue;
        if (U.dist2(p.x, p.y, en.x, en.y) < R * R) {
          en.hp -= dps * dt;
          en.hitFlash = Math.max(en.hitFlash, 0.05);
          if (en.hp <= 0) g.killEnemy(en);
        }
      }
    }
  };

  /* ---------------- 世界物件：全域牵引 + 力场共鸣 ---------------- */
  var _updateWorldObjects = G.updateWorldObjects;
  G.updateWorldObjects = function (dt) {
    _updateWorldObjects.call(this, dt);
    var g = this, hex = g.hex, p = g.player;
    if (!hex) return;
    if (hex.autoLoot > 0) {
      var speed = 320 + hex.autoLoot * 180, i, o, d, f;
      for (i = 0; i < g.gems.length; i++) {
        o = g.gems[i]; d = U.hypot(p.x - o.x, p.y - o.y) || 1;
        f = Math.min(1, speed * dt / d);
        o.x += (p.x - o.x) * f; o.y += (p.y - o.y) * f;
      }
      for (i = 0; i < g.chests.length; i++) {
        o = g.chests[i]; d = U.hypot(p.x - o.x, p.y - o.y) || 1;
        if (d > 34) { f = Math.min(1, speed * 0.65 * dt / d); o.x += (p.x - o.x) * f; o.y += (p.y - o.y) * f; }
      }
      for (i = 0; i < g.pickups.length; i++) {
        o = g.pickups[i]; d = U.hypot(p.x - o.x, p.y - o.y) || 1;
        if (d > 26) { f = Math.min(1, speed * 0.8 * dt / d); o.x += (p.x - o.x) * f; o.y += (p.y - o.y) * f; }
      }
    }
    if (hex.field > 0) {
      for (var z = 0; z < g.zones.length; z++) {
        var zone = g.zones[z];
        if (zone.kind === 'buff' && U.dist2(p.x, p.y, zone.x, zone.y) < zone.r * zone.r) {
          p.hp = Math.min(p.maxHp, p.hp + (3 + hex.field * 4) * dt);
          g.energy = Math.min(100, g.energy + hex.field * 3 * dt);
          break;
        }
      }
    }
  };

  /* ---------------- 宝箱奖励条数提升 ---------------- */
  var _openChest = G.openChest;
  G.openChest = function (c) {
    if (this.hex && this.hex.chestBonus > 0) {
      c.rarity = Math.max(c.rarity || 1, 1 + this.hex.chestBonus);
    }
    return _openChest.call(this, c);
  };

  /* ---------------- 奇点减速 ---------------- */
  var _enemyUpdate = NS.Enemy.prototype.update;
  NS.Enemy.prototype.update = function (dt, game) {
    if (game.hex && game.hex.singularity > 0) {
      var R = 165 + game.hex.singularity * 25;
      if (U.dist2(this.x, this.y, game.player.x, game.player.y) < R * R) dt *= 0.56;
    }
    return _enemyUpdate.call(this, dt, game);
  };

  /* ---------------- HUD 汇总 ---------------- */
  G.hexSummary = function () {
    var h = this.hex;
    if (!h) return null;
    var items = [], i;
    for (i = 0; i < H.list.length; i++) {
      var a = H.list[i], lv = h.taken[a.id] || 0;
      if (lv > 0) items.push({ name: a.name, icon: a.icon, color: a.color, tier: a.tier, level: lv });
    }
    return { items: items, count: h.count, tiers: h.tiers,
      autoLoot: h.autoLoot, lifesteal: h.lifesteal };
  };
})(typeof window !== 'undefined' ? window : globalThis);
