/** Paired exact pre-change weighted query versus scalar competition telemetry.
 * Synthetic local registry only; no provider, financial account or native host.
 */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {MarketRegistry} from '../src/market-registry.ts';
import {PilotWatch} from '../src/pilot-watch.ts';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.ts';
import {opportunitySelectionBeforeCompetition} from '../test/fixtures/opportunity-selection-before-competition.ts';
const AT=1800000000000,ELIGIBLE=1024,RETAINED=16384;
const registry=new MarketRegistry(':memory:',{now:()=>AT,concurrentIntake:true});
const watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record(){}});
try{
 const base=watch.discover({signature:'OFFLINE-competition-base',receivedAt:AT-100000});
 registry.transaction(()=>{
  for(let i=0;i<RETAINED;i++)registry.put({...base,signature:'OFFLINE-row-'+String(i).padStart(6,'0'),mint:'OFFLINE-mint-'+i,
   pool:i<ELIGIBLE?'OFFLINE-pool-'+i:null,state:i<ELIGIBLE?'WATCH':'DISCOVERED',firstSeenAt:AT-100000,
   waitingSince:AT-60000+i,observationIdentity:i<ELIGIBLE?{basis:'canonical-pool-hint',availableAt:AT-100000,evidence:'OFFLINE same-query fixture'}:undefined,
   history:Array.from({length:16},(_,j)=>({at:AT-100000+j,state:i<ELIGIBLE?'WATCH':'DISCOVERED',reason:'OFFLINE bounded retained history '+i+':'+j}))});
  for(let i=0;i<ELIGIBLE;i++)for(let j=0;j<4;j++)registry.observeActivity({mint:'OFFLINE-mint-'+i,pool:'OFFLINE-pool-'+i,
   signature:'OFFLINE-event-'+i+'-'+j,source:'OFFLINE-broad',at:AT-[90000,80000,50000,1000][j],side:j%2?'sell':'buy',
   quoteLamports:String(((i*17+j*11)%997+1)*1000000),quoteMint:'So11111111111111111111111111111111111111112',tokenAmount:String((i+j*3)%13+1)});
 });
 const current=registry.nextOpportunity.bind(registry),statement=registry.statement.bind(registry),samples=[];
 let measuring=false,operations=[],rankedRows=[];
 registry.statement=sql=>{
  const value=statement(sql);if(!measuring)return value;
  return new Proxy(value,{get(target,key){const original=Reflect.get(target,key);if(typeof original!=='function')return original;
   if(key!=='get'&&key!=='all')return original.bind(target);
   return(...params)=>{operations.push({kind:key,sql});const result=original.apply(target,params);
    if(sql.startsWith('WITH eligible AS MATERIALIZED')&&Array.isArray(result))rankedRows=result;return result;};}});
 };
 for(const [scope,options]of [['global',{}],['prepared4',{preparedMints:[1020,1021,1022,1023].map(i=>'OFFLINE-mint-'+i)}]]){
  let expected;
  for(let trial=0;trial<8;trial++)for(const variant of(trial%2?['competition','before']:['before','competition'])){
   registry.nextOpportunity=(...args)=>{measuring=true;try{return variant==='before'?opportunitySelectionBeforeCompetition.call(registry,...args):current(...args);}finally{measuring=false;}};
   operations=[];rankedRows=[];const began=performance.now();const row=watch.next(AT,new Set(),options);const elapsedMs=performance.now()-began;
   assert.ok(row);if(expected)assert.deepEqual(row,expected);else expected=row;
   assert.equal(operations.length,2,'same preflight plus one ranked SQL, with no telemetry query');
   if(variant==='competition'){
    assert.equal(operations[1].kind,'all');assert.ok(rankedRows.length<=8);
    assert.equal(rankedRows.filter(r=>r.body!==null).length,1,'only winner full body is fetched');
    assert.equal(rankedRows[0].ranked_population_count,scope==='global'?ELIGIBLE:4);
   }
   if(trial>0)samples.push({scope,variant,elapsedMs});
  }
 }
 const summary=[];
 for(const scope of['global','prepared4']){
  const paired={};for(const variant of['before','competition']){
   const values=samples.filter(v=>v.scope===scope&&v.variant===variant).map(v=>v.elapsedMs).sort((a,b)=>a-b);
   paired[variant]={samplesMs:values,medianMs:values[Math.floor(values.length/2)],maximumMs:Math.max(...values)};
  }
  // The operation already has a125ms local budget. Report paired overhead as
  // well as this limit; machine load may lengthen both sides of a local run.
  assert.ok(paired.competition.medianMs<=Math.max(125,paired.before.medianMs*1.5),scope+' retains its existing local operation budget');
  summary.push({scope,...paired,medianOverheadMs:paired.competition.medianMs-paired.before.medianMs});
 }
 console.log(JSON.stringify({kind:'OFFLINE_SAME_QUERY_COMPETITION_COST',retainedRows:RETAINED+1,eligibleRows:ELIGIBLE,
  activityRows:ELIGIBLE*4,queriesPerSelection:2,maximumScalarPeers:8,winnerBodiesFetched:1,summary,
  providerRequests:0,financialAccountOpened:false,hostActions:0},null,2));
}finally{registry.close();}
