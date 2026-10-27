/** Isolated continuous live-market PAPER pilot. Never a production entrypoint. */
import {appendFileSync,closeSync,constants,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,statfsSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {PaperLedger,type UsdPrice} from './ledger.js';
import {PaperTrader} from './trader.js';
import {PilotMarket} from './pilot-market.js';
import {SelectionRejections} from './selection-rejections.js';
import {readResearchBaseline} from './research-baseline.js';
import {PilotRpc} from './pilot-rpc.js';
import {PilotFeeds} from './pilot-feeds.js';
import {PILOT_CONTRACT,PILOT_CONTRACT_SHA256,PILOT_VERSION} from './pilot-contract.js';
import {fetchPublicUsdPrice} from './valuation.js';
import {FinancialBackupStore} from './backup.js';
import type {ExecutionContext} from './execution.js';
import type {MigrationIdentity} from './migration-identity.js';
import {mapConfirmedPumpSwapEvidence} from './pumpapi-mapping.js';
import {resolvePilotMigration} from './pilot-discovery.js';

const MIB=1024*1024;
export const PILOT_FLOW_EVIDENCE='pilot-confirmed-curve-v1:'+PILOT_CONTRACT_SHA256;
export const PILOT_TIMING=Object.freeze({targetMs:2000,experimentalCompletedEvaluationLimitMs:4000,maximumQuoteAgeAtUseMs:2000,maximumSourceAgeMs:30000,enrichmentDeadlineMs:5000,candidateLifetimeMs:180000,minimumRemainingManagementMs:910000,minimumRemainingUnits:490,minimumRemainingResponseBytes:6*MIB,meaning:'Research operating boundary, not an approved production protection tolerance or a guaranteed stop price.'});
type Proof={identity:MigrationIdentity;evidence:string};
type Manifest={schemaVersion:1;experimental:true;authoritative:false;accountId:string;inceptionAt:number;contractSha256:string;baselinePaths:string[];cooldownUntil:number;controlCooldownUntil?:number;pools:Record<string,Proof>;runs:string[];unresolvedResearch?:{runId:string;rpcDirectory:string;pid:number}};
type Seed={signature:string;feedMint?:string;receivedAt:number;eligibleAfter?:number;finalityDeferrals?:number};
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const safe=(e:unknown)=>e instanceof Error&&/^[A-Za-z0-9 _;:.,/-]{1,180}$/.test(e.message)?e.message:'PILOT_OPERATION_UNAVAILABLE';
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function atomic(path:string,value:unknown){const body=JSON.stringify(value,null,2)+'\n';need(Buffer.byteLength(body)<=2*MIB,'PILOT_STATUS_SIZE');const fd=openSync(path+'.pending',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,body);fsyncSync(fd);}finally{closeSync(fd);}renameSync(path+'.pending',path);const parent=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}
function privateDir(path:string){if(!existsSync(path))mkdirSync(path,{mode:0o700});const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o077)===0&&realpathSync(path)===path,'PILOT_PRIVATE_DIRECTORY_REQUIRED');}
export function assertPilotDirectory(path:string){need(process.getuid?.()!==0&&path.startsWith('/workspace/')&&!path.startsWith('/workspace/shared/')&&!path.includes('pump-opportunity-engine/')&&path!=='/workspace/poe-secrets','PILOT_ISOLATED_NONROOT_WORKSPACE_REQUIRED');privateDir(path);}
function lease(path:string){const fd=openSync(path,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);const s=fstatSync(fd);need(s.isFile()&&s.uid===process.getuid?.()&&s.nlink===1&&(s.mode&0o077)===0,'PILOT_UNSAFE_LEASE');const r=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000});if(r.status!==0){closeSync(fd);throw Error('PILOT_RESEARCH_ALREADY_RUNNING');}return fd;}
function sourceIdentity(){const files=readdirSync(resolve('src')).filter(f=>f.endsWith('.ts')).sort().concat(['../package.json','../package-lock.json']);const hashes=Object.fromEntries(files.map(p=>[p,hash(readFileSync(join('src',p),'utf8'))]));return {commit:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),sha256:hash(hashes),hashes};}
function initialBaseline(){const p='evidence/standing-research-20261027/08-current-combined';return [...JSON.parse(readFileSync(p+'/baseline.json','utf8')).baselinePaths,resolve(p+'/rpc-budget.json')] as string[];}
function initialManifest(accountId:string,price:UsdPrice,at:number):Manifest{return {schemaVersion:1,experimental:true,authoritative:false,accountId,inceptionAt:at,contractSha256:PILOT_CONTRACT_SHA256,baselinePaths:initialBaseline(),cooldownUntil:1793121390670,pools:{},runs:[]};}


export function validatePilotHistory(rows:Array<{signature:string;slot:number;err:unknown;blockTime:number|null;confirmationStatus?:string}>,known:ReadonlyMap<string,{slot:number;chainBlockTime:number|null}>,start:number,end:number){
  need(Array.isArray(rows)&&rows.length<=100&&start<=end,'PILOT_HISTORY_ENVELOPE');const signatures=new Map<string,typeof rows[number]>();let prior=Infinity;
  for(const row of rows){need(row&&typeof row.signature==='string'&&row.signature.length<=100&&Number.isSafeInteger(row.slot)&&row.slot>=0&&row.slot<=prior&&Number.isSafeInteger(row.blockTime)&&Number(row.blockTime)>0&&Object.hasOwn(row,'err')&&(row.err===null||typeof row.err==='object'&&row.err!==null)&&['confirmed','finalized'].includes(row.confirmationStatus??'')&&!signatures.has(row.signature),'PILOT_HISTORY_INVALID_OR_DUPLICATE');prior=row.slot;signatures.set(row.signature,row);}
  for(const [signature,trade]of known){need(trade.chainBlockTime!==null,'PILOT_KNOWN_TRADE_CHAIN_TIME_UNKNOWN');if(trade.chainBlockTime*1000>=start&&trade.chainBlockTime*1000<end){const row=signatures.get(signature);need(row&&row.err===null&&row.slot===trade.slot&&row.blockTime===trade.chainBlockTime,'PILOT_HISTORY_OMITTED_OR_CHANGED_KNOWN_TRADE');}}
  return rows.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime*1000>=start&&r.blockTime*1000<end&&!known.has(r.signature));
}


export function nextPreparedPilotSeed(proofs:Record<string,Proof>,tested:ReadonlySet<string>,now:number):Seed|null {
  const ready=Object.values(proofs).filter(p=>!tested.has(p.identity.baseMint)&&now-p.identity.chainBlockTime*1000>=240000&&now-p.identity.chainBlockTime*1000<=7200000).sort((a,b)=>a.identity.chainBlockTime-b.identity.chainBlockTime)[0];
  return ready?{signature:ready.identity.signature,feedMint:ready.identity.baseMint,receivedAt:now-35000}:null;
}


/** Capacity-only warm-up barrier; it does not exclude a predictive opportunity. */
export function pilotObservationReadyAt(starts:readonly number[],now:number,shortLimit=20){
  need(Number.isSafeInteger(now)&&starts.every((t,i)=>Number.isSafeInteger(t)&&t<=now&&(i===0||t>=starts[i-1]!))&&shortLimit>=15&&shortLimit<=20,'PILOT_HEADROOM_INPUT');
  const ready=(span:number,cap:number,reserve:number)=>{const recent=starts.filter(t=>t>now-span),allowed=cap-reserve;return recent.length<=allowed?now:recent[recent.length-allowed-1]!+span;};
  return Math.max(now,ready(10000,shortLimit,15),ready(60000,60,20));
}

export async function runPilot(directory:string,durationMs:number,resumeOnly=false){
  assertPilotDirectory(directory);need(Number.isSafeInteger(durationMs)&&durationMs>=60000&&durationMs<=1800000,'PILOT_DURATION_BOUND');
  const globalLease=lease('/tmp/poe-public-component-20261027.lock'),pumpLease=lease('/tmp/poe-pumpapi-probe.lock');
  const manifestPath=join(directory,'pilot.json'),dbPath=join(directory,'ledger.sqlite'),stopPath=join(directory,'stop.request');
  let guard:SelectionRejections|undefined;
  let ledger:PaperLedger|undefined,rpc:PilotRpc|undefined,feeds:PilotFeeds|undefined,backup:FinancialBackupStore|undefined,manifest:Manifest|undefined;
  const startedAt=Date.now(),startedMono=performance.now(),endAt=startedAt+durationMs,source=sourceIdentity(),runId='pilot-'+new Date(startedAt).toISOString().replace(/[^0-9]/g,'')+'-'+randomUUID().slice(0,8),runDir=join(directory,'runs',runId);
  privateDir(join(directory,'runs'));privateDir(runDir);
  let emergencyStatus:(()=>void)|null=null,completed=false;
  const eventPath=join(runDir,'events.ndjson');let eventBytes=0,stopping=false,stopReason='finite research interval ended',busy=false,resourceFailure:string|null=null;
  const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,recordedAt:Date.now(),elapsedMonoMs:performance.now()-startedMono,data})+'\n';need(eventBytes+Buffer.byteLength(line)<=14*MIB,'PILOT_EVIDENCE_CAP');appendFileSync(eventPath,line,{mode:0o600});eventBytes+=Buffer.byteLength(line);};
  const signalStop=()=>{stopping=true;stopReason='graceful signal stop; exposure retained';};process.once('SIGTERM',signalStop);process.once('SIGINT',signalStop);
  const lag=monitorEventLoopDelay({resolution:20});lag.enable();const cpuStart=process.cpuUsage();let maximumRss=0,lastPriceAttempt=0,lastReport=0,lastTick=0,lastSourceCheck=0,lastBackup=0,backupTask:Promise<unknown>|null=null;
  let usdRequests=0,usdFailures=0;
  const refreshUsd=async()=>{usdRequests++;try{return await fetchPublicUsdPrice();}catch(e){usdFailures++;throw e;}};
  let price:UsdPrice|null=null,context:ExecutionContext={price:null,marks:{}},lastUsable:number|null=null,lastContextRequested=0,maxGap=0,maxQuoteAge=0,protectionBreaches=0,unavailableChecks=0;
  const evaluationGaps:number[]=[],enrichmentDelays:number[]=[],seeds:Seed[]=[],seenSeeds=new Set<string>(),refusals:Record<string,number>={},testedMints=new Set<string>();
  let candidate:{proof:Proof;startedAt:number;flowAt:number|null;auditedThrough:number;lastAuditAt:number;knownSignatures:Map<string,{slot:number;chainBlockTime:number|null}>}|null=null;
  let discoveries=0,verifiedOrigins=0,admitted=0,usableWindows=0,lastWindow=0,naturalEntries=0,naturalExits=0,formerPositions=0,entryEnabledAt:number|null=null;
  const reject=(reason:string,details:unknown)=>{refusals[reason]=(refusals[reason]??0)+1;record('pilot-refusal',{reason,details});};
  const persist=()=>{if(manifest)atomic(manifestPath,manifest);};
  try{
    need(statfsSync(directory).bavail*statfsSync(directory).bsize>=256*MIB,'PILOT_DISK_HEADROOM');
    if(existsSync(manifestPath)){
      manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as Manifest;need(manifest.schemaVersion===1&&manifest.experimental===true&&manifest.authoritative===false&&/^poe-pilot-[a-z0-9-]+$/.test(manifest.accountId)&&manifest.contractSha256===PILOT_CONTRACT_SHA256&&existsSync(dbPath),'PILOT_IDENTITY_OR_RECOVERY_REQUIRED');
      ledger=new PaperLedger(dbPath,manifest.accountId,'PAPER');need(ledger.state().inceptionAt===manifest.inceptionAt,'PILOT_INCEPTION_MISMATCH');
    }else{
      need(!resumeOnly&&!existsSync(dbPath),'PILOT_NEVER_RESEED_EXISTING_OR_MISSING_ACCOUNT');
      price=await refreshUsd();lastPriceAttempt=Date.now();const at=Date.now(),accountId='poe-pilot-'+randomUUID();
      ledger=new PaperLedger(dbPath,accountId,'PAPER');ledger.initialize(price,at);manifest=initialManifest(accountId,price,at);persist();
    }
    if(manifest.unresolvedResearch){const prior=manifest.unresolvedResearch;need(prior.pid!==process.pid&&prior.rpcDirectory===join(directory,'runs',prior.runId,'rpc')&&manifest.runs.includes(prior.runId),'PILOT_RECOVERY_BINDING');let alive=false;try{process.kill(prior.pid,0);alive=true;}catch(e){need((e as NodeJS.ErrnoException).code==='ESRCH','PILOT_PRIOR_PROCESS_STATE_UNKNOWN');}need(!alive,'PILOT_PRIOR_PROCESS_STILL_ALIVE');const paths=existsSync(prior.rpcDirectory)?readdirSync(prior.rpcDirectory).filter(f=>/^chapter-\d{3}\.json$/.test(f)).sort().map(f=>join(prior.rpcDirectory,f)):[];const linked=[...manifest.baselinePaths,...paths.filter(p=>!manifest!.baselinePaths.includes(p))];readResearchBaseline({paths:linked,now:Date.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:128});manifest.baselinePaths=linked;if(existsSync(join(prior.rpcDirectory,'status.json'))){const priorStatus=JSON.parse(readFileSync(join(prior.rpcDirectory,'status.json'),'utf8'));manifest.cooldownUntil=Math.max(manifest.cooldownUntil,priorStatus.cooldownUntil??0);manifest.controlCooldownUntil=Math.max(manifest.controlCooldownUntil??0,priorStatus.controlCooldownUntil??0);}record('pilot-crash-research-reconciliation',{prior,allObservedChapterPathsRetained:paths,uncertainReservationsRetained:true,oldProcessVerifiedAbsent:true,globalAndFinancialOwnershipEstablished:true});delete manifest.unresolvedResearch;persist();}
    manifest.runs.push(runId);need(manifest.runs.length<=64,'PILOT_RUN_RETENTION_REVIEW_REQUIRED');manifest.unresolvedResearch={runId,rpcDirectory:join(runDir,'rpc'),pid:process.pid};persist();
    if(existsSync(stopPath))unlinkSync(stopPath);
    const currentLedger=ledger;guard=new SelectionRejections({path:join(directory,'selection-rejections.json'),policyVersion:'pilot-supported-clock-confirmed-curve-v1'});
    rpc=new PilotRpc({directory:join(runDir,'rpc'),runId,baselinePaths:manifest.baselinePaths,priorPhysicalSettled:true,priorCooldownUntil:manifest.cooldownUntil,durationMs,maxUnits:1500,maxResponseBytes:32*MIB,maxStartsPer10s:20,record});const currentRpc=rpc;
    const market=new PilotMarket({rpc,inventory:()=>currentLedger.state(),price:()=>price,recorder:{record},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'Frozen pilot: simulated base5000 + priority2000 lamports per attempt; actual pool fees embedded in SDK quotes.'}});
    for(const proof of Object.values(manifest.pools).filter(p=>currentLedger.state().positions[p.identity.baseMint]))market.registerPool({mint:proof.identity.baseMint,migrationSlot:proof.identity.slot,migrationVerified:true,evidence:proof.evidence});
    for(const mint of Object.keys(ledger.state().positions))need(manifest.pools[mint],'PILOT_HELD_POOL_PROOF_MISSING');
    const getContext=async(positions:Parameters<PilotMarket['context']>[0],signal:AbortSignal)=>{lastContextRequested=Date.now();const c=await market.context(positions,signal),at=Date.now();context=c;
      if(Object.keys(positions).length){const valid=Object.values(positions).every(p=>{const m=c.marks[p.mint];if(!m||m.pricedBaseUnits!==p.units||m.at>at||at-m.at>2000)return false;maxQuoteAge=Math.max(maxQuoteAge,at-m.at);return true;});
        if(valid){const gap=lastUsable===null?null:at-lastUsable;if(gap!==null){evaluationGaps.push(gap);maxGap=Math.max(maxGap,gap);if(gap>PILOT_TIMING.experimentalCompletedEvaluationLimitMs){protectionBreaches++;trader.feedGap();record('pilot-protection-breach',{gapMs:gap,at,classification:'experimental boundary exceeded; no equivalent-protection claim'});}}lastUsable=at;}else{unavailableChecks++;trader.pauseNewEntries('holding valuation unavailable; exposure retained');}}
      return c;};
    const trader=new PaperTrader({ledger,context:getContext,quote:market.quote,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'Frozen experimental pilot contract '+PILOT_CONTRACT_SHA256},recorder:{record},flowVerification:{verified:true,evidence:PILOT_FLOW_EVIDENCE},deferPredictivelyRejectedQuotes:true,experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},pilotExecution:{context:async(positions,signal)=>{const c=await getContext(positions,signal);if(c.price){const at=Date.now();currentLedger.reconcile('pilot-execution-context:'+currentLedger.state().revision+':'+at,at,c.price,c.marks);record('pilot-execution-fresh-reconciliation',{at,sourcePriceAt:c.price.at,heldMarks:c.marks});}return c;},quote:market.executionQuote},timeoutMs:3000});
    trader.start();formerPositions=Object.keys(ledger.state().positions).length;
    const controlAvailable=()=>Date.now()>=Math.max(manifest!.controlCooldownUntil??0,currentRpc.usage().controlCooldownUntil)&&!busy&&!stopping&&currentRpc.available()&&!(trader.nextDueAt()!==null&&trader.nextDueAt()!<=Date.now()+1500)&&(!Object.keys(currentLedger.state().positions).length||Date.now()-lastContextRequested<300);
    feeds=new PilotFeeds({control:rpc,amountConvention:'curve',durationMs,maxPumpApiBytes:1024*MIB,maxDiscoveryBytes:5*MIB,record,admitControl:()=>controlAvailable()?{latestStartAt:Math.min(endAt-5000,Date.now()+1200)}:false,
      onMigration:seed=>{discoveries++;if(seenSeeds.has(seed.signature))return;seenSeeds.add(seed.signature);if(seenSeeds.size>512)seenSeeds.delete(seenSeeds.values().next().value!);if(seeds.length>=16){reject('discovery-capacity',{signature:seed.signature});return;}seeds.push(seed);},
      onFlowOpen:(mint,at)=>{if(candidate&&candidate.proof.identity.baseMint===mint){candidate.flowAt=at;candidate.auditedThrough=at;trader.activateFlow(mint,'actual PumpApi socket open '+at);}},
      onHint:(_mint,at)=>{const st=currentLedger.state();if(st.controls.entriesEnabled&&!Object.values(st.pending).some(o=>o.side==='buy'))currentLedger.pause('pilot-information-pending:'+st.revision+':'+at,at,'selected enrichment pending; no new decision from incomplete evidence');},
      onTrade:row=>{trader.ingest(row.trade,'curve');market.minimumSlot(row.trade.mint,row.trade.slot!);enrichmentDelays.push(row.validatedAt-row.evidence.providerReceivedAt!);candidate?.knownSignatures.set(row.trade.identity.signature,{slot:row.evidence.slot,chainBlockTime:row.evidence.chainBlockTime});},
      onGap:gap=>{record('pilot-observation-gap',gap);if(gap.mint){trader.feedGap();}else reject('discovery-unavailable',gap);}});
    const currentFeeds=feeds;
    backup=new FinancialBackupStore({directory:join(directory,'backups'),sourcePath:dbPath,identity:{accountId:manifest.accountId,mode:'PAPER',inceptionAt:manifest.inceptionAt},maxBytes:16*MIB});
    const startBackup=()=>{if(backupTask)return;lastBackup=Date.now();backupTask=backup!.create(currentLedger).then(v=>record('pilot-consistent-backup',{...v,financialAuthority:'isolated pilot only'})).catch(e=>{reject('backup-unavailable',safe(e));trader.pauseNewEntries('consistent pilot backup unavailable');}).finally(()=>{backupTask=null;});};
    record('pilot-run-start',{runId,accountId:manifest.accountId,inceptionAt:manifest.inceptionAt,experimental:true,authoritative:false,source,contract:PILOT_CONTRACT,contractSha256:PILOT_CONTRACT_SHA256,timing:PILOT_TIMING,limits:{durationMs,requestUnits:1500,maximumStartsPer10s:20,startsPerMinute:60,spacingMs:250,physicalInFlight:1,relatedResponseBytes:32*MIB,pumpApiBytes:1024*MIB,discoveryBytes:5*MIB,eventBytes:14*MIB,rssBytes:384*MIB,cpuMicroseconds:240000000},productionTouched:false,renderPublishing:false,liveTradingEnabled:false});
    startBackup();await feeds.startDiscovery().catch(e=>reject('discovery-start-unavailable',safe(e)));
    const report=(final=false)=>{const at=Date.now(),p=ledger!.projection(at,price??undefined,context.marks),u=currentFeeds.usage(),r=currentRpc.usage(),state=ledger!.state();
      const snapshot={project:'Pump Opportunity Engine',experimental:true,authoritative:false,runId,accountId:manifest!.accountId,inceptionAt:manifest!.inceptionAt,generatedAt:at,startedAt,elapsedMs:at-startedAt,running:!final,source:{commit:source.commit,sha256:source.sha256},strategyVersion:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,entriesEnabled:p.entriesEnabled,entryEnabledAt,liveTradingEnabled:false,productionUntouched:true,renderPublishing:false,financial:p,positions:state.positions,pending:state.pending,journal:ledger!.exportJournal(50),naturalForward:{entries:naturalEntries,exits:naturalExits},funnel:{...trader.funnel,discovered:discoveries,verifiedMigrationOrigins:verifiedOrigins,admitted,usableWindows},refusals,candidate:candidate?{mint:candidate.proof.identity.baseMint,pool:candidate.proof.identity.pool,migrationAt:candidate.proof.identity.chainBlockTime*1000,flowAt:candidate.flowAt,snapshot:currentFeeds.snapshot()}:null,decisions:trader.decisions(),timing:{...PILOT_TIMING,maximumCompletedGapMs:maxGap,completedEvaluationGaps:evaluationGaps.slice(-256),maximumQuoteAgeAtUseMs:maxQuoteAge,protectionBreaches,unavailableChecks,enrichmentDelayMs:{count:enrichmentDelays.length,maximum:enrichmentDelays.length?Math.max(...enrichmentDelays):null}},usage:{rpc:r,feeds:u,eventBytes,maximumRss,cpu:process.cpuUsage(cpuStart),eventLoopDelayP95Ms:lag.percentile(95)/1e6},usdValuation:{requests:usdRequests,failures:usdFailures,maximumResponseBytesPerRequest:2048,actualBytes:'not separately metered; bounded by helper',endpoint:'Coinbase public SOL-USD spot'},costs:{apiData:'$0 additional API fees; public endpoints only',infrastructure:'existing Cloud/transfer allocation unverified; not zero total operating cost',simulatedExecutionLamports:state.executionCosts},status:final?stopReason:p.entriesEnabled?'experimental entries enabled':state.controls.reason,resourceFailure};
      atomic(join(directory,'status.json'),snapshot);if(final)atomic(join(runDir,'result.json'),snapshot);lastReport=at;return snapshot;};
    emergencyStatus=()=>{report(true);};
    const retire=async(reason:string)=>{if(!candidate)return;const mint=candidate.proof.identity.baseMint;if(reason==='independent audit denominator unavailable')guard!.reject({mint,pool:candidate.proof.identity.pool},'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN',join('runs',runId,'events.ndjson'));testedMints.add(mint);await currentFeeds.clearCandidate(reason);if(!currentLedger.state().positions[mint]&&!Object.values(currentLedger.state().pending).some(o=>o.mint===mint))trader.remove(mint);candidate=null;trader.pauseNewEntries(reason);};
    while(!stopping&&Date.now()<endAt-5000&&performance.now()-startedMono<durationMs-5000){
      const now=Date.now(),state=ledger.state(),held=Object.keys(state.positions).length,pending=Object.values(state.pending),u=rpc.usage();maximumRss=Math.max(maximumRss,process.memoryUsage().rss);
      if(existsSync(stopPath)){stopping=true;stopReason='graceful local stop request; exposure retained';break;}
      if(maximumRss>384*MIB||process.cpuUsage(cpuStart).user+process.cpuUsage(cpuStart).system>240000000||eventBytes>13*MIB||statfsSync(directory).bavail*statfsSync(directory).bsize<128*MIB){resourceFailure='bounded resource reserve reached';stopReason=resourceFailure;break;}
      if(now-lastSourceCheck>=10000){lastSourceCheck=now;if(sourceIdentity().sha256!==source.sha256){stopReason='source changed; interval closed and exposure checkpointed';break;}}
      if(now-lastPriceAttempt>=5000){lastPriceAttempt=now;void refreshUsd().then(v=>{price=v;}).catch(()=>{price=null;});}
      const hasPrice=!!price&&price.at<=now&&now-price.at<=10000;
      const capacity=endAt-now>=PILOT_TIMING.minimumRemainingManagementMs&&u.maximumNewUnits-u.newUnits>=PILOT_TIMING.minimumRemainingUnits&&u.maximumNewResponseBytes-u.newAccountedResponseBytes>=PILOT_TIMING.minimumRemainingResponseBytes&&rpc.available()&&feeds.usage().pumpApiSocketBytes<1020*MIB;
      if(!capacity||!hasPrice){if(state.controls.entriesEnabled)trader.pauseNewEntries(!hasPrice?'fresh USD conversion unavailable':'remaining monitoring reserve insufficient for new risk');}
      if(now-lastReport>=5000)report();if(now-lastBackup>=300000)startBackup();
      const blocked=new Set(testedMints);for(const proof of Object.values(manifest.pools))if(guard.lookup({mint:proof.identity.baseMint,pool:proof.identity.pool},now).blocked)blocked.add(proof.identity.baseMint);const preparedSeed=nextPreparedPilotSeed(manifest.pools,blocked,now);
      const due=trader.nextDueAt();
      if((due!==null&&due<=now)||(held&&now-lastContextRequested>=2000)){
        busy=true;try{await trader.tick();}catch(e){reject('holding-or-action-unavailable',safe(e));trader.pauseNewEntries('financial/protection work unavailable; positions and pending actions retained');}finally{busy=false;lastTick=Date.now();}
        const count=Object.keys(ledger.state().positions).length;if(count>formerPositions)naturalEntries+=count-formerPositions;if(count<formerPositions)naturalExits+=formerPositions-count;formerPositions=count;
        if(count&&candidate&&!Object.values(ledger.state().pending).some(o=>o.side==='buy'))await retire('held-position monitoring has priority; no held-token trade enrichment required');continue;
      }
      if(due!==null&&due>now&&due-now<=1500){await sleep(50);continue;}
      if(candidate){
        const s=feeds.snapshot();if(s?.failedCandidate||now-candidate.startedAt>=180000||held){await retire(s?.failedCandidate?'candidate information lost; fresh candidate required':'candidate observation allocation ended');continue;}
        const hint=feeds.peekHint();if(hint?.eligible&&rpc.available()){
          busy=true;try{await feeds.enrichNext(rpc,undefined,{latestStartAt:hint.deadlineAt-1200,timeoutMs:1000});}catch(e){reject('candidate-enrichment-unavailable',safe(e));trader.feedGap();}finally{busy=false;}continue;
        }
        // A bounded negative/positive coverage check cannot repair missed flow.
        // Information obtained here becomes available now, never at feed receipt.
        if(candidate.flowAt!==null&&now>=Math.floor(now/10000)*10000+5000&&!hint&&Math.floor(now/10000)*10000>candidate.auditedThrough&&now-candidate.lastAuditAt>=5000&&rpc.available()){
          candidate.lastAuditAt=now;busy=true;try{const rows=await rpc.call<Array<{signature:string;slot:number;err:unknown;blockTime:number|null;confirmationStatus?:string}>>('getSignaturesForAddress',[candidate.proof.identity.pool,{limit:100,commitment:'confirmed'}]);const end=Math.floor((Date.now()-5000)/10000)*10000,start=Math.max(candidate.flowAt,candidate.auditedThrough),missing=validatePilotHistory(rows,candidate.knownSignatures,start,end);
            if(rows.length===100&&rows.at(-1)?.blockTime!==null&&Number(rows.at(-1)?.blockTime)*1000>start||missing.length>2){reject('independent-audit-capacity',{missing:missing.length,start,end});trader.feedGap();await retire('independent audit denominator unavailable');}
            else{for(const row of missing){const tx=await rpc.call<any>('getTransaction',[row.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}]);record('pilot-independent-missing-signature-audit',{signature:row.signature,availableAt:Date.now(),transaction:tx});const matched=mapConfirmedPumpSwapEvidence(tx,{signature:row.signature,mint:candidate.proof.identity.baseMint,pool:candidate.proof.identity.pool,providerReceivedAt:null,availableAt:Date.now()});if(matched.length){reject('unobserved-pool-trade',{signature:row.signature,swaps:matched.length});trader.feedGap();await retire('independent audit found unobserved successful pool trade');break;}}
              if(candidate){candidate.auditedThrough=end;record('pilot-independent-history-audit',{start,end,rows:rows.length,missing:missing.length,classification:'bounded confirmed pool-signature sample; receive-time completeness and pending finality remain limited'});}}
          }catch(e){reject('independent-audit-unavailable',safe(e));trader.feedGap();await retire('independent history verification unavailable');}finally{busy=false;}continue;
        }
        const windowReady=s?.warm===true&&s.fullyEnriched&&!s.hasQualityLoss&&candidate.flowAt!==null&&candidate.auditedThrough>=(s.windowEndAt??Infinity)&&feeds.usage().pumpApiConnected;
        if(windowReady&&s.windowEndAt!==null&&s.windowEndAt!==lastWindow){lastWindow=s.windowEndAt;usableWindows++;}
        if(s?.warm&&!windowReady&&ledger.state().controls.entriesEnabled&&!Object.values(ledger.state().pending).some(o=>o.side==='buy'))ledger.pause('pilot-audit-pending:'+ledger.state().revision+':'+now,now,'new closed window awaits bounded independent history verification');
        if(!hint&&(!s?.warm||windowReady)&&now-lastTick>=500&&rpc.available()){
          busy=true;try{if(windowReady&&capacity&&hasPrice&&!Object.values(state.pending).length&&!held){const at=Date.now();ledger.reconcile('pilot-ready-reconcile:'+state.revision+':'+at,at,price!,{});const traffic=feeds.usage().lastAnyTrafficAt;
              if(traffic!==null&&at-traffic<=2000&&!ledger.state().controls.entriesEnabled){const result=ledger.resume('pilot-ready-resume:'+ledger.state().revision+':'+at,at,price!,{},{version:PILOT_VERSION,evidence:'pilot-contract:'+PILOT_CONTRACT_SHA256,marketAt:traffic,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});if(result.enabled)entryEnabledAt??=at;}}
            await trader.tick();lastTick=Date.now();}catch(e){reject('candidate-decision-unavailable',safe(e));trader.pauseNewEntries('candidate decision unavailable');}finally{busy=false;}continue;
        }
      }else if(!held&&!pending.length&&capacity&&(preparedSeed!==null||seeds.length>0)&&now>=feeds.usage().candidateRetryAt&&rpc.available()){
        const seed=preparedSeed??seeds.shift()!;if(now-seed.receivedAt<35000||now<(seed.eligibleAfter??0)){seeds.unshift(seed);await sleep(100);continue;}busy=true;
        try{const result=await resolvePilotMigration(seed,rpc,new AbortController().signal);if(!result.ok){if(preparedSeed?.feedMint)testedMints.add(preparedSeed.feedMint);reject(result.reason,{signature:seed.signature});if(result.reason==='PILOT_MIGRATION_FINALIZED_CREATION_UNAVAILABLE'&&(seed.finalityDeferrals??0)<2&&seeds.length<16){seeds.push({...seed,eligibleAfter:Date.now()+30000,finalityDeferrals:(seed.finalityDeferrals??0)+1});record('pilot-finality-proof-deferred',{signature:seed.signature,originalReceiveAt:seed.receivedAt,eligibleAfter:Date.now()+30000});}continue;}record('pilot-migration-resolution',result.proof);const proof:Proof={identity:result.identity,evidence:result.evidence},id=proof.identity;verifiedOrigins++;if(guard.lookup({mint:id.baseMint,pool:id.pool}).blocked){reject('prior-pool-refusal-active',{mint:id.baseMint,guard:guard.lookup({mint:id.baseMint,pool:id.pool})});continue;}if(testedMints.has(id.baseMint)){reject('already-observed-candidate',{mint:id.baseMint});continue;}
          const age=Date.now()-id.chainBlockTime*1000;if(age<240000){manifest.pools[id.baseMint]=proof;persist();reject('migration-warming-before-entry-age',{mint:id.baseMint,ageMs:age});continue;}testedMints.add(id.baseMint);if(age>7200000){reject('migration-age-excluded',{mint:id.baseMint,ageMs:age});continue;}
          market.registerPool({mint:id.baseMint,migrationSlot:id.slot,migrationVerified:true,evidence:proof.evidence});const costs=await market.prepareEntryCosts(id.baseMint,new AbortController().signal);trader.setPilotEntryDeposit(costs.depositLamports,costs.evidence);manifest.pools[id.baseMint]=proof;need(Object.keys(manifest.pools).length<=64,'PILOT_POOL_PROOF_CAP');persist();
          // Leave the measured14-event burst plus its upgrade outside prep traffic.
          // This waits before collecting required flow, never discards a trade.
          const waitingSince=Date.now();for(;;){const at=Date.now(),usage=rpc.usage(),chapter=usage.chapterUsage,starts=chapter?[...chapter.baseline.starts,...chapter.starts]:[],readyAt=Math.max(pilotObservationReadyAt(starts,at),feeds.usage().candidateRetryAt);if(at>=readyAt)break;need(!stopping&&at<endAt-910000&&at-waitingSince<20000,'PILOT_OBSERVATION_PREPARATION_RESERVE');await sleep(Math.min(100,readyAt-at));}
          need(Date.now()-costs.at<=30000,'PILOT_SUPPORT_VALIDATION_AGED_BEFORE_FLOW');record('pilot-observation-headroom',{mint:id.baseMint,waitedMs:Date.now()-waitingSince,maximumStartsPer10s:20,remainingShortStartsReserved:15,remainingMinuteStartsReserved:20,supportValidatedAt:costs.at,actualEntryQuoteRequiredLater:true});
          trader.admit({mint:id.baseMint,migrationAt:id.chainBlockTime*1000,migrationVerified:true,supportedPool:true,evidence:proof.evidence});candidate={proof,startedAt:Date.now(),flowAt:null,auditedThrough:0,lastAuditAt:0,knownSignatures:new Map()};admitted++;
          // Connect after releasing root's low-priority work marker. The same
          // physical gate still owns both upgrades and all enrichment reads.
          busy=false;await feeds.selectCandidate({mint:id.baseMint,pool:id.pool,baseUnits:'1',minSlot:id.slot,supportedPoolEvidence:costs.evidence});
        }catch(e){if(preparedSeed?.feedMint)testedMints.add(preparedSeed.feedMint);reject('candidate-preparation-unavailable',safe(e));if(candidate)await retire('candidate preparation failed');}finally{busy=false;}continue;
      }else if(!held&&!pending.length&&!candidate&&now-lastTick>=1000){busy=true;try{await trader.tick();lastTick=Date.now();}finally{busy=false;}}
      await sleep(50);
    }
    trader.pauseNewEntries('graceful pilot stop; new risk closed');await feeds.stop();const stop=ledger.safeStop('pilot-stop:'+runId,Date.now());record('pilot-monitoring-interruption',{at:Date.now(),reason:stopReason,result:stop,openExposureRetained:true,noFabricatedLiquidation:true});
    if(backupTask)await backupTask;startBackup();if(backupTask)await backupTask;
    rpc.close();manifest.baselinePaths=rpc.usage().chapterPaths;manifest.cooldownUntil=rpc.cooldownUntil();manifest.controlCooldownUntil=Math.max(manifest.controlCooldownUntil??0,rpc.usage().controlCooldownUntil);need(feeds.usage().physicalTransportsSettled,'PILOT_FEED_TRANSPORT_UNSETTLED');delete manifest.unresolvedResearch;persist();
    const result=report(true);completed=true;console.log(JSON.stringify({runId,accountId:manifest.accountId,status:result.status,entries:naturalEntries,exits:naturalExits,openPositions:result.financial.openPositions,resultPath:join(runDir,'result.json')}));return result;
  }catch(e){stopReason='pilot fault: '+safe(e);throw e;}finally{
    stopping=true;try{await feeds?.stop();}catch{/* Preserve unresolved receipt state. */}
    if(ledger){if(!completed)try{ledger.safeStop('pilot-finally:'+runId,Date.now());}catch{}if(!completed)try{(emergencyStatus as (()=>void)|null)?.();}catch{}await (backupTask as Promise<unknown>|null)?.catch(()=>{});ledger.close();}
    if(feeds&&!feeds.usage().physicalTransportsSettled&&manifest){manifest.unresolvedResearch={runId,rpcDirectory:join(runDir,'rpc'),pid:process.pid};persist();}
    if(rpc){try{rpc.close();if(manifest){manifest.baselinePaths=rpc.usage().chapterPaths;manifest.cooldownUntil=rpc.cooldownUntil();manifest.controlCooldownUntil=Math.max(manifest.controlCooldownUntil??0,rpc.usage().controlCooldownUntil);if(!feeds||feeds.usage().physicalTransportsSettled)delete manifest.unresolvedResearch;persist();}}catch{if(manifest){manifest.unresolvedResearch={runId,rpcDirectory:join(runDir,'rpc'),pid:process.pid};persist();}record('pilot-physical-accounting-unresolved',{usage:rpc.usage(),nextRunBlockedUntilReconciled:true});}}
    guard?.close();lag.disable();process.removeListener('SIGTERM',signalStop);process.removeListener('SIGINT',signalStop);closeSync(pumpLease);closeSync(globalLease);
  }
}

async function main(){const args=process.argv.slice(2),command=args.shift()??'status',options=new Map<string,string>();while(args.length){const k=args.shift(),v=args.shift();need(k!==undefined&&k.startsWith('--')&&v!==undefined,'PILOT_ARGUMENTS');options.set(k.slice(2),v);}const directory=resolve(options.get('directory')??'/workspace/poe-pilot');
  if(command==='status'){assertPilotDirectory(directory);console.log(readFileSync(join(directory,'status.json'),'utf8'));return;}
  if(command==='stop'){assertPilotDirectory(directory);if(existsSync(join(directory,'stop.request'))){console.log('Graceful stop already requested.');return;}const fd=openSync(join(directory,'stop.request'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);writeFileSync(fd,new Date().toISOString());closeSync(fd);console.log('Graceful stop requested. Check status; open positions remain recorded.');return;}
  need(command==='start'||command==='resume','PILOT_COMMAND');await runPilot(directory,Number(options.get('duration-seconds')??1800)*1000,command==='resume');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)void main().catch(e=>{console.error(safe(e));process.exitCode=1;});
