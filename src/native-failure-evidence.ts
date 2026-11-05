/** Optional, bounded current-run failure evidence. This is never a trading
 * permission, completeness proof, or financial durability requirement. */
import {constants,type Stats} from 'node:fs';
import {open,lstat,realpath,rename,unlink,type FileHandle} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';

export const NATIVE_FAILURE_EVIDENCE_POLICY=Object.freeze({
 version:'poe-current-native-failure-evidence-v1',file:'native-failure-evidence.json',
 pendingFile:'native-failure-evidence.pending.json',maximumRawSamples:8,
 maximumRawBytes:512*1024,maximumTransportSamples:24,
 maximumAuditSamples:8,maximumMissingSignaturesPerAudit:8,
 auditRetention:'LATEST_UNIQUE_CURRENT_RUN_ARRIVAL_ORDER',maximumIngressMatches:16,
 maximumDetailBytes:64*1024,maximumDetailRecordBytes:4096,maximumFileBytes:640*1024,
});
const P=NATIVE_FAILURE_EVIDENCE_POLICY;
export type NativeFailureIdentity={accountId:string;inceptionAt:number;configurationSha256:string;source:{commit:string;sha256:string};runId:string;startedAt:number};
type Data=Record<string,unknown>;
type Stored={kind:string;eventAt:number;eventTimeBasis:'ORIGINAL_PACKET_RECEIPT'|'PRODUCER_EVENT_TIMESTAMP';capturedAt:number;data:Data;retainedEventSha256:string;sourceFieldsOmitted:number};
type Stamp=Pick<Stats,'dev'|'ino'|'uid'|'gid'|'mode'|'nlink'|'size'|'mtimeMs'|'ctimeMs'>;
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const object=(value:unknown):value is Data=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const encode=(value:unknown)=>JSON.stringify(value);
const digest=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex');
function need(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
const same=(a:Stamp,b:Stamp)=>['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(k=>a[k as keyof Stamp]===b[k as keyof Stamp]);
const identityValid=(v:unknown):v is NativeFailureIdentity=>object(v)&&typeof v.accountId==='string'&&/^poe-[a-f0-9-]{36}$/.test(v.accountId)&&integer(v.inceptionAt)&&sha(v.configurationSha256)&&object(v.source)&&typeof v.source.commit==='string'&&/^[a-f0-9]{40}$/.test(v.source.commit)&&sha(v.source.sha256)&&integer(v.startedAt)&&typeof v.runId==='string'&&v.runId==='native-paper-'+new Date(v.startedAt).toISOString().replace(/[^0-9]/g,'');
const TRANSPORT=new Set(['native-flow-transport-integrity-gap','native-flow-protocol-refused','native-flow-control-refused','native-flow-suppressed-library-control','native-flow-disconnected','native-flow-raw-refusal-unavailable','pilot-data-control-unavailable']);
const DETAIL=new Set(['native-flow-refusal','native-flow-noncanonical-notification-refused']);
const NUMBERS=new Set(('at receivedAt availableAt slot connection connectionId subscription subscriptionId operationId opcode selectedScopes retryAt handlerStartedAt handlerElapsedMs receiptAgeAtHandlerMs requestStartedAt writeCallbackAt abortRequestedAt matchingPongReceiptAt matchingPongHandledAt unmatchedPongs unadmittedMatchingPongs rpcErrorCode socketState validationElapsedMs requiredEventRetentionMs supplementaryRawRetentionMs admissionAndCallbacksMs maximumProcessingMs maximumReceiptAgeMs rawPayloadBytes messages frames pendingEvents maximumPendingEvents maximumHandlerQueueMs maximumMessageSpanMs conservativeRoundTripAt transportReceiptLowerBoundAt nextHeartbeatAt previousDueAt handledAt controlCooldownUntil reservationsRetained').split(' '));
const FLAGS=new Set(('success duplicate correction defaultSignature selectedInformationAdmitted financialQualification requiresFreshWindow supportFresh candidateStillRegistered cancelled transportClosing transportClosed physicalSettlementClaimed writeCallbackSucceeded transportSettled expected physicalFrameSent originalSenderInvoked windowUsable partialMessage failed safeNonnegativeInteger retiredSubscriptionMatch activeSubscriptionMatch booleanResult physicalSettled publicRpcCooldownUnchanged').split(' '));
const HASHES=new Set(['rawHash','signatureSha256']);
const KEYS=new Set(['signature','mint','pool','subscriptionMint','subscriptionPool']);
const TEXT:Record<string,Set<string>>={method:new Set(['logsSubscribe','logsUnsubscribe','ping','pong','PING','PONG']),classification:new Set(['noncanonical-signature','unusable']),kind:new Set(['upgrade','logsSubscribe','logsUnsubscribe','ping']),resultType:new Set(['null','array','undefined','boolean','number','string','object','function','symbol','bigint'])};
const NESTED=new Set(['processingStages','receiptTiming','acknowledgement']);
const base58=(v:unknown)=>typeof v==='string'&&v.length<=88&&/^[1-9A-HJ-NP-Za-km-z]+$/.test(v);
function typed(input:Data,depth=0):{data:Data;omitted:number}{
 const data:Data={};let omitted=0;
 for(const [key,value]of Object.entries(input)){
  if(key==='receivedAt'&&!integer(value))omitted++;
  else if(NUMBERS.has(key)&&(value===null||typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER))data[key]=value;
  else if(FLAGS.has(key)&&(value===null||typeof value==='boolean'))data[key]=value;
  else if(HASHES.has(key)&&sha(value))data[key]=value;
  else if(KEYS.has(key)&&base58(value))data[key]=value;
  else if(TEXT[key]?.has(String(value)))data[key]=value;
  else if((key==='reason'||key==='code')&&typeof value==='string'){
   if(/^[A-Z][A-Z0-9_]{0,159}$/.test(value))data[key]=value;
   else{data[key]='OTHER_UNEXPORTED_REASON';data[key+'Sha256']=digest(value);omitted++;}
  }else if(NESTED.has(key)&&depth<1&&object(value)){
   const nested=typed(value,depth+1);data[key]=nested.data;omitted+=nested.omitted;
  }else omitted++;
 }
 return {data,omitted};
}

/** The router has already emitted these bounded diagnostic identities. Copy
 * only its typed fields; neither a match nor its absence supplies audit data. */
function auditIngressWitness(input:unknown,context:{mint:string;pool:string;target:Data;generation:unknown;availableAt:number;missing:string[];total:number;capturedAt:number}):Data{
 const unavailable=(reason:string)=>({kind:'NATIVE_MISSING_HISTORY_ROUTER_WITNESS',status:'UNAVAILABLE',reason,originalAuditOutcomeUnchanged:true,financialQualification:false});
 try{
  need(object(input),'INGRESS_OBJECT');
  if(input.status==='UNAVAILABLE')return unavailable('INGRESS_DIAGNOSTIC_UNAVAILABLE');
  const generation=(value:unknown):Data|null=>{if(value===null)return null;need(object(value)&&base58(value.mint)&&base58(value.pool)&&integer(value.openedAt)&&integer(value.connectionId)&&integer(value.subscriptionId),'INGRESS_GENERATION');return {mint:value.mint,pool:value.pool,openedAt:value.openedAt,connectionId:value.connectionId,subscriptionId:value.subscriptionId};};
  const requested=generation(input.requestedGeneration),expected=generation(context.generation),same=(a:unknown,b:unknown)=>encode(a)===encode(b),target=input.target,interval=input.requestedRoutingInterval,retention=input.retention;
  need(input.kind==='NATIVE_MISSING_HISTORY_ROUTER_WITNESS'&&input.version==='bounded-json-notification-router-v1'&&object(target)&&target.startAt===context.target.startAt&&target.endAt===context.target.endAt
   &&input.auditAvailableAt===context.availableAt&&integer(input.observedAt)&&input.observedAt>=context.availableAt&&input.observedAt<=context.capturedAt&&same(requested,expected)
   &&object(interval)&&interval.fromAt===(requested?.openedAt??context.target.startAt)&&interval.untilAt===context.availableAt
   &&Array.isArray(input.missingSignatures)&&same(input.missingSignatures,context.missing)&&input.missingSignaturesTotal===context.total&&input.missingSignaturesOmitted===context.total-context.missing.length
   &&object(retention)&&Array.isArray(input.matches)&&input.matches.length<=P.maximumIngressMatches,'INGRESS_SCOPE');
  const retained:Data={};for(const key of ['startedAt','rowsObserved','retainedRows','evictedRows','initialCallbacks','earlyAckReplays','noncanonicalSignatures','clockFaults']){need(integer(retention[key]),'INGRESS_RETENTION');retained[key]=retention[key];}
  need(retention.evictedThroughRoutedAt===null||integer(retention.evictedThroughRoutedAt),'INGRESS_RETENTION');retained.evictedThroughRoutedAt=retention.evictedThroughRoutedAt;
  need(Number(retention.retainedRows)<=2048&&Number(retention.retainedRows)<=Number(retention.rowsObserved)&&integer(input.matchingRows)&&input.matchingRows>=input.matches.length&&input.matchingRowsOmitted===input.matchingRows-input.matches.length&&integer(input.retainedRowsForRequestedGeneration)&&input.retainedRowsForRequestedGeneration<=Number(retention.retainedRows)&&typeof input.retainedRouterIntervalComplete==='boolean','INGRESS_COUNTS');
  need(input.retainedRouterIntervalComplete!==true||retention.clockFaults===0&&Number(retention.startedAt)<=Number(interval.fromAt)&&(retention.evictedThroughRoutedAt===null||Number(retention.evictedThroughRoutedAt)<Number(interval.fromAt)),'INGRESS_COMPLETE_ROUTER_INTERVAL');
  const stages=new Set(['INITIAL_CALLBACK','EARLY_ACK_REPLAY']),dispositions=new Set(['ROUTING','ACTIVE_PROCESSOR','QUEUED_BEFORE_ACK','ACK_RETIRED','UNRECOGNIZED_SUBSCRIPTION','EARLY_QUEUE_CAPACITY','IGNORED_SUSPENDED','IGNORED_UNREGISTERED','ROUTER_REFUSED']),refusals=new Set(['NATIVE_FLOW_RPC_ENVELOPE','NATIVE_FLOW_NOTIFICATION_SCHEMA','NATIVE_FLOW_UNSCOPED_NOTIFICATION','NATIVE_FLOW_SIGNATURE','NATIVE_FLOW_CLEANUP_DEADLINE_OR_GENERATION','OTHER_ROUTER_REFUSAL']);
  const matches=input.matches.map(raw=>{need(object(raw)&&integer(raw.sequence)&&raw.sequence>0&&typeof raw.signature==='string'&&context.missing.includes(raw.signature)&&integer(raw.connectionId)&&stages.has(String(raw.stage))&&dispositions.has(String(raw.disposition))&&(raw.refusalCode===null||refusals.has(String(raw.refusalCode))),'INGRESS_MATCH');
   for(const key of ['slot','receivedAt','routedAt','subscriptionId'])need(raw[key]===null||integer(raw[key]),'INGRESS_MATCH_TIME');need(raw.success===null||typeof raw.success==='boolean','INGRESS_MATCH_STATUS');
   const routedGeneration=generation(raw.generationAtRouting),equals=requested===null?null:requested!==null&&routedGeneration!==null&&same(requested,routedGeneration),afterAck=requested===null||raw.receivedAt===null?null:Number(raw.receivedAt)>=Number(requested.openedAt),inInterval=raw.routedAt!==null&&Number(raw.routedAt)>=Number(interval.fromAt)&&Number(raw.routedAt)<=context.availableAt;
   need(raw.generationAtRoutingEqualsRequested===equals&&raw.receivedAfterRequestedAck===afterAck&&raw.inRequestedRoutingInterval===inInterval,'INGRESS_MATCH_BINDING');
   return {sequence:raw.sequence,signature:raw.signature,slot:raw.slot,success:raw.success,receivedAt:raw.receivedAt,routedAt:raw.routedAt,connectionId:raw.connectionId,subscriptionId:raw.subscriptionId,generationAtRouting:routedGeneration,stage:raw.stage,disposition:raw.disposition,refusalCode:raw.refusalCode,generationAtRoutingEqualsRequested:equals,receivedAfterRequestedAck:afterAck,inRequestedRoutingInterval:inInterval};});
  for(const key of ['wholeSocketReceiptTrace','missingTransactionRelevanceEstablished','providerLossProved','localLossProved','financialQualification'])need(input[key]===false,'INGRESS_NO_AUTHORITY');need(input.originalAuditOutcomeUnchanged===true,'INGRESS_NO_AUTHORITY');
  return {kind:input.kind,version:input.version,target:{startAt:target.startAt,endAt:target.endAt},auditAvailableAt:input.auditAvailableAt,observedAt:input.observedAt,requestedGeneration:requested,requestedRoutingInterval:{fromAt:interval.fromAt,untilAt:interval.untilAt},missingSignatures:[...context.missing],missingSignaturesTotal:context.total,missingSignaturesOmitted:context.total-context.missing.length,retention:retained,matchingRows:input.matchingRows,matchingRowsOmitted:input.matchingRowsOmitted,retainedRowsForRequestedGeneration:input.retainedRowsForRequestedGeneration,retainedRouterIntervalComplete:input.retainedRouterIntervalComplete,matches,sourceMatchesSha256:digest(encode(matches)),recordBudgetMatchesOmitted:0,wholeSocketReceiptTrace:false,missingTransactionRelevanceEstablished:false,providerLossProved:false,localLossProved:false,financialQualification:false,originalAuditOutcomeUnchanged:true};
 }catch{return unavailable('INGRESS_DIAGNOSTIC_SCHEMA_REFUSED');}
}

/** Compact failure witness only. No successful payload, arbitrary error text,
 * reconstructed packet receipt, or external-versus-local loss claim is copied. */
function missingAuditWitness(value:Data,capturedAt:number):{data:Data;omitted:number}|null{
 const r=value.result;if(!object(r)||r.status!=='unusable'||r.reason!=='NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED')return null;
 if(Array.isArray(r.missingSuccessfulNotifications)&&r.missingSuccessfulNotifications.length===0)return null;
 need(base58(value.mint)&&base58(r.pool)&&integer(value.availableAt)&&integer(r.startedAt)&&integer(r.availableAt)&&r.startedAt<=r.availableAt&&r.availableAt<=value.availableAt,'AUDIT_TIME');
 const target=r.target,fences=r.strictInteriorSlots,snapshot=r.notificationSnapshot,tail=r.postSnapshotTail,missing=r.missingSuccessfulNotifications;
 need(object(target)&&integer(target.startAt)&&integer(target.endAt)&&target.endAt-target.startAt===60000&&target.endAt<=r.startedAt
  &&object(fences)&&integer(fences.lower)&&integer(fences.upper)&&fences.lower<fences.upper&&r.historyRangeCovered===true
  &&object(snapshot)&&integer(snapshot.capturedAt)&&integer(snapshot.rows)&&integer(snapshot.requiredRows)
  &&object(tail)&&(tail.refreshedAt===null||integer(tail.refreshedAt))&&integer(tail.rows)
  &&integer(r.historyRows)&&integer(r.interiorRows)&&integer(r.requestAttempts)
  &&Array.isArray(missing)&&missing.length>0&&missing.length<=6000,'AUDIT_WITNESS_SCHEMA');
 const generation=tail.generation;
 need(generation===null||object(generation)&&generation.mint===value.mint&&generation.pool===r.pool
  &&integer(generation.openedAt)&&generation.openedAt<=target.startAt&&integer(generation.connectionId)&&integer(generation.subscriptionId),'AUDIT_GENERATION');
 const lower=fences.lower,upper=fences.upper;
 const rows=missing.map(row=>{need(object(row)&&base58(row.signature)&&integer(row.slot)&&row.slot>lower&&row.slot<upper
  &&row.success===true&&['confirmed','finalized'].includes(String(row.confirmationStatus))&&(row.blockTime===null||integer(row.blockTime)),'AUDIT_MISSING_ROW');
  return {signature:row.signature,slot:row.slot,success:true,confirmationStatus:row.confirmationStatus,blockTime:row.blockTime};});
 const selected=rows.slice(0,P.maximumMissingSignaturesPerAudit);
 const result={status:'unusable',reason:r.reason,complete:false,notificationCompletenessVerified:false,executedFlowCompletenessVerified:false,pool:r.pool,target:{startAt:target.startAt,endAt:target.endAt},startedAt:r.startedAt,availableAt:r.availableAt,
  strictInteriorSlots:{lower:fences.lower,upper:fences.upper},historyRangeCovered:true,historyRows:r.historyRows,interiorRows:r.interiorRows,requestAttempts:r.requestAttempts,
  notificationSnapshot:{capturedAt:snapshot.capturedAt,rows:snapshot.rows,requiredRows:snapshot.requiredRows},
  postSnapshotTail:{generation:generation===null?null:{mint:generation.mint,pool:generation.pool,openedAt:generation.openedAt,connectionId:generation.connectionId,subscriptionId:generation.subscriptionId},refreshedAt:tail.refreshedAt,rows:tail.rows},
  missingSuccessfulNotifications:selected,missingSuccessfulNotificationsTotal:rows.length,missingSuccessfulNotificationsOmitted:rows.length-selected.length,
  missingSuccessfulNotificationsSha256:digest(encode(rows)),witnessOnly:true,sourceDeliveryCausality:'UNDETERMINED_NO_COMPLETE_RECEIPT_TRACE'};
 const notificationIngress=value.notificationIngress===undefined?undefined:auditIngressWitness(value.notificationIngress,{mint:value.mint as string,pool:r.pool as string,target,generation,availableAt:r.availableAt as number,missing:selected.map(row=>row.signature as string),total:rows.length,capturedAt});
 return {data:{at:value.availableAt,mint:value.mint,availableAt:value.availableAt,result,...(notificationIngress===undefined?{}:{notificationIngress})},omitted:Object.keys(value).filter(key=>!['mint','availableAt','result','notificationIngress'].includes(key)).length+Object.keys(r).filter(key=>!Object.hasOwn(result,key)).length};
}

/** The caller already holds the native-engine single-writer lease. Only these
 * two fixed files belong to this helper; no directory scan or historical import. */
export class NativeFailureEvidence {
 private identity:NativeFailureIdentity|null=null;
 private directory='';private directoryHandle:FileHandle|null=null;private directoryStamp:Stamp|null=null;
 private targetStamp:Stamp|null=null;private initialized=false;private task:Promise<void>|null=null;
 private revision=1;private publishedRevision=0;private closing=false;private closed=false;
 private failure:string|null=null;private previousRunDiscarded=false;
 private raw:string[]=[];private details:string[]=[];private transport:string[]=[];private audits:string[]=[];
 private rawBytes=0;private detailBytes=0;private rawKeys=new Set<string>();private transportKeys=new Set<string>();
 private lastDetail:Stored|null=null;private auditKeys=new Set<string>();
 private auditOrderKeys:string[]=[];private transportOrderKeys:string[]=[];
 private counts={rawSamplesOmitted:0,rawDuplicates:0,detailRecordsOmitted:0,transportSamplesOmitted:0,transportDuplicates:0,transportSamplesEvictedForAudit:0,auditSamplesOmitted:0,auditDuplicates:0,auditSamplesEvicted:0,malformedSelectedEvents:0,ioFailures:0};
 constructor(input:{directory:string;identity:NativeFailureIdentity;now?:()=>number}){
  this.now=input.now??Date.now;
  try{need(isAbsolute(input.directory)&&resolve(input.directory)===input.directory,'DIRECTORY_IDENTITY');need(identityValid(input.identity),'SOURCE_RUN_IDENTITY');this.directory=input.directory;const id=input.identity;this.identity={accountId:id.accountId,inceptionAt:id.inceptionAt,configurationSha256:id.configurationSha256,source:{commit:id.source.commit,sha256:id.source.sha256},runId:id.runId,startedAt:id.startedAt};this.schedule();}
  catch{this.failure='INVALID_IDENTITY';}
 }
 private readonly now:()=>number;
 private path(file:string){need(this.directoryHandle!==null,'DIRECTORY_UNAVAILABLE');return '/proc/self/fd/'+this.directoryHandle!.fd+'/'+file;}
 private privateFile(s:Stats){need(s.isFile()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o600&&s.nlink===1&&s.size>0&&s.size<=P.maximumFileBytes,'PRIVATE_FILE');}
 private async named(file:string){try{return await lstat(this.path(file));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
 private async readExisting(file:string):Promise<{stamp:Stats;value:Data}|null>{
  let fd:FileHandle;try{fd=await open(this.path(file),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  try{
   const before=await fd.stat();this.privateFile(before);const raw=Buffer.alloc(before.size+1);let offset=0;
   while(offset<raw.length){const read=await fd.read(raw,offset,raw.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
   const named=await this.named(file);need(offset===before.size&&same(before,await fd.stat())&&named&&same(before,named),'CHANGED_FILE');
   const value:unknown=JSON.parse(raw.subarray(0,offset).toString());need(object(value)&&value.kind===P.version&&value.schemaVersion===1&&identityValid(value.identity),'OWNED_SNAPSHOT');
   need((value as Data).financialWrites===0&&(value as Data).tradingAuthority===false,'OWNED_DIAGNOSTIC');
   return {stamp:before,value:value as Data};
  }finally{await fd.close();}
 }
 private async initialize(){
  need(await realpath(this.directory)===this.directory,'CANONICAL_DIRECTORY');
  this.directoryHandle=await open(this.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const stat=await this.directoryHandle.stat();need(stat.isDirectory()&&stat.uid===process.getuid?.()&&(stat.mode&0o077)===0,'PRIVATE_DIRECTORY');this.directoryStamp=stat;
  const previous=await this.readExisting(P.file),pending=await this.readExisting(P.pendingFile);
  for(const row of [previous,pending])if(row){const id=row.value.identity as NativeFailureIdentity;need(id.accountId===this.identity!.accountId&&id.inceptionAt===this.identity!.inceptionAt&&id.startedAt<this.identity!.startedAt,'OLDER_OWNED_RUN_REQUIRED');}
  this.targetStamp=previous?.stamp??null;this.previousRunDiscarded=previous!==null;
  // A complete, verified older temporary belongs to this exact namespace.
  // Unknown/partial temporary files refuse optional capture and remain untouched.
  if(pending){const named=await this.named(P.pendingFile);need(named&&same(named,pending.stamp),'CHANGED_PENDING');await unlink(this.path(P.pendingFile));}
  this.initialized=true;
 }
 private async targetUnchanged(){
  const namedDirectory=await lstat(this.directory);need(this.directoryStamp&&namedDirectory.isDirectory()&&namedDirectory.dev===this.directoryStamp.dev&&namedDirectory.ino===this.directoryStamp.ino&&namedDirectory.uid===this.directoryStamp.uid&&(namedDirectory.mode&0o077)===0,'CHANGED_DIRECTORY');
  const current=await this.named(P.file);need(this.targetStamp?current&&same(this.targetStamp,current):current===null,'CHANGED_TARGET');
 }
 private serialize(){
  const records=[...this.raw,...this.details,...this.transport,...this.audits].join(',');
  const header={schemaVersion:1,kind:P.version,identity:this.identity,capturedAt:this.now(),revision:this.revision,closed:this.closing,previousRunEvidenceImported:false,previousRunDiscarded:this.previousRunDiscarded,
   policy:P,rawSamples:this.raw.length,rawSampleBytes:this.rawBytes,auditSamples:this.audits.length,detailRecordBytes:this.detailBytes,counts:{...this.counts},
   completeness:'BOUNDED_FAILURE_SAMPLES_ONLY; COUNTERS_AS_OF_THIS_WRITE; NOT_A_COMPLETE_CENSUS',durability:'ATOMIC_BUFFERED_WRITE_WITHOUT_FSYNC',financialWrites:0,tradingAuthority:false};
  const raw=encode(header).slice(0,-1)+',"records":['+records+']}\n';need(Buffer.byteLength(raw)<=P.maximumFileBytes,'FILE_BOUND');return raw;
 }
 private async publish(raw:string){
  await this.targetUnchanged();const path=this.path(P.pendingFile);let fd:FileHandle|null=null,owned:Stamp|null=null;
  try{
   fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);owned=await fd.stat();
   need(owned.uid===process.getuid?.()&&(owned.mode&0o777)===0o600&&owned.nlink===1,'PENDING_PRIVATE_FILE');await fd.writeFile(raw);
   const written=await fd.stat();this.privateFile(written);need(written.size===Buffer.byteLength(raw),'WRITE_BOUND');await fd.close();fd=null;
   const pending=await this.named(P.pendingFile);need(pending&&same(written,pending),'CHANGED_PENDING');await this.targetUnchanged();
   await rename(path,this.path(P.file));const published=await this.named(P.file);need(published&&published.dev===written.dev&&published.ino===written.ino&&published.size===written.size,'PUBLISHED_FILE');this.privateFile(published!);this.targetStamp=published;
  }finally{
   if(fd)await fd.close();
   if(owned){const pending=await this.named(P.pendingFile);if(pending&&pending.dev===owned.dev&&pending.ino===owned.ino)await unlink(path);}
  }
 }
 private schedule(){
  if(this.task||this.failure||this.closed)return;
  this.task=Promise.resolve().then(async()=>{
   if(!this.initialized)await this.initialize();
   while(this.publishedRevision<this.revision){const revision=this.revision;await this.publish(this.serialize());this.publishedRevision=revision;}
  }).catch(()=>{this.counts.ioFailures++;this.failure='OPTIONAL_FAILURE_EVIDENCE_UNAVAILABLE';}).finally(()=>{this.task=null;if(!this.failure&&!this.closed&&this.publishedRevision<this.revision)this.schedule();});
 }
 private stored(kind:string,data:Data,omitted=0):Stored{
  const at=data.receivedAt??data.at;need(integer(at)&&at>=this.identity!.startedAt&&at<=this.now()+5000,'EVENT_TIME');
  return {kind,eventAt:at as number,eventTimeBasis:integer(data.receivedAt)?'ORIGINAL_PACKET_RECEIPT':'PRODUCER_EVENT_TIMESTAMP',capturedAt:this.now(),data,retainedEventSha256:digest(encode({kind,data})),sourceFieldsOmitted:omitted};
 }
 private count(key:Exclude<keyof NativeFailureEvidence['counts'],'ioFailures'>){
  this.counts[key]++;
  // Surface the first omission without converting repeated identical failures
  // into a write loop. Later counters are included in the next sample or close.
  if(this.counts[key]===1){this.revision++;this.schedule();}
 }
 /** Only already-emitted bounded samples and typed failures enter this path.
  * Successful packet events, ordinary reports and controls do no work here. */
 observe(kind:string,value:unknown):void{
  if(this.closed||this.closing||this.failure||!this.identity||kind!=='native-candidate-window-audit'&&kind!=='native-flow-raw-refusal'&&!DETAIL.has(kind)&&!TRANSPORT.has(kind))return;
  try{
   need(object(value),'EVENT_OBJECT');
   if(DETAIL.has(kind)){const projected=typed(value);this.lastDetail=this.stored(kind,projected.data,projected.omitted);return;}
   if(kind==='native-candidate-window-audit'){
    const projected=missingAuditWitness(value,this.now());if(!projected)return;const result=projected.data.result as Data;
    const key=encode([projected.data.mint,result.pool,result.target,(result.postSnapshotTail as Data).generation,result.missingSuccessfulNotificationsSha256]);
    if(this.auditKeys.has(key)){this.count('auditDuplicates');return;}
    let text=encode(this.stored(kind,projected.data,projected.omitted)),bytes=Buffer.byteLength(text);const ingress=projected.data.notificationIngress as Data|undefined,sourceWitnessSha256=ingress?digest(encode(ingress)):undefined;
    // The existing4KiB event limit remains authoritative. The source match
    // hash covers every typed emitted match, including explicitly omitted rows.
    while(bytes>P.maximumDetailRecordBytes&&ingress&&Array.isArray(ingress.matches)&&ingress.matches.length){ingress.matches.pop();ingress.recordBudgetMatchesOmitted=Number(ingress.recordBudgetMatchesOmitted)+1;ingress.matchingRowsOmitted=Number(ingress.matchingRowsOmitted)+1;text=encode(this.stored(kind,projected.data,projected.omitted));bytes=Buffer.byteLength(text);}
    if(bytes>P.maximumDetailRecordBytes&&ingress&&Array.isArray(ingress.matches)){
     projected.data.notificationIngress={kind:ingress.kind,version:ingress.version,status:'SUMMARY_ONLY_RECORD_BUDGET',sourceWitnessSha256,sourceMatchesSha256:ingress.sourceMatchesSha256,matchingRows:ingress.matchingRows,matchingRowsOmitted:ingress.matchingRows,recordBudgetMatchesOmitted:ingress.recordBudgetMatchesOmitted,wholeSocketReceiptTrace:false,providerLossProved:false,localLossProved:false,financialQualification:false,originalAuditOutcomeUnchanged:true};text=encode(this.stored(kind,projected.data,projected.omitted));bytes=Buffer.byteLength(text);
    }
    // Share the original transport/detail budget so the existing exporter sees
    // no more than40 records and the same64KiB detail /640KiB file limits.
    if(bytes>P.maximumDetailRecordBytes){this.count('auditSamplesOmitted');return;}
    // Reserve no extra bytes or records. New audit witnesses replace the
    // oldest audit at the audit cap, or oldest transport under shared pressure.
    while(this.audits.length>=P.maximumAuditSamples||this.transport.length+this.audits.length>=P.maximumTransportSamples||this.detailBytes+bytes>P.maximumDetailBytes){
     if(this.audits.length>=P.maximumAuditSamples||!this.transport.length&&this.audits.length){const old=this.audits.shift()!;this.auditKeys.delete(this.auditOrderKeys.shift()!);this.detailBytes-=Buffer.byteLength(old);this.counts.auditSamplesEvicted++;}
     else if(this.transport.length){const old=this.transport.shift()!;this.transportKeys.delete(this.transportOrderKeys.shift()!);this.detailBytes-=Buffer.byteLength(old);this.counts.transportSamplesEvictedForAudit++;}
     else{this.count('auditSamplesOmitted');return;}
    }
    this.audits.push(text);this.auditKeys.add(key);this.auditOrderKeys.push(key);this.detailBytes+=bytes;
   }else if(kind==='native-flow-raw-refusal'){
    need(value.supplementaryOnly===true&&Array.isArray(value.logs)&&value.logs.every(v=>typeof v==='string')&&integer(value.slot)&&integer(value.receivedAt)&&typeof value.reason==='string','EXPLICIT_RAW_REFUSAL');
    const envelope=encode({kind,data:value}),bytes=Buffer.byteLength(envelope),key=digest(envelope);
    if(this.rawKeys.has(key)){this.count('rawDuplicates');return;}
    if(this.raw.length>=P.maximumRawSamples||this.rawBytes+bytes>P.maximumRawBytes){this.count('rawSamplesOmitted');return;}
    const data=JSON.parse(envelope).data as Data,record=this.stored(kind,data),detail=this.lastDetail;
    if(detail&&detail.data.slot===data.slot&&detail.data.receivedAt===data.receivedAt&&detail.data.reason===data.reason&&(data.signature?detail.data.signature===data.signature:data.rawHash===detail.data.rawHash)){
     const text=encode(detail);if(Buffer.byteLength(text)<=P.maximumDetailRecordBytes&&this.detailBytes+Buffer.byteLength(text)<=P.maximumDetailBytes){this.details.push(text);this.detailBytes+=Buffer.byteLength(text);}else this.count('detailRecordsOmitted');
    }else this.count('detailRecordsOmitted');
    this.raw.push(encode(record));this.rawBytes+=bytes;this.rawKeys.add(key);
   }else{
    if(kind==='native-flow-disconnected'&&value.expected===true)return;
    const projected=typed(value),record=this.stored(kind,projected.data,projected.omitted),text=encode(record),bytes=Buffer.byteLength(text);
    const key=encode([kind,record.data.reasonSha256??record.data.reason??record.data.codeSha256??record.data.code??null,record.data.connectionId??record.data.connection??null,record.data.mint??record.data.subscriptionMint??null,record.data.pool??record.data.subscriptionPool??null]);
    if(this.transportKeys.has(key)){this.count('transportDuplicates');return;}
    if(this.transport.length+this.audits.length>=P.maximumTransportSamples||bytes>P.maximumDetailRecordBytes||this.detailBytes+bytes>P.maximumDetailBytes){this.count('transportSamplesOmitted');return;}
    this.transport.push(text);this.detailBytes+=bytes;this.transportKeys.add(key);this.transportOrderKeys.push(key);
   }
   this.revision++;this.schedule();
  }catch{this.count('malformedSelectedEvents');}
 }
 usage(){return {available:this.failure===null,reason:this.failure,rawSamples:this.raw.length,rawSampleBytes:this.rawBytes,transportSamples:this.transport.length,auditSamples:this.audits.length,packetDetails:this.details.length,detailRecordBytes:this.detailBytes,revision:this.revision,publishedRevision:this.publishedRevision,pending:this.task!==null,...this.counts,financialWrites:0,tradingAuthority:false};}
 async flush(){do{this.schedule();if(this.task)await this.task;}while(this.task||!this.failure&&!this.closed&&this.publishedRevision<this.revision);}
 async close(){if(this.closed)return;this.closing=true;this.revision++;await this.flush();this.closed=true;try{await this.directoryHandle?.close();}catch{this.counts.ioFailures++;this.failure='OPTIONAL_FAILURE_EVIDENCE_UNAVAILABLE';}this.directoryHandle=null;}
}
