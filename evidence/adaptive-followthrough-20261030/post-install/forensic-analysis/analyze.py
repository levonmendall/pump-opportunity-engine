#!/usr/bin/env python3
"""Local-only prior567 forensic and public-snapshot correlation."""
import collections
import datetime
import hashlib
import json
import pathlib
import re
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
HOST = ROOT / 'evidence/adaptive-followthrough-20261030/post-install/host/host-40990386819.json'
SUPERVISION = ROOT / 'evidence/coherent-protection-recovery-20261029/post-install/supervision'
SOURCE = '5675961a0ad05df508eec6928644c9e403be0811'
inputs = {}


def read(path):
    body = path.read_bytes()
    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(body).hexdigest()
    return body


def iso(at):
    return datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).isoformat()


host = json.loads(read(HOST))
receipt = host['adaptiveFollowthroughForensics']
value = receipt['value']
preflight = host['upgradeVerification']['value']['forensicPreflight']
assert receipt['available'] is True and receipt['receiptVerified'] is True
assert receipt['sha256'] == preflight['receipt']['sha256'] == preflight['rootCopySha256'] == 'a66e5b9aadea925ca7d4079f11ff19ab92318df9016dd468297d63223a8bba43'
assert receipt['bytes'] == preflight['receipt']['bytes'] == 106497
assert receipt['scriptSha256'] == preflight['scriptSha256'] == 'd31e59fe85b2935455c27798199287e072bae4e951d629dd6729322294bd7b75'
assert value['source']['commit'] == preflight['source']['commit'] == SOURCE
assert value['runId'] == 'native-paper-20261030010446598'
assert not value['financialDatabaseOpened'] and value['financialWrites'] == value['serviceControlOperations'] == value['credentialReads'] == 0

observations = {}
for name in ['provider-protection-incident-0125/initial-incident-observations.ndjson', 'dispatch-protection-incident-0147/observations.ndjson']:
    for line in read(SUPERVISION / name).decode().splitlines():
        row = json.loads(line)
        assert row['source']['release'] == SOURCE
        observations[row['sequence']] = row


def frame(sequence):
    row = observations[sequence]
    i = row['intelligence']
    refusals = {}
    for text in i['quality']['limitations']:
        refusals.update({key: int(n) for key, n in re.findall(r'(HELD_PRICING_[A-Z_]+):(\d+)', text)})
    return {
        'sequence': sequence, 'sourceAt': row['times']['generatedAt'], 'responseSha256': row['responseSha256'],
        'status': row['status'], 'protection': i['protection'],
        'provider': {key: i['provider'][key] for key in ['rpcRequests', 'httpTimeouts', 'httpErrors', 'throttles', 'rollingStartsPerMinute', 'maximumStartsPerMinute', 'primaryCooldownUntil']},
        'heldRefusals': refusals, 'selectedCapture': i['quality']['captureConnected'],
        'admission': i['admission'], 'resources': i['resources'],
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
    unavailable = [r for r in held if r['data'].get('usable') is False]
    windows.append({
        **window, 'fromUtc': iso(window['fromAt']), 'untilExclusiveUtc': iso(window['untilAtExclusive']),
        'retainedFacts': len(rows), 'retainedKindCounts': dict(collections.Counter(r['kind'] for r in rows)),
        'retainedUsableHeldChecks': sum(r['data'].get('usable') is True for r in held),
        'retainedUnusableHeldChecks': len(unavailable),
        'unavailableCompletedAtUtc': [iso(r['data']['completedAt']) for r in unavailable],
        'unavailableHaveNoFreshMark': all(r['data']['quoteAt'] is None and r['data']['sourceValidUntil'] is None for r in unavailable),
        'retainedDecisionQuoteCalls': [r for r in rows if r['kind'] == 'trader-quote'],
        'healthySamplesIncompleteDoNotInferGapFromSelectedRows': diagnostics['factCapacityReached'],
    })

status = value['currentStatus']
s = status['diagnostics']
rpc = value['rpcStatus']
assert rpc['available'] and rpc['runId'] == value['runId']
recovery = rpc['diagnostics']['protectionRecovery']
code = subprocess.check_output(['git', 'show', SOURCE + ':src/pilot-rpc.ts'], cwd=ROOT)
assert b"if(domain==='rpc'||domain==='protection'){this.failures=0;this.protectionProbeAt=0;this.protectionProbeMono=0;}" in code
assert b'this.cooldown=Math.max(this.cooldown,until)' in code

result = {
    'kind': 'INDEPENDENT_LOCAL_PRIOR567_QUOTE_AND_PROTECTION_CORRELATION',
    'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'inputSha256': inputs, 'reviewed567RpcSourceSha256': hashlib.sha256(code).hexdigest(),
    'source': value['source'], 'runId': value['runId'],
    'exportProvenance': {key: receipt[key] for key in ['sha256', 'bytes', 'scriptSha256', 'receiptVerified']},
    'rootCopyReceiptMatches': True, 'readerProjectionIsNotByteIdenticalRawExport': True,
    'scan': {key: diagnostics[key] for key in ['bytesRead', 'scanBudgetReached', 'factCapacityReached', 'selectionUnknown', 'matchingKindCounts', 'stateSha256', 'manifestFilesRead', 'manifestBytesRead', 'manifestUnavailable', 'matchedEssentialSegments', 'manifestSelectionTruncated']},
    'selectedFiles': diagnostics['files'], 'retainedFacts': len(facts),
    'retainedRpcOrHttpPhaseFacts': sum(r['kind'].startswith(('component-', 'pilot-rpc-', 'http-')) for r in facts),
    'runAttribution': dict(collections.Counter(r['runAttribution'] for r in facts)), 'windows': windows,
    'publicBrackets': {'timeoutsThenDispatch0125': bracket('11108', '11109'), 'dispatchOnly0147': bracket('11193', '11194')},
    'automaticRecoveryPublicFrames': {'after0125': frame('11113'), 'after0147': frame('11198')},
    'currentRpcProjection': rpc,
    'lastRpcFailureUtc': iso(recovery['lastFailure']['at']),
    'laterPreStopStatus': {
        'generatedAtUtc': iso(status['generatedAt']), 'rpcProjectionGeneratedAtUtc': iso(rpc['diagnostics']['projectionGeneratedAt']),
        'observedRuntimeElapsedMs': status['generatedAt'] - status['startedAt'],
        'running': status['running'], 'entriesEnabled': status['entriesEnabled'],
        'timing': s['timing'], 'holdingDiagnostics': s['usage']['market']['holdingDiagnostics'],
        'registeredPools': s['usage']['market']['registeredPools'], 'entryQuoteCalls': s['usage']['market']['entryQuoteCalls'],
        'entryExecutionQuotes': s['usage']['market']['entryExecutionQuotes'], 'entryPricing': s['usage']['market']['entryPricing'],
        'native': s['usage']['native'], 'financial': s['financial'], 'financialReadiness': s['financialReadiness'],
        'resources': s['resources'], 'evidenceRetention': s['evidenceRetention'],
        'rpcNewUnits': s['usage']['rpc']['newUnits'], 'httpTimeoutsRetained': s['usage']['rpc']['httpTimeouts'],
        'httpErrors': s['usage']['rpc']['httpErrors'], 'throttles': s['usage']['rpc']['throttles'],
        'localPhaseMaximaMs': {key: row['maximumMs'] for key, row in s['usage']['localPhases'].items()},
        'meaning': 'Later source snapshot and later RPC projection; cumulative counts are not event-level timing proof for the earlier incidents.',
    },
    'verifiedFindings': [
        'The 01:25 public bracket adds 2 holding TIMEOUT +5 DISPATCH +7 unavailable checks +1 breach, with 3 new physical HTTP timeouts. Seven exact unusable native completions are retained in the sampled interval; each has no fresh actual-size liquidation mark.',
        'The 01:47 public bracket is a separate dispatch-only incident: +5 DISPATCH/+5 unavailable/+1 breach, zero new HTTP timeout/error/throttle, and no advance of primary cooldown from 01:25:52.335. Source-level last successful completion before the incident is 01:47:14.817.',
        'The verified actual RPC lastFailure is 01:47:35.289, stage uninvoked-quota-or-spacing, physicalInFlight=false. The old category combines local dispatch causes; current totals are 9 such stages, 3 physical-timeout, 1 physical-settlement-wait and 1 local-admission.',
        'Earlier 01:25 timeout/probe pacing cannot simply be carried forward as the explanation for 01:47: successful primary/protected reads clear both probe clocks, and a new recoverable primary transport failure would update the shared cooldown. Recorded evidence instead identifies a separate uninvoked/local dispatch failure; exact rolling quota, spacing, caller admission or deadline cause is not retained.',
        'An 84RPM sample at 01:47:44 does not establish request headroom at 01:47:35 or during the shorter 10s window. It is neither proof of provider throttling nor proof that local dispatch should have been immediately available.',
        'Two retained buy-decision quote-attempt records are present at 01:19:27.764 and01:19:48.067 for one hashed mint. No resulting quote object survives their sanitized projection; later actual PilotMarket entryQuoteCalls/entryExecutionQuotes are 0. The exact cause of those historical attempts remains unknown despite the independently reproduced ancillary-rent/slot-floor mechanism.',
        'The sealed-manifest time index located 2 matching essential segments using 23,283,938 bytes, without exhausting the scan bound. Physical RPC/HTTP phase facts still do not survive; only essential files are present, and one missing manifest keeps selectionUnknown=true.',
        'Later 02:12:22.129 source status has entries enabled, one held position, four active deep slots, connected capture, healthy resources and zero mandatory evidence refusals. It preserves 74 breaches/245 unavailable checks and the 89426ms historical maximum. The RPC projection is 2.850s later, not the same atomic source snapshot.',
    ],
    'unknownsAndLimits': [
        'The fixed exporter samples 01:18–01:20 and01:25–01:27:15 only. There are no native phase records from 01:47 in this export; its lastFailure timestamp is a later retained cumulative observation.',
        'All 152 retained event attributions are temporal within a verified current run, not explicit run IDs on every event. Missing, rotated or bounded diagnostics do not prove absence.',
        'The fact capacity was reached; healthy sampled completions cannot establish an exact maximum protection gap or fill unknown historical intervals.',
        'Actual request starts, quota queue delays, precise local admission predicate, deadline runway, and provider TTFB/body/decode timings are unknown for the 01:47 dispatch incident.',
        'The five retry-paced synthetic refusals after three injected timeouts demonstrate a mechanism for the 01:25-style pattern, not proof of that pattern in a separate01:47 incident.',
        'This analysis does not certify 69 live protection, entry success, profitability, sustained acceptance or 24-hour operation. It makes no financial control change.',
    ],
    'networkRequests': 0, 'financialDatabaseOpened': False, 'financialWrites': 0, 'serviceControlOperations': 0,
}
HERE.mkdir(parents=True, exist_ok=True)
(HERE / 'analysis.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'retainedFacts': len(facts), 'retainedRpcOrHttpPhaseFacts': result['retainedRpcOrHttpPhaseFacts'], 'lastRpcFailureUtc': result['lastRpcFailureUtc'], 'dispatchOnlyDelta': result['publicBrackets']['dispatchOnly0147']['heldRefusalDelta'], 'output': str(HERE / 'analysis.json')}, indent=2))
