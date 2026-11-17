/* cdp_v8.js — 真浏览器验证 v8 羁绊系统 HUD / 卡片 / 结算展示
 * 用法：先启动 Edge --headless --remote-debugging-port=9226，再 node tests/cdp_v8.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const PORT = process.env.CDP_PORT || 9226;
const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'shots');
const PAGE_URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html';

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
(async () => {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR);
  const targets = await getJSON('http://127.0.0.1:' + PORT + '/json');
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('无页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const events = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params) => new Promise(resolve => {
    const myId = ++id; pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
  async function evalJS(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('JS异常: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE_URL });
  await new Promise(r => setTimeout(r, 1200));

  const out = {};
  // 进入游戏（游客）
  await evalJS("document.getElementById('p-guest').click();document.getElementById('p-play').click();'ok'");
  await new Promise(r => setTimeout(r, 300));
  out.gameStarted = await evalJS("NS.game.state==='playing'");

  // 注入羁绊构筑：超频 4 种 + 不朽 2 种，触发 recalc
  out.synResult = await evalJS("(function(){var g=NS.game,s=NS.Synergy;['hx_dmg','hx_haste','hx_crit','hx_apex'].forEach(function(id){g.hex.taken[id]=1;});['hx_hp','hx_regen'].forEach(function(id){g.hex.taken[id]=1;});var f=s.recalc(g,true);return JSON.stringify({fired:f.length,overclock:s.counts(g).overclock,immortal:s.counts(g).immortal,applied:s.summary(g).filter(function(x){return x.tier>0;}).map(function(x){return x.name+x.tier;})});})()");

  // 手动推一帧，让 HUD 羁绊栏渲染
  await evalJS("NS.game.onEvent('frame',NS.game.getHud());'ok'");
  await new Promise(r => setTimeout(r, 200));
  out.synChips = await evalJS("document.querySelectorAll('#synergy-bar .syn-chip').length");
  out.activeChips = await evalJS("document.querySelectorAll('#synergy-bar .syn-chip.active').length");
  out.chipTexts = await evalJS("Array.prototype.map.call(document.querySelectorAll('#synergy-bar .syn-chip'),function(e){return e.title;}).join(' | ')");

  // 升级卡羁绊标签
  out.cardTag = await evalJS("(function(){var c=NS.game.getChoices();var withTag=c.filter(function(x){return x.synergyTag;});NS.game._choices=c;NS.game.onEvent('levelup',{choices:c,level:10});return withTag.length;})()");
  await new Promise(r => setTimeout(r, 150));
  out.traitHintDom = await evalJS("document.querySelectorAll('.upgrade-card .trait-hint').length");
  const cardShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v8-cards.png'), Buffer.from(cardShot.result.data, 'base64'));

  // 结算羁绊展示
  await evalJS("NS.game.state='playing';NS.game.result={floor:6,bossKills:3,kills:800,score:24000,time:320,level:20,maxCombo:60,chests:5,evolutions:1,ults:2,hexCount:6,hexItems:[],endless:true};NS.game.onEvent('result',NS.game.result);'ok'");
  await new Promise(r => setTimeout(r, 200));
  out.resultSynChips = await evalJS("document.querySelectorAll('#result-build .build-chip.syn-result').length");
  out.resultSynText = await evalJS("(function(){var e=document.querySelectorAll('#result-build .build-title');for(var i=0;i<e.length;i++){if(e[i].textContent.indexOf('成型羁绊')>=0)return e[i].textContent;}return 'NONE';})()");

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v8-result.png'), Buffer.from(shot.result.data, 'base64'));

  out.pageErrors = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error('CDP失败:', e.message); process.exit(1); });
