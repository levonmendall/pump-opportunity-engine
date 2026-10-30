/** Real SDK/account bytes; synthetic timing and disposable ledger only. No
 * provider, funded account, actual transaction landing or profitability claim. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type Order,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {PilotMarket} from '../src/pilot-market.js';
import {paperExecutionPlanSha256,type PaperExecutionPlan} from '../src/execution-realism.js';
import type {PoolWireAccount} from '../src/pool.js';
function fixture(t:TestContext){
 const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8')),rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(l=>JSON.parse(l)),capture=rows.find(r=>r.kind==='pool-state').data;
 let at=Date.parse(proof.quote.validatedAt),slot=capture.context.slot,unavailable=false;const previous=Date.now;Date.now=()=>at;
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-realistic-execution-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-realistic-execution'),accounts=new Map<string,PoolWireAccount>(capture.addresses.map((a:string,i:number)=>[a,structuredClone(capture.value[i])])),records:Array<{kind:string;data:any}>=[],calls:string[]=[];
 const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE measured-time USD fixture'});ledger.initialize(price(),at);
 t.after(()=>{ledger.close();Date.now=previous;rmSync(directory,{recursive:true,force:true});});
 const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push(method);if(unavailable)throw Error('OFFLINE_PROVIDER_UNAVAILABLE');if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0]))as T;assert.equal(method,'getMultipleAccounts');const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);const clock={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};return {context:{slot},value:(params[0]as string[]).map(a=>a===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(a)??null))}as T;}};
 const market=new PilotMarket({executionRealism:true,rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder:{record(kind,data){records.push({kind,data:structuredClone(data)});}},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'Declared PAPER fee scenario'}});const mint=proof.quote.mint;
 market.registerPool({mint,migrationVerified:true,migrationSlot:proof.origin.slot,evidence:'Retained actual migration; synthetic timing'});
 const context=async(signal:AbortSignal)=>{const q=await market.context(ledger.state().positions,signal);if(q.price)ledger.reconcile('context:'+ledger.state().revision,at,q.price,q.marks);return q;};
 const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context,quote:market.executionQuote,executionPlan:o=>market.executionPlan(o)});coordinator.recover();
 const ready=()=>{ledger.reconcile('reconcile:'+ledger.state().revision,at,price(),{});ledger.resume('ready:'+ledger.state().revision,at,price(),{},{version:'DISPOSABLE-readiness',evidence:'No market qualification claim',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});};ready();
 const prepare=async()=>{const deposit=await market.prepareEntryCosts(mint,new AbortController().signal),q=await market.quote({mint,side:'buy',inputUnits:'10000000'},new AbortController().signal);assert.ok(q);return {q,deposit};};
 const reserve=async(id='modeled-buy')=>{const {q,deposit}=await prepare(),decisionAt=at;const result=coordinator.reserve({id,side:'buy',mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:deposit.depositLamports,maxSpend:q.inputUnits,minReceive:(BigInt(q.outputUnits)*9900n/10000n).toString(),decisionEvidence:q.evidence},{price:price(),marks:{}});assert.ok('reserved'in result);const order=ledger.state().pending[id]! as Order&{executionModel:PaperExecutionPlan};assert.ok(order.executionModel);assert.equal(order.decidedAt,decisionAt);return order;};
 return {ledger,market,coordinator,records,calls,mint,accounts,capture,price,prepare,reserve,now:()=>at,advance:(ms:number)=>{at+=ms;slot+=Math.max(1,Math.floor(ms/400));},setUnavailable:()=>{unavailable=true;}};
}
test('new actual-SDK PAPER reservation binds unsigned intent, adapts landing time and fills once using post-delay state',async t=>{
 const f=fixture(t),order=await f.reserve();assert.ok(order.executeAt>order.decidedAt+1000);assert.equal(order.executionModel.expiresAt,order.expiresAt);assert.equal(order.executionModel.slotDurationBasis,'scenario');
 const beforeCalls=f.calls.length;assert.deepEqual((await f.coordinator.runDue()).results,[]);assert.equal(f.calls.length,beforeCalls);
 f.advance(order.executeAt-f.now());const result=await f.coordinator.runDue();assert.equal(result.results[0]?.status,'filled',JSON.stringify(result));assert.equal(f.ledger.state().executionCosts,'7000');assert.ok(f.ledger.state().positions[f.mint]);
 const attempted=f.ledger.actionResult('execution-attempt:'+order.id);assert.ok(attempted);assert.deepEqual((await f.coordinator.runDue()).results,[]);assert.equal(f.ledger.state().executionCosts,'7000');
 const plan=f.records.find(r=>r.kind==='paper-execution-plan')!.data,landing=f.records.find(r=>r.kind==='paper-execution-landing-state')!.data.executionModel;assert.equal(plan.planSha256,paperExecutionPlanSha256(order.executionModel));assert.equal(landing.intentSha256,order.executionModel.intentSha256);assert.ok(landing.landingAt>=order.executeAt);assert.equal(f.market.usage().executionModel.supportedLandingStates,1);assert.equal(f.records.filter(r=>r.kind==='paper-unsigned-pumpswap').every(r=>r.data.construction.networkRequests===0),true);
});
test('missing actual landing preparation is an unsubmitted zero-fee failure and cannot fabricate a position',async t=>{
 const f=fixture(t),order=await f.reserve();f.advance(order.executeAt-f.now());f.setUnavailable();const result=await f.coordinator.runDue();assert.equal(result.results[0]?.status,'failed');assert.equal(f.ledger.state().executionCosts,'0');assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.market.usage().executionModel.unknownLanding,1);assert.deepEqual((await f.coordinator.runDue()).results,[]);
});
test('post-delay pool deterioration preserves original minimum output; a plausible landed slippage failure charges once',async t=>{
 const f=fixture(t),order=await f.reserve(),vault=f.capture.addresses[6] as string,account=f.accounts.get(vault)!;const raw=Buffer.from(account.data[0],'base64');raw.writeBigUInt64LE(raw.readBigUInt64LE(64)*2n,64);account.data=[raw.toString('base64'),'base64'];f.advance(order.executeAt-f.now());
 const result=await f.coordinator.runDue();assert.equal(result.results[0]?.status,'failed',JSON.stringify(result));assert.match(result.results[0]!.reason,/price constraint/);assert.equal(f.ledger.state().executionCosts,'7000');assert.deepEqual(f.ledger.state().positions,{});
 const landing=f.records.find(r=>r.kind==='paper-execution-landing-state')!.data.executionModel;assert.equal(landing.intentSha256,order.executionModel.intentSha256);assert.equal(f.records.filter(r=>r.kind==='paper-unsigned-pumpswap').at(-1)!.data.construction.minimumOutputUnits,order.minReceive);assert.deepEqual((await f.coordinator.runDue()).results,[]);assert.equal(f.ledger.state().executionCosts,'7000');
});
test('fresh held protection does not construct discretionary transactions or add RPC work',async t=>{
 const f=fixture(t),order=await f.reserve();f.advance(order.executeAt-f.now());assert.equal((await f.coordinator.runDue()).results[0]?.status,'filled');await f.market.context(f.ledger.state().positions,new AbortController().signal);const constructions=f.records.filter(r=>r.kind==='paper-unsigned-pumpswap').length,calls=f.calls.length;f.advance(1000);const context=await f.market.context(f.ledger.state().positions,new AbortController().signal);assert.ok(context.marks[f.mint]);assert.equal(f.records.filter(r=>r.kind==='paper-unsigned-pumpswap').length,constructions);assert.equal(f.calls.length-calls,1,'existing hot batched holding read only');
});

test('a modeled full-size exit preserves its own intent and leaves no duplicate pending obligation',async t=>{
 const f=fixture(t),buy=await f.reserve();f.advance(buy.executeAt-f.now());assert.equal((await f.coordinator.runDue()).results[0]?.status,'filled');f.advance(1000);const context=await f.market.context(f.ledger.state().positions,new AbortController().signal),position=f.ledger.state().positions[f.mint]!;const q=await f.market.quote({mint:f.mint,side:'sell',inputUnits:position.units},new AbortController().signal);assert.ok(q);f.ledger.reconcile('pre-exit',f.now(),f.price(),context.marks);
 const reserved=f.coordinator.reserve({id:'modeled-sell',side:'sell',mint:f.mint,decidedAt:f.now(),executeAt:f.now()+1000,expiresAt:f.now()+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:(BigInt(q.outputUnits)*9900n/10000n).toString(),decisionEvidence:q.evidence},context);assert.ok('reserved'in reserved);const order=f.ledger.state().pending['modeled-sell']! as Order&{executionModel:PaperExecutionPlan};f.advance(order.executeAt-f.now());const result=await f.coordinator.runDue();assert.equal(result.results[0]?.status,'filled',JSON.stringify(result));assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'14000');assert.ok(f.ledger.state().lockedDeposits[f.mint],'retained dedicated accounts are assets; no invented rent refund');assert.deepEqual((await f.coordinator.runDue()).results,[]);
});
