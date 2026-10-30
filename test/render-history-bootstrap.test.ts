import {test} from 'node:test';import assert from 'node:assert/strict';
import {SnapshotCache,mergePreservedEquityPoints} from '../src/reporting.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from '../src/operating-intelligence.js';
import {restoreRenderReceiverHistory,preservedReceiverCapture} from '../src/render-history-bootstrap.js';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {LIFETIME_EQUITY_SOURCE} from '../src/lifetime-equity-contract.js';

const identity={accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION,release:'f'.repeat(40),strategy:'adaptive-momentum-v2-paper-v1'};
test('exact preserved genuine receiver captures restore historical points without a current financial snapshot',()=>{
 const cache=new SnapshotCache(identity),result=restoreRenderReceiverHistory(cache);assert.equal(result.captureCount,2);assert.ok(result.points>=486);assert.equal(result.currentSnapshotCreated,false);assert.equal(cache.read(),null);assert.equal(cache.status().state,'waiting');
 const a=JSON.parse(readFileSync(resolve('evidence/receiver-history-preservation-20261030/current-live-status.json'),'utf8')),b=JSON.parse(readFileSync(resolve('evidence/receiver-history-preservation-20261030/owner-transition-current.json'),'utf8')),actual=cache.equityHistory().points;
 for(const point of [...a.equityHistory.points,...b.equityHistory.points])assert.ok(actual.some(p=>p.at===point.at&&p.equityUsd===point.equityUsd),'each genuine retained point survives exactly');
 const points=actual.filter(p=>Date.parse(p.at)>Date.parse('2026-10-30T14:30:55.590Z'));assert.ok(points.length>=30);assert.ok(actual.length<600,'timestamps deduplicate without manufacturing observations');
});
test('history union refuses conflicting actual values and keeps capital markers disconnected',()=>{
 const at='2026-10-30T15:30:25.000Z',epoch={activatedAt:at}as any;
 const old=[{at:'2026-10-30T15:28:12.712Z',equityUsd:886.29761}],source=[{at,equityUsd:950,segment:4,kind:'epoch-start' as const},{at:'2026-10-30T15:31:00.000Z',equityUsd:951,segment:4,kind:'observed' as const}];
 const merged=mergePreservedEquityPoints(source,old,epoch);assert.equal(merged.points.length,3);assert.ok(merged.points[1]!.segment!>merged.points[0]!.segment!);assert.equal(merged.points[1]!.kind,'epoch-start');assert.equal(merged.points[1]!.equityUsd,950);
 assert.throws(()=>mergePreservedEquityPoints(old,[{...old[0]!,equityUsd:999}]),/VALUE_CONFLICT/);
});
test('the bootstrapped public history cannot bypass exact file hash or original snapshot fingerprint',()=>{
 const raw=readFileSync(resolve('evidence/receiver-history-preservation-20261030/current-live-status.json'));
 assert.throws(()=>preservedReceiverCapture(raw,'0'.repeat(64)),/HASH_REQUIRED/);
 const corrupt=JSON.parse(raw.toString());corrupt.fingerprint='0'.repeat(64);const altered=Buffer.from(JSON.stringify(corrupt)),pin=createHash('sha256').update(altered).digest('hex');assert.throws(()=>preservedReceiverCapture(altered,pin),/SOURCE_FINGERPRINT/);
});

test('older durable replay cannot hide later preserved receiver values or change the current financial snapshot',()=>{
 const raw=JSON.parse(readFileSync(resolve('evidence/receiver-history-preservation-20261030/owner-transition-current.json'),'utf8'));
 const cache=new SnapshotCache({...identity,release:raw.snapshot.source.release});restoreRenderReceiverHistory(cache);cache.accept(raw.snapshot);
 const history={schemaVersion:1 as const,accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION,source:LIFETIME_EQUITY_SOURCE,lastSequence:raw.snapshot.sequence,downsampled:false,points:raw.equityHistory.points};
 cache.acceptLifetimeEquityHistory(history);const merged=cache.equityHistory();assert.equal(merged.retention,'durable-with-preserved-receiver');assert.equal(merged.points.length,487);assert.ok(merged.preservedReceiverPoints!>=30);assert.deepEqual(cache.read()!.snapshot,raw.snapshot);
 const changed=structuredClone(history);changed.lastSequence=(BigInt(history.lastSequence)+1n).toString();changed.points.find((p:any)=>p.at==='2026-10-30T15:28:12.712Z').equityUsd=999;assert.throws(()=>cache.acceptLifetimeEquityHistory(changed),/VALUE_CONFLICT/);assert.equal(cache.equityHistory().points.length,487);
});
