"""Read-only fixed retained capture + explicit synthetic counterexample.
No provider, financial-state, subprocess, or runtime integration operations.
This reports conditional row-set mechanics; it never issues audit certificates.
"""
import collections, hashlib, json, math, pathlib

HERE = pathlib.Path(__file__).resolve().parent
CAP = pathlib.Path('/workspace/poe-pilot/runs/native-reuse-isolation-20261028172800')
RUN = CAP / 'artifact/run'
receipt = json.loads((CAP/'readback-receipt.json').read_text())
assert receipt['allSelectedFilesVerified'] and receipt['wholeArchiveHashVerified']
index_raw = (CAP/'artifact/index.json').read_bytes()
index = {v['path']:v for v in json.loads(index_raw)['included']}
status_raw = (RUN/'status.json').read_bytes()
assert hashlib.sha256(status_raw).hexdigest() == index['run/status.json']['sha256']
status = json.loads(status_raw)
assert status['source']['commit'] == '71896104f07faa2b193b90d3d3133a8e29236f35'
assert status['financialWriterOpened'] is False
files = sorted((RUN/'events').glob('*.ndjson'))
assert 1 <= len(files) <= 32 and sum(p.stat().st_size for p in files) <= 192*1024*1024
pages = collections.defaultdict(list)
audits = {}
sources = []
for path in files:
    assert path.is_file() and not path.is_symlink()
    h = hashlib.sha256()
    with path.open('rb') as src:
        for line_number, line in enumerate(src, 1):
            h.update(line)
            event = json.loads(line)
            kind, data = event['kind'], event['data']
            if kind == 'native-flow-history-page':
                assert 1 <= len(data['rows']) <= 1000
                pages[data['pool'], data['target']['endAt']].append({**data, 'ref': str(path.relative_to(RUN))+':'+str(line_number)})
            elif kind == 'native-candidate-window-audit':
                audits[data['result']['pool'], data['result']['target']['endAt']] = data['result']
    expected = index[str(path.relative_to(CAP/'artifact'))]
    assert path.stat().st_size == expected['bytes'] and h.hexdigest() == expected['sha256']
    sources.append({'file': str(path.relative_to(RUN)), 'bytes': path.stat().st_size, 'sha256': h.hexdigest(), 'matchesRetainedArchiveIndex':True})


def identity(row):
    return row['signature'], row['slot'], row['success']


def flattened(key):
    pp = sorted(pages[key], key=lambda p: p['page'])
    assert [p['page'] for p in pp] == list(range(1, len(pp)+1))
    previous = None
    rows = []
    for p in pp:
        if previous is not None:
            assert p['requestedBefore'] == previous
        rows.extend(p['rows'])
        previous = p['rows'][-1]['signature']
    assert len({r['signature'] for r in rows}) == len(rows)
    assert all(a['slot'] >= b['slot'] for a, b in zip(rows, rows[1:]))
    return rows


pairs = []
for pool in sorted({pool for pool, _ in pages}):
    keys = sorted((key for key in pages if key[0] == pool), key=lambda key: key[1])
    for old, fresh in zip(keys, keys[1:]):
        if not 0 < fresh[1]-old[1] <= 15000:
            continue
        old_result, fresh_result = audits.get(old), audits.get(fresh)
        if not old_result or not fresh_result or not old_result['historyRangeCovered'] or not fresh_result['historyRangeCovered']:
            continue
        old_rows, fresh_rows = flattened(old), flattened(fresh)
        old_bounds, fresh_bounds = old_result['strictInteriorSlots'], fresh_result['strictInteriorSlots']
        eligible = [r for r in old_rows if old_bounds['lower'] < r['slot'] < old_bounds['upper']]
        finalized = [r for r in eligible if r['confirmationStatus'] == 'finalized']
        if not finalized:
            continue
        # Exclude the old top slot; no empty-slot claim above this frontier.
        frontier = max(r['slot'] for r in finalized)
        cached = [r for r in eligible if r['slot'] < frontier]
        if not cached or any(r['confirmationStatus'] != 'finalized' for r in cached):
            continue
        seam = max(r['slot'] for r in cached)
        if not old_bounds['lower'] <= fresh_bounds['lower'] < seam < fresh_bounds['upper']:
            continue
        assert min(r['slot'] for r in fresh_rows) < seam
        old_seam = {identity(r) for r in cached if r['slot'] == seam}
        fresh_seam = {identity(r) for r in fresh_rows if r['slot'] == seam}
        old_index = {r['signature']: r for r in cached}
        exposed_contradictions = [r['signature'] for r in fresh_rows if old_bounds['lower'] < r['slot'] <= seam and (r['signature'] not in old_index or identity(r) != identity(old_index[r['signature']]))]
        merged = [r for r in fresh_rows if seam < r['slot'] < fresh_bounds['upper']] + [r for r in cached if fresh_bounds['lower'] < r['slot'] <= seam]
        actual = [r for r in fresh_rows if fresh_bounds['lower'] < r['slot'] < fresh_bounds['upper']]
        same = {identity(r) for r in merged} == {identity(r) for r in actual}
        seen = 0
        needed_pages = 0
        for p in sorted(pages[fresh], key=lambda p: p['page']):
            needed_pages += 1
            seen += len(p['rows'])
            if min(r['slot'] for r in p['rows']) < seam:
                break
        pairs.append({'pool': pool, 'oldTargetEndAt': old[1], 'freshTargetEndAt': fresh[1], 'oldAvailableAt': old_result['availableAt'], 'freshAvailableAt': fresh_result['availableAt'], 'oldAuditStatus': old_result['status'], 'freshAuditStatus': fresh_result['status'], 'frontierExcludedSlot': frontier, 'wholeSeamSlot': seam, 'seamSignatures': len(old_seam), 'seamSetEqual': old_seam == fresh_seam, 'exposedContradictions': exposed_contradictions, 'joinedInteriorRows': len(merged), 'freshFullInteriorRows': len(actual), 'rowSetParity': same, 'originalFreshRequests': fresh_result['requestAttempts'], 'minimumSameRecordedPagesThroughSeam': needed_pages, 'potentialRequestsAvoidedWithinTheseRecordedPages': fresh_result['requestAttempts']-needed_pages, 'sourcePageRefs': [p['ref'] for p in pages[old]+pages[fresh]], 'scope': 'Retained chronological page rows only; no newly requested/predicted response timing, no new qualification, and no independent index-completeness guarantee.'})
        assert old_seam == fresh_seam and not exposed_contradictions and same

# Explicit synthetic adversarial index backfill. All ledger rows were already
# finalized; the address index omitted x at first read and inserts it later.
def synth(name, slot):
    return {'signature': 'SYNTHETIC:'+name, 'slot': slot, 'success': True, 'confirmationStatus': 'finalized'}
old_cached = [synth(str(slot), slot) for slot in range(159, 100, -1)]
seam = 159
fresh_all = [synth(str(slot), slot) for slot in range(180, 100, -1)]
backfill = synth('LATE_INDEXED_EXECUTED_ROW', 130)
fresh_all.insert(next(i for i,r in enumerate(fresh_all) if r['slot'] < 130), backfill)
# The actual fresh scan goes through the entire seam slot and one lower row.
fresh_suffix = [r for r in fresh_all if r['slot'] >= 158]
stitched = [r for r in fresh_suffix if r['slot'] > seam] + old_cached
full_interior = [r for r in fresh_all if 110 < r['slot'] < 181]
stitched_interior = [r for r in stitched if 110 < r['slot'] < 181]
seam_same = {identity(r) for r in old_cached if r['slot'] == seam} == {identity(r) for r in fresh_suffix if r['slot'] == seam}
missing = sorted({r['signature'] for r in full_interior}-{r['signature'] for r in stitched_interior})
assert seam_same and min(r['slot'] for r in fresh_suffix) < seam and missing == [backfill['signature']]

# Independent ordering counterexample: one common signature does not certify a
# whole slot. Whole-slot SET comparison catches the omission, a single seam ID
# does not. This does not cure the deeper index-backfill counterexample above.
old_tie = [synth('a',159), synth('b',159)]
changed_tie = [synth('a',159), synth('c',158)]
assert old_tie[0]['signature'] == changed_tie[0]['signature']
assert {identity(r) for r in old_tie} != {identity(r) for r in changed_tie if r['slot']==159}

history_rows = [r for pp in pages.values() for p in pp for r in p['rows']]
serialized_bytes = sum(len(json.dumps(r,separators=(',',':')).encode()) for r in history_rows)
row_bytes = serialized_bytes/len(history_rows)
projection = []
for required in [2054,4538,5144]:
    for page_size in [500,750,1000]:
        # One lower-fence row in addition to required rows is optimistic.
        requests = math.ceil((required+1)/page_size)
        projection.append({'requiredTargetSignatures': required, 'pageSize': page_size, 'minimumFullWindowRequests': requests, 'oneBusyPlusFiveQuietAuditRequestsPerMinute': (requests+5)*6, 'plusMinimalCeilingAndHeartbeatRequestsPerMinute': (requests+5)*6+12, 'conditionalNotProviderMeasured': True})
conditional = []
for finality_lag in [0,13,30]:
    suffix_rows = math.ceil(5144*(10+finality_lag)/60)+1
    suffix_requests = math.ceil(suffix_rows/1000)
    conditional.append({'assumedUniformSignaturesPer60Seconds': 5144, 'assumedAdditionalUnfinalizedSecondsAtPriorRead': finality_lag, 'decisionCadenceSeconds':10, 'minimumFreshSuffixRows': suffix_rows, 'minimumFresh1000RowRequests': suffix_requests, 'oneBusyFiveQuietPlusMinimalMaintenancePerMinute': (suffix_requests+5)*6+12, 'sixBusyPlusMinimalMaintenancePerMinute': suffix_requests*6*6+12, 'scope':'Hypothetical stable complete index and uniform activity, enough existing finalized prefix, no bursts/retries/verification/holding work, not measured latency or established entitlement.'})

out = {'schemaVersion':1,'classification':'OFFLINE_FINALIZED_PREFIX_FEASIBILITY_NO_RUNTIME_ADOPTION','source':status['source'],'runId':status['runId'],'rawArchiveSha256':receipt['archiveSha256'],'rawArchiveIndexSha256':hashlib.sha256(index_raw).hexdigest(),'rawSourceFiles':sources,'actualHistoryPages':sum(map(len,pages.values())),'actualHistoryRows':len(history_rows),'actualRowsReportedFinalized':sum(r['confirmationStatus']=='finalized' for r in history_rows),'retainedChronologicalPairs':pairs,'busyRollingPrefixPairAvailable':False,'retainedPairLimit':'All qualifying <=15s retained pairs are one-page4Ytm samples; the busy2054-row audit lacks an adjacent retained busy rolling window. No measured live request saving is established.','syntheticCounterexamples':{'lateIndexBackfill':{'canonicalRowsFinalized':True,'seamSetEqual':seam_same,'freshScanTraversesWholeSeam':True,'missedSuccessfulRowsUnderReuse':missing,'freshFullScanWouldExpose':True,'conclusion':'Finality and exact seam equality do not prove absence immutable in an address-history index.'},'sameSlotCursorOrdering':{'singleMatchingSeamSignature':True,'wholeSlotSetComparisonRejects':True},'unfinalizedEmptyHead':{'example':'A finalized pool row at100 with confirmed upper120 does not certify empty slots101..119. A later canonical row at110 can appear; never extend the cached frontier to the confirmed upper fence.'}},'arithmeticLowerBounds':projection,'conditionalRollingProjections':conditional,'memory':{'proposedMaximumRowsPerPool':8192,'sixPoolMaximumRows':49152,'actualAverageSerializedHistoryRowBytes':row_bytes,'sixPoolSerializedBytesAtThisAverage':math.ceil(row_bytes*49152),'runtimeHeapRssNotMeasured':'JSON size excludes JavaScript/string/index/array/certificate overhead. No runtime cache was created; EC2 headroom compatibility is unverified.'},'decision':'NO_GO_RUNTIME_CACHE_UNDER_CURRENT_FRESH_INDEPENDENT_HISTORY_CONTRACT','unestablishedProviderInvariants':['Complete address-index coverage at first read and no subsequent insertion/correction beneath known finalized frontier.','Stable gap-free before-cursor traversal across same-slot ties and backend replicas.','Truthful finality metadata linked to the same canonical chain lineage; minContextSlot is not a response bank/root or atomic history snapshot.'],'networkRequests':0,'financialLedgerOpened':False,'runtimeModified':False}
print(json.dumps(out,indent=2))
