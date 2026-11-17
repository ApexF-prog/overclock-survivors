/* cdp_v11.js — v11 声音与特效整改验证：
 * 5 首曲目 / 音量面板开关 / 三路音量实时生效 / 响度三档 / 点击音效与按压反馈 / 特效强度 / 零报错 + 截图
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const PORT = 9228;
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
  out.trackCount = await ev("NS.Audio.trackCount()");
  out.defaultVolume = await ev("NS.U.Save.data.settings.volume");
  out.defaultFx = await ev("NS.game.fx.power");

  /* 曲目随层数切换（先初始化音频上下文，否则 A.music 会直接返回） */
  await ev("NS.Audio.init(1,1,1); 'ok'");
  await ev("NS.Audio.battleMusic(1); 'ok'");
  out.trackFloor1 = await ev("NS.Audio.currentMusic()");
  await ev("NS.Audio.battleMusic(5); 'ok'");
  out.trackFloor5 = await ev("NS.Audio.currentMusic()");
  await ev("NS.Audio.bossMusic(7); 'ok'");
  out.trackBoss7 = await ev("NS.Audio.currentMusic()");

  /* 音量面板 */
  out.panelHidden = await ev("document.getElementById('vol-panel').classList.contains('hidden')");
  await ev("document.getElementById('vol-fab').click(); 'ok'");
  await new Promise(r => setTimeout(r, 120));
  out.panelOpen = await ev("!document.getElementById('vol-panel').classList.contains('hidden')");
  out.masterVal = await ev("document.getElementById('vol-master-val').textContent");
  await ev("(function(){var e=document.getElementById('vol-master');e.value='60';e.dispatchEvent(new Event('input'));return e.value})()");
  out.volumeApplied = await ev("NS.Audio.levels().volume");
  out.volumeSaved = await ev("NS.U.Save.data.settings.volume");
  await ev("(function(){var e=document.getElementById('vol-music');e.value='40';e.dispatchEvent(new Event('input'));return 1})()");
  out.musicApplied = await ev("NS.Audio.levels().musicVol");
  await ev("(function(){var e=document.getElementById('vol-sfx');e.value='70';e.dispatchEvent(new Event('input'));return 1})()");
  out.sfxApplied = await ev("NS.Audio.levels().sfxVol");
  await ev("(function(){var e=document.getElementById('vol-loud');e.value='loud';e.dispatchEvent(new Event('change'));return 1})()");
  out.loudApplied = await ev("NS.Audio.levels().loudness");

  /* 点击音效：先关掉音量面板（否则这一下会被判为“关闭面板”），再统计 */
  await ev("document.getElementById('vol-fab').click(); 'ok'");
  await new Promise(r => setTimeout(r, 180));
  await ev("window.__plays=[]; var _p=NS.Audio.play; NS.Audio.play=function(n){window.__plays.push(n); return _p.apply(this,arguments)}; 'ok'");
  await ev("document.getElementById('btn-help').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:10,clientY:10})); 'ok'");
  out.clickSfx = await ev("JSON.stringify(window.__plays.slice(0,4))");
  out.pressClass = await ev("document.getElementById('btn-help').className");
  out.ripple = await ev("!!document.querySelector('.ui-ripple')");

  /* 静音按钮 */
  await ev("document.getElementById('vol-mute').click(); 'ok'");
  out.mutedByBtn = await ev("NS.Audio.isMuted()");
  await ev("document.getElementById('vol-mute').click(); 'ok'");
  out.unmutedByBtn = await ev("!NS.Audio.isMuted()");

  /* 特效强度 */
  await ev("(function(){var e=document.getElementById('set-fx');e.value='1.5';e.dispatchEvent(new Event('change'));return 1})()");
  out.fxPower = await ev("NS.game.fx.power");
  out.fxSaved = await ev("NS.U.Save.data.settings.fxPower");
  await ev("NS.game.setFxPower(2); 'ok'");

  /* 截图：确保音量面板处于打开状态 */
  if (await ev("document.getElementById('vol-panel').classList.contains('hidden')")) {
    await ev("document.getElementById('vol-fab').click(); 'ok'");
  }
  await new Promise(r => setTimeout(r, 220));
  out.panelOpenForShot = await ev("!document.getElementById('vol-panel').classList.contains('hidden')");
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v11-volume.png'), Buffer.from(shot.result.data, 'base64'));

  out.errors = await ev("__errs.length");
  out.errList = await ev("JSON.stringify(__errs)");
  console.log(JSON.stringify(out, null, 2));

  const ok = out.trackCount === 5 && out.trackFloor1 === 'battle' && out.trackFloor5 === 'battle2' &&
    out.trackBoss7 === 'boss2' && out.panelHidden && out.panelOpen && /%/.test(out.masterVal) &&
    Math.abs(out.volumeApplied - 0.6) < 0.001 && Math.abs(out.volumeSaved - 0.6) < 0.001 &&
    Math.abs(out.musicApplied - 0.4) < 0.001 && Math.abs(out.sfxApplied - 0.7) < 0.001 &&
    out.loudApplied === 'loud' && /uiTap/.test(out.clickSfx) && /ui-press/.test(out.pressClass) &&
    out.ripple && out.mutedByBtn && out.unmutedByBtn && Math.abs(out.fxPower - 1.5) < 0.001 &&
    Math.abs(out.fxSaved - 1.5) < 0.001 && out.errors === 0;
  console.log(ok ? '\n✅ v11 声音/特效验证通过' : '\n❌ v11 声音/特效验证失败');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
