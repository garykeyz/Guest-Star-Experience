export function createStereoMeter(root, {label = 'Master L/R'} = {}) {
  const doc = root.ownerDocument;
  root.classList.add('stereo-meter'); root.setAttribute('aria-label', label);
  const rows = ['L','R'].map(side => {
    const row = doc.createElement('div'); row.className='stereo-channel';
    const name = doc.createElement('b'); name.textContent=side;
    const track = doc.createElement('span'); track.className='stereo-track'; track.setAttribute('role','meter');
    track.setAttribute('aria-label',`${label} ${side}`); track.setAttribute('aria-valuemin','-60'); track.setAttribute('aria-valuemax','0');
    const fill = doc.createElement('i'); const peak=doc.createElement('em'); track.append(fill,peak); row.append(name,track); root.append(row);
    return {track,fill,peak,level:0,hold:0,until:0,clipUntil:0};
  });
  let source={rmsL:0,rmsR:0,peakL:0,peakR:0}, received=-Infinity, painted=0, timer=0;
  const db = value => value > 0 ? Math.max(-60,20*Math.log10(value)) : -60;
  const fraction = value => Math.min(1,Math.max(0,(db(value)+60)/60));
  function paint() {
    timer=0;
    if (doc.hidden || !root.isConnected) return;
    const now=performance.now(), dt=Math.min(1,(now-painted)/1000 || .033); painted=now;
    let moving=false;
    rows.forEach((row,index)=>{
      const side=index?'R':'L', fresh=now-received<500;
      const rms=fresh ? Math.max(0,Number(source[`rms${side}`])||0):0;
      const peak=fresh ? Math.max(0,Number(source[`peak${side}`])||0):0;
      row.level=Math.max(rms,row.level*Math.exp(-dt*7));
      if(peak>=row.hold || now>=row.until){row.hold=peak;row.until=now+650;}
      if(peak>=1)row.clipUntil=now+1000;
      row.fill.style.clipPath=`inset(0 ${(1-fraction(row.level))*100}% 0 0)`;
      row.peak.style.transform=`translateX(${fraction(row.hold)*100}%)`;
      row.track.classList.toggle('is-clipping',now<row.clipUntil);
      row.track.setAttribute('aria-valuenow',String(Math.round(db(peak))));
      moving ||= row.level>.001 || row.hold>.001 || now<row.clipUntil;
    });
    if(moving) timer=setTimeout(paint,33);
  }
  function update(value) {source=value||{}; received=performance.now();root.classList.toggle('unavailable',value?.available===false);if(!timer)paint();}
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden){clearTimeout(timer);timer=0;}else if(!timer)paint();});
  return {update,stop(){clearTimeout(timer);timer=0;update({});}};
}
