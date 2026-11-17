/* cdp_v7.js — 真浏览器验证 v7 门户/研究所渲染与交互（Edge headless + 原生 WebSocket）
 * 用法：node tests/cdp_v7.js   （需先用 --remote-debugging-port=9226 启动 Edge）
 * 不依赖任何 npm 包。
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
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR);
  const targets = await getJSON('http://127.0.0.1:' + PORT + '/json');
  let page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('无页面 target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  function send(method, params) {
    return new Promise(resolve => {
      const myId = ++id;
      pending.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
    });
  }
  async function evalJS(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('JS异常: ' + JSON.stringify(r.result.exceptionDetails));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1600, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE_URL });
  await new Promise(r => setTimeout(r, 1200));

  const out = {};
  // 1. 门户渲染 + 未知账号注册进入
  out.portalVisible = await evalJS("!document.getElementById('screen-portal').classList.contains('hidden')");
  out.labEntryExists = await evalJS("!!document.getElementById('p-lab-toggle') && !!document.getElementById('p-lab-panel')");
  await evalJS("document.getElementById('p-reg-name').value='研究所测试员';document.getElementById('p-reg-pass').value='1234';document.getElementById('p-reg-pass2').value='1234';document.getElementById('p-form-reg').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));'ok'");
  await new Promise(r => setTimeout(r, 200));
  out.registered = await evalJS("!!window.NS.Account.current() && NS.Account.current().name==='研究所测试员'");

  // 2. 展开研究所，验证 6 项升级渲染
  await evalJS("document.getElementById('p-lab-toggle').click();'ok'");
  await new Promise(r => setTimeout(r, 150));
  out.labOpened = await evalJS("!document.getElementById('p-lab-panel').classList.contains('hidden')");
  out.labItems = await evalJS("document.querySelectorAll('#p-lab-list .p-lab-item').length");
  out.labSummary = await evalJS("JSON.stringify(NS.Lab.summary().map(x=>x.name))");

  // 3. 给足核心并购买，验证 DOM 更新 + 存档
  await evalJS("NS.Account.current().cores=9999;NS.Account.persist();document.getElementById('p-lab-toggle').click();document.getElementById('p-lab-toggle').click();'ok'");
  await new Promise(r => setTimeout(r, 150));
  const before = await evalJS("NS.Lab.level('power')");
  out.buyResult = await evalJS("(function(){var b=document.querySelectorAll('#p-lab-list .p-lab-buy')[1];b.click();return JSON.stringify({res:true});})()");
  await new Promise(r => setTimeout(r, 150));
  const after = await evalJS("NS.Lab.level('power')");
  out.buyLeveled = after === before + 1;

  // 研究所面板截图（此时门户与研究所均展开）
  await evalJS("document.getElementById('p-lab-panel').scrollIntoView({block:'center'});'ok'");
  await new Promise(r => setTimeout(r, 200));
  const shotL = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v7-lab.png'), Buffer.from(shotL.result.data, 'base64'));

  // 4. 结算产核心：模拟一次结算事件驱动 UI 显示
  out.coreBefore = await evalJS("NS.Lab.cores()");
  await evalJS("NS.game.result={floor:6,bossKills:3,kills:800,score:24000,time:320,level:20,maxCombo:60,chests:5,evolutions:1,ults:2,hexCount:9,hexItems:[],endless:true};NS.game.onEvent('result',NS.game.result);'ok'");
  await new Promise(r => setTimeout(r, 200));
  out.coreAfter = await evalJS("NS.Lab.cores()");
  out.resultVisible = await evalJS("!document.getElementById('screen-result').classList.contains('hidden')");
  out.coreCellText = await evalJS("(function(){var c=document.querySelectorAll('#result-stats .hi');return c.length?c[c.length-1].textContent:'NONE';})()");

  // 结算页截图（隐藏门户遮挡并滚到结算面板）
  await evalJS("document.getElementById('screen-portal').classList.add('hidden');document.getElementById('screen-result').scrollIntoView();'ok'");
  await new Promise(r => setTimeout(r, 200));
  const shot1 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'v7-result.png'), Buffer.from(shot1.result.data, 'base64'));

  // console 错误收集
  out.pageErrors = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch(e => { console.error('CDP失败:', e.message); process.exit(1); });
