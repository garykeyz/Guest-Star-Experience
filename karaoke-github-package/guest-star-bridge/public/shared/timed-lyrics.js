const BUSY = new Set(['preparing', 'transcribing', 'aligning']);
const STATUSES = new Set(['idle', 'preparing', 'transcribing', 'aligning', 'ready', 'unavailable', 'needs_alignment', 'error', 'cancelled']);

export function normalizeTimedLyrics(value = {}) {
  const input = value?.lyrics || value || {};
  const segments = (Array.isArray(input.segments) ? input.segments : [])
    .filter(segment => Number.isFinite(Number(segment?.start)) && Number(segment.start) >= 0 && String(segment?.text || '').trim())
    .slice(0, 10000)
    .map(segment => ({ start: Number(segment.start), end: Number(segment.end), text: String(segment.text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1000), ...(Array.isArray(segment.words)?{words:segment.words.filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start).map(w=>({text:String(w.text),start:w.start,end:w.end}))}:{}) }))
    .sort((left, right) => left.start - right.start);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const next = segments[index + 1]?.start;
    if (!Number.isFinite(segment.end) || segment.end <= segment.start) segment.end = next > segment.start ? next : segment.start + 5;
    if (next > segment.start) segment.end = Math.min(segment.end, next);
  }
  return {
    sourceKey: String(input.sourceKey || ''),
    status: STATUSES.has(input.status) ? input.status : 'idle',
    provider: String(input.provider || ''), language: String(input.language || 'auto'),
    estimated: input.estimated === true, processedSeconds: Math.max(0, Number(input.processedSeconds) || 0),
    segments, version: String(input.version || ''),versionId:input.versionId,revision:input.revision,recording:input.recording,textCandidate:input.textCandidate,humanReviewLevel:input.humanReviewLevel,reviewCoverage:input.reviewCoverage,readiness:input.readiness
  };
}

// Each lookup uses the current media position. Seeking backwards and changing
// tempo never depend on a cue index left over from the previous frame.
export function timedLyricsLines(segments = [], position = 0) {
  const time = Math.max(0, Number(position) || 0);
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle].start <= time) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const cue = segments[index];
  const cueWords=cue?.words||[];let wordLow=0,wordHigh=cueWords.length;
  while(wordLow<wordHigh){const middle=(wordLow+wordHigh)>>>1;if(cueWords[middle].start<=time)wordLow=middle+1;else wordHigh=middle;}
  const wordIndex=wordLow-1,activeWord=cueWords[wordIndex]&&time<cueWords[wordIndex].end?cueWords[wordIndex]:null;
  return {
    index: cue && time < cue.end ? index : -1,
    current: cue && time < cue.end ? cue.text : '',
    next: segments[index + 1]?.text || '',
    previous: segments[index - 1]?.text || '',
    displayCurrent: cue?.text || '',
    currentLine:cue?.text||'',nextLine:segments[index+1]?.text||'',
    previousWord:cueWords[wordIndex-1]?.text||'',currentWord:activeWord?.text||'',nextWord:cueWords[wordIndex+1]?.text||'',
    words:cueWords.map(w=>({...w,state:time>=w.end?'sung':time>=w.start?'active':'upcoming',progress:time>=w.start&&time<w.end?(time-w.start)/(w.end-w.start):0}))
  };
}

export function lyricsPlaybackTime(snapshot, now = Date.now()) {
  const base = Math.max(0, Number(snapshot?.currentTime) || 0);
  const elapsed = snapshot?.playing && snapshot?.publishedAt ? Math.max(0, (now - Number(snapshot.publishedAt)) / 1000) : 0;
  const rate = Math.max(0.5, Math.min(1.5, Number(snapshot?.tempoPercent) / 100 || 1));
  const duration = Math.max(0, Number(snapshot?.duration) || 0);
  const position = base + elapsed * rate;
  return duration ? Math.min(duration, position) : position;
}

export function lyricsForSnapshot(snapshot) {
  const lyrics = snapshot?.lyrics;
  if (snapshot?.displayMode !== 'karaoke' || !lyrics?.enabled || lyrics.status !== 'ready' ||
    String(lyrics.currentId || '') !== String(snapshot.currentId || '') ||
    String(lyrics.mediaUrl || '') !== String(snapshot.mediaUrl || '') || !lyrics.sourceKey) return [];
  return Array.isArray(lyrics.segments) ? lyrics.segments : [];
}

export function lyricsForSelection(value, loadedSelection, currentSelection) {
  return loadedSelection && loadedSelection === currentSelection ? value : { status: 'idle', segments: [] };
}

export function createTimedLyricsController({ request, onChange = () => {}, schedule = setTimeout, unschedule = clearTimeout }) {
  let selection = null;
  let generation = 0;
  let timer = null;
  let value = normalizeTimedLyrics();
  let autoStarted = false;

  const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  const emit = next => { value = normalizeTimedLyrics(next); onChange(value); };
  const isCurrent = (token, selected) => token === generation && selection === selected;
  const url = selected => `/api/player/lyrics/${encodeURIComponent(selected.id)}`;

  async function perform(method = 'GET', force = false) {
    if (!selection) return value;
    clearTimer();
    const selected = selection;
    const token = ++generation;
    try {
      const options = method === 'GET' ? {} : { method, body: JSON.stringify({ language: 'auto', force }) };
      const next = await request(url(selected), options);
      if (!isCurrent(token, selected)) return value;
      emit(next);
      if (method === 'GET' && value.status === 'idle' && selected.autoAnalyze && !autoStarted) {
        autoStarted = true;
        emit({ status: 'preparing' });
        return perform('POST');
      }
      if (BUSY.has(value.status)) timer = schedule(() => { if (isCurrent(token, selected)) void perform(); }, 1000);
    } catch {
      if (isCurrent(token, selected)) emit({ status: 'error' });
    }
    return value;
  }

  return {
    select(next) {
      const id = String(next?.id || '');
      const key = id ? `${id}|${String(next?.source || '')}` : '';
      if (key === (selection?.key || '')) return;
      generation += 1; clearTimer(); autoStarted = false;
      selection = id ? { id, key, autoAnalyze: next.autoAnalyze === true } : null;
      emit({ status: id ? 'preparing' : 'idle' });
      if (selection) void perform();
    },
    start({ force = false } = {}) { autoStarted = true; emit({ status: 'preparing' }); return perform('POST', force); },
    cancel() { autoStarted = true; return perform('DELETE'); },
    replace(next){generation+=1;clearTimer();emit(next);},
    get value() { return value; },
    destroy() { generation += 1; clearTimer(); selection = null; }
  };
}

// Only real supplied word intervals can receive word-level highlighting.
export function renderTimedWords(element,lines){
 if(!element)return;
 const signature=JSON.stringify([lines.displayCurrent||lines.current,lines.words?.map(w=>[w.text,w.state])]);
 if(element.dataset.lyricSignature===signature){const active=element.querySelector?.('.lyric-word-active'),word=lines.words?.find(w=>w.state==='active');if(active?.style?.setProperty&&word)active.style.setProperty('--lyric-progress',`${Math.round(word.progress*100)}%`);return;}element.dataset.lyricSignature=signature;
 if(!lines.words?.length){element.textContent=lines.displayCurrent||lines.current||'';return;}
 element.replaceChildren();for(const word of lines.words){const span=element.ownerDocument.createElement('span');span.textContent=word.text+' ';span.className='lyric-word lyric-word-'+word.state;if(word.state==='active')span.style?.setProperty?.('--lyric-progress',`${Math.round(word.progress*100)}%`);element.append(span);}
}
