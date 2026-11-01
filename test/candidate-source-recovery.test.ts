/** Offline policy tests. No operating ledger or provider is opened. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sourceFinancialCallback,CANDIDATE_SOURCE_RECOVERY_PAUSE} from '../src/candidate-source-recovery.js';
import {REVIEWED_SOURCE_PAUSE as p,reviewedSourcePauseLineage,type ReviewedSourcePauseState} from '../src/reviewed-source-pause.js';
import type {ReviewedContentionHistory} from '../src/reviewed-market-contention.js';
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const state={accountId:p.accountId,inceptionAt:p.inceptionAt,mode:'PAPER',revision:p.pauseRevision,lastAt:p.pauseAt,lamports:p.cashLamports,paperEpoch:{id:p.epochId},equityRisk:{version:'paper-equity-risk-v3-no-daily-stop-v1'},positions:{},pending:{},lockedDeposits:Object.fromEntries(Array.from({length:9},(_,i)=>['OFFLINE-'+i,i===0?'13624552':'1'])),daily:{lossPaused:false,paused:true},controls:{entriesEnabled:false,stopRequested:false,changedAt:p.pauseAt,reasonSha256:p.pauseReasonSha256}} as unknown as ReviewedSourcePauseState;
 const history:ReviewedContentionHistory={anchor:{revision:p.anchorRevision,at:p.anchorAt,kind:'resume',actionSha256:p.anchorActionSha256},controls:[{revision:p.pauseRevision,at:p.pauseAt,actionSha256:p.pauseActionSha256,detailSha256:p.pauseDetailSha256,reasonSha256:p.pauseReasonSha256,ordinary:true,startup:false,restored:false,temporary:false,kind:'pause',paused:true,cancellations:0}]};return {state,history};
}
test('retained action fingerprint is the exact runtime pause, including its one-millisecond ID difference',()=>{
 assert.equal(sha('trader:pause:247899:1793560027962'),p.pauseActionSha256);
 assert.equal(sha('native-paper-operating-financial-ready:246831:1793558513312'),p.anchorActionSha256);
});
test('exact historical source quarantine is recognized read-only before replacement startup',()=>{
 const f=fixture(),before=structuredClone(f);assert.equal(reviewedSourcePauseLineage(f.state,f.history),true);assert.deepEqual(f,before);assert.equal(p.entryPermissionGranted,false);
});
test('subsequent authenticated startup or source-only pause retains history, never grants entry',()=>{
 for(const startup of [true,false]){
  const f=fixture(),at=p.pauseAt+1000,reason=startup?'execution startup: fresh reconciliation/readiness required':CANDIDATE_SOURCE_RECOVERY_PAUSE;
  f.history.controls.push({...f.history.controls[0]!,revision:p.pauseRevision+10,at,actionSha256:sha('OFFLINE-authenticated-control'),detailSha256:sha('OFFLINE-detail'),reasonSha256:sha(reason),ordinary:!startup,startup,restored:false,temporary:true});
  f.state.revision+=10;f.state.controls.changedAt=at;f.state.controls.reasonSha256=sha(reason);
  assert.equal(reviewedSourcePauseLineage(f.state,f.history),true);assert.equal(f.state.controls.entriesEnabled,false);
 }
});
const mutations:Array<[string,(f:ReturnType<typeof fixture>)=>void]>=[
 ['account',f=>{f.state.accountId='other';}],['inception',f=>{f.state.inceptionAt++;}],['mode',f=>{(f.state as any).mode='LIVE';}],
 ['cash',f=>{f.state.lamports='1';}],['deposit missing',f=>{delete f.state.lockedDeposits['OFFLINE-0'];}],['deposit amount',f=>{f.state.lockedDeposits['OFFLINE-0']='1';}],
 ['holding',f=>{(f.state.positions as any).x={};}],['pending',f=>{(f.state.pending as any).x={};}],['owner stop',f=>{f.state.controls.stopRequested=true;}],
 ['daily loss',f=>{f.state.daily.lossPaused=true;}],['already enabled',f=>{f.state.controls.entriesEnabled=true;}],['epoch',f=>{(f.state.paperEpoch! as any).id='other';}],
 ['anchor revision',f=>{f.history.anchor!.revision++;}],['anchor time',f=>{f.history.anchor!.at++;}],['anchor identity',f=>{f.history.anchor!.actionSha256='0'.repeat(64);}],
 ['pause revision',f=>{f.history.controls[0]!.revision++;}],['pause time',f=>{f.history.controls[0]!.at++;}],['pause action',f=>{f.history.controls[0]!.actionSha256='0'.repeat(64);}],
 ['pause payload',f=>{f.history.controls[0]!.detailSha256='0'.repeat(64);}],['pause reason',f=>{f.history.controls[0]!.reasonSha256='0'.repeat(64);}],
 ['financial cancellation',f=>{f.history.controls[0]!.cancellations=1;}],['owner instead of runtime',f=>{f.history.controls[0]!.ordinary=false;}],
 ['current control mismatch',f=>{f.state.controls.reasonSha256='0'.repeat(64);}],['current timestamp mismatch',f=>{f.state.controls.changedAt++;}],
 ['new ordinary hard failure',f=>{const x={...f.history.controls[0]!,revision:p.pauseRevision+1,at:p.pauseAt+1};f.history.controls.push(x);f.state.revision++;f.state.controls.changedAt++;}],
 ['unpaired restored failure',f=>{const x={...f.history.controls[0]!,revision:p.pauseRevision+1,at:p.pauseAt+1,ordinary:false,restored:true};f.history.controls.push(x);f.state.revision++;f.state.controls.changedAt++;}],
];
for(const [name,mutate]of mutations)test('reviewed quarantine refuses '+name,()=>{const f=fixture();mutate(f);assert.equal(reviewedSourcePauseLineage(f.state,f.history),false);});
test('financial callback errors latch separately and preserve the original exception even when failure recording throws',()=>{
 const original=Error('OFFLINE possible financial outcome'),secondary=Error('OFFLINE recording failure');let latched=false;
 assert.throws(()=>sourceFinancialCallback(()=>{throw original;},error=>{assert.equal(error,original);latched=true;throw secondary;}),e=>e===original);
 assert.equal(latched,true);assert.equal(sourceFinancialCallback(()=>42,()=>{throw Error('unexpected');}),42);
});
test('source recovery path uses typed pause and contains every synchronous financial callback',()=>{
 const source=readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8');
 assert.ok(source.includes('currentBridge.trader.pauseNewEntries(CANDIDATE_SOURCE_RECOVERY_PAUSE)'));
 assert.equal(source.includes("pauseNewEntries(reason+'; exposure retained')"),false);
 for(const method of ['gap','trade','protocol','opened','currentPoolValidated'])assert.ok(source.includes('financialSourceCallback(()=>bridge?.'+method+'(row))'),method);
 assert.ok(source.includes('financialSourceCallback(()=>currentBridge.allocated(row))'));
 assert.ok(source.includes('financialSourceCallback(()=>currentBridge.retiredCandidate(row,reason))'));
 assert.ok(source.includes("financialMaintenanceFailed('runtime-failure',error)"));
});
