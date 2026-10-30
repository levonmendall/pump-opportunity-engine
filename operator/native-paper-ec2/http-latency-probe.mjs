/** Fixed-endpoint, data-only latency measurement. Never imported by the trader. */
import {channel} from 'node:diagnostics_channel';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {openSync,writeSync,fsyncSync,closeSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export const ENDPOINT='https://solana-rpc.publicnode.com';
export const CLOCK_ENDPOINT='https://api.mainnet.solana.com';
export const CLOCK='SysvarC1ock11111111111111111111111111111111';
export const LIMITS=Object.freeze({requests:9,historyRequests:6,clockRequests:3,historyRowsPerPage:100,elapsedMs:45000,startSpacingMs:750,requestMs:3000,settlementMs:1000,responseBytes:2*1024*1024,clockResponseBytes:4096,totalResponseBytes:12*1024*1024+12288,evidenceBytes:256*1024,rssBytes:192*1024*1024});
const sha=b=>createHash('sha256').update(b).digest('hex');
const key=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const need=(v,why)=>{if(!v)throw Error(why);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function validatePlan(value){
 need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='classification,clockEndpoint,historyEndpoint,historyPageLimit,pools,schemaVersion','PLAN_SHAPE');
 need(value.schemaVersion===1&&value.classification==='post-c189-publicnode-history-only-availability-v3'&&value.historyEndpoint===ENDPOINT&&value.clockEndpoint===CLOCK_ENDPOINT&&value.historyPageLimit===100,'FIXED_ENDPOINT_PLAN');
 need(Array.isArray(value.pools)&&value.pools.length===3&&new Set(value.pools.map(x=>x.pool)).size===3,'THREE_DISTINCT_POOLS');
 for(const row of value.pools){need(row&&Object.keys(row).sort().join(',')==='contextFloor,evidence,mint,pool,role'&&key(row.pool)&&key(row.mint)&&integer(row.contextFloor)&&['repeated-timeout','successful-control'].includes(row.role)&&typeof row.evidence==='string'&&row.evidence.length<=512,'POOL_PLAN_ROW');}
 need(value.pools.filter(x=>x.role==='repeated-timeout').length===2&&value.pools.filter(x=>x.role==='successful-control').length===1,'CONTROL_AND_FAILURE_POPULATION');return value;
}
/** Same immutable Rust layout and checks as decodeResearchBankClock; offline
 * parity tests compare this standalone closure with that existing decoder. */
export function clockFloor(result,at){
 need(integer(at)&&result&&integer(result.context?.slot)&&Array.isArray(result.value)&&result.value.length===1,'CLOCK_BATCH');const wire=result.value[0],slot=result.context.slot;
 need(wire&&wire.owner==='Sysvar1111111111111111111111111111111111111'&&wire.executable===false&&wire.data?.[1]==='base64'&&typeof wire.data[0]==='string','CLOCK_OWNER_OR_ENCODING');
 const raw=Buffer.from(wire.data[0],'base64');need(raw.length===40&&raw.toString('base64')===wire.data[0],'CLOCK_LAYOUT');const accountSlot=raw.readBigUInt64LE(0),unix=raw.readBigInt64LE(32);need(accountSlot===BigInt(slot),'CLOCK_CONTEXT_MISMATCH');need(unix>0n&&unix<=BigInt(Number.MAX_SAFE_INTEGER),'CLOCK_TIMESTAMP_RANGE');const bankClockAt=Number(unix)*1000;need(bankClockAt<=at&&at-bankClockAt<=30000,'CLOCK_SOURCE_TIME');return {slot,bankClockAt,validatedAt:at,evidence:'confirmed-bank-clock; not getBlockTime; no pool quote/support inference'};
}
export function recoveryHint(rows,at){let notBeforeAt=0,unresolved=false;for(const r of rows){if(![429,502,503,504].includes(r.httpStatus)&&r.rpcErrorCode!==-32005)continue;let until=r.settledAt+(r.httpStatus===429?65000:10000);if(r.retryAfter!==undefined){let parsed=/^\d+$/.test(r.retryAfter)?r.headersAt+Number(r.retryAfter)*1000:Date.parse(r.retryAfter);if(!Number.isSafeInteger(parsed)||parsed<0)unresolved=true;else until=Math.max(until,parsed+5000);}notBeforeAt=Math.max(notBeforeAt,until);}return {recommendedNextRequestNotBeforeAt:notBeforeAt,unresolvedProviderCooldown:unresolved,stillActiveAtResult:notBeforeAt>at,policy:'Append-only diagnostic handoff only; account cooldown is not rewritten. Honor this receipt before any subsequent provider requests.'};}
export function watchTransport(getActive,record,now=Date.now){
 const requests=new WeakMap(),sockets=new WeakMap();let nextSocket=0;const used=new WeakSet(),subscriptions=[];
 const sub=(name,fn)=>{const c=channel(name);c.subscribe(fn);subscriptions.push([c,fn]);};
 sub('undici:request:create',({request})=>{const row=getActive();if(!row||request?.origin!==row.endpoint||request?.method!=='POST')return;requests.set(request,row);row.transportRequestCreatedAt=now();record('transport-request-created',{request:row.ordinal,endpoint:row.endpoint,at:row.transportRequestCreatedAt});});
 sub('undici:client:sendHeaders',({request,socket})=>{const row=requests.get(request);if(!row||!socket||typeof socket.once!=='function')return;let id=sockets.get(socket);if(!id){id=++nextSocket;sockets.set(socket,id);}row.socketId=id;row.connectionReused=used.has(socket);used.add(socket);row.transportSentAt=now();row.socketClosed=false;socket.once('close',()=>{row.socketClosed=true;row.socketClosedAt=now();});record('transport-send-headers',{request:row.ordinal,at:row.transportSentAt,socketId:id,connectionReused:row.connectionReused,timingMeaning:'undici pre-write hook; not proven wire transmission or remote receipt'});});
 sub('undici:request:trailers',({request})=>{const row=requests.get(request);if(row){row.transportTerminal='trailers';row.transportTerminalAt=now();}});
 sub('undici:request:headers',({request,response})=>{const row=requests.get(request);if(row){row.transportHeadersAt=now();row.transportStatus=integer(response?.statusCode)?response.statusCode:null;}});
 sub('undici:request:error',({request,error})=>{const row=requests.get(request);if(row){row.transportTerminal='error';row.transportTerminalAt=now();row.transportErrorCode=typeof error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'UNAVAILABLE';}});
 return ()=>{for(const[c,fn]of subscriptions)c.unsubscribe(fn);};
}
/** Injection is only for deterministic offline tests; CLI accepts no endpoint,
 * timeout, pool or transport overrides outside the exact reviewed plan. */
export async function measure(plan,options={}){
 validatePlan(plan);const now=options.now??Date.now,mono=options.mono??(()=>performance.now()),pause=options.sleep??sleep,fetcher=options.fetcher??fetch,record=options.record??(()=>{}),arm=options.setTimer??setTimeout,disarm=options.clearTimer??clearTimeout,startedAt=now(),began=mono(),maximumMs=options.maximumMs??LIMITS.elapsedMs;need(integer(maximumMs)&&maximumMs>0&&maximumMs<=LIMITS.elapsedMs,'FINITE_AGGREGATE_TIME');let active=null,received=0,uncertain=0,lastStart=-Infinity,stop='COMPLETE';const rows=[];
 const unwatch=options.watch===false?()=>{}:watchTransport(()=>active,record,now);
 async function execute(pool,method,params,meta,maximumBytes){
  if(stop!=='COMPLETE')return null;const wait=Math.max(0,LIMITS.startSpacingMs-(mono()-lastStart));if(wait)await pause(wait);
  if(mono()-began>=maximumMs-LIMITS.requestMs-LIMITS.settlementMs||received+maximumBytes>LIMITS.totalResponseBytes){stop='SHUTDOWN_RESERVE';return null;}
  if((options.rss??(()=>process.memoryUsage().rss))()>LIMITS.rssBytes){stop='RSS_STOP';return null;}
  const endpoint=method==='getMultipleAccounts'?CLOCK_ENDPOINT:ENDPOINT;
  const row={ordinal:rows.length+1,endpoint,pool:pool.pool,mint:pool.mint,role:pool.role,method,...meta,requestedAt:now(),physicalInvokedAt:null,headersAt:null,firstBodyAt:null,bodyCompleteAt:null,decodedAt:null,settledAt:null,bytes:0,httpStatus:null,connectionReused:null,socketId:null,transportTerminal:null,outcome:'STARTED'};
  need(row.ordinal<=LIMITS.requests&&active===null,'ONE_PHYSICAL_OPERATION');rows.push(row);active=row;const opBegan=mono(),controller=new AbortController();let timer,physicalBegan=null,reader=null,complete=false,result=null;
  record('request-start',{...row,commitment:'confirmed',uncertainReservationBytes:LIMITS.responseBytes});
  try{
   need(mono()-began<maximumMs-LIMITS.requestMs-LIMITS.settlementMs,'PRESTART_CUTOFF');
   physicalBegan=mono();lastStart=physicalBegan;row.physicalInvokedAt=now();timer=arm(()=>{row.abortRequestedAt=now();controller.abort(Error('DIAGNOSTIC_3000MS_TIMEOUT'));},LIMITS.requestMs);
   const response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'poe-http-latency-'+row.ordinal,method,params}),signal:controller.signal,redirect:'error'});
   row.headersAt=now();row.httpStatus=response.status;const retry=response.headers.get('retry-after');if(retry!==null)row.retryAfter=retry.slice(0,128);
   if(response.status===429||[502,503,504].includes(response.status)){row.outcome='PROVIDER_STOP';stop='PROVIDER_STOP';controller.abort(Error('PROVIDER_STOP'));throw Error('PROVIDER_STOP');}
   reader=response.body?.getReader();need(reader,'RESPONSE_BODY_REQUIRED');const parts=[];
   for(;;){const v=await reader.read();if(v.done){complete=true;row.bodyCompleteAt=now();break;}row.firstBodyAt??=now();row.bytes+=v.value.byteLength;received+=v.value.byteLength;need(row.bytes<=maximumBytes&&received<=LIMITS.totalResponseBytes,'RESPONSE_BYTE_STOP');parts.push(v.value);}
   need(response.ok,'HTTP_STATUS');const body=Buffer.concat(parts);row.responseSha256=sha(body);const value=JSON.parse(body.toString('utf8'));row.decodedAt=now();need(value?.jsonrpc==='2.0'&&value.id==='poe-http-latency-'+row.ordinal,'RPC_ENVELOPE');
   if(value.error){row.rpcErrorCode=Number.isSafeInteger(value.error.code)?value.error.code:null;row.outcome='RPC_ERROR';if(value.error.code===-32005)stop='RPC_OVERLOAD';}
   else{if(method==='getMultipleAccounts'){result=clockFloor(value.result,now());row.clock=result;const w=value.result.value[0];row.clockAccountEvidence={contextSlot:value.result.context.slot,owner:w.owner,executable:w.executable,data:w.data};}else{need(Array.isArray(value.result)&&value.result.length<=plan.historyPageLimit,'HISTORY_SHAPE');row.rows=value.result.length;result={rows:row.rows};}row.outcome='COMPLETE_JSON_RESPONSE';}
  }catch(error){if(row.physicalInvokedAt===null){row.outcome='NOT_PHYSICALLY_INVOKED';stop='SHUTDOWN_RESERVE';}else if(row.outcome==='STARTED')row.outcome=controller.signal.aborted?'TIMED_OUT_OR_ABORTED':error?.message==='RESPONSE_BYTE_STOP'?'RESPONSE_BYTE_STOP':'TRANSPORT_OR_VALIDATION_UNAVAILABLE';if(row.outcome==='RESPONSE_BYTE_STOP')stop='RESPONSE_BYTE_STOP';else if(complete&&row.outcome==='TRANSPORT_OR_VALIDATION_UNAVAILABLE')stop='RESPONSE_VALIDATION_STOP';controller.abort();}
  finally{
   disarm(timer);const until=mono()+LIMITS.settlementMs;row.readerCancellationSettled=reader===null;let cancelTimer;
   if(reader){const cancellation=reader.cancel().catch(()=>{}).then(()=>{row.readerCancellationSettled=true;});try{await Promise.race([cancellation,new Promise(resolve=>{cancelTimer=arm(resolve,LIMITS.settlementMs);})]);}finally{disarm(cancelTimer);}}
   try{reader?.releaseLock();}catch{}
   if(!complete&&row.physicalInvokedAt!==null){uncertain+=LIMITS.responseBytes;const settled=()=>row.transportTerminal==='trailers'||row.transportTerminal==='error'&&row.socketClosed===true;while(mono()<until&&!settled())await pause(10);row.physicalSettlementConfirmed=settled();if(!row.physicalSettlementConfirmed){row.physicalSettlementUnverified=true;if(stop==='COMPLETE')stop='PHYSICAL_SETTLEMENT_UNVERIFIED';}}
   else row.physicalSettlementConfirmed=true;
   if(!row.readerCancellationSettled&&stop==='COMPLETE')stop='CANCELLATION_SETTLEMENT_UNVERIFIED';
   row.settledAt=now();row.elapsedMs=mono()-opBegan;row.physicalElapsedMs=physicalBegan===null?null:mono()-physicalBegan;record('request-settlement',{...row,completeBody:complete,uncertainReservationBytes:complete||row.physicalInvokedAt===null?0:LIMITS.responseBytes,physicalBytesMeaning:'Response body only; HTTP/TLS/wire overhead unavailable'});active=null;
  }
  return result;
 }
 try{for(let index=0;index<plan.pools.length&&stop==='COMPLETE';index++){
  const pool=plan.pools[index],clock=await execute(pool,'getMultipleAccounts',[[CLOCK],{encoding:'base64',commitment:'confirmed'}],{purpose:'fresh-confirmed-clock-floor',pair:index+1},LIMITS.clockResponseBytes);
  if(!clock){if(stop==='COMPLETE')stop='FRESH_CLOCK_UNAVAILABLE';break;}
  const order=index%2===0?['historical','fresh']:['fresh','historical'];
  for(const kind of order){if(stop!=='COMPLETE')break;const floor=kind==='fresh'?clock.slot:pool.contextFloor;await execute(pool,'getSignaturesForAddress',[pool.pool,{limit:plan.historyPageLimit,commitment:'confirmed',minContextSlot:floor}],{purpose:'fixed-publicnode-page100-availability',requestedLimit:plan.historyPageLimit,pair:index+1,floorKind:kind,minContextSlot:floor,freshClockValidatedAt:clock.validatedAt,freshClockSlot:clock.slot},LIMITS.responseBytes);}
 }}finally{unwatch();}
 return {schemaVersion:1,kind:'POE_HTTP_LATENCY_COMPONENT_RESULT',experimentVersion:'post-c189-publicnode-history-only-availability-v3',clockEndpoint:CLOCK_ENDPOINT,historyEndpoint:ENDPOINT,startedAt,endedAt:now(),elapsedMs:mono()-began,stopReason:stop,limits:LIMITS,requests:rows.filter(r=>r.physicalInvokedAt!==null).length,historyRequests:rows.filter(r=>r.physicalInvokedAt!==null&&r.method==='getSignaturesForAddress').length,clockRequests:rows.filter(r=>r.physicalInvokedAt!==null&&r.method==='getMultipleAccounts').length,receivedResponseBytes:received,uncertainResponseBytes:uncertain,recovery:recoveryHint(rows,now()),rows,financialStateRead:false,marketObservationWindowCreated:false,historyRowsValidated:false,qualificationPermitted:false,productionChanged:false,apiFee:'Keyless public RPC advertised free in retrieved official sources; no provider-plan change',providerEntitlementMeaning:'Numeric free quota and SLA unverified; bounded component only, not production capacity or failover adoption',costLimitation:'Existing compute/transfer/storage costs not established',connectionEvidence:'Actual undici socket object reuse only; absent diagnostics means UNKNOWN, not a new connection',transportSendHeadersMeaning:'transportSentAt is the undici pre-write hook; not actual wire transmission or remote receipt',originTimeMeaning:'Historical primary-provider floors and fresh primary-provider bank Clock floors are tested on history-only alternative; neither getBlockTime, cross-provider coherent state nor pool/price validation is established',interpretation:'Three paired pools and alternating order are diagnostic only; no causal or provider-capacity claim follows from six history calls; full audit paging/completeness is not tested'};
}
export async function cli(args){
 need(args.length===4&&args[0]==='--run','EXPLICIT_FIXED_PLAN_AND_RECEIPT_REQUIRED');need(process.getuid?.()===994,'NONROOT_RUNNER_REQUIRED');const planRaw=readFileSync(args[1]);need(planRaw.length<=8192,'PLAN_BYTE_BOUND');const plan=validatePlan(JSON.parse(planRaw));const before=JSON.parse(readFileSync(args[3]));need(before.kind==='poe-http-latency-preflight-v1'&&before.uid===994&&integer(before.startedAt)&&Date.now()>=before.startedAt&&Date.now()-before.startedAt<15000,'REVIEWED_PREFLIGHT_REQUIRED');const fd=openSync(args[2],'wx',0o600);let bytes=0;
 const record=(kind,data)=>{const raw=JSON.stringify({kind,data})+'\n';bytes+=Buffer.byteLength(raw);need(bytes<=LIMITS.evidenceBytes,'EVIDENCE_BYTE_BOUND');let n=0;while(n<Buffer.byteLength(raw))n+=writeSync(fd,Buffer.from(raw).subarray(n));fsyncSync(fd);};
 try{record('measurement-start',{at:Date.now(),sourceSha256:sha(readFileSync(new URL(import.meta.url))),planSha256:sha(planRaw),limits:LIMITS,noAutomaticRetry:true,unchangedRuntimeAuditDeadline:true});const result=await measure(plan,{record,maximumMs:Math.max(1,LIMITS.elapsedMs-10000-(Date.now()-before.startedAt))});result.aggregateStartedAt=before.startedAt;result.aggregateElapsedMs=Date.now()-before.startedAt;record('measurement-result',result);console.log(JSON.stringify(result));return result;}finally{fsyncSync(fd);closeSync(fd);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)cli(process.argv.slice(2)).catch(()=>{console.error('POE_HTTP_LATENCY_PROBE_REFUSED');process.exitCode=2;});
