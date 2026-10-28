import {createShow} from './show-composer.mjs';import {gameDefinitions} from './plugins.mjs';import {invariant,integer,cleanText} from './competition.mjs';
export async function showOffers(db,hotelId,activityId=null){if(activityId){const local=await db.prepare('SELECT formats_json FROM guest_star_activity_game_offers WHERE hotel_id=? AND activity_id=?').bind(hotelId,activityId).first();if(local)return JSON.parse(local.formats_json);}const row=await db.prepare('SELECT formats_json FROM guest_star_show_offers WHERE hotel_id=?').bind(hotelId).first();return row?JSON.parse(row.formats_json):null;}
export async function handleShowTemplates(db,body,actor,now=Date.now()){
 invariant(['host','superhost'].includes(actor.role),'FORBIDDEN');const hotelId=actor.scope.hotelId;
 if(body.action==='offers.save'){
  invariant(actor.role==='superhost','FORBIDDEN');invariant(Array.isArray(body.formats)&&body.formats.every(id=>gameDefinitions().some(d=>d.id===id)),'INVALID_SHOW_OFFER');
  if(body.activityOnly===true){await db.prepare('INSERT INTO guest_star_activity_game_offers(hotel_id,activity_id,formats_json,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(hotel_id,activity_id) DO UPDATE SET formats_json=excluded.formats_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(hotelId,actor.scope.activityId,JSON.stringify([...new Set(body.formats)]),actor.id,now).run();return {ok:true,formats:body.formats};}
  await db.prepare('INSERT INTO guest_star_show_offers(hotel_id,formats_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(hotel_id) DO UPDATE SET formats_json=excluded.formats_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(hotelId,JSON.stringify([...new Set(body.formats)]),actor.id,now).run();return {ok:true,formats:body.formats};
 }
 if(body.action==='templates.list'){
  const {results}=await db.prepare('SELECT t.template_id,t.version,t.config_json,t.created_at FROM guest_star_show_templates t WHERE t.hotel_id=? AND t.version=(SELECT max(n.version) FROM guest_star_show_templates n WHERE n.hotel_id=t.hotel_id AND n.template_id=t.template_id) ORDER BY t.created_at DESC LIMIT 100').bind(hotelId).all();
  return {ok:true,templates:(results || []).map(r=>({id:r.template_id,version:r.version,config:JSON.parse(r.config_json),createdAt:r.created_at})),hotelFormats:await showOffers(db,hotelId),formats:await showOffers(db,hotelId,actor.scope.activityId),...(actor.role==='superhost'?{catalog:gameDefinitions()}:{} )};
 }
 if(body.action==='templates.save'){
  invariant(actor.role==='superhost','FORBIDDEN');const id=cleanText(body.templateId,80),commandId=cleanText(body.commandId,120),expected=integer(body.expectedVersion,0,10000),config=structuredClone(body.config);
  createShow({id:'template-validation',scope:actor.scope,hostId:actor.id,config,now});
  const serialized=JSON.stringify(config),prior=await db.prepare('SELECT version,config_json FROM guest_star_show_templates WHERE hotel_id=? AND command_id=?').bind(hotelId,commandId).first();if(prior){invariant(prior.config_json===serialized,'COMMAND_ID_CONFLICT');return {ok:true,templateId:id,version:prior.version,replayed:true};}
  const result=await db.prepare('INSERT INTO guest_star_show_templates(hotel_id,template_id,version,config_json,created_by,created_at,command_id) SELECT ?,?,?,?,?,?,? WHERE COALESCE((SELECT max(version) FROM guest_star_show_templates WHERE hotel_id=? AND template_id=?),0)=?').bind(hotelId,id,expected+1,serialized,actor.id,now,commandId,hotelId,id,expected).run();invariant(result.meta?.changes===1,'STALE_TEMPLATE_VERSION');return {ok:true,templateId:id,version:expected+1};
 }
 if(body.action==='templates.clone'){
  invariant(actor.role==='superhost','FORBIDDEN');const source=await db.prepare('SELECT config_json FROM guest_star_show_templates WHERE hotel_id=? AND template_id=? AND version=?').bind(cleanText(body.sourceHotelId,160),cleanText(body.sourceTemplateId,80),integer(body.sourceVersion,1,10000)).first();invariant(source,'TEMPLATE_NOT_FOUND');return handleShowTemplates(db,{action:'templates.save',templateId:body.templateId,commandId:body.commandId,expectedVersion:0,config:JSON.parse(source.config_json)},actor,now);
 }
 throw Error('UNKNOWN_TEMPLATE_ACTION');
}
export async function materializeShowTemplate(db,reference,actor,overrides={}){
 invariant(reference.hotelId===actor.scope.hotelId,'TEMPLATE_TENANT_MISMATCH');const row=await db.prepare('SELECT config_json FROM guest_star_show_templates WHERE hotel_id=? AND template_id=? AND version=?').bind(reference.hotelId,cleanText(reference.id,80),integer(reference.version,1,10000)).first();invariant(row,'TEMPLATE_NOT_FOUND');return {...JSON.parse(row.config_json),...overrides,template:{hotelId:reference.hotelId,id:reference.id,version:reference.version}};
}
