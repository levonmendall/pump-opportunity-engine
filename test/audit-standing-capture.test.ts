import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAuditStandingArgs,prepareFailedBuyAudit,prepareFinalityRecovery,validateRecoveredFinality} from '../scripts/audit-standing-capture.js';
const base='evidence/standing-research-20261027/01-paced-combined',capture=JSON.parse(readFileSync(base+'/capture.json','utf8')),records=readFileSync(base+'/observations.ndjson','utf8').trim().split('\n').map(row=>JSON.parse(row));

test('audit CLI permits only the named retained capture and one isolated new output',()=>{
  const args=['run','--capture',base,'--out','evidence/standing-research-20261027/02-failed-buy-audit'];
  assert.equal(parseAuditStandingArgs(args,'/workspace/pump-opportunity-engine').capture,'/workspace/pump-opportunity-engine/'+base);
  assert.throws(()=>parseAuditStandingArgs([]),/EXPLICIT_SCOPE/);assert.throws(()=>parseAuditStandingArgs([...args,'--retry','yes']),/EXPLICIT_SCOPE/);assert.throws(()=>parseAuditStandingArgs(['run','--capture',base,'--out',base],'/workspace/pump-opportunity-engine'),/FIXED_CAPTURE/);
});

test('offline pair preparation isolates the one actual short Buy and preserves all original failed-window evidence and Sell fingerprints',()=>{
  const before=JSON.stringify(capture),prepared=prepareFailedBuyAudit(capture,records);
  assert.equal(prepared.signature,'2CPXozPnsW1SPnLsTYHzWPLjKCGySCBbtYLX3go3X6uanBCmCh5hLnWvkVoZhwq9xy7XEuSBZei7oB4MRmkh8miP');assert.equal(prepared.layout.name,'buy_exact_quote_in');assert.equal(prepared.layout.byteLength,24);assert.equal(prepared.layout.trackVolumeAvailable,false);assert.equal(prepared.layout.trackVolumeInvented,false);
  assert.equal(prepared.correctedOriginal.length,1);assert.equal(prepared.correctedOriginal[0]!.side,'buy');assert.ok(prepared.correctedOriginal[0]!.transferChecks.baseTransfer&&prepared.correctedOriginal[0]!.transferChecks.userQuoteTransfer);assert.equal(prepared.unchangedRetainedSells.length,3);assert.ok(prepared.unchangedRetainedSells.every((x:{unchanged:boolean})=>x.unchanged));
  assert.equal(capture.executedEvidence.length,3);assert.equal(capture.qualityGaps.length,1);assert.equal(JSON.stringify(capture),before);
  const refusal=records.find(r=>r.kind==='research-mapping-refusal');assert.ok(refusal);assert.throws(()=>prepareFailedBuyAudit(capture,[...records,refusal]),/ONE_MAPPING_REFUSAL/);
});

const successfulBase='evidence/standing-research-20261027/08-current-combined',successfulCapture=JSON.parse(readFileSync(successfulBase+'/capture.json','utf8')),incompleteAudit=JSON.parse(readFileSync(successfulBase+'/audit.json','utf8')),successfulRecords=readFileSync(successfulBase+'/observations.ndjson','utf8').trim().split('\n').map(row=>JSON.parse(row));

test('finality mode permits only the fixed08→09 pair and recovers the original first two targets after recorded cooldown',()=>{
  const p=parseAuditStandingArgs(['run','--capture',successfulBase,'--out','evidence/standing-research-20261027/09-finality-recovery'],'/repo');assert.equal(p.mode,'finality-recovery');
  assert.throws(()=>parseAuditStandingArgs(['run','--capture',successfulBase,'--out','evidence/standing-research-20261027/02-failed-buy-audit'],'/repo'),/FIXED_CAPTURE/);
  const beforeCapture=JSON.stringify(successfulCapture),beforeAudit=JSON.stringify(incompleteAudit),prepared=prepareFinalityRecovery(successfulCapture,incompleteAudit,successfulRecords);
  assert.equal(prepared.targets.length,2);assert.deepEqual(prepared.targets.map(t=>t.signature),incompleteAudit.independentTransactions.slice(0,2).map((t:any)=>t.signature));assert.equal(prepared.notBefore,1793121375670+10000+5000);assert.equal(prepared.confirmedEvents,11);
  assert.equal(JSON.stringify(successfulCapture),beforeCapture);assert.equal(JSON.stringify(incompleteAudit),beforeAudit);assert.equal(incompleteAudit.complete,false);assert.equal(prepared.receiveWindowCompleteness,'NOT_ESTABLISHED_BY_CHAIN_TIME_ALONE');
});

test('finality recovery refuses an unrelated original gap, missing match, changed throttle or existing recheck before requesting',()=>{
  for(const change of [ (a:any)=>{a.unsupported=[{reason:'unsupported'}];},(a:any)=>{a.unresolvedSelectedHints=[{signature:'missing'}];},(a:any)=>{a.verifiedSwapEvents=10;},(a:any)=>{a.rechecks=[{signature:'already'}];},(a:any)=>{a.independentTransactions[0].events[0].fingerprint='0'.repeat(64);} ]){const a=structuredClone(incompleteAudit);change(a);assert.throws(()=>prepareFinalityRecovery(successfulCapture,a,successfulRecords),/AUDIT_STANDING_RECOVERY_/);}
  const c=structuredClone(successfulCapture);c.qualityGaps.push({at:1,reason:'lost-selected-event'});assert.throws(()=>prepareFinalityRecovery(c,incompleteAudit,successfulRecords),/CAPTURE_UNUSABLE/);
  const r=structuredClone(successfulRecords);r.find((x:any)=>x.kind==='http-headers'&&x.data.status===429).data.retryAfter=null;assert.throws(()=>prepareFinalityRecovery(successfulCapture,incompleteAudit,r),/COOLDOWN_UNVERIFIED/);
});

test('offline finalized comparison mechanics require identical identity, transfers, chain context and instruction layout',()=>{
  const target=prepareFinalityRecovery(successfulCapture,incompleteAudit,successfulRecords).targets[0],record=successfulRecords.find((r:any)=>r.kind==='forward-audit-independent-transaction'&&r.data.signature===target.signature)!.data;
  // Reusing these CONFIRMED fixture bytes exercises comparison mechanics only;
  // it supplies no finalized read or new information-availability evidence.
  const check=validateRecoveredFinality(successfulCapture,target,record.transaction,record.availableAt);assert.equal(check.confirmedAndOriginalFingerprintsMatch,true);assert.equal(check.mapped.length,1);
  const changed=structuredClone(record.transaction);changed.slot++;assert.throws(()=>validateRecoveredFinality(successfulCapture,target,changed,record.availableAt),/FINALIZED_CONTEXT_CHANGED/);
  const targetChanged=structuredClone(target);targetChanged.events[0].fingerprint='0'.repeat(64);assert.throws(()=>validateRecoveredFinality(successfulCapture,targetChanged,record.transaction,record.availableAt),/FINALIZED_CONTENT_CHANGED/);
  const layoutChanged=structuredClone(target);layoutChanged.layouts[0].layout.byteLength++;assert.throws(()=>validateRecoveredFinality(successfulCapture,layoutChanged,record.transaction,record.availableAt),/FINALIZED_LAYOUT_CHANGED/);
});
