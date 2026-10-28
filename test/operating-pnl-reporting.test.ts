/** Disposable financial fixtures only; these are not forward trading results. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {DisposableLedger,OPERATING_REPORTING_BASIS,REPORTING_OPERATING_HISTORY_KEY,validateOperatingReportingHistory,type UsdPrice} from '../src/ledger.js';
import {operatingPnlReporting} from '../src/operating-pnl-reporting.js';

const T=Date.parse('2026-10-26T12:00:00Z');
const price=(at:number,value='100000000'):UsdPrice=>({at,microUsdPerSol:value,source:'DISPOSABLE verified-rate fixture'});
function fixture(t:TestContext){
  const dir=mkdtempSync(join(tmpdir(),'poe-operating-pnl-FIXTURE-')),path=join(dir,'fixture.sqlite');
  let ledger=new DisposableLedger(path,'fixture-operating-pnl');
  ledger.initialize(price(T),T);
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  const rows=()=>{const db=new Database(path,{readonly:true});try{return {financial:db.prepare('SELECT * FROM financial_state').all(),actions:db.prepare('SELECT * FROM actions').all(),journal:db.prepare('SELECT * FROM journal').all(),legacy:db.prepare("SELECT * FROM metadata WHERE key='reporting_history'").all()};}finally{db.close();}};
  return {get ledger(){return ledger;},path,rows,reopen(){ledger.close();ledger=new DisposableLedger(path,'fixture-operating-pnl');},mutate(body:string){ledger.close();const db=new Database(path);try{db.prepare('UPDATE metadata SET value=? WHERE key=?').run(body,REPORTING_OPERATING_HISTORY_KEY);}finally{db.close();}ledger=new DisposableLedger(path,'fixture-operating-pnl');}};
}

test('new operating series preserves exact legacy history, financial state, journal, actions and inception through restart',t=>{
  const f=fixture(t);f.ledger.recordReportingPoint({at:T+100,tradingMicroUsd:'123000000',economicMicroUsd:null});
  const before=f.rows(),at=T+60000;
  const empty=f.ledger.getOperatingReportingHistory();
  assert.deepEqual(empty,{schemaVersion:2,basis:OPERATING_REPORTING_BASIS,cutoverAt:null,firstObservedAt:null,points:[{at:T,tradingMicroUsd:'0',economicMicroUsd:null}],windowLimited:false,downsampled:false});
  const result=f.ledger.recordOperatingReportingPoint({at,tradingMicroUsd:'-2000',economicMicroUsd:null},at);
  assert.deepEqual(result.points,[{at:T,tradingMicroUsd:'0',economicMicroUsd:null},{at:T+1,tradingMicroUsd:null,economicMicroUsd:null},{at,tradingMicroUsd:'-2000',economicMicroUsd:null}]);
  assert.equal(result.cutoverAt,at);assert.equal(result.firstObservedAt,at);
  assert.deepEqual(f.rows(),before,'reporting metadata must not modify financial or prior reporting records');
  f.reopen();assert.deepEqual(f.ledger.getOperatingReportingHistory(),result);assert.deepEqual(f.rows(),before);
  assert.deepEqual(f.ledger.recordOperatingReportingPoint({at,tradingMicroUsd:'-2000',economicMicroUsd:null},at),result,'idempotent source retry');
  assert.throws(()=>f.ledger.recordOperatingReportingPoint({at,tradingMicroUsd:'0',economicMicroUsd:null},at),/conflict/);
});

test('real source observation time admits unknown gap markers but never backdates a known value',t=>{
  const f=fixture(t),at=T+60000;
  const gap=f.ledger.recordOperatingReportingPoint({at:T+1,tradingMicroUsd:null,economicMicroUsd:null},at);
  assert.equal(gap.cutoverAt,at);assert.equal(gap.firstObservedAt,null);
  assert.throws(()=>f.ledger.recordOperatingReportingPoint({at:at-1,tradingMicroUsd:'1',economicMicroUsd:null},at),/backdated/);
  const known=f.ledger.recordOperatingReportingPoint({at,tradingMicroUsd:'1',economicMicroUsd:null},at);
  assert.equal(known.firstObservedAt,at);
  const outage=f.ledger.recordOperatingReportingPoint({at:at+1,tradingMicroUsd:null,economicMicroUsd:null},at+20000);
  assert.equal(outage.points.at(-1)!.at,at+1,'gap boundary states unavailability, not a fabricated earlier mark');
  assert.throws(()=>f.ledger.recordOperatingReportingPoint({at:at+20001,tradingMicroUsd:null,economicMicroUsd:null},at+20000),/observation time/);
  assert.throws(()=>f.ledger.recordOperatingReportingPoint({at:at-1,tradingMicroUsd:null,economicMicroUsd:null},at),/regression/);
});

test('operating metadata corruption is rejected without replacing it with legacy USD values',t=>{
  const f=fixture(t),at=T+60000,h=f.ledger.recordOperatingReportingPoint({at,tradingMicroUsd:'0',economicMicroUsd:null},at);
  for(const mutate of [
    (x:any)=>{x.basis='legacy-equity-change';},
    (x:any)=>{x.cutoverAt=at+1;},
    (x:any)=>{x.firstObservedAt=at+1;},
    (x:any)=>{x.points[0].tradingMicroUsd='1';},
    (x:any)=>{x.points[1].tradingMicroUsd='999';},
    (x:any)=>{x.points[2].at=T;},
    (x:any)=>{x.points[2].tradingMicroUsd='0.1';},
    (x:any)=>{x.points[2].extra='field';},
  ]){const broken=structuredClone(h);mutate(broken);assert.throws(()=>validateOperatingReportingHistory(broken,T));}
  assert.throws(()=>validateOperatingReportingHistory(h,T+1),/inception|chronology/);
  const broken={...h,basis:'legacy-equity-change'};f.mutate(JSON.stringify(broken));
  assert.throws(()=>f.ledger.getOperatingReportingHistory(),/metadata/);
  assert.equal(f.ledger.getReportingHistory().points[0]!.tradingMicroUsd,'0','legacy history remains independently accessible');
});

test('bounded operating history preserves inception and an explicit unknown pre-retention interval',t=>{
  const f=fixture(t),first=T+60000;
  for(let i=0;i<730;i++){const at=first+i*15000;f.ledger.recordOperatingReportingPoint({at,tradingMicroUsd:i%2===0?String(i):null,economicMicroUsd:null},at);}
  const h=f.ledger.getOperatingReportingHistory();
  assert.equal(h.points.length,720);assert.equal(h.windowLimited,true);assert.equal(h.firstObservedAt,first);
  assert.deepEqual(h.points[0],{at:T,tradingMicroUsd:'0',economicMicroUsd:null});
  assert.deepEqual(h.points[1],{at:T+1,tradingMicroUsd:null,economicMicroUsd:null});
  assert.equal(h.points.at(-1)!.at,first+729*15000);
  assert.ok(h.points[2]!.at>first);f.reopen();assert.deepEqual(f.ledger.getOperatingReportingHistory(),h);
});

test('current USD translation never labels passive SOL appreciation as token trading profit',t=>{
  const f=fixture(t),at=T+1000,p=price(at,'200000000'),projection=f.ledger.projection(at,p,{});
  const result=operatingPnlReporting({at,projection,price:p,valuationUsable:true});
  assert.equal(result.netTokenTradingLamports,'0');assert.equal(result.currentUsdTranslationMicroUsd,'0');
  assert.equal(result.passiveSolPriceEffectMicroUsd,'1000000000');assert.equal(result.overallEquityChangeMicroUsd,'1000000000');
  assert.equal(result.operatingCostsMicroUsd,null);assert.equal(result.tokenTradingAfterOperatingCostsMicroUsd,null,'unknown infrastructure costs are not zero');
  assert.match(result.meaning,/not historical realized USD/);
});

test('net token result includes modeled execution costs once, with no historical-gas USD repricing',t=>{
  const f=fixture(t);f.ledger.reconcile('fixture-ready',T,price(T),{});
  const order={id:'fixture-buy',side:'buy' as const,mint:'fixture-token',decidedAt:T,executeAt:T+500,expiresAt:T+2000,gas:'10000',deposit:'0',maxSpend:'490000000',minReceive:'100',decisionEvidence:'DISPOSABLE actual-size fixture'};
  f.ledger.order(order,price(T),{});f.ledger.attempt('fixture-failed-fill',order.id,T+500,{at:T+500,spendLamports:'480000000',receiveUnits:'99',evidence:'DISPOSABLE slippage failure'},price(T+500));
  const at=T+1000,p=price(at,'200000000'),projection=f.ledger.projection(at,p,{}),result=operatingPnlReporting({at,projection,price:p,valuationUsable:true});
  assert.equal(result.netTokenTradingLamports,'-10000');assert.equal(result.modeledExecutionCostsLamports,'10000');assert.equal(result.currentUsdTranslationMicroUsd,'-2000');
  assert.equal(result.passiveSolPriceEffectMicroUsd,'1000000000');assert.equal(result.overallEquityChangeMicroUsd,'999998000');
  const known=operatingPnlReporting({at,projection:{...projection,operatingCostsMicroUsd:'500',operatingCostClassification:'allocated'},price:p,valuationUsable:true});
  assert.equal(known.tokenTradingAfterOperatingCostsMicroUsd,'-2500','gas was already in token result and is not deducted twice');
});

test('stale rates and unavailable liquidation preserve explicit unknown trading valuation',t=>{
  const f=fixture(t),at=T+20000,p=price(at),projection=f.ledger.projection(at,p,{});
  for(const stale of [price(at-10001),price(at+1),{...p,microUsdPerSol:'0'},{...p,source:'\u0000invalid'}]){
    const r=operatingPnlReporting({at,projection,price:stale,valuationUsable:true});assert.equal(r.netTokenTradingLamports,'0');assert.equal(r.currentUsdTranslationMicroUsd,null);assert.equal(r.usdPriceAt,null);assert.equal(r.passiveSolPriceEffectMicroUsd,null);
  }
  const unavailable=operatingPnlReporting({at,projection:{...projection,unknownMarks:true,totalPnlLamports:null,totalPnlMicroUsd:null,economicPnlMicroUsd:null},price:p,valuationUsable:true});
  assert.equal(unavailable.netTokenTradingLamports,null);assert.equal(unavailable.currentUsdTranslationMicroUsd,null);assert.equal(unavailable.overallEquityChangeMicroUsd,null);
  const degraded=operatingPnlReporting({at,projection,price:p,valuationUsable:false});assert.equal(degraded.netTokenTradingLamports,null);assert.equal(degraded.currentUsdTranslationMicroUsd,null);assert.equal(degraded.passiveSolPriceEffectMicroUsd,'0','independently fresh passive conversion remains identified separately');
});
