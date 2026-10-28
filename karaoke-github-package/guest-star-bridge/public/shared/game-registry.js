/** Future engines must provide both configure and start; a menu card is not an engine. */
export function createGameRegistry(entries) {
 const ids=new Set();
 return Object.freeze(entries.map(entry=>{
  if(!entry.id || ids.has(entry.id))throw new Error('Duplicate or missing game ID');
  ids.add(entry.id);
  if(entry.status==='available' && (typeof entry.configure!=='function' || typeof entry.start!=='function'))throw new Error('Available games require a functional engine');
  return Object.freeze({...entry,status:entry.status==='available'?'available':'pending'});
 }));
}
export const GAME_REGISTRY=createGameRegistry([
 ['music-trivia','Music Trivia','Preguntas y cultura musical.','trivia'],
 ['guess-song','Guess the Song','Reconoce la canción.','music'],
 ['team-battle','Team Battle','Desafíos musicales por equipos.','teams'],
 ['finish-lyrics','Finish the Lyrics','Completa la siguiente frase.','lyrics'],
 ['karaoke-battle','Karaoke Battle','Competencia de interpretación.','mic'],
 ['mystery-singer','Mystery Singer','Descubre quién está cantando.','star'],
 ['random-song','Random Song Challenge','El reto de una canción sorpresa.','shuffle'],
 ['duet-roulette','Duet Roulette','Encuentra tu próximo dueto.','teams'],
 ['audience-choice','Audience Choice / Spin the Wheel','La audiencia elige el siguiente reto.','wheel']
].map(([id,name,description,icon])=>({id,name,description,icon,status:'pending'})));
