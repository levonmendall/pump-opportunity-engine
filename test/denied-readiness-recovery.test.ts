/** OFFLINE disposable-ledger recovery regressions. No operating account, RPC,
 * financial reset, runtime control socket or publication is used. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {DisposableLedger,OPERATING_FINANCIAL_READINESS_VERSION,type OperatingFinancialReadiness,type Mark,type UsdPrice} from '../src/ledger.js';

const AT=Date.parse('2026-10-29T01:00:00Z'),RUN='native-paper-20261029010000000';
const DENIED='fresh reconciled inventory and authorized temporary recovery required';
const HARD='completed PAPER protection gap exceeded research boundary';
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-denied-readiness-'));
 const ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-denied-readiness-recovery');
 let at=AT;
 const price=():UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE explicit USD'});
 ledger.initialize(price(),at);
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const reconcile=()=>ledger.reconcile('OFFLINE reconcile:'+ledger.state().revision,at,price(),{});
 const pause=(reason='current equity or liquidation unavailable; entries closed')=>ledger.pause('trader:pause:'+ledger.state().revision+':'+at,at,reason);
 const proof=():OperatingFinancialReadiness=>{const s=ledger.state();return {version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE current financial readiness only',accountId:s.accountId,stateRevision:s.revision,reconciledAt:s.daily.reconciledAt,positionUnits:{},source:{kind:'selected-native-support',bankClockAt:at,receivedAt:at,validUntil:at+30000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true};};
 const startup=()=>new PaperExecutionCoordinator({ledger,now:()=>at,context:async()=>({price:price(),marks:{}}),quote:async()=>null}).recover();
 const resume=(id:string,q=proof(),marks:Record<string,Mark>={})=>ledger.resume(id,at,price(),marks,q);
 const db=(ledger as any).db;
 const history=()=>db.prepare('SELECT * FROM journal ORDER BY revision').all();
 const prefix=(revision:number)=>db.prepare('SELECT * FROM journal WHERE revision<=? ORDER BY revision').all(revision);
 reconcile();pause();
 return {ledger,db,price,reconcile,pause,proof,startup,resume,history,prefix,get at(){return at;},set at(value:number){at=value;}};
}
type Fixture=ReturnType<typeof fixture>;
function inventoryMismatch(q:OperatingFinancialReadiness,at:number):Record<string,Mark>{
 q.positionUnits={'OFFLINE unowned mint':'1'};q.source.kind='complete-held-liquidation-context';
 return {'OFFLINE unowned mint':{at,evidence:'OFFLINE internally consistent mark for an unowned token',pricedBaseUnits:'1',netLamports:'1000'}};
}
function rewritePayload(f:Fixture,id:string,change:(payload:any)=>void){
 const row=f.db.prepare('SELECT kind,detail FROM journal WHERE action_id=?').get(id),payload=JSON.parse(row.detail);change(payload);
 f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(JSON.stringify(payload),id);
 f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run(createHash('sha256').update(JSON.stringify({kind:row.kind,payload})).digest('hex'),id);
}
function assertAuthenticReceipt(f:Fixture,id:string){
 const row=f.db.prepare('SELECT j.kind,j.detail,a.payload_hash FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.action_id=?').get(id);
 assert.equal(row.payload_hash,createHash('sha256').update(JSON.stringify({kind:row.kind,payload:JSON.parse(row.detail)})).digest('hex'));
}

test('authentic stale and future revision denials retain history and permit fresh ordinary startup recovery',async t=>{
 for(const reference of ['stale','future']as const)await t.test(reference,st=>{
  const f=fixture(st),q=f.proof();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);
  if(reference==='stale')f.reconcile();else q.stateRevision+=10;
  const before=f.ledger.state(),id='OFFLINE denied '+reference;
  assert.notEqual(q.stateRevision,before.revision);
  assert.deepEqual(f.resume(id,q),{enabled:false,reason:DENIED});assertAuthenticReceipt(f,id);
  const denied=f.ledger.state(),journal=f.history();
  assert.equal(denied.revision,before.revision+1,'denial is a retained action, not a permission grant');
  assert.deepEqual(denied.controls,before.controls);assert.equal(denied.controls.entriesEnabled,false);
  assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);
  f.startup();assert.equal(f.ledger.state().controls.reason,'execution startup: fresh reconciliation/readiness required');
  const started=f.ledger.state();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);assert.deepEqual(f.ledger.state(),started,'authority inspection is read-only');
  assert.equal(f.resume('OFFLINE fresh recovery').enabled,true);
  assert.deepEqual(f.prefix(denied.revision),journal,'every original denied request and control record remains intact');
  const after=f.ledger.state();assert.equal(after.lamports,before.lamports);assert.deepEqual(after.positions,before.positions);assert.deepEqual(after.pending,before.pending);
 });
});

test('a schema-valid denied inventory claim does not become an ownership assertion or permanent recovery barrier',t=>{
 const f=fixture(t),q=f.proof(),marks=inventoryMismatch(q,f.at),before=f.ledger.state();
 assert.deepEqual(f.resume('OFFLINE denied claimed inventory',q,marks),{enabled:false,reason:DENIED});
 assertAuthenticReceipt(f,'OFFLINE denied claimed inventory');assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().controls,before.controls);
 f.startup();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);assert.equal(f.resume('OFFLINE actual flat inventory recovery').enabled,true);
 assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});
});

test('denied revision receipts and later startup cannot erase owner stops, owner pauses or hard pauses',async t=>{
 for(const intent of ['owner stop','owner copied soft pause','unknown hard pause','protection pause']as const)await t.test(intent,st=>{
  const f=fixture(st);
  if(intent==='owner stop')f.ledger.safeStop('operator-stop:OFFLINE owner',f.at);
  else if(intent==='owner copied soft pause')f.ledger.pause('operator-pause:OFFLINE owner',f.at,'entry preparation or reconciliation unavailable');
  else f.pause(intent==='protection pause'?HARD:'OFFLINE unknown hard failure');
  const q=f.proof();f.reconcile();assert.deepEqual(f.resume('OFFLINE denied stale after intent',q),{enabled:false,reason:DENIED});
  const before=f.ledger.state(),journal=f.history();f.startup();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
  assert.equal(f.resume('OFFLINE no intent laundering').enabled,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
  assert.deepEqual(f.prefix(before.revision),journal);assert.equal(f.ledger.state().lamports,before.lamports);
  f.ledger.safeStop('native-paper-stop:'+RUN,f.at);assert.equal(f.ledger.internalShutdownRecoveryProof([RUN],f.at).verified,false);
 });
});

test('both history readers retain exact successful permission revision binding',async t=>{
 for(const change of [-1,1])await t.test(String(change),st=>{
  const f=fixture(st),id='OFFLINE successful anchor';assert.equal(f.resume(id).enabled,true);
  rewritePayload(f,id,p=>{p.readiness.stateRevision+=change;});assertAuthenticReceipt(f,id);
  f.pause();f.startup();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
  assert.equal(f.resume('OFFLINE no altered grant').enabled,false);
  f.ledger.safeStop('native-paper-stop:'+RUN,f.at);
  assert.deepEqual(f.ledger.internalShutdownRecoveryProof([RUN],f.at),{verified:false,reason:'INTERNAL_SHUTDOWN_HISTORY_MALFORMED'});
 });
});

test('denied receipt validation still rejects malformed, unauthenticated or invented input and results',async t=>{
 const faults=['bad hash','missing action','bad JSON','foreign account','negative revision','noninteger revision','clock binding','mark binding','unknown reason','extra result field','nonboolean result','forged success']as const;
 for(const fault of faults)await t.test(fault,st=>{
  const f=fixture(st),id='OFFLINE damaged denied receipt',q=f.proof(),marks=inventoryMismatch(q,f.at);f.reconcile();
  assert.deepEqual(f.resume(id,q,marks),{enabled:false,reason:DENIED});
  if(fault==='bad hash')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),id);
  if(fault==='missing action')f.db.prepare('DELETE FROM actions WHERE id=?').run(id);
  if(fault==='bad JSON')f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run('{',id);
  if(fault==='foreign account')rewritePayload(f,id,p=>{p.readiness.accountId='OFFLINE foreign';});
  if(fault==='negative revision')rewritePayload(f,id,p=>{p.readiness.stateRevision=-1;});
  if(fault==='noninteger revision')rewritePayload(f,id,p=>{p.readiness.stateRevision=2.5;});
  if(fault==='clock binding')rewritePayload(f,id,p=>{p.readiness.source.validUntil++;});
  if(fault==='mark binding')rewritePayload(f,id,p=>{p.marks['OFFLINE unowned mint'].pricedBaseUnits='2';});
  if(fault==='unknown reason')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled:false,reason:'OFFLINE fabricated denial'}),id);
  if(fault==='extra result field')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled:false,reason:DENIED,ignore:true}),id);
  if(fault==='nonboolean result')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled:0,reason:DENIED}),id);
  if(fault==='forged success')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled:true,reason:'explicit verified operating financial readiness'}),id);
  f.startup();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);assert.equal(f.resume('OFFLINE corruption remains closed').enabled,false);
  f.ledger.safeStop('native-paper-stop:'+RUN,f.at);
  assert.deepEqual(f.ledger.internalShutdownRecoveryProof([RUN],f.at),{verified:false,reason:'INTERNAL_SHUTDOWN_HISTORY_MALFORMED'});
 });
});

function technicalFixture(t:TestContext){
 const f=fixture(t);assert.equal(f.resume('OFFLINE initial permission').enabled,true);f.at+=1000;f.pause(HARD);const origin=f.at;
 f.at=origin+60000;f.reconcile();
 const proof=()=>{
  const authority=f.ledger.technicalProtectionRecoveryAuthority(f.at);assert.equal(authority.verified,true);if(!authority.verified)throw Error('OFFLINE authority unavailable');
  const q=f.proof();q.technicalProtectionRecovery={version:'paper-technical-protection-recovery-v1',authoritySha256:authority.authoritySha256,originRevision:authority.originRevision,accountId:authority.accountId,inceptionAt:authority.inceptionAt,stateRevision:authority.stateRevision,controlChangedAt:authority.controlChangedAt,controlReason:authority.controlReason,positionUnits:{},startedAt:origin,completedAt:f.at,completedEvaluations:31,maximumCompletedGapMs:2000,lastQuoteAt:f.price().at};return q;
 };
 return {f,proof};
}

test('denied stale or wrong-authority technical proofs retain the hard pause until a fresh valid sustained proof',async t=>{
 for(const fault of ['stale revision','wrong authority']as const)await t.test(fault,st=>{
  const {f,proof}=technicalFixture(st),q=proof(),before=f.ledger.state();
  if(fault==='stale revision')f.reconcile();else q.technicalProtectionRecovery!.authoritySha256='0'.repeat(64);
  assert.deepEqual(f.resume('OFFLINE denied technical request',q),{enabled:false,reason:DENIED});assertAuthenticReceipt(f,'OFFLINE denied technical request');
  assert.deepEqual(f.ledger.state().controls,before.controls);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
  assert.equal(f.ledger.technicalProtectionRecoveryAuthority(f.at).verified,true,'denial does not corrupt the original technical authority');
  assert.equal(f.resume('OFFLINE ordinary proof cannot waive hard pause').enabled,false);assert.equal(f.ledger.state().controls.reason,HARD);
  const retained=f.ledger.state(),journal=f.history();assert.equal(f.resume('OFFLINE fresh measured technical recovery',proof()).enabled,true);
  assert.deepEqual(f.prefix(retained.revision),journal);assert.equal(f.ledger.state().lamports,before.lamports);assert.deepEqual(f.ledger.state().positions,{});
 });
});

test('denied technical receipts still require internal revision, account and inventory bindings',async t=>{
 for(const binding of ['revision','account','inventory']as const)await t.test(binding,st=>{
  const f=fixture(st),id='OFFLINE denied technical receipt';f.at+=60000;f.reconcile();const q=f.proof();
  // Internally complete input can still lack actual technical authority. The
  // writer records that denial; no real hard pause can hide a later schema fault.
  q.technicalProtectionRecovery={version:'paper-technical-protection-recovery-v1',authoritySha256:'0'.repeat(64),originRevision:0,accountId:q.accountId,inceptionAt:AT,stateRevision:q.stateRevision,controlChangedAt:AT,controlReason:HARD,positionUnits:{},startedAt:AT,completedAt:f.at,completedEvaluations:31,maximumCompletedGapMs:2000,lastQuoteAt:f.price().at};
  assert.equal(f.resume(id,q).enabled,false);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);
  rewritePayload(f,id,p=>{const technical=p.readiness.technicalProtectionRecovery;if(binding==='revision')technical.stateRevision++;if(binding==='account')technical.accountId='OFFLINE foreign';if(binding==='inventory')technical.positionUnits={'OFFLINE unknown':'1'};});
  assertAuthenticReceipt(f,id);assert.equal(f.ledger.technicalProtectionRecoveryAuthority(f.at).verified,false);
  f.startup();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
  f.ledger.safeStop('native-paper-stop:'+RUN,f.at);assert.deepEqual(f.ledger.internalShutdownRecoveryProof([RUN],f.at),{verified:false,reason:'INTERNAL_SHUTDOWN_HISTORY_MALFORMED'});
 });
});

test('internal shutdown proof validates denied financial requests without clearing the raw stop or changing its anchor',async t=>{
 for(const mismatch of ['stale revision','future revision','inventory']as const)await t.test(mismatch,st=>{
  const f=fixture(st);assert.equal(f.resume('OFFLINE successful financial anchor').enabled,true);const anchor=f.ledger.state().revision;
  f.ledger.safeStop('native-paper-stop:'+RUN,f.at);const q=f.proof();let marks:Record<string,Mark>={};
  if(mismatch==='stale revision')f.reconcile();if(mismatch==='future revision')q.stateRevision+=10;if(mismatch==='inventory')marks=inventoryMismatch(q,f.at);
  assert.deepEqual(f.resume('OFFLINE denied while internally stopped',q,marks),{enabled:false,reason:DENIED});f.startup();
  const state=f.ledger.state(),journal=f.history(),result=f.ledger.internalShutdownRecoveryProof([RUN],f.at);
  assert.equal(result.verified,true);if(!result.verified)throw Error('OFFLINE internal shutdown proof absent');
  assert.equal(result.lastSuccessfulResumeRevision,anchor);assert.equal(result.stops.length,1);assert.equal(result.stops[0]!.actionId,'native-paper-stop:'+RUN);
  assert.deepEqual(f.ledger.state(),state);assert.deepEqual(f.history(),journal);assert.equal(state.controls.stopRequested,true);assert.equal(state.controls.entriesEnabled,false);
 });
});
