/** A delayed read must never overwrite a command acknowledgment with an older revision. */
export function mergeGameSnapshots(previous,incoming){const rows=new Map(previous.map(row=>[row.id,row]));for(const row of incoming || [])if(!rows.has(row.id)||row.revision>=rows.get(row.id).revision)rows.set(row.id,row);return [...rows.values()];}
