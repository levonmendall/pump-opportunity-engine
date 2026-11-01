import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const SOL='So11111111111111111111111111111111111111112',AT=1800000000000;
function fixture(){
 let at=AT;const registry=new MarketRegistry(':memory:',{now:()=>at}),records:Array<{kind:string;data:any}>=[],watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:(kind,data)=>records.push({kind,data})});
 const seed=(mint:string,seenAt=AT)=>{watch.discover({signature:'origin-'+mint,feedMint:mint,receivedAt:seenAt});watch.verify('origin-'+mint,{mint,pool:'pool-'+mint,migrationAt:seenAt-300000,verifiedAt:seenAt});};
 const hint=(mint:string,id:string,when:number,sol:number,tokenAmount?:string,extra:Record<string,unknown>={})=>registry.observeActivity({mint,pool:'pool-'+mint,signature:mint+'-'+id,source:'shared-test',at:when,side:sol<0?'sell':'buy',quoteLamports:String(Math.round(Math.abs(sol)*1e9)),quoteMint:SOL,...(tokenAmount?{tokenAmount}:{}),...extra});
 const next=()=>watch.next(at,new Set()),priority=()=>records.filter(r=>r.kind==='pilot-watch-opportunity-priority').at(-1)!.data;
 return {registry,watch,records,seed,hint,next,priority,setAt:(next:number)=>{at=next;}};
}

test('equal current buying ranks accelerating capital demand above an unchanged high-volume stream',()=>{
 const f=fixture();try{
  f.seed('flat');f.seed('accelerating');f.hint('flat','previous',AT-90000,20);f.hint('flat','recent',AT-1000,20);f.hint('accelerating','previous',AT-90000,2);f.hint('accelerating','recent',AT-1000,20);
  assert.equal(f.next()!.mint,'accelerating');assert.equal(f.priority().recentNetSol,20);assert.equal(f.priority().priorNetSol,2);assert.equal(f.priority().netAccelerationSolPerMinute,18);assert.equal(f.priority().financialPermission,false);
 }finally{f.registry.close();}
});

test('signed economic demand outranks a large raw count of negligible or unknown transactions',()=>{
 const f=fixture();try{
  f.seed('noisy');f.seed('capital');for(let i=0;i<100;i++)f.hint('noisy',String(i),AT-1000,1e-9);f.hint('capital','prior',AT-90000,1);f.hint('capital','recent',AT-1000,2);
  assert.equal(f.next()!.mint,'capital');assert.equal(f.priority().recentNetSol,2);
 }finally{f.registry.close();}
});

test('price advances with weakening demand are an exhaustion hint without creating an economic veto',()=>{
 const f=fixture();try{
  f.seed('exhausted');f.seed('steady');for(const mint of ['exhausted','steady']){f.hint(mint,'prior',AT-90000,6);f.hint(mint,'early',AT-59000,1.5,'1.5');f.hint(mint,'late',AT-1000,1.5,mint==='exhausted'?'0.75':'1.5');}
  assert.equal(f.next()!.mint,'steady');assert.equal(f.priority().priceReturnBps,0);assert.equal(f.priority().priceDemandAgreement,0);
  assert.equal(f.watch.next(AT,new Set(['steady']))!.mint,'exhausted','observed exhaustion changes ranking only');assert.equal(f.priority().priceReturnBps,10000);assert.equal(f.priority().priceDemandAgreement,-1);assert.equal(f.priority().priceMovePerGrossSol,1/3);
 }finally{f.registry.close();}
});

test('missing liquidity and unscoped provider prices remain unknown and cannot exclude research',()=>{
 const f=fixture();try{
  f.seed('unknown');f.hint('unknown','prior',AT-90000,1,undefined,{price:1});f.hint('unknown','recent',AT-1000,2,undefined,{price:1000});
  assert.equal(f.next()!.mint,'unknown');assert.equal(f.priority().directLiquidity,'unknown');assert.equal(f.priority().priceReturnBps,null);assert.equal(f.priority().priceDemandAgreement,null);assert.equal(f.priority().priceMovePerGrossSol,null);assert.equal(f.priority().twoSidedPriceStability,null);
 }finally{f.registry.close();}
});

test('coherent two-sided observed price stability contributes to ranking without becoming a liquidity guarantee or veto',()=>{
 const f=fixture();try{
  f.seed('thin-response');f.seed('absorbed-response');for(const mint of ['thin-response','absorbed-response']){f.hint(mint,'prior',AT-90000,2);const buy=mint==='thin-response'?6:12,sell=mint==='thin-response'?2:8;f.hint(mint,'early',AT-59000,buy,String(buy));f.hint(mint,'late',AT-1000,-sell,String(sell/2));}
  assert.equal(f.next()!.mint,'absorbed-response');assert.equal(f.priority().recentNetSol,4);assert.equal(f.priority().netAccelerationSolPerMinute,2);assert.equal(f.priority().priceDemandAgreement,0);assert.equal(f.priority().twoSidedPriceStability,-1/20);assert.equal(f.priority().directLiquidity,'unknown');
  assert.equal(f.watch.next(AT,new Set(['absorbed-response']))!.mint,'thin-response');assert.equal(f.priority().recentNetSol,4);assert.equal(f.priority().netAccelerationSolPerMinute,2);assert.equal(f.priority().priceDemandAgreement,0);assert.equal(f.priority().twoSidedPriceStability,-1/8,'the less stable observed response still remains serviceable');
 }finally{f.registry.close();}
});

test('all-buy and all-sell price trends cannot manufacture two-sided resilience',()=>{
 for(const sign of [1,-1]){const f=fixture();try{
  f.seed('one-sided');f.hint('one-sided','prior',AT-90000,sign);f.hint('one-sided','early',AT-59000,sign,'1');f.hint('one-sided','late',AT-1000,sign*2,'1');assert.equal(f.next()!.mint,'one-sided');assert.equal(f.priority().priceReturnBps,10000);assert.equal(f.priority().twoSidedPriceStability,null);assert.ok(f.priority().economicMerit>0,'unknown stability receives positive neutral merit');
 }finally{f.registry.close();}}
});

test('price trends require matching pool, explicit SOL units and the same hint source',()=>{
 for(const mismatch of ['pool','quote','source']){const f=fixture();try{
  f.seed('token');f.hint('token','prior',AT-90000,1);f.hint('token','early',AT-59000,1,'1');f.hint('token','late',AT-1000,2,'0.5',mismatch==='pool'?{pool:'other-pool'}:mismatch==='quote'?{quoteMint:'unknown'}:{source:'other-source'});
  assert.equal(f.next()!.mint,'token');assert.equal(f.priority().priceReturnBps,null,mismatch);
 }finally{f.registry.close();}}
});

test('price versus demand compares the same pool and source, and never extrapolates from stale prices',()=>{
 for(const mismatch of ['pool','source','stale']){const f=fixture();try{
  f.seed('token');f.hint('token','prior',AT-90000,10,undefined,mismatch==='pool'?{pool:'bonding-curve'}:{source:'other-source'});f.hint('token','early',mismatch==='stale'?AT-61000:AT-59000,1,'1');f.hint('token','late',AT-1000,1,'0.5');
  assert.equal(f.next()!.mint,'token');assert.equal(f.priority().priceDemandAgreement,null,mismatch);if(mismatch==='stale')assert.equal(f.priority().priceReturnBps,null,'a price outside the current sixty-second window is not current continuation evidence');
 }finally{f.registry.close();}}
});

test('original event time and deduplication determine acceleration; replayed or future hints cannot inflate it',()=>{
 const f=fixture();try{
  f.seed('token');f.hint('token','prior',AT-90000,2);f.hint('token','recent',AT-1000,3);f.hint('token','recent',AT,1000);f.hint('token','future',AT+1000,5000);
  assert.equal(f.next()!.mint,'token');assert.equal(f.priority().recentNetSol,3);assert.equal(f.priority().priorNetSol,2);assert.equal(f.priority().netAccelerationSolPerMinute,1);
 }finally{f.registry.close();}
});

test('bounded waiting credit cannot outrank strong current buying or reopen unchanged pool refusals',()=>{
 const f=fixture();try{
  f.seed('patient');f.seed('closed');f.watch.noteEvaluation('closed',{kind:'technical-unavailable',windowEndAt:null,evidence:'NATIVE_OBSERVATION_POOL_MISSING'},AT);f.watch.transition('closed','DEFERRED','same pool still absent',AT);
  f.setAt(AT+120000);f.seed('fresh',AT+120000);f.hint('fresh','prior',AT+30000,1);f.hint('fresh','recent',AT+119000,100);f.hint('closed','irrelevant',AT+119000,10000,undefined,{pool:'bonding-curve'});
  assert.equal(f.next()!.mint,'fresh');assert.equal(f.priority().serviceableWaitMs,0);assert.equal(f.priority().fairnessBonus,0);assert.equal(f.priority().waitChangedWinner,false);assert.equal(f.watch.next(AT+120000,new Set(['patient','fresh'])),null,'age or unrelated flow cannot bypass a closed pool-evidence gate');
 }finally{f.registry.close();}
});

test('SQL waiting bonus is bounded even after a full day with no recent evidence',()=>{
 const f=fixture();try{
  f.seed('patient');f.setAt(AT+86400000);f.seed('fresh',AT+86400000);f.hint('fresh','prior',AT+86400000-90000,1);f.hint('fresh','recent',AT+86400000-1000,100);
  assert.equal(f.next()!.mint,'fresh');assert.equal(f.priority().waitChangedWinner,false);
  assert.equal(f.watch.next(AT+86400000,new Set(['fresh']))!.mint,'patient');assert.equal(f.priority().hasCurrentEconomicEvidence,false);assert.equal(f.priority().fairnessBonus,0);assert.equal(f.priority().priority,0.5);
 }finally{f.registry.close();}
});
test('equal-economic-evidence candidates receive bounded fairness, with auditable no-bonus leader',()=>{
 const f=fixture();try{f.seed('waiting');f.setAt(AT+60000);f.seed('new',AT+60000);f.hint('waiting','recent',AT+59000,1);f.hint('new','recent',AT+59000,1);assert.equal(f.next()!.mint,'waiting');assert.equal(f.priority().fairnessBonus,0.05);assert.equal(f.priority().economicLeaderMint,'waiting');assert.ok(Math.abs(f.priority().priority-f.priority().economicMerit-0.05)<1e-12);}finally{f.registry.close();}
});


test('unowned technical retries do not bypass stronger current economic candidates',()=>{
 const f=fixture();try{
  f.seed('retry');f.watch.requestTechnicalReevaluation('retry',{reason:'entry-quote-unavailable',failedWindowEndAt:AT-10000},AT);
  f.seed('strong');f.hint('strong','prior',AT-90000,1);f.hint('strong','recent',AT-1000,20);
  assert.equal(f.next()!.mint,'strong');assert.equal(f.priority().hasCurrentEconomicEvidence,true);
  assert.equal(f.watch.next(AT,new Set(['strong']))!.mint,'retry','retry remains eligible, not permanently rejected');
 }finally{f.registry.close();}
});
test('technical retry not-before remains a scheduling prerequisite',()=>{
 const f=fixture();try{
  f.seed('retry');f.watch.requestTechnicalReevaluation('retry',{reason:'entry-quote-unavailable',failedWindowEndAt:AT-10000},AT);
  const row=f.registry.lookup('retry')!;row.technicalReevaluation!.notBefore=AT+1000;f.registry.put(row);
  assert.equal(f.next(),null);f.setAt(AT+1000);assert.equal(f.next()!.mint,'retry');
 }finally{f.registry.close();}
});
