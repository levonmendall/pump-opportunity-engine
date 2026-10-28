/** Deterministic signature-history audit mechanics. These synthetic identities
 * and timings are not forward market coverage, swaps, or financial evidence. */
import{test}from'node:test';import assert from'node:assert/strict';import bs58 from'bs58';
import{auditNativeFlowWindow,type NativeFlowAuditOptions}from'../src/native-flow-audit.js';
import type{NativeNotification}from'../src/pilot-native-flow.js';
import type{PilotRpcCallOptions}from'../src/pilot-rpc.js';
const pool=bs58.encode(Buffer.alloc(32,9)),target={startAt:100000,endAt:160000};
function signature(id:number){const bytes=Buffer.alloc(64);bytes.writeUInt32LE(id);return bs58.encode(bytes);}
function note(id:number,slot:number,at:number,patch:Partial<NativeNotification>={}):NativeNotification{return {signature:signature(id),slot,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null,...patch};}
function row(id:number,slot:number,success=true){return {signature:signature(id),slot,err:success?null:{InstructionError:[0,{Custom:1}]},blockTime:Math.floor(target.startAt/1000),confirmationStatus:'confirmed'};}
function fixture(config:{notes?:NativeNotification[];pages?:unknown[][];delayMs?:number;recordDelayMs?:number;throwCode?:string}={}){
 let at=161000;const calls:Array<{method:string;params:unknown[];options?:PilotRpcCallOptions}>=[],records:Array<{kind:string;data:any}>=[];
 const notifications=config.notes??[note(1,100,99900),note(2,110,110000),note(3,200,160100)],pages=config.pages??[[row(2,110),row(1,100),row(4,90)]];
 const options:NativeFlowAuditOptions={pool,notifications,target,now:()=>at,call:async<T>(method:string,params:unknown[],signal?:AbortSignal,admission?:PilotRpcCallOptions):Promise<T>=>{signal?.throwIfAborted();assert.equal(method,'getSignaturesForAddress');assert.ok([100,1000].includes((params[1] as any).limit));assert.equal((params[1] as any).commitment,'confirmed');assert.ok(admission?.admissionOpen?.());calls.push({method,params:structuredClone(params),options:admission});at+=config.delayMs??25;if(config.throwCode)throw Object.assign(Error(config.throwCode),{retryAt:at+65000});return structuredClone(pages[calls.length-1]??[]) as T;},record(kind,data){records.push({kind,data:structuredClone(data)});at+=config.recordDelayMs??0;}};
 return {options,calls,records,get now(){return at;}};
}

test('strict interior signature audit verifies a complete target using actual pre/post window fences',async()=>{
 const f=fixture(),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'verified');assert.equal(r.complete,true);assert.equal(r.requestAttempts,1);assert.equal(r.availableAt,f.now);assert.ok(r.availableAt>r.target.endAt);assert.deepEqual(r.strictInteriorSlots,{lower:100,upper:200});assert.equal(r.anchor?.signature,signature(3));assert.equal((f.calls[0]!.params[1] as any).before,signature(3));assert.equal((f.calls[0]!.params[1] as any).limit,100);assert.equal((f.calls[0]!.params[1] as any).minContextSlot,200);assert.equal(r.pageLimit,100);assert.equal(r.historyRows,3);assert.equal(r.interiorRows,1);assert.deepEqual(r.requiredSignatures,[signature(2)]);assert.deepEqual(r.missingNotifications,[]);assert.equal(r.historyRangeCovered,true);assert.ok(r.limitations.some(s=>s.includes('not')&&s.includes('swap')));
});

test('failed and nontrade captured signatures participate without becoming executed trades',async()=>{
 const f=fixture({notes:[note(1,100,99900),note(2,110,110000,{success:false,classification:'failed-transaction',parsedEvents:0,eventsAccepted:0}),note(5,120,120000,{classification:'nontrade',parsedEvents:0,eventsAccepted:0}),note(3,200,160100)],pages:[[row(5,120),row(2,110,false),row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'verified');assert.equal(r.requiredSignatures.length,2);assert.equal(r.interiorRows,2);assert.equal(r.statusDisagreements.length,0);
});

test('an unobserved successful or failed interior pool transaction makes the window unusable without inventing a swap',async()=>{
 for(const success of [true,false]){const f=fixture({pages:[[row(5,120,success),row(2,110),row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'unusable');assert.equal(r.complete,false);assert.match(r.reason,/HISTORY_SIGNATURE_NOT_OBSERVED/);assert.equal(r.missingNotifications[0]!.signature,signature(5));assert.equal(r.missingNotifications[0]!.success,success);assert.equal(Object.hasOwn(r.missingNotifications[0]!,'side'),false);assert.equal(f.calls.length,1);}
});

test('a target signature absent from independent history is unavailable, not a silent complete pass',async()=>{
 const f=fixture({pages:[[row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'unavailable');assert.match(r.reason,/CAPTURED_TARGET_NOT_IN_HISTORY/);assert.deepEqual(r.unconfirmedCapturedSignatures,[signature(2)]);
});

test('same-slot target boundaries and missing before/after fences cannot establish coverage',async()=>{
 for(const notes of [[note(1,100,99900),note(2,100,110000),note(3,200,160100)],[note(1,100,99900),note(2,110,110000),note(3,110,160100)],[note(2,110,110000),note(3,200,160100)],[note(1,100,99900),note(2,110,110000)]]){const f=fixture({notes}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'unavailable');assert.match(r.reason,/FENCE|BOUNDARY/);assert.equal(f.calls.length,0);}
});

test('three bounded history pages follow actual last-row cursors and cover all required unique signatures',async()=>{
 const history=Array.from({length:400},(_,i)=>row(399-i,399-i)),notes=[note(100,100,99900),...Array.from({length:299},(_,i)=>note(i+101,i+101,100000+i*100)),note(400,400,160100)],f=fixture({notes,pages:[history.slice(0,100),history.slice(100,200),history.slice(200,300),history.slice(300)]}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'verified');assert.equal(f.calls.length,3);assert.equal(r.interiorRows,299);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).before),[signature(400),signature(300),signature(200)]);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).minContextSlot),[400,400,400]);assert.equal(r.pages[2]!.oldestSlot,100);assert.equal(r.requiredSignatures.length,299);
});

test('saturated four-page history retains an explicit incomplete denominator and performs no fifth read',async()=>{
 const history=Array.from({length:400},(_,i)=>row(499-i,499-i)),notes=[note(0,0,99900),...history.map((h,i)=>note(499-i,h.slot,100000+i*100)),note(500,500,160100)],f=fixture({notes,pages:[0,100,200,300].map(i=>history.slice(i,i+100))}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'unavailable');assert.match(r.reason,/HISTORY_RANGE_NOT_COVERED/);assert.equal(r.historyRangeCovered,false);assert.equal(r.requestAttempts,4);assert.equal(f.calls.length,4);assert.equal(r.historyRows,400);
});

test('duplicate capture preserves the earliest availability; corrections and confirmed status disagreement are not accepted',async()=>{
 const duplicate=fixture({notes:[note(1,100,99900),note(2,110,110000),note(2,110,160200,{duplicate:true}),note(3,200,160100)]}),pass=await auditNativeFlowWindow(duplicate.options);assert.equal(pass.status,'verified');assert.equal(pass.duplicateNotifications,1);assert.deepEqual(pass.requiredSignatures,[signature(2)]);assert.equal(pass.anchor?.signature,signature(3),'an old duplicated target event is not a new post-window chain fence');
 const corrected=fixture({notes:[note(1,100,99900),note(2,110,110000),note(2,110,120000,{correction:true,rawHash:'b'.repeat(64)}),note(3,200,160100)]}),failure=await auditNativeFlowWindow(corrected.options);assert.equal(failure.status,'unusable');assert.match(failure.reason,/CORRECTION/);assert.equal(corrected.calls.length,0);
 const mismatch=await auditNativeFlowWindow(fixture({pages:[[row(2,110,false),row(1,100),row(4,90)]]}).options);assert.equal(mismatch.status,'unusable');assert.match(mismatch.reason,/STATUS_DISAGREEMENT/);
});

test('malformed and duplicate independent history rows fail closed without extra requests',async()=>{
 for(const page of [[row(2,110),row(2,110)], [{...row(2,110),confirmationStatus:'processed'}],[row(2,110),row(1,120)],[{...row(2,110),signature:'invented'}]]){const f=fixture({pages:[page]}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'unavailable');assert.match(r.reason,/HISTORY_CONTEXT/);assert.equal(f.calls.length,1);}
});

test('provider refusal, elapsed time, abort and closed admission retain honest availability and never retry',async()=>{
 const refused=fixture({throwCode:'COMPONENT_HTTP_429'}),r=await auditNativeFlowWindow(refused.options);assert.equal(r.status,'unavailable');assert.equal(r.reason,'COMPONENT_HTTP_429');assert.equal(r.retryAt,refused.now+65000);assert.equal(refused.calls.length,1);
 const late=fixture({delayMs:20}),expired=await auditNativeFlowWindow({...late.options,maximumElapsedMs:10});assert.equal(expired.status,'unavailable');assert.match(expired.reason,/ELAPSED_LIMIT/);assert.equal(late.calls.length,1);assert.equal(expired.availableAt,late.now);
 const blocked=fixture(),deferred=await auditNativeFlowWindow({...blocked.options,admission:{admissionOpen:()=>false,latestStartAt:170000}});assert.equal(deferred.status,'unavailable');assert.equal(blocked.calls.length,0);
 const aborted=fixture(),controller=new AbortController();controller.abort();assert.equal((await auditNativeFlowWindow({...aborted.options,signal:controller.signal})).status,'unavailable');assert.equal(aborted.calls.length,0);
});

test('recording delay is included in audit availability and immutable source-window timestamps are never backdated',async()=>{
 const f=fixture({recordDelayMs:40}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'verified');assert.equal(r.availableAt,161065);assert.equal(r.target.startAt,100000);assert.equal(r.target.endAt,160000);assert.equal(r.pages[0]!.receivedAt,161025);assert.equal(r.pages[0]!.validatedAt,161065);assert.ok(r.availableAt>r.pages[0]!.receivedAt);
});

test('quiet interval can verify bounded signature absence only with genuine temporal fences and independent history coverage',async()=>{
 const f=fixture({notes:[note(1,100,99900),note(3,200,160100)],pages:[[row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow(f.options);assert.equal(r.status,'verified');assert.equal(r.requiredSignatures.length,0);assert.equal(r.interiorRows,0);assert.equal(r.historyRangeCovered,true);assert.ok(r.limitations.some(x=>x.includes('fresh complete source window')));
});

test('invalid target, candidate identity and excessive input bounds perform no provider request',async()=>{
 for(const patch of [{pool:'invalid'},{target:{startAt:100000,endAt:150000}},{maximumPages:5},{maximumElapsedMs:10001},{target:{startAt:110000,endAt:170000}}]){const f=fixture(),r=await auditNativeFlowWindow({...f.options,...patch});assert.equal(r.status,'unavailable');assert.equal(f.calls.length,0);}
});

test('fresh coherent bank Clock ceiling independently audits quiet history without an invented notification anchor',async()=>{
 const f=fixture({notes:[],pages:[[row(5,500),row(4,400),row(2,200),row(1,190)]]}),contextFences={lower:{slot:200,availableAt:99900,bankClockAt:99000},upper:{slot:400,availableAt:160500,bankClockAt:160000}},r=await auditNativeFlowWindow({...f.options,contextFences});assert.equal(r.status,'verified');assert.equal(r.anchorKind,'confirmed-bank-context');assert.equal(r.anchor,null);assert.equal(Object.hasOwn(f.calls[0]!.params[1] as object,'before'),false);assert.deepEqual(r.strictInteriorSlots,{lower:200,upper:400});assert.equal(r.requiredSignatures.length,0);assert.equal(r.interiorRows,0);assert.equal(r.historyRows,4);assert.equal(r.historyRangeCovered,true);assert.ok(r.boundaryExcludedSignatures.includes(signature(4)));assert.equal(r.contextFences?.upper.bankClockAt,160000);assert.equal((f.calls[0]!.params[1] as any).minContextSlot,400);
});

test('old, future or time-unbound context ceilings are unavailable before any history request',async()=>{
 for(const upper of [{slot:400,availableAt:160500,bankClockAt:159999},{slot:400,availableAt:161001,bankClockAt:160000},{slot:400,availableAt:160500,bankClockAt:160501}]){const f=fixture({notes:[]}),r=await auditNativeFlowWindow({...f.options,contextFences:{lower:{slot:200,availableAt:99900},upper}});assert.equal(r.status,'unavailable');assert.match(r.reason,/CONTEXT_FENCE_INVALID_OR_STALE/);assert.equal(f.calls.length,0);}
 const f=fixture({notes:[]}),r=await auditNativeFlowWindow({...f.options,target:{startAt:60000,endAt:120000},contextFences:{lower:{slot:100,availableAt:50000},upper:{slot:400,availableAt:150000,bankClockAt:130000}}});assert.equal(r.status,'unavailable');assert.equal(f.calls.length,0);
});

test('context quiet audit still rejects unobserved interior activity and ambiguous target boundary slots',async()=>{
 const contextFences={lower:{slot:100,availableAt:99900},upper:{slot:200,availableAt:160500,bankClockAt:160000}},missing=fixture({notes:[],pages:[[row(5,120),row(1,100),row(4,90)]]}),bad=await auditNativeFlowWindow({...missing.options,contextFences});assert.equal(bad.status,'unusable');assert.equal(bad.missingNotifications[0]!.signature,signature(5));
 const boundary=fixture({notes:[note(2,200,110000)]}),unknown=await auditNativeFlowWindow({...boundary.options,contextFences});assert.equal(unknown.status,'unavailable');assert.match(unknown.reason,/BOUNDARY_AMBIGUOUS/);assert.equal(boundary.calls.length,0);
});

test('empty independent history does not prove quietness when it never reaches the known lower context',async()=>{
 const f=fixture({notes:[],pages:[[]]}),r=await auditNativeFlowWindow({...f.options,contextFences:{lower:{slot:100,availableAt:99900},upper:{slot:200,availableAt:160500,bankClockAt:160000}}});assert.equal(r.status,'unavailable');assert.equal(r.historyRangeCovered,false);assert.equal(r.requestAttempts,1);
});

test('a genuine newer pre-window notification narrows context history without hiding target activity',async()=>{
 const f=fixture({notes:[note(2,200,99900),note(3,250,110000)],pages:[[row(3,250),row(2,200),row(5,150),row(1,100)]]}),r=await auditNativeFlowWindow({...f.options,contextFences:{lower:{slot:100,availableAt:90000},upper:{slot:400,availableAt:160500,bankClockAt:160000}}});assert.equal(r.status,'verified');assert.equal(r.strictInteriorSlots?.lower,200);assert.equal(r.lowerFence?.signature,signature(2));assert.equal(r.contextFences?.lower.slot,100,'original context provenance is retained');assert.equal(r.interiorRows,1);assert.deepEqual(r.comparedSignatures,[signature(3)]);assert.equal(r.missingNotifications.length,0);
});

test('SYNTHETIC busy1000-row page verifies every strict-interior signature in one bounded callback',async()=>{
 const history=Array.from({length:1000},(_,i)=>row(1099-i,1099-i)),notes=[note(100,100,99900),...Array.from({length:999},(_,i)=>note(101+i,101+i,100000+i*50)),note(1100,1100,160100)],f=fixture({notes,pages:[history]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,maximumPages:1,maximumElapsedMs:2000});assert.equal(r.status,'verified');assert.equal(r.pageLimit,1000);assert.equal((f.calls[0]!.params[1] as any).limit,1000);assert.equal(r.requestAttempts,1);assert.equal(r.interiorRows,999);assert.equal(r.requiredSignatures.length,999);assert.equal(r.historyRangeCovered,true);assert.equal(r.missingNotifications.length,0);assert.ok(r.historyPayloadBytes<1024*1024);
 const missing=fixture({notes:notes.filter(n=>n.signature!==signature(550)),pages:[history]}),unusable=await auditNativeFlowWindow({...missing.options,pageLimit:1000,maximumPages:1});assert.equal(unusable.status,'unusable');assert.equal(unusable.missingNotifications[0]!.signature,signature(550));assert.equal(missing.calls.length,1);
});

test('saturated1000 history that cannot reach its lower fence is explicit capacity-unknown, never a partial pass',async()=>{
 const history=Array.from({length:1000},(_,i)=>row(1199-i,1199-i)),notes=[note(100,100,99900),...history.map((r,i)=>note(1199-i,r.slot,100000+i*50)),note(1200,1200,160100)];
 const f=fixture({notes,pages:[history]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,maximumPages:1});assert.equal(r.status,'unavailable');assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN');assert.equal(r.historyRangeCovered,false);assert.equal(r.historyRows,1000);assert.equal(f.calls.length,1);
 const short=fixture({notes,pages:[history.slice(0,999)]}),unknown=await auditNativeFlowWindow({...short.options,pageLimit:1000,maximumPages:1});assert.equal(unknown.status,'unavailable');assert.equal(unknown.reason,'NATIVE_AUDIT_HISTORY_RANGE_NOT_COVERED');assert.equal(short.calls.length,1);
});

test('1000-row response has an explicit1MiB processing bound and preserves known rejected payload bytes',async()=>{
 const page=Array.from({length:1000},(_,i)=>({...row(1199-i,1199-i),memo:'x'.repeat(1100)})),f=fixture({pages:[page]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,maximumPages:1});assert.equal(r.status,'unavailable');assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_PAGE_PAYLOAD_LIMIT');assert.equal(r.historyPayloadBytes,Buffer.byteLength(JSON.stringify(page)));assert.ok(r.historyPayloadBytes>1024*1024);assert.equal(f.calls.length,1);
 const legacyPage=[{...row(2,110),memo:'x'.repeat(300*1024)},row(1,100),row(4,90)],legacy=fixture({pages:[legacyPage]}),limited=await auditNativeFlowWindow(legacy.options);assert.equal(limited.reason,'NATIVE_AUDIT_HISTORY_PAGE_PAYLOAD_LIMIT');assert.equal(limited.pageLimit,100);const larger=fixture({pages:[legacyPage]}),allowed=await auditNativeFlowWindow({...larger.options,pageLimit:1000,maximumPages:1});assert.equal(allowed.status,'verified');
});

test('1000-page mode preserves exact row validation, provider failure and accepted option values',async()=>{
 for(const page of [[row(2,110),row(2,110)],[row(2,110),row(1,120)],[{...row(2,110),confirmationStatus:'processed'}]]){const f=fixture({pages:[page]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,maximumPages:1});assert.equal(r.status,'unavailable');assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_CONTEXT');assert.equal(f.calls.length,1);}
 const refused=fixture({throwCode:'COMPONENT_HTTP_429'}),bad=await auditNativeFlowWindow({...refused.options,pageLimit:1000,maximumPages:1});assert.equal(bad.reason,'COMPONENT_HTTP_429');assert.equal(refused.calls.length,1);
 const invalid=fixture(),invalidResult=await auditNativeFlowWindow({...invalid.options,pageLimit:500 as any});assert.equal(invalidResult.reason,'NATIVE_AUDIT_INVALID_OPTIONS');assert.equal(invalid.calls.length,0);
});


test('a node behind the upper slot floor cannot verify quiet history in either fence mode',async()=>{
 for(const useClockFence of [false,true]){
  const f=fixture({notes:useClockFence?[]:[note(1,100,99900),note(3,200,160100)],pages:[[row(1,100),row(4,90)]],throwCode:'COMPONENT_RPC_ERROR_-32016'}),contextFences=useClockFence?{lower:{slot:100,availableAt:99900},upper:{slot:400,availableAt:160500,bankClockAt:160000}}:undefined;
  const r=await auditNativeFlowWindow({...f.options,...(contextFences?{contextFences}:{})});
  assert.equal(f.calls.length,1,'context-not-reached has no hidden retry');assert.equal((f.calls[0]!.params[1] as any).minContextSlot,useClockFence?400:200);assert.equal(r.reason,'COMPONENT_RPC_ERROR_-32016');assert.equal(r.status,'unavailable');assert.equal(r.complete,false);assert.equal(r.historyRangeCovered,false);assert.equal(r.pages.length,0);assert.equal(r.historyRows,0);assert.equal(r.requiredSignatures.length,0);assert.deepEqual(r.target,target);assert.equal(r.strictInteriorSlots?.upper,useClockFence?400:200);assert.equal(r.availableAt,f.now);
 }
});

test('Clock-fenced pagination retains the original served-node floor as history cursors move backward',async()=>{
 const history=Array.from({length:400},(_,i)=>row(399-i,399-i)),notes=Array.from({length:299},(_,i)=>note(i+101,i+101,100000+i*100)),f=fixture({notes,pages:[history.slice(0,100),history.slice(100,200),history.slice(200,300)]});
 const r=await auditNativeFlowWindow({...f.options,contextFences:{lower:{slot:100,availableAt:99900},upper:{slot:400,availableAt:160500,bankClockAt:160000}}});
 assert.equal(r.status,'verified');assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).minContextSlot),[400,400,400]);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).before),[undefined,signature(300),signature(200)]);assert.equal(r.interiorRows,299);
});

// Adaptive sizing is an opt-in transport optimization. Synthetic history sizes
// reproduce the relevant103/2200-row shapes; no market completeness is invented.
test('adaptive quiet audit requests100 rows and keeps the original strict coverage checks',async()=>{
 const f=fixture(),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,adaptivePageSizing:true});assert.equal(r.status,'verified');assert.equal(r.pageLimit,1000,'configured maximum is distinct from each physical request');assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[1] as any).limit,100);assert.equal(r.pages[0]!.requestedLimit,100);assert.equal(r.notificationCompletenessVerified,true);assert.equal(r.executedFlowCompletenessVerified,true);assert.equal(r.completenessScope,'all-notifications');
});

test('adaptive103-row quiet history escalates only after a full100-row page cannot reach the lower fence',async()=>{
 const history=Array.from({length:103},(_,i)=>row(202-i,202-i)),notes=[note(100,100,99900),...Array.from({length:9},(_,i)=>note(101+i,101+i,110000+i*1000))],f=fixture({notes,pages:[history.slice(0,100),history.slice(100)]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,adaptivePageSizing:true,contextFences:{lower:{slot:100,availableAt:99900},upper:{slot:110,availableAt:160500,bankClockAt:160000}}});assert.equal(r.status,'verified');assert.equal(r.historyRows,103);assert.equal(r.interiorRows,9);assert.equal(r.requiredSignatures.length,9);assert.equal(r.requestAttempts,2);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).limit),[100,1000]);assert.deepEqual(r.pages.map(p=>p.requestedLimit),[100,1000]);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).minContextSlot),[110,110]);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).before),[undefined,signature(103)]);assert.equal(r.historyRangeCovered,true);
});

test('adaptive busy2200-row history starts1000 and counts three separate physical pages without raising the cap',async()=>{
 const history=Array.from({length:2200},(_,i)=>row(2299-i,2299-i)),notes=[note(100,100,99900),...Array.from({length:2199},(_,i)=>note(101+i,101+i,100001+i*25)),note(2300,2300,160100)],f=fixture({notes,pages:[history.slice(0,1000),history.slice(1000,2000),history.slice(2000)]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,adaptivePageSizing:true});assert.equal(r.status,'verified');assert.equal(r.historyRows,2200);assert.equal(r.requiredSignatures.length,2199);assert.equal(r.requestAttempts,3);assert.equal(f.calls.length,3);assert.deepEqual(r.pages.map(p=>p.requestedLimit),[1000,1000,1000]);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).before),[signature(2300),signature(1300),signature(300)]);assert.equal(r.maximumPages,4);assert.equal(r.historyRangeCovered,true);
});

test('adaptive sizing refuses a response larger than the actual100 request and does not escalate a short uncovered page',async()=>{
 const extra=fixture({pages:[Array.from({length:101},(_,i)=>row(300-i,300-i))]}),oversized=await auditNativeFlowWindow({...extra.options,pageLimit:1000,adaptivePageSizing:true});assert.equal(oversized.status,'unavailable');assert.equal(oversized.reason,'NATIVE_AUDIT_HISTORY_PAGE_SCHEMA');assert.equal(extra.calls.length,1);assert.equal((extra.calls[0]!.params[1] as any).limit,100);
 const short=fixture({pages:[Array.from({length:99},(_,i)=>row(199-i,199-i))]}),incomplete=await auditNativeFlowWindow({...short.options,pageLimit:1000,adaptivePageSizing:true});assert.equal(incomplete.status,'unavailable');assert.equal(incomplete.reason,'NATIVE_AUDIT_HISTORY_RANGE_NOT_COVERED');assert.equal(short.calls.length,1);assert.equal(incomplete.historyRangeCovered,false);
});

test('adaptive history remains incomplete after four full pages and performs no fifth read',async()=>{
 const history=Array.from({length:4000},(_,i)=>row(4999-i,4999-i)),f=fixture({notes:[note(100,100,99900),note(5000,5000,160100)],pages:[history.slice(0,100),history.slice(100,1100),history.slice(1100,2100),history.slice(2100,3100)]}),r=await auditNativeFlowWindow({...f.options,pageLimit:1000,adaptivePageSizing:true});assert.equal(r.status,'unavailable');assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN');assert.equal(r.historyRows,3100);assert.equal(r.historyRangeCovered,false);assert.equal(r.requestAttempts,4);assert.deepEqual(f.calls.map(c=>(c.params[1] as any).limit),[100,1000,1000,1000]);assert.equal(r.notificationCompletenessVerified,false);assert.equal(r.executedFlowCompletenessVerified,false);
});

test('executed-flow scope retains independently failed missing packets as explicit diagnostics without claiming full notification coverage',async()=>{
 const f=fixture({pages:[[row(5,120,false),row(2,110),row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow({...f.options,completenessScope:'executed-transactions'});assert.equal(r.status,'verified');assert.equal(r.complete,true);assert.equal(r.reason,'NATIVE_AUDIT_EXECUTED_FLOW_VERIFIED_WITH_MISSING_FAILED_PACKETS');assert.equal(r.notificationCompletenessVerified,false);assert.equal(r.executedFlowCompletenessVerified,true);assert.equal(r.missingNotifications.length,1);assert.equal(r.missingFailedNotifications.length,1);assert.equal(r.missingSuccessfulNotifications.length,0);assert.equal(r.missingFailedNotifications[0]!.success,false);assert.equal(r.missingFailedNotifications[0]!.confirmationStatus,'confirmed');assert.equal(Object.hasOwn(r.missingFailedNotifications[0]!,'side'),false);assert.match(r.scope,/not full notification coverage/);
 const legacy=fixture({pages:[[row(5,120,false),row(2,110),row(1,100),row(4,90)]]}),strict=await auditNativeFlowWindow(legacy.options);assert.equal(strict.status,'unusable');assert.equal(strict.completenessScope,'all-notifications');assert.equal(strict.notificationCompletenessVerified,false);
});

test('executed-flow scope still rejects missing successful activity and every captured/history status reversal',async()=>{
 const missing=fixture({pages:[[row(5,120),row(2,110),row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow({...missing.options,completenessScope:'executed-transactions'});assert.equal(r.status,'unusable');assert.equal(r.reason,'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED');assert.equal(r.missingSuccessfulNotifications.length,1);assert.equal(r.executedFlowCompletenessVerified,false,'a successful history row is not assumed to be a harmless nontrade');
 for(const sourceSuccess of [true,false]){const f=fixture({notes:[note(1,100,99900),note(2,110,110000,{success:sourceSuccess,classification:sourceSuccess?'program-event':'failed-transaction'}),note(3,200,160100)],pages:[[row(2,110,!sourceSuccess),row(1,100),row(4,90)]]}),mismatch=await auditNativeFlowWindow({...f.options,completenessScope:'executed-transactions'});assert.equal(mismatch.status,'unusable');assert.equal(mismatch.reason,'NATIVE_AUDIT_CONFIRMED_STATUS_DISAGREEMENT');assert.deepEqual(mismatch.statusDisagreements,[signature(2)]);assert.equal(mismatch.executedFlowCompletenessVerified,false);}
});

test('a failed source hint without independently confirmed failed history remains unavailable, and malformed status cannot waive evidence',async()=>{
 const f=fixture({notes:[note(1,100,99900),note(2,110,110000,{success:false,classification:'failed-transaction'}),note(3,200,160100)],pages:[[row(1,100),row(4,90)]]}),r=await auditNativeFlowWindow({...f.options,completenessScope:'executed-transactions'});assert.equal(r.status,'unavailable');assert.equal(r.reason,'NATIVE_AUDIT_CAPTURED_TARGET_NOT_IN_HISTORY');assert.deepEqual(r.unconfirmedCapturedSignatures,[signature(2)]);assert.equal(r.executedFlowCompletenessVerified,false);
 for(const patch of [{confirmationStatus:'processed'},{err:undefined},{err:[]},{err:{}}]){const bad=fixture({pages:[[{...row(5,120,false),...patch},row(2,110),row(1,100)]]}),rejected=await auditNativeFlowWindow({...bad.options,completenessScope:'executed-transactions'});assert.equal(rejected.status,'unavailable');assert.equal(rejected.reason,'NATIVE_AUDIT_HISTORY_CONTEXT');}
 for(const patch of [{adaptivePageSizing:'yes'},{completenessScope:'missing-is-fine'}]){const bad=fixture(),rejected=await auditNativeFlowWindow({...bad.options,...patch} as any);assert.equal(rejected.reason,'NATIVE_AUDIT_INVALID_OPTIONS');assert.equal(bad.calls.length,0);}
});

test('adaptive paging preserves actual elapsed/refusal failures and never retries them as an escalation',async()=>{
 const history=Array.from({length:103},(_,i)=>row(202-i,202-i)),notes=Array.from({length:9},(_,i)=>note(101+i,101+i,110000+i*1000)),contextFences={lower:{slot:100,availableAt:99900},upper:{slot:110,availableAt:160500,bankClockAt:160000}},slow=fixture({notes,pages:[history.slice(0,100),history.slice(100)],delayMs:4500}),late=await auditNativeFlowWindow({...slow.options,pageLimit:1000,adaptivePageSizing:true,contextFences,maximumElapsedMs:8000});assert.equal(late.status,'unavailable');assert.equal(late.reason,'NATIVE_AUDIT_ELAPSED_LIMIT');assert.equal(late.requestAttempts,2);assert.equal(late.pages.length,1);assert.equal(late.availableAt,170000);assert.equal(late.notificationCompletenessVerified,false);assert.equal(late.executedFlowCompletenessVerified,false);assert.deepEqual(slow.calls.map(c=>(c.params[1] as any).limit),[100,1000]);
 const f=fixture({throwCode:'COMPONENT_HTTP_429'}),refused=await auditNativeFlowWindow({...f.options,pageLimit:1000,adaptivePageSizing:true});assert.equal(refused.reason,'COMPONENT_HTTP_429');assert.equal(refused.requestAttempts,1);assert.equal(refused.pages.length,0);assert.equal(f.calls.length,1);assert.equal((f.calls[0]!.params[1] as any).limit,100);
});

test('final admission clock failure clears packet and executed-flow completeness flags',async()=>{
 for(const regression of [false,true]){const f=fixture();let recorded=false,afterRecordClocks=0;const now=()=>{if(recorded&&++afterRecordClocks>=2)return regression?160999:171001;return 161000;};const r=await auditNativeFlowWindow({...f.options,adaptivePageSizing:true,pageLimit:1000,completenessScope:'executed-transactions',now,record(){recorded=true;}});assert.equal(r.status,'unavailable');assert.equal(r.complete,false);assert.equal(r.notificationCompletenessVerified,false);assert.equal(r.executedFlowCompletenessVerified,false);assert.equal(r.reason,regression?'NATIVE_AUDIT_CLOCK_REGRESSION':'NATIVE_AUDIT_ELAPSED_LIMIT');assert.equal(f.calls.length,1);assert.equal(r.historyRangeCovered,true,'retrieved history remains diagnostic, not a usable late result');}
});
