import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,dailyLossEntryBlocked,type Mark,type UsdPrice} from '../src/ledger.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_TEN_SOL_EPOCH_ID,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_ID,PAPER_EPOCH_ASSET_SEGREGATION,paperEpochLogicalSeal} from '../src/paper-epoch.js';
import {PAPER_EQUITY_RISK_VERSION,PAPER_V3_EQUITY_RISK_VERSION,PAPER_V3_EQUITY_RISK_POLICY} from '../src/paper-equity-risk.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {parseAuthorizedEpochArguments} from '../src/paper-epoch-cli.js';
import {buildPilotPortfolio} from '../src/pilot-reporting.js';
import {projectFinancialPolicyReporting,validateFinancialPolicyReporting} from '../src/financial-policy-reporting.js';

const AT=Date.parse('2026-10-30T18:00:00.000Z'),OLD_AT=AT+100,V3_AT=AT+200;
const price=(at:number,value='100000000'):UsdPrice=>({at,microUsdPerSol:value,source:'OFFLINE contemporaneous V3 fixture conversion'});
const db=(path:string,readonly=true)=>new Database(path,{readonly,fileMustExist:true});
function setup(t:{after:(fn:()=>void)=>void}){
 const root=mkdtempSync(join(tmpdir(),'poe-v3-epoch-')),path=join(root,'ledger.sqlite'),backups=join(root,'backups');mkdirSync(backups,{mode:0o700});
 let ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);ledger.initialize(price(POE_OPERATING_ACCOUNT.inceptionAt),POE_OPERATING_ACCOUNT.inceptionAt);ledger.activateEquityRiskPolicy(AT);ledger.reconcile('initial-current-day',AT+1,price(AT+1),{});ledger.pause('offline-owner-preparation',AT+2,'OFFLINE epoch preparation');
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 return {root,path,backups,get ledger(){return ledger;},reopen(){ledger.close();ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);return ledger;},old(){return ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(OLD_AT)},()=>OLD_AT);},v3(at=V3_AT,value='100000000'){return ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(at,value)},()=>at);}};
}
function resume(ledger:PaperLedger,at:number,p=price(at),marks:Record<string,Mark>={}){
 ledger.reconcile('fresh:'+at,at,p,marks);const s=ledger.state();
 return ledger.resume('resume:'+at,at,p,marks,!s.paperEpoch?{version:'OFFLINE explicit legacy readiness',evidence:'OFFLINE owner-authorized original fixture readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}:{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE fresh complete inventory and native Clock',accountId:s.accountId,stateRevision:s.revision,reconciledAt:s.daily.reconciledAt,positionUnits:Object.fromEntries(Object.entries(s.positions).map(([mint,x])=>[mint,x.units])),source:{kind:Object.keys(s.positions).length?'complete-held-liquidation-context':'selected-native-support',bankClockAt:at-1000,receivedAt:at,validUntil:at+29000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true});
}
function marks(ledger:PaperLedger,at:number,value?:string):Record<string,Mark>{return Object.fromEntries(Object.entries(ledger.state().positions).map(([mint,p])=>[mint,{at,pricedBaseUnits:p.units,netLamports:value??p.entryLamports,evidence:'OFFLINE fresh actual inventory liquidation'}]));}
function buy(ledger:PaperLedger,mint:string,at:number,p:UsdPrice,deposit='0',spend='490000000',v3Strategy=false){
 const observed=marks(ledger,at);ledger.reconcile('context:'+mint,at,p,observed);
 const windowEndAt=Math.floor(at/10000)*10000;
 const order={id:'buy-'+mint,mint,side:'buy' as const,decidedAt:at,executeAt:at+500,expiresAt:at+3000,gas:'7000',deposit,maxSpend:spend,minReceive:'1',decisionEvidence:'OFFLINE independently qualified executable fixture',...(v3Strategy?{entryStrategy:{version:'liquidity-resilient-momentum-v3' as const,cycle:1,windowStartAt:windowEndAt-60000,windowEndAt,assessedAt:at,signalId:'OFFLINE verified new V3 roundtrip'}}:{})};
 assert.equal('reserved'in ledger.order(order,p,observed),true);
 assert.equal(ledger.attempt('fill-'+mint,order.id,at+500,{at:at+500,spendLamports:spend,receiveUnits:'100',evidence:'OFFLINE exact-size entry'},price(at+500,p.microUsdPerSol),marks(ledger,at+500)).status,'filled');
 return order;
}
function roundtrip(ledger:PaperLedger,mint:string,at:number,deposit:string){
 assert.equal(resume(ledger,at).enabled,true);buy(ledger,mint,at+1,price(at+1),deposit,'1000000');
 const sell={id:'sell-'+mint,mint,side:'sell' as const,decidedAt:at+502,executeAt:at+1002,expiresAt:at+3000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE full liquidation retaining verified ATA asset'};
 ledger.order(sell,price(at+502),{});assert.equal(ledger.attempt('close-'+mint,sell.id,at+1002,{at:at+1002,spendLamports:'0',receiveUnits:'1000000',pricedBaseUnits:'100',evidence:'OFFLINE full exit with retained refundable asset'},price(at+1002)).status,'filled');ledger.pause('prepare-'+mint,at+1003,'OFFLINE epoch preparation');
}

test('V3 appends one backed-up10SOL epoch and policy while preserving the exact original account and loss history',async t=>{
 const f=setup(t);await f.old();f.ledger.reconcile('old-drawdown',OLD_AT+1,price(OLD_AT+1,'89000000'),{});
 const before=f.ledger.state();assert.equal(before.daily.lossPaused,true);assert.equal(before.equityRisk!.version,PAPER_EQUITY_RISK_VERSION);
 const original=db(f.path),seal=paperEpochLogicalSeal(original),journal=original.prepare('SELECT * FROM journal ORDER BY revision').all(),actions=original.prepare('SELECT * FROM actions ORDER BY id').all();original.close();
 const result=await f.v3(V3_AT,'89000000'),after=f.ledger.state(),p=f.ledger.projection(V3_AT,price(V3_AT,'89000000'));
 assert.equal(after.accountId,POE_OPERATING_ACCOUNT.accountId);assert.equal(after.inceptionAt,POE_OPERATING_ACCOUNT.inceptionAt);assert.equal(result.epoch.id,PAPER_V3_TEN_SOL_EPOCH_ID);assert.deepEqual(result.epoch.priorEpoch,before.paperEpoch);assert.equal(after.lamports,'10000000000');assert.deepEqual(after.positions,{});assert.deepEqual(after.pending,{});assert.deepEqual(after.lockedDeposits,{});assert.equal(p.reservedLamports,'0');assert.equal(p.totalPnlLamports,'0');assert.equal(p.totalPnlMicroUsd,'0');assert.equal(p.realizedLamports,'0');assert.equal(p.executionCostsLamports,'0');assert.equal(after.controls.entriesEnabled,false);assert.equal(after.equityRisk!.version,PAPER_V3_EQUITY_RISK_VERSION);assert.deepEqual(result.riskPolicy,PAPER_V3_EQUITY_RISK_POLICY);assert.equal(after.realizedLamports,before.realizedLamports);assert.equal(after.executionCosts,before.executionCosts);
 const backup=db(result.backup.backupPath);assert.equal(backup.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(paperEpochLogicalSeal(backup),seal);backup.close();assert.equal(createHash('sha256').update(readFileSync(result.backup.backupPath)).digest('hex'),result.backup.backupSha256);
 const latest=db(f.path);assert.deepEqual(latest.prepare('SELECT * FROM journal WHERE revision<=? ORDER BY revision').all(before.revision),journal);assert.deepEqual(latest.prepare('SELECT * FROM actions WHERE id<>? ORDER BY id').all('epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID),actions);const payload=JSON.parse((latest.prepare('SELECT detail FROM journal WHERE action_id=?').get('epoch:'+PAPER_V3_TEN_SOL_EPOCH_ID) as {detail:string}).detail);assert.deepEqual(payload.previousState,before);assert.equal(payload.previousState.daily.lossPaused,true);latest.close();
 const snapshot=buildPilotPortfolio({authoritativeOperating:true,at:V3_AT,running:true,state:after,projection:p,identity:{accountId:after.accountId,inceptionAt:new Date(after.inceptionAt).toISOString(),release:'offline-v3-fixture',strategy:'liquidity-resilient-momentum-v3'},sequence:'1',price:price(V3_AT,'89000000'),marks:{},history:f.ledger.getOperatingReportingHistory(),journal:[],actionResults:new Map(),decisions:[],funnel:{discovered:0,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:0},connected:true,warming:false,usefulProgressAt:V3_AT,blocker:'POE_ENTRY_RECONCILIATION_REQUIRED',metrics:{eventLoopLagMs:0,processingLagMs:0,providerEvents:0,rpcRequests:0,rpcAvailable:true}});
 assert.equal(snapshot.financialEpoch!.id,PAPER_V3_TEN_SOL_EPOCH_ID);assert.equal(snapshot.financialEpoch!.version,'poe-paper-epoch-v3');assert.equal(snapshot.balances.equitySol,'10');assert.equal(snapshot.balances.tradingPnlUsd,0);assert.equal(snapshot.financialEpoch!.version==='poe-paper-epoch-v3'&&snapshot.financialEpoch!.priorEpoch.id,PAPER_TEN_SOL_EPOCH_ID);
});

test('V3 has no percentage/$50 daily halt or inherited two/three-position cap, with exact five-percent sizing after losses',async t=>{
 const f=setup(t);await f.old();await f.v3(V3_AT,'1000000000');assert.equal(resume(f.ledger,V3_AT+1,price(V3_AT+1,'1000000000')).enabled,true);
 for(let i=0;i<4;i++)buy(f.ledger,'v3-'+i,V3_AT+1000+i*1000,price(V3_AT+1000+i*1000,'1000000000'));
 const at=V3_AT+5000,liquidations=marks(f.ledger,at,'1');f.ledger.reconcile('genuine-fixture-loss',at,price(at,'1000000000'),liquidations);
 const s=f.ledger.state(),p=f.ledger.projection(at,price(at,'1000000000'),liquidations);assert.equal(Object.keys(s.positions).length,4);assert.equal(p.entriesEnabled,true);assert.equal(s.daily.lossPaused,false);assert.equal(s.daily.paused,false);assert.equal(dailyLossEntryBlocked(s),false);assert.ok(p.equityRisk!.daily.drawdownBps!>1000);assert.ok(BigInt(p.equityRisk!.daily.drawdownMicroUsd!)>50000000n);assert.equal(p.equityRisk!.daily.limitBps,null);assert.equal(p.equityRisk!.daily.remainingBeforePauseMicroUsd,null);assert.equal(p.equityRisk!.reasonCode,null);
 for(const held of Object.values(s.positions)){assert.equal(held.allocation!.version,PAPER_V3_EQUITY_RISK_VERSION);assert.ok(BigInt(held.costMicroUsd)>50000000n);}
 const budget=f.ledger.entryRiskBudget(at,price(at,'1000000000'),liquidations);assert.equal(BigInt(budget.maximumConsumedLamports),BigInt(p.equityMicroUsd!)*1000000000n*500n/(1000000000n*10000n));
 const report=projectFinancialPolicyReporting({financial:p},at)!;assert.equal(report.risk!.version,PAPER_V3_EQUITY_RISK_VERSION);assert.equal(report.risk!.daily.limitBps,null);assert.equal(report.risk!.daily.lossPaused,false);validateFinancialPolicyReporting(report,at);
 for(const mutate of [(r:any)=>r.daily.limitBps=1000,(r:any)=>r.daily.remainingBeforePauseMicroUsd='0',(r:any)=>r.daily.lossPaused=true,(r:any)=>r.reasonCode='EQUITY_RISK_DAILY_DRAWDOWN']){const invalid=structuredClone(report);mutate(invalid.risk);assert.throws(()=>validateFinancialPolicyReporting(invalid,at),/FINANCIAL_POLICY_REPORTING/);}
 const stopped=f.ledger.state();assert.equal((await f.v3(V3_AT+6000,'1')).alreadyApplied,true);assert.deepEqual(f.ledger.state(),stopped);f.reopen();assert.deepEqual(f.ledger.state(),stopped);assert.equal(f.ledger.v3RiskPolicyActive(),true);
 // Loss telemetry survives a normal UTC-day rollover; no old halt returns.
 const next=Date.parse('2026-10-31T00:00:00Z');f.ledger.reconcile('next-day',next,price(next,'1000000000'),marks(f.ledger,next,'1'));assert.equal(f.ledger.state().daily.lossPaused,false);assert.equal(f.ledger.projection(next,price(next,'1000000000'),marks(f.ledger,next,'1')).entriesEnabled,true);
});

test('a second epoch archives only current-epoch closed deposit assets, never counts prior archived deposits twice',async t=>{
 const f=setup(t);roundtrip(f.ledger,'original-deposit',AT+10,'2000000');
 // The first transition follows the original closed position in chronological order.
 const old=await f.ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:f.backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(AT+2000)},()=>AT+2000);
 roundtrip(f.ledger,'second-deposit',AT+2010,'3000000');const before=f.ledger.state();
 const result=await f.v3(AT+4000);assert.deepEqual(result.epoch.archivedAssets.lockedDeposits,{'second-deposit':'3000000'});assert.deepEqual(result.epoch.priorEpoch.archivedAssets.lockedDeposits,{'original-deposit':'2000000'});assert.deepEqual(result.epoch.priorEpoch,old.epoch);assert.equal(result.epoch.archivedAssets.cashLamports,before.lamports);assert.deepEqual(f.ledger.state().lockedDeposits,{});assert.equal(f.ledger.state().lamports,'10000000000');
});

test('V3 authorization is distinct, unsettled old obligations refuse, and missing V3 policy never falls back to old loss or sizing policy',async t=>{
 const f=setup(t);await assert.rejects(f.v3(),/PREVIOUS_EPOCH/);await f.old();const before=f.ledger.state();
 await assert.rejects(f.ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION as any,backupDirectory:f.backups,price:price(V3_AT)},()=>V3_AT),/AUTHORIZATION/);
 assert.equal(resume(f.ledger,OLD_AT+1).enabled,true);buy(f.ledger,'unsettled-old',OLD_AT+2,price(OLD_AT+2),'0','1000000');f.ledger.pause('offline-stop-with-exposure',OLD_AT+503,'OFFLINE preparation retains position');await assert.rejects(f.v3(AT+1000),/UNRESOLVED/);
 // A separate flat fixture verifies the policy-corruption exit/read gate.
 const g=setup(t);await g.old();await g.v3();const current=structuredClone({...g.ledger.state()}),raw=db(g.path,false);delete current.equityRisk;raw.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(current));raw.close();assert.equal(g.ledger.projection(V3_AT,price(V3_AT)).entriesEnabled,false);assert.equal(g.ledger.entryRiskBudget(V3_AT,price(V3_AT)).ready,false);assert.equal(g.ledger.entryRiskBudget(V3_AT,price(V3_AT)).maximumConsumedLamports,'0');assert.throws(()=>g.ledger.activateEquityRiskPolicy(V3_AT+1),/unavailable/);assert.deepEqual(g.ledger.state(),current);assert.equal(before.paperEpoch!.id,PAPER_TEN_SOL_EPOCH_ID);
});

test('offline CLI requires exact V3 selector and owner authorization, without selecting a ledger during parsing',()=>{
 const base=['--backup-directory=/offline/private','--price-micro-usd-per-sol=100000000','--price-at='+V3_AT,'--price-source=OFFLINE conversion'];
 assert.equal(parseAuthorizedEpochArguments([...base,'--epoch=v3','--authorization='+PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION]).v3,true);
 assert.equal(parseAuthorizedEpochArguments([...base,'--authorization='+PAPER_TEN_SOL_EPOCH_AUTHORIZATION]).v3,false);
 for(const args of [[...base,'--epoch=v3','--authorization='+PAPER_TEN_SOL_EPOCH_AUTHORIZATION],[...base,'--authorization='+PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION],[...base,'--epoch=v4','--authorization='+PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION]])assert.throws(()=>parseAuthorizedEpochArguments(args),/EXPLICIT_ARGUMENTS/);
});

test('V3 executable-profit floor is durable, monotonic and bound to the exact held inventory without changing money or controls',async t=>{
 const f=setup(t);await f.old();await f.v3();assert.equal(resume(f.ledger,V3_AT+1).enabled,true);const order=buy(f.ledger,'profit-floor',V3_AT+1000,price(V3_AT+1000),'0','490000000',true),at=V3_AT+2000;
 f.ledger.checkpointAdaptiveProtection('fresh-executable-peak',at,marks(f.ledger,at,'800000000'));const before=f.ledger.state(),input={mint:order.mint,units:'100',roundTripId:order.id,floorLamports:'650000000',quoteAt:at,evidence:'OFFLINE fresh actual-size quote underlying V3 scenario'};
 assert.equal(f.ledger.checkpointV3ProtectionFloor('durable-floor',at,input).updated,true);const after=f.ledger.state();assert.equal(after.positions[order.mint]!.strategy!.profitProtectionFloorLamports,'650000000');for(const k of ['lamports','lockedDeposits','pending','daily','controls','realizedLamports','executionCosts','paperEpoch','equityRisk'] as const)assert.deepEqual(after[k],before[k]);
 assert.equal(f.ledger.checkpointV3ProtectionFloor('lower-floor',at+1,{...input,quoteAt:at+1,floorLamports:'600000000'}).updated,false);assert.deepEqual(f.ledger.state(),after);f.reopen();assert.deepEqual(f.ledger.state(),after);
 for(const invalid of [{...input,units:'101'},{...input,roundTripId:'different-roundtrip'},{...input,floorLamports:'800000001'},{...input,floorLamports:'490000000'},{...input,quoteAt:at-2001}])assert.throws(()=>f.ledger.checkpointV3ProtectionFloor('invalid-floor',at,invalid),/fresh exact-inventory/);
 assert.deepEqual(f.ledger.state(),after);
});

test('unavailable optional V3 entry policy cannot restore legacy loss/capacity rules or prevent a genuine fourth-position protective sale',async t=>{
 const f=setup(t);await f.old();await f.v3();assert.equal(resume(f.ledger,V3_AT+1).enabled,true);for(let i=0;i<4;i++)buy(f.ledger,'retained-'+i,V3_AT+1000+i*1000,price(V3_AT+1000+i*1000));
 const changed=structuredClone({...f.ledger.state()});delete changed.equityRisk;changed.daily.lossPaused=true;changed.daily.paused=true;const raw=db(f.path,false);raw.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(changed));raw.close();f.reopen();
 const at=V3_AT+5000,p=f.ledger.projection(at,price(at),marks(f.ledger,at));assert.equal(p.entriesEnabled,false);assert.equal(p.equityRisk!.version,PAPER_V3_EQUITY_RISK_VERSION);assert.equal(p.equityRisk!.daily.limitBps,null);assert.equal(dailyLossEntryBlocked(f.ledger.state()),false);assert.equal(f.ledger.entryRiskBudget(at,price(at),marks(f.ledger,at)).maximumConsumedLamports,'0');
 const exit={id:'genuine-protective-sale',mint:'retained-3',side:'sell' as const,decidedAt:at,executeAt:at+500,expiresAt:at+3000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE protective exit with optional entry-policy outage'};
 f.ledger.order(exit,price(at),{});assert.equal(f.ledger.attempt('settled-protective-sale',exit.id,at+500,{at:at+500,spendLamports:'0',receiveUnits:'1000000',pricedBaseUnits:'100',evidence:'OFFLINE executable full retained inventory liquidation'},price(at+500)).status,'filled');assert.equal(Object.keys(f.ledger.state().positions).length,3);assert.equal(f.ledger.state().positions[exit.mint],undefined);
});
