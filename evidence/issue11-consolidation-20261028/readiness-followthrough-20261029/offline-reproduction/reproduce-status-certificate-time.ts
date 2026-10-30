/** OFFLINE controlled timing fixture. No provider, ledger, execution or credentials. */
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NativeCandidateRunner} from './frozen-financial-5e55/src/native-candidate-runner.ts';
import {FlowWindow} from './frozen-financial-5e55/src/strategy.ts';
import {nativePaperFeaturesSha256} from './frozen-financial-5e55/src/native-paper-contract.ts';

const mint='So11111111111111111111111111111111111111112';
const pool='11111111111111111111111111111111';
const windowEndAt=1793244440000,openedAt=windowEndAt-60000,oldAt=windowEndAt+2000;
let now=oldAt;
const window=new FlowWindow(mint,openedAt);
const snapshots:Array<{at:number;now:number}>=[];
const flow={
 usage:()=>({dataContract:'confirmed-program-activity-v3-shadow'}),
 snapshot:(requested:string,at=now)=>{assert.equal(requested,mint);snapshots.push({at,now});const features=window.features(at);return {warm:features.sufficientlyObserved,features,openedAt,connectionId:1,subscription:2};},
 addCandidate:()=>{throw Error('unexpected add')},removeCandidate:()=>{throw Error('unexpected remove')},
 notificationLedger:()=>[],requestSupportRefresh:()=>{},requestHeartbeat:()=>{},service:()=>{throw Error('unexpected service')},stop:()=>{throw Error('unexpected stop')}
};
const runner=new NativeCandidateRunner({flow:flow as any,rpc:{usage:()=>({}),call:()=>{throw Error('unexpected RPC')},cooldownUntil:()=>0} as any,now:()=>now,record:()=>{}});
const candidate={identity:{baseMint:mint,pool,chainBlockTime:(oldAt-600000)/1000},allocatedAt:openedAt,openedAt,lastAssessmentEnd:windowEndAt};
(runner as any).candidates.set(mint,candidate);
const certificate={schemaVersion:1,mint,pool,dataContract:'confirmed-program-activity-v3-shadow',openedAt,connectionId:1,subscriptionId:2,windowStartAt:windowEndAt-60000,windowEndAt,auditAvailableAt:oldAt,admittedAt:oldAt,deadlineAt:windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(window.features(oldAt))};
(runner as any).certificates.set(mint,certificate);
const initial=runner.currentAuditCertificate(mint,oldAt);assert.deepEqual(initial,certificate);
assert.deepEqual(runner.certifiedCandidateMints(oldAt),[mint]);
// Real status() samples now anew, just as report() calls engineStatus().
now=oldAt+1;const status=runner.status();assert.equal(status.generatedAt,oldAt+1);assert.equal(status.candidates[0]?.snapshot?.features.asOf,oldAt+1);
let error:string|null=null;try{runner.currentAuditCertificate(mint,oldAt);}catch(e){error=e instanceof Error?e.message:String(e);}
assert.equal(error,'information cannot be observed before it became available');
let selectionError:string|null=null;try{runner.certifiedCandidateMints(oldAt);}catch(e){selectionError=e instanceof Error?e.message:String(e);}
assert.equal(selectionError,error);
// Repair semantics: sample the CURRENT query time after reporting advanced the window.
const freshAt=now;const fresh=runner.currentAuditCertificate(mint,freshAt);assert.deepEqual(fresh,certificate);assert.deepEqual(runner.certifiedCandidateMints(freshAt),[mint]);
assert.equal(nativePaperFeaturesSha256(window.features(freshAt)),certificate.featuresSha256);
assert.equal(fresh?.deadlineAt,certificate.deadlineAt);assert.equal(fresh?.admittedAt,certificate.admittedAt);
now=certificate.deadlineAt+1;assert.equal(runner.currentAuditCertificate(mint,now),null,'fresh lookup still enforces exact original expiry');
const root='/tmp/poe-readiness-timing-20261029/frozen-financial-5e55/src';
const sources=Object.fromEntries(['native-candidate-runner.ts','strategy.ts','native-paper-contract.ts'].map(name=>[name,createHash('sha256').update(readFileSync(root+'/'+name)).digest('hex')]));
const result={kind:'OFFLINE_FROZEN_STATUS_CERTIFICATE_TIME_REGRESSION_REPRODUCED',financialSourceCommit:'5e55d8b939de99698ddb311a282461931fcbc957',sourceSha256:sources,fixtureOnly:true,originalAccountOpened:false,financialDatabaseOpened:false,networkRequests:0,credentialsRead:false,oldAt,statusAt:status.generatedAt,clockAdvancedMs:status.generatedAt-oldAt,initialCertificatePresent:initial!==null,oldTimestampCertificateError:error,oldTimestampSelectionError:selectionError,freshTimestampCertificatePresent:fresh!==null,exactFeaturesHashUnchanged:true,originalCertificateMetadataUnchanged:true,expiredCertificateStillRejected:true,snapshotCalls:snapshots};
writeFileSync('/tmp/poe-readiness-timing-20261029/status-certificate-time-result.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
