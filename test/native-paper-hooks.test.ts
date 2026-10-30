/** OFFLINE hook fixtures only. Public retained origin bytes plus synthetic
 * transport/support/flow timings; disposable ledgers never belong to the pilot. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import bs58 from 'bs58';
import {PaperLedger,type Position} from '../src/ledger.js';
import {PaperTrader,type TraderOptions} from '../src/trader.js';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
import {FlowWindow,type NormalizedTrade} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {NativeCandidateRunner,type NativeAuditCertificate} from '../src/native-candidate-runner.js';
import {decodeMigrationIdentity} from '../src/migration-identity.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';
import {nativePaperCurrentCertificates,nativePaperEssentialEvidence} from '../src/run-native-paper.js';
const T=Date.parse('2026-10-27T12:00:00Z'),MINT=bs58.encode(Buffer.alloc(32,41));
function traderFixture(t:TestContext,inject?:(kind:string,data:any,trader:PaperTrader)=>void){
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-native-hooks-')),ledger=new PaperLedger(join(dir,'fixture.sqlite'),'poe-pilot-native-hooks-fixture');let at=T,trader:PaperTrader;const rows:Array<{kind:string;data:any}>=[];
 const price=()=>({microUsdPerSol:'100000000',at,source:'OFFLINE synthetic USD'}),context=async(positions:Readonly<Record<string,Position>>)=>({price:price(),marks:Object.fromEntries(Object.values(positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:'500000000',evidence:'OFFLINE current full-size mark'}])),...(Object.keys(positions).length?{sourceValidUntil:at+30000}:{})});ledger.initialize(price(),at);
 const options:TraderOptions={ledger,now:()=>at,context:async positions=>context(positions),quote:async request=>({...request,slot:1000,at,outputUnits:'1000',effectiveQuoteLiquidityLamports:'100000000000',evidence:'OFFLINE actual-size adapter stand-in',requiredDepositLamports:'2000000',depositEvidence:'OFFLINE current rent'}),costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'OFFLINE frozen costs'},flowVerification:{verified:true,evidence:'OFFLINE synthetic confirmed ordinary flow'},candidateReadiness:()=>true,experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},pilotExecution:{context:async positions=>context(positions),quote:async request=>({at,slot:1000,spendLamports:request.order.maxSpend,receiveUnits:'1000',evidence:'OFFLINE execution stand-in',requiredDepositLamports:'2000000',depositEvidence:'OFFLINE current rent'})},recorder:{record(kind,data){rows.push({kind,data:structuredClone(data)});inject?.(kind,data,trader);}}};trader=new PaperTrader(options);trader.start();trader.admit({mint:MINT,migrationAt:T-600000,migrationVerified:true,supportedPool:true,evidence:'OFFLINE canonical identity stand-in'});
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});return {trader,ledger,rows,price,get at(){return at;},set at(value:number){at=value;},ready(){ledger.reconcile('fixture-reconcile:'+ledger.state().revision,at,price(),{});ledger.resume('fixture-resume:'+ledger.state().revision,at,price(),{},{version:PILOT_VERSION,evidence:'OFFLINE fixture readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});}};
}

test('actual ACK time crossing a bucket preserves identical six-bucket warming in native and trader windows',t=>{
 const f=traderFixture(t),ack=T+9999;f.at=T+10001;const native=new FlowWindow(MINT,ack);f.trader.activateFlow(MINT,'OFFLINE actual ACK before delayed callback',ack);
 f.at=T+69999;assert.equal(f.trader.candidateFeatures(MINT,f.at)!.sufficientlyObserved,false);assert.equal(native.features(f.at).sufficientlyObserved,false);
 f.at=T+70000;const actual=f.trader.candidateFeatures(MINT,f.at)!;assert.equal(actual.sufficientlyObserved,true);assert.equal(nativePaperFeaturesSha256(actual),nativePaperFeaturesSha256(native.features(f.at)));assert.equal(f.rows.find(r=>r.kind==='trader-input'&&r.data.kind==='flow-start')!.data.at,ack);
 assert.throws(()=>f.trader.activateFlow(MINT,'OFFLINE future ACK',f.at+1),/nonfuture/);assert.throws(()=>f.trader.activateFlow(MINT,'OFFLINE ACK before candidate existed',T-1),/before it became available/);f.trader.candidateGap(MINT,'OFFLINE reconnect');f.at+=2;f.trader.activateFlow(MINT,'OFFLINE later actual ACK',f.at);assert.equal(f.trader.candidateFeatures(MINT,f.at)!.sufficientlyObserved,false,'reconnect cannot reuse the earlier warm window');
});

test('protocol slot received during decision recording invalidates its earlier quote before financial reservation',async t=>{
 let raised=false;const f=traderFixture(t,(kind,data,trader)=>{if(kind==='trader-decision'&&data.stage==='qualified'){trader.noteCandidateSlot(MINT,2000);raised=true;}});f.trader.activateFlow(MINT,'OFFLINE actual ACK');f.trader.setPilotEntryDeposit('2000000','OFFLINE current account rent',MINT);
 for(let i=0;i<6;i++){f.at=T+i*10000+100;f.trader.ingest({identity:{signature:'OFFLINE-buy-'+i,instructionIndex:0,eventIndex:0},mint:MINT,wallet:'OFFLINE-buyer-'+i,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:f.at,commitment:'confirmed',slot:100+i},'curve');}f.at=T+60000;f.ready();await f.trader.tick();assert.equal(raised,true);assert.ok(f.rows.some(r=>r.kind==='trader-decision'&&r.data.stage==='qualified'),'a prediction/quote initially qualified; this is not a successful reservation');assert.equal(f.trader.funnel.reserved,0);assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'0');assert.throws(()=>f.trader.noteCandidateSlot(MINT,-1),/actual slot/);
});

const origin=readFileSync('evidence/integration-2026-10-26T23-32-41.255Z.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x)).find(x=>x.kind==='migration-transaction')!.data;
const signature=origin.transaction.signatures[0] as string,BASE=Math.ceil((origin.blockTime*1000+600000)/10000)*10000+2000;
const decoded=decodeMigrationIdentity(origin,{signature,commitment:'finalized',availableAt:BASE});assert.ok(decoded.ok);const identity=decoded.identity;
const sig=(n:number)=>{const b=Buffer.alloc(64);b.writeUInt32LE(n);return bs58.encode(b);};
function runnerFixture(){
 let at=BASE,allocated=false,openedAt:number|null=null,window:FlowWindow|null=null,gap=false,connection=1,subscription=42,refresh=false,owned:'HELD'|'ENTRY_PENDING'|null=null;let runner:NativeCandidateRunner;
 const notes:NativeNotification[]=[],records:Array<{kind:string;data:any}>=[],certificates:NativeAuditCertificate[]=[],allocations:string[]=[],retirements:string[]=[];
 const flow={addCandidate(){allocated=true;},removeCandidate(){allocated=false;openedAt=null;window=null;},snapshot(mint:string,when=at){if(!allocated||mint!==identity.baseMint)return null;const features=window?.features(when)??null,opening=openedAt===null?null:{slot:origin.slot+1,availableAt:openedAt,bankClockAt:Math.floor(openedAt/1000)*1000},upper=openedAt===null?null:{slot:origin.slot+1000,availableAt:at,bankClockAt:Math.floor(at/1000)*1000};return {dataContract:'confirmed-program-events-v2',scope:{mint,pool:identity.pool},openedAt,connectionId:connection,subscription:openedAt===null?null:subscription,connected:openedAt!==null,warm:features?.sufficientlyObserved===true&&!gap,sourceSupportFresh:true,hasQualityLoss:gap,suspended:false,features,supportContext:upper,openingSupportContext:opening,supportContexts:[...(opening?[opening]:[]),...(upper?[upper]:[])],strictV2Unavailable:false};},notificationLedger(){return structuredClone(notes);},requestSupportRefresh(){refresh=true;},requestHeartbeat(){},async service(){if(refresh){refresh=false;return {kind:'support'};}if(allocated&&openedAt===null){openedAt=at;window=new FlowWindow(identity.baseMint,at);runner.onFlowOpen({mint:identity.baseMint,at});return {kind:'subscribe'};}return {kind:'idle'};},usage(){return {dataContract:'confirmed-program-events-v2',candidates:allocated?1:0,retiring:0,nextServiceAt:refresh||allocated&&openedAt===null?at:at+20000,physicalTransportsSettled:!allocated,fatal:null};},async stop(){allocated=false;}};
 const rpc={async call<T>(method:string){assert.equal(method,'getSignaturesForAddress');return [...notes].reverse().map(n=>({signature:n.signature,slot:n.slot,err:null,blockTime:Math.floor(n.availableAt/1000),confirmationStatus:'confirmed'})).concat([{signature,slot:origin.slot,err:null,blockTime:origin.blockTime,confirmationStatus:'finalized'}]) as T;},usage(){return {waitingOrOperating:false,inFlight:0,dispatchWindow:{readyAt:at,physicalBusy:false},cumulativeUnits:0};},cooldownUntil(){return 0;}};
 runner=new NativeCandidateRunner({flow:flow as any,rpc:rpc as any,now:()=>at,maximumDeep:1,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),financialOwnership:()=>owned,onCandidateAllocated:id=>allocations.push(id.baseMint),onCandidateRetired:mint=>retirements.push(mint),onAuditAvailable:c=>certificates.push(c)});
 runner.importOrigin({originConfirmed:{signature,availableAt:at,transaction:origin},originFinalized:{signature,availableAt:at,transaction:origin}});
 const warm=()=>{assert.ok(window&&openedAt!==null);const first=Math.ceil(openedAt/10000)*10000;for(let i=0;i<6;i++){at=first+i*10000+100;const trade:NormalizedTrade={identity:{kind:'program-log',signature:sig(100+i),program:PUMP_AMM_PROGRAM_ID.toBase58(),logIndex:0,frameOrdinal:0},mint:identity.baseMint,wallet:bs58.encode(Buffer.alloc(32,50+i)),side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:at,commitment:'confirmed',slot:origin.slot+20+i};window.ingest(trade);notes.push({signature:trade.identity.signature,slot:trade.slot!,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null});runner.onTrade();}at=first+60000;};
 return {runner,flow,records,certificates,allocations,retirements,warm,get at(){return at;},set at(value:number){at=value;},set owned(value:'HELD'|'ENTRY_PENDING'|null){owned=value;},reconnect(){connection++;subscription++;openedAt=at;window=new FlowWindow(identity.baseMint,at);notes.length=0;gap=false;runner.onFlowOpen({mint:identity.baseMint,at});}};
}

test('audit certificate is an immutable exact-window generation fact and is unavailable after expiry, reconnect or retirement',async()=>{
 const f=runnerFixture();await f.runner.step();assert.deepEqual(f.allocations,[identity.baseMint]);assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);f.warm();for(let i=0;i<4&&!f.certificates.length;i++)await f.runner.step();assert.equal(f.certificates.length,1,JSON.stringify(f.runner.status().counters));const c=f.runner.currentAuditCertificate(identity.baseMint)!;assert.ok(c);assert.equal(c.executedFlowCompletenessVerified,true);c.subscriptionId=999;assert.equal(f.runner.currentAuditCertificate(identity.baseMint)!.subscriptionId,42,'consumer cannot mutate stored certificate');f.at=c.deadlineAt+1;assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);f.reconnect();assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);f.warm();for(let i=0;i<4&&f.certificates.length<2;i++)await f.runner.step();const fresh=f.runner.currentAuditCertificate(identity.baseMint)!;assert.ok(fresh);assert.equal(fresh.connectionId,2);assert.equal(fresh.subscriptionId,43);assert.notEqual(fresh.openedAt,c.openedAt);f.runner.onGap({mint:identity.baseMint,at:f.at,reason:'OFFLINE lost source'});assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);assert.deepEqual(f.retirements,[identity.baseMint]);await f.runner.stop();
});

test('status/report work cannot backdate the next certificate read or extend an expired certificate',async()=>{
 const f=runnerFixture();await f.runner.step();f.warm();for(let i=0;i<4&&!f.certificates.length;i++)await f.runner.step();const certificate=f.runner.currentAuditCertificate(identity.baseMint)!;assert.ok(certificate);
 const loopAt=f.at;f.at++;f.runner.status();assert.throws(()=>f.runner.certifiedCandidateMints(loopAt),/information cannot be observed before it became available/,'the prior caller ordering reproduces the frozen runtime failure');
 const reportView=nativePaperCurrentCertificates(f.runner,()=>f.at);assert.equal(reportView.at,f.at);assert.deepEqual(reportView.mints,[identity.baseMint]);f.at++;f.runner.status();const candidateView=nativePaperCurrentCertificates(f.runner,()=>f.at);assert.equal(candidateView.at,loopAt+2);assert.deepEqual(candidateView.mints,[identity.baseMint]);
 f.at=certificate.deadlineAt+1;f.runner.status();assert.deepEqual(nativePaperCurrentCertificates(f.runner,()=>f.at).mints,[],'fresh sampling fails closed at actual expiry');assert.equal(certificate.admittedAt,f.certificates[0]!.admittedAt,'no certificate or trade timestamps are rewritten');await f.runner.stop();
});

test('financial ownership survives source retirement and age expiry without deleting HELD identity or origin proof',async()=>{
 const f=runnerFixture();await f.runner.step();f.owned='HELD';f.runner.syncFinancialOwnership();assert.equal(f.runner.status().candidates.length,0);assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.state,'HELD');assert.deepEqual(f.retirements,[identity.baseMint]);f.at+=25*60*60*1000;const checkpoint=f.runner.checkpoint();assert.equal(checkpoint.origins.length,1);assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.state,'HELD');assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);assert.equal(checkpoint.financialWriterOpened,false);await f.runner.stop();
});

test('resolved unfilled entry keeps genuinely continuous observation but invalidates the old certificate before a new audited decision',async()=>{
 const f=runnerFixture();await f.runner.step();f.warm();for(let n=0;n<4&&!f.certificates.length;n++)await f.runner.step();const old=f.runner.currentAuditCertificate(identity.baseMint)!;assert.ok(old);
 f.owned='ENTRY_PENDING';f.runner.syncFinancialOwnership();assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.state,'ENTRY_PENDING');f.owned=null;f.runner.syncFinancialOwnership();
 assert.equal(f.runner.status().candidates.length,1);assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.state,'DEEP_OBSERVATION','a continuously captured allocation must not become a non-deep deferred row');assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.deepSince,old.openedAt);assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null,'the failed action cannot reuse an earlier qualification');assert.deepEqual(f.retirements,[]);
 f.at+=10000;for(let n=0;n<4&&f.certificates.length<2;n++)await f.runner.step();assert.equal(f.certificates.length,2);assert.ok(f.certificates[1]!.windowEndAt>old.windowEndAt);assert.equal(f.certificates[1]!.openedAt,old.openedAt,'no missing data or fresh60s warming is invented for a continuous subscription');assert.equal(f.records.some(r=>r.kind==='native-candidate-work-unavailable'&&String(r.data.reason).includes('PILOT_WATCH_WINDOW_REQUIRES_DEEP')),false);await f.runner.stop();
});

test('resolved entry after a real observation gap cannot preserve the former subscription or old certificate',async()=>{
 const f=runnerFixture();await f.runner.step();f.warm();for(let n=0;n<4&&!f.certificates.length;n++)await f.runner.step();assert.ok(f.runner.currentAuditCertificate(identity.baseMint));f.owned='ENTRY_PENDING';f.runner.syncFinancialOwnership();f.runner.onGap({mint:identity.baseMint,at:f.at,reason:'OFFLINE actual notification gap'});f.owned=null;f.runner.syncFinancialOwnership();assert.equal(f.runner.status().candidates.length,0);assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.state,'DEFERRED');assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.deepSince,null);assert.deepEqual(f.retirements,[identity.baseMint]);await f.runner.stop();
});

test('an unfilled pending action resolving after observation age expires retires normally rather than restoring ineligible deep state',async()=>{
 const f=runnerFixture();await f.runner.step();f.warm();for(let n=0;n<4&&!f.certificates.length;n++)await f.runner.step();f.owned='ENTRY_PENDING';f.runner.syncFinancialOwnership();f.at=identity.chainBlockTime*1000+25*60*60*1000;f.owned=null;assert.doesNotThrow(()=>f.runner.syncFinancialOwnership());assert.equal(f.runner.status().candidates.length,0);assert.equal(f.runner.currentAuditCertificate(identity.baseMint),null);assert.equal(f.runner.watch.lookupIdentity(identity.baseMint,f.at)!.state,'EXPIRED');await f.runner.stop();
});


test('entry cost and exact-size quote evidence survives diagnostic rotation without protecting unrelated diagnostics',()=>{
 for(const kind of ['pilot-entry-cost-preparation','rpc-market-quote']){
  assert.equal(nativePaperEssentialEvidence(kind,'candidate',false),true);
  assert.equal(nativePaperEssentialEvidence(kind,'pending',true),true);
  assert.equal(nativePaperEssentialEvidence(kind,'protection',true),true);
  assert.equal(nativePaperEssentialEvidence(kind,'idle',false),false);
  assert.equal(nativePaperEssentialEvidence(kind,'source',false),false);
 }
 assert.equal(nativePaperEssentialEvidence('provider-diagnostic','candidate',false),false);
});
