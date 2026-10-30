/** Exact public receiver captures preserved before the reporting-only deploy.
 * This imports no ledger, financial control, provider, or credential. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {SnapshotCache,validateSnapshot,snapshotFingerprint,type ReceivedEquityPoint} from './reporting.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from './operating-intelligence.js';
const CAPTURES=[
 ['current-live-status.json','b66d6cc4f264461a44160684af8e6f02bb3ba4c83ee545e79c19898a687c91a5'],
 ['owner-transition-current.json','2ec517cf5a5dddc683d197e48a7b66e1ce2e7c8352ec69c8c5afe1244ec10aa2'],
] as const;
export function preservedReceiverCapture(raw:Buffer,pin:string,now=Date.now()):ReceivedEquityPoint[]{
 if(raw.length>524288||!/^[a-f0-9]{64}$/.test(pin)||createHash('sha256').update(raw).digest('hex')!==pin)throw Error('PRESERVED_RECEIVER_HASH_REQUIRED');
 const v=JSON.parse(raw.toString()),s=v.snapshot;
 if(s?.account?.id!==ORIGINAL_POE_ACCOUNT||s.account.inceptionAt!==ORIGINAL_POE_INCEPTION||s.financialEpoch)throw Error('PRESERVED_RECEIVER_ORIGINAL_EPOCH_REQUIRED');
 validateSnapshot(s,{accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION,release:s.source.release,strategy:s.source.strategy},now);
 if(snapshotFingerprint(s)!==v.fingerprint)throw Error('PRESERVED_RECEIVER_SOURCE_FINGERPRINT');
 const h=v.equityHistory;if(h?.schemaVersion!==1||h.accountId!==ORIGINAL_POE_ACCOUNT||h.source!=='accepted-authoritative-portfolio-equity'||!['receiver-memory-only','ec2-durable-republished'].includes(h.retention)||!Array.isArray(h.points)||h.points.length>1440)throw Error('PRESERVED_RECEIVER_HISTORY_SCHEMA');
 let last=Date.parse(ORIGINAL_POE_INCEPTION)-1;return h.points.map((point:any)=>{
  const at=Date.parse(point?.at);if(typeof point?.at!=='string'||!Number.isSafeInteger(at)||new Date(at).toISOString()!==point.at||at<=last||at<Date.parse(ORIGINAL_POE_INCEPTION)||at>Date.parse(s.times.generatedAt)||typeof point.equityUsd!=='number'||!Number.isFinite(point.equityUsd)||point.equityUsd<0||point.equityUsd>1e15||point.segment!==undefined&&(!Number.isSafeInteger(point.segment)||point.segment<0)||point.kind!==undefined&&!['inception','observed'].includes(point.kind))throw Error('PRESERVED_RECEIVER_POINT');
  last=at;return {at:point.at,equityUsd:point.equityUsd,...(point.segment===undefined?{}:{segment:point.segment}),...(point.kind===undefined?{}:{kind:point.kind})};
 });
}
export function restoreRenderReceiverHistory(cache:SnapshotCache,root=process.cwd(),now=Date.now()){
 for(const [name,sha]of CAPTURES)cache.preserveReceiverEquity(preservedReceiverCapture(readFileSync(resolve(root,'evidence/receiver-history-preservation-20261030',name)),sha,now));
 return {captureCount:CAPTURES.length,points:cache.equityHistory().points.length,currentSnapshotCreated:cache.read()!==null};
}
