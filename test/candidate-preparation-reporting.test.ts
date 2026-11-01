import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectCandidatePreparationReporting,validateCandidatePreparationReporting} from '../src/candidate-preparation-reporting.js';

const T=Date.parse('2026-11-01T21:00:00.000Z'),MINT='11111111111111111111111111111111';
function raw(){return {version:'native-candidate-preparation-v1',scope:'CURRENT_SOURCE_INSTANCE',sourceInstanceId:'native-runner:test-run:instance',runId:'test-run',startedAt:T-600000,generatedAt:T,state:'awaiting-market-evidence',currentMint:null,
 counters:{attempts:4,poolReady:1,poolAbsent:3,poolUnsupported:0,providerUnavailable:0,allocationsFromPrepared:1},
 lastOutcome:{mint:MINT,pool:MINT,at:T-1000,reason:'NATIVE_OBSERVATION_POOL_MISSING',stage:'pool-validation'},
 progress:{lastAcknowledgedAt:null,lastAuditedAt:null,unproductiveSinceAt:T-100000,serviceableSinceAt:T-99000,lastAttemptAt:T-1000,attemptsSinceProgress:4}};}

test('preparation projection preserves source-local outcomes and real progress timestamps',()=>{
 const source=raw(),before=structuredClone(source),p=projectCandidatePreparationReporting({candidatePreparation:source},T)!;
 assert.ok(p);assert.equal(p.lastOutcome!.reason,'NATIVE_OBSERVATION_POOL_MISSING');assert.equal(p.counters.poolAbsent,3);
 assert.equal(p.progress.serviceableSinceAt,new Date(T-99000).toISOString());assert.equal(p.progress.lastAcknowledgedAt,null);
 assert.deepEqual(validateCandidatePreparationReporting(p,T),p);assert.deepEqual(source,before);
});

test('older sources without preparation evidence retain absence rather than fabricated zero counts',()=>{
 assert.equal(projectCandidatePreparationReporting({},T),undefined);
 assert.equal(projectCandidatePreparationReporting({candidatePreparation:{version:'unknown'}},T),undefined);
});

test('malformed, mixed-generation and future preparation evidence cannot enter reporting',()=>{
 const cases:Array<(r:any)=>void>=[r=>r.runId='other-run',r=>r.generatedAt=T+1,r=>r.progress.lastAcknowledgedAt=T+1,
  r=>r.progress.serviceableSinceAt=T+1,r=>r.progress.unproductiveSinceAt=null,r=>r.progress.attemptsSinceProgress=-1,
  r=>r.progress.lastAttemptAt=T-200000,r=>r.counters.poolAbsent=NaN,r=>r.state='connected',
  r=>r.lastOutcome.reason='https://provider.invalid/PRIVATE',r=>r.lastOutcome.stage='unknown'];
 for(const mutate of cases){const r=raw();mutate(r);assert.equal(projectCandidatePreparationReporting({candidatePreparation:r},T),undefined);}
});

test('a completed acknowledgement clears unsuccessful-work tracking without inventing an audit',()=>{
 const r=raw();r.progress={lastAcknowledgedAt:T-1000,lastAuditedAt:null,unproductiveSinceAt:null,serviceableSinceAt:null,lastAttemptAt:T-2000,attemptsSinceProgress:0} as any;
 const p=projectCandidatePreparationReporting({candidatePreparation:r},T)!;assert.ok(p);
 assert.equal(p.progress.lastAcknowledgedAt,new Date(T-1000).toISOString());assert.equal(p.progress.lastAuditedAt,null);
 assert.equal(p.progress.attemptsSinceProgress,0);assert.equal(p.progress.serviceableSinceAt,null);
});

test('received preparation reports reject undeclared claims and chronological conflicts',()=>{
 const p=projectCandidatePreparationReporting({candidatePreparation:raw()},T)!;
 assert.throws(()=>validateCandidatePreparationReporting({...p,financialPermission:true},T),/CANDIDATE_PREPARATION/);
 const bad=structuredClone(p);bad.progress.lastAuditedAt=new Date(T-500).toISOString();
 assert.throws(()=>validateCandidatePreparationReporting(bad,T),/CANDIDATE_PREPARATION/);
});
