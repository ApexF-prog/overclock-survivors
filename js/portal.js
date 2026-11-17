/* portal.js — 4399 风格登录门户 UI 层（最后加载）
 * 登录 / 注册 / 游客 / 签到 / 难度 / 成就 / 本机排行榜 / 切换账号
 * 所有用户文案用 textContent 写入，避免昵称里的 HTML 注入。
 */
(function (root) {
  'use strict';
  var NS = root.NS = root.NS || {};
  var U = NS.U, A = NS.Account;
  var doc = root.document;
  function $(id) { return doc.getElementById(id); }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  var AUTOTEST = !!(root.location && root.location.search.indexOf('autotest=1') >= 0);
  var REMEMBER_KEY = 'os_last_name_v1';

  var NOTICES = [
    'V6.0 门户上线：本地账号档案、每日签到、成就与四档挑战难度',
    '新增「炼狱契约」：每层击破首领后三选一，用诅咒换爆发',
    '首领词缀系统：第 2 层起随机附带，越深层数越多',
    '无尽噩梦难度：首领词缀提前解锁，分数三倍结算',
    '签到连续 5 天可额外获得 1 次重掷，成就越多分数加成越高'
  ];

  var portalEl = $('screen-portal');
  var chosenAvatar = '◈';
  var P = NS.Portal = {
    isOpen: function () { return !portalEl.classList.contains('hidden'); },
    show: function () { portalEl.classList.remove('hidden'); render(); },
    hide: function () { portalEl.classList.add('hidden'); }
  };

  function msg(id, text, bad) {
    var e = $(id);
    e.textContent = text || '';
    e.classList.toggle('bad', bad !== false);
    e.classList.toggle('good', bad === false);
  }

  function rebindUI() {
    if (NS.UI && NS.UI.rebind) NS.UI.rebind();
  }

  function fillRemember() {
    try {
      var n = root.localStorage && root.localStorage.getItem(REMEMBER_KEY);
      if (n) $('p-login-name').value = n;
    } catch (e) { /* 隐私模式容错 */ }
  }

  function renderAvatars() {
    var box = $('p-avatar-list');
    box.innerHTML = '';
    A.avatars.forEach(function (ic) {
      var b = el('button', 'p-avatar-opt' + (ic === chosenAvatar ? ' on' : ''), ic);
      b.type = 'button';
      b.addEventListener('click', function () {
        chosenAvatar = ic;
        Array.prototype.forEach.call(box.children, function (c) { c.classList.toggle('on', c === b); });
      });
      box.appendChild(b);
    });
  }

  function renderRank() {
    var box = $('p-rank-list'), list = A.leaderboard().slice(0, 5);
    box.innerHTML = '';
    if (!list.length) { box.appendChild(el('div', 'p-empty', '暂无记录，成为第一位挑战者')); return; }
    list.forEach(function (r, i) {
      var row = el('div', 'p-rank-row' + (r.me ? ' me' : ''));
      row.appendChild(el('span', 'p-rank-no', String(i + 1).padStart(2, '0')));
      row.appendChild(el('span', 'p-rank-av', r.avatar));
      row.appendChild(el('span', 'p-rank-name', r.name + (r.guest ? '（游客）' : '')));
      row.appendChild(el('b', 'p-rank-floor', '第 ' + Math.max(1, r.floor) + ' 层'));
      row.appendChild(el('em', 'p-rank-score', r.score.toLocaleString()));
      box.appendChild(row);
    });
  }

  /* v9 每日挑战：确定性规则 + 日榜 + 接受挑战 */
  function renderDaily() {
    if (!NS.Daily) return;
    var ch = NS.Daily.challenge();
    $('p-daily-date').textContent = ch.date;
    var diffName = ch.diff, color = '#22e6ff';
    if (A && A.diffs) for (var i = 0; i < A.diffs.length; i++) {
      if (A.diffs[i].id === ch.diff) { diffName = A.diffs[i].name; color = A.diffs[i].color; break; }
    }
    var info = $('p-daily-info');
    info.innerHTML = '';
    var tag = el('span', 'p-daily-tag', diffName);
    tag.style.color = color; tag.style.borderColor = color;
    info.appendChild(tag);
    info.appendChild(el('span', 'p-daily-goal', '目标：抵达第 ' + ch.goal + ' 层'));
    var mods = $('p-daily-mods');
    mods.innerHTML = '';
    ch.mods.forEach(function (m) { mods.appendChild(el('span', 'p-daily-mod', '◆ ' + m.name + ' · ' + m.text)); });
    /* 我的今日最佳 */
    var mine = NS.Daily.mine();
    $('p-daily-mine').textContent = mine
      ? '我的最佳：第 ' + mine.floor + ' 层 · ' + mine.score.toLocaleString() + ' 分' + (mine.reached ? ' ✓达标' : '')
      : '尚未挑战';
    $('p-daily-mine').classList.toggle('done', !!(mine && mine.reached));
    /* 日榜前 3 */
    var board = $('p-daily-board');
    board.innerHTML = '';
    var list = NS.Daily.board().slice(0, 3);
    if (!list.length) board.appendChild(el('div', 'p-empty', '今日暂无成绩'));
    list.forEach(function (r, idx) {
      var row = el('div', 'p-daily-row' + (r.me ? ' me' : ''));
      row.appendChild(el('span', 'p-rank-no', String(idx + 1).padStart(2, '0')));
      row.appendChild(el('span', 'p-rank-av', r.avatar));
      row.appendChild(el('span', 'p-rank-name', r.name + (r.guest ? '（游客）' : '')));
      row.appendChild(el('b', 'p-rank-floor', '第 ' + r.floor + ' 层'));
      board.appendChild(row);
    });
  }

  /* v9 进化图鉴：6 条超武进化路线的跨局解锁进度 */
  function renderCodex() {
    if (!NS.Codex) return;
    var prog = NS.Codex.progress();
    $('p-codex-progress').textContent = prog.count + ' / ' + prog.total + ' 已解锁';
    var box = $('p-codex-list');
    box.innerHTML = '';
    prog.items.forEach(function (it) {
      var card = el('div', 'p-codex-item' + (it.got ? ' got' : ' locked'));
      var icon = el('div', 'p-codex-ic', it.icon);
      icon.style.borderColor = it.color;
      if (it.got) icon.style.color = it.color;
      card.appendChild(icon);
      var mid = el('div', 'p-codex-mid');
      mid.appendChild(el('b', '', it.got ? it.name : '？？？'));
      mid.appendChild(el('span', 'p-codex-desc', it.got ? it.desc : '武器 LV5 + 指定被动 → 进化解锁'));
      card.appendChild(mid);
      card.appendChild(el('span', 'p-codex-mark', it.got ? '✓' : '🔒'));
      box.appendChild(card);
    });
  }

  function renderDiff() {
    var box = $('p-diff-list'), cur = A.difficulty().id;
    box.innerHTML = '';
    A.diffs.forEach(function (d) {
      var b = el('button', 'p-diff' + (d.id === cur ? ' on' : ''), d.name);
      b.type = 'button';
      b.style.setProperty('--diff-color', d.color);
      b.dataset.id = d.id;
      b.appendChild(el('small', '', d.tag));
      b.addEventListener('click', function () {
        A.setDifficulty(d.id);
        rebindUI();
        renderDiff();
        NS.Audio && NS.Audio.play && NS.Audio.play('select');
      });
      box.appendChild(b);
    });
    $('p-diff-desc').textContent = A.difficulty().desc + ' · 分数 ×' + A.difficulty().score;
  }

  function renderAch() {
    var u = A.current(), box = $('p-ach-list'), n = A.achCount();
    $('p-ach-count').textContent = n + ' / ' + A.achievements.length;
    box.innerHTML = '';
    A.achievements.forEach(function (a) {
      var got = !!(u && u.ach[a.id]);
      var c = el('span', 'p-ach' + (got ? ' got' : ''), a.icon + ' ' + a.name);
      c.title = a.desc + (got ? ' · 已解锁' : ' · 未解锁');
      box.appendChild(c);
    });
  }

  function renderUser(u) {
    $('p-avatar').textContent = u.avatar;
    $('p-name').textContent = u.name;
    $('p-title').textContent = A.title();
    var s = u.stats || {}, b = A.bonus();
    var cells = [
      ['最深层数', '第 ' + Math.max(1, s.bestFloor || 1) + ' 层'],
      ['最高分', (s.bestScore || 0).toLocaleString()],
      ['累计击杀', (s.totalKills || 0).toLocaleString()],
      ['总局数', (s.totalRuns || 0) + ' 局'],
      ['最长存活', U.fmtTime(s.bestTime || 0)]
    ];
    var box = $('p-userstats');
    box.innerHTML = '';
    cells.forEach(function (c) {
      var d = el('div', 'p-ucell');
      d.appendChild(el('span', '', c[0]));
      d.appendChild(el('b', '', c[1]));
      box.appendChild(d);
    });
    /* 日期判定与 account.js 的 today() 保持一致（本地 YYYY-MM-DD） */
    var d0 = new Date(), t = d0.getFullYear() + '-' + ('0' + (d0.getMonth() + 1)).slice(-2) + '-' + ('0' + d0.getDate()).slice(-2);
    var signed = u.signDate === t;
    $('p-sign-btn').disabled = signed;
    $('p-sign-btn').textContent = signed ? '今日已签到 ✓' : '每日签到';
    $('p-sign-info').textContent = signed
      ? '连续 ' + (u.signDays || 0) + ' 天 · 开局 +' + b.hp + ' HP / +' + b.energy + ' 能量'
      : '连续 ' + (u.signDays || 0) + ' 天 · 明天继续累加';
    renderDiff();
    renderAch();
    renderLab();
  }

  /* v7 超频研究所：核心余额 + 永久升级购买 */
  function renderLab() {
    if (!NS.Lab) return;
    var cores = NS.Lab.cores();
    $('p-lab-cores').textContent = cores.toLocaleString() + ' 枚核心';
    var box = $('p-lab-list');
    if (!box) return;
    box.innerHTML = '';
    NS.Lab.summary().forEach(function (it) {
      var row = el('div', 'p-lab-item' + (it.maxed ? ' maxed' : ''));
      var ic = el('div', 'p-lab-ic', it.icon);
      ic.style.color = it.color;
      row.appendChild(ic);
      var mid = el('div', 'p-lab-mid');
      var title = el('b', '', it.name);
      title.style.color = it.color;
      mid.appendChild(title);
      mid.appendChild(el('span', 'p-lab-desc', it.desc));
      var bar = el('div', 'p-lab-bar');
      for (var k = 0; k < it.max; k++) bar.appendChild(el('i', k < it.level ? 'on' : ''));
      mid.appendChild(bar);
      row.appendChild(mid);
      var act = el('button', 'p-lab-buy' + (it.maxed ? ' done' : ''), it.maxed ? 'MAX' : (it.cost + ' 核'));
      act.type = 'button';
      act.disabled = it.maxed || cores < it.cost;
      if (!it.maxed) {
        act.title = it.next;
        act.addEventListener('click', function () {
          var res = NS.Lab.buy(it.id);
          msg('p-lab-msg', res.msg, res.ok);
          if (res.ok && NS.Audio && NS.Audio.play) NS.Audio.play('evolve');
          renderLab();
        });
      }
      row.appendChild(act);
      box.appendChild(row);
    });
  }

  function render() {
    var u = A.current();
    $('p-auth').classList.toggle('hidden', !!u);
    $('p-user').classList.toggle('hidden', !u);
    renderRank();
    renderDaily();
    renderCodex();
    if (u) renderUser(u); else fillRemember();
  }

  function renderNotices() {
    var box = $('p-notice-list');
    box.innerHTML = '';
    NOTICES.forEach(function (n, i) {
      var li = el('li', '', n);
      if (i === 0) li.appendChild(el('b', 'p-new', 'NEW'));
      box.appendChild(li);
    });
    $('p-online').textContent = (12000 + Math.floor(Math.random() * 2600)).toLocaleString();
  }

  function afterLogin(res) {
    if (!res.ok) return false;
    /* 登录成功音：门户里唯一的一次性确认音 */
    if (NS.Audio) { NS.Audio.resume(); NS.Audio.play('login'); }
    rebindUI();
    render();
    return true;
  }

  /* ---------------- 表单与按钮 ---------------- */
  var tabs = doc.querySelectorAll('#screen-portal .p-tabs button');
  Array.prototype.forEach.call(tabs, function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (t) { t.classList.toggle('on', t === b); });
      var reg = b.dataset.tab === 'reg';
      $('p-form-login').classList.toggle('hidden', reg);
      $('p-form-reg').classList.toggle('hidden', !reg);
      msg('p-login-msg', ''); msg('p-reg-msg', '');
    });
  });

  $('p-form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('p-login-name').value;
    var res = A.login(name, $('p-login-pass').value);
    if (!res.ok) { msg('p-login-msg', res.msg, true); return; }
    try {
      if ($('p-remember').checked) root.localStorage.setItem(REMEMBER_KEY, String(name).trim());
      else root.localStorage.removeItem(REMEMBER_KEY);
    } catch (err) { /* 容错 */ }
    $('p-login-pass').value = '';
    afterLogin(res);
  });

  $('p-form-reg').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('p-reg-name').value, p1 = $('p-reg-pass').value, p2 = $('p-reg-pass2').value;
    if (p1 !== p2) { msg('p-reg-msg', '两次密码不一致', true); return; }
    var res = A.register(n, p1, chosenAvatar);
    if (!res.ok) { msg('p-reg-msg', res.msg, true); return; }
    try { root.localStorage.setItem(REMEMBER_KEY, String(n).trim()); } catch (err) { /* 容错 */ }
    afterLogin(res);
  });

  $('p-guest').addEventListener('click', function () { A.guest(); afterLogin({ ok: true }); });
  $('p-logout').addEventListener('click', function () { A.logout(); rebindUI(); render(); });
  $('p-switch').addEventListener('click', function () { A.logout(); rebindUI(); render(); });

  $('p-sign-btn').addEventListener('click', function () {
    var res = A.sign();
    if (res.ok) { NS.Audio && NS.Audio.play && NS.Audio.play('levelup'); }
    else NS.Audio && NS.Audio.play && NS.Audio.play('select');
    render();
  });

  $('p-lab-toggle').addEventListener('click', function () {
    var panel = $('p-lab-panel');
    var opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    $('p-lab-toggle').classList.toggle('on', opening);
    if (opening) renderLab();
  });

  $('p-play').addEventListener('click', function () {
    P.hide();
    if (NS.Daily) NS.Daily.clear();   // 普通开局：清除任何待应用的挑战规则
    var btn = $('btn-start');   // startGame 内会做 Audio.init / resume
    if (btn) btn.click();
  });

  $('p-daily-go').addEventListener('click', function () {
    if (!A.current()) {
      msg('p-login-msg', '请先登录或游客试玩', true);
      $('p-auth').scrollIntoView && $('p-auth').scrollIntoView({ block: 'center' });
      return;
    }
    var ch = NS.Daily.arm();   // 注入当日挑战规则到下一局
    P.hide();
    var btn = $('btn-start');
    if (btn) btn.click();
    if (NS.Audio && NS.Audio.play) NS.Audio.play('event');
    return ch;
  });

  /* 门户打开时接管 Enter；表单内由 submit 自然处理，不重复触发开始游戏 */
  root.addEventListener('keydown', function (e) {
    if (!P.isOpen() || e.repeat || e.code !== 'Enter') return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') return;
    if (A.current()) { e.preventDefault(); $('p-play').click(); }
  });

  renderAvatars();
  renderNotices();
  render();

  /* ---------------- 门户 / 登录界面音乐 ----------------
   * 浏览器要求用户手势后才允许出声，所以先 init（挂起态），
   * 首次点击或按键时 resume 并播放门户曲目「menu」。
   */
  var musicArmed = false;
  function armMusic() {
    if (musicArmed) return;
    musicArmed = true;
    try {
      var st = (NS.U && NS.U.Save ? (NS.U.Save.peek ? NS.U.Save.peek() : NS.U.Save.load().settings) : null) || {};
      NS.Audio.init(st.volume, st.musicVol);
      NS.Audio.setMusicEnabled(st.musicOn !== false);
      NS.Audio.resume();
      if (P.isOpen() || (NS.game && NS.game.state === 'menu')) NS.Audio.music('menu');
    } catch (e) { /* 音频异常不影响门户 */ }
  }
  doc.addEventListener('pointerdown', armMusic, { passive: true });
  doc.addEventListener('keydown', armMusic);

  /* 回到门户时切回门户音乐（结算后、切换账号等） */
  var _showPortal = P.show;
  P.show = function () {
    _showPortal();
    if (musicArmed) NS.Audio.music('menu');
  };

  if (AUTOTEST) P.hide();   // 无头自动验证模式跳过门户
})(typeof window !== 'undefined' ? window : globalThis);
