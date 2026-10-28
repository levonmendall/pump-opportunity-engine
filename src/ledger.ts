import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { openSync, closeSync, fstatSync, lstatSync, statSync, realpathSync, constants, type Stats } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import {validateReportingTradeCache,reportingFilledTrade,type ReportingFilledTrade,type ReportingTradeCache} from './reporting.js';
import { initializeOperatingCosts, validateOperatingCosts, applyOperatingCostEvent, projectOperatingCosts, type OperatingCostState, type OperatingCostEvent } from './costs.js';

/** One PAPER accounting path. Fixture and authoritative identities never mix. No live execution. */
export type UsdPrice = { microUsdPerSol: string; at: number; source: string };
/** Actual-size token liquidation net of exit costs; excludes separately locked rent deposits. */
export type Mark = { netLamports: string; pricedBaseUnits: string; at: number; evidence: string };
export type Position = {
  mint: string; units: string; entryLamports: string; entryGas: string;
  costMicroUsd: string; deposit: string; enteredAt: number;
};
export type Order = {
  id: string; side: 'buy' | 'sell'; mint: string; decidedAt: number; executeAt: number;
  expiresAt: number; gas: string; deposit: string; maxSpend: string;
  minReceive: string; reserved: string; decisionEvidence: string;
};
export type LedgerMode = 'PAPER' | 'DISPOSABLE_PAPER';
export type LedgerState = {
  schemaVersion: 1;
  accountId: string; fixtureId?: string; mode: LedgerMode; inceptionAt: number;
  initialMicroUsd: string; inceptionPrice: UsdPrice; lamports: string;
  roundingResidualMicroUsd: string; gasReserve: string;
  lockedDeposits: Record<string, string>; lastAt: number;
  positions: Record<string, Position>; pending: Record<string, Order>;
  realizedLamports: string; executionCosts: string; daily: {
    day: string; baselineMicroUsd: string; paused: boolean; lossPaused: boolean; reconciledAt: number;
  }; revision: number;
  controls: { entriesEnabled: boolean; reason: string; changedAt: number; readinessVersion: string | null; stopRequested: boolean };
};
type State = LedgerState;
export type RuntimeReadiness = { version: string; evidence: string; marketAt: number; recoveryComplete: boolean; candidateWindowsReady: boolean; budgetAvailable: boolean };
export type ReportingPoint = { at: number; tradingMicroUsd: string | null; economicMicroUsd: string | null };
export type ReportingHistory = { points: ReportingPoint[]; windowLimited: boolean; downsampled: boolean };
/** Optional reporting metadata only. Legacy reporting_history is never migrated
 * or interpreted as a historical token-trading series. */
export const REPORTING_OPERATING_HISTORY_KEY='reporting_history_operating_v2' as const;
export const OPERATING_REPORTING_BASIS='net-token-trading-sol-current-usd-v2' as const;
export type OperatingReportingHistory=ReportingHistory&{schemaVersion:2;basis:typeof OPERATING_REPORTING_BASIS;cutoverAt:number|null;firstObservedAt:number|null};
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
const boundedText = (s: unknown, max = 512): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;
const amount = (s: string) => {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s)) throw new Error('unsigned integer amount required');
  const n = BigInt(s);
  if (n > (1n << 127n) - 1n) throw new Error('amount exceeds supported bound');
  return n;
};
function priceAt(price: UsdPrice, now: number) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(price.at) ||
    price.at > now || now - price.at > MAX_PRICE_AGE || typeof price.source !== 'string' || !price.source || price.source.length > 512 ||
    amount(price.microUsdPerSol) === 0n) throw new Error('fresh timestamped USD conversion required');
  return amount(price.microUsdPerSol);
}
const usd = (lamports: bigint, price: bigint) => lamports * price / L;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Shared with backup/recovery validation. No database or financial mutation. */
export function validateOperatingReportingHistory(value:unknown,inceptionAt:number):OperatingReportingHistory {
  const h=value as OperatingReportingHistory,integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
  if(!integer(inceptionAt)||!h||typeof h!=='object'||Array.isArray(h)||Object.keys(h).sort().join(',')!=='basis,cutoverAt,downsampled,firstObservedAt,points,schemaVersion,windowLimited'||h.schemaVersion!==2||h.basis!==OPERATING_REPORTING_BASIS||typeof h.windowLimited!=='boolean'||typeof h.downsampled!=='boolean'||!Array.isArray(h.points)||h.points.length<1||h.points.length>720)throw Error('invalid operating reporting history metadata');
  if(h.cutoverAt!==null&&(!integer(h.cutoverAt)||h.cutoverAt<=inceptionAt)||h.firstObservedAt!==null&&(!integer(h.firstObservedAt)||h.cutoverAt===null||h.firstObservedAt<h.cutoverAt))throw Error('operating reporting cutover mismatch');
  let previous=-Infinity;
  for(const p of h.points){
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='at,economicMicroUsd,tradingMicroUsd'||!integer(p.at)||p.at<inceptionAt||p.at<=previous)throw Error('operating reporting chronology');
    for(const v of [p.tradingMicroUsd,p.economicMicroUsd])if(v!==null){if(typeof v!=='string'||!/^(-?(0|[1-9][0-9]*))$/.test(v))throw Error('integer operating reporting value required');amount(v.startsWith('-')?v.slice(1):v);}
    if(p.at>inceptionAt&&(p.tradingMicroUsd!==null||p.economicMicroUsd!==null)&&(h.cutoverAt===null||p.at<h.cutoverAt))throw Error('operating reporting value before cutover');
    if(p.at>inceptionAt&&p.tradingMicroUsd!==null&&(h.firstObservedAt===null||p.at<h.firstObservedAt))throw Error('operating reporting first observation mismatch');
    previous=p.at;
  }
  const first=h.points[0]!;
  if(first.at!==inceptionAt||first.tradingMicroUsd!=='0'||first.economicMicroUsd!==null)throw Error('operating reporting inception mismatch');
  if(h.cutoverAt===null&&(h.points.length!==1||h.firstObservedAt!==null||h.windowLimited||h.downsampled))throw Error('operating reporting cutover absent');
  if(h.cutoverAt!==null&&h.points.length<2)throw Error('operating reporting observations absent');
  if(h.firstObservedAt!==null&&!h.windowLimited&&!h.downsampled&&!h.points.some(p=>p.at===h.firstObservedAt&&p.tradingMicroUsd!==null))throw Error('operating reporting first observation absent');
  if(h.cutoverAt!==null&&h.cutoverAt>inceptionAt+1){const gap=h.points[1];if(!gap||gap.at!==inceptionAt+1||gap.tradingMicroUsd!==null||gap.economicMicroUsd!==null)throw Error('operating reporting inception gap absent');}
  return structuredClone(h);
}

/** Parent aliases share one lease; final DB aliases cannot split ownership or WAL identity. */
function canonicalDatabase(path: string): string {
  const absolute = resolve(path);
  const canonical = join(realpathSync(dirname(absolute)), basename(absolute));
  try {
    const s = lstatSync(canonical);
    if (!s.isFile() || s.nlink !== 1) throw new Error('financial database must be a regular non-symlink file with one link');
  } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
  return canonical;
}

/** Standard Linux flock on a separate inode. Never use a financial DB lock as a process lease. */
function acquireOwner(path: string): number {
  if (process.platform !== 'linux' || !process.geteuid) throw new Error('Linux advisory flock required');
  const uid = process.geteuid();
  const ownerPath = path + '.owner.lock';
  const parent = statSync(dirname(ownerPath));
  if (!parent.isDirectory() || parent.uid !== uid || parent.mode & 0o077) throw new Error('financial owner directory must be private and owner-held');
  const check = (s: Stats) => {
    if (!s.isFile() || s.uid !== uid || (s.mode & 0o7777) !== 0o600 || s.nlink !== 1) throw new Error('financial owner lock must be an owner-held regular non-symlink 0600 file with one link');
  };
  try { check(lstatSync(ownerPath)); }
  catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
  const fd = openSync(ownerPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const before = fstatSync(fd); check(before);
    // dup(fd) in the child shares the parent's open file description. Linux retains
    // this flock after the short helper exits until the parent's FD closes/SIGKILL.
    const lease = spawnSync('/usr/bin/flock', ['-xn', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd], timeout: 5000 });
    if (lease.error || lease.status !== 0) throw new Error(lease.status === 1 ? 'financial owner locked by another process' : 'Linux advisory flock unavailable; ownership not established');
    const after = lstatSync(ownerPath); check(after);
    if (after.dev !== before.dev || after.ino !== before.ino) throw new Error('financial owner lock changed during acquisition');
    return fd;
  } catch (e) { closeSync(fd); throw e; }
}

/** Pure financial schema validation shared by writer recovery and read-only backups. */
export function validateFinancialState(s: LedgerState, accountId: string, mode: LedgerMode) {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const key = (v: unknown, max: number) => boundedText(v, max) && !['__proto__','constructor','prototype'].includes(v);
  const eventTime = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= s.inceptionAt && (v as number) <= s.lastAt;
  if (!record(s) || s.schemaVersion !== 1 || s.accountId !== accountId || s.mode !== mode || s.initialMicroUsd !== INITIAL.toString() || !Number.isSafeInteger(s.inceptionAt) || s.inceptionAt < 0 || !Number.isSafeInteger(s.lastAt) || s.lastAt < s.inceptionAt || !Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error('financial identity/state invariant');
  if (!record(s.inceptionPrice)) throw new Error('inception conversion invariant');
  const inceptionPrice = priceAt(s.inceptionPrice, s.inceptionAt);
  const initialLamports = INITIAL * L / inceptionPrice;
  if (amount(s.roundingResidualMicroUsd) !== INITIAL - usd(initialLamports, inceptionPrice)) throw new Error('inception rounding invariant');
  if (!record(s.controls) || typeof s.controls.entriesEnabled !== 'boolean' || typeof s.controls.stopRequested !== 'boolean' || !boundedText(s.controls.reason) || !eventTime(s.controls.changedAt) || !(s.controls.readinessVersion === null || boundedText(s.controls.readinessVersion, 128)) || s.controls.stopRequested && s.controls.entriesEnabled || s.mode === 'PAPER' && s.controls.entriesEnabled && s.controls.readinessVersion === null) throw new Error('financial recovery/control invariant');
  if (!record(s.daily) || typeof s.daily.lossPaused !== 'boolean' || typeof s.daily.paused !== 'boolean' || s.daily.lossPaused && !s.daily.paused || !Number.isSafeInteger(s.daily.reconciledAt) || s.daily.reconciledAt < 0 || s.daily.reconciledAt > s.lastAt || typeof s.daily.day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(s.daily.day) || utcDay(Date.parse(s.daily.day + 'T00:00:00.000Z')) !== s.daily.day || s.daily.day < utcDay(s.inceptionAt) || s.daily.day > utcDay(s.lastAt) || s.daily.reconciledAt > 0 && utcDay(s.daily.reconciledAt) !== s.daily.day) throw new Error('financial day/reconciliation invariant');
  const cash = amount(s.lamports); const gasReserve = amount(s.gasReserve);
  if (initialLamports <= gasReserve) throw new Error('inception gas reserve invariant');
  amount(s.executionCosts); amount(s.daily.baselineMicroUsd);
  if (typeof s.realizedLamports !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(s.realizedLamports) || amount(s.realizedLamports.startsWith('-') ? s.realizedLamports.slice(1) : s.realizedLamports) > (1n << 127n) - 1n) throw new Error('realized balance invariant');
  if (!record(s.positions) || !record(s.pending) || !record(s.lockedDeposits) || Object.keys(s.positions).length > 3 || Object.keys(s.pending).length > 3 || Object.keys(s.lockedDeposits).length > 128) throw new Error('capacity/state map invariant');
  for (const [mint, deposit] of Object.entries(s.lockedDeposits)) {
    if (!key(mint, 96)) throw new Error('locked deposit identity invariant');
    amount(deposit);
  }
  for (const [mint, p] of Object.entries(s.positions)) {
    if (!record(p) || !key(mint, 96) || p.mint !== mint || !eventTime(p.enteredAt) || amount(p.units) === 0n || amount(p.entryLamports) === 0n || amount(p.entryGas) === 0n || amount(p.costMicroUsd) > 50_000_000n || amount(p.deposit) > amount(s.lockedDeposits[mint] ?? '0')) throw new Error('position identity/amount invariant');
  }
  let reservations = 0n;
  const pendingMints = new Set<string>(); let pendingBuys = 0;
  for (const [id, o] of Object.entries(s.pending)) {
    if (!record(o) || !key(id, 100) || o.id !== id || !key(o.mint, 96) || pendingMints.has(o.mint) || !eventTime(o.decidedAt) || !Number.isSafeInteger(o.executeAt) || !Number.isSafeInteger(o.expiresAt) || o.executeAt < o.decidedAt + 500 || o.expiresAt <= o.executeAt || o.expiresAt > o.decidedAt + 30_000 || !boundedText(o.decisionEvidence) || amount(o.gas) === 0n || amount(o.minReceive) === 0n) throw new Error('pending order identity/time/amount invariant');
    const gas = amount(o.gas), spend = amount(o.maxSpend), deposit = amount(o.deposit), reserved = amount(o.reserved);
    if (o.side === 'buy') {
      pendingBuys++;
      if (spend === 0n || s.positions[o.mint] || reserved !== gas + spend + deposit || deposit > 0n && s.lockedDeposits[o.mint]) throw new Error('pending buy reservation invariant');
    } else if (o.side === 'sell') {
      if (!s.positions[o.mint] || spend !== 0n || deposit !== 0n || reserved !== gas) throw new Error('pending exit reservation invariant');
    } else throw new Error('pending order side invariant');
    pendingMints.add(o.mint); reservations += reserved;
  }
  // The gas reserve protects NEW entries, not exits. Held-position management
  // may consume it, but no action may spend another action's reservation.
  if (reservations > cash || Object.keys(s.positions).length + pendingBuys > 3) throw new Error('cash reservation/capacity invariant');
}

export class PaperLedger {
  private readonly db: Database.Database;
  private ownerFd: number | undefined;
  readonly sqlite: { version: string; source: string };

  constructor(path: string, readonly accountId: string, readonly mode: LedgerMode = 'PAPER') {
    if (mode === 'DISPOSABLE_PAPER' ? !/^fixture-[a-z0-9-]{1,80}$/.test(accountId) : mode !== 'PAPER' || !/^poe-[a-z0-9-]{1,80}$/.test(accountId)) throw new Error('explicit POE or disposable fixture identity required');
    if (mode === 'PAPER' && (path === ':memory:' || path.length === 0)) throw new Error('durable PAPER account path required');
    const database = path === ':memory:' ? path : canonicalDatabase(path);
    if (database !== ':memory:') this.ownerFd = acquireOwner(database);
    let opened: Database.Database | undefined;
    try {
      if (database !== ':memory:') canonicalDatabase(database); // Recheck after acquiring the owner lease.
      this.db = opened = new Database(database, { timeout: 100 });
      this.sqlite = this.db.prepare('SELECT sqlite_version() version, sqlite_source_id() source').get() as typeof this.sqlite;
      const [major, minor, patch] = this.sqlite.version.split('.').map(Number);
      if (!(major! > 3 || major === 3 && (minor! > 51 || minor === 51 && patch! >= 3))) throw new Error('SQLite WAL-reset fixed version >=3.51.3 required');
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 5").all() as { name: string }[];
      if (tables.length && (!['financial_state','actions','journal'].every(name => tables.some(row => row.name === name)) || tables.some(row => !['financial_state','actions','journal','metadata'].includes(row.name)))) throw new Error('foreign database schema; refusing to initialize or modify');
      // Financial locks last only for short synchronous transactions. The separate
      // advisory flock owns the writer while network/market/reporting work awaits.
      this.db.pragma('locking_mode = NORMAL');
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.pragma('wal_autocheckpoint = 128');
      this.db.exec(`CREATE TABLE IF NOT EXISTS financial_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS journal (
        revision INTEGER PRIMARY KEY, action_id TEXT NOT NULL UNIQUE,
        at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      const existing = this.read();
      if (existing && ((existing.accountId ?? existing.fixtureId) !== accountId || existing.mode !== mode)) throw new Error('wrong fixture account or PAPER identity/mode');
      if (existing) { this.assertState(existing); this.getOperatingCosts(); }
      else if ((this.db.prepare('SELECT (SELECT count(*) FROM actions) + (SELECT count(*) FROM journal) + (SELECT count(*) FROM metadata) records').get() as { records: number }).records > 0) throw new Error('financial state missing from populated account; recovery required, never reseed');
    } catch (e) {
      try { opened?.close(); }
      finally { if (this.ownerFd !== undefined) { closeSync(this.ownerFd); this.ownerFd = undefined; } }
      throw e;
    }
  }

  private read(): State | undefined {
    const row = this.db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as { body: string } | undefined;
    return row ? JSON.parse(row.body) as State : undefined;
  }
  state(): Readonly<State> {
    const s = this.read();
    if (!s) throw new Error('PAPER account not initialized');
    return s;
  }
  private assertState(s: State) { validateFinancialState(s, this.accountId, this.mode); }
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
      const s = this.read(); if (!s) throw new Error('PAPER account not initialized');
      if (now < s.lastAt) throw new Error('financial time regression');
      const result = fn(s);
      s.lastAt = now; s.revision++; this.assertState(s);
      this.db.prepare('UPDATE financial_state SET body=? WHERE singleton=1').run(JSON.stringify(s));
      this.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id, hash, JSON.stringify(result));
      this.db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(s.revision, id, now, kind, JSON.stringify(payload));
      return result;
    }).immediate();
  }

  initialize(price: UsdPrice, at: number, gasReserve = '5000000') {
    return this.db.transaction(() => {
      const old = this.read();
      if (old) return old; // Never reseed or require a new conversion on recovery.
      const p = priceAt(price, at); const reserve = amount(gasReserve);
      const cash = INITIAL * L / p;
      if (cash <= reserve) throw new Error('insufficient simulated gas capital');
      const s: State = {
        schemaVersion: 1,
        accountId: this.accountId, ...(this.mode === 'DISPOSABLE_PAPER' ? { fixtureId: this.accountId } : {}), mode: this.mode, inceptionAt: at,
        initialMicroUsd: INITIAL.toString(), inceptionPrice: price, lamports: cash.toString(),
        roundingResidualMicroUsd: (INITIAL - usd(cash, p)).toString(), gasReserve,
        positions: {}, pending: {}, lockedDeposits: {}, lastAt: at, realizedLamports: '0', executionCosts: '0',
        daily: { day: utcDay(at), baselineMicroUsd: INITIAL.toString(), paused: true, lossPaused: false, reconciledAt: 0 }, revision: 0,
        controls: { entriesEnabled: this.mode === 'DISPOSABLE_PAPER', reason: this.mode === 'PAPER' ? 'startup: observation only; explicit runtime readiness required' : 'disposable fixture', changedAt: at, readinessVersion: null, stopRequested: false },
      };
      this.assertState(s);
      this.db.prepare('INSERT INTO financial_state VALUES(1,?)').run(JSON.stringify(s));
      this.db.prepare('INSERT INTO journal VALUES(0,?,?,?,?)').run('inception', at, 'inception', JSON.stringify({ price, gasReserve, mode: s.mode }));
      // One factual inception point from the recorded virtual contribution and
      // exact USD residual, not a synthetic price series or historical flatline.
      this.db.prepare("INSERT INTO metadata VALUES('reporting_history',?)").run(JSON.stringify({ points: [{ at, tradingMicroUsd: '0', economicMicroUsd: null }], windowLimited: false, downsampled: false } satisfies ReportingHistory));
      return s;
    }).immediate();
  }

  private equity(s: State, price: bigint, marks: Record<string, Mark>, now: number): bigint {
    let liquid = amount(s.lamports);
    for (const p of Object.values(s.positions)) {
      const mark = marks[p.mint];
      if (!mark || !boundedText(mark.evidence) || mark.pricedBaseUnits !== p.units || !Number.isSafeInteger(mark.at) || mark.at > now || now - mark.at > MAX_QUOTE_AGE) throw new Error('unknown/stale/wrong-size liquidation mark');
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
        s.daily = { day: utcDay(now), baselineMicroUsd: equity.toString(), paused: false, lossPaused: false, reconciledAt: now };
      } else {
        // Inception starts closed, and only fresh reconciliation opens it.
        if (s.daily.reconciledAt === 0) s.daily.paused = false;
        if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) { s.daily.paused = true; s.daily.lossPaused = true; }
        s.daily.reconciledAt = now;
      }
      return { equityMicroUsd: equity.toString(), paused: s.daily.paused };
    });
  }

  pause(id: string, now: number, reason = 'operator paused new entries') {
    if (!boundedText(reason)) throw new Error('bounded pause reason required');
    return this.apply(id, 'pause', now, { now, reason }, s => {
      s.daily.paused = true; s.controls.entriesEnabled = false;
      s.controls.reason = reason; s.controls.changedAt = now;
      const canceled = Object.values(s.pending).filter(o => o.side === 'buy').map(o => o.id);
      // Preserve already-decided actions until their modeled attempt/cancel is recorded.
      return { paused: true, pendingBuyCancellations: canceled };
    });
  }

  resume(id: string, now: number, price: UsdPrice, marks: Record<string, Mark>, readiness: RuntimeReadiness) {
    const p = priceAt(price, now);
    if (typeof readiness.version !== 'string' || !readiness.version || readiness.version.length > 128 || typeof readiness.evidence !== 'string' || !readiness.evidence || readiness.evidence.length > 512 || !Number.isSafeInteger(readiness.marketAt) || readiness.marketAt > now || now - readiness.marketAt > MAX_QUOTE_AGE || readiness.recoveryComplete !== true || readiness.candidateWindowsReady !== true || readiness.budgetAvailable !== true) throw new Error('fresh explicit runtime readiness required');
    return this.apply(id, 'resume', now, { now, price, marks, readiness }, s => {
      const equity = this.equity(s, p, marks, now);
      if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) { s.daily.paused = true; s.daily.lossPaused = true; }
      if (s.daily.day !== utcDay(now) || s.daily.reconciledAt === 0 || now - s.daily.reconciledAt > MAX_QUOTE_AGE || s.daily.lossPaused) return { enabled: false, reason: 'fresh reconciliation or next UTC-day loss reset required' };
      s.daily.paused = false;
      s.controls = { entriesEnabled: true, reason: 'explicit verified runtime readiness', changedAt: now, readinessVersion: readiness.version, stopRequested: false };
      return { enabled: true, reason: s.controls.reason };
    });
  }

  safeStop(id: string, now: number) {
    return this.apply(id, 'safe-stop', now, { now }, s => {
      s.controls.entriesEnabled = false; s.controls.stopRequested = true;
      s.controls.changedAt = now; s.controls.reason = 'safe stop requested'; s.daily.paused = true;
      const canceledEntries = Object.values(s.pending).filter(o => o.side === 'buy').map(o => o.id);
      for (const orderId of canceledEntries) delete s.pending[orderId];
      const openPositions = Object.keys(s.positions).length;
      const uncertainActions = Object.keys(s.pending).length;
      return { safeToExit: openPositions === 0 && uncertainActions === 0, state: openPositions || uncertainActions ? 'management-required' : 'stopped-safe', openPositions, uncertainActions, canceledEntries };
    });
  }

  cancelEntryOrders(id: string, now: number, reason: string, mint?: string) {
    if (!boundedText(reason)) throw new Error('bounded entry cancellation reason required');
    if (mint !== undefined && !boundedText(mint, 96)) throw new Error('bounded cancellation mint required');
    // The legacy three-argument payload remains byte-for-byte equivalent for
    // existing idempotency keys. A scoped action includes its exact mint.
    return this.apply(id, 'cancel-entry-orders', now, { now, reason, ...(mint === undefined ? {} : { mint }) }, s => {
      const canceledEntries = Object.values(s.pending).filter(o => o.side === 'buy' && (mint === undefined || o.mint === mint)).map(o => o.id);
      for (const orderId of canceledEntries) delete s.pending[orderId];
      return { canceledEntries, preservedExitOrders: Object.values(s.pending).filter(o => o.side === 'sell').map(o => o.id) };
    });
  }

  /** Durable no-reentry index; successful fills write this marker atomically. */
  hasTradedMint(mint: string): boolean {
    if (!boundedText(mint, 96)) throw new Error('bounded mint identity required');
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('traded_mint:' + mint) as { value: string } | undefined;
    if (row && row.value !== '1') throw new Error('traded mint history marker invalid');
    return !!row;
  }

  order(input: Omit<Order, 'reserved'>, price: UsdPrice, marks: Record<string, Mark>) {
    const now = input.decidedAt;
    return this.apply(`order:${input.id}`, 'order', now, { input, price, marks }, s => {
      if (!Number.isSafeInteger(input.executeAt) || !Number.isSafeInteger(input.expiresAt) || input.executeAt < now + 500 || input.expiresAt <= input.executeAt || input.expiresAt > now + 30_000 || !boundedText(input.decisionEvidence)) throw new Error('invalid delay/expiry/evidence');
      const gas = amount(input.gas); const dep = amount(input.deposit);
      const spend = amount(input.maxSpend); const min = amount(input.minReceive);
      if (gas === 0n || min === 0n || input.id.length > 100 || !input.id || !input.mint || ['__proto__', 'constructor', 'prototype'].some(k => k === input.id || k === input.mint)) throw new Error('invalid order amounts/identity');
      if (Object.values(s.pending).some(o => o.mint === input.mint)) throw new Error('one pending action per token');
      if (Object.keys(s.pending).length >= 3) throw new Error('pending capacity');
      let reserved = gas;
      if (input.side === 'buy') {
        if (spend === 0n) throw new Error('positive buy maximum required');
        const p = priceAt(price, now);
        const equity = this.equity(s, p, marks, now);
        if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) { s.daily.paused = true; s.daily.lossPaused = true; }
        if (s.daily.day !== utcDay(now) || s.daily.reconciledAt === 0 || now - s.daily.reconciledAt > MAX_QUOTE_AGE || s.daily.paused || !s.controls.entriesEnabled || s.controls.stopRequested) return { rejected: 'entries paused or reconciliation required' };
        if (s.positions[input.mint]) throw new Error('adds/re-entry into held position forbidden');
        if (this.hasTradedMint(input.mint)) throw new Error('re-entry after a prior PAPER fill forbidden');
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
      const entryReserve = input.side === 'buy' ? amount(s.gasReserve) : 0n;
      if (existing + reserved + entryReserve > amount(s.lamports)) throw new Error('insufficient unreserved cash');
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
        if (BigInt(s.daily.baselineMicroUsd) - equity >= 50_000_000n) { s.daily.paused = true; s.daily.lossPaused = true; }
        if (s.daily.day !== utcDay(now) || s.daily.paused || !s.controls.entriesEnabled || s.controls.stopRequested || now - s.daily.reconciledAt > MAX_QUOTE_AGE) return finish('failed', 'entry gate closed; canceled before attempt');
        const totalReservations = Object.values(s.pending).reduce((sum, pending) => sum + amount(pending.reserved), 0n);
        if (totalReservations + amount(s.gasReserve) > amount(s.lamports)) return finish('failed', 'gas reserve needed for held-position management; entry canceled before attempt');
      }
      const gas = amount(o.gas);
      chargedGas = gas;
      s.lamports = (amount(s.lamports) - gas).toString();
      s.executionCosts = (amount(s.executionCosts) + gas).toString();
      if (!quote || !boundedText(quote.evidence) || !Number.isSafeInteger(quote.at) || quote.at < o.executeAt || quote.at > now || now - quote.at > MAX_QUOTE_AGE) return finish('failed', 'missing/stale first-attempt state; gas charged; no retry');
      let spend: bigint, received: bigint;
      try { spend = amount(quote.spendLamports); received = amount(quote.receiveUnits); }
      catch { return finish('failed', 'malformed first-attempt amounts; gas charged; no retry'); }
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
        this.db.prepare('INSERT INTO metadata VALUES(?,?)').run('traded_mint:' + o.mint, '1');
      } else {
        const pos = s.positions[o.mint]; if (!pos) throw new Error('position missing');
        if (quote.pricedBaseUnits !== pos.units) return finish('failed', 'exit quote is not for actual full size; gas charged');
        let refund: bigint;
        try { refund = amount(quote.refundedDepositLamports ?? '0'); }
        catch { return finish('failed', 'malformed deposit refund; gas charged; no retry'); }
        const locked = amount(s.lockedDeposits[o.mint] ?? '0');
        if (refund > locked || refund > 0n && !boundedText(quote.refundEvidence)) return finish('failed', 'unverified deposit refund; gas charged');
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
      if (!boundedText(evidence) || refund === 0n || refund > locked || s.positions[mint]) throw new Error('verified closed-account refund required');
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
  /** Replaceable max50 filled-trade projection, verified by indexed durable actions. */
  getReportingTrades():ReportingTradeCache {
    const state=this.state(),size=this.db.prepare("SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key='reporting_trades'").get() as {size:number}|undefined;
    if(!size)return {schemaVersion:1,accountId:state.accountId,inceptionAt:state.inceptionAt,windowLimited:false,trades:[]};
    if(size.size>128*1024)throw Error('reporting trade cache bound');
    const raw=this.db.prepare("SELECT value FROM metadata WHERE key='reporting_trades'").get() as {value:string};
    const cache=validateReportingTradeCache(JSON.parse(raw.value),state.accountId,state.inceptionAt,state.lastAt);
    for(const trade of cache.trades)this.validateReportingTrade(trade);return cache;
  }
  private validateReportingTrade(trade:ReportingFilledTrade){
    const attempt=this.db.prepare('SELECT at,kind,detail FROM journal WHERE action_id=?').get(trade.actionId) as {at:number;kind:string;detail:string}|undefined;
    if(!attempt||attempt.kind!=='attempt'||Buffer.byteLength(attempt.detail)>65536)throw Error('reporting trade attempt absent');
    const payload=JSON.parse(attempt.detail),order=this.db.prepare('SELECT detail FROM journal WHERE action_id=?').get('order:'+payload.orderId) as {detail:string}|undefined;
    if(!order||Buffer.byteLength(order.detail)>65536)throw Error('reporting trade order absent');
    const expected=reportingFilledTrade(trade.actionId,attempt.at,payload,JSON.parse(order.detail),this.actionResult(trade.actionId));
    if(!expected||!isDeepStrictEqual(trade,expected))throw Error('reporting trade durable evidence mismatch');
  }
  recordReportingTrades(trades:readonly ReportingFilledTrade[]):ReportingTradeCache {
    const state=this.state();validateReportingTradeCache({schemaVersion:1,accountId:state.accountId,inceptionAt:state.inceptionAt,windowLimited:false,trades:[...trades].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))},state.accountId,state.inceptionAt,state.lastAt);
    return this.db.transaction(()=>{
      const previous=this.getReportingTrades(),byId=new Map(previous.trades.map(row=>[row.actionId,row]));
      for(const trade of trades){this.validateReportingTrade(trade);const old=byId.get(trade.actionId);if(old&&!isDeepStrictEqual(old,trade))throw Error('reporting trade cache conflict');byId.set(trade.actionId,structuredClone(trade));}
      const sorted=[...byId.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.actionId.localeCompare(b.actionId)),next:ReportingTradeCache={...previous,windowLimited:previous.windowLimited||sorted.length>50,trades:sorted.slice(0,50)};
      if(!isDeepStrictEqual(previous,next))this.db.prepare("INSERT INTO metadata VALUES('reporting_trades',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
      return next;
    }).immediate();
  }
  /** O(1) lookup of a durable idempotent result; no state or journal mutation. */
  actionResult(id: string): unknown | undefined {
    if (!id || id.length > 160) throw new Error('bounded action identity required');
    const row = this.db.prepare('SELECT result FROM actions WHERE id=?').get(id) as { result: string } | undefined;
    return row ? JSON.parse(row.result) : undefined;
  }
  /** Bounded read model; absence means unknown coverage, never assumed free operations. */
  getOperatingCosts(): OperatingCostState {
    const account = this.state();
    const size = this.db.prepare("SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key='operating_costs'").get() as { size: number } | undefined;
    if (!size) {
      // Existing durable action/journal IDs provide this indexed history check; do not
      // scan the journal or silently reseed a lost cost projection on refresh.
      for (const [from, through] of [['cost:', 'cost;'], ['cost-valuation:', 'cost-valuation;']]) {
        const action = this.db.prepare('SELECT 1 FROM actions WHERE id>=? AND id<? LIMIT 1').get(from, through);
        const journal = this.db.prepare('SELECT 1 FROM journal WHERE action_id>=? AND action_id<? LIMIT 1').get(from, through);
        if (action || journal) throw new Error('operating cost metadata missing from recorded history; recovery required');
      }
      return initializeOperatingCosts(account.accountId, account.inceptionAt);
    }
    if (size.size > 262_144) throw new Error('operating cost metadata limit');
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='operating_costs'").get() as { value: string };
    const costs = JSON.parse(row.value) as OperatingCostState;
    validateOperatingCosts(costs);
    if (costs.accountId !== account.accountId || costs.inceptionAt !== account.inceptionAt || costs.lastRecordedAt > account.lastAt) throw new Error('operating cost account/inception chronology mismatch');
    return costs;
  }
  /** Uses the same atomic journal/action/metadata transaction as PAPER finance.
   * Operating outlays affect economic P&L, not this virtual account's cash. */
  recordOperatingCost(event: OperatingCostEvent, now = event.recordedAt) {
    const identity = event.kind === 'valuation' ? event.expense?.id : event.id;
    if (!boundedText(identity, 128)) throw new Error('bounded operating cost action identity required');
    const actionId = event.kind === 'valuation' ? 'cost-valuation:' + identity : 'cost:' + identity;
    return this.apply(actionId, 'operating-cost', now, { event }, account => {
      // Deliberately inside apply: an identical old action returns its durable
      // result first, without rebasing original knowledge time or reapplying it.
      if (now !== event.recordedAt) throw new Error('new operating cost recording time must equal its evidence time');
      if (event.kind === 'valuation') {
        const row = this.db.prepare('SELECT kind, detail FROM journal WHERE action_id=?').get('cost:' + event.expense.id) as { kind: string; detail: string } | undefined;
        const original = row ? JSON.parse(row.detail) as { event?: OperatingCostEvent } : undefined;
        if (row?.kind !== 'operating-cost' || original?.event?.kind !== 'expense' || !isDeepStrictEqual(original.event, event.expense)) throw new Error('original operating expense does not match authoritative journal');
      }
      const costs = applyOperatingCostEvent(this.getOperatingCosts(), event, now), body = JSON.stringify(costs);
      if (Buffer.byteLength(body) > 262_144) throw new Error('operating cost metadata limit');
      this.db.prepare("INSERT INTO metadata VALUES('operating_costs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(body);
      return { recorded: true, actionId, eventId: event.id, kind: event.kind, accountId: account.accountId, inceptionAt: account.inceptionAt, recordedAt: now };
    });
  }
  async backup(path: string) { await this.db.backup(path); }
  nextSnapshotSequence() {
    this.state();
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT value FROM metadata WHERE key='snapshot_sequence'").get() as { value: string } | undefined;
      if (row && !/^(0|[1-9][0-9]{0,39})$/.test(row.value)) throw new Error('reporting sequence metadata invalid');
      const next = (BigInt(row?.value ?? '0') + 1n).toString();
      if (next.length > 40) throw new Error('reporting sequence exhausted');
      this.db.prepare("INSERT INTO metadata VALUES('snapshot_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(next);
      return next;
    }).immediate();
  }
  private validateReportingPoint(point: ReportingPoint, inceptionAt: number) {
    if (!point || typeof point !== 'object' || Array.isArray(point) || Object.keys(point).sort().join(',') !== 'at,economicMicroUsd,tradingMicroUsd' || !Number.isSafeInteger(point.at) || point.at < inceptionAt) throw new Error('invalid reporting point identity/time');
    for (const value of [point.tradingMicroUsd, point.economicMicroUsd]) {
      if (value === null) continue;
      if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(value)) throw new Error('integer reporting value required');
      amount(value.startsWith('-') ? value.slice(1) : value);
    }
  }
  getReportingHistory(): ReportingHistory {
    const inceptionAt = this.state().inceptionAt;
    const size = this.db.prepare("SELECT length(value) size FROM metadata WHERE key='reporting_history'").get() as { size: number } | undefined;
    if (!size) return { points: [], windowLimited: false, downsampled: false };
    if (size.size > 262_144) throw new Error('reporting history metadata limit');
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='reporting_history'").get() as { value: string };
    const history = JSON.parse(row.value) as ReportingHistory;
    if (!history || typeof history !== 'object' || Object.keys(history).sort().join(',') !== 'downsampled,points,windowLimited' || !Array.isArray(history.points) || history.points.length > 720 || typeof history.windowLimited !== 'boolean' || typeof history.downsampled !== 'boolean') throw new Error('invalid reporting history metadata');
    let previous = -Infinity;
    for (const point of history.points) {
      this.validateReportingPoint(point, inceptionAt);
      if (point.at <= previous) throw new Error('reporting history chronology');
      previous = point.at;
    }
    if (!history.windowLimited && history.points.length && (history.points[0]!.at !== inceptionAt || history.points[0]!.tradingMicroUsd !== '0')) throw new Error('reporting inception point mismatch');
    return history;
  }
  recordReportingPoint(point: ReportingPoint): ReportingHistory {
    this.validateReportingPoint(point, this.state().inceptionAt);
    return this.db.transaction(() => {
      const history = this.getReportingHistory(), last = history.points.at(-1);
      if (last && point.at < last.at) throw new Error('reporting point regression');
      if (last && point.at === last.at) {
        if (point.tradingMicroUsd !== last.tradingMicroUsd || point.economicMicroUsd !== last.economicMicroUsd) throw new Error('reporting point conflict');
        return history;
      }
      history.points.push({ ...point });
      if (history.points.length > 720) {
        // Preserve first/last and every actual null-transition boundary. Thin
        // the densest interior sample, without fabricating any point or gap.
        const mask = (p: ReportingPoint) => `${p.tradingMicroUsd === null}:${p.economicMicroUsd === null}`;
        let remove = -1, smallestSpan = Infinity;
        for (let i = 1; i < history.points.length - 1; i++) {
          const before = history.points[i - 1]!, current = history.points[i]!, after = history.points[i + 1]!;
          const span = after.at - before.at;
          if (mask(before) === mask(current) && mask(current) === mask(after) && span < smallestSpan) { remove = i; smallestSpan = span; }
        }
        if (remove >= 0) { history.points.splice(remove, 1); history.downsampled = true; }
        else { history.points.shift(); history.windowLimited = true; }
      }
      this.db.prepare("INSERT INTO metadata VALUES('reporting_history',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(history));
      return history;
    }).immediate();
  }
  getOperatingReportingHistory():OperatingReportingHistory {
    const inceptionAt=this.state().inceptionAt,size=this.db.prepare('SELECT length(CAST(value AS BLOB)) size FROM metadata WHERE key=?').get(REPORTING_OPERATING_HISTORY_KEY) as {size:number}|undefined;
    if(!size)return {schemaVersion:2,basis:OPERATING_REPORTING_BASIS,cutoverAt:null,firstObservedAt:null,points:[{at:inceptionAt,tradingMicroUsd:'0',economicMicroUsd:null}],windowLimited:false,downsampled:false};
    if(size.size>262144)throw Error('operating reporting history metadata limit');
    const row=this.db.prepare('SELECT value FROM metadata WHERE key=?').get(REPORTING_OPERATING_HISTORY_KEY) as {value:string};
    return validateOperatingReportingHistory(JSON.parse(row.value),inceptionAt);
  }
  /** Only reporting metadata is written. observedAt is the actual source
   * observation time; historical null markers denote absence, not old prices. */
  recordOperatingReportingPoint(point:ReportingPoint,observedAt:number):OperatingReportingHistory {
    const inceptionAt=this.state().inceptionAt;this.validateReportingPoint(point,inceptionAt);
    if(!Number.isSafeInteger(observedAt)||observedAt<point.at)throw Error('operating reporting observation time');
    const inceptionPoint=point.at===inceptionAt&&point.tradingMicroUsd==='0'&&point.economicMicroUsd===null;
    if(!inceptionPoint&&point.at<observedAt&&(point.tradingMicroUsd!==null||point.economicMicroUsd!==null))throw Error('operating reporting data cannot be backdated');
    return this.db.transaction(()=>{
      const h=this.getOperatingReportingHistory(),last=h.points.at(-1)!;
      if(point.at<last.at)throw Error('operating reporting point regression');
      if(point.at===last.at){if(point.tradingMicroUsd!==last.tradingMicroUsd||point.economicMicroUsd!==last.economicMicroUsd)throw Error('operating reporting point conflict');return h;}
      if(h.cutoverAt===null)h.cutoverAt=observedAt;
      if(h.points.length===1&&point.at>inceptionAt+1)h.points.push({at:inceptionAt+1,tradingMicroUsd:null,economicMicroUsd:null});
      h.points.push({...point});
      if(point.tradingMicroUsd!==null&&h.firstObservedAt===null)h.firstObservedAt=point.at;
      while(h.points.length>720){
        const mask=(p:ReportingPoint)=>`${p.tradingMicroUsd===null}:${p.economicMicroUsd===null}`;let remove=-1,smallest=Infinity;
        for(let i=1;i<h.points.length-1;i++){const a=h.points[i-1]!,b=h.points[i]!,c=h.points[i+1]!,span=c.at-a.at;if(mask(a)===mask(b)&&mask(b)===mask(c)&&span<smallest){remove=i;smallest=span;}}
        if(remove>=0){h.points.splice(remove,1);h.downsampled=true;}
        else{const gap=h.points[1]?.at===inceptionAt+1&&h.points[1].tradingMicroUsd===null&&h.points[1].economicMicroUsd===null;h.points.splice(gap?2:1,1);h.windowLimited=true;if(!gap&&h.points[1]!.at>inceptionAt+1)h.points.splice(1,0,{at:inceptionAt+1,tradingMicroUsd:null,economicMicroUsd:null});}
      }
      const validated=validateOperatingReportingHistory(h,inceptionAt),body=JSON.stringify(validated);if(Buffer.byteLength(body)>262144)throw Error('operating reporting history metadata limit');
      this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(REPORTING_OPERATING_HISTORY_KEY,body);return validated;
    }).immediate();
  }
  projection(now: number, price?: UsdPrice, marks: Record<string, Mark> = {}) {
    const s = this.state();
    const reservedLamports = Object.values(s.pending).reduce((sum, o) => sum + amount(o.reserved), 0n);
    const lockedDepositLamports = Object.values(s.lockedDeposits).reduce((sum, n) => sum + amount(n), 0n);
    let equityLamports: bigint | null = amount(s.lamports) + lockedDepositLamports;
    let unknownMarks = false;
    let positionLiquidationLamports = 0n;
    for (const position of Object.values(s.positions)) {
      const mark = marks[position.mint];
      if (!mark || !boundedText(mark.evidence) || mark.pricedBaseUnits !== position.units || !Number.isSafeInteger(mark.at) || mark.at > now || now - mark.at > MAX_QUOTE_AGE) { unknownMarks = true; continue; }
      positionLiquidationLamports += amount(mark.netLamports);
    }
    equityLamports = unknownMarks ? null : equityLamports + positionLiquidationLamports;
    let p: bigint | null = null;
    try { if (price) p = priceAt(price, now); } catch { /* Explicit unknown USD valuation. */ }
    const initialLamports = INITIAL * L / amount(s.inceptionPrice.microUsdPerSol);
    const equityMicroUsd = p !== null && equityLamports !== null ? usd(equityLamports, p) + amount(s.roundingResidualMicroUsd) : null;
    const passiveSolEquityMicroUsd = p !== null ? usd(initialLamports, p) + amount(s.roundingResidualMicroUsd) : null;
    const totalPnlMicroUsd = equityMicroUsd === null ? null : (equityMicroUsd - INITIAL).toString();
    const operating = projectOperatingCosts(this.getOperatingCosts(), { asOf: now, now, tradingPnlMicroUsd: totalPnlMicroUsd });
    const dayFresh = s.daily.day === utcDay(now) && s.daily.reconciledAt > 0 && now >= s.daily.reconciledAt && now - s.daily.reconciledAt <= MAX_QUOTE_AGE;
    return {
      accountId: s.accountId, mode: s.mode, inceptionAt: s.inceptionAt, initialMicroUsd: s.initialMicroUsd, revision: s.revision,
      cashLamports: s.lamports, reservedLamports: reservedLamports.toString(), lockedDepositLamports: lockedDepositLamports.toString(),
      equityLamports: equityLamports?.toString() ?? null, equityMicroUsd: equityMicroUsd?.toString() ?? null,
      totalPnlLamports: equityLamports === null ? null : (equityLamports - initialLamports).toString(),
      totalPnlMicroUsd,
      operatingCostsMicroUsd: operating.operatingCostsMicroUsd, economicPnlMicroUsd: operating.economicPnlMicroUsd, operatingCostClassification: operating.classification,
      passiveSolEquityMicroUsd: passiveSolEquityMicroUsd?.toString() ?? null,
      solPriceEffectMicroUsd: passiveSolEquityMicroUsd === null ? null : (passiveSolEquityMicroUsd - INITIAL).toString(),
      realizedLamports: s.realizedLamports, executionCostsLamports: s.executionCosts,
      positionLiquidationLamports: unknownMarks ? null : positionLiquidationLamports.toString(),
      positionCostMicroUsd: Object.values(s.positions).reduce((sum, x) => sum + amount(x.costMicroUsd), 0n).toString(),
      openPositions: Object.keys(s.positions).length, pendingActions: Object.keys(s.pending).length,
      entriesEnabled: s.controls.entriesEnabled && !s.controls.stopRequested && !s.daily.paused && dayFresh && equityMicroUsd !== null,
      unknownMarks, usdValuationAvailable: p !== null, daily: s.daily, controls: s.controls,
    };
  }
  integrity() { return this.db.pragma('integrity_check', { simple: true }); }
  close() {
    try { this.db.close(); }
    finally { if (this.ownerFd !== undefined) { closeSync(this.ownerFd); this.ownerFd = undefined; } }
  }
}

/** Fixture wrapper uses the same accounting implementation and rejects production identities. */
export class DisposableLedger extends PaperLedger {
  constructor(path: string, readonly fixtureId: string) { super(path, fixtureId, 'DISPOSABLE_PAPER'); }
}
