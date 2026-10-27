/** ONE owner-approved isolated PumpApi/public-RPC experiment. No financial API. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,lstatSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {PublicKey} from '@solana/web3.js';
import {ResearchRpc} from '../src/research-rpc.js';
import {selectActivePool,type ActiveCandidate} from '../src/active-selection.js';
import {ActivePipeline} from '../src/active-pipeline.js';
import {quotePositionSell} from '../src/pool.js';
import type {ReadOnlyRpc} from '../src/network.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {readSourceVersion} from '../src/source-version.js';

const MIB=1024*1024,ROOT=resolve('evidence/free-data-20261027'),SCRIPT=fileURLToPath(import.meta.url),LOCK='/tmp/poe-pumpapi-probe.lock';
const GRANT=resolve(ROOT,'active-approved-allowance.json'),RPC_BUDGET=resolve(ROOT,'active-approved-rpc-budget.json'),OLD_BUDGET=resolve(ROOT,'pumpapi-budget.json');
const LIMITS=Object.freeze({cumulativeSocketBytes:256*MIB,cumulativeReservedMs:300_000,newSocketReservation:128*MIB,newSocketStop:127*MIB,applicationStop:126*MIB,captureMs:90_000,shutdownMs:5000,retainedBytes:32*MIB,recordBytes:12*MIB,payloadBytes:65_536,rssBytes:256*MIB,cpuMs:30_000,eventLoopLagMs:500,parentWallMs:280_000,enrichmentAttempts:48,auditCalls:12,pricingCycles:45});
const mode=process.argv[2];
if(resolve(process.argv[1]??'')===SCRIPT){
if(mode==='run-approved'){
  const p=spawn('flock',['-n','-F',LOCK+'.budget',process.execPath,'--use-env-proxy','--import','tsx',SCRIPT,'--locked'],{stdio:'inherit'});
  process.exitCode=await new Promise<number>(r=>{p.once('error',()=>r(2));p.once('exit',c=>r(c??2));});
}else if(mode==='--locked')await parent();
else if(mode==='--child'){
  if(!process.send||process.getuid?.()!==1000)throw Error('SUPERVISED_NONROOT_CHILD_REQUIRED');
  process.once('message',()=>{void child().catch(()=>{if(process.connected)process.send?.({kind:'fatal',reason:'BOUNDED_CHILD_FAILURE'},undefined,undefined,()=>process.disconnect());process.exitCode=2;});});
}else console.log(JSON.stringify({networkStarted:false,usage:'node --import tsx scripts/active-pumpapi-trial.ts run-approved',oneAttempt:true,limits:LIMITS,productionChanged:false}));
}

function json(path:string,value:unknown,exclusive=false){const s=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(s)>1024*1024)throw Error('SUMMARY_LIMIT');writeFileSync(path,s,{mode:0o600,flag:exclusive?'wx':'w'});}
function atomic(path:string,value:unknown){const tmp=path+'.pending-'+process.pid,fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,path);}
function disk(path=ROOT):number{return readdirSync(path).reduce((n,f)=>{const p=resolve(path,f),s=lstatSync(p);if(s.isSymbolicLink())throw Error('RESEARCH_EVIDENCE_SYMLINK');return n+(s.isDirectory()?disk(p):s.size);},0);}
function safe(error:unknown){const s=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_:;-]{0,127}$/.test(s)?s:'BOUNDED_RESEARCH_UNAVAILABLE';}
function compactSelection(selection:any){return {...selection,evidence:{...selection.evidence,transactions:selection.evidence.transactions.map((x:any)=>({signature:x.signature,requestedAt:x.requestedAt,availableAt:x.availableAt,slot:x.transaction?.slot,version:x.transaction?.version,transactionSha256:createHash('sha256').update(JSON.stringify(x.transaction)).digest('hex')}))}};}
function sources(){return {version:readSourceVersion(dirname(SCRIPT)),sha256:Object.fromEntries([SCRIPT,'../src/research-rpc.ts','../src/active-selection.ts','../src/active-pipeline.ts','../src/pumpapi-mapping.ts','../src/pool.ts','../src/strategy.ts','../package-lock.json'].map(p=>p.startsWith('/')?p:resolve(dirname(SCRIPT),p)).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};}

async function parent(){
  if(process.getuid?.()!==1000||disk()+LIMITS.recordBytes+2*MIB>LIMITS.retainedBytes)throw Error('NONROOT_OR_EVIDENCE_CAPACITY_REQUIRED');
  if(existsSync(GRANT))throw Error('APPROVED_ATTEMPT_ALREADY_RECORDED_NO_RETRY');
  const prior=JSON.parse(readFileSync(OLD_BUDGET,'utf8'));
  if(prior.reservedBytes!==112*MIB||prior.reservedMs!==100_000||prior.attempts.length!==2)throw Error('PRIOR_COUNTERS_CHANGED_REVIEW_REQUIRED');
  json(GRANT,{schemaVersion:1,authorization:'Owner explicitly approved one bounded active-pool test in this conversation',recordedAt:new Date().toISOString(),status:'preflight-started-one-attempt-only',limits:LIMITS,priorPumpApiBudgetSha256:createHash('sha256').update(readFileSync(OLD_BUDGET)).digest('hex'),prior:{reservedBytes:prior.reservedBytes,reservedMs:prior.reservedMs,attempts:prior.attempts},rpc:{requests:240,responseBytes:64*MIB,startsPerMinute:150,startsPer10Seconds:30,inFlight:1},sources:sources(),providers:['PumpApi credential-free stream','Solana public RPC'],productionChanged:false},true);
  const p=spawn('flock',['-n','-F',LOCK,'prlimit','--cpu=30:35','--fsize=16777216:16777216','--nofile=64:64','--',process.execPath,'--max-old-space-size=128','--use-env-proxy','--import','tsx',SCRIPT,'--child'],{stdio:['ignore','pipe','pipe','ipc']});
  const began=performance.now();let lastHeartbeat=began,ready=false,peakRss=0,final:any=null,stopReason:string|null=null,stdout=0,stderr=0,captureHardEndAt:number|null=null;
  const stop=(reason:string)=>{if(stopReason)return;stopReason=reason;p.kill('SIGTERM');setTimeout(()=>p.kill('SIGKILL'),1000).unref();};
  p.stdout!.on('data',b=>{stdout+=b.byteLength;if(stdout>32768)stop('SUPERVISOR_STDOUT_CAP');});p.stderr!.on('data',b=>{stderr+=b.byteLength;if(stderr>32768)stop('SUPERVISOR_STDERR_CAP');});
  p.on('message',(m:any)=>{if(m?.kind==='capture-deadline'){captureHardEndAt=m.hardEndAt;}else if(m?.kind==='capture-ended'){captureHardEndAt=null;}else if(m?.kind==='progress'){lastHeartbeat=performance.now();ready=true;}else if(m?.kind==='final'){final=m.summary;lastHeartbeat=performance.now();}else if(m?.kind==='fatal')stop('CHILD_FAILED');});
  const watch=setInterval(()=>{const now=performance.now();if(captureHardEndAt!==null&&Date.now()>=captureHardEndAt-500){stopReason??='SUPERVISOR_CAPTURE_HARD_LIMIT';p.kill('SIGKILL');}if(now-began>LIMITS.parentWallMs)stop('SUPERVISOR_WALL_CAP');if(now-lastHeartbeat>(ready?3000:8000))stop('SUPERVISOR_HEARTBEAT_CAP');if(p.pid){try{const text=readFileSync('/proc/'+p.pid+'/status','utf8'),rss=Number(text.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1])*1024;if(Number.isSafeInteger(rss)){peakRss=Math.max(peakRss,rss);if(rss>LIMITS.rssBytes)stop('SUPERVISOR_RSS_CAP');}}catch{}}},100);
  p.once('spawn',()=>p.send({approved:true}));
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>{p.once('error',()=>r({code:2,signal:null}));p.once('exit',(code,signal)=>r({code,signal}));});clearInterval(watch);
  const receipt={recordedAt:new Date().toISOString(),supervisor:{wallMs:performance.now()-began,peakRssBytes:peakRss,stopReason,stdoutBytes:stdout,stderrBytes:stderr,exit},summary:final,uncertainAttempt:!final,noRetry:true};
  json(resolve(ROOT,'active-approved-supervisor.json'),receipt,true);console.log(JSON.stringify({receipt:resolve(ROOT,'active-approved-supervisor.json'),outcome:final?.outcome??'UNCERTAIN_ATTEMPT',stopReason,exit}));if(exit.code!==0||!final)process.exitCode=2;
}

async function child(){
  let recordOpen=true;const began=performance.now(),cpuStart=process.cpuUsage(),recordPath=resolve(ROOT,'active-approved-record.ndjson'),fd=openSync(recordPath,'wx',0o600);let retained=0,sequence=0;
  const record=(kind:string,data:unknown)=>{if(!recordOpen)return;const line=JSON.stringify({schemaVersion:1,sequence:++sequence,receivedAt:Date.now(),receivedMonotonicMs:performance.now(),kind,data})+'\n';if(retained+Buffer.byteLength(line)>LIMITS.recordBytes)throw Error('RETAINED_EVIDENCE_CAP');writeFileSync(fd,line);retained+=Buffer.byteLength(line);};
  let terminated=false,lastTick=performance.now(),peakLoop=0,peakRss=0,stage='preflight',socket:WebSocket|undefined;
  const globalAbort=new AbortController();const signal=()=>{terminated=true;globalAbort.abort();socket?.terminate();};process.once('disconnect',signal);process.once('SIGTERM',signal);process.once('SIGINT',signal);
  let heartbeatPending=false;
  const watch=setInterval(()=>{const now=performance.now(),rss=process.memoryUsage().rss,cpu=process.cpuUsage(cpuStart);peakLoop=Math.max(peakLoop,Math.max(0,now-lastTick-100));lastTick=now;peakRss=Math.max(peakRss,rss);if(rss>LIMITS.rssBytes||(cpu.user+cpu.system)/1000>LIMITS.cpuMs||now-began>LIMITS.parentWallMs-5000){signal();}if(!heartbeatPending&&process.connected){heartbeatPending=true;process.send?.({kind:'progress',stage,rss,at:Date.now()},undefined,undefined,()=>{heartbeatPending=false;});}},100);
  const rpc=new ResearchRpc({budgetPath:RPC_BUDGET,timeoutMs:8000});
  let summary:any;
  try{
    record('approved-configuration',{limits:LIMITS,sources:sources(),rpc:rpc.usage(),enrichmentDelayMs:1000,enrichmentDeadlineMs:5000,pricingAttemptCadenceMs:2000,entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',economicConventions:['curve','user']});
    const preflightController=new AbortController(),preflightTimeout=setTimeout(()=>preflightController.abort(),100_000);
    const selection=await selectActivePool({rpc,signal:AbortSignal.any([globalAbort.signal,preflightController.signal]),record,maxReads:24,enrichmentCapacity:48});clearTimeout(preflightTimeout);record('selection-result',compactSelection(selection));
    if(!selection.ok||terminated){summary={outcome:'PREFLIGHT_REFUSED_NO_STREAM',reason:!selection.ok?selection.reason:'RESOURCE_OR_SUPERVISOR_STOP',selection:compactSelection(selection),streamOpened:false,rpc:rpc.usage()};}
    else{
      // Preserve the complete prior receipt and reserve before the sole socket.
      const prior=JSON.parse(readFileSync(OLD_BUDGET,'utf8'));
      if(prior.reservedBytes!==112*MIB||prior.reservedMs!==100_000||prior.attempts.length!==2)throw Error('PRIOR_COUNTERS_CHANGED_REVIEW_REQUIRED');
      if(prior.reservedBytes+128*MIB>256*MIB||prior.reservedMs+95_000>300_000)throw Error('CUMULATIVE_CAPTURE_BUDGET');
      const attempt={id:'active-approved-20261027',stage:'active-approved',at:new Date().toISOString(),reservedBytes:128*MIB,reservedMs:95_000,status:'reserved-before-network',record:recordPath,source:sources(),pool:selection.candidate.pool};
      prior.reservedBytes+=128*MIB;prior.reservedMs+=95_000;prior.attempts.push(attempt);atomic(OLD_BUDGET,prior);
      stage='capture';const result=await capture(selection.candidate,rpc,record,globalAbort.signal,ws=>{socket=ws;});stage='audit';
      const audit=result.physicalSlotUncertain?{complete:false,reason:'PHYSICAL_RPC_SLOT_UNCERTAIN_NO_AUDIT'}:await auditPool(selection.candidate,result,rpc,record,globalAbort.signal);const {enrichmentTransactions:rawTransactions,enrichmentHints:rawHints,...boundedResult}=result;record('capture-and-audit-result',{result:boundedResult,audit});
      const updated=JSON.parse(readFileSync(OLD_BUDGET,'utf8'));Object.assign(updated.attempts[2],{status:'completed-with-receipt',observedSocketBytes:result.socketBytes,observedApplicationBytes:result.applicationBytes,stopReason:result.stopReason});atomic(OLD_BUDGET,updated);
      summary={outcome:result.normalizedEvents>0?'ACTIVE_DATA_CAPTURED_REVIEW_REQUIRED':'INCONCLUSIVE_NO_NORMALIZED_ACTIVE_DATA',selection:compactSelection(selection),streamOpened:result.openedAt!==null,capture:boundedResult,audit,rpc:rpc.usage(),aggregate:{reservedBytes:updated.reservedBytes,reservedMs:updated.reservedMs,actualPriorSocketBytes:106994938,actualTotalSocketBytes:106994938+result.socketBytes},verifiedForProduction:false};
    }
  }catch(e){summary={outcome:'BOUNDED_EXPERIMENT_UNAVAILABLE',reason:safe(e),rpc:rpc.usage(),streamMayHaveBeenOpened:stage!=='preflight',uncertainReservationsRetained:true};}
  finally{clearInterval(watch);socket?.terminate();if(rpc.inFlight===0)rpc.close();recordOpen=false;fsyncSync(fd);closeSync(fd);}
  summary={...summary,recordedAt:new Date().toISOString(),actualWallMs:performance.now()-began,resources:{peakRssBytes:Math.max(peakRss,process.memoryUsage().rss),peakEventLoopLagMs:peakLoop,cpuMs:(process.cpuUsage(cpuStart).user+process.cpuUsage(cpuStart).system)/1000,kernelMaxRssBytes:process.resourceUsage().maxRSS*1024},retainedRecordBytes:retained,record:recordPath,apiDataFeesUsd:'0.00 under public/credential-free documentation',infrastructureTransferAllocationVerified:false,productionChanged:false,entriesEnabled:false,liveTrading:false,acceptanceClockStarted:false};
  json(resolve(ROOT,'active-approved-summary.json'),summary,true);const grant=JSON.parse(readFileSync(GRANT,'utf8'));grant.status=summary.outcome;grant.completedAt=summary.recordedAt;atomic(GRANT,grant);
  if(process.connected)process.send?.({kind:'final',summary},undefined,undefined,()=>{process.disconnect();process.exit(0);});else process.exit(0);
}

type CaptureDependencies={makeSocket?:()=>WebSocket;quote?:typeof quotePositionSell};
export async function capture(candidate:ActiveCandidate,rpc:ResearchRpc,record:(kind:string,data:unknown)=>void,outer:AbortSignal,onSocket:(ws:WebSocket)=>void,dependencies:CaptureDependencies={}){
  const pipeline=new ActivePipeline({scope:{...candidate,supportedPoolEvidence:candidate.supportedPoolEvidence},record});
  const enrichmentTransactions=new Map<string,any>(),enrichmentHints=new Map<string,{signature:string;receivedAt:number}>();
  const captureController=new AbortController();let openedAt:number|null=null,openedMono:number|null=null,endedAt:number|null=null,stopReason:string|null=null,closed=false,busy=false,workPromise:Promise<void>|null=null,currentJob:'pricing'|'enrichment'|null=null,prices=0,enrichments=0,frames=0,applicationBytes=0,socketBytes=0,lastReceiveAt:number|null=null,maxLag=0,lastTick=performance.now();
  const connectionStartedAt=Date.now(),connectionStartedMono=performance.now();if(process.connected)process.send?.({kind:'capture-deadline',hardEndAt:connectionStartedAt+LIMITS.captureMs});const ws=dependencies.makeSocket?.()??new WebSocket('wss://stream.pumpapi.io/',{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:LIMITS.payloadBytes,perMessageDeflate:false,followRedirects:false,handshakeTimeout:3000});onSocket(ws);
  const transport=()=>{const n=(ws as unknown as {_socket?:{bytesRead:number}})._socket?.bytesRead;if(typeof n==='number'){socketBytes=Math.max(socketBytes,n);if(socketBytes>=LIMITS.newSocketStop)stop('SOCKET_BYTE_HEADROOM');}return n;};
  const stop=(reason:string)=>{if(stopReason)return;stopReason=reason;endedAt=Date.now();pipeline.endObservation(endedAt,reason);ws.terminate();if(process.connected)process.send?.({kind:'capture-ended'});};
  const abort=()=>{captureController.abort();stop('RESOURCE_OR_SUPERVISOR_ABORT');};outer.addEventListener('abort',abort,{once:true});
  ws.on('open',()=>{openedAt=Date.now();openedMono=performance.now();pipeline.open(openedAt);record('stream-open',{openedAt});if(transport()===undefined)stop('SOCKET_COUNTER_UNAVAILABLE');});
  ws.on('message',raw=>{try{const b=Array.isArray(raw)?Buffer.concat(raw):typeof raw==='string'?Buffer.from(raw):Buffer.from(raw as ArrayBuffer);frames++;applicationBytes+=b.byteLength;transport();if(performance.now()-connectionStartedMono>=LIMITS.captureMs-1000)stop('DURATION_LIMIT_WITH_HEADROOM');if(stopReason)return;if(applicationBytes>=LIMITS.applicationStop){stop('APPLICATION_BYTE_HEADROOM');return;}lastReceiveAt=Date.now();const p=JSON.parse(b.toString('utf8'));if(!p||typeof p!=='object'||Array.isArray(p)){pipeline.gap('UNSUPPORTED_STREAM_MESSAGE_SHAPE',lastReceiveAt);stop('UNSUPPORTED_STREAM_MESSAGE_SHAPE');return;}const result=pipeline.observe(p,lastReceiveAt);if(result!=='irrelevant')record('selected-pumpapi-payload',{receivedAt:lastReceiveAt,payloadUtf8:b.toString('utf8'),sha256:createHash('sha256').update(b).digest('hex')});if(result==='invalid'){stop('INVALID_SELECTED_OBSERVATION');}}catch{pipeline.gap('MALFORMED_OR_STORAGE_FAILURE',Date.now());stop('MALFORMED_OR_STORAGE_FAILURE');}});
  ws.on('unexpected-response',(_req,response)=>{response.destroy();stop('HANDSHAKE_HTTP_'+response.statusCode);});ws.on('error',()=>stop('STREAM_TRANSPORT_OR_PAYLOAD_ERROR'));
  ws.on('close',()=>{closed=true;if(!stopReason){pipeline.gap('UNEXPECTED_SOURCE_CLOSE',Date.now());stop('UNEXPECTED_SOURCE_CLOSE');}});
  let featureAt=0;
  const work=async()=>{
    if(busy||openedAt===null||stopReason)return;busy=true;
    try{
      if(Date.now()>=openedAt+prices*2000&&prices<LIMITS.pricingCycles){currentJob='pricing';const scheduledAt=openedAt+prices*2000,startedAt=Date.now(),before=rpc.calls;prices++;
        const q=await (dependencies.quote??quotePositionSell)(rpc as unknown as ReadOnlyRpc,new PublicKey(candidate.mint),BigInt(candidate.baseUnits),{record},candidate.minSlot,AbortSignal.any([outer,captureController.signal]));const availableAt=Date.now();pipeline.price(q,availableAt);record('pricing-work',{scheduledAt,startedAt,availableAt,requests:rpc.calls-before});
      }else{
        const hint=pipeline.nextHint(Date.now());if(pipeline.hasQualityLoss){stop('SELECTED_ENRICHMENT_QUEUE_UNUSABLE');return;}if(hint){currentJob='enrichment';if(enrichments>=LIMITS.enrichmentAttempts){pipeline.failHint('ENRICHMENT_ALLOCATION_EXHAUSTED',Date.now());stop('ENRICHMENT_ALLOCATION_EXHAUSTED');return;}enrichments++;const before=rpc.calls,requestedAt=Date.now();
          const tx=await rpc.call<any>('getTransaction',[hint.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],AbortSignal.any([outer,captureController.signal]));const availableAt=Date.now();record('confirmed-enrichment',{hint,requestedAt,availableAt,requests:rpc.calls-before,transaction:tx});
          if(!tx){pipeline.failHint('CONFIRMED_TRANSACTION_UNAVAILABLE_NO_RETRY',availableAt);stop('CONFIRMED_TRANSACTION_UNAVAILABLE_NO_RETRY');return;}
          enrichmentTransactions.set(hint.signature,tx);enrichmentHints.set(hint.signature,hint);pipeline.completeHint(hint,tx,availableAt);if(pipeline.snapshot(availableAt).qualityGaps.length)stop('REQUIRED_SELECTED_EVIDENCE_UNUSABLE');
        }
      }
    }catch(e){try{if(currentJob==='enrichment')pipeline.failHint(safe(e),Date.now());else{pipeline.price(null,Date.now());pipeline.gap(safe(e),Date.now());}}catch{}try{stop(safe(e));}catch{ws.terminate();}}
    finally{busy=false;currentJob=null;}
  };
  while(!closed&&!outer.aborted){const now=Date.now(),mono=performance.now();maxLag=Math.max(maxLag,Math.max(0,mono-lastTick-100));lastTick=mono;transport();if(maxLag>LIMITS.eventLoopLagMs){pipeline.gap('EVENT_LOOP_LAG',now);stop('EVENT_LOOP_LAG');}
    if(mono-connectionStartedMono>=LIMITS.captureMs-1000)stop('DURATION_LIMIT_WITH_HEADROOM');if(openedAt!==null&&now-(lastReceiveAt??openedAt)>2000){pipeline.gap('GLOBAL_SOURCE_STALE',now);stop('GLOBAL_SOURCE_STALE');}
    if(now-featureAt>=1000&&openedAt!==null&&!stopReason){pipeline.tick(now);featureAt=now;}
    if(!stopReason&&!busy)workPromise=work().catch(()=>{try{stop('WORK_OR_RECORDING_FAILURE');}catch{ws.terminate();}});await new Promise(r=>setTimeout(r,100));
  }
  if(!stopReason)stop('SOURCE_ENDED');transport();
  const shutdownDeadline=performance.now()+LIMITS.shutdownMs;let abortedWork=false;
  while(busy&&performance.now()<shutdownDeadline&&!outer.aborted){if(!abortedWork&&performance.now()>shutdownDeadline-1000){abortedWork=true;captureController.abort();}await new Promise(r=>setTimeout(r,25));}
  // No extra enrichment attempt is started after close. Pending work remains
  // explicitly unavailable; the5s reserve bounds an already in-flight operation.
  if(busy)captureController.abort();const physicalSlotUncertain=busy||rpc.inFlight!==0;if(!busy&&workPromise)await workPromise;pipeline.close(Date.now(),stopReason!);outer.removeEventListener('abort',abort);
  const state=pipeline.snapshot(Date.now());return {...state,connectionStartedAt,connectionAttemptMs:Date.now()-connectionStartedAt,openedAt,endedAt,openMs:openedAt===null||endedAt===null?0:endedAt-openedAt,stopReason,frames,applicationBytes,socketBytes,priceAttempts:prices,enrichments,physicalSlotUncertain,peakCaptureLoopLagMs:maxLag,enrichmentTransactions:Object.fromEntries(enrichmentTransactions),enrichmentHints:Object.fromEntries(enrichmentHints)};
}

export async function auditPool(candidate:ActiveCandidate,capture:any,rpc:ResearchRpc,record:(kind:string,data:unknown)=>void,signal:AbortSignal){
  const before=rpc.calls,result:any={calls:0,history:[],windowTransactions:[],missingHints:[],verifiedSwapEvents:0,unsupported:[],rechecks:[],complete:false,reason:null};
  if(capture.openedAt===null||capture.endedAt===null){result.reason='NO_OPEN_OBSERVATION_WINDOW';return result;}
  const start=Math.ceil(capture.openedAt/1000)+2,end=Math.floor(capture.endedAt/1000)-2;let cursor:string|undefined,covered=false;
  try{
    for(let page=0;page<3&&rpc.calls-before<LIMITS.auditCalls;page++){
      const rows=await rpc.call<any[]>('getSignaturesForAddress',[candidate.pool,{commitment:'confirmed',limit:20,...(cursor?{before:cursor}:{})}],signal);record('audit-signature-page',{pool:candidate.pool,availableAt:Date.now(),rows});
      if(!Array.isArray(rows)||rows.length>20||rows.some(r=>r.blockTime===null))throw Error('AUDIT_HISTORY_UNAVAILABLE');result.history.push(...rows);if(rows.length<20||rows.some(r=>r.blockTime<start)){covered=true;break;}cursor=rows.at(-1)?.signature;
    }
    result.historyCoversInterior=covered;result.interiorChainTimeSeconds={start,end,boundaryExclusionSeconds:2};
    const inWindow=result.history.filter((r:any)=>r.err===null&&r.blockTime>=start&&r.blockTime<=end);result.windowTransactions=inWindow.map((r:any)=>r.signature);
    const unique=new Set<string>(),observed=new Map<string,any>(capture.executedEvidence.map((e:any)=>[e.identityKey,e]));result.matchedEvents=0;result.matchedSignatures=0;
    for(const row of inWindow){if(unique.has(row.signature))continue;unique.add(row.signature);let tx=capture.enrichmentTransactions[row.signature];
      if(!tx){result.missingHints.push(row.signature);if(rpc.calls-before>=LIMITS.auditCalls){result.unsupported.push({signature:row.signature,reason:'AUDIT_CALL_ALLOCATION_EXHAUSTED'});continue;}tx=await rpc.call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],signal);record('audit-unmatched-transaction',{signature:row.signature,availableAt:Date.now(),transaction:tx});}
      try{const mapped=mapConfirmedPumpSwapEvidence(tx,{mint:candidate.mint,pool:candidate.pool,signature:row.signature,providerReceivedAt:null,availableAt:Date.now()});if(mapped.some(m=>!m.transferChecks.baseTransfer||!m.transferChecks.userQuoteTransfer))throw Error('AUDIT_TRANSFER_VALIDATION_FAILED');result.verifiedSwapEvents+=mapped.length;let allMatched=true;for(const event of mapped){const original=observed.get(event.identityKey);if(!original||original.fingerprint!==event.fingerprint){allMatched=false;result.unsupported.push({signature:row.signature,identity:event.identity,reason:original?'EXECUTED_CONTENT_MISMATCH':'ONCHAIN_SWAP_NOT_NORMALIZED_FROM_STREAM'});}else result.matchedEvents++;}if(mapped.length&&allMatched)result.matchedSignatures++;}
      catch(e){result.unsupported.push({signature:row.signature,reason:safe(e)});}
    }
    // Recheck a small bounded set atfinalized. Null is pending, not reversal.
    for(const signature of Object.keys(capture.enrichmentTransactions).slice(0,2)){
      if(rpc.calls-before>=LIMITS.auditCalls)break;const tx=await rpc.call<any>('getTransaction',[signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:1}],signal);let same:boolean|null=null;if(tx){try{const events=mapConfirmedPumpSwapEvidence(tx,{mint:candidate.mint,pool:candidate.pool,signature,providerReceivedAt:null,availableAt:Date.now()});same=events.every(e=>observed.get(e.identityKey)?.fingerprint===e.fingerprint)&&events.length===capture.executedEvidence.filter((e:any)=>e.identity.signature===signature).length;if(!same)result.unsupported.push({signature,reason:'FINALIZED_EXECUTED_CONTENT_CHANGED'});}catch(e){result.unsupported.push({signature,reason:safe(e)});same=false;}}result.rechecks.push({signature,availableAt:Date.now(),finalizedAvailable:!!tx,executedEvidenceIdentical:same});record('audit-finalized-recheck',{signature,availableAt:Date.now(),transaction:tx});
    }
    result.complete=covered&&result.unsupported.length===0&&result.verifiedSwapEvents>0&&result.matchedEvents===result.verifiedSwapEvents;const rows=capture.featureRows.filter((r:any)=>r.curve.sufficientlyObserved&&r.user.sufficientlyObserved&&r.fullyEnriched&&r.curve.windowStartAt>=start*1000&&r.curve.windowEndAt<=(end+1)*1000&&!capture.qualityGaps.some((g:any)=>g.at>=r.curve.windowStartAt&&g.at<=r.at));result.auditedFeatureRows=result.complete?rows:[];result.auditedUsableFeatureSeconds=result.complete?rows.slice(1).reduce((n:number,r:any,i:number)=>n+Math.min(1000,Math.max(0,r.at-rows[i].at)),0)/1000:0;result.featureScope='Confirmed RPC-availability research views; bounded chain-time interior, not global provider completeness or entry eligibility';result.reason=result.complete?'BOUNDED_INTERIOR_INSTRUCTION_SAMPLE_MATCHED':'INCOMPLETE_OR_ZERO_TRADE_DENOMINATOR';
  }catch(e){result.reason=safe(e);}
  result.calls=rpc.calls-before;return result;
}
