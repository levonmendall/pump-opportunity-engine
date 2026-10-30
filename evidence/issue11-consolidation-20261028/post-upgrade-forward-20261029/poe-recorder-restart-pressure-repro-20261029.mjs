import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BoundedRotatingRecorder} from '/workspace/pump-opportunity-engine/src/recorder.ts';
let at=1000000,mono=0;
const directory=join(mkdtempSync(join(tmpdir(),'poe-OFFLINE-restart-pressure-')),'service');
const cfg={directory,segmentBytes:4096,diagnosticBytes:12288,minRetentionMs:300000,minimumDiskReserveBytes:0,now:()=>at,monotonic:()=>mono};
const first=new BoundedRotatingRecorder(cfg);let rows=0;
while(rows<100&&first.record('SYNTHETIC-native-packet',{raw:'x'.repeat(1500)}))rows++;
assert.ok(rows>0&&rows<100);await first.close();
// Simulated clean service reopen: old segments remain intact and their new
// retention epoch begins at this process's own monotonic time.
at+=86400000;mono=1000;
const second=new BoundedRotatingRecorder(cfg),before=second.usage();
assert.equal(before.candidateAdmissionAllowed,false);
assert.equal(before.pressureReason,'DIAGNOSTIC_HEADROOM');
await second.maintenance();assert.equal(second.usage().retiredBytes,0);
at+=299999;mono+=299999;await second.maintenance();const justBefore=second.usage();
assert.equal(justBefore.candidateAdmissionAllowed,false);assert.equal(justBefore.retiredBytes,0);
at+=1;mono+=1;await second.maintenance();const after=second.usage();
assert.equal(after.candidateAdmissionAllowed,true);assert.ok(after.retiredBytes>0);
const restartReceipt=JSON.parse(readFileSync(join(directory,'state.json'),'utf8')).receipts.find(x=>x.kind==='restart');
await second.close();
console.log(JSON.stringify({type:'OFFLINE_SYNTHETIC_RECORDER_REOPEN_PRESSURE',source:'a97799e88e4313ed94d0c6b5d250eeeea5f5fdc5',directory,rows,before,at299999:justBefore,at300000:after,restartReceipt,liveAttribution:'Not established: actual private recorder usage/receipts must identify whether this condition occurred on EC2.',financialStateUsed:false,networkUsed:false},null,2));
