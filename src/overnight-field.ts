/** One isolated, field-only PumpApi measurement. Broad traffic is counted then
 * discarded; only exact-scope hints and confirmed enrichment are retained.
 * Caller durably reserves the grant before calling. No publishing or trading. */
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {ActivePipeline,type ActiveScope} from './active-pipeline.js';
import {PUMPAPI_STREAM} from './pumpapi-probe.js';
import type {ComponentBudget} from './component-budget.js';
import type {ComponentTransport} from './component-transport.js';

const MIB=1024*1024;
export const OVERNIGHT_FIELD_LIMITS=Object.freeze({connectionMs:30000,shutdownMs:5000,enrichmentAttempts:24,payloadBytes:65536,socketStopBytes:63*MIB,applicationStopBytes:62*MIB,hardSocketBytes:64*MIB,retainedBytes:5*MIB,cpuMs:20000,rssBytes:256*MIB,eventLoopLagMs:500});
type RecordFn=(kind:string,data:unknown)=>void;
export type OvernightFieldInput={scope:ActiveScope;budget:ComponentBudget;rpc:ComponentTransport;record:RecordFn;signal:AbortSignal};
export type OvernightFieldDependencies={makeSocket?:(endpoint:string,options:WebSocket.ClientOptions)=>WebSocket;now?:()=>number;monotonic?:()=>number;sleep?:(ms:number)=>Promise<void>};
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,110}$/.test(e.message)?e.message:'COMPONENT_FIELD_FAILURE';

export async function captureOvernightFields(input:OvernightFieldInput,dependencies:OvernightFieldDependencies={}){
  if(input.signal.aborted)throw Error('COMPONENT_FIELD_ABORTED');
  if(input.rpc.budget!==input.budget)throw Error('COMPONENT_FIELD_SHARED_BUDGET_REQUIRED');
  const now=dependencies.now??Date.now,mono=dependencies.monotonic??(()=>performance.now()),sleep=dependencies.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  const cpu0=process.cpuUsage(),connectionStartedAt=now(),connectionStartedMono=mono(),controller=new AbortController(),signal=AbortSignal.any([input.signal,controller.signal]);
  let retainedBytes=0,recordingFailed=false;
  const record:RecordFn=(kind,data)=>{if(recordingFailed)return;const size=Buffer.byteLength(JSON.stringify({kind,recordedAt:now(),data})+'\n');if(retainedBytes+size>OVERNIGHT_FIELD_LIMITS.retainedBytes){recordingFailed=true;throw Error('COMPONENT_FIELD_EVIDENCE_CAP');}retainedBytes+=size;try{input.record(kind,data);}catch{recordingFailed=true;throw Error('COMPONENT_FIELD_STORAGE_FAILURE');}};
  const pipeline=new ActivePipeline({scope:input.scope,now,record}),mintBytes=Buffer.from(input.scope.mint),poolBytes=Buffer.from(input.scope.pool);
  const transactions:Record<string,unknown>={},hints:Record<string,{signature:string;receivedAt:number;requestedAt:number;availableAt:number}>={};
  let ws:WebSocket|undefined,openedAt:number|null=null,endedAt:number|null=null,stopReason:string|null=null,closed=false,seenSocketBytes=0,socketBytes=0,upgradeObservedBytes=0,applicationBytes=0,frames=0,parsedFrames=0,irrelevantFrames=0,enrichments=0,busy=false,workPromise:Promise<void>|null=null,maxLag=0,maxRss=0,maxCpu=0,lastTick=mono(),lastFeature=0;
  let resolveClosed!:()=>void;const closedPromise=new Promise<void>(r=>{resolveClosed=r;});
  const stop=(reason:string,gap=false)=>{
    if(stopReason)return;stopReason=reason;endedAt=now();
    try{if(openedAt!==null){if(gap)pipeline.gap(reason,endedAt);pipeline.endObservation(endedAt,reason);}}finally{ws?.terminate();}
  };
  const abort=()=>{controller.abort();try{stop('COMPONENT_FIELD_ABORTED',true);}catch{ws?.terminate();}};input.signal.addEventListener('abort',abort,{once:true});
  const sampleSocket=()=>{
    const n=(ws as unknown as {_socket?:{bytesRead?:number}})?._socket?.bytesRead;
    if(!Number.isSafeInteger(n)||Number(n)<seenSocketBytes)throw Error('COMPONENT_FIELD_SOCKET_COUNTER');
    seenSocketBytes=Number(n);socketBytes=seenSocketBytes;
    if(socketBytes>=OVERNIGHT_FIELD_LIMITS.hardSocketBytes){stop('COMPONENT_FIELD_HARD_BYTE_CAP',true);return;}
    if(socketBytes>=OVERNIGHT_FIELD_LIMITS.socketStopBytes)stop('COMPONENT_FIELD_SOCKET_STOP',true);
  };
  const resources=()=>{
    const current=mono(),lag=Math.max(0,current-lastTick-100);lastTick=current;maxLag=Math.max(maxLag,lag);maxRss=Math.max(maxRss,process.memoryUsage().rss);const cpu=process.cpuUsage(cpu0);maxCpu=Math.max(maxCpu,(cpu.user+cpu.system)/1000);
    if(maxLag>500||maxRss>256*MIB||maxCpu>20000){stop('COMPONENT_FIELD_RESOURCE_STOP',true);controller.abort();}
  };
  const work=async()=>{
    if(busy||stopReason||openedAt===null)return;busy=true;
    try{
      const hint=pipeline.nextHint(now());if(pipeline.hasQualityLoss){stop('COMPONENT_FIELD_SELECTED_WINDOW_UNUSABLE',true);return;}if(!hint)return;
      if(enrichments>=24){pipeline.failHint('COMPONENT_FIELD_ENRICHMENT_CAP',now());stop('COMPONENT_FIELD_ENRICHMENT_CAP',true);return;}
      enrichments++;const requestedAt=now(),before=input.budget.calls;
      const transaction=await input.rpc.call<unknown>('getTransaction',[hint.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],signal),availableAt=now();
      record('confirmed-enrichment',{hint,requestedAt,availableAt,requests:input.budget.calls-before,transaction});
      if(!transaction){pipeline.failHint('COMPONENT_FIELD_CONFIRMED_NULL_NO_RETRY',availableAt);stop('COMPONENT_FIELD_CONFIRMED_NULL_NO_RETRY',true);return;}
      if(!Number.isSafeInteger((transaction as {slot?:number}).slot)||Number((transaction as {slot?:number}).slot)<input.scope.minSlot){pipeline.failHint('COMPONENT_FIELD_STALE_TRANSACTION_SLOT',availableAt);stop('COMPONENT_FIELD_STALE_TRANSACTION_SLOT',true);return;}
      transactions[hint.signature]=transaction;hints[hint.signature]={signature:hint.signature,receivedAt:hint.receivedAt,requestedAt,availableAt};
      pipeline.completeHint(hint,transaction,availableAt);
      if(pipeline.hasQualityLoss)stop('COMPONENT_FIELD_MAPPING_UNUSABLE',true);
    }catch(e){try{pipeline.failHint(safe(e),now());stop(safe(e),true);}catch{ws?.terminate();stopReason??=safe(e);}}
    finally{busy=false;}
  };
  try{
    await input.budget.operate({transport:'ws-upgrade',method:'upgrade'},async op=>new Promise<void>((resolve,reject)=>{
      const options:WebSocket.ClientOptions={agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:65536,perMessageDeflate:false,followRedirects:false,handshakeTimeout:3000};
      ws=dependencies.makeSocket?.(PUMPAPI_STREAM,options)??new WebSocket(PUMPAPI_STREAM,options);
      let upgradeSettled=false;const settle=(error?:Error)=>{if(upgradeSettled)return;upgradeSettled=true;op.signal.removeEventListener('abort',cancel);if(error)reject(error);else resolve();};
      const cancel=()=>{ws?.terminate();settle(Error('COMPONENT_FIELD_UPGRADE_ABORTED'));};op.signal.addEventListener('abort',cancel,{once:true});
      ws.on('open',()=>{try{
        sampleSocket();if(stopReason)throw Error(stopReason);upgradeObservedBytes=socketBytes;
        // bytesRead at open can include coalesced initial data. Charging the
        // entire observed prefix is conservative, not an exact header count.
        for(let left=upgradeObservedBytes;left>0;){const n=Math.min(left,65536);input.budget.chargeWs(n);left-=n;}
        const rawSocket=(ws as unknown as {_socket?:{prependListener?:(event:string,listener:()=>void)=>void}})._socket;
        if(!rawSocket?.prependListener)throw Error('COMPONENT_FIELD_PREPARSE_COUNTER_REQUIRED');
        rawSocket.prependListener('data',()=>{try{sampleSocket();}catch{try{stop('COMPONENT_FIELD_SOCKET_COUNTER',true);}catch{ws?.terminate();}}});
        openedAt=now();pipeline.open(openedAt);op.completeResponse();record('field-stream-open',{endpoint:PUMPAPI_STREAM,at:openedAt,upgradeObservedBytes,dataOnly:true,subscriptionMessagesSent:0});settle();
      }catch(e){settle(Error(safe(e)));try{stop(safe(e),true);}catch{ws?.terminate();}}});
      ws.on('message',raw=>{try{
        const receivedAt=now(),b=Array.isArray(raw)?Buffer.concat(raw):typeof raw==='string'?Buffer.from(raw):Buffer.from(raw as ArrayBuffer);frames++;applicationBytes+=b.byteLength;sampleSocket();
        if(b.byteLength>65536){stop('COMPONENT_FIELD_OVERSIZE_PAYLOAD',true);return;}
        if(applicationBytes>=62*MIB){stop('COMPONENT_FIELD_APPLICATION_STOP',true);return;}
        if(mono()-connectionStartedMono>=30000){stop('COMPONENT_FIELD_DURATION_LIMIT');return;}
        if(stopReason)return;
        if(!b.includes(mintBytes)&&!b.includes(poolBytes)){irrelevantFrames++;return;}
        parsedFrames++;const payload=JSON.parse(b.toString('utf8'));
        if(!payload||typeof payload!=='object'||Array.isArray(payload)){stop('COMPONENT_FIELD_SELECTED_SHAPE',true);return;}
        const selected=payload.poolId===input.scope.pool||payload.mint===input.scope.mint&&(payload.poolId===undefined||payload.poolId===null);
        if(!selected){irrelevantFrames++;return;}
        record('selected-pumpapi-payload',{receivedAt,payloadUtf8:b.toString('utf8'),sha256:createHash('sha256').update(b).digest('hex')});
        if(pipeline.observe(payload,receivedAt)==='invalid')stop('COMPONENT_FIELD_SELECTED_INVALID',true);
      }catch(e){try{stop(safe(e),true);}catch{ws?.terminate();}}});
      ws.on('unexpected-response',(_request,response)=>{const status=response.statusCode;try{const n=response.socket?.bytesRead;if(Number.isSafeInteger(n)&&Number(n)>=0){socketBytes=seenSocketBytes=upgradeObservedBytes=Number(n);for(let left=upgradeObservedBytes;left>0;){const delta=Math.min(left,65536);input.budget.chargeWs(delta);left-=delta;}}}catch{}response.destroy();const reason=status===429?'COMPONENT_HTTP_429':'COMPONENT_FIELD_UPGRADE_REFUSED';settle(Error(reason));try{stop(reason,true);}catch{ws?.terminate();}});
      ws.on('error',()=>{settle(Error('COMPONENT_FIELD_TRANSPORT'));try{stop('COMPONENT_FIELD_TRANSPORT',true);}catch{ws?.terminate();}});
      ws.on('close',()=>{if(closed)return;closed=true;try{sampleSocket();if(!stopReason)stop('COMPONENT_FIELD_UNEXPECTED_CLOSE',true);}catch{stopReason??='COMPONENT_FIELD_SOCKET_COUNTER';}resolveClosed();settle(Error(stopReason??'COMPONENT_FIELD_CLOSED'));});
    }),signal,{timeoutMs:4000});
    lastTick=mono();while(!closed&&!signal.aborted){
      resources();sampleSocket();
      if(input.rpc.error()||input.budget.usage().haltedReason){stop(input.budget.usage().haltedReason??'COMPONENT_FIELD_RPC_FAILURE',true);controller.abort();}
      if(mono()-connectionStartedMono>=30000)stop('COMPONENT_FIELD_DURATION_LIMIT');
      if(openedAt!==null&&!stopReason&&now()-lastFeature>=1000){pipeline.tick(now());lastFeature=now();}
      if(!busy&&!stopReason)workPromise=work();
      if(stopReason)break;await sleep(100);
    }
  }catch(e){try{stop(safe(e),true);}catch{ws?.terminate();stopReason??=safe(e);}}
  finally{
    if(!stopReason)try{stop(signal.aborted?'COMPONENT_FIELD_ABORTED':'COMPONENT_FIELD_SOURCE_ENDED',true);}catch{ws?.terminate();}
    const shutdownEnd=Math.min(mono()+5000,connectionStartedMono+35000);
    while(busy&&mono()<shutdownEnd&&!input.signal.aborted){if(mono()>shutdownEnd-1000)controller.abort();await sleep(25);}
    if(busy)controller.abort();
    if(!busy&&workPromise)await workPromise;
    if(ws&&!closed)await Promise.race([closedPromise,sleep(Math.max(0,Math.min(600,shutdownEnd-mono())))]);
    if(!closed){try{pipeline.gap('COMPONENT_FIELD_SOCKET_CLOSE_UNCERTAIN',now());}catch{}}
    try{pipeline.close(now(),stopReason??'COMPONENT_FIELD_END');}catch{stopReason??='COMPONENT_FIELD_EVIDENCE_CAP';}
    input.signal.removeEventListener('abort',abort);
  }
  const state=pipeline.snapshot(now());
  return {...state,mode:'FIELD_ONLY_RESEARCH',connectionStartedAt,openedAt,endedAt,openMs:openedAt===null||endedAt===null?0:endedAt-openedAt,elapsedMs:mono()-connectionStartedMono,stopReason,frames,applicationBytes,socketBytes,broadSocketBytes:Math.max(0,socketBytes-upgradeObservedBytes),upgradeObservedBytes,parsedFrames,irrelevantFrames,enrichments,retainedBytes,recordingFailed,resources:{peakRssBytes:maxRss,peakCpuMs:maxCpu,peakEventLoopLagMs:maxLag},physicalSlotUncertain:busy||input.budget.inFlight!==0||Boolean(ws&&!closed),enrichmentTransactions:transactions,enrichmentHints:hints,qualificationEnabled:false,complete60SecondFeatureWindows:0,priceAttempts:0,streamTrafficAccounting:'Full socket bytesRead includes upgrade prefix; upgrade prefix also conservatively charged to RPC-related WS. Broad application/socket traffic is not charged as RPC notifications.',apiDataFeesUsd:'0 documented public/data-only endpoints; infrastructure transfer allocation unverified'};
}
