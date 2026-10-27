/** Offline boundaries only: importing the driver never opens a connection. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSubjectArgs,decodedSubjectSeed,subjectReadReserveAt,subjectPoolReason,subjectMigrationAck} from '../scripts/prepare-standing-subject.js';

test('selection is one explicit fixed review output, with no automatic invocation',()=>{
  const args=['run','--out','evidence/standing-research-20261027/04-current-subject'];
  assert.match(parseSubjectArgs(args,'/repo').out,/^\/repo\/evidence\/standing-research-20261027\/04-current-subject$/);
  for(const bad of [[],['run'],[...args,'--retry','1'],['run','--out','/tmp/elsewhere'],['run','--out','evidence/standing-research-20261027/05-another-pass']])assert.throws(()=>parseSubjectArgs(bad,'/repo'),/FIXED_EXPLICIT_SCOPE/);
});

test('exact migration acknowledgement cannot be an unsubscription or refusal',()=>{
  assert.equal(subjectMigrationAck({message:"Subscribed to 'migration' events."}),true);
  for(const message of ["Unsubscribed to 'migration' events.","Not subscribed to migration","Subscribed to 'migration' events. ERROR",'',null])assert.equal(subjectMigrationAck({message}),false);
});

test('current seed identity is derived from actual confirmed roles even when the feed mint is the quote',()=>{
  const rows=readFileSync('evidence/overnight-20261027/04-active/observations.ndjson','utf8').trim().split('\n').map(s=>JSON.parse(s)),tx=rows.find(r=>r.kind==='migration-transaction')!,hint=rows.find(r=>r.kind==='migration-verification-unavailable')!.data.hint;
  const result=decodedSubjectSeed(tx.data,{signature:tx.data.transaction.signatures[0],feedMint:hint.mint,receivedAt:tx.recordedAt-1000},tx.recordedAt);
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.equal(result.identity.feedHintRole,'quote');assert.equal(result.identity.classification,'EXCLUDED_CUSTOM_QUOTE');assert.notEqual(result.identity.baseMint,hint.mint);assert.equal(result.identity.currentPoolStateVerified,false);
});

test('five-read admission drains real short/minute history before starting the preflight clock',()=>{
  const now=100000;
  assert.equal(subjectReadReserveAt([99000,99250,99500,99750,100000],now),100250);
  assert.equal(subjectReadReserveAt([98000,98250,98500,98750,99000,99250],now),108000);
  const minute=Array.from({length:56},(_,i)=>41000+i*750);assert.equal(subjectReadReserveAt(minute,now),101000);
  assert.equal(subjectReadReserveAt([],now),now);
  assert.throws(()=>subjectReadReserveAt([100001],now),/INVALID_START_HISTORY/);
  assert.throws(()=>subjectReadReserveAt([99001,99000],now),/INVALID_START_HISTORY/);
});

test('capacity and support refusals persist; pacing, quotas and storage never poison pool eligibility',()=>{
  assert.equal(subjectPoolReason('FORWARD_PREFLIGHT_NO_RECENT_SUCCESS'),'INSUFFICIENT_RECENT_POOL_ACTIVITY');
  assert.equal(subjectPoolReason('FORWARD_PREFLIGHT_EXPECTED_ENRICHMENT_EXCEEDS10'),'SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY');
  assert.equal(subjectPoolReason('BAD_POOL_IDENTITY'),'BAD_POOL_IDENTITY');
  for(const r of ['FORWARD_PREFLIGHT_ELAPSED_CAP','SUBJECT_SELECTION_READ_RESERVE','SUBJECT_NEW_POOL_CAPACITY_INTERVAL_UNOBSERVABLE','COMPONENT_HTTP_429','COMPONENT_STORAGE_UNAVAILABLE','RESEARCH_CLOCK_ADMISSION_CLOSED','UNKNOWN_OPERATIONAL_FAILURE'])assert.equal(subjectPoolReason(r),null,r);
});
