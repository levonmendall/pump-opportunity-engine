#!/usr/bin/env python3
"""Reviewed finite nonroot candidate research job; no service-control or ledger API.

Input/package hashes are supplied by the reviewed workflow. This supervisor does
not read the reporting credential: only the separately reviewed publisher does.
"""
import argparse
import errno
import gzip
import hashlib
import io
import json
import os
import pathlib
import pwd
import resource
import shutil
import signal
import stat
import subprocess
import tarfile
import time
import urllib.request

MIB = 1024 * 1024
OUTER_SECONDS = 1020
OBSERVATION_SECONDS = 900
FINAL_REPORT_SECONDS = 45
TWO_HOUR_PROFILE = "candidate-native-two-hour-research-v1"
DEFAULT_OBSERVATION_POLICY = "observation-age-v1"
STUDY_OBSERVATION_POLICY = "observation-age-selected-24h-study-v1"
DEFAULT_HOST_LIMITS = {"durationSeconds": 900, "outerSeconds": 1020, "finalPublisherDrainSeconds": 45, "runnerTimeoutSeconds": 915, "workflowTimeoutMinutes": 20, "candidateSlots": 6, "heapMiB": 256, "runnerRssMiB": 384, "runnerCpuSeconds": 240, "publisherCpuSeconds": 15, "archiveCpuSeconds": 30, "archiveRssMiB": 256, "temporaryMiB": 256, "artifactMiB": 192, "compressedArchiveMiB": 32, "evidenceMiB": 128, "evidenceSegmentMiB": 8, "minimumAvailableRamMiB": 1024, "minimumAvailableDiskMiB": 1024, "minimumOngoingDiskMiB": 256, "maximumBaselinePaths": 224, "maximumComponentBookBytes": 512 * 1024, "maximumBaselineBytes": 32 * MIB, "maximumRpcMetadataBytes": 256 * 1024, "maximumChapters": 32, "maximumPackageMiB": 48, "maximumUnits": 1500}
TWO_HOUR_HOST_LIMITS = {**DEFAULT_HOST_LIMITS, "durationSeconds": 7200, "outerSeconds": 7320, "runnerTimeoutSeconds": 7215, "workflowTimeoutMinutes": 125, "runnerCpuSeconds": 1920, "publisherCpuSeconds": 120, "archiveCpuSeconds": 120, "temporaryMiB": 1536, "artifactMiB": 1280, "compressedArchiveMiB": 256, "evidenceMiB": 1024, "minimumAvailableDiskMiB": 2048, "maximumBaselinePaths": 192, "maximumRpcMetadataBytes": 2 * MIB, "maximumChapters": 64, "maximumUnits": 7500}
INSTANCE = ("133857166104", "us-west-2", "i-00044d4ea1471b957")
SECRET = pathlib.Path("/home/mm-ec2-runner/.local/share/poe-reporting/pilot-ingest.secret")
PUBLIC = pathlib.Path("/var/lib/poe-public/status.json")
SERVICE_FIELDS = ["MainPID", "NRestarts", "ActiveState", "SubState", "User"]
PUBLIC_FIELDS = ["project", "mode", "liveTrading", "accountId", "inceptionAt", "release", "strategy", "generatedAt", "lastUsefulProgressAt", "lastReconciledAt", "feedConnected", "entriesDisabled"]


class SupervisorGuardError(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise SupervisorGuardError(reason)


def host_profile(name=None):
    require(name in [None, TWO_HOUR_PROFILE], "UNKNOWN_HOST_RESEARCH_PROFILE")
    return dict(TWO_HOUR_HOST_LIMITS if name == TWO_HOUR_PROFILE else DEFAULT_HOST_LIMITS)


def observation_policy(version=None):
    require(version in [None, DEFAULT_OBSERVATION_POLICY, STUDY_OBSERVATION_POLICY], "UNKNOWN_OBSERVATION_POLICY")
    return version or DEFAULT_OBSERVATION_POLICY


def data_contract(version=None):
    require(version in [None, "confirmed-program-events-v2", "confirmed-program-activity-v3-shadow"], "UNKNOWN_DATA_CONTRACT")
    return version or "confirmed-program-events-v2"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_exception(error, phase):
    """Diagnostic identity only: never disclose private paths or raw messages."""
    message = str(error)
    number = getattr(error, "errno", None)
    number = number if type(number) is int and 0 <= number <= 4095 else None
    code = message if isinstance(error, SupervisorGuardError) and len(message) <= 160 and message.replace("_", "").isalnum() else "SUPERVISOR_FAILURE"
    return {"code": code, "type": type(error).__name__[:80], "errno": number, "errnoName": errno.errorcode.get(number), "phase": phase, "messageSha256": digest(message.encode("utf8", errors="replace"))}


def regular(path, maximum, owner=None, private=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 <= s.st_size <= maximum, "BOUNDED_REGULAR_FILE_REQUIRED")
        require(owner is None or s.st_uid == owner, "UNEXPECTED_FILE_OWNER")
        require(not private or not stat.S_IMODE(s.st_mode) & 0o077, "PRIVATE_FILE_REQUIRED")
        data = bytearray()
        while len(data) <= s.st_size:
            chunk = os.read(fd, min(65536, s.st_size + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = os.fstat(fd)
        require(len(data) == s.st_size and (after.st_size, after.st_mtime_ns, after.st_ctime_ns) == (s.st_size, s.st_mtime_ns, s.st_ctime_ns), "PUBLIC_FILE_CHANGED_DURING_READ")
        return bytes(data)
    finally:
        os.close(fd)


def save(path, value):
    body = (json.dumps(value, separators=(",", ":")) + "\n").encode()
    require(len(body) <= 8 * MIB, "SUPERVISOR_RECEIPT_TOO_LARGE")
    with path.open("xb") as f:
        f.write(body)
    path.chmod(0o600)


def observer():
    r = subprocess.run(["/usr/bin/systemctl", "show", "poe-runtime.service", "--property=" + ",".join(SERVICE_FIELDS)], capture_output=True, text=True, timeout=5, check=True)
    service = dict(line.split("=", 1) for line in r.stdout.splitlines() if "=" in line)
    require(service.get("ActiveState") == "active" and service.get("SubState") == "running" and service.get("User") == "poe-runtime" and int(service["MainPID"]) > 0, "ORIGINAL_OBSERVER_NOT_ACTIVE")
    data = json.loads(regular(PUBLIC, 4096, pwd.getpwnam("poe-runtime").pw_uid))
    require(stat.S_IMODE(PUBLIC.lstat().st_mode) == 0o644, "ORIGINAL_PUBLIC_STATUS_MODE_CHANGED")
    public = {key: data[key] for key in PUBLIC_FIELDS}
    require(public["project"] == "pump-opportunity-engine" and public["mode"] == "PAPER" and public["liveTrading"] is False and public["entriesDisabled"] is True, "ORIGINAL_OBSERVER_BOUNDARY_CHANGED")
    return {"checkedAt": int(time.time() * 1000), "service": service, "publicStatus": public}


def identity():
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with http.open(urllib.request.Request("http://169.254.169.254/latest/api/token", method="PUT", headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"}), timeout=3) as r:
        token = r.read(4096).decode()
    with http.open(urllib.request.Request("http://169.254.169.254/latest/dynamic/instance-identity/document", headers={"X-aws-ec2-metadata-token": token}), timeout=3) as r:
        data = json.loads(r.read(8192))
    require(tuple(data.get(k) for k in ["accountId", "region", "instanceId"]) == INSTANCE, "UNEXPECTED_EC2_INSTANCE")
    return {k: data[k] for k in ["accountId", "region", "instanceId"]}


def existing_node(temp):
    candidates = [shutil.which("node")] + [str(temp.parent.parent / "externals" / name / "bin/node") for name in ["node24"]]
    for value in candidates:
        if not value:
            continue
        try:
            path = pathlib.Path(value).resolve(strict=True)
            s = path.lstat()
            if not stat.S_ISREG(s.st_mode) or s.st_uid not in [0, 994] or s.st_mode & 0o022 or not os.access(path, os.X_OK):
                continue
            version = subprocess.run([str(path), "--version"], env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=3, check=True).stdout.strip()
            numbers = version.lstrip("v").split(".")
            if int(numbers[0]) == 24 and int(numbers[1]) >= 19:
                return str(path), version
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    raise RuntimeError("EXISTING_RUNNER_NODE24_19_REQUIRED_NO_INSTALL_ATTEMPTED")


def tree_size(root):
    total = 0
    for path in root.rglob("*"):
        try:
            value = path.lstat()
        except FileNotFoundError:
            # Atomic snapshot/counterbook .pending files may be renamed between
            # directory enumeration and stat. This is not a storage failure.
            continue
        if stat.S_ISREG(value.st_mode):
            total += value.st_size
    return total


def group_rss(group):
    total = 0
    for p in pathlib.Path("/proc").iterdir():
        if not p.name.isdigit():
            continue
        try:
            fields = (p / "stat").read_text().rsplit(")", 1)[1].split()
            if int(fields[2]) != group:
                continue
            for line in (p / "status").read_text().splitlines():
                if line.startswith("VmRSS:"):
                    total += int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            pass
    return total


def terminate(process, grace=4):
    if process is None:
        return True
    def live_group():
        members = []
        for p in pathlib.Path("/proc").iterdir():
            if not p.name.isdigit():
                continue
            try:
                fields = (p / "stat").read_text().rsplit(")", 1)[1].split()
                if int(fields[2]) == process.pid and fields[0] != "Z":
                    require(p.stat().st_uid == 994, "UNEXPECTED_PROCESS_GROUP_OWNER")
                    members.append(int(p.name))
            except (OSError, ValueError, IndexError):
                pass
        return members
    if not live_group():
        process.poll()
        return True
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.monotonic() + grace
    while live_group() and time.monotonic() < deadline:
        process.poll()
        time.sleep(0.05)
    if live_group():
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + 2
        while live_group() and time.monotonic() < deadline:
            process.poll()
            time.sleep(0.05)
    process.poll()
    return not live_group()


def launch(args, log, cpu, file_size_mib=8):
    file_size = file_size_mib * MIB
    command = ["/usr/bin/nice", "-n", "10", "/usr/bin/prlimit", f"--cpu={cpu}:{cpu + 5}", "--nofile=128:128", f"--fsize={file_size}:{file_size}", "--core=0:0", "--"] + args
    handle = log.open("xb")
    log.chmod(0o600)
    p = subprocess.Popen(command, env={"PATH": "/usr/bin:/bin"}, stdin=subprocess.DEVNULL, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
    handle.close()
    return p


def publisher_acks(log, binding):
    if not log.exists():
        return []
    data = regular(log, 8 * MIB, 994, True)
    accepted = []
    for line in data.splitlines():
        if len(line) > 8192:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("published") is True and row.get("result") in ["accepted", "duplicate"] and row.get("accountId") == binding["accountId"] and type(row.get("sourceAt")) is int and type(row.get("sourceAgeMs")) is int and row["sourceAgeMs"] >= 0:
            accepted.append(row)
    return accepted


def accepted_ack(log, binding, source_at=None, running=None):
    return next((row for row in reversed(publisher_acks(log, binding)) if (source_at is None or row["sourceAt"] == source_at) and (running is None or row.get("running") is running)), None)


def reporting_summary(acks, started_at, stopped_at):
    running = [row for row in acks if row.get("running") is True]
    distinct = sorted({row["sourceAt"] for row in running})
    # The reviewed publisher computes sourceAgeMs after reading the ACK. This
    # reconstructs its local acknowledgement time, not a Render receipt time.
    acknowledged = sorted(row["sourceAt"] + row["sourceAgeMs"] for row in running)
    gaps = [b - a for a, b in zip([started_at] + acknowledged, acknowledged + [stopped_at]) if b >= a]
    ages = [row["sourceAgeMs"] for row in running]
    maximum_gap = max(gaps) if gaps else max(0, stopped_at - started_at)
    return {"runningAcknowledgements": len(running), "distinctRunningSourceTimestamps": len(distinct), "firstAcceptedSourceAt": distinct[0] if distinct else None, "lastAcceptedSourceAt": distinct[-1] if distinct else None, "maximumObservedAcknowledgementGapMs": maximum_gap, "maximumAcknowledgedSourceAgeMs": max(ages) if ages else None, "targetCadenceMs": 15000, "staleBoundaryMs": 90000, "continuityVerifiedForInterval": len(distinct) >= 2 and maximum_gap <= 90000 and max(ages) <= 90000, "timingMeaning": "Publisher local acknowledgement times reconstructed from sourceAt+sourceAgeMs; not independent Render receipt timestamps."}


def runtime_outcome(source, planned_duration_ms=OBSERVATION_SECONDS * 1000):
    """Classify source lifecycle independently of process exit or receiver ACKs.

    A complete quiet interval is a mechanical result. It is not an audited
    market window, opportunity-recognition proof or acceptance result.
    """
    engine = (source or {}).get("engine") or {}
    counters = engine.get("counters") or {}
    stop_reason = (source or {}).get("stopReason")
    fatal = (engine.get("rpc") or ((source or {}).get("usage") or {}).get("rpc") or {}).get("fatal")
    started_at = (source or {}).get("startedAt")
    generated_at = (source or {}).get("generatedAt")
    elapsed = (source or {}).get("elapsedMs")
    stopped_at = (source or {}).get("stopRequestedAt")
    reported_cutoff = (source or {}).get("logicalObservationCutoffAt")
    reserve = 10000
    expected_cutoff = started_at + planned_duration_ms - reserve if type(started_at) is int else None
    wall_span = generated_at - started_at if type(started_at) is int and type(generated_at) is int and generated_at >= started_at else None
    # The source captures generatedAt before its elapsedMs field. An elapsed
    # value below that wall span is inconsistent, not a way to hide an overrun.
    timing_valid = all(type(x) is int and x >= 0 for x in [started_at, generated_at, elapsed, reported_cutoff]) and wall_span is not None and elapsed >= wall_span and (stopped_at is None or type(stopped_at) is int and started_at <= stopped_at <= generated_at)
    reached_cutoff = timing_valid and reported_cutoff == expected_cutoff and generated_at >= expected_cutoff and (stopped_at is None or stopped_at >= expected_cutoff)
    normal_reason = stop_reason in ["bounded interval completed", "logical observation cutoff reached; shutdown reserve begins"]
    classification = "unavailable-source-outcome"
    failure = "NATIVE_RESEARCH_SOURCE_OUTCOME_UNAVAILABLE"
    if source and (fatal is not None or stop_reason == "NATIVE_RESEARCH_RPC_FATAL"):
        classification, failure = "fatal-source-stop", "NATIVE_RESEARCH_SOURCE_FATAL_STOP"
    elif source and not timing_valid:
        classification, failure = "invalid-source-timing", "NATIVE_RESEARCH_SOURCE_TIMING_INVALID"
    elif source and source.get("running") is not False:
        classification, failure = "source-not-stopped", "NATIVE_RESEARCH_SOURCE_NOT_STOPPED"
    elif source and (elapsed > planned_duration_ms or wall_span > planned_duration_ms):
        classification, failure = "planned-duration-overrun", "NATIVE_RESEARCH_SOURCE_DURATION_OVERRUN"
    elif source and not normal_reason:
        classification, failure = "interrupted-or-failed-source-stop", "NATIVE_RESEARCH_SOURCE_STOP_NOT_NORMAL"
    elif source and not reached_cutoff:
        classification, failure = "premature-source-stop", "NATIVE_RESEARCH_SOURCE_STOPPED_BEFORE_PLANNED_CUTOFF"
    elif source:
        classification, failure = "mechanically-completed", None
    funnel = (source or {}).get("funnel") or {}
    audited = counters.get("auditedWindows", funnel.get("usableWindows"))
    assessments = counters.get("predictiveAssessments", funnel.get("evaluated"))
    unique = counters.get("uniqueEvaluated")
    return {"classification": classification, "mechanicallyCompleted": classification == "mechanically-completed", "failureReason": failure, "sourceStopReason": stop_reason, "sourceRpcFatalState": fatal, "plannedRunDurationMs": planned_duration_ms, "shutdownReserveMs": reserve, "plannedAdmissionDurationMs": planned_duration_ms - reserve, "actualRunElapsedMs": elapsed, "actualWallSpanMs": wall_span, "logicalObservationCutoffAt": reported_cutoff, "expectedLogicalObservationCutoffAt": expected_cutoff, "stopRequestedAt": stopped_at, "plannedAdmissionCutoffReached": bool(reached_cutoff), "candidateWindowEvidence": {"auditedWindows": audited, "predictiveAssessments": assessments, "uniqueEvaluated": unique, "classification": "audited-window-views-recorded-not-readiness" if type(audited) is int and audited > 0 else "no-audited-window-evidence", "overlappingViewsAreNotIndependentCoverage": True, "mechanicalCompletionIsNotWindowValidation": True}, "reportingMeaning": "Receiver acceptance and physical settlement are evaluated separately; neither makes a fatal or premature source interval successful."}


def capture_accepted_source(root, binding, retained):
    """Retain at most two exact source files matched to distinct running ACKs.

    An old ACK without the actual still-current source bytes is not reconstructed
    from later counters. All snapshots remain reporting-only, not a portfolio.
    """
    if len(retained) >= 2:
        return
    raw = regular(root / "run/status.json", 4 * MIB, 994, True)
    source = json.loads(raw)
    generated_at = source.get("generatedAt")
    require(type(generated_at) is int and source.get("accountId") == binding["accountId"] and source.get("inceptionAt") == binding["inceptionAt"], "REPORTING_SNAPSHOT_SOURCE_BINDING_MISMATCH")
    if source.get("running") is not True or any(row["sourceAt"] == generated_at for row in retained):
        return
    ack = next((row for row in publisher_acks(root / "publisher.log", binding) if row.get("sourceAt") == generated_at and row.get("runId") == source.get("runId") and row.get("running") is True), None)
    if ack is None:
        return
    directory = root / "reporting-evidence"
    directory.mkdir(exist_ok=True, mode=0o700)
    index = len(retained) + 1
    name = "accepted-source-" + str(index).zfill(3) + ".json"
    with (directory / name).open("xb") as out:
        out.write(raw)
    (directory / name).chmod(0o600)
    record = {"sourceAt": generated_at, "runId": source.get("runId"), "accountId": binding["accountId"], "inceptionAt": binding["inceptionAt"], "sourceFile": name, "sourceBytes": len(raw), "sourceSha256": digest(raw), "observedAt": int(time.time() * 1000), "acknowledgement": ack, "meaning": "Exact private status bytes observed while their generatedAt matched an accepted running publisher acknowledgement; no backdated reconstruction."}
    save(directory / ("accepted-source-" + str(index).zfill(3) + "-ack.json"), record)
    retained.append(record)


def supervised_stopped_projection(source, binding, source_sha256, observed_at, receipt_id, reason, groups_settled):
    """Reporting-only stop observation. Never a runtime/financial final receipt.

    Original source bytes stay untouched. Counters and market/source-fact times
    are cloned exactly; generatedAt describes only this supervision observation.
    """
    require(groups_settled is True, "SUPERVISED_STOP_REQUIRES_VERIFIED_PROCESS_GROUP_DEATH")
    require(isinstance(source, dict) and source.get("accountId") == binding["accountId"] and source.get("inceptionAt") == binding["inceptionAt"] and source.get("mode") == "candidate-evaluation" and source.get("experimental") is True and source.get("authoritative") is False, "SUPERVISED_STOP_SOURCE_BINDING")
    require(source.get("financialExecutionAuthorized") is False and source.get("entriesEnabled") is False and source.get("financialWriterOpened") is False and source.get("liveTradingEnabled") is False and source.get("portfolio") is None and source.get("experimentalFinancialPortfolio") is None, "SUPERVISED_STOP_FINANCIAL_SOURCE_DENIED")
    last_generated = source.get("generatedAt")
    require(type(last_generated) is int and type(observed_at) is int and observed_at >= last_generated, "SUPERVISED_STOP_CLOCK")
    require(len(source_sha256) == 64 and len(receipt_id) == 64 and all(c in "0123456789abcdef" for c in source_sha256 + receipt_id), "SUPERVISED_STOP_PROVENANCE")
    reason = reason if isinstance(reason, str) and len(reason) <= 160 and reason.replace("_", "").isalnum() else "SUPERVISOR_SOURCE_FINAL_UNAVAILABLE"
    result = json.loads(json.dumps(source))
    result.update({"running": False, "entriesEnabled": False, "financialExecutionAuthorized": False, "financialWriterOpened": False, "liveTradingEnabled": False, "generatedAt": observed_at, "lastRuntimeGeneratedAt": last_generated, "stopReason": "Supervisor observed process termination; source final checkpoint unavailable: " + reason, "physicalSettlementConfirmed": False, "supervision": {"schemaVersion": 1, "kind": "supervisor-observed-stop", "receiptId": receipt_id, "observedAt": observed_at, "lastRuntimeGeneratedAt": last_generated, "originalStatusSha256": source_sha256, "reason": reason, "ownedProcessGroupsSettled": True, "runtimeGracefulShutdownVerified": False, "applicationTransportAccountingSettled": False, "financialReconciliationVerified": False, "preservesHistoricalMarketFactTimes": True, "nestedRuntimeSnapshotMeaning": "Last runtime snapshot only; nested running/connected facts were not refreshed by the supervisor."}})
    result["status"] = "SUPERVISOR-GENERATED STOPPED; receipt " + receipt_id + "; last runtime " + str(last_generated) + "; reason " + reason[:48] + "; no graceful shutdown/reconciliation claim."
    require(len(result["status"]) <= 256, "SUPERVISED_STOP_LABEL_BOUND")
    require(len((json.dumps(result, separators=(",", ":")) + "\n").encode()) <= 4 * MIB, "SUPERVISED_STOP_PUBLISHER_SIZE_BOUND")
    return result


def export_artifact(root, package_manifest, limits=None):
    """Index ALL retained selected-flow evidence and mandatory summaries/books.

    The default workflow may upload this allowlist. The explicit long profile
    instead retains private durable raw files and creates one lossless bounded
    gzip/tar for targeted public-evidence readback; it uploads no artifact.
    Indexing alone is not verified backup. No segment is silently sampled away.
    """
    limits = limits or host_profile()
    output = root / "export"
    output.mkdir(mode=0o700)
    included, evidence_bytes, total = [], 0, 0
    ordered = sorted(root.rglob("*"), key=lambda p: (p.relative_to(root).as_posix().startswith("run/events/"), p.relative_to(root).as_posix()))
    for p in ordered:
        if not p.is_file() or p.is_symlink() or output in p.parents:
            continue
        name = p.relative_to(root).as_posix()
        allowed = name in ["before.json", "after.json", "supervisor.json", "supervised-status.json", "supervisor-stop-receipt.json", "input.json", "package.json", "runner.log", "publisher.log", "publisher-final.log", "run/status.json", "run/receipt.json", "run/watch-checkpoint.json"] or name.startswith("run/rpc/") and name.endswith(".json") or name.startswith("run/events/") and name.endswith(".ndjson") or name.startswith("reporting-evidence/") and name.endswith(".json")
        if not allowed:
            continue
        size = p.stat().st_size
        require(size <= 8 * MIB, "ARTIFACT_FILE_BOUND")
        row = {"path": name, "bytes": size, "sha256": digest(p.read_bytes())}
        require(not name.startswith("run/events/") or evidence_bytes + size <= limits["evidenceMiB"] * MIB, "EVENT_EVIDENCE_ARTIFACT_CAP")
        require(total + size <= limits["artifactMiB"] * MIB, "COMPLETE_ARTIFACT_CAP")
        included.append(row)
        total += size
        if name.startswith("run/events/"):
            evidence_bytes += size
    extended = limits["durationSeconds"] == 7200
    index = {"schemaVersion": 1, "included": included, "omittedSelectedEvidence": [], "uncompressedSelectedBytes": total, "selectedEvidenceBytes": evidence_bytes, "compressedArchiveBytes": None, "compressedSizeMeaning": "Measured separately by the bounded local archive creator; never inferred from uncompressed bytes.", "packageSha256": package_manifest, "credentialsIncluded": False, "financialFilesIncluded": False, "retention": "No artifact upload. Raw selected evidence remains in the private durable directory until verified download/hash backup; a completed local gzip is not yet verified remote backup." if extended else "Default allowlisted artifact upload remains available. Local archive is separately bounded; RUNNER_TEMP is not durable storage."}
    save(output / "index.json", index)
    require(tree_size(root) <= limits["temporaryMiB"] * MIB, "TEMPORARY_STORAGE_CAP")
    return {"index": str(output / "index.json"), "indexSha256": digest((output / "index.json").read_bytes()), "uncompressedBytes": total, "selectedEvidenceBytes": evidence_bytes, "omittedSegments": 0, "localArchiveCopiesAtIndexing": 0}


def export_failure_manifest(root, error, outcome):
    """Explicitly inventory evidence omitted by the bounded failure fallback."""
    included, omitted = [], []
    fixed = {"before.json", "after.json", "supervisor.json", "supervised-status.json", "supervisor-stop-receipt.json", "run/status.json", "run/receipt.json"}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink() or root / "export" in path.parents:
            continue
        name = path.relative_to(root).as_posix()
        selected = name.startswith("run/events/") and name.endswith(".ndjson")
        fallback = name in fixed or name.startswith("run/rpc/") and name.endswith(".json") or name.startswith("reporting-evidence/") and name.endswith(".json")
        if not selected and not fallback:
            continue
        size = path.stat().st_size
        row = {"path": name, "bytes": size, "sha256": digest(path.read_bytes()) if size <= 8 * MIB else None}
        if row["sha256"] is None:
            row["hashLimitation"] = "File exceeds the declared per-file bound; complete hash not verified."
        (included if fallback else omitted).append(row)
    value = {"schemaVersion": 1, "fullEvidenceExportVerified": False, "reason": str(error) if str(error).replace("_", "").isalnum() and len(str(error)) <= 160 else "FULL_EVIDENCE_INDEXING_FAILED", "fallbackIncludedFiles": included, "omittedSelectedEvidence": omitted, "outcome": outcome, "meaning": "Failure summaries/counterbooks/source snapshots only. Full selected evidence export is incomplete; the configured raw-evidence directory has not been verified as remote backup. RUNNER_TEMP is not durable. No full-window reproducibility/readiness claim is made."}
    directory = root / "export"
    directory.mkdir(exist_ok=True, mode=0o700)
    save(directory / "failure.json", value)
    return {"fullEvidenceExportVerified": False, "failureManifest": str(directory / "failure.json"), "omittedSelectedSegments": len(omitted)}


def archive_public_evidence(root, limits, deadline, profile, outcome, github_run_id, github_run_attempt):
    """One bounded lossless gzip/tar over the verified allowlist; raw stays put."""
    started, cpu_started = time.monotonic(), time.process_time()
    directory = root / "export"
    index_bytes = regular(directory / "index.json", 8 * MIB, 994, True)
    index = json.loads(index_bytes)
    pending = directory / "selected-evidence.tar.gz.pending"
    final = directory / "selected-evidence.tar.gz"
    initial_bytes = tree_size(root)
    maximum = limits["compressedArchiveMiB"] * MIB
    written, compressed_hash = 0, hashlib.sha256()
    priority = os.getpriority(os.PRIO_PROCESS, 0)
    if priority < 10:
        os.nice(10 - priority)
    def archive_guard():
        require(time.monotonic() < deadline, "ARCHIVE_DEADLINE")
        require(time.process_time() - cpu_started <= limits["archiveCpuSeconds"], "ARCHIVE_CPU_CAP")
        require(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024 <= limits["archiveRssMiB"] * MIB, "ARCHIVE_RSS_CAP")
    class BoundedWriter:
        def __init__(self, stream):
            self.stream = stream
        def write(self, data):
            nonlocal written
            archive_guard()
            require(written + len(data) <= maximum, "COMPRESSED_ARCHIVE_CAP")
            require(initial_bytes + written + len(data) + 65536 <= limits["temporaryMiB"] * MIB, "ARCHIVE_STORAGE_CAP")
            require(shutil.disk_usage(root).free >= limits["minimumOngoingDiskMiB"] * MIB + len(data), "ARCHIVE_DISK_HEADROOM")
            self.stream.write(data)
            compressed_hash.update(data)
            written += len(data)
            return len(data)
        def flush(self):
            self.stream.flush()
    result = {"schemaVersion": 1, "classification": "candidate-only-public-evidence", "complete": False, "format": "tar+gzip", "researchProfile": profile, "githubRunId": github_run_id, "githubRunAttempt": github_run_attempt, "accountId": outcome.get("accountId"), "inceptionAt": outcome.get("inceptionAt"), "source": outcome["source"], "runtimeOutcome": outcome.get("runtimeOutcome"), "uncompressedSelectedBytes": index["uncompressedSelectedBytes"], "selectedEvidenceBytes": index.get("selectedEvidenceBytes"), "indexSha256": digest(index_bytes), "rawSelectedEvidenceRetained": True, "credentialsIncluded": False, "financialFilesIncluded": False, "compressionLevel": 6, "costMeaning": "Existing compute/disk/transfer allowance is not verified free; no artifact-storage purchase or overage is authorized."}
    try:
        with pending.open("xb") as raw:
            pending.chmod(0o600)
            with gzip.GzipFile(fileobj=BoundedWriter(raw), mode="wb", compresslevel=6, mtime=0) as zipped:
                with tarfile.open(fileobj=zipped, mode="w|") as archive:
                    header = tarfile.TarInfo("index.json")
                    header.size, header.mode, header.uid, header.gid, header.mtime = len(index_bytes), 0o600, 994, 994, 0
                    archive.addfile(header, io.BytesIO(index_bytes))
                    for row in index["included"]:
                        archive_guard()
                        name = pathlib.PurePosixPath(row["path"])
                        require(not name.is_absolute() and ".." not in name.parts, "ARCHIVE_INDEX_PATH")
                        data = regular(root / name, 8 * MIB, 994, True)
                        require(len(data) == row["bytes"] and digest(data) == row["sha256"], "ARCHIVE_SOURCE_CHANGED_AFTER_INDEX")
                        # Each item is emitted immediately; never retain a full
                        # market archive or source evidence set in memory.
                        header = tarfile.TarInfo(str(name))
                        header.size, header.mode, header.uid, header.gid, header.mtime = len(data), 0o600, 994, 994, 0
                        archive.addfile(header, io.BytesIO(data))
            raw.flush()
            os.fsync(raw.fileno())
        pending.rename(final)
        parent_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
        s = final.lstat()
        result["complete"] = True
        result["archive"] = {"file": final.name, "bytes": written, "sha256": compressed_hash.hexdigest(), "stat": {"device": s.st_dev, "inode": s.st_ino, "size": s.st_size, "mtimeNs": s.st_mtime_ns, "ctimeNs": s.st_ctime_ns}}
    except Exception as error:
        result["failure"] = safe_exception(error, "lossless-archive")
        result["partialCompressedBytes"] = written
        result["partialCompressedSha256"] = compressed_hash.hexdigest()
        result["meaning"] = "Compressed export incomplete; all original selected evidence is retained. No readback-ready archive or successful export is claimed."
    result["elapsedMs"] = round((time.monotonic() - started) * 1000)
    result["cpuMs"] = round((time.process_time() - cpu_started) * 1000)
    result["resourceBounds"] = {"cpuSeconds": limits["archiveCpuSeconds"], "maximumRssMiB": limits["archiveRssMiB"], "nice": os.getpriority(os.PRIO_PROCESS, 0), "remainingOuterDeadlineIsBinding": True}
    save(directory / "archive.json", result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    require(len(args.manifest_sha256) == 64 and all(c in "0123456789abcdef" for c in args.manifest_sha256), "REVIEWED_MANIFEST_HASH_REQUIRED")
    require(os.getuid() == 994 and pwd.getpwuid(994).pw_name == "mm-ec2-runner" and os.environ.get("ACTUAL_RUNNER") == "meme-machine-ec2-admin", "EXPECTED_NONROOT_RUNNER_REQUIRED")
    def interrupted(_number, _frame):
        raise SupervisorGuardError("SUPERVISOR_SIGNAL_STOP")
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    started = time.monotonic()
    base = pathlib.Path(args.package).resolve(strict=True)
    manifest_raw = regular(base / "package.json", 2 * MIB)
    require(digest(manifest_raw) == args.manifest_sha256, "REVIEWED_PACKAGE_HASH_MISMATCH")
    manifest = json.loads(manifest_raw)
    profile = manifest.get("researchProfile")
    limits = host_profile(profile)
    age_policy = observation_policy(manifest.get("observationAgePolicy"))
    contract = data_contract(manifest.get("dataContract"))
    require(manifest["schemaVersion"] == 1 and manifest["limits"] == limits, "REVIEWED_LIMITS_MISMATCH")
    outer_deadline = started + limits["outerSeconds"]
    temp = pathlib.Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    require(os.environ["GITHUB_RUN_ID"].isdigit() and os.environ["GITHUB_RUN_ATTEMPT"].isdigit(), "RESEARCH_RUN_ID")
    evidence_parent = temp
    if profile == TWO_HOUR_PROFILE:
        evidence_parent = pathlib.Path("/home/mm-ec2-runner/.local/share/poe-native-research")
        evidence_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        s = evidence_parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and evidence_parent.resolve() == evidence_parent and s.st_uid == 994 and stat.S_IMODE(s.st_mode) == 0o700, "PRIVATE_DURABLE_RESEARCH_PARENT_REQUIRED")
    root = evidence_parent / ("poe-native-candidates-" + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"])
    root.mkdir(mode=0o700)
    for program in ["prlimit", "timeout", "nice", "flock"]:
        require(shutil.which(program), "REQUIRED_LOCAL_TOOL_UNAVAILABLE")
    host = identity()
    memory = dict(line.split(":", 1) for line in pathlib.Path("/proc/meminfo").read_text().splitlines())
    available = int(memory["MemAvailable"].split()[0]) * 1024
    disk_available = shutil.disk_usage(root).free
    require(available >= limits["minimumAvailableRamMiB"] * MIB and disk_available >= limits["minimumAvailableDiskMiB"] * MIB, "INSUFFICIENT_RESEARCH_HOST_HEADROOM")
    node, node_version = existing_node(temp)
    before = {"startedAt": int(time.time() * 1000), "uid": 994, "host": host, "observer": observer(), "availableMemoryBytes": available, "availableDiskBytes": disk_available, "node": node, "nodeVersion": node_version, "metadataReads": 2, "protectedServiceMutations": False, "financialFilesRead": False}
    save(root / "before.json", before)
    save(root / "package.json", manifest)
    with open(os.environ["GITHUB_ENV"], "a") as out:
        out.write("POE_NATIVE_RESEARCH_DIRECTORY=" + str(root) + "\nPOE_NATIVE_EVIDENCE_EXPORT_READY=false\nPOE_NATIVE_RESEARCH_PROFILE=" + (profile or "default-900s") + "\n")
    runner = publisher = None
    accepted_sources = []
    outcome = {"startedAt": before["startedAt"], "packageSha256": args.manifest_sha256, "source": manifest["source"], "researchProfile": profile, "observationAgePolicy": age_policy, "dataContract": contract, "accountId": manifest["reportingBinding"]["accountId"], "inceptionAt": manifest["reportingBinding"]["inceptionAt"], "evidencePersistence": "private-durable-until-verified-backup" if profile else "RUNNER_TEMP-not-durable", "evidenceDirectory": str(root), "baselineByteRunway": manifest.get("baselineByteRunway"), "boundaries": {"candidateOnly": True, "financialWriter": False, "entriesEnabled": False, "liveTrading": False, "observerReplacement": False}, "runnerExit": None, "publisherStarted": False, "finalStoppedReportAccepted": False, "failure": None, "maximumRunnerRssBytes": 0, "maximumPublisherRssBytes": 0, "finalPublisherDrainSeconds": FINAL_REPORT_SECONDS}
    phase = "package-preparation"
    try:
        staged_bytes = 0
        for row in manifest["files"]:
            rel = pathlib.PurePosixPath(row["path"])
            require(not rel.is_absolute() and ".." not in rel.parts and str(rel) not in ["package.json", "before.json"], "UNSAFE_PACKAGE_PATH")
            data = regular(base / rel, 8 * MIB)
            require(len(data) == row["bytes"] and digest(data) == row["sha256"], "REVIEWED_FILE_HASH_MISMATCH")
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open("xb") as out:
                out.write(data)
            target.chmod(0o600)
            staged_bytes += len(data)
        require(staged_bytes <= limits["maximumPackageMiB"] * MIB, "PACKAGE_STAGING_BYTE_CAP")
        with gzip.GzipFile(fileobj=io.BytesIO(regular(root / "native-candidates.mjs.gz", 8 * MIB, 994, True))) as stream:
            bundle = stream.read(8 * MIB + 1)
        require(len(bundle) == manifest["bundle"]["bytes"] and digest(bundle) == manifest["bundle"]["sha256"], "EXECUTABLE_BUNDLE_HASH_MISMATCH")
        with (root / "native-candidates.mjs").open("xb") as out:
            out.write(bundle)
        (root / "native-candidates.mjs").chmod(0o600)
        template = json.loads(regular(root / "input-template.json", 8 * MIB, 994, True))
        require(template["source"] == manifest["source"] and template.get("reportingBinding") == manifest["reportingBinding"] and template["source"]["sha256"] == manifest["bundle"]["sha256"] and template["priorPhysicalSettled"] is True, "EXACT_SOURCE_OR_REPORTING_BINDING_MISMATCH")
        require(observation_policy(template.get("observationAgePolicy")) == age_policy, "SOURCE_OBSERVATION_POLICY_MISMATCH")
        require(data_contract(template.get("dataContract")) == contract, "SOURCE_DATA_CONTRACT_MISMATCH")
        require(len(template["baselinePaths"]) == len(manifest["baselineBooks"]), "BASELINE_LIST_MISMATCH")
        template["baselinePaths"] = [str(root / row["path"]) for row in manifest["baselineBooks"]]
        require(int(time.time() * 1000) >= template["priorCooldownUntil"], "PRIOR_PROVIDER_COOLDOWN")
        save(root / "input.json", template)
        s = SECRET.lstat()
        require(stat.S_ISREG(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid == 994 and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600 and 32 <= s.st_size <= 4096, "DEDICATED_REPORTING_SECRET_FILE_NOT_ATTACHED")
        require(time.monotonic() - started <= 60, "PREPARATION_DEADLINE")
        binding = manifest["reportingBinding"]
        launcher = str(root / "reporting/run-publisher.sh")
        report_args = ["/bin/bash", launcher, "--node", node, "--status-file", str(root / "run/status.json"), "--secret-file", str(SECRET), "--account-id", binding["accountId"], "--inception-at", str(binding["inceptionAt"])]
        source_args = [node, "--no-addons", "--max-old-space-size=" + str(limits["heapMiB"]), str(root / "native-candidates.mjs"), "--run", "--input", str(root / "input.json"), "--directory", str(root / "run"), "--duration-seconds", str(limits["durationSeconds"])]
        if profile:
            source_args += ["--profile", profile]
        if age_policy != DEFAULT_OBSERVATION_POLICY:
            source_args += ["--observation-age-policy", age_policy]
        if contract != "confirmed-program-events-v2":
            source_args += ["--data-contract", contract]
        runner = launch(["/usr/bin/timeout", "--signal=TERM", "--kill-after=4s", str(limits["runnerTimeoutSeconds"]) + "s"] + source_args, root / "runner.log", limits["runnerCpuSeconds"])
        until_status = time.monotonic() + 25
        while runner.poll() is None:
            elapsed = time.monotonic() - started
            phase = "runner-rss-scan"
            runner_rss = group_rss(runner.pid)
            outcome["maximumRunnerRssBytes"] = max(outcome["maximumRunnerRssBytes"], runner_rss)
            require(runner_rss <= limits["runnerRssMiB"] * MIB, "RUNNER_RSS_BOUND")
            phase = "storage-scan"
            require(tree_size(root) <= limits["temporaryMiB"] * MIB and shutil.disk_usage(root).free >= limits["minimumOngoingDiskMiB"] * MIB, "RESEARCH_STORAGE_BOUND")
            phase = "outer-deadline-check"
            require(time.monotonic() < outer_deadline - FINAL_REPORT_SECONDS - 5, "OUTER_RESEARCH_DEADLINE")
            source_path = root / "run/status.json"
            if publisher is None and source_path.exists():
                phase = "reporting-start"
                source_check = json.loads(regular(source_path, 4 * MIB, 994, True))
                require(source_check.get("researchProfile") == profile and (source_check.get("observationAgePolicy") or {}).get("version") == age_policy, "RUNNING_SOURCE_PROFILE_OR_AGE_POLICY_MISMATCH")
                source_contract = source_check.get("dataContract") or (source_check.get("engine") or {}).get("dataContract")
                require(source_contract == contract, "RUNNING_SOURCE_DATA_CONTRACT_MISMATCH")
                require(manifest.get("configurationSha256") is None or source_check.get("configurationSha256") == manifest["configurationSha256"], "RUNNING_SOURCE_CONFIGURATION_MISMATCH")
                verify = subprocess.run(report_args + ["--verify-only"], env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=5)
                require(verify.returncode == 0, "REPORTING_PRIVATE_FILE_OR_IDENTITY_CHECK_FAILED")
                publisher_seconds = max(1, min(limits["outerSeconds"] - 60, int(outer_deadline - time.monotonic() - 3)))
                publisher = launch(["/usr/bin/timeout", "--signal=TERM", "--kill-after=3s", str(publisher_seconds) + "s"] + report_args + ["--watch"], root / "publisher.log", limits["publisherCpuSeconds"], file_size_mib=1)
                outcome["publisherStarted"] = True
            require(publisher is not None or time.monotonic() < until_status, "INITIAL_RUNTIME_STATUS_NOT_AVAILABLE")
            if publisher is not None:
                phase = "publisher-rss-scan"
                require(publisher.poll() is None, "REPORTING_PUBLISHER_EXITED")
                publisher_rss = group_rss(publisher.pid)
                outcome["maximumPublisherRssBytes"] = max(outcome["maximumPublisherRssBytes"], publisher_rss)
                require(publisher_rss <= 128 * MIB, "PUBLISHER_RSS_BOUND")
                try:
                    capture_accepted_source(root, binding, accepted_sources)
                except Exception as error:
                    outcome["acceptedSourceSnapshotCaptureFailure"] = "ACTUAL_ACCEPTED_SOURCE_SNAPSHOT_UNAVAILABLE"
                    outcome["acceptedSourceSnapshotException"] = safe_exception(error, "reporting-snapshot-capture")
            time.sleep(0.5)
        phase = "runner-exit-check"
        outcome["runnerExit"] = runner.returncode
        require(runner.returncode == 0, "NATIVE_RESEARCH_RUNNER_EXITED_WITH_FAILURE")
    except Exception as error:
        outcome["supervisorException"] = safe_exception(error, phase)
        outcome["failure"] = outcome["supervisorException"]["code"]
    finally:
        runner_group_settled = terminate(runner)
        # The normal watch publisher has one 15s cycle/backoff loop. Stop it,
        # then make one explicit bounded publication of the real final snapshot.
        # No fabricated liquidation or replacement timestamp is constructed.
        publisher_group_settled = terminate(publisher)
        outcome["ownedProcessGroupsSettled"] = runner_group_settled and publisher_group_settled
        if not outcome["ownedProcessGroupsSettled"]:
            outcome["failure"] = "OWNED_RESEARCH_PROCESS_GROUP_SETTLEMENT_UNVERIFIED"
        final_status = None
        try:
            original_source_bytes = regular(root / "run/status.json", 8 * MIB, 994, True)
            final_status = json.loads(original_source_bytes)
            outcome["reportingAvailability"] = reporting_summary(publisher_acks(root / "publisher.log", manifest["reportingBinding"]), final_status["startedAt"], final_status["generatedAt"])
            outcome["sourcePhysicalSettlementConfirmed"] = final_status.get("physicalSettlementConfirmed") is True
            outcome["physicalSettlementConfirmed"] = outcome["sourcePhysicalSettlementConfirmed"] and outcome["ownedProcessGroupsSettled"]
            require(outcome["ownedProcessGroupsSettled"], "WATCH_OR_RUNTIME_PROCESS_GROUP_NOT_SETTLED")
            require(final_status.get("accountId") == manifest["reportingBinding"]["accountId"] and final_status.get("inceptionAt") == manifest["reportingBinding"]["inceptionAt"], "REAL_SOURCE_BINDING_NOT_AVAILABLE")
            publish_source = final_status
            publish_args = report_args
            outcome["finalStoppedReportKind"] = "runtime-stopped-source"
            if final_status.get("running") is not False:
                observed_stop_at = int(time.time() * 1000)
                reason_code = outcome["failure"] or "SUPERVISOR_SOURCE_FINAL_UNAVAILABLE"
                exception = outcome.get("supervisorException") or {}
                if exception.get("errnoName"):
                    reason_code = (reason_code + "_" + exception["errnoName"] + "_" + exception.get("phase", "unknown").upper().replace("-", "_"))[:160]
                payload = {"schemaVersion": 1, "kind": "supervisor-observed-stop", "observedAt": observed_stop_at, "ownedProcessGroupsSettled": True, "sourceRunId": final_status.get("runId"), "accountId": manifest["reportingBinding"]["accountId"], "inceptionAt": manifest["reportingBinding"]["inceptionAt"], "lastRuntimeGeneratedAt": final_status.get("generatedAt"), "originalStatusSha256": digest(original_source_bytes), "originalStatusPath": "run/status.json", "packageSha256": args.manifest_sha256, "supervisorSha256": manifest["supervisorSha256"], "reason": reason_code, "supervisorException": exception, "runtimeGracefulShutdownVerified": False, "applicationTransportAccountingSettled": False, "financialReconciliationVerified": False}
                receipt_id = digest(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
                save(root / "supervisor-stop-receipt.json", {"receiptId": receipt_id, "identityMeaning": "SHA256 of canonical sorted-key payload JSON", "payload": payload})
                publish_source = supervised_stopped_projection(final_status, manifest["reportingBinding"], digest(original_source_bytes), observed_stop_at, receipt_id, reason_code, True)
                save(root / "supervised-status.json", publish_source)
                publish_args = [str(root / "supervised-status.json") if value == str(root / "run/status.json") else value for value in report_args]
                outcome["finalStoppedReportKind"] = "supervisor-observed-stop-not-runtime-final"
                outcome["supervisorStoppedProjection"] = {"receiptId": receipt_id, "generatedAt": observed_stop_at, "lastRuntimeGeneratedAt": final_status["generatedAt"], "originalStatusSha256": digest(original_source_bytes), "originalStatusBytesPreserved": True, "financialReconciliationVerified": False}
            deadline = min(outer_deadline - 5, time.monotonic() + FINAL_REPORT_SECONDS)
            require(deadline - time.monotonic() >= 6, "FINAL_REPORT_DRAIN_NOT_AVAILABLE")
            final_publisher = launch(publish_args + ["--once"], root / "publisher-final.log", 5, file_size_mib=1)
            try:
                final_publisher.wait(timeout=max(1, min(8, deadline - time.monotonic())))
            finally:
                outcome["finalPublisherProcessGroupSettled"] = terminate(final_publisher, grace=1)
            require(outcome["finalPublisherProcessGroupSettled"], "FINAL_PUBLISHER_PROCESS_GROUP_NOT_SETTLED")
            ack = accepted_ack(root / "publisher-final.log", manifest["reportingBinding"], publish_source["generatedAt"], False)
            outcome["finalStoppedReportAccepted"] = ack is not None
            outcome["finalStoppedReportingAck"] = ack
        except Exception as error:
            outcome["finalStoppedReportAccepted"] = False
            outcome["finalReportingException"] = safe_exception(error, "final-reporting")
            outcome["finalReportingLimitation"] = "Actual stopped-source report was not verified within the finite drain; receiver must expose stale/disconnected state."
        try:
            after = observer()
            unchanged = all(after["service"][key] == before["observer"]["service"][key] for key in ["MainPID", "NRestarts", "User"]) and all(after["publicStatus"][key] == before["observer"]["publicStatus"][key] for key in ["accountId", "inceptionAt", "release"])
            after["originalIdentityPidRestartsUnchanged"] = unchanged
            save(root / "after.json", after)
            if not unchanged:
                outcome["failure"] = "ORIGINAL_OBSERVER_CHANGED_DURING_TEST_NO_CAUSE_ASSUMED"
        except Exception:
            outcome["failure"] = outcome["failure"] or "ORIGINAL_OBSERVER_AFTER_CHECK_UNAVAILABLE"
        outcome["finishedAt"] = int(time.time() * 1000)
        outcome["aggregateElapsedSeconds"] = time.monotonic() - started
        outcome["actualRunElapsedMs"] = final_status.get("elapsedMs") if final_status else None
        outcome["runtimeOutcome"] = runtime_outcome(final_status, limits["durationSeconds"] * 1000)
        outcome["sourceStopReason"] = final_status.get("stopReason") if final_status else None
        if outcome["runtimeOutcome"]["failureReason"]:
            if outcome["failure"]:
                outcome["otherSupervisorFailure"] = outcome["failure"]
            outcome["failure"] = outcome["runtimeOutcome"]["failureReason"]
        outcome["candidateCounters"] = (final_status.get("engine") or {}).get("counters") if final_status else None
        outcome["acceptedSourceSnapshots"] = accepted_sources
        outcome["twoDistinctAcceptedSourcesRetained"] = len(accepted_sources) >= 2
        outcome["originalFinancialAccountTouched"] = False
        outcome["reportingCredentialReadBySupervisor"] = False
        if not outcome.get("reportingAvailability", {}).get("continuityVerifiedForInterval"):
            outcome["failure"] = outcome["failure"] or "REPORTING_CONTINUITY_NOT_VERIFIED"
        if not outcome["twoDistinctAcceptedSourcesRetained"]:
            outcome["failure"] = outcome["failure"] or "TWO_ACCEPTED_SOURCE_SNAPSHOTS_NOT_RETAINED"
        save(root / "supervisor.json", outcome)
        try:
            artifact = export_artifact(root, args.manifest_sha256, limits)
            archive = archive_public_evidence(root, limits, outer_deadline - 5, profile, outcome, os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"])
            artifact["losslessArchive"] = archive
            artifact["localArchiveCopies"] = 1 if archive["complete"] else 0
            artifact["partialLocalArchiveRetained"] = (root / "export/selected-evidence.tar.gz.pending").exists()
            if profile and not archive["complete"]:
                outcome["failure"] = outcome["failure"] or "LOSSLESS_EVIDENCE_ARCHIVE_INCOMPLETE"
            with open(os.environ["GITHUB_ENV"], "a") as out:
                out.write("POE_NATIVE_EVIDENCE_EXPORT_READY=" + ("true" if not profile or archive["complete"] else "false") + "\n")
        except Exception as error:
            outcome["failure"] = outcome["failure"] or "FULL_EVIDENCE_EXPORT_NOT_VERIFIED"
            artifact = export_failure_manifest(root, error, outcome)
        print(json.dumps({"directory": str(root), "outcome": outcome, "artifact": artifact}, sort_keys=True))
    return 0 if not outcome["failure"] and outcome.get("physicalSettlementConfirmed") and outcome["finalStoppedReportAccepted"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        detail = safe_exception(error, "supervisor-preflight-or-finalization")
        print(json.dumps({"failure": detail["code"], "exception": detail, "financialExecution": False, "serviceControlAttempted": False}))
        raise SystemExit(1)
