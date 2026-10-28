// Isolated browser fixture: never calls the installed server or production APIs.
// Uses the current installed markup/styles when GUEST_STAR_PUBLIC_DIR is supplied.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { queueFixtureModule } from '../test/helpers/player-queue-fixture.mjs';
const require = createRequire(import.meta.url);
const playwright = require(process.env.GUEST_STAR_PLAYWRIGHT_PATH || 'playwright');
const publicDir = process.env.GUEST_STAR_PUBLIC_DIR || new URL('../public/', import.meta.url);
const readPublic = name => readFile(typeof publicDir === 'string' ? resolve(publicDir, name) : new URL(name, publicDir), 'utf8');
const stripScripts = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
let host = stripScripts(await readFile(new URL('../public/index.html',import.meta.url),'utf8'));
if (!host.includes('/adaptive-host.css')) host = host.replace('</head>', '<link rel="stylesheet" href="/adaptive-host.css"></head>');
host = host.replace('</body>', '<script type="module" src="/fixture.js"></script></body>');
const star = stripScripts(await readPublic('star-screen.html')).replace('</body>', `<script type="module">
import { installStarScreenCanvas } from '/star-screen-canvas.js';
installStarScreenCanvas(document.querySelector('#starScreenCanvas'));
document.querySelector('#starScreenQueue').innerHTML = Array.from({length:5},(_,i)=>'<li><b>0'+(i+1)+'</b><div><strong>Participant avec un nom très long '+i+'</strong><small><span class="star-screen-song-title">Titre de chanson avec des métadonnées</span><span class="star-screen-song-artist">Artiste</span></small></div><span>EN FILA</span></li>').join('');
</script></body>`);
const wav = Buffer.alloc(44 + 90 * 22050 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8,4); wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(22050,24); wav.writeUInt32LE(44100,28); wav.writeUInt16LE(2,32);
wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(wav.length-44,40);
const fixture = queueFixtureModule().replace("$('#playing')", "$('#playerMedia')") + `
import '/adaptive-host.js';
document.body.className='player-mode player-activity-locked';
$('#playerWorkspace').classList.remove('hidden');
$('#playerNowSong').textContent='Participante — Título de canción considerablemente largo — Artista';
$('#playerNowSinger').textContent='Participante con un nombre largo';
$('#playerActivityName').textContent='Soirée karaoké et demandes des participants';
$('#playerPlanB').innerHTML=Array.from({length:8},(_,i)=>'<article class="player-plan-b-row"><div class="player-plan-b-primary"><strong>Une chanson avec un titre particulièrement long '+i+'</strong><small>Artiste avec un nom très long</small></div><div class="player-plan-b-meta"><span>FRANÇAIS</span><em class="available">LOCAL</em></div><button class="button primary player-plan-b-action">Attribuer à un participant</button></article>').join('');
$('#playerSeek').max=90; $('#playerSeek').value=18;
$('#playerVolume').value=.72; $('#playerBackgroundVolume').value=.31;
$('#playerTempo').value=103; $('#playerBackgroundTempo').value=97;
$('#playerVocalLevel').disabled=false; $('#playerVocalLevel').value=.42;
$('#playerEqLow').value=3; $('#playerEqMid').value=-2; $('#playerEqHigh').value=1;
window.startFixtureAudio=async()=>{
  const context=new AudioContext(); window.fixtureContext=context;
  window.fixtureGraph=[context.createGain(),context.createBiquadFilter(),context.createAnalyser()];
  window.fixtureGraph[0].gain.value=.72;
  for(const id of ['playerMedia','playerBackgroundAudio']) {
    const element=$('#'+id); element.src='/playing.wav'; element.loop=true;
    const source=context.createMediaElementSource(element);
    source.connect(window.fixtureGraph[0]);
    window.fixtureGraph.push(source);
    await element.play();
  }
  window.fixtureGraph[0].connect(window.fixtureGraph[1]);
  window.fixtureGraph[1].connect(window.fixtureGraph[2]);
  // Silent WAV verifies the two clocks/graph without audible test output.
  window.fixtureGraph[2].connect(context.destination); await context.resume();
  window.identityNodes=[...document.querySelectorAll('video,audio,canvas,iframe,input,button')];
  window.identityGraph=[...window.fixtureGraph];
  window.transportCalls=[];
  for(const element of document.querySelectorAll('video,audio')) {
    for(const name of ['play','pause','load']) element[name]=()=>{window.transportCalls.push(name);throw new Error('Resize called '+name);};
    for(const name of ['currentTime','playbackRate','volume','muted','src']) {
      const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,name);
      Object.defineProperty(element,name,{get:()=>descriptor.get.call(element),set:()=>{window.transportCalls.push(name);throw new Error('Resize wrote '+name);}});
    }
  }
};
window.fixtureReady=true;
`;
const server = createServer(async (req,res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if(path==='/playing.wav') { res.setHeader('Content-Type','audio/wav');res.end(wav);return; }
  if(path==='/' || path==='/star-screen.html' || path==='/fixture.js') {
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');
    res.end(path==='/'?host:path==='/fixture.js'?fixture:star);return;
  }
  if(/^\/[\w-]+\.(css|js)$/.test(path)) {
    try {
      const content=['/adaptive-host.css','/adaptive-host.js','/host-console.css'].includes(path)
        ? await readFile(new URL('../public'+path,import.meta.url),'utf8')
        : await readPublic(path.slice(1));
      res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(content);return;
    } catch {}
  }
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  const engine=process.env.GUEST_STAR_BROWSER || 'chromium';
  browser=await playwright[engine].launch({headless:true,...(process.env.GUEST_STAR_BROWSER_EXECUTABLE?{executablePath:process.env.GUEST_STAR_BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let frameNavigations=0;page.on('framenavigated',frame=>{if(frame!==page.mainFrame()) frameNavigations++;});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(()=>window.startFixtureAudio());
  const snapshot=()=>page.evaluate(()=>({
    values:[...document.querySelectorAll('input')].map(e=>[e.id,e.value,e.checked,e.disabled]),
    requests:window.fixture.state.requests, order:window.fixture.getOrder(), current:window.fixture.getCurrentId(),
    plan:document.querySelector('.player-plan-b-card').open,
    graphGain:window.fixtureGraph[0].gain.value
  }));
  const baseline=await snapshot();
  const initialTime=await page.locator('#playerMedia').evaluate(e=>e.currentTime);
  const sizes=[[1920,1080],[1600,900],[1440,900],[1401,900],[1400,900],[1399,900],[1200,800],
    [1101,760],[1100,760],[1099,760],[1051,760],[1050,760],[1049,760],
    [821,900],[820,900],[819,900],[701,700],[700,700],[699,700],
    [601,850],[600,850],[599,850],[431,850],[430,850],[429,850],[360,900],[320,900],
    [1600,360],[1200,260],[600,300],[360,300],[1440,900]];
  if(process.env.GUEST_STAR_ADAPTIVE_QUICK) sizes.splice(0,sizes.length,[1600,360],[360,300],[1440,900]);
  const labels={
    en:['⏮ Restart','▶ Play selected karaoke','↩ Return to queue','↷ Skip participant','✓ Participant has sung','× Remove from queue'],
    es:['⏮ Reiniciar','▶ Reproducir karaoke seleccionado','↩ Devolver a la fila','↷ Saltar participante','✓ Ya cantó','× Quitar de la fila'],
    fr:['⏮ Recommencer','▶ Lire le karaoké sélectionné','↩ Remettre dans la file','↷ Passer ce participant','✓ Le participant a chanté','× Retirer de la file']
  };
  const important=['playerRestart','playerPlay','playerReturn','playerSkip','playerComplete','playerRemove','playerSeek','playerVolume','playerTempo','playerKeyUp','playerEqLow','playerVocalLevel','playerBackgroundToggle','playerBackgroundVolume','playerBackgroundTempo'];
  for(const [language,texts] of Object.entries(labels)) {
    await page.evaluate(({language,texts})=>{
      document.documentElement.lang=language;
      document.querySelectorAll('.player-controls button > span').forEach((e,i)=>e.textContent=texts[i]);
      document.querySelector('#playerDirectSearch').placeholder=language==='fr'?'Rechercher un titre ou un artiste dans la bibliothèque locale…':'Título o artista de la biblioteca local…';
    },{language,texts});
    for(const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const geometry=await page.evaluate(()=>({
        width:document.body.clientWidth,scrollWidth:document.body.scrollWidth,
        queueHeights:[...document.querySelectorAll('.player-queue-row')].map(e=>e.getBoundingClientRect().height),
        sliders:['playerVolume','playerTempo','playerVocalLevel','playerBackgroundVolume','playerBackgroundTempo'].map(id=>[id,document.getElementById(id).getBoundingClientRect().width]),
        preview:(()=>{const r=document.querySelector('#playerStarScreenPreview').getBoundingClientRect();return {width:r.width,height:r.height};})()
      }));
      assert.ok(geometry.scrollWidth<=geometry.width+1,`${language} ${width}x${height}: horizontal overflow ${JSON.stringify(geometry)}`);
      assert.ok(geometry.queueHeights.every(h=>h===52),`${width}: queue row footprint changed`);
      assert.ok(geometry.sliders.every(([,w])=>w>=120),`${width}: slider too short ${JSON.stringify(geometry.sliders)}`);
      const operationWidths=await page.locator('.player-operation-actions .button').evaluateAll(es=>es.map(e=>[e.id,e.getBoundingClientRect().width]));
      assert.ok(operationWidths.every(([,w])=>w>=32 && w<=80),`${width}: action not content-sized ${JSON.stringify(operationWidths)}`);
      assert.ok(await page.locator('button.console-icon').evaluateAll(es=>es.every(e=>getComputedStyle(e).fontSize==='0px')),'legacy font-size exposed icon-only label');
      assert.ok(await page.locator('button.console-icon').evaluateAll(es=>es.every(e=>e.title&&e.getAttribute('aria-label'))),'icon-only action lost tooltip or accessible name');
      assert.ok(Math.abs(geometry.preview.width/geometry.preview.height-16/9)<.03,`${width}: distorted preview`);
      for(const id of important) {
        const control=page.locator('#'+id);
        await control.evaluate(e=>e.scrollIntoView({block:'center',inline:'nearest'}));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
        const r=await control.boundingBox();
        assert.ok(r && r.x>=8-1 && r.x+r.width<=width-8+1 && r.y>=8-1 && r.y+r.height<=height-8+1,`${width}x${height}: ${id} violates safe zone ${JSON.stringify(r)} ${JSON.stringify(await control.evaluate(e=>[e,e.parentElement,e.querySelector('span')].filter(Boolean).map(e=>{const s=getComputedStyle(e);return {cls:e.className,w:e.offsetWidth,h:e.offsetHeight,display:s.display,flex:s.flex,direction:s.flexDirection,position:s.position,width:s.width,font:s.fontSize,gap:s.gap,columns:s.gridTemplateColumns};})))}`);
      }
      // Absolute start/end must expose the first/last content with real space.
      const ends=await page.evaluate(()=>{
        const body=document.body;body.scrollTop=0;
        const top=document.querySelector('.topbar').getBoundingClientRect().top;
        body.scrollTop=body.scrollHeight;
        const last=document.querySelector('.player-plan-b-card').getBoundingClientRect().bottom;
        return {top,last,safe:parseFloat(getComputedStyle(document.documentElement).paddingTop)};
      });
      assert.ok(ends.top>=ends.safe-1 && ends.last<=height-ends.safe-8,`${width}x${height}: document ends lack safe space ${JSON.stringify(ends)}`);
      for(const selector of ['#playerQueue','#playerPlanB']) {
        const gaps=await page.locator(selector).evaluate(e=>{
          e.scrollTop=0;const first=e.firstElementChild.getBoundingClientRect().top-e.getBoundingClientRect().top;
          e.scrollTop=e.scrollHeight;const last=e.getBoundingClientRect().bottom-e.lastElementChild.getBoundingClientRect().bottom;
          return {first,last};
        });
        assert.ok(gaps.first>=7 && gaps.last>=7,`${selector}: missing first/last scroll padding ${JSON.stringify(gaps)}`);
      }
      assert.deepEqual(await snapshot(),baseline,`${language} ${width}x${height}: state changed`);
      assert.ok(await page.evaluate(()=>window.identityNodes.every(e=>e.isConnected&&(!e.id||document.getElementById(e.id)===e))&&window.identityGraph.every((e,i)=>e===window.fixtureGraph[i])&&window.fixtureContext.state==='running'));
    }
  }
  // Same transport button in XS and XL; a label/state update must stay accessible.
  await page.setViewportSize({width:360,height:900});
  const iconState=await page.locator('#playerPlay').evaluate(e=>{
    window.adaptivePlayIdentity=e;
    return {label:e.querySelector('span').textContent,disabled:e.disabled};
  });
  await page.locator('#playerPlayLabel').evaluate(e=>e.textContent='⏸ Mettre le karaoké en pause');
  await page.waitForFunction(()=>document.querySelector('#playerPlay').dataset.adaptiveIcon==='⏸');
  for(const id of ['playerPlay','playerRestart']) {
    const compact=await page.locator('#'+id).evaluate(e=>({
      label:e.getAttribute('aria-label'),title:e.title,
      icon:getComputedStyle(e,'::before').content,
      width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,
      textWidth:e.querySelector('span').getBoundingClientRect().width
    }));
    assert.ok(compact.label && compact.title.startsWith(compact.label) && compact.title.includes('⇧') && compact.icon!=='none');
    assert.ok(compact.width>=32 && compact.width<=34 && compact.height>=32 && compact.height<=34 && compact.textWidth===1,JSON.stringify(compact));
  }
  assert.ok(await page.locator('#playerComplete').evaluate(e=>e.title&&e.getAttribute('aria-label')),'outcome lost its accessible name');
  await page.setViewportSize({width:1440,height:900});
  assert.ok(await page.locator('#playerPlay').evaluate(e=>e===window.adaptivePlayIdentity&&e.querySelector('span').getBoundingClientRect().width===1));
  await page.locator('#playerPlay').evaluate((e,state)=>{e.querySelector('span').textContent=state.label;},iconState);
  assert.equal(await page.locator('#playerPlay').evaluate(e=>e.disabled),iconState.disabled);
  // Keep focus, an open queue popover, and a native select through continuous resize.
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#playerDirectSearch').fill('Titre très long');
  await page.locator('#playerDirectSearch').focus();
  for(let width=1440;width>=360;width-=30) await page.setViewportSize({width,height:650});
  for(let width=360;width<=1440;width+=30) await page.setViewportSize({width,height:650});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'playerDirectSearch');
  assert.equal(await page.locator('#playerDirectSearch').inputValue(),'Titre très long');
  await page.click('[data-player-expand="2"]');
  assert.ok(await page.locator('#playerQueueOptions [data-player-row-outcome="removed"]').evaluate(e=>e.getAttribute('aria-label')===e.title),'queue action needs its accessible title');
  for(const [width,height] of [[1440,900],[360,300],[820,900],[1440,900]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const box=await page.locator('#playerQueueOptions').boundingBox();
    assert.ok(box && box.x>=7 && box.y>=7 && box.x+box.width<=width-7 && box.y+box.height<=height-7,'queue popover escaped safe zone');
  }
  await page.keyboard.press('Escape');
  // Modal forms remain reachable in low/wide and narrow windows.
  for(const [width,height] of [[1440,260],[360,300],[600,600]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>document.querySelector('#preferencesDialog').showModal());
    const dialog=page.locator('#preferencesDialog');
    const box=await dialog.boundingBox();
    assert.ok(box && box.x>=7 && box.y>=7 && box.x+box.width<=width-7 && box.y+box.height<=height-7,'modal escaped safe zone');
    assert.equal(await dialog.evaluate(e=>getComputedStyle(e).overflowY),'auto','modal must support real wheel scrolling, not only scrollIntoView');
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,1000);
    await page.waitForFunction(()=>document.querySelector('#preferencesDialog').scrollTop>0);
    await dialog.locator('button').last().scrollIntoViewIfNeeded();
    await page.evaluate(()=>document.querySelector('#preferencesDialog').close());
  }
  assert.equal(frameNavigations,1,'preview reloaded during resize');
  assert.deepEqual(await page.evaluate(()=>window.transportCalls),[]);
  assert.deepEqual(await page.evaluate(()=>window.forbiddenCalls),[]);
  assert.ok(await page.locator('#playerMedia').evaluate((e,t)=>!e.paused && e.currentTime>t,initialTime));
  assert.ok(await page.locator('#playerBackgroundAudio').evaluate(e=>!e.paused&&e.currentTime>0));
  assert.deepEqual(errors,[]);
  // Entry/Bridge and Superhost use the same Host stylesheet without Player mode.
  const administration=await browser.newPage();
  await administration.goto(`http://127.0.0.1:${server.address().port}`);
  await administration.waitForFunction(()=>window.fixtureReady);
  const otherSizes=[[1440,900],[1100,700],[820,900],[600,700],[360,900],[320,260],[1440,260]];
  for(const mode of ['bridge','superhost']) {
    await administration.evaluate(mode=>{
      document.body.className=''; document.querySelector('#playerWorkspace').classList.add('hidden');
      document.querySelector('main').className=mode==='superhost'?'superhost-mode':'';
      document.querySelector('#superhostWorkspace').classList.toggle('hidden',mode!=='superhost');
      if(mode==='superhost') {
        document.querySelector('#superhostTabs').innerHTML=['Hotels et établissements','Participants et utilisateurs','Activités et paramètres','Rapports techniques'].map(t=>'<button>'+t+'</button>').join('');
        document.querySelector('#superhostContent').innerHTML='<div class="superhost-grid two">'+Array.from({length:2},()=>'<section class="superhost-card"><h3>Paramètres de l’établissement et des utilisateurs</h3><div class="superhost-entity"><div><strong>Un établissement avec un nom considérablement long</strong><small>Informations générales de la configuration</small></div><div class="superhost-actions"><button>Modifier les paramètres</button><button>Consulter les activités</button></div></div><form class="host-edit-form"><label>Nom du participant<input value="Un utilisateur avec un nom long"></label><label>Courriel<input value="utilisateur@example.com"></label><label>Langue<select><option>Français</option></select></label></form></section>').join('')+'</div>';
      }
    },mode);
    for(const [width,height] of otherSizes) {
      await administration.setViewportSize({width,height});
      await administration.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const fits=await administration.evaluate(()=>document.body.scrollWidth<=document.body.clientWidth+1);
      assert.ok(fits,`${mode} ${width}x${height}: horizontal overflow`);
    }
  }
  await administration.close();
  if(process.env.GUEST_STAR_ADAPTIVE_SCREENSHOTS) {
    const directory=process.env.GUEST_STAR_ADAPTIVE_SCREENSHOTS;await mkdir(directory,{recursive:true});
    for(const [width,height] of [[1440,900],[820,900],[360,900],[1440,360]]) {
      await page.setViewportSize({width,height});await page.evaluate(()=>document.body.scrollTo(0,0));
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(process.env.GUEST_STAR_ADAPTIVE_DEBUG) console.log(JSON.stringify(await page.evaluate(()=>[...document.querySelector('.player-transport-panel').children].map(e=>{
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {id:e.id,cls:e.className,x:r.x,y:r.y,w:r.width,h:r.height,display:s.display,position:s.position,rows:s.gridTemplateRows,columns:s.gridTemplateColumns};
      }))));
      await page.screenshot({path:resolve(directory,`host-${width}x${height}.png`)});
      await page.locator('#playerPlay').evaluate(e=>e.scrollIntoView({block:'center'}));
      await page.screenshot({path:resolve(directory,`host-${width}x${height}-controls.png`)});
      await page.evaluate(()=>document.body.scrollTop=document.body.scrollHeight);
      await page.screenshot({path:resolve(directory,`host-${width}x${height}-end.png`)});
    }
  }
  console.log(JSON.stringify({engine,layouts:sizes.length*3,otherLayouts:otherSizes.length*2,languages:Object.keys(labels),continuousResizeSteps:74,mediaClocks:2,transportCalls:0,previewNavigations:frameNavigations,focusPreserved:true,popover:true,dialogs:true,wheelScrolling:true,queueRows:52,safeZone:true,scrollEnds:true,adaptiveIcons:true}));
} finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
