/** Isolated private fixture accounts with PAPER schema; no live data/network. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger,DisposableLedger,type Position} from '../src/ledger.js';
import {PaperTrader,type TraderOptions,type PilotExecutionQuote,type PilotQuoteRequest} from '../src/trader.js';
import {PILOT_CONTRACT,PILOT_CONTRACT_SHA256,PILOT_VERSION,assertPilotBaseline} from '../src/pilot-contract.js';
import {PROVISIONAL_RULE,type NormalizedTrade} from '../src/strategy.js';

const T=Date.parse('2026-10-27T12:00:00Z'),MINT='fixture-pilot-token';
function fixture(t:TestContext,settings:{accountId?:string;disposable?:boolean}={}){
  const directory=mkdtempSync(join(tmpdir(),'poe-ISOLATED-pilot-test-')),ledger=settings.disposable?new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-pilot-guard'):new PaperLedger(join(directory,'fixture.sqlite'),settings.accountId??'poe-pilot-test');
  let at=T,net=500000000n,deposit='2000000',executionDeposit=deposit,executionSlot=1000,executionAtOffset=0;const rows:Array<{kind:string;data:any}>=[],reads:Array<{purpose:string;at:number}>=[],decisionCalls:any[]=[];
  const price=()=>({microUsdPerSol:'100000000',at,source:'ISOLATED synthetic USD'}),context=async(positions:Readonly<Record<string,Position>>)=>({price:price(),marks:Object.fromEntries(Object.values(positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:net.toString(),evidence:'ISOLATED synthetic actual-size net mark'}]))});
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
