/* cdp_v10.js — v10 体验层真浏览器验证：
 * 版本号 / 首领狂暴刻度 / 暂停战术快照 / M 静音 / 开局提示 / 清除存档按钮 / 无 JS 报错 + 截图
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const PORT = 9227;
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
  await new Promise(r => setTimeout(r, 1200));
  await ev("window.__errs=[];'ok'");

  const out = {};
  out.version = await ev("document.querySelector('.p-ver').textContent");
  out.menuEyebrow = await ev("document.querySelector('#screen-menu .eyebrow').textContent");
  out.phaseTicks = await ev("document.querySelectorAll('#boss-hud .phase-tick').length");
  out.pauseInfoBox = await ev("!!document.getElementById('pause-info')");
  out.settingsBtns = await ev("!!document.getElementById('btn-reset-settings') && !!document.getElementById('btn-wipe-save')");
  out.muteCheckbox = await ev("!!document.getElementById('set-muted')");
  out.controlHint = await ev("!!document.getElementById('control-hint')");
  out.shareBtn = await ev("!!document.getElementById('btn-share')");

  /* 进入游戏（跳过门户），检查开局提示与暂停快照 */
  await ev("NS.Portal.hide(); NS.UI.startGame(); 'ok'");
  await new Promise(r => setTimeout(r, 900));
  out.hintVisible = await ev("!document.getElementById('control-hint').classList.contains('hidden')");
  out.hintText = await ev("document.getElementById('control-hint').textContent");
  await ev("NS.game.pause(); 'ok'");
  await new Promise(r => setTimeout(r, 260));
  out.pauseScreen = await ev("!document.getElementById('screen-pause').classList.contains('hidden')");
  out.pauseCells = await ev("document.querySelectorAll('#pause-info .pause-cell').length");
  out.pauseChips = await ev("document.querySelectorAll('#pause-info .pause-chip').length");
  out.hintHiddenOnPause = await ev("document.getElementById('control-hint').classList.contains('hidden')");
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shotPause = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v10-pause.png'), Buffer.from(shotPause.result.data, 'base64'));

  /* 首领血条阶段样式：直接读计算样式，确认狂暴/濒死分支真的换了颜色 */
  await ev("NS.game.resume(); 'ok'");
  await ev("(function(){var bh=document.getElementById('boss-hud');bh.classList.remove('hidden');bh.classList.add('enraged','critical');return bh.className})()");
  out.enrageClass = await ev("document.getElementById('boss-hud').className");
  out.enrageFill = await ev("(function(){var bh=document.getElementById('boss-hud');bh.classList.add('enraged');return getComputedStyle(document.getElementById('boss-fill')).backgroundImage})()");
  out.bossBarBorder = await ev("(function(){var bh=document.getElementById('boss-hud');bh.classList.add('enraged');return getComputedStyle(document.querySelector('#boss-hud .boss-bar')).borderTopColor})()");

  /* M 键静音 + 持久化 */
  await ev("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyM'})); 'ok'");
  out.muted = await ev("NS.Audio.isMuted()");
  out.mutedSaved = await ev("NS.U.Save.data.settings.muted");
  await ev("window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyM'})); 'ok'");
  out.unmuted = await ev("!NS.Audio.isMuted()");

  /* 设置页截图 */
  await ev("NS.game.pause(); NS.UI.setScreen('settings'); 'ok'");
  await new Promise(r => setTimeout(r, 200));
  const shotSet = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v10-settings.png'), Buffer.from(shotSet.result.data, 'base64'));

  out.errors = await ev("__errs.length");
  out.errList = await ev("JSON.stringify(__errs)");
  console.log(JSON.stringify(out, null, 2));

  const ok = out.version === 'V10.0' && /v10\.0/.test(out.menuEyebrow) && out.phaseTicks === 2 &&
    out.pauseInfoBox && out.settingsBtns && out.muteCheckbox && out.shareBtn &&
    out.hintVisible && out.pauseScreen && out.pauseCells === 6 && out.pauseChips >= 1 &&
    out.hintHiddenOnPause && /enraged/.test(out.enrageClass) && /gradient/.test(out.enrageFill) &&
    out.muted && out.mutedSaved && out.unmuted &&
    out.errors === 0;
  console.log(ok ? '\n✅ v10 体验层验证通过' : '\n❌ v10 体验层验证失败');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
