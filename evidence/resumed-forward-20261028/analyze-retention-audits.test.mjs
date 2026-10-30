/** Explicit synthetic analyzer-mechanics checks, not market/runtime evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {analyzeRetentionAudits} from './analyze-retention-audits.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const source={commit:'a'.repeat(40),sha256:'b'.repeat(64)},configurationSha256='c'.repeat(64);
function fixture(extra,{assessments=0,unique=0,quality=0,deadlines=0,normalizations=0}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'poe-retention-analyzer-fixture-'));fs.mkdirSync(path.join(root,'run/events'),{recursive:true});
 const final={runId:'synthetic-analyzer-only',source,configurationSha256,startedAt:100000,generatedAt:150000,elapsedMs:50000,running:false,physicalSettlementConfirmed:true,financialWriterOpened:false,financialExecutionAuthorized:false,entriesEnabled:false,portfolio:null,stopReason:'synthetic fixture ended',limits:{durationMs:50000},resources:{cpu:{user:100,system:20},maximumRssBytes:10000000},engine:{maximumSimultaneousCandidates:2,counters:{normalizedEvents:normalizations,predictiveAssessments:assessments,uniqueEvaluated:unique,qualityGaps:quality,decisionDeadlineMisses:deadlines},flow:{protocolEffects:0,socketBytes:0,ignoredAfterGap:0,retiredNotifications:0,duplicates:0,corrections:0}},feeds:{pumpApiSocketBytes:0,discoverySocketBytes:0,totalSocketBytes:0}};
 const events=[{kind:'native-research-frozen-input',at:100000,data:{runId:final.runId,source,configurationSha256,startedAt:100000}},...extra].sort((a,b)=>a.at-b.at).map((r,i)=>JSON.stringify({schemaVersion:1,sequence:i+1,kind:r.kind,receivedAt:new Date(r.at).toISOString(),data:r.data})).join('\n')+'\n';
 const files={'run/receipt.json':JSON.stringify(final),'supervisor.json':JSON.stringify({runtimeOutcome:{mechanicallyCompleted:false,classification:'synthetic'}}),'run/events/events-001.ndjson':events};const included=[];for(const [name,data]of Object.entries(files)){fs.writeFileSync(path.join(root,name),data);included.push({path:name,bytes:Buffer.byteLength(data),sha256:sha(data)});}fs.writeFileSync(path.join(root,'index.json'),JSON.stringify({schemaVersion:1,credentialsIncluded:false,financialFilesIncluded:false,included}));return root;
}
const event=(kind,at,data)=>({kind,at,data}),physical=(id,at,method='getSignaturesForAddress',complete=true)=>[
 event('component-physical-start',at,{id,at,enqueuedAt:at-10,reservedAt:at-5,kind:{method,transport:'http'}}),
 event('component-physical-settled',at+100,{id,at:at+100,kind:{method,transport:'http'},responseComplete:complete,uncertainReservedBytes:complete?0:2097152})
];
const feature=(mint,at=120010)=>event('native-candidate-feature-view',at,{mint,at,features:{sufficientlyObserved:true,qualityReason:null,windowStartAt:60000,windowEndAt:120000,tradeCount:1,netBuyLamports:'1'}});
const page=(mint,n,at)=>event('native-flow-history-page',at,{mint,pool:'pool-'+mint,target:{startAt:60000,endAt:120000},page:n,receivedAt:at-1,rows:[{slot:1} ]});
const audit=(mint,n,at)=>event('native-candidate-window-audit',at,{mint,availableAt:at,result:{target:{startAt:60000,endAt:120000},status:'verified',reason:'synthetic-mechanics',complete:true,startedAt:120020,availableAt:at,requestAttempts:n,maximumPages:4,pages:Array.from({length:n},(_,i)=>({page:i+1,rows:1})),historyRows:n,historyRangeCovered:true,interiorRows:0,requiredSignatures:[],comparedSignatures:[],missingNotifications:[],unconfirmedCapturedSignatures:[],statusDisagreements:[],contextFences:null}});
const assessment=(mint,at)=>event('native-predictive-assessment',at,{mint,at,windowEndAt:120000,assessment:{status:'failed',reason:'synthetic-mechanics'},financialQualification:false,auditAvailableAt:at-1});

test('synthetic interleaved audit pages retain candidate identity and union overlapping lookbacks',async()=>{
 const root=fixture([feature('A'),feature('B'),event('native-candidate-audit-session-open',120020,{mint:'A',at:120020,targetEndAt:120000,deadlineAt:129999,maximumPages:4}),event('native-candidate-audit-session-open',120030,{mint:'B',at:120030,targetEndAt:120000,deadlineAt:129999,maximumPages:4}),...physical(1,120100),page('A',1,120202),...physical(2,120400),page('B',1,120502),audit('B',1,120503),assessment('B',120504),...physical(3,120700),page('A',2,120802),audit('A',2,120803),assessment('A',120804)],{assessments:2,unique:2});
 try{const d=await analyzeRetentionAudits(root);assert.deepEqual(d.audits.historyPages.map(p=>[p.mint,p.page,p.physicalId]),[['A',1,1],['B',1,2],['A',2,3]]);assert.equal(d.audits.verifiedMultipageEndpoints,1);assert.equal(d.coverage.assessedWallUnionMs,60000);assert.equal(d.coverage.assessedTokenUnionMs,120000);assert.equal(d.provider.reconstructedMaximumPhysicalInFlight,1);assert.equal(d.perCandidate[0].normalizedTrades,null);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('synthetic429 and local refusal stay separate; failed history request gets no invented candidate',async()=>{
 const root=fixture([...physical(1,120100,'getSignaturesForAddress',false),event('http-headers',120150,{id:1,at:120150,method:'getSignaturesForAddress',status:429,retryAfter:'2'}),event('pilot-rpc-unavailable',120201,{at:120201,code:'COMPONENT_HTTP_429',cooldownUntil:122201,physicalSettled:true}),event('pilot-job-admission-refused',120250,{at:120250,code:'COMPONENT_DISPATCH_EXPIRED',domain:'rpc',providerCooldownUnchanged:true})]);
 try{const d=await analyzeRetentionAudits(root);assert.equal(d.provider.explicit429or503.length,1);assert.equal(d.provider.localAdmissionRefusals.length,1);assert.deepEqual(d.audits.historyStartsWithoutSuccessfulPageAttribution,[1]);assert.equal(d.audits.successfulPagePhysicalMappings,0);assert.equal(d.provider.physicalOperations[0].uncertainReservedBytes,2097152);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('synthetic partial callback normalization remains visible after candidate-local refusal',async()=>{
 const notification={signature:'synthetic-selected-signature',slot:1,receivedAt:120000,availableAt:120100,subscriptionMint:'A',success:true,rawHash:'d'.repeat(64),eventsAccepted:1,classification:'unusable',reason:'NATIVE_FLOW_CALLBACK_PROCESSING_OVERRUN'};
 const root=fixture([event('native-flow-validated-events',120050,{notification}),event('native-flow-refusal',120100,notification),event('native-flow-ledger-capacity-refusal',120101,{mint:'A',at:120101,rows:8192,maximumRows:8192,candidateLocal:true,windowUsable:false,allReceivedBytesStillAccounted:true})],{normalizations:1});
 try{const d=await analyzeRetentionAudits(root);assert.equal(d.summary.normalizationsAccountedByTerminalNotificationRows,1);assert.equal(d.summary.normalizationsNotAccountedByTerminalRows,0);assert.equal(d.notificationRetention.sourceWideLedgerTermination,false);assert.equal(d.notificationRetention.capacityRefusals.length,1);assert.equal(d.summary.refusedUniqueSignatures,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('artifact tampering rejects analysis before drawing a completion conclusion',async()=>{
 const root=fixture([]);try{fs.appendFileSync(path.join(root,'run/events/events-001.ndjson'),'\n');await assert.rejects(()=>analyzeRetentionAudits(root),/PUBLIC_INDEX_HASH/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
