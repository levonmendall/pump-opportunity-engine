/** OFFLINE DISPOSABLE ledger provenance. No live account, provider, runtime
 * control, automatic resume or financial-history rewrite is performed. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';

const AT=Date.parse('2026-10-26T12:00:00.000Z');
const run=(at:number)=>'native-paper-'+new Date(at).toISOString().replace(/[^0-9]/g,'');
const price=(at:number):UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE internal shutdown provenance USD'});
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-shutdown-proof-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-internal-shutdown');let at=AT;
 ledger.initialize(price(at),at);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const resume=(id='fixture-successful-resume')=>ledger.resume(id,at,price(at),{},{version:'DISPOSABLE verified runtime fixture',evidence:'OFFLINE only, no market claim',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 const reconcile=()=>ledger.reconcile('fixture-reconcile:'+ledger.state().revision,at,price(at),{});
 const pause=(reason:string,restored=false)=>ledger.pause(`trader:${restored?'restore-hard-pause':'pause'}:${ledger.state().revision}:${at}`,at,reason);
 const startup=()=>ledger.pause(`execution-recovery:${ledger.accountId}:${ledger.state().revision}`,at,'execution startup: fresh reconciliation/readiness required');
 const stop=(id:string,finallyStop=false)=>ledger.safeStop(`native-paper-${finallyStop?'finally':'stop'}:${id}`,at);
 const proof=(ids:readonly string[])=>{const before=JSON.stringify(ledger.state()),journal=JSON.stringify(ledger.exportJournal(1000)),outcome=ledger.internalShutdownRecoveryProof(ids,at);assert.equal(JSON.stringify(ledger.state()),before,'proof cannot change a financial/control field');assert.equal(JSON.stringify(ledger.exportJournal(1000)),journal,'proof cannot append or rewrite history');return outcome;};
 return{ledger,resume,reconcile,pause,startup,stop,proof,get at(){return at;},set at(value:number){at=value;}};
}

test('all internal stop/finally intents survive many later one-second reconciliations and do not clear the raw stop',t=>{
 const f=fixture(t),a=run(AT),b=run(AT+1000);f.reconcile();assert.equal(f.resume().enabled,true);const anchor=f.ledger.state().revision;
 f.at+=100;f.pause('graceful native PAPER segment ended; exposure retained');f.stop(a);f.at++;f.pause('native PAPER process closing; obligations retained');f.stop(a,true);
 f.at+=1000;f.startup();f.pause('safe stop requested',true);f.at++;f.pause('entry preparation or reconciliation unavailable');f.stop(b);f.at++;f.stop(b,true);
 for(let n=0;n<700;n++){f.at+=1000;f.reconcile();}
 f.startup();f.pause('safe stop requested',true);const state=f.ledger.state(),result=f.proof([a,b]);assert.equal(result.verified,true);
 if(!result.verified)throw Error('proof absent');assert.equal(result.accountId,state.accountId);assert.equal(result.inceptionAt,AT);assert.equal(result.stateRevision,state.revision);assert.equal(result.lastSuccessfulResumeRevision,anchor);assert.equal(result.stops.length,4);assert.match(result.proofSha256,/^[a-f0-9]{64}$/);assert.deepEqual(result.stops.map(s=>s.actionId),['native-paper-stop:'+a,'native-paper-finally:'+a,'native-paper-stop:'+b,'native-paper-finally:'+b]);assert.equal(f.proof([b,a]).verified,true);assert.equal(f.ledger.state().controls.stopRequested,true);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('a failed resume cannot hide an owner stop or become the successful recovery boundary',t=>{
 const f=fixture(t),a=run(AT);f.reconcile();f.resume();const anchor=f.ledger.state().revision;f.at+=100;f.ledger.safeStop('operator-stop:DISPOSABLE-owner-intent',f.at);f.at+=3000;assert.equal(f.resume('fixture-failed-resume').enabled,false);f.stop(a);f.startup();f.pause('safe stop requested',true);
 assert.deepEqual(f.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_OWNER_OR_UNKNOWN_STOP'});
 // The actual failed-resume result is retained, never reclassified as enabled.
 assert.equal((f.ledger.actionResult('fixture-failed-resume') as any).enabled,false);assert.ok(anchor<f.ledger.state().revision);
});

test('only the last successful resume is an anchor and a later failed resume does not discard internal stops',t=>{
 const f=fixture(t),a=run(AT);f.reconcile();f.resume('fixture-initial-resume');f.at+=100;f.stop(a);f.at+=3000;assert.equal(f.resume('fixture-failed-resume').enabled,false);
 const proof=f.proof([a]);assert.equal(proof.verified,true);if(!proof.verified)throw Error('proof absent');assert.equal(proof.lastSuccessfulResumeRevision,2);assert.equal(proof.stops.length,1);
 f.reconcile();assert.equal(f.resume('fixture-new-successful-resume').enabled,true);f.at++;f.stop(a,true);const newer=f.proof([a]);assert.equal(newer.verified,true);if(!newer.verified)throw Error('proof absent');assert.equal(newer.lastSuccessfulResumeRevision,f.ledger.state().revision-1);assert.equal(newer.stops.length,1);assert.equal(newer.stops[0]!.actionId,'native-paper-finally:'+a);
});

test('resume result reasons must match the exact durable success and failure outcomes',t=>{
 for(const enabled of [true,false]){
  const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;f.stop(a);let id='fixture-successful-resume';
  if(!enabled){f.at+=3000;id='fixture-failed-resume';assert.equal(f.resume(id).enabled,false);}
  // A syntactically valid result is still corrupt if it claims another reason.
  (f.ledger as any).db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled,reason:'DISPOSABLE forged but bounded reason'}),id);
  assert.deepEqual(f.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_HISTORY_MALFORMED'});
 }
});

test('absence of a successful resume uses validated inception and every control intention, never a bounded journal tail',t=>{
 const f=fixture(t),a=run(AT);f.at+=100;f.stop(a);for(let i=0;i<520;i++){f.at+=1000;f.reconcile();}f.startup();f.pause('safe stop requested',true);const result=f.proof([a]);assert.equal(result.verified,true);if(!result.verified)throw Error('proof absent');assert.equal(result.lastSuccessfulResumeRevision,0);assert.equal(result.stops.length,1);
});

test('owner, unknown-run and malformed-looking stop identities remain blocked even after an internal finally',t=>{
 for(const id of ['operator-stop:DISPOSABLE','native-paper-stop:'+run(AT+1),'native-paper-stop:'+run(AT)+':suffix','foreign-finally:'+run(AT)]){
  const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;f.ledger.safeStop(id,f.at);f.at++;f.stop(a,true);f.startup();f.pause('safe stop requested',true);assert.deepEqual(f.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_OWNER_OR_UNKNOWN_STOP'},id);
 }
});

test('hard or owner pause intent cannot be masked by later internal stops and restore markers',t=>{
 for(const reason of ['operator paused new entries','selected evidence unavailable; entries closed','financial action unresolved; entries closed and reservations preserved','financial maintenance unavailable; preserve records and close entries','financial reservation unavailable; preserve records and close entries','completed PAPER protection gap exceeded research boundary','unclassified runtime failure']){
  const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;f.pause(reason);f.stop(a);f.startup();f.pause('safe stop requested',true);assert.deepEqual(f.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_HARD_OR_UNKNOWN_PAUSE'},reason);
 }
 const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;f.ledger.pause('operator-pause:DISPOSABLE-spoofed-soft-reason',f.at,'entry preparation or reconciliation unavailable');f.stop(a);assert.equal(f.proof([a]).verified,false,'an owner/custom action ID cannot become internal merely by copying a soft reason');
});

test('restore-hard-pause with safe-stop wording requires an earlier already-proven internal stop',t=>{
 const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;f.pause('safe stop requested',true);f.stop(a);assert.deepEqual(f.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_HARD_OR_UNKNOWN_PAUSE'});
});

test('only typed temporary readiness and ordinary shutdown pauses are recoverable provenance',t=>{
 const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;for(const reason of ['current equity or liquidation unavailable; entries closed','current financial reconciliation unavailable; exposure retained','entry preparation or reconciliation unavailable','consistent backup unavailable; exposure retained','graceful native PAPER segment ended; exposure retained','native PAPER process closing; obligations retained','native PAPER routine checkpoint: fresh audited readiness required']){f.pause(reason);f.at++;}f.stop(a);assert.equal(f.proof([a]).verified,true);
});

test('unknown or invalid run sets and future/inconsistent source times fail closed',t=>{
 const f=fixture(t),a=run(AT);f.at+=100;f.stop(a);
 for(const ids of [[],[a,a],['native-paper-20261301120000000'],['native-paper-2026102612000000'],[run(AT+1000)],Array.from({length:129},(_,i)=>run(AT+i))])assert.equal(f.proof(ids).verified,false,JSON.stringify(ids));
 assert.deepEqual(f.ledger.internalShutdownRecoveryProof([a],f.at-1),{verified:false,reason:'INTERNAL_SHUTDOWN_PROOF_TIME'});
 const g=fixture(t),futureRun=run(AT+50);g.at+=1;g.stop(futureRun);g.at+=100;assert.deepEqual(g.proof([futureRun]),{verified:false,reason:'INTERNAL_SHUTDOWN_OWNER_OR_UNKNOWN_STOP'});
 const h=fixture(t);h.reconcile();assert.deepEqual(h.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_NOT_REQUESTED'});
});

test('more than128 stops or512 filtered control intentions are unavailable rather than silently truncated',t=>{
 const f=fixture(t),runs=Array.from({length:65},(_,i)=>run(AT+i));f.reconcile();f.resume();f.at+=1000;
 for(let i=0;i<129;i++){f.stop(runs[Math.floor(i/2)]!,i%2===1);f.at++;}assert.deepEqual(f.proof(runs),{verified:false,reason:'INTERNAL_SHUTDOWN_STOP_BOUND'});
 const g=fixture(t),a=run(AT);g.reconcile();g.resume();g.at+=100;g.stop(a);for(let i=0;i<512;i++){g.at++;g.pause('entry preparation or reconciliation unavailable');}assert.deepEqual(g.proof([a]),{verified:false,reason:'INTERNAL_SHUTDOWN_HISTORY_BOUND'});
});

test('malformed joined actions, payloads and current control state do not yield provenance proof',t=>{
 for(const fault of ['missing-action','bad-hash','bad-json','bad-stop-result','bad-successful-resume','bad-inception','wrong-last-control'] as const){
  const f=fixture(t),a=run(AT);f.reconcile();f.resume();f.at+=100;f.stop(a);const db=(f.ledger as any).db;
  // Explicit corruption injection into this disposable fixture's sole connection.
  const stop='native-paper-stop:'+a;
  if(fault==='missing-action')db.prepare('DELETE FROM actions WHERE id=?').run(stop);
  if(fault==='bad-hash')db.prepare("UPDATE actions SET payload_hash=? WHERE id=?").run('0'.repeat(64),stop);
  if(fault==='bad-json')db.prepare("UPDATE journal SET detail='{' WHERE action_id=?").run(stop);
  if(fault==='bad-stop-result')db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({safeToExit:true,state:'stopped-safe',openPositions:1,uncertainActions:0,canceledEntries:[]}),stop);
  if(fault==='bad-successful-resume')db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled:true,reason:null}),'fixture-successful-resume');
  if(fault==='bad-inception')db.prepare("UPDATE journal SET detail='{}' WHERE revision=0").run();
  if(fault==='wrong-last-control'){const state=f.ledger.state();db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify({...state,controls:{...state.controls,changedAt:AT}}));}
  assert.equal(f.proof([a]).verified,false,fault);
 }
});
