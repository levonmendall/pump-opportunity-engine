#!/usr/bin/env python3
"""Bounded readback of one completed public-candidate evidence archive.

No CLI/environment path override, credential access, extraction or network client.
Only the fixed durable POE research tree is reachable by the production entry.
Whole-archive SHA256 comes from the completed creator manifest; the recipient
must verify it after reconstructing the archive. Each returned chunk has its own
SHA256, and its open manifest/archive descriptors must retain their exact stats.
"""
import argparse
import base64
import contextlib
import hashlib
import json
import os
import pathlib
import re
import stat
import sys

MIB = 1024 * 1024
BASE = pathlib.Path("/home/mm-ec2-runner/.local/share/poe-native-research")
EXPECTED_UID = 994
PROFILE = "candidate-native-two-hour-research-v1"
ACCOUNT_ID = "poe-pilot-8468add6-f916-48cf-a585-6cd008a81360"
INCEPTION_AT = 1793123773252
ARCHIVE = "selected-evidence.tar.gz"
MANIFEST = "archive.json"
MAXIMUM_ARCHIVE_BYTES = 256 * MIB
MAXIMUM_CHUNK_BYTES = 4 * MIB
MAXIMUM_MANIFEST_BYTES = 64 * 1024
# Base64 plus compact JSON framing stays below a 64KiB log line. The source
# block is also below the requested 64KiB source-block maximum.
SOURCE_BLOCK_BYTES = 48 * 1024 - 256
MAXIMUM_LOG_LINE_BYTES = 64 * 1024


class EvidenceReadbackError(RuntimeError):
    pass


def require(condition, code):
    if not condition:
        raise EvidenceReadbackError(code)


def canonical_number(value, maximum, positive=False):
    require(isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]{0,19}", value) is not None, "READBACK_NUMERIC_ARGUMENT_REQUIRED")
    number = int(value)
    require((number > 0 if positive else number >= 0) and number <= maximum, "READBACK_ARGUMENT_OUT_OF_RANGE")
    return value, number


def emit(output, value):
    line = json.dumps(value, separators=(",", ":"), ensure_ascii=True) + "\n"
    require(len(line.encode("ascii")) <= MAXIMUM_LOG_LINE_BYTES, "READBACK_LOG_RECORD_LIMIT")
    output.write(line)
    output.flush()


def stat_identity(value):
    return {"device": value.st_dev, "inode": value.st_ino, "size": value.st_size, "mtimeNs": value.st_mtime_ns, "ctimeNs": value.st_ctime_ns}


def private_directory(fd, uid):
    value = os.fstat(fd)
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == uid and stat.S_IMODE(value.st_mode) & 0o077 == 0, "READBACK_PRIVATE_DIRECTORY_REQUIRED")
    return value


def private_file(fd, uid, maximum):
    value = os.fstat(fd)
    require(stat.S_ISREG(value.st_mode) and value.st_uid == uid and value.st_nlink == 1 and stat.S_IMODE(value.st_mode) & 0o077 == 0 and 0 < value.st_size <= maximum, "READBACK_PRIVATE_REGULAR_FILE_REQUIRED")
    return value


def open_directory(name, parent_fd):
    return os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)


def open_fixed_base():
    """Open every fixed ancestor without following a symlink.

    Root-owned public ancestors and the runner's non-writable home ancestors
    are trusted only as path components; the final research base must be private.
    """
    require(os.getuid() == EXPECTED_UID, "READBACK_EXPECTED_NONROOT_UID_REQUIRED")
    current = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for name in BASE.parts[1:]:
            following = open_directory(name, current)
            os.close(current)
            current = following
            value = os.fstat(current)
            require(stat.S_ISDIR(value.st_mode) and value.st_uid in [0, EXPECTED_UID] and stat.S_IMODE(value.st_mode) & 0o022 == 0, "READBACK_FIXED_ANCESTOR_UNSAFE")
        private_directory(current, EXPECTED_UID)
        return current
    except BaseException:
        os.close(current)
        raise


def decode_manifest(raw, run_id, attempt):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "READBACK_DUPLICATE_MANIFEST_FIELD")
            result[key] = value
        return result

    def invalid_constant(_value):
        raise EvidenceReadbackError("READBACK_MANIFEST_NUMBER_INVALID")

    try:
        value = json.loads(raw.decode("utf8"), object_pairs_hook=pairs, parse_constant=invalid_constant)
    except EvidenceReadbackError:
        raise
    except (ValueError, UnicodeError):
        raise EvidenceReadbackError("READBACK_MANIFEST_INVALID") from None
    fields = {"schemaVersion", "classification", "complete", "format", "researchProfile", "githubRunId", "githubRunAttempt", "accountId", "inceptionAt", "archive", "credentialsIncluded", "financialFilesIncluded"}
    public_extras = {"source", "runtimeOutcome", "uncompressedSelectedBytes", "selectedEvidenceBytes", "indexSha256", "rawSelectedEvidenceRetained", "compressionLevel", "costMeaning", "elapsedMs", "cpuMs", "resourceBounds"}
    require(isinstance(value, dict) and fields <= set(value) and set(value) <= fields | public_extras, "READBACK_MANIFEST_FIELDS_INVALID")
    require(type(value["schemaVersion"]) is int and value["schemaVersion"] == 1 and value["classification"] == "candidate-only-public-evidence" and value["complete"] is True and value["format"] == "tar+gzip" and value["researchProfile"] == PROFILE, "READBACK_PUBLIC_CANDIDATE_ARCHIVE_REQUIRED")
    require(value["githubRunId"] == run_id and value["githubRunAttempt"] == attempt and value["accountId"] == ACCOUNT_ID and type(value["inceptionAt"]) is int and value["inceptionAt"] == INCEPTION_AT, "READBACK_SOURCE_BINDING_MISMATCH")
    require(value["credentialsIncluded"] is False and value["financialFilesIncluded"] is False, "READBACK_PRIVATE_OR_FINANCIAL_ARCHIVE_DENIED")
    archive = value["archive"]
    require(isinstance(archive, dict) and set(archive) == {"file", "bytes", "sha256", "stat"} and archive["file"] == ARCHIVE and type(archive["bytes"]) is int and 0 < archive["bytes"] <= MAXIMUM_ARCHIVE_BYTES and isinstance(archive["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", archive["sha256"]) is not None, "READBACK_ARCHIVE_IDENTITY_INVALID")
    identity = archive["stat"]
    require(isinstance(identity, dict) and set(identity) == {"device", "inode", "size", "mtimeNs", "ctimeNs"} and all(type(n) is int and n >= 0 for n in identity.values()) and identity["size"] == archive["bytes"], "READBACK_ARCHIVE_STAT_INVALID")
    if "source" in value:
        source = value["source"]
        require(isinstance(source, dict) and set(source) == {"commit", "sha256"} and isinstance(source["commit"], str) and re.fullmatch(r"[a-f0-9]{7,40}", source["commit"]) is not None and isinstance(source["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", source["sha256"]) is not None, "READBACK_PUBLIC_SOURCE_INVALID")
    if "runtimeOutcome" in value:
        require(value["runtimeOutcome"] is None or isinstance(value["runtimeOutcome"], dict), "READBACK_PUBLIC_RUNTIME_OUTCOME_INVALID")
    for name in ["uncompressedSelectedBytes", "selectedEvidenceBytes", "elapsedMs", "cpuMs"]:
        if name in value:
            require(type(value[name]) is int and value[name] >= 0, "READBACK_PUBLIC_USAGE_INVALID")
    if "uncompressedSelectedBytes" in value:
        require(value["uncompressedSelectedBytes"] <= 1280 * MIB, "READBACK_PUBLIC_USAGE_INVALID")
    if "selectedEvidenceBytes" in value:
        require(value["selectedEvidenceBytes"] <= 1024 * MIB, "READBACK_PUBLIC_USAGE_INVALID")
    if "indexSha256" in value:
        require(isinstance(value["indexSha256"], str) and re.fullmatch(r"[a-f0-9]{64}", value["indexSha256"]) is not None, "READBACK_PUBLIC_INDEX_INVALID")
    if "rawSelectedEvidenceRetained" in value:
        require(value["rawSelectedEvidenceRetained"] is True, "READBACK_PUBLIC_RAW_EVIDENCE_NOT_RETAINED")
    if "compressionLevel" in value:
        require(type(value["compressionLevel"]) is int and 0 <= value["compressionLevel"] <= 9, "READBACK_PUBLIC_COMPRESSION_INVALID")
    if "costMeaning" in value:
        require(isinstance(value["costMeaning"], str) and len(value["costMeaning"]) <= 1024, "READBACK_PUBLIC_COST_MEANING_INVALID")
    if "resourceBounds" in value:
        bounds = value["resourceBounds"]
        require(isinstance(bounds, dict) and set(bounds) == {"cpuSeconds", "maximumRssMiB", "nice", "remainingOuterDeadlineIsBinding"} and type(bounds["cpuSeconds"]) is int and bounds["cpuSeconds"] in [30, 120] and type(bounds["maximumRssMiB"]) is int and bounds["maximumRssMiB"] == 256 and type(bounds["nice"]) is int and 10 <= bounds["nice"] <= 19 and bounds["remainingOuterDeadlineIsBinding"] is True, "READBACK_PUBLIC_RESOURCE_BOUNDS_INVALID")
    return value


def read_manifest(fd, uid, run_id, attempt):
    before = private_file(fd, uid, MAXIMUM_MANIFEST_BYTES)
    data = bytearray()
    while len(data) <= before.st_size:
        block = os.read(fd, min(8192, before.st_size + 1 - len(data)))
        if not block:
            break
        data.extend(block)
    after = private_file(fd, uid, MAXIMUM_MANIFEST_BYTES)
    require(len(data) == before.st_size and stat_identity(before) == stat_identity(after), "READBACK_MANIFEST_CHANGED")
    raw = bytes(data)
    return decode_manifest(raw, run_id, attempt), raw, before


def stream_from_base_fd(base_fd, uid, run_id, attempt, offset, length, output):
    """Descriptor-only core; tests inject an owned temporary base descriptor.

    Production never accepts a caller-supplied descriptor, base path or UID.
    """
    run_id, _ = canonical_number(run_id, (1 << 64) - 1, positive=True)
    attempt, _ = canonical_number(attempt, (1 << 64) - 1, positive=True)
    _, start = canonical_number(offset, MAXIMUM_ARCHIVE_BYTES)
    _, requested = canonical_number(length, MAXIMUM_CHUNK_BYTES, positive=True)
    private_directory(base_fd, uid)
    with contextlib.ExitStack() as stack:
        run_fd = open_directory("poe-native-candidates-" + run_id + "-" + attempt, base_fd)
        stack.callback(os.close, run_fd)
        private_directory(run_fd, uid)
        export_fd = open_directory("export", run_fd)
        stack.callback(os.close, export_fd)
        private_directory(export_fd, uid)
        manifest_fd = os.open(MANIFEST, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=export_fd)
        stack.callback(os.close, manifest_fd)
        manifest, raw_manifest, manifest_before = read_manifest(manifest_fd, uid, run_id, attempt)
        archive_fd = os.open(ARCHIVE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=export_fd)
        stack.callback(os.close, archive_fd)
        archive_before = private_file(archive_fd, uid, MAXIMUM_ARCHIVE_BYTES)
        archive = manifest["archive"]
        require(stat_identity(archive_before) == archive["stat"], "READBACK_ARCHIVE_STAT_MISMATCH")
        require(start <= archive["bytes"], "READBACK_OFFSET_AFTER_EOF")
        actual_length = min(requested, archive["bytes"] - start)
        emit(output, {"schemaVersion": 1, "kind": "header", "classification": "candidate-only-public-evidence-readback", "githubRunId": run_id, "githubRunAttempt": attempt, "researchProfile": PROFILE, "accountId": ACCOUNT_ID, "inceptionAt": INCEPTION_AT, "manifestSha256": hashlib.sha256(raw_manifest).hexdigest(), "archive": {"file": ARCHIVE, "bytes": archive["bytes"], "sha256": archive["sha256"]}, "chunk": {"offset": start, "requestedLength": requested, "actualLength": actual_length, "sourceBlockMaximumBytes": SOURCE_BLOCK_BYTES}, "integrityMeaning": "Manifest creation SHA256 is supplied; this call hashes only its bounded chunk. Verify the entire archive SHA256 after reassembly. Complete archive/readback does not establish source runtime or market-window success."})
        hasher = hashlib.sha256()
        sent = 0
        index = 0
        while sent < actual_length:
            block = os.pread(archive_fd, min(SOURCE_BLOCK_BYTES, actual_length - sent), start + sent)
            require(len(block) == min(SOURCE_BLOCK_BYTES, actual_length - sent), "READBACK_ARCHIVE_SHORT_READ")
            hasher.update(block)
            emit(output, {"kind": "data", "index": index, "offset": start + sent, "bytes": len(block), "base64": base64.b64encode(block).decode("ascii")})
            sent += len(block)
            index += 1
        archive_after = private_file(archive_fd, uid, MAXIMUM_ARCHIVE_BYTES)
        manifest_after = private_file(manifest_fd, uid, MAXIMUM_MANIFEST_BYTES)
        for fd in [base_fd, run_fd, export_fd]:
            private_directory(fd, uid)
        require(stat_identity(archive_after) == archive["stat"] and stat_identity(archive_after) == stat_identity(archive_before), "READBACK_ARCHIVE_CHANGED")
        require(stat_identity(manifest_after) == stat_identity(manifest_before), "READBACK_MANIFEST_CHANGED")
        emit(output, {"schemaVersion": 1, "kind": "footer", "complete": True, "offset": start, "bytes": sent, "dataRecords": index, "chunkSha256": hasher.hexdigest(), "archiveSha256": archive["sha256"], "manifestSha256": hashlib.sha256(raw_manifest).hexdigest(), "descriptorStatsStable": True, "archiveWholeHashVerifiedByThisCall": False, "credentialsRead": False, "financialFilesRead": False})
        return {"bytes": sent, "chunkSha256": hasher.hexdigest(), "archiveSha256": archive["sha256"]}


def readback_public_evidence(run_id, attempt, offset, length, output):
    # Validate every argument before opening even the fixed directory tree.
    canonical_number(run_id, (1 << 64) - 1, positive=True)
    canonical_number(attempt, (1 << 64) - 1, positive=True)
    canonical_number(offset, MAXIMUM_ARCHIVE_BYTES)
    canonical_number(length, MAXIMUM_CHUNK_BYTES, positive=True)
    base_fd = open_fixed_base()
    try:
        return stream_from_base_fd(base_fd, EXPECTED_UID, run_id, attempt, offset, length, output)
    finally:
        os.close(base_fd)


class QuietArgumentParser(argparse.ArgumentParser):
    def error(self, _message):
        raise EvidenceReadbackError("READBACK_ARGUMENTS_INVALID")


def main(argv=None, output=None):
    output = output or sys.stdout
    try:
        parser = QuietArgumentParser(allow_abbrev=False, add_help=False)
        for flag in ["run-id", "attempt", "offset", "length"]:
            parser.add_argument("--" + flag, required=True)
        args = parser.parse_args(argv)
        require(os.getuid() == EXPECTED_UID, "READBACK_EXPECTED_NONROOT_UID_REQUIRED")
        readback_public_evidence(args.run_id, args.attempt, args.offset, args.length, output)
        return 0
    except BrokenPipeError:
        return 1
    except Exception as error:
        code = str(error) if isinstance(error, EvidenceReadbackError) else "READBACK_UNAVAILABLE"
        try:
            emit(output, {"schemaVersion": 1, "kind": "error", "complete": False, "code": code, "credentialsRead": False, "financialFilesRead": False})
        except BrokenPipeError:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
