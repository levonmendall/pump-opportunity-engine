import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DisposableLedger,type UsdPrice,OPERATING_FINANCIAL_READINESS_VERSION} from '../src/ledger.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_TEN_SOL_EPOCH_ID,paperEpochLogicalSeal,requireEpochFlat,verifiedEpochBackup} from '../src/paper-epoch.js';
const AT=Date.parse('2026-10-30T07:00:00Z'),EPOCH=AT+10000;
const price=(at:number,value='100000000'):UsdPrice=>({at,microUsdPerSol:value,source:'OFFLINE independently timestamped USD fixture'});
function setup(t:{after:(fn:()=>void)=>void}){
 const dir=mkdtempSync(join(tmpdir(),'poe-epoch-')),path=join(dir,'ledger.sqlite'),backups=join(dir,'backups');mkdirSync(backups,{mode:0o700});
 let ledger=new DisposableLedger(path,'fixture-paper-epoch');ledger.initialize(price(AT,'110000000'),AT);ledger.reconcile('initial',AT,price(AT,'110000000'),{});ledger.activateEquityRiskPolicy(AT+1);ledger.reconcile('activated',AT+2,price(AT+2,'110000000'),{});ledger.pause('owner-epoch-preparation',AT+3,'OFFLINE owner preparation pause');
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,path,backups,get ledger(){return ledger;},reopen(){ledger.close();ledger=new DisposableLedger(path,'fixture-paper-epoch');return ledger;},begin(at=EPOCH,value='100000000'){return ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,price:price(at,value)},()=>at);}};
}
function raw(path:string,readonly=true){return new Database(path,{readonly,fileMustExist:true});}

test('one-time10SOL epoch retains every original row and recovery-verifiable consistent SQLite backup',async t=>{
 const f=setup(t),before=f.ledger.state(),db=raw(f.path),prior=paperEpochLogicalSeal(db);db.close();
 const result=await f.begin(),state=f.ledger.state(),p=f.ledger.projection(EPOCH,price(EPOCH));
 assert.equal(result.alreadyApplied,false);assert.equal(result.epoch.id,PAPER_TEN_SOL_EPOCH_ID);assert.equal(state.lamports,'10000000000');assert.equal(state.accountId,before.accountId);assert.equal(state.inceptionAt,before.inceptionAt);assert.equal(state.initialMicroUsd,before.initialMicroUsd);assert.deepEqual(state.inceptionPrice,before.inceptionPrice);assert.equal(state.roundingResidualMicroUsd,before.roundingResidualMicroUsd);assert.equal(state.realizedLamports,before.realizedLamports);assert.equal(state.executionCosts,before.executionCosts);
 assert.equal(p.equityLamports,'10000000000');assert.equal(p.equityMicroUsd,'1000000000');assert.equal(p.totalPnlLamports,'0');assert.equal(p.totalPnlMicroUsd,'0');assert.equal(p.realizedLamports,'0');assert.equal(p.passiveSolEquityMicroUsd,'1000000000');assert.equal(p.solPriceEffectMicroUsd,'0');assert.equal(p.entriesEnabled,false);assert.equal(state.daily.reconciledAt,0);assert.equal(state.controls.stopRequested,false);
 const copied=raw(result.backup.backupPath);assert.equal(copied.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(paperEpochLogicalSeal(copied),prior);copied.close();
 assert.equal(createHash('sha256').update(readFileSync(result.backup.backupPath)).digest('hex'),result.backup.backupSha256);assert.deepEqual(JSON.parse(readFileSync(result.backup.receiptPath,'utf8')),result.backup);
 const after=raw(f.path);for(const [table,order]of [['actions','id'],['journal','revision']] as const){const old=raw(result.backup.backupPath);const prefix=old.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();old.close();const latest=after.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();assert.equal(latest.length,prefix.length+1);if(table==='journal')assert.deepEqual(latest.slice(0,prefix.length),prefix);else{const ids=new Set((prefix as {id:string}[]).map(r=>r.id));assert.deepEqual(latest.filter((r:any)=>ids.has(r.id)),prefix);}}
 after.close();assert.equal(result.backup.recoveryVerification,'read-only-reopen-state-schema-and-all-logical-rows');assert.equal(state.revision,before.revision+1);
});

test('repeat and restart cannot contribute twice or reset an epoch daily-loss high water',async t=>{
 const f=setup(t);const first=await f.begin();const state=f.ledger.state();const again=await f.begin(EPOCH+1,'90000000');assert.equal(again.alreadyApplied,true);assert.deepEqual(again.epoch,first.epoch);assert.deepEqual(f.ledger.state(),state);
 f.ledger.reconcile('epoch-loss',EPOCH+2,price(EPOCH+2,'89000000'),{});assert.equal(f.ledger.state().daily.lossPaused,true);assert.equal(f.ledger.state().equityRisk!.daily.highWaterMicroUsd,'1000000000');
 const lost=f.ledger.state();f.reopen();assert.deepEqual(f.ledger.state(),lost);const third=await f.begin(EPOCH+3);assert.equal(third.alreadyApplied,true);assert.deepEqual(f.ledger.state(),lost);assert.equal(f.ledger.projection(EPOCH+3,price(EPOCH+3)).entriesEnabled,false);
});

test('owner epoch is an explicit new control boundary; fresh financial evidence still required before resume',async t=>{
 const f=setup(t);await f.begin();const at=EPOCH+1;f.ledger.reconcile('epoch-ready',at,price(at),{});const s=f.ledger.state();
 assert.equal(f.ledger.operatingFinancialRecoveryAllowed(at),true);
 const readiness={version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only' as const,evidence:'OFFLINE independently fresh native support',accountId:s.accountId,stateRevision:s.revision,reconciledAt:s.daily.reconciledAt,positionUnits:{},source:{kind:'selected-native-support' as const,bankClockAt:at-1000,receivedAt:at-100,validUntil:at-1000+30000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true};
 assert.equal(f.ledger.resume('epoch-resume',at,price(at),{},readiness).enabled,true);
 f.ledger.pause('new-owner-pause',at+1,'OFFLINE new owner pause after epoch');assert.equal(f.ledger.operatingFinancialRecoveryAllowed(at+1),false);
 assert.equal(f.ledger.resume('must-not-erase-new-owner-pause',at+1,price(at+1),{},{...readiness,stateRevision:f.ledger.state().revision,reconciledAt:f.ledger.state().daily.reconciledAt}).enabled,false);
});

test('all unresolved positions, pending orders and refundable deposits prevent transition',async t=>{
 const f=setup(t),state=f.ledger.state();for(const kind of ['positions','pending','lockedDeposits']as const){const modified=structuredClone(state);(modified[kind]as any).obligation=kind==='lockedDeposits'?'1':{};assert.throws(()=>requireEpochFlat(modified),/UNRESOLVED/);}
 const db=raw(f.path,false);const altered=structuredClone(state);altered.lockedDeposits['retained-modeled-ata']='2000000';db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(altered));db.close();await assert.rejects(f.begin(),/UNRESOLVED/);assert.deepEqual(f.ledger.state(),altered);assert.equal(f.ledger.state().paperEpoch,undefined);
});

test('missing authorization, unsafe backup directory and stale conversion cannot append or rebase',async t=>{
 const f=setup(t),before=f.ledger.state();await assert.rejects(f.ledger.beginAuthorizedTenSolEpoch({authorization:'forged' as any,backupDirectory:f.backups,price:price(EPOCH)},()=>EPOCH),/AUTHORIZATION/);chmodSync(f.backups,0o755);await assert.rejects(f.begin(),/PRIVATE_DURABLE/);chmodSync(f.backups,0o700);
 await assert.rejects(f.ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:f.backups,price:price(EPOCH-10001)},()=>EPOCH),/fresh timestamped/);assert.deepEqual(f.ledger.state(),before);
 // A failed attempt retained its evidence; a new backup name permits a safe
 // fresh retry, rather than deleting or overwriting an earlier backup.
 assert.equal((await f.begin()).alreadyApplied,false);
});

test('corrupted epoch anchor is rejected instead of changing financial basis',async t=>{
 const f=setup(t);await f.begin();const db=raw(f.path,false);db.prepare("UPDATE actions SET payload_hash=? WHERE id=?").run('0'.repeat(64),'epoch:'+PAPER_TEN_SOL_EPOCH_ID);db.close();assert.throws(()=>f.ledger.state(),/HISTORY_UNAVAILABLE/);assert.throws(()=>f.reopen(),/HISTORY_UNAVAILABLE/);
});

test('concurrent source changes during SQLite backup invalidate the recovery prerequisite',async t=>{
 const f=setup(t),db=raw(f.path,false),original=db.backup.bind(db);(db as any).backup=async(path:string)=>{await original(path);db.prepare("INSERT INTO metadata VALUES('concurrent-source-change','observed')").run();};
 await assert.rejects(verifiedEpochBackup(db,f.backups,()=>{}),/SOURCE_CHANGED_DURING_BACKUP/);db.close();assert.equal(f.ledger.state().paperEpoch,undefined);
});

test('verified closed-position deposit assets and cash are archived separately from a NEW10SOL contribution',async t=>{
 const f=setup(t),at=AT+100;
 f.ledger.reconcile('fund-closed-position',at,price(at,'110000000'),{});
 f.ledger.resume('fixture-resume',at,price(at,'110000000'),{},{version:'OFFLINE fixture',evidence:'OFFLINE observed readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 const buy={id:'archive-buy',mint:'archive-mint',side:'buy' as const,decidedAt:at,executeAt:at+500,expiresAt:at+3000,gas:'7000',deposit:'2000000',maxSpend:'1000000',minReceive:'1',decisionEvidence:'OFFLINE original entry'};
 f.ledger.order(buy,price(at,'110000000'),{});assert.equal(f.ledger.attempt('archive-buy-fill',buy.id,at+500,{at:at+500,spendLamports:'1000000',receiveUnits:'100',evidence:'OFFLINE actualsize buy'},price(at+500,'110000000')).status,'filled');
 const sell={id:'archive-sell',mint:buy.mint,side:'sell' as const,decidedAt:at+501,executeAt:at+1001,expiresAt:at+3500,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE full old liquidation'};
 f.ledger.order(sell,price(at+501,'110000000'),{});assert.equal(f.ledger.attempt('archive-sell-fill',sell.id,at+1001,{at:at+1001,spendLamports:'0',receiveUnits:'1000000',pricedBaseUnits:'100',evidence:'OFFLINE sale retaining open ATA asset'},price(at+1001,'110000000')).status,'filled');f.ledger.pause('archive-preparation',at+1002,'OFFLINE owner epoch instruction');
 const before=f.ledger.state();await assert.rejects(f.begin(),/UNRESOLVED/);
 const {PAPER_EPOCH_ASSET_SEGREGATION}=await import('../src/paper-epoch.js');
 const receipt=await f.ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,backupDirectory:f.backups,price:price(EPOCH)},()=>EPOCH),epoch=receipt.epoch;
 assert.equal(epoch.contributionLamports,'10000000000');assert.equal(epoch.archivedAssets.cashLamports,before.lamports);assert.deepEqual(epoch.archivedAssets.lockedDeposits,before.lockedDeposits);assert.equal(epoch.archivedAssets.lockedDeposits[buy.mint],'2000000');assert.equal(BigInt(epoch.capitalArchivedLamports),BigInt(before.lamports)+2000000n);assert.equal(BigInt(epoch.capitalAdjustmentLamports),10000000000n-BigInt(epoch.capitalArchivedLamports));
 const state=f.ledger.state();assert.deepEqual(state.lockedDeposits,{});assert.equal(state.lamports,'10000000000');assert.equal(state.realizedLamports,before.realizedLamports);assert.equal(state.executionCosts,before.executionCosts);const p=f.ledger.projection(EPOCH,price(EPOCH));assert.equal(p.realizedLamports,'0');assert.equal(p.executionCostsLamports,'0');assert.equal(p.totalPnlLamports,'0');
 const original=raw(receipt.backup.backupPath);assert.deepEqual(paperEpochLogicalSeal(original).state,before);original.close();f.reopen();assert.deepEqual(f.ledger.state().paperEpoch,epoch);assert.throws(()=>f.ledger.releaseDeposit('no-new-epoch-refund',buy.mint,'2000000',EPOCH+1,'OFFLINE attempt to double count archived asset'),/closed-account refund/);
});

test('an unproved deposit asset cannot be laundered by the segregation flag',async t=>{
 const f=setup(t),before=f.ledger.state(),db=raw(f.path,false);before.lockedDeposits['unproved-asset']='2000000';db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(before));db.close();
 const {PAPER_EPOCH_ASSET_SEGREGATION}=await import('../src/paper-epoch.js');await assert.rejects(f.ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,backupDirectory:f.backups,price:price(EPOCH)},()=>EPOCH),/ASSET_BOOK_NOT_RECONCILED/);assert.deepEqual(f.ledger.state(),before);
});

test('removing optional epoch state after its durable transition cannot revive the original financial basis',async t=>{
 const f=setup(t);await f.begin();const state={...f.ledger.state()};delete state.paperEpoch;const db=raw(f.path,false);db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));db.close();assert.throws(()=>f.ledger.state(),/STATE_MISSING_FROM_RECORDED_HISTORY/);assert.throws(()=>f.ledger.projection(EPOCH,price(EPOCH)),/STATE_MISSING_FROM_RECORDED_HISTORY/);
});

test('epoch shutdown recovery uses the explicit epoch boundary without inventing a successful resume',async t=>{
 const f=setup(t);await f.begin();const run='native-paper-'+new Date(EPOCH).toISOString().replace(/[^0-9]/g,'');f.ledger.safeStop('native-paper-stop:'+run,EPOCH+1);const proof=f.ledger.internalShutdownRecoveryProof([run],EPOCH+2);assert.equal(proof.verified,true);if(!proof.verified)throw Error('epoch shutdown proof unavailable');assert.equal(proof.lastSuccessfulResumeRevision,0);assert.equal(proof.stops.length,1);
});
