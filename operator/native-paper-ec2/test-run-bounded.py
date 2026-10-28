"""Offline supervisor mechanics only; every process/account/status is disposable."""
import copy
import fcntl
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




class SourceUpgrade(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='poe-OFFLINE-source-upgrade-')
        self.root = pathlib.Path(self.temporary.name)
        self.root.chmod(0o700)
        self.owner = os.getuid()
        dead = subprocess.Popen([sys.executable, '-c', 'pass'])
        dead.wait(timeout=3)
        self.old = {'commit': 'a'*40, 'sha256': 'b'*64}
        self.manifest = manifest()
        self.manifest['source'] = {'commit': 'c'*40, 'sha256': 'd'*64}
        self.input = {'schemaVersion': 1, 'source': self.old, 'reportingBinding': {'accountId': m.ACCOUNT_ID, 'inceptionAt': m.INCEPTION}, 'baselinePaths': ['/OFFLINE/original-book.json'], 'priorPhysicalSettled': True, 'unchanged': {'nested': ['original', 7]}}
        self.status = source(runtimePid=dead.pid)
        self.pilot = {'schemaVersion': 1, 'experimental': True, 'authoritative': False, 'accountId': m.ACCOUNT_ID, 'inceptionAt': m.INCEPTION, 'runs': [self.status['runId']], 'baselinePaths': ['/OFFLINE/original-book.json']}
        self.settlement = {'at': 1210, 'physicalSettlementConfirmed': True, 'positions': 0, 'pending': 0, 'financialHistoryPreserved': True}
        self.run = self.root/'runs'/self.status['runId']
        self.run.mkdir(parents=True, mode=0o700)
        (self.root/'runs').chmod(0o700)
        self.save('input.json', self.input)
        self.save('pilot.json', self.pilot)
        self.save('status.json', self.status)
        self.save('runs/'+self.status['runId']+'/settlement.json', self.settlement)
        self.lock = self.root/'ledger.sqlite.owner.lock'
        self.lock.write_bytes(b'')
        self.lock.chmod(0o600)
        self.database = self.root/'ledger.sqlite'
        self.database.write_bytes(b'OFFLINE sentinel: never open or reseed financial DB')
        self.originals = {name: (self.root/name).read_bytes() for name in ['input.json', 'pilot.json', 'status.json', 'ledger.sqlite']}

    def tearDown(self):
        self.temporary.cleanup()

    def save(self, path, value):
        target = self.root/path
        target.write_text(json.dumps(value)+'\n')
        target.chmod(0o600)

    def upgrade(self, operation='123-1'):
        return m.prepare_input_source(self.root, self.manifest, operation, owner=self.owner, now=2000)

    def unchanged(self):
        for name, raw in self.originals.items():
            self.assertEqual((self.root/name).read_bytes(), raw)

    def test_settled_upgrade_changes_only_input_source_and_preserves_original_private_bytes(self):
        original_replace, original_fsync = os.replace, os.fsync
        observed_lock, synchronized = [], []
        def fsync(fd):
            synchronized.append(os.readlink('/proc/self/fd/'+str(fd)))
            return original_fsync(fd)
        def replace(*args, **kwargs):
            fd = os.open(self.lock, os.O_RDONLY)
            try:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
                observed_lock.append(True)
            finally:
                os.close(fd)
            for path in [self.root, self.root/'provenance', self.root/'provenance/source-transition-123-1']:
                self.assertIn(str(path), synchronized, 'backup parent directory links must be durable before input replacement')
            return original_replace(*args, **kwargs)
        with patch.object(m.os, 'replace', side_effect=replace), patch.object(m.os, 'fsync', side_effect=fsync):
            receipt = self.upgrade()
        self.assertEqual(observed_lock, [True])
        self.assertTrue(receipt['changed'])
        self.assertEqual(receipt['previousSource'], self.old)
        self.assertEqual(receipt['nextSource'], self.manifest['source'])
        self.assertEqual(receipt['monitoringGapAtTransitionMs'], 800)
        self.assertFalse(receipt['financialDatabaseOpened'])
        self.assertFalse(receipt['financialStateModified'])
        self.assertFalse(receipt['continuousOperationClaimed'])
        current = json.loads((self.root/'input.json').read_bytes())
        self.assertEqual(current, {**self.input, 'source': self.manifest['source']})
        directory = self.root/'provenance/source-transition-123-1'
        self.assertEqual((directory/'input-before.json').read_bytes(), self.originals['input.json'])
        self.assertEqual(json.loads((directory/'transition.json').read_bytes()), receipt)
        self.assertEqual(receipt['previousInputSha256'], m.digest(self.originals['input.json']))
        self.assertEqual(receipt['nextInputSha256'], m.digest((self.root/'input.json').read_bytes()))
        for name in ['pilot.json', 'status.json', 'ledger.sqlite']:
            self.assertEqual((self.root/name).read_bytes(), self.originals[name])
        fd = os.open(self.lock, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
        finally:
            os.close(fd)

    def test_nonflat_settled_exposure_and_pending_actions_are_retained(self):
        self.status['positions'] = {'OFFLINE-held': {'units': '7'}}
        self.status['pending'] = {'OFFLINE-exit': {'mint': 'OFFLINE-held', 'side': 'sell'}}
        self.settlement.update(positions=1, pending=1)
        self.save('status.json', self.status)
        self.save('runs/'+self.status['runId']+'/settlement.json', self.settlement)
        before = (self.root/'status.json').read_bytes()
        receipt = self.upgrade()
        self.assertEqual((receipt['positionsRetained'], receipt['pendingActionsRetained']), (1, 1))
        self.assertEqual((self.root/'status.json').read_bytes(), before)
        self.assertEqual(self.database.read_bytes(), self.originals['ledger.sqlite'])

    def test_upgrade_preserves_the_same_six_pending_projection_bound_as_source_validation(self):
        self.status['pending'] = {'OFFLINE-action-'+str(i): {'side': 'sell'} for i in range(6)}
        self.settlement['pending'] = 6
        self.save('status.json', self.status)
        self.save('runs/'+self.status['runId']+'/settlement.json', self.settlement)
        self.assertEqual(self.upgrade()['pendingActionsRetained'], 6)

    def test_same_source_initial_import_needs_no_old_runtime_and_never_updates_input(self):
        self.manifest['source'] = self.old
        self.lock.unlink()
        (self.root/'status.json').unlink()
        receipt = self.upgrade()
        self.assertFalse(receipt['changed'])
        self.assertFalse((self.root/'provenance').exists())
        self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])

    def test_active_owner_lock_or_runtime_pid_refuses_before_any_source_mutation(self):
        fd = os.open(self.lock, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaisesRegex(m.Guard, 'PRIOR_FINANCIAL_WRITER_ACTIVE'):
                self.upgrade()
        finally:
            os.close(fd)
        self.unchanged()
        self.status['runtimePid'] = os.getpid()
        self.save('status.json', self.status)
        with self.assertRaisesRegex(m.Guard, 'PRIOR_RUNTIME_PID_STILL_ALIVE'):
            self.upgrade()
        self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])
        self.assertFalse((self.root/'provenance').exists())

    def test_unresolved_research_or_status_source_conflict_is_not_a_source_upgrade(self):
        self.pilot['unresolvedResearch'] = {'retained': 'OFFLINE-unknown'}
        self.save('pilot.json', self.pilot)
        with self.assertRaisesRegex(m.Guard, 'SETTLED_SAME_ACCOUNT_MANIFEST_REQUIRED'):
            self.upgrade()
        del self.pilot['unresolvedResearch']
        self.save('pilot.json', self.pilot)
        self.status['source'] = {'commit': 'e'*40, 'sha256': 'f'*64}
        self.save('status.json', self.status)
        with self.assertRaisesRegex(m.Guard, 'PRIOR_STATUS_SOURCE_MISMATCH'):
            self.upgrade()
        self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])
        self.assertFalse((self.root/'provenance').exists())

    def test_unsettled_transport_or_ownership_mismatch_preserves_input(self):
        for changes in [{'physicalSettlementConfirmed': False}, {'positions': 1}, {'pending': True}, {'financialHistoryPreserved': False}]:
            with self.subTest(changes=changes):
                self.save('runs/'+self.status['runId']+'/settlement.json', {**self.settlement, **changes})
                with self.assertRaisesRegex(m.Guard, 'PRIOR_PHYSICAL_SETTLEMENT_REQUIRED'):
                    self.upgrade()
                self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])
        self.assertFalse((self.root/'provenance').exists())

    def test_running_unknown_or_wrong_account_source_never_becomes_quiescent(self):
        for changes in [{'running': True}, {'mode': 'candidate-evaluation'}, {'liveTradingEnabled': True}, {'accountId': 'authoritative'}, {'inceptionAt': 1}]:
            with self.subTest(changes=changes):
                self.save('status.json', {**self.status, **changes})
                with self.assertRaisesRegex(m.Guard, 'PRIOR_STOPPED_PAPER_SOURCE_REQUIRED'):
                    self.upgrade()
                self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])
        self.assertFalse((self.root/'provenance').exists())

    def test_conflicting_partial_transition_is_preserved_without_overwrite(self):
        target = self.root/'provenance/source-transition-123-1'
        target.mkdir(parents=True, mode=0o700)
        (self.root/'provenance').chmod(0o700)
        (target/'partial').write_bytes(b'OFFLINE retained interrupted evidence')
        with self.assertRaisesRegex(m.Guard, 'SOURCE_TRANSITION_PROVENANCE_EXISTS'):
            self.upgrade()
        self.assertEqual((target/'partial').read_bytes(), b'OFFLINE retained interrupted evidence')
        self.unchanged()

    def test_failed_atomic_update_retains_old_input_and_append_only_plan_and_backup(self):
        with patch.object(m.os, 'replace', side_effect=OSError('OFFLINE interrupted before replace')):
            with self.assertRaises(OSError):
                self.upgrade()
        self.unchanged()
        target = self.root/'provenance/source-transition-123-1'
        self.assertTrue((target/'transition-plan.json').exists())
        self.assertEqual((target/'input-before.json').read_bytes(), self.originals['input.json'])
        self.assertFalse((target/'transition.json').exists())
        self.assertTrue((self.root/'.input-source-123-1.pending').exists())

    def test_linked_input_or_owner_inode_is_refused_without_following_or_replacement(self):
        os.link(self.root/'input.json', self.root/'input-hardlink')
        with self.assertRaises(m.Guard):
            self.upgrade()
        self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])
        (self.root/'input-hardlink').unlink()
        owner_copy = self.root/'owner-copy'
        self.lock.rename(owner_copy)
        self.lock.symlink_to(owner_copy)
        with self.assertRaises(OSError):
            self.upgrade()
        self.assertEqual((self.root/'input.json').read_bytes(), self.originals['input.json'])


class ExactReviewedPackageTest(unittest.TestCase):
    def test_reviewed_manifest_retains_original_whitespace_and_hash_without_overwrite(self):
        raw = (json.dumps(manifest(), indent=2) + '\n').encode()
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-package-bytes-') as directory:
            path = pathlib.Path(directory)/'package.json'
            m.save_bytes(path, raw)
            self.assertEqual(path.read_bytes(), raw)
            self.assertEqual(m.digest(path.read_bytes()), m.digest(raw))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                m.save_bytes(path, raw)
            self.assertEqual(path.read_bytes(), raw)

    def test_raw_package_is_bounded_and_json_receipts_keep_the_existing_compact_format(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-package-bytes-') as directory:
            root = pathlib.Path(directory)
            for raw in [b'', b'x'*(128*1024+1), 'not-bytes']:
                with self.assertRaises(m.Guard):
                    m.save_bytes(root/'refused.json', raw)
            m.save(root/'receipt.json', {'a': 1})
            self.assertEqual((root/'receipt.json').read_bytes(), b'{"a":1}\n')


class ResourceTimelineTest(unittest.TestCase):
    def view(self, cpu=1, membership='1'*64):
        return {'liveProcesses': 1, 'membershipSha256': membership, 'cpuSeconds': cpu, 'rssBytes': 4096}

    def test_real_owned_process_group_counters_are_observed_without_command_or_environment_reads(self):
        child = subprocess.Popen([sys.executable, '-c', "import time; x=sum(range(2000000)); print('ready',flush=True); time.sleep(5)"], stdout=subprocess.PIPE, text=True, start_new_session=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            views = m.resource_process_views(child.pid, None)
            self.assertGreater(views['source']['cpuSeconds'], 0)
            self.assertGreater(views['source']['rssBytes'], 0)
            self.assertEqual(views['source']['liveProcesses'], 1)
            self.assertIsNone(views['publisher'])
            self.assertEqual(set(views['supervisor']), {'liveProcesses', 'membershipSha256', 'cpuSeconds', 'rssBytes'})
        finally:
            terminate(child)
            child.stdout.close()

    def test_interval_cpu_requires_stable_membership_and_source_time_stays_separate(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-resources-') as tmp:
            root = pathlib.Path(tmp)
            clock = [100.0]
            views = {'source': self.view(), 'publisher': None, 'supervisor': self.view(2)}
            with patch.object(m.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(m, 'resource_process_views', side_effect=lambda *_: copy.deepcopy(views)):
                timeline = m.ResourceTimeline(root, manifest(), False, 0, 100)
                s = source(generatedAt=1100, usage={'rpc': {'newUnits': 7, 'newAccountedResponseBytes': 80}, 'native': {'socketBytes': 90, 'normalizedEvents': 2}, 'feeds': {'pumpApiSocketBytes': 100}, 'eventBytes': 120, 'privateSentinel': 'MUST_NOT_EXPORT'})
                timeline.sample(1, None, s, 10000, 20000)
                clock[0] = 110;timeline.sample(1, None, s, 10000, 20000)
                clock[0] = 115;views['source'] = self.view(2.5);timeline.sample(1, None, s, 10000, 20000)
                clock[0] = 130;views['source'] = self.view(3, '2'*64);timeline.sample(1, None, s, 10000, 20000)
                clock[0] = 145;views['source'] = None;timeline.sample(1, None, s, 10000, 20000)
                summary = timeline.close()
            raw = (root/summary['file']).read_bytes();rows = [json.loads(x) for x in raw.splitlines()]
            self.assertEqual(summary['samples'], 4)
            self.assertEqual(summary['sha256'], m.digest(raw))
            self.assertEqual(summary['bytes'], len(raw))
            self.assertEqual((root/summary['file']).stat().st_mode & 0o777, 0o600)
            self.assertEqual(rows[0]['source'], manifest()['source'])
            self.assertEqual(rows[1]['processes']['source']['cpuDeltaSeconds'], 1.5)
            self.assertEqual(rows[1]['processes']['source']['oneCoreFraction'], 0.1)
            self.assertIsNone(rows[2]['processes']['source']['cpuDeltaSeconds'])
            self.assertIsNone(rows[3]['processes']['source'])
            self.assertTrue(all(row['sourceSnapshotAt'] == 1100 for row in rows))
            self.assertNotIn(b'MUST_NOT_EXPORT', raw)

    def test_diagnostic_capacity_and_write_failure_do_not_throw_or_overwrite_prior_evidence(self):
        with tempfile.TemporaryDirectory(prefix='poe-OFFLINE-resources-') as tmp:
            root = pathlib.Path(tmp)
            with patch.object(m, 'resource_process_views', return_value={'source': None, 'publisher': None, 'supervisor': None}):
                timeline = m.ResourceTimeline(root, manifest(), False, 0, time.monotonic())
                timeline.sample(1, None, None, 1, 2)
                before = (root/timeline.name).read_bytes()
                with patch.object(m, 'RESOURCE_SAMPLES_MAX_BYTES', len(before)):
                    timeline.sample(1, None, None, 1, 2, force=True)
                summary = timeline.close()
                self.assertEqual(summary['disabledReason'], 'RESOURCE_SAMPLE_BYTES_BOUND')
                self.assertEqual((root/timeline.name).read_bytes(), before)
                duplicate = m.ResourceTimeline(root, manifest(), False, 0, time.monotonic())
                self.assertEqual(duplicate.close()['disabledReason'], 'RESOURCE_SAMPLE_CREATE_FAILED')
                self.assertEqual((root/timeline.name).read_bytes(), before)
                failed = m.ResourceTimeline(root, manifest(), True, 1, time.monotonic())
                with patch.object(m.os, 'write', side_effect=OSError('OFFLINE controlled failure')):
                    failed.sample(1, None, None, 1, 2)
                self.assertEqual(failed.close()['disabledReason'], 'RESOURCE_SAMPLE_UNAVAILABLE')


if __name__ == '__main__':
    unittest.main()
