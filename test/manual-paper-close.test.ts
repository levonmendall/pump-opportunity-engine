/** OFFLINE original-identity fixture, retained real SDK account bytes, synthetic
 * current Clock and local-only ledger. This is no live fill or market claim. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {PilotMarket} from '../src/pilot-market.js';
import type {PoolWireAccount} from '../src/pool.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION} from '../src/paper-epoch.js';
import {executeAuthorizedManualClose,manualCloseOrderId,manualCloseSha256,validateManualCloseAuthorization,MANUAL_CLOSE_INSTALLED_SOURCE,MANUAL_CLOSE_EXECUTION_SOURCE,MANUAL_CLOSE_SCOPE,type ManualCloseAuthorization,type ManualCloseClaim,type ManualCloseOptions} from '../operator/manual-close/manual-close.js';
import {parseManualCloseArguments,validateManualCloseManifest} from '../operator/manual-close/manual-close-cli.js';

async function fixture(t:TestContext,modern=true){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-owner-close-')),path=join(root,'ledger.sqlite'),backups=join(root,'backups');mkdirSync(backups,{mode:0o700});
 const capture='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${capture}.json`,'utf8')),rows=readFileSync(`evidence/integration-${capture}.ndjson`,'utf8').trim().split('\n').map(s=>JSON.parse(s)),wire=rows.find(row=>row.kind==='pool-state').data;
 let at=Date.parse('2026-11-03T18:00:00.000Z'),slot=wire.context.slot+100000,clockAge=0,failLanding=false;const oldNow=Date.now;Date.now=()=>at;
 let ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);t.after(()=>{ledger.close();Date.now=oldNow;rmSync(root,{recursive:true,force:true});});
 const price=(time=at):UsdPrice=>({microUsdPerSol:'100000000',at:time,source:'OFFLINE synthetic fixed conversion'});
 ledger.initialize(price(POE_OPERATING_ACCOUNT.inceptionAt),POE_OPERATING_ACCOUNT.inceptionAt);ledger.activateEquityRiskPolicy(at-10000);ledger.reconcile('offline-day',at-9999,price(at-9999),{});ledger.pause('offline-epoch',at-9998,'OFFLINE epoch setup');
 await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(at-9000)},()=>at-9000);
 await ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(at-8000)},()=>at-8000);
 ledger.reconcile('offline-entry-context',at,price(),{});const s=ledger.state();assert.equal(ledger.resume('offline-enabled',at,price(),{},{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE fixture complete current inventory',accountId:s.accountId,stateRevision:s.revision,reconciledAt:at,positionUnits:{},source:{kind:'selected-native-support',bankClockAt:at-1000,receivedAt:at,validUntil:at+29000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true}).enabled,true);
 const accounts=new Map<string,PoolWireAccount>();for(let i=0;i<wire.addresses.length;i++)accounts.set(wire.addresses[i],structuredClone(wire.value[i]));
 const calls:Array<{method:string;at:number;params:unknown[]}>=[],records:Array<{kind:string;data:any}>=[];
 const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push({method,at,params:structuredClone(params)});if(failLanding&&Object.values(ledger.state().pending).some(o=>o.side==='sell'))throw Error('OFFLINE landing unavailable');if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0])) as T;assert.equal(method,'getMultipleAccounts');const bytes=Buffer.alloc(40);bytes.writeBigUInt64LE(BigInt(slot));bytes.writeBigInt64LE(BigInt(Math.floor((at-clockAge)/1000)),32);const clock:PoolWireAccount={data:[bytes.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};return {context:{slot},value:(params[0] as string[]).map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))} as T;},usage:()=>({offline:true,physicalCalls:calls.length})};
 const mint=proof.quote.mint,pool={mint,migrationSlot:proof.origin.slot,migrationVerified:true as const,evidence:'OFFLINE retained verified migration, synthetic current time'};
 const market=new PilotMarket({rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder:{record:(kind,data)=>records.push({kind,data:structuredClone(data)})},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'OFFLINE normal native7000 assumptions'},...(modern?{executionRealism:true as const}:{})});market.registerPool(pool);
 const plan=await market.prepareEntryCosts(mint,new AbortController().signal),q=await market.quote({mint,side:'buy',inputUnits:'10000000'},new AbortController().signal);assert.ok(q);
 const end=Math.floor(at/10000)*10000,entry={id:'offline-original-roundtrip',side:'buy' as const,mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:plan.depositLamports,maxSpend:'10000000',minReceive:(BigInt(q.outputUnits)*9900n/10000n).toString(),decisionEvidence:q.evidence,entryStrategy:{version:'liquidity-resilient-momentum-v3.1' as const,cycle:1,windowStartAt:end-60000,windowEndAt:end,assessedAt:at,signalId:'OFFLINE fixture complete audited window'}};
 // Set up the preexisting holding through unchanged ordinary model/ledger APIs.
 if(modern){const executionPlan=market.executionPlan(entry);assert.ok(executionPlan&&'executeAt'in executionPlan);ledger.order({...entry,executeAt:executionPlan.executeAt,expiresAt:executionPlan.expiresAt,temporaryRentLamports:executionPlan.temporaryQuoteRentLamports,executionModel:executionPlan},price(),{});at=executionPlan.executeAt;slot++;const context=await market.context(ledger.state().positions,new AbortController().signal);const executionQuote=await market.executionQuote({order:ledger.state().pending[entry.id]!,attemptedAt:at,fullPositionBaseUnits:null},new AbortController().signal);assert.ok(executionQuote?.executionModel);const {executionAttempt}=await import('../src/execution-realism.js');assert.equal(ledger.attempt('offline-original-entry',entry.id,at,executionQuote,price(),context.marks,executionAttempt(executionPlan,true,false)).status,'filled');}
 else{ledger.order(entry,price(),{});at=entry.executeAt;assert.equal(ledger.attempt('offline-original-entry',entry.id,at,{at,spendLamports:'10000000',receiveUnits:q.outputUnits,evidence:'OFFLINE retained SDK legacy entry'},price(),{}).status,'filled');}
 at+=10;const beforePause=ledger.state();ledger.pause(`trader:pause:${beforePause.revision}:${at}`,at,'native PAPER routine checkpoint: fresh audited readiness required');assert.equal(ledger.operatingFinancialRecoveryAllowed(at),true);
 const state=ledger.state(),holding=state.positions[mint]!,ls=statSync(path,{bigint:true});const authorization:ManualCloseAuthorization={schemaVersion:1,scope:MANUAL_CLOSE_SCOPE,authorizationId:'offline-one-owner-close-20261103',accountId:state.accountId,inceptionAt:state.inceptionAt,epochId:state.paperEpoch!.id,epochSha256:manualCloseSha256(state.paperEpoch),mint,pool:proof.quote.pool,roundTripId:holding.strategy!.roundTripId,units:holding.units,enteredAt:holding.enteredAt,installedSource:MANUAL_CLOSE_INSTALLED_SOURCE,executionSource:MANUAL_CLOSE_EXECUTION_SOURCE,issuedAt:at,expiresAt:at+300000,ledgerDevice:ls.dev.toString(),ledgerInode:ls.ino.toString()};
 const claimStore=new Map<string,ManualCloseClaim>();let recordHook:((kind:string,data:any)=>void)|undefined;
 const options=():ManualCloseOptions=>({ledger,authorization,authorizationSha256:manualCloseSha256(authorization),pool,knownRunIds:['native-paper-20261103170000000'],rpc:()=>rpc,now:()=>at,waitUntil:async time=>{at=time;slot++;},record:(kind,data)=>{records.push({kind,data:structuredClone(data)});recordHook?.(kind,data);},claim:proposed=>{const old=claimStore.get(authorization.authorizationId);if(old)return {created:false,claim:structuredClone(old)};claimStore.set(authorization.authorizationId,structuredClone(proposed));return {created:true,claim:structuredClone(proposed)};}});
 return {root,path,get ledger(){return ledger;},reopen(){ledger.close();ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);},authorization,options,calls,records,claimStore,now:()=>at,advance:(ms:number)=>{at+=ms;},staleClock:()=>{clockAge=31000;},landingUnavailable:()=>{failLanding=true;},onRecord:(fn:(kind:string,data:any)=>void)=>{recordHook=fn;}};
}

for(const modern of [true,false])test(`one authorized ${modern?'current modeled':'legacy'} full-size exit preserves original account, epoch, journal prefix and ordinary costs`,async t=>{
 const f=await fixture(t,modern),before=f.ledger.state(),begin=f.calls.length,readonly=new Database(f.path,{readonly:true,fileMustExist:true}),journal=readonly.prepare('SELECT * FROM journal ORDER BY revision').all(),actions=readonly.prepare('SELECT * FROM actions ORDER BY id').all();readonly.close();
 const result=await executeAuthorizedManualClose(f.options());assert.equal(result.executionReceipt?.status,'filled',JSON.stringify(result));assert.equal(result.flat,true);assert.equal(result.newEntryPermissionGranted,false);assert.equal(result.liveTransactionSubmitted,false);assert.deepEqual(result.after.paperEpoch,before.paperEpoch);assert.deepEqual(result.after.lockedDeposits,before.lockedDeposits);assert.equal(BigInt(result.after.executionCostsLamports)-BigInt(before.executionCosts),7000n);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.now()),true);assert.equal(result.after.controls.entriesEnabled,false);
 assert.equal(result.order?.minReceive,(BigInt(f.records.findLast(r=>r.kind==='manual-paper-close-decision')!.data.quote.outputUnits)*9900n/10000n).toString());assert.equal(result.order?.side,'sell');assert.equal(result.executionReceipt?.tradeOutcome?.kind,'closed-position');assert.equal(result.executionReceipt?.tradeOutcome?.entry.orderId,f.authorization.roundTripId);assert.equal(result.executionReceipt?.tradeOutcome?.exit?.orderId,result.orderId);
 const reads=f.calls.slice(begin).filter(r=>r.method==='getMultipleAccounts');assert.ok(reads.length>=2);assert.ok(reads.some(r=>r.at>=result.order!.executeAt));assert.ok(reads.some(r=>r.at<result.order!.executeAt));if(modern)assert.equal(result.order?.executionModel?.version,'paper-chain-conditioned-v1');else assert.equal(result.order?.executionModel,undefined);
 const check=new Database(f.path,{readonly:true,fileMustExist:true});assert.deepEqual(check.prepare('SELECT * FROM journal WHERE revision<=? ORDER BY revision').all(before.revision),journal);for(const row of actions as Array<{id:string}>)assert.deepEqual(check.prepare('SELECT * FROM actions WHERE id=?').get(row.id),row);check.close();
 const after=f.ledger.state(),callCount=f.calls.length;f.advance(400000);const replay=await executeAuthorizedManualClose(f.options());assert.equal(replay.replay,true);assert.deepEqual(replay.executionReceipt,result.executionReceipt);assert.deepEqual(f.ledger.state(),after);assert.equal(f.calls.length,callCount,'completed replay never requests market data or reserves again');
});

test('sealed authorization rejects wrong source, exact inventory, epoch and expired requests before market reads or financial changes',async t=>{
 const f=await fixture(t),before=f.ledger.state(),calls=f.calls.length;
 for(const mutation of [(a:any)=>a.installedSource='0'.repeat(40),(a:any)=>a.executionSource='0'.repeat(40),(a:any)=>a.accountId='poe-wrong',(a:any)=>a.epochSha256='0'.repeat(64),(a:any)=>a.units=(BigInt(a.units)+1n).toString(),(a:any)=>a.roundTripId='different-trip',(a:any)=>a.enteredAt--,(a:any)=>a.pool=a.mint,(a:any)=>{a.issuedAt-=400000;a.expiresAt-=400000;}]){const a=structuredClone(f.authorization);mutation(a);await assert.rejects(executeAuthorizedManualClose({...f.options(),authorization:a}),/MANUAL_CLOSE/);assert.deepEqual(f.ledger.state(),before);assert.equal(f.calls.length,calls);}
});

test('foreign pending exit remains byte-for-byte intact, without recovery, cancellation or quote',async t=>{
 const f=await fixture(t),at=f.now();f.ledger.order({id:'existing-original-exit',side:'sell',mint:f.authorization.mint,decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE already owned exit'}, {microUsdPerSol:'100000000',at,source:'OFFLINE'},{});const before=f.ledger.state(),calls=f.calls.length;
 await assert.rejects(executeAuthorizedManualClose(f.options()),/FOREIGN_PENDING_ACTION/);assert.deepEqual(f.ledger.state(),before);assert.equal(f.calls.length,calls);
});

test('restart after durable own reservation expires the original action without a replacement or later favorable quote',async t=>{
 const f=await fixture(t);f.onRecord(kind=>{if(kind==='manual-paper-close-reserved')throw Error('OFFLINE process stops after durable reservation');});await assert.rejects(executeAuthorizedManualClose(f.options()),/OFFLINE process stops/);const order=f.ledger.state().pending[manualCloseOrderId(f.authorization)]!;assert.ok(order);const calls=f.calls.length;f.onRecord(()=>{});f.reopen();const result=await executeAuthorizedManualClose(f.options());assert.equal(result.pendingRecovery,true);assert.equal(result.executionReceipt?.status,'expired');assert.equal(result.flat,false);assert.equal(result.executionReceipt?.at,order.expiresAt);assert.equal(f.calls.length,calls);assert.equal(f.ledger.state().positions[f.authorization.mint]?.units,f.authorization.units);assert.deepEqual(f.ledger.state().pending,{});
});

test('preexisting owner pause remains hard after an authorized close and cannot become automatic recovery permission',async t=>{
 const f=await fixture(t);f.ledger.pause('owner-existing-control',f.now(),'operator paused new entries');const before=f.ledger.state();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.now()),false);const result=await executeAuthorizedManualClose(f.options());assert.equal(result.executionReceipt?.status,'filled');assert.equal(result.after.controls.reason,before.controls.reason);assert.equal(result.after.controls.stopRequested,before.controls.stopRequested);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.now()),false);
});

for(const internal of [false,true])test(`${internal?'authentic internal':'preexisting owner'} stop lineage survives one exit without clearing stopRequested`,async t=>{
 const f=await fixture(t),runs=f.options().knownRunIds;f.ledger.safeStop(internal?'native-paper-stop:'+runs[0]:'owner-existing-safe-stop',f.now());assert.equal(f.ledger.internalShutdownRecoveryProof(runs,f.now()).verified,internal);const result=await executeAuthorizedManualClose(f.options());assert.equal(result.executionReceipt?.status,'filled');assert.equal(result.after.controls.stopRequested,true);assert.equal(result.after.controls.entriesEnabled,false);assert.deepEqual(result.controlRecovery,{before:{operating:false,internalShutdown:internal},after:{operating:false,internalShutdown:internal}});
});

test('unavailable landing is a failed ordinary modeled attempt with no fabricated fill and no second attempt',async t=>{
 const f=await fixture(t);f.landingUnavailable();const before=f.ledger.state(),result=await executeAuthorizedManualClose(f.options());assert.equal(result.executionReceipt?.status,'failed');assert.equal(result.flat,false);assert.equal(result.after.positions[f.authorization.mint]!.units,f.authorization.units);assert.equal(result.after.executionCostsLamports,before.executionCosts,'modern preflight unsubmitted failure charges no manufactured landed fee');const calls=f.calls.length;const replay=await executeAuthorizedManualClose(f.options());assert.equal(replay.replay,true);assert.equal(replay.executionReceipt?.status,'failed');assert.equal(f.calls.length,calls);
});

test('stale confirmed Clock refuses decision and consumes the authorization without creating a financial order',async t=>{
 const f=await fixture(t);f.staleClock();await assert.rejects(executeAuthorizedManualClose(f.options()),/FRESH_EXACT_SIZE_DECISION_QUOTE_REQUIRED/);assert.equal(f.ledger.actionResult('order:'+manualCloseOrderId(f.authorization)),undefined);assert.deepEqual(f.ledger.state().pending,{});const calls=f.calls.length;await assert.rejects(executeAuthorizedManualClose(f.options()),/ALREADY_USED_WITHOUT_ORDER/);assert.equal(f.calls.length,calls);
});

test('a missing durable authorization witness stops before coordinator recovery or provider work',async t=>{
 const f=await fixture(t),before=f.ledger.state(),calls=f.calls.length;await assert.rejects(executeAuthorizedManualClose({...f.options(),claim:()=>{throw Error('OFFLINE storage unavailable');}}),/OFFLINE storage/);assert.deepEqual(f.ledger.state(),before);assert.equal(f.calls.length,calls);assert.throws(()=>new PaperLedger(f.path,POE_OPERATING_ACCOUNT.accountId),/financial owner locked/);
});

test('operator CLI accepts only the bounded explicit invocation and performs no work during parsing/import',()=>{
 const args=['--authorization','/offline/auth.json','--authorization-sha256','a'.repeat(64),'--operating-directory','/offline/native','--ledger',POE_OPERATING_ACCOUNT.ledgerPath,'--output-directory','/offline/native/runs/native-paper-20261103180000000'];assert.equal(parseManualCloseArguments(args).ledger,POE_OPERATING_ACCOUNT.ledgerPath);for(const invalid of [[],args.slice(0,-2),[...args,'--force','true'],args.map(x=>x==='--ledger'?'--reset':x)])assert.throws(()=>parseManualCloseArguments(invalid),/EXACT_ARGUMENTS/);assert.throws(()=>validateManualCloseAuthorization({}),/AUTHORIZATION_SCHEMA/);
});

test('manual accounting append preserves the existing native192-run retention boundary without archiving or dropping anchors',()=>{
 const a=POE_OPERATING_ACCOUNT,runId='native-paper-20261103190000000',manifest={schemaVersion:1,experimental:false,authoritative:true,accountId:a.accountId,inceptionAt:a.inceptionAt,baselinePaths:['/OFFLINE/prior.json'],runs:Array.from({length:192},(_,i)=>'native-paper-'+new Date(Date.parse('2026-11-03T18:00:00Z')+i).toISOString().replace(/[^0-9]/g,''))};
 for(const n of [127,128,129,191]){const input={...manifest,runs:manifest.runs.slice(0,n)},before=structuredClone(input);validateManualCloseManifest(input,a,runId);assert.deepEqual(input,before);}
 assert.throws(()=>validateManualCloseManifest(manifest,a,runId),/ORIGINAL_OPERATING_MANIFEST/);assert.throws(()=>validateManualCloseManifest({...manifest,runs:[],unresolvedResearch:{runId:'older'}},a,runId),/PRIOR_PHYSICAL_SETTLEMENT_UNRESOLVED/);assert.throws(()=>validateManualCloseManifest({...manifest,runs:[runId]},a,runId),/ORIGINAL_OPERATING_MANIFEST/);
});
