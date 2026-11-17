/* cdp_v9.js — v9 真浏览器验证：每日挑战卡 / 图鉴 / 帧率设置 / 接受挑战注入 / HUD / 截图 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const PORT = 9226;
const PAGE = 'file:///C:/Users/18776/Desktop/开发游戏/OverclockSurvivors/index.html';
const SHOT_DIR = path.join(__dirname, '..', 'shots');

function cdpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
  });
}
(async () => {
  const tabs = await cdpGet(`http://127.0.0.1:${PORT}/json`);
  const page = tabs.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  function send(method, params) { return new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }); }
  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR:' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  }

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});" });
  await send('Page.navigate', { url: PAGE });
  await new Promise(r => setTimeout(r, 1300));

  const out = {};
  // 门户面板存在性
  out.dailyPanel = await ev("!!document.getElementById('p-daily-info') && document.querySelectorAll('#p-daily-mods .p-daily-mod').length");
  out.dailyDate = await ev("document.getElementById('p-daily-date').textContent");
  out.codexItems = await ev("document.querySelectorAll('#p-codex-list .p-codex-item').length");
  out.codexProgress = await ev("document.getElementById('p-codex-progress').textContent");
  out.fpsOptions = await ev("document.querySelectorAll('#set-fps option').length");
  // 登录（游客）后截图门户
  await ev("document.getElementById('p-guest').click();'ok'");
  await new Promise(r => setTimeout(r, 300));
  out.loggedIn = await ev("!!NS.Account.current()");
  out.dailyMine = await ev("document.getElementById('p-daily-mine').textContent");
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shot1 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(path.join(SHOT_DIR, 'v9-portal.png'), Buffer.from(shot1.result.data, 'base64'));
  // 接受挑战 → 注入 daily 到 game
  await ev("document.getElementById('p-daily-go').click();'ok'");
  await new Promise(r => setTimeout(r, 600));
  out.challengeActive = await ev("!!(NS.game && NS.game.daily)");
  out.challengeGoal = await ev("NS.game.daily ? NS.game.daily.goal : 0");
  out.challengeMods = await ev("NS.game.daily ? NS.game.daily.mods.length : 0");
  out.dailyHudVisible = await ev("!document.getElementById('daily-hud').classList.contains('hidden')");
  out.dailyHudText = await ev("document.getElementById('dh-goal').textContent + ' | ' + document.getElementById('dh-progress').textContent");
  // 帧率档位切换实时生效
  await ev("(function(){var s=document.getElementById('set-fps');s.value='90';s.dispatchEvent(new Event('change'));return s.value})()");
  out.fpsMode = await ev("NS.Perf.mode");
  out.fpsCap = await ev("NS.Perf.cap");
  out.hudFpsText = await ev("document.getElementById('fps-text').textContent");
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v9-challenge.png'), Buffer.from(shot2.result.data, 'base64'));
  out.errors = await ev("__errs.length");
  out.errList = await ev("JSON.stringify(__errs)");

  console.log(JSON.stringify(out, null, 2));
  const ok = out.dailyPanel === 3 && out.codexItems === 6 && out.fpsOptions === 5 &&
    out.loggedIn && out.challengeActive && out.challengeMods === 3 && out.dailyHudVisible &&
    out.fpsMode === '90' && out.fpsCap === 90 && out.errors === 0;
  console.log(ok ? '\n✅ v9 门户验证通过' : '\n❌ v9 门户验证失败');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
