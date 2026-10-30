import {test} from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDashboard } from '../src/dashboard.js';
import { ORIGINAL_POE_ACCOUNT, ORIGINAL_POE_INCEPTION } from '../src/operating-intelligence.js';
import { EQUITY_GAP_MS, LIFETIME_EQUITY_SOURCE, validateLifetimeEquityHistory,
  type LifetimeEquityHistory } from '../src/lifetime-equity-contract.js';
import { LifetimeEquityStore, readPrivateOriginalSnapshot } from '../src/lifetime-equity-store.js';
import { SnapshotCache, type Snapshot } from '../src/reporting.js';

const original = {accountId: ORIGINAL_POE_ACCOUNT, inceptionAt: ORIGINAL_POE_INCEPTION,
  release:'test-source-release', strategy:'test-original-strategy'};
const iso=(at:number)=>new Date(at).toISOString();
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const inception = Date.parse(ORIGINAL_POE_INCEPTION);
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
function store(t:{after:(fn:()=>void)=>void}) {
  const dir=mkdtempSync(join(tmpdir(),'poe-lifetime-equity-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {dir,path:join(dir,'equity.sqlite')};
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
test('durable EC2 sidecar preserves original lifetime equity after reopen and never substitutes P&L',t=>{
  const {path}=store(t);
  const now=Date.now(),first=now-9*60_000,second=now-60_000;
  const ledger=new LifetimeEquityStore(path);
  const one=sample('1',first,997.75),two=sample('2',second,985.15);
  assert.equal(ledger.accept(one,sha('one'),first+1000),'accepted');
  assert.equal(ledger.accept(two,sha('two'),second+1000),'accepted');
  assert.equal(ledger.accept(two,sha('two'),second+2000),'duplicate');
  assert.throws(()=>ledger.accept(two,sha('modified'),second+2000),/SEQUENCE_CONFLICT/);
  const history=ledger.history();
  assert.deepEqual(history.points.map(p=>p.equityUsd),[1000,997.75,985.15]);
  assert.ok(history.points[1]!.segment>0,'long unmeasured inception gap remains disconnected');
  assert.ok(history.points[2]!.segment>history.points[1]!.segment,'eight-minute outage stays a gap');
  assert.equal(ledger.stats().originalVerifiedObservations,2);
  ledger.close();
  const reopened=new LifetimeEquityStore(path);
  assert.deepEqual(reopened.history(),history,'process restart retains exact original equity measurements');
  reopened.close();
  assert.ok(inception<first);
});
test('hash-pinned original receiver snapshot is imported idempotently without guessing earlier equity',t=>{
  const {dir,path}=store(t),ledger=new LifetimeEquityStore(path);
  const now=Date.now(),first=now-180_000,last=now-60_000;
  const witness={
    schemaVersion:1,kind:'POE_ACCEPTED_ORIGINAL_EQUITY_RECEIVER_CAPTURE',
    capturedAt:iso(now),sourceUrl:'https://meme-machine-dashboard-staging.onrender.com/api/snapshot',
    accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION,sourceAt:iso(now),
    sequence:'12',source:{release:'previous-revision',strategy:'previous-strategy'},
    receiverBodySha256:'a'.repeat(64),receiverHistory:{
      source:'accepted-authoritative-portfolio-equity',retention:'receiver-memory-only',
      points:[{at:iso(first),equityUsd:990.12},{at:iso(last),equityUsd:992.25}],
    },limitation:'only authenticated receiver history',
  };
  const text=JSON.stringify(witness)+'\\n',capture=join(dir,'accepted-original-equity-fixture.json');
  writeFileSync(capture,text,{mode:0o600});
  assert.equal(ledger.importReceiverCapture(capture,sha(text),now),'imported');
  assert.equal(ledger.importReceiverCapture(capture,sha(text),now),'duplicate');
  assert.deepEqual(ledger.history(now).points.map(p=>p.equityUsd),[1000,990.12,992.25]);
  assert.equal(ledger.history(now).lastSequence,'0','receiver capture does not invent a source ledger sequence');
  assert.throws(()=>ledger.importReceiverCapture(capture,'b'.repeat(64),now),/HASH_MISMATCH/);
  ledger.close();
  const after=new LifetimeEquityStore(path);
  assert.deepEqual(after.history(now).points.map(p=>p.equityUsd),[1000,990.12,992.25]);
  after.close();
});

test('unknown or unreconciled valuations never turn into invented historical points',t=>{
  const {path}=store(t),ledger=new LifetimeEquityStore(path);
  const now=Date.now();
  assert.equal(ledger.accept(sample('1',now-1000,null),sha('null'),now),'unavailable');
  const stale=sample('2',now-1000,1001.15);stale.times.marketAt=iso(now-200_000);
  assert.equal(ledger.accept(stale,sha('stale'),now),'unavailable');
  assert.deepEqual(ledger.history().points,[{at:ORIGINAL_POE_INCEPTION,equityUsd:1000,
    segment:0,kind:'inception'}]);
  ledger.close();
});
test('bounded display compaction preserves original inception, verified newest point and full SQLite sample count',t=>{
  const {path}=store(t),ledger=new LifetimeEquityStore(path);
  const now=Date.now(),start=now-810*60_000;
  for(let i=1;i<=780;i++){
    const at=start+i*60_000;
    assert.equal(ledger.accept(sample(String(i),at,970+Math.sin(i/30)*10),sha(String(i)),at+1000),'accepted');
  }
  const view=ledger.history(now);
  assert.ok(view.points.length<=720);
  assert.equal(view.points[0]!.at,ORIGINAL_POE_INCEPTION);
  assert.equal(view.points.at(-1)!.at,iso(start+780*60_000));
  assert.equal(ledger.stats().originalVerifiedObservations,780);
  assert.equal(view.downsampled,true);
  ledger.close();
});
test('private source reader rejects altered permissions, wrong account and provenance conflicts',t=>{
  const {dir}=store(t),path=join(dir,'snapshot.json'),now=Date.now();
  const source=sample('1',now-1000,993.25);
  writeFileSync(path,JSON.stringify(source),{mode:0o600});
  assert.equal(readPrivateOriginalSnapshot(path,now).snapshot.balances.equityUsd,993.25);
  chmodSync(path,0o644);
  assert.throws(()=>readPrivateOriginalSnapshot(path,now),/PRIVATE_FILE_REQUIRED/);
  chmodSync(path,0o600);
  source.account.id='wrong-account';
  writeFileSync(path,JSON.stringify(source),{mode:0o600});
  assert.throws(()=>readPrivateOriginalSnapshot(path,now),/ORIGINAL_ACCOUNT_REQUIRED/);
});
test('lifetime source contract rejects wrong account, fabricated negative values, chronology and source spoofing',()=>{
  const at=Date.now()-60_000,base=seededHistory(at);
  assert.deepEqual(validateLifetimeEquityHistory(base),base);
  const invalid=(update:(p:any)=>void)=>{const p=structuredClone(base);update(p);return p};
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.accountId='another')),/ORIGINAL_ACCOUNT_REQUIRED/);
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.points[1].equityUsd=-1)),/AMOUNT_INVALID/);
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.points[2].at=p.points[1].at)),/CHRONOLOGY/);
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.points[1].segment=3)),/SEGMENTS_INVALID/);
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.points[0].equityUsd=999)),/INCEPTION_PROOF_REQUIRED/);
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.foo='unsafe')),/FIELDS_INVALID/);
  assert.throws(()=>validateLifetimeEquityHistory(invalid(p=>p.source='receiver-memory')),/ORIGINAL_ACCOUNT_REQUIRED/);
  assert.equal(EQUITY_GAP_MS,300_000);
});
test('receiver restart restores the exact same independently republished source history',()=>{
  const at=Date.now()-60_000,series=seededHistory(at);
  const first=new SnapshotCache(original);
  assert.equal(first.accept(sample('2',at,981.43),at+1000),'accepted');
  assert.equal(first.acceptLifetimeEquityHistory(series,at+1000),'accepted');
  assert.equal(first.acceptLifetimeEquityHistory(series,at+2000),'duplicate');
  assert.equal(first.equityHistory().retention,'ec2-durable-republished');
  assert.deepEqual(first.equityHistory().points,series.points);
  const second=new SnapshotCache(original);
  assert.equal(second.equityHistory().points.length,0,'empty Render process without source replay');
  assert.equal(second.acceptLifetimeEquityHistory(series,at+3000),'accepted');
  assert.equal(second.accept(sample('2',at,981.43),at+3000),'accepted');
  assert.deepEqual(second.equityHistory(),first.equityHistory(),'same original history after fresh Render receiver');
  const bad=structuredClone(series);bad.lastSequence='3';bad.points.at(-1)!.equityUsd=999;
  assert.throws(()=>second.acceptLifetimeEquityHistory(bad),/SOURCE_VALUE_CONFLICT/);
});
test('existing machine bearer authorizes lifetime history; public viewer cannot write it',async t=>{
  const secret='test-original-equity-secret-0123456789';
  const app=createDashboard({...original,viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:secret});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{app.server.closeAllConnections();await new Promise<void>(ok=>app.server.close(()=>ok()));});
  const address=app.server.address();assert.ok(address&&typeof address==='object');
  const url='http://127.0.0.1:'+address.port,now=Date.now()-60_000;
  const history=seededHistory(now),source=sample('2',now,981.43);
  const send=(path:string,obj:unknown,auth:string)=>fetch(url+path,{method:'POST',
    headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(obj)});
  assert.equal((await send('/api/equity-history',history,'Bearer invalid')).status,401);
  assert.equal((await send('/api/snapshot',source,'Bearer '+secret)).status,200);
  assert.equal((await send('/api/equity-history',history,'Bearer '+secret)).status,200);
  const data=await (await fetch(url+'/api/snapshot')).json();
  assert.equal(data.snapshot.balances.equityUsd,981.43);
  assert.equal(data.equityHistory.retention,'ec2-durable-republished');
  assert.deepEqual(data.equityHistory.points,history.points);
  assert.equal(data.snapshot.pnl.length,0,'the financial/P&L snapshot is unchanged');
});
