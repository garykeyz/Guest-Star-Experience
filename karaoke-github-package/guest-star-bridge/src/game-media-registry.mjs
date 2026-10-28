import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import {resolve} from 'node:path';import {randomUUID} from 'node:crypto';
/** Opaque media handles, isolated by existing activity occurrence; no media leaves the Mac. */
export function createGameMediaRegistry({root,getScope,resolveLibraryFile}){
 const file=resolve(root,'game-media-resources.json');let operation=Promise.resolve();
 const load=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,resources:[]};throw e;}};
 return {
  async register({libraryId,name,authorized}){if(authorized!==true)throw Error('MEDIA_AUTHORIZATION_REQUIRED');const scope=getScope();if(!scope)throw Error('ACTIVITY_REQUIRED');const path=await resolveLibraryFile(libraryId),row={id:randomUUID(),scope,path,name:String(name || 'Recurso local').slice(0,160),createdAt:Date.now()};const task=operation.then(async()=>{const store=await load();store.resources=store.resources.filter(r=>r.createdAt>Date.now()-30*86400000);if(store.resources.length>=500)throw Error('MEDIA_RESOURCE_LIMIT');store.resources.push(row);await mkdir(root,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(store),{mode:0o600});await rename(temp,file);return {id:row.id,name:row.name};});operation=task.catch(()=>{});return task;},
  async list(){const scope=getScope();return (await load()).resources.filter(r=>r.scope===scope&&r.createdAt>Date.now()-30*86400000).map(({id,name})=>({id,name}));},
  async resolve(id){const scope=getScope(),resource=(await load()).resources.find(r=>r.id===id&&r.scope===scope&&r.createdAt>Date.now()-30*86400000);if(!resource)throw Error('MEDIA_RESOURCE_NOT_FOUND');await resolveLibraryFile(Buffer.from(resource.path).toString('base64url'));return resource.path;}
 };
}
