/** Offline synthetic strict-audit integration. No provider, ledger, source status
 * or wallet access; fewer HTTP starts are not measured provider capacity. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
import {auditNativeFlowWindowsBatch,type NativeAuditBatchJob,type NativeAuditHistoryBatchTransportResult,type NativeFlowAuditBatchOptions} from '../src/native-flow-audit-batch.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';
import type {PilotRpcCallOptions} from '../src/pilot-rpc.js';
const target={startAt:100000,endAt:160000};
const signature=(id:number)=>{const bytes=Buffer.alloc(64);bytes.writeUInt32LE(id);return bs58.encode(bytes);};
const pool=(id:number)=>bs58.encode(Buffer.alloc(32,id));
function note(id:number,slot:number,at:number,patch:Partial<NativeNotification>={}):NativeNotification{return{signature:signature(id),slot,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null,...patch};}
const row=(id:number,slot:number)=>({signature:signature(id),slot,err:null,blockTime:110,confirmationStatus:'confirmed'});
function job(id:number,patch:Partial<NativeAuditBatchJob['audit']>={}):NativeAuditBatchJob{return{key:'candidate-'+id,audit:{pool:pool(id),target,notifications:[note(id*10+1,100,99900),note(id*10+2,110,110000),note(id*10+3,200,160100)],maximumElapsedMs:2000,pageLimit:1000,...patch}};}
function fixture(jobs:NativeAuditBatchJob[],change:{results?:Record<string,unknown>;errors?:Record<string,number>;overloaded?:boolean;throwError?:Error;during?:()=>void;recordDelay?:number}={}){
 let at=161000,calls=0;const submitted:any[]=[],records:any[]=[];
 const callBatch:NativeFlowAuditBatchOptions['callBatch']=async<T>(requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>{
  calls++;assert.equal(admission?.admissionOpen?.(),true);signal?.throwIfAborted();submitted.push(structuredClone(requests));const requestedAt=at;change.during?.();if(change.throwError)throw change.throwError;at+=20;const responseReceivedAt=at;at+=5;const validatedAt=at;
  return{physicalRequestId:44,requestedAt,responseReceivedAt,validatedAt,responseBytes:900,physicalHttpStarts:1,logicalQueries:requests.length,overloaded:change.overloaded??false,items:[...requests].reverse().map((request,i)=>{const id=Number(request.key.split('-').at(-1)),errorCode=change.errors?.[request.key],base={key:request.key,id:'44:'+i,requestedAt,responseReceivedAt,validatedAt:validatedAt-1};return errorCode===undefined?{...base,status:'result' as const,result:(change.results?.[request.key]??[row(id*10+2,110),row(id*10+1,100),row(id*10+4,90)]) as T}:{...base,status:'rpc-error' as const,errorCode};})} satisfies NativeAuditHistoryBatchTransportResult<T>;
 };
 return{options:{jobs,callBatch,now:()=>at,record:(kind,data)=>{records.push({kind,data});at+=change.recordDelay??0;}} satisfies NativeFlowAuditBatchOptions,get now(){return at;},set now(value:number){at=value;},get calls(){return calls;},submitted,records};
}

test('six independent strict-window audits share one physical batch without merging their params, fences or availability',async()=>{
 const jobs=Array.from({length:6},(_,i)=>job(i+1)),before=JSON.stringify(jobs),f=fixture(jobs),result=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(result.batchCallAttempts,1);assert.equal(result.physicalHttpStarts,1);assert.equal(result.logicalQueries,6);assert.equal(result.logicalQueriesRequested,6);assert.equal(f.calls,1);assert.equal(result.jobs.length,6);assert.equal(result.futureGateBlocked,false);assert.equal(result.transportFailure,null);
 for(let i=0;i<6;i++){const audit=result.jobs[i]!.result;assert.equal(result.jobs[i]!.key,jobs[i]!.key);assert.equal(audit.status,'verified');assert.equal(audit.complete,true);assert.equal(audit.maximumPages,1);assert.equal(audit.requestAttempts,1);assert.equal(audit.pageLimit,1000);assert.deepEqual(audit.requiredSignatures,[signature((i+1)*10+2)]);assert.deepEqual(audit.strictInteriorSlots,{lower:100,upper:200});assert.equal(audit.availableAt,161025);assert.ok(audit.availableAt>=result.transport!.validatedAt);assert.equal(audit.pages[0]!.receivedAt,161025);assert.equal(audit.target.endAt,160000);const params=f.submitted[0][i].params;assert.equal(params[0],pool(i+1));assert.deepEqual(params[1],{before:signature((i+1)*10+3),limit:1000,commitment:'confirmed',minContextSlot:200});}
 assert.equal(JSON.stringify(jobs),before);assert.equal(result.transport!.items[0]!.key,'candidate-6','transport order is not logical job order');assert.equal(f.records[0].kind,'native-flow-window-batch-audit');assert.equal(Object.hasOwn(f.records[0].data.transport.items[0],'result'),false,'aggregate metadata does not duplicate every raw history row');assert.match(result.limitations.join(' '),/separate provider queries/);
});

test('preflight no-call failures cannot deadlock valid siblings or an entirely ineligible batch',async()=>{
 const missingFence=job(1,{notifications:[]}),good=job(2),f=fixture([missingFence,good]),result=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(f.calls,1);assert.equal(f.submitted[0].length,1);assert.equal(result.logicalQueries,1);assert.equal(result.jobs[0]!.result.status,'unavailable');assert.match(result.jobs[0]!.result.reason,/FENCE/);assert.equal(result.jobs[0]!.result.requestAttempts,0);assert.equal(result.jobs[1]!.result.status,'verified');
 const none=fixture([missingFence,job(3,{pool:'invalid'})]),empty=await auditNativeFlowWindowsBatch(none.options);assert.equal(none.calls,0);assert.equal(empty.batchCallAttempts,0);assert.equal(empty.physicalHttpStarts,0);assert.equal(empty.logicalQueries,0);assert.equal(empty.transport,null);assert.equal(empty.jobs.length,2);assert.ok(empty.jobs.every(v=>v.result.status==='unavailable'));
});

test('ordinary per-item errors affect only that candidate and preserve all transport receipt metadata',async()=>{
 const f=fixture([job(1),job(2)],{errors:{'candidate-1':-32602}}),result=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(result.physicalHttpStarts,1);assert.equal(result.logicalQueries,2);assert.equal(result.futureGateBlocked,false);assert.equal(result.jobs[0]!.result.reason,'COMPONENT_RPC_ERROR_-32602');assert.equal(result.jobs[0]!.result.status,'unavailable');assert.equal(result.jobs[1]!.result.status,'verified');assert.equal(result.transport!.items.find(v=>v.key==='candidate-1')!.errorCode,-32602);assert.equal(result.transport!.items.find(v=>v.key==='candidate-2')!.status,'result');assert.equal(f.calls,1);
});

test('overload closes every current admission but retains valid sibling response facts and blocks future shared-gate use explicitly',async()=>{
 for(const overloaded of [false,true]){const f=fixture([job(1),job(2)],{errors:overloaded?{}:{'candidate-1':-32005},overloaded}),result=await auditNativeFlowWindowsBatch(f.options);assert.equal(f.calls,1);assert.equal(result.futureGateBlocked,true);assert.equal(result.logicalQueries,2);assert.ok(result.jobs.every(v=>v.result.status==='unavailable'&&v.result.reason===(overloaded?'COMPONENT_RPC_OVERLOAD':'COMPONENT_RPC_-32005')));assert.equal(result.transport!.items.find(v=>v.key==='candidate-2')!.status,'result');assert.equal(result.transport!.items.find(v=>v.key==='candidate-2')!.result instanceof Array,true);}
});

test('per-item429 is a shared provider refusal even if the receipt flag is missing',async()=>{
 const f=fixture([job(1),job(2)],{errors:{'candidate-1':429}}),r=await auditNativeFlowWindowsBatch(f.options);assert.equal(r.futureGateBlocked,true);assert.equal(r.logicalQueries,2);assert.ok(r.jobs.every(v=>v.result.reason==='COMPONENT_HTTP_429'));assert.equal(r.transport!.items.find(v=>v.key==='candidate-2')!.status,'result');assert.equal(f.calls,1);
});

test('individual cancellations, expired starts and closed admission are explicit without dispatching those queries',async()=>{
 const controller=new AbortController(),aborted={...job(1),signal:controller.signal};controller.abort();
 let checks=0;const deferred=job(2,{admission:{admissionOpen:()=>++checks===1}}),expired=job(3,{admission:{latestStartAt:160999}}),good=job(4),f=fixture([aborted,deferred,expired,good]),result=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(f.calls,1);assert.deepEqual(f.submitted[0].map((v:any)=>v.key),['candidate-4']);assert.equal(result.logicalQueries,1);for(const i of [0,1,2])assert.equal(result.jobs[i]!.result.status,'unavailable');assert.equal(result.jobs[0]!.result.requestAttempts,0);assert.equal(result.jobs[1]!.result.reason,'NATIVE_AUDIT_BATCH_ADMISSION_CLOSED');assert.equal(result.jobs[2]!.result.reason,'NATIVE_AUDIT_BATCH_DEADLINE');assert.equal(result.jobs[3]!.result.status,'verified');
});

test('a late individual cancellation invalidates its information but does not cancel or lose its sibling',async()=>{
 const controller=new AbortController(),f=fixture([{...job(1),signal:controller.signal},job(2)],{during:()=>controller.abort()}),result=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(result.logicalQueries,2,'both logical queries were physically dispatched before the cancellation');assert.equal(result.physicalHttpStarts,1);assert.equal(result.jobs[0]!.result.reason,'NATIVE_AUDIT_BATCH_ABORTED');assert.equal(result.jobs[1]!.result.status,'verified');assert.equal(result.transport!.items.length,2);
});

test('latestStartAt applies at request admission; actual information still must meet its separate validity deadline',async()=>{
 const f=fixture([job(1,{admission:{latestStartAt:161001}}),job(2,{maximumElapsedMs:10})]),result=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(result.logicalQueries,2);assert.equal(result.jobs[0]!.result.status,'verified','on-time start permits a later valid response');assert.equal(result.jobs[1]!.result.status,'unavailable');assert.match(result.jobs[1]!.result.reason,/ADMISSION_CLOSED|ELAPSED_LIMIT/);assert.equal(result.jobs[1]!.result.availableAt,161025);assert.equal(f.calls,1);
});

test('outer cancellation does not finish the audit until the one physical operation actually settles',async()=>{
 const controller=new AbortController(),f=fixture([job(1),job(2)]);let release!:(value:NativeAuditHistoryBatchTransportResult<unknown>)=>void,settled=false,called=0;
 const pending=auditNativeFlowWindowsBatch({...f.options,signal:controller.signal,callBatch:async<T>(_requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal)=>{called++;assert.equal(signal,controller.signal);return await new Promise<NativeAuditHistoryBatchTransportResult<T>>(resolve=>{release=resolve as typeof release;});}}).then(value=>{settled=true;return value;});
 controller.abort();await Promise.resolve();await Promise.resolve();assert.equal(settled,false,'no cancellation race releases unfinished physical ownership');assert.equal(called,1);
 release({physicalRequestId:1,requestedAt:161000,responseReceivedAt:161000,validatedAt:161000,responseBytes:20,physicalHttpStarts:1,logicalQueries:2,overloaded:false,items:[1,2].map(i=>({key:'candidate-'+i,id:String(i),status:'result',result:[],requestedAt:161000,responseReceivedAt:161000,validatedAt:161000}))});
 const result=await pending;assert.equal(result.logicalQueries,2);assert.equal(result.physicalHttpStarts,1);assert.ok(result.jobs.every(v=>v.result.status==='unavailable'&&v.result.reason==='NATIVE_AUDIT_BATCH_ABORTED'));
});

test('transport failure and refused starts are not mislabeled as known physical or provider-query consumption',async()=>{
 const refused=fixture([job(1),job(2)],{throwError:Error('COMPONENT_DISPATCH_EXPIRED')}),r=await auditNativeFlowWindowsBatch(refused.options);assert.equal(refused.calls,1);assert.equal(r.batchCallAttempts,1);assert.equal(r.physicalHttpStarts,null);assert.equal(r.logicalQueries,null);assert.equal(r.logicalQueriesRequested,2);assert.equal(r.transportFailure,'COMPONENT_DISPATCH_EXPIRED');assert.equal(r.futureGateBlocked,false);assert.ok(r.jobs.every(v=>v.result.status==='unavailable'));
 const throttled=fixture([job(1)],{throwError:Error('COMPONENT_HTTP_429')}),t=await auditNativeFlowWindowsBatch(throttled.options);assert.equal(t.futureGateBlocked,true);assert.equal(t.jobs[0]!.result.reason,'COMPONENT_HTTP_429');assert.equal(throttled.calls,1);
});

test('the original audit still rejects missing history, malformed rows, corrections and saturated history',async()=>{
 const invalidRows=[row(22,110),{...row(21,100),confirmationStatus:'processed'}],missing=[row(35,115),row(32,110),row(31,100)],history=Array.from({length:1000},(_,i)=>row(8000-i,1300-i));
 const f=fixture([job(1,{notifications:[note(11,100,99900),note(12,110,110000),note(12,110,120000,{correction:true}),note(13,200,160100)]}),job(2),job(3),job(4,{notifications:[note(41,100,99900),note(42,1200,110000),note(43,1400,160100)]})],{results:{'candidate-2':invalidRows,'candidate-3':missing,'candidate-4':history}}),r=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(f.calls,1);assert.equal(r.logicalQueries,3);assert.match(r.jobs[0]!.result.reason,/CORRECTION/);assert.equal(r.jobs[0]!.result.requestAttempts,0);assert.equal(r.jobs[1]!.result.reason,'NATIVE_AUDIT_HISTORY_CONTEXT');assert.equal(r.jobs[2]!.result.reason,'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED');assert.equal(r.jobs[2]!.result.missingNotifications[0]!.signature,signature(35));assert.equal(r.jobs[3]!.result.reason,'NATIVE_AUDIT_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN');assert.ok(r.jobs.every(v=>!v.result.complete));assert.equal(r.jobs[3]!.result.requestAttempts,1);
});

test('context-fence and notification-fence jobs preserve their distinct history cursors and original Clock provenance',async()=>{
 const contexts={lower:{slot:100,availableAt:99900,bankClockAt:99000},upper:{slot:200,availableAt:160500,bankClockAt:160000}},f=fixture([job(1,{notifications:[],contextFences:contexts}),job(2)],{results:{'candidate-1':[row(15,220),row(14,200),row(11,100),row(10,90)]}}),r=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(r.jobs[0]!.result.status,'verified');assert.equal(r.jobs[0]!.result.anchorKind,'confirmed-bank-context');assert.deepEqual(r.jobs[0]!.result.contextFences,contexts);assert.equal(r.jobs[1]!.result.anchorKind,'notification');assert.equal(Object.hasOwn(f.submitted[0][0].params[1],'before'),false);assert.equal(f.submitted[0][1].params[1].before,signature(23));assert.equal(f.submitted[0][0].params[1].minContextSlot,200);assert.equal(f.submitted[0][1].params[1].minContextSlot,200);assert.equal(r.jobs[0]!.result.contextFences!.upper.bankClockAt,160000);assert.equal(r.jobs[0]!.result.availableAt,161025);
});

test('a reused old transport receipt cannot be presented as a fresh independent audit',async()=>{
 const f=fixture([job(1)]),original=f.options.callBatch;const result=await auditNativeFlowWindowsBatch({...f.options,callBatch:async<T>(requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>{const response=await original<T>(requests,signal,admission);return {...response,requestedAt:150000,responseReceivedAt:150020,validatedAt:150025,items:response.items.map(item=>({...item,requestedAt:150000,responseReceivedAt:150020,validatedAt:150025}))};}});
 assert.equal(f.calls,1);assert.equal(result.transportFailure,'NATIVE_AUDIT_BATCH_TRANSPORT_RECEIPT');assert.equal(result.jobs[0]!.result.status,'unavailable');assert.equal(result.jobs[0]!.result.complete,false);assert.equal(result.transport,null,'unvalidated receipts are never recorded as trusted transport metadata');assert.equal(result.physicalHttpStarts,null);assert.equal(result.physicalSettlementConfirmed,null);
});

test('bounded collector rejects duplicate jobs, mixed targets and seven jobs without provider work',async()=>{
 for(const jobs of [[job(1),job(1)],Array.from({length:7},(_,i)=>job(i+1)),[job(1),job(2,{target:{startAt:110000,endAt:170000}})]]){const f=fixture(jobs);await assert.rejects(auditNativeFlowWindowsBatch(f.options),/NATIVE_AUDIT_BATCH_(JOB_|SHARED_)/);assert.equal(f.calls,0);}
});


test('the actual batch transport plus existing semantic audits use one injected HTTP response and one durable physical start',async()=>{
 for(const wrongPoolHistory of [false,true]){
  let at=161000,fetches=0;const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-audit-http-batch-')),records:any[]=[],record=(kind:string,data:unknown)=>records.push({kind,data}),budget=new ComponentBudget({statePath:join(directory,'fixture-book.json'),grantId:'offline-audit-batch',startedAt:at,baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>1000+i),refusal:'RPC_HTTP_429',refusalAt:2000,sha256:'a'.repeat(64)},now:()=>at,monotonic:()=>at,sleep:async milliseconds=>{at+=milliseconds;}});
  try{
   const transport=new ComponentTransport(budget,record,()=>{},()=>at,(async(_url,request)=>{fetches++;const batch=JSON.parse(String(request?.body));assert.equal(batch.length,6);assert.ok(batch.every((query:any)=>query.method==='getSignaturesForAddress'&&query.params[1].minContextSlot===200));assert.equal(new Set(batch.map((query:any)=>query.id)).size,6);const responses=batch.map((query:any)=>{const id=Array.from({length:6},(_,i)=>i+1).find(i=>query.params[0]===pool(i))!,historyId=wrongPoolHistory&&id===6?5:id;return {jsonrpc:'2.0',id:query.id,result:[row(historyId*10+2,110),row(historyId*10+1,100),row(historyId*10+4,90)]};}).reverse();at+=25;return new Response(JSON.stringify(responses),{status:200});}) as typeof fetch);
   const callBatch:NativeFlowAuditBatchOptions['callBatch']=<T>(requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>transport.callSignatureHistoryBatch<T>(requests,signal,admission),result=await auditNativeFlowWindowsBatch({jobs:Array.from({length:6},(_,i)=>job(i+1)),callBatch,now:()=>at,record});
   assert.equal(fetches,1);assert.equal(budget.newUnits,1);assert.equal(budget.calls,21);assert.equal(budget.inFlight,0);assert.equal(budget.usage().pending.length,0);assert.equal(budget.usage().uncertainResponseBytes,0);assert.equal(budget.usage().baseline.refusal,'RPC_HTTP_429');assert.equal(result.logicalQueries,6);assert.equal(result.physicalHttpStarts,1);assert.ok(result.jobs.slice(0,5).every(value=>value.result.status==='verified'&&value.result.availableAt===161025));assert.equal(result.jobs[5]!.result.availableAt,161025);
   if(wrongPoolHistory){assert.equal(result.jobs[5]!.result.status,'unusable');assert.equal(result.jobs[5]!.result.reason,'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED');assert.equal(result.jobs[5]!.result.missingNotifications[0]!.signature,signature(52));}else assert.equal(result.jobs[5]!.result.status,'verified');
   assert.equal(transport.signatureHistoryBatchUsage().logicalQueriesStarted,6);assert.equal(transport.signatureHistoryBatchUsage().physicalHttpStarts,1);assert.equal(records.filter(value=>value.kind==='http-response-timing').length,1);assert.equal(records.filter(value=>value.kind==='signature-history-batch-response').length,1);
  }finally{budget.close();rmSync(directory,{recursive:true,force:true});}
 }
});


test('missing transport items returns keyed unavailable results and safe aggregate evidence instead of throwing from final recording',async()=>{
 const f=fixture([job(1),job(2)]),original=f.options.callBatch,result=await auditNativeFlowWindowsBatch({...f.options,callBatch:async<T>(requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>{const response=await original<T>(requests,signal,admission);return {...response,items:undefined} as any;}});
 assert.equal(result.jobs.length,2);assert.ok(result.jobs.every(value=>value.result.status==='unavailable'&&!value.result.complete));assert.equal(result.transportFailure,'NATIVE_AUDIT_BATCH_TRANSPORT_RECEIPT');assert.equal(result.transport,null);assert.equal(result.physicalHttpStarts,null);assert.equal(result.logicalQueries,null);assert.equal(result.physicalSettlementConfirmed,null);assert.equal(f.records.at(-1).kind,'native-flow-window-batch-audit');assert.equal(f.records.at(-1).data.transport,null);
});

test('actual cancelled stalled fetch keeps physical ownership and uncertainty after the collector returns unavailable',async()=>{
 let at=161000,fetches=0,release!:(value:Response)=>void;const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-audit-batch-cancel-')),budget=new ComponentBudget({statePath:join(directory,'fixture-book.json'),grantId:'offline-audit-cancel',startedAt:at,baseline:{calls:20,bytes:272634,starts:Array.from({length:20},(_,i)=>1000+i),refusal:'RPC_HTTP_429',refusalAt:2000,sha256:'a'.repeat(64)},now:()=>at,monotonic:()=>at,sleep:async milliseconds=>{at+=milliseconds;}});
 try{
  const transport=new ComponentTransport(budget,()=>{},()=>{},()=>at,(async()=>{fetches++;return await new Promise<Response>(resolve=>{release=resolve;});})as typeof fetch),controller=new AbortController(),callBatch:NativeFlowAuditBatchOptions['callBatch']=<T>(requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>transport.callSignatureHistoryBatch<T>(requests,signal,admission),pending=auditNativeFlowWindowsBatch({jobs:[job(1),job(2)],callBatch,signal:controller.signal,now:()=>at});
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(fetches,1);assert.equal(budget.inFlight,1);controller.abort();const result=await pending;assert.equal(result.physicalSettlementConfirmed,null);assert.equal(result.physicalHttpStarts,null);assert.equal(result.logicalQueries,null);assert.equal(result.logicalQueriesRequested,2);assert.ok(result.jobs.every(value=>value.result.status==='unavailable'));assert.equal(budget.inFlight,1,'a rejected method promise must not be reported as physical settlement');assert.equal(budget.usage().uncertainResponseBytes,2*1024*1024);assert.equal(transport.signatureHistoryBatchUsage().logicalQueriesStarted,2);assert.equal(transport.signatureHistoryBatchUsage().physicalHttpStarts,1);await assert.rejects(transport.callSignatureHistoryBatch([{key:'cannot-replace',params:[pool(3),{limit:1000,commitment:'confirmed'}]}]),/HALTED/);assert.equal(fetches,1);
  release(new Response('[]'));for(let i=0;i<10&&budget.inFlight;i++)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(budget.inFlight,0);assert.equal(budget.usage().uncertainResponseBytes,2*1024*1024,'late physical settlement does not rewrite unresolved body consumption');
 }finally{budget.close();rmSync(directory,{recursive:true,force:true});}
});


test('a partial context-not-reached error cannot verify that pool while six logical query identities remain intact',async()=>{
 const f=fixture(Array.from({length:6},(_,i)=>job(i+1)),{errors:{'candidate-1':-32016}}),r=await auditNativeFlowWindowsBatch(f.options);
 assert.equal(f.calls,1);assert.equal(r.physicalHttpStarts,1);assert.equal(r.logicalQueries,6);assert.equal(r.futureGateBlocked,false,'served-node lag is data unavailability, not a global provider-overload declaration');assert.ok(f.submitted[0].every((q:any)=>q.params[1].minContextSlot===200));assert.equal(new Set(r.transport!.items.map(item=>item.id)).size,6);assert.equal(r.jobs[0]!.result.status,'unavailable');assert.equal(r.jobs[0]!.result.complete,false);assert.equal(r.jobs[0]!.result.reason,'COMPONENT_RPC_ERROR_-32016');assert.ok(r.jobs.slice(1).every(job=>job.result.status==='verified'));
});
