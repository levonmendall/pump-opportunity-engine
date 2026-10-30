/** Explicit CLI and physical-admission composition only. No provider/client is
 * run, no experiment directory or reservation is created. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStandingResearchArgs,mergeStandingAdmission,validateStandingScope} from '../scripts/standing-research.js';
import {readFileSync} from 'node:fs';

test('standing CLI requires one explicit isolated output and the fixed75s observation scope',()=>{
  const p=parseStandingResearchArgs(['run','--out','evidence/standing-research-20261027/experiment-01','--observation-ms','75000','--previous','evidence/standing-research-20261027/completed-00'],'/workspace/pump-opportunity-engine');
  assert.equal(p.out,'/workspace/pump-opportunity-engine/evidence/standing-research-20261027/experiment-01');assert.equal(p.observationMs,75000);assert.equal(p.previous.length,1);
  for(const args of [[],['run'],['run','--out','evidence/scheduler-forward-20261027','--observation-ms','75000'],['run','--out','evidence/standing-research-20261027/../escape','--observation-ms','75000'],['run','--out','evidence/standing-research-20261027/experiment-01','--observation-ms','30000'],['run','--out','evidence/standing-research-20261027/experiment-01','--observation-ms','75000','--retry','yes']])assert.throws(()=>parseStandingResearchArgs(args,'/workspace/pump-opportunity-engine'),/STANDING_/);
});

test('a prepared subject is only a bounded canonical identity seed, never reused current support',()=>{
  const scope=JSON.parse(readFileSync('evidence/scheduler-forward-20261027/capture.json','utf8')).scope;
  assert.deepEqual(validateStandingScope(scope),scope);
  for(const changed of [{baseUnits:'0'},{baseUnits:(1n<<64n).toString()},{minSlot:-1},{pool:'11111111111111111111111111111111'},{supportedPoolEvidence:''}])assert.throws(()=>validateStandingScope({...scope,...changed}));
  const parsed=parseStandingResearchArgs(['run','--out','evidence/standing-research-20261027/next-subject','--observation-ms','75000','--scope','evidence/standing-research-20261027/04-current-subject/selected.json'],'/workspace/pump-opportunity-engine');assert.match(parsed.scopePath!,/04-current-subject\/selected.json$/);
  assert.throws(()=>parseStandingResearchArgs(['run','--out','evidence/standing-research-20261027/next-subject','--observation-ms','75000','--scope','/workspace/shared/poe-secrets/selected.json'],'/workspace/pump-opportunity-engine'),/SCOPE_EVIDENCE/);
});

test('phase and observation admission use the earlier physical deadline and both clocks, including a post-persist crossing',()=>{
  let wall=100,mono=100,observation=true;const controller=new AbortController(),phase={deadlineAt:1000,deadlineMono:900,signal:controller.signal};
  const admission=mergeStandingAdmission(phase,{latestStartAt:777,admissionOpen:()=>observation},{wall:()=>wall,mono:()=>mono});
  assert.equal(admission.latestStartAt,777);assert.equal(admission.admissionOpen(),true);wall=999;mono=899;assert.equal(admission.admissionOpen(),true);
  mono=900;assert.equal(admission.admissionOpen(),false);mono=899;wall=1000;assert.equal(admission.admissionOpen(),false);
  wall=500;mono=500;observation=false;assert.equal(admission.admissionOpen(),false);observation=true;controller.abort();assert.equal(admission.admissionOpen(),false);
});

test('a phase alone remains exclusive at its boundary; previous experiment order cannot include the new output twice',()=>{
  const controller=new AbortController(),phase={deadlineAt:5000,deadlineMono:4500,signal:controller.signal};let at=4999;
  const admission=mergeStandingAdmission(phase,undefined,{wall:()=>at,mono:()=>4000});assert.equal(admission.latestStartAt,4999);assert.equal(admission.admissionOpen(),true);at=5000;assert.equal(admission.admissionOpen(),false);
  const prefix=['run','--out','evidence/standing-research-20261027/new-run','--observation-ms','75000'];
  assert.throws(()=>parseStandingResearchArgs([...prefix,'--previous','evidence/standing-research-20261027/new-run'],'/workspace/pump-opportunity-engine'),/FIXED_SCOPE/);
  assert.throws(()=>parseStandingResearchArgs([...prefix,'--previous','evidence/standing-research-20261027/old-run','--previous','evidence/standing-research-20261027/old-run'],'/workspace/pump-opportunity-engine'),/FIXED_SCOPE/);
});
