import { spawnSync } from 'node:child_process';
/** Bounded service diagnostics. Financial/qualification proof is never evicted.
 * Only this class's versioned private namespace is eligible for retention. */
import { constants, openSync, closeSync, writeSync, readFileSync, lstatSync, fstatSync, fsyncSync, renameSync, mkdirSync, realpathSync, statfsSync, unlinkSync, createReadStream } from 'node:fs';
import { open as openAsync } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID, type Hash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const MIB = 1024 * 1024, VERSION = 'poe-owned-rotating-evidence-v1', ZERO = '0'.repeat(64), MAX_STATE = 1024 * 1024;
const encode = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === 'bigint' ? x.toString() : x);
const digest = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const need = (v: unknown, reason: string) => {
    if (!v)
        throw Error('ROTATING_EVIDENCE_' + reason);
};
const integer = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
const sha = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
export type BoundedRecorderOptions = {
    directory: string;
    segmentBytes?: number;
    diagnosticBytes?: number;
    minRetentionMs?: number;
    minimumDiskReserveBytes?: number;
    /** Persistent service only: retain a rolling horizon and grow its working
     * allocation from observed mandatory bytes within verified disk headroom. */
    continuousRotation?: boolean;
    maximumDiagnosticBytes?: number;
    capacityDiskFraction?: number;
    now?: () => number;
    monotonic?: () => number;
};
type Meta = {
    file: string;
    sequence: number;
    startedAt: number;
    endedAt: number;
    bytes: number;
    records: number;
    previousSha256: string;
    lastRecordHash: string;
    prefixSha256: string;
    sha256?: string;
    unusableTailBytes?: number;
    invalidCommittedPrefix?: {
        expectedBytes: number;
        expectedSha256: string;
    };
};
type Receipt = {
    sequence: number;
    at: number;
    kind: string;
    data: unknown;
    previousSha256: string;
    sha256: string;
};
type State = {
    version: typeof VERSION;
    startedAt: number;
    policy: {
        segmentBytes: number;
        diagnosticBytes: number;
        minRetentionMs: number;
    };
    nextDiagnostic: number;
    nextEssential: number;
    diagnosticHead: string;
    essentialHead: string;
    activeDiagnostic: Meta | null;
    activeEssential: Meta | null;
    diagnostics: Meta[];
    receiptAnchor: {
        throughSequence: number;
        sha256: string;
    };
    receipts: Receipt[];
    totalRecordedBytes: number;
    retiredBytes: number;
    protectedBytes: number;
    refusedRecords: number;
    refusedBytes: number;
    optionalOmittedRecords: number;
    optionalOmittedBytes: number;
    nextReceipt: number;
    lastAt: number;
    evictedThroughAt: number;
    requiresCriticalRecovery: boolean;
    refusalIntervals: Array<{
        fromAt: number;
        toAt: number;
        records: number;
        bytes: number;
    }>;
    refusalOpen: boolean;
    refusalIntervalsCoalesced: number;
};
type Active = {
    fd: number;
    meta: Meta;
    hash: Hash;
};
export type EvidencePinResult = {
    complete: boolean;
    proofId: string;
    files: string[];
    bytes: number;
    manifestSha256: string | null;
    reason?: string;
};
export type RecorderRecordOutcome = {kind: 'accepted' | 'optional-capacity-omitted' | 'unavailable';reason: string | null};
/** A separate service API; finite research Recorder remains unchanged. */
export class BoundedRotatingRecorder {
    private readonly directory: string;
    private readonly directoryFd: number;
    private writerFd: number | null = null;
    private readonly now: () => number;
    private readonly mono: () => number;
    private readonly reserve: number;
    private readonly maintenanceTriggerBytes: number;
    private readonly maintenanceTargetBytes: number;
    private readonly continuousRotation: boolean;
    private readonly maximumDiagnosticBytes: number;
    private readonly capacityDiskFraction: number;
    private effectiveDiagnosticBytes: number;
    private lastOutcome: RecorderRecordOutcome = {kind:'unavailable',reason:'NO_RECORD_ATTEMPT'};
    private optionalOmissionDirty = false;
    private optionalOmissionLastCheckpoint = -Infinity;
    private state: State;
    private diagnostic: Active | null = null;
    private essential: Active | null = null;
    private closed = false;
    private closing = false;
    private fatal: string | null = null;
    private pressure: string | null = null;
    private readonly retentionStarted = new Map<string, number>();
    private readonly pinned = new Map<string, number>();
    private readonly pinById = new Map<string, {
        fromAt: number;
        toAt: number;
        task: Promise<EvidencePinResult>;
    }>();
    private pendingPinBytes = 0;
    private maintenanceTask: Promise<void> | null = null;
    private lastMaintenanceAt = -Infinity;
    private readonly pinTasks = new Set<Promise<EvidencePinResult>>();
    private availableBytes = Infinity;
    private diskCheckedMono = -Infinity;
    constructor(options: BoundedRecorderOptions) {
        this.directory = resolve(options.directory);
        this.now = options.now ?? Date.now;
        this.mono = options.monotonic ?? (() => performance.now());
        this.reserve = options.minimumDiskReserveBytes ?? 128 * MIB;
        const policy = { segmentBytes: options.segmentBytes ?? 8 * MIB, diagnosticBytes: options.diagnosticBytes ?? 128 * MIB, minRetentionMs: options.minRetentionMs ?? 300000 };
        need(integer(policy.segmentBytes) && policy.segmentBytes >= 4096 && policy.segmentBytes <= 8 * MIB && integer(policy.diagnosticBytes) && policy.diagnosticBytes >= 2 * policy.segmentBytes && policy.diagnosticBytes <= 1024 * MIB && policy.diagnosticBytes / policy.segmentBytes <= 512 && integer(policy.minRetentionMs) && policy.minRetentionMs >= 300000 && integer(this.reserve), 'POLICY');
        // Begin verified retirement before the unchanged one-segment admission
        // reserve is consumed. Small namespaces keep at least one segment before
        // triggering maintenance; neither the
        // total cap nor the minimum age/pin/integrity conditions are relaxed.
        this.maintenanceTriggerBytes = Math.max(policy.segmentBytes, policy.diagnosticBytes - 2 * policy.segmentBytes);
        this.maintenanceTargetBytes = Math.max(0, policy.diagnosticBytes - 3 * policy.segmentBytes);
        this.continuousRotation = options.continuousRotation ?? false;
        this.maximumDiagnosticBytes = options.maximumDiagnosticBytes ?? policy.diagnosticBytes;
        this.capacityDiskFraction = options.capacityDiskFraction ?? 1 / 32;
        this.effectiveDiagnosticBytes = policy.diagnosticBytes;
        need(typeof this.continuousRotation === 'boolean' && integer(this.maximumDiagnosticBytes) && this.maximumDiagnosticBytes >= policy.diagnosticBytes && this.maximumDiagnosticBytes <= 4 * 1024 * MIB && this.maximumDiagnosticBytes <= 512 * policy.segmentBytes && (this.continuousRotation || this.maximumDiagnosticBytes === policy.diagnosticBytes) && Number.isFinite(this.capacityDiskFraction) && this.capacityDiskFraction > 0 && this.capacityDiskFraction <= 1 / 32, 'SERVICE_CAPACITY_POLICY');
        need(realpathSync(dirname(this.directory)) === dirname(this.directory), 'CANONICAL_PARENT');
        try {
            const s = lstatSync(this.directory);
            need(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid?.() && (s.mode & 0o077) === 0, 'PRIVATE_DIRECTORY');
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                throw e;
            mkdirSync(this.directory, { mode: 0o700 });
        }
        this.directoryFd = openSync(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
            const marker = this.path('owner-namespace.txt');
            let marked = false;
            try {
                marked = this.readPrivate(marker, 128).toString() === VERSION + '\n';
                need(marked, 'NAMESPACE_MARKER');
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
                need(requireDirectoryNames(this.directory).length === 0, 'FOREIGN_DIRECTORY');
                this.atomicNew('owner-namespace.txt', Buffer.from(VERSION + '\n'));
                marked = true;
            }
            need(marked, 'NAMESPACE_MARKER');
            const leasePath = this.path('writer.lock'), lease = openSync(leasePath, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
            try {
                const before = this.privateStat(lease);
                const result = spawnSync('/usr/bin/flock', ['-xn', '3'], { stdio: ['ignore', 'ignore', 'ignore', lease], timeout: 5000 });
                need(!result.error && result.status === 0, 'WRITER_EXISTS');
                const after = lstatSync(leasePath);
                need(before.dev === after.dev && before.ino === after.ino, 'WRITER_LOCK_CHANGED');
                this.writerFd = lease;
            }
            catch (e) {
                closeSync(lease);
                closeSync(this.directoryFd);
                throw e;
            }
            const path = this.path('state.json');
            let raw: Buffer | null = null;
            try {
                raw = this.readPrivate(path, MAX_STATE);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
            if (raw) {
                this.state = JSON.parse(raw.toString()) as State;
                need(this.state.version === VERSION && encode(this.state.policy) === encode(policy) && Array.isArray(this.state.diagnostics) && this.state.diagnostics.length <= 514 && Array.isArray(this.state.receipts) && this.state.receipts.length <= 256, 'STATE');
                this.state.evictedThroughAt ??= 0;
                this.state.requiresCriticalRecovery ??= false;
                this.state.refusalIntervals ??= [];
                this.state.refusalOpen = false;
                this.state.refusalIntervalsCoalesced ??= 0;
                this.state.optionalOmittedRecords ??= 0;
                this.state.optionalOmittedBytes ??= 0;
                this.validateState();
                for (const m of this.state.diagnostics)
                    this.retentionStarted.set(m.file, this.mono());
                const diagnostic = this.state.activeDiagnostic, essential = this.state.activeEssential;
                this.state.activeDiagnostic = null;
                this.state.activeEssential = null;
                this.recoverActive('diagnostic', diagnostic);
                this.recoverActive('essential', essential);
                this.seal('diagnostic', true);
                this.seal('essential', true);
                this.receipt('restart', { diagnosticsRetained: this.state.diagnostics.length, conservativeRetentionRestartMs: policy.minRetentionMs, financialFilesRead: false });
            }
            else {
                const names = requireDirectoryNames(this.directory).filter(n => !['owner-namespace.txt', 'writer.lock'].includes(n) && !/^checkpoint-[0-9]+-[a-f0-9-]+\.pending$/.test(n));
                need(names.length === 0, 'FOREIGN_DIRECTORY');
                const at = this.time();
                this.state = { version: VERSION, startedAt: at, policy, nextDiagnostic: 1, nextEssential: 1, diagnosticHead: ZERO, essentialHead: ZERO, activeDiagnostic: null, activeEssential: null, diagnostics: [], receiptAnchor: { throughSequence: 0, sha256: ZERO }, receipts: [], totalRecordedBytes: 0, retiredBytes: 0, protectedBytes: 0, refusedRecords: 0, refusedBytes: 0, optionalOmittedRecords: 0, optionalOmittedBytes: 0, nextReceipt: 1, lastAt: at, evictedThroughAt: 0, requiresCriticalRecovery: false, refusalIntervals: [], refusalOpen: false, refusalIntervalsCoalesced: 0 };
                this.receipt('created', { policy, financialFilesRead: false, protectedProofNeverEvicted: true });
            }
            this.refreshDisk(true);
            // Legacy retained bytes have unknown per-record purpose. Preserve
            // every one and reserve fresh capture room; never fake their age.
            if (this.continuousRotation)
                this.rebalanceCapacity(0, true);
            this.save();
        }
        catch (error) {
            for (const active of [this.diagnostic, this.essential])
                if (active)
                    try {
                        closeSync(active.fd);
                    }
                    catch { }
            if (this.writerFd !== null)
                try {
                    closeSync(this.writerFd);
                }
                catch { }
            try {
                closeSync(this.directoryFd);
            }
            catch { }
            throw error;
        }
    }
    private path(name: string) { return join('/proc/self/fd/' + this.directoryFd, name); }
    private time() { const n = this.now(); need(integer(n), 'CLOCK'); return n; }
    private privateStat(fd: number) { const s = fstatSync(fd); need(s.isFile() && s.uid === process.getuid?.() && s.nlink === 1 && (s.mode & 0o077) === 0, 'PRIVATE_FILE'); return s; }
    private readPrivate(path: string, maximum: number) {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const s = this.privateStat(fd);
            need(s.size <= maximum, 'FILE_BOUND');
            const b = readFileSync(fd);
            need(b.length === s.size, 'CHANGED_FILE');
            return b;
        }
        finally {
            closeSync(fd);
        }
    }
    private validateMeta(m: Meta, kind: 'diagnostic' | 'essential') { if(m.unusableTailBytes!==undefined)need(integer(m.unusableTailBytes),'UNUSABLE_TAIL_STATE'); if (m.invalidCommittedPrefix !== undefined)
        need(integer(m.invalidCommittedPrefix.expectedBytes) && sha(m.invalidCommittedPrefix.expectedSha256), 'COMMITTED_PREFIX_FAILURE_STATE'); need(new RegExp('^' + kind + '-[0-9]{12}\\.ndjson$').test(m.file) && integer(m.sequence) && integer(m.startedAt) && integer(m.endedAt) && integer(m.bytes) && m.bytes <= this.state.policy.segmentBytes && integer(m.records) && sha(m.previousSha256) && sha(m.lastRecordHash) && sha(m.prefixSha256), 'SEGMENT_STATE'); }
    private validateState() {
        const s = this.state;
        for (const k of ['startedAt', 'nextDiagnostic', 'nextEssential', 'totalRecordedBytes', 'retiredBytes', 'protectedBytes', 'refusedRecords', 'refusedBytes', 'optionalOmittedRecords', 'optionalOmittedBytes', 'nextReceipt', 'lastAt', 'evictedThroughAt'] as const)
            need(integer(s[k]), 'STATE_COUNTER');
        need(typeof s.requiresCriticalRecovery === 'boolean' && typeof s.refusalOpen === 'boolean' && integer(s.refusalIntervalsCoalesced) && Array.isArray(s.refusalIntervals) && s.refusalIntervals.length <= 128, 'CRITICAL_RECOVERY_STATE');
        for (const r of s.refusalIntervals)
            need(integer(r.fromAt) && integer(r.toAt) && r.fromAt <= r.toAt && integer(r.records) && r.records > 0 && integer(r.bytes), 'REFUSAL_INTERVAL');
        need(sha(s.diagnosticHead) && sha(s.essentialHead) && integer(s.receiptAnchor.throughSequence) && sha(s.receiptAnchor.sha256), 'STATE_HEAD');
        let previous = s.receiptAnchor.sha256, sequence = s.receiptAnchor.throughSequence;
        for (const r of s.receipts) {
            const { sha256, ...base } = r;
            need(r.sequence === ++sequence && r.previousSha256 === previous && sha256 === digest(encode(base)), 'RECEIPT_CHAIN');
            previous = sha256;
        }
        need(s.nextReceipt === sequence + 1, 'RECEIPT_SEQUENCE');
        const names = new Set<string>();
        for (const m of s.diagnostics) {
            this.validateMeta(m, 'diagnostic');
            need(sha(m.sha256) && !names.has(m.file), 'SEGMENT_HEAD');
            names.add(m.file);
            try {
                const fd = openSync(this.path(m.file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try {
                    need(this.privateStat(fd).size === m.bytes, 'SEGMENT_CHANGED');
                }
                finally {
                    closeSync(fd);
                }
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
                need(s.receipts.some(r => r.kind === 'diagnostic-retention-eviction' && (r.data as any)?.file === m.file && (r.data as any)?.sha256 === m.sha256), 'SEGMENT_MISSING');
                s.diagnostics = s.diagnostics.filter(v => v.file !== m.file);
                s.retiredBytes += m.bytes;
                s.evictedThroughAt = Math.max(s.evictedThroughAt, m.endedAt);
            }
        }
        for (const [kind, m] of [['diagnostic', s.activeDiagnostic], ['essential', s.activeEssential]] as const)
            if (m) {
                this.validateMeta(m, kind);
                need(!names.has(m.file), 'DUPLICATE_FILE');
            }
    }
    private write(fd: number, b: Buffer) {
        let offset = 0;
        while (offset < b.length) {
            const n = writeSync(fd, b, offset, b.length - offset);
            need(n > 0, 'SHORT_WRITE');
            offset += n;
        }
    }
    private activeMeta(a: Active | null) { return a ? { ...a.meta, prefixSha256: a.hash.copy().digest('hex') } : null; }
    private save() {
        this.state.activeDiagnostic = this.activeMeta(this.diagnostic);
        this.state.activeEssential = this.activeMeta(this.essential);
        this.state.lastAt = Math.max(this.state.lastAt, this.time());
        const body = Buffer.from(encode(this.state) + '\n');
        need(body.length <= MAX_STATE, 'STATE_BOUND');
        const p = this.path('checkpoint-' + process.pid + '-' + randomUUID() + '.pending');
        const fd = openSync(p, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
            this.privateStat(fd);
            this.write(fd, body);
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(p, this.path('state.json'));
        this.syncDirectory();
        this.optionalOmissionDirty = false;
        this.optionalOmissionLastCheckpoint = this.mono();
    }
    private syncDirectory() { fsyncSync(this.directoryFd); }
    private receipt(kind: string, data: unknown) {
        const at = this.time(), previous = this.state.receipts.at(-1)?.sha256 ?? this.state.receiptAnchor.sha256, base = { sequence: this.state.nextReceipt++, at, kind, data, previousSha256: previous }, r = { ...base, sha256: digest(encode(base)) };
        this.state.receipts.push(r);
        while (this.state.receipts.length > 256 || Buffer.byteLength(encode(this.state.receipts)) > 256 * 1024) {
            const old = this.state.receipts.shift()!;
            this.state.receiptAnchor = { throughSequence: old.sequence, sha256: old.sha256 };
        }
        this.save();
    }
    private open(kind: 'diagnostic' | 'essential') {
        const seq = kind === 'diagnostic' ? this.state.nextDiagnostic++ : this.state.nextEssential++, file = kind + '-' + String(seq).padStart(12, '0') + '.ndjson', head = kind === 'diagnostic' ? this.state.diagnosticHead : this.state.essentialHead, at = this.time(), meta: Meta = { file, sequence: seq, startedAt: at, endedAt: at, bytes: 0, records: 0, previousSha256: head, lastRecordHash: head, prefixSha256: digest('') }, a = { fd: openSync(this.path(file), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600), meta, hash: createHash('sha256') };
        if (kind === 'diagnostic')
            this.diagnostic = a;
        else
            this.essential = a;
        this.save();
        return a;
    }
    private seal(kind: 'diagnostic' | 'essential', recovered = false) {
        const a = kind === 'diagnostic' ? this.diagnostic : this.essential;
        if (!a)
            return;
        fsyncSync(a.fd);
        closeSync(a.fd);
        const m = { ...a.meta, sha256: a.hash.digest('hex') };
        m.prefixSha256 = m.sha256;
        if (kind === 'diagnostic') {
            this.diagnostic = null;
            this.state.activeDiagnostic = null;
            this.state.diagnosticHead = m.sha256;
            this.state.diagnostics.push(m);
            this.retentionStarted.set(m.file, this.mono());
        }
        else {
            this.essential = null;
            this.state.activeEssential = null;
            this.state.essentialHead = m.sha256;
            const body = Buffer.from(encode({ version: VERSION, kind: 'protected-essential', ...m }) + '\n');
            this.atomicNew(m.file + '.manifest.json', body);
            this.state.protectedBytes += body.length;
        }
        this.receipt(recovered ? 'recovered-segment' : 'sealed-segment', { kind, file: m.file, bytes: m.bytes, sha256: m.sha256, previousSha256: m.previousSha256, records: m.records, unusableTailBytes: m.unusableTailBytes ?? 0, invalidCommittedPrefix: m.invalidCommittedPrefix ?? null, historicalIncompleteProofNeverReclassified: true, fullEssentialBytesPreserved: kind === 'essential' && !m.invalidCommittedPrefix && !(m.unusableTailBytes ?? 0) });
    }
    private recoverActive(kind: 'diagnostic' | 'essential', m: Meta | null) {
        if (!m)
            return;
        this.validateMeta(m, kind);
        const raw = this.readPrivate(this.path(m.file), this.state.policy.segmentBytes);
        let head = m.previousSha256, records = 0, offset = 0, validBytes = 0;
        const prefixValid = raw.length >= m.bytes && digest(raw.subarray(0, m.bytes)) === m.prefixSha256;
        if (prefixValid)
            for (const line of raw.toString().split('\n')) {
                if (!line)
                    break;
                const length = Buffer.byteLength(line) + 1;
                if (offset + length > raw.length)
                    break;
                try {
                    const { recordSha256, ...base } = JSON.parse(line);
                    if (base.sequence !== records + 1 || base.previousRecordHash !== head || recordSha256 !== digest(encode(base)))
                        break;
                    records++;
                    head = recordSha256;
                    offset += length;
                    validBytes = offset;
                }
                catch {
                    break;
                }
            }
        const unusableTailBytes = raw.length - validBytes;
        // A zero-byte surviving file has no opaque tail, but can still have lost
        // a previously fsynced committed prefix. Preserve that distinct failure.
        const invalidCommittedPrefix = m.invalidCommittedPrefix ?? (!prefixValid ? { expectedBytes: m.bytes, expectedSha256: m.prefixSha256 } : undefined);
        if ((invalidCommittedPrefix || unusableTailBytes) && kind === 'essential')
            this.state.requiresCriticalRecovery = true;
        this.state.totalRecordedBytes += Math.max(0, raw.length - m.bytes);
        if (kind === 'essential')
            this.state.protectedBytes += Math.max(0, raw.length - m.bytes);
        const fd = openSync(this.path(m.file), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
        try {
            this.privateStat(fd);
        }
        catch (error) {
            closeSync(fd);
            throw error;
        }
        const a = { fd, meta: { ...m, bytes: raw.length, records, lastRecordHash: head, ...(unusableTailBytes ? { unusableTailBytes } : {}), ...(invalidCommittedPrefix ? { invalidCommittedPrefix } : {}) }, hash: createHash('sha256').update(raw) };
        if (kind === 'diagnostic')
            this.diagnostic = a;
        else
            this.essential = a;
    }
    private atomicNew(name: string, body: Buffer) {
        let fd: number;
        try {
            fd = openSync(this.path(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                throw e;
            need(this.readPrivate(this.path(name), MAX_STATE).equals(body), 'IMMUTABLE_MANIFEST_CHANGED');
            return;
        }
        try {
            this.write(fd, body);
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        this.syncDirectory();
    }
    private refreshDisk(force = false) {
        const mono = this.mono();
        if (!force && mono - this.diskCheckedMono < 1000)
            return;
        const named = lstatSync(this.directory), owned = fstatSync(this.directoryFd);
        need(named.isDirectory() && !named.isSymbolicLink() && named.dev === owned.dev && named.ino === owned.ino, 'DIRECTORY_REPLACED');
        const s = statfsSync(this.path('.'));
        this.availableBytes = s.bavail * s.bsize;
        this.diskCheckedMono = mono;
    }
    private retainedBytes() { return this.state.diagnostics.reduce((n, m) => n + m.bytes, 0) + (this.diagnostic?.meta.bytes ?? 0); }
    private diskCapacityLimit() {
        if (!this.continuousRotation)
            return this.state.policy.diagnosticBytes;
        const headroom = Math.max(0, this.availableBytes - 2 * this.reserve - this.pendingPinBytes);
        return Math.min(this.maximumDiagnosticBytes, this.state.policy.diagnosticBytes + Math.floor(headroom * this.capacityDiskFraction));
    }
    private rebalanceCapacity(incomingRequiredBytes: number, mayGrow: boolean) {
        if (!this.continuousRotation)
            return;
        const desired = Math.max(this.state.policy.diagnosticBytes, this.retainedBytes() + incomingRequiredBytes + 3 * this.state.policy.segmentBytes), permitted = this.diskCapacityLimit();
        this.effectiveDiagnosticBytes = mayGrow ? Math.min(permitted, Math.max(this.effectiveDiagnosticBytes, desired)) : Math.min(this.effectiveDiagnosticBytes, desired, permitted);
    }
    recordOutcome(): RecorderRecordOutcome { return {...this.lastOutcome}; }
    private omitOptional(bytes: number, reason: string) {
        this.state.optionalOmittedRecords++;
        this.state.optionalOmittedBytes += bytes;
        this.optionalOmissionDirty = true;
        // Optional tracing cannot create per-message fsync pressure. Counts are
        // included in ordinary checkpoints, maintenance and graceful close.
        if (this.mono() - this.optionalOmissionLastCheckpoint >= 1000)
            this.save();
        this.lastOutcome = {kind:'optional-capacity-omitted',reason};
        return false;
    }
    private refusal(bytes: number, reason: string) {
        this.lastOutcome = {kind:'unavailable',reason};
        const at = this.time();
        this.state.refusedRecords++;
        this.state.refusedBytes += bytes;
        const previous = this.state.refusalIntervals.at(-1);
        if (this.state.refusalOpen && previous) {
            previous.fromAt = Math.min(previous.fromAt, at);
            previous.toAt = Math.max(previous.toAt, at);
            previous.records++;
            previous.bytes += bytes;
        }
        else
            this.state.refusalIntervals.push({ fromAt: at, toAt: at, records: 1, bytes });
        this.state.refusalOpen = true;
        while (this.state.refusalIntervals.length > 128) {
            const a = this.state.refusalIntervals.shift()!, b = this.state.refusalIntervals.shift()!;
            this.state.refusalIntervals.unshift({ fromAt: Math.min(a.fromAt, b.fromAt), toAt: Math.max(a.toAt, b.toAt), records: a.records + b.records, bytes: a.bytes + b.bytes });
            this.state.refusalIntervalsCoalesced++;
        }
        try {
            if (this.pressure !== reason) {
                this.pressure = reason;
                this.receipt('record-refused', { reason, requiredInformationNotRetained: true, callerMustInvalidateCandidate: true });
            }
            else
                this.save();
        }
        catch {
            this.fatal = 'CHECKPOINT_UNAVAILABLE';
        }
        return false;
    }
    record(kind: string, data: unknown, options: {
        essential?: boolean;
        required?: boolean;
    } = {}): boolean {
        this.lastOutcome = {kind:'unavailable',reason:'RECORDER_UNAVAILABLE'};
        if (this.closed || this.closing)
            return false;
        if (this.fatal && !options.essential)
            return false;
        let raw: Buffer;
        try {
            need(typeof kind === 'string' && kind.length > 0 && kind.length <= 128 && !/[\u0000-\u001f]/.test(kind), 'EVENT_KIND');
            need((options.required === undefined || typeof options.required === 'boolean') && !(options.essential && options.required === false), 'ESSENTIAL_REQUIRES_REQUIRED');
            const role = options.essential ? 'essential' : 'diagnostic';
            this.refreshDisk();
            if (this.availableBytes < (options.essential ? this.reserve : 2 * this.reserve))
                return this.refusal(0, 'FILESYSTEM_RESERVE');
            let a = role === 'diagnostic' ? this.diagnostic : this.essential;
            const base = { schemaVersion: 1, sequence: (a?.meta.records ?? 0) + 1, receivedAt: new Date(this.time()).toISOString(), monotonicMs: this.mono(), kind, data, previousRecordHash: a?.meta.lastRecordHash ?? (role === 'diagnostic' ? this.state.diagnosticHead : this.state.essentialHead) }, line = () => Buffer.from(encode({ ...base, recordSha256: digest(encode(base)) }) + '\n');
            raw = line();
            if (raw.length > this.state.policy.segmentBytes) {
                if (options.required === false)
                    return this.omitOptional(raw.length, 'OPTIONAL_RECORD_BOUND');
                return this.refusal(raw.length, 'RECORD_BOUND');
            }
            if (role === 'diagnostic' && options.required === false && this.retainedBytes() + raw.length > Math.max(0, Math.min(this.state.policy.diagnosticBytes, this.effectiveDiagnosticBytes) - 3 * this.state.policy.segmentBytes))
                return this.omitOptional(raw.length, 'OPTIONAL_DIAGNOSTIC_HEADROOM');
            if (role === 'diagnostic' && options.required !== false)
                this.rebalanceCapacity(raw.length, true);
            if (role === 'diagnostic')
                this.state.refusalOpen = false;
            if (role === 'diagnostic' && this.retainedBytes() + raw.length > this.effectiveDiagnosticBytes) {
                void this.maintenance();
                return this.refusal(raw.length, 'YOUNG_DIAGNOSTIC_CAPACITY');
            }
            if (role === 'diagnostic' && (!a || a.meta.bytes + raw.length > this.state.policy.segmentBytes) && this.state.diagnostics.length >= 511) {
                if (options.required === false)
                    return this.omitOptional(raw.length, 'OPTIONAL_SEGMENT_CAPACITY');
                void this.maintenance();
                return this.refusal(raw.length, 'YOUNG_SEGMENT_CAPACITY');
            }
            if (a && a.meta.bytes + raw.length > this.state.policy.segmentBytes) {
                this.seal(role);
                a = null;
                base.sequence = 1;
                base.previousRecordHash = role === 'diagnostic' ? this.state.diagnosticHead : this.state.essentialHead;
                raw = line();
            }
            a ??= this.open(role);
            this.write(a.fd, raw);
            a.hash.update(raw);
            a.meta.bytes += raw.length;
            a.meta.records++;
            a.meta.endedAt = Math.max(a.meta.endedAt, this.time());
            a.meta.lastRecordHash = JSON.parse(raw.toString()).recordSha256;
            this.state.totalRecordedBytes += raw.length;
            if (role === 'essential') {
                this.state.protectedBytes += raw.length;
                fsyncSync(a.fd);
                this.save();
            }
            if (role === 'diagnostic')
                this.state.refusalOpen = false;
            if (role === 'diagnostic' && this.retainedBytes() <= this.effectiveDiagnosticBytes - this.state.policy.segmentBytes && this.state.diagnostics.length < 511)
                this.pressure = null;
            if (role === 'diagnostic' && (this.continuousRotation || this.retainedBytes() >= this.maintenanceTriggerBytes) && this.mono() - this.lastMaintenanceAt >= 1000)
                void this.maintenance();
            this.lastOutcome = {kind:'accepted',reason:null};
            return true;
        }
        catch {
            this.fatal = 'RECORD_IO_OR_INTEGRITY_FAILURE';
            this.lastOutcome = {kind:'unavailable',reason:this.fatal};
            return false;
        }
    }
    usage() {
        try {
            if (!this.closed)
                this.refreshDisk();
            this.rebalanceCapacity(0, false);
        }
        catch {
            this.fatal = 'FILESYSTEM_UNAVAILABLE';
        }
        const bytes = this.retainedBytes(), pressure = this.fatal ?? (this.availableBytes < 2 * this.reserve ? 'FILESYSTEM_RESERVE' : bytes > this.effectiveDiagnosticBytes - this.state.policy.segmentBytes ? 'DIAGNOSTIC_HEADROOM' : this.state.diagnostics.length >= 511 ? 'DIAGNOSTIC_SEGMENT_HEADROOM' : this.pressure);
        return { version: VERSION, candidateAdmissionAllowed: !this.closed && !this.closing && !this.state.requiresCriticalRecovery && !pressure, pressureReason: this.state.requiresCriticalRecovery ? 'INTERRUPTED_ESSENTIAL_PROOF' : pressure, requiresCriticalRecovery: this.state.requiresCriticalRecovery, diagnosticBytes: bytes, diagnosticLimitBytes: this.effectiveDiagnosticBytes, baseDiagnosticLimitBytes: this.state.policy.diagnosticBytes, maximumDiagnosticBytes: this.maximumDiagnosticBytes, continuousRotation: this.continuousRotation, capacityDiskFraction: this.capacityDiskFraction, diagnosticSegments: this.state.diagnostics.length + (this.diagnostic ? 1 : 0), maximumDiagnosticSegments: 512, minRetentionMs: this.state.policy.minRetentionMs, retiredBytes: this.state.retiredBytes, totalRecordedBytes: this.state.totalRecordedBytes, protectedBytes: this.state.protectedBytes, protectedBytesMeaning: 'Tracked completed raw proof, essential records and manifests; interrupted copies may add unaccounted bytes. Actual filesystem headroom is authoritative.', refusedRecords: this.state.refusedRecords, refusedBytes: this.state.refusedBytes, optionalOmittedRecords: this.state.optionalOmittedRecords, optionalOmittedBytes: this.state.optionalOmittedBytes, optionalOmissionsMeaning: 'Capacity omissions of explicitly optional diagnostics only; never trading-flow completeness or financial evidence.', refusalIntervals: this.state.refusalIntervals.map(r => ({ ...r })), refusalIntervalsCoalesced: this.state.refusalIntervalsCoalesced, availableDiskBytes: this.availableBytes, minimumDiskReserveBytes: this.reserve, pinOperations: this.pinTasks.size, protectedProofNeverEvicted: true, financialFilesRead: false, receiptAnchor: { ...this.state.receiptAnchor }, receiptHead: this.state.receipts.at(-1)?.sha256 ?? this.state.receiptAnchor.sha256, retainedReceipts: this.state.receipts.length };
    }
    async maintenance() {
        if (this.maintenanceTask)
            return this.maintenanceTask;
        this.lastMaintenanceAt = this.mono();
        const run = async () => {
            if (this.closed)
                return;
            const retire = this.retainedBytes() >= this.maintenanceTriggerBytes || this.state.diagnostics.length >= 511;
            let verifications = 0;
            for (const m of [...this.state.diagnostics]) {
                if ((!this.continuousRotation && (!retire || this.retainedBytes() <= this.maintenanceTargetBytes && this.state.diagnostics.length < 511)) || verifications >= 2)
                    break;
                if (this.pinned.has(m.file) || this.mono() - (this.retentionStarted.get(m.file) ?? this.mono()) < this.state.policy.minRetentionMs)
                    continue;
                // Streaming/hash verification remains real source-process work.
                // A bounded pass yields to protection and current capture even
                // when many historical segments become eligible together.
                verifications++;
                await this.verifyFile(m);
                if (this.pinned.has(m.file))
                    continue;
                this.receipt('diagnostic-retention-eviction', { file: m.file, bytes: m.bytes, sha256: m.sha256, retainedForAtLeastMs: this.state.policy.minRetentionMs, fromAt: m.startedAt, toAt: m.endedAt, fullEssentialProofNotEvicted: true });
                unlinkSync(this.path(m.file));
                this.state.diagnostics = this.state.diagnostics.filter(v => v.file !== m.file);
                this.state.retiredBytes += m.bytes;
                this.state.evictedThroughAt = Math.max(this.state.evictedThroughAt, m.endedAt);
                this.state.refusalIntervals = this.state.refusalIntervals.filter(r => r.toAt >= this.state.evictedThroughAt);
                this.retentionStarted.delete(m.file);
                this.save();
            }
            this.refreshDisk(true);
            this.rebalanceCapacity(0, false);
            if (this.retainedBytes() <= this.effectiveDiagnosticBytes - this.state.policy.segmentBytes && this.state.diagnostics.length < 511 && this.availableBytes >= 2 * this.reserve)
                this.pressure = null;
            if (this.optionalOmissionDirty)
                this.save();
        };
        const task = run().catch(() => { this.fatal = 'RETENTION_IO_OR_INTEGRITY_FAILURE'; });
        this.maintenanceTask = task;
        try {
            await task;
        }
        finally {
            this.maintenanceTask = null;
        }
    }
    private async verifyFile(m: Meta, destination?: string) {
        const source = this.path(m.file), fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let target: Awaited<ReturnType<typeof openAsync>> | null = null;
        try {
            const before = this.privateStat(fd);
            need(before.size === m.bytes && sha(m.sha256), 'SEGMENT_CHANGED');
            const h = createHash('sha256');
            let bytes = 0;
            if (destination)
                target = await openAsync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            for await (const chunk of createReadStream(source, { fd, autoClose: false, highWaterMark: 65536 })) {
                const b = chunk as Buffer;
                bytes += b.length;
                need(bytes <= m.bytes, 'COPY_BOUND');
                h.update(b);
                if (target) {
                    let offset = 0;
                    while (offset < b.length) {
                        const r = await target.write(b, offset, b.length - offset);
                        need(r.bytesWritten > 0, 'COPY_SHORT_WRITE');
                        offset += r.bytesWritten;
                    }
                }
            }
            const after = this.privateStat(fd), named = lstatSync(source);
            need(!named.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && named.ino === before.ino && named.dev === before.dev && bytes === m.bytes && h.digest('hex') === m.sha256, 'SEGMENT_CHANGED');
            if (target)
                await target.sync();
        }
        finally {
            if (target)
                await target.close();
            closeSync(fd);
        }
    }
    private privateProofDirectory(directory: string) { const s = lstatSync(directory); need(s.isDirectory() && !s.isSymbolicLink() && s.uid === process.getuid?.() && (s.mode & 0o077) === 0, 'PRIVATE_PROOF_DIRECTORY'); }
    private requiredProofFailure(fromAt: number, toAt: number, afterRefusedRecords?: number) {
        return this.fatal ? 'RECORDER_INTEGRITY_UNAVAILABLE' : (afterRefusedRecords === undefined || this.state.refusedRecords > afterRefusedRecords) && this.state.refusalIntervals.some(r => r.fromAt <= toAt && r.toAt >= fromAt) ? 'RANGE_CONTAINS_REFUSAL' : null;
    }
    private async stageProofManifest(directory: string, raw: Buffer) {
        const pending = join(directory, 'manifest-' + randomUUID() + '.pending'), target = await openAsync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
            await target.writeFile(raw);
            await target.sync();
        }
        finally {
            await target.close();
        }
        return pending;
    }
    private trackPin(id: string, fromAt: number, toAt: number, task: Promise<EvidencePinResult>) { this.pinTasks.add(task); this.pinById.set(id, { fromAt, toAt, task }); void task.then(() => { this.pinTasks.delete(task); this.pinById.delete(id); }, () => { this.pinTasks.delete(task); this.pinById.delete(id); }); return task; }
    pinRecent(proofId: string) { return this.pinRange(proofId, Math.max(this.state.startedAt, this.time() - this.state.policy.minRetentionMs), this.time()); }
    pinRange(proofId: string, fromAt: number, toAt: number): Promise<EvidencePinResult> {
        need(typeof proofId === 'string' && proofId.length > 0 && proofId.length <= 256 && !/[\u0000-\u001f]/.test(proofId) && integer(fromAt) && integer(toAt) && fromAt <= toAt && toAt <= this.time(), 'PIN_RANGE');
        const failed = (reason: string): EvidencePinResult => ({ complete: false, proofId, files: [], bytes: 0, manifestSha256: null, reason });
        if (this.closed || this.closing)
            return Promise.resolve(failed('CLOSED'));
        if (this.fatal)
            return Promise.resolve(failed('RECORDER_INTEGRITY_UNAVAILABLE'));
        const id = digest(proofId), pending = this.pinById.get(id);
        if (pending)
            return pending.fromAt === fromAt && pending.toAt === toAt ? pending.task : Promise.resolve(failed('PROOF_ID_CONFLICT'));
        if (this.pinTasks.size >= 3)
            return Promise.resolve(failed('PIN_CAPACITY'));
        const prefix = 'proof-' + id, dir = this.path(prefix);
        let existing: Buffer | null = null;
        try {
            this.privateProofDirectory(dir);
            try {
                existing = this.readPrivate(join(dir, 'manifest.json'), MAX_STATE);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                return Promise.resolve(failed('PRIVATE_PROOF_DIRECTORY'));
        }
        if (existing) {
            const raw = existing, refusedBeforeRevalidation = this.state.refusedRecords;
            const verify = async () => {
                try {
                    const old = JSON.parse(raw.toString());
                    need(old.version === VERSION && old.proofId === proofId && old.fromAt === fromAt && old.toAt === toAt && old.complete === true && Array.isArray(old.files) && old.files.length <= 514 && integer(old.bytes) && old.bytes <= this.maximumDiagnosticBytes && old.bytes === old.files.reduce((n: number, m: Meta) => n + m.bytes, 0), 'PROOF_ID_CONFLICT');
                    if (old.optionalDiagnostics !== undefined)
                        need(integer(old.optionalDiagnostics.omittedRecords) && integer(old.optionalDiagnostics.omittedBytes) && old.optionalDiagnostics.requiredTradingFlowUnaffected === true, 'PROOF_OPTIONAL_DIAGNOSTICS');
                    for (const m of old.files) {
                        this.validateMeta(m, 'diagnostic');
                        need(sha(m.sha256), 'PROOF_HASH');
                        need(!m.invalidCommittedPrefix && !(m.unusableTailBytes ?? 0), 'PROOF_UNUSABLE');
                        await this.verifyFile({ ...m, file: join(prefix, m.file) });
                    }
                    // An immutable earlier proof is not rewritten by later
                    // failures sharing its millisecond timestamp. Failures
                    // newly arising during this verification still fail closed.
                    const revalidationFailure = this.requiredProofFailure(fromAt, toAt, refusedBeforeRevalidation);
                    if (revalidationFailure)
                        return failed(revalidationFailure);
                    need(this.record('qualification-proof-revalidated', { proofId, fromAt, toAt, manifestSha256: digest(raw), fullBytesRetained: true }, { essential: true }), 'PIN_REFERENCE_NOT_DURABLE');
                    return { complete: true, proofId, files: old.files.map((m: Meta) => join(prefix, m.file)), bytes: old.bytes, manifestSha256: digest(raw) };
                }
                catch {
                    return failed('PIN_IO_OR_INTEGRITY_FAILURE');
                }
            };
            return this.trackPin(id, fromAt, toAt, verify());
        }
        this.seal('diagnostic');
        const selected = this.state.diagnostics.filter(m => m.startedAt <= toAt && m.endedAt >= fromAt);
        const rangeFailure = () => this.requiredProofFailure(fromAt, toAt) ?? (fromAt <= this.state.evictedThroughAt || selected.some(m => !!m.invalidCommittedPrefix || (m.unusableTailBytes ?? 0) > 0) || fromAt < this.state.startedAt || !selected.length || fromAt < Math.min(...this.state.diagnostics.map(m => m.startedAt)) ? 'RANGE_NOT_RETAINED' : null);
        const initialFailure = rangeFailure();
        if (initialFailure)
            return Promise.resolve(failed(initialFailure));
        for (const m of selected)
            this.pinned.set(m.file, (this.pinned.get(m.file) ?? 0) + 1);
        const required = selected.reduce((n, m) => n + m.bytes, 0);
        let reserved = false;
        const run = async (): Promise<EvidencePinResult> => {
            const files: string[] = [];
            let bytes = 0;
            try {
                this.refreshDisk(true);
                if (this.availableBytes < required + this.pendingPinBytes + 2 * this.reserve)
                    return failed('FILESYSTEM_RESERVE');
                this.pendingPinBytes += required;
                reserved = true;
                try {
                    mkdirSync(dir, { mode: 0o700 });
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
                        throw e;
                }
                this.privateProofDirectory(dir);
                for (const m of selected) {
                    const target = join(dir, m.file);
                    let alreadyPresent = false;
                    try {
                        const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                        try {
                            need(this.privateStat(fd).size === m.bytes, 'INCOMPLETE_PIN_COPY');
                            alreadyPresent = true;
                        }
                        finally {
                            closeSync(fd);
                        }
                    }
                    catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                            throw e;
                    }
                    if (alreadyPresent)
                        await this.verifyFile({ ...m, file: join(prefix, m.file) });
                    else
                        await this.verifyFile(m, target);
                    files.push(join(prefix, m.file));
                    bytes += m.bytes;
                }
                const copiedFailure = rangeFailure();
                if (copiedFailure)
                    return failed(copiedFailure);
                const manifest = { version: VERSION, proofId, fromAt, toAt, complete: true, bytes, files: selected.map(m => ({ ...m })), optionalDiagnostics: {omittedRecords:this.state.optionalOmittedRecords,omittedBytes:this.state.optionalOmittedBytes,requiredTradingFlowUnaffected:true,meaning:'Cumulative capacity omissions of caller-declared optional diagnostics, not missing executed trading flow. Mandatory refusal intervals still invalidate this proof range.'}, meaning: 'Full raw recorded segments intersecting the requested available-information interval; qualification still requires its independent data contract and original timestamps.' }, raw = Buffer.from(encode(manifest) + '\n');
                need(raw.length <= MAX_STATE, 'PROOF_MANIFEST_BOUND');
                // Capture can record a required refusal or integrity failure
                // during either awaited raw copying or manifest I/O. Keep the
                // staged bytes for diagnosis; only publish the accepted name
                // after the final check, with no yield before its durable
                // reference. Optional omissions never enter this gap check.
                const pendingManifest = await this.stageProofManifest(dir, raw);
                const d = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
                try {
                    const publicationFailure = rangeFailure();
                    if (publicationFailure)
                        return failed(publicationFailure);
                    const acceptedName = join(dir, 'manifest.json'), accepted = openSync(acceptedName, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
                    closeSync(accepted);
                    renameSync(pendingManifest, acceptedName);
                    fsyncSync(d);
                }
                finally {
                    closeSync(d);
                }
                this.state.protectedBytes += bytes + raw.length;
                need(this.record('qualification-proof-pinned', { proofId, fromAt, toAt, files, bytes, manifestSha256: digest(raw), fullBytesRetained: true }, { essential: true }), 'PIN_REFERENCE_NOT_DURABLE');
                this.receipt('qualification-proof-pinned', { proofId, fromAt, toAt, files, bytes, manifestSha256: digest(raw), fullBytesRetained: true });
                return { complete: true, proofId, files, bytes, manifestSha256: digest(raw) };
            }
            catch {
                return { ...failed('PIN_IO_OR_INTEGRITY_FAILURE'), files, bytes };
            }
            finally {
                for (const m of selected) {
                    const remaining = (this.pinned.get(m.file) ?? 1) - 1;
                    if (remaining)
                        this.pinned.set(m.file, remaining);
                    else
                        this.pinned.delete(m.file);
                }
                if (reserved)
                    this.pendingPinBytes -= required;
            }
        };
        return this.trackPin(id, fromAt, toAt, run());
    }
    resolveCriticalRecovery(verification: {
        financialRevision: number;
        evidence: string;
    }) {
        need(integer(verification.financialRevision) && typeof verification.evidence === 'string' && verification.evidence.length > 0 && verification.evidence.length <= 1024, 'RECOVERY_VERIFICATION');
        if (!this.state.requiresCriticalRecovery)
            return true;
        if (!this.record('critical-evidence-recovery-verification', { at: this.time(), ...verification, historicalIncompleteProofRemainsUnavailable: true }, { essential: true }))
            return false;
        this.state.requiresCriticalRecovery = false;
        try {
            this.receipt('critical-evidence-recovery-acknowledged', { ...verification, historicalIncompleteProofRemainsUnavailable: true });
            return true;
        }
        catch {
            this.state.requiresCriticalRecovery = true;
            this.fatal = 'RECOVERY_CHECKPOINT_UNAVAILABLE';
            return false;
        }
    }
    async close() {
        if (this.closed)
            return;
        this.closing = true;
        await Promise.allSettled([...this.pinTasks]);
        if (this.maintenanceTask)
            await this.maintenanceTask;
        this.seal('diagnostic');
        this.seal('essential');
        this.receipt('closed', { protectedProofNeverEvicted: true });
        this.closed = true;
        closeSync(this.directoryFd);
        if (this.writerFd !== null) {
            closeSync(this.writerFd);
            this.writerFd = null;
        }
    }
}
import { readdirSync as requireDirectoryNames } from 'node:fs';
