/** Offline deferred-page mechanics; synthetic history and timing are not
 * provider entitlement, real pool completeness or position-protection proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {NativeAuditSession,type NativeAuditPage} from '../src/native-audit-session.js';
import {auditNativeFlowWindow,type NativeFlowAuditOptions} from '../src/native-flow-audit.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';

const pool=bs58.encode(Buffer.alloc(32,9)),target={startAt:100000,endAt:160000};
function signature(id:number){const bytes=Buffer.alloc(64);bytes.writeUInt32LE(id);return bs58.encode(bytes);}
function note(id:number,slot:number,at:number):NativeNotification{return {signature:signature(id),slot,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null};}
function row(id:number,slot:number){return {signature:signature(id),slot,err:null,blockTime:100,confirmationStatus:'confirmed'};}
function fixture(pages=3,patch:Pick<Partial<NativeFlowAuditOptions>,'signal'>={}){
 let at=161000,physicalInFlight=false;
 const high=100+pages*100,history=Array.from({length:pages*100},(_,i)=>row(high-1-i,high-1-i)),notifications=[note(100,100,99900),...Array.from({length:pages*100-1},(_,i)=>note(101+i,101+i,100000+i*100)),note(high,high,160100)];
 const source={pool,target:{...target},notifications,now:()=>at,pageLimit:100 as const,...patch};
 const session=new NativeAuditSession({...source,deadlineAt:169999,maximumPages:Math.max(4,pages) as 4|5|6});
 return {session,source,history,get at(){return at;},advance(ms:number){at+=ms;},setPhysical(v:boolean){physicalInFlight=v;},get physicalInFlight(){return physicalInFlight;}};
}

for(const count of [2,3,4,5,6])test(`${count} deferred pages use existing validation and permit explicit controls between caller dispatches`,async()=>{
 const f=fixture(count),dispatches:NativeAuditPage[]=[],order:string[]=[];
 for(let page=1;page<=count;page++){
  await f.session.advance();assert.equal(f.session.result(),null);const pending=f.session.pending();assert.ok(pending);assert.equal(pending.page,page);assert.equal(pending.method,'getSignaturesForAddress');assert.equal(pending.options.admissionOpen?.(),true);assert.equal(pending.options.latestStartAt,169999);assert.equal((pending.params[1] as any).minContextSlot,100+count*100);
  const copy=f.session.pending()!;(copy.params[1] as any).before='MUTATED';assert.notEqual((f.session.pending()!.params[1] as any).before,'MUTATED','exposed requests cannot mutate the original cursor');
  order.push('control-'+page);assert.equal(f.session.pending()!.page,page,'control interleaving does not secretly dispatch history');
  dispatches.push(pending);f.advance(250);assert.equal(f.session.respond(page,f.history.slice((page-1)*100,page*100)),true);
  assert.equal(f.session.respond(page,[]),false,'duplicate response cannot settle a newer page');
 }
 await f.session.advance();const result=f.session.result();assert.ok(result);assert.equal(result.status,'verified');assert.equal(result.requestAttempts,count);assert.equal(result.historyRows,count*100);assert.equal(result.requiredSignatures.length,count*100-1);assert.equal(result.availableAt,f.at);assert.deepEqual(result.target,target);assert.equal(f.session.pending(),null);assert.equal(f.session.error(),null);assert.equal(dispatches.length,count);assert.equal(order.length,count);
 let comparisonAt=161000,index=0;const direct=await auditNativeFlowWindow({...f.source,now:()=>comparisonAt,call:async<T>()=>{comparisonAt+=250;return f.history.slice(index++*100,index*100) as T;},maximumPages:Math.max(4,count),maximumElapsedMs:8999});
 assert.deepEqual(result,direct,'resumption reuses the established auditor rather than duplicating validation');
});

test('late page identity and cancellation never release a caller-owned physical operation or create an audit pass',async()=>{
 const f=fixture();await f.session.advance();assert.equal(f.session.pending()!.page,1);f.advance(250);assert.equal(f.session.respond(1,f.history.slice(0,100)),true);await f.session.advance();assert.equal(f.session.pending()!.page,2);
 assert.equal(f.session.respond(1,[]),false);assert.equal(f.session.reject(1,Error('COMPONENT_HTTP_429')),false);assert.equal(f.session.pending()!.page,2);
 const outstanding=f.session.pending()!;f.setPhysical(true);f.session.cancel('NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');assert.equal(outstanding.signal.aborted,true);assert.equal(outstanding.options.admissionOpen?.(),false);assert.equal(f.physicalInFlight,true,'only the real shared gate can observe physical settlement');assert.equal(f.session.pending(),null);assert.equal(f.session.respond(2,[]),false);await f.session.advance();assert.equal(f.session.result(),null);assert.equal(f.session.error(),'NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');
});

test('same-bucket deadline expires deferred work without timers, hidden retries, later information or a false pass',async()=>{
 const f=fixture();await f.session.advance();const page=f.session.pending()!;f.advance(9000);assert.equal(f.at,170000);assert.equal(page.options.admissionOpen?.(),false);assert.equal(f.session.pending(),null);assert.equal(f.session.respond(1,f.history.slice(0,100)),false);await f.session.advance();assert.equal(f.session.result(),null);assert.equal(f.session.error(),'NATIVE_AUDIT_SESSION_DEADLINE');
});

test('provider refusal is returned by the existing helper with actual availability and no automatic retry',async()=>{
 const f=fixture();await f.session.advance();f.advance(500);assert.equal(f.session.reject(1,Object.assign(Error('COMPONENT_HTTP_429'),{retryAt:250000})),true);await f.session.advance();const result=f.session.result();assert.ok(result);assert.equal(result.status,'unavailable');assert.equal(result.reason,'COMPONENT_HTTP_429');assert.equal(result.retryAt,250000);assert.equal(result.availableAt,f.at);assert.equal(result.requestAttempts,1);assert.equal(f.session.pending(),null);
});

test('captured source inputs are immutable and existing malformed-history checks remain authoritative',async()=>{
 const f=fixture(2);f.source.notifications.length=0;f.source.target.startAt=0;await f.session.advance();const first=f.session.pending()!;f.advance(10);assert.equal(f.session.respond(first.page,[row(200,200),row(200,200)]),true);await f.session.advance();const result=f.session.result();assert.ok(result);assert.equal(result.status,'unavailable');assert.equal(result.reason,'NATIVE_AUDIT_HISTORY_CONTEXT');assert.equal(result.requiredSignatures.length,199);assert.deepEqual(result.target,{startAt:100000,endAt:160000});target.startAt=100000;
});

test('abort before or during a pending page is observable and never starts a physical client',async()=>{
 for(const early of [false,true]){const controller=new AbortController();if(early)controller.abort();const f=fixture(2,{signal:controller.signal});await f.session.advance();if(!early){assert.ok(f.session.pending());controller.abort();}await f.session.advance();assert.equal(f.session.pending(),null);assert.equal(f.session.result(),null);assert.equal(f.session.error(),'NATIVE_AUDIT_SESSION_ABORTED');}
});

test('custom audit injection still receives only a deferred caller and the original fixed bucket deadline',async()=>{
 let captured:NativeFlowAuditOptions|undefined;const f=fixture(2);
 const custom=new NativeAuditSession({...f.source,deadlineAt:169000,maximumPages:2,audit:async options=>{captured=options;return auditNativeFlowWindow(options);}});await custom.advance();assert.ok(captured);assert.equal(captured.maximumPages,2);assert.equal(captured.maximumElapsedMs,8000);assert.equal(custom.pending()!.page,1);custom.cancel();await custom.advance();
 for(const deadlineAt of [161000,170000,180001])assert.throws(()=>new NativeAuditSession({...f.source,deadlineAt}),/SESSION_DEADLINE/);
 f.session.cancel();await f.session.advance();
});


test('complete validation available only after the fixed deadline is never admitted as an earlier pass',async()=>{
 let at=161000;const f=fixture(2),session=new NativeAuditSession({...f.source,now:()=>at,deadlineAt:169999,maximumPages:2,audit:async options=>{const result=await auditNativeFlowWindow(options);at=170000;return result;}});
 await session.advance();assert.equal(session.respond(1,f.history.slice(0,100)),true);await session.advance();assert.equal(session.respond(2,f.history.slice(100,200)),true);await session.advance();assert.equal(session.result(),null);assert.equal(session.error(),'NATIVE_AUDIT_SESSION_DEADLINE');const diagnostic=session.diagnosticResult();assert.ok(diagnostic);assert.equal(diagnostic.status,'verified');assert.equal(diagnostic.complete,true);assert.equal(diagnostic.availableAt,161000,'historical helper availability is preserved without backdating the delayed wrapper admission');f.session.cancel();await f.session.advance();
});


test('oversized retained source input is refused before a cloning or deferred-call session',()=>{
 const f=fixture(2);assert.throws(()=>new NativeAuditSession({...f.source,notifications:Array(8193).fill(f.source.notifications[0]),deadlineAt:169999}),/SESSION_INPUT_BOUND/);f.session.cancel();
});

test('adaptive deferred pages expose their actual100 then1000 limits and count each physical page separately',async()=>{
 let at=161000;const history=Array.from({length:103},(_,i)=>row(202-i,202-i)),notifications=Array.from({length:9},(_,i)=>note(101+i,101+i,110000+i*1000));const session=new NativeAuditSession({pool,target,notifications,pageLimit:1000,adaptivePageSizing:true,completenessScope:'executed-transactions',contextFences:{lower:{slot:100,availableAt:99900},upper:{slot:110,availableAt:160500,bankClockAt:160000}},now:()=>at,deadlineAt:169999});await session.advance();let p=session.pending()!;assert.equal(p.requestedLimit,100);assert.equal((p.params[1] as any).limit,100);at+=200;assert.equal(session.respond(p.page,history.slice(0,100)),true);await session.advance();assert.equal(session.result(),null);p=session.pending()!;assert.equal(p.page,2);assert.equal(p.requestedLimit,1000);assert.equal((p.params[1] as any).before,signature(103));assert.equal((p.params[1] as any).minContextSlot,110);at+=200;assert.equal(session.respond(p.page,history.slice(100)),true);await session.advance();const result=session.result()!;assert.equal(result.status,'verified');assert.equal(result.requestAttempts,2);assert.equal(result.historyRows,103);assert.equal(result.availableAt,at);assert.deepEqual(result.pages.map(p=>p.requestedLimit),[100,1000]);assert.equal(result.notificationCompletenessVerified,true);assert.equal(session.pending(),null);
});

test('adaptive escalation cannot survive cancellation or the original same-bucket deadline',async()=>{
 for(const cancel of [true,false]){let at=161000;const history=Array.from({length:103},(_,i)=>row(202-i,202-i)),notifications=Array.from({length:9},(_,i)=>note(101+i,101+i,110000+i*1000)),session=new NativeAuditSession({pool,target,notifications,pageLimit:1000,adaptivePageSizing:true,contextFences:{lower:{slot:100,availableAt:99900},upper:{slot:110,availableAt:160500,bankClockAt:160000}},now:()=>at,deadlineAt:169999});await session.advance();assert.equal(session.respond(1,history.slice(0,100)),true);await session.advance();const p=session.pending()!;assert.equal(p.requestedLimit,1000);if(cancel)session.cancel('NATIVE_AUDIT_SOURCE_GENERATION_CHANGED');else at=170000;assert.equal(p.options.admissionOpen?.(),false);assert.equal(session.respond(2,history.slice(100)),false);await session.advance();assert.equal(session.result(),null);assert.equal(session.error(),cancel?'NATIVE_AUDIT_SOURCE_GENERATION_CHANGED':'NATIVE_AUDIT_SESSION_DEADLINE');assert.equal(session.diagnosticResult()?.complete,false);assert.equal(session.diagnosticResult()?.pages.length,1);}
});
