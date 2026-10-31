/** Isolated private fixture accounts with PAPER schema; no live data/network. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger,DisposableLedger,type Position} from '../src/ledger.js';
import {PaperTrader,type TraderOptions,type PilotExecutionQuote,type PilotQuoteRequest} from '../src/trader.js';
import {PILOT_CONTRACT,PILOT_CONTRACT_SHA256,PILOT_VERSION,CONCURRENT_PILOTS,resolvePilotBinding,assertPilotBaseline,type PilotBinding} from '../src/pilot-contract.js';
import {PROVISIONAL_RULE,type NormalizedTrade} from '../src/strategy.js';

const T=Date.parse('2026-10-27T12:00:00Z'),MINT='fixture-pilot-token';
function fixture(t:TestContext,settings:{accountId?:string;disposable?:boolean}={}){
  const directory=mkdtempSync(join(tmpdir(),'poe-ISOLATED-pilot-test-')),ledger=settings.disposable?new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-pilot-guard'):new PaperLedger(join(directory,'fixture.sqlite'),settings.accountId??'poe-pilot-test');
  let at=T,net=500000000n,deposit='2000000',executionDeposit=deposit,executionSlot=1000,executionAtOffset=0;const rows:Array<{kind:string;data:any}>=[],reads:Array<{purpose:string;at:number}>=[],decisionCalls:any[]=[];
  const price=()=>({microUsdPerSol:'100000000',at,source:'ISOLATED synthetic USD'}),context=async(positions:Readonly<Record<string,Position>>)=>({price:price(),marks:Object.fromEntries(Object.values(positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:net.toString(),evidence:'ISOLATED synthetic actual-size net mark'}])),...(Object.keys(positions).length?{sourceValidUntil:at+30000}:{})});
  ledger.initialize(price(),at);
  const options:TraderOptions={ledger,now:()=>at,context:async positions=>{reads.push({purpose:'regular-context',at});return context(positions);},quote:async request=>{decisionCalls.push({...request});return {...request,slot:1000,at,outputUnits:request.side==='buy'?'1000':(net+7000n).toString(),effectiveQuoteLiquidityLamports:'100000000000',evidence:'ISOLATED size-specific quote',...(request.side==='buy'?{requiredDepositLamports:deposit,depositEvidence:'ISOLATED prepared refundable account rent'}:{})};},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'ISOLATED gas5000+priority2000; rent prepared separately'},flowVerification:{verified:true,evidence:'ISOLATED verified fields only; not forward provider evidence'},recorder:{record:(kind,data)=>rows.push({kind,data})},experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},pilotExecution:{context:async positions=>{reads.push({purpose:'fresh-execution-context',at});return context(positions);},quote:async(request:PilotQuoteRequest):Promise<PilotExecutionQuote>=>{reads.push({purpose:'strong-execution-quote',at});return {at:at+executionAtOffset,slot:executionSlot,spendLamports:request.order.side==='buy'?request.order.maxSpend:'0',receiveUnits:request.order.side==='buy'?'1000':(net+7000n).toString(),evidence:'ISOLATED strong own-pending adapter',...(request.order.side==='buy'?{requiredDepositLamports:executionDeposit,depositEvidence:'ISOLATED confirmed account plan'}:{pricedBaseUnits:request.fullPositionBaseUnits!})};}}};
  const ready=()=>{const marks=Object.fromEntries(Object.values(ledger.state().positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:net.toString(),evidence:'ISOLATED ready mark'}]));ledger.reconcile('ready-reconcile:'+ledger.state().revision,at,price(),marks);return ledger.resume('ready:'+ledger.state().revision,at,price(),marks,{version:PILOT_VERSION,evidence:'ISOLATED test readiness; no production action',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});};
  const admit=(trader:PaperTrader,mint=MINT)=>{trader.admit({mint,migrationAt:T-300000,migrationVerified:true,supportedPool:true,evidence:'ISOLATED actual-role stand-in'});trader.activateFlow(mint,'ISOLATED collection started');};
  const trade=(i:number,mint=MINT):NormalizedTrade=>({identity:{signature:'fixture-pilot-'+mint+'-'+i,instructionIndex:0,eventIndex:0},mint,wallet:'fixture-buyer-'+i,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:T+i*10000+100,commitment:'confirmed',slot:100+i});
  const warm=(trader:PaperTrader,mints=[MINT])=>{for(let i=0;i<6;i++)for(const mint of mints){const event=trade(i,mint);at=event.receivedAt;trader.ingest(event,'curve');}at=T+60000;};
  t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
  return {ledger,options,rows,reads,decisionCalls,ready,admit,warm,trade,get at(){return at;},set at(n:number){at=n;},set net(n:bigint){net=n;},set deposit(n:string){deposit=n;executionDeposit=n;},executionDeposit:(n:string)=>{executionDeposit=n;},executionSlot:(n:number)=>{executionSlot=n;},executionAtOffset:(n:number)=>{executionAtOffset=n;}};
}

test('pilot contract is frozen, isolated by account/mode/hash and leaves other PAPER entry paths closed',async t=>{
  assertPilotBaseline();assert.equal(PROVISIONAL_RULE.version,'persistent-buying-v0-unfrozen');assert.equal(PILOT_CONTRACT.amountConvention,'curve');assert.equal(PILOT_CONTRACT.risk.maximumSimultaneousPositions,1);
  for(const settings of [{accountId:'poe-unrelated-test'},{disposable:true}]){const f=fixture(t,settings);assert.throws(()=>new PaperTrader(f.options),/isolated pilot identity/);}
  const f=fixture(t);
  for(const override of [{experimentalPilot:{...f.options.experimentalPilot!,contractSha256:'a'.repeat(64)}},{experimentalPilot:{...f.options.experimentalPilot!,maxPositions:2}},{costs:{...f.options.costs,gasLamports:'10000'}},{costs:{...f.options.costs,slippageBps:500}},{pilotExecution:undefined},{timeoutMs:3001}])assert.throws(()=>new PaperTrader({...f.options,...override} as TraderOptions),/isolated pilot identity/);
  const ordinary=new PaperTrader({...f.options,experimentalPilot:undefined,pilotExecution:undefined});ordinary.start();f.admit(ordinary);for(let i=0;i<6;i++){const event=f.trade(i);f.at=event.receivedAt;ordinary.ingest(event);}f.at=T+60000;f.ready();await ordinary.tick();assert.equal(ordinary.funnel.reserved,0);assert.equal(ordinary.frozenVersion,null);assert.deepEqual(f.ledger.state().positions,{});
});

test('only explicit confirmed curve flow may warm a pilot window; violations close risk',t=>{
  for(const bad of ['missing','user','processed','slot'] as const){const f=fixture(t),engine=new PaperTrader(f.options);engine.start();f.admit(engine);f.ready();const event=f.trade(0);f.at=event.receivedAt;
    assert.throws(()=>engine.ingest({...event,...(bad==='processed'?{commitment:'processed' as const}:{}),...(bad==='slot'?{slot:undefined}:{})},bad==='missing'?undefined:bad==='user'?'user':'curve'),/explicit curve amounts/);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(engine.ingest(event,'curve'),'unselected');}
});

test('pilot refuses incompatible flow-verification configuration before any adapter or financial action',t=>{
  const f=fixture(t),before=f.ledger.state();
  for(const flowVerification of [undefined,{verified:false,evidence:'unverified fixture'},{verified:true,evidence:''},{verified:true,evidence:'x'.repeat(129)},{verified:true,evidence:'x'.repeat(182)},{verified:true,evidence:'embedded\ncontrol'}]){
    assert.throws(()=>new PaperTrader({...f.options,flowVerification}),/pilot requires verified flow fields and bounded evidence/);
    assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.reads,[]);assert.deepEqual(f.decisionCalls,[]);assert.deepEqual(f.rows,[]);
  }
  assert.doesNotThrow(()=>new PaperTrader({...f.options,flowVerification:{verified:true,evidence:'x'.repeat(128)}}));
  assert.doesNotThrow(()=>new PaperTrader({...f.options,flowVerification:{verified:true,evidence:'pilot-confirmed-curve-v1:'+PILOT_CONTRACT_SHA256}}));
  // Ordinary PAPER keeps its existing missing-data decision behavior; this
  // startup guard belongs only to the explicitly frozen isolated pilot.
  assert.doesNotThrow(()=>new PaperTrader({...f.options,experimentalPilot:undefined,pilotExecution:undefined,flowVerification:{verified:true,evidence:'x'.repeat(182)}}));
  assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.reads,[]);
});

test('frozen pilot admits one delayed position with exact prepared rent and manages its exit while entries are paused',async t=>{
  const f=fixture(t),engine=new PaperTrader(f.options);engine.start();assert.equal(f.ledger.state().controls.entriesEnabled,false);engine.setPilotEntryDeposit('2000000','ISOLATED current account-size rent');f.admit(engine);f.admit(engine,'fixture-second-token');f.warm(engine,[MINT,'fixture-second-token']);f.ready();
  await engine.tick();const buy=Object.values(f.ledger.state().pending)[0]!;assert.equal(buy.side,'buy');assert.equal(buy.deposit,'2000000');assert.equal(buy.gas,'7000');assert.equal(buy.reserved,'500000000');assert.equal(buy.minReceive,'990');assert.equal(engine.nextDueAt(),T+61000);assert.equal(engine.frozenVersion,PILOT_VERSION);assert.throws(()=>engine.setPilotEntryDeposit('1','cannot change pending entry'),/no pending entry/);
  f.at=T+61000;await engine.tick();assert.equal(engine.funnel.paperFilled,1);assert.equal(Object.keys(f.ledger.state().positions).length,1);assert.equal(f.ledger.state().lockedDeposits[MINT],'2000000');assert.equal(f.decisionCalls.filter(q=>q.side==='buy').length,1);assert.ok(f.reads.findIndex(r=>r.purpose==='fresh-execution-context')<f.reads.findIndex(r=>r.purpose==='strong-execution-quote'));assert.equal(f.reads.find(r=>r.purpose==='fresh-execution-context')!.at,T+61000);assert.equal(engine.funnel.reserved,1);
  f.at=T+62000;f.net=400000000n;await engine.tick();const sell=Object.values(f.ledger.state().pending)[0]!;assert.equal(sell.side,'sell');engine.feedGap();assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.ok(f.ledger.state().pending[sell.id]);f.at=T+63000;const before=f.reads.length;await engine.tick();assert.equal(f.reads[before]!.purpose,'fresh-execution-context');assert.equal(engine.funnel.exited,1);assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().lockedDeposits[MINT],'2000000');assert.equal(f.ledger.state().executionCosts,'14000');assert.equal(f.ledger.state().inceptionAt,T);
  assert.ok(engine.decisions().every(d=>d.ruleVersion===PILOT_VERSION));assert.equal(f.rows.find(r=>r.kind==='trader-config')!.data.pilot.contractSha256,PILOT_CONTRACT_SHA256);assert.equal(f.rows.find(r=>r.kind==='trader-config')!.data.rule.version,PILOT_VERSION);assert.equal(f.rows.find(r=>r.kind==='trader-input'&&r.data.kind==='trade')!.data.amountConvention,'curve');
});

test('unprepared/mismatched decision rent and stale or lower-slot execution never become pilot fills',async t=>{
  for(const fault of ['unprepared','decision-rent','execution-rent','execution-slot','execution-time'] as const){const f=fixture(t),engine=new PaperTrader(f.options);engine.start();if(fault!=='unprepared')engine.setPilotEntryDeposit(fault==='decision-rent'?'1':'2000000','ISOLATED rent preparation');f.admit(engine);f.warm(engine);f.ready();await engine.tick();
    if(fault==='unprepared'||fault==='decision-rent'){assert.equal(engine.funnel.reserved,0);continue;}
    if(fault==='execution-rent')f.executionDeposit('1');if(fault==='execution-slot')f.executionSlot(104);if(fault==='execution-time')f.executionAtOffset(-1);f.at=T+61000;await engine.tick();assert.equal(engine.funnel.paperFilled,0);assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'7000');assert.equal(f.ledger.state().lamports,'9999993000');}
});

test('pilot quote age and pending ownership are rechecked after execution evidence recording',async t=>{
  for(const changed of ['age','owner','floor'] as const){const f=fixture(t),original=f.options.recorder.record;let engine:PaperTrader;
    engine=new PaperTrader({...f.options,recorder:{record(kind,data){original(kind,data);if(kind==='trader-pilot-execution-quote'){if(changed==='age')f.at+=2001;else if(changed==='owner')engine.pauseNewEntries('ISOLATED owner closed pending entry during recording');else engine.ingest({...f.trade(6),receivedAt:f.at,slot:2000},'curve');}}}});engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED current rent');f.admit(engine);f.warm(engine);f.ready();await engine.tick();f.at=T+61000;await engine.tick();assert.equal(engine.funnel.paperFilled,0);assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,changed==='floor'?'7000':'0');assert.ok(f.rows.some(r=>r.kind==='trader-pilot-execution-refusal'));}
});

test('explicit staged contracts preserve v1 and bind stage, version and hash without changing entry or financial rules',t=>{
  assert.equal(createHash('sha256').update(JSON.stringify(PILOT_CONTRACT)).digest('hex'),'665b28e6cdc326b20cd5e921fbddbaf9fdfd786ce80cbd2286d98a00a8fef2a9');assert.equal(PILOT_CONTRACT.risk.maximumSimultaneousPositions,1);
  assert.deepEqual(Object.keys(CONCURRENT_PILOTS),['2','3']);
  for(const stage of [2,3]as const){
    const spec=CONCURRENT_PILOTS[stage];assert.equal(createHash('sha256').update(JSON.stringify(spec.contract)).digest('hex'),spec.contractSha256);assert.equal(spec.contract.stage,stage);assert.equal(spec.contract.risk.maximumSimultaneousPositions,stage);assert.equal(spec.contract.baseline,PILOT_CONTRACT.baseline);assert.equal(spec.contract.execution,PILOT_CONTRACT.execution);assert.equal(spec.contract.progression.automaticStageChanges,false);
    assert.deepEqual({...spec.contract.risk,maximumSimultaneousPositions:1},PILOT_CONTRACT.risk);
    const binding={version:spec.contract.version,stage,contractSha256:spec.contractSha256,maxPositions:stage};assert.ok(resolvePilotBinding(binding));
    for(const changed of [{...binding,maxPositions:4},{...binding,maxPositions:1},{...binding,stage:1},{...binding,stage:stage===2?3:2},{...binding,contractSha256:PILOT_CONTRACT_SHA256},{...binding,version:PILOT_VERSION}])assert.equal(resolvePilotBinding(changed),null);
  }
  assert.equal(resolvePilotBinding({version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:2}),null);assert.equal(resolvePilotBinding({version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1,stage:1}),null);
  const f=fixture(t);for(const stage of [2,3]as const){const s=CONCURRENT_PILOTS[stage];assert.throws(()=>new PaperTrader({...f.options,experimentalPilot:{version:s.contract.version,stage,contractSha256:s.contractSha256,maxPositions:1}as unknown as PilotBinding}),/isolated pilot identity/);}
});

test('staged two/three-position admission stops at its explicit cap and records the stage on every decision',async t=>{
  for(const stage of [2,3]as const){
    const f=fixture(t),spec=CONCURRENT_PILOTS[stage],binding={version:spec.contract.version,stage,contractSha256:spec.contractSha256,maxPositions:stage}as PilotBinding;
    const engine=new PaperTrader({...f.options,experimentalPilot:binding});engine.start();
    const mints=[MINT,'fixture-stage-second','fixture-stage-third','fixture-stage-fourth'];for(const mint of mints){f.admit(engine,mint);engine.setPilotEntryDeposit('2000000','ISOLATED current required account rent',mint);}f.warm(engine,mints);
    f.ledger.reconcile('staged-ready',f.at,{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'},{});f.ledger.resume('staged-resume',f.at,{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'},{},{version:spec.contract.version,evidence:'ISOLATED staged readiness',marketAt:f.at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
    for(let i=0;i<stage;i++){await engine.tick();f.at+=1000;await engine.tick();}
    assert.equal(Object.keys(f.ledger.state().positions).length,stage);assert.deepEqual(f.ledger.state().pending,{});assert.equal(engine.funnel.reserved,stage);assert.equal(engine.funnel.paperFilled,stage);assert.equal(f.ledger.state().executionCosts,String(stage*7000));assert.equal(f.ledger.state().inceptionAt,T);assert.equal(engine.frozenVersion,spec.contract.version);
    const config=f.rows.find(r=>r.kind==='trader-config')!.data;assert.equal(config.pilot.stage,stage);assert.equal(config.pilot.maxPositions,stage);assert.equal(config.pilot.contractSha256,spec.contractSha256);assert.ok(engine.decisions().every(d=>d.ruleVersion===spec.contract.version));assert.equal(f.ledger.state().positions['fixture-stage-fourth'],undefined);
    if(stage===3){
      // A later lower-stage startup must preserve and manage already-held
      // exposure rather than requiring its disappearance to satisfy admission.
      const positions=structuredClone(f.ledger.state().positions),lower=new PaperTrader(f.options);lower.start();assert.deepEqual(f.ledger.state().positions,positions);assert.equal(f.ledger.state().controls.entriesEnabled,false);
      f.net=400000000n;await lower.tick();assert.equal(Object.values(f.ledger.state().pending).filter(o=>o.side==='sell').length,3);f.at+=1000;await lower.tick();assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().inceptionAt,T);
    }
  }
});

test('candidate pending information and a gap during decision recording cannot reserve an obsolete entry or stop another candidate',async t=>{
  for(const interruption of ['pending','gap']as const){
    const f=fixture(t),spec=CONCURRENT_PILOTS[2];let engine:PaperTrader;const record=f.options.recorder.record;
    engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:2,contractSha256:spec.contractSha256,maxPositions:2},recorder:{record(kind,data){record(kind,data);const row=data as any;if(kind==='trader-decision'&&row.mint===MINT&&row.stage==='qualified'){if(interruption==='pending')engine.setCandidateInformationPending(MINT,true);else engine.candidateGap(MINT,'ISOLATED candidate-specific loss during recording');}}}});
    engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED exact account rent',MINT);engine.setPilotEntryDeposit('2000000','ISOLATED exact account rent','fixture-unaffected');f.admit(engine);f.admit(engine,'fixture-unaffected');f.warm(engine,[MINT,'fixture-unaffected']);f.ready();await engine.tick();
    const pending=Object.values(f.ledger.state().pending);assert.equal(pending.length,1);assert.equal(pending[0]!.mint,'fixture-unaffected');assert.equal(f.ledger.state().controls.entriesEnabled,true);assert.equal(f.ledger.state().executionCosts,'0');
  }
});

test('scoped candidate gap cancels only its unattempted buy, preserving other entries, exits and held management',async t=>{
  const f=fixture(t),spec=CONCURRENT_PILOTS[3];f.ready();
  const usd=()=>({microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'}),buy=(id:string,mint:string)=>({id,side:'buy' as const,mint,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'ISOLATED setup'});
  f.ledger.order(buy('setup-held','fixture-held'),usd(),{});f.at+=1000;f.ledger.attempt('fill-held','setup-held',f.at,{at:f.at,spendLamports:'10000000',receiveUnits:'1000',evidence:'ISOLATED setup'},usd());f.net=10007000n;
  const engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:3,contractSha256:spec.contractSha256,maxPositions:3}});engine.start();f.admit(engine);f.admit(engine,'fixture-unaffected');f.admit(engine,'fixture-held');f.ready();const marks={'fixture-held':{at:f.at,pricedBaseUnits:'1000',netLamports:'10007000',evidence:'ISOLATED actual-size mark'}};
  f.ledger.order(buy('target-buy',MINT),usd(),marks);f.ledger.order(buy('other-buy','fixture-unaffected'),usd(),marks);f.ledger.order({id:'held-sell',side:'sell',mint:'fixture-held',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'ISOLATED owned exit'},usd(),marks);
  const before=f.ledger.state();engine.candidateGap(MINT,'ISOLATED only target candidate failed');assert.equal(f.ledger.state().pending['target-buy'],undefined);assert.deepEqual(f.ledger.state().pending['other-buy'],before.pending['other-buy']);assert.deepEqual(f.ledger.state().pending['held-sell'],before.pending['held-sell']);assert.deepEqual(f.ledger.state().positions,before.positions);assert.equal(f.ledger.state().lamports,before.lamports);assert.equal(f.ledger.state().controls.entriesEnabled,true);
  engine.feedGap();assert.equal(f.ledger.state().pending['other-buy'],undefined);assert.ok(f.ledger.state().pending['held-sell']);f.at+=1000;await engine.tick();assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().executionCosts,'14000');assert.equal(f.ledger.state().inceptionAt,T);
});

test('candidate-specific loss preserves an uncertain financial entry instead of erasing its reservation',async t=>{
  const f=fixture(t),spec=CONCURRENT_PILOTS[2],engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:2,contractSha256:spec.contractSha256,maxPositions:2}});
  engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED required rent',MINT);f.admit(engine);f.warm(engine);f.ready();await engine.tick();const order=Object.values(f.ledger.state().pending)[0]!;
  const attempt=f.ledger.attempt.bind(f.ledger);f.ledger.attempt=(()=>{throw Error('ISOLATED unresolved financial write; outcome unknown');})as typeof f.ledger.attempt;f.at=order.executeAt;await engine.tick();f.ledger.attempt=attempt;
  const before=f.ledger.state();assert.ok(before.pending[order.id]);assert.equal(before.controls.entriesEnabled,false);engine.candidateGap(MINT,'ISOLATED candidate loss during financial uncertainty');assert.deepEqual(f.ledger.state().pending[order.id],before.pending[order.id]);assert.deepEqual(f.ledger.state().positions,before.positions);assert.equal(f.ledger.state().lamports,before.lamports);assert.equal(f.ledger.state().executionCosts,'0');assert.equal(engine.nextDueAt(),order.expiresAt);
});

test('concurrent entry sizing binds each mint rent and preserves a pending order while another mint is prepared',async t=>{
  const f=fixture(t),spec=CONCURRENT_PILOTS[2],other='fixture-rent-other',deposits:Record<string,string>={[MINT]:'2000000',[other]:'3000000'};
  const engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:2,contractSha256:spec.contractSha256,maxPositions:2},quote:async(request,signal)=>{const q=await f.options.quote(request,signal);return q?{...q,requiredDepositLamports:deposits[request.mint],depositEvidence:'ISOLATED exact per-mint current rent'}:null;},pilotExecution:{context:f.options.pilotExecution!.context,quote:async(request,signal)=>{const q=await f.options.pilotExecution!.quote(request,signal);return q?{...q,requiredDepositLamports:request.order.deposit}:null;}}});
  engine.start();assert.throws(()=>engine.setPilotEntryDeposit('1','missing mint'),/explicit mint/);for(const mint of [MINT,other]){f.admit(engine,mint);engine.setPilotEntryDeposit(deposits[mint]!,'ISOLATED per-mint current rent',mint);}f.warm(engine,[MINT,other]);f.ready();await engine.tick({candidateMint:MINT});
  const first=Object.values(f.ledger.state().pending)[0]!;assert.equal(first.deposit,'2000000');assert.equal(first.maxSpend,'497993000');assert.throws(()=>engine.setPilotEntryDeposit('1','cannot change own pending entry',MINT),/no pending entry/);
  deposits[other]='4000000';assert.doesNotThrow(()=>engine.setPilotEntryDeposit(deposits[other]!,'ISOLATED newer current rent for other mint',other));assert.deepEqual(f.ledger.state().pending[first.id],first);await engine.tick({candidateMint:other,reuseFreshContext:true});
  const second=Object.values(f.ledger.state().pending).find(o=>o.mint===other)!;assert.equal(second.deposit,'4000000');assert.equal(second.maxSpend,'495993000');assert.equal(second.reserved,first.reserved);f.at=T+61000;await engine.tick({evaluateCandidates:false});
  assert.equal(f.ledger.state().lockedDeposits[MINT],'2000000');assert.equal(f.ledger.state().lockedDeposits[other],'4000000');assert.equal(f.ledger.state().executionCosts,'14000');assert.equal(Object.keys(f.ledger.state().positions).length,2);
});

test('protection-only and one-mint ticks keep due actions first without chaining other candidate quotes',async t=>{
  const f=fixture(t),spec=CONCURRENT_PILOTS[3],mints=[MINT,'fixture-target-second','fixture-skipped-third'];
  const engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:3,contractSha256:spec.contractSha256,maxPositions:3}});engine.start();for(const mint of mints){f.admit(engine,mint);engine.setPilotEntryDeposit('2000000','ISOLATED per-mint rent',mint);}f.warm(engine,mints);f.ready();
  await engine.tick({evaluateCandidates:false});assert.equal(f.decisionCalls.length,0);assert.equal(engine.funnel.evaluated,0);assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,1);
  await engine.tick({candidateMint:MINT,reuseFreshContext:true});await engine.tick({candidateMint:mints[1],reuseFreshContext:true});assert.deepEqual(f.decisionCalls.map(q=>q.mint),mints.slice(0,2));assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,1);assert.equal(Object.keys(f.ledger.state().pending).length,2);
  const before=f.reads.length;f.at=T+61000;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.reads[before]!.purpose,'fresh-execution-context');assert.equal(Object.keys(f.ledger.state().positions).length,2);assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,2,'position-key change invalidates the prior empty-inventory context');assert.equal(f.decisionCalls.length,2);assert.equal(f.ledger.state().positions[mints[2]!],undefined);
  const calls=f.reads.length;await assert.rejects(engine.tick({candidateMint:'not-admitted'}),/admitted candidate/);assert.equal(f.reads.length,calls);
});

test('explicit fresh context reuse keeps original timestamps and refreshes stale or incomplete facts',async t=>{
  const setupHeld=(f:ReturnType<typeof fixture>)=>{f.ready();f.ledger.order({id:'reuse-held',side:'buy',mint:MINT,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'ISOLATED held setup'}, {microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'},{});f.at+=1000;f.ledger.attempt('reuse-fill','reuse-held',f.at,{at:f.at,spendLamports:'10000000',receiveUnits:'1000',evidence:'ISOLATED held setup'},{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'});f.net=10007000n;};
  {
    const f=fixture(t);setupHeld(f);const engine=new PaperTrader(f.options);engine.start();await engine.tick({evaluateCandidates:false});const original=f.at;f.at+=1000;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,1);const reused=f.rows.filter(r=>r.kind==='trader-context').at(-1)!.data.context;assert.equal(reused.price.at,original);assert.equal(reused.marks[MINT].at,original);assert.equal(f.rows.filter(r=>r.kind==='trader-context-reuse').length,1);
    f.at+=1001;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,2);assert.equal(f.rows.filter(r=>r.kind==='trader-context').at(-1)!.data.context.marks[MINT].at,f.at);
  }
  for(const fault of ['usd-age','mark-age','wrong-size','missing-mark','source-missing','source-expired']as const){
    const f=fixture(t);setupHeld(f);let broken=true;const engine=new PaperTrader({...f.options,context:async(positions,signal)=>{const c=await f.options.context(positions,signal);if(broken){if(fault==='usd-age')c.price!.at-=10001;else if(fault==='mark-age')c.marks[MINT]!.at-=2001;else if(fault==='wrong-size')c.marks[MINT]!.pricedBaseUnits='999';else if(fault==='missing-mark')delete c.marks[MINT];else if(fault==='source-missing')delete c.sourceValidUntil;else c.sourceValidUntil=f.at-1;}return c;}});engine.start();await engine.tick({evaluateCandidates:false});broken=false;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,2,fault);assert.ok(f.ledger.state().positions[MINT]);assert.equal(f.rows.filter(r=>r.kind==='trader-context-reuse').length,0,fault);
  }
});

test('a maximum due-action budget applies to the whole tick across repeated financial and holding loops',async t=>{
  const f=fixture(t),spec=CONCURRENT_PILOTS[3],mints=[MINT,'fixture-budget-second','fixture-budget-third'],engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:3,contractSha256:spec.contractSha256,maxPositions:3}});
  engine.start();for(const mint of mints){f.admit(engine,mint);engine.setPilotEntryDeposit('2000000','ISOLATED current rent',mint);}f.warm(engine,mints);f.ready();
  for(let i=0;i<3;i++){await engine.tick();f.at+=1000;await engine.tick();}assert.equal(Object.keys(f.ledger.state().positions).length,3);
  f.net=400000000n;await engine.tick({evaluateCandidates:false});assert.equal(Object.values(f.ledger.state().pending).filter(o=>o.side==='sell').length,3);f.at+=1000;
  for(let i=0;i<3;i++){
    const before=f.reads.filter(r=>r.purpose==='strong-execution-quote').length,result=await engine.tick({evaluateCandidates:false,maximumDueActions:1});assert.equal(f.reads.filter(r=>r.purpose==='strong-execution-quote').length-before,1);assert.equal(result.execution.filter(r=>r.status==='filled').length,1);assert.equal(Object.keys(f.ledger.state().positions).length,2-i);assert.equal(Object.keys(f.ledger.state().pending).length,2-i);if(i<2)assert.ok(result.nextDueAt!==null&&result.nextDueAt<=f.at);else assert.equal(result.nextDueAt,null);
  }
  assert.equal(f.ledger.state().executionCosts,'42000');assert.equal(f.ledger.state().inceptionAt,T);await assert.rejects(engine.tick({maximumDueActions:0 as 1}),/explicit tick options/);
});

test('held context reuse honors inclusive source expiry and rechecks it after recorder delay',async t=>{
  for(const scenario of ['boundary','recorder-delay']as const){
    const f=fixture(t);f.ready();f.ledger.order({id:'source-held',side:'buy',mint:MINT,decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'ISOLATED source-boundary setup'},{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'},{});f.at+=1000;f.ledger.attempt('source-fill','source-held',f.at,{at:f.at,spendLamports:'10000000',receiveUnits:'1000',evidence:'ISOLATED setup'},{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'});f.net=10007000n;
    const originalAt=f.at,sourceValidUntil=originalAt+1;let initial=true,delay=false;const record=f.options.recorder.record;
    const engine=new PaperTrader({...f.options,context:async(positions,signal)=>{const c=await f.options.context(positions,signal);return {...c,sourceValidUntil:initial?sourceValidUntil:f.at+30000};},recorder:{record(kind,data){record(kind,data);if(delay&&kind==='trader-context-reuse')f.at+=2;}}});engine.start();await engine.tick({evaluateCandidates:false});f.ready();
    if(scenario==='boundary'){
      f.at=sourceValidUntil;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,1);assert.equal(f.rows.filter(r=>r.kind==='trader-context').at(-1)!.data.context.sourceValidUntil,sourceValidUntil);
      f.at++;initial=false;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.at-originalAt,2,'original quote remains within2s at source expiry');assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,2);assert.equal(f.rows.filter(r=>r.kind==='trader-context-reuse').length,1);assert.equal(f.rows.filter(r=>r.kind==='trader-context').at(-1)!.data.context.marks[MINT].at,f.at);
    }else{
      delay=true;await engine.tick({evaluateCandidates:false,reuseFreshContext:true});assert.equal(f.at-originalAt,2);assert.equal(f.reads.filter(r=>r.purpose==='regular-context').length,1);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.ledger.state().daily.reconciledAt,originalAt,'expired source cannot be reconciled at a backdated pre-recorder time');assert.ok(f.ledger.state().positions[MINT]);
    }
  }
});

test('candidate readiness rechecks the actual current bucket after a cold quote or decision recorder crosses its audit boundary',async t=>{
  for(const delay of ['none','quote','recorder','readiness','throw']as const){
    const f=fixture(t),checks:number[]=[];let moved=false;const record=f.options.recorder.record;
    const engine=new PaperTrader({...f.options,candidateReadiness:(_mint,at)=>{checks.push(at);if(delay==='throw')throw Error('ISOLATED audit unavailable');if(delay==='readiness'&&!moved){moved=true;f.at++;}return Math.floor(at/10000)*10000<=T+60000;},quote:async(request,signal)=>{if(delay==='quote')f.at++;return f.options.quote(request,signal);},recorder:{record(kind,data){record(kind,data);if(delay==='recorder'&&kind==='trader-decision'&&(data as any).stage==='qualified')f.at++;}}});
    engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED required rent');f.admit(engine);f.warm(engine);f.at=T+69999;f.ready();await engine.tick();
    assert.equal(engine.funnel.reserved,delay==='none'?1:0,delay);assert.equal(Object.keys(f.ledger.state().pending).length,delay==='none'?1:0,delay);assert.equal(f.ledger.state().executionCosts,'0');
    if(delay==='quote'||delay==='recorder')assert.ok(checks.includes(T+70000),delay);if(delay==='readiness'||delay==='throw')assert.equal(f.decisionCalls.length,0,delay);
  }
});

test('late same-bucket audited evidence receives one evaluation without pre-audit quotes or duplicate reservations',async t=>{
  for(const separatePredictiveReadiness of [false,true]){
    const f=fixture(t);let audited=false;
    const engine=new PaperTrader({...f.options,candidateReadiness:()=>audited,...(separatePredictiveReadiness?{predictiveReadiness:()=>audited}:{})});
    engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED required rent');f.admit(engine);f.warm(engine);f.ready();
    for(let i=0;i<4;i++){await engine.tick();f.at+=25;}
    assert.equal(engine.funnel.evaluated,0,'unavailable evidence did not complete this bucket');
    assert.equal(f.decisionCalls.length,0);assert.equal(Object.keys(f.ledger.state().pending).length,0);
    assert.equal(f.rows.filter(r=>r.kind==='trader-candidate-evidence-deferred').length,1,'repeated unavailable ticks coalesce their diagnostic');
    audited=true;await engine.tick();assert.equal(engine.funnel.evaluated,1);assert.equal(engine.funnel.reserved,1);
    const before=f.decisionCalls.length,order=Object.values(f.ledger.state().pending)[0]!;
    await engine.tick();await engine.tick();assert.equal(engine.funnel.evaluated,1);assert.equal(engine.funnel.reserved,1);assert.equal(f.decisionCalls.length,before);
    assert.deepEqual(Object.values(f.ledger.state().pending),[order]);assert.equal(order.executeAt,order.decidedAt+1000);
  }
});

test('evidence readiness does not reopen an already completed financial risk rejection in the same bucket',async t=>{
  const f=fixture(t),engine=new PaperTrader({...f.options,candidateReadiness:()=>true,predictiveReadiness:()=>true});
  engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED required rent');f.admit(engine);f.warm(engine);
  await engine.tick();assert.equal(engine.funnel.evaluated,1);assert.equal(engine.funnel.reserved,0);assert.equal(f.decisionCalls.length,0);
  assert.ok(engine.decisions().some(r=>r.reason==='entries-not-authorized-by-ledger'));
  f.ready();await engine.tick();assert.equal(engine.funnel.evaluated,1);assert.equal(engine.funnel.reserved,0);assert.equal(f.decisionCalls.length,0);
});

test('bounded financial ticks yield new candidate quotes after reserving a future held exit while the default remains unchanged',async t=>{
  for(const bounded of [false,true]){
    const f=fixture(t),spec=CONCURRENT_PILOTS[2];f.ready();f.ledger.order({id:'priority-held',side:'buy',mint:'fixture-priority-held',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'ISOLATED priority setup'},{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'},{});f.at+=1000;f.ledger.attempt('priority-fill','priority-held',f.at,{at:f.at,spendLamports:'10000000',receiveUnits:'1000',evidence:'ISOLATED fixture'},{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED USD'});
    const engine=new PaperTrader({...f.options,experimentalPilot:{version:spec.contract.version,stage:2,contractSha256:spec.contractSha256,maxPositions:2}});engine.start();f.at=T+10000;f.admit(engine);engine.setPilotEntryDeposit('2000000','ISOLATED required rent',MINT);for(let i=0;i<6;i++){const trade={...f.trade(i),receivedAt:T+10000+i*10000+100};f.at=trade.receivedAt;engine.ingest(trade,'curve');}f.at=T+70000;f.ready();
    await engine.tick(bounded?{maximumDueActions:1}:{});assert.equal(f.decisionCalls.filter(q=>q.side==='sell').length,1);assert.equal(f.decisionCalls.filter(q=>q.side==='buy').length,bounded?0:1);assert.equal(Object.values(f.ledger.state().pending).filter(o=>o.side==='sell').length,1);assert.equal(engine.nextDueAt(),f.at+1000);assert.ok(f.ledger.state().positions['fixture-priority-held']);assert.equal(f.ledger.state().executionCosts,'7000');
  }
});


test('protection timing records actual exit evaluation after processing and retains pending exit observation',async t=>{
  const f=fixture(t);let processingDelay=0;
  const engine=new PaperTrader({...f.options,recorder:{record(kind,data){f.options.recorder.record(kind,data);if(kind==='trader-context')f.at+=processingDelay;}}});
  engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED current rent');f.admit(engine);f.warm(engine);f.ready();await engine.tick();f.at=T+61000;await engine.tick();
  assert.equal(Object.keys(f.ledger.state().positions).length,1);processingDelay=2500;f.at+=2000;
  const from=f.rows.length;await engine.tick({evaluateCandidates:false});
  const unavailable=f.rows.slice(from).find(r=>r.kind==='trader-held-evaluation')!.data;
  assert.equal(unavailable.evaluatedAt-unavailable.quoteAt,2500);assert.equal(unavailable.usable,false);assert.equal(unavailable.action,'quote-required');
  processingDelay=0;f.net=400000000n;f.at+=2000;await engine.tick({evaluateCandidates:false});
  const pending=Object.values(f.ledger.state().pending)[0]!;assert.equal(pending.side,'sell');
  f.at+=100;const before=f.rows.length;await engine.tick({evaluateCandidates:false});
  const retained=f.rows.slice(before).find(r=>r.kind==='trader-held-evaluation')!.data;
  assert.equal(retained.pendingExit,true);assert.equal(retained.outcome,'owned-exit-retained');assert.equal(retained.usable,true);assert.ok(f.ledger.state().pending[pending.id]);
});


test('a delayed fresh entry quote performs genuine flat reconciliation before sizing authorization and reservation',async t=>{
 const f=fixture(t);let quoteStarted=0;const engine=new PaperTrader({...f.options,quote:async(request,signal)=>{quoteStarted=f.at;f.at+=2500;return f.options.quote(request,signal);}});engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED prepared account rent');f.admit(engine);f.warm(engine);f.ready();const initial=f.ledger.state();await engine.tick();
 const order=Object.values(f.ledger.state().pending)[0];assert.ok(order,JSON.stringify(engine.decisions()));assert.equal(order.decidedAt,quoteStarted+2500);const proof=f.rows.find(r=>r.kind==='trader-entry-flat-reconciliation')!.data;assert.equal(proof.priorReconciledAt,quoteStarted);assert.equal(proof.reconciledAt,order.decidedAt);assert.equal(proof.usdAt,quoteStarted);assert.equal(proof.marketTimestampsRefreshed,false);assert.equal(f.ledger.state().lamports,initial.lamports);assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.exportJournal(100).filter(r=>(r as any).action_id.includes('entry-flat-reconcile')).length,1);
});

for(const fault of ['changed-revision','pending','owner-pause','stale-usd','quote-stale-after-record']as const)test(`flat entry reconciliation refuses ${fault} without laundering market or financial authority`,async t=>{
 const f=fixture(t);let expectedPending:string[]=[];const engine=new PaperTrader({...f.options,quote:async(request,signal)=>{f.at+=fault==='stale-usd'?10001:2500;if(fault==='changed-revision')f.ledger.reconcile('ISOLATED intervening actual reconciliation',f.at,{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED changed context'},{});if(fault==='pending'){f.ledger.reconcile('ISOLATED current obligation context',f.at,{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED current context'},{});f.ledger.order({id:'ISOLATED pending other obligation',side:'buy',mint:'other-obligation',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'1',minReceive:'1',decisionEvidence:'ISOLATED pre-existing obligation'},{microUsdPerSol:'100000000',at:f.at,source:'ISOLATED price'},{});expectedPending=['ISOLATED pending other obligation'];}if(fault==='owner-pause')f.ledger.pause('ISOLATED owner pause',f.at,'operator paused new entries');return f.options.quote(request,signal);},recorder:{record(kind,data){f.options.recorder?.record(kind,data);if(fault==='quote-stale-after-record'&&kind==='trader-decision'&&(data as any).stage==='qualified')f.at+=2001;}}});engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED prepared account rent');f.admit(engine);f.warm(engine);f.ready();await engine.tick();assert.deepEqual(Object.keys(f.ledger.state().pending),expectedPending);assert.deepEqual(f.ledger.state().positions,{});assert.equal(engine.funnel.reserved,0);if(fault!=='quote-stale-after-record'){assert.equal(f.rows.some(r=>r.kind==='trader-entry-flat-reconciliation'),false);const refusal=f.rows.find(r=>r.kind==='trader-entry-flat-reconciliation-refused')!.data;assert.equal(refusal.technicalFailure,true);assert.equal(refusal.strategyRejection,false);assert.equal(refusal.transportStarted,false);assert.equal(refusal.quoteAt,f.at);assert.ok(engine.decisions().some(d=>d.stage==='missing-data'&&d.reason==='entry-flat-reconciliation-unavailable'));}
});


test('optional predictive recomputation fault cannot abort a completed risk rejection or close financial permissions',async t=>{
  const f=fixture(t),engine=new PaperTrader({...f.options,predictiveDiagnostics:true,candidateReadiness:()=>true,predictiveReadiness:()=>true});
  engine.start();engine.setPilotEntryDeposit('2000000','ISOLATED current account rent');f.admit(engine);f.warm(engine);
  const candidate=(engine as any).candidates.get(MINT),original=candidate.window.features.bind(candidate.window);let reads=0;
  candidate.window.features=(at:number)=>{reads++;if(reads===2)throw Error('ISOLATED optional predictive window rollover');return original(at);};
  const before=f.ledger.state();await assert.doesNotReject(engine.tick());
  const after=f.ledger.state();assert.equal(reads,2);assert.equal(engine.funnel.evaluated,1);
  assert.ok(engine.decisions().some(d=>d.stage==='risk-rejection'));
  assert.ok(f.rows.some(r=>r.kind==='trader-decision'));
  assert.equal(f.rows.some(r=>r.kind==='trader-predictive-assessment'),false);
  assert.equal(after.controls.reason,before.controls.reason,'secondary diagnostics cannot become hard financial intent');
  assert.deepEqual(after.positions,{});assert.deepEqual(after.pending,{});
});
