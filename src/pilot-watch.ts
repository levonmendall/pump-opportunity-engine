/** Lightweight opportunity awareness. This registry never supplies trading
 * evidence, quotes, financial state, or authority to enter a position. */
export type WatchState='DISCOVERED'|'VERIFYING'|'WATCH'|'DEEP_OBSERVATION'|'QUALIFIED'|'ENTRY_PENDING'|'HELD'|'DEFERRED'|'EXPIRED'|'PERMANENTLY_UNSUPPORTED';
export type WatchSeed={signature:string;feedMint?:string;receivedAt:number};
export type WatchHistory={at:number;state:WatchState;reason:string};
export type WatchRow={
  signature:string;feedMint:string|null;mint:string|null;pool:string|null;
  migrationAt:number|null;verifiedAt:number|null;firstSeenAt:number;
  state:WatchState;reason:string;lastActivityAt:number|null;lastActivityEvidence:string|null;
  lastDemotedAt:number|null;deepSince:number|null;deferUntil:number;waitingSince:number;
  promotions:number;repromotions:number;demotions:number;completeWindows:number;
  everHadWindow:boolean;lastWindowAt:number|null;history:WatchHistory[];
};
type Counters={discovered:number;duplicates:number;verified:number;promoted:number;repromoted:number;demoted:number;expired:number;capacityExclusions:number;structuralExclusions:number;completeWindows:number;evicted:number;activityHints:number;promotionWaitTotalMs:number;promotionWaitMaximumMs:number};
export type WatchCheckpoint={schemaVersion:1;rows:WatchRow[];counters:Counters};
type Options={maximumIdentities?:number;maximumDeep:number;now?:()=>number;record:(kind:string,data:unknown)=>void;restored?:unknown};
const STATES:WatchState[]=['DISCOVERED','VERIFYING','WATCH','DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD','DEFERRED','EXPIRED','PERMANENTLY_UNSUPPORTED'];
const MIN_AGE=300000,MAX_AGE=7200000,UNVERIFIED_RETENTION=MAX_AGE+MIN_AGE;
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown,max=180):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
const initialCounters=():Counters=>({discovered:0,duplicates:0,verified:0,promoted:0,repromoted:0,demoted:0,expired:0,capacityExclusions:0,structuralExclusions:0,completeWindows:0,evicted:0,activityHints:0,promotionWaitTotalMs:0,promotionWaitMaximumMs:0});
const deep=(r:WatchRow)=>r.deepSince!==null&&['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(r.state);
const protectedRow=(r:WatchRow)=>deep(r)||r.state==='HELD'||r.state==='ENTRY_PENDING';
const copy=<T>(v:T):T=>structuredClone(v);

export class PilotWatch {
  private readonly maximum:number;private readonly maximumDeep:number;private readonly clock:()=>number;
  private readonly rows=new Map<string,WatchRow>();private counters=initialCounters();
  constructor(private readonly options:Options){
    this.maximum=options.maximumIdentities??150;this.maximumDeep=options.maximumDeep;this.clock=options.now??Date.now;
    need(integer(this.maximum)&&this.maximum>=1&&this.maximum<=512&&integer(this.maximumDeep)&&this.maximumDeep>=1&&this.maximumDeep<=20&&this.maximumDeep<=this.maximum,'PILOT_WATCH_LIMITS');
    if(options.restored!==undefined)this.restore(options.restored);
  }
  private emit(kind:string,data:unknown){this.options.record(kind,data);}
  private at(at=this.clock()){need(integer(at),'PILOT_WATCH_TIME');return at;}
  private row(id:string){return [...this.rows.values()].find(r=>r.mint===id||r.signature===id);}
  private eligible(r:WatchRow,at:number){return !['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)&&r.migrationAt!==null&&r.verifiedAt!==null&&r.mint!==null&&r.pool!==null&&at>=r.migrationAt+MIN_AGE&&at<r.migrationAt+MAX_AGE;}
  private history(r:WatchRow,at:number,state:WatchState,reason:string){r.state=state;r.reason=reason;r.history.push({at,state,reason});if(r.history.length>16)r.history.shift();}
  private expire(at:number){
    for(const r of this.rows.values())if(r.state!=='HELD'&&r.state!=='ENTRY_PENDING'&&r.state!=='EXPIRED'&&r.state!=='PERMANENTLY_UNSUPPORTED'&&at>=(r.migrationAt===null?r.firstSeenAt+UNVERIFIED_RETENTION:r.migrationAt+MAX_AGE)){
      this.history(r,at,'EXPIRED',r.migrationAt===null?'unverified identity retention elapsed; migration time unavailable':'existing entry-age horizon elapsed');r.deepSince=null;this.counters.expired++;this.emit('pilot-watch-expired',{signature:r.signature,mint:r.mint,at,reason:r.reason});
    }
  }
  discover(seed:WatchSeed):WatchRow|null{
    need(text(seed.signature,100)&&(seed.feedMint===undefined||text(seed.feedMint,96))&&integer(seed.receivedAt),'PILOT_WATCH_SEED');const at=this.at();need(seed.receivedAt<=at,'PILOT_WATCH_FUTURE_SEED');
    const old=this.rows.get(seed.signature);if(old){this.counters.duplicates++;return copy(old);}
    this.expire(at);this.counters.discovered++;
    if(this.rows.size>=this.maximum){
      const victim=[...this.rows.values()].filter(r=>!protectedRow(r)).sort((a,b)=>Number(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(a.state))-Number(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(b.state))||a.firstSeenAt-b.firstSeenAt)[0];
      if(!victim){this.counters.capacityExclusions++;this.emit('pilot-watch-capacity-refusal',{at,signature:seed.signature,feedMint:seed.feedMint??null,maximum:this.maximum,reason:'all retained identities protected; discovery still recorded, no deep evidence admitted'});return null;}
      const lostHorizon=!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(victim.state);this.rows.delete(victim.signature);this.counters.evicted++;if(lostHorizon)this.counters.capacityExclusions++;
      this.emit('pilot-watch-evicted',{at,signature:victim.signature,mint:victim.mint,state:victim.state,reason:lostHorizon?'lightweight horizon capacity exceeded; lost awareness explicitly recorded':'expired or structurally unsupported retention reclaimed',lostHorizon});
    }
    const row:WatchRow={signature:seed.signature,feedMint:seed.feedMint??null,mint:null,pool:null,migrationAt:null,verifiedAt:null,firstSeenAt:seed.receivedAt,state:'DISCOVERED',reason:'processed migration hint; base/quote/pool identity and time unverified',lastActivityAt:null,lastActivityEvidence:null,lastDemotedAt:null,deepSince:null,deferUntil:0,waitingSince:seed.receivedAt,promotions:0,repromotions:0,demotions:0,completeWindows:0,everHadWindow:false,lastWindowAt:null,history:[]};
    row.history.push({at:seed.receivedAt,state:row.state,reason:row.reason});this.rows.set(seed.signature,row);this.emit('pilot-watch-discovered',{at,signature:row.signature,feedMint:row.feedMint,verified:false});return copy(row);
  }
  verify(signature:string,input:{mint:string;pool:string;migrationAt:number;verifiedAt:number}):WatchRow{
    need(text(signature,100)&&text(input.mint,96)&&text(input.pool,96)&&integer(input.migrationAt)&&integer(input.verifiedAt)&&input.migrationAt<=input.verifiedAt&&input.verifiedAt<=this.at(),'PILOT_WATCH_VERIFICATION');
    let r=this.rows.get(signature);if(!r){this.discover({signature,feedMint:input.mint,receivedAt:input.verifiedAt});r=this.rows.get(signature);}need(r,'PILOT_WATCH_VERIFY_CAPACITY');
    if(r.verifiedAt!==null){need(r.mint===input.mint&&r.pool===input.pool&&r.migrationAt===input.migrationAt,'PILOT_WATCH_IDENTITY_CONFLICT');return copy(r);}
    const same=[...this.rows.values()].find(other=>other!==r&&other.mint===input.mint);
    if(same){need(same.pool===input.pool&&same.migrationAt===input.migrationAt,'PILOT_WATCH_IDENTITY_CONFLICT');this.rows.delete(signature);this.counters.duplicates++;this.emit('pilot-watch-identity-merged',{at:input.verifiedAt,signature,retainedSignature:same.signature,mint:input.mint});return copy(same);}
    r.mint=input.mint;r.pool=input.pool;r.migrationAt=input.migrationAt;r.verifiedAt=input.verifiedAt;this.counters.verified++;
    this.history(r,input.verifiedAt,'WATCH','canonical migration identity verified; current support and fresh observation still required');this.expire(input.verifiedAt);this.emit('pilot-watch-verified',{signature:r.signature,mint:r.mint,pool:r.pool,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt});return copy(r);
  }
  transition(mint:string,state:WatchState,reason:string,at=this.clock(),options:{deferUntil?:number}={}):WatchRow{
    this.at(at);need(STATES.includes(state)&&text(reason)&&integer(options.deferUntil??0),'PILOT_WATCH_TRANSITION');const r=this.row(mint);need(r,'PILOT_WATCH_UNKNOWN_IDENTITY');
    if(r.state===state&&r.reason===reason&&r.deferUntil===(options.deferUntil??0))return copy(r);
    if(['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD'].includes(state))need(r.mint!==null&&r.pool!==null&&r.verifiedAt!==null,'PILOT_WATCH_UNVERIFIED_PROMOTION');
    if(state==='DEEP_OBSERVATION'&&!deep(r)){
      need(this.eligible(r,at),'PILOT_WATCH_ENTRY_AGE');need([...this.rows.values()].filter(deep).length<this.maximumDeep,'PILOT_WATCH_DEEP_CAPACITY');
      const again=r.promotions>0;r.promotions++;this.counters.promoted++;if(again){r.repromotions++;this.counters.repromoted++;}
      const waitMs=Math.max(0,at-Math.max(r.waitingSince,r.migrationAt!+MIN_AGE,r.verifiedAt!));this.counters.promotionWaitTotalMs+=waitMs;this.counters.promotionWaitMaximumMs=Math.max(this.counters.promotionWaitMaximumMs,waitMs);
      r.deepSince=at;this.emit('pilot-watch-promotion',{mint:r.mint,at,reason,repromotion:again,waitMs,freshFullWindowRequired:true});
    }
    if(deep(r)&&['WATCH','DEFERRED'].includes(state)){r.demotions++;this.counters.demoted++;r.lastDemotedAt=at;r.waitingSince=at;r.deepSince=null;}
    if(!['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(state))r.deepSince=null;
    if(state==='EXPIRED'&&r.state!=='EXPIRED')this.counters.expired++;
    if(state==='PERMANENTLY_UNSUPPORTED'&&r.state!=='PERMANENTLY_UNSUPPORTED')this.counters.structuralExclusions++;
    r.deferUntil=options.deferUntil??0;this.history(r,at,state,reason);this.emit('pilot-watch-transition',{mint:r.mint,signature:r.signature,at,state,reason,deferUntil:r.deferUntil,deepAllocated:deep(r)});return copy(r);
  }
  noteActivity(mint:string,at:number,evidence:string):boolean{
    this.at(at);need(text(evidence,256),'PILOT_WATCH_ACTIVITY_EVIDENCE');const r=this.row(mint);if(!r||r.mint===null||['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state))return false;
    if(r.lastActivityAt!==null&&at<=r.lastActivityAt)return false;r.lastActivityAt=at;r.lastActivityEvidence=evidence;this.counters.activityHints++;
    // This is a scheduling hint only. It never supplies normalized trade fields
    // or clears any defer deadline, audit gap, or incomplete flow window.
    return true;
  }
  noteWindow(mint:string,at:number){
    this.at(at);const r=this.row(mint);need(r&&deep(r)&&r.verifiedAt!==null,'PILOT_WATCH_WINDOW_REQUIRES_DEEP');if(r.lastWindowAt!==null&&at<=r.lastWindowAt)return;
    r.completeWindows++;r.everHadWindow=true;r.lastWindowAt=at;this.counters.completeWindows++;this.emit('pilot-watch-complete-window',{mint:r.mint,at,completeWindows:r.completeWindows,deepSince:r.deepSince});
  }
  next(at:number,excluded:ReadonlySet<string>):WatchRow|null{
    this.at(at);this.expire(at);
    const ready=[...this.rows.values()].filter(r=>r.mint!==null&&!excluded.has(r.mint)&&['WATCH','DEFERRED'].includes(r.state)&&at>=r.deferUntil&&this.eligible(r,at));
    // New evidence receives bounded preference, but a waiting identity older
    // than five minutes goes first so busy hints cannot monopolize re-promotion.
    const rank=(r:WatchRow)=>at-Math.max(r.waitingSince,r.migrationAt!+MIN_AGE,r.verifiedAt!)>=300000?0:r.lastDemotedAt!==null&&(r.lastActivityAt??0)>r.lastDemotedAt?1:2;
    ready.sort((a,b)=>rank(a)-rank(b)||a.waitingSince-b.waitingSince||a.firstSeenAt-b.firstSeenAt||a.signature.localeCompare(b.signature));return ready[0]?copy(ready[0]):null;
  }
  snapshot(at=this.clock()){
    this.at(at);this.expire(at);const rows=[...this.rows.values()],eligible=rows.filter(r=>this.eligible(r,at)&&r.state!=='PERMANENTLY_UNSUPPORTED'),waiting=eligible.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&at>=r.deferUntil),waits=waiting.map(r=>Math.max(0,at-Math.max(r.waitingSince,r.migrationAt!+MIN_AGE,r.verifiedAt!))),covered=eligible.filter(r=>r.everHadWindow);
    return {rows:copy(rows),summary:{...copy(this.counters),known:rows.length,maximumIdentities:this.maximum,watch:rows.filter(r=>['WATCH','DEFERRED'].includes(r.state)).length,unverified:rows.filter(r=>r.verifiedAt===null).length,eligibleKnown:eligible.length,deepActive:rows.filter(deep).length,maximumDeep:this.maximumDeep,queued:waiting.length,waitMs:{mean:waits.length?waits.reduce((a,b)=>a+b,0)/waits.length:0,maximum:waits.length?Math.max(...waits):0},promotionWaitMs:{mean:this.counters.promoted?this.counters.promotionWaitTotalMs/this.counters.promoted:0,maximum:this.counters.promotionWaitMaximumMs},coverage:{denominator:'currently entry-age-eligible verified identities retained in this bounded registry; at least one audited window during this eligibility horizon',eligibleKnown:eligible.length,atLeastOneValidWindow:covered.length,percent:eligible.length?covered.length*100/eligible.length:null,wholeMarketPercent:null},states:Object.fromEntries(STATES.map(s=>[s,rows.filter(r=>r.state===s).length]))}};
  }
  export():WatchCheckpoint{return {schemaVersion:1,rows:copy([...this.rows.values()]),counters:copy(this.counters)};}
  private restore(value:unknown){
    need(value&&typeof value==='object'&&!Array.isArray(value),'PILOT_WATCH_CHECKPOINT');const v=value as WatchCheckpoint;
    need(v.schemaVersion===1&&Array.isArray(v.rows)&&v.rows.length<=this.maximum&&v.counters&&typeof v.counters==='object'&&Object.keys(initialCounters()).every(k=>integer(v.counters[k as keyof Counters])),'PILOT_WATCH_CHECKPOINT');
    this.counters=copy(v.counters);const mints=new Set<string>();for(const r of v.rows){
      need(r&&text(r.signature,100)&&!this.rows.has(r.signature)&&(r.feedMint===null||text(r.feedMint,96))&&(r.mint===null||text(r.mint,96))&&(r.pool===null||text(r.pool,96))&&STATES.includes(r.state)&&text(r.reason)&&integer(r.firstSeenAt)&&integer(r.deferUntil)&&integer(r.waitingSince)&&[r.migrationAt,r.verifiedAt,r.lastActivityAt,r.lastDemotedAt,r.deepSince,r.lastWindowAt].every(n=>n===null||integer(n))&&[r.promotions,r.repromotions,r.demotions,r.completeWindows].every(integer)&&typeof r.everHadWindow==='boolean'&&(r.lastActivityEvidence===null||text(r.lastActivityEvidence,256))&&Array.isArray(r.history)&&r.history.length<=16&&r.history.every(h=>integer(h.at)&&STATES.includes(h.state)&&text(h.reason)),'PILOT_WATCH_CHECKPOINT_ROW');
      need((r.verifiedAt===null)===(r.migrationAt===null)&&(r.verifiedAt===null)===(r.mint===null)&&(r.verifiedAt===null)===(r.pool===null)&&(!r.mint||!mints.has(r.mint)),'PILOT_WATCH_CHECKPOINT_IDENTITY');if(r.mint)mints.add(r.mint);
      if(r.verifiedAt!==null)need(r.migrationAt!<=r.verifiedAt&&r.verifiedAt<=this.clock(),'PILOT_WATCH_CHECKPOINT_TIME');
      const restored=copy(r);if(['DEEP_OBSERVATION','QUALIFIED'].includes(restored.state)){this.history(restored,this.clock(),'DEFERRED','research process restarted; previous flow is unavailable; fresh full window required');restored.deepSince=null;restored.lastDemotedAt=this.clock();restored.waitingSince=this.clock();restored.deferUntil=this.clock();restored.demotions++;this.counters.demoted++;this.emit('pilot-watch-recovery-demotion',{mint:restored.mint,at:this.clock(),priorState:r.state,freshFullWindowRequired:true});}if(restored.state==='ENTRY_PENDING'){restored.deepSince=null;this.emit('pilot-watch-owned-recovery',{mint:restored.mint,at:this.clock(),state:'ENTRY_PENDING',freshFlowUnavailable:true,financialObligationRetained:true});}this.rows.set(r.signature,restored);
    }
    need([...this.rows.values()].filter(deep).length<=this.maximumDeep,'PILOT_WATCH_CHECKPOINT_DEEP_CAPACITY');
  }
}
