import {mkdir,readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';

const enqueueOrigins = new Set(['HOST_SEND_TO_VDJ','HOST_RETURN_TO_VDJ','HOST_REPLACE_IN_VDJ','HOST_SEND_SUGGESTION_TO_VDJ']);
const loadOrigins = new Set(['HOST_PREPARE_VDJ_DECK','HOST_SKIP_VDJ_NEXT']);
const capabilities = new WeakMap();
const hash = value => createHash('sha256').update(value).digest('hex');

// Only a validated manual command boundary can mint this private capability.
// Origin strings alone cannot authorize the transport or an internal caller.
export function assertVdjHostIntent(intent, effect) {
  const capability = intent && capabilities.get(intent);
  const allowed = effect === 'enqueue' ? enqueueOrigins : loadOrigins;
  const existingHead = effect === 'load' && capability?.record.origin === 'REAL_VDJ_QUEUE_POSITION_1';
  if (!capability || capability.used || (!allowed.has(capability.record.origin) && !existingHead) || !capability.valid()) {
    throw new Error('VDJ song write denied: an explicit, current Host command is required.');
  }
  return capability;
}

// The automatic exception is constrained to this exact guarded LOAD script.
// VDJ rechecks the real head and playback at execution time, so a stale
// snapshot cannot load a missing track or replace a playing/audible deck.
export function realVdjQueueHeadIntent({filePath,singer,valid=()=>true}) {
  if(!filePath || /["`\r\n\0]/.test(filePath+singer))throw Error('Unsafe real VDJ head identity.');
  const path=JSON.stringify(filePath),name=JSON.stringify(singer);
  const load=`browser_window "karaoke" & browser_scroll "top" & deck 1 play ? nothing : deck 1 is_audible ? nothing : param_equal \`get_browsed_filepath\` ${path} ? deck 1 load : nothing`;
  const script=`deck 1 play ? nothing : deck 1 is_audible ? nothing : param_equal \`deck 1 get_filepath\` ${path} ? nothing : param_equal \`get_next_karaoke_song 'fullpath' 0\` ${path} ? (param_equal \`get_next_karaoke_song 'singer' 0\` ${name} ? (${load}) : nothing) : nothing`;
  const intent=Object.freeze({});
  capabilities.set(intent,{record:{origin:'REAL_VDJ_QUEUE_POSITION_1',subject:filePath},used:false,valid,script,consume:async()=>{}});
  return {intent,script};
}

export function createVdjHostCommandGate({path,currentScope}) {
  let records, loading, saving=Promise.resolve();
  const commands = new Map();
  async function load() {
    if (!loading) loading=(async()=>{
      try { const saved=JSON.parse(await readFile(path,'utf8')); if(saved.version!==1 || !saved.commands || typeof saved.commands!=='object' || Array.isArray(saved.commands))throw Error('Invalid VDJ Host command ledger.');records=saved.commands; }
      catch(error){ if(error.code!=='ENOENT')throw error;records={}; }
    })();
    await loading;
  }
  function save() {
    const snapshot=JSON.stringify({version:1,commands:records});
    const next=saving.then(async()=>{await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',snapshot,{mode:0o600});await rename(path+'.tmp',path);});
    saving=next.catch(()=>{});return next;
  }
  async function run(command,operation) {
    const {commandId,origin,subject,signature,scope}=command;
    if(command.userInitiated!==true || (!enqueueOrigins.has(origin)&&!loadOrigins.has(origin)) || !/^[A-Za-z0-9_-]{8,80}$/.test(String(commandId||'')) || !subject || scope!==currentScope())throw Error('VDJ song write denied: invalid manual Host intent.');
    const fingerprint=hash(JSON.stringify([origin,subject,signature,scope]));
    const previous=commands.get(commandId);
    if(previous){if(previous.fingerprint!==fingerprint)throw Error('Host command ID was reused for another action.');return previous.promise;}
    const promise=(async()=>{
      await load();
      const prior=records[commandId];
      if(prior){
        if(prior.fingerprint!==fingerprint)throw Error('Host command ID was reused for another action.');
        return {ok:prior.status==='completed',idempotent:true,consumed:true,error:prior.status==='completed'?undefined:'This Host command was already consumed; synchronize and use a new manual action if needed.',warning:'The original Host command was not sent again.'};
      }
      const record={commandId,origin,subject,scope,fingerprint,status:'reserved',reservedAt:new Date().toISOString()};
      records[commandId]=record;
      // Durable reservation precedes all side effects, including lost responses.
      await save();
      const intent=Object.freeze({});
      capabilities.set(intent,{record,used:false,valid:()=>scope===currentScope(),consume:async script=>{record.effectHash=hash(script);record.consumedAt=new Date().toISOString();await save();}});
      try {const result=await operation(intent);record.status='completed';await save();return result;}
      catch(error){record.status='failed';await save();throw error;}
      finally{const cap=capabilities.get(intent);if(cap)cap.used=true;}
    })();
    commands.set(commandId,{fingerprint,promise});promise.catch(()=>{});return promise;
  }
  return {run};
}

function songEffect(script) {
  // Ignore literal paths/titles. These verbs are commands, not read properties.
  const nested=[...String(script).matchAll(/`([^`]+)`/g)].map(m=>m[1]).join(' ');
  const verbs=(String(script)+' '+nested).replace(/"[^"]*"|'[^']*'/g,'');
  if(/\b(?:repeat_start|repeat_start_instant|execute|script)\b/i.test(verbs))throw Error('Deferred or indirect VDJ script writes are not allowed.');
  if(/\b(?:karaoke_add|karaoke_load|playlist_add|playlist_load|automix_add|sidelist_add|sidelist_load|browser_add|add_to_list|virtualfolder_add|enqueue|requeue)\b/i.test(verbs))return 'enqueue';
  if(/\b(?:load|load_next|load_previous|undo_load|browser_enter|emergency_play|load_deck_set|clone_deck|sidelist_load_and_remove|sidelist_load_and_keep)\b/i.test(verbs))return 'load';
  if(/(?:^|[&?:()])\s*(?:karaoke|automix)(?:\s+(?:on|off|true|false|toggle|[01])\b|\s*(?:$|[&?:()]))/i.test(verbs))return 'load';
  return '';
}

export async function authorizeVdjSongWrite(script,intent,{query=false}={}) {
  const effect=songEffect(script);
  if(!effect)return;
  if(query)throw Error('VDJ song writes cannot use the observation transport.');
  const cap=assertVdjHostIntent(intent,effect);
  if(cap.script && cap.script!==script)throw Error('A real queue head authorization cannot issue another VDJ command.');
  // Guest Star's sole enqueue primitive is a single explicit karaoke_add.
  if(effect==='enqueue') {
    const verbs=String(script).replace(/"[^"]*"|'[^']*'/g,'');
    if((verbs.match(/\bkaraoke_add\b/g)||[]).length!==1 || /\b(?:karaoke_load|playlist_add|playlist_load|automix_add|sidelist_add|sidelist_load|browser_add|add_to_list|virtualfolder_add|enqueue|requeue|load|load_next|load_previous|undo_load|clone_deck|browser_enter)\b/i.test(verbs))throw Error('Unsupported VDJ enqueue primitive.');
  }
  cap.used=true;
  await cap.consume(script);
  if(!cap.valid())throw Error('The activity changed before the VDJ song write.');
  return cap.valid;
}

export async function auditVdjWrite(script,intent) {
  if(!process.env.GUEST_STAR_VDJ_WRITE_AUDIT)return;
  const record=intent && capabilities.get(intent)?.record;
  await appendFile(process.env.GUEST_STAR_VDJ_WRITE_AUDIT,JSON.stringify({timestamp:new Date().toISOString(),command:script,origin:record?.origin||'NO_HOST_INTENT',userInitiated:Boolean(record?.commandId),commandId:record?.commandId||'',requestId:record?.subject||'',caller:new Error().stack})+'\n',{mode:0o600});
}
