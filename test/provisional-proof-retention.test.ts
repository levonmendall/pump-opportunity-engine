import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, unlinkSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BoundedRotatingRecorder } from '../src/retained-recorder.js';
import { PROVISIONAL_PROOF_GRACE_MS, UNUSED_PROOF_GRACE_MS } from '../src/provisional-proof-retention.js';

const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'poe-OFFLINE-proof-expiry-')), directory = join(root, 'evidence');
    let at = 1_000_000, mono = 0;
    const options = { directory, segmentBytes: 4096, diagnosticBytes: 131072, minRetentionMs: 300000, minimumDiskReserveBytes: 0, now: () => at, monotonic: () => mono };
    return { root, directory, open: () => new BoundedRotatingRecorder(options), get at() { return at; }, advance(n: number) { at += n; mono += n; }, proof(id: string) { return join(directory, 'proof-' + hash(id)); } };
}
async function sweep(r: BoundedRotatingRecorder, passes = 50) { for (let i = 0; i < passes; i++) await r.maintenance(); }
async function prepare(f: ReturnType<typeof fixture>, r: BoundedRotatingRecorder, id = 'candidate-window', packets = 1) {
    const from = f.at; for (let i = 0; i < packets; i++) assert.equal(r.record('required-market-flow', { signature: 'packet-' + i, exact: 'x'.repeat(1500) }), true);
    const deadline = f.at + 5000, result = await r.pinProvisionalRange(id, from, f.at, deadline); assert.equal(result.complete, true, result.reason);
    return { result, from, deadline, id };
}

test('abandoned provisional copies expire after their deadline and grace; legacy evidence remains permanent', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r);
    const legacy = await r.pinRange('legacy-trade-proof', p.from, p.from); assert.equal(legacy.complete, true);
    f.advance(5000 + PROVISIONAL_PROOF_GRACE_MS - 1); await sweep(r); assert.ok(existsSync(f.proof(p.id)));
    f.advance(1); await sweep(r); assert.equal(existsSync(f.proof(p.id)), false); assert.ok(existsSync(f.proof('legacy-trade-proof')));
    assert.equal(r.usage().provisionalProofRetention.retiredProofs, 1); assert.ok(r.usage().provisionalProofRetention.retiredBytes > p.result.bytes);
    assert.equal(r.usage().candidateAdmissionAllowed, true); await r.close();
});

test('unused release respects the qualification deadline and grace, then removes copies only', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r);
    assert.equal(r.releaseUnusedProof(p.id), true); f.advance(5000 + UNUSED_PROOF_GRACE_MS - 1); await sweep(r); assert.ok(existsSync(f.proof(p.id)));
    const original = readdirSync(f.directory).filter(x => /^diagnostic-.*ndjson$/.test(x)); assert.ok(original.length);
    f.advance(1); await sweep(r); assert.equal(existsSync(f.proof(p.id)), false);
    for (const file of original) assert.ok(existsSync(join(f.directory, file)), 'provisional expiry cannot delete recorder-owned raw source');
    await r.close();
});

test('promotion after an unused marker protects exact trade and preparation evidence through expiry and restart', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r);
    const manifest = readFileSync(join(f.proof(p.id), 'manifest.json'));
    assert.equal(r.appendProvisionalEvidence(p.id, 'sdk-entry-cost-plan', { raw: 'ORIGINAL_READ_ONLY_PLAN', gasLamports: 5000n }), true);
    assert.equal(r.releaseUnusedProof(p.id), true);
    assert.equal(r.protectProof(p.id, 'attempt-with-modeled-gas-123'), true);
    assert.equal(r.releaseUnusedProof(p.id), false);
    assert.equal(r.appendProvisionalEvidence(p.id, 'late-candidate-completion', { original: 'STILL_TRADE_LINKED' }), false);
    assert.equal(r.record('late-candidate-completion', { original: 'STILL_TRADE_LINKED' }, { essential: true }), true, 'post-promotion records use the permanent essential fallback');
    assert.deepEqual(readFileSync(join(f.proof(p.id), 'manifest.json')), manifest, 'qualification manifest is immutable');
    await r.close(); f.advance(5000 + 2 * PROVISIONAL_PROOF_GRACE_MS); const reopened = f.open(); await sweep(reopened);
    assert.ok(existsSync(f.proof(p.id)));
    const preparations = readdirSync(f.proof(p.id)).filter(n => /^preparation-.*json$/.test(n)); assert.equal(preparations.length, 1);
    for (const name of preparations) { const raw = readFileSync(join(f.proof(p.id), name)); assert.equal(name, 'preparation-' + hash(raw) + '.json'); }
    assert.match(preparations.map(n => readFileSync(join(f.proof(p.id), n), 'utf8')).join(''), /ORIGINAL_READ_ONLY_PLAN/);
    assert.match(readFileSync(join(f.proof(p.id), 'trade-reference.json'), 'utf8'), /attempt-with-modeled-gas-123/);
    const reference = JSON.parse(readFileSync(join(f.proof(p.id), 'trade-reference.json'), 'utf8'));
    assert.deepEqual(reference.preparationFiles, preparations.map(file => ({ file, sha256: hash(readFileSync(join(f.proof(p.id), file))) })));
    const permanent = readdirSync(f.directory).filter(x => /^essential-.*ndjson$/.test(x)).map(x => readFileSync(join(f.directory, x), 'utf8')).join(''); assert.match(permanent, /STILL_TRADE_LINKED/);
    const durableReference = permanent.trim().split('\n').map(line => JSON.parse(line)).find(row => row.kind === 'qualification-proof-financial-reference');
    assert.ok(durableReference, 'permanent essential chain anchors the complete trade evidence graph');
    assert.equal(durableReference.data.manifestSha256, hash(manifest));
    assert.equal(durableReference.data.referenceSha256, hash(readFileSync(join(f.proof(p.id), 'trade-reference.json'))));
    assert.equal(durableReference.data.preparationRecords, 1);
    await reopened.close();
});

test('unused preparation records retire with their proof and do not enter permanent essential history', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r);
    assert.equal(r.appendProvisionalEvidence(p.id, 'candidate-quote', { exact: 'UNUSED_PREPARATION_BODY' }), true);
    assert.equal(r.releaseUnusedProof(p.id), true); f.advance(5000 + UNUSED_PROOF_GRACE_MS); await sweep(r);
    assert.equal(existsSync(f.proof(p.id)), false);
    const essential = readdirSync(f.directory).filter(x => /^essential-.*ndjson$/.test(x)).map(x => readFileSync(join(f.directory, x), 'utf8')).join('');
    assert.equal(essential.includes('UNUSED_PREPARATION_BODY'), false);
    assert.ok(r.usage().provisionalProofRetention.retiredBytes > p.result.bytes); await r.close();
});

test('legacy proofs refuse provisional-only appends and release; callers retain the essential fallback', async () => {
    const f = fixture(), r = f.open(); r.record('market', { exact: 'ORIGINAL' });
    assert.equal((await r.pinRange('legacy', f.at, f.at)).complete, true);
    assert.equal(r.appendProvisionalEvidence('legacy', 'candidate-sdk', { exact: 'MUST_FALL_BACK_TO_ESSENTIAL' }), false);
    assert.equal(r.releaseUnusedProof('legacy'), false); f.advance(3 * PROVISIONAL_PROOF_GRACE_MS); await sweep(r);
    assert.ok(existsSync(f.proof('legacy'))); await r.close();
});

test('retirement uses cooperative chunks of two files, stays bounded, and resumes after restart', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r, 'many-files', 8);
    for (let i = 0; i < 40; i++) assert.equal(r.appendProvisionalEvidence(p.id, 'preparation', { i }), true);
    r.releaseUnusedProof(p.id); f.advance(5000 + UNUSED_PROOF_GRACE_MS);
    const before = readdirSync(f.proof(p.id)); await r.maintenance();
    const after = readdirSync(f.proof(p.id)), removed = before.filter(x => !after.includes(x)).length; assert.ok(removed > 0 && removed <= 16); assert.ok(after.includes('retiring.json'));
    assert.equal(r.protectProof(p.id, 'too-late'), false, 'an in-progress retirement cannot authorize a financial attempt');
    await r.close(); const reopened = f.open(); await sweep(reopened); assert.equal(existsSync(f.proof(p.id)), false);
    assert.equal(reopened.usage().candidateAdmissionAllowed, true); await reopened.close();
});

test('active copy ownership wins over expiry until asynchronous copying settles', async () => {
    const f = fixture(), r = f.open(); r.record('market', { raw: 'REQUIRED' });
    const internal = r as any, verify = internal.verifyFile.bind(r); let release!: () => void, seen!: () => void;
    const gate = new Promise<void>(resolve => release = resolve), reached = new Promise<void>(resolve => seen = resolve);
    internal.verifyFile = async (m: unknown, destination?: string) => { if (destination) { seen(); await gate; } return verify(m, destination); };
    const pending = r.pinProvisionalRange('pending', f.at, f.at, f.at + 5000); await reached;
    f.advance(PROVISIONAL_PROOF_GRACE_MS + 5000); await sweep(r); assert.ok(existsSync(f.proof('pending')));
    release(); assert.equal((await pending).complete, true); await sweep(r); assert.equal(existsSync(f.proof('pending')), false); await r.close();
});

test('a permanent pin joining a provisional in-flight copy promotes before returning', async () => {
    const f = fixture(), r = f.open(); r.record('market', { raw: 'REQUIRED' });
    const a = r.pinProvisionalRange('joined', f.at, f.at, f.at + 5000), b = r.pinRange('joined', f.at, f.at);
    assert.equal((await a).complete, true); assert.equal((await b).complete, true);
    f.advance(PROVISIONAL_PROOF_GRACE_MS + 5000); await sweep(r); assert.ok(existsSync(f.proof('joined'))); await r.close();
});

test('foreign files, symlinks and hardlinks are retained and reported without disabling protection', async () => {
    for (const kind of ['unknown', 'symlink', 'hardlink'] as const) {
        const f = fixture(), r = f.open(), p = await prepare(f, r), original = join(f.root, 'financial-original'); writeFileSync(original, 'IRREPLACEABLE', { mode: 0o600 });
        if (kind === 'unknown') writeFileSync(join(f.proof(p.id), 'unique-financial.sqlite'), 'KEEP', { mode: 0o600 });
        else { const copy = join(f.directory, p.result.files[0]!); unlinkSync(copy); if (kind === 'symlink') symlinkSync(original, copy); else linkSync(original, copy); }
        r.releaseUnusedProof(p.id); f.advance(5000 + UNUSED_PROOF_GRACE_MS); await sweep(r);
        assert.ok(existsSync(f.proof(p.id))); assert.equal(readFileSync(original, 'utf8'), 'IRREPLACEABLE');
        assert.ok(r.usage().provisionalProofRetention.skipped > 0); assert.equal(r.usage().candidateAdmissionAllowed, true);
        assert.equal(r.record('held-position-protection', { current: true }, { essential: true }), true); await r.close();
    }
});

test('a malformed provisional policy fails closed for deletion but leaves ordinary recording usable', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r);
    writeFileSync(join(f.proof(p.id), 'retention.json'), '{incomplete', { mode: 0o600 }); f.advance(3 * PROVISIONAL_PROOF_GRACE_MS); await sweep(r);
    assert.ok(existsSync(f.proof(p.id))); assert.ok(r.usage().provisionalProofRetention.skipped > 0);
    assert.equal(r.record('current-protection', { preserved: true }, { essential: true }), true); await r.close();
});

test('an interrupted new provisional copy remains unprotectable and expires after restart', async () => {
    const f = fixture(), r = f.open(); r.record('market', { raw: 'REQUIRED' });
    const internal = r as any, verify = internal.verifyFile.bind(r);
    internal.verifyFile = async (m: unknown, destination?: string) => { await verify(m, destination); if (destination) throw Error('OFFLINE crash after copied file'); };
    const failed = await r.pinProvisionalRange('interrupted', f.at, f.at, f.at + 5000);
    assert.equal(failed.complete, false); assert.equal(existsSync(join(f.proof('interrupted'), 'manifest.json')), false);
    assert.equal(r.protectProof('interrupted', 'not-authorized'), false); await r.close();
    f.advance(5000 + PROVISIONAL_PROOF_GRACE_MS); const reopened = f.open(); await sweep(reopened);
    assert.equal(existsSync(f.proof('interrupted')), false); assert.equal(reopened.usage().candidateAdmissionAllowed, true); await reopened.close();
});

test('the permanent API resuming an interrupted provisional directory cannot leave it expirable', async () => {
    const f = fixture(), r = f.open(); r.record('market', { raw: 'REQUIRED' });
    const internal = r as any, verify = internal.verifyFile.bind(r);
    internal.verifyFile = async (m: unknown, destination?: string) => { await verify(m, destination); if (destination) throw Error('OFFLINE copy interruption'); };
    assert.equal((await r.pinProvisionalRange('resumed', f.at, f.at, f.at + 5000)).complete, false);
    internal.verifyFile = verify;
    assert.equal((await r.pinRange('resumed', f.at, f.at)).complete, true);
    f.advance(PROVISIONAL_PROOF_GRACE_MS + 5000); await sweep(r); assert.ok(existsSync(f.proof('resumed'))); await r.close();
});

test('permanent promotion during a cooperative inventory yield prevents every unlink', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r, 'promotion-race');
    for (let i = 0; i < 40; i++) assert.equal(r.appendProvisionalEvidence(p.id, 'preparation', { i }), true);
    r.releaseUnusedProof(p.id); f.advance(5000 + UNUSED_PROOF_GRACE_MS);
    const before = readdirSync(f.proof(p.id)); let promoted = false;
    const promotion = new Promise<void>(resolve => setImmediate(() => { promoted = r.protectProof(p.id, 'recovered-exact-attempt'); resolve(); }));
    await r.maintenance(); await promotion; assert.equal(promoted, true);
    for (const file of before) assert.ok(existsSync(join(f.proof(p.id), file)), 'a trade reference arriving during planning prevents deletion');
    await sweep(r); assert.ok(existsSync(f.proof(p.id))); assert.equal(existsSync(join(f.proof(p.id), 'retiring.json')), false); await r.close();
});

test('the cooperative maintenance pass stops starting chunks after its elapsed budget', async () => {
    const f = fixture(), r = f.open(), p = await prepare(f, r, 'elapsed-budget');
    for (let i = 0; i < 20; i++) assert.equal(r.appendProvisionalEvidence(p.id, 'preparation', { i }), true);
    r.releaseUnusedProof(p.id); f.advance(5000 + UNUSED_PROOF_GRACE_MS);
    const internal = r as any, original = internal.proofRetention.sweep.bind(internal.proofRetention); let chunks = 0;
    internal.proofRetention.sweep = async (...args: unknown[]) => { chunks++; const result = await original(...args); f.advance(11); return result; };
    await r.maintenance(); assert.equal(chunks, 1); assert.ok(existsSync(f.proof(p.id))); await r.close();
});
