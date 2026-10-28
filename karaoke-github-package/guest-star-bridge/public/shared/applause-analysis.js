const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:0;};
export function acousticFrame(samples){let energy=0,peak=0,clipped=0,difference=0;for(let i=0;i<samples.length;i++){const value=samples[i];energy+=value*value;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=.98)clipped++;if(i)difference+=(value-samples[i-1])**2;}const rms=Math.sqrt(energy/Math.max(1,samples.length));return {rms,peak,clippedFraction:clipped/Math.max(1,samples.length),brightness:Math.min(1,difference/Math.max(energy*4,1e-12)),crest:peak/Math.max(rms,1e-8)};}
export function calibrateApplause(frames,{id,deviceId,durationMs}){
 if(frames.length<100||durationMs<3000)throw Error('CALIBRATION_TOO_SHORT');const noise=median(frames.map(f=>f.rms));if(noise<1e-6||noise>.3||frames.some(f=>f.clippedFraction>.01))throw Error('INVALID_AMBIENT_CALIBRATION');return {id,deviceId,durationMs,noiseRms:noise,brightness:median(frames.map(f=>f.brightness)),createdAt:Date.now()};
}
export function evaluateApplause(frames,calibration,{id,durationMs,deviceId}){
 if(!calibration||calibration.deviceId!==deviceId||Date.now()-calibration.createdAt>30*60000)throw Error('CALIBRATION_REQUIRED');
 if(frames.length<100||durationMs<3000||durationMs>15000)throw Error('INVALID_MEASUREMENT_WINDOW');
 const rms=frames.map(f=>f.rms),clippedFraction=frames.reduce((n,f)=>n+f.clippedFraction,0)/frames.length,active=frames.filter(f=>f.rms>calibration.noiseRms*2),snrDb=20*Math.log10(Math.max(median(rms),1e-8)/calibration.noiseRms);
 let onsets=0;for(let i=1;i<frames.length;i++)if(frames[i].rms>Math.max(calibration.noiseRms*2.5,frames[i-1].rms*1.5))onsets++;
 const brightness=median(active.map(f=>f.brightness)),coverage=active.length/frames.length;
 // Confidence is a transparent heuristic, not certified source separation or vocal scoring.
 const confidence=Math.max(0,Math.min(1,(snrDb>6?.25:0)+(brightness>.08?.25:0)+(onsets>=3?.3:0)+(coverage>.25?.2:0)));
 const valid=clippedFraction<.01&&confidence>=.65&&coverage>.2&&onsets>=3&&brightness>.08;
 const score=Math.round(Math.max(0,Math.min(100,snrDb/30*65+coverage*25+Math.min(onsets/15,1)*10))*100)/100;
 return {id,calibrationId:calibration.id,deviceId,method:'ambient-rms-transient-brightness-v1',durationMs,score,valid,confidence,clippedFraction,snrDb,onsets,coverage,brightness,noiseRms:calibration.noiseRms,at:Date.now(),reason:valid?'':clippedFraction>=.01?'CLIPPED_INPUT':'LOW_CONFIDENCE_REPEAT_OR_JURY'};
}
