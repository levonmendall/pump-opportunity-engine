/** Completed holding-protection receipts from the current process. These
 * diagnostics do not infer completions from publisher polls or old maxima. */
export type CompletedProtectionCyclesReporting={scope:'CURRENT_SOURCE_PROCESS';runId:string;generatedAt:string;observations:number;intervals:number;breaches:number;maxMs:number|null;sumMs:number;firstProtectionCompletedAt:string|null;lastCompletedAt:string|null;intervalBuckets:{le2000:number;le4000:number;over4000:number};recent:{mint:string;at:string;previousAt:string|null;quoteAt:string;gapMs:number|null;breach:boolean}[]};
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z'),LIMIT=16;
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const count=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const duration=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
function need(value:unknown):asserts value {if(!value)throw Error('COMPLETED_PROTECTION_CYCLES_INVALID');}
function exact(value:unknown,keys:string){const row=record(value);need(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(row).sort().join(' ')===keys.split(' ').sort().join(' '));return row;}
function iso(value:unknown,at:number,nullable=false){if(value===null&&nullable)return null;need(count(value)&&value>=INCEPTION&&value<=at&&value<=8640000000000000);return new Date(value).toISOString();}

export function projectCompletedProtectionCycles(value:unknown,runId:string,startedAt:number):CompletedProtectionCyclesReporting|undefined {
 const raw=record(value);if(raw.scope!=='CURRENT_SOURCE_PROCESS')return undefined;
 try{
  need(count(raw.generatedAt)&&raw.generatedAt>=startedAt&&raw.generatedAt<=8640000000000000&&Array.isArray(raw.recent)&&raw.recent.length<=LIMIT);
  const at=raw.generatedAt,buckets=record(raw.intervalBuckets);
  return validateCompletedProtectionCycles({scope:raw.scope,runId,generatedAt:iso(at,at),observations:raw.observations,intervals:raw.intervals,breaches:raw.breaches,maxMs:raw.intervals===0?null:raw.maxMs,sumMs:raw.sumMs,firstProtectionCompletedAt:iso(raw.firstProtectionCompletedAt,at,true),lastCompletedAt:iso(raw.lastCompletedAt,at,true),intervalBuckets:{le2000:buckets.le2000,le4000:buckets.le4000,over4000:buckets.over4000},recent:raw.recent.map((value:unknown)=>{const row=record(value);return {mint:row.mint,at:iso(row.at,at),previousAt:iso(row.previousAt,at,true),quoteAt:iso(row.quoteAt,at),gapMs:row.gapMs,breach:row.breach};})},runId,startedAt);
 }catch{return undefined;}
}

export function validateCompletedProtectionCycles(value:unknown,runId:string,startedAt:number):CompletedProtectionCyclesReporting {
 const r=exact(value,'scope runId generatedAt observations intervals breaches maxMs sumMs firstProtectionCompletedAt lastCompletedAt intervalBuckets recent');
 need(r.scope==='CURRENT_SOURCE_PROCESS'&&r.runId===runId&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(runId)&&count(startedAt)&&startedAt>=INCEPTION);
 // This observation clock is independent of the financial valuation clock.
 const time=(value:unknown,nullable=false):number|null=>{if(value===null&&nullable)return null;const at=typeof value==='string'?Date.parse(value):NaN;need(count(at)&&at>=INCEPTION&&new Date(at).toISOString()===value);return at;};
 const at=time(r.generatedAt)!;need(at>=startedAt);
 for(const key of ['observations','intervals','breaches'])need(count(r[key]));need(duration(r.sumMs));
 need(r.intervals===0?r.maxMs===null&&r.sumMs===0:duration(r.maxMs)&&r.maxMs<=r.sumMs);
 need(r.intervals<=r.observations&&(r.observations===0||r.intervals<r.observations)&&r.breaches<=r.intervals);
 const buckets=exact(r.intervalBuckets,'le2000 le4000 over4000');Object.values(buckets).forEach(value=>need(count(value)));need(buckets.le2000+buckets.le4000+buckets.over4000===r.intervals&&buckets.over4000===r.breaches);
 const first=time(r.firstProtectionCompletedAt,true),last=time(r.lastCompletedAt,true);need(r.observations===0?first===null&&last===null:first!==null&&last!==null&&first>=startedAt&&first<=last&&last<=at);
 need(Array.isArray(r.recent)&&r.recent.length<=LIMIT&&r.recent.length<=r.observations);let priorAt=startedAt;const seen=new Set<string>();
 for(const value of r.recent){const row=exact(value,'mint at previousAt quoteAt gapMs breach');need(typeof row.mint==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint));const completed=time(row.at)!,previous=time(row.previousAt,true),quote=time(row.quoteAt)!;need(completed>=priorAt&&completed<=at&&last!==null&&completed<=last&&quote<=completed&&typeof row.breach==='boolean');priorAt=completed;const key=row.mint+':'+row.at;need(!seen.has(key));seen.add(key);
  if(previous===null)need(row.gapMs===null&&row.breach===false);else need(previous>=startedAt&&previous<=completed&&count(row.gapMs)&&row.gapMs===completed-previous&&row.breach===(row.gapMs>4000));
 }
 need(Buffer.byteLength(JSON.stringify(r))<=8192);return r as CompletedProtectionCyclesReporting;
}
