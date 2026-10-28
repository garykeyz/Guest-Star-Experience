import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rename, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {normalizeQueueState} from './queue-state.mjs';
// Only data is stored. Frontend components and audio engines are shared.
export function activityContextKey(selection, startedAt = '') {
  return JSON.stringify([selection.hotelId || selection.lastHotelId || '', selection.venueId || selection.lastVenueId || '', selection.activityId || selection.lastActivityId || '', startedAt]);
}
export function createActivityContextStore(directory) {
  let writes = Promise.resolve();
  const pathFor = key => join(directory, createHash('sha256').update(key).digest('hex') + '.json');
  return {
    async latestActiveFreeSession() {
      let names;
      try {names=await readdir(directory);} catch(error) {if(error.code==='ENOENT')return null;throw error;}
      const candidates=await Promise.all(names.filter(name=>name.endsWith('.json')).map(async name=>{
        const path=join(directory,name);
        try {
          const [raw,info]=await Promise.all([readFile(path,'utf8'),stat(path)]);
          const value=JSON.parse(raw),key=JSON.parse(value.key);
          if(!Array.isArray(key)||key.length!==4||key[0]!==''||key[1]!==''||!/^free:[0-9a-f-]{36}$/.test(key[2]))return null;
          const active=normalizeQueueState(value.queue).activeActivityState;
          if(active.activityId!==key[2]||active.activityStartedAt!==key[3]||!active.playbackMode)return null;
          return {sessionId:key[2],activityStartedAt:key[3],playbackMode:active.playbackMode,modifiedAt:info.mtimeMs};
        } catch {return null;}
      }));
      return candidates.filter(Boolean).sort((a,b)=>b.modifiedAt-a.modifiedAt)[0] || null;
    },
    async load(key) {
      await writes;
      try {const value=JSON.parse(await readFile(pathFor(key),'utf8'));return value.key===key ? normalizeQueueState(value.queue) : normalizeQueueState();}
      catch(error) {if(error.code==='ENOENT')return normalizeQueueState();throw error;}
    },
    save(key, queue) {
      const content=JSON.stringify({key,queue:normalizeQueueState(queue)});
      const write=async()=>{await mkdir(directory,{recursive:true});const path=pathFor(key);await writeFile(path+'.tmp',content,{mode:0o600});await rename(path+'.tmp',path);};
      writes=writes.then(write,write);return writes;
    }
  };
}
