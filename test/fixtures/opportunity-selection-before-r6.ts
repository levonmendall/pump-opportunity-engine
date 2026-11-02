/** Frozen deployed 985b/295c11f selector for exact full-population parity tests. */
import type Database from 'better-sqlite3';
import type {WatchRow} from '../../src/pilot-watch.js';
import {SHARED_ACTIVITY_HORIZON_MS,type RegistryQuery,type ObservationPriorityHints} from '../../src/market-registry.js';
import {OPPORTUNITY_PRIORITY_POLICY,observationFairnessBonus} from '../../src/opportunity-priority-policy.js';
import {TOKEN_AGE_POLICY} from '../../src/token-age-policy.js';
type LegacyRegistryAccess={statement(sql:string):Database.Statement};
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}

export function legacyOpportunitySelection(this:LegacyRegistryAccess,q:RegistryQuery,at:number,readyAnchorSql:string,preparationWithTokenAge=false):{row:WatchRow;hints:ObservationPriorityHints}|undefined{
  need(integer(at),'MARKET_REGISTRY_OPPORTUNITY_TIME');
  if(!this.statement(`SELECT 1 FROM watch_rows w WHERE w.archived=0${q.where?` AND (${q.where})`:''} LIMIT 1`).get(...(q.params??[])))return undefined;
  const recent=at-SHARED_ACTIVITY_HORIZON_MS,prior=Math.max(0,at-2*SHARED_ACTIVITY_HORIZON_MS);
  // Preparation precedes immutable age verification. Prefer candidates that
  // already have valid age or can request its proof now, before work with no
  // current route to admission. The request predicates match the existing
  // creation dispatcher, except for the pool check this operation supplies.
  // Correlated indexed lookups stay inside this query; awareness and fallback
  // preparation remain intact, and economics still rank each feasible tier.
  const ageRoute=preparationWithTokenAge?`CASE
   WHEN EXISTS(SELECT 1 FROM token_creations preparation_age WHERE preparation_age.mint=w.mint AND preparation_age.created_at<=? AND preparation_age.created_at>=? AND preparation_age.verified_at<=?) THEN 2
   WHEN NOT EXISTS(SELECT 1 FROM token_creations existing_age WHERE existing_age.mint=w.mint)
    AND EXISTS(SELECT 1 FROM market_tokens preparation_token WHERE preparation_token.mint=w.mint
     AND (preparation_token.last_activity_at>=? AND preparation_token.last_activity_at<=?
      OR EXISTS(SELECT 1 FROM identity_provenance preparation_migration INDEXED BY identity_provenance_pool_progress WHERE preparation_migration.mint=w.mint AND preparation_migration.kind='migration' AND preparation_migration.last_seen_at>=? AND preparation_migration.last_seen_at<=?))
     AND EXISTS(SELECT 1 FROM identity_provenance preparation_birth LEFT JOIN token_creation_requests preparation_retry ON preparation_retry.mint=preparation_birth.mint AND preparation_retry.signature=preparation_birth.signature
      WHERE preparation_birth.mint=w.mint AND preparation_birth.kind='creation' AND preparation_birth.source='pumpportal-new-token' AND preparation_birth.signature!=''
       AND preparation_birth.first_seen_at>=? AND preparation_birth.first_seen_at<=?
       AND (preparation_retry.mint IS NULL OR (preparation_retry.terminal=0 AND preparation_retry.next_attempt_at<=?)))) THEN 1 ELSE 0 END`:'0';
  const ageParams=preparationWithTokenAge?[at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,recent,at,recent,at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,at]:[];
  const ordinal=(field:string)=>`CASE WHEN ${field} IS NULL THEN 0.5 ELSE (RANK() OVER(ORDER BY ${field})-1-(COUNT(*) OVER()-COUNT(${field}) OVER())+COUNT(*) OVER(PARTITION BY ${field})/2.0+CASE WHEN ${field}>0 THEN 1.0 WHEN ${field}=0 THEN 0.5 ELSE 0 END)/(COUNT(${field}) OVER()+1.0) END`;
  const row=this.statement(`WITH eligible AS (
   SELECT w.signature,w.mint,w.pool,w.waiting_since,w.first_seen_at,MAX(0,?-(${readyAnchorSql})) serviceable_wait_ms,${ageRoute} preparation_age_route FROM watch_rows w WHERE w.archived=0${q.where?` AND (${q.where})`:''}
  ),scoped_flow AS (
   SELECT a.mint,a.pool,a.hint_source,SUM(CASE WHEN a.first_seen_at>? AND a.quote_lamports IS NOT NULL THEN 1 ELSE 0 END) recent_known,
    SUM(CASE WHEN a.first_seen_at>? AND a.quote_lamports IS NOT NULL AND a.side='buy' THEN 1 ELSE 0 END) recent_buys,
    SUM(CASE WHEN a.first_seen_at>? AND a.quote_lamports IS NOT NULL AND a.side='sell' THEN 1 ELSE 0 END) recent_sells,
    SUM(CASE WHEN a.first_seen_at<=? AND a.quote_lamports IS NOT NULL THEN 1 ELSE 0 END) prior_known,
    SUM(CASE WHEN a.first_seen_at>? THEN CASE a.side WHEN 'buy' THEN CAST(a.quote_lamports AS REAL) WHEN 'sell' THEN -CAST(a.quote_lamports AS REAL) ELSE 0 END ELSE 0 END)/1e9 recent_net,
    SUM(CASE WHEN a.first_seen_at<=? THEN CASE a.side WHEN 'buy' THEN CAST(a.quote_lamports AS REAL) WHEN 'sell' THEN -CAST(a.quote_lamports AS REAL) ELSE 0 END ELSE 0 END)/1e9 prior_net,
    SUM(CASE WHEN a.first_seen_at>? THEN CAST(a.quote_lamports AS REAL) ELSE 0 END)/1e9 recent_gross
   FROM market_activity_seen a JOIN eligible e ON e.mint=a.mint WHERE a.first_seen_at>? AND a.first_seen_at<=? GROUP BY a.mint,a.pool,a.hint_source
  ),flow AS (
   SELECT mint,SUM(recent_known) recent_known,SUM(prior_known) prior_known,SUM(recent_net) recent_net,SUM(prior_net) prior_net,SUM(recent_gross) recent_gross FROM scoped_flow GROUP BY mint
  ),price_rows AS (
   SELECT a.mint,a.pool,a.hint_source,a.first_seen_at,a.signature,a.side,a.sol_ui_price,ROW_NUMBER() OVER(PARTITION BY a.mint,a.pool,a.hint_source ORDER BY a.first_seen_at,a.signature,a.side) first_rank,
    ROW_NUMBER() OVER(PARTITION BY a.mint,a.pool,a.hint_source ORDER BY a.first_seen_at DESC,a.signature DESC,a.side DESC) last_rank
   FROM market_activity_seen a JOIN eligible e ON e.mint=a.mint AND e.pool=a.pool WHERE a.first_seen_at>? AND a.first_seen_at<=? AND a.sol_ui_price IS NOT NULL AND a.hint_source IS NOT NULL
  ),prices AS (
   SELECT mint,pool,hint_source,MIN(first_seen_at) first_at,MAX(first_seen_at) last_at,
    MAX(CASE WHEN first_rank=1 THEN sol_ui_price END) first_price,MAX(CASE WHEN last_rank=1 THEN sol_ui_price END) last_price
   FROM price_rows GROUP BY mint,pool,hint_source
  ),latest_prices AS (
   SELECT *,ROW_NUMBER() OVER(PARTITION BY mint,pool ORDER BY last_at DESC,hint_source) source_rank FROM prices WHERE first_at<last_at
  ),observed AS (
   SELECT e.*,CASE WHEN f.recent_known>0 THEN f.recent_net END recent_net,CASE WHEN f.prior_known>0 THEN f.prior_net END prior_net,
    CASE WHEN f.recent_known>0 AND f.prior_known>0 THEN f.recent_net-f.prior_net END acceleration,
    CASE WHEN p.first_price>0 AND p.last_price>0 THEN p.last_price/p.first_price-1 END price_return,
    CASE WHEN sf.recent_known>0 AND sf.prior_known>0 THEN sf.recent_net-sf.prior_net END scoped_acceleration,
    CASE WHEN sf.recent_known>0 THEN sf.recent_net END scoped_net,sf.recent_gross,sf.recent_buys,sf.recent_sells,p.hint_source price_hint_source,p.first_at price_first_at,p.last_at price_last_at
   FROM eligible e LEFT JOIN flow f ON f.mint=e.mint LEFT JOIN latest_prices p ON p.mint=e.mint AND p.pool=e.pool AND p.source_rank=1 LEFT JOIN scoped_flow sf ON sf.mint=e.mint AND sf.pool=e.pool AND sf.hint_source=p.hint_source
  ),dimensions AS (
   SELECT *,CASE WHEN price_return IS NULL OR scoped_net IS NULL OR scoped_acceleration IS NULL THEN NULL
    WHEN price_return>0 AND scoped_acceleration<0 THEN -price_return WHEN price_return<0 AND scoped_net>0 THEN price_return ELSE 0 END price_agreement,
    CASE WHEN price_return IS NOT NULL AND recent_gross>0 AND recent_buys>0 AND recent_sells>0 THEN -ABS(price_return)/recent_gross END price_stability
   FROM observed
  ),ranked AS (
   SELECT *,(${ordinal('recent_net')}+${ordinal('acceleration')}+${ordinal('price_agreement')}+${ordinal('price_stability')})/4.0 economic_merit,CASE WHEN recent_net IS NULL THEN 0 ELSE 1 END current_evidence FROM dimensions
  ) SELECT *,(SELECT body FROM watch_rows w WHERE w.signature=ranked.signature) body,economic_merit+CASE WHEN current_evidence=1 THEN ${OPPORTUNITY_PRIORITY_POLICY.fairnessMaximum}*MIN(1.0,serviceable_wait_ms/${OPPORTUNITY_PRIORITY_POLICY.fairnessSaturationMs}.0) ELSE 0 END selection_priority,
    FIRST_VALUE(mint) OVER(ORDER BY (preparation_age_route>0) DESC,current_evidence DESC,economic_merit DESC,waiting_since,first_seen_at,signature) economic_leader_mint,
    FIRST_VALUE(economic_merit) OVER(ORDER BY (preparation_age_route>0) DESC,current_evidence DESC,economic_merit DESC,waiting_since,first_seen_at,signature) economic_leader_merit FROM ranked
   ORDER BY (preparation_age_route>0) DESC,current_evidence DESC,selection_priority DESC,waiting_since,first_seen_at,signature LIMIT 1`).get(at,...ageParams,...(q.params??[]),recent,recent,recent,recent,recent,recent,recent,prior,at,recent,at) as {body:string;mint:string;preparation_age_route:number;recent_net:number|null;prior_net:number|null;acceleration:number|null;price_return:number|null;price_agreement:number|null;price_stability:number|null;recent_gross:number|null;pool:string;price_hint_source:string|null;price_first_at:number|null;price_last_at:number|null;serviceable_wait_ms:number;economic_merit:number;selection_priority:number;current_evidence:number;economic_leader_mint:string;economic_leader_merit:number}|undefined;
  return row?{row:JSON.parse(row.body) as WatchRow,hints:{version:'shared-flow-opportunity-priority-v2',horizonMs:SHARED_ACTIVITY_HORIZON_MS,recentNetSol:row.recent_net,priorNetSol:row.prior_net,netAccelerationSolPerMinute:row.acceleration,priceReturnBps:row.price_return===null?null:row.price_return*10000,priceDemandAgreement:row.price_agreement,priceMovePerGrossSol:row.price_return===null||!row.recent_gross?null:Math.abs(row.price_return)/row.recent_gross,twoSidedPriceStability:row.price_stability,priceScope:row.price_return===null?null:{pool:row.pool,source:row.price_hint_source!,firstAt:row.price_first_at!,lastAt:row.price_last_at!},serviceableWaitMs:row.serviceable_wait_ms,economicMerit:row.economic_merit,priority:row.selection_priority,hasCurrentEconomicEvidence:row.current_evidence===1,fairnessBonus:row.current_evidence===1?observationFairnessBonus(row.serviceable_wait_ms):0,economicLeaderMint:row.economic_leader_mint,economicLeaderMerit:row.economic_leader_merit,waitChangedWinner:row.mint!==row.economic_leader_mint,...(preparationWithTokenAge?{preparationAgeRoute:row.preparation_age_route===2?'verified-token-age' as const:row.preparation_age_route===1?'creation-request-available' as const:'creation-request-unavailable' as const}:{}),directLiquidity:'unknown',financialPermission:false}}:undefined;
 }
