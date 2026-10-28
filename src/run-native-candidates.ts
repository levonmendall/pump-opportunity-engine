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
import {PilotNativeFlow,NATIVE_NOTIFICATION_LEDGER_POLICY,nativeFlowDataContract,type NativeFlowDataContract} from './pilot-native-flow.js';
import {ResearchClockPositionPricer} from './research-clock-pricing.js';
import {NativeCandidateRunner,NATIVE_CANDIDATE_VERSION,NATIVE_CANDIDATE_AUDIT_PROFILE,type NativeOrigin} from './native-candidate-runner.js';
import {PROVISIONAL_RULE} from './strategy.js';
import {resolveNativeResearchProfile} from './native-research-profile.js';
import {observationAgePolicyByVersion,type ObservationAgePolicyVersion} from './observation-age.js';

const MIB=1024*1024;
export const NATIVE_CANDIDATE_LIMITS=Object.freeze({durationMs:900000,maximumDurationMs:1800000,shutdownReserveMs:10000,maximumDeep:6,maximumUnits:1500,relatedResponseBytes:256*MIB,nativeSocketBytes:220*MIB,broadWatchBytes:1024*MIB,discoveryBytes:5*MIB,retainedEvidenceBytes:128*MIB,evidenceSegmentBytes:8*MIB,maximumRssBytes:384*MIB,maximumCpuMicros:240000000,minimumDiskHeadroom:256*MIB,maximumDiscoveryQueue:256});
/** Explicit resource selection only; default900s/max1800s stays unchanged. */
export function nativeCandidateRunSettings(durationMs?:number,profileName?:unknown,agePolicyVersion?:unknown,dataContract?:unknown){
 const profile=resolveNativeResearchProfile(profileName),limits=profile??NATIVE_CANDIDATE_LIMITS,duration=durationMs??limits.durationMs;
 need(Number.isSafeInteger(duration)&&duration>=90000&&duration<=limits.maximumDurationMs,'NATIVE_RESEARCH_DURATION');return {profile,limits,duration,observationAgePolicy:observationAgePolicyByVersion(agePolicyVersion),dataContract:nativeFlowDataContract(dataContract)};
}
export function nativeCandidateConfigurationSha256(settings:ReturnType<typeof nativeCandidateRunSettings>){return createHash('sha256').update(json({limits:settings.limits,duration:settings.duration,profile:settings.profile?.version??null,observationAgePolicy:settings.observationAgePolicy,contract:settings.dataContract,notificationLedgerPolicy:NATIVE_NOTIFICATION_LEDGER_POLICY,auditProfile:NATIVE_CANDIDATE_AUDIT_PROFILE,strategy:PROVISIONAL_RULE,watchHints:'unchanged-broad-PumpApi'})).digest('hex');}
/** The same captured object is written and recorded; receipt heartbeats cannot
 * substitute a second generatedAt/source time during publication. */
export const NATIVE_PUBLISHED_STATUS_MAXIMUM_BYTES=4*MIB;
const statusBytes=(value:unknown)=>Buffer.byteLength(json(value)+'\n');
export function nativeStatusArchiveEligible(extended:boolean,archivedCount:number,lastArchivedAt:number|null,at:number){
 need(typeof extended==='boolean'&&Number.isSafeInteger(archivedCount)&&archivedCount>=0&&Number.isSafeInteger(at)&&at>=0&&(lastArchivedAt===null||Number.isSafeInteger(lastArchivedAt)&&lastArchivedAt>=0&&lastArchivedAt<=at)&&(archivedCount===0||lastArchivedAt!==null),'NATIVE_STATUS_ARCHIVE_STATE');
 const policy=resolveNativeResearchProfile('candidate-native-two-hour-research-v1')!.statusSnapshotArchive;
 return !extended||archivedCount<policy.initialFullSnapshots||lastArchivedAt!==null&&at-lastArchivedAt>=policy.minimumLaterIntervalMs;
}
export function writeNativeSourceStatusSnapshot<T extends {generatedAt:number}>(snapshot:T,write:(value:T)=>void,record?:((kind:string,data:T)=>void)){
 need(statusBytes(snapshot)<=NATIVE_PUBLISHED_STATUS_MAXIMUM_BYTES,'NATIVE_RESEARCH_REPORTING_STATUS_SIZE');write(snapshot);record?.('native-source-status-snapshot',snapshot);return snapshot;
}
/** Final reporting survives duplicate-heavy status growth. Market/financial facts
 * are copied as recorded; omitted raw details remain explicit, not fabricated. */
export function boundedNativeFinalStatus<T extends {generatedAt:number;running:boolean}>(snapshot:T):T {
 need(snapshot.running===false,'NATIVE_FINAL_STATUS_MUST_BE_STOPPED');if(statusBytes(snapshot)<=NATIVE_PUBLISHED_STATUS_MAXIMUM_BYTES)return snapshot;
 const full=snapshot as T&Record<string,any>,fields=['schemaVersion','project','experimental','authoritative','runId','accountId','inceptionAt','accountBindingProvenance','mode','researchProfile','runtimeVersion','source','strategyVersion','configurationSha256','startedAt','generatedAt','lastSourceAt','elapsedMs','running','financialExecutionAuthorized','entriesEnabled','financialWriterOpened','liveTradingEnabled','productionUntouched','portfolio','experimentalFinancialPortfolio','financialMeaning','stopReason','logicalObservationCutoffAt','stopRequestedAt','limits','statusArchive','status','observationAgePolicy','dataContract','funnel','timing','decisions','refusals','sourceTimes','funnelMeaning','resources','costs','physicalSettlementConfirmed','transportSettledAt','appendOnlyCounterPaths','unmanagedControlUnits'];
 const reduced:any=Object.fromEntries(fields.filter(key=>Object.hasOwn(full,key)).map(key=>[key,full[key]]));
 reduced.engine=null;reduced.feeds=null;reduced.watch=full.watch?{summary:full.watch.summary}:null;
 if(full.source)reduced.source={commit:full.source.commit,sha256:full.source.sha256};
 const rpc=full.usage?.rpc??{},rpcFields=['profile','runId','startedAt','deadlineAt','remainingMs','chapter','cumulativeUnits','newUnits','accountedCumulativeResponseBytes','newAccountedResponseBytes','maximumNewUnits','maximumNewResponseBytes','requestLimits','inFlight','waitingOrOperating','uncertainResponseBytes','cooldownUntil','controlCooldownUntil','closed','fatal'];
 reduced.usage={rpc:Object.fromEntries(rpcFields.filter(key=>Object.hasOwn(rpc,key)).map(key=>[key,rpc[key]])),feeds:full.usage?.feeds??{},eventLoopDelayP95Ms:full.usage?.eventLoopDelayP95Ms??null};
 reduced.sourceDetailUnavailable='Raw duplicated engine/watch-row/request-history details omitted to satisfy the 4MiB reporting limit; final public counters and original source timestamps retained.';
 need(statusBytes(reduced)<=NATIVE_PUBLISHED_STATUS_MAXIMUM_BYTES,'NATIVE_RESEARCH_FINAL_REPORTING_STATUS_SIZE');return reduced as T;
}
export type NativeCandidateInput={schemaVersion:1;baselinePaths:string[];priorPhysicalSettled:true;priorCooldownUntil:number;origins:NativeOrigin[];source:{commit:string;sha256:string};dataContract?:NativeFlowDataContract;observationAgePolicy?:ObservationAgePolicyVersion;watchCheckpoint?:unknown;reportingBinding?:{accountId:string;inceptionAt:number;sourceStatusSha256:string}};
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,150}$/.test(e.message)?e.message:'NATIVE_RESEARCH_UNAVAILABLE';
function atomic(path:string,value:unknown){const body=json(value)+'\n';need(Buffer.byteLength(body)<=8*MIB,'NATIVE_RESEARCH_SNAPSHOT_SIZE');const temp=path+'.pending',fd=openSync(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,path);}
function lease(path:string){const fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);const result=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000});if(result.status!==0||result.error){closeSync(fd);throw Error('NATIVE_RESEARCH_ALREADY_OWNED');}return fd;}
/** Runtime fields are deliberately public binding metadata only. Financial
 * state is absent rather than fabricated as a zero portfolio. */
export function validateNativeCandidateInput(value:unknown):asserts value is NativeCandidateInput{
 const v=value as NativeCandidateInput;need(v?.schemaVersion===1&&v.priorPhysicalSettled===true&&Array.isArray(v.baselinePaths)&&v.baselinePaths.length>0&&v.baselinePaths.length<=480&&v.baselinePaths.every(p=>typeof p==='string'&&p.length>0)&&Number.isSafeInteger(v.priorCooldownUntil)&&v.priorCooldownUntil>=0&&Array.isArray(v.origins)&&v.origins.length<=174&&typeof v.source?.commit==='string'&&/^[a-f0-9]{7,40}$/.test(v.source.commit)&&/^[a-f0-9]{64}$/.test(v.source.sha256),'NATIVE_RESEARCH_INPUT');
 if(v.reportingBinding)need(/^poe-pilot-[a-z0-9-]+$/.test(v.reportingBinding.accountId)&&Number.isSafeInteger(v.reportingBinding.inceptionAt)&&v.reportingBinding.inceptionAt>0&&/^[a-f0-9]{64}$/.test(v.reportingBinding.sourceStatusSha256),'NATIVE_RESEARCH_ACCOUNT_BINDING');
 need(!['privateKey','wallet','secret','capital','balance','positions','pending','entriesEnabled'].some(k=>Object.hasOwn(v,k)),'NATIVE_RESEARCH_NONPUBLIC_INPUT_DENIED');
 need(Object.keys(v).every(k=>['schemaVersion','baselinePaths','priorPhysicalSettled','priorCooldownUntil','origins','source','watchCheckpoint','reportingBinding','observationAgePolicy','dataContract'].includes(k)),'NATIVE_RESEARCH_INPUT_FIELD_DENIED');
 observationAgePolicyByVersion(v.observationAgePolicy);nativeFlowDataContract(v.dataContract);
}
/** Reporting-only projection, compatible with the existing experimental channel.
 * Unknown financial/protection facts stay absent or null, never invented zeroes. */
export function nativeCandidateReportingProjection(engine:ReturnType<NativeCandidateRunner['status']>|undefined,feeds:ReturnType<PilotFeeds['usage']>|undefined,eventLoopDelayP95Ms:number|null,running:boolean,stopReason:string){
 const c=engine?.counters,flow=engine?.flow,at=engine?.generatedAt??Date.now();
 const baseStatus=!running?'stopped: '+stopReason:!engine?'initializing candidate-only native observation':flow?.fatal?'native flow failed: '+flow.fatal+'; candidate admissions closed; no financial execution':engine.rpc.cooldownUntil>at?'RPC cooldown; candidate support/audits degraded; no financial execution':engine.candidates.length===0?'candidate-only discovery/watch; no deep scopes currently allocated; no financial execution':!flow?.connected?'native flow disconnected or starting; validated candidate observation unavailable':engine.candidates.some(v=>!v.snapshot?.sourceSupportFresh)?'native support unavailable/stale; affected windows unusable; no financial execution':engine.candidates.some(v=>v.snapshot?.hasQualityLoss)?'native candidate data gap; rebuilding complete windows; no financial execution':engine.candidates.some(v=>v.snapshot?.warm)?'candidate-only native observation; current window requires independent audit; no financial execution':'candidate-only native observation; warming six closed buckets; no financial execution';
 const status=((flow?.dataContract&&flow.dataContract!=='confirmed-program-events-v2'?'SHADOWv3 protocol-aware ordinary flow; strictv2 unavailable views '+(c?.strictV2BaselineUnavailableViews??0)+', protocol effects '+flow.protocolEffects+'. ':'')+baseStatus+(running&&feeds?(!feeds.discoveryConnected?' Migration discovery disconnected.':'')+(!feeds.pumpApiConnected?' Broad WATCH activity hints unavailable.':''):'')).slice(0,256);
 return {status,observationAgePolicy:engine?.observationAgePolicy??null,watch:engine?{...engine.watch,summary:{...engine.watch.summary,predictiveAssessments:c!.predictiveAssessments,predictiveFailures:c!.predictiveFailed,strategyRejections:0,incompleteDataExclusions:c!.qualityGaps,enrichmentDeadlineFailures:0}}:null,
 funnel:{discovered:c?.migrationHints??null,supported:null,sufficientlyObserved:c?.auditedWindows??null,evaluated:c?.predictiveAssessments??null,qualified:0,reserved:0,attempted:0,paperFilled:0,exited:0,reconciled:0,verifiedMigrationOrigins:c?.verifiedOrigins??null,admitted:engine?.watch.summary.promoted??null,usableWindows:c?.auditedWindows??null},
 usage:{rpc:engine?.rpc??{newUnits:null},feeds:{frames:flow&&feeds?flow.receivedBoundNotifications+feeds.frames:null,normalizedTrades:flow?.normalizedEvents??null,totalSocketBytes:flow&&feeds?flow.socketBytes+feeds.totalSocketBytes:null,nativeSocketBytes:flow?.socketBytes??null,broadWatchSocketBytes:feeds?.pumpApiSocketBytes??null,discoverySocketBytes:feeds?.discoverySocketBytes??null},eventLoopDelayP95Ms},timing:{},
 decisions:engine?.decisions??[],refusals:c?{'migration-verification-unavailable':c.verificationRefusals,'verification-queue-full':c.verificationQueueRefusals,'native-quality-gaps':c.qualityGaps,'independent-audit-unavailable':c.auditUnavailable,'independent-audit-unusable':c.auditUnusable,'predictive-window-deadline-missed':c.decisionDeadlineMisses}: {},
 sourceTimes:{lastMarketNotificationAt:flow?.lastNotificationAt??null,lastFreshSupportAt:flow?.lastFreshSupportAt??null,lastBankClockAt:flow?.lastBankClockAt??null,lastAuditAt:engine?.lastAuditAt??null,lastPredictiveAt:engine?.lastPredictiveAt??null,financialReconciliationAt:null},
 funnelMeaning:'Candidate-only predictive counts; executable qualification and financial actions are disabled. Overlapping windows are not independent market minutes; uniqueEvaluated is separately reported.'};
}
/** WATCH reconnects are lower priority than due selected-flow controls. This
 * checks the SAME dispatcher; it neither reserves a second budget nor starts IO. */
export function nativeCandidateWatchControlAdmission(busy:boolean,admissionOpen:boolean,flow:{nextServiceAt:number}|undefined,at:number){
 return !busy&&admissionOpen&&(!flow||flow.nextServiceAt>at+2000);
}
/** A WATCH upgrade has a1500ms physical timeout and500ms planning reserve.
 * Unknown settlement still holds the shared physical gate; this is admission
 * planning, never permission to release a stalled operation. */
export function nativeCandidateWatchControlRequest(state:()=>{busy:boolean;admissionOpen:boolean;flow:{nextServiceAt:number}|undefined;at:number},cutoffAt:number){
 const s=state();if(!nativeCandidateWatchControlAdmission(s.busy,s.admissionOpen,s.flow,s.at))return false;
 return {latestStartAt:Math.min(cutoffAt-2000,(s.flow?.nextServiceAt??Infinity)-2000),admissionOpen:()=>{const current=state();return nativeCandidateWatchControlAdmission(current.busy,current.admissionOpen,current.flow,current.at);}};
}
/** This candidate-only launcher owns no held exposure. A trader must isolate
 * candidate-source failure while continuing its separate position manager. */
export function nativeCandidateDataStopReason(usage:Pick<ReturnType<PilotNativeFlow['usage']>,'fatal'|'unmanagedControlUnits'>){if(usage.unmanagedControlUnits)return 'NATIVE_RESEARCH_UNMANAGED_CONTROL_REQUIRES_ACCOUNTING';return usage.fatal?'NATIVE_RESEARCH_FLOW_FATAL:'+safe(Error(usage.fatal)):null;}
export async function settleNativeCandidateSources(feeds:Pick<PilotFeeds,'stop'|'usage'>|undefined,runner:Pick<NativeCandidateRunner,'stop'>|undefined,native:Pick<PilotNativeFlow,'usage'>|undefined,rpc:Pick<PilotRpc,'usage'|'close'>|undefined,reason:string){
 const results=await Promise.allSettled([feeds?.stop(),runner?.stop(reason)]),failures=results.flatMap(r=>r.status==='rejected'?[safe(r.reason)]:[]);
 let settled=results.every(r=>r.status==='fulfilled')&&!rpc?.usage().inFlight&&!rpc?.usage().waitingOrOperating&&(!native||native.usage().physicalTransportsSettled)&&(!feeds||feeds.usage().physicalTransportsSettled);
 if(settled)try{rpc?.close();}catch(error){settled=false;failures.push(safe(error));}
 if(!settled)failures.push('NATIVE_RESEARCH_PHYSICAL_SETTLEMENT_UNKNOWN');return {settled,failures};
}
export async function runNativeCandidates(args:{inputPath:string;directory:string;durationMs?:number;profile?:unknown;observationAgePolicy?:unknown;dataContract?:unknown}){
 need(process.getuid?.()!==0,'NATIVE_RESEARCH_NONROOT_REQUIRED');
 nativeCandidateRunSettings(args.durationMs,args.profile,args.observationAgePolicy,args.dataContract);
 const inputRaw=readFileSync(resolve(args.inputPath));need(inputRaw.length<=8*MIB,'NATIVE_RESEARCH_INPUT_SIZE');const input:unknown=JSON.parse(inputRaw.toString());validateNativeCandidateInput(input);
 need(args.observationAgePolicy===undefined||input.observationAgePolicy===undefined||args.observationAgePolicy===input.observationAgePolicy,'NATIVE_RESEARCH_OBSERVATION_POLICY_CONFLICT');
 need(args.dataContract===undefined||input.dataContract===undefined||args.dataContract===input.dataContract,'NATIVE_RESEARCH_DATA_CONTRACT_CONFLICT');
 const settings=nativeCandidateRunSettings(args.durationMs,args.profile,args.observationAgePolicy??input.observationAgePolicy,args.dataContract??input.dataContract),{profile,limits,duration,observationAgePolicy,dataContract}=settings;
 if(profile)need(input.baselinePaths.length<=profile.maximumBaselinePaths,'NATIVE_RESEARCH_BASELINE_COMPACTION_REQUIRED');
 const directory=resolve(args.directory),parent=lstatSync(dirname(directory));need(parent.isDirectory()&&!parent.isSymbolicLink()&&parent.uid===process.getuid?.()&&(parent.mode&0o077)===0&&realpathSync(dirname(directory))===dirname(directory)&&!existsSync(directory),'NATIVE_RESEARCH_PRIVATE_NEW_DIRECTORY_REQUIRED');
 if(profile){const disk=statfsSync(dirname(directory));need(disk.bavail*disk.bsize>=profile.startupDiskHeadroom,'NATIVE_RESEARCH_STARTUP_DISK_HEADROOM');}
 const globalLease=lease('/tmp/poe-public-component-20261027.lock'),watchLease=lease('/tmp/poe-pumpapi-probe.lock');
 mkdirSync(directory,{mode:0o700});const events=join(directory,'events');mkdirSync(events,{mode:0o700});const startedAt=Date.now(),startedMono=performance.now(),cpuStart=process.cpuUsage(),deadlineAt=startedAt+duration,admissionCutoffAt=deadlineAt-limits.shutdownReserveMs,runId='native-candidates-'+new Date(startedAt).toISOString().replace(/[^0-9]/g,'');
 let recorder:Recorder|null=null,segmentBytes=0,evidenceBytes=0,segments=0,reason='bounded interval completed',stopRequestedAt:number|null=null,lastSourceAt:number|null=null,maximumRss=0,busy=false,closed=false;
 let statusSnapshotsArchived=0,lastStatusSnapshotArchivedAt:number|null=null;
 let runner:NativeCandidateRunner|undefined,rpc:PilotRpc|undefined,feeds:PilotFeeds|undefined,native:PilotNativeFlow|undefined;
 const controller=new AbortController(),lag=monitorEventLoopDelay({resolution:20});lag.enable();
 const record=(kind:string,data:unknown)=>{const n=Buffer.byteLength(json({kind,data}))+200;need(n<=limits.evidenceSegmentBytes,'NATIVE_RESEARCH_EVIDENCE_RECORD_TOO_LARGE');need(evidenceBytes+n<=limits.retainedEvidenceBytes-MIB,'NATIVE_RESEARCH_EVIDENCE_CAP');if(!recorder||segmentBytes+n>limits.evidenceSegmentBytes){recorder?.close();recorder=new Recorder(join(events,'events-'+String(++segments).padStart(3,'0')+'.ndjson'),limits.evidenceSegmentBytes);segmentBytes=0;}recorder.record(kind,data);segmentBytes+=n;evidenceBytes+=n;if(kind==='native-flow-information-available')lastSourceAt=(data as {normalizedAt:number}).normalizedAt;};
 const admissionOpen=()=>!controller.signal.aborted&&Date.now()<admissionCutoffAt&&performance.now()-startedMono<duration-limits.shutdownReserveMs;
 const stop=(why:string)=>{if(stopRequestedAt!==null)return;reason=why;stopRequestedAt=Date.now();controller.abort();};
 const cutoffTimer=setTimeout(()=>stop('logical observation cutoff reached; shutdown reserve begins'),Math.max(1,admissionCutoffAt-Date.now()));
 const signalStop=()=>stop('signal requested; candidate observation interrupted');process.once('SIGTERM',signalStop);process.once('SIGINT',signalStop);
 const status=(running:boolean)=>{const engine=runner?.status(),feedUsage=feeds?.usage(),lagMs=lag.percentile(95)/1e6;return {schemaVersion:1,project:'Pump Opportunity Engine',experimental:true,authoritative:false,runId,accountId:input.reportingBinding?.accountId??null,inceptionAt:input.reportingBinding?.inceptionAt??null,accountBindingProvenance:input.reportingBinding?.sourceStatusSha256??null,mode:'candidate-evaluation',researchProfile:profile?.version??null,runtimeVersion:NATIVE_CANDIDATE_VERSION,source:input.source,strategyVersion:PROVISIONAL_RULE.version,configurationSha256:nativeCandidateConfigurationSha256(settings),startedAt,generatedAt:Date.now(),lastSourceAt,elapsedMs:Date.now()-startedAt,running,financialExecutionAuthorized:false,entriesEnabled:false,financialWriterOpened:false,liveTradingEnabled:false,productionUntouched:true,portfolio:null,experimentalFinancialPortfolio:null,financialMeaning:'Candidate-only native observation segment; financial ledger remains separate and unopened; no financial execution or invented balances.',stopReason:running?null:reason,logicalObservationCutoffAt:admissionCutoffAt,stopRequestedAt,limits:{...limits,durationMs:duration},statusArchive:{policy:profile?'first4full-then-hourly-plus-final':'every15s-plus-final',periodicFullSnapshotsRecorded:statusSnapshotsArchived,lastPeriodicFullSnapshotAt:lastStatusSnapshotArchivedAt,meaning:'Latest status file updates every15s; unarchived intermediate status objects are not claimed retained evidence.'},engine:engine??null,feeds:feedUsage??null,...nativeCandidateReportingProjection(engine,feedUsage,lagMs,running,reason),observationAgePolicy,dataContract,resources:{maximumRssBytes:maximumRss,cpu:process.cpuUsage(cpuStart),eventLoopDelayP95Ms:lagMs,eventLoopDelayMaximumMs:lag.max/1e6,retainedEvidenceBytes:evidenceBytes,evidenceSegments:segments},costs:{apiData:'public RPC/free discovery/data-only stream; no new API purchase',infrastructure:'existing compute and transfer allowance/cost unverified; not zero total cost'}};};
 try{
  record('native-research-frozen-input',{runId,startedAt,inputSha256:createHash('sha256').update(inputRaw).digest('hex'),source:input.source,strategy:PROVISIONAL_RULE,limits,durationMs:duration,observationAgePolicy,dataContract,configurationSha256:nativeCandidateConfigurationSha256(settings),financialWriterOpened:false});
  rpc=new PilotRpc({directory:join(directory,'rpc'),runId,baselinePaths:input.baselinePaths,priorPhysicalSettled:true,priorCooldownUntil:input.priorCooldownUntil,durationMs:duration,maxUnits:limits.maximumUnits,maxResponseBytes:limits.relatedResponseBytes,...(profile?{maxChapters:profile.maximumChapters}:{}),maxStartsPerMinute:profile?.physical.startsPerMinute??60,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,profile:profile?.version??'candidate-native-research-v1',record});
  const support=new ResearchClockPositionPricer(rpc,{record});
  native=new PilotNativeFlow({dataContract,control:rpc,support,record,maximumCandidates:limits.maximumDeep,durationMs:duration,maximumReceivedBytes:limits.nativeSocketBytes,maximumRecordedBytes:profile?.nativeRecordedBytes??112*MIB,...(profile?{profile:profile.version}:{}),maximumCpuMicros:limits.maximumCpuMicros,maximumRssBytes:limits.maximumRssBytes,informationAdmissionOpen:admissionOpen,onFlowOpen:r=>runner?.onFlowOpen(r),onTrade:r=>runner?.onTrade(),onGap:r=>runner?.onGap(r),onActivity:r=>runner?.onActivity(r)});
  runner=new NativeCandidateRunner({observationAgePolicy:observationAgePolicy.version,rpc,flow:native,record,maximumDeep:limits.maximumDeep,admissionOpen,restoredWatch:input.watchCheckpoint});for(const origin of input.origins)runner.importOrigin(origin);
  feeds=new PilotFeeds({control:rpc,amountConvention:'curve',durationMs:duration,maximumCandidates:limits.maximumDeep,maxPumpApiBytes:limits.broadWatchBytes,maxDiscoveryBytes:limits.discoveryBytes,maximumRecordedBytes:profile?.feedRecordedBytes??8*MIB,...(profile?{profile:profile.version}:{}),record,onMigration:seed=>runner?.onMigration(seed),watchedIdentities:()=>runner!.watch.listIdentities().flatMap(r=>r.mint&&r.pool?[{mint:r.mint,pool:r.pool}]:[]),onWatchActivity:r=>runner?.onActivity({mint:r.mint,at:r.receivedAt,evidence:r.evidence}),onTrade:()=>{throw Error('NATIVE_RESEARCH_LEGACY_DEEP_TRADE_FORBIDDEN');},onGap:r=>record('native-watch-feed-unavailable',{...r,selectedNativeFlowUnaffected:true}),admitControl:()=>nativeCandidateWatchControlRequest(()=>({busy,admissionOpen:admissionOpen(),flow:native?.usage(),at:Date.now()}),admissionCutoffAt)});
  await feeds.startDiscovery(controller.signal);await feeds.startWatchActivity(controller.signal);
  let nextStatusAt=0;
  while(admissionOpen()){
   maximumRss=Math.max(maximumRss,process.memoryUsage().rss);const cpu=process.cpuUsage(cpuStart);if(maximumRss>limits.maximumRssBytes||cpu.user+cpu.system>limits.maximumCpuMicros){stop('NATIVE_RESEARCH_RESOURCE_CAP');break;}
   if(statfsSync(directory).bavail*statfsSync(directory).bsize<limits.minimumDiskHeadroom){stop('NATIVE_RESEARCH_STORAGE_HEADROOM');break;}
   if(evidenceBytes>=limits.retainedEvidenceBytes-2*MIB){stop('NATIVE_RESEARCH_EVIDENCE_SOFT_STOP');break;}
   const sourceStopReason=nativeCandidateDataStopReason(native.usage());if(sourceStopReason){record('native-candidate-source-stop',{at:Date.now(),reason:sourceStopReason,scope:'candidate-only process; no financial writer or position manager exists here'});stop(sourceStopReason);break;}
   if(!rpc.available()&&rpc.usage().fatal){stop('NATIVE_RESEARCH_RPC_FATAL');break;}
   busy=true;try{await runner.step(controller.signal);}finally{busy=false;}
   if(Date.now()>=nextStatusAt){const sourceStatus=status(true),archive=nativeStatusArchiveEligible(profile!==null,statusSnapshotsArchived,lastStatusSnapshotArchivedAt,sourceStatus.generatedAt);writeNativeSourceStatusSnapshot(sourceStatus,value=>atomic(join(directory,'status.json'),value),archive?record:undefined);if(archive){statusSnapshotsArchived++;lastStatusSnapshotArchivedAt=sourceStatus.generatedAt;}atomic(join(directory,'watch-checkpoint.json'),runner.checkpoint());nextStatusAt=sourceStatus.generatedAt+15000;}
   if(existsSync(join(directory,'stop-request.json'))){stop('file requested; candidate observation interrupted');break;}
   await new Promise<void>(r=>setTimeout(r,50));
  }
 }catch(error){reason=safe(error);stop(reason);try{record('native-research-failure',{at:Date.now(),reason,financialWriterOpened:false});}catch{}}
 finally{
  stopRequestedAt??=Date.now();
  const cleanup=await settleNativeCandidateSources(feeds,runner,native,rpc,reason);closed=cleanup.settled;if(cleanup.failures.length)reason=cleanup.failures[0]!;
  const final=boundedNativeFinalStatus({...status(false),physicalSettlementConfirmed:closed,transportSettledAt:closed?Date.now():null,appendOnlyCounterPaths:rpc?.usage().chapterPaths??[],unmanagedControlUnits:native?.usage().unmanagedControlUnits??0});
  try{atomic(join(directory,'status.json'),final);atomic(join(directory,'receipt.json'),final);if(runner)atomic(join(directory,'watch-checkpoint.json'),runner.checkpoint());
   for(const kind of ['native-research-final','native-source-status-snapshot']){const bytes=Buffer.byteLength(json({kind,data:final}))+200;if(evidenceBytes+bytes<=limits.retainedEvidenceBytes-MIB)record(kind,final);else{const unavailable={at:final.generatedAt,kind,reason:'bounded final evidence reserve unavailable; exact final status/receipt preserved',sourceStatusSha256:createHash('sha256').update(json(final)+'\n').digest('hex')};const small=Buffer.byteLength(json({kind:'native-final-status-recording-unavailable',data:unavailable}))+200;if(evidenceBytes+small<=limits.retainedEvidenceBytes-MIB)record('native-final-status-recording-unavailable',unavailable);}}
  }finally{clearTimeout(cutoffTimer);lag.disable();(recorder as Recorder|null)?.close();if(closed){closeSync(watchLease);closeSync(globalLease);}process.off('SIGTERM',signalStop);process.off('SIGINT',signalStop);}
 }
 return {directory,runId,reason,physicalSettlementConfirmed:closed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1];need(args.includes('--run')&&args.includes('--input')&&args.includes('--directory'),'NATIVE_RESEARCH_EXPLICIT_RUN_REQUIRED');const seconds=args.includes('--duration-seconds')?Number(value('--duration-seconds')):undefined;runNativeCandidates({inputPath:value('--input')!,directory:value('--directory')!,...(seconds===undefined?{}:{durationMs:seconds*1000}),...(args.includes('--profile')?{profile:value('--profile')}:{}),...(args.includes('--observation-age-policy')?{observationAgePolicy:value('--observation-age-policy')}:{}),...(args.includes('--data-contract')?{dataContract:value('--data-contract')}:{})}).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(safe(error)+'\n');process.exitCode=1;});}
