import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}
function fixture({role='superhost', choice=null, mounted='', running=false}={}) {
  const calls=[];
  const fields={hidden:true};
  const dialog=name=>({open:true,close(){this.open=false;calls.push(name+':close');},showModal(){this.open=true;}});
  const context=vm.createContext({
    state:{account:{authenticated:true,user:{role},current:{activityId:'a'}},tenant:{activity:{activityId:'a'}},activity:{activityId:'a',activityRunning:running},operatingMode:{selected:'bridge'}},
    entryInitialized:false,entryChoice:choice,mountedMode:mounted,pendingHostEntry:false,superhostInHostView:true,
    autoRestoredPlayerActivityId:'',autoRestoredBridgeActivityId:'',
    selectionDialog:dialog('selection'),playbackModeDialog:dialog('mode'),
    $:()=>fields,rememberedActivity:()=>({activityId:'remembered'}),entryContextId:()=> 'a',
    useRememberedActivity:async()=>calls.push('remembered'),
    showEntrySelection:()=>calls.push('selection'),
    enterSelectedContext:()=>calls.push('enter'),
    openPlaybackModeDialog:()=>calls.push('mode'),
    navigateEntry:choice=>calls.push('navigate:'+choice),
    fillSelection:()=>calls.push('fill'),showNotice:()=>{},updateStatus:()=>calls.push('status'),
    showHostForSelectedMode:()=>calls.push('host'),
    playerPanel:{close:()=>calls.push('player:close')},
    superhostPanel:{open:()=>calls.push('admin')}
  });
  for (const name of ['openSuperhostView','requestHostEntry','initializeEntry']) vm.runInContext(functionSource(name),context);
  return {context,calls,fields};
}
test('Superhost starts in administration even with a remembered running session',async()=>{
  const f=fixture({running:true});await f.context.initializeEntry();
  assert.ok(f.calls.includes('admin'));assert.ok(!f.calls.includes('enter'));assert.ok(!f.calls.includes('remembered'));
  assert.equal(f.context.selectionDialog.open,false);assert.equal(f.context.playbackModeDialog.open,false);
});
test('explicit activity switching still opens the picker for Superhost',async()=>{
  const f=fixture({choice:'switch'});await f.context.initializeEntry();
  assert.deepEqual(f.calls,['selection']);
});
test('Superhost sees the hotel, venue and activity fields immediately in the picker',()=>{
  for (const role of ['superhost','host']) {
    const elements=new Map();
    const get=selector=>{
      if(!elements.has(selector))elements.set(selector,{});
      return elements.get(selector);
    };
    const context=vm.createContext({state:{account:{user:{role}}},$:get,
      rememberedActivity:()=>null,fillSelection(){},selectionDialog:{open:false,showModal(){this.open=true;}}});
    vm.runInContext(functionSource('showEntrySelection'),context);
    context.showEntrySelection();
    assert.equal(get('#activitySelectionFields').hidden,role!=='superhost');
    assert.equal(context.selectionDialog.open,true);
  }
});
test('Host retains automatic entry into its running activity',async()=>{
  const f=fixture({role:'host',running:true});await f.context.initializeEntry();
  assert.deepEqual(f.calls,['enter']);
});
test('a new login can initialize its own landing panel after logout',()=>{
  const context=vm.createContext({state:{account:{authenticated:false}},mountedMode:'',entryInitialized:true,loginDialog:{open:true}});
  vm.runInContext(functionSource('updateAuthUi'),context);
  context.updateAuthUi();assert.equal(context.entryInitialized,false);
});
test('Superhost chooses an activity instead of silently reusing the previous Host context',()=>{
  const f=fixture();f.context.requestHostEntry();
  assert.ok(f.calls.includes('selection'));assert.equal(f.fields.hidden,false);
  assert.ok(!f.calls.includes('enter'));assert.ok(!f.calls.includes('host'));
});
test('Superhost changing Host context uses the existing workspace exit path',()=>{
  const f=fixture({mounted:'player',running:true});f.context.requestHostEntry();
  assert.deepEqual(f.calls,['navigate:switch']);
});
test('Host can return to Superhost without a selection modal covering administration',()=>{
  const f=fixture({mounted:'bridge'});f.context.openSuperhostView();
  assert.equal(f.context.selectionDialog.open,false);assert.equal(f.context.playbackModeDialog.open,false);
  assert.ok(f.calls.includes('admin'));assert.equal(f.context.superhostInHostView,false);
});
