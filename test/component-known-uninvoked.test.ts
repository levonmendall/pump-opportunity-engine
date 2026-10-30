/** OFFLINE durability and compatibility. No provider or financial state. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ComponentBudget,componentKnownUninvokedReservations,componentPacingBaselineStarts,COMPONENT_KNOWN_UNINVOKED_KIND} from '../src/component-budget.js';
const MIB=1024*1024,HTTP={transport:'http' as const,method:'getMultipleAccounts'},turn=()=>new Promise<void>(r=>setImmediate(r));
function fixture(t:TestContext,beforePersist?:(write:number,advance:(ms:number)=>void)=>void){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-uninvoked-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));let at=200000,writes=0;
 const options={statePath:join(directory,'book.json'),grantId:'known-uninvoked-fixture',baseline:{calls:1,bytes:0,starts:[1000],refusal:'RPC_HTTP_429' as const,refusalAt:2000,sha256:'a'.repeat(64)},startedAt:at,continuousAccounting:true as const,now:()=>at,monotonic:()=>at,sleep:async(ms:number)=>{at+=ms;},beforePersist:()=>beforePersist?.(++writes,ms=>{at+=ms;}),limits:{maxCumulativeUnits:null,maxCumulativeBytes:null,minSpacingMs:250,maxStartsPerMinute:90,maxStartsPer10s:20}};
 return {options,read:()=>JSON.parse(readFileSync(options.statePath,'utf8')),now:()=>at};
}

test('only a durable pre-transport refusal excludes physical pacing; every allocated unit, pending byte and operation ID survives reopen',async t=>{
 const f=fixture(t),b=new ComponentBudget(f.options);let transports=0;
 await assert.rejects(b.operate(HTTP,async()=>{transports++;},undefined,{admissionOpen:()=>b.usage().pending.length===0}),/ADMISSION_CLOSED/);await turn();
 const u=b.usage(),raw=f.read();assert.equal(transports,0);assert.equal(u.cumulativeUnits,2);assert.equal(u.newUnits,1);assert.equal(u.actualInvokedUnits,0);assert.equal(u.provenUninvokedCurrentUnits,1);assert.equal(u.rolling10SecondStarts,0);assert.equal(u.rolling60SecondStarts,0);assert.equal(u.uncertainResponseBytes,2*MIB);assert.deepEqual(u.reservationStarts,[200000]);assert.equal(u.pending.length,1);
 assert.deepEqual(raw.knownUninvokedReservations,[{kind:COMPONENT_KNOWN_UNINVOKED_KIND,id:2,attestedAt:200000,reasonCode:'COMPONENT_ADMISSION_CLOSED'}]);assert.equal(raw.pending[0].reservedBytes,2*MIB);assert.deepEqual(raw.actualInvocations,[]);
 b.close();const reopened=new ComponentBudget(f.options);try{const after=reopened.usage();assert.equal(after.provenUninvokedCurrentUnits,1);assert.equal(after.rolling10SecondStarts,0);assert.equal(after.cumulativeUnits,2);assert.equal(after.pending.length,1);assert.equal(after.uncertainResponseBytes,2*MIB);await assert.rejects(reopened.operate(HTTP,async()=>{}),/HALTED/);}finally{reopened.close();}
});

test('an identical refusal string thrown after transport invocation cannot manufacture a never-invoked proof',async t=>{
 const f=fixture(t),b=new ComponentBudget(f.options);try{let calls=0;await assert.rejects(b.operate(HTTP,async()=>{calls++;throw Error('COMPONENT_ADMISSION_CLOSED');}),/ADMISSION_CLOSED/);await turn();const u=b.usage();assert.equal(calls,1);assert.equal(u.provenUninvokedCurrentUnits,0);assert.equal(u.actualInvokedUnits,1);assert.equal(u.rolling10SecondStarts,1);assert.equal(u.uncertainResponseBytes,2*MIB);assert.equal(f.read().knownUninvokedReservations,undefined);}finally{b.close();}
});

test('failed proof persistence leaves the reservation conservative and does not publish an exclusion',async t=>{
 const f=fixture(t,write=>{if(write===3)throw Error('OFFLINE storage failure while persisting attestation');}),b=new ComponentBudget(f.options);try{await assert.rejects(b.operate(HTTP,async()=>{},undefined,{admissionOpen:()=>b.usage().pending.length===0}),/STORAGE_UNAVAILABLE/);await turn();const u=b.usage();assert.equal(u.storageFailed,true);assert.equal(u.provenUninvokedCurrentUnits,0);assert.equal(u.rolling10SecondStarts,1);assert.equal(u.actualInvokedUnits,0);assert.equal(u.cumulativeUnits,2);assert.equal(u.uncertainResponseBytes,2*MIB);assert.equal(f.read().knownUninvokedReservations,undefined);}finally{b.close();}
});

test('post-reservation deadline expiry is attested without invoking transport or changing allocated accounting',async t=>{
 const f=fixture(t,(write,advance)=>{if(write===2)advance(20);}),b=new ComponentBudget(f.options);try{let calls=0;await assert.rejects(b.operate(HTTP,async()=>{calls++;},undefined,{latestStartAt:200010}),/DISPATCH_EXPIRED/);await turn();assert.equal(calls,0);assert.equal(b.usage().provenUninvokedCurrentUnits,1);assert.equal(b.usage().cumulativeUnits,2);assert.equal(b.usage().rolling10SecondStarts,0);assert.equal(f.read().knownUninvokedReservations[0].reasonCode,'COMPONENT_DISPATCH_EXPIRED');}finally{b.close();}
});

test('post-reservation cancellation is attested only before transport invocation',async t=>{
 const controller=new AbortController(),f=fixture(t,write=>{if(write===2)queueMicrotask(()=>controller.abort());}),b=new ComponentBudget(f.options);try{let calls=0;await assert.rejects(b.operate(HTTP,async()=>{calls++;},controller.signal),/ABORTED/);await turn();assert.equal(calls,0);assert.equal(b.usage().provenUninvokedCurrentUnits,1);assert.equal(b.usage().uncertainResponseBytes,2*MIB);assert.equal(f.read().knownUninvokedReservations[0].reasonCode,'COMPONENT_ABORTED');}finally{b.close();}
});

test('invalid, spliced, duplicate, ambiguous and partial proof records never exclude pacing',async t=>{
 const f=fixture(t),b=new ComponentBudget(f.options);await assert.rejects(b.operate(HTTP,async()=>{},undefined,{admissionOpen:()=>b.usage().pending.length===0}),/ADMISSION_CLOSED/);await turn();const raw=f.read();b.close();
 const mutations:Array<(v:any)=>void>=[v=>delete v.knownUninvokedReservations,v=>v.knownUninvokedReservations={},v=>v.knownUninvokedReservations[0].kind='forged',v=>v.knownUninvokedReservations.push({...v.knownUninvokedReservations[0]}),v=>v.knownUninvokedReservations[0].id=1,v=>v.knownUninvokedReservations[0].id=3,v=>v.knownUninvokedReservations[0].attestedAt=199999,v=>v.knownUninvokedReservations[0].attestedAt=200001,v=>v.knownUninvokedReservations[0].reasonCode='https://private-provider.invalid/token',v=>v.knownUninvokedReservations[0].extra=true,v=>v.actualInvocations.push({id:2,at:200000}),v=>delete v.actualInvocations,v=>v.pending=[],v=>v.pending[0].reservedBytes=1];
 for(const mutate of mutations){const changed=structuredClone(raw);mutate(changed);assert.deepEqual(componentKnownUninvokedReservations(changed),[]);}
 assert.equal(componentKnownUninvokedReservations(raw).length,1);assert.deepEqual(componentPacingBaselineStarts({starts:[1,1,2]},[1]),[1,2]);
 for(const invalid of [[1,1,1],[3],[-1],[Number.NaN],null,{}])assert.deepEqual(componentPacingBaselineStarts({starts:[1,1,2]},invalid as any),[1,1,2]);
});
