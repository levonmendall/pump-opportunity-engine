/** Offline public-input exporter for the existing native candidate harness.
 * Does not connect, dispatch, read a financial ledger/credential, or mutate the
 * pilot manifest. Explicit outputs are new private files in the bundle folder.
 * Run with node --import tsx; root owns the lease, commit, bundle and dispatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {decodeMigrationIdentity} from '../../src/migration-identity.ts';
import {readResearchBaseline} from '../../src/research-baseline.ts';
import {validateNativeCandidateInput} from '../../src/run-native-candidates.ts';

const REPOSITORY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PILOT='/workspace/poe-pilot',MIB=1024*1024,now=Date.now(),uid=process.getuid();
const need=(value,reason)=>{if(!value)throw Error('INPUT_EXPORT_'+reason);};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const argv=process.argv.slice(2),allowed=new Set(['--bundle-directory','--output','--provenance','--lease-pid','--handoff-directory','--settlement-receipt']);
need([8,12].includes(argv.length)&&argv.every((value,index)=>index%2||allowed.has(value))&&new Set(argv.filter((_,index)=>index%2===0)).size===argv.length/2&&['--bundle-directory','--output','--provenance','--lease-pid'].every(name=>argv.includes(name)),'EXPLICIT_ARGUMENTS_REQUIRED');
const arg=name=>argv[argv.indexOf(name)+1];
const latestHandoff=argv.includes('--handoff-directory');
need(latestHandoff===argv.includes('--settlement-receipt'),'HANDOFF_AND_SETTLEMENT_REQUIRED_TOGETHER');
const bundleDirectory=path.resolve(arg('--bundle-directory')),output=path.resolve(arg('--output')),provenanceOutput=path.resolve(arg('--provenance'));
const leasePid=Number(arg('--lease-pid'));
need(/^\/tmp\/poe-native-candidate-output-[a-z0-9-]+$/.test(bundleDirectory),'FIXED_PUBLIC_BUNDLE_DIRECTORY');
need(uid===1000&&Number.isSafeInteger(leasePid)&&leasePid>1,'NONROOT_LEASE_PID_REQUIRED');
need(output!==provenanceOutput&&path.dirname(output)===bundleDirectory&&path.dirname(provenanceOutput)===bundleDirectory,'OUTPUTS_IN_BUNDLE_DIRECTORY_REQUIRED');
for(const file of [output,provenanceOutput])need(/^[a-z0-9][a-z0-9.-]*\.json$/.test(path.basename(file))&&!fs.existsSync(file),'NEW_JSON_OUTPUT_REQUIRED');
const bundleStat=fs.lstatSync(bundleDirectory);
need(bundleStat.isDirectory()&&!bundleStat.isSymbolicLink()&&fs.realpathSync(bundleDirectory)===bundleDirectory&&bundleStat.uid===uid&&(bundleStat.mode&0o077)===0,'PRIVATE_BUNDLE_DIRECTORY_REQUIRED');
process.kill(leasePid,0);
need(fs.statSync('/proc/'+leasePid).uid===uid,'LEASE_PROCESS_OWNER_MISMATCH');
for(const name of ['poe-public-component-20261027.lock','poe-pumpapi-probe.lock']){
 const fd=fs.openSync('/tmp/'+name,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);need(s.isFile()&&s.uid===uid,'PRIVATE_LEASE_FILE_REQUIRED');need(spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000}).status===1,'LEAD_LEASE_MISSING');}finally{fs.closeSync(fd);}
}

let inputBytes=0;const inputs=[];
function read(file,maximum){
 need(path.isAbsolute(file)&&fs.realpathSync(file)===file,'CANONICAL_PUBLIC_FILE_REQUIRED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const before=fs.fstatSync(fd);need(before.isFile()&&before.uid===uid&&before.nlink===1&&before.size>0&&before.size<=maximum,'BOUNDED_PUBLIC_SOURCE');
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
  need(bytes.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'PUBLIC_SOURCE_CHANGED');
  inputBytes+=bytes.length;need(inputBytes<=64*MIB,'TOTAL_PUBLIC_INPUT_CAP');inputs.push({path:file,bytes:bytes.length,sha256:sha(bytes)});return bytes;
 }finally{fs.closeSync(fd);}
}
const git=(...args)=>{const result=spawnSync('git',args,{cwd:REPOSITORY,encoding:'utf8',timeout:5000,maxBuffer:2*MIB});need(result.status===0,'GIT_METADATA_UNAVAILABLE');return result.stdout.trim();};
const manifestPath=PILOT+'/pilot.json',manifestRaw=read(manifestPath,2*MIB),manifest=JSON.parse(manifestRaw);
need(manifest.schemaVersion===1&&manifest.experimental===true&&manifest.authoritative===false&&!manifest.unresolvedResearch,'UNSETTLED_OR_NONEXPERIMENTAL_RESEARCH');
need(Array.isArray(manifest.baselinePaths)&&manifest.baselinePaths.length>0&&manifest.baselinePaths.length<=192,'EXPLICIT_BASELINE_PATHS_REQUIRED');
let discovery,watch,checkpoint,checkpointPath,expectedAccounting,handoff;
if(!latestHandoff){
 const discoveryPath=PILOT+'/runs/discovery-cache-20261028070929965/receipt.json';discovery=JSON.parse(read(discoveryPath,4*MIB));
 need(discovery.running===false&&discovery.physicalSettlementConfirmed===true&&discovery.financialWriterOpened===false&&discovery.entriesEnabled===false&&discovery.liveTrading===false,'SETTLED_DISCOVERY_RECEIPT_REQUIRED');
 need(discovery.usage?.closed===true&&discovery.usage.inFlight===0&&discovery.usage.waitingOrOperating===false&&discovery.usage.fatal===null,'DISCOVERY_COUNTERBOOK_NOT_SETTLED');
 need(JSON.stringify(discovery.usage.chapterPaths)===JSON.stringify(manifest.baselinePaths),'MANIFEST_CHANGED_SINCE_LAST_SETTLEMENT');
 const watchStatusPath=PILOT+'/runs/discovery-cache-20261028070929965/status.json',watchStatus=JSON.parse(read(watchStatusPath,4*MIB));
 need(watchStatus.runId===discovery.runId&&watchStatus.running===false&&watchStatus.generatedAt===discovery.generatedAt,'LATEST_WATCH_HANDOFF_REQUIRED');
 watch=watchStatus.watch;need(JSON.stringify(watch)===JSON.stringify(discovery.watch),'WATCH_RECEIPT_MISMATCH');
 checkpointPath=PILOT+'/runs/native-age-20261028061211/artifact/run/watch-checkpoint.json';checkpoint=JSON.parse(read(checkpointPath,8*MIB));
 expectedAccounting={sourceCount:discovery.usage.chapterPaths.length,calls:discovery.usage.cumulativeUnits,bytes:discovery.usage.accountedCumulativeResponseBytes,uncertain:discovery.usage.uncertainResponseBytes};
 handoff={mode:'historical-discovery-handoff',receipt:discoveryPath,watchSource:watchStatusPath,originSource:checkpointPath,physicalSettlementConfirmed:true};
}else{
 const directory=path.resolve(arg('--handoff-directory')),study=path.dirname(path.dirname(directory)),settlementPath=path.resolve(arg('--settlement-receipt'));
 need(new RegExp('^'+PILOT+'/runs/native-[a-z0-9-]+/artifact/run$').test(directory)&&settlementPath===study+'/settlement-link.json','FIXED_NATIVE_HANDOFF_PATHS_REQUIRED');
 for(const folder of [study,path.dirname(directory),directory]){const stat=fs.lstatSync(folder);need(stat.isDirectory()&&!stat.isSymbolicLink()&&fs.realpathSync(folder)===folder&&stat.uid===uid&&(stat.mode&0o077)===0,'PRIVATE_NATIVE_HANDOFF_REQUIRED');}
 const settlement=JSON.parse(read(settlementPath,128*1024)),prepared=JSON.parse(read(study+'/prepared.json',2*MIB)),readback=JSON.parse(read(study+'/readback-receipt.json',256*1024));
 need(settlement.schemaVersion===1&&settlement.applicationAndProcessGroupsSettled===true&&settlement.wholeArchiveHashVerified===true&&settlement.priorBooksRetainedUnchanged===true&&settlement.financialLedgerOpened===false,'SETTLED_NATIVE_HANDOFF_REQUIRED');
 need(prepared.schemaVersion===1&&prepared.priorPhysicalSettled===true&&prepared.financialWriterOpened===false&&prepared.entriesEnabled===false&&prepared.liveTrading===false&&prepared.administrationRun===settlement.administrationRun,'PREPARED_NATIVE_BOUNDARIES_MISMATCH');
 need(readback.schemaVersion===1&&readback.sourceRun===settlement.administrationRun&&readback.wholeArchiveHashVerified===true&&readback.allSelectedSegmentsRetained===true&&readback.financialFilesRead===false&&readback.rawHostEvidenceDeletionPerformed===false,'VERIFIED_PUBLIC_READBACK_REQUIRED');
 need(Array.isArray(prepared.priorBookPaths)&&Array.isArray(settlement.newPaths)&&settlement.newPaths.length>0&&settlement.newPaths.length<=65&&settlement.newPaths.every(row=>typeof row?.path==='string'&&/^[a-f0-9]{64}$/.test(row.sha256)),'EXPLICIT_SETTLED_PATHS_REQUIRED');
 need(JSON.stringify([...prepared.priorBookPaths,...settlement.newPaths.map(row=>row.path)])===JSON.stringify(manifest.baselinePaths),'MANIFEST_CHANGED_SINCE_NATIVE_SETTLEMENT');
 for(const row of settlement.newPaths){need(row.path.startsWith(directory+'/rpc/chapter-')&&/^chapter-[0-9]{3}\.json$/.test(path.basename(row.path))||row.path===study+'/observed-unmanaged-control.json','SETTLED_COUNTERBOOK_SCOPE');need(sha(read(row.path,512*1024))===row.sha256,'SETTLED_COUNTERBOOK_HASH_MISMATCH');}
 const supervisorPath=study+'/artifact/supervisor.json',receiptPath=directory+'/receipt.json',statusPath=directory+'/status.json',indexPath=study+'/artifact/index.json';
 const supervisor=JSON.parse(read(supervisorPath,256*1024)),receiptRaw=read(receiptPath,8*MIB),receipt=JSON.parse(receiptRaw),statusRaw=read(statusPath,8*MIB),index=JSON.parse(read(indexPath,MIB));
 need(receipt.running===false&&receipt.physicalSettlementConfirmed===true&&receipt.financialWriterOpened===false&&receipt.financialExecutionAuthorized===false&&receipt.entriesEnabled===false&&receipt.liveTradingEnabled===false&&receipt.accountId===manifest.accountId&&receipt.inceptionAt===manifest.inceptionAt,'SETTLED_NATIVE_SOURCE_REQUIRED');
 need(receipt.usage?.rpc?.closed===true&&receipt.usage.rpc.inFlight===0&&receipt.usage.rpc.waitingOrOperating===false&&receipt.feeds?.physicalTransportsSettled===true&&receipt.engine?.flow?.physicalTransportsSettled===true,'NATIVE_TRANSPORTS_NOT_SETTLED');
 need(supervisor.ownedProcessGroupsSettled===true&&supervisor.sourcePhysicalSettlementConfirmed===true&&supervisor.physicalSettlementConfirmed===true&&supervisor.finalPublisherProcessGroupSettled===true&&supervisor.originalFinancialAccountTouched===false,'EXTERNAL_PROCESS_SETTLEMENT_REQUIRED');
 need(JSON.stringify(receipt.source)===JSON.stringify(settlement.source)&&JSON.stringify(receipt.source)===JSON.stringify(prepared.source)&&JSON.stringify(receipt.source)===JSON.stringify(supervisor.source)&&receipt.configurationSha256===settlement.configurationSha256&&receipt.configurationSha256===prepared.configurationSha256&&supervisor.accountId===manifest.accountId&&supervisor.inceptionAt===manifest.inceptionAt,'PRIOR_SOURCE_IDENTITY_MISMATCH');
 need(sha(receiptRaw)===sha(statusRaw)&&receipt.stopReason===settlement.runtimeStop&&receipt.unmanagedControlUnits===settlement.extraObservedUnmanagedControls&&receipt.elapsedMs===settlement.actualElapsedMs,'NATIVE_FINAL_RECEIPT_MISMATCH');
 need(index.schemaVersion===1&&Array.isArray(index.included)&&index.included.length>0&&index.included.length<=256&&Array.isArray(index.omittedSelectedEvidence)&&index.omittedSelectedEvidence.length===0&&index.credentialsIncluded===false&&index.financialFilesIncluded===false&&readback.indexFileHashesVerified===index.included.length,'PUBLIC_ARCHIVE_INDEX_REQUIRED');
 checkpointPath=directory+'/watch-checkpoint.json';const checkpointRaw=read(checkpointPath,8*MIB);checkpoint=JSON.parse(checkpointRaw);
 for(const [relative,file] of [['supervisor.json',supervisorPath],['run/receipt.json',receiptPath],['run/status.json',statusPath],['run/watch-checkpoint.json',checkpointPath]]){const rows=index.included.filter(row=>row.path===relative),entry=inputs.find(row=>row.path===file);need(rows.length===1&&rows[0].bytes===entry.bytes&&rows[0].sha256===entry.sha256,'INDEXED_HANDOFF_FILE_MISMATCH');}
 const archivePath=study+'/selected-evidence.tar.gz';need(fs.realpathSync(archivePath)===archivePath&&Number.isSafeInteger(readback.archiveBytes)&&readback.archiveBytes>0&&readback.archiveBytes<=256*MIB&&/^[a-f0-9]{64}$/.test(readback.archiveSha256),'BOUNDED_ARCHIVE_REQUIRED');
 const archiveFd=fs.openSync(archivePath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let archiveHash;
 try{const before=fs.fstatSync(archiveFd);need(before.isFile()&&before.uid===uid&&before.nlink===1&&before.size===readback.archiveBytes,'PUBLIC_ARCHIVE_SIZE_MISMATCH');const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(64*1024);let total=0;for(;;){const count=fs.readSync(archiveFd,buffer,0,buffer.length,null);if(!count)break;total+=count;need(total<=readback.archiveBytes,'ARCHIVE_CHANGED_DURING_HASH');hash.update(buffer.subarray(0,count));}const after=fs.fstatSync(archiveFd);need(total===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,'ARCHIVE_CHANGED_DURING_HASH');archiveHash=hash.digest('hex');need(archiveHash===readback.archiveSha256,'WHOLE_ARCHIVE_HASH_MISMATCH');}finally{fs.closeSync(archiveFd);}
 watch=checkpoint.watch;need(JSON.stringify(watch?.rows)===JSON.stringify(receipt.engine.watch.rows),'FINAL_WATCH_SOURCE_MISMATCH');
 expectedAccounting={sourceCount:manifest.baselinePaths.length,calls:settlement.cumulativeAccountedUnits,bytes:settlement.cumulativeAccountedResponseBytes,uncertain:settlement.cumulativeUncertainResponseBytes,observed:settlement.cumulativeObservedResponseBytes};
 need(settlement.cumulativeAccountedUnits===prepared.priorUnits+settlement.newAccountedUnits&&settlement.newAccountedUnits===settlement.actualManagedStarts+settlement.extraObservedUnmanagedControls&&settlement.actualManagedStarts===settlement.actualManagedSettlements,'NATIVE_SETTLED_OPERATION_COUNTS_MISMATCH');
 handoff={mode:'explicit-settled-native-handoff',directory,settlementReceipt:settlementPath,source:receipt.source,runId:receipt.runId,administrationRun:settlement.administrationRun,configurationSha256:receipt.configurationSha256,wholeArchive:{path:archivePath,bytes:readback.archiveBytes,sha256:archiveHash,verifiedByThisExport:true},indexVerifiedFileCount:readback.indexFileHashesVerified,physicalSettlementConfirmed:true,extraObservedUnmanagedControls:settlement.extraObservedUnmanagedControls,historicalHintsReinserted:false};
}
need(watch?.schemaVersion===1&&watch.observationAgePolicyVersion==='observation-age-selected-24h-study-v1'&&Array.isArray(watch.rows)&&watch.rows.length<=174,'BOUNDED_WATCH_EXPORT_REQUIRED');
const bindingPath='/workspace/poe-ec2-ws-diagnostic-admin/scripts/poe/reporting-source-context.json',binding=JSON.parse(read(bindingPath,4096));
need(binding.accountId===manifest.accountId&&binding.inceptionAt===manifest.inceptionAt&&/^[a-f0-9]{64}$/.test(binding.sourceStatusSha256),'ACTUAL_REPORTING_IDENTITY_BINDING_REQUIRED');
// The original nonsecret binding hash is retained; no financial status/database
// is opened merely to recompute an already-attested identity source hash.
const metadataPath=path.join(bundleDirectory,'metadata.json'),metadata=JSON.parse(read(metadataPath,2*MIB));
const commit=git('rev-parse','HEAD');
need(metadata.git?.commit===commit&&metadata.git.workingTreeStatus===''&&git('status','--porcelain','--untracked-files=all','--','src','scripts',':!node_modules')==='','EXACT_COMMITTED_BUNDLE_REQUIRED');
need(metadata.smoke?.exitStatus===0&&metadata.measurementExecuted===false&&metadata.credentialsRead===false,'IMPORT_ONLY_SMOKE_REQUIRED');
const bundle=read(path.join(bundleDirectory,'native-candidates.mjs'),8*MIB);
need(metadata.bundle?.sha256===sha(bundle)&&metadata.bundle.bytes===bundle.length,'EXECUTABLE_HASH_MISMATCH');

need(checkpoint.financialWriterOpened===false&&Array.isArray(checkpoint.origins)&&checkpoint.origins.length<=174&&Number.isSafeInteger(checkpoint.generatedAt)&&checkpoint.generatedAt<=now,'LATEST_NATIVE_PROOFS_REQUIRED');
const origins=new Map(),excludedOrigins=[];
const core=identity=>{const {availableAt,commitment,...rest}=identity;return JSON.stringify(rest);};
for(let index=0;index<checkpoint.origins.length;index++){
 const source=checkpoint.origins[index],confirmed=source?.originConfirmed,finalized=source?.originFinalized;
 need(confirmed&&finalized&&Number.isSafeInteger(confirmed.availableAt)&&Number.isSafeInteger(finalized.availableAt)&&confirmed.availableAt<=checkpoint.generatedAt&&finalized.availableAt<=checkpoint.generatedAt,'ORIGIN_AVAILABILITY_INVALID');
 const a=decodeMigrationIdentity(confirmed.transaction,{signature:confirmed.signature,commitment:'confirmed',availableAt:confirmed.availableAt});
 const b=decodeMigrationIdentity(finalized.transaction,{signature:finalized.signature,commitment:'finalized',availableAt:finalized.availableAt});
 need(a.ok&&b.ok&&core(a.identity)===core(b.identity)&&b.identity.classification==='SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT','STRICT_CANONICAL_ORIGIN_REQUIRED');
 const identity=b.identity,migrationAt=identity.chainBlockTime*1000,ageMs=now-migrationAt;
 need(ageMs>=0,'FUTURE_ORIGIN_TIMESTAMP');
 if(ageMs>=86400000){excludedOrigins.push({mint:identity.baseMint,pool:identity.pool,migrationAt,originIndex:index,reason:'outside selected24h observation horizon at export; original proof retained'});continue;}
 const prior=origins.get(identity.baseMint);
 need(!prior||prior.identity.pool===identity.pool&&prior.identity.chainBlockTime===identity.chainBlockTime,'CONFLICTING_ORIGIN');
 if(!prior||finalized.availableAt<prior.proof.originFinalized.availableAt)origins.set(identity.baseMint,{identity,proof:structuredClone(source),ref:{path:checkpointPath,originIndex:index,kind:'latest-native-strict-proof'}});
}
need(origins.size<=174,'ORIGIN_IDENTITY_CAP');
const linked=readResearchBaseline({paths:manifest.baselinePaths,now,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:192});
need(linked.sources.length===expectedAccounting.sourceCount&&linked.baseline.calls===expectedAccounting.calls&&linked.baseline.bytes===expectedAccounting.bytes&&linked.uncertainResponseBytes===expectedAccounting.uncertain&&(expectedAccounting.observed===undefined||linked.observedBytes===expectedAccounting.observed),'SETTLED_ACCOUNTING_MISMATCH');
const priorCooldownUntil=Math.max(manifest.cooldownUntil??0,manifest.controlCooldownUntil??0);
need(Number.isSafeInteger(priorCooldownUntil)&&priorCooldownUntil>=0&&now>=priorCooldownUntil,'PROVIDER_COOLDOWN');
const input={schemaVersion:1,baselinePaths:manifest.baselinePaths,priorPhysicalSettled:true,priorCooldownUntil,origins:[...origins.values()].sort((a,b)=>b.identity.chainBlockTime-a.identity.chainBlockTime).map(row=>row.proof),source:{commit:metadata.git.commit,sha256:metadata.bundle.sha256},dataContract:'confirmed-program-activity-v3-shadow',observationAgePolicy:'observation-age-selected-24h-study-v1',watchCheckpoint:structuredClone(watch),reportingBinding:binding};
validateNativeCandidateInput(input);
const encoded=JSON.stringify(input)+'\n';need(Buffer.byteLength(encoded)<=8*MIB,'INPUT_CAP');
const hintRows=latestHandoff?watch.rows.filter(row=>row.migrationAt===null&&row.verifiedAt===null):watch.rows.filter(row=>row.firstSeenAt>=discovery.startedAt);
const hints=hintRows.map(row=>{need(row.migrationAt===null&&row.verifiedAt===null&&Number.isSafeInteger(row.firstSeenAt)&&row.firstSeenAt<=now,'UNVERIFIED_HINT_CHANGED');if(!latestHandoff)need(row.mint===null&&row.pool===null&&row.state==='DISCOVERED','ORIGINAL_DISCOVERY_HINT_CHANGED');return {signature:row.signature,feedMint:row.feedMint,firstSeenAt:row.firstSeenAt,receiptAgeMs:now-row.firstSeenAt,state:row.state,migrationAt:null,currentPool:row.pool,semantics:'retained unverified discovery hint; receipt age is not migration age; no eligibility or activity inferred'};});
if(!latestHandoff)need(hints.length===discovery.migrationHints,'PRESERVED_HINT_COUNT_MISMATCH');
const provenance={schemaVersion:1,createdAt:now,source:input.source,dataContract:input.dataContract,observationAgePolicy:input.observationAgePolicy,baselineEntryAge:'5–120min unchanged; no financial execution',inputSha256:sha(encoded),inputBytes:Buffer.byteLength(encoded),baseline:{calls:linked.baseline.calls,accountedResponseBytes:linked.baseline.bytes,observedResponseBytes:linked.observedBytes,uncertainResponseBytes:linked.uncertainResponseBytes,pendingHistoricalReservations:linked.pendingOperations,sourceCount:linked.sources.length,sha256:linked.baseline.sha256},handoff,originCheckpointCount:checkpoint.origins.length,originCount:origins.size,excludedOrigins,origins:[...origins.values()].map(row=>({mint:row.identity.baseMint,pool:row.identity.pool,migrationAt:row.identity.chainBlockTime*1000,source:row.ref})),watchRows:watch.rows.length,unverifiedHints:hints,watchUnchangedFromSettledHandoff:true,reportingBinding:binding,inputs,sourceInputBytes:inputBytes,financialDatabaseOpened:false,financialStatusRead:false,credentialsRead:false,networkCalls:0,pilotManifestModified:false,externalLeaseHolder:leasePid,immutableSourceMeaning:'Executable/commit/configuration are frozen by reviewed metadata and stager; status uses input.source, not publication-time Git HEAD.'};
// Recheck source and manifest after all bounded decoding to reject concurrent
// source or accounting changes rather than exporting a mixed-time snapshot.
need(git('rev-parse','HEAD')===commit&&git('status','--porcelain','--untracked-files=all','--','src','scripts',':!node_modules')===''&&sha(fs.readFileSync(manifestPath))===sha(manifestRaw),'SOURCE_OR_ACCOUNTING_CHANGED_DURING_EXPORT');
function writeExclusive(file,bytes){const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
writeExclusive(output,encoded);writeExclusive(provenanceOutput,JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({...provenance,inputs:undefined,origins:undefined,unverifiedHints:hints.map(({signature,...row})=>row),output,provenanceOutput}));
