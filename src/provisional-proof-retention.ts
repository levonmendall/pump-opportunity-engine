import { constants, openSync, closeSync, fstatSync, lstatSync, fsyncSync, readFileSync, writeSync, readdirSync, opendirSync, unlinkSync, rmdirSync, renameSync, type Dir } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';

/** Only newly and explicitly provisional proof copies enter this lifecycle.
 * Original proof manifests and all legacy proof directories remain immutable.
 * The caller must protect a proof synchronously before its first financial use. */
export const PROVISIONAL_PROOF_GRACE_MS = 24 * 60 * 60 * 1000;
export const UNUSED_PROOF_GRACE_MS = 60 * 1000;
const VERSION = 'poe-provisional-proof-v1', LIMIT = 1024 * 1024;
const idOf = (id: string) => createHash('sha256').update(id).digest('hex');
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const need = (ok: unknown, code: string) => { if (!ok) throw Error('PROVISIONAL_PROOF_' + code); };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const identity = (s: ReturnType<typeof fstatSync>) => ({ dev: s.dev, ino: s.ino });
type Policy = { version: typeof VERSION; proofId: string; createdAt: number; deadlineAt: number; expiresAt: number; files: string[] };
type Retirement = { version: typeof VERSION; proofId: string; startedAt: number; files: string[]; bytes: number; accountedBytes: number };
export type RetiredProvisionalProof = { proofId: string; bytes: number; accountedBytes: number };
export type ProtectedProofReference = { manifestSha256: string; preparationRecords: number; referenceSha256: string | null; legacy: boolean };

export class ProvisionalProofRetention {
    private cursor: Dir | null = null;
    private retiring: string | null = null;
    private retiringOffset = 0;
    private lastSweepAt: number | null = null;
    private lastCompletedSweepAt: number | null = null;
    private skipped = 0;
    private lastFailure: string | null = null;
    private sweepHadFailure = false;
    constructor(private readonly root: string, private readonly now: () => number) {}
    private name(id: string) { need(typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\u0000-\u001f]/.test(id), 'ID'); return 'proof-' + idOf(id); }
    private open(name: string) {
        need(/^proof-[a-f0-9]{64}$/.test(name), 'DIRECTORY_NAME');
        const fd = openSync(join(this.root, name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { const s = fstatSync(fd); need(s.isDirectory() && s.uid === process.getuid?.() && (s.mode & 0o077) === 0, 'PRIVATE_DIRECTORY'); return fd; }
        catch (e) { closeSync(fd); throw e; }
    }
    private path(fd: number, file: string) { need(!file.includes('/') && file !== '.' && file !== '..', 'FILE_NAME'); return join('/proc/self/fd/' + fd, file); }
    private stat(fd: number) { const s = fstatSync(fd); need(s.isFile() && s.uid === process.getuid?.() && s.nlink === 1 && (s.mode & 0o077) === 0, 'PRIVATE_FILE'); return s; }
    private read(fd: number, file: string): Buffer | null {
        let fileFd: number;
        try { fileFd = openSync(this.path(fd, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch (error) { if (missing(error)) return null; throw error; }
        try { const s = this.stat(fileFd); need(s.size <= LIMIT, 'FILE_BOUND'); const raw = readFileSync(fileFd); need(raw.length === s.size, 'CHANGED_FILE'); return raw; }
        finally { closeSync(fileFd); }
    }
    /** Immutable marker publication: contents and directory entry are durable
     * before returning. Existing markers are never overwritten or truncated. */
    private create(fd: number, file: string, body: unknown, maximum = LIMIT) {
        const raw = Buffer.from(JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? value.toString() : value) + '\n');
        return this.createRaw(fd, file, raw, maximum);
    }
    private createRaw(fd: number, file: string, raw: Buffer, maximum = LIMIT) {
        need(raw.length <= maximum, 'FILE_BOUND');
        need(this.read(fd, file) === null, 'MARKER_ALREADY_EXISTS');
        const pending = 'retention-' + randomUUID() + '.pending';
        const target = openSync(this.path(fd, pending), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { this.stat(target); let offset = 0; while (offset < raw.length) { const n = writeSync(target, raw, offset, raw.length - offset); need(n > 0, 'SHORT_WRITE'); offset += n; } fsyncSync(target); }
        finally { closeSync(target); }
        // Recorder's exclusive namespace lease and this synchronous operation
        // prevent another lifecycle writer between the absent check and rename.
        renameSync(this.path(fd, pending), this.path(fd, file));
        fsyncSync(fd);
        return raw.length;
    }
    private policy(fd: number, name: string): Policy | null {
        const raw = this.read(fd, 'retention.json'); if (!raw) return null;
        const p = JSON.parse(raw.toString()) as Policy;
        need(p.version === VERSION && this.name(p.proofId) === name && integer(p.createdAt) && integer(p.deadlineAt) && p.deadlineAt >= p.createdAt && integer(p.expiresAt) && p.expiresAt === p.deadlineAt + PROVISIONAL_PROOF_GRACE_MS && Array.isArray(p.files) && p.files.length <= 514 && new Set(p.files).size === p.files.length && p.files.every(f => /^diagnostic-[0-9]{12}\.ndjson$/.test(f)), 'POLICY');
        return p;
    }
    /** Called only for a newly created proof directory, before any copied data. */
    createProvisional(proofId: string, deadlineAt: number, files: string[]) {
        const createdAt = this.now(); need(integer(createdAt) && integer(deadlineAt) && deadlineAt >= createdAt && Number.isSafeInteger(deadlineAt + PROVISIONAL_PROOF_GRACE_MS), 'DEADLINE');
        const name = this.name(proofId), fd = this.open(name);
        try {
            need(readdirSync('/proc/self/fd/' + fd).length === 0, 'NEW_DIRECTORY_REQUIRED');
            need(Array.isArray(files) && files.length <= 514 && new Set(files).size === files.length && files.every(f => /^diagnostic-[0-9]{12}\.ndjson$/.test(f)), 'FILES');
            this.create(fd, 'retention.json', { version: VERSION, proofId, createdAt, deadlineAt, expiresAt: deadlineAt + PROVISIONAL_PROOF_GRACE_MS, files } satisfies Policy);
        } finally { closeSync(fd); }
    }
    /** A legacy call is permanent. Reusing a provisional ID through that older
     * API promotes it before revalidation so no caller can unknowingly expire it. */
    protect(proofId: string, reference: string): ProtectedProofReference {
        need(typeof reference === 'string' && reference.length > 0 && reference.length <= 256 && !/[\u0000-\u001f]/.test(reference), 'REFERENCE');
        const name = this.name(proofId), fd = this.open(name);
        try {
            need(!this.read(fd, 'retiring.json'), 'RETIRING');
            const raw = this.read(fd, 'manifest.json'); need(raw, 'COMPLETE_MANIFEST_REQUIRED');
            const manifest = JSON.parse(raw!.toString());
            need(manifest.proofId === proofId && manifest.complete === true && integer(manifest.bytes) && Array.isArray(manifest.files), 'COMPLETE_MANIFEST_REQUIRED');
            if (!this.policy(fd, name)) return { manifestSha256: idOf(raw!.toString()), preparationRecords: 0, referenceSha256: null, legacy: true }; // Legacy never became disposable.
            const old = this.read(fd, 'trade-reference.json');
            if (old) { const p = JSON.parse(old.toString()); need(p.version === VERSION && p.proofId === proofId && typeof p.reference === 'string' && p.manifestSha256 === idOf(raw!.toString()) && Array.isArray(p.preparationFiles) && p.preparationFiles.length <= 4096 && p.preparationFiles.every((f: { file: string; sha256: string }) => typeof f?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(f.sha256) && f.file === 'preparation-' + f.sha256 + '.json'), 'PROTECTION_MARKER'); return { manifestSha256: p.manifestSha256, preparationRecords: p.preparationFiles.length, referenceSha256: idOf(old.toString()), legacy: false }; }
            const preparationFiles = readdirSync('/proc/self/fd/' + fd).filter(file => /^preparation-[a-f0-9]{64}\.json$/.test(file)).sort().map(file => ({ file, sha256: file.slice('preparation-'.length, -'.json'.length) }));
            need(preparationFiles.length <= 4096, 'PREPARATION_MANIFEST_BOUND');
            const manifestSha256 = idOf(raw!.toString()), body = Buffer.from(JSON.stringify({ version: VERSION, proofId, reference, at: this.now(), manifestSha256, preparationFiles, meaning: 'Complete immutable preparation records at first financial reservation; later events use the permanent essential recorder.' }) + '\n');
            this.createRaw(fd, 'trade-reference.json', body);
            return { manifestSha256, preparationRecords: preparationFiles.length, referenceSha256: idOf(body.toString()), legacy: false };
        } finally { closeSync(fd); }
    }
    /** A positive trade marker always wins over an unused marker. */
    releaseUnused(proofId: string): boolean {
        const name = this.name(proofId), fd = this.open(name);
        try {
            if (!this.policy(fd, name) || this.read(fd, 'trade-reference.json') || this.read(fd, 'retiring.json')) return false;
            if (!this.read(fd, 'unused.json')) this.create(fd, 'unused.json', { version: VERSION, proofId, at: this.now(), reason: 'candidate-completed-without-financial-attempt' });
            return true;
        } finally { closeSync(fd); }
    }
    /** Full decision inputs generated after the initial range copy are kept
     * alongside it. One immutable record per event avoids a mutable audit chain
     * and permits identical ownership/retirement of all preparation evidence. */
    appendEvidence(proofId: string, kind: string, data: unknown): number | null {
        need(typeof kind === 'string' && kind.length > 0 && kind.length <= 256 && !/[\u0000-\u001f]/.test(kind), 'EVENT_KIND');
        const name = this.name(proofId), fd = this.open(name);
        try {
            if (!this.policy(fd, name) || this.read(fd, 'trade-reference.json')) return null;
            need(!this.read(fd, 'retiring.json'), 'RETIRING');
            const event = { version: VERSION, proofId, recordId: randomUUID(), at: this.now(), kind, data };
            const raw = JSON.stringify(event, (_key, value) => typeof value === 'bigint' ? value.toString() : value) + '\n';
            return this.createRaw(fd, 'preparation-' + idOf(raw) + '.json', Buffer.from(raw), 8 * LIMIT);
        } finally { closeSync(fd); }
    }
    /** Pin reuse cannot resurrect a copy already entering retirement. */
    assertUsable(proofId: string) {
        const name = this.name(proofId); let fd: number;
        try { fd = this.open(name); } catch (e) { if (missing(e)) return; throw e; }
        try { need(!this.read(fd, 'retiring.json'), 'RETIRING'); this.policy(fd, name); }
        finally { closeSync(fd); }
    }
    private async retirement(fd: number, name: string, isActive: (name: string) => boolean): Promise<Retirement | null> {
        const policy = this.policy(fd, name); if (!policy || this.read(fd, 'trade-reference.json')) return null;
        const existing = this.read(fd, 'retiring.json');
        if (existing) {
            const r = JSON.parse(existing.toString()) as Retirement;
            need(r.version === VERSION && r.proofId === policy.proofId && integer(r.startedAt) && integer(r.bytes) && integer(r.accountedBytes) && Array.isArray(r.files) && r.files.length <= 4096 && new Set(r.files).size === r.files.length && r.files.every(f => this.owned(f, policy)), 'RETIREMENT');
            return r;
        }
        const unused = this.read(fd, 'unused.json');
        if (unused) { const u = JSON.parse(unused.toString()); need(u.version === VERSION && u.proofId === policy.proofId && integer(u.at) && u.reason === 'candidate-completed-without-financial-attempt', 'UNUSED_MARKER'); if (this.now() < Math.max(policy.deadlineAt, u.at) + UNUSED_PROOF_GRACE_MS) return null; }
        if (!unused && this.now() < policy.expiresAt) return null;
        const before = fstatSync(fd), names: string[] = [], entries = opendirSync('/proc/self/fd/' + fd);
        let bytes = 0, preparationBytes = 0;
        try {
            for (;;) {
                const entry = entries.readSync(); if (!entry) break;
                const file = entry.name; need(names.length < 4096 && this.owned(file, policy), 'UNRECOGNIZED_FILE'); names.push(file);
                const f = openSync(this.path(fd, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try { const s = this.stat(f); need(s.size <= (/^(diagnostic-|preparation-)/.test(file) ? 8 * LIMIT : LIMIT), 'FILE_BOUND'); bytes += s.size; if (/^preparation-/.test(file)) preparationBytes += s.size; }
                finally { closeSync(f); }
                if (names.length % 16 === 0) {
                    await yieldEventLoop();
                    if (isActive(name) || this.read(fd, 'trade-reference.json')) return null;
                }
            }
        } finally { entries.closeSync(); }
        // A pin, late preparation append or permanent promotion may run during
        // the cooperative inventory yields. Restart planning instead of using
        // a partial/stale inventory; no file has been deleted at this point.
        const after = fstatSync(fd);
        if (isActive(name) || this.read(fd, 'trade-reference.json') || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return null;
        let accountedBytes = preparationBytes; const manifest = this.read(fd, 'manifest.json');
        if (manifest) { const m = JSON.parse(manifest.toString()); need(m.proofId === policy.proofId && m.complete === true && integer(m.bytes), 'MANIFEST'); accountedBytes += m.bytes + manifest.length; }
        const r: Retirement = { version: VERSION, proofId: policy.proofId, startedAt: this.now(), files: names.filter(f => f !== 'retention.json'), bytes, accountedBytes };
        this.create(fd, 'retiring.json', r);
        return r;
    }
    private owned(file: string, policy: Policy) { return policy.files.includes(file) || ['retention.json', 'manifest.json', 'unused.json'].includes(file) || /^preparation-[a-f0-9]{64}\.json$/.test(file) || /^(manifest|retention)-[a-f0-9-]{36}\.pending$/.test(file); }
    private async remove(name: string, isActive: (name: string) => boolean): Promise<RetiredProvisionalProof | null> {
        const fd = this.open(name), before = identity(fstatSync(fd));
        try {
            const r = await this.retirement(fd, name, isActive); if (!r) { this.retiring = null; this.retiringOffset = 0; return null; }
            if (this.retiring !== name) this.retiringOffset = 0;
            this.retiring = name;
            // At most two files are removed per maintenance pass. No hash scan,
            // recursive removal, financial file access, or raw-source mutation.
            let removed = 0, scanned = 0;
            for (; this.retiringOffset < r.files.length;) {
                if (scanned++ >= 32) { if (removed) fsyncSync(fd); return null; }
                const file = r.files[this.retiringOffset++]!;
                const path = this.path(fd, file); let fileFd: number;
                try { fileFd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
                catch (e) { if (missing(e)) continue; throw e; }
                try { const original = this.stat(fileFd), named = lstatSync(path); need(original.ino === named.ino && original.dev === named.dev && !named.isSymbolicLink(), 'CHANGED_FILE'); unlinkSync(path); }
                finally { closeSync(fileFd); }
                if (++removed >= 2) { fsyncSync(fd); return null; }
            }
            // Final metadata removal gets its own two-unlink chunk.
            if (removed) { fsyncSync(fd); return null; }
            const names = readdirSync('/proc/self/fd/' + fd); need(names.every(f => f === 'retention.json' || f === 'retiring.json'), 'UNRECOGNIZED_FILE');
            const named = lstatSync(join(this.root, name)); need(!named.isSymbolicLink() && named.ino === before.ino && named.dev === before.dev, 'CHANGED_DIRECTORY');
            unlinkSync(this.path(fd, 'retiring.json'));
            unlinkSync(this.path(fd, 'retention.json'));
            fsyncSync(fd);
            rmdirSync(join(this.root, name));
            const parent = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(parent); } finally { closeSync(parent); }
            this.retiring = null;
            this.retiringOffset = 0;
            return { proofId: r.proofId, bytes: r.bytes, accountedBytes: r.accountedBytes };
        } finally { closeSync(fd); }
    }
    /** Scan a bounded number of directory entries, then retire at most one
     * proof in bounded file batches. Pending copy/revalidation always wins. */
    async sweep(isActive: (proofDirectory: string) => boolean): Promise<RetiredProvisionalProof | null> {
        this.lastSweepAt = this.now();
        try {
            if (this.retiring) return isActive(this.retiring) ? null : await this.remove(this.retiring, isActive);
            this.cursor ??= opendirSync(this.root);
            for (let count = 0; count < 32; count++) {
                const entry = this.cursor.readSync();
                if (!entry) { this.cursor.closeSync(); this.cursor = null; this.lastCompletedSweepAt = this.now(); if (!this.sweepHadFailure) this.lastFailure = null; this.sweepHadFailure = false; return null; }
                if (!/^proof-[a-f0-9]{64}$/.test(entry.name) || isActive(entry.name)) continue;
                const retired = await this.remove(entry.name, isActive); if (retired || this.retiring) return retired;
            }
            return null;
        } catch (error) {
            // A malformed/foreign item is a cleanup warning, never permission
            // to delete it or to interrupt protection of existing positions.
            this.skipped++; this.sweepHadFailure = true; this.lastFailure = error instanceof Error && /^PROVISIONAL_PROOF_[A-Z_]+$/.test(error.message) ? error.message : 'PROVISIONAL_PROOF_IO_UNAVAILABLE'; this.retiring = null; this.retiringOffset = 0;
            return null;
        }
    }
    usage() { return { policy: VERSION, abandonedGraceMs: PROVISIONAL_PROOF_GRACE_MS, unusedGraceMs: UNUSED_PROOF_GRACE_MS, lastSweepAt: this.lastSweepAt, lastCompletedSweepAt: this.lastCompletedSweepAt, skipped: this.skipped, lastFailure: this.lastFailure, retiring: this.retiring !== null, legacyProofsPreserved: true, tradeLinkedProofsPreserved: true }; }
    close() { this.cursor?.closeSync(); this.cursor = null; }
}
