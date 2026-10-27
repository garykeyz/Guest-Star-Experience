import {createVisualLyricEditor} from './visual-lyric-editor.js';

export function installLyricEditor({getId,getLyrics,getTime=()=>0,isPlaying=()=>false,onTogglePlay=()=>{},onSeek=()=>{},onReanalyze=()=>{},request,onSaved,document=globalThis.document}){
 const $=selector=>document.querySelector(selector),dialog=$('#playerLyricEditor'),text=$('#lyricEditorText');
 let id='',revision=0,token=0,sourceKey='',hasManualVersion=false;
 const base=()=>`/api/player/lyrics/${encodeURIComponent(id)}`;
 const status=message=>$('#lyricEditorStatus').textContent=message;
 const visual=createVisualLyricEditor({
  document,request,getTime,isPlaying,onTogglePlay,onSeek,status,
  onChange:value=>{const start=text.selectionStart;text.value=value;text.setSelectionRange(Math.min(start,value.length),Math.min(start,value.length));},
  onSelect:range=>{text.focus({preventScroll:true});text.setSelectionRange(range.start,range.end);}
 });
 async function history(){
  const list=await request(base()+'/versions');revision=list.revision;
  hasManualVersion=list.versions.some(version=>['HUMAN_REVIEWED','PARTIALLY_HUMAN_REVIEWED'].includes(version.humanReviewLevel));
  const select=$('#lyricEditorVersions');select.replaceChildren();
  for(const version of list.versions){
   const option=document.createElement('option');option.value=version.versionId;
   const label=version.humanReviewLevel==='AUTOMATIC'?'Análisis automático':'Corrección guardada';
   option.textContent=`${new Date(version.createdAt).toLocaleString()} · ${label}`;
   option.selected=version.versionId===list.selectedVersionId;select.append(option);
  }
 }
 async function publish(result){
  if(id!==String(getId())||getLyrics().sourceKey!==sourceKey){status('La pista cambió. La corrección quedó guardada para su grabación.');return;}
  onSaved(result);revision=result.revision;visual.acceptSaved(result);await history();status('Guardado. La reproducción continúa.');
 }
 function showDocument(lyrics){visual.start(id,lyrics);text.value=visual.text||lyrics.textCandidate?.text||'';}
 $('#playerLyricsEdit').addEventListener('click',async()=>{
  id=String(getId()||'');if(!id)return;const current=++token;dialog.showModal();status('Cargando letra…');
  try{const lyrics=getLyrics();sourceKey=lyrics.sourceKey;revision=lyrics.revision||0;if(current!==token)return;showDocument(lyrics);await history();status('Escucha, corrige el texto o arrastra palabras y pulsa Guardar.');}
  catch(error){status(error.message);}
 });
 $('#lyricEditorClose').addEventListener('click',()=>{
  if(visual.dirty&&!document.defaultView.confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))return;
  token++;visual.close();dialog.close();
 });
 text.addEventListener('input',()=>visual.changeText(text.value));
 for(const event of ['click','keyup','select'])text.addEventListener(event,()=>visual.selectAtText(text.selectionStart));
 $('#lyricEditorSave').addEventListener('click',async()=>{
  try{status('Guardando…');await publish(await visual.save());}
  catch(error){status(error.message+' La corrección sigue visible.');}
 });
 $('#lyricEditorReanalyze').addEventListener('click',()=>{
  if(visual.dirty){status('Guarda o descarta tus cambios antes de reanalizar.');return;}
  if(hasManualVersion&&!document.defaultView.confirm('Esta letra tiene correcciones guardadas. Reanalizar creará una nueva versión; podrás recuperar las anteriores desde Historial. ¿Continuar?'))return;
  token++;visual.close();dialog.close();void onReanalyze();
 });
 $('#lyricEditorRestore').addEventListener('click',async()=>{
  try{const result=await request(base()+'/restore',{method:'POST',body:JSON.stringify({versionId:$('#lyricEditorVersions').value,expectedRevision:revision})});await publish(result);showDocument(result);}
  catch(error){status(error.message);}
 });
 $('#lyricEditorAlign').addEventListener('click',async()=>{
  try{
   status('Alineando el texto contra el audio…');
   if(visual.dirty)await publish(await visual.save());
   const result=await request(base()+'/realign',{method:'POST',body:JSON.stringify({expectedRevision:revision})});
   await publish(result);showDocument(result);
  }catch(error){status(error.message);}
 });
 $('#lyricEditorShare').addEventListener('click',async()=>{
  try{const result=await request(base()+'/share',{method:'POST',body:JSON.stringify({rights:{allow:$('#lyricShareAllow').checked,kind:$('#lyricShareKind').value,basis:$('#lyricShareBasis').value}})});status(result.ok?'Versión autorizada compartida.':result.error||'No se pudo compartir.');}
  catch(error){status(error.message);}
 });
 $('#lyricEditorReference').addEventListener('click',async()=>{
  try{const result=await request(base()+'/reference',{method:'POST',body:JSON.stringify({text:$('#lyricReferenceText').value,url:$('#lyricReferenceUrl').value,rights:{allow:$('#lyricShareAllow').checked,kind:$('#lyricShareKind').value,basis:$('#lyricShareBasis').value}})});if(result.lyrics){await publish(result.lyrics);showDocument(result.lyrics);}status(result.conflict?'Hay diferencias para revisar en la referencia.':'Referencia coincidente.');}
  catch(error){status(error.message);}
 });
 return {close(){token++;visual.close();dialog.close();}};
}
