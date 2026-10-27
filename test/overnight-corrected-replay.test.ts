import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {replayOvernightCorrection,verifyExistingOvernightCorrection} from '../scripts/replay-overnight-correction.js';
const dir='evidence/overnight-20261027/11-combined',capture=JSON.parse(readFileSync(dir+'/capture.json','utf8')),proof=JSON.parse(readFileSync(dir+'/offline-mapping-audit.json','utf8')),records=readFileSync(dir+'/observations.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line));

test('corrected chronological replay repairs only proven mapping gaps and preserves confirmed availability plus application-stop loss',()=>{
  const r=replayOvernightCorrection(records,capture.scope,proof);
  assert.equal(r.normalizedEvents,6);assert.equal(r.normalizedBuys,2);assert.equal(r.normalizedSells,4);assert.equal(r.failedTransactions,0);assert.equal(r.pending,0);
  assert.equal(r.removedMappingGapsOnlyInCounterfactual.length,2);assert.equal(r.remainingQualityGaps.length,1);assert.equal(r.originalApplicationStopRetained,true);
  for(const item of r.informationAvailability){assert.equal(item.normalizedAvailableAt,item.confirmedAvailableAt);assert.ok(Number(item.normalizedAvailableAt)>Number(item.providerReceivedAt));assert.equal(item.allExecutedTransfersPass,true);}
  assert.equal(r.distinctRawWarmedWindowEnds,1);assert.equal(r.uniqueCompleteClosedWindowEnds[0]!.windowEndAt,1793087370000);assert.ok(r.uniqueCompleteClosedWindowEnds[0]!.firstAvailableAt>=1793087370000);assert.ok(r.uniqueCompleteClosedWindowEnds[0]!.lastAvailableAt<r.endAt);
  assert.equal(capture.normalizedEvents,4);assert.equal(capture.complete60SecondFeatureWindows,0);assert.equal(r.independentlyAuditedCompleteWindows,0);assert.equal(r.forwardAcceptance,false);assert.equal(r.financialPnl,null);
});

test('moving a confirmation before its original request is refused rather than backdating information',()=>{
  const changed=structuredClone(records),tx=changed.find(r=>r.kind==='confirmed-enrichment')!;tx.data.availableAt=tx.data.hint.receivedAt;
  assert.throws(()=>replayOvernightCorrection(changed,capture.scope,proof),/INVALID_ENRICHMENT_TIMING/);
});

test('current mapper and validation-availability correction reproduce the frozen v2 replay without rewriting historical sources',()=>{
  const path=dir+'/offline-corrected-replay.json',before=readFileSync(path),stored=JSON.parse(before.toString('utf8'));
  const result=verifyExistingOvernightCorrection();assert.equal(result.semanticReplayMatches,true);assert.equal(result.originalFilesUnchanged,true);assert.equal(result.readOnly,true);assert.equal(result.networkRequests,0);assert.equal(result.forwardAcceptance,false);
  assert.equal(result.normalizedEvents,6);assert.equal(result.buys,2);assert.equal(result.sells,4);assert.equal(result.sourceCodeComparison.mapperMatchesRecorded,false);
  assert.equal(result.sourceCodeComparison.recorded.mapperSha256,stored.sourceCode.mapperSha256);assert.equal(result.sourceCodeComparison.pipelineMatchesRecorded,false);
  assert.deepEqual(readFileSync(path),before);for(const original of stored.originalFilesBefore)assert.equal(createHash('sha256').update(readFileSync(original.path)).digest('hex'),original.sha256);
});

test('read-only verification refuses altered stored semantics or source receipts in an isolated fixture',t=>{
  const directory=mkdtempSync(join(tmpdir(),'poe-offline-replay-verification-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const stored=JSON.parse(readFileSync(dir+'/offline-corrected-replay.json','utf8'));
  stored.originalFilesBefore=stored.originalFilesBefore.map((entry:any)=>{const destination=join(directory,basename(entry.path));copyFileSync(entry.path,destination);return {...entry,path:destination};});stored.originalFilesAfter=structuredClone(stored.originalFilesBefore);
  const output=join(directory,'offline-corrected-replay.json');writeFileSync(output,JSON.stringify(stored));assert.equal(verifyExistingOvernightCorrection(directory).semanticReplayMatches,true);
  const changed=structuredClone(stored);changed.correctedOfflineReplay.normalizedBuys++;writeFileSync(output,JSON.stringify(changed));assert.throws(()=>verifyExistingOvernightCorrection(directory),/STORED_SEMANTIC_REPLAY_MISMATCH/);
  writeFileSync(output,JSON.stringify(stored));const receipt=join(directory,'rpc-budget.json');writeFileSync(receipt,readFileSync(receipt,'utf8')+'\n');assert.throws(()=>verifyExistingOvernightCorrection(directory),/STORED_ORIGINAL_HASH_MISMATCH/);
});
