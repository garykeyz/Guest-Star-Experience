import {basename,extname} from 'node:path';
import {normalizeText} from './matcher.mjs';
export const PLAYER_AUDIO=new Set(['.mp3','.m4a','.wav','.flac','.aac','.ogg']);
export const PLAYER_VIDEO=new Set(['.mp4','.m4v','.mov','.webm']);
export const playerMediaType=file=>PLAYER_AUDIO.has(extname(file).toLowerCase())?'audio':PLAYER_VIDEO.has(extname(file).toLowerCase())?'video':'';
export function playerMediaFolders(config){return [...new Set([...config.libraryFolders,...(config.playerAudioFolders||[]),...(config.playerVideoFolders||[])])];}
// Keep version suffixes (live/remix/edit) intact. Filename equivalence is only a
// media selection heuristic; it is NEVER lyric/temporal recording identity.
export function playerSourceCandidates(file,files,priority='auto'){
 const key=normalizeText(basename(file,extname(file)));
 const candidates=[...new Set([file,...files.filter(f=>normalizeText(basename(f,extname(f)))===key)])].filter(f=>playerMediaType(f));
 return candidates.sort((a,b)=>{const prefer=priority==='auto'?'video':priority;return Number(playerMediaType(b)===prefer)-Number(playerMediaType(a)===prefer)||a.localeCompare(b);});
}
