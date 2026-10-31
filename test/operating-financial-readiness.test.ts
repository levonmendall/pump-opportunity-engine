/** OFFLINE disposable accounting only; no operating account, provider, control
 * socket, synthetic publication or financial-history reset. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {DisposableLedger,OPERATING_FINANCIAL_READINESS_VERSION,type OperatingFinancialReadiness,type UsdPrice,type Mark,type TechnicalProtectionRecoveryProof} from '../src/ledger.js';
const AT=Date.parse('2026-10-29T01:00:00Z'),run='native-paper-20261029010000000';
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-financial-readiness-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-operating-financial-readiness');let at=AT;
 const price=():UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE explicit USD'});ledger.initialize(price(),at);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const reconcile=(marks:Record<string,Mark>={})=>ledger.reconcile('OFFLINE reconcile:'+ledger.state().revision,at,price(),marks);
 const pause=(reason='current equity or liquidation unavailable; entries closed')=>ledger.pause('trader:pause:'+ledger.state().revision+':'+at,at,reason);
 const proof=(units:Record<string,string>={}):OperatingFinancialReadiness=>({version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE financially complete inventory; no candidate window or trading qualification',accountId:ledger.accountId,stateRevision:ledger.state().revision,reconciledAt:ledger.state().daily.reconciledAt,positionUnits:units,source:{kind:Object.keys(units).length?'complete-held-liquidation-context':'selected-native-support',bankClockAt:AT,receivedAt:at,validUntil:AT+30000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true});
 return {ledger,price,reconcile,pause,proof,get at(){return at;},set at(value:number){at=value;}};
}

test('new versioned financial-only permission preserves account/history and asserts no candidate window',t=>{
 const f=fixture(t);f.reconcile();f.pause();const before=f.ledger.state(),proof=f.proof();assert.equal(Object.hasOwn(proof,'candidateWindowsReady'),false);assert.equal(Object.hasOwn(proof,'marketAt'),false);
 assert.deepEqual(f.ledger.resume('OFFLINE financial resume',f.at,f.price(),{},proof),{enabled:true,reason:'explicit verified operating financial readiness'});
 const after=f.ledger.state();assert.equal(after.controls.readinessVersion,OPERATING_FINANCIAL_READINESS_VERSION);assert.equal(after.controls.entriesEnabled,true);assert.equal(after.lamports,before.lamports);assert.equal(after.initialMicroUsd,before.initialMicroUsd);assert.equal(after.inceptionAt,before.inceptionAt);assert.equal(after.realizedLamports,before.realizedLamports);assert.deepEqual(after.positions,{});assert.deepEqual(after.pending,{});
 assert.equal(f.ledger.exportJournal(100).filter(x=>(x as any).kind==='inception').length,1);
});

function deniedReadinessHistory(t:TestContext,ownerPause=false){
 const f=fixture(t);f.reconcile();
 assert.equal(f.ledger.resume('OFFLINE initial permission',f.at,f.price(),{},{version:'OFFLINE legacy readiness',evidence:'OFFLINE complete initial finance',marketAt:f.at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);
 f.at+=3001;
 if(ownerPause)f.ledger.pause('operator-pause:OFFLINE-buried-intent',f.at,'operator paused new entries');
 f.pause();const controls=structuredClone(f.ledger.state().controls);
 for(let i=0;i<600;i++)assert.equal(f.ledger.resume('OFFLINE denied readiness '+i,f.at,f.price(),{},{version:'OFFLINE legacy readiness',evidence:'OFFLINE current market while financial reconciliation is stale',marketAt:f.at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,false);
 assert.deepEqual(f.ledger.state().controls,controls);f.reconcile();return f;
}

test('more than512 authenticated denied readiness attempts cannot permanently exhaust the control-intent projection',t=>{
 const f=deniedReadinessHistory(t),before=f.ledger.state(),db=(f.ledger as any).db,history=db.prepare('SELECT * FROM journal ORDER BY revision').all();
 assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);
 assert.deepEqual(f.ledger.state(),before,'control preflight is read-only');
 assert.equal(f.ledger.resume('OFFLINE recovered after denied attempts',f.at,f.price(),{},f.proof()).enabled,true);
 assert.deepEqual(db.prepare('SELECT * FROM journal WHERE revision<=? ORDER BY revision').all(before.revision),history,'all original denied receipts and financial history are retained');
 assert.equal(f.ledger.state().lamports,before.lamports);assert.deepEqual(f.ledger.state().positions,before.positions);assert.deepEqual(f.ledger.state().pending,before.pending);
});

test('streaming denied receipts still authenticates each record and preserves buried owner intent',async t=>{
 for(const fault of ['owner-pause','bad-denied-hash','missing-denied-action','bad-denied-result'])await t.test(fault,st=>{
  const f=deniedReadinessHistory(st,fault==='owner-pause'),db=(f.ledger as any).db,id='OFFLINE denied readiness 17';
  if(fault==='bad-denied-hash')db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),id);
  if(fault==='missing-denied-action')db.prepare('DELETE FROM actions WHERE id=?').run(id);
  if(fault==='bad-denied-result')db.prepare('UPDATE actions SET result=? WHERE id=?').run('{',id);
  const before=f.ledger.state();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
  assert.equal(f.ledger.resume('OFFLINE no control laundering after long history',f.at,f.price(),{},f.proof()).enabled,false);
  assert.deepEqual(f.ledger.state().controls,before.controls);assert.equal(f.ledger.state().lamports,before.lamports);
 });
});

test('operating readiness cannot clear owner stop, owner pause, unknown or protection hard controls',async t=>{
 for(const control of ['operator paused new entries','completed PAPER protection gap exceeded research boundary','PAPER protection currently overdue; candidate admissions closed','unknown hard failure','STOP'])await t.test(control,st=>{
  const f=fixture(st);f.reconcile();if(control==='STOP')f.ledger.safeStop('OFFLINE owner stop',f.at);else f.pause(control);const before=f.ledger.state();
  assert.equal(f.ledger.resume('OFFLINE attempted financial resume',f.at,f.price(),{},f.proof()).enabled,false);
  assert.deepEqual(f.ledger.state().controls,before.controls);assert.equal(f.ledger.state().daily.paused,true);
 });
});

test('current-day loss latch is never reset by operating financial readiness',t=>{
 const f=fixture(t);f.reconcile();f.pause();f.at++;f.ledger.reconcile('OFFLINE actual loss',f.at,{...f.price(),microUsdPerSol:'90000000'},{});assert.equal(f.ledger.state().daily.lossPaused,true);const proof=f.proof();
 assert.equal(f.ledger.resume('OFFLINE no loss waiver',f.at,{...f.price(),microUsdPerSol:'90000000'},{},proof).enabled,false);assert.equal(f.ledger.state().daily.lossPaused,true);
});

test('malformed, stale and foreign financial permission proofs fail closed before any control change',async t=>{
 const changes:Array<[string,(q:any)=>void]>=[['version',q=>q.version='invented'],['candidate assertion',q=>q.candidateWindowsReady=true],['purpose',q=>q.purpose='candidate-qualified'],['foreign account',q=>q.accountId='foreign'],['stale reconciliation',q=>q.reconciledAt=AT-2001],['future reconciliation',q=>q.reconciledAt=AT+1],['missing inventory',q=>delete q.positionUnits],['future clock',q=>q.source.bankClockAt=AT+1],['clock expiry mismatch',q=>q.source.validUntil++],['unknown source',q=>q.source.kind='notification'],['future receive',q=>q.source.receivedAt=AT+1],['unready inventory',q=>q.financialInventoryReady=false],['no reserve',q=>q.budgetAvailable=false]];
 for(const [label,change]of changes)await t.test(label,st=>{const f=fixture(st);f.reconcile();f.pause();const before=f.ledger.state(),q=f.proof();change(q);assert.throws(()=>f.ledger.resume('OFFLINE malformed',f.at,f.price(),{},q));assert.deepEqual(f.ledger.state(),before);});
});

test('same-writer revision, exact inventory and no-pending checks refuse outdated accounting without enabling entries',async t=>{
 for(const changed of ['revision','inventory','pending'])await t.test(changed,st=>{
  const f=fixture(st);f.reconcile();f.pause();const q=f.proof();
  if(changed==='revision')q.stateRevision--;
  if(changed==='inventory')q.positionUnits={foreign:'1'};
  if(changed==='pending'){
   // A retained sell action cannot be fabricated without a position; use an
   // existing legitimate reserved buy before pausing the disposable ledger.
   f.ledger.resume('OFFLINE ordinary permission',f.at,f.price(),{},{version:'OFFLINE old schema',evidence:'OFFLINE only',marketAt:f.at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
   f.ledger.order({id:'OFFLINE pending buy',mint:'OFFLINE mint',side:'buy',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1',decisionEvidence:'OFFLINE legitimate action'},f.price(),{});f.pause();Object.assign(q,f.proof());
  }
  try{assert.equal(f.ledger.resume('OFFLINE outdated inventory',f.at,f.price(),{},q).enabled,false);}catch{}assert.equal(f.ledger.state().controls.entriesEnabled,false);
 });
});

test('strict control-history proof accepts the new financial receipt alongside unchanged legacy receipts',t=>{
 const f=fixture(t);f.reconcile();f.pause();assert.equal(f.ledger.resume('OFFLINE financial anchor',f.at,f.price(),{},f.proof()).enabled,true);const anchor=f.ledger.state().revision;
 f.at+=100;f.ledger.safeStop('native-paper-stop:'+run,f.at);const result=f.ledger.internalShutdownRecoveryProof([run],f.at);assert.equal(result.verified,true);if(!result.verified)throw Error('proof absent');assert.equal(result.lastSuccessfulResumeRevision,anchor);assert.equal(result.stops.length,1);
});


test('an owner/custom action cannot become automatic recovery merely by copying a recognized temporary reason',t=>{
 const f=fixture(t);f.reconcile();f.ledger.pause('operator-pause:OFFLINE-custom-owner',f.at,'entry preparation or reconciliation unavailable');const before=f.ledger.state();assert.equal(f.ledger.resume('OFFLINE no copied-reason laundering',f.at,f.price(),{},f.proof()).enabled,false);assert.deepEqual(f.ledger.state().controls,before.controls);
});

test('malformed joined temporary-control evidence cannot grant operating financial permission',async t=>{
 for(const fault of ['bad-hash','missing-action','bad-json'])await t.test(fault,st=>{
  const f=fixture(st);f.reconcile();f.pause();const before=f.ledger.state(),db=(f.ledger as any).db,id='trader:pause:'+(before.revision-1)+':'+f.at;
  if(fault==='bad-hash')db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),id);
  if(fault==='missing-action')db.prepare('DELETE FROM actions WHERE id=?').run(id);
  if(fault==='bad-json')db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run('{',id);
  assert.equal(f.ledger.resume('OFFLINE preserve malformed control stop',f.at,f.price(),{},f.proof()).enabled,false);assert.deepEqual(f.ledger.state().controls,before.controls);
 });
});


function technicalFixture(t:TestContext){const f=fixture(t);f.reconcile();f.pause();assert.equal(f.ledger.resume('OFFLINE pre-failure permission',f.at,f.price(),{},f.proof()).enabled,true);f.at+=1000;f.pause('completed PAPER protection gap exceeded research boundary');const origin=f.at;return {f,origin,proof:()=>{const authority=f.ledger.technicalProtectionRecoveryAuthority(f.at);assert.equal(authority.verified,true);if(!authority.verified)throw Error('OFFLINE authority absent');const q=f.proof();q.source={kind:'selected-native-support',bankClockAt:f.at,receivedAt:f.at,validUntil:f.at+30000};q.technicalProtectionRecovery={version:'paper-technical-protection-recovery-v1',authoritySha256:authority.authoritySha256,originRevision:authority.originRevision,accountId:authority.accountId,inceptionAt:authority.inceptionAt,stateRevision:authority.stateRevision,controlChangedAt:authority.controlChangedAt,controlReason:authority.controlReason,positionUnits:{},startedAt:origin,completedAt:f.at,completedEvaluations:31,maximumCompletedGapMs:2000,lastQuoteAt:f.price().at};return q;}};}

test('technical recovery requires separate versioned sustained evidence and retains original failure history',t=>{
 const {f,origin,proof}=technicalFixture(t),first=f.ledger.technicalProtectionRecoveryAuthority(f.at);assert.equal(first.verified,true);f.at=origin+60000;f.reconcile();const authority=f.ledger.technicalProtectionRecoveryAuthority(f.at);assert.equal(authority.verified,true);if(!first.verified||!authority.verified)throw Error('OFFLINE authority absent');assert.equal(first.authoritySha256,authority.authoritySha256,'ordinary financial revisions cannot restart or forge the control interval');assert.notEqual(first.stateRevision,authority.stateRevision);
 const q=proof();assert.equal(f.ledger.resume('OFFLINE validated sustained recovery',f.at,f.price(),{},q).enabled,true);assert.equal(f.ledger.state().controls.reason,'explicit verified operating financial readiness');assert.ok(f.ledger.exportJournal(100).some(x=>(x as any).kind==='pause'&&(x as any).detail.includes('completed PAPER protection gap')));assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});
});

test('technical proof cannot waive missing duration, breaches, stale or fabricated quotes, changed control or inventory',async t=>{
 const faults:Array<[string,(p:TechnicalProtectionRecoveryProof)=>void]>=[['short duration',p=>p.startedAt++],['gap',p=>p.maximumCompletedGapMs=4001],['impossible count',p=>p.completedEvaluations=2],['future completion',p=>p.completedAt++],['old quote',p=>p.lastQuoteAt-=2001],['renamed authority',p=>p.authoritySha256='0'.repeat(64)],['changed revision',p=>p.stateRevision--],['changed origin',p=>p.originRevision--],['foreign account',p=>p.accountId='fixture-foreign'],['fabricated quote',p=>p.lastQuoteAt--],['missing holding',p=>p.positionUnits={unknown:'1'}]];
 for(const [name,mutate]of faults)await t.test(name,st=>{const {f,origin,proof}=technicalFixture(st);f.at=origin+60000;f.reconcile();const q=proof();mutate(q.technicalProtectionRecovery!);const before=f.ledger.state();try{assert.equal(f.ledger.resume('OFFLINE reject invalid protection proof',f.at,f.price(),{},q).enabled,false);}catch{}assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.ledger.state().controls.reason,before.controls.reason);});
});

test('technical authority rejects owner/custom and unknown control intentions even when current wording copies a protection reason',async t=>{
 for(const kind of ['owner technical wording','owner before technical','unknown hard before technical','safe stop'])await t.test(kind,st=>{
  const {f}=technicalFixture(st);if(kind==='owner technical wording')f.ledger.pause('operator-pause:OFFLINE-intent',f.at,'completed PAPER protection gap exceeded research boundary');
  if(kind==='owner before technical'){f.ledger.pause('operator-pause:OFFLINE-owner',f.at,'operator paused new entries');f.pause('completed PAPER protection gap exceeded research boundary');}
  if(kind==='unknown hard before technical'){f.pause('unknown financial safety failure');f.pause('completed PAPER protection gap exceeded research boundary');}
  if(kind==='safe stop')f.ledger.safeStop('operator-stop:OFFLINE-owner',f.at);
  assert.equal(f.ledger.technicalProtectionRecoveryAuthority(f.at).verified,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
 });
});


test('copied owner soft wording cannot be laundered by execution recovery startup or a later ordinary soft pause',async t=>{
 for(const later of ['startup','startup then ordinary']as const)await t.test(later,st=>{
  const f=fixture(st);f.reconcile();f.ledger.pause('operator-pause:OFFLINE-owner-copied-soft',f.at,'entry preparation or reconciliation unavailable');
  const execution=new PaperExecutionCoordinator({ledger:f.ledger,now:()=>f.at,context:async()=>({price:f.price(),marks:{}}),quote:async()=>null});execution.recover();if(later==='startup then ordinary')f.pause();f.reconcile();
  assert.equal(f.ledger.resume('OFFLINE copied owner must remain closed',f.at,f.price(),{},f.proof()).enabled,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
 });
});
