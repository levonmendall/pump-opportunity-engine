import {randomUUID} from 'node:crypto';
import type {MarketRegistry,MarketEvidence} from './market-registry.js';
import {canonicalObservationPool,assertNativeCurrentPoolIdentityProof,type NativeCurrentPoolIdentityProof} from './native-observation-identity.js';
import {TOKEN_AGE_POLICY} from './token-age-policy.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY,OBSERVATION_AGE_POLICY,entryAgeEligible,observationAgeEligible,observationExpiryAt,observationAgeCohort,observationAgePolicyByVersion,type ObservationAgePolicy,type ObservationAgePolicyVersion} from './observation-age.js';
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
export const TECHNICAL_REEVALUATION_POLICY=Object.freeze({version:'next-fresh-window-technical-reevaluation-v2',maximumAttempts:3,lifetimeMs:300000,backoffMs:Object.freeze([0,0,0] as const),restartDelayMs:0});
const TECHNICAL_REEVALUATION_REASONS:readonly TechnicalReevaluationReason[]=['entry-preparation-unavailable','entry-quote-unavailable','entry-attempt-data-unavailable','entry-action-expired'];
export type WatchReobservation={kind:'economic-rejection'|'technical-unavailable';decisionAt:number;windowEndAt:number|null;evidence:string;minimumEconomicChangeLamports:string|null;baseline:MarketEvidence|null;ready:{at:number;reason:string;evidence:string}|null;relevantEvidence?:{kind:'audited-flow'|'pool-reserves'|'liquidity'|'source-recovery'|'migration-hint'|'pool-hint';at:number;fingerprint:string}};
export type WatchRow={
  signature:string;feedMint:string|null;mint:string|null;pool:string|null;
  migrationAt:number|null;verifiedAt:number|null;firstSeenAt:number;
  /** Canonical address scope only. Historical migration remains unknown until
   * separately verified; current account support is independently timestamped. */
  observationIdentity?:{basis:'canonical-pool-hint';availableAt:number;evidence:string;currentPool?:NativeCurrentPoolIdentityProof};
  state:WatchState;reason:string;lastActivityAt:number|null;lastActivityEvidence:string|null;
  lastDemotedAt:number|null;deepSince:number|null;deferUntil:number;waitingSince:number;
  promotions:number;repromotions:number;demotions:number;completeWindows:number;
  everHadWindow:boolean;lastWindowAt:number|null;history:WatchHistory[];capacityCoverage?:CapacityCoverage;olderResearch?:{selectedAt:number;activityAt:number;evidence:string};technicalReevaluation?:TechnicalReevaluation;reobservation?:WatchReobservation;
};
export type WatchIdentityMetadata=Pick<WatchRow,'mint'|'pool'|'signature'|'migrationAt'|'verifiedAt'|'state'>&{olderResearch:boolean};
type Counters={discovered:number;duplicates:number;verified:number;promoted:number;repromoted:number;demoted:number;expired:number;capacityExclusions:number;structuralExclusions:number;completeWindows:number;evicted:number;activityHints:number;promotionWaitTotalMs:number;promotionWaitMaximumMs:number};
export type WatchCheckpoint={schemaVersion:1;registry?:{version:'persistent-market-registry-v1';id:string};observationAgePolicyVersion?:ObservationAgePolicyVersion;rows:WatchRow[];counters:Counters;capacityProbeAdmissions?:Array<{mint:string;at:number}>;entryAgePromotionCount?:number};
type Options={enforceTokenAge24h?:true;registry?:MarketRegistry;observationAgePolicy?:ObservationAgePolicyVersion;maximumIdentities?:number;maximumOlderResearch?:number;maximumDeep:number;now?:()=>number;record:(kind:string,data:unknown)=>void;restored?:unknown};
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
  /** Row objects live only for one synchronous operation. The indexed registry
   * holds the unbounded identity history; queries never hydrate the whole table. */
  private operationDepth=0;private readOperationDepth=0;private registryIdentity='';private savedPersistentState='';private readonly originals=new Map<string,string>();
  private readonly deleted=new Set<string>();
  private persistentState(){return {counters:copy(this.counters),capacityProbeAdmissions:copy(this.capacityProbeAdmissions),entryAgePromotionCount:this.entryAgePromotionCount,observationAgePolicyVersion:this.checkpointObservationAgePolicy.version};}
  private flush(){if(!this.options.registry)return;for(const [signature,r] of this.rows){const body=JSON.stringify(r);if(this.originals.get(signature)!==body){this.options.registry.put(r);this.originals.set(signature,body);}}for(const signature of this.deleted)this.options.registry.delete(signature,this.clock(),'canonical identity alias merged');this.deleted.clear();}
  private operation<T>(run:()=>T):T{
    if(!this.options.registry)return run();if(this.operationDepth++>0){try{return run();}finally{this.operationDepth--;}}
    const prior=this.persistentState(),saved=this.savedPersistentState,admissions=new Map(this.capacityAdmissions);const restore=()=>{this.counters=prior.counters;this.capacityProbeAdmissions=prior.capacityProbeAdmissions;this.entryAgePromotionCount=prior.entryAgePromotionCount;this.savedPersistentState=saved;this.capacityAdmissions.clear();for(const [key,value]of admissions)this.capacityAdmissions.set(key,value);};try{return this.options.registry.transaction(()=>{this.options.registry!.onRollback(restore);const result=run();this.flush();const state=this.persistentState(),body=JSON.stringify(state);if(body!==this.savedPersistentState){this.options.registry!.setMetadata('pilot-watch-state',state);this.savedPersistentState=body;}return result;});}catch(error){restore();throw error;}
    finally{this.operationDepth--;this.rows.clear();this.originals.clear();this.deleted.clear();}
  }
  private readOperation<T>(run:()=>T):T{
    if(!this.options.registry)return run();this.readOperationDepth++;
    if(this.operationDepth++>0){try{return run();}finally{this.operationDepth--;this.readOperationDepth--;}}
    try{return this.options.registry.readTransaction(run);}finally{this.operationDepth--;this.readOperationDepth--;this.rows.clear();this.originals.clear();this.deleted.clear();}
  }
  private retain(r:WatchRow){const existing=this.rows.get(r.signature);if(existing)return existing;this.rows.set(r.signature,r);this.originals.set(r.signature,JSON.stringify(r));return r;}
  private stored(signature:string){const r=this.rows.get(signature)??this.options.registry?.get(signature);return r?this.retain(r):undefined;}
  private query(where:string,params:Array<string|number|null>=[],orderBy='w.signature',limit=256):WatchRow[]{this.flush();return this.options.registry!.queryRows({where,params,orderBy,limit}).map(r=>this.retain(r));}
  private count(where:string,params:Array<string|number|null>=[]){this.flush();return this.options.registry!.count(where,params);}
  private remove(signature:string){this.rows.delete(signature);this.originals.delete(signature);if(this.options.registry)this.deleted.add(signature);}
  private durable(){return this.options.registry!==undefined;}
  private observationIdentitySql(){return "w.mint IS NOT NULL AND w.pool IS NOT NULL AND "+(this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?"((w.migration_at IS NOT NULL AND w.verified_at IS NOT NULL) OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint')":"w.migration_at IS NOT NULL AND w.verified_at IS NOT NULL");}
  private readyAnchorSql(){return "MAX(w.waiting_since,COALESCE(w.verified_at,json_extract(w.body,'$.observationIdentity.availableAt'),w.first_seen_at),COALESCE(w.migration_at,0),w.defer_until,COALESCE(json_extract(w.body,'$.reobservation.ready.at'),0)"+(this.options.enforceTokenAge24h?",COALESCE((SELECT verified_at FROM token_creations age WHERE age.mint=w.mint),0)":"")+")";}
  private tokenAgeSql(at:string){return this.options.enforceTokenAge24h?` AND EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=w.mint AND age.created_at<=${at} AND age.created_at>=${at}-${TOKEN_AGE_POLICY.maximumAgeMs} AND age.verified_at<=${at})`:'';}
  private readySql(at:number,preparation=false){
    this.at(at);const persistent=this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY,age=persistent?'COALESCE(w.migration_at,0)<=?':'w.migration_at<=? AND ?<w.migration_at+CASE WHEN w.older_research=1 THEN ? ELSE ? END';
    const identity=persistent?"(w.verified_at IS NOT NULL OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint')":"w.verified_at IS NOT NULL";
    return {where:"w.mint IS NOT NULL AND w.pool IS NOT NULL AND "+identity+" AND w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=1 AND COALESCE(w.capacity_status,'')!='AWAITING_CAPACITY' AND w.defer_until<=? AND (w.technical_state IS NULL OR w.technical_state!='WAITING' OR w.technical_not_before<=?) AND "+age+(preparation&&this.options.enforceTokenAge24h?` AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=w.mint AND (age.created_at>? OR age.created_at<? OR age.verified_at>?))`:this.tokenAgeSql('?')),params:[...(persistent?[at,at,at]:[at,at,at,at,this.observationAgePolicy.selectedOlderMaximumAgeMs,this.observationAgePolicy.recentMaximumAgeMs]),...(this.options.enforceTokenAge24h?(preparation?[at,at-TOKEN_AGE_POLICY.maximumAgeMs,at]:[at,at,at]):[])]};
  }
  private repairPredecisionReady(r:WatchRow,source:'checkpoint'|'durable-registry'){
    const gate=r.reobservation,ready=gate?.ready;
    if(!gate||!ready||!integer(gate.decisionAt)||gate.decisionAt>this.clock()||!integer(ready.at)||ready.at>=gate.decisionAt||!text(ready.reason)||!text(ready.evidence,512))return false;
    const key='pilot-watch-predecision-ready:'+r.signature+':'+gate.decisionAt+':'+ready.at,receipt={at:this.clock(),source,signature:r.signature,mint:r.mint,originalGate:copy(gate),correction:'clear only predecision readiness from delayed intake; retain completed decision, evidence and financial history',financialWriterOpened:false};
    if(!this.options.registry?.getMetadata(key)){this.options.registry?.setMetadata(key,receipt);this.emit('pilot-watch-predecision-readiness-corrected',receipt);}
    gate.ready=null;return true;
  }
  private repairDurableReadiness(){
    let after='';for(;;){const batch=this.query("w.signature>? AND w.reobserve_ready=1 AND w.last_decision_at IS NOT NULL AND json_extract(w.body,'$.reobservation.ready.at')<w.last_decision_at",[after],'w.signature',128);if(!batch.length)break;for(const row of batch)this.repairPredecisionReady(row,'durable-registry');after=batch.at(-1)!.signature;this.flush();this.rows.clear();this.originals.clear();if(batch.length<128)break;}
  }
  private recoverDurable(){
    // Only operational proofs need restart repair. Historical inactive rows are
    // left on disk and retain their original decision-time provenance.
    let after='';for(;;){const batch=this.query("w.signature>? AND (w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING') OR w.technical_state IN ('CLAIMED','WAITING') OR (w.state IN ('WATCH','DEFERRED') AND w.capacity_status='OTHER_UNAVAILABLE'))",[after],'w.signature',128);if(!batch.length)break;
      for(const r of batch){const v:WatchCheckpoint={schemaVersion:1,observationAgePolicyVersion:this.checkpointObservationAgePolicy.version,rows:[copy(r)],counters:copy(this.counters),capacityProbeAdmissions:copy(this.capacityProbeAdmissions),entryAgePromotionCount:this.entryAgePromotionCount};this.rows.delete(r.signature);this.restore(v);}
      after=batch.at(-1)!.signature;this.flush();this.rows.clear();this.originals.clear();if(batch.length<128)break;
    }
  }

  constructor(private readonly options:Options){
    need(!options.enforceTokenAge24h||!!options.registry,'TOKEN_AGE_DURABLE_REGISTRY_REQUIRED');
    this.observationAgePolicy=observationAgePolicyByVersion(options.observationAgePolicy);this.checkpointObservationAgePolicy=this.observationAgePolicy;
    this.maximum=options.maximumIdentities??OBSERVATION_AGE_POLICY.totalWatchCapacity;this.olderMaximum=Math.min(options.maximumOlderResearch??OBSERVATION_AGE_POLICY.olderWatchCapacity,Math.max(0,this.maximum-1));this.maximumDeep=options.maximumDeep;this.clock=options.now??Date.now;
    need(integer(this.maximumDeep)&&this.maximumDeep>=1&&this.maximumDeep<=20&&(this.durable()||integer(this.maximum)&&this.maximum>=1&&this.maximum<=512&&this.maximumDeep<=this.maximum&&integer(this.olderMaximum)&&this.olderMaximum<=OBSERVATION_AGE_POLICY.olderWatchCapacity),'PILOT_WATCH_LIMITS');
    if(options.registry){
      this.registryIdentity=options.registry.getMetadata<string>('pilot-watch-identity')??'';if(!this.registryIdentity){need(!(options.restored as WatchCheckpoint|undefined)?.registry,'PILOT_WATCH_DURABLE_HISTORY_UNAVAILABLE');this.registryIdentity=randomUUID();options.registry.setMetadata('pilot-watch-identity',this.registryIdentity);}
      const checkpoint=options.restored as WatchCheckpoint|undefined;need(!checkpoint?.registry||checkpoint.registry.id===this.registryIdentity,'PILOT_WATCH_REGISTRY_IDENTITY');
      const state=options.registry.getMetadata<ReturnType<PilotWatch['persistentState']>>('pilot-watch-state');
      if(state){this.counters=copy(state.counters);this.capacityProbeAdmissions=copy(state.capacityProbeAdmissions);this.entryAgePromotionCount=state.entryAgePromotionCount;const previousPolicy=observationAgePolicyByVersion(state.observationAgePolicyVersion);if(previousPolicy.selectedOlderMaximumAgeMs>this.checkpointObservationAgePolicy.selectedOlderMaximumAgeMs)this.checkpointObservationAgePolicy=previousPolicy;this.savedPersistentState=JSON.stringify(state);this.operation(()=>{this.repairDurableReadiness();this.recoverDurable();});}
      else this.operation(()=>{if(options.restored!==undefined)this.restore(options.restored);});
      for(const name of ['discover','verify','observeIdentity','currentPoolValidated','releaseArchiveDeferral','releaseLegacyCapacityGate','transition','resumeContinuousObservation','requestTechnicalReevaluation','technicalReevaluation','claimTechnicalReevaluation','finishTechnicalReevaluation','selectOlderResearch','deferCapacity','recordCapacityDemand','reassessCapacity','admitCapacity','deferVerification','noteActivity','noteEvaluation','notePoolHintProgress','noteMigrationHint','noteRelevantEvidence','noteWindow','next','lookupIdentity','listIdentities','listIdentityPage','identitiesInStates','snapshot','export'] as const){const original=(this[name] as Function).bind(this);(this as any)[name]=(...args:unknown[])=>name==='technicalReevaluation'?this.readTechnicalReevaluation(args,original):this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY&&['lookupIdentity','listIdentities','listIdentityPage','identitiesInStates','snapshot','export'].includes(name)?this.readOperation(()=>original(...args)):this.operation(()=>original(...args));}
    }else if(options.restored!==undefined)this.restore(options.restored);
  }
  /** Ordinary sorting/readiness polls do not need an exclusive writer when
   * there is no ticket or no expiry/backoff migration to persist. Recheck under
   * the normal write lease only for an actual ticket mutation. */
  private readTechnicalReevaluation(args:unknown[],original:(...args:unknown[])=>unknown){
    const mint=args[0] as string,at=args[1]===undefined?this.clock():args[1] as number;
    this.at(at);need(at<=this.clock(),'PILOT_WATCH_TECHNICAL_REEVALUATION_TIME');
    const ticket=this.readOperation(()=>copy(this.row(mint)?.technicalReevaluation??null));
    const changes=!!ticket&&(['WAITING','CLAIMED'].includes(ticket.state)&&at>=ticket.expiresAt||ticket.state==='WAITING'&&at>=ticket.requestedAt&&ticket.notBefore>at);
    return changes?this.operation(()=>original(...args)):ticket;
  }
  private emit(kind:string,data:unknown){this.options.record(kind,data);}
  private at(at=this.clock()){need(integer(at),'PILOT_WATCH_TIME');return at;}
  private row(id:string){for(const r of this.rows.values())if(r.mint===id||r.signature===id)return r;const r=this.options.registry?.lookup(id);return r?this.retain(r):undefined;}
  private verified(r:WatchRow){return r.migrationAt!==null&&r.verifiedAt!==null&&r.mint!==null&&r.pool!==null;}
  private identified(r:WatchRow){return this.verified(r)||!!(r.mint&&r.pool&&r.observationIdentity?.basis==='canonical-pool-hint');}
  private identityAt(r:WatchRow){return r.verifiedAt??r.observationIdentity?.availableAt??r.firstSeenAt;}
  private cohort(r:WatchRow,at:number){return r.migrationAt===null?'unknown-migration-age':observationAgeCohort(r.migrationAt,at,r.olderResearch!==undefined,this.observationAgePolicy);}
  private entryEligible(r:WatchRow,at:number){return !['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)&&this.verified(r)&&entryAgeEligible(r.migrationAt!,at);}
  private observable(r:WatchRow,at:number){return (!this.options.enforceTokenAge24h||!!r.mint&&this.options.registry!.tokenAgeEligibility(r.mint,at).allowed)&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)&&this.identified(r)&&this.identityAt(r)<=at&&(r.migrationAt===null?this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY:observationAgeEligible(r.migrationAt,at,r.olderResearch!==undefined,this.observationAgePolicy));}
  private older(r:WatchRow,at:number){return this.verified(r)&&r.olderResearch!==undefined&&at-r.migrationAt!>=MAX_AGE;}
  private olderDeepAvailable(r:WatchRow,at:number){return this.durable()||this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY||!this.older(r,at)||[...this.rows.values()].filter(other=>other!==r&&deep(other)&&this.older(other,at)).length<OBSERVATION_AGE_POLICY.maximumOlderDeep;}
  private freshProbe(r:WatchRow,at:number){const c=r.capacityCoverage,d=c?.lastDemand,probe=c?.probeAdmissions.at(-1);return !!d&&d.complete&&d.observedAt<=at&&at-d.observedAt<=30000&&probe!==undefined&&probe<=at&&at-probe<=30000;}
  private refreshProbeReadiness(at:number){
    // Read projections never acquire a writer lease for opportunistic upkeep.
    // next()/transition() retain the actual freshness/admission maintenance.
    if(this.readOperationDepth>0)return;
    for(const r of (this.durable()?this.query("w.capacity_status='PROBE_READY' AND w.state IN ('WATCH','DEFERRED')",[], 'w.signature',32):this.rows.values()))if(r.capacityCoverage?.status==='PROBE_READY'&&['WATCH','DEFERRED'].includes(r.state)&&!this.freshProbe(r,at)){
      const c=r.capacityCoverage;c.status='AWAITING_CAPACITY';c.reassessAt=Math.max(c.reassessAt,at+5000);this.capacityAdmissions.delete(r.signature);
      this.transition(r.signature,'DEFERRED','capacity demand or readiness aged; fresh resource assessment required',at,{deferUntil:Math.max(r.deferUntil,c.reassessAt)});
      this.emit('pilot-watch-capacity-readiness-expired',{mint:r.mint,at,demandObservedAt:c.lastDemand?.observedAt??null,latestProbeAt:c.probeAdmissions.at(-1)??null,reassessAt:c.reassessAt,financialPermission:false});
    }
  }

  private history(r:WatchRow,at:number,state:WatchState,reason:string){r.state=state;r.reason=reason;r.history.push({at,state,reason});if(r.history.length>16)r.history.shift();}
  private refreshTechnicalReevaluation(r:WatchRow,at:number){
    const t=r.technicalReevaluation;if(t&&['WAITING','CLAIMED'].includes(t.state)&&at>=t.expiresAt){t.state='EXPIRED';this.emit('pilot-watch-technical-reevaluation-expired',{mint:r.mint,at,...copy(t),ordinaryWatchPreserved:true,financialPermission:false});}
    // Legacy fixed backoff is scheduling metadata, not a provider restriction
    // or evidence recovery boundary. A new current audited window is still
    // required by the claim and trading callers; no same-window claim is reset.
    if(t?.state==='WAITING'&&this.readOperationDepth===0&&at>=t.requestedAt&&t.notBefore>at){const previousNotBefore=t.notBefore;t.notBefore=at;this.emit('pilot-watch-technical-backoff-released',{mint:r.mint,at,previousNotBefore,notBefore:t.notBefore,policy:TECHNICAL_REEVALUATION_POLICY.version,requestedAt:t.requestedAt,expiresAt:t.expiresAt,attempts:t.attempts,lastClaimedWindowEndAt:t.lastClaimedWindowEndAt,newerWindowRequired:true,financialPermission:false});}return t;
  }
  private expire(at:number){
    if(this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY)return;
    const source=this.durable()?this.query("w.state NOT IN ('HELD','ENTRY_PENDING','EXPIRED','PERMANENTLY_UNSUPPORTED') AND ((w.migration_at IS NULL AND w.first_seen_at+?<=?) OR (w.migration_at IS NOT NULL AND w.migration_at+CASE WHEN w.older_research=1 THEN ? ELSE ? END<=?))",[UNVERIFIED_RETENTION,at,this.observationAgePolicy.selectedOlderMaximumAgeMs,this.observationAgePolicy.recentMaximumAgeMs,at]):this.rows.values();
    for(const r of source)if(r.state!=='HELD'&&r.state!=='ENTRY_PENDING'&&r.state!=='EXPIRED'&&r.state!=='PERMANENTLY_UNSUPPORTED'&&at>=(r.migrationAt===null?r.firstSeenAt+UNVERIFIED_RETENTION:observationExpiryAt(r.migrationAt,r.olderResearch!==undefined,this.observationAgePolicy))){
      this.history(r,at,'EXPIRED',r.migrationAt===null?'unverified identity retention elapsed; migration time unavailable':'existing observation-age horizon elapsed');r.deepSince=null;this.counters.expired++;this.emit('pilot-watch-expired',{signature:r.signature,mint:r.mint,at,reason:r.reason});
    }
  }
  discover(seed:WatchSeed):WatchRow|null{
    need(text(seed.signature,100)&&(seed.feedMint===undefined||text(seed.feedMint,96))&&integer(seed.receivedAt),'PILOT_WATCH_SEED');const at=this.at();need(seed.receivedAt<=at,'PILOT_WATCH_FUTURE_SEED');
    const old=this.stored(seed.signature);if(old){this.counters.duplicates++;return copy(old);}
    this.expire(at);this.counters.discovered++;
    if(!this.durable()&&this.rows.size>=this.maximum){
      const victim=[...this.rows.values()].filter(r=>!protectedRow(r)).sort((a,b)=>Number(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(a.state))-Number(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(b.state))||Number(a.olderResearch===undefined)-Number(b.olderResearch===undefined)||a.firstSeenAt-b.firstSeenAt)[0];
      if(!victim){this.counters.capacityExclusions++;this.emit('pilot-watch-capacity-refusal',{at,signature:seed.signature,feedMint:seed.feedMint??null,maximum:this.maximum,reason:'all retained identities protected; discovery still recorded, no deep evidence admitted'});return null;}
      const lostHorizon=!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(victim.state);this.remove(victim.signature);this.capacityAdmissions.delete(victim.signature);this.counters.evicted++;if(lostHorizon)this.counters.capacityExclusions++;
      this.emit('pilot-watch-evicted',{at,signature:victim.signature,mint:victim.mint,state:victim.state,reason:lostHorizon?'lightweight horizon capacity exceeded; lost awareness explicitly recorded':'expired or structurally unsupported retention reclaimed',lostHorizon});
    }
    const row:WatchRow={signature:seed.signature,feedMint:seed.feedMint??null,mint:null,pool:null,migrationAt:null,verifiedAt:null,firstSeenAt:seed.receivedAt,state:'DISCOVERED',reason:'processed migration hint; base/quote/pool identity and time unverified',lastActivityAt:null,lastActivityEvidence:null,lastDemotedAt:null,deepSince:null,deferUntil:0,waitingSince:seed.receivedAt,promotions:0,repromotions:0,demotions:0,completeWindows:0,everHadWindow:false,lastWindowAt:null,history:[]};
    row.history.push({at:seed.receivedAt,state:row.state,reason:row.reason});this.rows.set(seed.signature,row);this.emit('pilot-watch-discovered',{at,signature:row.signature,feedMint:row.feedMint,verified:false});return copy(row);
  }
  /** A parseable mint and its canonical PDA identify a scope to probe. This
   * deliberately does not assert that the pool exists or that migration was seen. */
  observeIdentity(signature:string,input:{mint:string;pool:string;availableAt:number;evidence:string}):WatchRow{
    const at=this.at();need(this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY&&text(signature,100)&&integer(input.availableAt)&&input.availableAt<=at&&text(input.evidence,512),'PILOT_WATCH_OBSERVATION_IDENTITY');canonicalObservationPool(input.mint,input.pool);
    let r=this.stored(signature),same=this.row(input.mint);
    if(same&&same!==r){need(same.pool===input.pool,'PILOT_WATCH_IDENTITY_CONFLICT');if(r){this.remove(signature);if(this.options.registry){this.flush();this.options.registry.mergeWatchAlias(signature,same.signature);}this.capacityAdmissions.delete(signature);}return copy(same);}
    if(!r){this.discover({signature,feedMint:input.mint,receivedAt:input.availableAt});r=this.stored(signature);}need(r,'PILOT_WATCH_OBSERVATION_CAPACITY');
    need((r.mint===null||r.mint===input.mint)&&(r.pool===null||r.pool===input.pool),'PILOT_WATCH_IDENTITY_CONFLICT');
    if(this.identified(r))return copy(r);
    r.mint=input.mint;r.pool=input.pool;r.observationIdentity={basis:'canonical-pool-hint',availableAt:input.availableAt,evidence:input.evidence};
    if(['DISCOVERED','VERIFYING'].includes(r.state))this.history(r,at,'WATCH','canonical pool address selected; current account support and fresh observation required');
    this.emit('pilot-watch-observation-identity',{signature:r.signature,mint:r.mint,pool:r.pool,at,...copy(r.observationIdentity),migrationAt:r.migrationAt,migrationVerified:false,currentSupportVerified:false,financialPermission:false});return copy(r);
  }
  currentPoolValidated(proof:NativeCurrentPoolIdentityProof):WatchRow{
    const at=this.at();assertNativeCurrentPoolIdentityProof(proof,at);const r=this.row(proof.mint);need(r&&this.identified(r)&&r.pool===proof.pool,'PILOT_WATCH_CURRENT_POOL_SCOPE');
    r.observationIdentity??={basis:'canonical-pool-hint',availableAt:this.identityAt(r),evidence:'retained canonical scope; current support independently validated'};
    if(!r.observationIdentity.currentPool){r.observationIdentity.currentPool=copy(proof);this.emit('pilot-watch-current-pool-validated',{at,mint:r.mint,pool:r.pool,proof:copy(proof),migrationAt:r.migrationAt,migrationVerified:this.verified(r),financialPermission:false});}return copy(r);
  }
  /** An old archive retry must not survive as an observation prerequisite. */
  releaseArchiveDeferral(mint:string,at=this.clock()):boolean{
    this.at(at);const r=this.row(mint);if(!r||!this.identified(r)||r.state!=='DEFERRED')return false;
    const knownArchiveRetry=/^known origin proof unavailable:/.test(r.reason)||r.reason==='durable origin quarantined; canonical creation re-verification required';
    // A never-verified seed may have a long archival-history retry timer. Bind
    // its removal to the exact durable verification attempt, not an error-code
    // prefix that might also describe an unrelated current-source deferral.
    const pendingArchiveRetry=r.verifiedAt===null&&!!this.options.registry?.count("w.signature=? AND EXISTS(SELECT 1 FROM verification_queue q WHERE q.signature=w.signature AND q.state='PENDING' AND q.attempts>0 AND q.last_reason=? AND q.not_before=?)",[r.signature,r.reason,r.deferUntil]);
    if(!knownArchiveRetry&&!pendingArchiveRetry)return false;
    const prior={reason:r.reason,deferUntil:r.deferUntil};r.deferUntil=0;this.history(r,at,'WATCH','archival creation proof optional; current account support still required');this.emit('pilot-watch-archive-deferral-released',{at,mint:r.mint,prior,currentSupportRequired:true,freshWindowRequired:true,financialPermission:false});return true;
  }
  /** Legacy selected-hint demand estimated one RPC enrichment per trade.
   * Native program observation uses current account support and independent
   * audits instead; its real dispatch/resource gates remain outside this row. */
  releaseLegacyCapacityGate(mint:string,at=this.clock()):boolean{
    this.at(at);const r=this.row(mint),prior=r?.capacityCoverage;if(!r||!prior||!this.identified(r))return false;
    delete r.capacityCoverage;this.capacityAdmissions.delete(r.signature);
    if(r.state==='DEFERRED'&&(r.reason===prior.reason||r.reason==='restored technical gap requires current resource reassessment'||r.reason==='capacity demand or readiness aged; fresh resource assessment required')){r.deferUntil=0;this.history(r,at,'WATCH','native current support replaces obsolete per-transaction enrichment estimate');}
    this.emit('pilot-watch-native-capacity-transition',{at,mint:r.mint,priorCoverage:copy(prior),nativeCurrentSupportRequired:true,independentAuditRequired:true,physicalProviderGatesUnchanged:true,reobservationGatePreserved:true,financialPermission:false});return true;
  }
  verify(signature:string,input:{mint:string;pool:string;migrationAt:number;verifiedAt:number}):WatchRow{
    need(text(signature,100)&&text(input.mint,96)&&text(input.pool,96)&&integer(input.migrationAt)&&integer(input.verifiedAt)&&input.migrationAt<=input.verifiedAt&&input.verifiedAt<=this.at(),'PILOT_WATCH_VERIFICATION');
    let r=this.stored(signature);if(!r){this.discover({signature,feedMint:input.mint,receivedAt:input.verifiedAt});r=this.stored(signature);}need(r,'PILOT_WATCH_VERIFY_CAPACITY');
    if(r.verifiedAt!==null){need(r.mint===input.mint&&r.pool===input.pool&&r.migrationAt===input.migrationAt,'PILOT_WATCH_IDENTITY_CONFLICT');return copy(r);}
    const same=this.durable()?this.row(input.mint):[...this.rows.values()].find(other=>other!==r&&other.mint===input.mint);
    if(same&&same!==r){need(same.pool===input.pool&&(same.migrationAt===null||same.migrationAt===input.migrationAt),'PILOT_WATCH_IDENTITY_CONFLICT');this.remove(signature);if(this.options.registry){this.flush();this.options.registry.mergeWatchAlias(signature,same.signature);}this.capacityAdmissions.delete(signature);this.counters.duplicates++;this.emit('pilot-watch-identity-merged',{at:input.verifiedAt,signature,retainedSignature:same.signature,mint:input.mint});if(same.verifiedAt!==null)return copy(same);r=same;}
    r.mint=input.mint;r.pool=input.pool;r.migrationAt=input.migrationAt;r.verifiedAt=input.verifiedAt;this.counters.verified++;
    if(!r.observationIdentity||['DISCOVERED','VERIFYING'].includes(r.state))this.history(r,input.verifiedAt,'WATCH','canonical migration identity verified; current support and fresh observation still required');this.expire(input.verifiedAt);this.emit('pilot-watch-verified',{signature:r.signature,mint:r.mint,pool:r.pool,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt});return copy(r);
  }
  transition(mint:string,state:WatchState,reason:string,at=this.clock(),options:{deferUntil?:number;releaseObservation?:true}={}):WatchRow{
    this.at(at);need(STATES.includes(state)&&text(reason)&&integer(options.deferUntil??0),'PILOT_WATCH_TRANSITION');const r=this.row(mint);need(r,'PILOT_WATCH_UNKNOWN_IDENTITY');
    need(!options.releaseObservation||!['DEEP_OBSERVATION','QUALIFIED'].includes(state),'PILOT_WATCH_RELEASE_OBSERVATION_STATE');
    const releaseObservation=options.releaseObservation;
    const gated=r.capacityCoverage&&['AWAITING_CAPACITY','PROBE_READY'].includes(r.capacityCoverage.status)&&['WATCH','DEFERRED'].includes(state),requestedState=state;
    if(gated){state='DEFERRED';options={deferUntil:Math.max(r.deferUntil,options.deferUntil??0,r.capacityCoverage!.status==='AWAITING_CAPACITY'?r.capacityCoverage!.reassessAt:0)};this.capacityAdmissions.delete(r.signature);}
    if(!releaseObservation&&r.state===state&&r.reason===reason&&r.deferUntil===(options.deferUntil??0))return copy(r);
    if(['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD'].includes(state))need(this.identified(r),'PILOT_WATCH_UNVERIFIED_PROMOTION');
    if(state==='DEEP_OBSERVATION'&&!deep(r)){
      need(this.observable(r,at),'PILOT_WATCH_OBSERVATION_AGE');need(!this.durable()||!r.reobservation||r.reobservation.ready!==null,'PILOT_WATCH_NEW_RELEVANT_EVIDENCE_REQUIRED');need(this.olderDeepAvailable(r,at),'PILOT_WATCH_OLDER_DEEP_CAPACITY');need(r.capacityCoverage?.status!=='AWAITING_CAPACITY','PILOT_WATCH_CAPACITY_PROBE_REQUIRED');if(r.capacityCoverage?.status==='PROBE_READY'){const admitted=this.capacityAdmissions.get(r.signature);need(this.freshProbe(r,at)&&admitted!==undefined&&admitted<=at&&at-admitted<=1000,'PILOT_WATCH_CAPACITY_ADMISSION_REQUIRED');}need((this.durable()?this.count("w.deep_since IS NOT NULL AND w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING')"):[...this.rows.values()].filter(deep).length)<this.maximumDeep,'PILOT_WATCH_DEEP_CAPACITY');
      const again=r.promotions>0;r.promotions++;this.counters.promoted++;if(again){r.repromotions++;this.counters.repromoted++;}
      const waitMs=Math.max(0,at-Math.max(r.waitingSince,(r.migrationAt??at)+MIN_AGE,this.identityAt(r))),observationWaitMs=Math.max(0,at-Math.max(r.waitingSince,r.migrationAt??0,this.identityAt(r))),entryEligible=this.entryEligible(r,at);if(entryEligible){this.entryAgePromotionCount++;this.counters.promotionWaitTotalMs+=waitMs;this.counters.promotionWaitMaximumMs=Math.max(this.counters.promotionWaitMaximumMs,waitMs);}
      r.deepSince=at;this.emit('pilot-watch-promotion',{mint:r.mint,at,reason,repromotion:again,waitMs,observationWaitMs,entryEligible,ageCohort:this.cohort(r,at),freshFullWindowRequired:true});
    }
    if(deep(r)&&['WATCH','DEFERRED'].includes(state)){r.demotions++;this.counters.demoted++;r.lastDemotedAt=at;r.waitingSince=at;r.deepSince=null;}
    if(releaseObservation||!['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(state))r.deepSince=null;
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
    const r=this.row(mint);need(r&&this.identified(r),'PILOT_WATCH_TECHNICAL_REEVALUATION_IDENTITY');
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
    if(!this.durable()&&this.observationAgePolicy!==PERSISTENT_OBSERVABLE_MARKET_POLICY){const existing=[...this.rows.values()].filter(other=>other!==r&&other.olderResearch&&this.observable(other,at));need(existing.length<this.olderMaximum,'PILOT_WATCH_OLDER_CAPACITY');}
    const selection=r.olderResearch??{selectedAt:at,activityAt:activity.observedAt,evidence:activity.evidence};r.olderResearch=selection;
    if(r.state==='EXPIRED'){const capacity=r.capacityCoverage;if(capacity&&['AWAITING_CAPACITY','PROBE_READY'].includes(capacity.status)){capacity.status='AWAITING_CAPACITY';capacity.reassessAt=Math.max(capacity.reassessAt,at+5000);this.transition(mint,'DEFERRED',capacity.reason,at,{deferUntil:Math.max(r.deferUntil,capacity.reassessAt)});}else this.transition(mint,'WATCH','selected older observation research; baseline entry age remains excluded',at,{deferUntil:Math.max(r.deferUntil,at)});}
    this.noteActivity(mint,activity.observedAt,activity.evidence);this.emit('pilot-watch-older-research-selected',{mint:r.mint,at,selection:copy(selection),entryEligible:false,activityHintOnly:true,freshFullWindowRequired:true});return copy(r);
  }
  /** Technical loss, never a predictive rejection. Short reassessment replaces
   * the old escalating full-read cooldown; this does not itself retry anything. */
  deferCapacity(mint:string,reason:string,demand:CapacityDemand|null,at=this.clock()):WatchRow{
    this.at(at);need(text(reason)&&(demand===null||validDemand(demand)&&demand.observedAt<=at),'PILOT_WATCH_CAPACITY_DEMAND');const r=this.row(mint);need(r&&this.identified(r),'PILOT_WATCH_CAPACITY_VERIFIED_IDENTITY');
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
    const active=(this.durable()?this.query(this.readySql(at).where+" AND w.capacity_status='PROBE_READY'",this.readySql(at).params,'w.signature',32):[...this.rows.values()]).filter(r=>r.capacityCoverage?.status==='PROBE_READY'&&this.freshProbe(r,at)&&at>=r.deferUntil&&['WATCH','DEFERRED'].includes(r.state)&&this.observable(r,at)&&this.olderDeepAvailable(r,at)&&!excluded.has(r.mint??''));if(active.length)return null;
    this.capacityProbeAdmissions=this.capacityProbeAdmissions.filter(t=>t.at>at-60000);if(this.capacityProbeAdmissions.filter(t=>t.at>at-10000).length>=2||this.capacityProbeAdmissions.length>=12||(this.capacityProbeAdmissions.at(-1)?.at??0)>at)return null;
    const saturated=[...new Set(this.capacityProbeAdmissions.filter(t=>this.capacityProbeAdmissions.filter(other=>other.mint===t.mint).length>=2).map(t=>t.mint))],blocked=[...new Set([...excluded,...saturated])],eligibility=this.readySql(at);const ready=(this.durable()?this.query(eligibility.where.replace("COALESCE(w.capacity_status,'')!='AWAITING_CAPACITY'","w.capacity_status='AWAITING_CAPACITY'")+" AND w.state='DEFERRED' AND w.capacity_reassess_at<=?"+(blocked.length?' AND w.mint NOT IN ('+blocked.map(()=>'?').join(',')+')':''),[...eligibility.params,at,...blocked],"COALESCE(w.last_activity_at,0) DESC,w.waiting_since,w.signature",1): [...this.rows.values()]).filter(r=>r.mint!==null&&!excluded.has(r.mint)&&r.state==='DEFERRED'&&this.observable(r,at)&&this.olderDeepAvailable(r,at)&&r.capacityCoverage?.status==='AWAITING_CAPACITY'&&at>=r.deferUntil&&at>=r.capacityCoverage.reassessAt&&(r.capacityCoverage.probeAdmissions.filter(t=>t>at-60000).length<2)&&this.capacityProbeAdmissions.filter(t=>t.mint===r.mint).length<2);
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
    const at=this.at(context.at);this.expire(at);this.refreshProbeReadiness(at);const r=this.row(mint);need(r&&this.identified(r),'PILOT_WATCH_CAPACITY_VERIFIED_IDENTITY');
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
    const r=this.stored(signature);need(r,'PILOT_WATCH_UNKNOWN_IDENTITY');
    if(r.verifiedAt!==null||['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state))return copy(r);
    const saturated=(value:string)=>value.includes('PILOT_MIGRATION_HISTORY_SATURATED_ORIGIN_UNKNOWN');
    const repeated=saturated(reason)&&r.history.some(h=>h.state==='DEFERRED'&&saturated(h.reason));
    const delayMs=saturated(reason)?repeated?900000:300000:60000;
    const deferUntil=Math.max(r.deferUntil,at+delayMs);need(integer(deferUntil),'PILOT_WATCH_VERIFICATION_DEFERRAL');
    const result=this.transition(signature,'DEFERRED',reason,at,{deferUntil});
    this.emit('pilot-watch-verification-deferred',{signature,at,reason,delayMs,deferUntil,repeatedSaturatedOrigin:repeated,scope:'exact unverified transaction signature; awareness retained'});
    return result;
  }
  /** Completed economics and unavailable infrastructure are separate outcomes.
   * This records allocation evidence only; no trade/risk permission is created. */
  noteEvaluation(mint:string,input:{kind:'economic-rejection'|'technical-unavailable';windowEndAt:number|null;evidence:string;minimumEconomicChangeLamports?:string},at=this.clock()):boolean{
    this.at(at);need(at<=this.clock()&&['economic-rejection','technical-unavailable'].includes(input.kind)&&(input.windowEndAt===null?input.kind==='technical-unavailable':integer(input.windowEndAt)&&input.windowEndAt<=at)&&text(input.evidence,512)&&(input.minimumEconomicChangeLamports===undefined||/^(0|[1-9][0-9]{0,38})$/.test(input.minimumEconomicChangeLamports)),'PILOT_WATCH_EVALUATION');
    const r=this.row(mint);need(r&&this.identified(r),'PILOT_WATCH_EVALUATION_IDENTITY');if(['HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED'].includes(r.state))return false;
    const old=r.reobservation;if(old&&old.windowEndAt===input.windowEndAt&&old.kind===input.kind&&old.evidence===input.evidence)return false;
    const minimum=input.minimumEconomicChangeLamports===undefined?null:input.minimumEconomicChangeLamports;
    r.reobservation={kind:input.kind,decisionAt:at,windowEndAt:input.windowEndAt,evidence:input.evidence,minimumEconomicChangeLamports:minimum,baseline:this.options.registry?.marketEvidence(mint)??null,ready:null,...(old?.relevantEvidence?{relevantEvidence:copy(old.relevantEvidence)}:{})};
    this.emit('pilot-watch-evaluation-completed',{mint,at,...copy(r.reobservation),unchangedReobservationSuppressed:this.durable(),awarenessRetained:true,financialPermission:false});return true;
  }
  notePoolHintProgress(mint:string,at=this.clock()):boolean{
    this.at(at);need(at<=this.clock(),'PILOT_WATCH_POOL_HINT_TIME');const r=this.row(mint);if(!r)return false;const ready=r.reobservation?.ready;this.refreshReobservation(r,at);return !ready&&!!r.reobservation?.ready;
  }
  /** A new migration notification can justify another account check. It is
   * only an allocation hint: it supplies neither a supported pool nor a trade
   * qualification. Replayed/predecision hints never reopen a refused scope. */
  noteMigrationHint(mint:string,input:{signature:string;receivedAt:number},at=this.clock()):boolean{
    this.at(at);need(at<=this.clock()&&text(input.signature,100)&&integer(input.receivedAt)&&input.receivedAt<=at,'PILOT_WATCH_MIGRATION_HINT');
    const r=this.row(mint),gate=r?.reobservation;if(!r||!gate||gate.kind!=='technical-unavailable'||gate.windowEndAt!==null||gate.ready||['HELD','ENTRY_PENDING','EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state))return false;
    const fingerprint='migration-hint:'+input.signature;
    if(input.receivedAt<=gate.decisionAt||gate.relevantEvidence?.kind==='migration-hint'&&gate.relevantEvidence.fingerprint===fingerprint)return false;
    gate.relevantEvidence={kind:'migration-hint',at:input.receivedAt,fingerprint};gate.ready={at,reason:'new unverified migration hint after account support refusal; fresh supported accounts required',evidence:fingerprint};
    this.emit('pilot-watch-reobservation-ready',{mint,decisionAt:gate.decisionAt,decisionKind:gate.kind,...gate.ready,hintOnly:true,financialPermission:false});return true;
  }
  /** Caller must supply a content fingerprint of verified numeric pool/flow or
   * recovered source state. A timestamp, quote hash, or refreshed window label
   * alone is not a relevant change and must not be supplied here. */
  noteRelevantEvidence(mint:string,input:{kind:'audited-flow'|'pool-reserves'|'liquidity'|'source-recovery';at:number;fingerprint:string},at=this.clock()):boolean{
    this.at(at);need(at<=this.clock()&&integer(input.at)&&input.at<=at&&['audited-flow','pool-reserves','liquidity','source-recovery'].includes(input.kind)&&text(input.fingerprint,512),'PILOT_WATCH_RELEVANT_EVIDENCE');
    const r=this.row(mint);if(!r?.reobservation||['HELD','ENTRY_PENDING','EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state))return false;const gate=r.reobservation,old=gate.relevantEvidence;
    if(input.at<=gate.decisionAt||old?.kind===input.kind&&old.fingerprint===input.fingerprint||input.kind==='source-recovery'&&gate.kind!=='technical-unavailable')return false;
    gate.relevantEvidence=copy(input);gate.ready={at,reason:'new verified '+input.kind+' content after completed decision',evidence:input.fingerprint};this.emit('pilot-watch-reobservation-ready',{mint,decisionAt:gate.decisionAt,decisionKind:gate.kind,...gate.ready,financialPermission:false});return true;
  }
  private refreshReobservation(r:WatchRow,at:number){
    const gate=r.reobservation;if(!gate||gate.ready||!r.mint||!this.options.registry)return;
    if(gate.kind==='technical-unavailable'&&gate.windowEndAt===null){
      if(!r.pool)return;const hint=this.options.registry.canonicalPoolHintAfter(r.mint,r.pool,gate.decisionAt,at);
      if(!hint)return;gate.relevantEvidence={kind:'pool-hint',at:hint.at,fingerprint:hint.fingerprint};gate.ready={at:this.clock(),reason:'new unverified matching canonical-pool hint after account refusal; fresh supported accounts required',evidence:hint.fingerprint};
      this.emit('pilot-watch-reobservation-ready',{mint:r.mint,decisionAt:gate.decisionAt,decisionKind:gate.kind,...gate.ready,hintOnly:true,financialPermission:false});return;
    }
    const current=this.options.registry.marketEvidence(r.mint),baseline=gate.baseline;if(!current||baseline&&current.fingerprint===baseline.fingerprint)return;
    const fresh=this.options.registry.economicFlowAfter(r.mint,gate.decisionAt);
    // Worker commit order is not market information time. Mixed batches must
    // not let predecision volume subsidize a later negligible transaction.
    if(fresh.knownEvents===0||fresh.latestAt===null||fresh.latestAt<=gate.decisionAt)return;
    const buy=BigInt(fresh.buyLamports),sell=BigInt(fresh.sellLamports);
    // Actual measured execution friction is a size-relative information-value
    // reference, not a universal dollar threshold or a qualification filter.
    // Material selling can reveal absorption/reversal/liquidity changes too.
    const gross=buy+sell,reference=gate.minimumEconomicChangeLamports===null?null:BigInt(gate.minimumEconomicChangeLamports);
    const relevant=gate.kind==='technical-unavailable'?gross>0n:reference!==null?gross>0n&&gross>=reference:buy>sell;
    if(!relevant)return;gate.ready={at:this.clock(),reason:gate.kind==='technical-unavailable'?'new signed economic source progress after technical unavailability':reference===null?'new positive measured capital pressure; execution-friction reference unavailable':'new measured capital flow covers prior actual quoted round-trip network cost',evidence:current.fingerprint};
    this.emit('pilot-watch-reobservation-ready',{mint:r.mint,decisionAt:gate.decisionAt,decisionKind:gate.kind,deltaBuyLamports:buy.toString(),deltaSellLamports:sell.toString(),knownPostDecisionEvents:fresh.knownEvents,unknownPostDecisionEvents:fresh.unknownEvents,postDecisionHistoryComplete:fresh.complete,latestKnownReceivedAt:fresh.latestAt,minimumEconomicChangeLamports:gate.minimumEconomicChangeLamports,...gate.ready,financialPermission:false});
  }
  noteActivity(mint:string,at:number,evidence:string):boolean{
    this.at(at);need(at<=this.clock(),'PILOT_WATCH_ACTIVITY_FUTURE');need(text(evidence,256),'PILOT_WATCH_ACTIVITY_EVIDENCE');this.expire(at);const r=this.row(mint);if(!r||r.mint===null||r.state==='PERMANENTLY_UNSUPPORTED')return false;
    if(this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY&&r.state==='EXPIRED'&&this.verified(r)&&AGE_ONLY_EXPIRY_REASONS.has(r.reason)){this.history(r,at,'WATCH','new shared activity revived durable market identity; fresh evidence required');r.waitingSince=at;}
    if(r.state==='EXPIRED'&&!(this.verified(r)&&AGE_ONLY_EXPIRY_REASONS.has(r.reason)&&at>=r.migrationAt!+MAX_AGE&&at<observationExpiryAt(r.migrationAt!,true,this.observationAgePolicy)))return false;
    this.refreshReobservation(r,at);if(r.lastActivityAt!==null&&at<=r.lastActivityAt)return false;r.lastActivityAt=at;r.lastActivityEvidence=evidence;this.counters.activityHints++;this.emit('pilot-watch-activity',{mint:r.mint,at,evidence,hintOnly:true,meaning:'allocation hint only; no normalized trade fields or qualification supplied'});
    // This is a scheduling hint only. It never supplies normalized trade fields
    // or clears any defer deadline, audit gap, or incomplete flow window.
    return true;
  }
  noteWindow(mint:string,at:number){
    this.at(at);const r=this.row(mint);need(r&&deep(r)&&this.identified(r),'PILOT_WATCH_WINDOW_REQUIRES_DEEP');if(r.lastWindowAt!==null&&at<=r.lastWindowAt)return;
    if(r.capacityCoverage)r.capacityCoverage.status='VALID_WINDOW';r.completeWindows++;r.everHadWindow=true;r.lastWindowAt=at;this.counters.completeWindows++;this.emit('pilot-watch-complete-window',{mint:r.mint,at,completeWindows:r.completeWindows,deepSince:r.deepSince,entryEligible:this.entryEligible(r,at),ageCohort:this.cohort(r,at)});
  }
  next(at:number,excluded:ReadonlySet<string>,options:{requireOrigin?:boolean;preparation?:boolean;preparedMints?:readonly string[]}={}):WatchRow|null{
    this.at(at);if(options.preparedMints?.length===0)return null;this.expire(at);this.refreshProbeReadiness(at);
    if(this.durable()){
      const ready=this.readySql(at,options.preparation===true),notExcluded=[...excluded];
      const where=ready.where+(notExcluded.length?' AND w.mint NOT IN ('+notExcluded.map(()=>'?').join(',')+')':'')+(options.requireOrigin?' AND EXISTS (SELECT 1 FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1)':'')+(options.preparedMints?' AND w.mint IN ('+options.preparedMints.map(()=>'?').join(',')+')':'')+(options.preparation&&this.options.enforceTokenAge24h?" AND NOT EXISTS(SELECT 1 FROM observation_preparations prepared WHERE prepared.mint=w.mint AND prepared.pool=w.pool AND prepared.state='pool-ready' AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=w.mint))":'');
      const params=[...ready.params,...notExcluded,...(options.preparedMints??[])];
      // Unowned technical retries compete on current economics, retaining their
      // not-before and changed-evidence gates. Financial owners are separate.
      // Current broad-feed economics and bounded additive waiting credit rank
      // research only; unchanged-pool and financial gates above
      // remain prerequisites for every candidate, regardless of priority.
      this.flush();const selected=this.options.registry!.nextOpportunity({where,params},at,this.readyAnchorSql());if(!selected)return null;this.retain(selected.row);
      this.emit('pilot-watch-opportunity-priority',{at,mint:selected.row.mint,pool:selected.row.pool,...selected.hints,meaning:'Unverified scheduling hints; two-sided price stability is a limited activity proxy, not reserves, executable depth or causal price impact; no expected-profit, audit or execution claim'});return copy(selected.row);
    }
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
  /** Keyset pages are transport batches, never a registry admission limit. */
  listIdentityPage(options:{at?:number;after?:string;limit?:number;states?:WatchState[]}={}):WatchIdentityMetadata[]{
    const at=this.at(options.at??this.clock()),limit=options.limit??256;need(integer(limit)&&limit>0&&limit<=10000,'PILOT_WATCH_PAGE');this.expire(at);this.refreshProbeReadiness(at);
    if(this.durable()){this.flush();return this.options.registry!.listMetadata({...(options.after?{after:options.after}:{}),limit,...(options.states?{where:'w.state IN ('+options.states.map(()=>'?').join(',')+')',params:options.states}:{})});}
    return this.listIdentities(at).filter(r=>(!options.after||r.signature>options.after)&&(!options.states||options.states.includes(r.state))).sort((a,b)=>a.signature.localeCompare(b.signature)).slice(0,limit);
  }
  identitiesInStates(states:WatchState[],at=this.clock()):WatchIdentityMetadata[]{
    need(states.length>0&&states.every(s=>STATES.includes(s)),'PILOT_WATCH_STATE_QUERY');const result:WatchIdentityMetadata[]=[];let after:string|undefined;
    for(;;){const page=this.listIdentityPage({at,states,after,limit:256});result.push(...page);if(page.length<256)break;after=page.at(-1)!.signature;}return result;
  }
  /** Fresh bounded allocation metadata only. All fields are primitive copies;
   * history, capacity details and mutable older-selection evidence stay private. */
  listIdentities(at=this.clock()):WatchIdentityMetadata[]{
    this.at(at);this.expire(at);this.refreshProbeReadiness(at);
    need(!this.durable(),'PILOT_WATCH_PAGED_QUERY_REQUIRED');
    return [...this.rows.values()].map(r=>({mint:r.mint,pool:r.pool,signature:r.signature,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt,state:r.state,olderResearch:r.olderResearch!==undefined}));
  }
  allocationReadySince(mint:string,at=this.clock(),options:{requireOrigin?:boolean}={}):number|null{
    this.at(at);need(this.durable(),'PILOT_WATCH_DURABLE_BACKLOG_REQUIRED');return this.readOperation(()=>{
      const ready=this.readySql(at),where=ready.where+" AND w.mint=?"+(options.requireOrigin?" AND EXISTS(SELECT 1 FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1)":""),base=this.readyAnchorSql(),anchor=options.requireOrigin?"MAX("+base+",COALESCE((SELECT o.updated_at FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1),0))":base;
      const value=this.options.registry!.aggregate({since:'MAX('+anchor+')'},where,[...ready.params,mint]).since;return value===null?null:Math.min(at,value!);
    });
  }
  /** Local allocation predicates only. Global provider/financial runtime gates
   * remain separate; retained history and dormant records are not a queue. */
  serviceableBacklog(at=this.clock(),options:{requireOrigin?:boolean}={}){
    this.at(at);need(this.durable(),'PILOT_WATCH_DURABLE_BACKLOG_REQUIRED');
    return this.readOperation(()=>{
      const registry=this.options.registry!,ready=this.readySql(at),serviceable=ready.where+(options.requireOrigin?" AND EXISTS(SELECT 1 FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1)":"");
      const sameEligibility=serviceable===ready.where;
      const age=this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?'COALESCE(w.migration_at,0)<='+at:'w.migration_at<='+at+' AND '+at+'<w.migration_at+CASE WHEN w.older_research=1 THEN '+this.observationAgePolicy.selectedOlderMaximumAgeMs+' ELSE '+this.observationAgePolicy.recentMaximumAgeMs+' END';
      const waiting=this.observationIdentitySql()+" AND w.state IN ('WATCH','DEFERRED') AND "+age;
      const counts=registry.aggregate({retained:'COUNT(*)',activeDeep:"SUM(CASE WHEN w.deep_since IS NOT NULL AND w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING') THEN 1 ELSE 0 END)",verifiedAwaitingPrerequisites:'SUM(CASE WHEN '+waiting+' AND NOT ('+serviceable+') THEN 1 ELSE 0 END)'},undefined,ready.params);
      const retained=counts.retained??0,activeDeep=counts.activeDeep??0,verifiedAwaitingPrerequisites=counts.verifiedAwaitingPrerequisites??0;
      const since=this.readyAnchorSql(),serviceableSince=options.requireOrigin?"MAX("+since+",COALESCE((SELECT o.updated_at FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1),0))":since;
      const summarize=(where:string,anchor:string)=>registry.valueSummary({expression:'MAX(0,?-'+anchor+')',where,params:[at,...ready.params]});
      // Both queues have exactly the same predicates/anchor in current-pool
      // observation. Reuse this transaction's fresh result, not an older report;
      // independent value objects preserve the two reporting aliases.
      const eligibleQueue=summarize(ready.where,since),capacityQueue=sameEligibility&&serviceableSince===since?{...eligibleQueue}:summarize(serviceable,serviceableSince);
      // COUNT(*) in each exact quantile population is also its eligibility
      // count; repeating the full eligibility query cannot add information.
      const eligibleNow=eligibleQueue.count,serviceableNow=capacityQueue.count;
      return {population:{retained,verifiedAwaitingPrerequisites,eligibleNow,serviceableNow,capacityWaiting:Math.max(0,serviceableNow-Math.max(0,this.maximumDeep-activeDeep)),activeDeep},waits:{eligibleQueue,capacityQueue}};
    });
  }
  snapshot(at=this.clock(),strategy:'baseline'|'adaptive-momentum-v2'|'liquidity-resilient-momentum-v3'|'liquidity-resilient-momentum-v3.1'='baseline'){
    this.at(at);this.expire(at);this.refreshProbeReadiness(at);if(this.durable())return this.durableSnapshot(at,strategy);const rows=[...this.rows.values()],baselineEligible=rows.filter(r=>this.entryEligible(r,at)),observable=rows.filter(r=>this.observable(r,at)),adaptive=strategy==='adaptive-momentum-v2'||strategy==='liquidity-resilient-momentum-v3'||strategy==='liquidity-resilient-momentum-v3.1',eligible=adaptive?observable:baselineEligible,waiting=eligible.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status!=='AWAITING_CAPACITY'&&at>=r.deferUntil),waits=waiting.map(r=>Math.max(0,at-Math.max(r.waitingSince,(r.migrationAt??0)+(adaptive?0:MIN_AGE),this.identityAt(r)))),covered=eligible.filter(r=>r.everHadWindow&&r.lastWindowAt!==null&&r.lastWindowAt<=at&&(adaptive?this.observable(r,r.lastWindowAt):this.verified(r)&&entryAgeEligible(r.migrationAt!,r.lastWindowAt)));
    return {rows:copy(rows),summary:{observationAgePolicy:this.observationAgePolicy,...copy(this.counters),known:rows.length,maximumIdentities:this.maximum,maximumOlderResearchIdentities:this.olderMaximum,minimumPrimaryIdentityCapacity:this.maximum-this.olderMaximum,observationEligibleKnown:observable.length,observationCapacityAwaiting:observable.filter(r=>r.state==='DEFERRED'&&r.capacityCoverage?.status==='AWAITING_CAPACITY').length,observationCapacityProbeReady:observable.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status==='PROBE_READY').length,observationQueued:observable.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status!=='AWAITING_CAPACITY'&&at>=r.deferUntil&&this.olderDeepAvailable(r,at)).length,ageCohorts:{preEntry:observable.filter(r=>this.cohort(r,at)==='pre-entry').length,entryEligible:baselineEligible.length,olderSelected:observable.filter(r=>this.older(r,at)).length},watch:rows.filter(r=>['WATCH','DEFERRED'].includes(r.state)).length,capacityAwaiting:eligible.filter(r=>r.state==='DEFERRED'&&r.capacityCoverage?.status==='AWAITING_CAPACITY').length,capacityProbeReady:eligible.filter(r=>['WATCH','DEFERRED'].includes(r.state)&&r.capacityCoverage?.status==='PROBE_READY').length,unverified:rows.filter(r=>r.verifiedAt===null).length,eligibleKnown:eligible.length,deepActive:rows.filter(deep).length,maximumDeep:this.maximumDeep,queued:waiting.length,waitMs:{mean:waits.length?waits.reduce((a,b)=>a+b,0)/waits.length:0,maximum:waits.length?Math.max(...waits):0},promotionWaitMs:{mean:this.entryAgePromotionCount?this.counters.promotionWaitTotalMs/this.entryAgePromotionCount:0,maximum:this.counters.promotionWaitMaximumMs,entryAgePromotions:this.entryAgePromotionCount},coverage:{denominator:adaptive?'currently identified observation scopes retained for '+(strategy==='adaptive-momentum-v2'?'AdaptiveMomentumV2':strategy)+'; current account support remains separately required; at least one audited window during the configured observation horizon':'currently entry-age-eligible verified identities retained in this bounded registry; at least one audited window during this eligibility horizon',eligibleKnown:eligible.length,atLeastOneValidWindow:covered.length,percent:eligible.length?covered.length*100/eligible.length:null,wholeMarketPercent:null},states:Object.fromEntries(STATES.map(s=>[s,rows.filter(r=>r.state===s).length]))}};
  }
  private durableSnapshot(at:number,strategy:'baseline'|'adaptive-momentum-v2'|'liquidity-resilient-momentum-v3'|'liquidity-resilient-momentum-v3.1'){
    this.flush();const inspectionAt='@inspectionAt';const adaptive=strategy!=='baseline',age=this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?'COALESCE(w.migration_at,0)<='+inspectionAt:'w.migration_at<='+inspectionAt+' AND '+inspectionAt+'<w.migration_at+CASE WHEN w.older_research=1 THEN '+this.observationAgePolicy.selectedOlderMaximumAgeMs+' ELSE '+this.observationAgePolicy.recentMaximumAgeMs+' END';
    const verified="w.migration_at IS NOT NULL AND w.verified_at IS NOT NULL AND w.mint IS NOT NULL AND w.pool IS NOT NULL AND w.state NOT IN ('EXPIRED','PERMANENTLY_UNSUPPORTED')";
    const observable='('+this.observationIdentitySql()+" AND w.state NOT IN ('EXPIRED','PERMANENTLY_UNSUPPORTED') AND "+age+this.tokenAgeSql(inspectionAt)+')',baseline='('+verified+' AND w.migration_at+'+MIN_AGE+'<='+inspectionAt+' AND '+inspectionAt+'<w.migration_at+'+MAX_AGE+')';
    const waiting="w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=1 AND COALESCE(w.capacity_status,'')!='AWAITING_CAPACITY' AND w.defer_until<="+inspectionAt;
    const count=(condition:string)=>'SUM(CASE WHEN '+condition+' THEN 1 ELSE 0 END)',wait='MAX(0,'+inspectionAt+'-MAX(w.waiting_since,COALESCE(w.migration_at,0)+'+(adaptive?0:MIN_AGE)+",COALESCE(w.verified_at,json_extract(w.body,'$.observationIdentity.availableAt'),w.first_seen_at)))";
    const covered='w.ever_had_window=1 AND w.last_window_at IS NOT NULL AND w.last_window_at<='+inspectionAt+(adaptive?" AND w.last_window_at>=COALESCE(w.migration_at,json_extract(w.body,'$.observationIdentity.availableAt'),w.first_seen_at)":' AND w.last_window_at>=w.migration_at+'+MIN_AGE+' AND w.last_window_at<w.migration_at+'+MAX_AGE);
    const aggregate=(expressions:Record<string,string>,where?:string)=>{const parameters:number[]=[],bind=(expression:string)=>expression.replaceAll(inspectionAt,()=>{parameters.push(at);return '?';}),bound=Object.fromEntries(Object.entries(expressions).map(([key,expression])=>[key,bind(expression)])),predicate=where===undefined?undefined:bind(where);return this.options.registry!.aggregate(bound,predicate,parameters);};
    const common:Record<string,string>={unchangedEconomic:count("w.last_decision_kind='economic-rejection' AND w.reobserve_ready=0 AND w.state IN ('WATCH','DEFERRED')"),unchangedTechnical:count("w.last_decision_kind='technical-unavailable' AND w.reobserve_ready=0 AND w.state IN ('WATCH','DEFERRED')"),known:'COUNT(*)',watch:count("w.state IN ('WATCH','DEFERRED')"),unverified:count('w.verified_at IS NULL'),deep:count("w.deep_since IS NOT NULL AND w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING')")};
    for(const state of STATES)common['state_'+state]=count("w.state='"+state+"'");
    const observation={observable:'COUNT(*)',observationQueued:count(waiting),preEntry:count(inspectionAt+'<w.migration_at+'+MIN_AGE),older:count(inspectionAt+'>=w.migration_at+'+MAX_AGE),observationAwaiting:count("w.state='DEFERRED' AND w.capacity_status='AWAITING_CAPACITY'"),observationProbe:count("w.state IN ('WATCH','DEFERRED') AND w.capacity_status='PROBE_READY'")};
    const selected={eligible:'COUNT(*)',queued:count(waiting),covered:count(covered),waitTotal:'SUM(CASE WHEN '+waiting+' THEN '+wait+' ELSE 0 END)',waitMaximum:'MAX(CASE WHEN '+waiting+' THEN '+wait+' ELSE 0 END)',awaiting:count("w.state='DEFERRED' AND w.capacity_status='AWAITING_CAPACITY'"),probe:count("w.state IN ('WATCH','DEFERRED') AND w.capacity_status='PROBE_READY'")};
    // Evaluate each expensive identity/age predicate once as the WHERE of its
    // complete current population. The old single SELECT repeated it in every
    // aggregate, including rows which could contribute to none of those sums.
    // Every group reads the same readOperation snapshot; no rows are capped or
    // hydrated and no population is retained between reports.
    const raw={...aggregate(common),...(adaptive?aggregate({...observation,...selected},observable):{...aggregate(observation,observable),...aggregate(selected,baseline)})};
    raw.baseline=adaptive?aggregate({baseline:'COUNT(*)'},baseline).baseline??0:raw.eligible??0;
    const n=(key:string)=>raw[key]??0;
    // A bounded report page is explicitly a projection. Counts above cover the
    // complete indexed registry and are never inferred from this page.
    const rows=this.query('1=1',[],"CASE WHEN w.state IN ('HELD','ENTRY_PENDING','DEEP_OBSERVATION','QUALIFIED') THEN 0 ELSE 1 END,COALESCE(w.last_activity_at,w.first_seen_at) DESC,w.signature",64);
    const eligibleKnown=n('eligible'),queued=n('queued');return {rows:copy(rows),summary:{observationAgePolicy:this.observationAgePolicy,...copy(this.counters),known:n('known'),maximumIdentities:null,maximumOlderResearchIdentities:null,minimumPrimaryIdentityCapacity:null,observationEligibleKnown:n('observable'),observationCapacityAwaiting:n('observationAwaiting'),observationCapacityProbeReady:n('observationProbe'),observationQueued:n('observationQueued'),ageCohorts:{preEntry:n('preEntry'),entryEligible:n('baseline'),olderSelected:n('older')},watch:n('watch'),capacityAwaiting:n('awaiting'),capacityProbeReady:n('probe'),unverified:n('unverified'),eligibleKnown,deepActive:n('deep'),maximumDeep:this.maximumDeep,queued,waitMs:{mean:queued?n('waitTotal')/queued:0,maximum:n('waitMaximum')},promotionWaitMs:{mean:this.entryAgePromotionCount?this.counters.promotionWaitTotalMs/this.entryAgePromotionCount:0,maximum:this.counters.promotionWaitMaximumMs,entryAgePromotions:this.entryAgePromotionCount},coverage:{denominator:adaptive?'currently identified observation scopes in the durable configured market registry; current account support remains separately required; at least one audited window; feed-wide market denominator independently unknown':'all currently entry-age-eligible verified identities in the durable registry',eligibleKnown,atLeastOneValidWindow:n('covered'),percent:eligibleKnown?n('covered')*100/eligibleKnown:null,wholeMarketPercent:null},states:Object.fromEntries(STATES.map(state=>[state,n('state_'+state)])),projection:{returned:rows.length,total:n('known'),complete:rows.length===n('known'),purpose:'bounded operational report page; use indexed keyset pages for discovery consumers'},storage:'persistent-market-registry-v1',reobservation:{awaitingEconomicChange:n('unchangedEconomic'),awaitingSourceProgress:n('unchangedTechnical'),permanentRejections:0,meaning:'Dormant records remain in durable lightweight awareness; no repeated expensive observation without relevant new evidence.'}}};
  }
  export():WatchCheckpoint{return {schemaVersion:1,...(this.durable()?{registry:{version:'persistent-market-registry-v1' as const,id:this.registryIdentity}}:{}),...(this.checkpointObservationAgePolicy!==OBSERVATION_AGE_POLICY?{observationAgePolicyVersion:this.checkpointObservationAgePolicy.version}:{}),rows:this.durable()?[]:copy([...this.rows.values()]),counters:copy(this.counters),capacityProbeAdmissions:copy(this.capacityProbeAdmissions),entryAgePromotionCount:this.entryAgePromotionCount};}
  private restore(value:unknown){
    need(value&&typeof value==='object'&&!Array.isArray(value),'PILOT_WATCH_CHECKPOINT');const v=value as WatchCheckpoint;need(!v.registry||this.durable()&&v.registry.version==='persistent-market-registry-v1','PILOT_WATCH_REGISTRY_REQUIRED');
    const checkpointPolicy=observationAgePolicyByVersion(v.observationAgePolicyVersion);
    // Preserve selection provenance on another checkpoint even when the active
    // policy is narrower; otherwise a second resume could reject owned records.
    if(checkpointPolicy.selectedOlderMaximumAgeMs>this.checkpointObservationAgePolicy.selectedOlderMaximumAgeMs)this.checkpointObservationAgePolicy=checkpointPolicy;
    if(checkpointPolicy!==this.observationAgePolicy)this.emit('pilot-watch-observation-policy-transition',{at:this.clock(),checkpointSelectionPolicy:checkpointPolicy.version,current:this.observationAgePolicy.version,freshFullWindowRequired:true,entryPermission:false,selectedCohortBiased:true});
    need(v.schemaVersion===1&&Array.isArray(v.rows)&&(this.durable()||v.rows.length<=this.maximum)&&v.counters&&typeof v.counters==='object'&&Object.keys(initialCounters()).every(k=>integer(v.counters[k as keyof Counters])),'PILOT_WATCH_CHECKPOINT');
    this.counters=copy(v.counters);const mints=new Set<string>();for(const sourceRow of v.rows){const r=copy(sourceRow);
      need(r&&text(r.signature,100)&&!this.rows.has(r.signature)&&(r.feedMint===null||text(r.feedMint,96))&&(r.mint===null||text(r.mint,96))&&(r.pool===null||text(r.pool,96))&&STATES.includes(r.state)&&text(r.reason)&&integer(r.firstSeenAt)&&integer(r.deferUntil)&&integer(r.waitingSince)&&[r.migrationAt,r.verifiedAt,r.lastActivityAt,r.lastDemotedAt,r.deepSince,r.lastWindowAt].every(n=>n===null||integer(n))&&[r.promotions,r.repromotions,r.demotions,r.completeWindows].every(integer)&&typeof r.everHadWindow==='boolean'&&(r.lastActivityEvidence===null||text(r.lastActivityEvidence,256))&&Array.isArray(r.history)&&r.history.length<=16&&r.history.every(h=>integer(h.at)&&STATES.includes(h.state)&&text(h.reason)),'PILOT_WATCH_CHECKPOINT_ROW');
      if(r.observationIdentity!==undefined){const o=r.observationIdentity;need(o&&o.basis==='canonical-pool-hint'&&integer(o.availableAt)&&o.availableAt<=this.clock()&&text(o.evidence,512)&&r.mint!==null&&r.pool!==null,'PILOT_WATCH_CHECKPOINT_OBSERVATION_IDENTITY');canonicalObservationPool(r.mint,r.pool);if(o.currentPool){assertNativeCurrentPoolIdentityProof(o.currentPool,this.clock());need(o.currentPool.mint===r.mint&&o.currentPool.pool===r.pool&&o.currentPool.verifiedAt>=o.availableAt,'PILOT_WATCH_CHECKPOINT_CURRENT_POOL');}}
      this.repairPredecisionReady(r,'checkpoint');
      if(r.reobservation!==undefined){const g=r.reobservation;need(g&&['economic-rejection','technical-unavailable'].includes(g.kind)&&integer(g.decisionAt)&&g.decisionAt<=this.clock()&&(g.windowEndAt===null?g.kind==='technical-unavailable':integer(g.windowEndAt)&&g.windowEndAt<=g.decisionAt)&&text(g.evidence,512)&&(g.minimumEconomicChangeLamports===null||/^(0|[1-9][0-9]{0,38})$/.test(g.minimumEconomicChangeLamports))&&(g.ready===null||integer(g.ready.at)&&g.ready.at>=g.decisionAt&&g.ready.at<=this.clock()&&text(g.ready.reason)&&text(g.ready.evidence,512))&&(g.baseline===null||g.baseline&&/^(0|[1-9][0-9]{0,38})$/.test(g.baseline.buyLamports)&&/^(0|[1-9][0-9]{0,38})$/.test(g.baseline.sellLamports)&&[g.baseline.buyHints,g.baseline.sellHints,g.baseline.activityHints].every(integer)&&text(g.baseline.fingerprint,512))&&(g.relevantEvidence===undefined||['audited-flow','pool-reserves','liquidity','source-recovery','migration-hint','pool-hint'].includes(g.relevantEvidence.kind)&&integer(g.relevantEvidence.at)&&g.relevantEvidence.at<=this.clock()&&text(g.relevantEvidence.fingerprint,512)),'PILOT_WATCH_CHECKPOINT_REOBSERVATION');}
      if(r.olderResearch!==undefined){const o=r.olderResearch;need(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')==='activityAt,evidence,selectedAt'&&integer(o.selectedAt)&&integer(o.activityAt)&&o.activityAt<=o.selectedAt&&o.selectedAt-o.activityAt<=OBSERVATION_AGE_POLICY.olderActivityMaximumAgeMs&&text(o.evidence,256)&&r.migrationAt!==null&&o.selectedAt>=r.migrationAt+MAX_AGE&&o.selectedAt<observationExpiryAt(r.migrationAt,true,checkpointPolicy)&&o.selectedAt<=this.clock(),'PILOT_WATCH_CHECKPOINT_OLDER_RESEARCH');}
      if(r.capacityCoverage!==undefined){const c=r.capacityCoverage;need(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')==='lastDemand,lostAt,probeAdmissions,reason,reassessAt,status'&&['AWAITING_CAPACITY','PROBE_READY','OBSERVING','VALID_WINDOW','OTHER_UNAVAILABLE'].includes(c.status)&&text(c.reason)&&integer(c.lostAt)&&integer(c.reassessAt)&&c.reassessAt>=c.lostAt&&(c.lastDemand===null||validDemand(c.lastDemand)&&c.lastDemand.observedAt<=this.clock())&&Array.isArray(c.probeAdmissions)&&c.probeAdmissions.length<=2&&c.probeAdmissions.every((at,i)=>integer(at)&&at<=this.clock()&&(i===0||at>c.probeAdmissions[i-1]!))&&this.identified(r),'PILOT_WATCH_CHECKPOINT_CAPACITY');}
      if(r.technicalReevaluation!==undefined){const t=r.technicalReevaluation;need(t&&typeof t==='object'&&!Array.isArray(t)&&Object.keys(t).sort().join(',')==='attempts,expiresAt,failedWindowEndAt,lastClaimedWindowEndAt,notBefore,reason,requestedAt,state'&&TECHNICAL_REEVALUATION_REASONS.includes(t.reason)&&integer(t.requestedAt)&&this.identified(r)&&t.requestedAt>=this.identityAt(r)&&t.requestedAt<=this.clock()&&integer(t.failedWindowEndAt)&&t.failedWindowEndAt<=t.requestedAt&&integer(t.notBefore)&&t.notBefore>=t.requestedAt+TECHNICAL_REEVALUATION_POLICY.backoffMs[0]&&integer(t.expiresAt)&&t.expiresAt===t.requestedAt+TECHNICAL_REEVALUATION_POLICY.lifetimeMs&&integer(t.attempts)&&t.attempts<=TECHNICAL_REEVALUATION_POLICY.maximumAttempts&&['WAITING','CLAIMED','EXHAUSTED','EXPIRED','FINISHED'].includes(t.state)&&(t.attempts===0?t.lastClaimedWindowEndAt===null:integer(t.lastClaimedWindowEndAt)&&t.lastClaimedWindowEndAt>t.failedWindowEndAt&&t.lastClaimedWindowEndAt<=this.clock())&&(t.state!=='CLAIMED'||t.attempts>0)&&(t.state!=='EXHAUSTED'||t.attempts===TECHNICAL_REEVALUATION_POLICY.maximumAttempts)&&(t.state!=='WAITING'||t.attempts<TECHNICAL_REEVALUATION_POLICY.maximumAttempts),'PILOT_WATCH_CHECKPOINT_TECHNICAL_REEVALUATION');}
      need((r.verifiedAt===null)===(r.migrationAt===null)&&(r.mint===null)===(r.pool===null)&&(r.mint===null?r.verifiedAt===null&&r.observationIdentity===undefined:r.verifiedAt!==null||r.observationIdentity!==undefined)&&(!r.mint||!mints.has(r.mint)),'PILOT_WATCH_CHECKPOINT_IDENTITY');if(r.mint)mints.add(r.mint);
      if(r.verifiedAt!==null)need(r.migrationAt!<=r.verifiedAt&&r.verifiedAt<=this.clock(),'PILOT_WATCH_CHECKPOINT_TIME');
      const restored=copy(r);if(['DEEP_OBSERVATION','QUALIFIED'].includes(restored.state)){this.history(restored,this.clock(),'DEFERRED','research process restarted; previous flow is unavailable; fresh full window required');restored.deepSince=null;restored.lastDemotedAt=this.clock();restored.waitingSince=this.clock();restored.deferUntil=this.clock();if(restored.capacityCoverage){restored.capacityCoverage.status='AWAITING_CAPACITY';restored.capacityCoverage.reason=restored.reason;restored.capacityCoverage.reassessAt=this.clock()+5000;}restored.demotions++;this.counters.demoted++;this.emit('pilot-watch-recovery-demotion',{mint:restored.mint,at:this.clock(),priorState:r.state,freshFullWindowRequired:true});}if(restored.state==='ENTRY_PENDING'){restored.deepSince=null;this.emit('pilot-watch-owned-recovery',{mint:restored.mint,at:this.clock(),state:'ENTRY_PENDING',freshFlowUnavailable:true,financialObligationRetained:true});}
      const technical=this.refreshTechnicalReevaluation(restored,this.clock());if(technical?.state==='CLAIMED'){const previousNotBefore=technical.notBefore;technical.state=technical.attempts>=TECHNICAL_REEVALUATION_POLICY.maximumAttempts?'EXHAUSTED':'WAITING';technical.notBefore=this.clock()+TECHNICAL_REEVALUATION_POLICY.restartDelayMs;this.emit('pilot-watch-technical-reevaluation-recovered',{mint:restored.mint,at:this.clock(),...copy(technical),previousNotBefore,claimConsumedBeforeRestart:true,newerWindowRequired:true,financialOutcomeUnknown:true,financialPermission:false});}
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
    need(this.durable()||this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY||[...this.rows.values()].filter(r=>r.olderResearch&&observationAgeEligible(r.migrationAt!,this.clock(),true,this.observationAgePolicy)&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(r.state)).length<=this.olderMaximum,'PILOT_WATCH_CHECKPOINT_OLDER_CAPACITY');
    need([...this.rows.values()].filter(deep).length<=this.maximumDeep,'PILOT_WATCH_CHECKPOINT_DEEP_CAPACITY');
  }
}
