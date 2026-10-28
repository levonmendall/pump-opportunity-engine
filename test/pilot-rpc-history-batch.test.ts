/** OFFLINE real PilotRpc + existing physical transport/gate. Synthetic delays
 * and responses exercise accounting; they establish no provider entitlement. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bs58 from 'bs58';
import {PilotRpc,PilotRpcUnavailable,type PilotRpcOptions} from '../src/pilot-rpc.js';
import type {SignatureHistoryBatchRequest} from '../src/component-transport.js';
const MIB=1024*1024,turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const pool=(id:number)=>bs58.encode(Buffer.alloc(32,id));
const requests=(count=2):SignatureHistoryBatchRequest[]=>Array.from({length:count},(_,index)=>({key:'pool-'+index,params:[pool(index+1),{limit:100,commitment:'confirmed',minContextSlot:200,before:bs58.encode(Buffer.alloc(64,index+1))}]}));
const respond=(rows:unknown)=>new Response(JSON.stringify(rows));
function fixture(t:TestContext,fetcher:typeof fetch,extra:Partial<PilotRpcOptions>={}){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-pilot-history-batch-')),prior=join(directory,'prior.json');let at=200000,mono=200000,calls=0;
 writeFileSync(prior,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:2000,starts:[1000],pending:[]}));
 const priorBytes=readFileSync(prior),records:Array<{kind:string;data:any}>=[],wire:Array<{at:number;body:any}>=[];
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:'history-batch-test',baselinePaths:[prior],priorPhysicalSettled:true,now:()=>at,monotonic:()=>mono,sleep:async ms=>{at+=ms;mono+=ms;},record:(kind,data)=>records.push({kind,data:structuredClone(data)}),fetcher:(async(url,init)=>{calls++;wire.push({at,body:JSON.parse(String(init?.body))});return fetcher(url,init);})as typeof fetch,...extra});
 t.after(()=>{rpc.close();assert.deepEqual(readFileSync(prior),priorBytes);rmSync(directory,{recursive:true,force:true});});
 return{rpc,directory,records,wire,get calls(){return calls;},now:()=>at,advance(ms:number){at+=ms;mono+=ms;},wall(ms:number){at+=ms;},mono(ms:number){mono+=ms;},status(){return JSON.parse(readFileSync(join(directory,'run/status.json'),'utf8'));}};
}

test('quiet batch preserves independent item errors, stable IDs and cumulative logical counters across the same chapter gate',async t=>{
 const f=fixture(t,(async(_url,init)=>{const wire=JSON.parse(String(init?.body));if(!Array.isArray(wire))return respond({jsonrpc:'2.0',id:wire.id,result:7});return respond([...wire].reverse().map((request,index)=>index===1?{jsonrpc:'2.0',id:request.id,error:{code:-32602,message:'PRIVATE_PROVIDER_TEXT'}}:{jsonrpc:'2.0',id:request.id,result:[request.params[0]]}));})as typeof fetch,{chapterUnits:1});
 const original=requests(6),saved=structuredClone(original),result=await f.rpc.callSignatureHistoryBatch<string[]>(original,undefined,{queryTimeoutScope:'independent-history'});
 assert.equal(result.physicalHttpStarts,1);assert.equal(result.logicalQueries,6);assert.equal(result.overloaded,false);assert.equal(result.items.length,6);assert.equal(result.items[4]!.status,'rpc-error');assert.equal(result.items[4]!.errorCode,-32602);
 assert.deepEqual(result.items[0]!.result,[pool(1)]);assert.deepEqual(original,saved);assert.deepEqual(f.wire[0]!.body.map((row:any)=>row.params),saved.map(row=>row.params));
 let usage=f.rpc.usage();assert.equal(usage.newUnits,1);assert.equal(usage.fatal,null);assert.equal(usage.cooldownUntil,0);assert.equal(usage.signatureHistoryBatch.logicalQueriesRequested,6);assert.equal(usage.signatureHistoryBatch.logicalQueriesInvoked,6);assert.equal(usage.signatureHistoryBatch.logicalQueriesValidated,6);assert.equal(usage.signatureHistoryBatch.physicalHttpStarts,1);assert.equal(usage.signatureHistoryBatch.rpcErrorResponses,1);assert.equal(usage.signatureHistoryBatch.successfulLogicalQueries,5);assert.equal(usage.signatureHistoryBatch.logicalQueriesWithoutValidatedResponse,0);
 assert.equal(await f.rpc.call('getSlot'),7);assert.equal(f.rpc.usage().chapter,2);assert.ok(f.wire[1]!.at-f.wire[0]!.at>=250);
 await f.rpc.callSignatureHistoryBatch(requests());usage=f.rpc.usage();assert.equal(usage.chapter,3);assert.equal(usage.newUnits,3);assert.equal(usage.signatureHistoryBatch.logicalQueriesInvoked,8);assert.equal(usage.signatureHistoryBatch.physicalHttpStarts,2);assert.deepEqual(f.status().signatureHistoryBatch,usage.signatureHistoryBatch);assert.equal(JSON.stringify(f.records).includes('PRIVATE_PROVIDER_TEXT'),false);
});

test('bounded requests, canceled signals and absent admission cannot invoke a physical batch',async t=>{
 const f=fixture(t,(async()=>{throw Error('OFFLINE must not fetch');})as typeof fetch);
 for(const bad of [[],requests(1),requests(7),[requests()[0]!,requests()[0]!],[...requests().slice(0,1),{...requests()[1]!,params:[pool(2),{limit:1000,commitment:'confirmed',minContextSlot:200}]}],[...requests().slice(0,1),{...requests()[1]!,params:[pool(2),{limit:100,commitment:'confirmed',minContextSlot:200,until:'1'.repeat(64)}]}],[...requests().slice(0,1),{...requests()[1]!,params:[pool(2),{limit:100,commitment:'confirmed'}]}]])await assert.rejects(f.rpc.callSignatureHistoryBatch(bad));
 const abort=new AbortController();abort.abort();await assert.rejects(f.rpc.callSignatureHistoryBatch(requests(),abort.signal),/ABORTED/);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests(),undefined,{latestStartAt:f.now()-1}),/DISPATCH_EXPIRED/);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests(),undefined,{admissionOpen:()=>false}),/ADMISSION_CLOSED/);
 assert.equal(f.calls,0);assert.equal(f.rpc.usage().newUnits,0);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesInvoked,0);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(f.rpc.usage().signatureHistoryBatch.physicalHttpStarts,0);assert.equal(f.rpc.usage().cooldownUntil,0);
 for(const bad of ['',pool(1)+'/',null])assert.throws(()=>f.rpc.historyQueryReadyAt(bad as any),/INVALID_HISTORY_POOL/);
});

test('query-local cooling pools are refused before batch admission while healthy pools still share the settled gate',async t=>{
 let fail=true;const f=fixture(t,(async(_url,init)=>{const wire=JSON.parse(String(init?.body));if(fail)return await new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(Error('OFFLINE settled abort')),{once:true});});return respond(wire.map((row:any)=>({jsonrpc:'2.0',id:row.id,result:[]})));})as typeof fetch);
 await assert.rejects(f.rpc.call('getSignaturesForAddress',[pool(1),{limit:100,commitment:'confirmed',minContextSlot:200}],undefined,{timeoutMs:5,queryTimeoutScope:'independent-history'}),/PHYSICAL_TIMEOUT/);await turn();await turn();
 assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.cooldownUntil(),0);assert.equal(f.rpc.historyQueryReadyAt(pool(1)),f.now()+2000);assert.equal(f.rpc.historyQueryReadyAt(pool(2)),f.now());
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),error=>error instanceof PilotRpcUnavailable&&error.code==='QUERY_COOLDOWN');assert.equal(f.calls,1);assert.equal(f.rpc.usage().signatureHistoryBatch.plans,0);
 fail=false;await f.rpc.callSignatureHistoryBatch(requests().map((request,index)=>({...request,params:[pool(index+2),request.params[1]]})));assert.equal(f.calls,2);assert.equal(f.rpc.usage().newUnits,2);assert.equal(f.rpc.usage().chapter,2);
 f.wall(2500);assert.ok(f.rpc.historyQueryReadyAt(pool(1))>f.now(),'wall clock alone does not release monotonic backoff');f.mono(2500);assert.equal(f.rpc.historyQueryReadyAt(pool(1)),f.now());
});

for(const status of [429,503])test(`unattributable timeout retains physical occupancy; late HTTP${status} updates durable shared backoff`,async t=>{
 let release!:(value:Response)=>void,fail=true;const f=fixture(t,(async(_url,init)=>{if(fail)return await new Promise<Response>(resolve=>{release=resolve;});const wire=JSON.parse(String(init?.body));return respond(wire.map((row:any)=>({jsonrpc:'2.0',id:row.id,result:[]})));})as typeof fetch);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests(),undefined,{timeoutMs:5,queryTimeoutScope:'independent-history'}),/PHYSICAL_TIMEOUT/);
 let usage=f.rpc.usage();assert.equal(usage.inFlight,1);assert.equal(usage.newUnits,1);assert.equal(usage.signatureHistoryBatch.logicalQueriesRequested,2);assert.equal(usage.signatureHistoryBatch.logicalQueriesInvoked,2);assert.equal(usage.signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(usage.signatureHistoryBatch.physicalHttpStarts,1);assert.equal(usage.queryTimeoutIsolation.isolatedTimeouts,0);assert.equal(usage.cooldownUntil,f.now()+2000);assert.equal(usage.uncertainResponseBytes,2*MIB);
 f.advance(3000);await assert.rejects(f.rpc.call('getSlot'),/PHYSICAL_SLOT_OCCUPIED/);await assert.rejects(f.rpc.operateData({transport:'ws',method:'ping'},async op=>op.completeResponse()),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.calls,1);
 release(new Response('',{status,headers:{'retry-after':'10'}}));await turn();await turn();usage=f.rpc.usage();assert.equal(usage.inFlight,0);assert.equal(usage.cooldownUntil,f.now()+15000);assert.equal(f.status().cooldownUntil,usage.cooldownUntil);assert.equal(usage.signatureHistoryBatch.logicalQueriesWithoutValidatedResponse,2);assert.equal(usage.currentChapterUncertainResponseBytes,2*MIB);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/COOLDOWN/);assert.equal(f.calls,1);const failed=readFileSync(usage.activeChapterPath!);f.advance(15001);fail=false;await f.rpc.callSignatureHistoryBatch(requests());usage=f.rpc.usage();assert.equal(usage.newUnits,2);assert.equal(usage.chapter,2);assert.equal(usage.signatureHistoryBatch.logicalQueriesInvoked,4);assert.equal(usage.signatureHistoryBatch.logicalQueriesValidated,2);assert.equal(usage.uncertainResponseBytes,2*MIB);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),failed);
});

test('cancel after physical start keeps the gate occupied and retains query uncertainty until actual settlement',async t=>{
 let release!:(value:Response)=>void;const f=fixture(t,(async()=>await new Promise<Response>(resolve=>{release=resolve;}))as typeof fetch),controller=new AbortController();
 const pending=f.rpc.callSignatureHistoryBatch(requests(),controller.signal);await turn();assert.equal(f.calls,1);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesInvoked,2);assert.equal(f.status().signatureHistoryBatch.logicalQueriesInvoked,2,'actual invocation is durable before logical completion');assert.equal(f.status().signatureHistoryBatch.logicalQueriesValidated,0);controller.abort();await assert.rejects(pending,/ABORTED/);assert.equal(f.rpc.usage().inFlight,1);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesInvoked,2);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);
 f.advance(3000);await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.calls,1);release(respond([]));await turn();await turn();assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);
});

for(const code of [429,-32005])test(`actual per-item overload${code} returns its settled receipt and establishes the shared cooldown`,async t=>{
 const f=fixture(t,(async(_url,init)=>{const wire=JSON.parse(String(init?.body));return respond(wire.map((request:any,index:number)=>index?{jsonrpc:'2.0',id:request.id,result:[]}:{jsonrpc:'2.0',id:request.id,error:{code,message:'PRIVATE_PROVIDER_TEXT'}}));})as typeof fetch);
 const response=await f.rpc.callSignatureHistoryBatch(requests());assert.equal(response.overloaded,true);assert.equal(response.items[0]!.errorCode,code);assert.equal(response.items[1]!.status,'result');assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.usage().uncertainResponseBytes,0);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesValidated,2);assert.equal(f.rpc.usage().signatureHistoryBatch.providerBackoffBatches,1);assert.equal(f.rpc.cooldownUntil(),f.now()+(code===429?65000:2000));assert.equal(f.status().cooldownUntil,f.rpc.cooldownUntil());await assert.rejects(f.rpc.call('getSlot'),/COOLDOWN/);assert.equal(f.calls,1);assert.equal(JSON.stringify(f.records).includes('PRIVATE_PROVIDER_TEXT'),false);
});

test('HTTP429 stops before the body and preserves physical/logical counts plus unobserved bytes',async t=>{
 let reads=0,canceled=false;const f=fixture(t,(async()=>new Response(new ReadableStream({pull(){reads++;},cancel(){canceled=true;}},{highWaterMark:0}),{status:429,headers:{'retry-after':'10'}}))as typeof fetch);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/HTTP_429/);await turn();assert.equal(reads,0);assert.equal(canceled,true);assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.usage().newUnits,1);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesInvoked,2);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);assert.equal(f.rpc.cooldownUntil(),f.now()+15000);
});

for(const shape of ['missing','duplicate','wrong-id'])test(`malformed ${shape} envelope never invents validated per-pool responses`,async t=>{
 const f=fixture(t,(async(_url,init)=>{const wire=JSON.parse(String(init?.body)),rows=wire.map((row:any)=>({jsonrpc:'2.0',id:row.id,result:[]}));if(shape==='missing')rows.pop();if(shape==='duplicate')rows[1].id=rows[0].id;if(shape==='wrong-id')rows[1].id='unrequested';return respond(rows);})as typeof fetch);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/HISTORY_BATCH_ENVELOPE/);assert.equal(f.rpc.usage().inFlight,0);assert.equal(f.rpc.usage().newUnits,1);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesInvoked,2);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(f.rpc.usage().uncertainResponseBytes,0);assert.equal(f.rpc.usage().fatal,null);assert.equal(f.rpc.usage().signatureHistoryBatch.disabledReason,'COMPONENT_HISTORY_BATCH_ENVELOPE');
});

test('quiet batch aggregate decoded response cap is512KiB and charges the crossing chunk before rejection',async t=>{
 let canceled=false,index=0;const chunks=[new Uint8Array(256*1024),new Uint8Array(256*1024),new Uint8Array(1)];const f=fixture(t,(async()=>new Response(new ReadableStream({pull(controller){const chunk=chunks[index++];if(chunk)controller.enqueue(chunk);},cancel(){canceled=true;}},{highWaterMark:0})))as typeof fetch);
 await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/HISTORY_BATCH_RESPONSE_SIZE/);await turn();assert.equal(canceled,true);assert.equal(f.rpc.usage().chapterUsage!.httpBytes,512*1024+1);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(f.rpc.usage().signatureHistoryBatch.logicalQueriesInvoked,2);
});

for(const bad of ['json','envelope','capped-body'] as const)test(`quiet batch ${bad} disables that optimization while ordinary pricing RPC can recover on the same accounted gate`,async t=>{
 const f=fixture(t,(async(_url,init)=>{const request=JSON.parse(String(init?.body));if(!Array.isArray(request))return respond({jsonrpc:'2.0',id:request.id,result:123});return bad==='json'?new Response('{SYNTHETIC_INVALID_JSON'):bad==='envelope'?respond([]):new Response('x'.repeat(512*1024+1));})as typeof fetch);
 const expected=bad==='json'?'COMPONENT_HISTORY_BATCH_MALFORMED_JSON':bad==='envelope'?'COMPONENT_HISTORY_BATCH_ENVELOPE':'COMPONENT_HISTORY_BATCH_RESPONSE_SIZE';await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),new RegExp(expected));await turn();const prior=f.rpc.usage();assert.equal(prior.fatal,null);assert.equal(prior.inFlight,0);assert.equal(prior.signatureHistoryBatch.disabledReason,expected);assert.equal(prior.signatureHistoryBatch.logicalQueriesInvoked,2);assert.equal(prior.signatureHistoryBatch.logicalQueriesValidated,0);assert.equal(prior.newUnits,1);assert.ok(f.rpc.cooldownUntil()>f.now());await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/HISTORY_BATCH_DISABLED/);assert.equal(f.calls,1,'a disabled batch is not retried');f.advance(f.rpc.cooldownUntil()-f.now());assert.equal(await f.rpc.call('getSlot'),123,'an isolated candidate optimization cannot permanently disable unrelated pricing work');const next=f.rpc.usage();assert.equal(next.chapter,2);assert.equal(next.newUnits,2);assert.equal(next.fatal,null);assert.equal(next.uncertainResponseBytes,prior.uncertainResponseBytes);assert.equal(next.signatureHistoryBatch.physicalHttpStarts,1);assert.equal(next.signatureHistoryBatch.logicalQueriesInvoked,2);assert.ok(f.records.some(r=>r.kind==='pilot-history-batch-disabled'));
});

test('declared response beyond the unchanged2MiB hard limit remains fatal rather than a recoverable quiet-batch fault',async t=>{
 let read=0,canceled=false;const f=fixture(t,(async()=>new Response(new ReadableStream({pull(){read++;},cancel(){canceled=true;}},{highWaterMark:0}),{headers:{'content-length':String(2*MIB+1)}}))as typeof fetch);await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/HTTP_RESPONSE_SIZE/);await turn();assert.equal(read,0);assert.equal(canceled,true);assert.equal(f.rpc.usage().fatal,'COMPONENT_HTTP_RESPONSE_SIZE');assert.equal(f.rpc.usage().signatureHistoryBatch.disabledReason,null);assert.equal(f.rpc.usage().uncertainResponseBytes,2*MIB);f.advance(10000);await assert.rejects(f.rpc.call('getSlot'),/HTTP_RESPONSE_SIZE/);assert.equal(f.calls,1);
});

test('failure to record a batch-disable event remains fatal and cannot be bypassed by ordinary RPC recovery',async t=>{
 const f=fixture(t,(async()=>respond([]))as typeof fetch,{record:(kind)=>{if(kind==='pilot-history-batch-disabled')throw Error('SYNTHETIC_DIAGNOSTIC_FAILURE');}});await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/DIAGNOSTIC_FAILURE/);assert.equal(f.rpc.usage().fatal,'DIAGNOSTIC_FAILURE');f.advance(10000);await assert.rejects(f.rpc.call('getSlot'),/DIAGNOSTIC_FAILURE/);assert.equal(f.calls,1);
});

test('failure to durably persist a batch-disable state remains storage-fatal after physical settlement',async t=>{
 let f!:ReturnType<typeof fixture>,faulted=false;f=fixture(t,(async()=>respond([]))as typeof fetch,{record:(kind)=>{if(kind!=='pilot-history-batch-disabled'||faulted)return;faulted=true;const status=join(f.directory,'run/status.json');renameSync(status,status+'.fixture-before-failure');mkdirSync(status);}});await assert.rejects(f.rpc.callSignatureHistoryBatch(requests()),/STORAGE_UNAVAILABLE/);assert.equal(f.rpc.usage().fatal,'STORAGE_UNAVAILABLE');assert.equal(f.rpc.usage().inFlight,0);f.advance(10000);await assert.rejects(f.rpc.call('getSlot'),/STORAGE_UNAVAILABLE/);assert.equal(f.calls,1);const status=join(f.directory,'run/status.json');rmSync(status,{recursive:true});if(existsSync(status+'.pending'))rmSync(status+'.pending');renameSync(status+'.fixture-before-failure',status);
});
