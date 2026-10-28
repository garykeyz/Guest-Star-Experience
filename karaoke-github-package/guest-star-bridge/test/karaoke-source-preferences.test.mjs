import assert from 'node:assert/strict';
import test from 'node:test';
import {installPlayerMediaPreferences} from '../public/player-media-preferences.js';
function fixture(folder){
 const elements=new Map(),calls=[];
 const element=()=>({value:'',textContent:'',children:[],events:{},addEventListener(name,fn){this.events[name]=fn;},setAttribute(){},replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);}});
 const document={querySelector(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
 const request=async(path,options)=>{calls.push({path,options});if(path.endsWith('choose-folder'))return{folder};if(options)return JSON.parse(options.body);return{audioFolders:[],videoFolders:[],priority:'auto'};};
 const preferences=installPlayerMediaPreferences({request,document});return{elements,calls,preferences};
}
for(const kind of ['Audio','Video'])test(`choosing ${kind} saves and refreshes immediately; duplicate selection is idempotent`,async()=>{
 const f=fixture('/fixture/karaoke');await f.preferences.load();
 await f.elements.get(`#player${kind}Choose`).events.click();
 let saved=f.calls.filter(c=>c.path==='/api/player/media-preferences'&&c.options);
 assert.equal(saved.length,1);assert.deepEqual(JSON.parse(saved[0].options.body)[kind.toLowerCase()+'Folders'],['/fixture/karaoke']);
 await f.elements.get(`#player${kind}Choose`).events.click();saved=f.calls.filter(c=>c.path==='/api/player/media-preferences'&&c.options);
 assert.deepEqual(JSON.parse(saved[1].options.body)[kind.toLowerCase()+'Folders'],['/fixture/karaoke']);
 assert.match(f.elements.get('#playerMediaPreferencesStatus').textContent,/biblioteca actualizada/);
 assert.ok(f.calls.every(c=>!c.path.includes('transport')));
});
test('cancelling folder selection preserves preferences',async()=>{const f=fixture('');await f.preferences.load();await f.elements.get('#playerVideoChoose').events.click();assert.equal(f.calls.filter(c=>c.options&&c.path==='/api/player/media-preferences').length,0);});
