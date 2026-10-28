/** Finite integrated research launcher. Public inputs only, no ledger, signer,
 * wallet, order or transaction-execution imports. Importing this file is inert. */
import {constants,openSync,closeSync,readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,renameSync,fsyncSync,statfsSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {Recorder,json} from './recorder.js';
import {PilotRpc} from './pilot-rpc.js';
import {PilotFeeds} from './pilot-feeds.js';
import {PilotNativeFlow} from './pilot-native-flow.js';
import {ResearchClockPositionPricer} from './research-clock-pricing.js';
import {NativeCandidateRunner,NATIVE_CANDIDATE_VERSION,type NativeOrigin} from './native-candidate-runner.js';
import {PROVISIONAL_RULE} from './strategy.js';

const MIB=1024*1024;
export const NATIVE_CANDIDATE_LIMITS=Object.freeze({durationMs:900000,maximumDurationMs:1800000,shutdownReserveMs:10000,maximumDeep:6,maximumUnits:1500,relatedResponseBytes:256*MIB,nativeSocketBytes:220*MIB,broadWatchBytes:1024*MIB,discoveryBytes:5*MIB,retainedEvidenceBytes:128*MIB,evidenceSegmentBytes:8*MIB,maximumRssBytes:384*MIB,maximumCpuMicros:240000000,minimumDiskHeadroom:256*MIB,maximumDiscoveryQueue:256});
export type NativeCandidateInput={schemaVersion:1;baselinePaths:string[];priorPhysicalSettled:true;priorCooldownUntil:number;origins:NativeOrigin[];source:{commit:string;sha256:string};watchCheckpoint?:unknown;reportingBinding?:{accountId:string;inceptionAt:number;sourceStatusSha256:string}};
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,150}$/.test(e.message)?e.message:'NATIVE_RESEARCH_UNAVAILABLE';
function atomic(path:string,value:unknown){const body=json(value)+'\n';need(Buffer.byteLength(body)<=8*MIB,'NATIVE_RESEARCH_SNAPSHOT_SIZE');const temp=path+'.pending',fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);}
function lease(path:string){const fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);const result=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000});if(result.status!==0||result.error){closeSync(fd);throw Error('NATIVE_RESEARCH_ALREADY_OWNED');}return fd;}
/** Runtime fields are deliberately public binding metadata only. Financial
 * state is absent rather than fabricated as a zero portfolio. */
export function validateNativeCandidateInput(value:unknown):asserts value is NativeCandidateInput{
 const v=value as NativeCandidateInput;need(v?.schemaVersion===1&&v.priorPhysicalSettled===true&&Array.isArray(v.baselinePaths)&&v.baselinePaths.length>0&&v.baselinePaths.length<=224&&v.baselinePaths.every(p=>typeof p==='string'&&p.length>0)&&Number.isSafeInteger(v.priorCooldownUntil)&&v.priorCooldownUntil>=0&&Array.isArray(v.origins)&&v.origins.length<=174&&typeof v.source?.commit==='string'&&/^[a-f0-9]{7,40}$/.test(v.source.commit)&&/^[a-f0-9]{64}$/.test(v.source.sha256),'NATIVE_RESEARCH_INPUT');
 if(v.reportingBinding)need(/^poe-pilot-[a-z0-9-]+$/.test(v.reportingBinding.accountId)&&Number.isSafeInteger(v.reportingBinding.inceptionAt)&&v.reportingBinding.inceptionAt>0&&/^[a-f0-9]{64}$/.test(v.reportingBinding.sourceStatusSha256),'NATIVE_RESEARCH_ACCOUNT_BINDING');
 need(!['privateKey','wallet','secret','capital','balance','positions','pending','entriesEnabled'].some(k=>Object.hasOwn(v,k)),'NATIVE_RESEARCH_NONPUBLIC_INPUT_DENIED');
}
/** Reporting-only projection, compatible with the existing experimental channel.
 * Unknown financial/protection facts stay absent or null, never invented zeroes. */
export function nativeCandidateReportingProjection(engine:ReturnType<NativeCandidateRunner['status']>|undefined,feeds:ReturnType<PilotFeeds['usage']>|undefined,eventLoopDelayP95Ms:number|null,running:boolean,stopReason:string){
 const c=engine?.counters,flow=engine?.flow,at=engine?.generatedAt??Date.now();
 const baseStatus=!running?'stopped: '+stopReason:!engine?'initializing candidate-only native observation':engine.rpc.cooldownUntil>at?'RPC cooldown; candidate support/audits degraded; no financial execution':engine.candidates.length===0?'candidate-only discovery/watch; no deep scopes currently allocated; no financial execution':!flow?.connected?'native flow disconnected or starting; validated candidate observation unavailable':engine.candidates.some(v=>!v.snapshot?.sourceSupportFresh)?'native support unavailable/stale; affected windows unusable; no financial execution':engine.candidates.some(v=>v.snapshot?.hasQualityLoss)?'native candidate data gap; rebuilding complete windows; no financial execution':engine.candidates.some(v=>v.snapshot?.warm)?'candidate-only native observation; current window requires independent audit; no financial execution':'candidate-only native observation; warming six closed buckets; no financial execution';
 const status=(baseStatus+(running&&feeds?(!feeds.discoveryConnected?' Migration discovery disconnected.':'')+(!feeds.pumpApiConnected?' Broad WATCH activity hints unavailable.':''):'')).slice(0,256);
 return {status,observationAgePolicy:engine?.observationAgePolicy??null,watch:engine?{...engine.watch,summary:{...engine.watch.summary,predictiveAssessments:c!.predictiveAssessments,predictiveFailures:c!.predictiveFailed,strategyRejections:0,incompleteDataExclusions:c!.qualityGaps,enrichmentDeadlineFailures:0}}:null,
 funnel:{discovered:c?.migrationHints??null,supported:null,sufficientlyObserved:c?.auditedWindows??null,evaluated:c?.predictiveAssessments??null,qualified:0,reserved:0,attempted:0,paperFilled:0,exited:0,reconciled:0,verifiedMigrationOrigins:c?.verifiedOrigins??null,admitted:engine?.watch.summary.promoted??null,usableWindows:c?.auditedWindows??null},
 usage:{rpc:engine?.rpc??{newUnits:null},feeds:{frames:flow&&feeds?flow.receivedBoundNotifications+feeds.frames:null,normalizedTrades:flow?.normalizedEvents??null,totalSocketBytes:flow&&feeds?flow.socketBytes+feeds.totalSocketBytes:null,nativeSocketBytes:flow?.socketBytes??null,broadWatchSocketBytes:feeds?.pumpApiSocketBytes??null,discoverySocketBytes:feeds?.discoverySocketBytes??null},eventLoopDelayP95Ms},timing:{},
 decisions:engine?.decisions??[],refusals:c?{'migration-verification-unavailable':c.verificationRefusals,'verification-queue-full':c.verificationQueueRefusals,'native-quality-gaps':c.qualityGaps,'independent-audit-unavailable':c.auditUnavailable,'independent-audit-unusable':c.auditUnusable,'predictive-window-deadline-missed':c.decisionDeadlineMisses}: {},
 sourceTimes:{lastMarketNotificationAt:flow?.lastNotificationAt??null,lastFreshSupportAt:flow?.lastFreshSupportAt??null,lastBankClockAt:flow?.lastBankClockAt??null,lastAuditAt:engine?.lastAuditAt??null,lastPredictiveAt:engine?.lastPredictiveAt??null,financialReconciliationAt:null},
 funnelMeaning:'Candidate-only predictive counts; executable qualification and financial actions are disabled. Overlapping windows are not independent market minutes; uniqueEvaluated is separately reported.'};
}
export async function settleNativeCandidateSources(feeds:Pick<PilotFeeds,'stop'|'usage'>|undefined,runner:Pick<NativeCandidateRunner,'stop'>|undefined,native:Pick<PilotNativeFlow,'usage'>|undefined,rpc:Pick<PilotRpc,'usage'|'close'>|undefined,reason:string){
 const results=await Promise.allSettled([feeds?.stop(),runner?.stop(reason)]),failures=results.flatMap(r=>r.status==='rejected'?[safe(r.reason)]:[]);
 let settled=results.every(r=>r.status==='fulfilled')&&!rpc?.usage().inFlight&&!rpc?.usage().waitingOrOperating&&(!native||native.usage().physicalTransportsSettled)&&(!feeds||feeds.usage().physicalTransportsSettled);
 if(settled)try{rpc?.close();}catch(error){settled=false;failures.push(safe(error));}
 if(!settled)failures.push('NATIVE_RESEARCH_PHYSICAL_SETTLEMENT_UNKNOWN');return {settled,failures};
}
export async function runNativeCandidates(args:{inputPath:string;directory:string;durationMs?:number}){
 need(process.getuid?.()!==0,'NATIVE_RESEARCH_NONROOT_REQUIRED');
 const inputRaw=readFileSync(resolve(args.inputPath));need(inputRaw.length<=8*MIB,'NATIVE_RESEARCH_INPUT_SIZE');const input:unknown=JSON.parse(inputRaw.toString());validateNativeCandidateInput(input);
 const duration=args.durationMs??NATIVE_CANDIDATE_LIMITS.durationMs;need(Number.isSafeInteger(duration)&&duration>=90000&&duration<=NATIVE_CANDIDATE_LIMITS.maximumDurationMs,'NATIVE_RESEARCH_DURATION');
 const directory=resolve(args.directory),parent=lstatSync(dirname(directory));need(parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===process.getuid?.()&&(parent.mode&0o077)===0&&realpathSync(dirname(directory))===dirname(directory)&&!existsSync(directory),'NATIVE_RESEARCH_PRIVATE_NEW_DIRECTORY_REQUIRED');
 const globalLease=lease('/tmp/poe-public-component-20261027.lock'),watchLease=lease('/tmp/poe-pumpapi-probe.lock');
 mkdirSync(directory,{mode:0o700});const events=join(directory,'events');mkdirSync(events,{mode:0o700});const startedAt=Date.now(),startedMono=performance.now(),cpuStart=process.cpuUsage(),deadlineAt=startedAt+duration,admissionCutoffAt=deadlineAt-NATIVE_CANDIDATE_LIMITS.shutdownReserveMs,runId='native-candidates-'+new Date(startedAt).toISOString().replace(/[^0-9]/g,'');
 let recorder:Recorder|null=null,segmentBytes=0,evidenceBytes=0,segments=0,reason='bounded interval completed',stopRequestedAt:number|null=null,lastSourceAt:number|null=null,maximumRss=0,busy=false,closed=false;
 let runner:NativeCandidateRunner|undefined,rpc:PilotRpc|undefined,feeds:PilotFeeds|undefined,native:PilotNativeFlow|undefined;
 const controller=new AbortController(),lag=monitorEventLoopDelay({resolution:20});lag.enable();
 const record=(kind:string,data:unknown)=>{const n=Buffer.byteLength(json({kind,data}))+200;need(n<=NATIVE_CANDIDATE_LIMITS.evidenceSegmentBytes,'NATIVE_RESEARCH_EVIDENCE_RECORD_TOO_LARGE');need(evidenceBytes+n<=NATIVE_CANDIDATE_LIMITS.retainedEvidenceBytes-MIB,'NATIVE_RESEARCH_EVIDENCE_CAP');if(!recorder||segmentBytes+n>NATIVE_CANDIDATE_LIMITS.evidenceSegmentBytes){recorder?.close();recorder=new Recorder(join(events,'events-'+String(++segments).padStart(3,'0')+'.ndjson'),NATIVE_CANDIDATE_LIMITS.evidenceSegmentBytes);segmentBytes=0;}recorder.record(kind,data);segmentBytes+=n;evidenceBytes+=n;if(kind==='native-flow-information-available')lastSourceAt=(data as {normalizedAt:number}).normalizedAt;};
 const admissionOpen=()=>!controller.signal.aborted&&Date.now()<admissionCutoffAt&&performance.now()-startedMono<duration-NATIVE_CANDIDATE_LIMITS.shutdownReserveMs;
 const stop=(why:string)=>{if(stopRequestedAt!==null)return;reason=why;stopRequestedAt=Date.now();controller.abort();};
 const cutoffTimer=setTimeout(()=>stop('logical observation cutoff reached; shutdown reserve begins'),Math.max(1,admissionCutoffAt-Date.now()));
 const signalStop=()=>stop('signal requested; candidate observation interrupted');process.once('SIGTERM',signalStop);process.once('SIGINT',signalStop);
 const status=(running:boolean)=>{const engine=runner?.status(),feedUsage=feeds?.usage(),lagMs=lag.percentile(95)/1e6;return {schemaVersion:1,project:'Pump Opportunity Engine',experimental:true,authoritative:false,runId,accountId:input.reportingBinding?.accountId??null,inceptionAt:input.reportingBinding?.inceptionAt??null,accountBindingProvenance:input.reportingBinding?.sourceStatusSha256??null,mode:'candidate-evaluation',runtimeVersion:NATIVE_CANDIDATE_VERSION,source:input.source,strategyVersion:PROVISIONAL_RULE.version,configurationSha256:createHash('sha256').update(json({limits:NATIVE_CANDIDATE_LIMITS,duration,contract:'confirmed-program-events-v2',strategy:PROVISIONAL_RULE,watchHints:'unchanged-broad-PumpApi'})).digest('hex'),startedAt,generatedAt:Date.now(),lastSourceAt,elapsedMs:Date.now()-startedAt,running,financialExecutionAuthorized:false,entriesEnabled:false,financialWriterOpened:false,liveTradingEnabled:false,productionUntouched:true,portfolio:null,experimentalFinancialPortfolio:null,financialMeaning:'Candidate-only native observation segment; financial ledger remains separate and unopened; no financial execution or invented balances.',stopReason:running?null:reason,logicalObservationCutoffAt:admissionCutoffAt,stopRequestedAt,limits:{...NATIVE_CANDIDATE_LIMITS,durationMs:duration},engine:engine??null,feeds:feedUsage??null,...nativeCandidateReportingProjection(engine,feedUsage,lagMs,running,reason),resources:{maximumRssBytes:maximumRss,cpu:process.cpuUsage(cpuStart),eventLoopDelayP95Ms:lagMs,retainedEvidenceBytes:evidenceBytes,evidenceSegments:segments},costs:{apiData:'public RPC/free discovery/data-only stream; no new API purchase',infrastructure:'existing compute and transfer allowance/cost unverified; not zero total cost'}};};
 try{
  record('native-research-frozen-input',{runId,startedAt,inputSha256:createHash('sha256').update(inputRaw).digest('hex'),source:input.source,strategy:PROVISIONAL_RULE,limits:NATIVE_CANDIDATE_LIMITS,durationMs:duration,financialWriterOpened:false});
  rpc=new PilotRpc({directory:join(directory,'rpc'),runId,baselinePaths:input.baselinePaths,priorPhysicalSettled:true,priorCooldownUntil:input.priorCooldownUntil,durationMs:duration,maxUnits:1500,maxResponseBytes:256*MIB,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,profile:'candidate-native-research-v1',record});
  const support=new ResearchClockPositionPricer(rpc,{record});
  native=new PilotNativeFlow({control:rpc,support,record,maximumCandidates:6,durationMs:duration,maximumReceivedBytes:220*MIB,maximumRecordedBytes:112*MIB,maximumCpuMicros:NATIVE_CANDIDATE_LIMITS.maximumCpuMicros,maximumRssBytes:NATIVE_CANDIDATE_LIMITS.maximumRssBytes,informationAdmissionOpen:admissionOpen,onFlowOpen:r=>runner?.onFlowOpen(r),onTrade:r=>runner?.onTrade(),onGap:r=>runner?.onGap(r),onActivity:r=>runner?.onActivity(r)});
  runner=new NativeCandidateRunner({rpc,flow:native,record,maximumDeep:6,admissionOpen,restoredWatch:input.watchCheckpoint});for(const origin of input.origins)runner.importOrigin(origin);
  feeds=new PilotFeeds({control:rpc,amountConvention:'curve',durationMs:duration,maximumCandidates:6,maxPumpApiBytes:1024*MIB,maxDiscoveryBytes:5*MIB,maximumRecordedBytes:8*MIB,record,onMigration:seed=>runner?.onMigration(seed),watchedIdentities:()=>runner!.watch.listIdentities().flatMap(r=>r.mint&&r.pool?[{mint:r.mint,pool:r.pool}]:[]),onWatchActivity:r=>runner?.onActivity({mint:r.mint,at:r.receivedAt,evidence:r.evidence}),onTrade:()=>{throw Error('NATIVE_RESEARCH_LEGACY_DEEP_TRADE_FORBIDDEN');},onGap:r=>record('native-watch-feed-unavailable',{...r,selectedNativeFlowUnaffected:true}),admitControl:()=>busy||!admissionOpen()?false:{latestStartAt:admissionCutoffAt-2000,admissionOpen}});
  await feeds.startDiscovery(controller.signal);await feeds.startWatchActivity(controller.signal);
  let nextStatusAt=0;
  while(admissionOpen()){
   maximumRss=Math.max(maximumRss,process.memoryUsage().rss);const cpu=process.cpuUsage(cpuStart);if(maximumRss>NATIVE_CANDIDATE_LIMITS.maximumRssBytes||cpu.user+cpu.system>NATIVE_CANDIDATE_LIMITS.maximumCpuMicros){stop('NATIVE_RESEARCH_RESOURCE_CAP');break;}
   if(statfsSync(directory).bavail*statfsSync(directory).bsize<NATIVE_CANDIDATE_LIMITS.minimumDiskHeadroom){stop('NATIVE_RESEARCH_STORAGE_HEADROOM');break;}
   if(evidenceBytes>=NATIVE_CANDIDATE_LIMITS.retainedEvidenceBytes-2*MIB){stop('NATIVE_RESEARCH_EVIDENCE_SOFT_STOP');break;}
   if(native.usage().unmanagedControlUnits){stop('NATIVE_RESEARCH_UNMANAGED_CONTROL_REQUIRES_ACCOUNTING');break;}
   if(!rpc.available()&&rpc.usage().fatal){stop('NATIVE_RESEARCH_RPC_FATAL');break;}
   busy=true;try{await runner.step(controller.signal);}finally{busy=false;}
   if(Date.now()>=nextStatusAt){atomic(join(directory,'status.json'),status(true));atomic(join(directory,'watch-checkpoint.json'),runner.checkpoint());nextStatusAt=Date.now()+15000;}
   if(existsSync(join(directory,'stop-request.json'))){stop('file requested; candidate observation interrupted');break;}
   await new Promise<void>(r=>setTimeout(r,50));
  }
 }catch(error){reason=safe(error);stop(reason);try{record('native-research-failure',{at:Date.now(),reason,financialWriterOpened:false});}catch{}}
 finally{
  stopRequestedAt??=Date.now();
  const cleanup=await settleNativeCandidateSources(feeds,runner,native,rpc,reason);closed=cleanup.settled;if(cleanup.failures.length)reason=cleanup.failures[0]!;
  const final={...status(false),physicalSettlementConfirmed:closed,transportSettledAt:closed?Date.now():null,appendOnlyCounterPaths:rpc?.usage().chapterPaths??[],unmanagedControlUnits:native?.usage().unmanagedControlUnits??0};
  try{record('native-research-final',final);atomic(join(directory,'status.json'),final);atomic(join(directory,'receipt.json'),final);if(runner)atomic(join(directory,'watch-checkpoint.json'),runner.checkpoint());}finally{clearTimeout(cutoffTimer);lag.disable();(recorder as Recorder|null)?.close();if(closed){closeSync(watchLease);closeSync(globalLease);}process.off('SIGTERM',signalStop);process.off('SIGINT',signalStop);}
 }
 return {directory,runId,reason,physicalSettlementConfirmed:closed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];need(args.includes('--run')&&args.includes('--input')&&args.includes('--directory'),'NATIVE_RESEARCH_EXPLICIT_RUN_REQUIRED');const seconds=args.includes('--duration-seconds')?Number(value('--duration-seconds')):900;runNativeCandidates({inputPath:value('--input')!,directory:value('--directory')!,durationMs:seconds*1000}).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(safe(error)+'\n');process.exitCode=1;});}
