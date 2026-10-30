#!/usr/bin/env python3
"""Reproduce bounded local correlation. No network, account DB or service access."""
import collections
import datetime
import hashlib
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
HOST = ROOT / 'evidence/provider-protection-recovery-20261030/post-install/host/host-40983714483.json'
SUPERVISION = ROOT / 'evidence/coherent-protection-recovery-20261029/post-install/supervision'
SOURCE = '93bf0b5d6a3f1258a74ac696798fb4e0ec6147a2'
inputs = {}


def read(path):
    raw = path.read_bytes()
    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
    return raw


def iso(value):
    return datetime.datetime.fromtimestamp(value / 1000, datetime.timezone.utc).isoformat()


host = json.loads(read(HOST))
receipt = host['providerRecoveryForensics']
value = receipt['value']
preflight = host['upgradeVerification']['value']['forensicPreflight']
assert receipt['available'] is True and receipt['receiptVerified'] is True
assert receipt['sha256'] == preflight['receipt']['sha256'] == preflight['rootCopySha256']
assert receipt['bytes'] == preflight['receipt']['bytes'] == 100707
assert receipt['scriptSha256'] == preflight['scriptSha256'] == 'e1c04bc56c27e2341b188d441055eaf5b1eac245ad1d390157a14e3b3d129f7e'
assert value['source']['commit'] == preflight['source']['commit'] == SOURCE
assert value['runId'] == 'native-paper-20261029234856700'
assert not value['financialDatabaseOpened'] and value['financialWrites'] == value['serviceControlOperations'] == value['credentialReads'] == 0

observations = {}
for name in ['provider-incident-0012', 'holding-abort-0018', 'active-window-0013']:
    for line in read(SUPERVISION / name / 'source-observations.ndjson').decode().splitlines():
        row = json.loads(line)
        assert row['source']['release'] == SOURCE
        observations[row['sequence']] = row


def frame(sequence):
    row = observations[sequence]
    intelligence = row['intelligence']
    failures = {}
    for text in intelligence['quality']['limitations']:
        failures.update({key: int(count) for key, count in re.findall(r'(HELD_PRICING_[A-Z_]+):(\d+)', text)})
    return {
        'sequence': sequence, 'sourceAt': row['times']['generatedAt'],
        'responseSha256': row['responseSha256'], 'status': row['status'],
        'protection': intelligence['protection'],
        'provider': {key: intelligence['provider'][key] for key in ['rpcRequests', 'httpTimeouts', 'httpErrors', 'throttles', 'rollingStartsPerMinute', 'primaryCooldownUntil']},
        'heldRefusals': failures, 'selectedCapture': intelligence['quality']['captureConnected'],
        'admission': intelligence['admission'], 'resources': intelligence['resources'],
    }


def bracket(a, b):
    before, after = frame(a), frame(b)
    return {
        'before': before, 'after': after,
        'protectionDelta': {key: after['protection'][key] - before['protection'][key] for key in ['breaches', 'unavailableChecks']},
        'providerDelta': {key: after['provider'][key] - before['provider'][key] for key in ['rpcRequests', 'httpTimeouts', 'httpErrors', 'throttles']},
        'heldRefusalDelta': {key: after['heldRefusals'].get(key, 0) - before['heldRefusals'].get(key, 0) for key in set(before['heldRefusals']) | set(after['heldRefusals'])},
    }


diagnostics = value['diagnostics']
facts = diagnostics['facts']
windows = []
for window in value['priorityWindows']:
    rows = sorted([r for r in facts if window['fromAt'] <= r['at'] < window['untilAtExclusive']], key=lambda r: r['at'])
    held = [r for r in rows if r['kind'] == 'trader-held-evaluation']
    unusable = [r for r in held if r['data'].get('usable') is False]
    usable = [r for r in held if r['data'].get('usable') is True]
    quote_ages = [r['data']['completedAt'] - r['data']['quoteAt'] for r in usable]
    windows.append({
        **window, 'fromUtc': iso(window['fromAt']), 'untilExclusiveUtc': iso(window['untilAtExclusive']),
        'retainedFacts': len(rows), 'retainedKindCounts': dict(collections.Counter(r['kind'] for r in rows)),
        'retainedUsableChecks': len(usable), 'retainedUnusableChecks': len(unusable),
        'unusableCompletionTimes': [iso(r['data']['completedAt']) for r in unusable],
        'allUnusableHaveNoQuoteOrSourceExpiry': all(r['data']['quoteAt'] is None and r['data']['sourceValidUntil'] is None for r in unusable),
        'allUnusableRequireFreshActualSizeLiquidation': all(r['data']['reason']['code'] == 'fresh-actual-size-net-liquidation-required' for r in unusable),
        'retainedUsableQuoteAgeMs': {'minimum': min(quote_ages), 'maximum': max(quote_ages)},
        'retainedHealthySamplesAreIncomplete': diagnostics['factCapacityReached'],
        'doNotInferCompletedProtectionGapFromSampledHealthyRows': True,
    })

status = value['currentStatus']
s = status['diagnostics']
result = {
    'kind': 'INDEPENDENT_LOCAL_PRE_STOP_PROVIDER_FORENSIC_CORRELATION',
    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'inputSha256': inputs,
    'exportProvenance': {key: receipt[key] for key in ['sha256', 'bytes', 'scriptSha256', 'receiptVerified']},
    'rootCopyReceiptMatches': True,
    'readerValueIsSanitizedProjectionNotByteIdenticalRawExport': True,
    'source': value['source'], 'runId': value['runId'],
    'scan': {key: diagnostics[key] for key in ['bytesRead', 'scanBudgetReached', 'factCapacityReached', 'selectionUnknown', 'matchingKindCounts', 'stateSha256']},
    'selectedFiles': diagnostics['files'], 'retainedFacts': len(facts),
    'runAttribution': dict(collections.Counter(r['runAttribution'] for r in facts)),
    'retainedRpcOrHttpPhaseFacts': sum(r['kind'].startswith(('component-', 'pilot-rpc-', 'http-')) for r in facts),
    'windows': windows,
    'publicBrackets': {'timeoutAndCooldown': bracket('10821', '10823'), 'threeAbortsOnly': bracket('10847', '10848'), 'subsequentSeparateTimeout': bracket('10848', '10849'), 'repeatedAbortsAndCooldown': bracket('10857', '10858')},
    'preStopLaterStatus': {
        'generatedAt': status['generatedAt'], 'generatedAtUtc': iso(status['generatedAt']),
        'running': status['running'], 'entriesEnabled': status['entriesEnabled'],
        'native': s['usage']['native'], 'timing': s['timing'],
        'holdingDiagnostics': s['usage']['market']['holdingDiagnostics'],
        'rpc': {key: s['usage']['rpc'][key] for key in ['newUnits', 'httpTimeouts', 'httpErrors', 'throttles', 'uncertainResponseBytes', 'cooldownUntil', 'inFlight', 'waitingOrOperating']},
        'localPhaseMaximaMs': {key: row['maximumMs'] for key, row in s['usage']['localPhases'].items()},
        'eventLoopDelayP95Ms': s['usage']['eventLoopDelayP95Ms'],
        'financial': s['financial'], 'financialReadiness': s['financialReadiness'],
        'evidenceRetention': s['evidenceRetention'], 'resources': s['resources'], 'sourceRecovery': s['sourceRecovery'],
        'meaning': 'A later cumulative93 snapshot, not historical proof of resource or provider conditions during either sampled incident.',
    },
    'verifiedFindings': [
        'Thirty-two retained unusable held checks have absent fresh liquidation marks; each is accompanied by a cache invalidation. These were real missing protection evidence, not only dashboard classification.',
        'The 00:11 incident has 21 retained unavailable checks, matching the public counter increase. Public held refusals increase by 3 timeout and 18 cooldown while physical HTTP timeout total increases 4.',
        'The 00:18:33.844, 36.888, 39.930 completion times align with three held ABORTED refusals, three unavailable checks and one breach, with no new HTTP timeout. Inter-completion times 3044ms/3042ms match, but do not prove, the known 3s context envelope.',
        'The 00:21 incident has three roughly 3s unavailable checks and one additional immediate unavailable check; public counters increase 3 ABORTED/1 COOLDOWN/4 unavailable while HTTP timeout total remains 616.',
        'Both public incident brackets retain connected capture and healthy evidence/resource admission. Connected capture does not certify complete candidate windows; quality-gap counters still rise.',
        'Later 01:04:34.410 status has entries enabled, no owner stop or uncertain financial actions, one held position, normal resources and active evidence rotation with zero mandatory record refusals.',
    ],
    'unknownsAndLimits': [
        'No physical RPC start/completion, quota-wait, HTTP lifecycle or provider-phase events are retained by this bounded export. All selected files are essential segments; whether diagnostics were retired or failed interval-index selection is unknown.',
        'The 66,868,564-byte scan and fact limits were reached. Retained failure records and public deltas are useful, but absence of a record is not proof that an event never occurred; selected healthy rows cannot establish exact maximum protection gaps.',
        'Provider response latency, connection reuse, TTFB/body/decode timing and the exact caller-abort stage remain unverified for these historical requests. The local reproductions establish mechanisms, not exact historical attribution.',
        'All 179 retained event attributions are temporal within a verified current run, not explicit run IDs on every event.',
        'Global local-phase maxima and the later resource snapshot cannot identify a particular incident cause. Aggregate HTTP totals include inherited failures and are not new-run counts unless differenced.',
        'This analysis does not certify the new 567 source or sustained protection, profitability, trade readiness or uninterrupted market coverage.',
    ],
    'networkRequests': 0, 'financialDatabaseOpened': False, 'financialWrites': 0, 'serviceControlOperations': 0,
}
HERE.mkdir(parents=True, exist_ok=True)
(HERE / 'analysis.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'windows': [{k: w[k] for k in ['fromUtc', 'retainedUsableChecks', 'retainedUnusableChecks']} for w in windows], 'retainedRpcOrHttpPhaseFacts': result['retainedRpcOrHttpPhaseFacts'], 'output': str(HERE / 'analysis.json')}, indent=2))
