/** Pure nonfinancial registry reporting. No watch/engine construction, source
 * scheduling, financial state, permission, provider request or membership write.
 * Callers retain the original sample time; the SQL reads one guarded snapshot. */
import type {MarketRegistry,RegistryReportingIndex} from './market-registry.js';
import type {WatchCheckpoint} from './pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY,type ObservationAgePolicy} from './observation-age.js';
import {TOKEN_AGE_POLICY} from './token-age-policy.js';
export type WatchRegistryReportingScope={observationAgePolicy:ObservationAgePolicy;maximumDeep:number;enforceTokenAge24h?:boolean;pumpswapOnly?:boolean};
export type WatchRegistryReportingState=Pick<WatchCheckpoint,'counters'>&{entryAgePromotionCount:number};
export type WatchReportingStrategy='baseline'|'adaptive-momentum-v2'|'liquidity-resilient-momentum-v3'|'liquidity-resilient-momentum-v3.1';
const MIN_AGE=300000,MAX_AGE=7200000;
const STATES=['DISCOVERED','VERIFYING','WATCH','DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING','HELD','DEFERRED','EXPIRED','PERMANENTLY_UNSUPPORTED'] as const;
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function watchReportingIdentitySql(scope:WatchRegistryReportingScope){return "w.mint IS NOT NULL AND w.pool IS NOT NULL AND "+(scope.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?"((w.migration_at IS NOT NULL AND w.verified_at IS NOT NULL) OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint')":"w.migration_at IS NOT NULL AND w.verified_at IS NOT NULL");}
export function watchReportingReadyAnchorSql(registry:MarketRegistry,scope:WatchRegistryReportingScope){return "MAX(w.waiting_since,COALESCE(w.verified_at,json_extract(w.body,'$.observationIdentity.availableAt'),w.first_seen_at),COALESCE(w.migration_at,0),w.defer_until,COALESCE(json_extract(w.body,'$.reobservation.ready.at'),0)"+(scope.enforceTokenAge24h?`,COALESCE((SELECT verified_at FROM ${registry.admissionAgeTable} age WHERE age.mint=w.mint),0)`:"")+")";}
export function watchReportingTokenAgeSql(registry:MarketRegistry,scope:WatchRegistryReportingScope,at:string){return scope.enforceTokenAge24h?` AND ${registry.admissionAgeSql('w.mint',at)}`:'';}
export function watchReportingReadySql(registry:MarketRegistry,scope:WatchRegistryReportingScope,at:number,preparation=false){
    const persistent=scope.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY,age=persistent?'COALESCE(w.migration_at,0)<=?':'w.migration_at<=? AND ?<w.migration_at+CASE WHEN w.older_research=1 THEN ? ELSE ? END';
    const identity=(persistent?"(w.verified_at IS NOT NULL OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint')":"w.verified_at IS NOT NULL")+(scope.pumpswapOnly?' AND EXISTS(SELECT 1 FROM pumpswap_hint_tokens swap WHERE swap.mint=w.mint)':'');
    return {where:"w.mint IS NOT NULL AND w.pool IS NOT NULL AND "+identity+" AND w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=1 AND COALESCE(w.capacity_status,'')!='AWAITING_CAPACITY' AND w.defer_until<=? AND (w.technical_state IS NULL OR w.technical_state!='WAITING' OR w.technical_not_before<=?) AND "+age+(preparation&&scope.enforceTokenAge24h?` AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=w.mint AND (age.created_at>? OR age.created_at<? OR age.verified_at>?))`:watchReportingTokenAgeSql(registry,scope,'?')),params:[...(persistent?[at,at,at]:[at,at,at,at,scope.observationAgePolicy.selectedOlderMaximumAgeMs,scope.observationAgePolicy.recentMaximumAgeMs]),...(scope.enforceTokenAge24h?(preparation?[at,at-TOKEN_AGE_POLICY.maximumAgeMs,at]:[at,at,at]):[])]};
  }

export function readWatchRegistrySnapshot(registry:MarketRegistry,scope:WatchRegistryReportingScope,state:WatchRegistryReportingState,at:number,strategy:WatchReportingStrategy){
 return registry.readTransaction(()=>{
    const inspectionAt='@inspectionAt';const adaptive=strategy!=='baseline',age=scope.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?'COALESCE(w.migration_at,0)<='+inspectionAt:'w.migration_at<='+inspectionAt+' AND '+inspectionAt+'<w.migration_at+CASE WHEN w.older_research=1 THEN '+scope.observationAgePolicy.selectedOlderMaximumAgeMs+' ELSE '+scope.observationAgePolicy.recentMaximumAgeMs+' END';
    const verified="w.migration_at IS NOT NULL AND w.verified_at IS NOT NULL AND w.mint IS NOT NULL AND w.pool IS NOT NULL AND w.state NOT IN ('EXPIRED','PERMANENTLY_UNSUPPORTED')";
    const observable='('+watchReportingIdentitySql(scope)+" AND w.state NOT IN ('EXPIRED','PERMANENTLY_UNSUPPORTED') AND "+age+watchReportingTokenAgeSql(registry,scope,inspectionAt)+')',baseline='('+verified+' AND w.migration_at<='+inspectionAt+'-'+MIN_AGE+' AND w.migration_at>'+inspectionAt+'-'+MAX_AGE+')';
    const waiting="w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=1 AND COALESCE(w.capacity_status,'')!='AWAITING_CAPACITY' AND w.defer_until<="+inspectionAt;
    const count=(condition:string)=>'SUM(CASE WHEN '+condition+' THEN 1 ELSE 0 END)',wait='MAX(0,'+inspectionAt+'-MAX(w.waiting_since,COALESCE(w.migration_at,0)+'+(adaptive?0:MIN_AGE)+",COALESCE(w.verified_at,json_extract(w.body,'$.observationIdentity.availableAt'),w.first_seen_at)))";
    const covered='w.ever_had_window=1 AND w.last_window_at IS NOT NULL AND w.last_window_at<='+inspectionAt+(adaptive?" AND w.last_window_at>=COALESCE(w.migration_at,json_extract(w.body,'$.observationIdentity.availableAt'),w.first_seen_at)":' AND w.last_window_at>=w.migration_at+'+MIN_AGE+' AND w.last_window_at<w.migration_at+'+MAX_AGE);
    const aggregate=(expressions:Record<string,string>,where?:string,tokenAgeAt?:number,index:RegistryReportingIndex='watch_rows_report_summary_v1')=>{const parameters:number[]=[],bind=(expression:string)=>expression.replaceAll(inspectionAt,()=>{parameters.push(at);return '?';}),bound=Object.fromEntries(Object.entries(expressions).map(([key,expression])=>[key,bind(expression)])),predicate=where===undefined?undefined:bind(where);return registry.aggregate(bound,predicate,parameters,index,tokenAgeAt);};
    const common=registry.watchReportingPopulation(),tokenAgeAt=scope.enforceTokenAge24h?at:undefined;
    const observation={observable:'COUNT(*)',observationQueued:count(waiting),preEntry:count(inspectionAt+'<w.migration_at+'+MIN_AGE),older:count(inspectionAt+'>=w.migration_at+'+MAX_AGE),observationAwaiting:count("w.state='DEFERRED' AND w.capacity_status='AWAITING_CAPACITY'"),observationProbe:count("w.state IN ('WATCH','DEFERRED') AND w.capacity_status='PROBE_READY'")};
    const selected={eligible:'COUNT(*)',queued:count(waiting),covered:count(covered),waitTotal:'SUM(CASE WHEN '+waiting+' THEN '+wait+' ELSE 0 END)',waitMaximum:'MAX(CASE WHEN '+waiting+' THEN '+wait+' ELSE 0 END)',awaiting:count("w.state='DEFERRED' AND w.capacity_status='AWAITING_CAPACITY'"),probe:count("w.state IN ('WATCH','DEFERRED') AND w.capacity_status='PROBE_READY'")};
    // Evaluate each expensive identity/age predicate once as the WHERE of its
    // complete current population. The old single SELECT repeated it in every
    // aggregate, including rows which could contribute to none of those sums.
    // Every group reads the same guarded snapshot. Full populations are never
    // hydrated or capped; detached consumers retain the original sample time.
    const raw={...common,...(adaptive?aggregate({...observation,...selected},observable,tokenAgeAt):{...aggregate(observation,observable,tokenAgeAt),...aggregate(selected,baseline)})};
    raw.baseline=adaptive?aggregate({baseline:'COUNT(*)'},baseline,undefined,'watch_rows_report_entry_age_v2').baseline??0:raw.eligible??0;
    const n=(key:string)=>raw[key]??0;
    // A bounded report page is explicitly a projection. Counts above cover the
    // complete indexed registry and are never inferred from this page.
    const rows=registry.queryRows({where:'1=1',orderBy:"CASE WHEN w.state IN ('HELD','ENTRY_PENDING','DEEP_OBSERVATION','QUALIFIED') THEN 0 ELSE 1 END,COALESCE(w.last_activity_at,w.first_seen_at) DESC,w.signature",limit:64,index:'watch_rows_report_page_v1'});
    const eligibleKnown=n('eligible'),queued=n('queued');return {rows:copy(rows),summary:{observationAgePolicy:scope.observationAgePolicy,...copy(state.counters),known:n('known'),maximumIdentities:null,maximumOlderResearchIdentities:null,minimumPrimaryIdentityCapacity:null,observationEligibleKnown:n('observable'),observationCapacityAwaiting:n('observationAwaiting'),observationCapacityProbeReady:n('observationProbe'),observationQueued:n('observationQueued'),ageCohorts:{preEntry:n('preEntry'),entryEligible:n('baseline'),olderSelected:n('older')},watch:n('watch'),capacityAwaiting:n('awaiting'),capacityProbeReady:n('probe'),unverified:n('unverified'),eligibleKnown,deepActive:n('deep'),maximumDeep:scope.maximumDeep,queued,waitMs:{mean:queued?n('waitTotal')/queued:0,maximum:n('waitMaximum')},promotionWaitMs:{mean:state.entryAgePromotionCount?state.counters.promotionWaitTotalMs/state.entryAgePromotionCount:0,maximum:state.counters.promotionWaitMaximumMs,entryAgePromotions:state.entryAgePromotionCount},coverage:{denominator:adaptive?'currently identified observation scopes in the durable configured market registry; current account support remains separately required; at least one audited window; feed-wide market denominator independently unknown':'all currently entry-age-eligible verified identities in the durable registry',eligibleKnown,atLeastOneValidWindow:n('covered'),percent:eligibleKnown?n('covered')*100/eligibleKnown:null,wholeMarketPercent:null},states:Object.fromEntries(STATES.map(state=>[state,n('state_'+state)])),projection:{returned:rows.length,total:n('known'),complete:rows.length===n('known'),purpose:'bounded operational report page; use indexed keyset pages for discovery consumers'},storage:'persistent-market-registry-v1',reobservation:{awaitingEconomicChange:n('unchangedEconomic'),awaitingSourceProgress:n('unchangedTechnical'),permanentRejections:0,meaning:'Dormant records remain in durable lightweight awareness; no repeated expensive observation without relevant new evidence.'}}};

 });
}

export function readWatchRegistryBacklog(registry:MarketRegistry,scope:WatchRegistryReportingScope,at:number,options:{requireOrigin?:boolean}={}){
 return registry.readTransaction(()=>{
      const ready=watchReportingReadySql(registry,scope,at),serviceable=ready.where+(options.requireOrigin?" AND EXISTS(SELECT 1 FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1)":"");
      const sameEligibility=serviceable===ready.where;
      const age=scope.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?'COALESCE(w.migration_at,0)<='+at:'w.migration_at<='+at+' AND '+at+'<w.migration_at+CASE WHEN w.older_research=1 THEN '+scope.observationAgePolicy.selectedOlderMaximumAgeMs+' ELSE '+scope.observationAgePolicy.recentMaximumAgeMs+' END';
      const waiting=watchReportingIdentitySql(scope)+" AND w.state IN ('WATCH','DEFERRED') AND "+age;
      const population=registry.watchReportingPopulation(),retained=population.known??0,activeDeep=population.deep??0;
      // With verified token age required, only that exact current indexed
      // population can satisfy serviceability (or leave it SQL NULL). Count the
      // cheap waiting population once, then subtract those exceptions; do not
      // probe age/origin prerequisites for every retained historical identity.
      // IS NOT FALSE deliberately includes NULL: NOT(serviceable) excluded
      // unknown prerequisites in the original CASE expression too. Every count
      // shares this readOperation snapshot, including the common state totals.
      const waitingIndex=scope.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?'watch_rows_report_waiting_v2':'watch_rows_report_summary_v1';
      const verifiedAwaitingPrerequisites=scope.enforceTokenAge24h?
        (registry.aggregate({waiting:'COUNT(*)'},waiting,[],waitingIndex).waiting??0)-
        (registry.aggregate({notAwaiting:'COUNT(*)'},'('+waiting+') AND (('+serviceable+') IS NOT FALSE)',ready.params,'watch_rows_report_summary_v1',at).notAwaiting??0):
        registry.aggregate({awaiting:'SUM(CASE WHEN '+waiting+' AND NOT ('+serviceable+') THEN 1 ELSE 0 END)'},undefined,ready.params,'watch_rows_report_summary_v1').awaiting??0;
      const since=watchReportingReadyAnchorSql(registry,scope),serviceableSince=options.requireOrigin?"MAX("+since+",COALESCE((SELECT o.updated_at FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1),0))":since;
      const summarize=(where:string,anchor:string)=>registry.valueSummary({expression:'MAX(0,?-'+anchor+')',where,params:[at,...ready.params],index:'watch_rows_report_summary_v1',...(scope.enforceTokenAge24h?{tokenAgeAt:at}:{})});
      // Both queues have exactly the same predicates/anchor in current-pool
      // observation. Reuse this transaction's fresh result, not an older report;
      // independent value objects preserve the two reporting aliases.
      const eligibleQueue=summarize(ready.where,since),capacityQueue=sameEligibility&&serviceableSince===since?{...eligibleQueue}:summarize(serviceable,serviceableSince);
      // COUNT(*) in each exact quantile population is also its eligibility
      // count; repeating the full eligibility query cannot add information.
      const eligibleNow=eligibleQueue.count,serviceableNow=capacityQueue.count;
      return {population:{retained,verifiedAwaitingPrerequisites,eligibleNow,serviceableNow,capacityWaiting:Math.max(0,serviceableNow-Math.max(0,scope.maximumDeep-activeDeep)),activeDeep},waits:{eligibleQueue,capacityQueue}};

 });
}
