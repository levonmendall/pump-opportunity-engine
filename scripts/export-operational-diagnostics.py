#!/usr/bin/env python3
"""Release-independent, read-only POE diagnostics. Never loads credentials.

Install under a dedicated systemd mount namespace with /var/lib/poe read-only.
The SQLite connection is mode=ro/query_only and sees WAL through SQLite, never
immutable=1. This is a bounded diagnostic projection, NOT a complete backup.
"""
import argparse
import collections
import datetime
import hashlib
import heapq
import json
import math
import os
import pathlib
import re
import sqlite3
import stat
import time

ACCOUNT = 'poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION = 1793052456212
ROOT = pathlib.Path('/var/lib/poe')
MAX_FILE = 8 * 1024 * 1024
MAX_SCAN = 128 * 1024 * 1024
MAX_RECORDS = 2048
MAX_PROJECTED_RECORD_BYTES = 2 * 1024 * 1024
MAX_EXPORT_BYTES = 8 * 1024 * 1024
MAX_TYPED_ROWS = 128
# Keep essential events visible without losing all provider timing context. The
# existing byte/record bounds still apply; unused essential capacity is available
# to diagnostics. Newest segments are considered first within each stream.
ESSENTIAL_SHARE_NUMERATOR = 3
ESSENTIAL_SHARE_DENOMINATOR = 4
MAX_AMOUNT = (1 << 127) - 1
SCALARS = set(('at startedAt completedAt generatedAt requestedAt availableAt receivedAt '
 'invokedAt evaluatedAt quoteAt quoteAgeMs sourceSlot slot deadlineAt windowEndAt '
 'durationMs elapsedMs waitMs maximumMs lastCompletedAt maximumCompletedGapMs '
 'maximumQuoteAgeAtUseMs completedEvaluationBoundaryMs targetCadenceMs '
 'protectionBreaches unavailableChecks calls logicalAttempts rapidProbes '
 'refusals physicalInFlight physicalRequestStarted physicalSettled paused lossPaused reconciledAt '
 'httpTimeouts httpErrors throttles requests rpcRequests responseBytes '
 'headersDelayMs bodyAfterHeadersMs decodeMs processingMs scheduledDelayMs '
 'eventLoopDelayP95Ms rssBytes availableMemoryBytes availableDiskBytes '
 'candidateAdmissionAllowed entriesEnabled running reconciled revision '
 'active maximumCandidates queued promoted demoted repromoted completeWindows '
 'auditedWindows uniqueEvaluated decisionDeadlineMisses auditUnavailable '
 'auditUnusable qualityGaps count mean maximum minimum pendingAgeMs '
 'reservedAt retryAt providerCooldownUntil historyCooldownUntil '
 'remainingDecisionMs nativeServiceSlackMs boundaryMs gapMs usable '
 'sourceAgeMs reconciliationAgeMs newRiskMustRemainClosed '
 'financialManagementContinues monitoringInterruption financialHistoryPreserved '
 'exitCode returncode pid restartNotBeforeAt sourceSnapshotAt '
 'actualInvocations physicalTimeoutMs requestedTimeoutMs totalMs '
 'transportMs callbackLatenessMs undiciRequestCreatedDelayMs '
 'enabled restartFailures financialDatabaseOpened deliveryFreshnessVerified '
 'criticalResource staleRuntime restartRequired sourceFailures sourcePid publisherPid matchedSourceAcknowledgements '
 'resourceCritical sourceRestartRequired statusStale sourceHadStatus physicalWriterSettled '
 'httpStatus attempts deliveryFailures lastDeliveredAt statusWriteFailures '
 'points observations sequence samples lastSequence '
 'undiciResponseHeadersDelayMs undiciHeadersDispatchDelayMs').split())
SCALARS.update(('sourceValidUntil attemptedAt decidedAt executeAt expiresAt '
 'preparedAt landingAt enteredAt highWaterAt windowStartAt assessedAt '
 'quoteSlot minSlot knownSlotFloor cycle pendingExit allowEntry stopRequested '
 'changedAt completedEvaluations firstCompletedProtectionAt '
 'lastCompletedProtectionAt currentRunMaximumCompletedGapMs '
 'currentRunMaximumQuoteAgeAtUseMs observedRpcMs modeledDelayMs '
 'supplyDecimals tokenDecimals decimals slippageBps '
 'remainingStarts spent remaining').split())
SCALARS.update(('startAt endAt lower upper bankClockAt openedAt connectionId '
 'subscriptionId blockTime success complete capturedAt rows requiredRows '
 'refreshedAt duplicate correction requestAttempts maximumPages pageLimit '
 'adaptivePageSizing notificationCompletenessVerified executedFlowCompletenessVerified '
 'historyRangeCovered historyPayloadBytes historyRows interiorRows duplicateNotifications '
 'requiredTargetSignaturesUnchanged featureInformationBackdated page requestedLimit '
 'newestSlot oldestSlot validatedAt reusedRows freshOverlapSlot '
 'freshProviderOverlapRequired originalDeadlineUnchanged').split())
SCALARS.update(('dailyLossStopEnabled entryConsumedCostBps limitBps transitionRevision '
 'rawBuyerCount capitalDiversityBps effectiveBuyerCount effectiveBuyerCountBps largestBuyerBps '
 'top5BuyerBps top10BuyerBps dustBuyerCount dustBuyVolumeBps '
 'equalSizeBuyVolumeBps multiEventSignatureBuyVolumeBps netFlowShareBps '
 'recentPositiveBuckets scenarioNetSurplusBps lossFromConsumedCostBps '
 'executable cashLimited observations requiredForAdmission').split())
SCALARS.update(('profitGivebackBps liquidityDeteriorationVerified trailingDistanceBps '
 'profitRetentionBps priceReturnBps volatilityBps').split())
OBJECTS = set(('timing protection protectionRecovery failureStages provider rpc '
 'resources resource cpu processes source publisher financialReadiness safety '
 'reporting dispatchTrace localPhases diagnostics usage localPhases '
 'queueAgeMs entryQuoteFailures contextFailureCounts sourceRecovery '
 'auditDispatchTrace financialPolicy daily entry risk execution valuation equityCompanion store').split())
OBJECTS.update(('input request quote order price mark allocation entryStrategy '
 'strategy executionModel equityRisk adaptiveHoldingSignal').split())
OBJECTS.update(('result target anchor lowerFence strictInteriorSlots contextFences '
 'lower upper notificationSnapshot originalSnapshot postSnapshotTail generation').split())
OBJECTS.update(('v3 assessments genuineDemand liquidityResilience continuation '
 'netEconomics components reserveStability liquidityContext flowContext '
 'liquidityResilientHolding decision').split())
ENUM_FIELDS = {
    'continuationConfidence':{'audited-flow','price-reserve-only','unknown'},
    'participationEvidence':{'current-independent-audit','UNKNOWN_NATIVE_HELD_FLOW_NOT_AVAILABLE'},
    'inventoryEvidence':{'POINT_IN_TIME_ACCOUNT_OBSERVATIONS_AND_PLAUSIBLE_UNDISPOSED_PURCHASES_NOT_CURRENT_WALLET_BALANCES'},
    'outOfPoolTransfers':{'UNKNOWN'},'externalSellerInventory':{'UNKNOWN'}}
STRINGS = {'kind', 'reasonCode', 'stage', 'state', 'outcome', 'method', 'purpose',
           'reason', 'runId', 'mint', 'side', 'code', 'sourceState', 'ingestionReasonCode',
           'deliveryState', 'status', 'action', 'version', 'strategyVersion', 'mode',
           'confirmationStatus', 'classification', 'anchorKind', 'completenessScope'}
UNSIGNED_AMOUNTS = set(('units inputUnits outputUnits pricedBaseUnits receiveUnits '
 'spendLamports netLamports quoteLamports tokenUnits lamports gas gasReserve '
 'deposit maxSpend minReceive reserved entryLamports entryGas costMicroUsd '
 'highWaterNetLamports feeLamports requiredDepositLamports refundedDepositLamports '
 'temporaryRentLamports temporaryQuoteRentLamports executionCosts microUsdPerSol '
 'maximumConsumedLamports maximumConsumedCostMicroUsd baselineMicroUsd '
 'highWaterMicroUsd currentEquityMicroUsd drawdownMicroUsd '
 'remainingBeforePauseMicroUsd').split())
UNSIGNED_AMOUNTS.update(('cashLamports reservedLamports lockedDepositLamports '
 'executionCostsLamports contributionLamports initialLamports '
 'proposedConsumedLamports immediateNetLamports observedInventoryLargestBaseUnits '
 'minimumRawQuoteLamports maximumRawQuoteLamports assumedExternalSellBaseUnits '
 'grossCurveLamports retainedProfitFloorLamports profitProtectionFloorLamports '
 'stressedNetLamports historicalMaximumObservedAccountBaseUnits '
 'windowNetPurchasedLargestBaseUnits renewedDemandScenarioLamports').split())
UNSIGNED_AMOUNTS.update(('rawQuoteReserveLamports previousRawQuoteReserveLamports '
 'rawQuoteLamports priorRawQuoteLamports stressNetLamports').split())
SIGNED_AMOUNTS = {'realizedLamports', 'tradingMicroUsd', 'economicMicroUsd',
                  'roundingResidualMicroUsd'}
SIGNED_AMOUNTS.update(('recentNetBuyLamports scenarioNetSurplusLamports').split())
HASH_FIELDS = set(('sha256 policySha256 constructionSha256 intentSha256 '
 'quoteRentProofSha256 planSha256 authoritySha256 proofSha256 rawHash').split())
HASHED_TEXT = {'id', 'orderId', 'roundTripId', 'signalId', 'evidence',
               'decisionEvidence', 'refundEvidence', 'depositEvidence'}
PUBLIC_KEYS = {'mint':32, 'pool':32, 'subscriptionMint':32, 'subscriptionPool':32,
               'signature':64, 'freshOverlapSignature':64}
SIGNATURE_ARRAYS = set(('requiredSignatures comparedSignatures '
 'unconfirmedCapturedSignatures statusDisagreements boundaryExcludedSignatures '
 'addedSignatures matchedInteriorSignatures').split())
ROW_ARRAYS = set(('missingNotifications missingFailedNotifications '
 'missingSuccessfulNotifications addedPackets pages').split())
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def public_key(value, size):
    if not isinstance(value,str) or not 1 <= len(value) <= 88 or any(c not in BASE58 for c in value):
        return False
    number = 0
    for char in value:
        number = number * 58 + BASE58.index(char)
    zeroes = len(value)-len(value.lstrip('1'))
    return zeroes + (number.bit_length()+7)//8 == size

def record_bytes(record):
    return len(json.dumps(record,separators=(',',':'),allow_nan=False).encode())

def bounded_records(candidates, maximum, byte_limit):
    selected = []
    used = 0
    for record in candidates:
        size = record_bytes(record)
        if len(selected)<maximum and used+size<=byte_limit:
            selected.append(record)
            used += size
    return selected,used

def enforce_export_bound(value):
    """The installed readback accepts at most8MiB, including projection metadata.

    Trim only this public projection, oldest optional evidence first. Exact
    scanned/journal counts and hashes of retained records remain intact, while
    every removed row/file is explicitly reported as omitted.
    """
    def size():
        return record_bytes(value)+1  # main()/timer append one newline

    sections=[(value.get('supervisorEvents',{}),lambda r:not outcome_record(r)),
              (value.get('retainedEvents',{}),lambda r:r.get('stream')!='essential' and not outcome_record(r)),
              (value.get('retainedEvents',{}),lambda r:not outcome_record(r)),
              (value.get('financial',{}),lambda r:r.get('kind')=='reconcile'),
              (value.get('supervisorEvents',{}),lambda r:True),
              (value.get('retainedEvents',{}),lambda r:True),
              (value.get('financial',{}),lambda r:r.get('kind') not in {'order','attempt','paper-epoch-transition','inception','deposit-release'}),
              (value.get('financial',{}),lambda r:True)]
    sections=collections.deque(sections)
    while sections:
        section,optional=sections.popleft()
        excess=size()-MAX_EXPORT_BYTES
        if excess<=0:
            return value
        removed=[]
        kept=[]
        freed=0
        for row in section.get('records',[]):
            if freed<excess and optional(row):
                removed.append(row)
                freed+=record_bytes(row)+1
            else:
                kept.append(row)
        if not removed:
            continue
        section['records']=kept
        section['exportBoundOmittedRecords']=section.get('exportBoundOmittedRecords',0)+len(removed)
        omitted_key='omittedRecords' if 'intervalKindCounts' in section else 'omittedMatchingRecords'
        section[omitted_key]=section.get(omitted_key,0)+len(removed)
        retained_counts=collections.Counter(row['kind'] for row in kept)
        counts=section.get('intervalKindCounts',section.get('kindCounts',{}))
        section['retainedKindCounts']=dict(retained_counts)
        section['omittedKindCounts']={k:n-retained_counts[k] for k,n in counts.items() if n>retained_counts[k]}
        if 'distinctMintsInRetainedMatchingEvents' in section:
            section['distinctMintsInRetainedMatchingEvents']=len({row.get('data',{}).get('mint')
                for row in kept if isinstance(row.get('data',{}).get('mint'),str)})
        section['projectedRecordBytes']=sum(record_bytes(row) for row in kept)
        # Omission metadata can itself add bytes. Reuse this same lowest
        # priority class before escalating to protected audit outcomes.
        sections.appendleft((section,optional))
    # An unusually large retained-file census must not make every future export
    # unreadable. Preserve its newest metadata and report the omitted file count.
    for name in ('supervisorEvents','retainedEvents'):
        section=value.get(name,{})
        while section.get('files') and size()>MAX_EXPORT_BYTES:
            excess=size()-MAX_EXPORT_BYTES+128
            files=section['files']
            removed=freed=0
            for file in reversed(files):
                if freed>=excess:
                    break
                freed+=record_bytes(file)+1
                removed+=1
            del files[len(files)-removed:]
            section['exportBoundOmittedFiles']=section.get('exportBoundOmittedFiles',0)+removed
    if size()>MAX_EXPORT_BYTES:
        raise ValueError('READ_ONLY_DIAGNOSTIC_EXPORT_TOO_LARGE')
    return value

def read_regular(path, maximum=MAX_FILE):
    if path.parent.resolve(strict=True) != path.parent:
        raise ValueError('noncanonical parent')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size > maximum:
            raise ValueError('regular bounded file required')
        raw = os.read(fd, maximum + 1)
        end = os.fstat(fd)
        changed = (s.st_size, s.st_mtime_ns) != (end.st_size, end.st_mtime_ns)
        return raw, changed
    finally:
        os.close(fd)

def public_fields(value, depth=0):
    """Explicit data keys; unknown free text and nested payloads are not exported."""
    if not isinstance(value, dict) or depth > 6:
        return {}
    out = {}
    for key, item in value.items():
        if key in ENUM_FIELDS:
            if isinstance(item,str) and item in ENUM_FIELDS[key]:
                out[key]=item
        elif key in SCALARS and (item is None or type(item) is bool or
                type(item) in (int, float) and math.isfinite(item)):
            out[key] = item
        elif key in UNSIGNED_AMOUNTS | SIGNED_AMOUNTS:
            # Ledger quantities are bigint decimal strings. Do not coerce them
            # through float, accept arbitrary numeric-looking text or expose a
            # provider URL stored under an otherwise allowed key.
            pattern = r'(?:0|[1-9][0-9]{0,38})'
            if key in SIGNED_AMOUNTS:
                pattern = r'(?:0|-?[1-9][0-9]{0,38})'
            if item is None:
                out[key] = None
            elif isinstance(item, str) and re.fullmatch(pattern, item) and abs(int(item)) <= MAX_AMOUNT:
                out[key] = item
        elif key in HASH_FIELDS and isinstance(item, str) and re.fullmatch(r'[a-f0-9]{64}', item):
            out[key] = item
        elif key in HASHED_TEXT and isinstance(item, str):
            out[key + 'Sha256'] = digest(item.encode())
        elif key in PUBLIC_KEYS and public_key(item,PUBLIC_KEYS[key]):
            out[key] = item
        elif key == 'sourceCommit' and isinstance(item,str) and re.fullmatch(r'[a-f0-9]{40}',item):
            out[key] = item
        elif key == 'scenarios' and isinstance(item,list):
            names={'immediate-full-liquidation','latest-point-in-time-observed-account-balance-scenario',
                   'plausible-undisposed-window-net-purchases-scenario',
                   'historical-largest-executed-sell-repeat-diagnostic',
                   'historical-maximum-observed-account-balance-repeat-diagnostic',
                   'unobserved-seller-one-percent-pool-base-scenario'}
            kept=[{'name':row['name'],**public_fields(row,depth+1)} for row in item[:16]
                  if isinstance(row,dict) and row.get('name') in names]
            out[key]=kept
            out[key+'Projection']={'sourceItems':len(item),'retainedItems':len(kept),
                                  'omittedItems':len(item)-len(kept)}
        elif key in SIGNATURE_ARRAYS | ROW_ARRAYS and isinstance(item,list):
            kept=[]
            for row in item[:MAX_TYPED_ROWS]:
                if key in SIGNATURE_ARRAYS:
                    if public_key(row,64):
                        kept.append(row)
                elif isinstance(row,dict) and (key=='pages' or public_key(row.get('signature'),64)):
                    kept.append(public_fields(row,depth+1))
            out[key] = kept
            out[key+'Projection'] = {'sourceItems':len(item),'retainedItems':len(kept),
                                     'omittedItems':len(item)-len(kept)}
        elif key in OBJECTS and isinstance(item, dict):
            out[key] = public_fields(item, depth + 1)
        elif key == 'recentRestarts' and isinstance(item, list):
            out[key] = [public_fields(row, depth + 1) for row in item[-128:] if isinstance(row, dict)]
        elif key in STRINGS and isinstance(item, str):
            # Codes/identities only; provider messages may contain credential URLs.
            pattern = r'[A-Z][A-Z0-9_]{0,127}'
            if key in PUBLIC_KEYS:
                continue
            elif key == 'runId':
                pattern = r'native-paper-[0-9]{17}'
            elif key in {'kind', 'stage', 'state', 'outcome', 'method', 'purpose', 'side', 'sourceState', 'deliveryState', 'status', 'action', 'version', 'strategyVersion', 'mode', 'confirmationStatus', 'classification', 'anchorKind', 'completenessScope'}:
                pattern = r'[A-Za-z][A-Za-z0-9_-]{0,95}'
            out[key] = item if re.fullmatch(pattern, item) else {'sha256': digest(item.encode()), 'redacted': True}
    return out

def ledger_projection(path, start, end):
    # Do not create a missing DB or bypass its WAL. All statements share one read
    # transaction. No checkpoints, schema changes, mutating pragmas or repairs.
    if path.resolve(strict=True) != path or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('canonical existing ledger required')
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=2)
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        row = db.execute('SELECT body FROM financial_state WHERE singleton=1').fetchone()
        if not row or len(row[0].encode()) > MAX_FILE:
            raise ValueError('financial state unavailable or oversized')
        s = json.loads(row[0])
        if s.get('accountId') != ACCOUNT or s.get('inceptionAt') != INCEPTION or s.get('mode') != 'PAPER':
            raise ValueError('original PAPER identity required')
        journal = db.execute('SELECT count(*), min(revision), max(revision) FROM journal').fetchone()
        actions = db.execute('SELECT count(*) FROM actions').fetchone()[0]
        counts = dict(db.execute('SELECT kind,count(*) FROM journal WHERE at>=? AND at<? GROUP BY kind', (start,end)))
        # An explicit omission count keeps latest-N diagnostics honest.
        # Reconciliation is high frequency. It must not evict the orders,
        # attempts, capital transitions or risk changes needed to explain a loss.
        # Counts still cover the entire requested interval in this transaction.
        rows = db.execute("""SELECT revision,action_id,at,kind,detail FROM journal
            WHERE at>=? AND at<? ORDER BY CASE
              WHEN kind IN ('order','attempt','paper-epoch-transition','inception','deposit-release') THEN 0
              WHEN kind='reconcile' THEN 2 ELSE 1 END, revision DESC LIMIT ?""",
                          (start,end,MAX_RECORDS))
        records=[]
        projected_bytes=row_count=0
        for r in rows:
            row_count+=1
            record={'revision':r[0], 'actionIdSha256':digest(r[1].encode()),
                    'at':r[2], 'kind':r[3], 'detailSha256':digest(r[4].encode()),
                    'data':public_fields(json.loads(r[4]))}
            size=record_bytes(record)
            if projected_bytes+size<=MAX_PROJECTED_RECORD_BYTES:
                records.append(record)
                projected_bytes+=size
        records.sort(key=lambda r:r['revision'])
        retained_counts = collections.Counter(r['kind'] for r in records)
        # Scalar projection of the authoritative current state, not permission
        # to trade. Keep legacy latch facts separate from the active versioned
        # policy so a removed loss stop cannot be mistaken for a cleared ledger.
        balance=public_fields({'cashLamports':s.get('lamports'),
                              'realizedLamports':s.get('realizedLamports'),
                              'executionCostsLamports':s.get('executionCosts')})
        for name,values in [('reservedLamports',[o.get('reserved') for o in s['pending'].values()]),
                            ('lockedDepositLamports',list(s['lockedDeposits'].values()))]:
            if all(isinstance(v,str) and re.fullmatch(r'(?:0|[1-9][0-9]{0,38})',v) and int(v)<=MAX_AMOUNT for v in values):
                total=sum(int(v) for v in values)
                if total<=MAX_AMOUNT:
                    balance[name]=str(total)
        epoch=s.get('paperEpoch') or {}
        epoch_id=epoch.get('id')
        active_epoch={'id':epoch_id if epoch_id in ('poe-paper-10sol-20261030','poe-paper-10sol-v3-20261030') else None,
                      **public_fields({k:epoch.get(k) for k in ('version','startedAt','transitionRevision','initialLamports','contributionLamports')})}
        risk=s.get('equityRisk') or {}
        known_version=risk.get('version') in ('paper-equity-risk-5-10-v1','paper-equity-risk-v3-no-daily-stop-v1')
        no_daily_stop=epoch_id=='poe-paper-10sol-v3-20261030' and risk.get('version')=='paper-equity-risk-v3-no-daily-stop-v1'
        risk_projection={'version':risk.get('version') if known_version else None,
                         'dailyLossStopEnabled':not no_daily_stop if known_version else None,
                         'entryConsumedCostBps':500 if known_version else None,
                         'daily':public_fields(risk.get('daily') or {})}
        return {'available':True, 'accountId':ACCOUNT, 'inceptionAt':INCEPTION,
                'revision':s['revision'], 'stateBodySha256':digest(row[0].encode()),
                'actions':actions, 'journalRows':journal[0], 'firstRevision':journal[1],
                'lastRevision':journal[2], 'positionCount':len(s['positions']),
                'pendingCount':len(s['pending']), 'lockedDepositCount':len(s['lockedDeposits']),
                'controls':public_fields(s['controls']),
                'balances':balance,'activeEpoch':active_epoch,'riskPolicy':risk_projection,
                'daily':public_fields(s['daily']), 'intervalKindCounts':counts,
                'records':records, 'omittedRecords':sum(counts.values())-len(records),
                'selectionPolicy':'financial-actions-then-controls-then-latest-reconciliations',
                'retainedKindCounts':dict(retained_counts),
                'omittedKindCounts':{k:n-retained_counts[k] for k,n in counts.items() if n>retained_counts[k]},
                'projectedRecordBytes':projected_bytes,
                'projectedRecordByteBoundReached':len(records)<row_count,
                'financialWrites':0, 'consistentReadTransaction':True,
                'meaning':'Read-only diagnostic projection; counts are exact for this read transaction, records may be explicitly bounded. Not a backup or independent economic validation.'}
    finally:
        db.close()

OUTCOME_KINDS = frozenset(('native-candidate-window-audit native-audit-dispatch-summary '
    'native-audit-dispatch-state native-flow-audit-post-snapshot-tail '
    'native-active-strategy-assessment native-predictive-assessment '
    'trader-predictive-assessment trader-decision trader-held-evaluation '
    'trader-execution trader-pilot-execution-quote native-paper-entry-permission '
    'native-paper-entry-work-completed paper-execution-plan paper-execution-landing-state '
    'native-paper-start native-paper-frozen-start pilot-watch-transition '
    'pilot-watch-complete-window native-flow-transport-integrity-gap '
    'pilot-feed-reconnect-scheduled native-paper-admission-suspended '
    'native-candidate-source-admissions-closed native-paper-technical-reevaluation-request').split())
RAW_EVENT_KINDS = frozenset(('native-flow-information-available native-flow-validated-events '
    'trader-input pilot-watch-activity trader-context research-clock-pool-state '
    'research-clock-position-sell-quote qualification-proof-pinned '
    'native-paper-entry-proof-pinned').split())
FAILURE_CODE = re.compile(r'(?:^|[-_])(unavailable|error|failed|failure|refused|timeout|expired|deadline)(?:$|[-_])',re.I)

def event_bucket(record):
    kind=record['kind']
    data=record['data']
    mint=data.get('mint','')
    if kind in RAW_EVENT_KINDS:
        return (0,kind,mint,False)
    outcome=kind in OUTCOME_KINDS
    failure=any(part in kind for part in (
        '-refus', '-unavailable', '-failure', '-failed', '-timeout', '-quality-gap',
        '-deadline', '-gap'))
    outcome|=failure or '-protection' in kind or '-recovery' in kind
    if type(data.get('httpStatus')) is int and 400<=data['httpStatus']<=599:
        failure=True
    # A shared dispatch/RPC event kind may report both successful and failed
    # outcomes. Classify only projected codes, never provider/free-form text.
    for values in (data,data.get('result',{})):
        if not isinstance(values,dict):
            continue
        for key in ('status','outcome','reasonCode','classification'):
            value=values.get(key)
            failure|=isinstance(value,str) and FAILURE_CODE.search(value) is not None
        if outcome:
            failure|=values.get('usable') is False or values.get('success') is False
    # Failure and completed evaluations of the same kind/mint each retain
    # recent evidence; a success flood must not hide the last failed check.
    return (int(outcome or failure),kind,mint,failure)

def outcome_record(record):
    return bool(event_bucket(record)[0])

class FairEventReservoir:
    """Bounded newest samples, outcomes first, fair by kind and public mint.

    A single hot kind/mint cannot evict every sparse outcome. Indexed eviction
    is amortized logarithmic; lazy indices are periodically compacted so scan
    volume cannot grow retention memory without bound.
    """
    def __init__(self):
        self.buckets={}
        self.kinds={}
        self.indices={0:[],1:[]}
        self.count=self.bytes=self.version=self.index_entries=0
        self.byte_bound=False

    def index(self,key):
        bucket=self.buckets[key]
        self.version+=1
        bucket['version']=self.version
        heap=bucket['heap']
        pressure=max(len(heap)*MAX_PROJECTED_RECORD_BYTES,bucket['bytes']*MAX_RECORDS)
        kind=self.kinds[key[:2]]
        heapq.heappush(kind['index'],(-pressure,heap[0][0],heap[0][1],self.version,key))
        self.version+=1
        kind['version']=self.version
        pressure=max(kind['count']*MAX_PROJECTED_RECORD_BYTES,kind['bytes']*MAX_RECORDS)
        heapq.heappush(self.indices[key[0]],(-pressure,self.version,key[:2]))
        self.index_entries+=2

    def worst(self):
        for priority in (0,1):
            index=self.indices[priority]
            while index:
                _,version,key=index[0]
                kind=self.kinds.get(key)
                if kind is not None and kind['version']==version:
                    break
                heapq.heappop(index)
                self.index_entries-=1
            if index:
                local=kind['index']
                while local:
                    _,_,_,version,key=local[0]
                    bucket=self.buckets.get(key)
                    if bucket is not None and bucket['version']==version:
                        return key
                    heapq.heappop(local)
                    self.index_entries-=1
        raise AssertionError('retention index invariant')

    def compact(self):
        if self.index_entries>4*MAX_RECORDS+16:
            self.indices={0:[],1:[]}
            self.index_entries=0
            for kind in self.kinds.values():
                kind['index']=[]
            for key in self.buckets:
                self.index(key)

    def add(self,item):
        size=item[3]
        if size>MAX_PROJECTED_RECORD_BYTES:
            self.byte_bound=True
            return
        key=event_bucket(item[2])
        bucket=self.buckets.get(key)
        # Newest segments are scanned first. Once a bucket is the next fair
        # eviction target, an older equal-sized row cannot improve it. Replace
        # a newer row directly without inserting/evicting/reindexing twice.
        if bucket and (self.count>=MAX_RECORDS or self.bytes+size>MAX_PROJECTED_RECORD_BYTES) and size==bucket['heap'][0][3] and self.worst()==key:
            if self.bytes+size>MAX_PROJECTED_RECORD_BYTES:
                self.byte_bound=True
            if item[:2]>bucket['heap'][0][:2]:
                heapq.heapreplace(bucket['heap'],item)
                self.index(key)
                self.compact()
            return
        bucket=self.buckets.setdefault(key,{'heap':[],'bytes':0})
        kind=self.kinds.setdefault(key[:2],{'count':0,'bytes':0,'index':[],'keys':set()})
        kind['keys'].add(key)
        heapq.heappush(bucket['heap'],item)
        bucket['bytes']+=size
        kind['count']+=1
        kind['bytes']+=size
        self.count+=1
        self.bytes+=size
        self.index(key)
        while self.count>MAX_RECORDS or self.bytes>MAX_PROJECTED_RECORD_BYTES:
            self.byte_bound|=self.bytes>MAX_PROJECTED_RECORD_BYTES
            worst=self.worst()
            worst_kind=worst[:2]
            current_kind=self.kinds[worst_kind]
            current=self.buckets[worst]
            removed=heapq.heappop(current['heap'])
            self.count-=1
            self.bytes-=removed[3]
            current['bytes']-=removed[3]
            current_kind['count']-=1
            current_kind['bytes']-=removed[3]
            if current['heap']:
                self.index(worst)
            else:
                del self.buckets[worst]
                current_kind['keys'].remove(worst)
                if not current_kind['count']:
                    del self.kinds[worst_kind]
                else:
                    # Reindex a surviving bucket to update its kind pressure.
                    surviving=next(iter(current_kind['keys']))
                    self.index(surviving)
        self.compact()

    def index_size(self):
        return self.index_entries

    def items(self):
        return [item for bucket in self.buckets.values() for item in bucket['heap']]

def fair_event_order(items):
    # Round robin kinds, and then mints within each kind. Each bucket yields its
    # newest record first; repeated outcomes remain available with spare space.
    kinds={}
    for item in sorted(items,reverse=True):
        record=item[2]
        kinds.setdefault(record['kind'],{}).setdefault(event_bucket(record)[2:],collections.deque()).append(item)
    queues={kind:collections.deque(buckets.values()) for kind,buckets in kinds.items()}
    active=collections.deque(queues)
    ordered=[]
    while active:
        kind=active.popleft()
        mints=queues[kind]
        bucket=mints.popleft()
        ordered.append(bucket.popleft())
        if bucket:
            mints.append(bucket)
        if mints:
            active.append(kind)
    return ordered

def event_projection(paths, start, end):
    counts = collections.Counter()
    mints = set()
    # Keep newest matching observations rather than the last *scanned* ones:
    # scanning newest segments first must not let an older segment evict them.
    records = {stream:FairEventReservoir() for stream in ('essential','diagnostic','other')}
    counts_by_stream = {stream:collections.Counter() for stream in records}
    groups = {stream:[] for stream in records}
    for path in paths:
        stream = 'essential' if path.name.startswith('essential-') else 'diagnostic' if path.name.startswith('diagnostic-') else 'other'
        groups[stream].append(path)
    files = []
    scanned = 0
    malformed = partial = oversized = 0
    bounded = False
    serial = 0
    projection_byte_bound = False
    # Essential gets the first bounded share; diagnostics retain at least one
    # quarter when both streams are present. Unused capacity is never withheld.
    essential_limit = MAX_SCAN if not groups['diagnostic'] and not groups['other'] else MAX_SCAN * ESSENTIAL_SHARE_NUMERATOR // ESSENTIAL_SHARE_DENOMINATOR
    scheduled = [(stream,path,essential_limit if stream=='essential' else MAX_SCAN,stream=='essential') for stream in ('essential','diagnostic','other')
                 for path in reversed(groups[stream])]
    for stream,path,limit,defer in scheduled:
        try:
            size = path.stat().st_size
            if scanned + size > limit:
                if defer:
                    # After optional context is scanned, use any unused bytes
                    # for essential files instead of withholding that capacity.
                    scheduled.append((stream,path,MAX_SCAN,False))
                    continue
                bounded = True
                files.append({'name':path.name,'stream':stream,'available':False,
                              'reasonCode':'SCAN_BYTE_BUDGET','bytesNotScanned':size})
                continue
            raw, changed = read_regular(path)
        except (OSError,ValueError):
            files.append({'name':path.name, 'available':False})
            continue
        scanned += len(raw)
        files.append({'name':path.name, 'stream':stream,'bytes':len(raw), 'sha256':digest(raw), 'changedDuringRead':changed})
        lines = raw.splitlines()
        if raw and not raw.endswith(b'\n'):
            partial += 1
            lines = lines[:-1]
        for line in lines:
            if len(line) > 1024*1024:
                oversized += 1
                continue
            try:
                v=json.loads(line)
                if not isinstance(v,dict):
                    raise ValueError()
                at=v.get('receivedAt',v.get('at'))
                # Recorders use ISO or millisecond times; never invent missing time.
                if isinstance(at,str):
                    at=int(datetime.datetime.fromisoformat(at.replace('Z','+00:00')).timestamp()*1000)
                if type(at) not in (int,float) or not start<=at<end:
                    continue
                kind=v.get('kind')
                if not isinstance(kind,str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,127}',kind):
                    raise ValueError()
                data=public_fields(v.get('data',{}))
                mint=data.get('mint')
                if isinstance(mint,str):
                    mints.add(mint)
                counts[kind]+=1
                counts_by_stream[stream][kind]+=1
                serial += 1
                record = {'at':at,'kind':kind,'stream':stream,'data':data,'lineSha256':digest(line)}
                size = record_bytes(record)
                item = (at,serial,record,size)
                records[stream].add(item)
            except (ValueError,TypeError,OverflowError,RecursionError):
                malformed+=1
    projection_byte_bound|=any(reservoir.byte_bound for reservoir in records.values())
    all_items=[item for reservoir in records.values() for item in reservoir.items()]
    outcomes=fair_event_order([item for item in all_items if outcome_record(item[2])])
    context=[item for item in all_items if not outcome_record(item[2])]
    outcome_count=min(len(outcomes),MAX_RECORDS if not context else max(
        MAX_RECORDS*ESSENTIAL_SHARE_NUMERATOR//ESSENTIAL_SHARE_DENOMINATOR,
        MAX_RECORDS-len(context)))
    outcome_bytes_limit=MAX_PROJECTED_RECORD_BYTES if not context else MAX_PROJECTED_RECORD_BYTES*ESSENTIAL_SHARE_NUMERATOR//ESSENTIAL_SHARE_DENOMINATOR
    kept_outcomes,outcome_bytes=bounded_records([item[2] for item in outcomes],outcome_count,outcome_bytes_limit)
    remaining_count=MAX_RECORDS-len(kept_outcomes)
    remaining_bytes=MAX_PROJECTED_RECORD_BYTES-outcome_bytes
    # Context keeps the original essential/optional share. Outcome priority
    # crosses stream boundaries: a diagnostic audit cannot lose to raw flow.
    essential = fair_event_order([item for item in context if item[2]['stream']=='essential'])
    optional = fair_event_order([item for item in context if item[2]['stream']!='essential'])
    essential_count = min(len(essential),remaining_count if not optional else max(
        remaining_count*ESSENTIAL_SHARE_NUMERATOR//ESSENTIAL_SHARE_DENOMINATOR,
        remaining_count-len(optional)))
    essential_candidates = [item[2] for item in essential]
    optional_candidates = [item[2] for item in optional]
    essential_byte_limit = remaining_bytes if not optional else remaining_bytes*ESSENTIAL_SHARE_NUMERATOR//ESSENTIAL_SHARE_DENOMINATOR
    kept_essential,essential_bytes = bounded_records(essential_candidates,essential_count,essential_byte_limit)
    kept_optional,optional_bytes = bounded_records(optional_candidates,remaining_count-len(kept_essential),remaining_bytes-essential_bytes)
    used_ids = {id(record) for record in kept_essential}
    extra_essential,extra_bytes = bounded_records(
        [record for record in essential_candidates if id(record) not in used_ids],
        remaining_count-len(kept_essential)-len(kept_optional),
        remaining_bytes-essential_bytes-optional_bytes)
    kept_essential+=extra_essential
    essential_bytes+=extra_bytes
    outcome_ids={id(record) for record in kept_outcomes}
    extra_outcomes,extra_outcome_bytes=bounded_records(
        [item[2] for item in outcomes if id(item[2]) not in outcome_ids],
        MAX_RECORDS-len(kept_outcomes)-len(kept_essential)-len(kept_optional),
        MAX_PROJECTED_RECORD_BYTES-outcome_bytes-essential_bytes-optional_bytes)
    kept_outcomes+=extra_outcomes
    outcome_bytes+=extra_outcome_bytes
    keep_ids = {id(record) for record in kept_outcomes+kept_essential+kept_optional}
    selected = [item for item in all_items if id(item[2]) in keep_ids]
    selected.sort(key=lambda item:item[:2])
    retained = [item[2] for item in selected]
    retained_counts = collections.Counter(r['kind'] for r in retained)
    return {'files':files,'bytesScanned':scanned,'scanBoundReached':bounded,
            'malformedRecords':malformed,'partialTrailingRecords':partial,
            'oversizedRecords':oversized,'kindCounts':dict(counts),
            'distinctMintsInRetainedMatchingEvents':len({r['data']['mint'] for r in retained if isinstance(r['data'].get('mint'),str)}),
            'distinctMintsInScannedMatchingEvents':len(mints),
            'records':retained,'omittedMatchingRecords':sum(counts.values())-len(retained),
            'selectionPolicy':'outcomes-first-fair-kind-and-mint-newest-samples-with-context-share',
            'kindCountsByStream':{k:dict(v) for k,v in counts_by_stream.items()},
            'retainedKindCounts':dict(retained_counts),
            'omittedKindCounts':{k:n-retained_counts[k] for k,n in counts.items() if n>retained_counts[k]},
            'projectedRecordBytes':outcome_bytes+essential_bytes+optional_bytes,
            'projectedRecordByteBoundReached':projection_byte_bound or len(retained)<min(MAX_RECORDS,len(all_items)),
            'coverage':'Retained selected files only; rotation, omitted files, untimestamped console lines and scan bounds prevent a claim of complete historical coverage.'}

def export(root, start, end):
    value={'schemaVersion':1,'kind':'POE_RELEASE_INDEPENDENT_READ_ONLY_DIAGNOSTICS',
           'diagnosticProjectionVersion':'outcome-kind-mint-v2',
           'generatedAt':int(time.time()*1000),'window':{'fromAt':start,'untilAtExclusive':end},
           'credentialReads':0,'financialWrites':0,'serviceChanges':0,'providerRequests':0}
    try:
        value['financial']=ledger_projection(root/'state/ledger.sqlite',start,end)
    except (OSError,ValueError,sqlite3.Error,KeyError):
        value['financial']={'available':False,'reasonCode':'READ_ONLY_FINANCIAL_PROJECTION_UNAVAILABLE'}
    for label,path in [('runtime',root/'native-engine/status.json'),('supervisor',root/'service/health.json'),('lifetimeEquity',root/'lifetime-equity/status.json')]:
        try:
            raw,changed=read_regular(path)
            value[label]={'available':True,'sha256':digest(raw),'changedDuringRead':changed,'data':public_fields(json.loads(raw))}
        except (OSError,ValueError):
            value[label]={'available':False}
    paths=[]
    directory=root/'native-engine/service-evidence'
    try:
        if directory.resolve(strict=True)!=directory:
            raise ValueError('canonical evidence required')
        paths=sorted(p for p in directory.iterdir() if re.fullmatch(r'(diagnostic|essential)-[0-9]{12}\.ndjson',p.name) and not p.is_symlink())
    except (OSError,ValueError):
        pass
    value['retainedEvents']=event_projection(paths,start,end)
    directory=root/'service/diagnostics'
    try:
        if directory.resolve(strict=True)!=directory:
            raise ValueError('canonical supervisor diagnostics required')
        paths=sorted((p for p in directory.iterdir() if re.fullmatch(r'supervisor-[0-9]+\.log',p.name) and not p.is_symlink()), key=lambda p:p.stat().st_mtime_ns)
        value['supervisorEvents']=event_projection(paths,start,end)
    except (OSError,ValueError):
        value['supervisorEvents']={'available':False}
    return enforce_export_bound(value)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-ms',type=int,required=True)
    parser.add_argument('--until-ms',type=int,required=True)
    args=parser.parse_args()
    if not 0<=args.from_ms<args.until_ms<=int(time.time()*1000)+5000:
        parser.error('ordered actual timestamp window required')
    print(json.dumps(export(ROOT,args.from_ms,args.until_ms),separators=(',',':'),allow_nan=False))

if __name__=='__main__':
    main()
