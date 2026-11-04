/** OFFLINE original-account reconstruction in a temporary directory only.
 * These are accounting/control tests, not market evidence or live fills. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,V3_1_PAPER_STRATEGY_VERSION,validateFinancialState,type Mark,type UsdPrice} from '../src/ledger.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION} from '../src/paper-epoch.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {PAPER_V3_EQUITY_RISK_POLICY} from '../src/paper-equity-risk.js';
import {LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING} from '../src/pilot-contract.js';
import {PAPER_TWO_HOLDING_OPERATING_POLICY as POLICY,paperEntryCapacity,paperOperatingCapacityPolicy} from '../src/paper-operating-capacity.js';
import {NativePaper} from '../src/native-paper.js';
import {nativePaperConfigurationSha256,resolveNativePaperStrategy} from '../src/run-native-paper.js';
const AT=Date.parse('2026-10-30T18:00:00Z'),START=AT+1000;
const price=(at:number):UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE actual-size accounting fixture'});
const entry=(mint:string,at:number)=>({id:'entry:'+mint,mint,side:'buy' as const,decidedAt:at,executeAt:at+500,expiresAt:at+5000,gas:'7000',maxSpend:'99993000',deposit:'2000000',minReceive:'1',decisionEvidence:'OFFLINE complete selected-size decision',entryStrategy:{version:V3_1_PAPER_STRATEGY_VERSION,cycle:1,windowStartAt:Math.floor(at/10000)*10000-60000,windowEndAt:Math.floor(at/10000)*10000,assessedAt:at,signalId:'OFFLINE independently audited signal'}});
async function fixture(t:TestContext,overlay=true){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-two-holdings-')),path=join(root,'ledger.sqlite'),backups=join(root,'backups');mkdirSync(backups,{mode:0o700});
 let ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId,'PAPER',overlay?{operatingCapacityPolicy:POLICY}:{});
 ledger.initialize(price(POE_OPERATING_ACCOUNT.inceptionAt),POE_OPERATING_ACCOUNT.inceptionAt);ledger.activateEquityRiskPolicy(AT);ledger.reconcile('prior-day',AT+1,price(AT+1),{});ledger.pause('prior-owner',AT+2,'OFFLINE explicit epoch preparation');
 await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(AT+100)},()=>AT+100);
 await ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(AT+200)},()=>AT+200);
 const marks=(at:number):Record<string,Mark>=>Object.fromEntries(Object.entries(ledger.state().positions).map(([mint,p])=>[mint,{at,pricedBaseUnits:p.units,netLamports:'100000000',evidence:'OFFLINE full held liquidation'}]));
 const ready=(at:number)=>{ledger.reconcile('reconcile:'+at,at,price(at),marks(at));const s=ledger.state();return ledger.resume('resume:'+at,at,price(at),marks(at),{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE full inventory and provider readiness',accountId:s.accountId,stateRevision:s.revision,reconciledAt:s.daily.reconciledAt,positionUnits:Object.fromEntries(Object.entries(s.positions).map(([mint,p])=>[mint,p.units])),source:{kind:Object.keys(s.positions).length?'complete-held-liquidation-context':'selected-native-support',bankClockAt:at-1000,receivedAt:at,validUntil:at+29000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true});};
 ready(START);
 const rows=()=>{const db=new Database(path,{readonly:true});try{return {actions:db.prepare('SELECT * FROM actions ORDER BY id').all() as {id:string}[],journal:db.prepare('SELECT * FROM journal ORDER BY revision').all()};}finally{db.close();}};
 const prefix=rows(),epoch=structuredClone(ledger.state().paperEpoch);
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 return {path,get ledger(){return ledger;},marks,ready,rows,reopen(useOverlay=true){ledger.close();ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId,'PAPER',useOverlay?{operatingCapacityPolicy:POLICY}:{});return ledger;},verifyHistory(){const current=rows(),ids=new Set(prefix.actions.map(r=>r.id));assert.deepEqual(current.actions.filter(r=>ids.has(r.id)),prefix.actions);assert.deepEqual(current.journal.slice(0,prefix.journal.length),prefix.journal);assert.deepEqual(ledger.state().paperEpoch,epoch);assert.equal(ledger.state().equityRisk!.version,PAPER_V3_EQUITY_RISK_POLICY.version);}};
}
test('capacity counts held positions and every unresolved BUY, retains pending SELL ownership and requires policy readiness',()=>{
 const state={positions:{a:{}},pending:{b:{side:'buy'},exit:{side:'sell'}}};
 assert.deepEqual(paperEntryCapacity(state,null,POLICY),{heldPositions:1,pendingBuyOrders:1,occupiedPositions:2,historicalMaximumPositions:null,maximumPositions:2,operatingPolicyVersion:POLICY.version,available:false});
 assert.equal(paperEntryCapacity({positions:{a:{}},pending:{exit:{side:'sell'}}},null,POLICY).available,true);
 assert.equal(paperEntryCapacity({positions:{},pending:{}},null,POLICY,false).available,false);
 assert.equal(paperEntryCapacity({positions:{},pending:{}},1,POLICY).maximumPositions,1);
 assert.equal(paperEntryCapacity({positions:{a:{},b:{},c:{}},pending:{}},null,null).available,true);
});
test('runtime policy is exact and immutable; an invalid limit is rejected before opening a writer',t=>{
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-capacity-invalid-')),path=join(root,'ledger.sqlite');t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const bad of [{...POLICY,maximumPositions:3},{...POLICY,extra:true},null])assert.throws(()=>new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId,'PAPER',{operatingCapacityPolicy:bad as any}),/invalid PAPER operating capacity/);
 assert.equal(existsSync(path),false);const copy={...POLICY};const frozen=paperOperatingCapacityPolicy(copy)!;assert.equal(Object.isFrozen(frozen),true);(copy as any).maximumPositions=9;assert.equal(frozen.maximumPositions,2);
});
test('sole ledger reserves only two BUY slots atomically, preserves duplicate receipts, and releases capacity only on actual cancellation',async t=>{
 const f=await fixture(t),a=entry('a',START),b=entry('b',START),third=entry('third',START);
 const first=f.ledger.order(a,price(START),{});assert.ok('reserved'in first);const {entryStrategy:unusedB,...genericB}=b,{entryStrategy:unusedThird,...genericThird}=third;assert.ok('reserved'in f.ledger.order(genericB,price(START),{}));
 const full=structuredClone(f.ledger.state()),rows=f.rows();assert.throws(()=>f.ledger.order(genericThird,price(START),{}),/position capacity/);assert.deepEqual(f.ledger.state(),full);assert.deepEqual(f.rows(),rows);
 assert.deepEqual(f.ledger.order(a,price(START),{}),first);assert.deepEqual(f.ledger.state(),full);
 f.ledger.cancelEntryOrders('cancel-b',START+1,'OFFLINE actual unsubmitted cancellation','b');assert.equal(f.ledger.entryCapacity(null).available,true);
 assert.ok('reserved'in f.ledger.order({...genericThird,decidedAt:START+1,executeAt:START+501,expiresAt:START+5001},price(START+1),{}));assert.equal(f.ledger.entryCapacity(null).pendingBuyOrders,2);f.verifyHistory();
});
test('held plus pending BUY blocks a third candidate before proof, quote, rent or order preparation, across later candidate windows',async t=>{
 const f=await fixture(t),a=entry('a',START);f.ledger.order(a,price(START),{});assert.equal(f.ledger.attempt('fill-a',a.id,START+500,{at:START+500,spendLamports:a.maxSpend,receiveUnits:'100',evidence:'OFFLINE selected-size fill'},price(START+500)).status,'filled');
 const at=START+600;f.ready(at);f.ledger.order(entry('b',at),price(at),f.marks(at));const before=structuredClone(f.ledger.state()),records:any[]=[];let clock=at,preparations=0;
 const bridge=Object.create(NativePaper.prototype) as any;
 Object.assign(bridge,{options:{ledger:f.ledger,certificate:()=>({}),record:(kind:string,data:any)=>records.push({kind,data}),market:{prepareEntryCosts:()=>{preparations++;throw Error('must not prepare');}}},maximumPositions:null,now:()=>clock,registryFollowups:{pending:()=>false},pools:new Map([['third',{}]]),trader:{candidateFeatures:()=>({windowEndAt:clock})},lastCandidateBucket:new Map(),ready:()=>true});
 for(const generationAt of [at,at+10000]){clock=generationAt;assert.equal(bridge.qualificationProof('third',clock),null);assert.deepEqual(await bridge.candidate('third',true),{kind:'capacity-refused'});}
 assert.equal(preparations,0);assert.equal(records.length,2);assert.ok(records.every(row=>row.data.heldPositions===1&&row.data.pendingBuyOrders===1&&row.data.maximumPositions===2&&row.data.orderCreated===false));assert.deepEqual(f.ledger.state(),before);f.verifyHistory();
});
test('reopening existing V3 history with more than two holdings preserves every obligation and allows protective SELL settlement',async t=>{
 const f=await fixture(t,false);let at=START+1;
 for(const mint of ['a','b','c']){f.ready(at);const input=entry(mint,at);f.ledger.order(input,price(at),f.marks(at));assert.equal(f.ledger.attempt('fill:'+mint,input.id,at+500,{at:at+500,spendLamports:input.maxSpend,receiveUnits:'100',evidence:'OFFLINE predecessor held inventory'},price(at+500),f.marks(at+500)).status,'filled');at+=1000;}
 const before=structuredClone(f.ledger.state()),rows=f.rows();f.reopen();assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.rows(),rows);validateFinancialState(f.ledger.state(),POE_OPERATING_ACCOUNT.accountId,'PAPER');assert.equal(f.ledger.entryCapacity(null).available,false);
 f.ready(at);assert.throws(()=>f.ledger.order(entry('d',at),price(at),f.marks(at)),/position capacity/);
 const exit={id:'protective-exit',mint:'a',side:'sell' as const,decidedAt:at,executeAt:at+500,expiresAt:at+5000,gas:'7000',maxSpend:'0',deposit:'0',minReceive:'1',decisionEvidence:'OFFLINE existing exit rule full inventory'};
 assert.ok('reserved'in f.ledger.order(exit,price(at),f.marks(at)));assert.equal(f.ledger.entryCapacity(null).occupiedPositions,3,'pending SELL does not free its holding');
 assert.equal(f.ledger.attempt('protective-filled',exit.id,at+500,{at:at+500,spendLamports:'0',receiveUnits:'100000000',pricedBaseUnits:'100',evidence:'OFFLINE full protective liquidation'},price(at+500),f.marks(at+500)).status,'filled');
 assert.equal(Object.keys(f.ledger.state().positions).length,2);assert.equal(f.ledger.entryCapacity(null).available,false);assert.equal(f.ledger.state().positions.b!.strategy!.version,V3_1_PAPER_STRATEGY_VERSION);f.verifyHistory();
});
test('runtime overlay survives restart without modifying immutable policy, sizing, epoch or historical financial actions',async t=>{
 const f=await fixture(t),before=structuredClone(f.ledger.state()),rows=f.rows();f.reopen();assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.rows(),rows);
 assert.equal(PAPER_V3_EQUITY_RISK_POLICY.maximumPositions,null);assert.equal(PAPER_V3_EQUITY_RISK_POLICY.dailyLossEntryHalt,false);assert.equal(PAPER_V3_EQUITY_RISK_POLICY.dailyDrawdownBps,null);assert.equal(PAPER_V3_EQUITY_RISK_POLICY.entryConsumedCostBps,500);assert.equal(LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING.maxPositions,null);
 assert.throws(()=>f.ledger.order({...entry('too-large',START),maxSpend:'500000001'},price(START),{}),/5%/);assert.deepEqual(f.ledger.state(),before);
 assert.equal(f.ledger.entryCapacity(null).maximumPositions,2);assert.equal(f.ledger.entryCapacity(null).historicalMaximumPositions,null);f.verifyHistory();
});
test('already accepted pending BUY obligations remain settleable after adopting the runtime ceiling',async t=>{
 const f=await fixture(t,false),orders=['a','b','c'].map(mint=>{const {entryStrategy:unused,...order}=entry(mint,START);return order;});
 // Existing generic ledger reservations are legitimate financial obligations;
 // no claim is made that these synthetic orders passed V3.1 market economics.
 for(const order of orders)assert.ok('reserved'in f.ledger.order(order,price(START),{}));
 const before=structuredClone(f.ledger.state()),rows=f.rows();f.reopen();assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.rows(),rows);assert.equal(f.ledger.entryCapacity(null).pendingBuyOrders,3);
 for(const order of orders)assert.equal(f.ledger.attempt('settle:'+order.id,order.id,START+500,{at:START+500,spendLamports:order.maxSpend,receiveUnits:'100',evidence:'OFFLINE accepted obligation genuine settlement'},price(START+500),f.marks(START+500)).status,'filled');
 assert.equal(Object.keys(f.ledger.state().positions).length,3);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.entryCapacity(null).available,false);f.verifyHistory();
});
test('new V3.1 configuration digest honestly includes the owner operating policy without retagging the historical binding',()=>{
 const args={strategy:V3_1_PAPER_STRATEGY_VERSION,stage:'two',deepSlots:4,service:true} as const;
 assert.equal(resolveNativePaperStrategy('two',args.strategy).binding,LIQUIDITY_RESILIENT_V3_1_PILOT_BINDING);
 assert.notEqual(nativePaperConfigurationSha256(args),'f030f068a845d28f0717bf3edabe8bba0483f55cc3cc2f95a6feedb634c10d28');
});
