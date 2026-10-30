/** Reporting-only completeness; source snapshots and financial gates are unchanged. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from '../src/operating-intelligence.js';
import {LIFETIME_EQUITY_SOURCE,type LifetimeEquityHistory} from '../src/lifetime-equity-contract.js';
import {SnapshotCache,type Snapshot} from '../src/reporting.js';
const original={accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION,release:'test-source-release',strategy:'test-original-strategy'};
const iso=(at:number)=>new Date(at).toISOString();
function sample(sequence: string, at: number, equityUsd: number | null): Snapshot {
  return {
    project:'pump-opportunity-engine', mode:'PAPER', liveTrading:false, schemaVersion:1,
    account:{id:ORIGINAL_POE_ACCOUNT, inceptionAt:ORIGINAL_POE_INCEPTION, initialUsd:1000},
    sequence, source:{release:original.release, strategy:original.strategy},
    times:{generatedAt:iso(at),marketAt:iso(at-1000),reconciledAt:iso(at-1000),usefulProgressAt:iso(at)},
    status:{runtime:'running',market:'observing',entries:'disabled',reconciled:true,blocker:'test only'},
    balances:{cashSol:'10',reservedSol:'0',equitySol:'10',equityUsd,
      realizedUsd:null,unrealizedUsd:null,tradingPnlUsd:-123,
      economicPnlUsd:null,positionCostUsd:0,markedExposureUsd:null,drawdownUsd:null,
      executionCostsUsd:null,operatingCostsUsd:null,passiveSolEquityUsd:null,solPriceUsd:100},
    costLabels:{execution:'simulated',operating:'unavailable'},
    positions:[],trades:[],decisions:[],pnl:[],
    history:{windowStartAt:null,downsampled:false,label:'No verified historic PnL'},
    funnel:{discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,
      qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:0},
    metrics:{processingLagMs:null,eventLoopLagMs:null,providerEvents:0,rpcRequests:0,
      projectedDailyDataSol:null,budgetRemainingSol:null,budgetStatus:'unavailable',
      coverage:'test source only',latency:'test only'},
  };
}
function seededHistory(at:number,seq='2'):LifetimeEquityHistory {
  return {
    schemaVersion:1,accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION,
    source:LIFETIME_EQUITY_SOURCE,lastSequence:seq,downsampled:false,
    points:[
      {at:ORIGINAL_POE_INCEPTION,equityUsd:1000,segment:0,kind:'inception'},
      {at:iso(at-60_000),equityUsd:978.12,segment:1,kind:'observed'},
      {at:iso(at),equityUsd:981.43,segment:1,kind:'observed'},
    ],
  };
}

test('durable equity series does not append unverified current valuation or weaken source warnings',()=>{
 const at=Date.now()-60000,history=seededHistory(at),updates:Array<(s:Snapshot)=>void>=[
  s=>{s.status.reconciled=false;},s=>{s.times.reconciledAt=null;s.status.reconciled=false;},s=>{s.times.marketAt=null;},
  s=>{s.times.marketAt=iso(at-200000);},s=>{s.times.reconciledAt=iso(at-200000);},s=>{s.balances.equityUsd=null;},
 ];
 for(const update of updates){const cache=new SnapshotCache(original);cache.acceptLifetimeEquityHistory(history,at);const snapshot=sample('3',at+1000,999.12);update(snapshot);cache.accept(snapshot,at+1000);assert.deepEqual(cache.equityHistory().points,history.points);assert.deepEqual(cache.read()!.snapshot,snapshot);}
});
test('complete current source extends durable equity with exact value and source timestamp',()=>{
 const at=Date.now()-60000,history=seededHistory(at),cache=new SnapshotCache(original);cache.acceptLifetimeEquityHistory(history,at);const snapshot=sample('3',at+1000,990.12);cache.accept(snapshot,at+1000);const points=cache.equityHistory().points;assert.deepEqual(points.slice(0,-1),history.points);assert.deepEqual(points.at(-1),{at:snapshot.times.generatedAt,equityUsd:990.12,segment:1,kind:'observed'});assert.deepEqual(cache.read()!.snapshot,snapshot);
});
