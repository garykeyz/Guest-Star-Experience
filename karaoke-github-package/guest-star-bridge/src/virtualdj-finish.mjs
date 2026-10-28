import {listKaraokeEntries,executeVdj,normalizeVdjPath,sameKaraokeIdentity,buildKaraokeRemoveScript} from './virtualdj.mjs';
import {readVdjPlayback} from './virtualdj-operations.mjs';

const literal=(value,allowEmpty=false)=>{const text=String(value||'');if((!text&&!allowEmpty)||/["'`\r\n]/.test(text))throw Error('Queue identity cannot be guarded safely.');return '"'+text+'"';};
export function guardedFutureRemove(entry,index,deckCount) {
  const path=literal(entry.filePath),singer=literal(entry.singer,true);
  let guard='browser_remove';
  // Compare in VirtualDJ at execution time as well as in the preceding snapshot.
  for(let deck=deckCount;deck>=1;deck--)guard=`param_equal \`deck ${deck} get_filepath\` ${path} ? nothing : (${guard})`;
  guard=`param_equal \`get_decks\` ${deckCount} ? (${guard}) : nothing`;
  guard=`param_equal \`get_next_karaoke_song 'singer' ${index}\` ${singer} ? (${guard}) : nothing`;
  guard=`param_equal \`get_browsed_filepath\` ${path} ? (${guard}) : nothing`;
  return buildKaraokeRemoveScript(index).replace(/browser_remove$/,`(${guard})`);
}
export async function clearConfirmedFutureQueue({config,entries,valid=()=>true,consume=async()=>{},removed=async()=>{},readQueue=listKaraokeEntries,readPlayback=readVdjPlayback,execute=executeVdj,allowDuplicateRows=false}) {
  const result={removed:[],preserved:[],uncertain:[]};
  for(const target of entries){
    if(!valid())break;
    const [queue,playback]=await Promise.all([readQueue(config),readPlayback(config)]);
    if(!valid())break;
    if(!Array.isArray(playback?.decks)||!playback.decks.length||playback.connected===false||playback.decks.some(deck=>(deck.loaded||deck.playing||deck.audible)&&!deck.filePath)){
      result.uncertain.push(target.id);continue;
    }
    const matches=queue.filter(row=>sameKaraokeIdentity(row,target));
    if(allowDuplicateRows&&matches.length===0){result.removed.push(target.id);continue;}
    if(!matches.length||(!allowDuplicateRows&&matches.length!==1)){result.uncertain.push(target.id);continue;}
    const row=matches[0];
    if(!row.filePath||playback.decks.some(deck=>normalizeVdjPath(deck.filePath)===normalizeVdjPath(row.filePath))){result.preserved.push(target.id);continue;}
    const script=guardedFutureRemove(row,row.index,playback.decks.length);
    // Persist before issuing an effect. A lost response never replays deletion.
    await consume(target);
    if(!valid())break;
    await execute(config,script);
    const after=await readQueue(config);
    if(!after.some(entry=>sameKaraokeIdentity(entry,row)) || (allowDuplicateRows && after.filter(entry=>sameKaraokeIdentity(entry,row)).length<matches.length)){await removed(target);result.removed.push(target.id);}
    else result.uncertain.push(target.id);
  }
  return result;
}
