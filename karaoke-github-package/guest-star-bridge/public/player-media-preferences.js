export function installPlayerMediaPreferences({request,document}){
 const $=s=>document.querySelector(s);let value={audioFolders:[],videoFolders:[],priority:'auto'};
 function render(){for(const kind of ['audio','video']){const list=$('#player'+(kind==='audio'?'Audio':'Video')+'Folders');list.replaceChildren();for(const [index,folder] of value[kind+'Folders'].entries()){const row=document.createElement('div'),input=document.createElement('input'),remove=document.createElement('button');input.type='text';input.value=folder;input.setAttribute('aria-label','Carpeta '+kind);input.addEventListener('input',()=>value[kind+'Folders'][index]=input.value);remove.type='button';remove.textContent='Quitar';remove.className='button ghost';remove.addEventListener('click',()=>{value[kind+'Folders'].splice(index,1);render();});row.append(input,remove);list.append(row);}}$('#playerMediaPriority').value=value.priority;}
 for(const kind of ['audio','video']){
  const prefix='#player'+(kind==='audio'?'Audio':'Video');
  $(prefix+'Add').addEventListener('click',()=>{value[kind+'Folders'].push('');render();});
  $(prefix+'Choose').addEventListener('click',async()=>{try{const selected=await request('/api/player/media/choose-folder',{method:'POST',body:JSON.stringify({kind})});if(selected.folder){if(!value[kind+'Folders'].includes(selected.folder))value[kind+'Folders'].push(selected.folder);render();await save();}}catch(e){$('#playerMediaPreferencesStatus').textContent=e.message;}});
 }
 async function save(){value.priority=$('#playerMediaPriority').value;for(const kind of ['audio','video'])value[kind+'Folders']=value[kind+'Folders'].map(x=>x.trim()).filter(Boolean);$('#playerMediaPreferencesStatus').textContent='Actualizando biblioteca…';value=await request('/api/player/media-preferences',{method:'POST',body:JSON.stringify(value)});render();$('#playerMediaPreferencesStatus').textContent='Preferencias guardadas y biblioteca actualizada. La pista en reproducción conserva su fuente.';}
 $('#playerMediaSave').addEventListener('click',async()=>{try{await save();}catch(e){$('#playerMediaPreferencesStatus').textContent=e.message;}});
 return {async load(){try{value=await request('/api/player/media-preferences');render();}catch(e){$('#playerMediaPreferencesStatus').textContent=e.message;}}};
}
