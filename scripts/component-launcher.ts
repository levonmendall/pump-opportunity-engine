/** Standard nonroot supervisor for ONE explicitly approved public-RPC component.
 * This file performs no provider requests and never edits the old counterbook.
 */
import {spawn,spawnSync} from 'node:child_process';
import {constants,openSync,closeSync,fstatSync,lstatSync,readdirSync,readFileSync,writeFileSync,fsyncSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readResearchBaseline} from '../src/research-baseline.js';

const MIB=1024*1024,PIN='4bbb21380dd0af2546297179cf5795a28a5d202c';
const PROPOSAL='evidence/adaptive-monitoring/next-live-proposal.json';
const OLD_BOOK='evidence/free-data-20261027/active-approved-rpc-budget.json';
const MAX_NEW_EVIDENCE=8*MIB,MAX_ALL_EVIDENCE=32*MIB,RECEIPT_RESERVE=256*1024;
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
function boundedJson(path:string,value:unknown){
  const body=JSON.stringify(value,null,2)+'\n';need(Buffer.byteLength(body)<=RECEIPT_RESERVE,'COMPONENT_SUPERVISOR_RECEIPT_SIZE');
  const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}
}
function files(path:string):string[]{
  const rows:string[]=[];
  for(const name of readdirSync(path)){
    const p=resolve(path,name),s=lstatSync(p);need(!s.isSymbolicLink(),'COMPONENT_EVIDENCE_SYMLINK');
    if(s.isDirectory())rows.push(...files(p));else{need(s.isFile(),'COMPONENT_EVIDENCE_FILE_TYPE');rows.push(p);}
    need(rows.length<=1024,'COMPONENT_EVIDENCE_FILE_COUNT');
  }
  return rows.sort();
}
function bytes(paths:string[]){return paths.reduce((n,p)=>n+lstatSync(p).size,0);}
function hashes(paths:string[],repo:string){return Object.fromEntries(paths.map(p=>[p.slice(repo.length+1),hash(readFileSync(p))]));}
function verify(h:Record<string,string>,repo:string){return Object.entries(h).filter(([p,s])=>{try{return hash(readFileSync(resolve(repo,p)))!==s;}catch{return true;}}).map(([p])=>p);}

export type ComponentLauncherResult={receipt:string;outcome:string;exitCode:number};
/** Called only by the caller's explicit `run-approved` branch. No CLI auto-run. */
export async function runComponentLauncher(childScript:string,overnight?:{leg:string}):Promise<ComponentLauncherResult>{
  const startedAt=Date.now(),began=performance.now(),script=resolve(childScript),repo=resolve(dirname(script),'..');
  if(overnight)need(/^[0-9]{2}-[a-z-]{1,32}$/.test(overnight.leg),'COMPONENT_INVALID_OVERNIGHT_LEG');
  need(process.getuid?.()===1000,'COMPONENT_NONROOT_CLOUD_USER_REQUIRED');
  need(process.cwd()===repo&&script.startsWith(resolve(repo,'scripts')+'/'),'COMPONENT_CLEAN_PROJECT_REQUIRED');
  for(const p of [repo,resolve(repo,'evidence')]){const s=lstatSync(p);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o022)===0,'COMPONENT_UNSAFE_PROJECT_DIRECTORY');}
  const pinned=spawnSync('git',['show',`${PIN}:${PROPOSAL}`],{cwd:repo,encoding:'buffer',maxBuffer:MIB,timeout:5000});
  need(!pinned.error&&pinned.status===0&&Buffer.isBuffer(pinned.stdout),'COMPONENT_PINNED_PROPOSAL_UNAVAILABLE');
  const proposalBytes=readFileSync(resolve(repo,PROPOSAL));need(proposalBytes.equals(pinned.stdout),'COMPONENT_PROPOSAL_CHANGED');
  const proposal=JSON.parse(proposalBytes.toString());
  need(proposal.maximumTotalMs===90000&&proposal.totalRequestUnitCeiling===70&&proposal.resources?.cpuSeconds===20&&proposal.retainedEvidenceBytesCeiling===MAX_NEW_EVIDENCE,'COMPONENT_PINNED_LIMIT_MISMATCH');
  const oldBytes=readFileSync(resolve(repo,OLD_BOOK)),old=JSON.parse(oldBytes.toString());
  need(old.calls===20&&old.bytes===272634&&old.blockedReason==='RPC_HTTP_429'&&Array.isArray(old.pending)&&old.pending.length===0&&Array.isArray(old.starts)&&old.starts.length===20,'COMPONENT_PRIOR_COUNTER_STATE_CHANGED');
  const overnightRoot=resolve(repo,'evidence/overnight-20261027');
  if(overnight){try{mkdirSync(overnightRoot,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}}
  const baselinePaths=[OLD_BOOK,'evidence/public-component-20261027/rpc-budget.json'];
  if(overnight)for(const name of readdirSync(overnightRoot).filter(n=>/^[0-9]{2}-[a-z-]+$/.test(n)).sort()){
    need(name<overnight.leg,'COMPONENT_OVERNIGHT_LEG_ORDER');baselinePaths.push('evidence/overnight-20261027/'+name+'/rpc-budget.json');
  }
  const linked=overnight?readResearchBaseline({paths:baselinePaths,now:startedAt,physicalSettled:true}):null;
  const priorNewBooks=overnight?baselinePaths.slice(2).map(p=>({path:p,book:JSON.parse(readFileSync(resolve(repo,p),'utf8'))})):[];
  for(const p of priorNewBooks){const receipt=JSON.parse(readFileSync(resolve(repo,dirname(p.path),'supervisor.json'),'utf8'));need(receipt.supervisor?.exit&&(receipt.supervisor.exit.code!==null||receipt.supervisor.exit.signal!==null),'COMPONENT_PRIOR_CHILD_EXIT_UNVERIFIED');}
  need(!priorNewBooks.some(p=>p.book.haltedReason==='COMPONENT_PHYSICAL_TIMEOUT'),'COMPONENT_OVERNIGHT_PHYSICAL_STALL');
  const refusals=priorNewBooks.filter(p=>p.book.haltedReason==='COMPONENT_HTTP_429');need(refusals.length<2,'COMPONENT_OVERNIGHT_SECOND_429');
  let providerNotBefore=0;
  if(refusals.length){const p=refusals.at(-1)!,records=readFileSync(resolve(repo,dirname(p.path),'observations.ndjson'),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));const header=records.findLast(r=>r.kind==='http-headers'&&r.data.status===429||r.kind==='ws-upgrade-refused'&&r.data.status===429);const raw=header?.data.retryAfter,at=header?.recordedAt??p.book.lastObservedAt;providerNotBefore=typeof raw==='string'&&/^\d+$/.test(raw)?at+Number(raw)*1000:typeof raw==='string'&&Number.isFinite(Date.parse(raw))?Date.parse(raw):at+300000;need(startedAt>=providerNotBefore,'COMPONENT_PROVIDER_COOLDOWN_ACTIVE');}
  const refusalAt=Math.max(old.lastObservedAt,...old.starts);
  need(Number.isSafeInteger(refusalAt)&&refusalAt<=startedAt&&startedAt-refusalAt>=300000,'COMPONENT_PROVIDER_COOLDOWN_NOT_ELAPSED');
  const priorRoots=['evidence/free-data-20261027','evidence/adaptive-monitoring',...(overnight?['evidence/public-component-20261027','evidence/overnight-20261027']:[])].map(p=>resolve(repo,p)),priorFiles=priorRoots.flatMap(files);
  const immutableFiles=overnight?priorFiles.filter(p=>p!==resolve(overnightRoot,'pumpapi-budget.json')):priorFiles;
  const priorEvidence=hashes(immutableFiles,repo),priorEvidenceBytes=bytes(priorFiles);
  need(priorEvidenceBytes+MAX_NEW_EVIDENCE<=MAX_ALL_EVIDENCE,'COMPONENT_CUMULATIVE_EVIDENCE_RESERVE');
  const sourcePaths=[script,resolve(repo,'scripts/component-launcher.ts'),...['src/component-budget.ts','src/component-selection.ts','src/component-transport.ts','src/component-parity.ts','src/research-clock-pricing.ts','src/pool.ts','src/sdk.ts','src/pumpapi-mapping.ts','src/active-selection.ts','src/strategy.ts','src/network.ts','package.json','package-lock.json'].map(p=>resolve(repo,p))];
  if(overnight)sourcePaths.push(resolve(repo,'src/research-baseline.ts'));
  if(script.endsWith('/overnight-notifications.ts'))sourcePaths.push(resolve(repo,'src/component-results.ts'));
  if(script.endsWith('/overnight-active.ts'))for(const path of ['scripts/active-pumpapi-trial.ts','src/active-pipeline.ts','src/research-rpc.ts'])sourcePaths.push(resolve(repo,path));
  if(script.endsWith('/overnight-feed.ts'))for(const path of ['src/overnight-field.ts','src/active-pipeline.ts','src/pumpapi-probe.ts'])sourcePaths.push(resolve(repo,path));
  const sourceHashes=hashes(sourcePaths,repo);
  const lockPath='/tmp/poe-public-component-20261027.lock',lease=openSync(lockPath,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  let leaseOpen=true;
  try{
    const lock=fstatSync(lease);need(lock.isFile()&&lock.uid===process.getuid?.()&&lock.nlink===1&&(lock.mode&0o077)===0,'COMPONENT_UNSAFE_SUPERVISOR_LEASE');
    const owned=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',lease],timeout:5000});need(!owned.error&&owned.status===0,'COMPONENT_SUPERVISOR_ALREADY_OWNED');
    const outDir=overnight?resolve(overnightRoot,overnight.leg):resolve(repo,'evidence/public-component-20261027');
    try{mkdirSync(outDir,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error('COMPONENT_GRANT_ALREADY_RECORDED_NO_RETRY');throw error;}
    const maximumTotalMs=overnight?.leg.endsWith('-discovery')?600000:overnight?.leg.endsWith('-sampler')?10000:overnight?.leg.endsWith('-field')?35000:90000;
    const deadlineAt=startedAt+maximumTotalMs;
    if(overnight){
      const grantPath=resolve(overnightRoot,'grant.json');
      let grant:any;try{grant=JSON.parse(readFileSync(grantPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;grant={schemaVersion:1,authority:'Explicit owner overnight multi-stage research directive,2026-10-27; no production change or spending',startedAt,deadlineAt:startedAt+8*60*60*1000,startingUsage:{units:linked!.baseline.calls,measuredBytes:linked!.observedBytes,uncertainReservedBytes:linked!.uncertainResponseBytes},ceilings:{units:240,rpcRelatedResponseBytes:64*MIB,pumpApiReservedBytes:256*MIB,pumpApiReservedMs:300000,retainedEvidenceBytes:32*MIB},rpcThrottlePolicy:'Stop affected measurement; at most one deliberate paced reattempt after Retry-After or conservative5min cooldown; second new429 ends RPC research'};boundedJson(grantPath,grant);}
      need(deadlineAt<=grant.deadlineAt,'COMPONENT_OVERNIGHT_DEADLINE');
      boundedJson(resolve(outDir,'baseline.json'),{...linked,providerNotBefore,priorNew429Count:refusals.length,baselinePaths,maximumTotalMs});
    }
    boundedJson(resolve(outDir,'grant.json'),{schemaVersion:1,authorization:overnight?'Owner explicitly approved bounded overnight multi-stage research; this is a linked measurement, not reopening old grants.':'Owner explicitly approved exactly the public-RPC component proposal at4bbb213; one new bounded grant, not reopening the prior experiment.',startedAt,deadlineAt,proposalCommit:overnight?null:PIN,proposalSha256:overnight?null:hash(proposalBytes),proposal:overnight?{classification:'OVERNIGHT_LINKED_MEASUREMENT',leg:overnight.leg,maximumTotalMs,maximumNewUnits:70,priorAggregateUnits:linked!.baseline.calls,priorAggregateObservedBytes:linked!.observedBytes,priorUncertainReservedBytes:linked!.uncertainResponseBytes,discoveryReceivedCeilingBytes:overnight.leg.endsWith('-discovery')?5*MIB:null}:proposal,priorCounterbookSha256:overnight?linked!.baseline.sha256:hash(oldBytes),priorCounters:overnight?{units:linked!.baseline.calls,responseBytes:linked!.observedBytes,uncertainReservedBytes:linked!.uncertainResponseBytes,historicalRefusal:'RPC_HTTP_429'}:{units:20,responseBytes:272634,blockedReason:'RPC_HTTP_429'},cooldown:{minimumLocalWaitMs:300000,elapsedSincePriorRefusalMs:startedAt-refusalAt,priorRetryAfterHeader:null,limitation:'The old response header was not retained; no known provider cooldown remains. No endpoint or identity rotation.'},priorEvidenceBytes,priorEvidenceSha256:priorEvidence,sourceSha256:sourceHashes,productionChanged:false,entriesEnabled:false,liveTrading:false,acceptanceClockStarted:false});
    const clockTicks=spawnSync('/usr/bin/getconf',['CLK_TCK'],{encoding:'utf8',timeout:5000});const hz=Number(clockTicks.stdout.trim());need(clockTicks.status===0&&Number.isSafeInteger(hz)&&hz>0,'COMPONENT_CPU_CLOCK_UNAVAILABLE');
    const child=spawn('/usr/bin/prlimit',['--cpu=20:21','--fsize=16777216:16777216','--nofile=64:64','--',process.execPath,'--max-old-space-size=128','--use-env-proxy','--import','tsx',script,overnight?'--overnight-child':'--component-child'],{cwd:repo,env:{...process.env,POE_COMPONENT_STARTED_AT:String(startedAt),POE_COMPONENT_OUT_DIR:outDir,...(overnight?{POE_OVERNIGHT_LEG:overnight.leg}:{})},stdio:['ignore','pipe','pipe','ipc']});
    let stopReason:string|null=null,finalSummary:any=null,stdoutBytes=0,stderrBytes=0,peakRssBytes=0,peakCpuMs=0,peakParentLoopLagMs=0,lastHeartbeat=performance.now(),ready=false,lastTick=lastHeartbeat,lastOldCheck=lastHeartbeat;
    let grace:NodeJS.Timeout|undefined;
    const stop=(reason:string,hard=false)=>{stopReason??=reason;if(hard){child.kill('SIGKILL');return;}if(grace)return;child.kill('SIGTERM');grace=setTimeout(()=>child.kill('SIGKILL'),Math.min(1000,Math.max(0,deadlineAt-Date.now())));grace.unref();};
    const abort=()=>stop('COMPONENT_SUPERVISOR_INTERRUPTED');process.once('SIGTERM',abort);process.once('SIGINT',abort);
    child.stdout!.on('data',(b:Buffer)=>{stdoutBytes+=b.length;if(stdoutBytes>32768)stop('COMPONENT_STDOUT_CAP');});
    child.stderr!.on('data',(b:Buffer)=>{stderrBytes+=b.length;if(stderrBytes>32768)stop('COMPONENT_STDERR_CAP');});
    child.on('message',(m:any)=>{
      if(m?.kind==='progress'){
        ready=true;lastHeartbeat=performance.now();
        if(Number.isFinite(m.rss)&&m.rss>256*MIB)stop('COMPONENT_CHILD_RSS_CAP');
        if(Number.isFinite(m.cpuMs)&&m.cpuMs>20000)stop('COMPONENT_CHILD_CPU_CAP');
        if(Number.isFinite(m.eventLoopLagMs)&&m.eventLoopLagMs>500)stop('COMPONENT_CHILD_EVENT_LOOP_CAP');
      }else if(m?.kind==='final'){
        if(Buffer.byteLength(JSON.stringify(m.summary??null))>128*1024){stop('COMPONENT_FINAL_IPC_CAP');return;}
        finalSummary=m.summary;lastHeartbeat=performance.now();
      }else if(m?.kind==='fatal')stop('COMPONENT_CHILD_FATAL');
    });
    child.once('spawn',()=>child.send({kind:'start',approved:true,startedAt,deadlineAt,outDir}));
    const hard=setTimeout(()=>stop('COMPONENT_WALL_HARD_LIMIT',true),Math.max(0,deadlineAt-Date.now()));
    const watch=setInterval(()=>{
      const tick=performance.now();peakParentLoopLagMs=Math.max(peakParentLoopLagMs,Math.max(0,tick-lastTick-100));lastTick=tick;
      if(Date.now()>=deadlineAt){stop('COMPONENT_WALL_HARD_LIMIT',true);return;}
      if(peakParentLoopLagMs>500)stop('COMPONENT_SUPERVISOR_EVENT_LOOP_CAP');
      if(tick-lastHeartbeat>(ready?3000:8000))stop('COMPONENT_HEARTBEAT_CAP');
      try{
        if(bytes(files(outDir))>MAX_NEW_EVIDENCE-RECEIPT_RESERVE)stop('COMPONENT_RETAINED_EVIDENCE_CAP');
        if(child.pid){
          const status=readFileSync('/proc/'+child.pid+'/status','utf8'),rss=Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1])*1024;
          if(Number.isSafeInteger(rss)){peakRssBytes=Math.max(peakRssBytes,rss);if(rss>256*MIB)stop('COMPONENT_SUPERVISOR_RSS_CAP');}
          const stat=readFileSync('/proc/'+child.pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),cpu=(Number(fields[11])+Number(fields[12]))*1000/hz;
          if(Number.isFinite(cpu)){peakCpuMs=Math.max(peakCpuMs,cpu);if(cpu>20000)stop('COMPONENT_SUPERVISOR_CPU_CAP');}
        }
        if(tick-lastOldCheck>=1000){lastOldCheck=tick;if(hash(readFileSync(resolve(repo,OLD_BOOK)))!==hash(oldBytes))stop('COMPONENT_PRIOR_COUNTERBOOK_MUTATED');}
      }catch{if(child.exitCode===null)stop('COMPONENT_RESOURCE_OR_EVIDENCE_CHECK_UNAVAILABLE');}
    },100);
    const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>{child.once('error',()=>r({code:2,signal:null}));child.once('exit',(code,signal)=>r({code,signal}));});
    clearInterval(watch);clearTimeout(hard);if(grace)clearTimeout(grace);process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);
    const priorMismatches=verify(priorEvidence,repo),sourceMismatches=verify(sourceHashes,repo);
    if(priorMismatches.length)stopReason??='COMPONENT_PRIOR_EVIDENCE_MUTATED';if(sourceMismatches.length)stopReason??='COMPONENT_TEST_SOURCE_CHANGED';
    const receipt=resolve(outDir,'supervisor.json'),outcome=typeof finalSummary?.outcome==='string'?finalSummary.outcome:'UNCERTAIN_COMPONENT_STOP';
    boundedJson(receipt,{schemaVersion:1,recordedAt:new Date().toISOString(),startedAt,deadlineAt,supervisor:{wallMs:performance.now()-began,peakRssBytes,peakCpuMs,peakParentLoopLagMs,stdoutBytes,stderrBytes,stopReason,exit},outcome,summary:finalSummary,uncertainAttempt:finalSummary===null,priorEvidenceUnchanged:priorMismatches.length===0,priorMismatches,sourceUnchanged:sourceMismatches.length===0,sourceMismatches,newEvidenceBytesBeforeReceipt:bytes(files(outDir)),noRetry:true,productionChanged:false,entriesEnabled:false,liveTrading:false,acceptanceClockStarted:false});
    const exitCode=exit.code===0&&finalSummary!==null&&stopReason===null?0:2;
    console.log(JSON.stringify({receipt,outcome,stopReason,exit,priorEvidenceUnchanged:priorMismatches.length===0}));
    closeSync(lease);leaseOpen=false;return {receipt,outcome,exitCode};
  }finally{if(leaseOpen)closeSync(lease);}
}
