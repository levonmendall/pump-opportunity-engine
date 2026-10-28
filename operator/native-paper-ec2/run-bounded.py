#!/usr/bin/env python3
"""Fixed-account bounded native PAPER supervision; never opens the financial DB.

Source and reporting are separate processes. Only an exact, fresh final source
and settlement can establish flatness. Unknown/nonflat state gets one immediate
management-only segment after the previous process group is settled.
"""
import ctypes
import hashlib
import importlib.util
import json
import os
import pathlib
import pwd
import resource
import shutil
import signal
import stat
import subprocess
import sys
import time

UID = 994
HOME = pathlib.Path('/home/mm-ec2-runner')
ROOT = HOME / '.local/share/poe-native-paper'
ACCOUNT = ROOT / 'account'
ACCOUNT_ID = 'poe-pilot-8468add6-f916-48cf-a585-6cd008a81360'
INCEPTION = 1793123773252
SECRET = HOME / '.local/share/poe-reporting/pilot-ingest.secret'
SELECTOR = pathlib.Path('scripts/poe/native-candidate-run-bounded.py')
PACKAGE = pathlib.Path('operator/native-paper-ec2/run-package.json')
PUBLISHER = pathlib.Path('scripts/poe/native-candidates/reporting')
CONTRACT = 'confirmed-program-ordinary-flow-paper-v1'
MIB = 1024 * 1024
LIMITS = {'segmentSeconds': 1800, 'maximumSegments': 2, 'outerSeconds': 3840,
          'sourceHeapMiB': 192, 'sourceRssMiB': 512, 'sourceFileMiB': 40, 'sourceLogMiB': 8,
          'sourceCpuSoftSeconds': 240, 'sourceCpuHardSeconds': 245,
          'sourceEarlyStopCpuSeconds': 220, 'publisherRssMiB': 128,
          'publisherCpuSeconds': 30, 'publisherMaximumRestarts': 2,
          'initialStatusSeconds': 30, 'initialReportingSeconds': 55, 'statusStaleSeconds': 90,
          'gracefulStopSeconds': 30, 'finalPublishSeconds': 12,
          'minimumAvailableRamMiB': 1024, 'minimumDiskMiB': 1024,
          'minimumRecoveryRamMiB': 512, 'minimumRecoveryDiskMiB': 256,
          'ongoingDiskMiB': 128, 'ongoingAvailableRamMiB': 256, 'parentRssMiB': 128, 'supervisorEvidenceMiB': 32}
PUBLISHER_FILES = {'run-publisher.sh': 32768,
                   'dist/publisher.mjs': 131072, 'dist/manifest.json': 131072}


class Guard(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise Guard(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def hashed(value, length=64):
    return isinstance(value, str) and len(value) == length and all(c in '0123456789abcdef' for c in value)


def integer(value):
    return type(value) is int and value >= 0


def regular(path, maximum, owner=UID, private=True):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == owner and before.st_nlink == 1 and 0 < before.st_size <= maximum, 'BOUNDED_OWNER_FILE_REQUIRED')
        need(not before.st_mode & (0o077 if private else 0o022), 'PRIVATE_FILE_REQUIRED')
        body = os.read(fd, before.st_size + 1)
        after = os.fstat(fd)
        need(len(body) == before.st_size and (before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'FILE_CHANGED_DURING_READ')
        return body
    finally:
        os.close(fd)


def private_directory(path, owner=UID):
    value = path.lstat()
    need(stat.S_ISDIR(value.st_mode) and not stat.S_ISLNK(value.st_mode) and value.st_uid == owner and not value.st_mode & 0o077 and path.resolve(strict=True) == path, 'PRIVATE_DIRECTORY_REQUIRED')


def save(path, value):
    body = (json.dumps(value, separators=(',', ':')) + '\n').encode()
    need(len(body) <= 128 * 1024, 'SUPERVISOR_RECEIPT_BOUND')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        offset = 0
        while offset < len(body):
            offset += os.write(fd, body[offset:])
        os.fsync(fd)
    finally:
        os.close(fd)


def validate_manifest(raw, expected):
    need(hashed(expected) and digest(raw) == expected, 'EXACT_RUN_MANIFEST_HASH_REQUIRED')
    value = json.loads(raw)
    need(type(value) is dict and set(value) == {'schemaVersion', 'kind', 'source', 'configurationSha256', 'managementConfigurationSha256', 'nodeSelectorSha256', 'publisher', 'limits'}, 'EXACT_RUN_MANIFEST_REQUIRED')
    need(value['schemaVersion'] == 1 and value['kind'] == 'poe-native-paper-bounded-supervision-v1' and value['limits'] == LIMITS, 'REVIEWED_PAPER_LIMITS_REQUIRED')
    source = value['source']
    need(type(source) is dict and set(source) == {'commit', 'sha256'} and hashed(source['commit'], 40) and hashed(source['sha256']), 'FROZEN_SOURCE_REQUIRED')
    need(all(hashed(value[key]) for key in ['configurationSha256', 'managementConfigurationSha256', 'nodeSelectorSha256']), 'FROZEN_CONFIGURATION_REQUIRED')
    rows = value['publisher']
    need(type(rows) is list and len(rows) == 3 and all(type(r) is dict for r in rows) and {r.get('path') for r in rows} == set(PUBLISHER_FILES), 'EXACT_REPORTING_FILES_REQUIRED')
    for row in rows:
        need(set(row) == {'path', 'bytes', 'sha256'} and integer(row['bytes']) and 0 < row['bytes'] <= PUBLISHER_FILES[row['path']] and hashed(row['sha256']), 'BOUNDED_REPORTING_SPECIFICATION')
    return value


def validate_source(value, manifest, management, wall_started_at, now, runtime_pid):
    need(type(value) is dict and value.get('accountId') == ACCOUNT_ID and value.get('inceptionAt') == INCEPTION and value.get('mode') == 'paper' and value.get('financialExecutionAuthorized') is True and value.get('liveTradingEnabled') is False, 'PAPER_SOURCE_IDENTITY_REQUIRED')
    source = value.get('source', {})
    need(type(source) is dict and source.get('commit') == manifest['source']['commit'] and source.get('sha256') == manifest['source']['sha256'], 'PAPER_EXECUTABLE_SOURCE_MISMATCH')
    configuration = manifest['managementConfigurationSha256' if management else 'configurationSha256']
    need(value.get('configurationSha256') == configuration and value.get('managementOnly') is management and type(value.get('running')) is bool, 'PAPER_CONFIGURATION_MISMATCH')
    need(integer(value.get('startedAt')) and integer(value.get('generatedAt')) and wall_started_at <= value['startedAt'] <= value['generatedAt'] <= now + 5000 and now - value['generatedAt'] <= LIMITS['statusStaleSeconds'] * 1000, 'PAPER_SOURCE_FRESHNESS_REQUIRED')
    need(value.get('runtimePid') == runtime_pid, 'PAPER_RUNTIME_PID_MISMATCH')
    run_id = value.get('runId')
    need(isinstance(run_id, str) and run_id.startswith('native-paper-') and run_id[13:].isdigit() and len(run_id) <= 64, 'PAPER_RUN_ID_REQUIRED')
    need(type(value.get('positions')) is dict and type(value.get('pending')) is dict and len(value['positions']) <= 3 and len(value['pending']) <= 6, 'PAPER_OWNERSHIP_PROJECTION_REQUIRED')
    need(value.get('funnel') is None or type(value.get('funnel')) is dict, 'PAPER_FUNNEL_DIAGNOSTICS_REQUIRED')
    timing = value.get('timing', {})
    need(type(timing) is dict and all(timing.get(k) is None or integer(timing[k]) for k in ['firstCompletedProtectionAt', 'lastCompletedProtectionAt']), 'PAPER_PROTECTION_TIMING_REQUIRED')
    if management:
        need(value.get('entriesEnabled') is False, 'MANAGEMENT_ONLY_CANNOT_ENABLE_ENTRIES')
    return value


def transition(final_source, settlement, source_group_settled):
    """Unknown is not flat. No new writer can precede actual group settlement."""
    if not source_group_settled:
        return {'action': 'blocked', 'reason': 'previous-physical-process-group-unsettled', 'flatVerified': False}
    if final_source is not None and final_source['running'] is False and type(settlement) is dict and settlement.get('physicalSettlementConfirmed') is True and integer(settlement.get('positions')) and integer(settlement.get('pending')) and settlement.get('positions') == len(final_source['positions']) and settlement.get('pending') == len(final_source['pending']):
        if not final_source['positions'] and not final_source['pending']:
            return {'action': 'complete', 'reason': 'fresh-stopped-source-and-settlement-flat', 'flatVerified': True}
        return {'action': 'management-only', 'reason': 'verified-retained-financial-obligations', 'flatVerified': False}
    return {'action': 'management-only', 'reason': 'financial-flatness-unverified-after-source-settlement', 'flatVerified': False}


def protection_runway_stop(source):
    if source is None or not (source['positions'] or source['pending']):
        return None
    usage = source.get('usage')
    rpc = usage.get('rpc') if type(usage) is dict else None
    reserve = usage.get('managementReserve') if type(usage) is dict else None
    if type(rpc) is not dict or type(reserve) is not dict or not integer(reserve.get('remainingChapters')) or not all(integer(rpc.get(k)) for k in ['maximumNewUnits', 'newUnits', 'maximumNewResponseBytes', 'newAccountedResponseBytes']):
        return 'PROTECTION_RPC_RUNWAY_UNKNOWN'
    if reserve['remainingChapters'] <= 4:
        return 'PROTECTION_CHAPTER_RUNWAY_RECOVERY'
    if rpc['maximumNewUnits']-rpc['newUnits'] <= 4:
        return 'PROTECTION_REQUEST_RUNWAY_RECOVERY'
    if rpc['maximumNewResponseBytes']-rpc['newAccountedResponseBytes'] <= 4*MIB:
        return 'PROTECTION_RESPONSE_RUNWAY_RECOVERY'
    return None


def source_args(node, release, management):
    args = [node, '--max-old-space-size=192', str(release/'native-paper.mjs'), '--resume', '--directory', str(ACCOUNT), '--input', str(ACCOUNT/'input.json'), '--paper-contract', CONTRACT, '--stage', 'single', '--deep-slots', '1' if management else '3', '--duration-seconds', '1800']
    if management:
        args.append('--management-only')
    return args


def launch(args, log, cpu_soft, cpu_hard, file_mib, env=None):
    parent = os.getpid()
    def guard():
        if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL) != 0 or os.getppid() != parent:
            os._exit(1)
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_soft, cpu_hard))
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_mib*MIB, file_mib*MIB))
        resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.nice(19)
    handle = log.open('xb')
    try:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT, env=env or {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'TZ': 'UTC'}, start_new_session=True, preexec_fn=guard)
    finally:
        handle.close()
    log.chmod(0o600)
    return process


def process_cpu(pid):
    try:
        values = pathlib.Path('/proc', str(pid), 'stat').read_text().rsplit(')', 1)[1].split()
        return (int(values[11]) + int(values[12])) / os.sysconf('SC_CLK_TCK')
    except FileNotFoundError:
        return 0


def available_memory():
    return next(int(row.split()[1])*1024 for row in pathlib.Path('/proc/meminfo').read_text().splitlines() if row.startswith('MemAvailable:'))


def self_rss():
    return int(pathlib.Path('/proc/self/statm').read_text().split()[1])*os.sysconf('SC_PAGE_SIZE')


def load_reviewed_helpers(expected):
    body = regular(SELECTOR, 65536, private=False)
    need(digest(body) == expected, 'NODE_PROCESS_HELPER_HASH_MISMATCH')
    spec = importlib.util.spec_from_file_location('poe_reviewed_native_helpers', SELECTOR)
    module = importlib.util.module_from_spec(spec)
    exec(compile(body, str(SELECTOR), 'exec'), module.__dict__)
    return module


def publisher_args(node, publisher_root):
    return ['/bin/bash', str(publisher_root/'run-publisher.sh'), '--node', node, '--status-file', str(ACCOUNT/'status.json'), '--secret-file', str(SECRET), '--account-id', ACCOUNT_ID, '--inception-at', str(INCEPTION)]


def publish_once(node, publisher_root, root, final_source, helpers, ordinal):
    if final_source is None or final_source['running'] is not False:
        return False
    p = launch(publisher_args(node, publisher_root) + ['--once'], root/('publisher-final-'+str(ordinal)+'.log'), 5, 6, 1)
    try:
        p.wait(timeout=LIMITS['finalPublishSeconds'])
    except subprocess.TimeoutExpired:
        pass
    settled = helpers.terminate(p, grace=1)
    return settled and helpers.accepted_ack(root/('publisher-final-'+str(ordinal)+'.log'), {'accountId': ACCOUNT_ID, 'inceptionAt': INCEPTION}, final_source['generatedAt'], False) is not None


def accepted_source_at(logs, source, helpers, now):
    """Only accepted current-run source time counts; heartbeat receipt cannot freshen it."""
    if source is None:
        return None
    candidates = []
    for log in logs:
        try:
            rows = helpers.publisher_acks(log, {'accountId': ACCOUNT_ID, 'inceptionAt': INCEPTION})
        except (OSError, ValueError, RuntimeError, TypeError, AttributeError):
            continue
        for row in rows:
            at = row.get('sourceAt')
            if row.get('runId') == source['runId'] and integer(at) and source['startedAt'] <= at <= source['generatedAt'] and at <= now and now-at <= 90000:
                candidates.append(at)
    return max(candidates) if candidates else None


class AcceptedSourceWitness:
    """Bounded private evidence cache, never a trading/financial prerequisite.

    Retain exact first two and latest two accepted source byte strings. A
    receipt without its captured raw source remains explicitly unmatched.
    Latest slots rotate; first slots and original publisher logs do not.
    """
    def __init__(self, root):
        self.root, self.recent, self.rows, self.seen = root, {}, {}, set()
        self.accepted, self.unmatched, self.disabled = 0, 0, None

    def observe(self, raw, value):
        if self.disabled is not None:
            return
        key = (value['runId'], value['generatedAt'])
        if key not in self.recent:
            self.recent[key] = raw
            while len(self.recent) > 4:
                del self.recent[next(iter(self.recent))]

    def atomic(self, name, raw):
        target = self.root/name
        temporary = self.root/('.'+name+'.tmp')
        fd = os.open(temporary, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
        try:
            at = 0
            while at < len(raw):
                at += os.write(fd, raw[at:])
            os.fsync(fd)
        finally:
            os.close(fd)
        os.replace(temporary, target)

    def collect(self, logs, helpers):
        if self.disabled is not None:
            return
        try:
            for log in logs:
                for ack in helpers.publisher_acks(log, {'accountId': ACCOUNT_ID, 'inceptionAt': INCEPTION}):
                    key = (ack.get('runId'), ack.get('sourceAt'))
                    if key in self.seen:
                        continue
                    self.seen.add(key)
                    need(len(self.seen) <= 1024, 'ACCEPTED_SOURCE_WITNESS_RECEIPT_BOUND')
                    raw = self.recent.get(key)
                    if raw is None:
                        self.unmatched += 1
                        continue
                    value = json.loads(raw)
                    need(value['accountId'] == ACCOUNT_ID and value['inceptionAt'] == INCEPTION and value['running'] is ack.get('running'), 'ACCEPTED_SOURCE_WITNESS_MISMATCH')
                    # Four exact4MiB sources are possible, but never exceed the
                    # shared32MiB supervisor evidence ceiling to retain them.
                    actual = sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file())
                    need(actual+2*len(raw)+256*1024 <= LIMITS['supervisorEvidenceMiB']*MIB, 'ACCEPTED_SOURCE_WITNESS_STORAGE_PRESSURE')
                    self.accepted += 1
                    names = ['accepted-source-last-'+str((self.accepted-1)%2+1)+'.json']
                    if self.accepted <= 2:
                        names.append('accepted-source-first-'+str(self.accepted)+'.json')
                    for name in names:
                        if name.startswith('accepted-source-first-'):
                            need(not (self.root/name).exists(), 'IMMUTABLE_FIRST_SOURCE_WITNESS_EXISTS')
                        self.atomic(name, raw)
                        self.rows[name] = {'file': name, 'runId': key[0], 'sourceAt': key[1], 'sourceBytes': len(raw), 'sourceSha256': digest(raw), 'publisherAcknowledgement': ack}
                    receipt = {'schemaVersion': 1, 'kind': 'poe-exact-accepted-source-witness-v1', 'acceptedDistinctSources': self.accepted, 'unmatchedAcknowledgements': self.unmatched, 'rows': list(self.rows.values()), 'meaning': 'Exact private source bytes matched by account/run/sourceAt/running to publisher ACK; no reconstructed or backdated snapshots.'}
                    body = (json.dumps(receipt, separators=(',', ':'))+'\n').encode()
                    need(len(body) <= 128*1024, 'ACCEPTED_SOURCE_WITNESS_RECEIPT_BYTES')
                    self.atomic('accepted-source-witness.json', body)
        except Exception as error:
            self.disabled = str(error) if isinstance(error, Guard) else 'ACCEPTED_SOURCE_WITNESS_CAPTURE_UNAVAILABLE'

    def summary(self):
        return {'acceptedDistinctSources': self.accepted, 'unmatchedAcknowledgements': self.unmatched, 'disabledReason': self.disabled, 'retainedSourceFiles': len(self.rows), 'sourceInformationReconstructed': False}


def suspend_admissions(account, source, last_accepted_at, now, reason='reporting-unavailable-for90s'):
    marker = account/'admission-suspension.request'
    value = {'schemaVersion': 1, 'kind': 'native-paper-admission-suspension-v1',
             'reason': reason, 'createdAt': now,
             'sourceRunId': source.get('runId') if source else None,
             'lastAcceptedSourceAt': last_accepted_at,
             'financialStateChangedBySupervisor': False}
    try:
        save(marker, value)
    except FileExistsError:
        # Preserve any existing safety request; never clear/replace it here.
        st = marker.lstat()
        need(stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o077 and st.st_nlink == 1, 'EXISTING_ADMISSION_SUSPENSION_INVALID')
        return False
    fd = os.open(account, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return True


def supervise_segment(node, release, publisher_root, root, manifest, helpers, management, ordinal, outer_deadline, stop_requested, publisher_state=None, prior_protection_at=None):
    need(time.monotonic() + LIMITS['segmentSeconds'] + 60 < outer_deadline, 'SEGMENT_SHUTDOWN_RESERVE_UNAVAILABLE')
    began = time.monotonic()
    wall = int(time.time()*1000)
    if publisher_state is None:
        publisher_state = {'process': None, 'logs': [], 'restarts': 0, 'started': False}
    witness = publisher_state.setdefault('witness', AcceptedSourceWitness(root))
    source = None
    publisher = publisher_state['process']
    final_source = None
    final_raw = None
    source_valid = False
    publisher_restarts = publisher_state['restarts']
    publisher_started = publisher_state['started']
    last_read = 0
    last_valid_read = began
    last_accepted_source = None
    publisher_logs = publisher_state['logs']
    first_recovery_completed_at = None
    maximum_source_rss = maximum_publisher_rss = maximum_parent_rss = 0
    reason = None
    result = {'ordinal': ordinal, 'managementOnly': management, 'startedAt': wall, 'previousSourceGroupSettledBeforeStart': True}
    try:
        source = launch(source_args(node, release, management), root/('source-'+str(ordinal)+'.log'), 240, 245, 40)
        while source.poll() is None:
            at = time.monotonic()
            source_rss = helpers.group_rss(source.pid)
            maximum_source_rss = max(maximum_source_rss, source_rss)
            parent_rss = self_rss()
            maximum_parent_rss = max(maximum_parent_rss, parent_rss)
            cpu_used = process_cpu(source.pid)
            disk_free = shutil.disk_usage(ACCOUNT).free
            memory_free = available_memory()
            log_bytes = (root/('source-'+str(ordinal)+'.log')).stat().st_size
            failures = [
                ('SUPERVISOR_CANCELLATION', stop_requested()),
                ('SOURCE_GROUP_RSS_BOUND', source_rss > 512*MIB),
                ('PARENT_RSS_BOUND', parent_rss > 128*MIB),
                ('SOURCE_EARLY_CPU_STOP', cpu_used >= 220),
                ('HOST_DISK_LOW_WATER', disk_free < 128*MIB),
                ('HOST_MEMORY_LOW_WATER', memory_free < 256*MIB),
                ('SOURCE_STDOUT_BOUND', log_bytes > 8*MIB),
                ('SOURCE_SEGMENT_DEADLINE', at-began >= LIMITS['segmentSeconds'] + 5),
                ('OUTER_SHUTDOWN_RESERVE', at >= outer_deadline - 45),
            ]
            triggered = [name for name, failed in failures if failed]
            if triggered:
                reason = triggered[0]
                result['boundedStopEvidence'] = {'causes': triggered, 'sourceRssBytes': source_rss, 'parentRssBytes': parent_rss, 'sourceCpuSeconds': cpu_used, 'availableDiskBytes': disk_free, 'availableMemoryBytes': memory_free, 'sourceStdoutBytes': log_bytes, 'elapsedSeconds': at-began}
                break
            if at-last_read >= 1:
                last_read = at
                try:
                    source_raw = regular(ACCOUNT/'status.json', 4*MIB)
                    s = validate_source(json.loads(source_raw), manifest, management, wall, int(time.time()*1000), source.pid)
                    witness.observe(source_raw, s)
                    source_valid = True
                    last_valid_read = at
                    final_source = s
                    runway_reason = protection_runway_stop(s)
                    if runway_reason:
                        reason = runway_reason
                        result['managementReserveAtRecovery'] = (s.get('usage') or {}).get('managementReserve')
                        break
                    completed_at = (s.get('timing') or {}).get('firstCompletedProtectionAt')
                    if management and first_recovery_completed_at is None and integer(completed_at) and completed_at >= wall:
                        first_recovery_completed_at = completed_at
                except (OSError, Guard, ValueError):
                    if (not source_valid and at-began >= LIMITS['initialStatusSeconds']) or (source_valid and at-last_valid_read >= LIMITS['statusStaleSeconds']):
                        reason = 'source-status-unavailable-stale-or-mismatched'
                        break
                if source_valid and (publisher is None or publisher.poll() is not None):
                    if publisher_started:
                        if publisher_restarts >= LIMITS['publisherMaximumRestarts']:
                            # Reporting cannot become a financial stop. Keep the
                            # source and make this visible in the final outcome.
                            result['publisherUnavailableAfterBoundedRestarts'] = True
                        else:
                            publisher_restarts += 1
                    if not publisher_started or publisher_restarts < LIMITS['publisherMaximumRestarts'] + 1 and not result.get('publisherUnavailableAfterBoundedRestarts'):
                        log = root/('publisher-'+str(ordinal)+'-'+str(publisher_restarts)+'.log')
                        publisher = launch(publisher_args(node, publisher_root) + ['--watch'], log, 30, 35, 1)
                        publisher_logs.append(log)
                        publisher_started = True
                        publisher_state.update({'process': publisher, 'restarts': publisher_restarts, 'started': True})
                if publisher is not None and publisher.poll() is None:
                    current_publisher_rss = helpers.group_rss(publisher.pid)
                    maximum_publisher_rss = max(maximum_publisher_rss, current_publisher_rss)
                    if current_publisher_rss > 128*MIB:
                        helpers.terminate(publisher, grace=1)
                        result['publisherResourceFailure'] = True
                accepted_now = accepted_source_at(publisher_logs, final_source, helpers, int(time.time()*1000))
                witness.collect(publisher_logs, helpers)
                if accepted_now is not None:
                    last_accepted_source = max(last_accepted_source or accepted_now, accepted_now)
                reporting_now = int(time.time()*1000)
                startup_unverified = last_accepted_source is None and reporting_now-wall >= LIMITS['initialReportingSeconds']*1000
                source_stale = last_accepted_source is not None and reporting_now-last_accepted_source >= 90000
                if not management and (startup_unverified or source_stale):
                    created = suspend_admissions(ACCOUNT, final_source, last_accepted_source, reporting_now, 'reporting-startup-unverified-before-qualification' if startup_unverified else 'reporting-unavailable-for90s')
                    result['admissionSuspendedForReporting'] = True
                    result['admissionSuspensionCreated'] = result.get('admissionSuspensionCreated', False) or created
            time.sleep(0.25)
    except Exception as error:
        reason = str(error) if isinstance(error, Guard) else 'bounded-source-supervision-failed'
    finally:
        group_settled = helpers.terminate(source, grace=LIMITS['gracefulStopSeconds'])
        # Keep the independent publisher alive while the next financial
        # manager starts. Render ACK/drain must never delay exposure recovery.
        publisher_settled = None
        try:
            final_raw = regular(ACCOUNT/'status.json', 4*MIB) if source is not None else None
            final_source = validate_source(json.loads(final_raw), manifest, management, wall, int(time.time()*1000), source.pid) if final_raw is not None else None
            if final_source is not None:
                witness.observe(final_raw, final_source)
                witness.collect(publisher_logs, helpers)
        except (OSError, Guard, ValueError):
            final_source = None
        settlement = None
        if final_source is not None:
            try:
                settlement = json.loads(regular(ACCOUNT/'runs'/final_source['runId']/'settlement.json', 16384))
            except (OSError, Guard, ValueError):
                pass
        decision = transition(final_source, settlement, group_settled)
        accepted = None  # Final publication is caller-owned after the last segment.
        source_span = final_source['generatedAt']-final_source['startedAt'] if final_source else None
        initial_target_reached = not management and source_span is not None and source_span >= (LIMITS['segmentSeconds']-5)*1000 and source is not None and source.returncode == 0 and reason is None and final_source.get('status') == 'bounded interval completed; monitoring interruption checkpointed'
        result.update({'sourceSpanMs': source_span, 'initialTargetReached': initial_target_reached, 'sourceStopReason': final_source.get('status') if final_source else None, 'stoppedAt': int(time.time()*1000), 'elapsedSeconds': time.monotonic()-began, 'sourceExit': source.returncode if source is not None else None, 'sourcePid': source.pid if source is not None else None, 'sourceGroupSettled': group_settled, 'publisherGroupSettled': publisher_settled, 'publisherKeptAcrossFinancialTransition': publisher is not None and publisher.poll() is None, 'reason': reason, 'transition': decision, 'sourceRunId': final_source.get('runId') if final_source else None, 'lastSourceAt': final_source.get('generatedAt') if final_source else None, 'positions': len(final_source['positions']) if final_source else None, 'pending': len(final_source['pending']) if final_source else None, 'finalStoppedReportAccepted': accepted, 'finalStatusSha256': digest(final_raw) if final_source is not None and final_raw is not None else None, 'privateStatusPath': str(ACCOUNT/'status.json'), 'funnelCounters': {key: (final_source.get('funnel') or {}).get(key) for key in ['discovered', 'evaluated', 'qualified', 'reserved', 'attempted', 'paperFilled', 'exited', 'reconciled', 'usableWindows']} if final_source else None, 'protectionTiming': {key: (final_source.get('timing') or {}).get(key) for key in ['firstCompletedProtectionAt', 'lastCompletedProtectionAt', 'maximumCompletedGapMs', 'maximumQuoteAgeAtUseMs', 'protectionBreaches', 'unavailableChecks']} if final_source else None, 'publisherRestarts': publisher_restarts, 'lastAcceptedSourceAt': last_accepted_source, 'maximumSourceGroupRssBytes': maximum_source_rss, 'maximumPublisherGroupRssBytes': maximum_publisher_rss, 'maximumParentRssBytes': maximum_parent_rss, 'financialDatabaseReadBySupervisor': False, 'financialHistoryRewritten': False, 'lastCompletedProtectionAt': (final_source.get('timing') or {}).get('lastCompletedProtectionAt') if final_source else None, 'priorCompletedProtectionAt': prior_protection_at, 'firstRecoveryCompletedProtectionAt': first_recovery_completed_at, 'crossSegmentProtectionGapMs': first_recovery_completed_at-prior_protection_at if integer(first_recovery_completed_at) and integer(prior_protection_at) and first_recovery_completed_at>=prior_protection_at else None})
        result['acceptedSourceWitness'] = witness.summary()
        save(root/('segment-'+str(ordinal)+'.json'), result)
    return result


def main():
    need(len(sys.argv) == 1 and os.getuid() == UID and pwd.getpwuid(UID).pw_name == 'mm-ec2-runner' and os.environ.get('ACTUAL_RUNNER') == 'meme-machine-ec2-admin', 'FIXED_NONROOT_RUNNER_REQUIRED')
    os.umask(0o077)
    stopping = False
    def cancelled(_signal, _frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    signal.signal(signal.SIGXCPU, cancelled)
    raw = regular(PACKAGE, 128*1024, private=False)
    manifest = validate_manifest(raw, os.environ.get('EXPECTED_RUN_PACKAGE_SHA256'))
    helpers = load_reviewed_helpers(manifest['nodeSelectorSha256'])
    private_directory(ROOT)
    private_directory(ACCOUNT)
    release = ROOT/'releases'/manifest['source']['sha256']
    private_directory(release)
    need(digest(regular(release/'native-paper.mjs', 8*MIB)) == manifest['source']['sha256'], 'IMMUTABLE_NATIVE_PAPER_EXECUTABLE_REQUIRED')
    public_input = json.loads(regular(ACCOUNT/'input.json', 8*MIB))
    binding = public_input.get('reportingBinding') if type(public_input) is dict else None
    need(type(public_input) is dict and public_input.get('source') == manifest['source'] and type(binding) is dict and binding.get('accountId') == ACCOUNT_ID and binding.get('inceptionAt') == INCEPTION, 'IMPORTED_PAPER_INPUT_IDENTITY_REQUIRED')
    memory = available_memory()
    need(memory >= MIB*LIMITS['minimumAvailableRamMiB'] and shutil.disk_usage(ACCOUNT).free >= MIB*LIMITS['minimumDiskMiB'], 'HOST_INITIAL_HEADROOM_REQUIRED')
    node, node_version = helpers.existing_node(pathlib.Path(os.environ['RUNNER_TEMP']).resolve(strict=True))
    supervision = ROOT/'supervision'
    if not supervision.exists():
        supervision.mkdir(mode=0o700)
    private_directory(supervision)
    operation = os.environ.get('GITHUB_RUN_ID', '')+'-'+os.environ.get('GITHUB_RUN_ATTEMPT', '')
    need(all(x.isdigit() and 1 <= len(x) <= 24 for x in operation.split('-')) and operation.count('-') == 1, 'FIXED_OPERATION_ID_REQUIRED')
    root = supervision/('poe-native-paper-'+operation)
    root.mkdir(mode=0o700)
    reporting = root/'reporting'
    reporting.mkdir(mode=0o700)
    for row in manifest['publisher']:
        body = regular(PUBLISHER/row['path'], PUBLISHER_FILES[row['path']], private=False)
        need(len(body) == row['bytes'] and digest(body) == row['sha256'], 'FROZEN_PUBLISHER_HASH_REQUIRED')
        target = reporting/row['path']
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(target, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, body)
            os.fsync(fd)
        finally:
            os.close(fd)
    host = helpers.identity()
    before = helpers.observer()
    save(root/'before.json', before)
    save(root/'package.json', manifest)
    outer = time.monotonic()+LIMITS['outerSeconds']
    segments = []
    publisher_state = {'process': None, 'logs': [], 'restarts': 0, 'started': False}
    prior_protection_at = None
    supervision_failure = None
    try:
        for ordinal in range(2):
            if stopping:
                break
            if ordinal:
                memory = available_memory()
                need(memory >= 512*MIB and shutil.disk_usage(ACCOUNT).free >= 256*MIB, 'HOST_MANAGEMENT_RECOVERY_HEADROOM_REQUIRED')
            result = supervise_segment(node, release, reporting, root, manifest, helpers, ordinal == 1, ordinal, outer, lambda: stopping, publisher_state, prior_protection_at)
            segments.append(result)
            prior_protection_at = result.get('lastCompletedProtectionAt')
            if result['transition']['action'] != 'management-only':
                break
    except Exception as error:
        supervision_failure = str(error) if isinstance(error, Guard) else 'SUPERVISION_INTERRUPTED_BEFORE_COMPLETION'
    final = segments[-1] if segments else None
    publisher_settled = helpers.terminate(publisher_state['process'], grace=2)
    final_source = None
    final_accepted = False
    if final and final['sourceGroupSettled'] and publisher_settled:
        try:
            final_source = validate_source(json.loads(regular(ACCOUNT/'status.json', 4*MIB)), manifest, final['managementOnly'], final['startedAt'], int(time.time()*1000), final['sourcePid'])
            final_accepted = publish_once(node, reporting, root, final_source, helpers, len(segments))
            witness = publisher_state.get('witness')
            if witness is not None:
                witness.observe(regular(ACCOUNT/'status.json', 4*MIB), final_source)
                witness.collect(publisher_state['logs']+[root/('publisher-final-'+str(len(segments))+'.log')], helpers)
        except Exception:
            pass
    try:
        after = helpers.observer()
    except Exception:
        after = None
    unchanged = after is not None and all(before['service'][k] == after['service'][k] for k in ['MainPID', 'NRestarts', 'User']) and all(before['publicStatus'][k] == after['publicStatus'][k] for k in ['accountId', 'inceptionAt', 'release'])
    save(root/'after.json', {**(after or {}), 'originalIdentityPidRestartsUnchanged': unchanged, 'checked': after is not None})
    complete = supervision_failure is None and bool(segments and segments[0]['initialTargetReached']) and final is not None and final['transition']['flatVerified'] and final_accepted and publisher_settled and unchanged
    outcome = {'schemaVersion': 1, 'kind': 'POE_NATIVE_PAPER_BOUNDED_SUPERVISION', 'source': manifest['source'], 'packageSha256': digest(raw), 'accountId': ACCOUNT_ID, 'inceptionAt': INCEPTION, 'nodeVersion': node_version, 'host': host, 'metadataReads': 2, 'segments': segments, 'supervisionFailure': supervision_failure, 'flatVerifiedAtEnd': bool(final and final['transition']['flatVerified']), 'publisherGroupSettled': publisher_settled, 'finalStoppedReportAccepted': final_accepted, 'operationalAcceptance': False, 'continuous24HourOperation': False, 'originalObserverIdentityPidRestartsUnchanged': unchanged, 'financialDatabaseReadBySupervisor': False, 'realTradingEnabled': False, 'newServicePurchase': False, 'costMeaning': 'Existing compute, transfer and storage allowances/cost are unverified; no new purchase.', 'result': 'bounded-flat-and-reporting-complete' if complete else 'interrupted-or-unresolved; inspect retained financial state and supervision evidence'}
    save(root/'supervisor.json', outcome)
    print(json.dumps(outcome, separators=(',', ':')), flush=True)
    if not complete:
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Guard as error:
        print(json.dumps({'kind': 'POE_NATIVE_PAPER_SUPERVISION_REFUSED', 'reason': str(error), 'financialDatabaseReadBySupervisor': False, 'financialStateDeleted': False, 'realTradingEnabled': False}), flush=True)
        raise SystemExit(1)
