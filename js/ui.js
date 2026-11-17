/* ui.js — DOM 界面、设置、存档、触屏控件、键盘快捷键（v2） */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, D = NS.DEFS;
  var doc = root.document;
  function $(id) { return doc.getElementById(id); }

  var save = U.Save.load();
  var canvas = $('game');
  var AUTOTEST = !!(root.location && root.location.search.indexOf('autotest=1') >= 0);
  var game = new NS.Game(canvas, {
    quality: save.settings.quality, volume: save.settings.volume,
    manualTick: AUTOTEST, onEvent: onEvent
  });
  NS.game = game;

  var SCREENS = ['menu', 'help', 'settings', 'levelup', 'pause', 'result', 'contract'];
  var current = 'menu';
  var hudTick = 0, wSig = '', augSig = '', floorSig = '', affSig = '', synSig = '', toastTimer = null, lootTimer = null, autoFrames = 0;
  var bossWarnTimer = null, floorBannerTimer = null, bossWarnSeq = 0, floorBannerSeq = 0;
  var shownLoot = null, lootQueue = null;   // 宝箱奖励排队，避免与升级面板抢画面
  var isTouch = ('ontouchstart' in root) || (root.navigator && root.navigator.maxTouchPoints > 0);

  function hideLoot() {
    $('loot-popup').classList.remove('show');
    if (lootTimer) { clearTimeout(lootTimer); lootTimer = null; }
  }

  function setScreen(name) {
    /* 进入任何全屏面板（升级/暂停/结算/菜单）时，把正在展示的奖励收起并排队 */
    if (name !== null && lootTimer) {
      lootQueue = shownLoot || lootQueue;
      hideLoot();
    }
    current = name;
    for (var i = 0; i < SCREENS.length; i++) {
      $('screen-' + SCREENS[i]).classList.toggle('hidden', SCREENS[i] !== name);
    }
    var showHud = (name === null || name === 'pause' || name === 'levelup' || name === 'result' || name === 'contract');
    $('hud').classList.toggle('hidden', !showHud);
    $('touch-controls').classList.toggle('hidden', !(isTouch && name === null));
    if (name !== null) hideControlHint();
    if (name === 'pause') renderPauseInfo();
  }

  /* v10：暂停面板显示本局战术快照，不用退出就能复盘构筑 */
  function renderPauseInfo() {
    var box = $('pause-info');
    if (!box) return;
    var p = game.player || {};
    var syn = (NS.Synergy && game.hex) ? NS.Synergy.summary(game) : null;
    var formed = syn ? syn.filter(function (s) { return s.tier > 0; }) : [];
    box.innerHTML = '';
    var cells = [
      ['层数', '第 ' + (game.floor || 1) + ' 层'],
      ['存活', U.fmtTime(game.time || 0)],
      ['击杀', game.kills || 0],
      ['等级', 'LV ' + (p.level || 1)],
      ['分数', Math.round(game.score || 0)],
      ['生命', Math.round(p.hp || 0) + '/' + Math.max(1, Math.round(p.maxHp || 0))]
    ];
    for (var i = 0; i < cells.length; i++) {
      var c = doc.createElement('div');
      c.className = 'pause-cell';
      var lab = doc.createElement('span'); lab.textContent = cells[i][0];
      var val = doc.createElement('b'); val.textContent = cells[i][1];
      c.appendChild(lab); c.appendChild(val);
      box.appendChild(c);
    }
    var row = doc.createElement('div');
    row.className = 'pause-build';
    var ws = p.weapons || [];
    for (var w = 0; w < ws.length; w++) {
      var d = D.weaponById[ws[w].id];
      var chip = doc.createElement('span');
      chip.className = 'pause-chip';
      chip.textContent = (d ? d.icon + ' ' + d.name : ws[w].id) + (ws[w].evolved ? ' · EVO' : ' · LV' + ws[w].level);
      if (d) chip.style.borderColor = d.color;
      row.appendChild(chip);
    }
    for (var s = 0; s < formed.length; s++) {
      var sc = doc.createElement('span');
      sc.className = 'pause-chip syn';
      sc.textContent = '◆ ' + formed[s].name + ' ' + formed[s].tier + ' 阶';
      sc.style.borderColor = formed[s].color;
      sc.style.color = formed[s].color;
      row.appendChild(sc);
    }
    if (!ws.length && !formed.length) {
      var none = doc.createElement('span');
      none.className = 'pause-chip';
      none.textContent = '尚无构筑';
      row.appendChild(none);
    }
    box.appendChild(row);
  }

  /* v10：开局几秒的操作提示（触屏 / 键鼠分别提示），不打断老玩家 */
  var hintTimer = null;
  function showControlHint() {
    var el = $('control-hint');
    if (!el) return;
    el.innerHTML = isTouch
      ? '左摇杆移动 · 右下 <b>冲刺</b> / <b>EMP</b> · 武器全自动开火'
      : '<b>WASD</b> 移动 · <b>SPACE</b> 冲刺 · <b>Q</b> EMP · <b>P</b> 暂停 · <b>M</b> 静音';
    el.classList.remove('hidden');
    root.requestAnimationFrame(function () { el.classList.add('on'); });
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideControlHint, 6500);
  }
  function hideControlHint() {
    var el = $('control-hint');
    if (!el) return;
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    el.classList.remove('on');
    el.classList.add('hidden');
  }

  /* v10：全局静音（M），只压 master，不动用户设的音量 */
  function toggleMute() {
    var on = NS.Audio.toggleMute();
    save.settings.muted = !!on;
    U.Save.save();
    showToast(on ? '🔇 已静音 · 按 M 恢复' : '🔊 声音已恢复', !!on, true);
    if (!on) NS.Audio.play('select');
  }

  function refreshBest() {    /* 直接读当前档案的持久化数据，切换账号后菜单纪录不会显示上一个档案的缓存 */
    var prof = NS.Account && NS.Account.current();
    var s = (prof && prof.stats) || save;
    $('best-line').textContent = '最深第 ' + Math.max(1, s.bestFloor || 1) + ' 层' +
      ' · 最高分 ' + (s.bestScore || 0) +
      ' · 最长存活 ' + U.fmtTime(s.bestTime || 0) +
      ' · 累计击杀 ' + (s.totalKills || 0);
  }

  function showToast(text, danger, long) {
    var t = $('toast');
    t.textContent = text;
    t.classList.toggle('danger', !!danger);
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, long ? 2600 : 1400);
  }

  /* v4：首领入场全屏警报 —— 层数、名字、血量、强度倍率一目了然 */
  function showBossWarning(data) {
    var seq = ++bossWarnSeq;
    $('bw-floor').textContent = data.floor;
    $('bw-name').textContent = data.name;
    $('bw-hp').textContent = Math.round(data.hp).toLocaleString();
    $('bw-scale').textContent = data.scale;
    var aw = $('bw-affix');
    aw.textContent = (data.affixes && data.affixes.length)
      ? '首领词缀 // ' + data.affixes.join(' · ') : '';
    aw.classList.toggle('hidden', !(data.affixes && data.affixes.length));
    var el = $('boss-warning');
    el.classList.remove('hidden');
    if (bossWarnTimer) clearTimeout(bossWarnTimer);
    root.requestAnimationFrame(function () { el.classList.add('show'); });
    bossWarnTimer = setTimeout(function () {
      if (seq !== bossWarnSeq) return;
      el.classList.remove('show');
      /* 延迟收起的旧定时器不能把新一轮警报藏掉 */
      setTimeout(function () { if (seq === bossWarnSeq) el.classList.add('hidden'); }, 300);
    }, 2300);
  }

  /* v4：击破首领、进入下一层的绿色横幅 */
  function showFloorBanner(data) {
    var seq = ++floorBannerSeq;
    $('fb-title').textContent = '进入第 ' + data.next + ' 层';
    var el = $('floor-banner');
    el.classList.remove('hidden');
    if (floorBannerTimer) clearTimeout(floorBannerTimer);
    root.requestAnimationFrame(function () { el.classList.add('show'); });
    floorBannerTimer = setTimeout(function () {
      if (seq !== floorBannerSeq) return;
      el.classList.remove('show');
      setTimeout(function () { if (seq === floorBannerSeq) el.classList.add('hidden'); }, 300);
    }, 1800);
  }

  function startGame() {
    NS.Audio.init(save.settings.volume, save.settings.musicVol == null ? 0.9 : save.settings.musicVol);
    NS.Audio.setMusicEnabled(save.settings.musicOn !== false);
    NS.Audio.setMute(save.settings.muted === true);
    NS.Audio.resume();
    $('event-banner').classList.add('hidden');
    $('combo-box').classList.add('hidden');
    lootQueue = null; shownLoot = null; hideLoot();
    $('ult-ready-hint').classList.add('hidden');
    $('danger-vignette').classList.remove('on');
    $('boss-warning').classList.remove('show');
    $('floor-banner').classList.remove('show');
    $('augment-list').innerHTML = ''; $('synergy-bar').innerHTML = '';
    augSig = ''; floorSig = ''; affSig = ''; synSig = '';
    game.start();
    /* 立即写入当前档案的难度，不等下一帧 HUD 刷新 */
    if (game.diff) {
      $('diff-text').textContent = game.diff.name;
      $('diff-text').style.color = game.diff.color;
    }
    $('contract-text').textContent = '0';
    showControlHint();
  }

  /* ---------------- 事件总线 ---------------- */
  function onEvent(type, data) {
    switch (type) {
      case 'start': setScreen(null); wSig = ''; break;
      case 'pause': setScreen('pause'); break;
      case 'resume': setScreen(null); break;
      case 'menu': setScreen('menu'); refreshBest(); break;
      case 'levelup': renderCards(data.choices, data.level); setScreen('levelup'); break;
      case 'result': handleResult(data); break;
      case 'toast': showToast(data.text, data.danger, data.long); break;
      case 'frame':
        updateHud(data);
        heartbeat(data);
        if (lootQueue && current === null) flushLoot();
        break;
      case 'event': showEvent(data); break;
      case 'eventEnd': $('event-banner').classList.add('hidden'); break;
      case 'chest': showLoot(data.rewards); break;
      case 'ult': $('energy-box').classList.remove('ready'); break;
      case 'bossIncoming': showBossWarning(data); break;
      case 'floorClear': showFloorBanner(data); break;
      case 'contract': renderContract(data); setScreen('contract'); break;
    }
  }

  function showEvent(e) {
    var b = $('event-banner');
    b.style.setProperty('--ev-color', e.color);
    $('event-name').textContent = e.name;
    $('event-text').textContent = e.text;
    b.classList.remove('hidden');
  }

  function showLoot(rewards) {
    /* 连续开箱时合并奖励并限制行数，避免弹窗被覆盖或撑得过高 */
    lootQueue = (lootQueue || []).concat(rewards).slice(-5);
    if (current !== null) { hideLoot(); return; }   // 升级/暂停/结算时不遮挡界面
    flushLoot();
  }

  function flushLoot() {
    if (!lootQueue || current !== null) return;
    var rewards = lootQueue;
    lootQueue = null; shownLoot = rewards;
    var box = $('loot-list');
    box.innerHTML = '';
    for (var i = 0; i < rewards.length; i++) {
      var d = doc.createElement('div');
      d.className = 'loot-item';
      d.textContent = '+ ' + rewards[i].name;
      d.style.color = rewards[i].color || '#ffe14d';
      box.appendChild(d);
    }
    var pop = $('loot-popup');
    pop.classList.remove('hidden');
    if (lootTimer) clearTimeout(lootTimer);
    root.requestAnimationFrame(function () { pop.classList.add('show'); });
    lootTimer = setTimeout(function () {
      pop.classList.remove('show');
      shownLoot = null; lootTimer = null;
    }, 2300);
  }

  /* ---------------- HUD ---------------- */
  /* v10：残血心跳 —— 血量越低间隔越短，配合屏幕红晕给出压力反馈 */
  var heartNext = 0;
  function heartbeat(d) {
    if (!d || game.state !== 'playing') { heartNext = 0; return; }
    var r = d.hp / Math.max(1, d.maxHp);
    if (r > 0.32) { heartNext = 0; return; }
    if (d.time < heartNext) return;
    heartNext = d.time + 0.6 + (r / 0.32) * 0.6;
    NS.Audio.play('heart');
  }

  function updateHud(d) {
    if (AUTOTEST) {
      autoFrames++;
      if (autoFrames % 30 === 0) {
        $('autotest-out').textContent = JSON.stringify({
          frames: autoFrames, state: game.state, time: +d.time.toFixed(2),
          enemies: game.enemies.length, bullets: game.bullets.length,
          kills: d.kills, score: d.score, level: d.level,
          hp: Math.round(d.hp), fps: d.fps, boss: !!d.boss,
          stage: d.stage, combo: d.combo, energy: Math.round(d.energy),
          chests: d.chestCount, evolutions: d.evolutionCount,
          event: d.event ? d.event.name : null,
          camx: game.cam.x, camy: game.cam.y, W: game.W, H: game.H, dpr: game.dpr,
          props: game.props ? game.props.length : 0, zones: game.zones ? game.zones.length : 0,
          hex: d.hex ? d.hex.count : 0, perf: d.perfLevel, rerolls: d.rerolls,
          duel: +(d.duelTimer || 0).toFixed(1), hpRatio: +(d.hpRatio || 0).toFixed(2),
          floor: d.floor, floorState: d.floorState, bossKills: d.bossKills,
          bossWarning: +(d.bossWarning || 0).toFixed(1), enemyCap: d.enemyCap,
          state2: d.state, contracts: d.contractCount, diff: d.difficulty ? d.difficulty.tag : '',
          bossAffixes: (d.bossAffixes || []).length, ach: d.achCount
        });
      }
    }
    if ((hudTick++ & 1) !== 0) return;
    $('hp-fill').style.width = U.clamp(d.hp / d.maxHp * 100, 0, 100) + '%';
    $('hp-text').textContent = Math.ceil(d.hp) + ' / ' + Math.round(d.maxHp);
    $('xp-fill').style.width = U.clamp(d.xp / d.xpNeed * 100, 0, 100) + '%';
    $('xp-text').textContent = Math.floor(d.xp) + ' / ' + d.xpNeed;
    $('lv-text').textContent = 'LV ' + d.level;
    $('time-text').textContent = U.fmtTime(d.time);
    /* v4 无尽层：层数 + 首领倒计时，只在数值变化时写 DOM */
    var fsig = d.floor + ':' + d.floorState + ':' + Math.ceil(d.floorLeft || 0) + ':' + (d.boss ? 1 : 0);
    if (fsig !== floorSig) {
      floorSig = fsig;
      $('floor-text').innerHTML = '第 ' + d.floor + ' 层 <em>无尽炼狱</em>';
      $('wave-text').textContent = d.floorState === 'boss'
        ? (d.boss ? '⚠ 首领战 · 击破后进入下一层' : '⚠ 战场清理中')
        : '准备波 · 首领倒计时 ' + Math.ceil(d.floorLeft || 0) + 's';
    }
    $('kill-text').textContent = d.kills;
    $('score-text').textContent = d.score;
    $('fps-text').textContent = d.fps + (d.perf && d.perf.cap ? '/' + d.perf.cap : '');
    if (d.perf && $('ft-text')) $('ft-text').textContent = d.perf.ft + 'ms';
    /* v9 每日挑战 HUD：仅挑战局显示 */
    var dh = $('daily-hud');
    if (dh) {
      if (d.daily) {
        dh.classList.remove('hidden');
        $('dh-goal').textContent = '目标 第 ' + d.daily.goal + ' 层';
        $('dh-progress').textContent = (d.daily.floor || 1) + ' / ' + d.daily.goal;
        $('dh-status').textContent = d.daily.reached ? '✓ 已达标' : '进行中';
        dh.classList.toggle('reached', !!d.daily.reached);
      } else dh.classList.add('hidden');
    }
    if (d.difficulty) {
      $('diff-text').textContent = d.difficulty.name;
      $('diff-text').style.color = d.difficulty.color;
    }
    $('contract-text').textContent = d.contractCount || 0;
    $('dash-fill').style.width = (d.dash * 100) + '%';
    $('dash-label').textContent = d.dash >= 1 ? '就绪' : Math.ceil((1 - d.dash) * game.player.dashCdMax) + 's';

    /* v2：阶段 / 连杀 / 能量 / 事件 */
    $('stage-name').textContent = d.stageName || '启动区';
    $('stage-sub').textContent = d.stageSub || 'INIT';
    $('stage-fill').style.width = (U.clamp(d.stageProgress || 0, 0, 1) * 100) + '%';

    var cb = $('combo-box');
    if (d.combo >= 3) {
      cb.classList.remove('hidden');
      $('combo-num').textContent = d.combo;
      $('combo-mul').textContent = 'x' + (d.comboMul || 1).toFixed(1);
    } else cb.classList.add('hidden');

    var eb = $('energy-box');
    $('energy-fill').style.width = U.clamp(d.energy || 0, 0, 100) + '%';
    $('energy-label').textContent = Math.floor(d.energy || 0) + '%';
    eb.classList.toggle('ready', !!d.ultReady);

    if (d.event) {
      $('event-fill').style.width = U.clamp(d.event.left / d.event.total * 100, 0, 100) + '%';
    }

    /* v3：已获强化 chip / EMP 就绪醒目提示 / 低血危险边框 */
    var al = $('augment-list');
    var hexSig = d.hex ? d.hex.count + ':' + d.hex.items.map(function (x) {
      return x.name + x.level;
    }).join(',') : '';
    if (hexSig !== augSig) {
      augSig = hexSig;
      al.innerHTML = '';
      if (d.hex) {
        for (var hi = 0; hi < d.hex.items.length; hi++) {
          var it = d.hex.items[hi], chip = doc.createElement('div');
          chip.className = 'augchip tier-' + it.tier;
          chip.style.borderLeftColor = it.color;
          chip.textContent = it.icon + (it.level > 1 ? ' ×' + it.level : '');
          chip.title = it.name + (it.level > 1 ? ' ×' + it.level : '');
          al.appendChild(chip);
        }
      }
    }
    /* v8：羁绊栏——已激活的羁绊阶梯，进度变化时重绘 */
    var sb = $('synergy-bar');
    var syns = d.hex && d.hex.synergies ? d.hex.synergies : null;
    var synSigLocal = syns ? syns.map(function (s) { return s.id + s.count; }).join(',') : '';
    if (synSigLocal !== synSig) {
      synSig = synSigLocal;
      sb.innerHTML = '';
      if (syns) {
        syns.forEach(function (s) {
          if (s.count <= 0) return;   // 只展示已投入的羁绊
          var chip = doc.createElement('div');
          chip.className = 'syn-chip' + (s.tier > 0 ? ' active' : '');
          chip.style.setProperty('--syn-color', s.color);
          var dots = '';
          for (var q = 0; q < s.maxTier; q++) dots += '<i' + (q < s.tier ? ' class="on"' : '') + '></i>';
          chip.innerHTML = '<span class="syn-ic">' + s.icon + '</span>' +
            '<span class="syn-name">' + s.name + '</span>' +
            '<span class="syn-count">' + s.count + '</span>' +
            '<span class="syn-dots">' + dots + '</span>';
          chip.title = s.name + ' ' + s.count + ' 件' + (s.active ? ' · ' + s.active : (s.next ? ' · 再 ' + (s.next - s.count) + ' 件激活' : ''));
          sb.appendChild(chip);
        });
      }
    }
    $('ult-ready-hint').classList.toggle('hidden', !d.ultReady);
    $('danger-vignette').classList.toggle('on', !!d.hpRatio && d.hpRatio < 0.32);

    var sig = '';
    for (var i = 0; i < d.weapons.length; i++) {
      sig += d.weapons[i].id + d.weapons[i].level + (d.weapons[i].evolved ? 'E' : '') + '|';
    }
    if (sig !== wSig) {
      wSig = sig;
      var wl = $('weapon-list');
      wl.innerHTML = '';
      for (i = 0; i < d.weapons.length; i++) {
        var w = d.weapons[i];
        var chip = doc.createElement('div');
        chip.className = 'wchip' + (w.evolved ? ' evolved' : '');
        chip.style.borderLeftColor = w.color;
        var ic = doc.createElement('i'); ic.textContent = w.icon; ic.style.color = w.color;
        var nm = doc.createElement('span'); nm.textContent = w.name;
        var lv = doc.createElement('em'); lv.textContent = w.evolved ? 'EVO' : 'LV' + w.level;
        chip.appendChild(ic); chip.appendChild(nm); chip.appendChild(lv);
        wl.appendChild(chip);
      }
    }
    var bh = $('boss-hud');
    if (d.boss) {
      bh.classList.remove('hidden');
      $('boss-name').textContent = d.boss.name;
      $('boss-floor').textContent = 'L' + d.boss.floor;
      $('boss-hp-text').textContent = Math.round(d.boss.ratio * 100) + '%';
      $('boss-fill').style.width = (d.boss.ratio * 100) + '%';
      /* v10：血条颜色跟随狂暴阶段，配合 50% / 22% 刻度线，阶段跃迁可预判 */
      bh.classList.toggle('enraged', d.boss.ratio <= 0.5);
      bh.classList.toggle('critical', d.boss.ratio <= 0.22);
    } else {
      bh.classList.add('hidden');
      bh.classList.remove('enraged', 'critical');
    }

    /* v6：首领词缀标签（壁垒 / 噬主 / 崩解 …），只在变化时重建 DOM */
    var affs = d.bossAffixes || [];
    var asig = affs.map(function (a) { return a.name; }).join(',');
    var ab = $('boss-affix');
    if (asig !== affSig) {
      affSig = asig;
      ab.innerHTML = '';
      for (var ai = 0; ai < affs.length; ai++) {
        var s = doc.createElement('span');
        s.className = 'aff-chip';
        s.textContent = affs[ai].name;
        s.title = affs[ai].desc;
        ab.appendChild(s);
      }
    }
    ab.classList.toggle('hidden', affs.length === 0);
  }

  /* ---------------- 炼狱契约三选一 ---------------- */
  function renderContract(data) {
    $('contract-floor').textContent = data.floor;
    var box = $('contract-cards');
    box.innerHTML = '';
    for (var i = 0; i < data.choices.length; i++) {
      (function (idx) {
        var c = data.choices[idx];
        var btn = doc.createElement('button');
        btn.className = 'upgrade-card pact-card';
        btn.style.setProperty('--card-color', c.color);
        var n = doc.createElement('span'); n.className = 'idx'; n.textContent = '0' + (idx + 1);
        var ic = doc.createElement('div'); ic.className = 'uicon'; ic.textContent = c.icon;
        var h = doc.createElement('h3'); h.textContent = c.name;
        var cu = doc.createElement('p'); cu.className = 'pact-curse'; cu.textContent = '✖ 诅咒 // ' + c.curse;
        var bo = doc.createElement('p'); bo.className = 'pact-boon'; bo.textContent = '✚ 收益 // ' + c.boon;
        var lv = doc.createElement('div'); lv.className = 'lvl';
        lv.textContent = '第 ' + data.floor + ' 层 · 已签 ' + data.taken + ' 张';
        btn.appendChild(n); btn.appendChild(ic); btn.appendChild(h);
        btn.appendChild(cu); btn.appendChild(bo); btn.appendChild(lv);
        btn.addEventListener('click', function () { game.chooseContract(idx); });
        box.appendChild(btn);
      })(i);
    }
  }

  /* ---------------- 升级卡片 ---------------- */
  function renderCards(choices, level) {
    $('levelup-title').textContent = '海克斯强化 · LV ' + level;
    $('reroll-count').textContent = game.rerolls;
    $('btn-reroll').disabled = game.rerolls <= 0;
    var box = $('upgrade-cards');
    box.innerHTML = '';
    for (var i = 0; i < choices.length; i++) {
      (function (idx) {
        var c = choices[idx], def = c.def;
        var tier = c.tier || 'silver';
        var tinfo = (NS.HEX && NS.HEX.tier) ?
          NS.HEX.tier[tier] : { name: '银色', color: def.color, tag: 'COMMON' };
        var btn = doc.createElement('button');
        btn.className = 'upgrade-card aug-tier-' + tier;
        btn.style.setProperty('--card-color', def.color);
        btn.style.setProperty('--tier-color', tinfo.color);
        var lvl = c.kind === 'heal' ? '即时补充' :
          (c.level ? '第 ' + c.level + ' 层 / 共 ' + def.max : '');
        btn.innerHTML = '<span class="idx">0' + (idx + 1) + '</span>' +
          '<div class="tier-badge">' + tinfo.name + ' · ' + tinfo.tag + '</div>' +
          '<div class="uicon">' + def.icon + '</div>' +
          '<h3>' + def.name + '</h3>' +
          '<p>' + def.desc(c.level) + '</p>' +
          (c.synergy ? '<div class="synhint">协同 // 已持有「' + c.synergy + '」</div>' : '') +
          (c.synergyTag ? '<div class="trait-hint" style="--trait-color:' + c.synergyTag.color + '">◆ ' + c.synergyTag.name + '羁绊 ' + c.synergyTag.count + '/' + c.synergyTag.next + (c.synergyTag.near ? ' · 即将激活' : '') + '</div>' : '') +
          (c.evoHint ? '<div class="evohint">' + c.evoHint + '</div>' : '') +
          '<div class="lvl">' + lvl + '</div>';
        btn.addEventListener('click', function () { game.chooseUpgrade(idx); });
        box.appendChild(btn);
      })(i);
    }
  }

  /* ---------------- 结算与存档 ---------------- */
  function handleResult(r) {
    var floor = r.floor || 1;
    var newScore = r.score > save.bestScore;
    var newTime = r.time > save.bestTime;
    var newFloor = floor > (save.bestFloor || 0);
    save.totalRuns++;
    save.totalKills += r.kills;
    if (newScore) save.bestScore = r.score;
    if (newTime) save.bestTime = r.time;
    if (newFloor) save.bestFloor = floor;
    U.Save.save();

    /* v7：按战果结算超频核心（游客也有档案），供研究所永久升级 */
    var coresEarned = 0, coresTotal = 0;
    if (NS.Lab && NS.Account && NS.Account.current()) {
      coresEarned = NS.Lab.grant(r);
      coresTotal = NS.Lab.cores();
    }

    /* v4：无尽模式没有「通关」，结算核心指标是抵达层数与击破首领数 */
    $('result-badge').textContent = 'RUN TERMINATED // ENDLESS INFERNO';
    $('result-title').textContent = '挑战终止 · 第 ' + floor + ' 层';
    $('result-sub').textContent = '无尽炼狱没有终点 · 击破首领 ' + (r.bossKills || 0) + ' 只' +
      ' · 难度 ' + (r.difficulty || '标准') + ' · 契约 ' + (r.contracts || []).length + ' 张' +
      ' · 最强武器：' + (r.bestWeapon || '—');
    var cells = [
      ['抵达层数', '第 ' + floor + ' 层', newFloor],
      ['击破首领', r.bossKills || 0, false],
      ['存活时间', U.fmtTime(r.time), newTime],
      ['最终分数', r.score, newScore],
      ['击杀数', r.kills, false],
      ['等级', 'LV ' + r.level, false],
      ['最高连杀', r.maxCombo || 0, false],
      ['宝箱开启', r.chests || 0, false],
      ['超武进化', r.evolutions || 0, false],
      ['EMP 释放', r.ults || 0, false],
      ['海克斯强化', r.hexCount || 0, false],
      ['最深纪录', '第 ' + Math.max(1, save.bestFloor || 1) + ' 层', false],
      ['超频核心 +' + coresEarned, coresTotal + ' 枚', true]
    ];
    var box = $('result-stats');
    box.innerHTML = '';
    for (var i = 0; i < cells.length; i++) {
      var div = doc.createElement('div');
      if (cells[i][2]) div.className = 'hi';
      var s = doc.createElement('span'); s.textContent = cells[i][0] + (cells[i][2] ? ' · 新纪录' : '');
      var b = doc.createElement('b'); b.textContent = cells[i][1];
      div.appendChild(s); div.appendChild(b); box.appendChild(div);
    }
    /* v3：结算展示本局构筑，制造重玩动机 */
    var build = $('result-build');
    build.innerHTML = '';
    if (r.hexItems && r.hexItems.length) {
      var bt = doc.createElement('div');
      bt.className = 'build-title';
      bt.textContent = '本局构筑 · ' + r.hexCount + ' 项海克斯强化';
      build.appendChild(bt);
      var row = doc.createElement('div'); row.className = 'build-row';
      for (var bi = 0; bi < r.hexItems.length; bi++) {
        var it = r.hexItems[bi], bchip = doc.createElement('span');
        bchip.className = 'build-chip tier-' + it.tier;
        bchip.style.borderColor = it.color;
        bchip.textContent = it.icon + ' ' + it.name + (it.level > 1 ? ' ×' + it.level : '');
        row.appendChild(bchip);
      }
      build.appendChild(row);
    }
    /* v8：结算展示本局成型的羁绊构筑 */
    var synSource = (NS.Synergy && game.hex) ? NS.Synergy.summary(game) : null;
    if (synSource) {
      var formed = synSource.filter(function (s) { return s.tier > 0; });
      var st = doc.createElement('div');
      st.className = 'build-title';
      st.textContent = '成型羁绊 · ' + formed.length + ' 个';
      build.appendChild(st);
      var srow = doc.createElement('div'); srow.className = 'build-row';
      if (!formed.length) {
        var empty = doc.createElement('span');
        empty.className = 'build-chip';
        empty.style.borderColor = 'rgba(120,160,210,.3)';
        empty.textContent = '本局未凑齐羁绊 · 试试同类强化叠加';
        srow.appendChild(empty);
      }
      formed.forEach(function (s) {
        var sc = doc.createElement('span');
        sc.className = 'build-chip syn-result';
        sc.style.borderColor = s.color;
        sc.style.color = s.color;
        var txt = s.icon + ' ' + s.name + ' ' + s.tier + '阶';
        (s.tiers || []).forEach(function (t) { if (t.on) txt += ' [' + t.n + ']'; });
        sc.textContent = txt;
        srow.appendChild(sc);
      });
      build.appendChild(srow);
    }
    $('event-banner').classList.add('hidden');
    $('combo-box').classList.add('hidden');
    $('ult-ready-hint').classList.add('hidden');
    $('danger-vignette').classList.remove('on');
    $('boss-warning').classList.remove('show');
    $('floor-banner').classList.remove('show');
    setScreen('result');
  }

  /* ---------------- 设置 ---------------- */
  function applySettings(fill) {
    var s = save.settings;
    game.setVolume(s.volume);
    game.setShake(s.shake);
    game.setQuality(s.quality);
    if (game.setBloom) game.setBloom(s.bloom !== false);
    if (NS.Perf && NS.Perf.setMode) NS.Perf.setMode(s.fps || 'auto');
    if (fill) {
      $('set-volume').value = Math.round(s.volume * 100);
      $('set-volume-val').textContent = Math.round(s.volume * 100) + '%';
      if ($('set-music-vol')) {
        var mv = s.musicVol == null ? 0.9 : s.musicVol;
        $('set-music-vol').value = Math.round(mv * 100);
        $('set-music-vol-val').textContent = Math.round(mv * 100) + '%';
      }
      if ($('set-music-on')) $('set-music-on').checked = s.musicOn !== false;
      if ($('set-muted')) $('set-muted').checked = s.muted === true;
      $('set-quality').value = s.quality;
      $('set-shake').checked = !!s.shake;
      $('set-bloom').checked = s.bloom !== false;
      if ($('set-fps')) $('set-fps').value = s.fps || 'auto';
    }
    NS.Audio.setMusicVolume(s.musicVol == null ? 0.9 : s.musicVol);
    NS.Audio.setMusicEnabled(s.musicOn !== false);
    NS.Audio.setMute(s.muted === true);
    U.Save.save();
  }
  $('set-music-vol').addEventListener('input', function () {
    save.settings.musicVol = Number(this.value) / 100;
    if ($('set-music-vol-val')) $('set-music-vol-val').textContent = this.value + '%';
    NS.Audio.setMusicVolume(save.settings.musicVol);
    U.Save.save();
  });
  $('set-music-on').addEventListener('change', function () {
    save.settings.musicOn = this.checked;
    NS.Audio.setMusicEnabled(this.checked);
    U.Save.save();
  });
  if ($('set-muted')) $('set-muted').addEventListener('change', function () {
    save.settings.muted = this.checked;
    NS.Audio.setMute(this.checked);
    U.Save.save();
  });

  /* v10：恢复默认设置（只重置音频/画质/帧率，不动账号与纪录） */
  if ($('btn-reset-settings')) $('btn-reset-settings').addEventListener('click', function () {
    save.settings.volume = 0.85;
    save.settings.musicVol = 0.9;
    save.settings.musicOn = true;
    save.settings.muted = false;
    save.settings.quality = 'high';
    save.settings.bloom = true;
    save.settings.shake = true;
    save.settings.fps = 'auto';
    if (NS.Perf && NS.Perf.setMode) NS.Perf.setMode('auto');
    applySettings(true);
    showToast('已恢复默认设置', false, true);
    NS.Audio.play('select');
  });

  /* v10：清除本机全部存档（二次确认，纯本地数据，不影响其他设备） */
  if ($('btn-wipe-save')) $('btn-wipe-save').addEventListener('click', function () {
    if (!root.confirm('确定清除本机全部存档？账号、超频核心、研究所等级与所有纪录都会删除。')) return;
    if (!root.confirm('再次确认：该操作无法恢复，只影响这台设备。')) return;
    try {
      if (root.localStorage) {
        root.localStorage.removeItem('neon_survivors_v1');
        root.localStorage.removeItem('os_accounts_v1');
      }
    } catch (e) { /* 隐私模式容错 */ }
    root.location.reload();
  });
  $('set-volume').addEventListener('input', function () {
    save.settings.volume = Number(this.value) / 100;
    $('set-volume-val').textContent = this.value + '%';
    game.setVolume(save.settings.volume);
    U.Save.save();
    NS.Audio.play('select');
  });
  $('set-quality').addEventListener('change', function () {
    save.settings.quality = this.value;
    game.setQuality(this.value);
    U.Save.save();
  });
  $('set-shake').addEventListener('change', function () {
    save.settings.shake = this.checked;
    game.setShake(this.checked);
    U.Save.save();
  });
  $('set-bloom').addEventListener('change', function () {
    save.settings.bloom = this.checked;
    if (game.setBloom) game.setBloom(this.checked);
    U.Save.save();
  });
  if ($('set-fps')) $('set-fps').addEventListener('change', function () {
    save.settings.fps = this.value;
    if (NS.Perf && NS.Perf.setMode) NS.Perf.setMode(this.value);
    U.Save.save();
    NS.Audio.play('select');
  });

  /* ---------------- 按钮 ---------------- */
  $('btn-reroll').addEventListener('click', function () { game.rerollAugments(); });
  $('btn-start').addEventListener('click', startGame);
  $('btn-help').addEventListener('click', function () { setScreen('help'); });
  $('btn-settings').addEventListener('click', function () { setScreen('settings'); });
  $('btn-help-back').addEventListener('click', function () { setScreen('menu'); });
  $('btn-settings-back').addEventListener('click', function () { setScreen('menu'); });
  $('btn-resume').addEventListener('click', function () { game.resume(); });
  $('btn-restart').addEventListener('click', startGame);
  $('btn-quit').addEventListener('click', function () { game.toMenu(); });
  $('btn-again').addEventListener('click', startGame);
  $('btn-menu').addEventListener('click', function () { game.toMenu(); });

  /* v10：一键复制本局战绩，方便发给朋友 / 贴到群里 */
  if ($('btn-share')) $('btn-share').addEventListener('click', function () {
    var r = game.result || {};
    var txt = '【超频幸存者】第 ' + (r.floor || 1) + ' 层 · ' + (r.score || 0) + ' 分 · 击杀 ' +
      (r.kills || 0) + ' · 击破首领 ' + (r.bossKills || 0) + ' 只 · 存活 ' + U.fmtTime(r.time || 0) +
      '。试玩：https://apexf-prog.github.io/overclock-survivors/';
    function fallback() {
      try {
        var ta = doc.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        doc.body.appendChild(ta); ta.select();
        doc.execCommand('copy');
        doc.body.removeChild(ta);
        showToast('战绩已复制', false, true);
      } catch (e) { showToast('复制失败，请手动截图', true); }
    }
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      root.navigator.clipboard.writeText(txt).then(function () {
        showToast('战绩已复制 · 直接粘贴给朋友', false, true);
      }, fallback);
    } else fallback();
  });
  $('btn-account').addEventListener('click', function () {
    if (game.state !== 'menu' && game.state !== 'result') game.toMenu();
    setScreen('menu');
    NS.Portal.show();
  });
  $('btn-skip-contract').addEventListener('click', function () { game.chooseContract(-1); });

  /* ---------------- 键盘 ---------------- */
  root.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (NS.Portal && NS.Portal.isOpen()) return;   // 登录门户打开时由门户接管
    var c = e.code;
    if (c === 'KeyM') { toggleMute(); return; }     // v10：随时静音，任何界面都生效
    if (game.state === 'contract') {
      var ci = (c === 'Digit1' || c === 'Numpad1') ? 0 :
               (c === 'Digit2' || c === 'Numpad2') ? 1 :
               (c === 'Digit3' || c === 'Numpad3') ? 2 : -1;
      if (ci >= 0) { game.chooseContract(ci); return; }
      if (c === 'Digit4' || c === 'Numpad4' || c === 'Escape') { game.chooseContract(-1); return; }
    }
    if (game.state === 'levelup') {
      if (c === 'KeyR') { game.rerollAugments(); return; }
      var idx = (c === 'Digit1' || c === 'Numpad1') ? 0 :
                (c === 'Digit2' || c === 'Numpad2') ? 1 :
                (c === 'Digit3' || c === 'Numpad3') ? 2 : -1;
      if (idx >= 0) { game.chooseUpgrade(idx); return; }
    }
    if ((game.state === 'menu' || game.state === 'result') && (c === 'Enter' || c === 'NumpadEnter')) {
      startGame(); return;
    }
    if (game.state === 'paused' && (c === 'KeyP' || c === 'Escape')) {
      game.input.keys.delete('KeyP');
      game.input.keys.delete('Escape');
      game.resume(); return;
    }
    if (c === 'Escape' && (current === 'help' || current === 'settings')) setScreen('menu');
  });

  /* ---------------- 触屏摇杆 ---------------- */
  var joy = $('joystick'), knob = $('joystick-knob');
  var joyId = null, joyCx = 0, joyCy = 0, JOY_MAX = 44;
  function moveJoy(t) {
    var dx = t.clientX - joyCx, dy = t.clientY - joyCy;
    var len = U.hypot(dx, dy);
    if (len > JOY_MAX) { dx = dx / len * JOY_MAX; dy = dy / len * JOY_MAX; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    game.input.touch.active = len > 6;
    game.input.touch.x = dx / JOY_MAX;
    game.input.touch.y = dy / JOY_MAX;
  }
  function endJoy() {
    joyId = null;
    knob.style.transform = 'translate(0,0)';
    game.input.touch.active = false;
    game.input.touch.x = game.input.touch.y = 0;
  }
  joy.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.changedTouches[0];
    joyId = t.identifier;
    var r = joy.getBoundingClientRect();
    joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
    moveJoy(t);
  }, { passive: false });
  joy.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyId) { moveJoy(e.changedTouches[i]); break; }
    }
  }, { passive: false });
  joy.addEventListener('touchend', function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joyId) { endJoy(); break; }
    }
  });
  joy.addEventListener('touchcancel', endJoy);
  $('btn-dash-touch').addEventListener('click', function () { game.tryDash(); });
  $('btn-ult-touch').addEventListener('click', function () { game.tryUltimate(); });

  /* v10：回到主菜单后恢复菜单音乐（旧版 stopMusic 之后就再也没响过） */
  var _toMenu = game.toMenu;
  game.toMenu = function () {
    _toMenu.call(this);
    try { NS.Audio.music('menu'); } catch (e) { /* 音频异常不影响返回 */ }
  };

  /* v10：切标签页 / 最小化自动暂停，避免回来时已经被围死 */
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden && game.state === 'playing') game.pause();
  });

  root.addEventListener('resize', function () { game.resize(); });

  /* 供门户层切换账号时重新绑定当前档案的存档引用 */
  NS.UI = {
    rebind: function () { save = U.Save.load(); refreshBest(); applySettings(true); },
    refreshBest: refreshBest,
    startGame: startGame,
    setScreen: setScreen,
    current: function () { return current; }
  };

  applySettings(true);
  refreshBest();
  setScreen('menu');
  $('loot-popup').classList.remove('hidden'); // 由 .show 控制可见性

  /* 无头浏览器自动验证钩子：?autotest=1 */
  if (AUTOTEST) {
    startGame();
    var vt = 0;
    root.setInterval(function () { vt += 16; game.tick(vt); }, 16);
  }
})(typeof window !== 'undefined' ? window : globalThis);
