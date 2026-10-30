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
OBJECTS = set(('timing protection protectionRecovery failureStages provider rpc '
 'resources resource cpu processes source publisher financialReadiness safety '
 'reporting dispatchTrace localPhases diagnostics usage localPhases '
 'queueAgeMs entryQuoteFailures contextFailureCounts sourceRecovery '
 'auditDispatchTrace financialPolicy daily entry risk execution valuation equityCompanion store').split())
STRINGS = {'kind', 'reasonCode', 'stage', 'state', 'outcome', 'method', 'purpose',
           'reason', 'runId', 'mint', 'side', 'code', 'sourceState', 'ingestionReasonCode', 'deliveryState'}

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

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
        if key in SCALARS and (item is None or type(item) is bool or
                type(item) in (int, float) and math.isfinite(item)):
            out[key] = item
        elif key in OBJECTS and isinstance(item, dict):
            out[key] = public_fields(item, depth + 1)
        elif key == 'recentRestarts' and isinstance(item, list):
            out[key] = [public_fields(row, depth + 1) for row in item[-128:] if isinstance(row, dict)]
        elif key in STRINGS and isinstance(item, str):
            # Codes/identities only; provider messages may contain credential URLs.
            pattern = r'[A-Z][A-Z0-9_]{0,127}'
            if key == 'mint':
                pattern = r'[1-9A-HJ-NP-Za-km-z]{32,44}'
            elif key == 'runId':
                pattern = r'native-paper-[0-9]{17}'
            elif key in {'kind', 'stage', 'state', 'outcome', 'method', 'purpose', 'side', 'sourceState', 'deliveryState'}:
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
        rows = db.execute('SELECT revision,action_id,at,kind,detail FROM journal WHERE at>=? AND at<? ORDER BY revision DESC LIMIT ?', (start,end,MAX_RECORDS)).fetchall()
        records = [{'revision':r[0], 'actionIdSha256':digest(r[1].encode()),
                    'at':r[2], 'kind':r[3], 'detailSha256':digest(r[4].encode()),
                    'data':public_fields(json.loads(r[4]))} for r in reversed(rows)]
        return {'available':True, 'accountId':ACCOUNT, 'inceptionAt':INCEPTION,
                'revision':s['revision'], 'stateBodySha256':digest(row[0].encode()),
                'actions':actions, 'journalRows':journal[0], 'firstRevision':journal[1],
                'lastRevision':journal[2], 'positionCount':len(s['positions']),
                'pendingCount':len(s['pending']), 'lockedDepositCount':len(s['lockedDeposits']),
                'controls':public_fields(s['controls']),
                'daily':public_fields(s['daily']), 'intervalKindCounts':counts,
                'records':records, 'omittedRecords':sum(counts.values())-len(records),
                'financialWrites':0, 'consistentReadTransaction':True,
                'meaning':'Read-only diagnostic projection; counts are exact for this read transaction, records may be explicitly bounded. Not a backup or independent economic validation.'}
    finally:
        db.close()

def event_projection(paths, start, end):
    counts = collections.Counter()
    mints = set()
    records = collections.deque(maxlen=MAX_RECORDS)
    files = []
    scanned = 0
    malformed = partial = oversized = 0
    bounded = False
    for path in paths:
        try:
            if scanned + path.stat().st_size > MAX_SCAN:
                bounded = True
                break
            raw, changed = read_regular(path)
        except (OSError,ValueError):
            files.append({'name':path.name, 'available':False})
            continue
        scanned += len(raw)
        files.append({'name':path.name, 'bytes':len(raw), 'sha256':digest(raw), 'changedDuringRead':changed})
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
                records.append({'at':at,'kind':kind,'data':data,'lineSha256':digest(line)})
            except (ValueError,TypeError,OverflowError):
                malformed+=1
    return {'files':files,'bytesScanned':scanned,'scanBoundReached':bounded,
            'malformedRecords':malformed,'partialTrailingRecords':partial,
            'oversizedRecords':oversized,'kindCounts':dict(counts),
            'distinctMintsInRetainedMatchingEvents':len(mints),
            'records':list(records),'omittedMatchingRecords':sum(counts.values())-len(records),
            'coverage':'Retained selected files only; rotation, omitted files, untimestamped console lines and scan bounds prevent a claim of complete historical coverage.'}

def export(root, start, end):
    value={'schemaVersion':1,'kind':'POE_RELEASE_INDEPENDENT_READ_ONLY_DIAGNOSTICS',
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
    return value

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
