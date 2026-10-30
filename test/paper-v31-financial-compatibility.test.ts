/** Disposable reconstruction of an already activated V3 epoch; no live state. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,V3_PAPER_STRATEGY_VERSION,V3_1_PAPER_STRATEGY_VERSION,validateFinancialState,type EntryStrategy,type Mark,type UsdPrice} from '../src/ledger.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION} from '../src/paper-epoch.js';
import {PAPER_V3_EQUITY_RISK_VERSION,PAPER_V3_EQUITY_RISK_POLICY} from '../src/paper-equity-risk.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {planPaperExecution,executionAttempt,paperExecutionPlanSha256} from '../src/execution-realism.js';
const AT=Date.parse('2026-10-30T18:00:00Z'),START=AT+1000;
const price=(at:number):UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE exact contemporaneous SOL/USD fixture'});
function ready(ledger:PaperLedger,at:number,marks:Record<string,Mark>={}){
 ledger.reconcile('reconcile:'+at,at,price(at),marks);const s=ledger.state();
 return ledger.resume('resume:'+at,at,price(at),marks,{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE full inventory/provider readiness',accountId:s.accountId,stateRevision:s.revision,reconciledAt:s.daily.reconciledAt,positionUnits:Object.fromEntries(Object.entries(s.positions).map(([mint,p])=>[mint,p.units])),source:{kind:Object.keys(s.positions).length?'complete-held-liquidation-context':'selected-native-support',bankClockAt:at-1000,receivedAt:at,validUntil:at+29000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true});
}
async function fixture(t:{after:(fn:()=>void)=>void}){
 const root=mkdtempSync(join(tmpdir(),'poe-v31-existing-epoch-')),path=join(root,'ledger.sqlite'),backups=join(root,'backups');mkdirSync(backups,{mode:0o700});
 let ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);ledger.initialize(price(POE_OPERATING_ACCOUNT.inceptionAt),POE_OPERATING_ACCOUNT.inceptionAt);ledger.activateEquityRiskPolicy(AT);ledger.reconcile('prior-current-day',AT+1,price(AT+1),{});ledger.pause('prior-owner-preparation',AT+2,'OFFLINE prior epoch setup');
 await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(AT+100)},()=>AT+100);
 await ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(AT+200)},()=>AT+200);
 assert.equal(ready(ledger,START).enabled,true);
 const db=new Database(path,{readonly:true}),journal=db.prepare('SELECT * FROM journal ORDER BY revision').all(),actions=db.prepare('SELECT * FROM actions ORDER BY id').all() as Array<{id:string}>,epoch=structuredClone(ledger.state().paperEpoch);db.close();
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 return {path,get ledger(){return ledger;},reopen(){ledger.close();ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);return ledger;},verifyHistory(){const read=new Database(path,{readonly:true});try{assert.deepEqual(read.prepare('SELECT * FROM journal ORDER BY revision').all().slice(0,journal.length),journal);const oldIds=new Set(actions.map(a=>a.id));assert.deepEqual((read.prepare('SELECT * FROM actions ORDER BY id').all()as Array<{id:string}>).filter(a=>oldIds.has(a.id)),actions);assert.equal((read.prepare("SELECT count(*) n FROM journal WHERE kind='paper-epoch-transition'").get()as {n:number}).n,2);}finally{read.close();}assert.deepEqual(ledger.state().paperEpoch,epoch);assert.equal(ledger.state().equityRisk!.version,PAPER_V3_EQUITY_RISK_VERSION);}};
}
function entry(mint:string,at:number,consumed='100000000',version:EntryStrategy['version']=V3_1_PAPER_STRATEGY_VERSION){
 const windowEndAt=Math.floor(at/10000)*10000;
 return {id:'entry:'+mint,mint,side:'buy' as const,decidedAt:at,executeAt:at+500,expiresAt:at+5000,gas:'7000',maxSpend:(BigInt(consumed)-7000n).toString(),deposit:'2000000',minReceive:'1',decisionEvidence:'OFFLINE independently audited exact selected size',entryStrategy:{version,cycle:1,windowStartAt:windowEndAt-60000,windowEndAt,assessedAt:at,signalId:'OFFLINE V3.1 exact decision-size signal'}};
}
const mark=(mint:string,at:number,net='100000000'):Record<string,Mark>=>({[mint]:{at,pricedBaseUnits:'100',netLamports:net,evidence:'OFFLINE executable full held inventory'}});
function plan(at:number){return planPaperExecution({plannedAt:at,decisionQuoteAt:at,sourceSlot:10,intentSha256:'b'.repeat(64),temporaryQuoteRentLamports:'2039280',quoteRentProofSha256:'d'.repeat(64),constructionSha256:'a'.repeat(64),constructionMs:1,observedRpcMs:10})!;}
function landing(p:ReturnType<typeof plan>,at:number){return {version:p.version,planSha256:paperExecutionPlanSha256(p),intentSha256:p.intentSha256,temporaryQuoteRentLamports:p.temporaryQuoteRentLamports,quoteRentProofSha256:'e'.repeat(64),constructionSha256:'c'.repeat(64),landingAt:at,preparedAt:at,sourceSlot:11,outcome:'scenario-landed' as const,feeLamports:'7000'};}

test('V3.1 variable decision size uses the existing5% ceiling, exact rent reservations and unchanged epoch across restart',async t=>{
 const f=await fixture(t),p=plan(START),input={...entry('smaller',START),executeAt:p.executeAt,expiresAt:p.expiresAt,executionModel:p,temporaryRentLamports:p.temporaryQuoteRentLamports};
 assert.deepEqual(f.ledger.order(input,price(START),{}),{reserved:'104039280'});assert.equal(f.ledger.state().pending[input.id]!.allocation!.consumedLamports,'100000000');assert.equal(f.ledger.state().pending[input.id]!.allocation!.maximumConsumedLamports,'500000000');
 const pending=structuredClone(f.ledger.state());f.reopen();assert.deepEqual(f.ledger.state(),pending);
 const at=p.executeAt;f.ledger.reconcile('landing-context',at,price(at),{});const before=BigInt(f.ledger.state().lamports);
 assert.equal(f.ledger.attempt('filled-smaller',input.id,at,{at,spendLamports:input.maxSpend,receiveUnits:'100',evidence:'OFFLINE actual selected-size modeled landing',executionModel:landing(p,at)},price(at),{},executionAttempt(p,true)).status,'filled');
 const state=f.ledger.state(),position=state.positions.smaller!;assert.equal(state.lamports,(before-102000000n).toString());assert.equal(state.executionCosts,'7000');assert.equal(state.lockedDeposits.smaller,'2000000');assert.equal(position.allocation!.consumedLamports,'100000000');assert.equal(position.strategy!.version,V3_1_PAPER_STRATEGY_VERSION);assert.equal(f.ledger.projection(at,price(at),mark('smaller',at)).reservedLamports,'0');
 assert.deepEqual(PAPER_V3_EQUITY_RISK_POLICY.dailyDrawdownBps,null);assert.equal(state.daily.lossPaused,false);f.verifyHistory();
});

test('V3.1 rejects above5%, insufficient cash and forged allocation; tiny positive sizes have no artificial floor',async t=>{
 const f=await fixture(t),before=structuredClone(f.ledger.state());
 assert.throws(()=>f.ledger.order(entry('over',START,'500000001'),price(START),{}),/5%/);
 assert.throws(()=>f.ledger.order({...entry('no-cash',START),deposit:'9950000000'},price(START),{}),/insufficient unreserved cash/);
 assert.throws(()=>f.ledger.order({...entry('forged',START),allocation:{}}as any,price(START),{}),/ledger-issued/);
 assert.deepEqual(f.ledger.state(),before);
 const tiny=entry('tiny',START,'7001');assert.deepEqual(f.ledger.order(tiny,price(START),{}),{reserved:'2007001'});assert.equal(f.ledger.state().pending[tiny.id]!.allocation!.consumedLamports,'7001');f.verifyHistory();
});

test('V3.1 unsubmitted/expired decisions release reservations without fees; supported failed landing charges exactly once',async t=>{
 const f=await fixture(t),initial=f.ledger.state().lamports,p=plan(START),input={...entry('unsubmitted',START,'25000000'),executeAt:p.executeAt,expiresAt:p.expiresAt,executionModel:p,temporaryRentLamports:p.temporaryQuoteRentLamports};
 f.ledger.order(input,price(START),{});assert.equal(f.ledger.attempt('unsubmitted',input.id,p.executeAt,null,price(p.executeAt),{},executionAttempt(p,false)).status,'failed');assert.equal(f.ledger.state().lamports,initial);assert.deepEqual(f.ledger.state().lockedDeposits,{});
 const next=p.executeAt+1;ready(f.ledger,next);const expired=entry('expired',next,'30000000');f.ledger.order(expired,price(next),{});assert.equal(f.ledger.attempt('expired',expired.id,expired.expiresAt,null,price(expired.expiresAt)).status,'expired');assert.equal(f.ledger.state().lamports,initial);
 const again=expired.expiresAt+1;ready(f.ledger,again);const p2=plan(again),failed={...entry('failed',again,'25000000'),executeAt:p2.executeAt,expiresAt:p2.expiresAt,executionModel:p2,temporaryRentLamports:p2.temporaryQuoteRentLamports};f.ledger.order(failed,price(again),{});f.ledger.reconcile('failed-context',p2.executeAt,price(p2.executeAt),{});
 const quote={at:p2.executeAt,spendLamports:failed.maxSpend,receiveUnits:'0',evidence:'OFFLINE supported landed slippage failure',executionModel:landing(p2,p2.executeAt)},attempt=executionAttempt(p2,true),result=f.ledger.attempt('failed-once',failed.id,p2.executeAt,quote,price(p2.executeAt),{},attempt);
 assert.equal(result.status,'failed');assert.equal(f.ledger.state().lamports,(BigInt(initial)-7000n).toString());assert.equal(f.ledger.state().realizedLamports,'-7000');assert.equal(f.ledger.state().executionCosts,'7000');assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().lockedDeposits,{});assert.deepEqual(f.ledger.attempt('failed-once',failed.id,p2.executeAt,quote,price(p2.executeAt),{},attempt),result);f.reopen();assert.equal(f.ledger.state().executionCosts,'7000');f.verifyHistory();
});

test('V3 and V3.1 held strategies keep their version and monotonic executable-profit protection after restart',async t=>{
 const f=await fixture(t);let at=START+1;
 for(const [mint,version]of [['old-v3',V3_PAPER_STRATEGY_VERSION],['new-v31',V3_1_PAPER_STRATEGY_VERSION]]as const){
  const held=Object.fromEntries(Object.keys(f.ledger.state().positions).map(m=>[m,{at,pricedBaseUnits:'100',netLamports:'200000000',evidence:'OFFLINE retained actual-size mark'}]));ready(f.ledger,at,held);const input=entry(mint,at,'100000000',version);f.ledger.order(input,price(at),held);f.ledger.attempt('fill:'+mint,input.id,at+500,{at:at+500,spendLamports:input.maxSpend,receiveUnits:'100',evidence:'OFFLINE unchanged inventory supported entry'},price(at+500),Object.fromEntries(Object.entries(held).map(([m,p])=>[m,{...p,at:at+500}])));
  at+=1000;f.ledger.checkpointAdaptiveProtection('peak:'+mint,at,mark(mint,at,'200000000'));assert.equal(f.ledger.checkpointV3ProtectionFloor('floor:'+mint,at,{mint,units:'100',roundTripId:input.id,floorLamports:'150000000',quoteAt:at,evidence:'OFFLINE exact-size executable floor'}).updated,true);assert.equal(f.ledger.checkpointV3ProtectionFloor('lower:'+mint,at,{mint,units:'100',roundTripId:input.id,floorLamports:'140000000',quoteAt:at,evidence:'OFFLINE weaker floor cannot replace protection'}).updated,false);
 }
 const before=structuredClone(f.ledger.state());f.reopen();assert.deepEqual(f.ledger.state(),before);assert.equal(f.ledger.state().positions['old-v3']!.strategy!.version,V3_PAPER_STRATEGY_VERSION);assert.equal(f.ledger.state().positions['new-v31']!.strategy!.version,V3_1_PAPER_STRATEGY_VERSION);validateFinancialState(f.ledger.state(),POE_OPERATING_ACCOUNT.accountId,'PAPER');f.verifyHistory();
});

test('V3.1 reentry requires verified full closure and a strictly later complete audited window',async t=>{
 const f=await fixture(t),at=START+1,input=entry('repeat',at);f.ledger.reconcile('repeat-context',at,price(at),{});f.ledger.order(input,price(at),{});f.ledger.attempt('repeat-fill',input.id,at+500,{at:at+500,spendLamports:input.maxSpend,receiveUnits:'100',evidence:'OFFLINE first V3.1 actual-size entry'},price(at+500));
 const exit={id:'repeat-exit',mint:'repeat',side:'sell' as const,decidedAt:at+501,executeAt:at+1001,expiresAt:at+5000,gas:'7000',maxSpend:'0',deposit:'0',minReceive:'1',decisionEvidence:'OFFLINE executable full-position protective sale'};f.ledger.order(exit,price(at+501),{});assert.equal(f.ledger.attempt('repeat-close',exit.id,at+1001,{at:at+1001,spendLamports:'0',receiveUnits:'120000000',pricedBaseUnits:'100',evidence:'OFFLINE verified complete closure'},price(at+1001)).status,'filled');
 const later=Math.floor((at+1001+60000)/10000)*10000+10000;ready(f.ledger,later);const eligibility=f.ledger.entryEligibility('repeat',V3_1_PAPER_STRATEGY_VERSION,later,later);assert.equal(eligibility.allowed,true);assert.equal(eligibility.cycle,2);assert.equal(f.ledger.entryEligibility('repeat','unknown-future-version',later,later).allowed,false);
 const next=entry('repeat',later,'50000000');next.id='repeat-second';next.deposit='0';next.entryStrategy.cycle=eligibility.cycle;assert.ok('reserved'in f.ledger.order(next,price(later),{}));assert.equal(f.ledger.state().pending[next.id]!.entryStrategy!.version,V3_1_PAPER_STRATEGY_VERSION);f.verifyHistory();
});


test('V3.1 cannot fall back to a V2 financial policy or fixed-dollar entry authorization',t=>{
 const root=mkdtempSync(join(tmpdir(),'poe-v31-no-fallback-')),ledger=new DisposableLedger(join(root,'ledger.sqlite'),'fixture-no-v31-fallback');t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});ledger.initialize(price(START),START);ledger.activateEquityRiskPolicy(START);ledger.reconcile('v2-ready',START,price(START),{});const before=structuredClone(ledger.state());assert.throws(()=>ledger.order(entry('not-v3-epoch',START,'100000000'),price(START),{}),/requires existing V3 financial epoch and policy/);assert.deepEqual(ledger.state(),before);
});
