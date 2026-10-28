/** Offline public-input exporter for the existing native candidate harness.
 * Does not connect, dispatch, read a financial ledger/credential, or mutate the
 * pilot manifest. Explicit outputs are new private files in the bundle folder.
 * Run with node --import tsx; root owns the lease, commit, bundle and dispatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {decodeMigrationIdentity} from '../../src/migration-identity.ts';
import {readResearchBaseline,verifyResearchCheckpointSourceHandoff,RESEARCH_CHECKPOINT_KIND} from '../../src/research-baseline.ts';
import {validateNativeCandidateInput} from '../../src/run-native-candidates.ts';

const REPOSITORY=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const PILOT='/workspace/poe-pilot',MIB=1024*1024;
const need=(value,reason)=>{if(!value)throw Error('INPUT_EXPORT_'+reason);};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
/** First-seal inspection supplies UNTRUSTED candidate source paths only. The
 * caller must still run its original native/archive/historical guards and raw
 * chain reader, then the reviewed exact checkpoint-source handoff verifier.
 * No production CLI can override the fixed pilot root. */
export function inspectNativeInputAccountingPaths(manifest,readBounded,pilotRoot=PILOT){
 need(Array.isArray(manifest.baselinePaths)&&manifest.baselinePaths.length>0&&manifest.baselinePaths.length<=448,'EXPLICIT_BASELINE_PATHS_REQUIRED');
 if(manifest.baselineCheckpointSha256===undefined)return {sourcePaths:[...manifest.baselinePaths],checkpoint:null};
 need(/^[a-f0-9]{64}$/.test(manifest.baselineCheckpointSha256)&&manifest.baselinePaths.length===1,'EXACT_SINGLE_CHECKPOINT_REQUIRED');
 const checkpointPath=manifest.baselinePaths[0],folder=pilotRoot+'/research-checkpoints/';
 need(typeof checkpointPath==='string'&&checkpointPath.startsWith(folder)&&path.dirname(checkpointPath)===folder.slice(0,-1)&&/^[a-z0-9-]+\.json$/.test(path.basename(checkpointPath)),'FIXED_CHECKPOINT_PATH_REQUIRED');
 const raw=readBounded(checkpointPath,512*1024);need(sha(raw)===manifest.baselineCheckpointSha256,'CHECKPOINT_HASH_MISMATCH');
 const checkpoint=JSON.parse(raw);
 need(checkpoint.schemaVersion===1&&checkpoint.kind===RESEARCH_CHECKPOINT_KIND&&checkpoint.previousCheckpoint===null&&Array.isArray(checkpoint.sources)&&checkpoint.sources.length>0&&checkpoint.sources.length<=448,'FIRST_CHECKPOINT_SOURCE_LIST_REQUIRED');
 const sourcePaths=checkpoint.sources.map(row=>{need(row&&typeof row.path==='string'&&path.isAbsolute(row.path)&&/^[a-f0-9]{64}$/.test(row.sha256),'CHECKPOINT_SOURCE_REFERENCE_REQUIRED');return row.path;});
 need(new Set(sourcePaths).size===sourcePaths.length&&!sourcePaths.includes(checkpointPath),'CHECKPOINT_SOURCE_PATH_CONFLICT');
 return {sourcePaths,checkpoint:{path:checkpointPath,sha256:manifest.baselineCheckpointSha256,bytes:raw.length,sourcePathsAreUntrustedUntilExistingGuardsPass:true}};
}

/** Source hashes/counters alone cannot prove rolling demand was preserved.
 * Re-derive the creator's FIRST-seal conservative history from the already
 * verified raw books. Missing physical stamps stay at the actual seal time.
 * This is one quiescent export check, never per-request historical replay. */
export function verifyNativeInputCheckpointAccounting({checkpointPath,checkpointSha256,sourcePaths,now,readBounded}){
 const verified=verifyResearchCheckpointSourceHandoff({checkpointPath,checkpointSha256,sourcePaths,now,physicalSettled:true});
 const linked=readResearchBaseline({paths:sourcePaths,now,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:448});
 const anchorRaw=readBounded(checkpointPath,512*1024);need(sha(anchorRaw)===checkpointSha256,'CHECKPOINT_HASH_MISMATCH');const anchor=JSON.parse(anchorRaw);
 need(anchor.previousCheckpoint===null,'FIRST_CHECKPOINT_SOURCE_LIST_REQUIRED');
 const sealAt=anchor.createdAt,cutoff=Math.max(0,sealAt-60000),starts=[];let unknown=0,lastObservedAt=0;
 for(let index=0;index<linked.sources.length;index++){
  const source=linked.sources[index],raw=readBounded(source.path,512*1024);need(sha(raw)===source.sha256,'CHECKPOINT_RAW_SOURCE_CHANGED');const book=JSON.parse(raw);lastObservedAt=book.lastObservedAt;
  if(index===0){need(book.blockedReason==='RPC_HTTP_429','CHECKPOINT_LEGACY_REFUSAL_REQUIRED');for(const _ of book.starts){unknown++;starts.push(sealAt);}}
  else{const actual=new Map((book.actualInvocations??[]).map(row=>[row.id,row.at])),base=book.baseline.calls;for(let i=0;i<book.starts.length;i++){const at=actual.get(base+i+1);if(at===undefined){unknown++;starts.push(sealAt);}else starts.push(at);}}
 }
 const retained=starts.filter(at=>at>=cutoff).sort((a,b)=>a-b),expected={retainedSinceAt:cutoff,omittedCount:linked.baseline.calls-retained.length,conservativeUnknownAtSeal:unknown,times:retained};
 need(starts.length===linked.baseline.calls&&anchor.sourceLastObservedAt===lastObservedAt&&anchor.starts.retainedSinceAt===expected.retainedSinceAt&&anchor.starts.omittedCount===expected.omittedCount&&anchor.starts.conservativeUnknownAtSeal===expected.conservativeUnknownAtSeal&&JSON.stringify(anchor.starts.times)===JSON.stringify(expected.times),'CHECKPOINT_START_HISTORY_REFUND_OR_RETIME');
 return {...verified,firstSealStartHistoryVerified:true,unknownPhysicalStartsConservativelyAtSeal:unknown,retainedStarts:retained.length};
}

/** One append-only correction for an abbreviated identity on a measured
 * zero-request LOCAL admission refusal. It grants no network/data authority and
 * cannot rewrite the original receipt or relax any suffix/accounting guard. */
export function verifyZeroRequestHistoricalSourceCorrection({run,receiptRaw,provenanceRaw,correctionRaw,readBounded,readCommitFile,now}){
 const r=JSON.parse(receiptRaw),p=JSON.parse(provenanceRaw),c=JSON.parse(correctionRaw),u=r.usage;
 need(run===PILOT+'/runs/historical-adjudication-20261028192000'&&r.runId==='historical-adjudication-20261028192000'&&r.sourceCommit==='90f68c7'&&r.failure==='PILOT_RPC_INVALID_TIMEOUT'&&r.completed===0&&r.requestedTargets===2&&Array.isArray(r.results)&&r.results.length===0,'ZERO_REQUEST_CORRECTION_SCOPE');
 need(r.schemaVersion===1&&r.historicalDiagnosisOnly===true&&r.earlierWindowsUnchanged===true&&r.financialFilesRead===false&&r.credentialsRead===false&&r.physicalSettlementConfirmed===true&&r.unresolvedResearchRetained===false&&u?.newUnits===0&&u.newAccountedResponseBytes===0&&u.currentChapterUncertainResponseBytes===0&&u.inFlight===0&&u.waitingOrOperating===false&&u.closed===true&&u.fatal===null&&u.signatureHistoryBatch?.physicalHttpStarts===0&&u.signatureHistoryBatch.logicalQueriesInvoked===0,'ZERO_REQUEST_CORRECTION_NETWORK_OR_DATA');
 const fields=['schemaVersion','kind','runId','recordedAt','originalReceiptSha256','originalProvenanceSha256','originalSourceCommit','sourceCommit','sourceFiles','scriptPath','scriptSha256','originalReceiptRewritten','networkUsageReclassified'];
 need(c&&typeof c==='object'&&Object.keys(c).length===fields.length&&fields.every(k=>Object.hasOwn(c,k))&&c.schemaVersion===1&&c.kind==='poe-zero-request-historical-source-identity-correction-v1'&&c.runId===r.runId&&c.originalSourceCommit===r.sourceCommit&&c.sourceCommit==='90f68c707b54ff422e504d591124b664caa4c6d2'&&c.sourceCommit.startsWith(r.sourceCommit)&&c.originalReceiptRewritten===false&&c.networkUsageReclassified===false,'ZERO_REQUEST_CORRECTION_IDENTITY');
 need(c.originalReceiptSha256===sha(receiptRaw)&&c.originalProvenanceSha256===sha(provenanceRaw),'ZERO_REQUEST_CORRECTION_ORIGINAL_HASH');
 need(p.schemaVersion===1&&p.source?.commit===c.sourceCommit&&p.historicalDiagnosisOnly===true&&p.financialFilesRead===false&&p.credentialsRead===false&&p.earlierWindowsUnchanged===true&&p.sourceCommitInReceiptMayBeAbbreviated===true&&Number.isSafeInteger(c.recordedAt)&&c.recordedAt>=r.stoppedAt&&Number.isFinite(Date.parse(p.recordedAt))&&c.recordedAt>=Date.parse(p.recordedAt)&&c.recordedAt<=now,'ZERO_REQUEST_CORRECTION_PROVENANCE');
 const expected=['src/pilot-rpc.ts','src/component-budget.ts','src/component-transport.ts','src/research-baseline.ts'];
 need(Array.isArray(p.sourceFiles)&&p.sourceFiles.length===expected.length&&JSON.stringify(c.sourceFiles)===JSON.stringify(p.sourceFiles),'ZERO_REQUEST_CORRECTION_SOURCE_FILES');
 for(let i=0;i<expected.length;i++){const row=p.sourceFiles[i];need(row&&row.path===expected[i]&&/^[a-f0-9]{64}$/.test(row.sha256)&&sha(readCommitFile(c.sourceCommit,row.path))===row.sha256,'ZERO_REQUEST_CORRECTION_SOURCE_FILE_HASH');}
 need(p.scriptPath===PILOT+'/migration-20261028/shape-field-check.mjs'&&c.scriptPath===p.scriptPath&&/^[a-f0-9]{64}$/.test(p.scriptSha256)&&c.scriptSha256===p.scriptSha256&&sha(readBounded(p.scriptPath,128*1024))===p.scriptSha256,'ZERO_REQUEST_CORRECTION_SCRIPT_HASH');
 return {path:run+'/source-identity-correction.json',sha256:sha(correctionRaw),originalReceiptSha256:c.originalReceiptSha256,originalProvenanceSha256:c.originalProvenanceSha256,originalSourceCommit:r.sourceCommit,sourceCommit:c.sourceCommit,zeroNetworkUsageVerified:true,originalReceiptRewritten:false,marketHistoryRewritten:false};
}

export function prepareNativePublicInput(argv=process.argv.slice(2)){
const now=Date.now(),uid=process.getuid();
const allowed=new Set(['--bundle-directory','--output','--provenance','--lease-pid','--handoff-directory','--settlement-receipt']);
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
const inspectedAccounting=inspectNativeInputAccountingPaths(manifest,read),accountingPaths=inspectedAccounting.sourcePaths;
let discovery,watch,checkpoint,checkpointPath,expectedAccounting,handoff;
if(!latestHandoff){
 const discoveryPath=PILOT+'/runs/discovery-cache-20261028070929965/receipt.json';discovery=JSON.parse(read(discoveryPath,4*MIB));
 need(discovery.running===false&&discovery.physicalSettlementConfirmed===true&&discovery.financialWriterOpened===false&&discovery.entriesEnabled===false&&discovery.liveTrading===false,'SETTLED_DISCOVERY_RECEIPT_REQUIRED');
 need(discovery.usage?.closed===true&&discovery.usage.inFlight===0&&discovery.usage.waitingOrOperating===false&&discovery.usage.fatal===null,'DISCOVERY_COUNTERBOOK_NOT_SETTLED');
 need(JSON.stringify(discovery.usage.chapterPaths)===JSON.stringify(accountingPaths),'MANIFEST_CHANGED_SINCE_LAST_SETTLEMENT');
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
 const nativeSettledPaths=[...prepared.priorBookPaths,...settlement.newPaths.map(row=>row.path)];
 need(accountingPaths.length>=nativeSettledPaths.length&&accountingPaths.length<=nativeSettledPaths.length+16&&JSON.stringify(accountingPaths.slice(0,nativeSettledPaths.length))===JSON.stringify(nativeSettledPaths),'MANIFEST_CHANGED_SINCE_NATIVE_SETTLEMENT');
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
 expectedAccounting={sourceCount:nativeSettledPaths.length,calls:settlement.cumulativeAccountedUnits,bytes:settlement.cumulativeAccountedResponseBytes,uncertain:settlement.cumulativeUncertainResponseBytes,observed:settlement.cumulativeObservedResponseBytes};
 need(settlement.cumulativeAccountedUnits===prepared.priorUnits+settlement.newAccountedUnits&&settlement.newAccountedUnits===settlement.actualManagedStarts+settlement.extraObservedUnmanagedControls&&settlement.actualManagedStarts===settlement.actualManagedSettlements,'NATIVE_SETTLED_OPERATION_COUNTS_MISMATCH');
 handoff={mode:'explicit-settled-native-handoff',directory,settlementReceipt:settlementPath,source:receipt.source,runId:receipt.runId,administrationRun:settlement.administrationRun,configurationSha256:receipt.configurationSha256,wholeArchive:{path:archivePath,bytes:readback.archiveBytes,sha256:archiveHash,verifiedByThisExport:true},indexVerifiedFileCount:readback.indexFileHashesVerified,physicalSettlementConfirmed:true,extraObservedUnmanagedControls:settlement.extraObservedUnmanagedControls,historicalHintsReinserted:false};
}
// A completed field-only historical diagnosis may append settled public RPC
// books after the market segment. Its results never alter the market checkpoint.
// Follow only the explicit manifest suffix; no directory/history scan or refund.
const supplementalHistorical=[];
while(expectedAccounting.sourceCount<accountingPaths.length){
 const count=expectedAccounting.sourceCount,first=accountingPaths[count];
 need(new RegExp('^'+PILOT+'/runs/historical-adjudication-[0-9]{14}/rpc/chapter-[0-9]{3}\\.json$').test(first),'UNREVIEWED_ACCOUNTING_SUFFIX');
 const run=path.dirname(path.dirname(first)),receiptPath=run+'/receipt.json',beforePath=run+'/manifest-before.json';
 const raw=read(receiptPath,2*MIB),r=JSON.parse(raw),before=JSON.parse(read(beforePath,2*MIB)),u=r.usage;
 let sourceIdentityCorrection=null;
 if(!/^[a-f0-9]{40}$/.test(r.sourceCommit))sourceIdentityCorrection=verifyZeroRequestHistoricalSourceCorrection({run,receiptRaw:raw,provenanceRaw:read(run+'/provenance.json',128*1024),correctionRaw:read(run+'/source-identity-correction.json',128*1024),readBounded:read,readCommitFile:(commit,name)=>{const result=spawnSync('git',['show',commit+':'+name],{cwd:REPOSITORY,timeout:5000,maxBuffer:2*MIB});need(result.status===0,'ZERO_REQUEST_CORRECTION_COMMIT_FILE_UNAVAILABLE');return result.stdout;},now});
 need(r.schemaVersion===1&&r.historicalDiagnosisOnly===true&&r.earlierWindowsUnchanged===true&&r.financialFilesRead===false&&r.credentialsRead===false&&r.physicalSettlementConfirmed===true&&r.unresolvedResearchRetained===false&&/^[a-f0-9]{40}$/.test(sourceIdentityCorrection?.sourceCommit??r.sourceCommit),'SETTLED_HISTORICAL_RECEIPT_REQUIRED');
 need(before.accountId===manifest.accountId&&before.inceptionAt===manifest.inceptionAt&&!before.unresolvedResearch&&JSON.stringify(before.baselinePaths)===JSON.stringify(accountingPaths.slice(0,count)),'HISTORICAL_PREFIX_CHANGED');
 need(u&&u.closed===true&&u.inFlight===0&&u.waitingOrOperating===false&&Number.isSafeInteger(u.newUnits)&&u.newUnits>=0&&u.newUnits<=6&&Array.isArray(u.chapterPaths)&&u.chapterPaths.length>count&&u.chapterPaths.length<=count+6&&JSON.stringify(u.chapterPaths)===JSON.stringify(accountingPaths.slice(0,u.chapterPaths.length)),'HISTORICAL_SETTLEMENT_COUNTS');
 for(const next of u.chapterPaths.slice(count))need(path.dirname(next)===run+'/rpc'&&/^chapter-[0-9]{3}\.json$/.test(path.basename(next)),'HISTORICAL_COUNTER_SCOPE');
 need(u.cumulativeUnits===expectedAccounting.calls+u.newUnits&&u.accountedCumulativeResponseBytes===expectedAccounting.bytes+u.newAccountedResponseBytes&&Number.isSafeInteger(u.uncertainResponseBytes)&&u.uncertainResponseBytes>=expectedAccounting.uncertain,'HISTORICAL_COUNTER_TOTAL_MISMATCH');
 expectedAccounting={sourceCount:u.chapterPaths.length,calls:u.cumulativeUnits,bytes:u.accountedCumulativeResponseBytes,uncertain:u.uncertainResponseBytes,observed:u.accountedCumulativeResponseBytes-u.uncertainResponseBytes};
 supplementalHistorical.push({receipt:receiptPath,sha256:sha(raw),newUnits:u.newUnits,completed:r.completed,failure:r.failure,...(sourceIdentityCorrection?{sourceIdentityCorrection}:{}),physicalSettlementConfirmed:true,marketHistoryRewritten:false});
}
if(supplementalHistorical.length)handoff={...handoff,supplementalHistorical};
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
const linked=readResearchBaseline({paths:accountingPaths,now,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:448});
need(linked.sources.length===expectedAccounting.sourceCount&&linked.baseline.calls===expectedAccounting.calls&&linked.baseline.bytes===expectedAccounting.bytes&&linked.uncertainResponseBytes===expectedAccounting.uncertain&&(expectedAccounting.observed===undefined||linked.observedBytes===expectedAccounting.observed),'SETTLED_ACCOUNTING_MISMATCH');
// The original run/archive/source-prefix/historical checks and full raw-chain
// accounting verification above are mandatory BEFORE trusting a compact anchor.
// This is a quiescent first seal only; it does not prove in-process rollover.
let checkpointHandoff=null,runtimeLinked=linked;
if(inspectedAccounting.checkpoint){
 const anchor=inspectedAccounting.checkpoint;
 checkpointHandoff=verifyNativeInputCheckpointAccounting({checkpointPath:anchor.path,checkpointSha256:anchor.sha256,sourcePaths:accountingPaths,now,readBounded:read});
 runtimeLinked=readResearchBaseline({paths:manifest.baselinePaths,checkpointSha256:anchor.sha256,now,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:448});
 need(runtimeLinked.baseline.calls===linked.baseline.calls&&runtimeLinked.baseline.bytes===linked.baseline.bytes&&runtimeLinked.observedBytes===linked.observedBytes&&runtimeLinked.uncertainResponseBytes===linked.uncertainResponseBytes&&runtimeLinked.pendingOperations===linked.pendingOperations&&runtimeLinked.baseline.refusalAt===linked.baseline.refusalAt,'SEALED_ACCOUNTING_COUNTER_MISMATCH');
 handoff={...handoff,accountingCheckpoint:checkpointHandoff};
}
const priorCooldownUntil=Math.max(manifest.cooldownUntil??0,manifest.controlCooldownUntil??0);
need(Number.isSafeInteger(priorCooldownUntil)&&priorCooldownUntil>=0&&now>=priorCooldownUntil,'PROVIDER_COOLDOWN');
const input={schemaVersion:1,baselinePaths:manifest.baselinePaths,...(inspectedAccounting.checkpoint?{baselineCheckpointSha256:inspectedAccounting.checkpoint.sha256}:{}),priorPhysicalSettled:true,priorCooldownUntil,origins:[...origins.values()].sort((a,b)=>b.identity.chainBlockTime-a.identity.chainBlockTime).map(row=>row.proof),source:{commit:metadata.git.commit,sha256:metadata.bundle.sha256},dataContract:'confirmed-program-activity-v3-shadow',observationAgePolicy:'observation-age-selected-24h-study-v1',watchCheckpoint:structuredClone(watch),reportingBinding:binding};
validateNativeCandidateInput(input);
const encoded=JSON.stringify(input)+'\n';need(Buffer.byteLength(encoded)<=8*MIB,'INPUT_CAP');
const hintRows=latestHandoff?watch.rows.filter(row=>row.migrationAt===null&&row.verifiedAt===null):watch.rows.filter(row=>row.firstSeenAt>=discovery.startedAt);
const hints=hintRows.map(row=>{need(row.migrationAt===null&&row.verifiedAt===null&&Number.isSafeInteger(row.firstSeenAt)&&row.firstSeenAt<=now,'UNVERIFIED_HINT_CHANGED');if(!latestHandoff)need(row.mint===null&&row.pool===null&&row.state==='DISCOVERED','ORIGINAL_DISCOVERY_HINT_CHANGED');return {signature:row.signature,feedMint:row.feedMint,firstSeenAt:row.firstSeenAt,receiptAgeMs:now-row.firstSeenAt,state:row.state,migrationAt:null,currentPool:row.pool,semantics:'retained unverified discovery hint; receipt age is not migration age; no eligibility or activity inferred'};});
if(!latestHandoff)need(hints.length===discovery.migrationHints,'PRESERVED_HINT_COUNT_MISMATCH');
const provenance={schemaVersion:1,createdAt:now,source:input.source,dataContract:input.dataContract,observationAgePolicy:input.observationAgePolicy,baselineEntryAge:'5–120min unchanged; no financial execution',inputSha256:sha(encoded),inputBytes:Buffer.byteLength(encoded),baseline:{calls:linked.baseline.calls,accountedResponseBytes:linked.baseline.bytes,observedResponseBytes:linked.observedBytes,uncertainResponseBytes:linked.uncertainResponseBytes,pendingHistoricalReservations:linked.pendingOperations,sourceCount:runtimeLinked.sources.length,originalSourceCount:linked.sources.length,sha256:runtimeLinked.baseline.sha256,baselineCheckpointSha256:manifest.baselineCheckpointSha256??null,rawSourceHashes:linked.sources,rawInputBytes:linked.inputBytes,runtimeInputBytes:runtimeLinked.inputBytes},handoff,originCheckpointCount:checkpoint.origins.length,originCount:origins.size,excludedOrigins,origins:[...origins.values()].map(row=>({mint:row.identity.baseMint,pool:row.identity.pool,migrationAt:row.identity.chainBlockTime*1000,source:row.ref})),watchRows:watch.rows.length,unverifiedHints:hints,watchUnchangedFromSettledHandoff:true,reportingBinding:binding,inputs,sourceInputBytes:inputBytes,financialDatabaseOpened:false,financialStatusRead:false,credentialsRead:false,networkCalls:0,pilotManifestModified:false,externalLeaseHolder:leasePid,immutableSourceMeaning:'Executable/commit/configuration are frozen by reviewed metadata and stager; status uses input.source, not publication-time Git HEAD.'};
// Recheck source and manifest after all bounded decoding to reject concurrent
// source or accounting changes rather than exporting a mixed-time snapshot.
need(git('rev-parse','HEAD')===commit&&git('status','--porcelain','--untracked-files=all','--','src','scripts',':!node_modules')===''&&sha(fs.readFileSync(manifestPath))===sha(manifestRaw),'SOURCE_OR_ACCOUNTING_CHANGED_DURING_EXPORT');
function writeExclusive(file,bytes){const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
writeExclusive(output,encoded);writeExclusive(provenanceOutput,JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({...provenance,baseline:{...provenance.baseline,rawSourceHashes:undefined},inputs:undefined,origins:undefined,unverifiedHints:hints.map(({signature,...row})=>row),output,provenanceOutput}));

return provenance;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)prepareNativePublicInput();
