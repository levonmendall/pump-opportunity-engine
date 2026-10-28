#!/usr/bin/env python3
"""Purpose-specific offline metadata-join regressions, no market/financial I/O."""
import hashlib, importlib.util, json, pathlib, tempfile, unittest

spec = importlib.util.spec_from_file_location('joined', pathlib.Path(__file__).with_name('analyze.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Join(unittest.TestCase):
    def fixture(self, definitions):
        tmp = tempfile.TemporaryDirectory(prefix='poe-OFFLINE-deadline-join-')
        self.addCleanup(tmp.cleanup)
        root = pathlib.Path(tmp.name)
        (root / 'segments/0').mkdir(parents=True)
        lines = []
        per_file = {}
        for kind, data, source_file in definitions:
            per_file[source_file] = per_file.get(source_file, 0) + 1
            n = per_file[source_file]
            lines.append(dict(runId='native-paper-20261028223428977', kind=kind,
                              sourceFile=source_file, sourceLine=n, sourceSequence=n,
                              sourceLineSha256='a' * 64, data=data))
        (root / 'segments/0/selected-events.ndjson').write_text(''.join(json.dumps(v) + '\n' for v in lines))
        (root / 'final-status.json').write_text(json.dumps(dict(
            source=dict(commit='b' * 40, sha256='c' * 64),
            runId='native-paper-20261028223428977', configurationSha256='d' * 64)))
        files = [dict(file=name, **m.fingerprint(root / name)) for name in
                 ['segments/0/selected-events.ndjson', 'final-status.json']]
        (root / 'index.json').write_text(json.dumps(dict(
            rawFinancialFilesIncluded=False, credentialsIncluded=False,
            completeMarketEvidenceIncluded=False, files=files)))
        return root

    @staticmethod
    def page(mint, rid, at, source_file='events-001.ndjson'):
        kind = dict(transport='http', method='getSignaturesForAddress')
        return [
            ('native-audit-dispatch-state', dict(mint=mint, windowEndAt=1000,
                firstReadyAt=1001, reason='page-admission', context={}), source_file),
            ('component-physical-start', dict(id=rid, at=at, enqueuedAt=at-1, kind=kind), source_file),
            ('http-lifecycle-timing', dict(id=rid, endpoint='https://solana-rpc.publicnode.com',
                status=200, elapsedMonotonicMs=10, responseBytes=100, headersAt=at+5), source_file),
            ('component-physical-settled', dict(id=rid, at=at+10, kind=kind), source_file),
            ('native-audit-dispatch-state', dict(mint=mint, windowEndAt=1000,
                firstReadyAt=1001, reason='page-response', context={}), source_file)]

    @staticmethod
    def outcome(mint, attempts, status='verified', source_file='events-001.ndjson'):
        return [('native-candidate-window-audit', dict(mint=mint,
            result=dict(target=dict(endAt=1000), requestAttempts=attempts, status=status)), source_file)]

    def test_interleaved_peer_sessions_never_join_by_overlapping_time_range(self):
        definitions = self.page('A', 1, 1002) + self.page('B', 2, 1020) + self.page('A', 3, 1035)
        result = m.analyze(self.fixture(definitions + self.outcome('A', 2) + self.outcome('B', 1)))
        cases = {v['mint']: v for v in result['cases']}
        self.assertEqual([v['id'] for v in cases['A']['pages']], [1, 3])
        self.assertEqual([v['id'] for v in cases['B']['pages']], [2])
        self.assertEqual(result['targetsWithIncompletePhysicalPageAttribution'], 0)

    def test_recorder_sequence_reset_is_ordered_by_file_and_line(self):
        result = m.analyze(self.fixture(self.page('A', 1, 1002) + self.outcome('A', 1) +
                          self.page('B', 2, 1020, 'events-002.ndjson') + self.outcome('B', 1, source_file='events-002.ndjson')))
        self.assertEqual(result['physicalStarts'], 2)
        self.assertEqual(result['directlyLinkedHistoryPages'], 2)

    def test_expiry_is_not_counted_as_an_additional_unavailable_target(self):
        definitions = self.page('A', 1, 1002) + self.outcome('A', 1, 'unavailable')
        definitions.append(('native-predictive-window-expired', dict(mint='A', windowEndAt=1000), 'events-001.ndjson'))
        result = m.analyze(self.fixture(definitions))
        self.assertEqual(result['targetCount'], 1)
        self.assertEqual(result['expiredTargetsWithUnavailableAudit'], 1)
        self.assertEqual(result['outcomeCounts'], {'audit-unavailable': 1})

    def test_missing_admission_stays_unknown_instead_of_inventing_identity(self):
        definitions = self.page('A', 1, 1002)[1:] + self.outcome('A', 1)
        result = m.analyze(self.fixture(definitions))
        self.assertEqual(result['directlyLinkedHistoryPages'], 0)
        self.assertEqual(result['unlinkedHistoryPhysicalStarts'], [1])
        self.assertEqual(result['targetsWithIncompletePhysicalPageAttribution'], 1)

    def test_changed_indexed_file_fails_before_analysis(self):
        root = self.fixture(self.page('A', 1, 1002))
        (root / 'segments/0/selected-events.ndjson').write_text('{}\n')
        with self.assertRaises(AssertionError):
            m.analyze(root)


if __name__ == '__main__':
    unittest.main()
