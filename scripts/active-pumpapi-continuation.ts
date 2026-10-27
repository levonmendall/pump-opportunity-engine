/** Explicit continuation of the unused capture grant; old receipts are immutable. */
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
import {capture,auditPool} from './active-pumpapi-trial.js';
import {ResearchPositionPricer} from '../src/research-pricing.js';
import {ResearchPhaseRpc} from '../src/research-phase.js';
import type {quotePositionSell} from '../src/pool.js';
import type {ReadOnlyRpc} from '../src/network.js';
import {readSourceVersion} from '../src/source-version.js';

const MIB=1024*1024,ROOT=resolve('evidence/free-data-20261027'),SCRIPT=fileURLToPath(import.meta.url),LOCK='/tmp/poe-pumpapi-probe.lock';
const GRANT=resolve(ROOT,'active-continuation-allowance.json'),RPC_BUDGET=resolve(ROOT,'active-approved-rpc-budget.json'),OLD_BUDGET=resolve(ROOT,'pumpapi-budget.json');
const LIMITS=Object.freeze({cumulativeSocketBytes:256*MIB,cumulativeReservedMs:300_000,newSocketReservation:128*MIB,newSocketStop:127*MIB,applicationStop:126*MIB,captureMs:90_000,shutdownMs:5000,retainedBytes:32*MIB,recordBytes:12*MIB,payloadBytes:65_536,rssBytes:256*MIB,cpuMs:30_000,eventLoopLagMs:500,parentWallMs:250_000,enrichmentAttempts:48,auditCalls:24,pricingCycles:45});
const PHASES=Object.freeze({selection:{calls:48,bytes:8*MIB,elapsedMs:70_000,candidates:6},capture:{calls:142,bytes:40*MIB,pricingCalls:94,enrichmentCalls:48},audit:{calls:24,bytes:12*MIB,elapsedMs:45_000},shutdown:{calls:4,bytes:2*MIB}});
const mode=process.argv[2];
if(resolve(process.argv[1]??'')===SCRIPT){
if(mode==='run-approved'){
  const p=spawn('flock',['-n','-F',LOCK+'.budget',process.execPath,'--use-env-proxy','--import','tsx',SCRIPT,'--locked'],{stdio:'inherit'});
  process.exitCode=await new Promise<number>(r=>{p.once('error',()=>r(2));p.once('exit',c=>r(c??2));});
}else if(mode==='--locked')await parent();
else if(mode==='--child'){
  if(!process.send||process.getuid?.()!==1000)throw Error('SUPERVISED_NONROOT_CHILD_REQUIRED');
  process.once('message',()=>{void child().catch(()=>{if(process.connected)process.send?.({kind:'fatal',reason:'BOUNDED_CHILD_FAILURE'},undefined,undefined,()=>process.disconnect());process.exitCode=2;});});
}else console.log(JSON.stringify({networkStarted:false,usage:'node --import tsx scripts/active-pumpapi-continuation.ts run-approved',oneAttempt:true,limits:LIMITS,productionChanged:false}));
}

function json(path:string,value:unknown,exclusive=false){const s=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(s)>1024*1024)throw Error('SUMMARY_LIMIT');writeFileSync(path,s,{mode:0o600,flag:exclusive?'wx':'w'});}
function atomic(path:string,value:unknown){const tmp=path+'.pending-'+process.pid,fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,path);}
function disk(path=ROOT):number{return readdirSync(path).reduce((n,f)=>{const p=resolve(path,f),s=lstatSync(p);if(s.isSymbolicLink())throw Error('RESEARCH_EVIDENCE_SYMLINK');return n+(s.isDirectory()?disk(p):s.size);},0);}
function safe(error:unknown){const s=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_:;-]{0,127}$/.test(s)?s:'BOUNDED_RESEARCH_UNAVAILABLE';}
function compactSelection(selection:any){return {...selection,evidence:{...selection.evidence,transactions:selection.evidence.transactions.map((x:any)=>({signature:x.signature,requestedAt:x.requestedAt,availableAt:x.availableAt,slot:x.transaction?.slot,version:x.transaction?.version,transactionSha256:createHash('sha256').update(JSON.stringify(x.transaction)).digest('hex')}))}};}
function sources(){return {version:readSourceVersion(dirname(SCRIPT)),sha256:Object.fromEntries([SCRIPT,'../src/research-rpc.ts','../src/active-selection.ts','../src/active-pipeline.ts','../src/pumpapi-mapping.ts','../src/pool.ts','../src/strategy.ts','../src/research-pricing.ts','../src/research-phase.ts','../scripts/active-pumpapi-trial.ts','../package-lock.json'].map(p=>p.startsWith('/')?p:resolve(dirname(SCRIPT),p)).map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};}

async function parent(){
  if(process.getuid?.()!==1000||disk()+LIMITS.recordBytes+2*MIB>LIMITS.retainedBytes)throw Error('NONROOT_OR_EVIDENCE_CAPACITY_REQUIRED');
  if(existsSync(GRANT))throw Error('CONTINUATION_ALREADY_RECORDED_NO_RETRY');
  const originalGrant=JSON.parse(readFileSync(resolve(ROOT,'active-approved-allowance.json'),'utf8'));
  const startingRpc=JSON.parse(readFileSync(RPC_BUDGET,'utf8'));
  if(originalGrant.status!=='PREFLIGHT_REFUSED_NO_STREAM'||startingRpc.calls!==6||startingRpc.bytes!==81729||startingRpc.pending.length||startingRpc.blockedReason)throw Error('CONTINUATION_PRIOR_STATE_REVIEW_REQUIRED');
  const prior=JSON.parse(readFileSync(OLD_BUDGET,'utf8'));
  if(prior.reservedBytes!==112*MIB||prior.reservedMs!==100_000||prior.attempts.length!==2)throw Error('PRIOR_COUNTERS_CHANGED_REVIEW_REQUIRED');
  json(GRANT,{schemaVersion:1,authorization:'Owner explicitly approved one bounded selection continuation and the unused sole live capture, without increasing cumulative allowances',recordedAt:new Date().toISOString(),status:'continuation-preflight-started-one-pass-only',limits:LIMITS,phaseReservations:PHASES,startingRpc,priorGrantSha256:createHash('sha256').update(readFileSync(resolve(ROOT,'active-approved-allowance.json'))).digest('hex'),arithmetic:{remainingCalls:234,reservedCalls:218,unallocatedCalls:16,remainingResponseBytes:67027135,reservedResponseBytes:62*MIB,unallocatedResponseBytes:67027135-62*MIB},priorPumpApiBudgetSha256:createHash('sha256').update(readFileSync(OLD_BUDGET)).digest('hex'),prior:{reservedBytes:prior.reservedBytes,reservedMs:prior.reservedMs,attempts:prior.attempts},rpc:{requests:240,responseBytes:64*MIB,startsPerMinute:150,startsPer10Seconds:30,inFlight:1},sources:sources(),providers:['PumpApi credential-free stream','Solana public RPC'],productionChanged:false},true);
  const p=spawn('flock',['-n','-F',LOCK,'prlimit','--cpu=30:35','--fsize=16777216:16777216','--nofile=64:64','--',process.execPath,'--max-old-space-size=128','--use-env-proxy','--import','tsx',SCRIPT,'--child'],{stdio:['ignore','pipe','pipe','ipc']});
  const began=performance.now();let lastHeartbeat=began,ready=false,peakRss=0,final:any=null,stopReason:string|null=null,stdout=0,stderr=0,captureHardEndAt:number|null=null;
  const stop=(reason:string)=>{if(stopReason)return;stopReason=reason;p.kill('SIGTERM');setTimeout(()=>p.kill('SIGKILL'),1000).unref();};
  p.stdout!.on('data',b=>{stdout+=b.byteLength;if(stdout>32768)stop('SUPERVISOR_STDOUT_CAP');});p.stderr!.on('data',b=>{stderr+=b.byteLength;if(stderr>32768)stop('SUPERVISOR_STDERR_CAP');});
  p.on('message',(m:any)=>{if(m?.kind==='capture-deadline'){captureHardEndAt=m.hardEndAt;}else if(m?.kind==='capture-ended'){captureHardEndAt=null;}else if(m?.kind==='progress'){lastHeartbeat=performance.now();ready=true;}else if(m?.kind==='final'){final=m.summary;lastHeartbeat=performance.now();}else if(m?.kind==='fatal')stop('CHILD_FAILED');});
  const watch=setInterval(()=>{const now=performance.now();if(captureHardEndAt!==null&&Date.now()>=captureHardEndAt-500){stopReason??='SUPERVISOR_CAPTURE_HARD_LIMIT';p.kill('SIGKILL');}if(now-began>LIMITS.parentWallMs)stop('SUPERVISOR_WALL_CAP');if(now-lastHeartbeat>(ready?3000:8000))stop('SUPERVISOR_HEARTBEAT_CAP');if(p.pid){try{const text=readFileSync('/proc/'+p.pid+'/status','utf8'),rss=Number(text.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1])*1024;if(Number.isSafeInteger(rss)){peakRss=Math.max(peakRss,rss);if(rss>LIMITS.rssBytes)stop('SUPERVISOR_RSS_CAP');}}catch{}}},100);
  p.once('spawn',()=>p.send({approved:true}));
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>{p.once('error',()=>r({code:2,signal:null}));p.once('exit',(code,signal)=>r({code,signal}));});clearInterval(watch);
  const receipt={recordedAt:new Date().toISOString(),supervisor:{wallMs:performance.now()-began,peakRssBytes:peakRss,stopReason,stdoutBytes:stdout,stderrBytes:stderr,exit},summary:final,uncertainAttempt:!final,noRetry:true};
  json(resolve(ROOT,'active-continuation-supervisor.json'),receipt,true);console.log(JSON.stringify({receipt:resolve(ROOT,'active-continuation-supervisor.json'),outcome:final?.outcome??'UNCERTAIN_ATTEMPT',stopReason,exit}));if(exit.code!==0||!final)process.exitCode=2;
}

async function child(){
  let recordOpen=true;const began=performance.now(),cpuStart=process.cpuUsage(),recordPath=resolve(ROOT,'active-continuation-record.ndjson'),fd=openSync(recordPath,'wx',0o600);let retained=0,sequence=0;
  const record=(kind:string,data:unknown)=>{if(!recordOpen)return;const line=JSON.stringify({schemaVersion:1,sequence:++sequence,receivedAt:Date.now(),receivedMonotonicMs:performance.now(),kind,data})+'\n';if(retained+Buffer.byteLength(line)>LIMITS.recordBytes)throw Error('RETAINED_EVIDENCE_CAP');writeFileSync(fd,line);retained+=Buffer.byteLength(line);};
  let terminated=false,lastTick=performance.now(),peakLoop=0,peakRss=0,stage='preflight',socket:WebSocket|undefined;
  const globalAbort=new AbortController();const signal=()=>{terminated=true;globalAbort.abort();socket?.terminate();};process.once('disconnect',signal);process.once('SIGTERM',signal);process.once('SIGINT',signal);
  let heartbeatPending=false;
  const watch=setInterval(()=>{const now=performance.now(),rss=process.memoryUsage().rss,cpu=process.cpuUsage(cpuStart);peakLoop=Math.max(peakLoop,Math.max(0,now-lastTick-100));lastTick=now;peakRss=Math.max(peakRss,rss);if(rss>LIMITS.rssBytes||(cpu.user+cpu.system)/1000>LIMITS.cpuMs||now-began>LIMITS.parentWallMs-5000){signal();}if(!heartbeatPending&&process.connected){heartbeatPending=true;process.send?.({kind:'progress',stage,rss,at:Date.now()},undefined,undefined,()=>{heartbeatPending=false;});}},100);
  const rpc=new ResearchRpc({budgetPath:RPC_BUDGET,timeoutMs:8000});
  let summary:any;
  try{
    record('approved-configuration',{limits:LIMITS,phaseReservations:PHASES,sources:sources(),rpc:rpc.usage(),enrichmentDelayMs:1000,enrichmentDeadlineMs:5000,pricingAttemptCadenceMs:2000,entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',economicConventions:['curve','user']});
    const selectionRpc=new ResearchPhaseRpc(rpc,'SELECTION',PHASES.selection.calls,PHASES.selection.bytes);
    const preflightController=new AbortController(),preflightTimeout=setTimeout(()=>preflightController.abort(),PHASES.selection.elapsedMs);
    const selection=await selectActivePool({rpc:selectionRpc,signal:AbortSignal.any([globalAbort.signal,preflightController.signal]),record,maxReads:PHASES.selection.calls,maxCandidates:PHASES.selection.candidates,maxElapsedMs:PHASES.selection.elapsedMs,maxResponseBytes:PHASES.selection.bytes,responseBytes:()=>rpc.bytes,enrichmentCapacity:48,programLimit:256,maxProgramTransactions:24});clearTimeout(preflightTimeout);record('selection-result',compactSelection(selection));
    if(!selection.ok||terminated){summary={outcome:'PREFLIGHT_REFUSED_NO_STREAM',reason:!selection.ok?selection.reason:'RESOURCE_OR_SUPERVISOR_STOP',selection:compactSelection(selection),streamOpened:false,rpc:rpc.usage(),phases:{selection:selectionRpc.usage()}};}
    else{
      // Preserve the complete prior receipt and reserve before the sole socket.
      const prior=JSON.parse(readFileSync(OLD_BUDGET,'utf8'));
      if(prior.reservedBytes!==112*MIB||prior.reservedMs!==100_000||prior.attempts.length!==2)throw Error('PRIOR_COUNTERS_CHANGED_REVIEW_REQUIRED');
      if(prior.reservedBytes+128*MIB>256*MIB||prior.reservedMs+95_000>300_000)throw Error('CUMULATIVE_CAPTURE_BUDGET');
      const attempt={id:'active-continuation-20261027',stage:'active-continuation',at:new Date().toISOString(),reservedBytes:128*MIB,reservedMs:95_000,status:'reserved-before-network',record:recordPath,source:sources(),pool:selection.candidate.pool};
      prior.reservedBytes+=128*MIB;prior.reservedMs+=95_000;prior.attempts.push(attempt);atomic(OLD_BUDGET,prior);
      const captureRpc=new ResearchPhaseRpc(rpc,'CAPTURE',PHASES.capture.calls,PHASES.capture.bytes,{getTransaction:48});
      const pricer=new ResearchPositionPricer(captureRpc as unknown as ReadOnlyRpc,{record});
      let pricingCalls=0;
      const quote=(async(_r:unknown,mint:PublicKey,units:bigint,_rec:unknown,minSlot=0,signal?:AbortSignal)=>{
        if(pricingCalls+3>PHASES.capture.pricingCalls)throw Error('PRICING_REQUEST_RESERVE');
        const before=rpc.calls;
        try{const result=await pricer.quote({mint,fullBaseUnits:units,minSlot},signal);const q=result.quotes[mint.toBase58()];if(!q)throw Error('RESEARCH_PRICE_UNAVAILABLE');return q;}
        finally{pricingCalls+=rpc.calls-before;}
      }) as typeof quotePositionSell;
      stage='capture';const result=await capture(selection.candidate,captureRpc as unknown as ResearchRpc,record,globalAbort.signal,ws=>{socket=ws;},{quote});stage='audit';
      const auditRpc=new ResearchPhaseRpc(rpc,'AUDIT',PHASES.audit.calls,PHASES.audit.bytes);
      const auditController=new AbortController(),auditTimer=setTimeout(()=>auditController.abort(),PHASES.audit.elapsedMs);
      const audit=result.physicalSlotUncertain?{complete:false,reason:'PHYSICAL_RPC_SLOT_UNCERTAIN_NO_AUDIT'}:await auditPool(selection.candidate,result,auditRpc as unknown as ResearchRpc,record,AbortSignal.any([globalAbort.signal,auditController.signal]),{maxCalls:PHASES.audit.calls,maxElapsedMs:PHASES.audit.elapsedMs});clearTimeout(auditTimer);
      const {enrichmentTransactions:rawTransactions,enrichmentHints:rawHints,...boundedResult}=result;record('capture-and-audit-result',{result:boundedResult,audit});
      const updated=JSON.parse(readFileSync(OLD_BUDGET,'utf8'));Object.assign(updated.attempts[2],{status:'completed-with-receipt',observedSocketBytes:result.socketBytes,observedApplicationBytes:result.applicationBytes,stopReason:result.stopReason});atomic(OLD_BUDGET,updated);
      summary={outcome:result.normalizedEvents>0?'ACTIVE_DATA_CAPTURED_REVIEW_REQUIRED':'INCONCLUSIVE_NO_NORMALIZED_ACTIVE_DATA',selection:compactSelection(selection),streamOpened:result.openedAt!==null,capture:boundedResult,audit,rpc:rpc.usage(),pricingReuse:pricer.usage(),phases:{selection:selectionRpc.usage(),capture:captureRpc.usage(),audit:auditRpc.usage()},pricingCalls,aggregate:{reservedBytes:updated.reservedBytes,reservedMs:updated.reservedMs,actualPriorSocketBytes:106994938,actualTotalSocketBytes:106994938+result.socketBytes},verifiedForProduction:false};
    }
  }catch(e){summary={outcome:'BOUNDED_EXPERIMENT_UNAVAILABLE',reason:safe(e),rpc:rpc.usage(),streamMayHaveBeenOpened:stage!=='preflight',uncertainReservationsRetained:true};}
  finally{clearInterval(watch);socket?.terminate();if(rpc.inFlight===0)rpc.close();recordOpen=false;fsyncSync(fd);closeSync(fd);}
  summary={...summary,recordedAt:new Date().toISOString(),actualWallMs:performance.now()-began,resources:{peakRssBytes:Math.max(peakRss,process.memoryUsage().rss),peakEventLoopLagMs:peakLoop,cpuMs:(process.cpuUsage(cpuStart).user+process.cpuUsage(cpuStart).system)/1000,kernelMaxRssBytes:process.resourceUsage().maxRSS*1024},retainedRecordBytes:retained,record:recordPath,apiDataFeesUsd:'0.00 under public/credential-free documentation',infrastructureTransferAllocationVerified:false,productionChanged:false,entriesEnabled:false,liveTrading:false,acceptanceClockStarted:false};
  json(resolve(ROOT,'active-continuation-summary.json'),summary,true);const grant=JSON.parse(readFileSync(GRANT,'utf8'));grant.status=summary.outcome;grant.completedAt=summary.recordedAt;atomic(GRANT,grant);
  if(process.connected)process.send?.({kind:'final',summary},undefined,undefined,()=>{process.disconnect();process.exit(0);});else process.exit(0);
}

