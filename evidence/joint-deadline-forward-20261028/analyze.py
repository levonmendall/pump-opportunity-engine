#!/usr/bin/env python3
"""Offline join of one verified, allowlisted POE forward archive.

Reads exported metadata only. No network, credentials, ledger or runtime writes.
The archive must already have passed transport/index verification. Indexed file
hashes are checked again here. Missing/coalesced detail remains explicitly unknown.
"""
import argparse, collections, hashlib, json, math, pathlib


def quant(values):
    a = sorted(x for x in values if type(x) in (int, float) and math.isfinite(x))
    return dict(count=len(a), minimum=a[0] if a else None,
                p50=a[math.ceil(.5 * len(a)) - 1] if a else None,
                p95=a[math.ceil(.95 * len(a)) - 1] if a else None,
                maximum=a[-1] if a else None)


def ref(event):
    if event is None:
        return None
    return {k: event.get(k) for k in
            ('sourceFile', 'sourceLine', 'sourceLineSha256', 'sourceSequence')}


def fingerprint(path):
    raw = path.read_bytes()
    return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def analyze(root):
    root = root.resolve()
    index = json.loads((root / 'index.json').read_bytes())
    assert index['rawFinancialFilesIncluded'] is False
    assert index['credentialsIncluded'] is False
    assert index['completeMarketEvidenceIncluded'] is False
    assert len(index['files']) <= 128
    files = {}
    for row in index['files']:
        name = pathlib.PurePosixPath(row['file'])
        assert not name.is_absolute() and '..' not in name.parts
        path = root / name
        actual = fingerprint(path)
        assert actual == {'bytes': row['bytes'], 'sha256': row['sha256']}
        files[str(name)] = actual
    assert len(files) == len(index['files']), 'duplicate indexed file'
    assert 'final-status.json' in files, 'source status must be hash-indexed'
    status = json.loads((root / 'final-status.json').read_bytes())
    source, source_run = status['source'], status['runId']
    events = []
    for name in sorted(files):
        if name.endswith('/selected-events.ndjson'):
            assert files[name]['bytes'] <= 32 * 1024 * 1024
            for line in (root / name).read_text().splitlines():
                event = json.loads(line)
                assert event['runId'] == source_run, 'mixed run requires separate analysis'
                events.append(event)
    assert events, 'no selected source events'
    assert all(type(e['sourceSequence']) is int for e in events)
    # Each bounded Recorder file restarts its sequence. File/line provenance,
    # not a falsely global sequence number, establishes retained source order.
    events.sort(key=lambda e: (e['sourceFile'], e['sourceLine']))
    assert len({(e['sourceFile'], e['sourceLine']) for e in events}) == len(events)
    rows = lambda kind: [e for e in events if e['kind'] == kind]
    def unique(kind):
        selected = rows(kind)
        result = {e['data']['id']: e for e in selected}
        assert len(result) == len(selected), 'duplicate physical ID: ' + kind
        return result
    starts = unique('component-physical-start')
    settled = unique('component-physical-settled')
    http = unique('http-lifecycle-timing')
    timeouts = unique('component-physical-timeout')
    targets, operation_target, unmatched_admissions = {}, {}, []

    def target(mint, end):
        key = (mint, end)
        if key not in targets:
            targets[key] = dict(mint=mint, windowEndAt=end,
                                decisionDeadlineAt=end + 9999,
                                states=[], summaries=[], audits=[], assessments=[],
                                expired=[], unavailable=[], session=[], pages=[])
        return targets[key]

    # Associate a physical page only with a retained actual page admission and
    # its same-call response/refusal. Never assign overlapping sessions by time
    # range alone: that would misattribute interleaved multi-page peer work.
    admission = None
    for event in events:
        kind, d = event['kind'], event['data']
        if admission is not None:
            old = admission['data']
            terminal_end = (d.get('result') or {}).get('target', {}).get('endAt') if kind == 'native-candidate-window-audit' else d.get('targetEndAt', d.get('windowEndAt'))
            terminal = (kind in ('native-audit-dispatch-summary', 'native-candidate-window-audit',
                                'native-candidate-window-audit-unavailable', 'native-predictive-window-expired')
                        and (d.get('mint'), terminal_end) == (old['mint'], old['windowEndAt']))
            new_generation = kind in ('native-candidate-retired', 'native-candidate-observation-open', 'native-flow-subscription-ack') and d.get('mint') == old['mint']
            selected_peer = kind == 'native-audit-dispatch-state' and d.get('reason') == 'audit-selected' and d.get('context', {}).get('selectedMint') not in (None, old['mint'])
            other_physical = kind == 'component-physical-start' and d['kind'] != {'transport': 'http', 'method': 'getSignaturesForAddress'}
            if terminal or new_generation or selected_peer or other_physical:
                unmatched_admissions.append(ref(admission))
                admission = None
        if kind == 'native-audit-dispatch-state':
            t = target(d['mint'], d['windowEndAt'])
            t['states'].append(event)
            if d['reason'] == 'page-admission':
                if admission is not None:
                    unmatched_admissions.append(ref(admission))
                admission = event
            elif d['reason'] in ('page-response', 'page-refusal') and admission is not None:
                old = admission['data']
                if (d['mint'], d['windowEndAt']) == (old['mint'], old['windowEndAt']):
                    admission = None
        elif kind == 'native-origin-read-dispatch':
            if admission is not None:
                unmatched_admissions.append(ref(admission))
                admission = None
        elif kind == 'component-physical-start' and d['kind'] == {
                'transport': 'http', 'method': 'getSignaturesForAddress'}:
            if admission is not None:
                ad = admission['data']
                key = (ad['mint'], ad['windowEndAt'])
                targets[key]['pages'].append((event, admission))
                assert d['id'] not in operation_target
                operation_target[d['id']] = key
                admission = None
        elif kind == 'native-audit-dispatch-summary':
            target(d['mint'], d['windowEndAt'])['summaries'].append(event)
        elif kind == 'native-candidate-window-audit':
            target(d['mint'], d['result']['target']['endAt'])['audits'].append(event)
        elif kind == 'native-predictive-assessment':
            target(d['mint'], d['windowEndAt'])['assessments'].append(event)
        elif kind == 'native-predictive-window-expired':
            target(d['mint'], d['windowEndAt'])['expired'].append(event)
        elif kind == 'native-candidate-window-audit-unavailable':
            target(d['mint'], d['targetEndAt'])['unavailable'].append(event)
        elif kind == 'native-candidate-audit-session-open':
            target(d['mint'], d['targetEndAt'])['session'].append(event)
    if admission is not None:
        unmatched_admissions.append(ref(admission))

    def operation(event, admission_event=None):
        d, rid = event['data'], event['data']['id']
        h, s, timeout = http.get(rid), settled.get(rid), timeouts.get(rid)
        hd = h['data'] if h else {}
        sd = s['data'] if s else {}
        td = timeout['data'] if timeout else {}
        return dict(id=rid, kind=d['kind'], enqueuedAt=d.get('enqueuedAt'),
                    reservedAt=d.get('reservedAt'), physicalStartedAt=d['at'],
                    physicalSettledAt=sd.get('at'),
                    enqueueToStartMs=d['at']-d['enqueuedAt'] if 'enqueuedAt' in d else None,
                    physicalOccupancyMs=sd['at']-d['at'] if 'at' in sd else None,
                    endpoint=hd.get('endpoint'), endpointDirectlyRecorded='endpoint' in hd,
                    http=hd, timedOut=timeout is not None,
                    timeoutCallbackLatenessMs=td.get('callbackLatenessMs'),
                    settlementAfterTimeoutMs=sd['at']-td['at'] if 'at' in sd and 'at' in td else None,
                    evidence=dict(start=ref(event), http=ref(h), settlement=ref(s),
                                  timeout=ref(timeout), admission=ref(admission_event)))

    cases = []
    for key, t in sorted(targets.items(), key=lambda p: (p[0][1], p[0][0])):
        summaries, states = t['summaries'], t['states']
        summary = summaries[-1]['data'] if summaries else {}
        first = min([e['data']['firstReadyAt'] for e in states if 'firstReadyAt' in e['data']]
                    + [summary.get('firstReadyAt', math.inf)])
        first = None if first == math.inf else first
        pages = [operation(e, ad) for e, ad in t['pages']]
        audit = t['audits'][-1]['data']['result'] if t['audits'] else None
        assessment = t['assessments'][-1]['data']['assessment'] if t['assessments'] else None
        if assessment:
            outcome = 'predictive-' + assessment['status']
        elif audit:
            outcome = 'audit-' + audit['status']
        elif t['unavailable']:
            outcome = 'audit-session-unavailable'
        elif t['expired']:
            outcome = 'expired-without-validated-audit'
        else:
            outcome = 'no-final-audit-outcome-retained'
        first_start = min((p['physicalStartedAt'] for p in pages), default=None)
        competing = []
        if first is not None and first_start is not None:
            for rid, e in starts.items():
                sd = settled.get(rid, {}).get('data', {})
                end = sd.get('at')
                if end is None or rid in {p['id'] for p in pages}:
                    continue
                overlap = min(end, first_start) - max(first, e['data']['at'])
                if overlap > 0:
                    competing.append(dict(id=rid, kind=e['data']['kind'],
                                          overlapMs=overlap,
                                          peerAuditTarget=operation_target.get(rid),
                                          evidence=ref(e)))
        reason_counts = summary.get('reasonCounts', dict(collections.Counter(
            e['data']['reason'] for e in states)))
        causes = []
        if any(p['timedOut'] for p in pages):
            causes.append('actual-physical-timeout; inspect recorded HTTP/Undici stages')
        if any(p['timedOut'] and p['http'].get('headersAt') is None for p in pages):
            causes.append('no headers by timeout; remote/backend/network cause not isolated')
        if any(e['data'].get('nextAction') == 'await-primary-support-ceiling' for e in states):
            causes.append('runner awaited usable primary support ceiling; this alone does not establish provider latency')
        if any(e['data'].get('nextAction') == 'await-history-provider-or-query-cooldown' for e in states):
            causes.append('runner reported history/query readiness wait; actual provider/query cooldown requires separate evidence')
        if any((e['data'].get('context', {}).get('historyCooldownUntil') or 0) > (e['data'].get('at') or 0) for e in states):
            causes.append('history provider cooldown was explicitly active at a retained dispatch observation')
        if t['expired'] and not pages:
            causes.append('no directly linked physical page before expiry; inspect dispatch/missing detail')
        if summary.get('omittedTransitions', 0):
            causes.append('dispatch transitions coalesced/omitted; exact continuous wait attribution unavailable')
        cases.append(dict(mint=t['mint'], windowEndAt=t['windowEndAt'],
                          decisionDeadlineAt=t['decisionDeadlineAt'], firstReadyAt=first,
                          primaryOutcome=outcome, expiredAlsoRecorded=bool(t['expired']),
                          audit=audit, independentAssessment=assessment,
                          firstReadyToFirstPhysicalMs=first_start-first if first_start is not None and first is not None else None,
                          pages=pages, dispatchReasonCounts=reason_counts,
                          auditRequestAttempts=audit.get('requestAttempts') if audit else None,
                          physicalPageAttributionComplete=(audit.get('requestAttempts') == len(pages)) if audit else None,
                          omittedDispatchTransitions=summary.get('omittedTransitions'),
                          competingPhysicalBeforeFirstPage=competing,
                          demonstratedCauseEvidence=causes,
                          evidence=dict(summary=[ref(e) for e in summaries],
                                        audit=[ref(e) for e in t['audits']],
                                        assessment=[ref(e) for e in t['assessments']],
                                        expired=[ref(e) for e in t['expired']],
                                        session=[ref(e) for e in t['session']])))
    physical = [operation(e) for e in starts.values()]
    provider = {}
    for endpoint in sorted({p['endpoint'] or 'not-recorded' for p in physical if p['http']}):
        group = [p for p in physical if p['http'] and (p['endpoint'] or 'not-recorded') == endpoint]
        provider[endpoint] = dict(requests=len(group), timedOut=sum(p['timedOut'] for p in group),
                                  statusCounts=dict(collections.Counter(str(p['http'].get('status')) for p in group)),
                                  methodCounts=dict(collections.Counter(p['kind']['method'] for p in group)),
                                  httpElapsedMs=quant(p['http'].get('elapsedMonotonicMs') for p in group),
                                  enqueueToStartMs=quant(p['enqueueToStartMs'] for p in group),
                                  responseBytes=sum(p['http'].get('responseBytes', 0) for p in group),
                                  undiciObservationCounts=dict(collections.Counter(p['http'].get('undiciObservation', 'not-recorded') for p in group)))
    return dict(schemaVersion=1, classification='ACTUAL_FORWARD_ALLOWLISTED_DEADLINE_JOIN_NOT_ACCEPTANCE',
                source=source, configurationSha256=status['configurationSha256'], runId=source_run,
                inputFileHashesVerified=True, indexedInputs=files,
                targetCount=len(cases), uniqueTargetTokens=len({c['mint'] for c in cases}),
                outcomeCounts=dict(collections.Counter(c['primaryOutcome'] for c in cases)),
                expiredTargets=sum(c['expiredAlsoRecorded'] for c in cases),
                expiredTargetsWithUnavailableAudit=sum(c['expiredAlsoRecorded'] and c['primaryOutcome'].startswith(('audit-unavailable', 'audit-session-unavailable')) for c in cases),
                expiredTargetsWithoutDirectlyLinkedPhysicalPage=sum(c['expiredAlsoRecorded'] and not c['pages'] for c in cases),
                directlyLinkedHistoryPages=len(operation_target),
                targetsWithIncompletePhysicalPageAttribution=sum(c['physicalPageAttributionComplete'] is False for c in cases),
                unlinkedHistoryPhysicalStarts=[p['id'] for p in physical if p['kind'] == {'transport':'http','method':'getSignaturesForAddress'} and p['id'] not in operation_target],
                unlinkedAdmissionEvidence=unmatched_admissions,
                physicalStarts=len(starts), physicalSettlements=len(settled), physicalTimeouts=len(timeouts),
                provider=provider, cases=cases,
                limitations=['Selected metadata is not raw complete market evidence or an independent whole-market opportunity denominator.',
                             'Only retained page-admission→physical-start links assign a request to a target; overlapping session time ranges are insufficient.',
                             'An expiration, unavailable audit, retirement and quality callback can describe the same lost target; do not sum them as independent opportunities.',
                             'Pre-write Undici hooks do not prove actual wire transmission or remote receipt.',
                             'No-header timeout does not alone prove provider saturation; missing headers may reflect several transport/backend causes.',
                             'Competing physical occupancy is measured overlap; residual delay is not automatically scheduler or CPU processing time.',
                             'Asynchronous local phase CPU spans include concurrent work and cannot be summed as exclusive causes.',
                             'Different forward market populations do not establish causal improvement from a raw audit/window count.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()
    result = analyze(args.input)
    # Preserve previous result files; callers give each measured interval its
    # own output name instead of replacing historical evidence on a rerun.
    with args.output.open('x') as output:
        output.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('source', 'runId', 'targetCount', 'outcomeCounts',
                                           'expiredTargets', 'physicalStarts', 'physicalTimeouts',
                                           'directlyLinkedHistoryPages')}))


if __name__ == '__main__':
    main()
