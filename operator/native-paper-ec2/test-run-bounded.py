"""Offline supervisor mechanics only; every process/account/status is disposable."""
import copy
import importlib.util
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

P = pathlib.Path(__file__).with_name('run-bounded.py')
spec = importlib.util.spec_from_file_location('paper_supervisor', P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def manifest():
    return {'schemaVersion': 1, 'kind': 'poe-native-paper-bounded-supervision-v1',
            'source': {'commit': 'a'*40, 'sha256': 'b'*64},
            'configurationSha256': 'c'*64, 'managementConfigurationSha256': 'd'*64,
            'nodeSelectorSha256': 'e'*64, 'limits': copy.deepcopy(m.LIMITS),
            'publisher': [{'path': name, 'bytes': 1, 'sha256': 'f'*64} for name in m.PUBLISHER_FILES]}


def source(**patches):
    s = {'accountId': m.ACCOUNT_ID, 'inceptionAt': m.INCEPTION, 'mode': 'paper',
         'financialExecutionAuthorized': True, 'liveTradingEnabled': False,
         'source': {'commit': 'a'*40, 'sha256': 'b'*64}, 'configurationSha256': 'c'*64,
         'managementOnly': False, 'entriesEnabled': False, 'running': False,
         'startedAt': 1000, 'generatedAt': 1200, 'runtimePid': 123,
         'runId': 'native-paper-20261028180000000', 'positions': {}, 'pending': {},
         'usage': {'rpc': {'maximumNewUnits': 1500, 'newUnits': 0, 'maximumNewResponseBytes': 268435456, 'newAccountedResponseBytes': 0}, 'managementReserve': {'remainingChapters': 64}}}
    s.update(patches)
    return s


def terminate(process, grace=1):
    if process is None:
        return True
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=2)
    return process.poll() is not None


class Guards(unittest.TestCase):
    def test_exact_manifest_rejects_extra_privileges_or_changed_bounds(self):
        good = manifest()
        raw = json.dumps(good).encode()
        self.assertEqual(m.validate_manifest(raw, m.digest(raw)), good)
        for update in [{'limits': {**m.LIMITS, 'sourceCpuHardSeconds': 900}}, {'wallet': 'FORBIDDEN'}, {'source': {'commit': 'a'*40, 'sha256': 'invalid'}}]:
            bad = {**good, **update}
            body = json.dumps(bad).encode()
            with self.assertRaises(m.Guard):
                m.validate_manifest(body, m.digest(body))
        with self.assertRaises(m.Guard):
            m.validate_manifest(raw, '0'*64)

    def test_fresh_exact_runtime_provenance_cannot_be_old_or_authoritative(self):
        good = source()
        self.assertEqual(m.validate_source(good, manifest(), False, 1000, 1250, 123), good)
        cases = [{'accountId': 'poe-authoritative-fixture'}, {'inceptionAt': 1}, {'liveTradingEnabled': True}, {'mode': 'candidate-evaluation'}, {'configurationSha256': 'd'*64}, {'runtimePid': 122}, {'startedAt': 999}, {'generatedAt': 100000}, {'positions': []}, {'managementOnly': True}, {'source': None}, {'timing': []}]
        for change in cases:
            with self.subTest(change=change), self.assertRaises(m.Guard):
                m.validate_source(source(**change), manifest(), False, 1000, 1250, 123)
        with self.assertRaises(m.Guard):
            m.validate_source(good, manifest(), False, 1000, 100000, 123)

    def test_management_only_requires_separate_hash_and_entries_closed(self):
        good = source(managementOnly=True, configurationSha256='d'*64)
        self.assertEqual(m.validate_source(good, manifest(), True, 1000, 1250, 123), good)
        with self.assertRaises(m.Guard):
            m.validate_source({**good, 'entriesEnabled': True}, manifest(), True, 1000, 1250, 123)
        args = m.source_args('/node', pathlib.Path('/release'), True)
        self.assertIn('--management-only', args)
        self.assertEqual(args[args.index('--deep-slots')+1], '1')
        self.assertIn('--resume', args)
        self.assertNotIn('--management-only', m.source_args('/node', pathlib.Path('/release'), False))

    def test_unknown_never_becomes_flat_and_unsettled_group_never_restarts(self):
        flat = source()
        settlement = {'physicalSettlementConfirmed': True, 'positions': 0, 'pending': 0}
        self.assertEqual(m.transition(flat, settlement, True)['action'], 'complete')
        for s, receipt in [(None, settlement), (source(running=True), settlement), (flat, None), (flat, {'physicalSettlementConfirmed': False}), (flat, {'physicalSettlementConfirmed': True, 'positions': False, 'pending': False}), (source(positions={'token': {}}), settlement)]:
            self.assertEqual(m.transition(s, receipt, True)['action'], 'management-only')
            self.assertFalse(m.transition(s, receipt, True)['flatVerified'])
        self.assertEqual(m.transition(flat, settlement, False)['action'], 'blocked')
        held = source(positions={'token': {'units': '7'}})
        self.assertEqual(m.transition(held, {'physicalSettlementConfirmed': True, 'positions': 1, 'pending': 0}, True)['reason'], 'verified-retained-financial-obligations')

    def test_held_runway_recovery_precedes_hard_chapter_request_or_byte_exhaustion(self):
        held = source(positions={'fixture-token': {'units': '7'}})
        self.assertIsNone(m.protection_runway_stop(held))
        for changed, expected in [({'remainingChapters': 4}, 'PROTECTION_CHAPTER_RUNWAY_RECOVERY')]:
            value = copy.deepcopy(held)
            value['usage']['managementReserve'].update(changed)
            self.assertEqual(m.protection_runway_stop(value), expected)
        for key, changed, expected in [('newUnits', 1496, 'PROTECTION_REQUEST_RUNWAY_RECOVERY'), ('newAccountedResponseBytes', 268435456-4*1024*1024, 'PROTECTION_RESPONSE_RUNWAY_RECOVERY')]:
            value = copy.deepcopy(held)
            value['usage']['rpc'][key] = changed
            self.assertEqual(m.protection_runway_stop(value), expected)
        self.assertEqual(m.protection_runway_stop({**held, 'usage': None}), 'PROTECTION_RPC_RUNWAY_UNKNOWN')
        self.assertIsNone(m.protection_runway_stop(source(usage=None)))

    def test_private_reader_refuses_links_fifos_and_changed_owner(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-supervisor-') as tmp:
            root = pathlib.Path(tmp)
            p = root/'normal'
            p.write_text('fixture')
            p.chmod(0o600)
            self.assertEqual(m.regular(p, 100, os.getuid()), b'fixture')
            (root/'symlink').symlink_to(p)
            os.mkfifo(root/'fifo', 0o600)
            os.link(p, root/'hardlink')
            for candidate in [p, root/'symlink', root/'fifo', root/'hardlink']:
                with self.subTest(path=candidate.name), self.assertRaises(m.Guard if candidate.name != 'symlink' else OSError):
                    m.regular(candidate, 100, os.getuid())

    def test_source_process_environment_has_no_inherited_credentials(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-child-') as tmp:
            log = pathlib.Path(tmp)/'child.log'
            p = m.launch([sys.executable, '-c', 'import os,json;print(json.dumps(sorted(os.environ)))'], log, 5, 6, 1)
            p.wait(timeout=3)
            self.assertEqual(p.returncode, 0)
            self.assertTrue(set(json.loads(log.read_text())) <= {'LANG', 'LC_CTYPE', 'PATH', 'TZ'})
            self.assertTrue({'LANG', 'PATH', 'TZ'} <= set(json.loads(log.read_text())))
            self.assertTrue(terminate(p))

    def test_only_current_accepted_source_time_satisfies_reporting_freshness(self):
        current = source(startedAt=1000, generatedAt=100000)
        rows = [
            {'runId': current['runId'], 'sourceAt': 1100},
            {'runId': current['runId'], 'sourceAt': 99000},
            {'runId': 'another-run', 'sourceAt': 100000},
            {'runId': current['runId'], 'sourceAt': 100001},
        ]
        helpers = SimpleNamespace(publisher_acks=lambda *_: rows)
        self.assertEqual(m.accepted_source_at(['fixture-log'], current, helpers, 100000), 99000)
        self.assertIsNone(m.accepted_source_at(['fixture-log'], current, helpers, 200000))

    def test_reporting_suspension_is_private_append_only_and_never_touches_ledger(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-admission-suspension-') as tmp:
            account = pathlib.Path(tmp)
            self.assertTrue(m.suspend_admissions(account, source(), 1100, 100000))
            marker = account/'admission-suspension.request'
            before = marker.read_bytes()
            self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
            self.assertFalse(m.suspend_admissions(account, source(), 1200, 100001))
            self.assertEqual(marker.read_bytes(), before)
            self.assertFalse((account/'ledger.sqlite').exists())

    def test_exact_accepted_source_witness_keeps_first_two_and_latest_two(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-source-witness-') as tmp:
            root = pathlib.Path(tmp)
            witness = m.AcceptedSourceWitness(root)
            acks, originals = [], {}
            helper = SimpleNamespace(publisher_acks=lambda *_: acks)
            for index in range(1, 7):
                value = source(generatedAt=1000+index, running=True)
                raw = (json.dumps(value, sort_keys=True)+'\n').encode()
                originals[value['generatedAt']] = raw
                witness.observe(raw, value)
                acks.append({'published': True, 'result': 'accepted', 'accountId': m.ACCOUNT_ID,
                             'runId': value['runId'], 'sourceAt': value['generatedAt'],
                             'running': True, 'sourceAgeMs': 20})
                witness.collect(['fixture-log'], helper)
            first = (root/'accepted-source-first-1.json').read_bytes()
            self.assertEqual(first, originals[1001])
            self.assertEqual((root/'accepted-source-first-2.json').read_bytes(), originals[1002])
            receipt = json.loads((root/'accepted-source-witness.json').read_text())
            self.assertEqual(receipt['acceptedDistinctSources'], 6)
            self.assertEqual(receipt['unmatchedAcknowledgements'], 0)
            self.assertEqual(sorted(row['sourceAt'] for row in receipt['rows']), [1001, 1002, 1005, 1006])
            for row in receipt['rows']:
                raw = (root/row['file']).read_bytes()
                self.assertEqual(raw, originals[row['sourceAt']])
                self.assertEqual(m.digest(raw), row['sourceSha256'])
                self.assertEqual(row['publisherAcknowledgement']['sourceAt'], row['sourceAt'])
            self.assertEqual((root/'accepted-source-first-1.json').read_bytes(), first)
            self.assertLessEqual(len(witness.recent), 4)
            self.assertEqual(witness.summary()['retainedSourceFiles'], 4)

    def test_missing_source_witness_is_explicit_and_capture_pressure_cannot_stop_trading(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-source-witness-missing-') as tmp:
            root = pathlib.Path(tmp)
            witness = m.AcceptedSourceWitness(root)
            ack = {'accountId': m.ACCOUNT_ID, 'runId': source()['runId'], 'sourceAt': 1200, 'running': False}
            helper = SimpleNamespace(publisher_acks=lambda *_: [ack])
            witness.collect(['fixture-log'], helper)
            self.assertEqual(witness.summary()['unmatchedAcknowledgements'], 1)
            self.assertEqual(witness.summary()['retainedSourceFiles'], 0)
            self.assertFalse((root/'accepted-source-first-1.json').exists())
            # Matching a new raw source cannot substitute one for the missing
            # earlier timestamp. A private storage failure disables only this
            # witness cache and remains visible in the supervisor outcome.
            value = source(generatedAt=1300)
            witness.observe(json.dumps(value).encode(), value)
            ack['sourceAt'] = 1300
            with patch.object(witness, 'atomic', side_effect=OSError('SYNTHETIC disk pressure')):
                witness.collect(['fixture-log'], helper)
            self.assertEqual(witness.summary()['disabledReason'], 'ACCEPTED_SOURCE_WITNESS_CAPTURE_UNAVAILABLE')
            self.assertFalse(witness.summary()['sourceInformationReconstructed'])
            self.assertFalse((root/'ledger.sqlite').exists())

    def test_real_disposable_processes_keep_publisher_running_during_financial_handoff(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-handoff-') as tmp:
            root = pathlib.Path(tmp)
            account = root/'account'
            account.mkdir()
            state = {'process': None, 'logs': [], 'restarts': 0, 'started': False}
            publisher_pids = []
            original_launch = m.launch
            high_water_injected = False
            def bounded_launch(args, *rest, **kwargs):
                process = original_launch(args, *rest, **kwargs)
                if '--watch' in args:
                    publisher_pids.append(process.pid)
                return process
            def rss(pid):
                nonlocal high_water_injected
                if publisher_pids and pid == publisher_pids[0] and not high_water_injected:
                    high_water_injected = True
                    return 200*1024*1024
                return 80*1024*1024 if pid in publisher_pids else 0
            def args(_node, _release, management):
                value = source(configurationSha256='d'*64 if management else 'c'*64, managementOnly=management, positions={} if management else {'fixture-token': {'units': '7'}}, timing={})
                code = "import pathlib,time,json,os; p=pathlib.Path("+repr(str(account))+ "); s="+repr(value)+"; s.update(startedAt=int(time.time()*1000),generatedAt=int(time.time()*1000),runtimePid=os.getpid(),running=True); s['timing']['lastCompletedProtectionAt']=s['startedAt']; s['timing']['firstCompletedProtectionAt']=s['startedAt']; (p/'status.json').write_text(json.dumps(s)); (p/'status.json').chmod(0o600); time.sleep("+repr(1.2 if management else 3.2)+"); s.update(running=False,generatedAt=int(time.time()*1000)); (p/'status.json').write_text(json.dumps(s)); d=p/'runs'/s['runId']; d.mkdir(parents=True,exist_ok=True); (d/'settlement.json').write_text(json.dumps({'physicalSettlementConfirmed':True,'positions':len(s['positions']),'pending':0})); (d/'settlement.json').chmod(0o600)"
                return [sys.executable, '-c', code]
            publisher_code = "import sys,time,json,pathlib; s=json.loads(pathlib.Path("+repr(str(account/'status.json'))+").read_text()); print(json.dumps({'published':True,'result':'accepted','accountId':s['accountId'],'runId':s['runId'],'sourceAt':s['generatedAt'],'running':s['running'],'sourceAgeMs':0}),flush=True); time.sleep(60 if '--watch' in sys.argv else 0)"
            def ack(log, _binding, source_at, running):
                rows = [json.loads(x) for x in log.read_text().splitlines()]
                return next((r for r in rows if r['sourceAt']==source_at and r['running'] is running), None)
            helpers = SimpleNamespace(group_rss=rss, terminate=terminate, accepted_ack=ack, publisher_acks=lambda *_: [])
            original = m.regular
            real_publish_once = m.publish_once
            with patch.object(m, 'launch', side_effect=bounded_launch), patch.object(m, 'publish_once', side_effect=AssertionError('Render drain must not precede recovery')) as drain, patch.object(m, 'ACCOUNT', account), patch.object(m, 'source_args', side_effect=args), patch.object(m, 'publisher_args', return_value=[sys.executable, '-c', publisher_code]), patch.object(m, 'regular', side_effect=lambda p, n, owner=m.UID, private=True: original(p, n, os.getuid(), private)):
                first = m.supervise_segment('/unused-node', root, root, root, manifest(), helpers, False, 0, time.monotonic()+4000, lambda: False, state)
                self.assertEqual(first['transition']['action'], 'management-only')
                self.assertEqual(first['maximumPublisherGroupRssBytes'], 200*1024*1024)
                self.assertEqual(first['publisherRestarts'], 1)
                self.assertEqual(len(publisher_pids), 2)
                self.assertIsNone(first['finalStoppedReportAccepted'])
                self.assertFalse(first['initialTargetReached'])
                self.assertEqual(len(first['finalStatusSha256']), 64)
                self.assertIsNone(state['process'].poll())
                publisher_pid = state['process'].pid
                second = m.supervise_segment('/unused-node', root, root, root, manifest(), helpers, True, 1, time.monotonic()+4000, lambda: False, state, first['lastCompletedProtectionAt'])
                self.assertEqual(second['transition']['action'], 'complete')
                self.assertEqual(state['process'].pid, publisher_pid)
                self.assertIsNone(state['process'].poll())
                self.assertEqual(drain.call_count, 0)
                self.assertIsNotNone(second['crossSegmentProtectionGapMs'])
                terminate(state['process'])
                final = json.loads((account/'status.json').read_text())
                self.assertTrue(real_publish_once('/unused-node', root, root, final, helpers, 2))
                self.assertTrue(second['sourceGroupSettled'])
                self.assertFalse((account/'ledger.sqlite').exists())

    def test_workflow_parent_hard_limits_permit_the_actual_child_bounds(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-parent-hard-bounds-') as tmp:
            log = pathlib.Path(tmp)/'child.log'
            code = "import importlib.util,resource,pathlib,sys; resource.setrlimit(resource.RLIMIT_NOFILE,(64,256)); resource.setrlimit(resource.RLIMIT_CPU,(60,600)); q=importlib.util.spec_from_file_location('bounded',"+repr(str(P))+ "); m=importlib.util.module_from_spec(q); q.loader.exec_module(m); p=m.launch([sys.executable,'-c','import resource;print(resource.getrlimit(resource.RLIMIT_NOFILE))'],pathlib.Path("+repr(str(log))+"),5,6,1); p.wait(timeout=3); print(p.returncode)"
            result = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), '0')
            self.assertEqual(log.read_text().strip(), '(128, 128)')
            workflow = P.parents[2]/'.github/workflows/poe-native-paper-research.yml'
            self.assertIn('--nofile=64:256', workflow.read_text())

    def test_cpu_early_stop_settles_before_management_only_recovery(self):
        """Synthetic CPU telemetry, real disposable financial/publisher children."""
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-cpu-handoff-') as tmp:
            root = pathlib.Path(tmp)
            account = root/'account'
            account.mkdir()
            state = {'process': None, 'logs': [], 'restarts': 0, 'started': False}
            children = []
            original_launch = m.launch
            original_regular = m.regular
            first_source_pid = None

            def launch(args, *rest, **kwargs):
                nonlocal first_source_pid
                process = original_launch(args, *rest, **kwargs)
                children.append(process)
                if first_source_pid is None:
                    first_source_pid = process.pid
                return process

            def args(_node, _release, management):
                value = source(configurationSha256='d'*64 if management else 'c'*64,
                               managementOnly=management,
                               positions={} if management else {'fixture-token': {'units': '7'}},
                               timing={})
                code = "\n".join([
                    'import pathlib,time,json,os,signal',
                    'p=pathlib.Path('+repr(str(account))+')',
                    's='+repr(value),
                    's.update(startedAt=int(time.time()*1000),generatedAt=int(time.time()*1000),runtimePid=os.getpid(),running=True)',
                    "s['timing']['lastCompletedProtectionAt']=s['startedAt']",
                    "s['timing']['firstCompletedProtectionAt']=s['startedAt']",
                    "(p/'status.json').write_text(json.dumps(s)); (p/'status.json').chmod(0o600)",
                    'def finish(*_args):',
                    ' s.update(running=False,generatedAt=int(time.time()*1000))',
                    " (p/'status.json').write_text(json.dumps(s))",
                    " d=p/'runs'/s['runId']; d.mkdir(parents=True,exist_ok=True)",
                    " (d/'settlement.json').write_text(json.dumps({'physicalSettlementConfirmed':True,'positions':len(s['positions']),'pending':0}))",
                    " (d/'settlement.json').chmod(0o600)",
                    ' raise SystemExit(0)',
                    'signal.signal(signal.SIGTERM,finish)',
                    'time.sleep('+('1.2' if management else '60')+')',
                    'finish()',
                ])
                return [sys.executable, '-c', code]

            helpers = SimpleNamespace(group_rss=lambda _pid: 0, terminate=terminate,
                                      accepted_ack=lambda *_: None, publisher_acks=lambda *_: [])
            # Reach the first valid owned-source read and start its publisher,
            # then inject the measured early-stop boundary. No real CPU load.
            def cpu(pid):
                return m.LIMITS['sourceEarlyStopCpuSeconds'] if pid == first_source_pid and state['started'] else 0

            try:
                with patch.object(m, 'ACCOUNT', account), patch.object(m, 'launch', side_effect=launch), patch.object(m, 'source_args', side_effect=args), patch.object(m, 'publisher_args', return_value=[sys.executable, '-c', 'import time;time.sleep(60)']), patch.object(m, 'process_cpu', side_effect=cpu), patch.object(m, 'regular', side_effect=lambda p, n, owner=m.UID, private=True: original_regular(p, n, os.getuid(), private)):
                    first = m.supervise_segment('/unused', root, root, root, manifest(), helpers,
                                                False, 0, time.monotonic()+4000, lambda: False, state)
                    self.assertEqual(first['reason'], 'SOURCE_EARLY_CPU_STOP')
                    self.assertEqual(first['boundedStopEvidence']['sourceCpuSeconds'], 220)
                    self.assertTrue(first['sourceGroupSettled'])
                    self.assertEqual(first['sourceExit'], 0)
                    self.assertEqual(first['positions'], 1)
                    self.assertEqual(first['transition']['action'], 'management-only')
                    self.assertFalse(first['initialTargetReached'])
                    self.assertIsNotNone(children[0].poll(), 'old financial child settled before a new writer')
                    publisher_pid = state['process'].pid
                    second = m.supervise_segment('/unused', root, root, root, manifest(), helpers,
                                                 True, 1, time.monotonic()+4000, lambda: False, state,
                                                 first['lastCompletedProtectionAt'])
                    self.assertIsNone(second['reason'])
                    self.assertEqual(second['transition']['action'], 'complete')
                    self.assertEqual(state['process'].pid, publisher_pid)
                    self.assertIsNone(state['process'].poll(), 'reporting remains independent through handoff')
                    self.assertTrue(second['sourceGroupSettled'])
                    self.assertIsNotNone(second['crossSegmentProtectionGapMs'])
                    self.assertFalse((account/'ledger.sqlite').exists())
            finally:
                for child in children:
                    terminate(child)

    def test_spawn_failure_preserves_unknown_and_returns_a_recoverable_outcome(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-spawn-') as tmp:
            root = pathlib.Path(tmp)
            helpers = SimpleNamespace(terminate=terminate)
            with patch.object(m, 'launch', side_effect=OSError('SYNTHETIC_NO_LAUNCH')):
                r = m.supervise_segment('/unused-node', root, root, root, manifest(), helpers, False, 0, time.monotonic()+4000, lambda: False)
            self.assertIsNone(r['sourcePid'])
            self.assertTrue(r['sourceGroupSettled'])
            self.assertEqual(r['transition']['action'], 'management-only')
            self.assertFalse(r['transition']['flatVerified'])

    def test_cancellation_settles_owned_child_without_manufacturing_flatness(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-paper-cancel-') as tmp:
            root = pathlib.Path(tmp)
            account = root/'account'
            account.mkdir()
            helpers = SimpleNamespace(group_rss=lambda _pid: 0, terminate=terminate, accepted_ack=lambda *_args: None)
            with patch.object(m, 'ACCOUNT', account), patch.object(m, 'source_args', return_value=[sys.executable, '-c', 'import time;time.sleep(10)']):
                r = m.supervise_segment('/unused-node', root, root, root, manifest(), helpers, False, 0, time.monotonic()+4000, lambda: True)
            self.assertTrue(r['sourceGroupSettled'])
            self.assertEqual(r['transition']['action'], 'management-only')
            self.assertIsNone(r['positions'])
            self.assertIsNone(r['finalStoppedReportAccepted'])
            self.assertTrue((root/'segment-0.json').exists())


if __name__ == '__main__':
    unittest.main()
