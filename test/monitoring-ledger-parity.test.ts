/** Disposable financial parity only. No authoritative account, provider or wallet. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,type Mark,type Order,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator,type ExecutionContext} from '../src/execution.js';
import {runMonitoringReplay} from '../src/adaptive-monitoring.js';
import {PublicKey} from '@solana/web3.js';
import {ResearchClockPositionPricer,type ResearchClockQuote} from '../src/research-clock-pricing.js';

const AT=Date.parse('2026-10-27T12:00:00.000Z'),MINT='DISPOSABLE-monitoring-parity-token';
const GAS=7000n,ENTRY=10000000n,UNITS='100',DECISION_NET=8000000n;
const price=(at:number):UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE fixed $100/SOL parity fixture'});

async function parity(t:TestContext,status:'filled'|'failed'|'expired',responseDelay=200){
  const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-monitoring-parity-'));
  const ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-monitoring-parity-'+status);
  t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
  let at=AT-2000,quoteCalls=0;
  ledger.initialize(price(at),at);
  const initial=ledger.state();assert.equal(initial.mode,'DISPOSABLE_PAPER');assert.equal(initial.initialMicroUsd,'1000000000');
  const decisionGross=DECISION_NET+GAS,minGross=decisionGross*9500n/10000n;
  const attemptGross=minGross-(status==='failed'?1n:0n),attemptNet=attemptGross-GAS;
  const context=():ExecutionContext=>({price:price(at),marks:ledger.state().positions[MINT]?{[MINT]:{netLamports:DECISION_NET.toString(),pricedBaseUnits:UNITS,at,evidence:'DISPOSABLE full-size initial liquidation'} satisfies Mark}:{}});
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:100,context:async()=>context(),quote:async request=>{
    quoteCalls++;
    if(request.order.side==='buy')return {at,spendLamports:ENTRY.toString(),receiveUnits:UNITS,evidence:'DISPOSABLE first delayed entry quote'};
    assert.equal(request.fullPositionBaseUnits,UNITS);
    const sourceAt=at;at+=responseDelay; // Same explicitly modeled response delay as replay.
    return {at:sourceAt,spendLamports:'0',receiveUnits:attemptGross.toString(),pricedBaseUnits:UNITS,evidence:'DISPOSABLE first delayed full-size gross exit quote'};
  }});
  coordinator.recover();at=AT-1500;
  ledger.reconcile('fixture-ready-reconcile',at,price(at),{});
  assert.equal(ledger.resume('fixture-ready',at,price(at),{},{version:'DISPOSABLE-monitoring-parity',evidence:'OFFLINE fixture only; no live readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);
  const buy:Omit<Order,'reserved'>={id:'fixture-entry',side:'buy',mint:MINT,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:GAS.toString(),deposit:'0',maxSpend:ENTRY.toString(),minReceive:UNITS,decisionEvidence:'DISPOSABLE exact-size entry'};
  coordinator.reserve(buy,context());at=buy.executeAt;
  assert.equal((await coordinator.runDue()).results[0]!.status,'filled');
  const position=ledger.state().positions[MINT]!;
  assert.equal(position.units,UNITS);assert.equal(BigInt(position.entryLamports)+BigInt(position.entryGas),ENTRY+GAS);
  // $1.0007 initial cost is within the unchanged $50 position/$150 aggregate
  // experimental limits. This account is disposable and never reports to Render.
  assert.ok(BigInt(position.costMicroUsd)<=50000000n);
  const replay=runMonitoringReplay({policy:'fixed-2s',startAt:AT,endAt:AT+(status==='expired'?8000:4000),sourceMode:'dense-synthetic',latencyMs:200,requestLatency:(_at,kind)=>kind==='exit'?responseDelay:200,exitSlippageBps:500,exitGasLamportsIncluded:GAS.toString(),failedAttemptCostLamports:GAS.toString(),positions:[{id:MINT,enteredAt:position.enteredAt,entryCostLamports:(ENTRY+GAS).toString(),units:UNITS,observations:[{at:AT,netLamports:DECISION_NET.toString()},{at:AT+1000,netLamports:attemptNet.toString()}]}]});
  const simulated=replay.positions[0]!,decision=simulated.firstActionableExit!;
  assert.equal(decision.grossLamports,decisionGross.toString());assert.equal(simulated.exit!.minimumGrossReceiveLamports,minGross.toString());
  at=decision.at;
  const sell:Omit<Order,'reserved'>={id:'fixture-exit',side:'sell',mint:MINT,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:GAS.toString(),deposit:'0',maxSpend:'0',minReceive:minGross.toString(),decisionEvidence:'DISPOSABLE Trader.reserveExit gross-slip equivalent'};
  coordinator.reserve(sell,context());
  at=replay.requests.find(r=>r.kind==='exit')!.at;
  const outcome=(await coordinator.runDue()).results[0]!;
  assert.equal(outcome.status,status);assert.equal(simulated.exit!.status,status);assert.equal(outcome.at,simulated.exit!.at);
  const state=ledger.state();assert.equal(state.executionCosts,((status==='expired'?1n:2n)*GAS).toString());
  assert.equal(state.inceptionAt,initial.inceptionAt);assert.deepEqual(state.pending,{});assert.equal(quoteCalls,2);
  assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(quoteCalls,2);
  if(status==='filled'){
    assert.deepEqual(state.positions,{});
    const netProfit=attemptNet-ENTRY-GAS;
    assert.equal(state.realizedLamports,netProfit.toString());assert.equal(BigInt(state.lamports)-BigInt(initial.lamports),netProfit);
    assert.equal(simulated.modeledPnlLamports,netProfit.toString());assert.equal(simulated.failedExecutionCostLamports,'0');
  }else{
    assert.equal(state.positions[MINT]!.units,UNITS);assert.equal(state.realizedLamports,(status==='expired'?0n:-GAS).toString());
    assert.equal(state.lamports,(BigInt(initial.lamports)-ENTRY-(status==='expired'?1n:2n)*GAS).toString());
    assert.equal(simulated.failedExecutionCostLamports,(status==='expired'?0n:GAS).toString());assert.equal(simulated.unresolvedPosition,true);assert.equal(simulated.modeledPnlLamports,null);
    // Compare native asset-equity at an equally fresh net mark. Failed gas is a
    // cash debit once; a failed sell does not silently dispose of the holding.
    const markedEquityChange=BigInt(state.lamports)+attemptNet-BigInt(initial.lamports);
    assert.equal(simulated.markedPnlAtEndLamports,markedEquityChange.toString());
  }
}

test('monitoring replay filled gross-slip boundary agrees with existing disposable writer/coordinator',async t=>parity(t,'filled'));
test('monitoring replay failed gross-slip boundary preserves exposure and charges exactly existing failed gas',async t=>parity(t,'failed'));


test('exact-expiry replay matches existing writer: no fill, no exit gas and retained exposure',async t=>parity(t,'expired',4000));
test('after-expiry replay matches existing writer: no late favorable fill or exit gas',async t=>parity(t,'expired',4001));

test('one post-delay coherent Clock batch can serve coordinator context and exit quote; invalid reuse fails closed',async()=>{
  // Test-only closures demonstrate a bounded integration option. RpcMarket and
  // the installed observer are not changed or claimed to use this option.
  for(const mode of ['fresh','stale','wrong-size','pre-delay'] as const){
    const run='2026-10-26T19-42-16.130Z';
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
    const retained=structuredClone(rows.find(x=>x.kind==='pool-state').data),mint=proof.quote.mint,units=proof.quote.buy.outputBaseUnits;
    const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-clock-coordinator-'));
    let at=Date.parse(proof.quote.validatedAt)-2000,reads=0,phase:'entry'|'exit'='entry',shared:ResearchClockQuote|null=null;
    const originalNow=Date.now;Date.now=()=>at;
    const ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-clock-coordinator-'+mode);
    try{
      const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
        reads++;assert.equal(method,'getMultipleAccounts');
        const addresses=params[0] as string[];
        if(addresses.length===1)return structuredClone({context:retained.context,value:[retained.value[0]]}) as T;
        assert.equal(addresses.length,8);
        const clock=Buffer.alloc(40);clock.writeBigUInt64LE(BigInt(retained.context.slot),0);clock.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
        // Synthetic same-bank Clock only; all seven pool dependencies are the
        // retained actual account bytes passed to the established decoder.
        const value=[...retained.value,{owner:'Sysvar1111111111111111111111111111111111111',data:[clock.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0}];
        return structuredClone({context:retained.context,value}) as T;
      }};
      const pricer=new ResearchClockPositionPricer(rpc,{record(){}});
      const read=async(wrongSize=false)=>{
        const batch=await pricer.quoteMany([{mint:new PublicKey(mint),fullBaseUnits:BigInt(units)+(wrongSize?1n:0n),minSlot:proof.origin.slot}]);
        assert.ok(batch.quotes[mint]);return batch.quotes[mint]!;
      };
      const context=async():Promise<ExecutionContext>=>{
        if(phase==='entry')return {price:price(at),marks:{}};
        if(mode!=='pre-delay')shared=await read(mode==='wrong-size');
        assert.ok(shared);
        if(mode==='stale')at+=2001;
        return {price:price(at),marks:{[mint]:{netLamports:(BigInt(shared.sell.outputLamports)-GAS).toString(),pricedBaseUnits:shared.sell.inputBaseUnits,at:Date.parse(shared.receivedAt),evidence:'DISPOSABLE shared coherent Clock snapshot'}}};
      };
      ledger.initialize(price(at),at);
      const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:100,context,quote:async request=>{
        if(request.order.side==='buy')return {at,spendLamports:ENTRY.toString(),receiveUnits:units,evidence:'DISPOSABLE initial entry'};
        const q=shared,sourceAt=q?Date.parse(q.receivedAt):NaN;
        if(!q||q.mint!==request.order.mint||q.sell.inputBaseUnits!==request.fullPositionBaseUnits||sourceAt<request.order.executeAt||sourceAt>at||at-sourceAt>2000)return null;
        return {at:sourceAt,spendLamports:'0',receiveUnits:q.sell.outputLamports,pricedBaseUnits:q.sell.inputBaseUnits,evidence:'DISPOSABLE reuse of post-delay actual-size context snapshot'};
      }});
      coordinator.recover();at+=500;
      ledger.reconcile('ready-reconcile',at,price(at),{});ledger.resume('ready',at,price(at),{},{version:'DISPOSABLE-Clock-parity',evidence:'test-only closures',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
      coordinator.reserve({id:'entry',side:'buy',mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:GAS.toString(),deposit:'0',maxSpend:ENTRY.toString(),minReceive:units,decisionEvidence:'DISPOSABLE entry'},await context());
      at+=1000;assert.equal((await coordinator.runDue()).results[0]!.status,'filled');phase='exit';at+=500;
      shared=await read();assert.equal(reads,2); // Cold link discovery + coherent batch.
      const min=(BigInt(shared.sell.outputLamports)*9500n/10000n).toString(),decisionAt=at;
      coordinator.reserve({id:'exit',side:'sell',mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:GAS.toString(),deposit:'0',maxSpend:'0',minReceive:min,decisionEvidence:'DISPOSABLE gross SDK decision'}, {price:price(at),marks:{[mint]:{netLamports:(BigInt(shared.sell.outputLamports)-GAS).toString(),pricedBaseUnits:units,at,evidence:'DISPOSABLE decision mark'}}});
      at=decisionAt+1000;const before=reads,result=(await coordinator.runDue()).results[0]!;
      assert.equal(reads-before,mode==='pre-delay'?0:1);
      assert.equal(result.status,mode==='fresh'?'filled':'failed');
      assert.equal(ledger.state().executionCosts,(2n*GAS).toString());
      assert.equal(!!ledger.state().positions[mint],mode!=='fresh');
      assert.deepEqual((await coordinator.runDue()).results,[]);assert.equal(reads-before,mode==='pre-delay'?0:1);
    }finally{ledger.close();Date.now=originalNow;rmSync(directory,{recursive:true,force:true});}
  }
});
