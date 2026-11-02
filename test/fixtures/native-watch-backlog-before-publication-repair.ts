/** OFFLINE parity/profile oracle: exact serviceableBacklog method from released
 * 92d83ba59d542fa2dfb20bca4444b704666f9c05. Source SHA256:
 * 6aeb9a0518516a86dbe3f6a3921ccbc8836c3b7832f47eaae98b28fc97e777f0. */
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../../src/observation-age.js';
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
export function releasedServiceableBacklog(this:any,at=this.clock(),options:{requireOrigin?:boolean}={}){
    this.at(at);need(this.durable(),'PILOT_WATCH_DURABLE_BACKLOG_REQUIRED');
    return this.readOperation(()=>{
      const registry=this.options.registry!,ready=this.readySql(at),serviceable=ready.where+(options.requireOrigin?" AND EXISTS(SELECT 1 FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1)":"");
      const sameEligibility=serviceable===ready.where;
      const age=this.observationAgePolicy===PERSISTENT_OBSERVABLE_MARKET_POLICY?'COALESCE(w.migration_at,0)<='+at:'w.migration_at<='+at+' AND '+at+'<w.migration_at+CASE WHEN w.older_research=1 THEN '+this.observationAgePolicy.selectedOlderMaximumAgeMs+' ELSE '+this.observationAgePolicy.recentMaximumAgeMs+' END';
      const waiting=this.observationIdentitySql()+" AND w.state IN ('WATCH','DEFERRED') AND "+age;
      const counts=registry.aggregate({retained:'COUNT(*)',activeDeep:"SUM(CASE WHEN w.deep_since IS NOT NULL AND w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING') THEN 1 ELSE 0 END)",verifiedAwaitingPrerequisites:'SUM(CASE WHEN '+waiting+' AND NOT ('+serviceable+') THEN 1 ELSE 0 END)'},undefined,ready.params,'watch_rows_report_summary_v1');
      const retained=counts.retained??0,activeDeep=counts.activeDeep??0,verifiedAwaitingPrerequisites=counts.verifiedAwaitingPrerequisites??0;
      const since=this.readyAnchorSql(),serviceableSince=options.requireOrigin?"MAX("+since+",COALESCE((SELECT o.updated_at FROM origin_proofs o WHERE o.mint=w.mint AND o.available=1),0))":since;
      const summarize=(where:string,anchor:string)=>registry.valueSummary({expression:'MAX(0,?-'+anchor+')',where,params:[at,...ready.params],index:'watch_rows_report_summary_v1',...(this.options.enforceTokenAge24h?{tokenAgeAt:at}:{})});
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
