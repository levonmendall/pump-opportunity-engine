import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,PaperLedger,type Position} from '../src/ledger.js';
import {Recorder} from '../src/recorder.js';
import {PaperTrader,type SizeQuote,type SizeRequest,type TraderOptions} from '../src/trader.js';
import {PROVISIONAL_RULE,type EventIdentity,type NormalizedTrade} from '../src/strategy.js';
import {planObservation} from '../src/observation.js';

const T=Date.parse('2026-10-26T12:00:00Z'),MINT='fixture-mint';
type Recorded={kind:string;data:any};
function fixture(t:TestContext,settings:{verified?:boolean;paper?:boolean}={}){
  const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-trader-')),path=join(directory,'fixture.sqlite'),evidence=join(directory,'selected.ndjson');let now=T,exitNet=500_000_000n,available=true,usd='100000000',missingMarks=false,usdUnavailable=false;
  const ledger=settings.paper?new PaperLedger(path,'poe-local-isolated-test'):new DisposableLedger(path,'fixture-trader');
  ledger.initialize({microUsdPerSol:'100000000',at:now,source:'DISPOSABLE USD'},now);chmodSync(path,0o600);
  const recorder=new Recorder(evidence),ledgers=[ledger],recorders=[recorder];const quoteCalls:SizeRequest[]=[];
  const context=async(positions:Readonly<Record<string,Position>>)=>({price:usdUnavailable?null:{microUsdPerSol:usd,at:now,source:'DISPOSABLE USD'},marks:Object.fromEntries((missingMarks?[]:Object.values(positions)).map(p=>[p.mint,{at:now,pricedBaseUnits:p.units,netLamports:exitNet.toString(),evidence:'DISPOSABLE actual-size net liquidation'}]))});
  const quote=async(request:SizeRequest):Promise<SizeQuote|null>=>{quoteCalls.push({...request});if(!available)return null;return {...request,at:now,evidence:'DISPOSABLE size-specific state',outputUnits:request.side==='buy'?'1000':(exitNet+10_000n).toString(),effectiveQuoteLiquidityLamports:'100000000000',...(request.side==='sell'?{refundedDepositLamports:'2000000',refundEvidence:'DISPOSABLE modeled close account'}:{})};};
  const options=(l=ledger,r=recorder):TraderOptions=>({ledger:l,now:()=>now,context,quote,recorder:r,costs:{gasLamports:'10000',depositLamports:'2000000',slippageBps:500,evidence:'DISPOSABLE fixed base/priority/rent assumptions'},...(settings.verified===false?{}:{flowVerification:{verified:true,evidence:'DISPOSABLE verified normalized contract; not production feed evidence'}})});
  const trader=new PaperTrader(options());trader.start();
  const ready=(l=ledger)=>{const c={price:{microUsdPerSol:usd,at:now,source:'DISPOSABLE USD'},marks:Object.fromEntries(Object.values(l.state().positions).map(p=>[p.mint,{at:now,pricedBaseUnits:p.units,netLamports:exitNet.toString(),evidence:'DISPOSABLE fresh mark'}]))};l.reconcile('fixture-ready-reconcile:'+l.state().revision,now,c.price,c.marks);assert.equal(l.resume('fixture-ready:'+l.state().revision,now,c.price,c.marks,{version:'DISPOSABLE runtime readiness',evidence:'fixture only; no forward authorization',marketAt:now,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);};
  const admit=(engine=trader,mint=MINT)=>{engine.admit({mint,migrationAt:now-300_000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE canonical migrated pool'});engine.activateFlow(mint,'DISPOSABLE subscription activation');};
  const warm=(engine=trader,mint=MINT,from=now)=>{for(let i=0;i<6;i++){now=from+i*10_000+100;engine.ingest({identity:{signature:`fixture-trade-${mint}-${from}-${i}`,instructionIndex:0,eventIndex:0},mint,wallet:`fixture-wallet-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:String(300_000-i*20_000),receivedAt:now,commitment:'processed',slot:100+i});}now=from+60_000;};
  t.after(()=>{for(const r of recorders)r.close();for(const l of ledgers){try{l.close();}catch{}}rmSync(directory,{recursive:true,force:true});});
  return {directory,path,evidence,ledger,trader,options,ready,admit,warm,quoteCalls,context,quote,ledgers,recorders,recorder,now:()=>now,set:(at:number)=>{now=at;},stopNet:()=>{exitNet=400_000_000n;},unavailable:()=>{available=false;},usd:(value:string)=>{usd=value;},noUsd:()=>{usdUnavailable=true;},unknownMarks:()=>{missingMarks=true;},records:():Recorded[]=>readFileSync(evidence,'utf8').trim().split('\n').map(s=>JSON.parse(s))};
}

test('normalized flow completes one disposable delayed lifecycle, and feed loss does not disable supported RPC exits',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();assert.equal(f.quoteCalls.length,0);assert.equal(f.trader.funnel.paperFilled,0);
  const reserved=await f.trader.tick();assert.equal(reserved.nextDueAt,T+61_000);assert.equal(f.trader.funnel.reserved,1);assert.equal(f.quoteCalls.length,1);assert.deepEqual(f.ledger.state().positions,{});
  await f.trader.tick();assert.equal(f.quoteCalls.length,1); // Coalesced closed-bin evaluation, not quotes per event/tick.
  f.set(T+61_000);await f.trader.tick();assert.equal(f.trader.funnel.paperFilled,1);assert.equal(f.ledger.state().positions[MINT]!.units,'1000');assert.equal(f.ledger.hasTradedMint(MINT),true);
  f.set(T+62_000);f.stopNet();await f.trader.tick();const pendingExit=Object.values(f.ledger.state().pending)[0]!;assert.equal(pendingExit.side,'sell');assert.equal(pendingExit.executeAt,T+63_000);
  f.set(T+62_100);f.trader.feedGap();assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(Object.values(f.ledger.state().pending)[0]!.side,'sell');
  f.set(T+63_000);await f.trader.tick();assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.trader.funnel.exited,1);assert.equal(f.ledger.state().executionCosts,'20000');
  assert.equal(f.ledger.state().inceptionAt,T);assert.equal(f.ledger.state().lamports,'9902000000');assert.equal(f.ledger.state().controls.entriesEnabled,false);
  const sellCalls=f.quoteCalls.filter(q=>q.side==='sell');assert.equal(sellCalls.length,2);assert.ok(sellCalls.every(q=>q.inputUnits==='1000'));
  assert.ok(f.records().some(r=>r.kind==='trader-input'&&r.data.kind==='gap'));assert.ok(f.records().some(r=>r.kind==='trader-execution'&&r.data.status==='filled'&&r.data.side==='sell'));
});

test('unverified field contract defaults closed and current unfrozen rule cannot enter a production PAPER account',async t=>{
  for(const config of [{verified:false},{paper:true}]){
    const f=fixture(t,config);f.admit();f.warm();f.ready();await f.trader.tick();assert.equal(f.quoteCalls.length,0);assert.deepEqual(f.ledger.state().pending,{});
    assert.equal(f.trader.funnel.qualified,0);assert.equal(f.trader.funnel.paperFilled,0);
    assert.equal(f.trader.decisions().at(-1)!.stage,config.verified===false?'missing-data':'risk-rejection');
  }
});

test('budget-loss retirement durably cancels an unexpired entry before flow stops, without an invented gas charge',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();
  const plan=planObservation({now:f.now(),candidates:[],financial:f.ledger.state(),currentTradeSubscriptions:[],rpcProtection:{},budgetAllowsObservation:false});
  assert.equal(plan.closeEntryRiskBeforeRetirement,true);assert.equal(plan.pendingEntryIdsToCancelOrQuarantine.length,1);
  const cash=f.ledger.state().lamports;
  // The orchestrator closes financial entry risk before calling upstream
  // unsubscribe/deactivate. Financially uncertain actions must be quarantined,
  // never discarded or allowed to extend paid traffic past its cap.
  f.trader.feedGap();assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.ledger.state().pending,{});
  f.trader.deactivateFlow(MINT,'DISPOSABLE budget ceiling; upstream retirement after durable cancellation');
  f.set(T+61_000);await f.trader.tick();assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().lamports,cash);assert.equal(f.ledger.state().executionCosts,'0');assert.equal(f.trader.funnel.paperFilled,0);
});

test('intentional held-flow retirement keeps RPC exits working and never retires an unexpired entry',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();
  const before=f.ledger.state();assert.throws(()=>f.trader.deactivateFlow(MINT,'DISPOSABLE premature subscription retirement'),/pending entry flow/);assert.deepEqual(f.ledger.state(),before);
  f.set(T+61_000);await f.trader.tick();assert.equal(f.ledger.state().positions[MINT]!.units,'1000');
  const held=f.ledger.state();f.trader.deactivateFlow(MINT,'DISPOSABLE tested full-size RPC handoff; no holding-flow exit rule');assert.deepEqual(f.ledger.state(),held);
  assert.equal(f.trader.ingest({identity:{signature:'fixture-retired-flow',instructionIndex:0,eventIndex:0},mint:MINT,wallet:'fixture-wallet',side:'buy',quoteLamports:'1',tokenUnits:'1',receivedAt:f.now(),commitment:'processed'}),'unselected');
  f.set(T+62_000);f.stopNet();await f.trader.tick();assert.equal(Object.values(f.ledger.state().pending)[0]!.side,'sell');
  f.set(T+63_000);await f.trader.tick();assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.trader.funnel.exited,1);assert.equal(f.ledger.state().inceptionAt,T);
  assert.ok(f.records().some(r=>r.kind==='trader-input'&&r.data.kind==='flow-stop'));
});

test('candidate evidence is bounded; a gap requires fresh activation and a complete fresh window',async t=>{
  const f=fixture(t);for(let i=0;i<12;i++)assert.equal(f.trader.admit({mint:`fixture-${i}`,migrationAt:T-300_000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE pool'}),true);
  assert.equal(f.trader.admit({mint:'fixture-overflow',migrationAt:T-300_000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE pool'}),false);
  f.trader.remove('fixture-0');f.admit();f.warm();f.ready();f.trader.feedGap();await f.trader.tick();assert.equal(f.quoteCalls.length,0);
  f.set(T+70_000);f.trader.activateFlow(MINT,'DISPOSABLE reconnect/resubscribe');f.warm(f.trader,MINT,T+70_000);f.ready();await f.trader.tick();assert.equal(f.trader.funnel.reserved,0);
  assert.equal(f.trader.decisions().at(-1)!.reason,'feed-gap'); // The ACK/lost-event boundary is excluded, not accepted as a full window.
  f.set(T+140_000);f.ready();await f.trader.tick();assert.equal(f.trader.funnel.reserved,1);
});

test('first subscription warms inclusively from its actual ACK, never from earlier candidate admission',async t=>{
  const f=fixture(t);f.trader.admit({mint:MINT,migrationAt:T-300_000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE admitted before subscription'});
  f.set(T+10_000);f.trader.activateFlow(MINT,'DISPOSABLE first actual ACK');
  const trade=(i:number):NormalizedTrade=>({identity:{signature:`fixture-delayed-ack-${i}`,instructionIndex:0,eventIndex:0},mint:MINT,wallet:`fixture-wallet-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:String(300_000-i*20_000),receivedAt:T+10_100+i*10_000,commitment:'processed'});
  for(let i=0;i<5;i++){const observation=trade(i);f.set(observation.receivedAt);f.trader.ingest(observation);}
  f.set(T+60_000);f.ready();await f.trader.tick();assert.equal(f.trader.funnel.reserved,0);assert.equal(f.quoteCalls.length,0);
  const last=trade(5);f.set(last.receivedAt);f.trader.ingest(last);f.set(T+70_000);f.ready();await f.trader.tick();assert.equal(f.trader.funnel.reserved,1);
});

test('first activation cannot move availability backward before candidate admission',t=>{
  const f=fixture(t);f.set(T+20_000);f.trader.admit({mint:MINT,migrationAt:T-300_000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE admission availability'});
  const state=f.ledger.state();f.set(T+10_000);assert.throws(()=>f.trader.activateFlow(MINT,'DISPOSABLE backward ACK'),/before it became available/);
  f.set(T+10_100);assert.equal(f.trader.ingest({identity:{signature:'fixture-too-early',instructionIndex:0,eventIndex:0},mint:MINT,wallet:'fixture-wallet',side:'buy',quoteLamports:'1',tokenUnits:'1',receivedAt:f.now(),commitment:'processed'}),'unselected');
  assert.deepEqual(f.ledger.state(),state);assert.equal(f.quoteCalls.length,0);
});

test('a real gap before the first ACK still excludes its exact lost-event boundary',async t=>{
  const f=fixture(t);f.trader.admit({mint:MINT,migrationAt:T-300_000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE admission before gap'});
  f.set(T+10_000);f.trader.feedGap();f.trader.activateFlow(MINT,'DISPOSABLE first ACK after gap');f.warm(f.trader,MINT,T+10_000);f.ready();await f.trader.tick();
  assert.equal(f.trader.funnel.reserved,0);assert.equal(f.trader.decisions().at(-1)!.reason,'feed-gap');
  f.set(T+80_000);f.ready();await f.trader.tick();assert.equal(f.trader.funnel.reserved,1);
});

test('missing size-specific exit quote preserves exposure; no stop price or free exit is invented',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();f.set(T+61_000);await f.trader.tick();
  f.set(T+62_000);f.stopNet();f.unavailable();await f.trader.tick();assert.equal(f.ledger.state().positions[MINT]!.units,'1000');assert.deepEqual(f.ledger.state().pending,{});
  assert.equal(f.trader.funnel.exited,0);assert.equal(f.trader.decisions().at(-1)!.stage,'execution-unavailable');
  assert.equal(f.ledger.state().executionCosts,'10000');
});

test('traded-mint no-reentry index survives exit, restart and consistent restore',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();f.set(T+61_000);await f.trader.tick();f.stopNet();f.set(T+62_000);await f.trader.tick();f.set(T+63_000);await f.trader.tick();
  const snapshot=join(f.directory,'consistent.sqlite');await f.ledger.backup(snapshot);chmodSync(snapshot,0o600);f.ledger.close();
  const restored=new DisposableLedger(snapshot,'fixture-trader');f.ledgers.push(restored);assert.equal(restored.hasTradedMint(MINT),true);assert.equal(restored.state().inceptionAt,T);
  const nextEvidence=new Recorder(join(f.directory,'restart.ndjson'));f.recorders.push(nextEvidence);const next=new PaperTrader(f.options(restored,nextEvidence));next.start();
  f.set(T+70_000);f.admit(next);f.warm(next,MINT,T+70_000);f.ready(restored);const calls=f.quoteCalls.length;await next.tick();
  assert.equal(f.quoteCalls.length,calls);assert.equal(next.decisions().at(-1)!.reason,'reentry-disabled');assert.deepEqual(restored.state().positions,{});
  const current=(await f.context({})).price!;
  assert.throws(()=>restored.order({id:'fixture-bypass',mint:MINT,side:'buy',decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'10000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'DISPOSABLE direct API bypass'},current,{}),/re-entry/);
});

test('one recorder replays normalized receive-time observations into the same deterministic reservation and fill',async t=>{
  const original=fixture(t);original.admit();original.warm();original.ready();await original.trader.tick();original.set(T+61_000);await original.trader.tick();
  const observed=original.records(),replay=fixture(t);const input=observed.filter(r=>r.kind==='trader-input');
  for(const row of input){const d=row.data;
    if(d.kind==='candidate'){replay.set(d.at);replay.trader.admit(d.candidate);}
    else if(d.kind==='flow-start'){replay.set(d.at);replay.trader.activateFlow(d.mint,d.evidence);}
    else if(d.kind==='trade'){replay.set(d.trade.receivedAt);replay.trader.ingest(d.trade as NormalizedTrade);}
    else if(d.kind==='tick'){replay.set(d.at);if(d.at===T+60_000)replay.ready();await replay.trader.tick();}
  }
  assert.equal(replay.ledger.state().lamports,original.ledger.state().lamports);assert.deepEqual(replay.ledger.state().positions,original.ledger.state().positions);
  assert.equal(replay.trader.funnel.paperFilled,1);assert.deepEqual(replay.quoteCalls,original.quoteCalls);
  const firstTrade=input.find(r=>r.data.kind==='trade')!;assert.ok(firstTrade.data.trade.receivedAt<T+60_000);
  assert.ok(observed.some(r=>r.kind==='trader-quote'&&r.data.purpose==='execution'));
});

test('selected evidence failure closes new risk without abandoning an already-held position',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();f.set(T+61_000);await f.trader.tick();
  const broken=new PaperTrader({...f.options(),recorder:{record(){throw new Error('DISPOSABLE evidence disk full');}}});broken.start();f.stopNet();f.set(T+62_000);await broken.tick();
  assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(Object.values(f.ledger.state().pending)[0]!.side,'sell');f.set(T+63_000);await broken.tick();
  assert.deepEqual(f.ledger.state().positions,{});assert.equal(broken.funnel.exited,1);
});

test('held-position exit proposals and due execution precede new candidate quotes',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();f.set(T+61_000);await f.trader.tick();
  f.set(T+70_000);f.admit(f.trader,'fixture-next');f.warm(f.trader,'fixture-next',T+70_000);f.stopNet();f.ready();const before=f.quoteCalls.length;
  await f.trader.tick();assert.deepEqual(f.quoteCalls.slice(before).map(q=>q.side),['sell','buy']);
  f.set(T+131_000);const attempts=f.quoteCalls.length;await f.trader.tick();assert.deepEqual(f.quoteCalls.slice(attempts).map(q=>q.side),['sell','buy']);
  assert.equal(f.trader.funnel.paperFilled,2);assert.equal(f.trader.funnel.exited,1);
});

test('three $50 reservations cap aggregate commitment without canceling valid earlier decisions',async t=>{
  const f=fixture(t),mints=['fixture-a','fixture-b','fixture-c','fixture-d'];for(const mint of mints)f.admit(f.trader,mint);
  for(let i=0;i<6;i++)for(let j=0;j<mints.length;j++){const mint=mints[j]!;f.set(T+i*10_000+100+j);f.trader.ingest({identity:{signature:`fixture-${mint}-${i}`,instructionIndex:0,eventIndex:0},mint,wallet:`fixture-wallet-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:String(300_000-i*20_000),receivedAt:f.now(),commitment:'confirmed'});}
  f.set(T+60_000);f.ready();for(let i=0;i<4;i++)await f.trader.tick();assert.equal(f.quoteCalls.length,3);assert.equal(Object.keys(f.ledger.state().pending).length,3);assert.equal(f.ledger.state().controls.entriesEnabled,true);
  const reserved=Object.values(f.ledger.state().pending).reduce((sum,o)=>sum+BigInt(o.reserved),0n);assert.equal(reserved,1_500_000_000n);
  assert.equal(f.trader.funnel.reserved,3);assert.equal(f.trader.decisions().at(-1)!.stage,'risk-rejection');
});

test('unknown liquidation closes new risk, but max-holding exit still requires and uses an actual-size quote',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();f.set(T+61_000);await f.trader.tick();f.unknownMarks();f.set(T+62_000);await f.trader.tick();
  assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.ledger.state().positions[MINT]!.units,'1000');assert.deepEqual(f.ledger.state().pending,{});
  f.set(T+61_000+PROVISIONAL_RULE.maximumHoldingMs);await f.trader.tick();assert.equal(Object.values(f.ledger.state().pending)[0]!.side,'sell');
  f.set(f.now()+1000);await f.trader.tick();assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.trader.funnel.exited,1);
});

test('UTC marked-equity loss gate stays paused after price recovery and produces no entry quote',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();f.usd('90000000');await f.trader.tick();assert.equal(f.ledger.state().daily.lossPaused,true);assert.equal(f.quoteCalls.length,0);
  f.usd('100000000');f.set(T+70_000);await f.trader.tick();assert.equal(f.ledger.state().daily.lossPaused,true);assert.equal(f.quoteCalls.length,0);assert.deepEqual(f.ledger.state().pending,{});
});

test('a supported full-size SOL exit remains available during an honest unknown-USD valuation',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();f.set(T+61_000);await f.trader.tick();f.stopNet();f.noUsd();f.set(T+62_000);await f.trader.tick();
  assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(Object.values(f.ledger.state().pending)[0]!.side,'sell');f.set(T+63_000);await f.trader.tick();
  assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.trader.funnel.exited,1);assert.equal(f.ledger.projection(f.now()).equityMicroUsd,null);
});

test('financial commit uncertainty pauses new risk without treating an unresolved reservation as obsolete flow',async t=>{
  const f=fixture(t);f.admit();f.warm();f.ready();await f.trader.tick();const pendingId=Object.keys(f.ledger.state().pending)[0]!;
  const actual=f.ledger.attempt.bind(f.ledger);f.ledger.attempt=()=>{throw new Error('DISPOSABLE interrupted storage write');};f.set(T+61_000);await f.trader.tick();
  assert.ok(f.ledger.state().pending[pendingId]);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.ledger.state().positions,{});
  f.set(T+61_100);f.trader.feedGap();assert.ok(f.ledger.state().pending[pendingId]);f.ledger.attempt=actual;f.set(T+65_000);await f.trader.tick();
  assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().lamports,'10000000000');assert.equal(f.ledger.state().executionCosts,'0');
});

test('a quote crossing a closed-bin boundary does not cause duplicate evaluation of that completed bin',async t=>{
  const f=fixture(t);const crossing=new PaperTrader({...f.options(),quote:async request=>{f.set(T+70_100);return f.quote(request);}});crossing.start();f.admit(crossing);f.warm(crossing);f.set(T+69_900);f.ready();
  await crossing.tick();assert.equal(f.quoteCalls.length,1);assert.equal(crossing.funnel.evaluated,1);assert.equal(crossing.funnel.reserved,1);
  await crossing.tick();assert.equal(f.quoteCalls.length,1);assert.equal(crossing.funnel.evaluated,1);
});

test('recorder inputs are allowlisted rather than copying unrelated configuration or adapter payload fields',async t=>{
  const f=fixture(t),sentinel='DISPOSABLE-DO-NOT-RECORD';const base=f.options();
  const engine=new PaperTrader({...base,costs:{...base.costs,unrelated:sentinel},flowVerification:{...base.flowVerification!,unrelated:sentinel},quote:async request=>({...await f.quote(request),unrelated:sentinel} as SizeQuote)} as TraderOptions);
  engine.start();f.admit(engine);f.warm(engine);f.ready();await engine.tick();f.set(T+61_000);await engine.tick();
  engine.reverse(MINT,{signature:'fixture-reversed',instructionIndex:0,eventIndex:0,unrelated:sentinel} as EventIdentity);
  assert.ok(!JSON.stringify(f.records()).includes(sentinel));assert.equal(engine.funnel.paperFilled,1);
});

test('mutable adapter requests cannot substitute another mint in decision or delayed execution quotes',async t=>{
  for(const phase of ['decision','execution']){
    const f=fixture(t);let calls=0,mutationRefused=false;
    const engine=new PaperTrader({...f.options(),quote:async request=>{calls++;if(calls===(phase==='decision'?1:2)){try{request.mint='fixture-other';}catch{mutationRefused=true;}return {...await f.quote(request),mint:'fixture-other'} as SizeQuote;}return f.quote(request);}});
    engine.start();f.admit(engine);f.warm(engine);f.ready();await engine.tick();if(phase==='execution'){f.set(T+61_000);await engine.tick();}
    assert.equal(mutationRefused,true);assert.equal(engine.funnel.paperFilled,0);assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.hasTradedMint(MINT),false);
    assert.equal(f.ledger.state().executionCosts,phase==='decision'?'0':'10000');
  }
});

test('reserving an entry yields before slower lower-priority candidate quotes can consume its execution window',async t=>{
  const f=fixture(t),mints=['fixture-a','fixture-b','fixture-c'];let lowerQuotes=0;
  const engine=new PaperTrader({...f.options(),timeoutMs:10_000,quote:async request=>{if(request.mint!=='fixture-a'){lowerQuotes++;f.set(f.now()+6000);return null;}return f.quote(request);}});engine.start();for(const mint of mints)f.admit(engine,mint);
  for(let i=0;i<6;i++)for(const [j,mint]of mints.entries()){f.set(T+i*10_000+100+j);engine.ingest({identity:{signature:`fixture-${mint}-${i}`,instructionIndex:0,eventIndex:0},mint,wallet:`fixture-wallet-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:String(300_000-i*20_000),receivedAt:f.now(),commitment:'confirmed'});}
  f.set(T+60_000);f.ready();const first=await engine.tick();assert.equal(lowerQuotes,0);assert.equal(first.nextDueAt,T+61_000);assert.equal(engine.funnel.reserved,1);
  f.set(T+61_000);await engine.tick();assert.equal(engine.funnel.paperFilled,1);assert.equal(lowerQuotes,0);
});

test('a pending action becoming due during a candidate estimate is serviced before another candidate',async t=>{
  const f=fixture(t);const order:string[]=[];
  const engine=new PaperTrader({...f.options(),quote:async request=>{order.push(request.mint);f.set(f.now()+1000);const q=await f.quote(request);return request.mint===MINT?{...q,effectiveQuoteLiquidityLamports:'1'} as SizeQuote:q;}});engine.start();f.admit(engine);f.warm(engine);f.ready();
  f.ledger.order({id:'fixture-existing',mint:'fixture-existing-mint',side:'buy',decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'10000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'DISPOSABLE prior reservation'},(await f.context({})).price!,{});
  await engine.tick();assert.deepEqual(order,[MINT,'fixture-existing-mint']);assert.equal(f.ledger.state().positions['fixture-existing-mint']!.units,'1000');assert.equal(f.ledger.state().positions['fixture-existing-mint']!.enteredAt,T+62_000);
});

test('low-priority quote timeout is capped by the upcoming execution deadline rather than its10s adapter limit',{timeout:5000},async t=>{
  const f=fixture(t);let live=false,startReal=0,aborted=false;const clock=()=>live?T+60_000+Date.now()-startReal:f.now();
  const engine=new PaperTrader({...f.options(),now:clock,timeoutMs:10_000,context:async positions=>{f.set(clock());return f.context(positions);},quote:async(request,signal)=>{
    if(request.mint===MINT)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('DISPOSABLE lower-priority request aborted'));},{once:true}));
    f.set(clock());return f.quote(request);
  }});engine.start();f.admit(engine);f.warm(engine);f.ready();startReal=Date.now();live=true;
  f.ledger.order({id:'fixture-deadline',mint:'fixture-existing-mint',side:'buy',decidedAt:clock(),executeAt:clock()+1000,expiresAt:clock()+5000,gas:'10000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'DISPOSABLE prior reservation'},(await f.context({})).price!,{});
  await engine.tick();assert.equal(aborted,true);assert.equal(f.ledger.state().positions['fixture-existing-mint']!.units,'1000');assert.ok(f.ledger.state().positions['fixture-existing-mint']!.enteredAt<T+65_000);
});

test('another held-position estimate cannot starve an already-reserved exit',{timeout:5000},async t=>{
  const f=fixture(t),mints=['fixture-held-a','fixture-held-b','fixture-held-c'];f.ready();
  for(const [i,mint]of mints.entries())f.ledger.order({id:`fixture-seed-${i}`,mint,side:'buy',decidedAt:T,executeAt:T+500,expiresAt:T+2000,gas:'10000',deposit:'2000000',maxSpend:'1000000',minReceive:'1',decisionEvidence:'DISPOSABLE held position setup'},(await f.context({})).price!,{});
  f.set(T+500);for(const [i]of mints.entries())f.ledger.attempt(`fixture-fill-${i}`,`fixture-seed-${i}`,f.now(),{at:f.now(),spendLamports:'1000000',receiveUnits:'1000',evidence:'DISPOSABLE size quote'},(await f.context({})).price!,(await f.context(f.ledger.state().positions)).marks);
  let live=false,startReal=0,aborted=false;const clock=()=>live?T+500+Date.now()-startReal:f.now();
  const engine=new PaperTrader({...f.options(),now:clock,timeoutMs:10_000,context:async positions=>{f.set(clock());return f.context(positions);},quote:async(request,signal)=>{
    if(request.mint==='fixture-held-b')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('DISPOSABLE secondary exit estimate canceled'));},{once:true}));
    f.set(clock());return f.quote(request);
  }});engine.start();startReal=Date.now();live=true;await engine.tick();
  assert.equal(aborted,true);assert.equal(f.ledger.state().positions['fixture-held-a'],undefined);assert.equal(f.ledger.state().positions['fixture-held-b']!.units,'1000');assert.equal(engine.funnel.exited,1);
});
