#!/usr/bin/env python3
"""Fixed-path read-only, bounded current-run diagnostic export; no ledger API."""
import hashlib,json,math,os,pathlib,stat,sys,time,datetime

ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION=1793052456212
SOURCE={'commit':'ba33ee535ad1703da36905a5e2f44088ae19a43d','sha256':'870ac98a2377fefde564b9a3a252a7cc7cb3a561582abd48bda22ee18a14bee7'}
CONFIGURATION='797f8c1f0a1e23a9771b05356ff51d71f081b520e994f4cf6b2ed1c7c44c6511'
RUN='native-paper-20261029221651345'
STARTED=1793312211345
START,END=1793312985000,1793313210000 #22:29:45 through22:33:30UTC exclusive
ROOT=pathlib.Path('/var/lib/poe/native-engine')
OUTPUT=pathlib.Path('/var/lib/poe-public/current-run-forensics-20261029.json')
UID,GID=988,982
MAX_STATUS=4*1024*1024
MAX_STATE=1024*1024
MAX_SEGMENT=8*1024*1024
MAX_SCAN_BYTES=64*1024*1024
MAX_LINE=65536
MAX_FILES=16
MAX_DIRECTORY_ENTRIES=4096
MAX_FACTS=192
MAX_OUTPUT=131072
MAX_FACT_BYTES=85000
MAX_SECONDS=2.0
EVENT_KINDS=frozenset('native-paper-source-unavailable native-paper-admission-suspended native-paper-discovery-start-unavailable native-paper-watch-start-unavailable native-paper-backup-preparation-deferred native-paper-local-phase native-paper-reporting-overrun native-paper-audit-readiness-unavailable native-paper-recovery-start native-paper-recovery-ready native-paper-watch-unavailable trader-context trader-held-evaluation trader-execution trader-pilot-execution-refusal trader-pilot-execution-quote trader-quote native-paper-financial-readiness-recovered native-audit-dispatch-state native-audit-dispatch-summary native-predictive-window-expired native-candidate-window-audit-unavailable native-candidate-work-unavailable native-candidate-quality-gap native-candidate-window-audit native-audit-late-page native-candidate-audit-session-open native-candidate-audit-cancelled-after-page-return native-candidate-audit-cancelled-diagnostic native-flow-disconnected native-flow-service-deferred native-flow-support-refresh-deferred native-flow-control-refused component-job-enqueued component-pacing-wait component-physical-start component-physical-timeout component-physical-settled http-headers http-response-timing http-lifecycle-timing pilot-rpc-unavailable pilot-data-control-unavailable pilot-derived-status-flush-unavailable pilot-query-timeout-unavailable rpc-market-quote'.split())
# Only known field names reach output. Unknown values are never copied verbatim.
SCALAR_KEYS=frozenset('availableAt responseReceivedAt firstBodyAt lastBodyAt bodyCompleteAt jsonDecodedAt httpWorkEndedAt chunksReceived aborted headersDelayMs bodyAfterHeadersMs jsonDecodeMonotonicMs undiciRequestCreatedAt undiciSendHeadersHookAt undiciResponseHeadersAt undiciRequestErrorAt undiciRequestCreatedDelayMs undiciHeadersDispatchDelayMs undiciResponseHeadersDelayMs undiciSocketId undiciSocketPreviouslyObserved undiciSocketPreviousRequestAt undiciResponseStatus undiciMatchedRequestCount undiciSendHeadersHookCount undiciObservedEvents cooldownUntil primaryRpcCooldownUntil queryCooldownUntil queryFailures physicalSettled reservationsRetained automaticRetry transitionRecord physicalStartClaimed connected discoveryConnected watchConnected physicalTransportsSettled sharedOperationActive nativePhysicalOperations receivedBoundNotifications parsedMessages notifications receivedMessages acceptedMessages rejectedMessages memoryPressure stopped maximumCandidates candidates retiring user system cpuFraction rssBytes sampleAt availableMemoryBytes generation closingSettled restartRequired lastNotificationAt lastFreshSupportAt lastBankClockAt lastAuditAt lastPredictiveAt financialReconciliationAt mean maximum minimum p95 p99 at completedAt evaluatedAt quoteAt sourceValidUntil requestedAt receivedAt validatedAt enqueuedAt reservedAt invokedAt startedAt generatedAt elapsedMs maximumMs totalMs cpuMicros count overruns declaredBoundMs overrun earliestCandidateDeadlineAt readyCandidates deadlineAt decisionDeadlineAt windowEndAt firstReadyAt lastAt transitionRecords omittedTransitions final physicalSettlementClaimed financialPriorityUnchanged elapsedMonotonicMs callbackLatenessMs timerScheduledAt scheduledAt requestedTimeoutMs scheduledDelayMs id operationId waitMs responseComplete uncertainReservedBytes status responseBytes bodyBytes responseSize requestBytes bytesRead firstByteAt headersAt bodyCompletedAt decodeMs processingMs transportMs inFlight waitingOrOperating rolling60SecondStarts rolling10SecondStarts startsPerMinuteLimit startsPer10SecondLimit rpcReadyAt historyReadyAt controlReadyAt physicalBusy actualPhysicalBusy providerCooldownUntil historyCooldownUntil controlCooldownUntil nextNativeServiceAt nativeServiceSlackMs pageOperationBoundMs page readyOrder sessionOpened selectedMint verifiedAt supportExpiresAt supportFresh sourceSupportFresh sourceExpiresAt bankClockAt hasQualityLoss connection retryAt deferredUntilAt notificationCapturePreserved physicalRequestStarted capturedAt maximumProjectionMs projectionOverruns deferrals targetMs localProjectionBudgetMs networkPublisherIndependent localPublicStatusAvailable financialProjectionReady cadenceMs maximumCompletedGapMs maximumQuoteAgeAtUseMs protectionBreaches unavailableChecks firstCompletedProtectionAt lastCompletedProtectionAt completedEvaluationBoundaryMs targetCadenceMs experimentalCompletedEvaluationLimitMs boundaryMs recoveryComplete idle evidenceAvailable financialAvailable uncertainActions automaticRecoveryAllowed entriesEnabled stopRequested lossPaused paused reconciledAt revision pendingAgeMs maximumObservedDirtyAgeMs attempts failures totalRecordedBytes retiredBytes protectedBytes refusedRecords refusedBytes optionalOmittedRecords optionalOmittedBytes retainedDiagnosticBytes diagnosticBytes diagnosticLimitBytes effectiveDiagnosticBytes requiredRecords candidateAdmissionAllowed requiresCriticalRecovery availableDiskBytes minimumDiskReserveBytes minimumRetainedMs continuousRotation maintenanceInFlight maximumDirtyAgeMs maximumDelayMs flushFailures passiveReceiptCalls coalescedPassiveReceipts lastGeneratedAt lastFailureAt pendingSinceAt dirty cumulativeUnits newUnits actualInvokedUnits cumulativeResponseBytes httpBytes wsBytes newResponseBytes remainingGrantUnits remainingCumulativeUnits remainingGrantResponseBytes remainingCumulativeResponseBytes uncertainResponseBytes actualInvocations responseComplete storageFailed closed continuousAccounting totalMs maximumRss eventBytes eventLoopDelayP95Ms active held nextDueAt usable pendingExit sourceContextAt sourceAgeMs maxLatencyMs quoteAgeMs poolCount accountCount requests maximumResponseBytes sourceAdmissionAllowed economicQualificationUnchanged unsafeContext financialExposureRetained holdingManagerContinues failed completed maximumAtAtSourceMs lastCompletedAt currentAt sourceCurrent sourceAvailable requestStartedAt writeCallbackAt writeCallbackSucceeded abortRequestedAt acknowledgementAt canceled cancelled transportClosing requestCount httpTimeouts httpErrors throttles rollingStartsPerMinute minimumSpacingMs maximumStartsPerMinute nativeStreamBytes broadWatchBytes requestStarted budgetAvailable resourceAvailable guardOpen admitted latestStartAt localRetryDeferredCount providerOrQueryBlockedCount earliestLocalRetryAt nextCeilingRefreshAt jobDeadlineAt dispatchContextObservedAt'.split())
OBJECT_KEYS=frozenset('cpu queueAgeMs transportRecovery kind byOperation controls financial usage rpc chapterUsage persistence derivedStatus reporting localPhases timing financialReadiness safety maintenance internalShutdownProof evidenceRetention resourceControl resources provider sourceRecovery protection context lastState dispatchTrace auditDispatchTrace reasonCounts limits dispatchWindow rpcDispatchWindow historyDispatchWindow controlDispatchWindow managementReserve native sourceTimes acknowledgement'.split())
ARRAY_KEYS=frozenset(('durationsMs','pending','actualInvocations','scopes','openProtectionGaps','auditDispatchTrace'))
STRING_KEYS=frozenset('domain scope undiciObservation undiciRequestErrorCode connectionReuse derivedEntryReason pauseReason kind transport method reason reasonCode outcome action state lastDeferral nextAction nextNativeServiceAction nextNativeServiceDomain serviceResult serviceReason lastOutcome phase purpose version haltedReason fatal quotePurpose error code mint pool selectedMint orderId requestId runId'.split())
DYNAMIC_KEYS=frozenset('scheduler-wait scheduler-refusal page-admission page-response page-refusal page-deferred page-not-exposed work-exception backup-start candidate-entry-preparation entry-checkpoint service-startup-report ownership-and-maintenance report-checkpoint candidate-shared-step backup-prepare-after-lease protection pending execution entry-preparation selected-source-dispatch candidate-step held-context protective-exit audit-selected peer-selected eligible native-service-wait native-service-dispatch native-service-return rpc-gate-wait ceiling-backoff ceiling-refresh prepare-native-runway dispatch-none getMultipleAccounts getAccountInfo getSignaturesForAddress getTransaction getBlockTime getSlot http:getMultipleAccounts http:getAccountInfo http:getSignaturesForAddress ws:logsSubscribe ws:logsUnsubscribe ws:ping ws:pong ws-upgrade:upgrade'.split())
STATIC_STRINGS=frozenset('bounded-native-audit-dispatch-v1 observed unavailable-no-matched-events unavailable-listener-observation ambiguous-multiple-request-or-send same-socket-observed-at-prior-request-hook http ws ws-upgrade getMultipleAccounts getAccountInfo getSignaturesForAddress getTransaction getBlockTime getSlot logsSubscribe logsUnsubscribe ping pong upgrade protection pending source idle flat held unavailable ready running complete failed normal pressure requested finished job wait decision-deadline-expired superseded-target new-ack-generation hold sell stop-loss take-profit trailing-profit-protection maximum-holding-time native-service-shared-pacing native-rpc-shared-pacing completed awaiting fresh-current-run-reporting verified observation-only native-audit-dispatch-diagnostics-v1 financial-readiness-v1'.split())
STATIC_CODES=frozenset('COMPONENT_PHYSICAL_TIMEOUT COMPONENT_HTTP_429 COMPONENT_HTTP_TRANSPORT COMPONENT_STORAGE_UNAVAILABLE PILOT_RPC_COOLDOWN PILOT_MARKET_READ_IN_FLIGHT PILOT_MARKET_CLOCK RESEARCH_HELD_SOURCE_AGE RESEARCH_HELD_CLOCK_AGE RESEARCH_HELD_INTERRUPTED_CONTEXT RESEARCH_PACING_PHYSICAL_SLOT_OCCUPIED NATIVE_AUDIT_NOT_COMPLETED NATIVE_AUDIT_SESSION_DEADLINE NATIVE_AUDIT_SESSION_CANCELLED NATIVE_AUDIT_UNAVAILABLE NATIVE_FLOW_TRANSPORT_CLOSED POE_ENTRY_FINANCIAL_PAUSED POE_ENTRY_DAILY_LOSS'.split())
class Refused(RuntimeError):pass
def need(value,code):
 if not value:raise Refused(code)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def number(value):return type(value)in(int,float)and math.isfinite(value)and 0<=value<=9007199254740991
def integer(value):return type(value)is int and 0<=value<=9007199254740991
def string_fact(value):
 if type(value)is not str:return None
 raw=value.encode('utf8');return {'code':value if value in STATIC_STRINGS or value in STATIC_CODES else 'UNKNOWN_HASHED','sha256':digest(raw)}
def sanitize(value,depth=0):
 if type(value)is not dict or depth>7:return {}
 out={}
 for key,v in value.items():
  if key in('remainingDecisionMs','nativeServiceSlackMs')and type(v)in(int,float)and math.isfinite(v)and abs(v)<=9007199254740991:out[key]=v
  elif key in SCALAR_KEYS and(type(v)is bool or number(v)or v is None):out[key]=v
  elif key in STRING_KEYS and type(v)is str:out[key]=string_fact(v)
  elif key in OBJECT_KEYS and type(v)is dict:out[key]=sanitize(v,depth+1)
  elif key in DYNAMIC_KEYS and type(v)is dict:out[key]=sanitize(v,depth+1)
  elif key in ARRAY_KEYS and type(v)is list:
   out[key]=[sanitize(i,depth+1)if type(i)is dict else i for i in v[-96:]if type(i)is dict or number(i)or type(i)is bool or i is None]
  elif key in DYNAMIC_KEYS and(type(v)is bool or number(v)):out[key]=v
 return out

def drop_original_identity():
 need(os.geteuid()in(0,UID),'ORIGINAL_OWNER_ACCESS_REQUIRED')
 if os.geteuid()==0:
  os.closerange(3,1024);os.setgroups([]);os.setresgid(GID,GID,GID);os.setresuid(UID,UID,UID)
 need(os.getresuid()==(UID,UID,UID)and os.getresgid()==(GID,GID,GID),'PERMANENT_ORIGINAL_IDENTITY_REQUIRED')
def private_directory(path,uid):
 need(path.resolve(strict=True)==path,'CANONICAL_DIRECTORY_REQUIRED');s=path.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o700,'PRIVATE_DIRECTORY_REQUIRED')
def read(path,maximum,uid=UID,growing=False):
 need(path.resolve(strict=True)==path,'CANONICAL_FIXED_PATH_REQUIRED');fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o600 and 0<=s.st_size<=maximum,'FIXED_BOUNDED_FILE_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd)
  need((s.st_dev,s.st_ino,s.st_uid)==(a.st_dev,a.st_ino,a.st_uid),'INPUT_REPLACED_DURING_READ')
  if growing:need(len(raw)>=s.st_size,'INPUT_TRUNCATED_DURING_READ');raw=raw[:s.st_size]
  else:need(len(raw)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'INPUT_CHANGED_DURING_READ')
  return raw,(s.st_size,s.st_mtime_ns)!=(a.st_size,a.st_mtime_ns)
 finally:os.close(fd)
def source_pins(value):
 return {k:value.get(k)for k in('commit','sha256')}if type(value)is dict else None
def status_fact(value):
 need(type(value)is dict and value.get('accountId')==ACCOUNT and value.get('inceptionAt')==INCEPTION and value.get('runId')==RUN and source_pins(value.get('source'))==SOURCE and value.get('configurationSha256')==CONFIGURATION and value.get('startedAt')==STARTED and value.get('mode')=='paper'and value.get('liveTradingEnabled')is False and integer(value.get('generatedAt'))and value['generatedAt']>=STARTED,'EXACT_CURRENT_RUN_IDENTITY_REQUIRED')
 return {'available':True,'accountId':ACCOUNT,'inceptionAt':INCEPTION,'source':SOURCE,'configurationSha256':CONFIGURATION,'runId':RUN,'startedAt':STARTED,'generatedAt':value['generatedAt'],'running':value.get('running')if type(value.get('running'))is bool else None,'entriesEnabled':value.get('entriesEnabled')if type(value.get('entriesEnabled'))is bool else None,'status':string_fact(value.get('status')),'diagnostics':sanitize({k:value[k]for k in('usage','timing','reporting','financial','financialReadiness','evidenceRetention','resourceControl','resources','sourceRecovery','sourceTimes')if k in value}),'missingDiagnostics':[k for k in('usage','timing','reporting','financialReadiness','evidenceRetention')if k not in value]}
def event_time(value):
 if integer(value.get('data',{}).get('at')):return value['data']['at']
 s=value.get('receivedAt')
 if type(s)is not str or len(s)>40 or not s.endswith('Z'):return None
 try:return int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
 except(ValueError,OverflowError):return None
def event_fact(value):
 if type(value)is not dict or type(value.get('data'))is not dict:return None
 if value.get('runId',RUN)!=RUN or value['data'].get('runId',RUN)!=RUN:return None
 if 'source'in value and source_pins(value['source'])!=SOURCE:return None
 if 'source'in value['data']and type(value['data']['source'])is dict and 'commit'in value['data']['source']and source_pins(value['data']['source'])!=SOURCE:return None
 at=event_time(value)
 if at is None or not START<=at<END or value.get('kind')not in EVENT_KINDS:return None
 return {'kind':value['kind'],'at':at,'data':sanitize(value['data']),'runAttribution':'explicit-run-field'if value.get('runId')==RUN or value['data'].get('runId')==RUN else'time-correlated-with-verified-current-run'}
def fact_priority(fact):
 k=fact['kind'];d=fact['data']
 if 'unavailable'in k or k in('component-physical-timeout','native-paper-reporting-overrun')or k=='native-paper-local-phase'and d.get('overrun')is True or k=='trader-held-evaluation'and d.get('usable')is not True:return 0
 if k=='trader-held-evaluation':return 1
 if k=='http-lifecycle-timing':return 2
 if k=='native-audit-dispatch-summary':return 3
 if k=='native-paper-local-phase':return 5
 if k in('native-audit-dispatch-state','http-headers'):return 6
 return 4
def valid_segment(name):
 import re
 return type(name)is str and re.fullmatch('(diagnostic|essential)-[0-9]{12}\\.ndjson',name)is not None

def evidence_facts(directory,status,uid=UID,budget_seconds=MAX_SECONDS):
 deadline=time.monotonic()+budget_seconds;private_directory(directory,uid);files=[];facts=[];used=0;factbytes=0;unknown={};kind_counts={};result={'files':files,'facts':facts,'unrecognizedEventKinds':unknown,'matchingKindCounts':kind_counts,'samplingPolicy':'Priority samples retain failures, unusable holdings, then completed holding checks ahead of dense discretionary traces; bounds and omission counts remain explicit.','bytesRead':0,'scanBudgetReached':False,'factCapacityReached':False,'selectionUnknown':False,'meaning':'Surviving bounded diagnostic copies only; timestamp-correlated events do not independently establish run or source provenance. Rotation, missing files, truncation, optional omission and scan bounds remain UNKNOWN; absence of retained facts is not absence of failure.'}
 if not status.get('available'):result['selectionUnknown']=True;result['reasonCode']='VERIFIED_CURRENT_STATUS_REQUIRED';return result
 candidates=[]
 try:
  raw,_=read(directory/'state.json',MAX_STATE,uid);result['stateSha256']=digest(raw);s=json.loads(raw);need(type(s)is dict and s.get('version')=='poe-owned-rotating-evidence-v1','OWNED_EVIDENCE_NAMESPACE_REQUIRED');rows=s.get('diagnostics',[]);need(type(rows)is list and len(rows)<=512,'STATE_SEGMENT_BOUND');rows=rows+[s.get('activeDiagnostic'),s.get('activeEssential')]
  for row in rows:
   if type(row)is dict and valid_segment(row.get('file'))and integer(row.get('startedAt'))and integer(row.get('endedAt'))and row['startedAt']<END and row['endedAt']>=START:candidates.append(row['file'])
 except(OSError,ValueError,TypeError,Refused):result['selectionUnknown']=True
 # Essential segments are durable and may have sealed before this snapshot.
 # Only bounded canonical names, never arbitrary paths from the state, are read.
 names=[]
 with os.scandir(directory)as entries:
  for i,e in enumerate(entries):
   if i>=MAX_DIRECTORY_ENTRIES:result['selectionUnknown']=True;result['scanBudgetReached']=True;break
   if time.monotonic()>deadline:result['scanBudgetReached']=True;break
   if valid_segment(e.name)and e.name.startswith('essential-'):names.append(e.name)
 candidates=list(dict.fromkeys(candidates+sorted(names,reverse=True)[:MAX_FILES]))
 if len(candidates)>MAX_FILES:result['scanBudgetReached']=True
 for name in candidates[:MAX_FILES]:
  item={'file':name,'available':False};files.append(item)
  if time.monotonic()>deadline or used+MAX_SEGMENT>MAX_SCAN_BYTES:result['scanBudgetReached']=True;item['reasonCode']='SCAN_TIME_OR_BYTE_BOUND';continue
  try:
   raw,changed=read(directory/name,MAX_SEGMENT,uid,True);used+=len(raw);item.update(available=True,bytesRead=len(raw),sha256=digest(raw),changedDuringRead=changed,partialTrailingLine=bool(raw and not raw.endswith(b'\n')),oversizedLines=0,malformedLines=0);lines=raw.splitlines();lines=lines[:-1]if item['partialTrailingLine']else lines
   for line in lines:
    if time.monotonic()>deadline:result['scanBudgetReached']=True;break
    if len(line)>MAX_LINE:item['oversizedLines']+=1;continue
    try:
     value=json.loads(line);fact=event_fact(value)
     if fact is None:
      if type(value)is dict and value.get('kind')not in EVENT_KINDS and integer(event_time(value))and START<=event_time(value)<END:
       code=digest(str(value.get('kind')).encode());
       if code in unknown or len(unknown)<64:unknown[code]=unknown.get(code,0)+1
       else:result['unrecognizedKindCapacityReached']=True
      continue
     body=json.dumps(fact,separators=(',',':')).encode();kind_counts[fact['kind']]=kind_counts.get(fact['kind'],0)+1
     while facts and(len(facts)>=MAX_FACTS or factbytes+len(body)>MAX_FACT_BYTES):
      result['factCapacityReached']=True;worst=max(range(len(facts)),key=lambda i:(fact_priority(facts[i]),-facts[i]['at']))
      if (fact_priority(fact),-fact['at'])>=(fact_priority(facts[worst]),-facts[worst]['at']):break
      old=facts.pop(worst);factbytes-=len(json.dumps(old,separators=(',',':')).encode())
     if len(facts)>=MAX_FACTS or factbytes+len(body)>MAX_FACT_BYTES:result['factCapacityReached']=True;continue
     facts.append(fact);factbytes+=len(body)
    except(ValueError,TypeError,AttributeError,OverflowError):item['malformedLines']+=1
  except(OSError,ValueError,TypeError,Refused):item['reasonCode']='SEGMENT_UNAVAILABLE_OR_BOUND'
 facts.sort(key=lambda f:f['at']);result['bytesRead']=used;return result

def collect(root=ROOT,uid=UID,budget_seconds=MAX_SECONDS):
 began=time.monotonic();private_directory(root,uid);snapshot={'available':False,'reasonCode':'CURRENT_STATUS_UNAVAILABLE_OR_IDENTITY_UNKNOWN'}
 try:
  raw,_=read(root/'status.json',MAX_STATUS,uid);snapshot={**status_fact(json.loads(raw)),'fileSha256':digest(raw)};
  if len(json.dumps(snapshot,separators=(',',':')).encode())>32768:snapshot['diagnostics']={};snapshot['diagnosticsCapacityReached']=True
 except(OSError,ValueError,TypeError,Refused):pass
 remaining=max(0,budget_seconds-(time.monotonic()-began))
 try:diagnostics=evidence_facts(root/'service-evidence',snapshot,uid,remaining)
 except(OSError,ValueError,TypeError,Refused):diagnostics={'available':False,'reasonCode':'EVIDENCE_NAMESPACE_UNAVAILABLE_OR_BOUND','facts':[]}
 return {'schemaVersion':1,'kind':'POE_CURRENT_RUN_FORENSICS','generatedAt':int(time.time()*1000),'accountId':ACCOUNT,'inceptionAt':INCEPTION,'source':SOURCE,'configurationSha256':CONFIGURATION,'runId':RUN,'readerUid':os.getuid(),'readerGid':os.getgid(),'financialDatabaseOpened':False,'financialWrites':0,'serviceControlOperations':0,'credentialReads':0,'window':{'fromAt':START,'untilAtExclusive':END},'currentStatus':snapshot,'diagnostics':diagnostics,'limitations':['No balances, quantities, wallet/provider strings, arbitrary messages, market payloads or financial database are read/exported.','Unknown strings are represented only by SHA256; event source/run attribution is explicit or temporal, never invented.','Current status is a later cumulative snapshot; it does not reconstruct historical timing without retained event evidence.','Exporting diagnostics never clears financial pauses, resets daily loss, authorizes an entry, certifies holding protection or proves operational acceptance.']}

def publish(path,value,uid=UID):
 parent=path.parent;s=parent.lstat();need(parent.resolve(strict=True)==parent and stat.S_ISDIR(s.st_mode)and s.st_uid==uid and not s.st_mode&0o022,'EXISTING_PUBLIC_DIRECTORY_REQUIRED');raw=(json.dumps(value,separators=(',',':'),allow_nan=False)+'\n').encode();need(len(raw)<=MAX_OUTPUT,'OUTPUT_BOUND');dfd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);tmp='.current-run-forensics-'+str(os.getpid())+'.pending';fd=None
 try:
  z=os.fstat(dfd);need((s.st_dev,s.st_ino)==(z.st_dev,z.st_ino),'PUBLIC_DIRECTORY_CHANGED')
  try:o=os.stat(path.name,dir_fd=dfd,follow_symlinks=False);need(stat.S_ISREG(o.st_mode)and o.st_uid==uid and o.st_nlink==1,'OUTPUT_SHAPE_REQUIRED')
  except FileNotFoundError:pass
  fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=dfd);os.fchmod(fd,0o644);pos=0
  while pos<len(raw):n=os.write(fd,raw[pos:]);need(n>0,'OUTPUT_WRITE_REQUIRED');pos+=n
  os.fsync(fd);os.close(fd);fd=None;os.replace(tmp,path.name,src_dir_fd=dfd,dst_dir_fd=dfd);os.fsync(dfd)
 finally:
  if fd is not None:os.close(fd)
  os.close(dfd)
 return {'path':str(path),'bytes':len(raw),'sha256':digest(raw)}
def main():
 need(len(sys.argv)==1,'NO_ARGUMENTS_ACCEPTED');drop_original_identity();value=collect();receipt=publish(OUTPUT,value);print(json.dumps({'kind':'POE_CURRENT_RUN_FORENSIC_EXPORT_RECEIPT','readerUid':os.getuid(),'readerGid':os.getgid(),'financialDatabaseOpened':False,'financialWrites':0,'serviceChanges':0,'credentialReads':0,'source':SOURCE,'runId':RUN,**receipt},separators=(',',':')))
if __name__=='__main__':
 try:main()
 except Exception:print(json.dumps({'kind':'POE_CURRENT_RUN_FORENSIC_EXPORT_REFUSED','reason':'IDENTITY_ACCESS_INPUT_OR_OUTPUT_BOUND','financialDatabaseOpened':False,'financialWrites':0,'serviceChanges':0,'credentialReads':0}));raise SystemExit(1)
