import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DisposableLedger, type UsdPrice } from '../src/ledger.js';

const AT = Date.parse('2026-10-26T12:00:00.000Z');
const price = (at: number, value = '100000000'): UsdPrice => ({ microUsdPerSol: value, at, source: 'fixture-usd-conversion' });
const buyOrder = (id: string, at = AT, mint = 'fixture-mint') => ({
  id, side: 'buy' as const, mint, decidedAt: at, executeAt: at + 500, expiresAt: at + 2000,
  gas: '10000', deposit: '2000000', maxSpend: '490000000', minReceive: '100', decisionEvidence: 'fixture-decision',
});
function setup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'poe-disposable-ledger-'));
  const path = join(dir, 'fixture.sqlite');
  const ledger = new DisposableLedger(path, 'fixture-ledger');
  let closed = false;
  t.after(() => { if (!closed) ledger.close(); rmSync(dir, { recursive: true, force: true }); });
  ledger.initialize(price(AT), AT);
  ledger.reconcile('initial-reconcile', AT, price(AT), {});
  return { dir, path, ledger, close: () => { ledger.close(); closed = true; } };
}
function fillBuy(ledger: DisposableLedger, id = 'buy', at = AT, mint = 'fixture-mint') {
  ledger.order(buyOrder(id, at, mint), price(at), {});
  return ledger.attempt(`fill:${id}`, id, at + 500, {
    at: at + 500, spendLamports: '480000000', receiveUnits: '1000', evidence: 'fixture-size-specific-buy',
  }, price(at + 500));
}

test('fixture-only identity, fixed loaded SQLite, integer conversion and one-time inception', t => {
  assert.throws(() => new DisposableLedger(':memory:', 'poe-account'), /fixture/);
  const { ledger } = setup(t);
  assert.equal(ledger.sqlite.version, '3.53.4');
  assert.equal(ledger.state().lamports, '10000000000');
  ledger.initialize(price(AT + 1000, '200000000'), AT + 1000);
  assert.equal(ledger.state().lamports, '10000000000');
  assert.equal(ledger.state().inceptionAt, AT);
  assert.equal(ledger.state().mode, 'DISPOSABLE_PAPER');
  assert.equal(ledger.integrity(), 'ok');
});

test('delayed full lifecycle counts gas once, locks/refunds deposits, preserves idempotency', t => {
  const { ledger } = setup(t);
  const order = buyOrder('buy');
  assert.deepEqual(ledger.order(order, price(AT), {}), { reserved: '492010000' });
  assert.equal(ledger.state().lamports, '10000000000'); // reservation is not a second asset/debit
  assert.throws(() => ledger.attempt('early', 'buy', AT + 499, null, price(AT + 499)), /delay/);
  const quote = { at: AT + 500, spendLamports: '480000000', receiveUnits: '1000', evidence: 'fixture-size-specific-buy' };
  assert.equal(ledger.attempt('fill-buy', 'buy', AT + 500, quote, price(AT + 500)).status, 'filled');
  const s = ledger.state();
  assert.equal(s.lamports, '9517990000');
  assert.equal(s.positions['fixture-mint']!.deposit, '2000000');
  ledger.attempt('fill-buy', 'buy', AT + 500, quote, price(AT + 500));
  assert.equal(ledger.state().lamports, s.lamports);
  assert.throws(() => ledger.attempt('fill-buy', 'buy', AT + 501, quote, price(AT + 501)), /idempotency conflict/);
  ledger.order({ id: 'sell', side: 'sell', mint: 'fixture-mint', decidedAt: AT + 600, executeAt: AT + 1100,
    expiresAt: AT + 3000, gas: '10000', deposit: '0', maxSpend: '0', minReceive: '470000000', decisionEvidence: 'fixture-exit' }, price(AT + 600), {});
  assert.equal(ledger.attempt('fill-sell', 'sell', AT + 1100, { at: AT + 1100, spendLamports: '0', receiveUnits: '500000000', pricedBaseUnits: '1000', evidence: 'fixture-size-specific-sell', refundedDepositLamports: '2000000', refundEvidence: 'fixture-atomic-sell-and-close' }, price(AT + 1100)).status, 'filled');
  assert.equal(ledger.state().lamports, '10019980000');
  assert.equal(ledger.state().realizedLamports, '19980000');
  assert.equal(ledger.state().executionCosts, '20000');
  assert.deepEqual(ledger.state().positions, {});
  assert.equal(ledger.reconcile('end-reconcile', AT + 1200, price(AT + 1200), {}).equityMicroUsd, '1001998000');
});

test('failed single attempt charges gas and cannot cherry-pick a retry; expiry cannot fill', t => {
  const { ledger } = setup(t);
  ledger.order(buyOrder('failure'), price(AT), {});
  const bad = { at: AT + 500, spendLamports: '480000000', receiveUnits: '99', evidence: 'fixture-slippage-failure' };
  assert.equal(ledger.attempt('attempt-failure', 'failure', AT + 500, bad, price(AT + 500)).status, 'failed');
  assert.equal(ledger.state().lamports, '9999990000');
  assert.equal(ledger.state().realizedLamports, '-10000');
  assert.throws(() => ledger.attempt('retry', 'failure', AT + 600, { ...bad, at: AT + 600, receiveUnits: '1000' }, price(AT + 600)), /not pending/);
  ledger.order(buyOrder('expired', AT + 600), price(AT + 600), {});
  assert.equal(ledger.attempt('expire', 'expired', AT + 2600, { ...bad, at: AT + 2600, receiveUnits: '1000' }, price(AT + 2600)).status, 'expired');
  assert.equal(ledger.state().lamports, '9999990000');
});

test('missing state never fills and pre-delay or stale quotes never become execution evidence', t => {
  const { ledger } = setup(t);
  ledger.order(buyOrder('missing'), price(AT), {});
  assert.equal(ledger.attempt('missing-attempt', 'missing', AT + 500, null, price(AT + 500)).status, 'failed');
  ledger.order(buyOrder('old', AT + 600), price(AT + 600), {});
  assert.equal(ledger.attempt('old-attempt', 'old', AT + 1100, { at: AT + 1099, spendLamports: '100', receiveUnits: '1000', evidence: 'too-early' }, price(AT + 1100)).status, 'failed');
  assert.deepEqual(ledger.state().positions, {});
});

test('unknown liquidation blocks new risk, never converts an open position to zero', t => {
  const { ledger } = setup(t);
  fillBuy(ledger);
  assert.throws(() => ledger.reconcile('bad-mark', AT + 600, price(AT + 600), {}), /unknown\/stale/);
  assert.throws(() => ledger.order(buyOrder('more', AT + 600, 'second-mint'), price(AT + 600), {}), /unknown\/stale/);
  assert.equal(ledger.state().positions['fixture-mint']!.units, '1000');
});

test('sticky day loss survives recovery, price recovery and restart; fresh next day can resume', t => {
  const { ledger, path, close } = setup(t);
  const down = ledger.reconcile('loss', AT + 100, price(AT + 100, '94000000'), {});
  assert.equal(down.paused, true);
  assert.equal(ledger.reconcile('recovery', AT + 200, price(AT + 200), {}).paused, true);
  close();
  const reopened = new DisposableLedger(path, 'fixture-ledger');
  try {
    assert.equal(reopened.state().daily.paused, true);
    assert.ok('rejected' in reopened.order(buyOrder('paused', AT + 200), price(AT + 200), {}));
    const tomorrow = Date.parse('2026-10-27T00:00:00Z');
    assert.ok('rejected' in reopened.order(buyOrder('day-before-reconcile', tomorrow), price(tomorrow), {}));
    assert.equal(reopened.reconcile('tomorrow', tomorrow, price(tomorrow), {}).paused, false);
    assert.ok('reserved' in reopened.order(buyOrder('tomorrow-entry', tomorrow), price(tomorrow), {}));
  } finally { reopened.close(); }
});

test('entry pause cancels pending buys without abandoning position exit management', t => {
  const { ledger } = setup(t);
  ledger.order(buyOrder('pending'), price(AT), {});
  ledger.pause('manual-pause', AT + 100);
  const result = ledger.attempt('canceled', 'pending', AT + 500, { at: AT + 500, spendLamports: '480000000', receiveUnits: '1000', evidence: 'fixture' }, price(AT + 500));
  assert.equal(result.status, 'failed');
  assert.equal(ledger.state().lamports, '10000000000');
  assert.deepEqual(ledger.state().pending, {});
});

test('entry size includes gas/deposit, prevents adds and keeps reserved capital exclusive', t => {
  const { ledger } = setup(t);
  assert.throws(() => ledger.order({ ...buyOrder('too-big'), maxSpend: '500000000' }, price(AT), {}), /\$50/);
  fillBuy(ledger);
  const marks = { 'fixture-mint': { netLamports: '470000000', at: AT + 600, evidence: 'actual-size-liquidation' } };
  ledger.reconcile('position-reconcile', AT + 600, price(AT + 600), marks);
  assert.throws(() => ledger.order(buyOrder('add', AT + 600), price(AT + 600), marks), /adds/);
  assert.throws(() => ledger.order({ ...buyOrder('bad-decimal', AT + 600, 'other'), gas: '1.1' }, price(AT + 600), marks), /integer/);
});

test('wrong-sized exit cannot remove held tokens or refund its deposit', t => {
  const { ledger } = setup(t);
  fillBuy(ledger);
  ledger.order({ id: 'exit', side: 'sell', mint: 'fixture-mint', decidedAt: AT + 600, executeAt: AT + 1100, expiresAt: AT + 2000,
    gas: '10000', deposit: '0', maxSpend: '0', minReceive: '1', decisionEvidence: 'fixture-exit' }, price(AT + 600), {});
  const result = ledger.attempt('exit-attempt', 'exit', AT + 1100, { at: AT + 1100, spendLamports: '0', receiveUnits: '500000000', pricedBaseUnits: '10', evidence: 'wrong-size' }, price(AT + 1100));
  assert.equal(result.status, 'failed');
  assert.equal(ledger.state().positions['fixture-mint']!.units, '1000');
  assert.equal(ledger.state().positions['fixture-mint']!.deposit, '2000000');
});

test('restart recovers unresolved reservations; SQLite backup restores coherent financial state', async t => {
  const { ledger, path, dir, close } = setup(t);
  ledger.order(buyOrder('recover'), price(AT), {});
  const state = ledger.state();
  const backup = join(dir, 'consistent-backup.sqlite');
  await ledger.backup(backup);
  close();
  const restored = new DisposableLedger(backup, 'fixture-ledger');
  const restarted = new DisposableLedger(path, 'fixture-ledger');
  try {
    assert.deepEqual(restored.state(), state);
    assert.deepEqual(restarted.state(), state);
    assert.equal(restored.integrity(), 'ok');
    assert.equal(restarted.attempt('recover-expire', 'recover', AT + 3000, null, price(AT + 3000)).status, 'expired');
    assert.equal(restarted.state().lamports, '10000000000');
    assert.equal(restarted.state().inceptionAt, AT);
  } finally { restored.close(); restarted.close(); }
});

test('exclusive loaded SQLite connection rejects a second owner and wrong account', t => {
  const { ledger, path, close } = setup(t);
  assert.throws(() => new DisposableLedger(path, 'fixture-ledger'), /locked/);
  assert.equal(ledger.integrity(), 'ok');
  close();
  assert.throws(() => new DisposableLedger(path, 'fixture-wrong'), /wrong fixture/);
});

test('backward wall time cannot clear a persisted day pause', t => {
  const { ledger } = setup(t);
  ledger.reconcile('day-loss', AT + 1000, price(AT + 1000, '90000000'), {});
  assert.throws(() => ledger.reconcile('older-day', AT - 86_400_000, price(AT - 86_400_000), {}), /time regression/);
  assert.equal(ledger.state().daily.paused, true);
});

test('SOL exits work during USD outage and deposits stay locked until explicit refund', t => {
  const { ledger } = setup(t);
  fillBuy(ledger);
  const now = AT + 60_000;
  const oldPrice = price(AT);
  ledger.order({ id: 'exit-outage', side: 'sell', mint: 'fixture-mint', decidedAt: now, executeAt: now + 500, expiresAt: now + 2000,
    gas: '10000', deposit: '0', maxSpend: '0', minReceive: '1', decisionEvidence: 'fixture-protection-exit' }, oldPrice, {});
  const result = ledger.attempt('exit-outage-attempt', 'exit-outage', now + 500, { at: now + 500, spendLamports: '0', receiveUnits: '500000000', pricedBaseUnits: '1000', evidence: 'fixture-size-specific-exit' }, oldPrice);
  assert.equal(result.status, 'filled');
  assert.equal(ledger.state().lockedDeposits['fixture-mint'], '2000000');
  assert.equal(ledger.state().lamports, '10017980000');
  assert.throws(() => ledger.releaseDeposit('bad-refund', 'fixture-mint', '2000000', now + 600, ''), /verified/);
  ledger.releaseDeposit('proven-refund', 'fixture-mint', '2000000', now + 600, 'fixture-close-confirmation');
  assert.deepEqual(ledger.state().lockedDeposits, {});
  assert.equal(ledger.state().lamports, '10019980000');
});

async function killAfterMarker(source: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let marked = false; let stderr = '';
    child.stderr.on('data', b => { stderr += String(b).slice(0, 1000); });
    child.stdout.on('data', b => {
      if (String(b).includes('CRASH-HERE')) { marked = true; child.kill('SIGKILL'); }
    });
    child.on('error', reject);
    child.on('exit', (_code, signal) => {
      if (marked && signal === 'SIGKILL') resolve();
      else reject(new Error(`fixture crash worker exited before marker: ${stderr}`));
    });
  });
}

test('SIGKILL after durable order commit retains reservation and inception', { timeout: 10_000 }, async t => {
  const { ledger, path, close } = setup(t);
  const initial = ledger.state(); close();
  const moduleUrl = new URL('../src/ledger.ts', import.meta.url).href;
  await killAfterMarker(`
    import { DisposableLedger } from ${JSON.stringify(moduleUrl)};
    const ledger = new DisposableLedger(${JSON.stringify(path)}, 'fixture-ledger');
    ledger.order(${JSON.stringify(buyOrder('crash-committed'))}, ${JSON.stringify(price(AT))}, {});
    process.stdout.write('CRASH-HERE'); setInterval(() => {}, 1000);
  `);
  const recovered = new DisposableLedger(path, 'fixture-ledger');
  try {
    assert.equal(recovered.integrity(), 'ok');
    assert.equal(recovered.state().lamports, initial.lamports);
    assert.equal(recovered.state().pending['crash-committed']!.reserved, '492010000');
    assert.equal(recovered.state().inceptionAt, initial.inceptionAt);
  } finally { recovered.close(); }
});

test('SIGKILL during uncommitted write rolls back without reseeding account', { timeout: 10_000 }, async t => {
  const { ledger, path, close } = setup(t);
  fillBuy(ledger);
  const initial = ledger.state(); close();
  await killAfterMarker(`
    import Database from 'better-sqlite3';
    const db = new Database(${JSON.stringify(path)});
    db.pragma('cache_size = 1'); db.exec('BEGIN IMMEDIATE');
    const row = db.prepare('SELECT body FROM financial_state WHERE singleton=1').get();
    const state = JSON.parse(row.body); state.lamports = '0';
    state.positions = {}; state.fixtureInterruptionPadding = 'x'.repeat(100000);
    db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(state));
    process.stdout.write('CRASH-HERE'); setInterval(() => {}, 1000);
  `);
  const recovered = new DisposableLedger(path, 'fixture-ledger');
  try {
    assert.equal(recovered.integrity(), 'ok');
    assert.deepEqual(recovered.state(), initial);
  } finally { recovered.close(); }
});
