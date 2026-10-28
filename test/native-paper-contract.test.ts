/** Pure contract fixtures: no network, ledger, market-data or performance claim. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {FlowWindow,PROVISIONAL_RULE} from '../src/strategy.js';
import {PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION,NATIVE_PAPER_CONTRACT,NATIVE_PAPER_CONTRACT_SHA256,nativePaperFeaturesSha256,nativePaperEvidenceReady,type NativePaperAuditCertificate,type NativePaperEvidenceInput} from '../src/native-paper-contract.js';
const mint=bs58.encode(Buffer.alloc(32,21)),pool=bs58.encode(Buffer.alloc(32,22));
function fixture():NativePaperEvidenceInput{
 const window=new FlowWindow(mint,90000);
 for(const [i,at]of [110000,125000].entries())window.ingest({identity:{signature:'OFFLINE-program-signature-'+i,instructionIndex:i,eventIndex:0},mint,wallet:'OFFLINE-user-'+i,side:'buy',quoteLamports:'250000000',tokenUnits:'1000000000',receivedAt:at,commitment:'confirmed',slot:100+i});
 const at=160500,features=window.features(at),certificate:NativePaperAuditCertificate={schemaVersion:1,mint,pool,dataContract:'confirmed-program-activity-v3-shadow',openedAt:90000,connectionId:1,subscriptionId:72,windowStartAt:features.windowStartAt,windowEndAt:features.windowEndAt,auditAvailableAt:160400,admittedAt:160500,deadlineAt:169999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(features)};
 return {contractVersion:NATIVE_PAPER_DATA_CONTRACT_VERSION,certificate,at,mint,pool,dataContract:certificate.dataContract,openedAt:certificate.openedAt,connectionId:certificate.connectionId,subscriptionId:certificate.subscriptionId,features,connected:true,sourceSupportFresh:true,hasQualityLoss:false};
}
const cert=(f:NativePaperEvidenceInput)=>f.certificate as NativePaperAuditCertificate;

test('native PAPER contract is separately versioned, deeply frozen, hash pinned and preserves baseline thresholds',()=>{
 assert.equal(NATIVE_PAPER_DATA_CONTRACT_VERSION,'confirmed-program-ordinary-flow-paper-v1');assert.equal(NATIVE_PAPER_CONTRACT.strategy.pilotBaseContractSha256,PILOT_CONTRACT_SHA256);assert.equal(NATIVE_PAPER_CONTRACT.strategy.baseline,PROVISIONAL_RULE.version);assert.equal(NATIVE_PAPER_CONTRACT.strategy.thresholdChanges,false);assert.equal(NATIVE_PAPER_CONTRACT.strategy.windowMs,PROVISIONAL_RULE.windowMs);assert.equal(NATIVE_PAPER_CONTRACT.strategy.bucketMs,PROVISIONAL_RULE.bucketMs);assert.equal(NATIVE_PAPER_CONTRACT.liveTradingEnabled,false);assert.equal(NATIVE_PAPER_CONTRACT_SHA256,createHash('sha256').update(JSON.stringify(NATIVE_PAPER_CONTRACT)).digest('hex'));assert.ok(Object.isFrozen(NATIVE_PAPER_CONTRACT));assert.ok(Object.isFrozen(NATIVE_PAPER_CONTRACT.strategy));assert.ok(Object.isFrozen(NATIVE_PAPER_CONTRACT.sources));assert.ok(Object.isFrozen(NATIVE_PAPER_CONTRACT.unavailableAssertions));assert.ok(NATIVE_PAPER_CONTRACT.unavailableAssertions.includes('per-transaction SPL transfer cross-check'));assert.match(NATIVE_PAPER_CONTRACT.qualification,/no prediction/);
});

test('canonical fingerprint keeps every closed-window feature while allowing actual asOf time to advance within its bucket',()=>{
 const f=fixture(),features=f.features as Record<string,unknown>,fingerprint=nativePaperFeaturesSha256(features),reordered=Object.fromEntries(Object.entries(features).reverse());assert.equal(nativePaperFeaturesSha256(reordered),fingerprint);assert.equal(nativePaperFeaturesSha256({...features,asOf:f.at+1}),fingerprint);assert.equal(nativePaperFeaturesSha256({...features,asOf:169999}),fingerprint);
 for(const patch of [{positiveNetBuckets:3},{distinctBuyerWallets:1},{largestBuyerBps:10000},{priceReturnBps:1},{provisionalTradeCount:1},{sufficientlyObserved:false,qualityReason:'feed-gap'},{firstPrice:{quoteLamports:'250000001',tokenUnits:'1000000000'}},{buyLamports:'600000000',netBuyLamports:'600000000'}])assert.notEqual(nativePaperFeaturesSha256({...features,...patch}),fingerprint);
 assert.throws(()=>nativePaperFeaturesSha256({...features,asOf:170000}),/INVALID_FEATURES/);assert.throws(()=>nativePaperFeaturesSha256({...features,netBuyLamports:'999'}),/INVALID_FEATURES/);assert.throws(()=>nativePaperFeaturesSha256({...features,unverifiedPrivate:'must not enter hash'}),/INVALID_FEATURES/);assert.throws(()=>nativePaperFeaturesSha256({...features,firstPrice:{quoteLamports:'0',tokenUnits:'1'}}),/INVALID_FEATURES/);
});

test('exact current audited evidence can be admitted only through the explicit new PAPER contract',()=>{
 const f=fixture();assert.equal(nativePaperEvidenceReady(f),true);for(const source of NATIVE_PAPER_CONTRACT.sources){f.dataContract=source;cert(f).dataContract=source;assert.equal(nativePaperEvidenceReady(f),true);}for(const value of [undefined,null,'confirmed-program-activity-v3-shadow','confirmed-program-events-v2','paper','live'])assert.equal(nativePaperEvidenceReady({...f,contractVersion:value}),false);assert.equal(nativePaperEvidenceReady({...f,certificate:null}),false);assert.equal(nativePaperEvidenceReady({...f,certificate:{...cert(f),extra:'unknown'}}),false);
});

test('generation, source identity, actual current feature window and fingerprint must agree exactly',()=>{
 const f=fixture();for(const patch of [{mint:pool},{pool:mint},{dataContract:'confirmed-program-events-v2'},{dataContract:'unknown'},{openedAt:90001},{connectionId:2},{subscriptionId:73},{windowStartAt:90000,windowEndAt:150000},{windowStartAt:100001},{featuresSha256:'a'.repeat(64)},{featuresSha256:'short'},{schemaVersion:2}])assert.equal(nativePaperEvidenceReady({...f,certificate:{...cert(f),...patch}}),false,JSON.stringify(patch));
 for(const patch of [{openedAt:null},{connectionId:null},{subscriptionId:null},{connected:false},{sourceSupportFresh:false},{hasQualityLoss:true}])assert.equal(nativePaperEvidenceReady({...f,...patch}),false,JSON.stringify(patch));
 assert.equal(nativePaperEvidenceReady({...f,features:{...(f.features as object),positiveNetBuckets:3}}),false);assert.equal(nativePaperEvidenceReady({...f,features:{...(f.features as object),asOf:f.at-1}}),false,'stale asOf cannot stand in for current in-memory validation');
});

test('actual audit/admission availability and unchanged bucket cutoff prevent backdating or stale certificate reuse',()=>{
 const f=fixture();for(const patch of [{auditAvailableAt:159999},{auditAvailableAt:160501},{admittedAt:160399},{admittedAt:160501},{deadlineAt:170000},{deadlineAt:169998},{openedAt:100001},{connectionId:-1},{subscriptionId:1.5}])assert.equal(nativePaperEvidenceReady({...f,certificate:{...cert(f),...patch}}),false,JSON.stringify(patch));
 const near={...f,at:169999,features:{...(f.features as object),asOf:169999}};assert.equal(nativePaperEvidenceReady(near),true);assert.equal(nativePaperEvidenceReady({...near,at:170000,features:{...(f.features as object),asOf:170000}}),false);
});

test('only independently verified executed completeness can waive a missing failed packet; warming or provisional flow never qualifies as ready',()=>{
 const f=fixture();assert.equal(nativePaperEvidenceReady({...f,certificate:{...cert(f),notificationCompletenessVerified:false}}),true,'full packet census is distinct from executed-flow evidence');for(const patch of [{executedFlowCompletenessVerified:false},{notificationCompletenessVerified:'yes'},{executedFlowCompletenessVerified:'true'}])assert.equal(nativePaperEvidenceReady({...f,certificate:{...cert(f),...patch}}),false);
 for(const patch of [{sufficientlyObserved:false,qualityReason:'warming'},{provisionalTradeCount:1},{qualityReason:'feed-gap'}]){const features={...(f.features as object),...patch};assert.equal(nativePaperEvidenceReady({...f,features,certificate:{...cert(f),featuresSha256:nativePaperFeaturesSha256(features)}}),false);}
 const unknown=Object.create(null);assert.equal(nativePaperEvidenceReady({...f,features:unknown}),false);const hostile={get mint(){throw Error('PRIVATE-untrusted-value');}};assert.throws(()=>nativePaperFeaturesSha256(hostile),/^Error: NATIVE_PAPER_INVALID_FEATURES$/);assert.equal(nativePaperEvidenceReady({...f,features:hostile}),false);
});
