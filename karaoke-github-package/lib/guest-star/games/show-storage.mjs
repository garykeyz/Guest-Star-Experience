import {showView} from './show-composer.mjs';
export function createShowStorage({sql,atomic,db}){
 sql.exec('CREATE TABLE IF NOT EXISTS shows(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,dirty INTEGER NOT NULL DEFAULT 1,synced INTEGER NOT NULL DEFAULT 0)');
 sql.exec('CREATE TABLE IF NOT EXISTS show_chunks(show_id TEXT NOT NULL,ordinal INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(show_id,ordinal))');
 sql.exec('CREATE TABLE IF NOT EXISTS show_events(show_id TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(show_id,sequence))');
 const read=id=>{if(!sql.exec('SELECT id FROM shows WHERE id=?',id).toArray()[0])return null;const value=JSON.parse(sql.exec('SELECT content FROM show_chunks WHERE show_id=? ORDER BY ordinal',id).toArray().map(v=>v.content).join(''));value.events=[];return value;};
 const save=show=>atomic(()=>{for(const event of show.events || [])sql.exec('INSERT OR IGNORE INTO show_events(show_id,sequence,data) VALUES(?,?,?)',show.id,event.sequence,JSON.stringify(event));const raw=JSON.stringify({...show,events:[]});sql.exec('DELETE FROM show_chunks WHERE show_id=?',show.id);for(let i=0;i<raw.length;i+=30000)sql.exec('INSERT INTO show_chunks(show_id,ordinal,content) VALUES(?,?,?)',show.id,i/30000,raw.slice(i,i+30000));sql.exec('INSERT INTO shows(id,revision,dirty) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,dirty=1',show.id,show.revision);});
 return {read,save,list:()=>sql.exec('SELECT id FROM shows ORDER BY id').toArray().map(v=>read(v.id)),dirty:()=>sql.exec('SELECT count(*) n FROM shows WHERE dirty=1').toArray()[0].n>0,
 async flush(){for(const row of sql.exec('SELECT id,synced FROM shows WHERE dirty=1').toArray()){
  const show=read(row.id),recordId=JSON.stringify([show.scope.hotelId,show.scope.venueId,show.scope.activityId,show.scope.runId,show.id]),raw=JSON.stringify(show),chunks=[];for(let i=0;i<raw.length;i+=30000)chunks.push(raw.slice(i,i+30000));
  const summary={...showView(show,{id:show.hostId,role:'host'},Date.now()),archive:{revision:show.revision,parts:chunks.length}};
  await db.prepare('INSERT OR IGNORE INTO guest_star_show_sessions(show_id,hotel_id,venue_id,activity_id,run_id,revision,status,snapshot_json,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)').bind(recordId,show.scope.hotelId,show.scope.venueId,show.scope.activityId,show.scope.runId,1,'RECOVERING','{}',show.updatedAt).run();
  const events=sql.exec('SELECT sequence,data FROM show_events WHERE show_id=? AND sequence>? ORDER BY sequence',show.id,row.synced).toArray();for(let i=0;i<events.length;i+=50)await db.batch(events.slice(i,i+50).map(e=>db.prepare('INSERT OR IGNORE INTO guest_star_show_event_log(show_id,sequence,event_json) VALUES(?,?,?)').bind(recordId,e.sequence,e.data)));
  for(let i=0;i<chunks.length;i+=50)await db.batch(chunks.slice(i,i+50).map((content,j)=>db.prepare('INSERT OR REPLACE INTO guest_star_show_state_chunks(show_id,revision,ordinal,content) VALUES(?,?,?,?)').bind(recordId,show.revision,i+j,content)));
  await db.prepare('UPDATE guest_star_show_sessions SET revision=?,status=?,snapshot_json=?,updated_at=? WHERE show_id=? AND revision<=?').bind(show.revision,show.status,JSON.stringify(summary),show.updatedAt,recordId,show.revision).run();
  await db.prepare('DELETE FROM guest_star_show_state_chunks WHERE show_id=? AND revision<?').bind(recordId,show.revision).run();sql.exec('UPDATE shows SET dirty=0,synced=? WHERE id=? AND revision=?',show.revision,show.id,show.revision);
 }} };
}
