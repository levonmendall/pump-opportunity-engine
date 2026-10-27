import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAuditStandingArgs,prepareFailedBuyAudit} from '../scripts/audit-standing-capture.js';
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
