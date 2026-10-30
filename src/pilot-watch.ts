import {OBSERVATION_AGE_POLICY,entryAgeEligible,observationAgeEligible,observationExpiryAt,observationAgeCohort,observationAgePolicyByVersion,type ObservationAgePolicy,type ObservationAgePolicyVersion} from './observation-age.js';
/** Lightweight opportunity awareness. This registry never supplies trading
 * evidence, quotes, financial state, or authority to enter a position. */
export type WatchState='DISCOVERED'|'VERIFYING'|'WATCH'|'DEEP_OBSERVATION'|'QUALIFIED'|'ENTRY_PENDING'|'HELD'|'DEFERRED'|'EXPIRED'|'PERMANENTLY_UNSUPPORTED';
export type WatchSeed={signature:string;feedMint?:string;receivedAt:number};
export type CapacityDemand={requests:number;windowMs:number;observedAt:number;complete:boolean;source:'confirmed-pool-signatures'|'complete-selected-hints'};
export type CapacityCoverage={status:'AWAITING_CAPACITY'|'PROBE_READY'|'OBSERVING'|'VALID_WINDOW'|'OTHER_UNAVAILABLE';reason:string;lostAt:number;lastDemand:CapacityDemand|null;reassessAt:number;probeAdmissions:number[]};
/** Free starts are caller-verified remaining shared/method capacity AFTER
 * protection, pending actions, current candidates and audit reservations. */
export type CapacityProbeContext={at:number;capacityObservedAt:number;windowMs:number;freeEnrichmentStarts:number;freeSharedStarts:number;globalCooldownUntil:number;protectionPending:boolean};
export type WatchHistory={at:number;state:WatchState;reason:string};
export type TechnicalReevaluationReason='entry-preparation-unavailable'|'entry-quote-unavailable'|'entry-attempt-data-unavailable'|'entry-action-expired';
/** Scheduling metadata only. No flow, financial outcome or entry permission is
 * established by requesting or claiming another fresh-window evaluation. */
export type TechnicalReevaluation={reason:TechnicalReevaluationReason;requestedAt:number;failedWindowEndAt:number;notBefore:number;expiresAt:number;attempts:number;lastClaimedWindowEndAt:number|null;state:'WAITING'|'CLAIMED'|'EXHAUSTED'|'EXPIRED'|'FINISHED'};
export const TECHNICAL_REEVALUATION_POLICY=Object.freeze({version:'bounded-fresh-window-technical-reevaluation-v1',maximumAttempts:3,lifetimeMs:300000,backoffMs:Object.freeze([5000,15000,30000] as const),restartDelayMs:5000});
const TECHNICAL_REEVALUATION_REASONS:readonly TechnicalReevaluationReason[]=['entry-preparation-unavailable','entry-quote-unavailable','entry-attempt-data-unavailable','entry-action-expired'];
export type WatchRow={
  signature:string;feedMint:string|null;mint:string|null;pool:string|null;
  migrationAt:number|null;verifiedAt:number|null;firstSeenAt:number;
  state:WatchState;reason:string;lastActivityAt:number|null;lastActivityEvidence:string|null;
  lastDemotedAt:number|null;deepSince:number|null;deferUntil:number;waitingSince:number;
  promotions:number;repromotions:number;demotions:number;completeWindows:number;
  everHadWindow:boolean;lastWindowAt:number|null;history:WatchHistory[];capacityCoverage?:CapacityCoverage;olderResearch?:{selectedAt:number;activityAt:number;evidence:string};technicalReevaluation?:TechnicalReevaluation;
};
export type WatchIdentityMetadata=Pick<WatchRow,'mint'|'pool'|'signature'|'migrationAt'|'verifiedAt'|'state'>&{olderResearch:boolean};
type Counters={discovered:number;duplicates:number;verified:number;promoted:number;repromoted:number;demoted:number;expired:number;capacityExclusions:number;structuralExclusions:number;completeWindows:number;evicted:number;activityHints:number;promotionWaitTotalMs:number;promotionWaitMaximumMs:number};
export type WatchCheckpoint={schemaVersion:1;observationAgePolicyVersion?:ObservationAgePolicyVersion;rows:WatchRow[];counters:Counters;capacityProbeAdmissions?:Array<{mint:string;at:number}>;entryAgePromotionCount?:number};
type Options={observationAgePolicy?:ObservationAgePolicyVersion;maximumIdentities?:number;maximumOlderResearch?:number;maximumDeep:number;now?:()=>number;record:(kind:string,data:unknown)=>void;restored?:unknown};
const STATES:WatchState[]=['DISCOVERED','VERIFYING','WATCH','DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD','DEFERRED','EXPIRED','PERMANENTLY_UNSUPPORTED'];
const MIN_AGE=300000,MAX_AGE=7200000,UNVERIFIED_RETENTION=MAX_AGE+MIN_AGE;
const AGE_ONLY_EXPIRY_REASONS=new Set(['existing entry-age horizon elapsed','existing observation-age horizon elapsed','existing entry-age eligibility expired','existing observation-age eligibility expired','remaining horizon cannot fit a complete required window']);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown,max=180):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
const initialCounters=():Counters=>({discovered:0,duplicates:0,verified:0,promoted:0,repromoted:0,demoted:0,expired:0,capacityExclusions:0,structuralExclusions:0,completeWindows:0,evicted:0,activityHints:0,promotionWaitTotalMs:0,promotionWaitMaximumMs:0});
const deep=(r:WatchRow)=>r.deepSince!==null&&['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(r.state);
const protectedRow=(r:WatchRow)=>deep(r)||r.state==='HELD'||r.state==='ENTRY_PENDING';
const copy=<T>(v:T):T=>structuredClone(v);

function validDemand(value:unknown):value is CapacityDemand {const d=value as CapacityDemand;return !!d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).sort().join(',')==='complete,observedAt,requests,source,windowMs'&&integer(d.requests)&&d.requests<=10000&&integer(d.windowMs)&&d.windowMs>=1000&&d.windowMs<=60000&&integer(d.observedAt)&&typeof d.complete==='boolean'&&['confirmed-pool-signatures','complete-selected-hints'].includes(d.source);}
/** Necessary admission estimate only. A probe is not a complete flow window or
 * proof of future provider capacity; every physical start still needs its gate. */
export function capacityProbePolicy(demand:CapacityDemand|null,context:CapacityProbeContext){
  need(integer(context.at)&&integer(context.capacityObservedAt)&&integer(context.windowMs)&&context.windowMs>=1000&&context.windowMs<=60000&&integer(context.freeEnrichmentStarts)&&context.freeEnrichmentStarts<=10000&&integer(context.freeSharedStarts)&&context.freeSharedStarts<=10000&&integer(context.globalCooldownUntil)&&typeof context.protectionPending==='boolean'&&(demand===null||validDemand(demand)),'PILOT_WATCH_CAPACITY_CONTEXT');
  const unavailable=(reason:string)=>({kind:'awaiting-capacity' as const,reason,estimatedEnrichmentStarts:null as number|null});
  if(context.protectionPending)return unavailable('existing protection or pending financial work has priority');
  if(context.at<context.globalCooldownUntil)return unavailable('global provider cooldown remains in force');
  if(context.capacityObservedAt>context.at||context.at-context.capacityObservedAt>1000)return unavailable('current shared capacity is not verified');
  if(context.freeSharedStarts<1)return unavailable('no verified shared request capacity for a bounded probe');
  if(demand!==null&&demand.observedAt>context.at)return unavailable('demand information is not available at this timestamp');
  const recent=demand!==null&&demand.observedAt<=context.at&&context.at-demand.observedAt<=30000;
  const estimate=demand&&recent&&demand.complete?Math.ceil(demand.requests*context.windowMs/demand.windowMs):null;
  if(estimate!==null&&estimate<=context.freeEnrichmentStarts&&estimate<=context.freeSharedStarts)return {kind:'deep-readmission-ready' as const,reason:'recent complete demand estimate fits current reserved shared enrichment capacity; fresh observation still required',estimatedEnrichmentStarts:estimate};
  return {kind:'activity-feasibility-probe' as const,reason:estimate===null?'demand is missing, stale or incomplete; one bounded activity measurement only':'observed demand exceeds current enrichment capacity; one bounded activity measurement only',estimatedEnrichmentStarts:estimate};
}

export class PilotWatch {
  readonly observationAgePolicy:ObservationAgePolicy;
  private checkpointObservationAgePolicy:ObservationAgePolicy;
  private readonly maximum:number;private readonly olderMaximum:number;private readonly maximumDeep:number;private readonly clock:()=>number;
  private readonly rows=new Map<string,WatchRow>();private counters=initialCounters();private entryAgePromotionCount=0;private capacityProbeAdmissions:Array<{mint:string;at:number}>=[];
  /** Ephemeral actual-admission checks are never restored as available capacity. */
  private readonly capacityAdmissions=new Map<string,number>();
  constructor(private readonly options:Options){
    this.observationAgePolicy=observationAgePolicyByVersion(options.observationAgePolicy);this.checkpointObservationAgePolicy=this.observationAgePolicy;
    this.maximum=options.maximumIdentities??OBSERVATION_AGE_POLICY.totalWatchCapacity;this.olderMaximum=Math.min(options.maximumOlderResearch??OBSERVATION_AGE_POLICY.olderWatchCapacity,Math.max(0,this.maximum-1));this.maximumDeep=options.maximumDeep;this.clock=options.now??Date.now;
    need(integer(this.maximum)&&this.maximum>=1&&this.maximum<=512&&integer(this.maximumDeep)&&this.maximumDeep>=1&&this.maximumDeep<=20&&this.maximumDeep<=this.maximum&&integer(this.olderMaximum)&&this.olderMaximum<=OBSERVATION_AGE_POLICY.olderWatchCapacity,'PILOT_WATCH_LIMITS');
    if(options.restored!==undefined)this.restore(options.restored);
  }
  private emit(kind:string,data:unknown){this.options.record(kind,data);}
  private at(at=this.clock()){need(integer(at),'PILOT_WATCH_TIME');return at;}
  private row(id:string){for(const r of this.rows.values())if(r.mint===id||r.signature===id)return r;return undefined;}
  private verified(r:WatchRow){return r.migrationAt!==null&&r.verifiedAt!==null&&r.mint!==null&&r.pool!==null;}
  private entryEligible(r:WatchRow,at:number){return !['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)&&this.verified(r)&&entryAgeEligible(r.migrationAt!,at);}
  private observable(r:WatchRow,at:number){return !['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)&&this.verified(r)&&observationAgeEligible(r.migrationAt!,at,r.olderResearch!==undefined,this.observationAgePolicy);}
  private older(r:WatchRow,at:number){return this.verified(r)&&r.olderResearch!==undefined&&at-r.migrationAt!>=MAX_AGE;}
  private olderDeepAvailable(r:WatchRow,at:number){return !this.older(r,at)||[...this.rows.values()].filter(other=>other!==r&&deep(other)&&this.older(other,at)).length<OBSERVATION_AGE_POLICY.maximumOlderDeep;}
  private freshProbe(r:WatchRow,at:number){const c=r.capacityCoverage,d=c?.lastDemand,probe=c?.probeAdmissions.at(-1);return !!d&&d.complete&&d.observedAt<=at&&at-d.observedAt<=30000&&probe!==undefined&&probe<=at&&at-probe<=30000;}
  private refreshProbeReadiness(at:number){
    for(const r of this.rows.values())if(r.capacityCoverage?.status==='PROBE_READY'&&['WATCH','DEFERRED'].includes(r.state)&&!this.freshProbe(r,at)){
      const c=r.capacityCoverage;c.status='AWAITING_CAPACITY';c.reassessAt=Math.max(c.reassessAt,at+5000);this.capacityAdmissions.delete(r.signature);
      this.transition(r.signature,'DEFERRED','capacity demand or readiness aged; fresh resource assessment required',at,{deferUntil:Math.max(r.deferUntil,c.reassessAt)});
      this.emit('pilot-watch-capacity-readiness-expired',{mint:r.mint,at,demandObservedAt:c.lastDemand?.observedAt??null,latestProbeAt:c.probeAdmissions.at(-1)??null,reassessAt:c.reassessAt,financialPermission:false});
    }
  }

  private history(r:WatchRow,at:number,state:WatchState,reason:string){r.state=state;r.reason=reason;r.history.push({at,state,reason});if(r.history.length>16)r.history.shift();}
  private refreshTechnicalReevaluation(r:WatchRow,at:number){
    const t=r.technicalReevaluation;if(t&&['WAITING','CLAIMED'].includes(t.state)&&at>=t.expiresAt){t.state='EXPIRED';this.emit('pilot-watch-technical-reevaluation-expired',{mint:r.mint,at,...copy(t),ordinaryWatchPreserved:true,financialPermission:false});}return t;
  }
  private expire(at:number){
    for(const r of this.rows.values())if(r.state!=='HELD'&&r.state!=='ENTRY_PENDING'&&r.state!=='EXPIRED'&&r.state!=='PERMANENTLY_UNSUPPORTED'&&at>=(r.migrationAt===null?r.firstSeenAt+UNVERIFIED_RETENTION:observationExpiryAt(r.migrationAt,r.olderResearch!==undefined,this.observationAgePolicy))){
      this.history(r,at,'EXPIRED',r.migrationAt===null?'unverified identity retention elapsed; migration time unavailable':'existing observation-age horizon elapsed');r.deepSince=null;this.counters.expired++;this.emit('pilot-watch-expired',{signature:r.signature,mint:r.mint,at,reason:r.reason});
    }
  }
  discover(seed:WatchSeed):WatchRow|null{
    need(text(seed.signature,100)&&(seed.feedMint===undefined||text(seed.feedMint,96))&&integer(seed.receivedAt),'PILOT_WATCH_SEED');const at=this.at();need(seed.receivedAt<=at,'PILOT_WATCH_FUTURE_SEED');
    const old=this.rows.get(seed.signature);if(old){this.counters.duplicates++;return copy(old);}
    this.expire(at);this.counters.discovered++;
    if(this.rows.size>=this.maximum){
      const victim=[...this.rows.values()].filter(r=>!protectedRow(r)).sort((a,b)=>Number(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(a.state))-Number(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(b.state))||Number(a.olderResearch===undefined)-Number(b.olderResearch===undefined)||a.firstSeenAt-b.firstSeenAt)[0];
      if(!victim){this.counters.capacityExclusions++;this.emit('pilot-watch-capacity-refusal',{at,signature:seed.signature,feedMint:seed.feedMint??null,maximum:this.maximum,reason:'all retained identities protected; discovery still recorded, no deep evidence admitted'});return null;}
      const lostHorizon=!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(victim.state);this.rows.delete(victim.signature);this.capacityAdmissions.delete(victim.signature);this.counters.evicted++;if(lostHorizon)this.counters.capacityExclusions++;
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
    if(same){need(same.pool===input.pool&&same.migrationAt===input.migrationAt,'PILOT_WATCH_IDENTITY_CONFLICT');this.rows.delete(signature);this.capacityAdmissions.delete(signature);this.counters.duplicates++;this.emit('pilot-watch-identity-merged',{at:input.verifiedAt,signature,retainedSignature:same.signature,mint:input.mint});return copy(same);}
    r.mint=input.mint;r.pool=input.pool;r.migrationAt=input.migrationAt;r.verifiedAt=input.verifiedAt;this.counters.verified++;
    this.history(r,input.verifiedAt,'WATCH','canonical migration identity verified; current support and fresh observation still required');this.expire(input.verifiedAt);this.emit('pilot-watch-verified',{signature:r.signature,mint:r.mint,pool:r.pool,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt});return copy(r);
  }
  transition(mint:string,state:WatchState,reason:string,at=this.clock(),options:{deferUntil?:number}={}):WatchRow{
    this.at(at);need(STATES.includes(state)&&text(reason)&&integer(options.deferUntil??0),'PILOT_WATCH_TRANSITION');const r=this.row(mint);need(r,'PILOT_WATCH_UNKNOWN_IDENTITY');
    const gated=r.capacityCoverage&&['AWAITING_CAPACITY','PROBE_READY'].includes(r.capacityCoverage.status)&&['WATCH','DEFERRED'].includes(state),requestedState=state;
    if(gated){state='DEFERRED';options={deferUntil:Math.max(r.deferUntil,options.deferUntil??0,r.capacityCoverage!.status==='AWAITING_CAPACITY'?r.capacityCoverage!.reassessAt:0)};this.capacityAdmissions.delete(r.signature);}
    if(r.state===state&&r.reason===reason&&r.deferUntil===(options.deferUntil??0))return copy(r);
    if(['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD'].includes(state))need(r.mint!==null&&r.pool!==null&&r.verifiedAt!==null,'PILOT_WATCH_UNVERIFIED_PROMOTION');
    if(state==='DEEP_OBSERVATION'&&!deep(r)){
      need(this.observable(r,at),'PILOT_WATCH_OBSERVATION_AGE');need(this.olderDeepAvailable(r,at),'PILOT_WATCH_OLDER_DEEP_CAPACITY');need(r.capacityCoverage?.status!=='AWAITING_CAPACITY','PILOT_WATCH_CAPACITY_PROBE_REQUIRED');if(r.capacityCoverage?.status==='PROBE_READY'){const admitted=this.capacityAdmissions.get(r.signature);need(this.freshProbe(r,at)&&admitted!==undefined&&admitted<=at&&at-admitted<=1000,'PILOT_WATCH_CAPACITY_ADMISSION_REQUIRED');}need([...this.rows.values()].filter(deep).length<this.maximumDeep,'PILOT_WATCH_DEEP_CAPACITY');
      const again=r.promotions>0;r.promotions++;this.counters.promoted++;if(again){r.repromotions++;this.counters.repromoted++;}
      const waitMs=Math.max(0,at-Math.max(r.waitingSince,r.migrationAt!+MIN_AGE,r.verifiedAt!)),observationWaitMs=Math.max(0,at-Math.max(r.waitingSince,r.migrationAt!,r.verifiedAt!)),entryEligible=this.entryEligible(r,at);if(entryEligible){this.entryAgePromotionCount++;this.counters.promotionWaitTotalMs+=waitMs;this.counters.promotionWaitMaximumMs=Math.max(this.counters.promotionWaitMaximumMs,waitMs);}
      r.deepSince=at;this.emit('pilot-watch-promotion',{mint:r.mint,at,reason,repromotion:again,waitMs,observationWaitMs,entryEligible,ageCohort:observationAgeCohort(r.migrationAt!,at,r.olderResearch!==undefined,this.observationAgePolicy),freshFullWindowRequired:true});
    }
    if(deep(r)&&['WATCH','DEFERRED'].includes(state)){r.demotions++;this.counters.demoted++;r.lastDemotedAt=at;r.waitingSince=at;r.deepSince=null;}
    if(!['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(state))r.deepSince=null;
    if(state==='EXPIRED'&&r.state!=='EXPIRED')this.counters.expired++;
    if(state==='PERMANENTLY_UNSUPPORTED'&&r.state!=='PERMANENTLY_UNSUPPORTED')this.counters.structuralExclusions++;
    if(r.capacityCoverage){if(state==='DEEP_OBSERVATION')r.capacityCoverage.status='OBSERVING';else if(['WATCH','DEFERRED'].includes(state)&&reason!==r.capacityCoverage.reason&&!['VALID_WINDOW','AWAITING_CAPACITY','PROBE_READY'].includes(r.capacityCoverage.status))r.capacityCoverage.status='OTHER_UNAVAILABLE';}
    this.capacityAdmissions.delete(r.signature);r.deferUntil=options.deferUntil??0;this.history(r,at,state,reason);this.emit('pilot-watch-transition',{mint:r.mint,signature:r.signature,at,state,requestedState,reason,deferUntil:r.deferUntil,deepAllocated:deep(r),capacityStatus:r.capacityCoverage?.status??null});return copy(r);
  }
  /** Only an uninterrupted, caller-verified scope can retain its allocation
   * after an unfilled owned action. Restarted scopes have deepSince=null and
   * must instead retire and warm a new complete window through normal admission. */
  resumeContinuousObservation(mint:string,reason:string,at=this.clock()):WatchRow{
    this.at(at);need(at<=this.clock()&&text(reason),'PILOT_WATCH_CONTINUOUS_OBSERVATION');const r=this.row(mint);
    need(r&&r.state==='ENTRY_PENDING'&&r.deepSince!==null&&r.deepSince<=at&&this.observable(r,at),'PILOT_WATCH_CONTINUOUS_OBSERVATION_REQUIRED');
    return this.transition(mint,'DEEP_OBSERVATION',reason,at);
  }
  requestTechnicalReevaluation(mint:string,input:{reason:TechnicalReevaluationReason;failedWindowEndAt:number},at=this.clock()):boolean{
    this.at(at);need(at<=this.clock()&&input&&TECHNICAL_REEVALUATION_REASONS.includes(input.reason)&&integer(input.failedWindowEndAt)&&input.failedWindowEndAt<=at&&integer(at+TECHNICAL_REEVALUATION_POLICY.lifetimeMs),'PILOT_WATCH_TECHNICAL_REEVALUATION_REQUEST');
    const r=this.row(mint);need(r&&this.verified(r),'PILOT_WATCH_TECHNICAL_REEVALUATION_IDENTITY');
    if(!this.observable(r,at)||r.state==='HELD')return false;
    const prior=this.refreshTechnicalReevaluation(r,at);
    if(prior){
      // A repeated failure never buys a new allowance or renews the episode.
      if(prior.state!=='CLAIMED')return false;
      if(prior.attempts>=TECHNICAL_REEVALUATION_POLICY.maximumAttempts){prior.state='EXHAUSTED';this.emit('pilot-watch-technical-reevaluation-exhausted',{mint:r.mint,at,...copy(prior),ordinaryWatchPreserved:true,financialPermission:false});return false;}
      prior.state='WAITING';prior.reason=input.reason;prior.notBefore=at+TECHNICAL_REEVALUATION_POLICY.backoffMs[prior.attempts]!;
    }else r.technicalReevaluation={reason:input.reason,requestedAt:at,failedWindowEndAt:input.failedWindowEndAt,notBefore:at+TECHNICAL_REEVALUATION_POLICY.backoffMs[0],expiresAt:at+TECHNICAL_REEVALUATION_POLICY.lifetimeMs,attempts:0,lastClaimedWindowEndAt:null,state:'WAITING'};
    this.emit('pilot-watch-technical-reevaluation-requested',{mint:r.mint,at,...copy(r.technicalReevaluation!),freshFullCurrentWindowRequired:true,financialPermission:false});return true;
  }
  technicalReevaluation(mint:string,at=this.clock()):TechnicalReevaluation|null{
    this.at(at);need(at<=this.clock(),'PILOT_WATCH_TECHNICAL_REEVALUATION_TIME');const r=this.row(mint);return r?copy(this.refreshTechnicalReevaluation(r,at)??null):null;
  }
  claimTechnicalReevaluation(mint:string,windowEndAt:number,at=this.clock()):boolean{
    this.at(at);need(at<=this.clock()&&integer(windowEndAt)&&windowEndAt<=at,'PILOT_WATCH_TECHNICAL_REEVALUATION_WINDOW');const r=this.row(mint),t=r&&this.refreshTechnicalReevaluation(r,at);
    if(!r||!t||t.state!=='WAITING'||at<t.notBefore||t.attempts>=TECHNICAL_REEVALUATION_POLICY.maximumAttempts||windowEndAt<=t.failedWindowEndAt||t.lastClaimedWindowEndAt!==null&&windowEndAt<=t.lastClaimedWindowEndAt||['HELD','ENTRY_PENDING'].includes(r.state)||!this.observable(r,at)||at<r.deferUntil||r.capacityCoverage?.status==='AWAITING_CAPACITY')return false;
    t.attempts++;t.lastClaimedWindowEndAt=windowEndAt;t.state='CLAIMED';this.emit('pilot-watch-technical-reevaluation-claimed',{mint:r.mint,at,...copy(t),freshFullCurrentWindowRequired:true,financialPermission:false});return true;
  }
  finishTechnicalReevaluation(mint:string,at=this.clock(),reason='technical reevaluation completed'):boolean{
    this.at(at);need(at<=this.clock()&&text(reason),'PILOT_WATCH_TECHNICAL_REEVALUATION_FINISH');const r=this.row(mint),t=r&&this.refreshTechnicalReevaluation(r,at);if(!r||!t||!['WAITING','CLAIMED'].includes(t.state))return false;
    t.state='FINISHED';this.emit('pilot-watch-technical-reevaluation-finished',{mint:r.mint,at,reason,technicalReevaluation:copy(t),ordinaryWatchPreserved:true,financialPermission:false});return true;
  }
  selectOlderResearch(mint:string,activity:{observedAt:number;evidence:string},at=this.clock()):WatchRow{
    this.at(at);need(activity&&integer(activity.observedAt)&&activity.observedAt<=at&&at-activity.observedAt<=OBSERVATION_AGE_POLICY.olderActivityMaximumAgeMs&&text(activity.evidence,256),'PILOT_WATCH_OLDER_ACTIVITY');this.expire(at);const r=this.row(mint);
    need(r&&this.verified(r)&&at>=r.migrationAt!+MAX_AGE&&at<observationExpiryAt(r.migrationAt!,true,this.observationAgePolicy),'PILOT_WATCH_OLDER_VERIFIED_IDENTITY');
    need(!['HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED'].includes(r.state),'PILOT_WATCH_OLDER_PROTECTED_IDENTITY');
    need(r.state!=='EXPIRED'||AGE_ONLY_EXPIRY_REASONS.has(r.reason),'PILOT_WATCH_OLDER_EXPIRY_CAUSE');
    const existing=[...this.rows.values()].filter(other=>other!==r&&other.olderResearch&&this.observable(other,at));need(existing.length<this.olderMaximum,'PILOT_WATCH_OLDER_CAPACITY');
    const selection=r.olderResearch??{selectedAt:at,activityAt:activity.observedAt,evidence:activity.evidence};r.olderResearch=selection;
    if(r.state==='EXPIRED'){const capacity=r.capacityCoverage;if(capacity&&['AWAITING_CAPACITY','PROBE_READY'].includes(capacity.status)){capacity.status='AWAITING_CAPACITY';capacity.reassessAt=Math.max(capacity.reassessAt,at+5000);this.transition(mint,'DEFERRED',capacity.reason,at,{deferUntil:Math.max(r.deferUntil,capacity.reassessAt)});}else this.transition(mint,'WATCH','selected older observation research; baseline entry age remains excluded',at,{deferUntil:Math.max(r.deferUntil,at)});}
    this.noteActivity(mint,activity.observedAt,activity.evidence);this.emit('pilot-watch-older-research-selected',{mint:r.mint,at,selection:copy(selection),entryEligible:false,activityHintOnly:true,freshFullWindowRequired:true});return copy(r);
  }
  /** Technical loss, never a predictive rejection. Short reassessment replaces
   * the old escalating full-read cooldown; this does not itself retry anything. */
  deferCapacity(mint:string,reason:string,demand:CapacityDemand|null,at=this.clock()):WatchRow{
    this.at(at);need(text(reason)&&(demand===null||validDemand(demand)&&demand.observedAt<=at),'PILOT_WATCH_CAPACITY_DEMAND');const r=this.row(mint);need(r&&r.mint!==null&&r.verifiedAt!==null,'PILOT_WATCH_CAPACITY_VERIFIED_IDENTITY');
    need(!['HELD','ENTRY_PENDING','EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state),'PILOT_WATCH_CAPACITY_PROTECTED_IDENTITY');
    const previous=r.capacityCoverage,probeAdmissions=(previous?.probeAdmissions??[]).filter(t=>t>at-60000),lastDemand=demand??previous?.lastDemand??null;
    this.transition(mint,'DEFERRED',reason,at,{deferUntil:at+5000});r.capacityCoverage={status:'AWAITING_CAPACITY',reason,lostAt:at,lastDemand,reassessAt:at+5000,probeAdmissions};
    this.emit('pilot-watch-capacity-deferred',{mint:r.mint,at,coverage:copy(r.capacityCoverage),awarenessRetained:true,predictiveAssessment:'unavailable; technical gap',freshFullWindowRequired:true});return copy(r);
  }
  recordCapacityDemand(mint:string,demand:CapacityDemand,at=this.clock()):WatchRow{
    this.at(at);need(validDemand(demand)&&demand.observedAt<=at,'PILOT_WATCH_CAPACITY_DEMAND');const r=this.row(mint);need(r?.capacityCoverage,'PILOT_WATCH_CAPACITY_IDENTITY');
    need(r.capacityCoverage.lastDemand===null||demand.observedAt>=r.capacityCoverage.lastDemand.observedAt,'PILOT_WATCH_CAPACITY_DEMAND_REGRESSION');r.capacityCoverage.lastDemand=copy(demand);
    this.emit('pilot-watch-capacity-demand',{mint:r.mint,at,demand:copy(demand),meaning:'resource estimate only; no strategy features, qualification or window completeness supplied'});return copy(r);
  }
  reassessCapacity(context:CapacityProbeContext,excluded:ReadonlySet<string>=new Set()){
    const at=this.at(context.at);this.expire(at);this.refreshProbeReadiness(at);capacityProbePolicy(null,context);
    const active=[...this.rows.values()].filter(r=>r.capacityCoverage?.status==='PROBE_READY'&&this.freshProbe(r,at)&&at>=r.deferUntil&&['WATCH','DEFERRED'].includes(r.state)&&this.observable(r,at)&&this.olderDeepAvailable(r,at)&&!excluded.has(r.mint??''));if(active.length)return null;
    this.capacityProbeAdmissions=this.capacityProbeAdmissions.filter(t=>t.at>at-60000);if(this.capacityProbeAdmissions.filter(t=>t.at>at-10000).length>=2||this.capacityProbeAdmissions.length>=12||(this.capacityProbeAdmissions.at(-1)?.at??0)>at)return null;
    const ready=[...this.rows.values()].filter(r=>r.mint!==null&&!excluded.has(r.mint)&&r.state==='DEFERRED'&&this.observable(r,at)&&this.olderDeepAvailable(r,at)&&r.capacityCoverage?.status==='AWAITING_CAPACITY'&&at>=r.deferUntil&&at>=r.capacityCoverage.reassessAt&&(r.capacityCoverage.probeAdmissions.filter(t=>t>at-60000).length<2)&&this.capacityProbeAdmissions.filter(t=>t.mint===r.mint).length<2);
    ready.sort((a,b)=>{const aa=a.lastActivityAt!==null&&a.lastActivityAt>(a.lastDemotedAt??0),bb=b.lastActivityAt!==null&&b.lastActivityAt>(b.lastDemotedAt??0);return Number(bb)-Number(aa)||(a.capacityCoverage!.probeAdmissions.at(-1)??0)-(b.capacityCoverage!.probeAdmissions.at(-1)??0)||a.waitingSince-b.waitingSince||a.signature.localeCompare(b.signature);});
    for(const r of ready){const c=r.capacityCoverage!,decision=capacityProbePolicy(c.lastDemand,context);if(decision.kind==='awaiting-capacity')continue;
      c.probeAdmissions=[...c.probeAdmissions.filter(t=>t>at-60000),at];this.capacityProbeAdmissions.push({mint:r.mint!,at});c.reassessAt=at+5000;
      if(decision.kind==='deep-readmission-ready'){c.status='PROBE_READY';r.deferUntil=at;}
      this.emit('pilot-watch-capacity-reassessment',{mint:r.mint,at,...decision,capacityObservedAt:context.capacityObservedAt,demand:copy(c.lastDemand),probeAdmissionOnly:true,requestStarted:false,freshFullWindowRequired:true});return {kind:decision.kind,row:copy(r),reason:decision.reason,estimatedEnrichmentStarts:decision.estimatedEnrichmentStarts};
    }return null;
  }
  /** Call immediately before DEEP_OBSERVATION after preparation completes.
   * Resource readiness never becomes financial permission or flow evidence. */
  admitCapacity(mint:string,context:CapacityProbeContext){
    const at=this.at(context.at);this.expire(at);this.refreshProbeReadiness(at);const r=this.row(mint);need(r&&this.verified(r),'PILOT_WATCH_CAPACITY_VERIFIED_IDENTITY');
    if(!['WATCH','DEFERRED'].includes(r.state)){this.capacityAdmissions.delete(r.signature);this.emit('pilot-watch-capacity-admission',{mint:r.mint,at,allowed:false,reason:'current watch state is owned, terminal or already observing; capacity admission cannot change it',state:r.state,financialPermission:false});return {allowed:false,row:copy(r),reason:'current watch state is owned, terminal or already observing; capacity admission cannot change it'};}
    const c=r.capacityCoverage;
    const decision=capacityProbePolicy(c?.lastDemand??null,context);
    if(!c||!['AWAITING_CAPACITY','PROBE_READY'].includes(c.status))return {allowed:true,row:copy(r),reason:'no unresolved capacity gate; normal admission checks still required'};
    const allowed=c.status==='PROBE_READY'&&this.freshProbe(r,at)&&decision.kind==='deep-readmission-ready'&&at>=r.deferUntil&&this.observable(r,at)&&this.olderDeepAvailable(r,at);
    const reason=allowed?'fresh complete demand fits current reserved capacity':c.status==='AWAITING_CAPACITY'?'explicit resource reassessment/probe remains required':at<r.deferUntil?'candidate defer remains in force':!this.observable(r,at)?'observation age/state unavailable':!this.olderDeepAvailable(r,at)?'older observation slot remains occupied':decision.reason;
    if(allowed)this.capacityAdmissions.set(r.signature,at);else{this.capacityAdmissions.delete(r.signature);if(c.status==='PROBE_READY'){c.status='AWAITING_CAPACITY';c.reassessAt=Math.max(c.reassessAt,at+5000,context.globalCooldownUntil);this.transition(r.signature,'DEFERRED',reason,at,{deferUntil:Math.max(r.deferUntil,c.reassessAt)});}}
    this.emit('pilot-watch-capacity-admission',{mint:r.mint,at,allowed,capacityObservedAt:context.capacityObservedAt,reason,financialPermission:false});
    return {allowed,row:copy(r),reason};
  }
  deferVerification(signature:string,reason:string,at=this.clock()):WatchRow{
    this.at(at);need(text(signature,100)&&text(reason),'PILOT_WATCH_VERIFICATION_DEFERRAL');this.expire(at);
    // Verification retries belong to an exact transaction hint, never to its
    // provisional mint role. A new signature for that mint remains independent.
    const r=this.rows.get(signature);need(r,'PILOT_WATCH_UNKNOWN_IDENTITY');
    if(r.verifiedAt!==null||['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state))return copy(r);
    const saturated=(value:string)=>value.includes('PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN');
    const repeated=saturated(reason)&&r.history.some(h=>h.state==='DEFERRED'&&saturated(h.reason));
    const delayMs=saturated(reason)?repeated?900000:300000:60000;
    const deferUntil=Math.max(r.deferUntil,at+delayMs);need(integer(deferUntil),'PILOT_WATCH_VERIFICATION_DEFERRAL');
    const result=this.transition(signature,'DEFERRED',reason,at,{deferUntil});
    this.emit('pilot-watch-verification-deferred',{signature,at,reason,delayMs,deferUntil,repeatedSaturatedOrigin:repeated,scope:'exact unverified transaction signature; awareness retained'});
    return result;
  }
  noteActivity(mint:string,at:number,evidence:string):boolean{
    this.at(at);need(at<=this.clock(),'PILOT_WATCH_ACTIVITY_FUTURE');need(text(evidence,256),'PILOT_WATCH_ACTIVITY_EVIDENCE');this.expire(at);const r=this.row(mint);if(!r||r.mint===null||r.state==='PERMANENTLY_UNSUPPORTED')return false;
    if(r.state==='EXPIRED'&&!(this.verified(r)&&AGE_ONLY_EXPIRY_REASONS.has(r.reason)&&at>=r.migrationAt!+MAX_AGE&&at<observationExpiryAt(r.migrationAt!,true,this.observationAgePolicy)))return false;
    if(r.lastActivityAt!==null&&at<=r.lastActivityAt)return false;r.lastActivityAt=at;r.lastActivityEvidence=evidence;this.counters.activityHints++;this.emit('pilot-watch-activity',{mint:r.mint,at,evidence,hintOnly:true,meaning:'allocation hint only; no normalized trade fields or qualification supplied'});
    // This is a scheduling hint only. It never supplies normalized trade fields
    // or clears any defer deadline, audit gap, or incomplete flow window.
    return true;
  }
  noteWindow(mint:string,at:number){
    this.at(at);const r=this.row(mint);need(r&&deep(r)&&r.verifiedAt!==null,'PILOT_WATCH_WINDOW_REQUIRES_DEEP');if(r.lastWindowAt!==null&&at<=r.lastWindowAt)return;
    if(r.capacityCoverage)r.capacityCoverage.status='VALID_WINDOW';r.completeWindows++;r.everHadWindow=true;r.lastWindowAt=at;this.counters.completeWindows++;this.emit('pilot-watch-complete-window',{mint:r.mint,at,completeWindows:r.completeWindows,deepSince:r.deepSince,entryEligible:this.entryEligible(r,at),ageCohort:observationAgeCohort(r.migrationAt!,at,r.olderResearch!==undefined,this.observationAgePolicy)});
  }
  next(at:number,excluded:ReadonlySet<string>):WatchRow|null{
    this.at(at);this.expire(at);this.refreshProbeReadiness(at);
    const ready=[...this.rows.values()].filter(r=>r.mint!==null&&!excluded.has(r.mint)&&['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status!=='AWAITING_CAPACITY'&&at>=r.deferUntil&&this.observable(r,at)&&this.olderDeepAvailable(r,at));
    const technical=ready.filter(r=>{const t=this.refreshTechnicalReevaluation(r,at);return t?.state==='WAITING'&&at>=t.notBefore;});
    technical.sort((a,b)=>a.technicalReevaluation!.notBefore-b.technicalReevaluation!.notBefore||a.technicalReevaluation!.requestedAt-b.technicalReevaluation!.requestedAt||a.signature.localeCompare(b.signature));if(technical[0])return copy(technical[0]);
    // Allocation only: new post-demotion activity and never-deep identities
    // precede inactive revisits. Four durable promotion phases give fresh work
    // one guaranteed turn and inactive revisits at most one when both wait;
    // the remaining turns prefer newly active identities. No flow is inferred.
    const active=ready.filter(r=>r.promotions>0&&r.lastDemotedAt!==null&&r.lastActivityAt!==null&&r.lastActivityAt>r.lastDemotedAt&&r.lastActivityAt<=at&&at-r.lastActivityAt<=60000),activeIds=new Set(active.map(r=>r.signature));
    const fresh=ready.filter(r=>r.promotions===0),inactive=ready.filter(r=>r.promotions>0&&!activeIds.has(r.signature)),phase=this.counters.promoted%4;
    const order=phase===3?[inactive,active,fresh]:phase===1?[fresh,active,inactive]:[active,fresh,inactive];
    const selected=order.find(rows=>rows.length)??[];selected.sort((a,b)=>a.waitingSince-b.waitingSince||a.firstSeenAt-b.firstSeenAt||a.signature.localeCompare(b.signature));return selected[0]?copy(selected[0]):null;
  }
  /** Same expiry/readiness semantics as snapshot, without cloning unrelated
   * identities or calculating reporting summaries. No flow or financial data. */
  lookupIdentity(id:string,at=this.clock()):WatchRow|undefined{
    this.at(at);this.expire(at);this.refreshProbeReadiness(at);const r=this.row(id);return r?copy(r):undefined;
  }
  /** Fresh bounded allocation metadata only. All fields are primitive copies;
   * history, capacity details and mutable older-selection evidence stay private. */
  listIdentities(at=this.clock()):WatchIdentityMetadata[]{
    this.at(at);this.expire(at);this.refreshProbeReadiness(at);
    return [...this.rows.values()].map(r=>({mint:r.mint,pool:r.pool,signature:r.signature,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt,state:r.state,olderResearch:r.olderResearch!==undefined}));
  }
  snapshot(at=this.clock(),strategy:'baseline'|'adaptive-momentum-v2'='baseline'){
    this.at(at);this.expire(at);this.refreshProbeReadiness(at);const rows=[...this.rows.values()],baselineEligible=rows.filter(r=>this.entryEligible(r,at)),observable=rows.filter(r=>this.observable(r,at)),adaptive=strategy==='adaptive-momentum-v2',eligible=adaptive?observable:baselineEligible,waiting=eligible.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status!=='AWAITING_CAPACITY'&&at>=r.deferUntil),waits=waiting.map(r=>Math.max(0,at-Math.max(r.waitingSince,r.migrationAt!+(adaptive?0:MIN_AGE),r.verifiedAt!))),covered=eligible.filter(r=>r.everHadWindow&&r.lastWindowAt!==null&&r.lastWindowAt<=at&&(adaptive?observationAgeEligible(r.migrationAt!,r.lastWindowAt,r.olderResearch!==undefined,this.observationAgePolicy):entryAgeEligible(r.migrationAt!,r.lastWindowAt)));
    return {rows:copy(rows),summary:{observationAgePolicy:this.observationAgePolicy,...copy(this.counters),known:rows.length,maximumIdentities:this.maximum,maximumOlderResearchIdentities:this.olderMaximum,minimumPrimaryIdentityCapacity:this.maximum-this.olderMaximum,observationEligibleKnown:observable.length,observationCapacityAwaiting:observable.filter(r=>r.state==='DEFERRED'&&r.capacityCoverage?.status==='AWAITING_CAPACITY').length,observationCapacityProbeReady:observable.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status==='PROBE_READY').length,observationQueued:observable.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status!=='AWAITING_CAPACITY'&&at>=r.deferUntil&&this.olderDeepAvailable(r,at)).length,ageCohorts:{preEntry:observable.filter(r=>observationAgeCohort(r.migrationAt!,at,r.olderResearch!==undefined,this.observationAgePolicy)==='pre-entry').length,entryEligible:baselineEligible.length,olderSelected:observable.filter(r=>this.older(r,at)).length},watch:rows.filter(r=>['WATCH','DEFERRED'].includes(r.state)).length,capacityAwaiting:eligible.filter(r=>r.state==='DEFERRED'&&r.capacityCoverage?.status==='AWAITING_CAPACITY').length,capacityProbeReady:eligible.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status==='PROBE_READY').length,unverified:rows.filter(r=>r.verifiedAt===null).length,eligibleKnown:eligible.length,deepActive:rows.filter(deep).length,maximumDeep:this.maximumDeep,queued:waiting.length,waitMs:{mean:waits.length?waits.reduce((a,b)=>a+b,0)/waits.length:0,maximum:waits.length?Math.max(...waits):0},promotionWaitMs:{mean:this.entryAgePromotionCount?this.counters.promotionWaitTotalMs/this.entryAgePromotionCount:0,maximum:this.counters.promotionWaitMaximumMs,entryAgePromotions:this.entryAgePromotionCount},coverage:{denominator:adaptive?'currently observable verified identities retained for AdaptiveMomentumV2, including early and selected older cohorts; at least one audited window during the observation horizon':'currently entry-age-eligible verified identities retained in this bounded registry; at least one audited window during this eligibility horizon',eligibleKnown:eligible.length,atLeastOneValidWindow:covered.length,percent:eligible.length?covered.length*100/eligible.length:null,wholeMarketPercent:null},states:Object.fromEntries(STATES.map(s=>[s,rows.filter(r=>r.state===s).length]))}};
  }
  export():WatchCheckpoint{return {schemaVersion:1,...(this.checkpointObservationAgePolicy!==OBSERVATION_AGE_POLICY?{observationAgePolicyVersion:this.checkpointObservationAgePolicy.version}:{}),rows:copy([...this.rows.values()]),counters:copy(this.counters),capacityProbeAdmissions:copy(this.capacityProbeAdmissions),entryAgePromotionCount:this.entryAgePromotionCount};}
  private restore(value:unknown){
    need(value&&typeof value==='object'&&!Array.isArray(value),'PILOT_WATCH_CHECKPOINT');const v=value as WatchCheckpoint;
    const checkpointPolicy=observationAgePolicyByVersion(v.observationAgePolicyVersion);
    // Preserve selection provenance on another checkpoint even when the active
    // policy is narrower; otherwise a second resume could reject owned records.
    if(checkpointPolicy.selectedOlderMaximumAgeMs>this.checkpointObservationAgePolicy.selectedOlderMaximumAgeMs)this.checkpointObservationAgePolicy=checkpointPolicy;
    if(checkpointPolicy!==this.observationAgePolicy)this.emit('pilot-watch-observation-policy-transition',{at:this.clock(),checkpointSelectionPolicy:checkpointPolicy.version,current:this.observationAgePolicy.version,freshFullWindowRequired:true,entryPermission:false,selectedCohortBiased:true});
    need(v.schemaVersion===1&&Array.isArray(v.rows)&&v.rows.length<=this.maximum&&v.counters&&typeof v.counters==='object'&&Object.keys(initialCounters()).every(k=>integer(v.counters[k as keyof Counters])),'PILOT_WATCH_CHECKPOINT');
    this.counters=copy(v.counters);const mints=new Set<string>();for(const r of v.rows){
      need(r&&text(r.signature,100)&&!this.rows.has(r.signature)&&(r.feedMint===null||text(r.feedMint,96))&&(r.mint===null||text(r.mint,96))&&(r.pool===null||text(r.pool,96))&&STATES.includes(r.state)&&text(r.reason)&&integer(r.firstSeenAt)&&integer(r.deferUntil)&&integer(r.waitingSince)&&[r.migrationAt,r.verifiedAt,r.lastActivityAt,r.lastDemotedAt,r.deepSince,r.lastWindowAt].every(n=>n===null||integer(n))&&[r.promotions,r.repromotions,r.demotions,r.completeWindows].every(integer)&&typeof r.everHadWindow==='boolean'&&(r.lastActivityEvidence===null||text(r.lastActivityEvidence,256))&&Array.isArray(r.history)&&r.history.length<=16&&r.history.every(h=>integer(h.at)&&STATES.includes(h.state)&&text(h.reason)),'PILOT_WATCH_CHECKPOINT_ROW');
      if(r.olderResearch!==undefined){const o=r.olderResearch;need(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')==='activityAt,evidence,selectedAt'&&integer(o.selectedAt)&&integer(o.activityAt)&&o.activityAt<=o.selectedAt&&o.selectedAt-o.activityAt<=OBSERVATION_AGE_POLICY.olderActivityMaximumAgeMs&&text(o.evidence,256)&&r.migrationAt!==null&&o.selectedAt>=r.migrationAt+MAX_AGE&&o.selectedAt<observationExpiryAt(r.migrationAt,true,checkpointPolicy)&&o.selectedAt<=this.clock(),'PILOT_WATCH_CHECKPOINT_OLDER_RESEARCH');}
      if(r.capacityCoverage!==undefined){const c=r.capacityCoverage;need(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')==='lastDemand,lostAt,probeAdmissions,reason,reassessAt,status'&&['AWAITING_CAPACITY','PROBE_READY','OBSERVING','VALID_WINDOW','OTHER_UNAVAILABLE'].includes(c.status)&&text(c.reason)&&integer(c.lostAt)&&integer(c.reassessAt)&&c.reassessAt>=c.lostAt&&(c.lastDemand===null||validDemand(c.lastDemand)&&c.lastDemand.observedAt<=this.clock())&&Array.isArray(c.probeAdmissions)&&c.probeAdmissions.length<=2&&c.probeAdmissions.every((at,i)=>integer(at)&&at<=this.clock()&&(i===0||at>c.probeAdmissions[i-1]!))&&r.verifiedAt!==null,'PILOT_WATCH_CHECKPOINT_CAPACITY');}
      if(r.technicalReevaluation!==undefined){const t=r.technicalReevaluation;need(t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).sort().join(',')==='attempts,expiresAt,failedWindowEndAt,lastClaimedWindowEndAt,notBefore,reason,requestedAt,state'&&TECHNICAL_REEVALUATION_REASONS.includes(t.reason)&&integer(t.requestedAt)&&r.verifiedAt!==null&&t.requestedAt>=r.verifiedAt&&t.requestedAt<=this.clock()&&integer(t.failedWindowEndAt)&&t.failedWindowEndAt<=t.requestedAt&&integer(t.notBefore)&&t.notBefore>=t.requestedAt+TECHNICAL_REEVALUATION_POLICY.backoffMs[0]&&integer(t.expiresAt)&&t.expiresAt===t.requestedAt+TECHNICAL_REEVALUATION_POLICY.lifetimeMs&&integer(t.attempts)&&t.attempts<=TECHNICAL_REEVALUATION_POLICY.maximumAttempts&&['WAITING','CLAIMED','EXHAUSTED','EXPIRED','FINISHED'].includes(t.state)&&(t.attempts===0?t.lastClaimedWindowEndAt===null:integer(t.lastClaimedWindowEndAt)&&t.lastClaimedWindowEndAt>t.failedWindowEndAt&&t.lastClaimedWindowEndAt<=this.clock())&&(t.state!=='CLAIMED'||t.attempts>0)&&(t.state!=='EXHAUSTED'||t.attempts===TECHNICAL_REEVALUATION_POLICY.maximumAttempts)&&(t.state!=='WAITING'||t.attempts<TECHNICAL_REEVALUATION_POLICY.maximumAttempts),'PILOT_WATCH_CHECKPOINT_TECHNICAL_REEVALUATION');}
      need((r.verifiedAt===null)===(r.migrationAt===null)&&(r.verifiedAt===null)===(r.mint===null)&&(r.verifiedAt===null)===(r.pool===null)&&(!r.mint||!mints.has(r.mint)),'PILOT_WATCH_CHECKPOINT_IDENTITY');if(r.mint)mints.add(r.mint);
      if(r.verifiedAt!==null)need(r.migrationAt!<=r.verifiedAt&&r.verifiedAt<=this.clock(),'PILOT_WATCH_CHECKPOINT_TIME');
      const restored=copy(r);if(['DEEP_OBSERVATION','QUALIFIED'].includes(restored.state)){this.history(restored,this.clock(),'DEFERRED','research process restarted; previous flow is unavailable; fresh full window required');restored.deepSince=null;restored.lastDemotedAt=this.clock();restored.waitingSince=this.clock();restored.deferUntil=this.clock();if(restored.capacityCoverage){restored.capacityCoverage.status='AWAITING_CAPACITY';restored.capacityCoverage.reason=restored.reason;restored.capacityCoverage.reassessAt=this.clock()+5000;}restored.demotions++;this.counters.demoted++;this.emit('pilot-watch-recovery-demotion',{mint:restored.mint,at:this.clock(),priorState:r.state,freshFullWindowRequired:true});}if(restored.state==='ENTRY_PENDING'){restored.deepSince=null;this.emit('pilot-watch-owned-recovery',{mint:restored.mint,at:this.clock(),state:'ENTRY_PENDING',freshFlowUnavailable:true,financialObligationRetained:true});}
      const technical=this.refreshTechnicalReevaluation(restored,this.clock());if(technical?.state==='CLAIMED'){technical.state=technical.attempts>=TECHNICAL_REEVALUATION_POLICY.maximumAttempts?'EXHAUSTED':'WAITING';technical.notBefore=Math.max(technical.notBefore,this.clock()+TECHNICAL_REEVALUATION_POLICY.restartDelayMs);this.emit('pilot-watch-technical-reevaluation-recovered',{mint:restored.mint,at:this.clock(),...copy(technical),claimConsumedBeforeRestart:true,newerWindowRequired:true,financialOutcomeUnknown:true,financialPermission:false});}
      // Older versions could erase a technical resource gate merely by changing
      // its WATCH/DEFERRED reason. No valid replacement window was established.
      if(['WATCH','DEFERRED'].includes(restored.state)&&restored.capacityCoverage?.status==='OTHER_UNAVAILABLE'){const c=restored.capacityCoverage;c.status='AWAITING_CAPACITY';c.reassessAt=Math.max(c.reassessAt,this.clock()+5000);restored.deferUntil=Math.max(restored.deferUntil,c.reassessAt);this.history(restored,this.clock(),'DEFERRED','restored technical gap requires current resource reassessment');this.emit('pilot-watch-capacity-gate-recovered',{mint:restored.mint,at:this.clock(),priorStatus:r.capacityCoverage!.status,priorReason:r.reason,currentReason:restored.reason,freshFullWindowRequired:true});}
      this.rows.set(r.signature,restored);
    }
    // Global probe admissions outlive individual watch rows. Eviction cannot
    // refund an admission; old checkpoints conservatively inherit row evidence.
    if(v.capacityProbeAdmissions!==undefined)need(Array.isArray(v.capacityProbeAdmissions)&&v.capacityProbeAdmissions.length<=12&&v.capacityProbeAdmissions.every((entry,i)=>entry&&typeof entry==='object'&&Object.keys(entry).sort().join(',')==='at,mint'&&text(entry.mint,96)&&integer(entry.at)&&entry.at<=this.clock()&&(i===0||entry.at>=v.capacityProbeAdmissions![i-1]!.at)),'PILOT_WATCH_CHECKPOINT_GLOBAL_CAPACITY');
    this.capacityProbeAdmissions=copy(v.capacityProbeAdmissions??[...this.rows.values()].flatMap(r=>(r.capacityCoverage?.probeAdmissions??[]).map(at=>({mint:r.mint!,at}))).filter(entry=>entry.at>this.clock()-60000).sort((a,b)=>a.at-b.at).slice(-12));
    need(v.entryAgePromotionCount===undefined||integer(v.entryAgePromotionCount)&&v.entryAgePromotionCount<=this.counters.promoted,'PILOT_WATCH_CHECKPOINT_ENTRY_PROMOTIONS');this.entryAgePromotionCount=v.entryAgePromotionCount??this.counters.promoted;
    need([...this.rows.values()].filter(r=>r.olderResearch&&observationAgeEligible(r.migrationAt!,this.clock(),true,this.observationAgePolicy)&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)).length<=this.olderMaximum,'PILOT_WATCH_CHECKPOINT_OLDER_CAPACITY');
    need([...this.rows.values()].filter(deep).length<=this.maximumDeep,'PILOT_WATCH_CHECKPOINT_DEEP_CAPACITY');
  }
}
