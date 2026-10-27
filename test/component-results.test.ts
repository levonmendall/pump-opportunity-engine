import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {componentObjectiveResults,type ComponentObjectiveEvidence} from '../src/component-results.js';
import type {ComponentNotice} from '../src/component-transport.js';
const addresses=Array.from({length:7},(_,i)=>'account'+i);
function fixture():ComponentObjectiveEvidence{return {basic:{pool:'pool',slot:10,availableAt:10000,fullBaseUnits:'10',quoteAgeAtUseMs:0,sameBytesSdkParity:true,bankClockValidated:true},blockTimeReferences:[],acknowledgements:[],expectedAddresses:addresses,reconnect:{requested:false,closedAt:null,upgradedAt:null,allAcknowledgedAt:null,firstCoherentQuoteAt:null},notifications:[],validatedSnapshots:[],evaluations:[],stopReason:null};}
const evaluation=(at:number,slot:number,output='100',condition:string|null=null)=>({pool:'pool',slot,availableAt:at,sell:{inputBaseUnits:'10',outputLamports:output},hypotheticalExitCondition:condition});
test('quiet current state and ACK/reconnect/fresh retrieval can pass without changed delivery or protection',()=>{
 const e=fixture();e.acknowledgements=[1,2].flatMap(connection=>addresses.map(address=>({connection,address,method:'accountSubscribe',at:11000})));e.reconnect={requested:true,closedAt:12000,upgradedAt:13000,allAcknowledgedAt:14000,firstCoherentQuoteAt:15000};e.evaluations=[evaluation(10000,10),evaluation(15000,20)];
 const r=componentObjectiveResults(e);assert.equal(r.basicCurrentState.status,'VERIFIED_FOR_CAPTURED_SIZE_AND_STATE');assert.equal(r.subscriptionAcknowledgements.status,'ACKNOWLEDGED');assert.equal(r.reconnectAcknowledgements.status,'RESTORED');assert.equal(r.freshStateAfterReconnect.status,'OBSERVED');assert.equal(r.changedAccountDelivery.status,'UNVERIFIED');assert.equal(r.actualSizePriceChanges.status,'UNVERIFIED');assert.equal(r.sampledExitRecognition.status,'UNVERIFIED');
});
test('later throttle or missing optional activity never erases captured basic evidence',()=>{
 const e=fixture();e.stopReason='COMPONENT_HTTP_429';const r=componentObjectiveResults(e);assert.equal(r.basicCurrentState.status,'VERIFIED_FOR_CAPTURED_SIZE_AND_STATE');assert.equal(r.basicEvidenceSurvivesLaterFailure,true);assert.equal(r.laterStopReason,'COMPONENT_HTTP_429');assert.equal(r.reconnectAcknowledgements.status,'UNVERIFIED');
 e.basic=null;assert.equal(componentObjectiveResults(e).basicCurrentState.status,'UNVERIFIED');
});
test('ACK duplicates and an unmatched change cannot manufacture restoration or notification proof',()=>{
 const e=fixture();e.acknowledgements=addresses.map(()=>({connection:1,address:addresses[0]!,method:'accountSubscribe',at:1}));e.notifications=[{at:12000,connection:1,address:addresses[0]!,slot:11,hash:'not-matched',account:{},changed:true}];const r=componentObjectiveResults(e);assert.equal(r.subscriptionAcknowledgements.status,'UNVERIFIED');assert.equal(r.changedAccountDelivery.changedNotifications,1);assert.equal(r.changedAccountDelivery.status,'UNVERIFIED');
});
test('only a later validated matching account version proves a delivered sample; sparse quotes do not reveal exact crossing time',()=>{
 const e=fixture(),account={owner:'owner',lamports:1,executable:false,data:['AA==','base64'] as [string,string],rentEpoch:0};
 const hash=createHash('sha256').update(JSON.stringify({owner:account.owner,lamports:account.lamports,executable:account.executable,data:account.data})).digest('hex');
 const notice:ComponentNotice={at:12000,connection:1,address:addresses[0]!,slot:11,hash,account,changed:true};e.notifications=[notice];
 e.validatedSnapshots=[{addresses,value:addresses.map(()=>account),context:{slot:12},requestedAt:new Date(12500).toISOString(),receivedAt:new Date(13000).toISOString()}];e.evaluations=[evaluation(10000,10),evaluation(13000,12,'80','STOP_LOSS')];
 const r=componentObjectiveResults(e);assert.equal(r.changedAccountDelivery.status,'MATCHED_CAPTURED_VERSIONS');assert.equal(r.actualSizePriceChanges.status,'OBSERVED');assert.equal(r.sampledExitRecognition.status,'OBSERVED_AT_QUOTED_SAMPLES');assert.equal(r.sampledExitRecognition.transitions[0]!.crossingTime,'UNKNOWN_BETWEEN_CAPTURED_STATES');assert.equal(r.sampledExitRecognition.continuousProtection,'UNVERIFIED');
 e.validatedSnapshots=[{...e.validatedSnapshots[0]!,receivedAt:new Date(11999).toISOString()}];assert.equal(componentObjectiveResults(e).changedAccountDelivery.status,'UNVERIFIED');
});
test('changing hypothetical size or pool cannot be counted as a market price move',()=>{
 const e=fixture();e.evaluations=[evaluation(10000,10),{...evaluation(13000,12,'80','STOP_LOSS'),sell:{inputBaseUnits:'20',outputLamports:'80'}},{...evaluation(14000,13,'200','TAKE_PROFIT'),pool:'different'}];const r=componentObjectiveResults(e);assert.equal(r.actualSizePriceChanges.status,'UNVERIFIED');assert.equal(r.sampledExitRecognition.status,'UNVERIFIED');
});

test('fresh RPC state after upgrade is independent of complete subscription restoration',()=>{
 const e=fixture();e.reconnect={requested:true,closedAt:12000,upgradedAt:13000,allAcknowledgedAt:null,firstCoherentQuoteAt:14000};
 const r=componentObjectiveResults(e);assert.equal(r.freshStateAfterReconnect.status,'OBSERVED');assert.equal(r.reconnectAcknowledgements.status,'UNVERIFIED');assert.equal(r.changedAccountDelivery.status,'UNVERIFIED');
});
