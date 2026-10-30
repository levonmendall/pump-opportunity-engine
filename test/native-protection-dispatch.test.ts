import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeProtectionDispatch} from '../src/native-protection-dispatch.js';
import {pilotLowerPriorityAdmission} from '../src/pilot.js';

test('multi-operation candidate workload yields actual protection before each threatened completion envelope',async t=>{
 let at=100000,last=at,source=true,busy=false,attempts=0;const completions=[last],events:any[]=[];
 const runway=(bound:number)=>pilotLowerPriorityAdmission({now:at,endAt:1000000,held:1,lastUsable:last,nextPendingAt:null,operationBoundMs:bound}).admitted;
 const scheduler=new NativeProtectionDispatch({now:()=>at,sourceWork:()=>source,owned:()=>true,runway,physicalIdle:()=>!busy,financialIdle:()=>true,record:(_kind,data)=>events.push(data),protect:async()=>{assert.equal(busy,false);attempts++;source=false;busy=true;at+=150;last=at;completions.push(last);busy=false;source=true;}});
 // One logical candidate step performs 80 physical-sized operations without
 // returning to the main loop. Injected timing only; no provider reliability
 // claim. Each physical operation remains subject to its own admission check.
 for(let n=0;n<80;n++){
  await scheduler.beforeSourceRead(1200);assert.equal(runway(1200),true);busy=true;at+=300;busy=false;
 }
 assert.ok(attempts>=15);assert.ok(completions.slice(1).every((v,i)=>v-completions[i]!<=4000));
 assert.ok(events.every(e=>e.protectionCompletionClaimed===false&&e.runwayRestored===true));
 assert.equal(scheduler.usage().yielded,attempts);assert.equal(scheduler.usage().failed,0);
 t.diagnostic(JSON.stringify({classification:'LOCAL_INJECTED_MULTI_OPERATION_SOURCE_STEP',candidatePhysicalSegments:80,protectionAttempts:attempts,completedEvaluations:completions.length-1,maximumCompletedGapMs:Math.max(...completions.slice(1).map((v,i)=>v-completions[i]!)),providerRequests:0}));
});

test('failed or busy protection never invents a completion or opens candidate admission',async()=>{
 let busy=true,attempts=0;const events:any[]=[];
 const scheduler=new NativeProtectionDispatch({sourceWork:()=>true,owned:()=>true,runway:()=>false,physicalIdle:()=>!busy,financialIdle:()=>true,record:(_kind,data)=>events.push(data),protect:async()=>{attempts++;throw Error('provider unavailable');}});
 await scheduler.beforeSourceRead(1200);assert.equal(attempts,0);assert.equal(scheduler.usage().busyRefusals,1);
 busy=false;await scheduler.beforeSourceRead(1200);assert.equal(attempts,1);assert.equal(scheduler.usage().failed,1);
 assert.equal(events[0].runwayRestored,false);assert.equal(events[0].protectionCompletionClaimed,false);
});

test('concurrent source callers share one yielded protection operation and preserve caller deadlines',async()=>{
 let release!:()=>void,attempts=0;let source=true;
 const scheduler=new NativeProtectionDispatch({sourceWork:()=>source,owned:()=>true,runway:()=>false,physicalIdle:()=>true,financialIdle:()=>true,record(){},protect:async()=>{attempts++;await new Promise<void>(r=>{release=r;});}});
 const first=scheduler.beforeSourceRead(1200),second=scheduler.beforeSourceRead(1200);assert.equal(attempts,1);
 release();await Promise.all([first,second]);assert.equal(scheduler.usage().yielded,1);
 source=false;await scheduler.beforeSourceRead(1200);assert.equal(attempts,1);
});
