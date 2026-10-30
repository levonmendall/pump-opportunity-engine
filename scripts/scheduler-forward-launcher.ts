/** One owner-approved scheduler diagnostic. This supervisor makes no provider
 * requests and never edits old evidence, financial state or provider budgets. */
import {spawn,spawnSync} from 'node:child_process';
import {constants,openSync,closeSync,fstatSync,lstatSync,readdirSync,readFileSync,writeFileSync,fsyncSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join,relative} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readResearchBaseline} from '../src/research-baseline.js';
import {scanActiveComponentEvidence,COMPONENT_ATOMIC_TEMP_HEADROOM,componentWatchFailure,type ComponentWatchStage} from './component-launcher.js';

const MIB=1024*1024,PROPOSAL='evidence/scheduler-correction-20261027/forward-proposal.json';
export const SCHEDULER_FORWARD_PIN='de102ee038b9b3cfa46fbd5d5560884d715429bf';
export const SCHEDULER_FORWARD_LIMITS=Object.freeze({totalMs:120000,softStopMs:115000,newUnits:77,plannedUnits:73,cumulativeUnits:240,newRelatedBytes:32*MIB,cumulativeRelatedBytes:64*MIB,newEvidenceBytes:6*MIB,allEvidenceBytes:32*MIB,receiptReserveBytes:256*1024,rssBytes:256*MIB,cpuMs:20000,lagMs:500});
const PHASES=['01-preflight','02-combined','03-audit'] as const;
const hash=(body:Buffer|string)=>createHash('sha256').update(body).digest('hex');
function need(v:unknown,code:string):asserts v {if(!v)throw Error(code);}
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function durableJson(path:string,value:unknown){
  const bytes=JSON.stringify(value,null,2)+'\n';need(Buffer.byteLength(bytes)<=256*1024,'SCHEDULER_RECEIPT_SIZE');
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  const parent=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}
}
function files(directory:string):string[]{
  const result:string[]=[];for(const name of readdirSync(directory)){const path=join(directory,name),s=lstatSync(path);need(!s.isSymbolicLink(),'SCHEDULER_SOURCE_SYMLINK');if(s.isDirectory())result.push(...files(path));else{need(s.isFile(),'SCHEDULER_SOURCE_FILE_TYPE');result.push(path);}need(result.length<=4096,'SCHEDULER_FILE_COUNT');}return result.sort();
}
const hashes=(paths:string[],repo:string)=>Object.fromEntries(paths.map(path=>[relative(repo,path),hash(readFileSync(path))]));
const mismatches=(expected:Record<string,string>,repo:string)=>Object.entries(expected).filter(([path,sum])=>{try{return hash(readFileSync(resolve(repo,path)))!==sum;}catch{return true;}}).map(([path])=>path);

export function validateSchedulerForwardProposal(pinned:Buffer,current:Buffer){
  need(current.equals(pinned),'SCHEDULER_OWNER_PROPOSAL_CHANGED');const p=JSON.parse(current.toString('utf8')),a=p.existingRpcAllowanceAllocation,g=p.preciseNewOwnerGrantProposal,t=p.observationTiming;
  need(a?.plannedMaximumUnits===73&&a?.newRequestUnitsCeiling===77&&a?.unassignedShutdownOrUncertainOperationHeadroomUnits===4&&a?.newRelatedResponseByteCeiling===32*MIB,'SCHEDULER_PROPOSAL_REQUEST_LIMITS');
  need(g?.newCaptures===1&&g?.newPumpApiReceiptReservationBytes===140*MIB&&g?.newPumpApiReservedMs===90000&&g?.newCumulativePumpApiReservedBytes===396*MIB&&g?.newCumulativePumpApiReservedMs===320000&&t?.maximumAggregateTestMs===120000&&t?.maximumOpenObservationMs===75000,'SCHEDULER_PROPOSAL_STREAM_LIMITS');return p;
}

/** Existing atomic scanner applied independently to each of the three known
 * phase directories. Reserve all three128KiB transient slots from the outset. */
export function scanSchedulerForwardEvidence(path:string,options:{writerPid:number;beforeStat?:(path:string)=>void}){
  let stableBytes=0,observedAtomicBytes=0,vanishedAtomicFiles=0,fileCount=0,presentPhases=0;
  const root=lstatSync(path);need(root.isDirectory()&&!root.isSymbolicLink(),'SCHEDULER_EVIDENCE_DIRECTORY');
  for(const name of readdirSync(path)){
    const file=join(path,name);options.beforeStat?.(file);const stat=lstatSync(file);need(!stat.isSymbolicLink(),'SCHEDULER_EVIDENCE_SYMLINK');
    if(stat.isDirectory()){
      need((PHASES as readonly string[]).includes(name),'SCHEDULER_UNKNOWN_PHASE_DIRECTORY');const scan=scanActiveComponentEvidence(file,options);presentPhases++;stableBytes+=scan.stableBytes;observedAtomicBytes+=scan.observedAtomicBytes;vanishedAtomicFiles+=scan.vanishedAtomicFiles;fileCount+=scan.fileCount;
    }else{need(stat.isFile(),'SCHEDULER_EVIDENCE_FILE_TYPE');stableBytes+=stat.size;fileCount++;}
    need(fileCount<=1024,'SCHEDULER_EVIDENCE_FILE_COUNT');
  }
  return {stableBytes,observedAtomicBytes,measuredBytes:stableBytes+observedAtomicBytes,countedBytes:stableBytes+3*COMPONENT_ATOMIC_TEMP_HEADROOM,atomicTempHeadroomBytes:3*COMPONENT_ATOMIC_TEMP_HEADROOM,vanishedAtomicFiles,fileCount,presentPhases};
}

/** Sum increments, never the linked cumulative baselines. Every durable request
 * reservation and uncertain response remains charged, including after abort. */
export function schedulerForwardUsage(directory:string,baseline:{calls:number;bytes:number}){
  let newUnits=0,observedBytes=0,uncertainBytes=0;const phases:Array<{phase:string;units:number;observedBytes:number;uncertainBytes:number;haltedReason:string|null}>=[];
  for(const phase of PHASES){
    const file=join(directory,phase,'rpc-budget.json');let b:any;
    try{const s=lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=128*1024,'SCHEDULER_UNSAFE_COUNTERBOOK');b=JSON.parse(readFileSync(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
    need(b?.schemaVersion===1&&Array.isArray(b.starts)&&b.starts.length<=70&&b.starts.every(integer)&&integer(b.httpBytes)&&integer(b.wsBytes)&&Array.isArray(b.pending),'SCHEDULER_INVALID_COUNTERBOOK');
    need(b.baseline?.calls>=baseline.calls&&b.baseline?.calls<=240&&b.baseline?.bytes>=baseline.bytes,'SCHEDULER_COUNTER_BASELINE_CONFLICT');
    let reserved=0;for(const p of b.pending){need(integer(p.reservedBytes)&&p.reservedBytes<=2*MIB,'SCHEDULER_INVALID_RESERVATION');reserved+=p.reservedBytes;}
    const observed=b.httpBytes+b.wsBytes;newUnits+=b.starts.length;observedBytes+=observed;uncertainBytes+=reserved;
    phases.push({phase,units:b.starts.length,observedBytes:observed,uncertainBytes:reserved,haltedReason:typeof b.haltedReason==='string'?b.haltedReason:null});
  }
  const accountedBytes=observedBytes+uncertainBytes;
  need(newUnits<=77&&baseline.calls+newUnits<=240,'SCHEDULER_REQUEST_UNIT_CAP');need(accountedBytes<=32*MIB&&baseline.bytes+accountedBytes<=64*MIB,'SCHEDULER_RELATED_BYTE_CAP');
  const firstProviderFailure=phases.map(p=>p.haltedReason).find(reason=>reason&&/(?:HTTP_429|OVERLOAD|THROTTL|RPC_-32005)/.test(reason))??null;
  return {newUnits,plannedUnits:73,headroomUnitsRemaining:77-newUnits,cumulativeUnits:baseline.calls+newUnits,observedBytes,uncertainBytes,accountedBytes,cumulativeAccountedBytes:baseline.bytes+accountedBytes,phases,firstProviderFailure};
}

export function schedulerForwardChildArguments(child:string){return ['--cpu=20:21','--fsize=16777216:16777216','--nofile=64:64','--',process.execPath,'--max-old-space-size=128','--use-env-proxy','--import','tsx',child,'--child'];}
export type SchedulerForwardLauncherResult={receipt:string;outcome:string;exitCode:number};
/** Explicit caller entry only; importing this module launches nothing. */
export async function runSchedulerForwardLauncher(childPath:string):Promise<SchedulerForwardLauncherResult>{
  const startedAt=Date.now(),began=performance.now(),parentCpu0=process.cpuUsage(),deadlineAt=startedAt+120000,script=resolve(childPath),repo=resolve(dirname(script),'..'),outDir=resolve(repo,'evidence/scheduler-forward-20261027');
  need(process.getuid?.()===1000,'SCHEDULER_NONROOT_USER_REQUIRED');need(process.cwd()===repo&&script===resolve(repo,'scripts/scheduler-forward.ts'),'SCHEDULER_FIXED_CHILD_REQUIRED');
  for(const path of [repo,resolve(repo,'evidence')]){const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o022)===0,'SCHEDULER_UNSAFE_DIRECTORY');}
  const shown=spawnSync('git',['show',`${SCHEDULER_FORWARD_PIN}:${PROPOSAL}`],{cwd:repo,maxBuffer:MIB,timeout:5000});need(shown.status===0&&Buffer.isBuffer(shown.stdout),'SCHEDULER_PIN_UNAVAILABLE');
  const proposalBytes=readFileSync(resolve(repo,PROPOSAL)),proposal=validateSchedulerForwardProposal(shown.stdout,proposalBytes);
  const baselinePaths=['evidence/free-data-20261027/active-approved-rpc-budget.json','evidence/public-component-20261027/rpc-budget.json',...readdirSync(resolve(repo,'evidence/overnight-20261027')).filter(name=>/^\d\d-[a-z-]+$/.test(name)).sort().map(name=>'evidence/overnight-20261027/'+name+'/rpc-budget.json')];
  for(const path of baselinePaths.slice(2)){const receipt=JSON.parse(readFileSync(resolve(repo,dirname(path),'supervisor.json'),'utf8'));need(receipt.supervisor?.exit&&(receipt.supervisor.exit.code!==null||receipt.supervisor.exit.signal!==null),'SCHEDULER_PRIOR_CHILD_NOT_SETTLED');}
  const baseline=readResearchBaseline({paths:baselinePaths.map(path=>resolve(repo,path)),now:startedAt,physicalSettled:true});need(baseline.baseline.calls===163&&baseline.baseline.bytes===3587908,'SCHEDULER_APPROVED_BASELINE_CHANGED');
  need(startedAt-baseline.baseline.refusalAt>=300000,'SCHEDULER_PROVIDER_COOLDOWN');
  const oldPump=JSON.parse(readFileSync(resolve(repo,'evidence/overnight-20261027/pumpapi-budget.json'),'utf8'));need(oldPump.reservedBytes===256*MIB&&oldPump.reservedMs===230000,'SCHEDULER_OLD_STREAM_RESERVATIONS_CHANGED');
  const priorFiles=files(resolve(repo,'evidence')),priorHashes=hashes(priorFiles,repo),priorBytes=priorFiles.reduce((sum,path)=>sum+lstatSync(path).size,0);need(priorBytes+6*MIB<=32*MIB,'SCHEDULER_CUMULATIVE_EVIDENCE_RESERVE');
  const sourcePaths=[...files(resolve(repo,'src')),...files(resolve(repo,'scripts'))].filter(path=>/\.(?:ts|mjs)$/.test(path)).concat(['package.json','package-lock.json'].map(path=>resolve(repo,path))),sourceHashes=hashes(sourcePaths,repo);
  const lockPath='/tmp/poe-public-component-20261027.lock',lease=openSync(lockPath,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  try{
    const lock=fstatSync(lease);need(lock.isFile()&&lock.uid===process.getuid?.()&&lock.nlink===1&&(lock.mode&0o077)===0,'SCHEDULER_UNSAFE_LEASE');const held=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',lease],timeout:5000});need(held.status===0,'SCHEDULER_PUBLIC_RESEARCH_ALREADY_RUNNING');
    try{mkdirSync(outDir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('SCHEDULER_SINGLE_ATTEMPT_ALREADY_RECORDED');throw e;}
    durableJson(join(outDir,'authorization.json'),{schemaVersion:1,authority:'Owner explicitly approved exactly diagnostic proposal de102ee; one bounded attempt, no retry, no production or financial action.',startedAt,deadlineAt,proposalCommit:SCHEDULER_FORWARD_PIN,proposalSha256:hash(proposalBytes),limits:SCHEDULER_FORWARD_LIMITS,proposal,sourceSha256:sourceHashes,priorEvidenceSha256:priorHashes,priorEvidenceBytes:priorBytes,pumpApiReservationCreated:false,streamReservationRule:'Child may exclusively create its new linked reservation only after successful bounded preflight. All old books remain immutable.',productionChanged:false,paperEntries:false,liveTrading:false,acceptanceClock:false});
    durableJson(join(outDir,'baseline.json'),{...baseline,baselinePaths,globalStartedAt:startedAt,globalDeadlineAt:deadlineAt,plannedUnits:73,maximumNewUnits:77,maximumNewRelatedBytes:32*MIB,maximumNewEvidenceBytes:6*MIB});
    const clock=spawnSync('/usr/bin/getconf',['CLK_TCK'],{encoding:'utf8',timeout:5000}),hz=Number(clock.stdout.trim());need(clock.status===0&&integer(hz)&&hz>0,'SCHEDULER_CPU_CLOCK_UNAVAILABLE');
    const env:NodeJS.ProcessEnv={};for(const key of ['PATH','LANG','LC_ALL','TZ','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','TMPDIR'])if(process.env[key]!==undefined)env[key]=process.env[key];
    Object.assign(env,{POE_COMPONENT_OUT_DIR:outDir,POE_COMPONENT_STARTED_AT:String(startedAt),POE_COMPONENT_DEADLINE_AT:String(deadlineAt),POE_SCHEDULER_OUT_DIR:outDir,POE_SCHEDULER_STARTED_AT:String(startedAt),POE_SCHEDULER_DEADLINE_AT:String(deadlineAt)});
    // FD4 inherits the same lease description through prlimit/exec, so losing
    // the parent cannot release exclusivity while the child is still alive.
    const child=spawn('/usr/bin/prlimit',schedulerForwardChildArguments(script),{cwd:repo,env,stdio:['ignore','pipe','pipe','ipc',lease]});
    let stopReason:string|null=null,finalSummary:any=null,stdoutBytes=0,stderrBytes=0,peakRssBytes=0,peakCpuMs=0,peakParentCpuMs=0,peakParentRssBytes=0,peakParentLagMs=0,lastHeartbeat=performance.now(),lastTick=lastHeartbeat,lastVerify=lastHeartbeat,ready=false,childExited=false,vanishedAtomicFiles=0,usage= schedulerForwardUsage(outDir,baseline.baseline);
    const resourceErrors:Array<unknown>=[];let killTimer:NodeJS.Timeout|undefined,procTimer:NodeJS.Timeout|undefined;
    const stop=(reason:string,hard=false)=>{stopReason??=reason;if(hard){child.kill('SIGKILL');return;}if(killTimer)return;child.send?.({kind:'stop',reason},()=>{});child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),Math.max(0,Math.min(5000,deadlineAt-Date.now())));killTimer.unref();};
    child.once('exit',()=>{childExited=true;clearTimeout(procTimer);});child.once('error',()=>{childExited=true;clearTimeout(procTimer);});
    const interrupt=()=>stop('SCHEDULER_SUPERVISOR_INTERRUPTED');process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);
    child.stdout!.on('data',(body:Buffer)=>{stdoutBytes+=body.length;if(stdoutBytes>32768)stop('SCHEDULER_STDOUT_CAP');});child.stderr!.on('data',(body:Buffer)=>{stderrBytes+=body.length;if(stderrBytes>32768)stop('SCHEDULER_STDERR_CAP');});
    child.on('message',(m:any)=>{if(m?.kind==='progress'){ready=true;lastHeartbeat=performance.now();if(m.rss>256*MIB)stop('SCHEDULER_RSS_CAP');if(m.cpuMs>20000)stop('SCHEDULER_CPU_CAP');if(m.eventLoopLagMs>500)stop('SCHEDULER_CHILD_LAG_CAP');if(m.firstProviderFailure)stop(typeof m.firstProviderFailure==='string'&&/^[A-Z][A-Z0-9_:-]{0,100}$/.test(m.firstProviderFailure)?m.firstProviderFailure:'SCHEDULER_PROVIDER_FAILURE');}else if(m?.kind==='final'){if(Buffer.byteLength(JSON.stringify(m.summary??null))>128*1024){stop('SCHEDULER_FINAL_IPC_CAP');return;}finalSummary=m.summary;lastHeartbeat=performance.now();}else if(m?.kind==='fatal')stop('SCHEDULER_CHILD_FATAL');});
    child.once('spawn',()=>child.send({kind:'start',approved:true,startedAt,deadlineAt,outDir}));
    const soft=setTimeout(()=>stop('SCHEDULER_SHUTDOWN_RESERVE'),Math.max(0,startedAt+115000-Date.now())),hard=setTimeout(()=>stop('SCHEDULER_WALL_HARD_LIMIT',true),Math.max(0,deadlineAt-Date.now()));
    const watcher=setInterval(()=>{
      const tick=performance.now();peakParentLagMs=Math.max(peakParentLagMs,Math.max(0,tick-lastTick-100));lastTick=tick;
      const parentUsed=process.cpuUsage(parentCpu0);peakParentCpuMs=Math.max(peakParentCpuMs,(parentUsed.user+parentUsed.system)/1000);peakParentRssBytes=Math.max(peakParentRssBytes,process.memoryUsage().rss);if(peakParentRssBytes>256*MIB)stop('SCHEDULER_PARENT_RSS_CAP');if(peakParentCpuMs+peakCpuMs>20000)stop('SCHEDULER_AGGREGATE_CPU_CAP');
      if(Date.now()>=deadlineAt){stop('SCHEDULER_WALL_HARD_LIMIT',true);return;}if(peakParentLagMs>500)stop('SCHEDULER_PARENT_LAG_CAP');if(tick-lastHeartbeat>(ready?3000:8000))stop('SCHEDULER_HEARTBEAT_CAP');
      let stage:ComponentWatchStage='active-evidence-scan';
      try{
        const scan=scanSchedulerForwardEvidence(outDir,{writerPid:child.pid!});vanishedAtomicFiles+=scan.vanishedAtomicFiles;need(scan.countedBytes<=6*MIB-256*1024,'SCHEDULER_NEW_EVIDENCE_CAP');need(priorBytes+scan.countedBytes+256*1024<=32*MIB,'SCHEDULER_ALL_EVIDENCE_CAP');
        usage=schedulerForwardUsage(outDir,baseline.baseline);if(usage.firstProviderFailure)stop(usage.firstProviderFailure);
        if(child.pid&&!childExited){stage='child-proc-status';const status=readFileSync('/proc/'+child.pid+'/status','utf8'),rss=Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1])*1024;need(integer(rss),'SCHEDULER_RSS_UNAVAILABLE');peakRssBytes=Math.max(peakRssBytes,rss);if(rss>256*MIB)stop('SCHEDULER_RSS_CAP');stage='child-proc-stat';const stat=readFileSync('/proc/'+child.pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),cpu=(Number(fields[11])+Number(fields[12]))*1000/hz;need(Number.isFinite(cpu)&&cpu>=0,'SCHEDULER_CPU_UNAVAILABLE');peakCpuMs=Math.max(peakCpuMs,cpu);if(cpu>20000)stop('SCHEDULER_CPU_CAP');}
        stage='prior-counterbook-hash';if(tick-lastVerify>=1000){lastVerify=tick;need(mismatches(priorHashes,repo).length===0,'SCHEDULER_PRIOR_EVIDENCE_CHANGED');need(mismatches(sourceHashes,repo).length===0,'SCHEDULER_REVIEWED_SOURCE_CHANGED');}
      }catch(e){const detail=componentWatchFailure(stage,e),ownCode=e instanceof Error&&/^SCHEDULER_[A-Z0-9_]{1,100}$/.test(e.message)?e.message:null;if(resourceErrors.length<16)resourceErrors.push({at:Date.now(),...detail,failureCode:ownCode??detail.failureCode});if(detail.disposition==='await-child-exit'){if(!childExited&&!procTimer){procTimer=setTimeout(()=>{if(!childExited)stop('SCHEDULER_PROC_EXIT_UNCONFIRMED');},250);procTimer.unref();}}else if(!childExited)stop(ownCode??'SCHEDULER_RESOURCE_OR_EVIDENCE_CHECK_FAILED');}
    },100);
    const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolveExit=>{child.once('error',()=>resolveExit({code:2,signal:null}));child.once('exit',(code,signal)=>resolveExit({code,signal}));});
    clearInterval(watcher);clearTimeout(soft);clearTimeout(hard);clearTimeout(killTimer);clearTimeout(procTimer);process.removeListener('SIGTERM',interrupt);process.removeListener('SIGINT',interrupt);
    const priorMismatches=mismatches(priorHashes,repo),sourceMismatches=mismatches(sourceHashes,repo);if(priorMismatches.length)stopReason??='SCHEDULER_PRIOR_EVIDENCE_CHANGED';if(sourceMismatches.length)stopReason??='SCHEDULER_REVIEWED_SOURCE_CHANGED';
    try{usage=schedulerForwardUsage(outDir,baseline.baseline);}catch{stopReason??='SCHEDULER_FINAL_COUNTERS_UNAVAILABLE';}
    const receipt=join(outDir,'supervisor.json'),outcome=typeof finalSummary?.outcome==='string'?finalSummary.outcome:'UNCERTAIN_SCHEDULER_DIAGNOSTIC_STOP';
    durableJson(receipt,{schemaVersion:1,recordedAt:new Date().toISOString(),startedAt,deadlineAt,supervisor:{wallMs:performance.now()-began,peakRssBytes,peakCpuMs,peakParentCpuMs,peakParentRssBytes,peakParentLagMs,stdoutBytes,stderrBytes,stopReason,exit,resourceErrors,activeEvidenceAccounting:{atomicTempHeadroomBytes:3*COMPONENT_ATOMIC_TEMP_HEADROOM,vanishedAtomicFiles}},usage,outcome,summary:finalSummary,uncertainAttempt:finalSummary===null,priorEvidenceUnchanged:priorMismatches.length===0,priorMismatches,sourceUnchanged:sourceMismatches.length===0,sourceMismatches,noRetry:true,productionChanged:false,paperEntries:false,liveTrading:false,acceptanceClock:false});
    const exitCode=exit.code===0&&finalSummary!==null&&stopReason===null?0:2;process.stdout.write(JSON.stringify({receipt,outcome,stopReason,exit,priorEvidenceUnchanged:priorMismatches.length===0})+'\n');return {receipt,outcome,exitCode};
  }finally{closeSync(lease);}
}
