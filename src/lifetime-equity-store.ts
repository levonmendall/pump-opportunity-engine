import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { chmodSync, constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
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
  const minIndex = rows.reduce((i, p, n) => p.equity_usd < rows[i]!.equity_usd ? n : i, 0);
  const maxIndex = rows.reduce((i, p, n) => p.equity_usd > rows[i]!.equity_usd ? n : i, 0);
  let remove = -1, score = Infinity;
  for (let i = 1; i < rows.length - 1; i++) {
    const prev = rows[i - 1]!, cur = rows[i]!, next = rows[i + 1]!;
    if (cur.kind === 'inception' || i === minIndex || i === maxIndex) continue;
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
      p.kind !== 'inception' && i !== minIndex && i !== maxIndex);
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
const SIDECAR_APPLICATION_ID = 0x504f4545;
const SIDECAR_TABLES = ['equity_identity','equity_imported_capture','equity_plot','equity_samples'];
const SIDECAR_COLUMNS: Record<string,string[]> = {
  equity_identity:['id','account_id','inception_at','last_sequence','last_sha'],
  equity_imported_capture:['sha256','accepted_at_ms','observation_count'],
  equity_plot:['at_ms','equity_usd','segment','kind'],
  equity_samples:['sequence','at_ms','equity_usd','segment','kind','sha256'],
};
function sidecarFile(file:string) {
  const value=lstatSync(file);
  if(!value.isFile()||value.isSymbolicLink()||value.nlink!==1||value.uid!==process.getuid?.()||
      (value.mode&0o077)!==0)throw Error('EQUITY_SIDECAR_PRIVATE_FILE_REQUIRED');
  return value;
}
/** Inspect an existing database READ ONLY before any writable open or PRAGMA.
 * Exact sidecar tables are required; a renamed financial database is refused.
 * The hardlink and descriptor identity checks prevent aliasing another file.
 */
function verifyExistingSidecar(file:string) {
  const before=sidecarFile(file),db=new Database(file,{readonly:true,fileMustExist:true});
  try {
    const application=db.pragma('application_id',{simple:true});
    const tables=db.prepare("SELECT type,name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as {type:string;name:string}[];
    if(![0,SIDECAR_APPLICATION_ID].includes(application as number)||
        tables.length!==SIDECAR_TABLES.length||tables.some((row,i)=>row.type!=='table'||row.name!==SIDECAR_TABLES[i]))
      throw Error('EQUITY_SIDECAR_FOREIGN_SCHEMA');
    for(const table of SIDECAR_TABLES) {
      const columns=db.pragma('table_info('+table+')') as {name:string}[];
      if(JSON.stringify(columns.map(row=>row.name))!==JSON.stringify(SIDECAR_COLUMNS[table]))throw Error('EQUITY_SIDECAR_FOREIGN_SCHEMA');
    }
    const identity=db.prepare(SQL.meta).get() as MetaRow|undefined;
    if(!identity||identity.account_id!==ORIGINAL_POE_ACCOUNT||identity.inception_at!==ORIGINAL_POE_INCEPTION)
      throw Error('EQUITY_SIDECAR_ACCOUNT_CONFLICT');
  } finally {db.close();}
  const after=sidecarFile(file);
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
    throw Error('EQUITY_SIDECAR_FILE_CHANGED');
  return after;
}

export class LifetimeEquityStore {
  private readonly db: Database.Database;
  private readonly directory: string;
  constructor(file: string) {
    if (!isAbsolute(file) || resolve(file) !== file || !file.endsWith('.sqlite') ||
        /(?:^|\/)(?:ledger|financial)(?:\.|\/)/i.test(file)) throw Error('EQUITY_SIDECAR_PATH_INVALID');
    const parent = dirname(file);
    this.directory = parent;
    mkdirSync(parent, {recursive: true, mode: 0o700});
    const dir = lstatSync(parent);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() ||
        (dir.mode & 0o077) !== 0 || realpathSync(parent)!==parent) throw Error('EQUITY_SIDECAR_PRIVATE_DIRECTORY_REQUIRED');
    let checked:ReturnType<typeof lstatSync>;
    try {checked=verifyExistingSidecar(file);}
    catch(e) {
      if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
      // Precreate exactly this new file, without following links or replacing data.
      const descriptor=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try {checked=fstatSync(descriptor);} finally {closeSync(descriptor);}
    }
    this.db = new Database(file, {fileMustExist: true});
    const opened=sidecarFile(file);
    if(opened.dev!==checked.dev||opened.ino!==checked.ino){this.db.close();throw Error('EQUITY_SIDECAR_FILE_CHANGED');}
    chmodSync(file, 0o600);
    this.db.pragma('application_id = '+SIDECAR_APPLICATION_ID);
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
      CREATE TABLE IF NOT EXISTS equity_imported_capture (
        sha256 TEXT PRIMARY KEY,
        accepted_at_ms INTEGER NOT NULL,
        observation_count INTEGER NOT NULL
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
  /**
   * Explicit one-time import of the ACTUAL old accepted Render equity readings,
   * captured read-only and pinned to a hash by the admin runner before a deploy.
   * Not a trading-P&L reconstruction. Requires owner-reviewed placement beside
   * this sidecar; never searches the financial ledger or arbitrary directories.
   */
  importReceiverCapture(file: string, expectedSha256: string, now = Date.now()): 'imported' | 'duplicate' {
    if (!isAbsolute(file) || resolve(file) !== file ||
        dirname(file) !== this.directory || !file.split('/').at(-1)?.startsWith('accepted-original-equity-') ||
        !file.endsWith('.json') || !/^[a-f0-9]{64}$/.test(expectedSha256))
      throw Error('EQUITY_CAPTURE_PIN_REQUIRED');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let raw: Buffer;
    try {
      const first = fstatSync(fd);
      if (!first.isFile() || first.nlink !== 1 || first.uid !== process.getuid?.() ||
          (first.mode & 0o077) !== 0 || first.size < 50 || first.size > 524288)
        throw Error('EQUITY_CAPTURE_NOT_PRIVATE');
      raw = readFileSync(fd);
      const second = fstatSync(fd);
      if (raw.length !== first.size || second.ino !== first.ino ||
          second.mtimeMs !== first.mtimeMs || second.ctimeMs !== first.ctimeMs)
        throw Error('EQUITY_CAPTURE_CHANGED');
    } finally { closeSync(fd); }
    const digest = createHash('sha256').update(raw).digest('hex');
    if (digest !== expectedSha256) throw Error('EQUITY_CAPTURE_HASH_MISMATCH');
    const v = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    if (!v || typeof v !== 'object' || v.kind !== 'POE_ACCEPTED_ORIGINAL_EQUITY_RECEIVER_CAPTURE' ||
        v.accountId !== ORIGINAL_POE_ACCOUNT || v.inceptionAt !== ORIGINAL_POE_INCEPTION ||
        typeof v.sourceAt !== 'string' || !Number.isFinite(Date.parse(v.sourceAt)) ||
        typeof v.receiverBodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.receiverBodySha256))
      throw Error('EQUITY_CAPTURE_ACCOUNT_OR_RECEIPT');
    const h = v.receiverHistory as Record<string, unknown> | undefined;
    if (!h || h.source !== 'accepted-authoritative-portfolio-equity' ||
        h.retention !== 'receiver-memory-only' || !Array.isArray(h.points) ||
        h.points.length < 1 || h.points.length > 1440)
      throw Error('EQUITY_CAPTURE_SCHEMA');
    let prior = Date.parse(ORIGINAL_POE_INCEPTION) - 1;
    const points: {at: number; usd: number}[] = [];
    for (const item of h.points) {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
          Object.keys(item).sort().join('|') !== 'at|equityUsd') throw Error('EQUITY_CAPTURE_POINT_SCHEMA');
      const p = item as Record<string, unknown>;
      const at = typeof p.at === 'string' ? Date.parse(p.at) : NaN;
      if (!Number.isSafeInteger(at) || at <= prior ||
          at < Date.parse(ORIGINAL_POE_INCEPTION) || at > Date.parse(v.sourceAt) ||
          at > now + 30_000 || typeof p.equityUsd !== 'number' ||
          !Number.isFinite(p.equityUsd) || p.equityUsd < 0)
        throw Error('EQUITY_CAPTURE_CHRONOLOGY_OR_VALUE');
      points.push({at,usd:p.equityUsd});prior=at;
    }
    return this.db.transaction(() => {
      const exists = this.db.prepare('SELECT 1 FROM equity_imported_capture WHERE sha256=?').get(digest);
      if (exists) return 'duplicate';
      for (const point of points) {
        const existing = this.db.prepare('SELECT equity_usd FROM equity_samples WHERE at_ms=?')
          .get(point.at) as {equity_usd: number} | undefined;
        if (existing) {
          if (existing.equity_usd !== point.usd) throw Error('EQUITY_CAPTURE_SOURCE_VALUE_CONFLICT');
          continue;
        }
        this.db.prepare('INSERT INTO equity_samples VALUES(?,?,?,?,?,?)')
          .run('receiver:' + point.at, point.at, point.usd, 0, 'observed', v.receiverBodySha256);
      }
      // The capture may precede the active source: re-evaluate gap boundaries
      // across all TRUE timestamped original-account observations.
      const all = this.db.prepare('SELECT sequence,at_ms,equity_usd,kind FROM equity_samples ORDER BY at_ms')
        .all() as (PointRow & {sequence:string})[];
      let priorAt = -Infinity, seg = 0;
      const update = this.db.prepare('UPDATE equity_samples SET segment=? WHERE sequence=?');
      this.db.prepare('DELETE FROM equity_plot').run();
      const insert = this.db.prepare('INSERT INTO equity_plot VALUES(?,?,?,?)');
      const drop = this.db.prepare('DELETE FROM equity_plot WHERE at_ms=?');
      let previousPlot: PointRow | null = null;
      for (const row of all) {
        if (priorAt >= 0 && row.at_ms - priorAt > EQUITY_GAP_MS) seg++;
        update.run(seg,row.sequence);
        if (previousPlot && Math.floor(previousPlot.at_ms / 60_000) === Math.floor(row.at_ms / 60_000) &&
            previousPlot.kind !== 'inception') drop.run(previousPlot.at_ms);
        insert.run(row.at_ms,row.equity_usd,seg,row.kind);
        previousPlot = {...row,segment:seg};
        compactPlot(this.db);
        priorAt = row.at_ms;
      }
      this.db.prepare('INSERT INTO equity_imported_capture VALUES(?,?,?)').run(digest,now,points.length);
      return 'imported';
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
