import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {PilotRpc,PilotRpcUnavailable,type PilotRpcOptions} from '../src/pilot-rpc.js';
import {componentRpcResponseError} from '../src/component-transport.js';
import {auditNativeFlowWindow} from '../src/native-flow-audit.js';
import type {NativeNotification} from '../src/pilot-native-flow.js';
import {resolvePumpSwapMigrationAge,validPumpSwapMigrationRecovery,type PumpSwapMigrationRecovery} from '../src/pumpswap-migration-recovery.js';

const MIB=1024*1024,POOL='So11111111111111111111111111111111111111112',BEFORE='2'.repeat(88),UNTIL='3'.repeat(88),CODE='COMPONENT_RPC_ERROR_-32020';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
type Request={jsonrpc:string;id:number;method:string;params:unknown[]};
function fixture(response:(request:Request)=>Response|Promise<Response>,options:Partial<PilotRpcOptions>={},initialAt=200000){
 const directory=mkdtempSync(join(tmpdir(),'poe-history-cursor-')),old=join(directory,'old.json');let now=initialAt,mono=initialAt;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:20,bytes:272634,lastObservedAt:2000,starts:Array.from({length:20},(_,i)=>1000+i),pending:[{id:20,unobservedBytes:2*MIB}]}),{mode:0o600});
 const original=readFileSync(old),records:Array<{kind:string;data:any}>=[],requests:Array<{request:Request;url:string;at:number}>=[];
 const client=new PilotRpc({directory:join(directory,'run'),runId:'cursor-test',baselinePaths:[old],priorPhysicalSettled:true,historyRoute:'publicnode-history-only-v1',now:()=>now,monotonic:()=>mono,sleep:async ms=>{now+=ms;mono+=ms;},record:(kind,data)=>records.push({kind,data}),fetcher:(async(url,init)=>{const request=JSON.parse(String(init?.body)) as Request;requests.push({request,url:String(url),at:now});return response(request);}) as typeof fetch,...options});
 return {client,directory,records,requests,now:()=>now,advance(ms:number){now+=ms;mono+=ms;},advanceWall(ms:number){now+=ms;},advanceMono(ms:number){mono+=ms;},close(){client.close();assert.deepEqual(readFileSync(old),original);rmSync(directory,{recursive:true,force:true});}};
}
const cursor=(extra:Record<string,unknown>={})=>[POOL,{before:BEFORE,limit:1000,commitment:'confirmed',...extra}];
const refused=(request:Request,code=-32020)=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code,message:'Synthetic cursor is not in this test history'}}));
const succeeded=(request:Request,result:unknown=123)=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));

test('actual retained fatal hash reproduces as a rejected cursor response without a process-fatal error',async()=>{
 assert.equal(createHash('sha256').update(CODE).digest('hex'),'984a1ba4bec574c365fec315dfea5e03c9d4463940ea5917494128367f6e93c2');
 // The envelope below is synthetic. The retained native evidence proves the
 // original fatal code, not the original response message or request method.
 const f=fixture(request=>request.method==='getSignaturesForAddress'?refused(request):succeeded(request));try{
  let refusal:PilotRpcUnavailable|undefined;await assert.rejects(f.client.call('getSignaturesForAddress',cursor(),undefined,{requestId:'original-cursor-request',latestStartAt:201000}),error=>{if(error instanceof PilotRpcUnavailable&&error.code===CODE){refusal=error;return true;}return false;});
  await turn();const u=f.client.usage();assert.equal(u.fatal,null);assert.equal(u.chapterUsage!.haltedReason,CODE);assert.equal(u.inFlight,0);assert.equal(u.waitingOrOperating,false);assert.equal(u.newUnits,1);assert.equal(f.requests.length,1);assert.equal(u.automaticRequestRetries,0);assert.equal(f.client.historyCooldownUntil(),202000);assert.equal(f.client.cooldownUntil(),0);assert.equal(u.controlCooldownUntil,0);
  assert.equal(refusal!.retryAt,202000);const failed=readFileSync(u.activeChapterPath!),uncertainty=u.uncertainResponseBytes,charged=u.newAccountedResponseBytes;
  await assert.rejects(f.client.call('getSignaturesForAddress',cursor()),/COOLDOWN/);assert.equal(f.requests.length,1);assert.equal(f.client.usage().newUnits,1);
  assert.equal(u.rpcDispatchWindow!.recoveryAdmissible,true);assert.ok(u.rpcDispatchWindow!.readyAt<202000);assert.equal(u.historyDispatchWindow!.readyAt,202000);
  assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(f.requests.length,2);assert.equal(f.client.usage().chapter,2);assert.equal(f.client.usage().uncertainResponseBytes,uncertainty);assert.ok(f.client.usage().newAccountedResponseBytes>=charged);assert.deepEqual(readFileSync(join(f.directory,'run/chapter-001.json')),failed);
  const event=f.records.find(row=>row.kind==='pilot-rpc-unavailable'&&row.data.scope==='history-cursor')!.data;
  assert.equal(event.code,CODE);assert.equal(event.method,'getSignaturesForAddress');assert.equal(event.physicalRequestId,f.requests[0]!.request.id);assert.equal(event.requestId,'original-cursor-request');assert.equal(event.latestStartAt,201000);assert.equal(event.cursor.before,BEFORE);assert.equal(event.cursor.until,null);assert.equal(event.historyResultAvailable,false);assert.equal(event.automaticRetry,false);assert.equal(event.physicalSettled,true);assert.equal(event.globalRpcCooldownUnchanged,true);
 }finally{f.close();}
});

test('until-only finalized cursor retains its original request and normal repeated backoff caps at60 seconds',async()=>{
 let allow=false;const f=fixture(request=>allow?succeeded(request,[]):refused(request));try{
  const params=[POOL,{until:UNTIL,limit:100,commitment:'finalized'}];
  for(const backoff of [2000,5000,10000,20000,40000,60000,60000]){const at=f.now();await assert.rejects(f.client.call('getSignaturesForAddress',params),error=>error instanceof PilotRpcUnavailable&&error.code===CODE&&error.retryAt===at+backoff);assert.equal(f.client.usage().fatal,null);f.advance(backoff);}
  assert.equal(f.requests.length,7);for(const row of f.requests)assert.deepEqual(row.request.params,params);assert.equal(f.client.usage().automaticRequestRetries,0);
  allow=true;assert.deepEqual(await f.client.call('getSignaturesForAddress',params),[]);allow=false;f.advance(250);const at=f.now();await assert.rejects(f.client.call('getSignaturesForAddress',params),error=>error instanceof PilotRpcUnavailable&&error.retryAt===at+2000);
 }finally{f.close();}
});

test('cursor recovery cannot bypass live physical occupancy or an expired original admission deadline',async()=>{
 let resolve!:()=>void;const f=fixture(request=>request.method==='getSignaturesForAddress'?new Promise<Response>(done=>{resolve=()=>done(refused(request));}):succeeded(request));try{
  const pending=f.client.call('getSignaturesForAddress',cursor(),undefined,{latestStartAt:200500});await turn();assert.equal(f.client.usage().inFlight,1);await assert.rejects(f.client.call('getMultipleAccounts'),/PHYSICAL_SLOT_OCCUPIED/);assert.equal(f.requests.length,1);
  resolve();await assert.rejects(pending,/RPC_ERROR_-32020/);await turn();f.advance(2000);const calls=f.requests.length;
  await assert.rejects(f.client.call('getSignaturesForAddress',cursor(),undefined,{latestStartAt:200500}),/DISPATCH_EXPIRED/);assert.equal(f.requests.length,calls);assert.equal(f.client.usage().fatal,null);
 }finally{f.close();}
});

test('a matching diagnostic exception cannot manufacture a parsed cursor-error receipt',async()=>{
 assert.equal(componentRpcResponseError(Error(CODE)),null);
 const f=fixture(request=>succeeded(request,[]),{record(kind){if(kind==='http-lifecycle-timing')throw Error(CODE);}});try{
  await assert.rejects(f.client.call('getSignaturesForAddress',cursor()),/RPC_ERROR_-32020/);assert.equal(f.client.usage().fatal,CODE);assert.equal(f.client.historyCooldownUntil(),0);assert.equal(f.requests.length,1);
 }finally{f.close();}
});

test('real audit keeps the original window, cursor and deadline unavailable while a holding read can proceed',async()=>{
 const sig=(id:number)=>{const b=Buffer.alloc(64);b.writeUInt32LE(id);return bs58.encode(b);};
 const note=(id:number,slot:number,at:number):NativeNotification=>({signature:sig(id),slot,receivedAt:at,availableAt:at,success:true,rawHash:'a'.repeat(64),parsedEvents:1,eventsAccepted:1,duplicate:false,correction:false,classification:'program-event',reason:null,chainBlockTime:null});
 const target={startAt:100000,endAt:160000},notifications=[note(1,100,99900),note(2,110,110000),note(3,200,160100)],before=structuredClone({target,notifications});
 const f=fixture(request=>request.method==='getSignaturesForAddress'?refused(request):succeeded(request,{context:{slot:201},value:[]}));try{
  const result=await auditNativeFlowWindow({pool:POOL,target,notifications,now:f.now,admission:{latestStartAt:200500,timeoutMs:1000},call:(...args)=>f.client.call(...args)});
  assert.equal(result.status,'unavailable');assert.equal(result.reason,'PILOT_RPC_'+CODE);assert.equal(result.complete,false);assert.equal(result.historyRangeCovered,false);assert.equal(result.executedFlowCompletenessVerified,false);assert.equal(result.notificationCompletenessVerified,false);assert.equal(result.requestAttempts,1);assert.equal(result.historyRows,0);assert.equal(result.pages.length,0);assert.equal(result.retryAt,202000);assert.deepEqual(result.target,target);assert.equal(result.anchor!.signature,sig(3));assert.equal(result.startedAt,200000);assert.equal(result.availableAt,200000);assert.deepEqual({target,notifications},before);
  assert.equal((f.requests[0]!.request.params[1] as any).before,sig(3));const refusedEvent=f.records.find(row=>row.data.scope==='history-cursor')!.data;assert.equal(refusedEvent.latestStartAt,200500);assert.equal(refusedEvent.cursor.before,sig(3));
  const price=await f.client.callProtection('getMultipleAccounts',[[POOL],{commitment:'confirmed',encoding:'base64'}],undefined,{completeBy:201500});assert.deepEqual(price,{context:{slot:201},value:[]});assert.equal(f.client.usage().fatal,null);assert.equal(f.requests.length,2);assert.equal(f.client.usage().automaticRequestRetries,0);
 }finally{f.close();}
});

test('real migration continuation retains the exact saved cursor and original evidence clocks after cursor refusal',async t=>{
 const recorded=JSON.parse(readFileSync(new URL('./fixtures/migration-queue-checkpoint.json',import.meta.url),'utf8')),checkpoint=recorded.checkpoint as PumpSwapMigrationRecovery,original=structuredClone(checkpoint),at=checkpoint.updatedAt+10;
 assert.equal(createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex'),recorded.cursorCapture.bodySha256);assert.equal(validPumpSwapMigrationRecovery(checkpoint,checkpoint.seed,at),true);
 const f=fixture(request=>request.method==='getSignaturesForAddress'?refused(request):succeeded(request),{},at);t.mock.method(Date,'now',f.now);try{
  const deadline=at+1500;const result=await resolvePumpSwapMigrationAge(checkpoint.seed,{call:(method,params,signal)=>f.client.call(method,params,signal,{latestStartAt:deadline})},new AbortController().signal,checkpoint);
  assert.equal(result.ok,false);if(result.ok)throw Error('synthetic cursor rejection cannot provide a migration proof');assert.equal(result.reason,'PILOT_RPC_'+CODE);assert.ok(result.recovery);assert.deepEqual(result.recovery.before,checkpoint.before);assert.deepEqual(result.recovery.until,checkpoint.until);assert.deepEqual(result.recovery.sameSlotCursors,checkpoint.sameSlotCursors);assert.equal(result.recovery.startedAt,checkpoint.startedAt);assert.equal(result.recovery.seed.receivedAt,checkpoint.seed.receivedAt);assert.equal(result.recovery.historyPages,checkpoint.historyPages);assert.equal(result.recovery.historyRows,checkpoint.historyRows);assert.equal(result.recovery.candidateReads,checkpoint.candidateReads);assert.equal(result.recovery.revision,checkpoint.revision+1);assert.equal(result.recovery.originConfirmed,null);assert.deepEqual(checkpoint,original);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0]!.request.method,'getSignaturesForAddress');assert.equal((f.requests[0]!.request.params[1] as any).before,checkpoint.before!.signature);assert.equal(f.records.find(row=>row.data.scope==='history-cursor')!.data.latestStartAt,deadline);assert.equal(await f.client.call('getMultipleAccounts'),123);assert.equal(f.client.usage().fatal,null);
 }finally{f.close();}
});

test('history backoff uses both original wall and monotonic clocks and does not refresh a cursor',async()=>{
 const f=fixture(request=>refused(request));try{
  await assert.rejects(f.client.call('getSignaturesForAddress',cursor()),/RPC_ERROR_-32020/);await turn();f.advanceWall(10000);await assert.rejects(f.client.call('getSignaturesForAddress',cursor()),/COOLDOWN/);assert.equal(f.requests.length,1);f.advanceMono(2000);
  await assert.rejects(f.client.call('getSignaturesForAddress',cursor()),/RPC_ERROR_-32020/);assert.equal(f.requests.length,2);assert.equal(f.requests[1]!.request.params[1]&& (f.requests[1]!.request.params[1] as any).before,BEFORE);
 }finally{f.close();}
});

test('a caller mutation cannot change the original admitted cursor or its diagnostic binding',async()=>{
 const f=fixture(request=>refused(request));try{
  const config={before:BEFORE,limit:1000,commitment:'confirmed'},params=[POOL,config];const call=f.client.call('getSignaturesForAddress',params);config.before=UNTIL;config.limit=1;
  await assert.rejects(call,/RPC_ERROR_-32020/);assert.equal((f.requests[0]!.request.params[1] as any).before,BEFORE);assert.equal((f.requests[0]!.request.params[1] as any).limit,1000);const event=f.records.find(row=>row.data.scope==='history-cursor')!.data;assert.equal(event.cursor.before,BEFORE);assert.equal(event.cursor.limit,1000);
 }finally{f.close();}
});

test('the same code outside the configured bounded history cursor request remains fatal',async()=>{
 const cases:Array<{method:string;params:unknown[];options?:Partial<PilotRpcOptions>}>=[
  {method:'getSlot',params:[]},{method:'getTransaction',params:[BEFORE,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]},
  {method:'getSignaturesForAddress',params:cursor(),options:{historyRoute:undefined}},
  {method:'getSignaturesForAddress',params:[POOL,{limit:1000,commitment:'confirmed'}]},
  {method:'getSignaturesForAddress',params:cursor({before:'invalid'})},
  {method:'getSignaturesForAddress',params:cursor({limit:1001})},
  {method:'getSignaturesForAddress',params:cursor({unexpected:true})},
 ];
 for(const value of cases){const f=fixture(request=>refused(request),value.options);try{await assert.rejects(f.client.call(value.method,value.params),/RPC_ERROR_-32020/);assert.equal(f.client.usage().fatal,CODE);assert.equal(f.requests.length,1);assert.equal(f.records.some(row=>row.data.scope==='history-cursor'),false);await assert.rejects(f.client.call('getMultipleAccounts'),/RPC_ERROR_-32020/);assert.equal(f.requests.length,1);}finally{f.close();}}
});

test('unknown or malformed responses and real HTTP restrictions keep their existing guards',async()=>{
 const cases:Array<{response:(request:Request)=>Response;fatal:string|null;code:string;historyBackoff?:number}>=[
  {response:request=>refused(request,-32099),fatal:'COMPONENT_RPC_ERROR_-32099',code:'RPC_ERROR_-32099'},
  {response:request=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:[],error:{code:-32020,message:'synthetic'}})),fatal:CODE,code:'RPC_ERROR_-32020'},
  {response:request=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32020}})),fatal:CODE,code:'RPC_ERROR_-32020'},
  {response:request=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id+1,error:{code:-32020,message:'synthetic'}})),fatal:'COMPONENT_HTTP_ENVELOPE',code:'HTTP_ENVELOPE'},
  {response:()=>new Response('{'),fatal:'COMPONENT_HTTP_MALFORMED_JSON',code:'HTTP_MALFORMED_JSON'},
  {response:()=>new Response('denied',{status:401}),fatal:'COMPONENT_HTTP_STATUS_401',code:'HTTP_STATUS_401'},
  {response:()=>new Response('throttled',{status:429,headers:{'retry-after':'10'}}),fatal:null,code:'HTTP_429',historyBackoff:10000},
  {response:()=>new Response('busy',{status:503,headers:{'retry-after':'20'}}),fatal:null,code:'HTTP_STATUS_503',historyBackoff:20000},
  {response:request=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32020,message:'synthetic'}}),{headers:{'retry-after':'10'}}),fatal:CODE,code:'RPC_ERROR_-32020',historyBackoff:10000},
 ];
 for(const value of cases){const f=fixture(value.response);try{await assert.rejects(f.client.call('getSignaturesForAddress',cursor()),new RegExp(value.code));assert.equal(f.client.usage().fatal,value.fatal);assert.equal(f.records.some(row=>row.data.scope==='history-cursor'),false);if(value.historyBackoff!==undefined)assert.equal(f.client.historyCooldownUntil(),200000+value.historyBackoff);}finally{f.close();}}
});
