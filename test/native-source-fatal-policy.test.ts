/** Synthetic fatal-source policy, not attribution of any recorded outage. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {nativeCandidateDataStopReason,nativeCandidateReportingProjection} from '../src/run-native-candidates.js';
test('candidate-only source stop preserves exact safe fatal reason and does not stop a quiet healthy source',()=>{
 assert.equal(nativeCandidateDataStopReason({fatal:null,unmanagedControlUnits:0}),null);
 assert.equal(nativeCandidateDataStopReason({fatal:'NATIVE_FLOW_SYNTHETIC_FATAL',unmanagedControlUnits:0}),'NATIVE_RESEARCH_FLOW_FATAL:NATIVE_FLOW_SYNTHETIC_FATAL');
 assert.equal(nativeCandidateDataStopReason({fatal:'NATIVE_FLOW_SYNTHETIC_FATAL',unmanagedControlUnits:1}),'NATIVE_RESEARCH_UNMANAGED_CONTROL_REQUIRES_ACCOUNTING');
 assert.equal(nativeCandidateDataStopReason({fatal:'untrusted detailed provider text',unmanagedControlUnits:0}),'NATIVE_RESEARCH_FLOW_FATAL:NATIVE_RESEARCH_UNAVAILABLE');
});
test('fatal native source closes new candidate admissions once without financial writes or repeated busy-loop diagnostics',async()=>{
 const at=1793161000000,records:Array<{kind:string;data:any}>=[];let sources=0,calls=0;
 const flow={usage:()=>({fatal:'NATIVE_FLOW_SYNTHETIC_FATAL',unmanagedControlUnits:0,candidates:0,retiring:0,nextServiceAt:Infinity,connected:false,physicalTransportsSettled:true}),addCandidate(){sources++;},removeCandidate(){},snapshot(){return null;},notificationLedger(){return [];},requestSupportRefresh(){sources++;},requestHeartbeat(){sources++;},async service(){sources++;return {kind:'idle'};},async stop(){}};
 const rpc={async call(){calls++;throw Error('UNEXPECTED_NETWORK');},usage:()=>({newUnits:0,inFlight:0,waitingOrOperating:false,dispatchWindow:{readyAt:at},cooldownUntil:0}),cooldownUntil:()=>0};
 const runner=new NativeCandidateRunner({rpc:rpc as any,flow:flow as any,now:()=>at,record:(kind,data)=>records.push({kind,data})});
 assert.equal(await runner.step(),'source-fatal');for(let i=0;i<20;i++)assert.equal(await runner.step(),'closed');runner.onMigration({signature:'not-used-by-source-after-fatal',receivedAt:at});const status=runner.status();assert.equal(status.admissionsClosedReason,'NATIVE_FLOW_SYNTHETIC_FATAL');assert.equal(status.verificationQueue,0);assert.equal(status.financialWriterOpened,false);assert.equal(status.financialExecutionAuthorized,false);assert.equal(calls,0);assert.equal(sources,0);assert.equal(records.filter(r=>r.kind==='native-candidate-source-admissions-closed').length,1);
 const view=nativeCandidateReportingProjection(status,undefined,0,true,'fixture');assert.match(view.status,/native flow failed: NATIVE_FLOW_SYNTHETIC_FATAL/);assert.match(view.status,/admissions closed/);await runner.stop('synthetic source failure checkpoint');assert.equal(runner.status().running,false);
});
