import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ORIGINAL_POE_ACCOUNT, ORIGINAL_POE_INCEPTION } from './operating-intelligence.js';
import { EQUITY_GAP_MS, LIFETIME_EQUITY_SOURCE, MAX_LIFETIME_EQUITY_POINTS,
  validateLifetimeEquityHistory, type LifetimeEquityHistory, type LifetimeEquityPoint } from './lifetime-equity-contract.js';
import { validateSnapshot, type Snapshot } from './reporting.js';

type PointRow = {at_ms: number; equity_usd: number; segment: number; kind: LifetimeEquityPoint['kind']};
type MetaRow = {account_id: string; inception_at: string; last_sequence: string; last_sha: string};

function canonicalDate(value: number) { return new Date(value).toISOString(); }
const SQL = {
  meta: 'SELECT account_id, inception_at, last_sequence, last_sha FROM equity_identity WHERE id=1',
  last: 'SELECT at_ms,equity_usd,segment,kind FROM equity_samples ORDER BY at_ms DESC LIMIT 1',
  plot: 'SELECT at_ms,equity_usd,segment,kind FROM equity_plot ORDER BY at_ms ASC',
};

/** Reads only the existing original source report, never the financial DB or secrets. */
export function readPrivateOriginalSnapshot(file: string, now = Date.now()): {snapshot: Snapshot; sha256: string} {
  if (!isAbsolute(file) || resolve(file) !== file) throw Error('EQUITY_SOURCE_ABSOLUTE_PATH_REQUIRED');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const a = fstatSync(fd);
    const uid = process.getuid?.();
    if (!a.isFile() || a.nlink !== 1 || a.uid !== uid || (a.mode & 0o077) !== 0 ||
        a.size === 0 || a.size > 128 * 1024) throw Error('EQUITY_SOURCE_PRIVATE_FILE_REQUIRED');
    const raw = readFileSync(fd), b = fstatSync(fd);
    if (raw.length !== a.size || a.ino !== b.ino || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs)
      throw Error('EQUITY_SOURCE_CHANGED');
    const source = JSON.parse(raw.toString('utf8')) as Snapshot;
    if (source?.account?.id !== ORIGINAL_POE_ACCOUNT ||
        source?.account?.inceptionAt !== ORIGINAL_POE_INCEPTION)
      throw Error('EQUITY_ORIGINAL_ACCOUNT_REQUIRED');
    const snapshot = validateSnapshot(source, {
      accountId: ORIGINAL_POE_ACCOUNT, inceptionAt: ORIGINAL_POE_INCEPTION,
      release: source.source.release, strategy: source.source.strategy,
    }, now);
    return { snapshot, sha256: createHash('sha256').update(raw).digest('hex') };
  } finally {
    closeSync(fd);
  }
}

function reportValid(snapshot: Snapshot, now: number): boolean {
  const at = Date.parse(snapshot.times.generatedAt);
  const market = snapshot.times.marketAt ? Date.parse(snapshot.times.marketAt) : NaN;
  const reconciled = snapshot.times.reconciledAt ? Date.parse(snapshot.times.reconciledAt) : NaN;
  return snapshot.status.reconciled === true && snapshot.balances.equityUsd !== null &&
    snapshot.balances.equityUsd >= 0 &&
    Number.isFinite(market) && Number.isFinite(reconciled) &&
    market <= at && reconciled <= at && at - market <= 90_000 && at - reconciled <= 90_000 &&
    at <= now + 30_000 && now - at <= 120_000;
}

function plotRows(db: Database.Database): PointRow[] {
  return db.prepare(SQL.plot).all() as PointRow[];
}
/** Preserve actual inception, current value, global extrema and interval edges. */
function compactPlot(db: Database.Database) {
  const rows = plotRows(db);
  if (rows.length <= MAX_LIFETIME_EQUITY_POINTS) return;
  const extrema = [Math.min(...rows.map(p => p.equity_usd)), Math.max(...rows.map(p => p.equity_usd))];
  let remove = -1, score = Infinity;
  for (let i = 1; i < rows.length - 1; i++) {
    const prev = rows[i - 1]!, cur = rows[i]!, next = rows[i + 1]!;
    if (cur.kind === 'inception' || extrema.includes(cur.equity_usd)) continue;
    // Segment changes are actual missing-data breaks, never interpolatable.
    const sameSegment = prev.segment === cur.segment && cur.segment === next.segment;
    if (!sameSegment) continue;
    const expected = prev.equity_usd + (next.equity_usd - prev.equity_usd) *
      (cur.at_ms - prev.at_ms) / (next.at_ms - prev.at_ms);
    const error = Math.abs(cur.equity_usd - expected);
    const candidate = error * Math.sqrt(Math.max(1, next.at_ms - prev.at_ms));
    if (candidate < score) { score = candidate; remove = i; }
  }
  if (remove < 0) {
    // If an extraordinary number of separate outages exhausts the display,
    // omit an interior point; the surviving segment IDs still forbid bridges.
    remove = rows.findIndex((p, i) => i > 0 && i < rows.length - 1 &&
      p.kind !== 'inception' && !extrema.includes(p.equity_usd));
  }
  if (remove < 0) throw Error('EQUITY_DISPLAY_CAPACITY_UNAVAILABLE');
  db.prepare('DELETE FROM equity_plot WHERE at_ms=?').run(rows[remove]!.at_ms);
}

/**
 * Dedicated SQLite sidecar on the SAME EC2 host. It is not the original
 * financial ledger: no updates to PAPER tables, controls, or execution state.
 * The full source-timestamp record is retained; the bounded public chart
 * representation is separately and deterministically downsampled.
 */
export class LifetimeEquityStore {
  private readonly db: Database.Database;
  constructor(file: string) {
    if (!isAbsolute(file) || resolve(file) !== file || !file.endsWith('.sqlite') ||
        /(?:^|\/)(?:ledger|financial)(?:\.|\/)/i.test(file)) throw Error('EQUITY_SIDECAR_PATH_INVALID');
    const parent = dirname(file);
    mkdirSync(parent, {recursive: true, mode: 0o700});
    const dir = lstatSync(parent);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() ||
        (dir.mode & 0o077) !== 0) throw Error('EQUITY_SIDECAR_PRIVATE_DIRECTORY_REQUIRED');
    try {
      const existing = lstatSync(file);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== process.getuid?.() ||
          (existing.mode & 0o077) !== 0) throw Error('EQUITY_SIDECAR_PRIVATE_FILE_REQUIRED');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    this.db = new Database(file, {fileMustExist: false});
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('busy_timeout = 1000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS equity_identity (
        id INTEGER PRIMARY KEY CHECK(id=1),
        account_id TEXT NOT NULL,
        inception_at TEXT NOT NULL,
        last_sequence TEXT NOT NULL,
        last_sha TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS equity_samples (
        sequence TEXT PRIMARY KEY,
        at_ms INTEGER NOT NULL UNIQUE,
        equity_usd REAL NOT NULL,
        segment INTEGER NOT NULL,
        kind TEXT NOT NULL,
        sha256 TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS equity_plot (
        at_ms INTEGER PRIMARY KEY,
        equity_usd REAL NOT NULL,
        segment INTEGER NOT NULL,
        kind TEXT NOT NULL
      );
    `);
    this.db.transaction(() => {
      const existing = this.meta();
      if (existing) {
        if (existing.account_id !== ORIGINAL_POE_ACCOUNT ||
            existing.inception_at !== ORIGINAL_POE_INCEPTION) throw Error('EQUITY_SIDECAR_ACCOUNT_CONFLICT');
        return;
      }
      const inception = Date.parse(ORIGINAL_POE_INCEPTION);
      this.db.prepare('INSERT INTO equity_identity VALUES(1,?,?,?,?)')
        .run(ORIGINAL_POE_ACCOUNT, ORIGINAL_POE_INCEPTION, '0', '');
      // Recorded original $1,000 contribution: an inception fact, not a
      // backfilled market valuation or invented historical equity trajectory.
      this.db.prepare('INSERT INTO equity_samples VALUES(?,?,?,?,?,?)')
        .run('0', inception, 1000, 0, 'inception', '');
      this.db.prepare('INSERT INTO equity_plot VALUES(?,?,?,?)')
        .run(inception, 1000, 0, 'inception');
    }).immediate();
  }
  private meta() { return this.db.prepare(SQL.meta).get() as MetaRow | undefined; }
  /** Record authenticated source valuations; ignore stale/incomplete source marks. */
  accept(snapshot: Snapshot, sha256: string, now = Date.now()): 'accepted' | 'duplicate' | 'unavailable' {
    if (snapshot.account.id !== ORIGINAL_POE_ACCOUNT ||
        snapshot.account.inceptionAt !== ORIGINAL_POE_INCEPTION ||
        snapshot.account.initialUsd !== 1000) throw Error('EQUITY_ORIGINAL_ACCOUNT_REQUIRED');
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error('EQUITY_SOURCE_SHA_REQUIRED');
    if (!reportValid(snapshot, now)) return 'unavailable';
    return this.db.transaction(() => {
      const meta = this.meta()!;
      const sequence = BigInt(snapshot.sequence), previous = BigInt(meta.last_sequence);
      if (sequence <= previous) {
        const row = this.db.prepare('SELECT sha256 FROM equity_samples WHERE sequence=?').get(snapshot.sequence) as {sha256: string} | undefined;
        if (sequence === previous && row?.sha256 === sha256) return 'duplicate';
        throw Error('EQUITY_SOURCE_SEQUENCE_CONFLICT');
      }
      const at = Date.parse(snapshot.times.generatedAt);
      const last = this.db.prepare(SQL.last).get() as PointRow;
      if (at <= last.at_ms) throw Error('EQUITY_SOURCE_TIME_REGRESSION');
      const segment = at - last.at_ms > EQUITY_GAP_MS ? last.segment + 1 : last.segment;
      const usd = snapshot.balances.equityUsd!;
      this.db.prepare('INSERT INTO equity_samples VALUES(?,?,?,?,?,?)')
        .run(snapshot.sequence, at, usd, segment, 'observed', sha256);
      const bucket = Math.floor(at / 60_000);
      const recent = this.db.prepare('SELECT at_ms FROM equity_plot ORDER BY at_ms DESC LIMIT 1').get() as {at_ms: number};
      if (Math.floor(recent.at_ms / 60_000) === bucket && recent.at_ms !== Date.parse(ORIGINAL_POE_INCEPTION)) {
        this.db.prepare('DELETE FROM equity_plot WHERE at_ms=?').run(recent.at_ms);
      }
      this.db.prepare('INSERT INTO equity_plot VALUES(?,?,?,?)').run(at, usd, segment, 'observed');
      compactPlot(this.db);
      this.db.prepare('UPDATE equity_identity SET last_sequence=?, last_sha=? WHERE id=1')
        .run(snapshot.sequence, sha256);
      return 'accepted';
    }).immediate();
  }
  history(now = Date.now()): LifetimeEquityHistory {
    const meta = this.meta()!;
    const points = plotRows(this.db).map(row => ({
      at: canonicalDate(row.at_ms), equityUsd: row.equity_usd,
      segment: row.segment, kind: row.kind,
    }));
    const total = (this.db.prepare('SELECT count(*) n FROM equity_samples').get() as {n:number}).n;
    return validateLifetimeEquityHistory({
      schemaVersion: 1, accountId: ORIGINAL_POE_ACCOUNT, inceptionAt: ORIGINAL_POE_INCEPTION,
      source: LIFETIME_EQUITY_SOURCE, lastSequence: meta.last_sequence,
      downsampled: total > points.length, points,
    }, now);
  }
  stats() {
    const first = this.db.prepare('SELECT MIN(at_ms) at FROM equity_samples WHERE kind=?').get('observed') as {at:number|null};
    const last = this.db.prepare('SELECT MAX(at_ms) at FROM equity_samples WHERE kind=?').get('observed') as {at:number|null};
    const count = (this.db.prepare('SELECT count(*) n FROM equity_samples WHERE kind=?').get('observed') as {n:number}).n;
    return {originalInception: ORIGINAL_POE_INCEPTION, firstVerifiedObservedAt: first.at===null?null:canonicalDate(first.at),
      lastVerifiedObservedAt: last.at===null?null:canonicalDate(last.at), originalVerifiedObservations: count,
      publishedDisplayPoints: plotRows(this.db).length};
  }
  close() { this.db.close(); }
}
