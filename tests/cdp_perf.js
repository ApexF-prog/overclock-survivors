/* cdp_perf.js — v9 真浏览器性能验证：帧率档位 / 动态分辨率 / HUD 帧时 / 无页面异常 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = 9226;
const PAGE = 'file:///C:/Users/18776/Desktop/开发游戏/OverclockSurvivors/index.html?autotest=1';
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
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  function send(method, params) {
    return new Promise(resolve => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  }
  async function evalJS(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  await new Promise(r => setTimeout(r, 1200));

  const out = {};
  // 1. perf 模块加载
  out.perfLoaded = await evalJS("!!(window.NS && NS.Perf && NS.Perf._installed)");
  out.optionCount = await evalJS("NS.Perf.options.length");
  // 2. 档位切换
  out.mode120 = await evalJS("NS.Perf.setMode('120').cap");
  out.modeAuto = await evalJS("NS.Perf.setMode('auto').cap");
  // 3. 开局并跑一段，采样帧时间
  await evalJS("document.getElementById('btn-start').click();'ok'");
  await new Promise(r => setTimeout(r, 2500));
  out.hudFps = await evalJS("document.getElementById('fps-text').textContent");
  out.hudFt = await evalJS("document.getElementById('ft-text').textContent");
  out.frames = await evalJS("NS.game.time");
  out.perfState = await evalJS("JSON.stringify({ft:Math.round(NS.Perf.ft*10)/10,renderMs:Math.round(NS.Perf.renderMs*10)/10,dyn:NS.Perf.dynScale,stress:NS.Perf.stress})");
  // 4. 手动制造密集场景：塞满敌人
  await evalJS("(function(){var g=NS.game;for(var i=0;i<140;i++){var a=Math.random()*6.28;g.enemies.push(new NS.Enemy('drone',g.player.x+Math.cos(a)*300,g.player.y+Math.sin(a)*300,1,1,1));}return g.enemies.length;})()");
  await new Promise(r => setTimeout(r, 1800));
  out.denseFps = await evalJS("document.getElementById('fps-text').textContent");
  out.denseFt = await evalJS("document.getElementById('ft-text').textContent");
  out.dynUnderStress = await evalJS("NS.Perf.dynScale");
  out.stressUnderLoad = await evalJS("NS.Perf.stress");
  out.enemyCount = await evalJS("NS.game.enemies.length");
  // 5. 页面异常
  out.errors = await evalJS("(window.__errs||[]).length");
  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SHOT_DIR, 'v9-perf.png'), Buffer.from(shot.result.data, 'base64'));

  console.log(JSON.stringify(out, null, 2));
  const ok = out.perfLoaded && out.optionCount === 5 && out.mode120 === 120 && out.modeAuto === 0 &&
    out.frames > 0 && out.enemyCount > 0 && out.errors === 0;
  console.log(ok ? '\n✅ 性能验证通过' : '\n❌ 性能验证失败');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
