#!/usr/bin/env python3
"""Reproduce entry-readiness facts from preserved original public GET receipts.

No network, ledger reads, service controls, or application changes.
"""
import datetime
import hashlib
import json
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
ARCHIVE = HERE.parent / 'cloud-recovery-1756'
REPOSITORY = next(p for p in HERE.parents if (p / '.git').exists())
SOURCE = 'cdba9d483fdcef105e74e3053a8d4bbf28bdff0c'
ACCOUNT = 'poe-3123e352-4581-455b-85db-acd7e825e99e'
CORE_FIELDS = ('account', 'source', 'sequence', 'times', 'status', 'intelligence', 'funnel', 'balances', 'positions', 'trades')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def millis(at):
    return round(datetime.datetime.fromisoformat(at.replace('Z', '+00:00')).timestamp() * 1000)


def utc(at):
    return datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


manifest_raw = (ARCHIVE / 'manifest.json').read_bytes()
manifest = json.loads(manifest_raw)
found = {}
locations = {}
inputs = []
duplicates = []
conflicts = []
malformed = []
for item in manifest['files']:
    path = ARCHIVE / item['file']
    raw = path.read_bytes()
    assert len(raw) == item['bytes'] and digest(raw) == item['sha256'], path
    inputs.append(dict(item))
    if path.suffix != '.ndjson':
        continue
    for number, line in enumerate(raw.splitlines(), 1):
        try:
            row = json.loads(line)
        except (UnicodeError, ValueError):
            malformed.append({'file': path.name, 'line': number})
            continue
        sequence = row.get('sequence')
        if not str(sequence).isdigit() or not 9304 <= int(sequence) <= 9314:
            continue
        assert row['account']['id'] == ACCOUNT and row['source']['release'] == SOURCE
        key = str(sequence)
        core = json.dumps({name: row[name] for name in CORE_FIELDS}, sort_keys=True, separators=(',', ':')).encode()
        location = {'file': path.name, 'line': number, 'rawLineSha256': digest(line), 'coreSnapshotSha256': digest(core)}
        locations.setdefault(key, []).append(location)
        if key in found:
            previous = json.dumps({name: found[key][name] for name in CORE_FIELDS}, sort_keys=True, separators=(',', ':')).encode()
            if previous != core:
                conflicts.append({'sequence': key, **location})
            else:
                duplicates.append({'sequence': key, **location})
            continue
        found[key] = row

assert '9307' in found and '9310' in found and not conflicts
rows = [found[key] for key in sorted(found, key=int)]
frozen = b''.join(json.dumps(row, separators=(',', ':'), ensure_ascii=False).encode() + b'\n' for row in rows)
(HERE / 'snapshots.ndjson').write_bytes(frozen)

summaries = []
for row in rows:
    at = millis(row['times']['generatedAt'])
    i = row['intelligence']
    provider = i['provider']
    reconciled = millis(row['times']['reconciledAt']) if row['times']['reconciledAt'] else None
    market = millis(row['times']['marketAt']) if row['times']['marketAt'] else None
    held = len(row['positions'])
    pending = len(i['pendingOrders'])
    summaries.append({
        'sequence': row['sequence'],
        'sourceGeneratedAt': row['times']['generatedAt'],
        'renderReceivedAt': row['freshness']['receivedAt'],
        'cloudRequestedAt': utc(row['requestedAt']),
        'cloudReceivedAt': utc(row['receivedAt']),
        'sourceAgeAtRenderReceiptMs': millis(row['freshness']['receivedAt']) - at,
        'sourceAgeAtCloudObservationMs': row['receivedAt'] - at,
        'status': row['status'],
        'reconciledAt': row['times']['reconciledAt'],
        'reconciliationAgeAtSourceMs': None if reconciled is None else at - reconciled,
        'reconciliationWithin2000ms': reconciled is not None and 0 <= at - reconciled <= 2000,
        'marketAt': row['times']['marketAt'],
        'marketAgeAtSourceMs': None if market is None else at - market,
        'flatMarketTimestampIsActualUsdPriceTimestamp': held == 0,
        'usdPriceAgeAtSourceMs': at - market if held == 0 and market is not None else None,
        'usdPriceWithin10000ms': held == 0 and market is not None and 0 <= at - market <= 10000,
        'solPriceUsd': row['balances']['solPriceUsd'],
        'usdEquityAvailable': row['balances']['equityUsd'] is not None,
        'cashSol': row['balances']['cashSol'],
        'reservedSol': row['balances']['reservedSol'],
        'equitySol': row['balances']['equitySol'],
        'heldPositions': held,
        'pendingOrders': pending,
        'quality': i['quality'],
        'provider': provider,
        'primaryCooldownActiveAtSource': provider['primaryCooldownUntil'] is not None and millis(provider['primaryCooldownUntil']) > at,
        'historyCooldownActiveAtSource': provider['historyCooldownUntil'] is not None and millis(provider['historyCooldownUntil']) > at,
        'admission': i['admission'],
        'sourceTimes': i['times'],
        'resources': i['resources'],
        'protection': i['protection'],
        'runId': i['run']['id'],
        'configurationSha256': i['run']['configurationSha256'],
        'financialFunnel': row['funnel'],
        'rawLedgerControlsAvailable': False,
    })

source_files = {}
needles = {
    'src/run-native-paper.ts': ['lastProtectionStart>=5000', 'blocker:projection.entriesEnabled?null:state.controls.reason'],
    'src/pilot-reporting.ts': ['status:{runtime:', 'at-s.daily.reconciledAt<=2000', 'markTimes.length?Math.min'],
    'src/ledger.ts': ['const dayFresh =', 'entriesEnabled: s.controls.entriesEnabled', 's.controls = { entriesEnabled: true'],
}
for name, patterns in needles.items():
    raw = subprocess.run(['git', 'show', SOURCE + ':' + name], cwd=REPOSITORY, check=True, stdout=subprocess.PIPE).stdout
    lines = raw.decode().splitlines()
    source_files[name] = {'sha256': digest(raw), 'matchedLines': [
        {'line': n, 'text': line} for n, line in enumerate(lines, 1) if any(pattern in line for pattern in patterns)
    ]}

report = {
    'kind': 'POE_EXACT_PUBLIC_ENTRY_READINESS_CORRELATION',
    'sourceCommit': SOURCE,
    'accountId': ACCOUNT,
    'archiveManifestSha256': digest(manifest_raw),
    'archiveInputs': inputs,
    'frozenRows': {'file': 'snapshots.ndjson', 'rows': len(rows), 'bytes': len(frozen), 'sha256': digest(frozen)},
    'locations': locations,
    'duplicateSourceSnapshots': duplicates,
    'conflictingSourceSnapshots': conflicts,
    'malformedLines': malformed,
    'sourceCode': source_files,
    'focus': [s for s in summaries if s['sequence'] in ('9307', '9310')],
    'brackets': summaries,
    'conclusions': [
        'The user-reported17:47:05/17:47:51 times are Render receipt times, not source generation times.',
        '9307 was generated54ms after reconciliation;9310 was generated5050ms after reconciliation and therefore correctly fails the unchanged2000ms financial gate.',
        'Both snapshots are flat with no pending orders; their marketAt fields are consequently the actual USD price timestamps. Price ages2825ms/3249ms remain within the existing10000ms rule.',
        'HTTP timeout/error/throttle and quality-gap/audit-failure counters did not increase between these two source snapshots. Provider cooldowns shown in both were already expired.',
        'Capture, broad discovery, watch and public resource/evidence/supervision gates are healthy in both snapshots. These snapshots do not prove the absence of unsampled incidents.',
        'Installed source flat maintenance is discretionary at>=5000ms; actual order/projection financial gates require reconciliation age<=2000ms. This is a demonstrated scheduling mismatch, not a reason to relax the guard.',
        'Public status.entries is derived from projection.entriesEnabled AND portfolio reconciliation validity. It is not a direct export of durable controls.entriesEnabled.',
        'The11bracketing snapshots include7entry-paused states; all7have reconciliation ages>2000ms while every USD price age is<10000ms. Reconciliation counters generally rise3per15s, consistent with the installed5s flat cadence.',
        'The paused snapshot reuses controls.reason from the last recorded state; explicit verified runtime readiness is a successful resume label, not proof that a new technical pause occurred.',
        'The exact durable controls/daily-loss state and any pause/resume journal events were not read. Do not infer a private ledger transition solely from these public fields.',
    ],
    'limitations': [
        'No network, provider requests, original financial database reads, service controls or code modifications.',
        'Snapshots are samples; overlapping observations do not establish continuous financial readiness.',
        'Financial amounts remain original source projections. No profitable opportunity or execution miss is inferred.',
    ],
}
(HERE / 'correlation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'rows': len(rows), 'sourceSnapshots': [s['sequence'] for s in summaries], 'focus': [{k: s[k] for k in ('sequence', 'sourceGeneratedAt', 'renderReceivedAt', 'reconciliationAgeAtSourceMs', 'usdPriceAgeAtSourceMs', 'status')} for s in report['focus']], 'conflicts': conflicts, 'sha256': digest(frozen)}, indent=2))
