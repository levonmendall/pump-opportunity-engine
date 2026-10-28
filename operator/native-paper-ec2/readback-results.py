#!/usr/bin/env python3
"""Fixed-account settled PAPER projection readback; no raw ledger/secret export.

Reuses the reviewed descriptor/chunk protocol. Preparation acquires the existing
financial-owner lease read-only, checks a stopped source and supervisor, then
exports only explicit public projections and a bounded financial checksum audit.
"""
import argparse,base64,contextlib,fcntl,gzip,hashlib,importlib.util,io,json,math,os,pathlib,re,sqlite3,stat,sys,tarfile,time
MIB=1024*1024
UID=994
BASE=pathlib.Path('/home/mm-ec2-runner/.local/share/poe-native-paper')
ACCOUNT='poe-pilot-8468add6-f916-48cf-a585-6cd008a81360'
INCEPTION=1793123773252
MAX_ARCHIVE=32*MIB
MAX_SELECTED=32*MIB
MAX_EVENTS=128*MIB
ARCHIVE='selected-evidence.tar.gz'
MANIFEST='archive.json'
SUPPORT_SHA='81f017b3a2fa789ec6f3f75f1718c9036067bf9690a0d1f7cf05852c9484501a'
P=pathlib.Path(__file__).parents[1]/'native-candidate-ec2/readback-public-evidence.py'
support_fd=os.open(P,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
try:
 support_stat=os.fstat(support_fd)
 if not(stat.S_ISREG(support_stat.st_mode)and support_stat.st_uid==os.getuid()and support_stat.st_nlink==1 and not support_stat.st_mode&0o022 and 0<support_stat.st_size<=65536):raise RuntimeError('REVIEWED_READBACK_SUPPORT_FILE_REQUIRED')
 raw=os.read(support_fd,support_stat.st_size+1)
 if len(raw)!=support_stat.st_size:raise RuntimeError('REVIEWED_READBACK_SUPPORT_CHANGED')
finally:os.close(support_fd)
if hashlib.sha256(raw).hexdigest()!=SUPPORT_SHA:raise RuntimeError('REVIEWED_READBACK_SUPPORT_HASH_MISMATCH')
spec=importlib.util.spec_from_file_location('poe_fixed_readback_support',P)
h=importlib.util.module_from_spec(spec);exec(compile(raw,str(P),'exec'),h.__dict__)
class Guard(RuntimeError):pass
def need(value,code):
 if not value:raise Guard(code)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def encode(value):return (json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
def integer(value):return type(value)is int and value>=0
def sha(value):return isinstance(value,str)and re.fullmatch('[a-f0-9]{64}',value)is not None
def parse(raw):
 def pairs(items):
  result={}
  for k,v in items:
   need(k not in result,'DUPLICATE_JSON_FIELD');result[k]=v
  return result
 def finite(value):
  result=float(value);need(math.isfinite(result),'INVALID_JSON_NUMBER');return result
 return json.loads(raw,object_pairs_hook=pairs,parse_float=finite,parse_constant=lambda _:(_ for _ in ()).throw(Guard('INVALID_JSON_NUMBER')))
def number(value,maximum,positive=False):return h.canonical_number(value,maximum,positive)[1]
def read(fd,name,uid,maximum):
 need('/'not in name and name not in ['.','..'],'FIXED_CHILD_NAME_REQUIRED')
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
 try:
  before=h.private_file(f,uid,maximum);raw=os.read(f,before.st_size+1);after=h.private_file(f,uid,maximum)
  need(len(raw)==before.st_size and h.stat_identity(before)==h.stat_identity(after),'SOURCE_FILE_CHANGED')
  return raw
 finally:os.close(f)
def directory(fd,name,uid):
 child=h.open_directory(name,fd);h.private_directory(child,uid);return child
def source(value,expected):
 need(type(value)is dict and value.get('accountId')==ACCOUNT and value.get('inceptionAt')==INCEPTION and value.get('mode')=='paper' and value.get('financialExecutionAuthorized')is True and value.get('liveTradingEnabled')is False,'PAPER_SOURCE_IDENTITY_REQUIRED')
 need(value.get('source',{}).get('commit')==expected['commit']and value.get('source',{}).get('sha256')==expected['sha256'],'SOURCE_EXECUTABLE_MISMATCH')
 need(isinstance(value.get('runId'),str)and re.fullmatch('native-paper-[0-9]{14,20}',value['runId'])is not None and integer(value.get('generatedAt'))and integer(value.get('startedAt'))and value['generatedAt']>=value['startedAt'],'SOURCE_TIME_REQUIRED')
 need(type(value.get('positions'))is dict and type(value.get('pending'))is dict,'SOURCE_OWNERSHIP_REQUIRED')
 return value

def ledger_audit(account_fd,uid,last):
 """Read-only checksum/reconciliation only; never serialize the DB or state body."""
 owner=os.open('ledger.sqlite.owner.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=account_fd)
 try:
  owner_stat=os.fstat(owner);need(stat.S_ISREG(owner_stat.st_mode)and owner_stat.st_uid==uid and owner_stat.st_nlink==1 and stat.S_IMODE(owner_stat.st_mode)==0o600,'FINANCIAL_OWNER_LOCK_REQUIRED');fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
  need(h.stat_identity(owner_stat)==h.stat_identity(os.stat('ledger.sqlite.owner.lock',dir_fd=account_fd,follow_symlinks=False)),'FINANCIAL_OWNER_LOCK_CHANGED')
  for name in ['ledger.sqlite-wal','ledger.sqlite-shm','ledger.sqlite-journal']:
   try:os.stat(name,dir_fd=account_fd,follow_symlinks=False);raise Guard('FINANCIAL_SIDECAR_PRESENT')
   except FileNotFoundError:pass
  f=os.open('ledger.sqlite',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=account_fd)
  try:
   before=h.private_file(f,uid,40*MIB);hasher=hashlib.sha256()
   while True:
    block=os.read(f,1024*1024)
    if not block:break
    hasher.update(block)
   db=sqlite3.connect('file:/proc/self/fd/'+str(f)+'?mode=ro&immutable=1',uri=True,timeout=0.1)
   try:
    db.execute('PRAGMA query_only=ON');db.execute('PRAGMA trusted_schema=OFF')
    need(db.execute('PRAGMA quick_check').fetchone()==('ok',),'LEDGER_QUICK_CHECK_FAILED')
    tables={r[0]for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    need(tables=={'financial_state','actions','journal','metadata'},'LEDGER_SCHEMA_MISMATCH')
    body=db.execute('SELECT body FROM financial_state WHERE singleton=1').fetchone();need(body is not None and type(body[0])is str and len(body[0].encode())<=2*MIB,'LEDGER_STATE_BOUND')
    state=parse(body[0]);need(state['schemaVersion']==1 and state['accountId']==ACCOUNT and state['mode']=='PAPER'and state['inceptionAt']==INCEPTION and state['initialMicroUsd']=='1000000000','LEDGER_IDENTITY_MISMATCH')
    counts={name:db.execute('SELECT count(*) FROM '+name).fetchone()[0]for name in sorted(tables)}
    revision=state['revision'];need(integer(revision)and counts['financial_state']==1 and counts['actions']==revision and counts['journal']==revision+1,'LEDGER_REVISION_COUNTS')
    need(db.execute('SELECT min(revision),max(revision) FROM journal').fetchone()==(0,revision),'LEDGER_JOURNAL_RANGE')
    need(db.execute('SELECT count(*) FROM actions a LEFT JOIN journal j ON j.action_id=a.id WHERE j.action_id IS NULL').fetchone()[0]==0 and db.execute('SELECT count(*) FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>0 AND a.id IS NULL').fetchone()[0]==0,'LEDGER_ACTION_JOURNAL_LINKS')
    def amount(value,signed=False):
     need(isinstance(value,str)and re.fullmatch('-?(0|[1-9][0-9]{0,38})'if signed else'0|[1-9][0-9]{0,38}',value)is not None,'LEDGER_AMOUNT_BOUND');return int(value)
    cash=amount(state['lamports']);reserved=sum(amount(o['reserved'])for o in state['pending'].values());locked=sum(amount(v)for v in state['lockedDeposits'].values());need(reserved<=cash and len(state['positions'])<=3 and len(state['pending'])<=3,'LEDGER_RESERVATION_INVARIANT')
    fields={'revision':revision,'cashLamports':state['lamports'],'reservedLamports':str(reserved),'lockedDepositLamports':str(locked),'realizedLamports':state['realizedLamports'],'executionCostsLamports':state['executionCosts'],'openPositions':len(state['positions']),'pendingActions':len(state['pending'])}
    amount(state['realizedLamports'],True);amount(state['executionCosts'])
    flat=not state['positions'];initial=1000000000*1000000000//amount(state['inceptionPrice']['microUsdPerSol']);fields.update({'equityLamports':str(cash+locked)if flat else None,'totalPnlLamports':str(cash+locked-initial)if flat else None})
    expected=last.get('financial')or{};comparison={k:expected.get(k)==v for k,v in fields.items()if v is not None}
    permission={'entriesEnabled':state['controls']['entriesEnabled'],'stopRequested':state['controls']['stopRequested'],'controlsChangedAt':state['controls']['changedAt'],'dailyPaused':state['daily']['paused'],'dailyLossPaused':state['daily']['lossPaused'],'reconciledAt':state['daily']['reconciledAt']}
    need(all(type(permission[k])is bool for k in ['entriesEnabled','stopRequested','dailyPaused','dailyLossPaused'])and all(integer(permission[k])for k in ['controlsChangedAt','reconciledAt']),'LEDGER_PERMISSION_FIELDS')
    comparison.update({'controls.'+k:(expected.get('controls')or{}).get(k)==state['controls'][k]for k in ['entriesEnabled','stopRequested','changedAt']});comparison.update({'daily.'+k:(expected.get('daily')or{}).get(k)==state['daily'][k]for k in ['paused','lossPaused','reconciledAt']})
    attempts={str(status):count for status,count in db.execute("SELECT json_extract(a.result,'$.status'),count(*) FROM actions a JOIN journal j ON j.action_id=a.id WHERE j.kind='attempt' GROUP BY json_extract(a.result,'$.status')")}
    outcome={'schemaVersion':1,'kind':'read-only-paper-ledger-projection-audit','accountId':ACCOUNT,'inceptionAt':INCEPTION,'initialMicroUsd':'1000000000','databaseSha256':hasher.hexdigest(),'databaseBytes':before.st_size,'financialStateBodySha256':digest(body[0].encode()),'financialStateBodyBytes':len(body[0].encode()),'tableCounts':counts,'journalRangeContiguous':True,'actionJournalLinksValid':True,'quickCheck':'ok','fields':fields,'financialPermission':permission,'sourceFieldComparisons':comparison,'allComparableSourceFieldsMatch':all(comparison.values()),'sourceOwnershipMatchesLedger':last['positions']==state['positions']and last['pending']==state['pending'],'attemptStatuses':attempts,'reconciledAt':state['daily']['reconciledAt'],'lastFinancialAt':state['lastAt'],'heldValuationIndependentlyRepriced':False,'usdPnlIndependentlyVerified':False,'limitation':'Current held mark/source/USD freshness is not reconstructed from a stopped ledger; only exact stored cash/reservation/ownership/cost and flat SOL arithmetic are independently checked. Raw financial state, journal payloads, metadata and database bytes are not exported.'}
   finally:db.close()
   after=h.private_file(f,uid,40*MIB);named=os.stat('ledger.sqlite',dir_fd=account_fd,follow_symlinks=False);need(h.stat_identity(before)==h.stat_identity(after)==h.stat_identity(named),'LEDGER_CHANGED_DURING_READ')
   need(h.stat_identity(owner_stat)==h.stat_identity(os.stat('ledger.sqlite.owner.lock',dir_fd=account_fd,follow_symlinks=False)),'FINANCIAL_OWNER_LOCK_CHANGED');outcome['databaseUnchangedDuringRead']=True;outcome['ledgerAuditedAt']=int(time.time()*1000);return outcome
  finally:os.close(f)
 finally:os.close(owner)

EVENT_KINDS=frozenset(['trader-decision','trader-execution','trader-pilot-execution-quote','trader-pilot-execution-refusal','trader-held-evaluation','native-paper-entry-permission','native-paper-entry-preparation-unavailable','native-paper-entry-unavailable','native-paper-startup-protection','native-paper-startup-source-deferred','native-paper-management-reserve','native-paper-source-unavailable','native-paper-admission-suspended','native-paper-reporting-overrun'])
EVENT_FIELDS=frozenset(['at','mint','orderId','side','status','stage','reason','ruleVersion','attemptedAt','quoteAt','quoteSlot','requiredDepositLamports','depositEvidence','evaluatedAt','completedAt','sourceValidUntil','usable','units','pendingExit','action','outcome','windowEndAt','predictiveOnly','executableQualification','orderCreated','candidateCoverageSuspended','financialExposureRetained','holdingManagerContinues','remainingUnits','remainingResponseBytes','remainingChapters','elapsedMs','budgetMs','nextSource','managementOnly','attemptedBeforeSource','marketSourceStarted'])
QUOTE_FIELDS=frozenset(['at','spendLamports','receiveUnits','evidence','pricedBaseUnits','refundedDepositLamports','refundEvidence'])
# Observation diagnostics are metadata only. No generic recursive object or
# provider payload is copied; source files/hashes remain the complete evidence.
DIAGNOSTIC_KINDS=frozenset([
 'pilot-watch-discovered','pilot-watch-verified','pilot-watch-promotion','pilot-watch-transition','pilot-watch-expired','pilot-watch-evicted','pilot-watch-capacity-refusal','pilot-watch-complete-window','pilot-watch-verification-deferred','native-migration-refused','native-candidate-observation-open','native-candidate-retired','native-candidate-quality-gap','native-candidate-source-admissions-closed','native-candidate-work-unavailable',
 'native-candidate-audit-session-open','native-candidate-window-audit','native-candidate-window-audit-unavailable','native-candidate-audit-cancelled-diagnostic','native-candidate-audit-cancelled-after-page-return',
 'native-candidate-audit-batch-selected','native-candidate-audit-batch-return','native-candidate-audit-batch-unavailable','native-audit-dispatch-state','native-audit-dispatch-summary','native-audit-late-page',
 'native-independent-audit-warming','native-predictive-window-expired','native-predictive-unavailable','native-predictive-assessment','native-deep-admission-deferred','native-shared-audit-ceiling-requested',
 'native-flow-upgrade-refused','native-flow-socket-error','native-flow-early-heartbeat-request','native-flow-transport-integrity-gap','native-flow-control-refused','native-flow-subscription-ack','native-flow-subscription-retired','native-flow-subscription-rebound','native-flow-service-deferred','native-flow-support-refresh-deferred','native-flow-round-trip-proof','native-flow-ledger-capacity-refusal',
 'component-physical-start','component-physical-settled','component-physical-timeout','http-headers','http-response-timing','http-lifecycle-timing','pilot-rpc-unavailable','pilot-job-admission-refused','pilot-data-control-unavailable','pilot-candidate-batch-unavailable','pilot-query-timeout-unavailable','pilot-query-timeout-escalated','pilot-rpc-provider-backoff-observed','pilot-history-batch-disabled','signature-history-batch-response'])
DIAGNOSTIC_FIELDS=frozenset('page maximumPages onePhysicalPagePerStep notHoldingProtectionAcceptance operationPurpose key scope httpStatus queryCooldownUntil queryFailures distinctTimedOutQueriesLast10s globalBackoffRequired globalRpcCooldownUnchanged globalFailureStreakUnchanged ordinaryRequestsRequireSharedGate providerCooldownUnchanged publicRpcCooldownUnchanged physicalGateUnchanged observedAfterLogicalCompletion chapterHalted nextAttemptRequiresExistingSettlementGuards optimizationDisabledForRun individualQueriesAndFinancialPricingRequireExistingSharedRecovery uncertainReservationsRetained automaticRetry state requestedState priorState deferUntil deepAllocated capacityStatus signature feedMint migrationAt verifiedAt verified repromotion waitMs observationWaitMs entryEligible freshFullWindowRequired deepSince maximum lostHorizon delayMs repeatedSaturatedOrigin structuralExactSeedOnly provisionalMintNotPermanentlyExcluded notPredictiveRejection at mint pool reason code status stage outcome version windowStartAt windowEndAt targetEndAt currentEndAt decisionDeadlineAt deadlineAt firstReadyAt lastAt remainingDecisionMs nextAction transitionRecord transitionRecords omittedTransitions final allocatedAt openedAt completeWindows actualAcknowledgment freshWindowRequired awarenessRetained financialExecutionAuthorized partialHistoryNeverComplete notBackdated admitted physicalStartClaimed physicalSettlementClaimed physicalRequestStarted physicalGateInFlight physicalGateWaitingOrOperating callerOwnsPhysicalSettlement cancelledAt recordedAt availableAt auditAvailableAt auditPreserved baselineFeatureSemantics strictV2BaselineUnavailable assessmentScope auditCompletenessScope notificationCompletenessVerified executedFlowCompletenessVerified dataContract strategyVersion entryAgeEligible ageCohort observationAgePolicy financialQualification historyRequestStarted deadlineEligible windowUsable executionFeasibility transferCrossCheck id enqueuedAt reservedAt requestedAt headersAt firstBodyAt lastBodyAt bodyCompleteAt jsonDecodedAt httpWorkEndedAt responseReceivedAt validatedAt responseBytes chunksReceived aborted headersDelayMs bodyAfterHeadersMs jsonDecodeMonotonicMs elapsedMonotonicMs connectionReuse validationScope method retryAfter byteAccounting responseComplete uncertainReservedBytes scheduledAt requestedTimeoutMs scheduledDelayMs callbackLatenessMs cooldownUntil providerCooldownUntil controlCooldownUntil physicalSettled reservationsRetained physicalRequestId physicalHttpStarts logicalQueries logicalQueriesRequested requestedLimit maximumResponseBytes overloaded late providerErrorTextRetained logicalPagesRetainedForScheduling latestStartAt dispatchedAt operationBoundMs connection operationId rpcErrorCode supportFresh candidateStillRegistered cancelled transportClosing subscription retiredAt retentionMs sourceExpiresAt previousDueAt nextHeartbeatAt conservativeRoundTripAt transportReceiptLowerBoundAt requestStartedAt domain retryAt deferredUntilAt notificationCapturePreserved freshSupportStillRequired priorSupportUnchanged freshnessExtended consecutiveFailures automaticRequestRetry rows maximumRows candidateLocal allReceivedBytesStillAccounted validatedPacketRetained currentDeep maximumDeep watchAwarenessRetained requiredNativeServicePreserved'.split())
CONTEXT_FIELDS=frozenset('reason selectedMint readyOrder readyCandidates page sessionOpened requestedLimit responseRows rpcReadyAt controlReadyAt physicalBusy actualPhysicalBusy inFlight waitingOrOperating rolling60SecondStarts rolling10SecondStarts startsPerMinuteLimit startsPer10SecondLimit providerCooldownUntil controlCooldownUntil nextNativeServiceAt nextNativeServiceDomain nextNativeServiceAction nativeServiceSlackMs pageOperationBoundMs nextCeilingRefreshAt latestStartAt operationBoundMs readyAt selectionClass selectedClass selectedDeadlineAt physicalSettlementClaimed'.split())
TRACE_FIELDS=frozenset('version windowEndAt decisionDeadlineAt firstReadyAt lastAt transitionRecords omittedTransitions final'.split())
DISPATCH_REASONS=frozenset('eligible native-service-wait native-service-dispatch native-service-return rpc-gate-wait ceiling-backoff ceiling-refresh prepare-native-runway scheduler-wait scheduler-refusal audit-selected peer-selected page-admission page-response page-refusal page-not-exposed work-exception'.split())
AUDIT_FIELDS=frozenset('schemaVersion classification status reason complete pool startedAt availableAt historyRangeCovered requestAttempts maximumPages pageLimit adaptivePageSizing completenessScope notificationCompletenessVerified executedFlowCompletenessVerified historyPayloadBytes historyRows interiorRows duplicateNotifications retryAt anchorKind'.split())
FEATURE_FIELDS=frozenset('mint asOf windowStartAt windowEndAt sufficientlyObserved qualityReason buyLamports sellLamports netBuyLamports tradeCount provisionalTradeCount distinctBuyerWallets largestBuyerBps positiveNetBuckets priceReturnBps firstPrice lastPrice'.split())
def scalars(value,fields):
 if type(value)is not dict:return {}
 out={k:v for k,v in value.items()if k in fields and(v is None or type(v)in[bool,int,float,str])}
 for v in out.values():need(not isinstance(v,str)or len(v)<=4096,'EVENT_FIELD_BOUND')
 return out

def trace_projection(value):
 out=scalars(value,TRACE_FIELDS)
 if type(value)is not dict:return out
 state=value.get('lastState')
 if type(state)is dict:out['lastState']={**scalars(state,frozenset(['reason','nextAction'])),'context':scalars(state.get('context'),CONTEXT_FIELDS)}
 counts=value.get('reasonCounts')
 if type(counts)is dict:out['reasonCounts']={k:v for k,v in counts.items()if k in DISPATCH_REASONS and integer(v)}
 return out

def audit_projection(value):
 out=scalars(value,AUDIT_FIELDS)
 if type(value)is not dict:return out
 for field,fields in [('target',frozenset(['startAt','endAt'])),('strictInteriorSlots',frozenset(['lower','upper'])),('notificationSnapshot',frozenset(['capturedAt','rows','requiredRows']))]:
  if type(value.get(field))is dict:out[field]=scalars(value[field],fields)
 fences=value.get('contextFences')
 if type(fences)is dict:out['contextFences']={k:scalars(fences[k],frozenset(['slot','availableAt','bankClockAt']))for k in ['lower','upper']if type(fences.get(k))is dict}
 pages=value.get('pages')
 if type(pages)is list:
  need(len(pages)<=6,'AUDIT_PAGE_METADATA_BOUND');out['pages']=[scalars(v,frozenset('page requestedLimit rows newestSlot oldestSlot receivedAt validatedAt'.split()))for v in pages]
 # Counts and explicitly labelled small samples cannot become a complete flow
 # denominator. All original signature lists/history stay privately retained.
 for key in ['requiredSignatures','comparedSignatures','missingNotifications','missingFailedNotifications','missingSuccessfulNotifications','unconfirmedCapturedSignatures','statusDisagreements','boundaryExcludedSignatures']:
  values=value.get(key)
  if type(values)is list:
   need(len(values)<=32768,'AUDIT_DIAGNOSTIC_LIST_BOUND');out[key+'Count']=len(values)
   if key in ['missingSuccessfulNotifications','statusDisagreements','unconfirmedCapturedSignatures']:
    sample=[]
    for row in values[:16]:
     if type(row)is str:need(re.fullmatch('[1-9A-HJ-NP-Za-km-z]{64,100}',row)is not None,'AUDIT_SIGNATURE_METADATA_BOUND');sample.append(row)
     elif type(row)is dict:sample.append(scalars(row,frozenset(['signature','slot','success','blockTime','confirmationStatus'])))
    out[key+'DiagnosticSample']=sample;out[key+'SampleTruncated']=len(values)>16
 return out

def observation_projection(kind,data):
 value=scalars(data,DIAGNOSTIC_FIELDS)
 if type(data.get('seed'))is dict:value['seed']=scalars(data['seed'],frozenset(['signature','feedMint','receivedAt']))
 if type(data.get('kind'))is dict:value['kind']=scalars(data['kind'],frozenset(['transport','method']))
 if type(data.get('context'))is dict:value['context']=scalars(data['context'],CONTEXT_FIELDS)
 for name in ['dispatchTrace']:
  if type(data.get(name))is dict:value[name]=trace_projection(data[name])
 if kind=='native-audit-dispatch-summary':value.update(trace_projection(data))
 for name in ['result','diagnosticResult']:
  if type(data.get(name))is dict:value[name]=audit_projection(data[name])
 if type(data.get('assessment'))is dict:
  a=data['assessment'];features=scalars(a.get('features'),FEATURE_FIELDS)
  if type(a.get('features'))is dict:
   for name in ['firstPrice','lastPrice']:
    if type(a['features'].get(name))is dict:features[name]=scalars(a['features'][name],frozenset(['quoteLamports','tokenUnits']))
  value['assessment']={**scalars(a,frozenset(['status','reason','qualified'])),'features':features}
 if type(data.get('acknowledgement'))is dict:value['acknowledgement']=scalars(data['acknowledgement'],frozenset('resultType safeNonnegativeInteger subscriptionId retiredSubscriptionMatch activeSubscriptionMatch'.split()))
 for name in ['mints','readyMints']:
  if type(data.get(name))is list:
   need(len(data[name])<=6 and all(isinstance(v,str)and re.fullmatch('[1-9A-HJ-NP-Za-km-z]{32,44}',v)is not None for v in data[name]),'SCOPED_MINT_METADATA_BOUND');value[name]=data[name]
 if type(data.get('scopes'))is list:
  need(len(data['scopes'])<=6,'SCOPED_SUPPORT_METADATA_BOUND');value['scopes']=[scalars(v,frozenset('mint subscription sourceSupportFresh verifiedAt bankClockAt sourceExpiresAt hasQualityLoss'.split()))for v in data['scopes']]
 if type(data.get('items'))is list:
  need(len(data['items'])<=6,'AUDIT_BATCH_ITEM_METADATA_BOUND');value['items']=[scalars(v,frozenset('key id status errorCode requestedAt responseReceivedAt validatedAt'.split()))for v in data['items']]
 return value
def select_event(row,raw,filename,line):
 kind=row.get('kind');data=row.get('data');need(type(data)is dict,'EVENT_DATA_MALFORMED')
 value=observation_projection(kind,data)if kind in DIAGNOSTIC_KINDS else scalars(data,EVENT_FIELDS)
 for k,v in value.items():need(not isinstance(v,str)or len(v)<=4096,'EVENT_FIELD_BOUND')
 if kind=='trader-pilot-execution-quote'and type(data.get('quote'))is dict:value['quote']={k:v for k,v in data['quote'].items()if k in QUOTE_FIELDS and(v is None or type(v)in[int,str])}
 return {'kind':kind,'sourceFile':filename,'sourceLine':line,'sourceLineSha256':digest(raw),'receivedAt':row.get('receivedAt')if isinstance(row.get('receivedAt'),str)and len(row['receivedAt'])<=64 else None,'sourceSequence':row.get('sequence')if integer(row.get('sequence'))else None,'sourceMonotonicMs':row.get('monotonicMs')if type(row.get('monotonicMs'))in[int,float]else None,'data':value}

def events_summary(run_fd,uid,segment_run_id):
 names=sorted(n for n in os.listdir(run_fd)if re.fullmatch(r'events-[0-9]{3}\.ndjson',n));need(len(names)<=32,'SOURCE_EVENT_FILE_BOUND')
 counts={};index=[];out=bytearray();total=0
 for name in names:
  f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=run_fd)
  try:
   before=h.private_file(f,uid,8*MIB);total+=before.st_size;need(total<=MAX_EVENTS,'SOURCE_EVENT_TOTAL_BOUND');hashfile=hashlib.sha256();lines=0
   with os.fdopen(os.dup(f),'rb')as stream:
    while True:
     raw=stream.readline(8*MIB+1)
     if not raw:break
     need(len(raw)<=8*MIB and raw.endswith(b'\n'),'SOURCE_EVENT_LINE_BOUND');hashfile.update(raw);lines+=1;row=parse(raw);kind=row.get('kind');need(isinstance(kind,str)and len(kind)<=128,'EVENT_KIND_BOUND');counts[kind]=counts.get(kind,0)+1
     if kind in EVENT_KINDS|DIAGNOSTIC_KINDS:
      encoded=encode({'runId':segment_run_id,**select_event(row,raw,name,lines)});need(len(encoded)<=64*1024 and len(out)+len(encoded)<=4*MIB,'SELECTED_EVENT_TOTAL_BOUND');out.extend(encoded)
   need(h.stat_identity(before)==h.stat_identity(h.private_file(f,uid,8*MIB)),'SOURCE_EVENTS_CHANGED');index.append({'file':name,'bytes':before.st_size,'sha256':hashfile.hexdigest(),'records':lines})
  finally:os.close(f)
 return bytes(out),{'runId':segment_run_id,'sourceFiles':index,'sourceKindCounts':counts,'selectedKinds':sorted(EVENT_KINDS|DIAGNOSTIC_KINDS),'completeMarketEvidenceIncluded':False,'observationDiagnostics':'Explicit allowlisted metadata only; audit signature samples are labelled and not complete evidence; no provider payload, raw logs, raw history pages or trading-flow archive; only labelled bounded missing-signature metadata samples.','selectedBytes':len(out),'classification':'Allowlisted diagnostic/financial event projection, not a complete market-flow archive; original complete event files remain privately retained.'}

class BoundedArchiveWriter:
 def __init__(self,stream):self.stream,self.written=stream,0
 def write(self,raw):
  need(self.written+len(raw)<=MAX_ARCHIVE,'ARCHIVE_SIZE_BOUND');count=self.stream.write(raw);self.written+=count;return count
 def flush(self):return self.stream.flush()

def write_new(fd,name,raw):
 f=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 try:
  at=0
  while at<len(raw):at+=os.write(f,raw[at:])
  os.fsync(f)
 finally:os.close(f)
def verify_package_identity(raw,reviewed_sha,expected_source):
 # The first supervisor saved a compact reserialization while retaining the
 # SHA of the exact reviewed two-space JSON. Do not rewrite either old file or
 # accept arbitrary semantic equivalence: reconstruct that one exact byte form.
 need(sha(reviewed_sha),'SUPERVISION_PACKAGE_HASH_MISMATCH')
 value=parse(raw);need(type(value)is dict and value.get('source')==expected_source,'SUPERVISION_PACKAGE_HASH_MISMATCH')
 actual=digest(raw);mode='exact-reviewed-bytes'
 if actual!=reviewed_sha:
  need(raw==encode(value),'SUPERVISION_PACKAGE_HASH_MISMATCH')
  reconstructed=(json.dumps(value,indent=2,ensure_ascii=True)+'\n').encode('ascii')
  need(len(reconstructed)<=128*1024 and digest(reconstructed)==reviewed_sha,'SUPERVISION_PACKAGE_HASH_MISMATCH')
  mode='legacy-compact-save-of-exact-reviewed-two-space-json'
 return {'schemaVersion':1,'kind':'poe-supervision-package-identity-verification-v1','savedPackageSha256':actual,'reviewedPackageSha256':reviewed_sha,'representation':mode,'source':expected_source,'exactReviewedRepresentationHashVerified':True,'historicalPackageRewritten':False,'historicalSupervisorRewritten':False,'semanticEquivalenceAloneAccepted':False}

def prepare_from_base_fd(base_fd,uid,run_id,attempt):
 number(run_id,(1<<64)-1,True);number(attempt,(1<<64)-1,True);h.private_directory(base_fd,uid)
 with contextlib.ExitStack()as stack:
  supervision=directory(base_fd,'supervision',uid);stack.callback(os.close,supervision);root=directory(supervision,'poe-native-paper-'+run_id+'-'+attempt,uid);stack.callback(os.close,root)
  supervisor_raw=read(root,'supervisor.json',uid,128*1024);supervisor=parse(supervisor_raw)
  need(supervisor.get('kind')=='POE_NATIVE_PAPER_BOUNDED_SUPERVISION'and supervisor.get('accountId')==ACCOUNT and supervisor.get('inceptionAt')==INCEPTION and supervisor.get('realTradingEnabled')is False,'SUPERVISOR_IDENTITY_REQUIRED')
  expected=supervisor.get('source');need(type(expected)is dict and re.fullmatch('[a-f0-9]{40}',expected.get('commit',''))and sha(expected.get('sha256')),'SOURCE_HASH_REQUIRED')
  segments=supervisor.get('segments');need(type(segments)is list and 1<=len(segments)<=2,'SETTLED_SEGMENTS_REQUIRED')
  for segment in segments:
   need(segment.get('sourceGroupSettled')is True and integer(segment.get('sourcePid'))and segment['sourcePid']>0,'SOURCE_GROUP_NOT_SETTLED')
   try:os.kill(segment['sourcePid'],0);raise Guard('SOURCE_PID_STILL_PRESENT')
   except ProcessLookupError:pass
  need(supervisor.get('publisherGroupSettled')is True,'PUBLISHER_NOT_SETTLED')
  account_fd=directory(base_fd,'account',uid);stack.callback(os.close,account_fd);runs_fd=directory(account_fd,'runs',uid);stack.callback(os.close,runs_fd)
  package_raw=read(root,'package.json',uid,128*1024);package_identity=verify_package_identity(package_raw,supervisor.get('packageSha256'),expected)
  entries={'supervisor.json':supervisor_raw,'package.json':package_raw,'package-identity-verification.json':encode(package_identity)};summaries=[];last=None
  for i,segment in enumerate(segments):
   run=segment.get('sourceRunId');need(isinstance(run,str)and re.fullmatch('native-paper-[0-9]{14,20}',run),'SEGMENT_RUN_ID_REQUIRED');r=directory(runs_fd,run,uid);stack.callback(os.close,r)
   raw=read(r,'result.json',uid,4*MIB);last=source(parse(raw),expected);need(last['runId']==run and last.get('running')is False,'STOPPED_RESULT_REQUIRED')
   need(digest(raw)==segment.get('finalStatusSha256'),'SEGMENT_FINAL_SOURCE_HASH_MISMATCH')
   entries['segments/'+str(i)+'/result.json']=raw;segment_raw=read(root,'segment-'+str(i)+'.json',uid,128*1024);need(parse(segment_raw)==segment,'SEGMENT_SUPERVISION_MISMATCH');entries['segments/'+str(i)+'/supervision.json']=segment_raw
   settlement=read(r,'settlement.json',uid,16*1024);value=parse(settlement);need(value.get('physicalSettlementConfirmed')is True,'PHYSICAL_SETTLEMENT_REQUIRED');entries['segments/'+str(i)+'/settlement.json']=settlement
   selected,summary=events_summary(r,uid,run);entries['segments/'+str(i)+'/selected-events.ndjson']=selected;summaries.append(summary)
  need(last is not None,'LAST_SOURCE_REQUIRED');current=read(account_fd,'status.json',uid,4*MIB);need(digest(current)==segments[-1]['finalStatusSha256'],'ACCOUNT_SOURCE_CHANGED_AFTER_SEGMENT');entries['final-status.json']=current
  try:witness_raw=read(root,'accepted-source-witness.json',uid,128*1024);witness=parse(witness_raw)
  except FileNotFoundError:witness={'kind':'poe-exact-accepted-source-witness-v1','rows':[],'unavailableReason':'No exact accepted source witness was retained; reporting cannot be established from this archive.'};witness_raw=encode(witness)
  need(witness.get('kind')=='poe-exact-accepted-source-witness-v1'and type(witness.get('rows'))is list and len(witness['rows'])<=4,'WITNESS_REQUIRED')
  for row in witness['rows']:
   name=row.get('file');need(row.get('runId')in{v['sourceRunId']for v in segments},'WITNESS_OUTSIDE_SUPERVISION');need(isinstance(name,str)and re.fullmatch(r'accepted-source-(first|last)-[12]\.json',name),'WITNESS_FILE_REQUIRED');raw=read(root,name,uid,4*MIB);value=source(parse(raw),expected);ack=row.get('publisherAcknowledgement');need(type(ack)is dict and ack.get('published')is True and ack.get('result')in['accepted','duplicate'],'ACCEPTED_ACK_REQUIRED')
   need(row.get('sourceSha256')==digest(raw)and row.get('sourceBytes')==len(raw)and row.get('runId')==value['runId']==ack.get('runId')and row.get('sourceAt')==value['generatedAt']==ack.get('sourceAt')and ack.get('accountId')==ACCOUNT and ack.get('running')is value.get('running'),'EXACT_WITNESS_MISMATCH');entries['witness/'+name]=raw
  entries['witness/accepted-source-witness.json']=witness_raw;entries['ledger-projection-audit.json']=encode(ledger_audit(account_fd,uid,last));entries['event-summary.json']=encode(summaries)
  index={'schemaVersion':1,'classification':'paper-public-projection-evidence','source':expected,'accountId':ACCOUNT,'inceptionAt':INCEPTION,'files':[{'file':name,'bytes':len(raw),'sha256':digest(raw)}for name,raw in entries.items()],'rawFinancialFilesIncluded':False,'credentialsIncluded':False,'completeMarketEvidenceIncluded':False}
  entries['index.json']=encode(index);need(sum(map(len,entries.values()))<=MAX_SELECTED,'SELECTED_EVIDENCE_BOUND')
  disk=os.fstatvfs(base_fd);need(disk.f_bavail*disk.f_frsize>=128*MIB,'READBACK_DISK_HEADROOM_REQUIRED');os.mkdir('export',0o700,dir_fd=root);export=directory(root,'export',uid);stack.callback(os.close,export);f=os.open(ARCHIVE,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=export)
  try:
   with os.fdopen(os.dup(f),'wb')as dst:
    with gzip.GzipFile(filename='',mode='wb',fileobj=BoundedArchiveWriter(dst),compresslevel=1,mtime=0)as gz:
     with tarfile.open(mode='w|',fileobj=gz,format=tarfile.USTAR_FORMAT)as archive:
      for name,raw in entries.items():
       info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o600;info.mtime=0;archive.addfile(info,io.BytesIO(raw));need(os.fstat(f).st_size<=MAX_ARCHIVE,'ARCHIVE_SIZE_BOUND')
   os.fsync(f)
  finally:os.close(f)
  raw=read(export,ARCHIVE,uid,MAX_ARCHIVE);s=os.stat(ARCHIVE,dir_fd=export,follow_symlinks=False);manifest={'schemaVersion':1,'classification':'paper-public-projection-evidence','complete':True,'format':'tar+gzip','githubRunId':run_id,'githubRunAttempt':attempt,'accountId':ACCOUNT,'inceptionAt':INCEPTION,'source':expected,'archive':{'file':ARCHIVE,'bytes':len(raw),'sha256':digest(raw),'stat':h.stat_identity(s)},'selectedBytes':sum(map(len,entries.values())),'indexSha256':digest(entries['index.json']),'credentialsIncluded':False,'rawFinancialFilesIncluded':False,'ledgerReadOnlyProjectionIncluded':True};write_new(export,MANIFEST,encode(manifest));os.fsync(export);return manifest

def stream_from_base_fd(base_fd,uid,run_id,attempt,offset,length,output):
 number(run_id,(1<<64)-1,True);number(attempt,(1<<64)-1,True);start=number(offset,MAX_ARCHIVE);requested=number(length,h.MAXIMUM_CHUNK_BYTES,True);h.private_directory(base_fd,uid)
 with contextlib.ExitStack()as stack:
  a=directory(base_fd,'supervision',uid);stack.callback(os.close,a);r=directory(a,'poe-native-paper-'+run_id+'-'+attempt,uid);stack.callback(os.close,r);e=directory(r,'export',uid);stack.callback(os.close,e)
  raw=read(e,MANIFEST,uid,128*1024);manifest=parse(raw);need(manifest.get('schemaVersion')==1 and manifest.get('classification')=='paper-public-projection-evidence'and manifest.get('complete')is True and manifest.get('githubRunId')==run_id and manifest.get('githubRunAttempt')==attempt and manifest.get('accountId')==ACCOUNT and manifest.get('inceptionAt')==INCEPTION and manifest.get('credentialsIncluded')is False and manifest.get('rawFinancialFilesIncluded')is False,'PAPER_ARCHIVE_MANIFEST_REQUIRED');archive=manifest.get('archive');need(type(archive)is dict and archive.get('file')==ARCHIVE and integer(archive.get('bytes'))and 0<archive['bytes']<=MAX_ARCHIVE and sha(archive.get('sha256')),'ARCHIVE_IDENTITY_REQUIRED')
  f=os.open(ARCHIVE,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=e);stack.callback(os.close,f);before=h.private_file(f,uid,MAX_ARCHIVE);need(h.stat_identity(before)==archive.get('stat')and start<=before.st_size,'ARCHIVE_STAT_OR_OFFSET_MISMATCH');actual=min(requested,before.st_size-start);manifest_sha=digest(raw)
  h.emit(output,{'schemaVersion':1,'kind':'header','classification':'paper-public-projection-evidence-readback','githubRunId':run_id,'githubRunAttempt':attempt,'accountId':ACCOUNT,'inceptionAt':INCEPTION,'manifestSha256':manifest_sha,'archive':{'file':ARCHIVE,'bytes':before.st_size,'sha256':archive['sha256']},'chunk':{'offset':start,'requestedLength':requested,'actualLength':actual,'sourceBlockMaximumBytes':h.SOURCE_BLOCK_BYTES},'integrityMeaning':'This call hashes only its bounded chunk. Verify the complete archive after reassembly. Projections do not establish natural trading or continuous acceptance.'});sent=0;hasher=hashlib.sha256();index=0
  while sent<actual:
   block=os.pread(f,min(h.SOURCE_BLOCK_BYTES,actual-sent),start+sent);need(len(block)==min(h.SOURCE_BLOCK_BYTES,actual-sent),'ARCHIVE_SHORT_READ');hasher.update(block);h.emit(output,{'kind':'data','index':index,'offset':start+sent,'bytes':len(block),'base64':base64.b64encode(block).decode('ascii')});sent+=len(block);index+=1
  need(h.stat_identity(before)==h.stat_identity(h.private_file(f,uid,MAX_ARCHIVE))and read(e,MANIFEST,uid,128*1024)==raw,'READBACK_SOURCE_CHANGED');h.emit(output,{'schemaVersion':1,'kind':'footer','complete':True,'offset':start,'bytes':sent,'dataRecords':index,'chunkSha256':hasher.hexdigest(),'archiveSha256':archive['sha256'],'manifestSha256':manifest_sha,'descriptorStatsStable':True,'archiveWholeHashVerifiedByThisCall':False,'credentialsRead':False,'financialDatabaseReadByThisCall':False,'rawFinancialFilesIncluded':False});return {'bytes':sent,'chunkSha256':hasher.hexdigest(),'archiveSha256':archive['sha256']}

def main(argv=None,output=None):
 output=output or sys.stdout
 try:
  parser=h.QuietArgumentParser(allow_abbrev=False,add_help=False)
  parser.add_argument('--phase',choices=['prepare','readback'],required=True)
  for name in ['run-id','attempt']:parser.add_argument('--'+name,required=True)
  parser.add_argument('--offset',default='0');parser.add_argument('--length',default=str(h.MAXIMUM_CHUNK_BYTES));args=parser.parse_args(argv)
  number(args.run_id,(1<<64)-1,True);number(args.attempt,(1<<64)-1,True);number(args.offset,MAX_ARCHIVE);number(args.length,h.MAXIMUM_CHUNK_BYTES,True);need(os.getuid()==UID,'EXPECTED_NONROOT_UID_REQUIRED');h.BASE=BASE;base=h.open_fixed_base()
  try:
   if args.phase=='prepare':h.emit(output,{'kind':'prepared','manifest':prepare_from_base_fd(base,UID,args.run_id,args.attempt)})
   else:stream_from_base_fd(base,UID,args.run_id,args.attempt,args.offset,args.length,output)
  finally:os.close(base)
  return 0
 except BrokenPipeError:return 1
 except Exception as error:
  code=str(error)if isinstance(error,(Guard,h.EvidenceReadbackError))else'PAPER_RESULT_READBACK_UNAVAILABLE'
  try:h.emit(output,{'kind':'error','complete':False,'code':code,'credentialsIncluded':False,'rawFinancialFilesIncluded':False})
  except BrokenPipeError:pass
  return 1
if __name__=='__main__':raise SystemExit(main())
