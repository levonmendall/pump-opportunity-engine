/** Actual completed callbacks only. These bounded current-process aggregates
 * permit interval comparisons without treating dashboard polling as a proof
 * that every intermediate protection cycle completed. No financial authority. */
export class NativeOperatingCycles {
 private previous=new Map<string,{units:string;at:number;quoteAt:number}>();
 private observations=0;private intervals=0;private breaches=0;private maxMs=0;private sumMs=0;
 private buckets={le2000:0,le4000:0,over4000:0};
 private recent:Array<{mint:string;at:number;previousAt:number|null;quoteAt:number;gapMs:number|null;breach:boolean}>=[];
 private firstCompletedAt:number|null=null;private lastCompletedAt:number|null=null;
 private reconciliation={decisions:0,invalid:0,stale:0,maxAgeMs:0,lastUsedAt:null as number|null,lastReconciledAt:null as number|null};
 constructor(readonly startedAt:number,readonly runId:string|null=null){}
 completed(mint:string,units:string,at:number,quoteAt:number){
  if(![at,quoteAt].every(Number.isSafeInteger)||at<this.startedAt||quoteAt>at||at-quoteAt>2000)return false;
  const old=this.previous.get(mint),prior=old?.units===units?old:undefined;
  if(prior&&(at<prior.at||quoteAt<=prior.quoteAt))return false;
  const gapMs=prior?at-prior.at:null,breach=gapMs!==null&&gapMs>4000;
  this.observations++;if(gapMs!==null){this.intervals++;this.sumMs+=gapMs;this.maxMs=Math.max(this.maxMs,gapMs);this.buckets[gapMs<=2000?'le2000':gapMs<=4000?'le4000':'over4000']++;if(breach)this.breaches++;}
  this.firstCompletedAt??=at;this.lastCompletedAt=at;this.previous.set(mint,{units,at,quoteAt});
  this.recent.push({mint,at,previousAt:prior?.at??null,quoteAt,gapMs,breach});if(this.recent.length>16)this.recent.shift();return true;
 }
 reconcileAtDecision(at:number,reconciledAt:number){
  this.reconciliation.decisions++;if(!Number.isSafeInteger(at)||!Number.isSafeInteger(reconciledAt)||reconciledAt<this.startedAt||reconciledAt>at){this.reconciliation.invalid++;return;}
  const age=at-reconciledAt;this.reconciliation.maxAgeMs=Math.max(this.reconciliation.maxAgeMs,age);if(age>2000)this.reconciliation.stale++;
  this.reconciliation.lastUsedAt=at;this.reconciliation.lastReconciledAt=reconciledAt;
 }
 retainInventory(mints:readonly string[]){const current=new Set(mints);for(const mint of this.previous.keys())if(!current.has(mint))this.previous.delete(mint);}
 usage(at:number){return {scope:'CURRENT_SOURCE_PROCESS' as const,runId:this.runId,startedAt:this.startedAt,generatedAt:at,observations:this.observations,intervals:this.intervals,breaches:this.breaches,maxMs:this.maxMs,sumMs:this.sumMs,firstProtectionCompletedAt:this.firstCompletedAt,lastCompletedAt:this.lastCompletedAt,intervalBuckets:{...this.buckets},recent:this.recent.map(row=>({...row})),decisionReconciliation:{...this.reconciliation},meaning:'Consecutive actual usable protection completions for unchanged holding quantities. Initial/replaced holdings have no invented prior completion. Original quote timestamps and decision-time reconciliation remain independent.'};}
}
