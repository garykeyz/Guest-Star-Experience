// Run with Playwright installed, or point GUEST_STAR_PLAYWRIGHT_PATH at its package.
// GUEST_STAR_BROWSER=webkit checks the WebKit UI used by the native host.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { queueFixtureModule } from '../test/helpers/player-queue-fixture.mjs';
const require = createRequire(import.meta.url);
const playwright = require(process.env.GUEST_STAR_PLAYWRIGHT_PATH || 'playwright');
const engine = process.env.GUEST_STAR_BROWSER || 'chromium';
const wav = Buffer.alloc(44 + 30 * 22050 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32);
wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
for(let i=44;i<wav.length;i+=2) wav.writeInt16LE(Math.round(Math.sin((i-44)/2/22050*2*Math.PI*220)*300),i);
const server = createServer(async (req,res) => {
  if(req.url==='/') {res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><link rel="stylesheet" href="/player-beta.css"><style>body{background:#07060a;color:white;font-family:Arial;margin:24px}.fixture-panel{width:360px}.player-queue-list{height:300px}button{font-family:inherit}</style></head><body><div class="fixture-panel player-queue-card"><header><h3>Fila del Player</h3><span id="playerQueueCount"></span></header><div id="playerQueue" class="player-queue-list"></div></div><audio id="playing" src="/playing.wav" loop></audio><button id="start">Iniciar audio de prueba</button><script type="module" src="/fixture.js"></script><script>document.querySelector('#start').onclick=()=>document.querySelector('#playing').play()</script></body></html>`);return;}
  if(req.url==='/playing.wav') {res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
  if(req.url==='/fixture.js') {res.setHeader('Content-Type','text/javascript');res.end(queueFixtureModule());return;}
  if(/^\/[\w-]+\.(js|css)$/.test(req.url)) {
    try {const data=await readFile(new URL('../public'+req.url,import.meta.url));res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(data);return;}catch{}
  }
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await playwright[engine].launch({headless:true,...(process.env.GUEST_STAR_BROWSER_EXECUTABLE?{executablePath:process.env.GUEST_STAR_BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1000,height:760}});
  if(process.env.GUEST_STAR_QUEUE_POPOVER_FALLBACK) await page.addInitScript(()=>{HTMLDivElement.prototype.showPopover=undefined;HTMLDivElement.prototype.hidePopover=undefined;});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.fixture);
  const items=await page.evaluate(()=>JSON.stringify(window.fixture.state.requests));
  const dimensions=()=>page.locator('[data-player-row]').evaluateAll(rows=>rows.map(row=>({height:row.getBoundingClientRect().height,width:row.getBoundingClientRect().width})));
  const baseline=await dimensions(); assert.equal(baseline.length,5); assert.ok(baseline.every(row=>row.height===52));
  await page.click('#start'); await page.waitForFunction(()=>!document.querySelector('#playing').paused);
  const playback=await page.evaluate(()=>{
    const audio=document.querySelector('#playing');
    for(const name of ['pause','load','play']) audio[name]=()=>{window.forbiddenCalls.push(name);throw new Error(name);};
    const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime');
    Object.defineProperty(audio,'currentTime',{get:()=>descriptor.get.call(audio),set:()=>{window.forbiddenCalls.push('seek');throw new Error('seek');}});
    window.bridge={audioCommand:()=>{window.forbiddenCalls.push('audioCommand');throw new Error('audioCommand');}};
    return {src:audio.currentSrc,time:audio.currentTime};
  });
  async function drag(id,beforeId,{poll=false}={}) {
    const from=await page.locator(`[data-player-drag="${id}"]`).boundingBox();
    const to=await page.locator(`[data-player-row="${beforeId}"]`).boundingBox();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2); await page.mouse.down();
    if(poll) await page.evaluate(()=>{window.poll=setInterval(()=>{window.fixture.state.requests[3].stem.progress++;window.fixture.renderQueue();},40);});
    await page.mouse.move(from.x+from.width/2,to.y+2,{steps:12});
    await page.waitForSelector('.player-queue-drop-indicator');
    assert.equal(await page.locator('.player-queue-drag-preview').count(),1);
    assert.ok((await dimensions()).every(row=>row.height===52));
    await page.mouse.up();
    if(poll) await page.evaluate(()=>clearInterval(window.poll));
    await page.waitForTimeout(220);
  }
  await drag('5','1'); assert.deepEqual(await page.evaluate(()=>window.fixture.getOrder()),['5','1','2','3','4']);
  await drag('5','4',{poll:true}); assert.deepEqual(await page.evaluate(()=>window.fixture.getOrder()),['1','2','3','5','4']);
  for(let i=0;i<12;i++) {const order=await page.evaluate(()=>window.fixture.getOrder());await drag(order.at(-1),order[0]);assert.equal(new Set(await page.evaluate(()=>window.fixture.getOrder())).size,5);}
  const prior=await page.evaluate(()=>window.fixture.getOrder());
  const handle=page.locator(`[data-player-drag="${prior.at(-1)}"]`); await handle.focus(); await page.keyboard.press('ArrowUp');
  assert.equal((await page.evaluate(()=>window.fixture.getOrder())).at(-2),prior.at(-1));
  for(const id of ['2','4','1']) {
    await page.click(`[data-player-expand="${id}"]`);
    await page.waitForFunction(()=>!document.querySelector('#playerQueueOptions').hidden);
    assert.deepEqual(await dimensions(),baseline);
    await page.evaluate(()=>window.fixture.renderQueue());
    assert.ok(await page.locator('#playerQueueOptions .player-queue-actions').isVisible());
    await page.click('#playerQueueOptions summary');
    assert.deepEqual(await dimensions(),baseline);
    if(id==='4') {
      await page.click('#playerQueueOptions [data-player-move="-1"]');
      assert.deepEqual(await dimensions(),baseline);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!!document.querySelector('#playerQueueOptions').hidden);
  }
  // Outside release, Escape, and pointer cancellation must not commit a move.
  const beforeCancel=await page.evaluate(()=>window.fixture.getOrder());
  const from=await page.locator('[data-player-drag]').first().boundingBox();
  await page.mouse.move(from.x+8,from.y+8);await page.mouse.down();await page.mouse.move(800,600,{steps:10});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>window.fixture.getOrder()),beforeCancel);
  await page.mouse.move(from.x+8,from.y+8);await page.mouse.down();await page.mouse.move(from.x+8,from.y+90,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>window.fixture.getOrder()),beforeCancel);
  await page.mouse.move(from.x+8,from.y+8);await page.mouse.down();await page.mouse.move(from.x+8,from.y+90,{steps:5});
  await page.dispatchEvent('#playerQueue','pointercancel',{pointerId:1});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>window.fixture.getOrder()),beforeCancel);
  // Scroll a short queue while dragging the fifth entry all the way to the top.
  await page.evaluate(()=>{document.querySelector('#playerQueue').style.height='140px';});
  const scrollingOrder=await page.evaluate(()=>window.fixture.getOrder());
  const lastId=scrollingOrder.at(-1);
  await page.locator(`[data-player-drag="${lastId}"]`).scrollIntoViewIfNeeded();
  const lastHandle=await page.locator(`[data-player-drag="${lastId}"]`).boundingBox();
  const bounds=await page.locator('#playerQueue').boundingBox();
  await page.mouse.move(lastHandle.x+8,lastHandle.y+8);await page.mouse.down();
  await page.mouse.move(lastHandle.x+8,bounds.y+8,{steps:10});
  await page.waitForFunction(()=>document.querySelector('#playerQueue').scrollTop===0);
  await page.mouse.up();await page.waitForTimeout(220);
  assert.equal((await page.evaluate(()=>window.fixture.getOrder()))[0],lastId);
  await page.evaluate(()=>{document.querySelector('#playerQueue').style.height='300px';});
  // Stems ready, failed, and long metadata all preserve the same footprint.
  await page.evaluate(()=>{window.fixture.state.requests[3].stem={ready:true,status:'ready',improving:true};window.fixture.renderQueue();});
  assert.deepEqual(await dimensions(),baseline);
  await page.evaluate(()=>{window.fixture.state.requests[3].stem={status:'failed'};window.fixture.renderQueue();});
  assert.deepEqual(await dimensions(),baseline);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>localStorage.getItem('test-queue')),JSON.stringify(await page.evaluate(()=>window.fixture.getOrder())));
  const result=await page.evaluate(()=>({current:window.fixture.getCurrentId(),src:document.querySelector('#playing').currentSrc,time:document.querySelector('#playing').currentTime,paused:document.querySelector('#playing').paused,calls:window.forbiddenCalls,payloads:window.savedPayloads}));
  assert.equal(result.current,'2'); assert.equal(result.src,playback.src); assert.equal(result.paused,false); assert.ok(result.time>playback.time+1); assert.deepEqual(result.calls,[]);
  assert.ok(result.payloads.length>0); assert.ok(result.payloads.every(payload=>Object.keys(payload).join()==='queueOrder'));
  assert.deepEqual(result.payloads.at(-1).queueOrder,await page.evaluate(()=>window.fixture.getOrder()));
  assert.equal(await page.evaluate(()=>JSON.stringify(window.fixture.state.requests.map(({stem,...item})=>item))),JSON.stringify(JSON.parse(items).map(({stem,...item})=>item)));
  assert.deepEqual(errors,[]);
  await page.click('[data-player-expand="4"]');
  if(process.env.GUEST_STAR_QUEUE_SCREENSHOT) await page.screenshot({path:process.env.GUEST_STAR_QUEUE_SCREENSHOT});
  console.log(JSON.stringify({engine,popoverFallback:Boolean(process.env.GUEST_STAR_QUEUE_POPOVER_FALLBACK),rows:5,rowHeight:52,dragMoves:15,keyboard:true,options:true,stemsStates:true,cancel:true,autoScroll:true,playbackContinued:true,transportCalls:0,queueOnlyPersistence:true}));
} finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
