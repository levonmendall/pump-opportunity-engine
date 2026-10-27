/** Offline component connection only: real dispatcher/budget/coordinator/ledger,
 * retained account bytes and explicitly synthetic common bank Clock/time. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator,type ExecutionContext} from '../src/execution.js';
import {ComponentBudget} from '../src/component-budget.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {ResearchHeldMarket} from '../src/research-held-market.js';
import {chooseProtectedResearchWork} from '../src/research-dispatch.js';
import {ActivePipeline} from '../src/active-pipeline.js';
import type {PoolWireAccount} from '../src/pool.js';

test('a feasible owned exit uses the shared physical gate, preserves suspended flow and prices the remaining holding coherently',async t=>{
  const retained=['2026-10-26T19-42-16.130Z','2026-10-26T19-57-35.882Z'].map(run=>({proof:JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8')),state:JSON.parse(readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').find(s=>JSON.parse(s).kind==='pool-state')!).data}));
  const accounts=new Map<string,PoolWireAccount|null>();for(const r of retained)for(let i=0;i<7;i++)if(!accounts.has(r.state.addresses[i]))accounts.set(r.state.addresses[i],r.state.value[i]);
  // These original pools were captured at different times. Only this fixture
  // gives them a shared synthetic context; no live two-pool claim follows.
  const inception=Math.max(...retained.map(r=>Date.parse(r.proof.quote.validatedAt))),slot=Math.max(...retained.map(r=>r.state.context.slot));let at=inception;
  const directory=mkdtempSync(join(tmpdir(),'poe-fixture-scheduler-execution-')),path=join(directory,'fixture.sqlite'),realNow=Date.now;Date.now=()=>at;
  let ledger:DisposableLedger|undefined,budget:ComponentBudget|undefined;
  t.after(()=>{budget?.close();ledger?.close();Date.now=realNow;rmSync(directory,{recursive:true,force:true});});
  ledger=new DisposableLedger(path,'fixture-shared-scheduler-execution');
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'FIXTURE fixed USD; no provider'}),recorded:Array<{kind:string;data:any}>=[],physical:Array<{at:number;addresses:string[];inFlight:number}>=[];
  const recorder={record(kind:string,data:unknown){recorded.push({kind,data});}};
  budget=new ComponentBudget({statePath:join(directory,'isolated-budget.json'),grantId:'fixture-shared-scheduler-execution',baseline:{calls:0,bytes:0,starts:[],refusal:'RPC_HTTP_429',refusalAt:inception-60000,sha256:'f'.repeat(64)},startedAt:inception,now:()=>at,monotonic:()=>at-inception,sleep:async ms=>{at+=ms;},record:recorder.record});
  let latestStartAt:number|undefined;
  const rpc={async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal):Promise<T>{
    assert.equal(method,'getMultipleAccounts');return budget!.operate({transport:'http',method},async operation=>{
      const addresses=params[0] as string[];physical.push({at,addresses:[...addresses],inFlight:budget!.inFlight});
      const clock=Buffer.alloc(40);clock.writeBigUInt64LE(BigInt(slot));clock.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
      const wire:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[clock.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
      const result={context:{slot},value:addresses.map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?wire:structuredClone(accounts.get(address)??null))};
      operation.chargeHttp(Buffer.byteLength(JSON.stringify(result)));operation.completeResponse();return result as T;
    },signal,{latestStartAt});
  }};
  const pricer=new ResearchClockPositionPricer(rpc,recorder),market=new ResearchHeldMarket({pricer,inventory:()=>ledger!.state(),now:()=>at,usd:price,gasLamports:'7000',gasEvidence:'FIXTURE explicit gas only',recorder});
  for(const r of retained)market.registerPool({mint:r.proof.quote.mint,migrationSlot:r.proof.origin.slot,migrationVerified:true,evidence:'Retained migration; synthetic bank timing for this fixture'});
  ledger.initialize(price(),at);ledger.reconcile('fixture-ready',at,price(),{});ledger.resume('fixture-resume',at,price(),{},{version:'fixture-scheduler',evidence:'Fixture setup only; no natural signal',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  // Minimal disposable inventory setup, using existing ledger rules. Entry
  // strategy/delegate integration has its own E2E test; it is not claimed here.
  for(const [i,r] of retained.entries())ledger.order({id:'setup-'+i,mint:r.proof.quote.mint,side:'buy',decidedAt:at,executeAt:at+1000,expiresAt:at+10000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:r.proof.quote.buy.outputBaseUnits,decisionEvidence:'FIXTURE retained quote quantities; not a natural entry'},price(),{});
  at+=1000;ledger.attempt('setup-fill-0','setup-0',at,{at,spendLamports:'10000000',receiveUnits:retained[0]!.proof.quote.buy.outputBaseUnits,evidence:'FIXTURE setup'},price(),{});
  const firstContext=await market.context(ledger.state().positions,new AbortController().signal);ledger.attempt('setup-fill-1','setup-1',at,{at,spendLamports:'10000000',receiveUnits:retained[1]!.proof.quote.buy.outputBaseUnits,evidence:'FIXTURE setup'},price(),firstContext.marks);
  const warm=await market.context(ledger.state().positions,new AbortController().signal);assert.equal(Object.keys(warm.marks).length,2);
  let actionContext:ExecutionContext|null=null;
  const execution=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context:async signal=>{actionContext=await market.context(ledger!.state().positions,signal);return actionContext;},quote:market.executionQuote});execution.recover();
  const positions=ledger.state().positions,exitPosition=positions[retained[0]!.proof.quote.mint]!,remaining=positions[retained[1]!.proof.quote.mint]!,decisionAt=at;
  execution.reserve({id:'owned-exit',side:'sell',mint:exitPosition.mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'FIXTURE own pending exit'},warm);
  const flow=new ActivePipeline({scope:{mint:exitPosition.mint,pool:retained[0]!.proof.quote.pool,baseUnits:exitPosition.units,minSlot:slot,supportedPoolEvidence:'Fixture only'},now:()=>at,record:recorder.record});flow.open(at);
  at+=1000;const gate=budget.dispatchWindow(),order=ledger.state().pending['owned-exit']!;
  const dispatch=chooseProtectedResearchWork({now:at,readyAt:gate.readyAt,physicalBusy:gate.physicalBusy,nextProtectionAt:decisionAt+2000,lastUsableEvaluationAt:decisionAt,observingSince:decisionAt,otherStartSinceProtection:false,advanceOutstanding:false,candidateWindowActive:true,recoveryActive:false,capacityAvailable:true,startSpacingMs:1000,jobs:[{id:order.id,kind:'pending',enqueuedAt:order.decidedAt,eligibleAt:order.executeAt,deadlineAt:order.expiresAt,operationBoundMs:1200}]});
  assert.equal(dispatch.decision.kind,'job');assert.equal(dispatch.candidateDisposition,'suspend');assert.equal(dispatch.protectionFeasible,true);assert.equal(dispatch.proposed,true);
  if(dispatch.decision.kind!=='job')throw Error('fixture pending dispatch unavailable');latestStartAt=dispatch.decision.latestStartAt;
  const ownerState=structuredClone(ledger.state());flow.gap(dispatch.reason??'owned-action-priority',at);assert.deepEqual(ledger.state(),ownerState);assert.ok(ledger.state().pending['owned-exit']);assert.equal(flow.snapshot(at).historicalWindowInvalidated,true);
  assert.throws(()=>new DisposableLedger(path,'fixture-shared-scheduler-execution'),/financial owner locked/);
  const before=physical.length,result=await execution.runDue();assert.equal(result.results[0]!.status,'filled');assert.equal(physical.length-before,1);const operation=physical.at(-1)!;
  assert.equal(operation.addresses.length,12);assert.ok(operation.addresses.includes(retained[0]!.proof.quote.pool));assert.ok(operation.addresses.includes(retained[1]!.proof.quote.pool));assert.ok(operation.at<=latestStartAt);assert.ok(operation.at>=order.executeAt);
  assert.ok(actionContext);const handed=actionContext as ExecutionContext,remainingMark=handed.marks[remaining.mint]!;assert.ok(remainingMark);assert.equal(remainingMark.pricedBaseUnits,remaining.units);assert.equal(ledger.state().positions[remaining.mint]!.units,remaining.units);assert.equal(ledger.state().positions[exitPosition.mint],undefined);
  const calls=physical.length,q=await market.quote({mint:remaining.mint,side:'sell',inputUnits:remaining.units,minSlot:slot},new AbortController().signal);assert.ok(q);assert.equal(BigInt(remainingMark.netLamports),BigInt(q.outputUnits)-7000n);ledger.reconcile('fixture-action-context-handoff',at,price(),{[remaining.mint]:remainingMark});assert.equal(physical.length,calls);
  assert.equal(await market.quote({mint:remaining.mint,side:'sell',inputUnits:(BigInt(remaining.units)+1n).toString(),minSlot:slot},new AbortController().signal),null);assert.equal(await market.quote({mint:remaining.mint,side:'sell',inputUnits:remaining.units,minSlot:slot+1},new AbortController().signal),null);
  at+=2001;assert.equal(await market.quote({mint:remaining.mint,side:'sell',inputUnits:remaining.units,minSlot:slot},new AbortController().signal),null);assert.equal(physical.length,calls);assert.equal(ledger.state().positions[remaining.mint]!.units,remaining.units);
  const usage=budget.usage();assert.equal(usage.actualInvokedUnits,physical.length);assert.ok(usage.rolling60SecondStarts<=60);assert.ok(usage.rolling10SecondStarts<=30);assert.ok(physical.every(p=>p.inFlight===1));assert.ok(physical.slice(1).every((p,i)=>p.at-physical[i]!.at>=1000));assert.equal(budget.inFlight,0);assert.equal(ledger.state().accountId,'fixture-shared-scheduler-execution');assert.equal(ledger.state().inceptionAt,inception);
  // This proves consumption of the same fresh mark through existing APIs. No
  // periodic-protection handoff hook or changed scheduler baseline is present,
  // so it deliberately claims no new production request saving or gap bound.
});
