import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

/** Disposable Gate A account only. No daemon, live orders, or production initialization. */
export type UsdPrice = { microUsdPerSol: string; at: number; source: string };
export type Mark = { netLamports: string; at: number; evidence: string };
type Position = {
  mint: string; units: string; entryLamports: string; entryGas: string;
  costMicroUsd: string; deposit: string; enteredAt: number;
};
type Order = {
  id: string; side: 'buy' | 'sell'; mint: string; decidedAt: number; executeAt: number;
  expiresAt: number; gas: string; deposit: string; maxSpend: string;
  minReceive: string; reserved: string; decisionEvidence: string;
};
type State = {
  fixtureId: string; mode: 'DISPOSABLE_PAPER'; inceptionAt: number;
  initialMicroUsd: string; inceptionPrice: UsdPrice; lamports: string;
  roundingResidualMicroUsd: string; gasReserve: string;
  lockedDeposits: Record<string, string>; lastAt: number;
  positions: Record<string, Position>; pending: Record<string, Order>;
  realizedLamports: string; executionCosts: string; daily: {
    day: string; baselineMicroUsd: string; paused: boolean; reconciledAt: number;
  }; revision: number;
};
export type ExecutionQuote = {
  /** Caller must supply the first available supported state at/after modeled delay. */
  at: number; spendLamports: string; receiveUnits: string; evidence: string;
  /** Required for sells: quote must liquidate exactly the entire held amount. */
  pricedBaseUnits?: string;
  refundedDepositLamports?: string; refundEvidence?: string;
};
export type OrderOutcome = { status: 'filled' | 'failed' | 'expired'; reason: string; at: number };
const L = 1_000_000_000n;
const INITIAL = 1_000_000_000n; // $1,000 in microUSD
const MAX_PRICE_AGE = 10_000;
const MAX_QUOTE_AGE = 2_000;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const amount = (s: string) => {
  if (!/^(0|[1-9][0-9]*)$/.test(s)) throw new Error('unsigned integer amount required');
  const n = BigInt(s);
  if (n > (1n << 127n) - 1n) throw new Error('amount exceeds supported bound');
  return n;
};
function priceAt(price: UsdPrice, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(price.at) ||
    price.at > now || now - price.at > MAX_PRICE_AGE || !price.source ||
    amount(price.microUsdPerSol) === 0n) throw new Error('fresh timestamped USD conversion required');
  return amount(price.microUsdPerSol);
}
const usd = (lamports: bigint, price: bigint) => lamports * price / L;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class DisposableLedger {
  private readonly db: Database.Database;
  readonly sqlite: { version: string; source: string };

  constructor(path: string, readonly fixtureId: string) {
    if (!/^fixture-[a-z0-9-]{1,80}$/.test(fixtureId)) throw new Error('disposable fixture identity required');
    this.db = new Database(path, { timeout: 100 });
    this.sqlite = this.db.prepare('SELECT sqlite_version() version, sqlite_source_id() source').get() as typeof this.sqlite;
    const [major, minor, patch] = this.sqlite.version.split('.').map(Number);
    if (!(major! > 3 || major === 3 && (minor! > 51 || minor === 51 && patch! >= 3))) {
      this.db.close(); throw new Error('SQLite WAL-reset fixed version >=3.51.3 required');
    }
    try {
      // One connection, including readers/checkpointing. No external financial writer.
      this.db.pragma('locking_mode = EXCLUSIVE');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('wal_autocheckpoint = 128');
      this.db.exec(`CREATE TABLE IF NOT EXISTS financial_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS journal (
        revision INTEGER PRIMARY KEY, action_id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);`);
      const existing = this.read();
      if (existing && existing.fixtureId !== fixtureId) throw new Error('wrong fixture account');
    } catch (e) { this.db.close(); throw e; }
  }

  private read(): State | undefined {
    const row = this.db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as { body: string } | undefined;
    return row ? JSON.parse(row.body) as State : undefined;
  }
  state(): Readonly<State> {
    const s = this.read();
    if (!s) throw new Error('fixture account not initialized');
    return s;
  }
  private assertState(s: State) {
    if (Object.keys(s.positions).length > 3 || Object.keys(s.pending).length > 3) throw new Error('capacity invariant');
    let reservations = 0n;
    for (const o of Object.values(s.pending)) reservations += amount(o.reserved);
    if (reservations + amount(s.gasReserve) > amount(s.lamports)) throw new Error('cash reservation invariant');
    for (const p of Object.values(s.positions)) {
      if (!amount(p.units)) throw new Error('empty position invariant');
      amount(p.entryLamports); amount(p.entryGas); amount(p.deposit);
    }
  }
  private apply<T>(id: string, kind: string, now: number, payload: unknown, fn: (s: State) => T): T {
    if (!id || id.length > 160 || !Number.isSafeInteger(now)) throw new Error('invalid action identity/time');
    if (JSON.stringify(payload).length > 65_536) throw new Error('financial action payload limit');
    const hash = digest({ kind, payload });
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT payload_hash, result FROM actions WHERE id=?').get(id) as { payload_hash: string; result: string } | undefined;
      if (prior) {
        if (prior.payload_hash !== hash) throw new Error('idempotency conflict');
        return JSON.parse(prior.result) as T;
      }
      const s = this.read(); if (!s) throw new Error('fixture account not initialized');
      if (now < s.lastAt) throw new Error('financial time regression');
      const result = fn(s);
      this.assertState(s); s.revision++; s.lastAt = now;
      this.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(s));
      this.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id, hash, JSON.stringify(result));
      this.db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(s.revision, id, now, kind, JSON.stringify(payload));
      return result;
    }).immediate();
  }

  initialize(price: UsdPrice, at: number, gasReserve = '5000000') {
    const p = priceAt(price, at); const reserve = amount(gasReserve);
    return this.db.transaction(() => {
      const old = this.read();
      if (old) return old; // Never reseed, even if invocation has another conversion.
      const cash = INITIAL * L / p;
      if (cash <= reserve) throw new Error('insufficient simulated gas capital');
      const s: State = {
        fixtureId: this.fixtureId, mode: 'DISPOSABLE_PAPER', inceptionAt: at,
        initialMicroUsd: INITIAL.toString(), inceptionPrice: price, lamports: cash.toString(),
        roundingResidualMicroUsd: (INITIAL - usd(cash, p)).toString(), gasReserve,
        positions: {}, pending: {}, lockedDeposits: {}, lastAt: at, realizedLamports: '0', executionCosts: '0',
        daily: { day: utcDay(at), baselineMicroUsd: INITIAL.toString(), paused: true, reconciledAt: 0 }, revision: 0,
      };
      this.assertState(s);
      this.db.prepare('INSERT INTO financial_state VALUES(1,?)').run(JSON.stringify(s));
      this.db.prepare('INSERT INTO journal VALUES(0,?,?,?,?)').run('inception', at, 'inception', JSON.stringify({ price, gasReserve, mode: s.mode }));
      return s;
    }).immediate();
  }

  private equity(s: State, price: bigint, marks: Record<string, Mark>, now: number): bigint {
    let liquid = amount(s.lamports);
    for (const p of Object.values(s.positions)) {
      const mark = marks[p.mint];
      if (!mark || !mark.evidence || !Number.isSafeInteger(mark.at) || mark.at > now || now - mark.at > MAX_QUOTE_AGE) throw new Error('unknown/stale liquidation mark');
      liquid += amount(mark.netLamports);
    }
    for (const deposit of Object.values(s.lockedDeposits)) liquid += amount(deposit);
    return usd(liquid, price) + amount(s.roundingResidualMicroUsd);
  }

  reconcile(id: string, now: number, price: UsdPrice, marks: Record<string, Mark>) {
    const p = priceAt(price, now);
    return this.apply(id, 'reconcile', now, { now, price, marks }, s => {
      const equity = this.equity(s, p, marks, now);
      if (s.daily.day !== utcDay(now)) {
        s.daily = { day: utcDay(now), baselineMicroUsd: equity.toString(), paused: false, reconciledAt: now };
      } else {
        // Inception starts closed, and only fresh reconciliation opens it.
        if (s.daily.reconciledAt === 0) s.daily.paused = false;
        if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) s.daily.paused = true;
        s.daily.reconciledAt = now;
      }
      return { equityMicroUsd: equity.toString(), paused: s.daily.paused };
    });
  }

  pause(id: string, now: number) {
    return this.apply(id, 'pause', now, { now }, s => { s.daily.paused = true; return { paused: true }; });
  }

  order(input: Omit<Order, 'reserved'>, price: UsdPrice, marks: Record<string, Mark>) {
    const now = input.decidedAt;
    return this.apply(`order:${input.id}`, 'order', now, { input, price, marks }, s => {
      if (!Number.isSafeInteger(input.executeAt) || !Number.isSafeInteger(input.expiresAt) || input.executeAt < now + 500 || input.expiresAt <= input.executeAt || input.expiresAt > now + 30_000 || !input.decisionEvidence) throw new Error('invalid delay/expiry/evidence');
      const gas = amount(input.gas); const dep = amount(input.deposit);
      const spend = amount(input.maxSpend); const min = amount(input.minReceive);
      if (gas === 0n || min === 0n || input.id.length > 100 || !input.id || !input.mint || ['__proto__', 'constructor', 'prototype'].some(k => k === input.id || k === input.mint)) throw new Error('invalid order amounts/identity');
      if (Object.values(s.pending).some(o => o.mint === input.mint)) throw new Error('one pending action per token');
      if (Object.keys(s.pending).length >= 3) throw new Error('pending capacity');
      let reserved = gas;
      if (input.side === 'buy') {
        const p = priceAt(price, now);
        const equity = this.equity(s, p, marks, now);
        if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) s.daily.paused = true;
        if (s.daily.day !== utcDay(now) || s.daily.reconciledAt === 0 || now - s.daily.reconciledAt > MAX_QUOTE_AGE || s.daily.paused) return { rejected: 'entries paused or reconciliation required' };
        if (s.positions[input.mint]) throw new Error('adds/re-entry into held position forbidden');
        if (s.lockedDeposits[input.mint] && dep > 0n) throw new Error('existing account deposit cannot be charged twice');
        if (Object.keys(s.lockedDeposits).length >= 128 && !s.lockedDeposits[input.mint]) throw new Error('unresolved deposit capacity');
        const pendingBuys = Object.values(s.pending).filter(o => o.side === 'buy');
        if (Object.keys(s.positions).length + pendingBuys.length >= 3) throw new Error('position capacity');
        reserved += spend + dep;
        if (usd(reserved, p) > 50_000_000n) throw new Error('$50 initial commitment limit');
        const heldCost = Object.values(s.positions).reduce((n, x) => n + amount(x.costMicroUsd), 0n);
        const pendingCost = pendingBuys.reduce((n, x) => n + usd(amount(x.reserved), p), 0n);
        if (heldCost + pendingCost + usd(reserved, p) > 150_000_000n) throw new Error('$150 cost limit');
      } else if (input.side === 'sell') {
        if (!s.positions[input.mint] || spend !== 0n || dep !== 0n) throw new Error('full-position sell required');
      } else throw new Error('unsupported side');
      const existing = Object.values(s.pending).reduce((n, o) => n + amount(o.reserved), 0n);
      if (existing + reserved + amount(s.gasReserve) > amount(s.lamports)) throw new Error('insufficient unreserved cash');
      s.pending[input.id] = { ...input, reserved: reserved.toString() };
      return { reserved: reserved.toString() };
    });
  }

  attempt(id: string, orderId: string, now: number, quote: ExecutionQuote | null, price: UsdPrice, marks: Record<string, Mark> = {}): OrderOutcome {
    return this.apply(id, 'attempt', now, { orderId, now, quote, price, marks }, s => {
      const o = s.pending[orderId]; if (!o) throw new Error('order is not pending');
      if (now < o.executeAt) throw new Error('modeled delay not elapsed');
      let chargedGas = 0n;
      const finish = (status: OrderOutcome['status'], reason: string) => {
        if (status === 'failed') s.realizedLamports = (BigInt(s.realizedLamports) - chargedGas).toString();
        delete s.pending[orderId]; return { status, reason, at: now };
      };
      if (now >= o.expiresAt) return finish('expired', 'expiry reached before attempt');
      let p = 0n;
      if (o.side === 'buy') {
        try { p = priceAt(price, now); }
        catch { return finish('failed', 'USD valuation unavailable; entry canceled before attempt'); }
        let equity: bigint;
        try { equity = this.equity(s, p, marks, now); }
        catch { return finish('failed', 'unknown liquidation marks; entry canceled before attempt'); }
        if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) s.daily.paused = true;
        if (s.daily.day !== utcDay(now) || s.daily.paused || now - s.daily.reconciledAt > MAX_QUOTE_AGE) return finish('failed', 'entry gate closed; canceled before attempt');
      }
      const gas = amount(o.gas);
      chargedGas = gas;
      s.lamports = (amount(s.lamports) - gas).toString();
      s.executionCosts = (amount(s.executionCosts) + gas).toString();
      if (!quote || !quote.evidence || !Number.isSafeInteger(quote.at) || quote.at < o.executeAt || quote.at > now || now - quote.at > MAX_QUOTE_AGE) return finish('failed', 'missing/stale first-attempt state; gas charged; no retry');
      const spend = amount(quote.spendLamports); const received = amount(quote.receiveUnits);
      if (received < amount(o.minReceive) || (o.side === 'buy' && (spend > amount(o.maxSpend) || spend === 0n)) || (o.side === 'sell' && spend !== 0n)) return finish('failed', 'price constraint failed; gas charged; no retry');
      if (o.side === 'buy') {
        if (usd(spend + gas + amount(o.deposit), p) > 50_000_000n) return finish('failed', '$50 commitment limit at execution; gas charged');
        if (s.positions[o.mint]) throw new Error('position already held');
        s.lamports = (amount(s.lamports) - spend - amount(o.deposit)).toString();
        if (amount(o.deposit) > 0n) s.lockedDeposits[o.mint] = o.deposit;
        s.positions[o.mint] = {
          mint: o.mint, units: received.toString(), entryLamports: spend.toString(), entryGas: gas.toString(),
          costMicroUsd: usd(spend + gas, p).toString(), deposit: o.deposit, enteredAt: now,
        };
      } else {
        const pos = s.positions[o.mint]; if (!pos) throw new Error('position missing');
        if (quote.pricedBaseUnits !== pos.units) return finish('failed', 'exit quote is not for actual full size; gas charged');
        const refund = amount(quote.refundedDepositLamports ?? '0');
        const locked = amount(s.lockedDeposits[o.mint] ?? '0');
        if (refund > locked || refund > 0n && !quote.refundEvidence) return finish('failed', 'unverified deposit refund; gas charged');
        s.lamports = (amount(s.lamports) + received + refund).toString();
        if (locked > refund) s.lockedDeposits[o.mint] = (locked - refund).toString();
        else delete s.lockedDeposits[o.mint];
        s.realizedLamports = (BigInt(s.realizedLamports) + received - gas - amount(pos.entryLamports) - amount(pos.entryGas)).toString();
        delete s.positions[o.mint];
      }
      return finish('filled', 'single modeled PAPER attempt; no live fill claim');
    });
  }

  releaseDeposit(id: string, mint: string, lamports: string, now: number, evidence: string) {
    return this.apply(id, 'deposit-release', now, { mint, lamports, now, evidence }, s => {
      const refund = amount(lamports); const locked = amount(s.lockedDeposits[mint] ?? '0');
      if (!evidence || refund === 0n || refund > locked || s.positions[mint]) throw new Error('verified closed-account refund required');
      s.lamports = (amount(s.lamports) + refund).toString();
      if (refund === locked) delete s.lockedDeposits[mint];
      else s.lockedDeposits[mint] = (locked - refund).toString();
      return { refundedLamports: lamports };
    });
  }

  exportJournal(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('bounded export required');
    return this.db.prepare('SELECT * FROM journal ORDER BY revision DESC LIMIT ?').all(limit);
  }
  async backup(path: string) { await this.db.backup(path); }
  integrity() { return this.db.pragma('integrity_check', { simple: true }); }
  close() { this.db.close(); }
}
