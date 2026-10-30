import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { LifetimeEquityStore, readPrivateOriginalSnapshot } from './lifetime-equity-store.js';

const RECEIVER = 'https://meme-machine-dashboard-staging.onrender.com/api/equity-history';
const SOURCE = '/var/lib/poe/service/snapshot.json';
const STORE = '/var/lib/poe/lifetime-equity/equity.sqlite';

function absolute(name: string, value: string) {
  if (!isAbsolute(value) || resolve(value) !== value || value.length > 4096) throw Error(name + '_INVALID');
  return value;
}
function secretFromFile(path: string): string {
  const file = absolute('EQUITY_SECRET_PATH', path);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const a = fstatSync(fd);
    if (!a.isFile() || a.nlink !== 1 || a.size === 0 || a.size > 4096 ||
        ![0, process.getuid?.()].includes(a.uid) || (a.mode & 0o077) !== 0) throw Error('EQUITY_CREDENTIAL_MODE');
    const raw = readFileSync(fd), b = fstatSync(fd);
    if (raw.length !== a.size || a.ino !== b.ino || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs)
      throw Error('EQUITY_CREDENTIAL_CHANGED');
    const key = raw.toString('utf8').trim();
    if (!/^[A-Za-z0-9._~+/=-]{24,512}$/.test(key)) throw Error('EQUITY_CREDENTIAL_INVALID');
    return key;
  } finally { closeSync(fd); }
}

export type EquityCompanionOptions = {
  sourceFile: string; storeFile: string; receiver?: string;
  credentialFile: string; fetch?: typeof fetch;
  bootstrapFile?: string; bootstrapSha256?: string;
};
/**
 * Auxiliary reporting-only process. Never imports PaperLedger or any trader;
 * failures only delay graph reporting and never affect PAPER entry/protection.
 */
export class OriginalEquityCompanion {
  readonly store: LifetimeEquityStore;
  private readonly opts: EquityCompanionOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private delivering = false;
  private lastDeliveredSequence = '';
  private lastDeliveryAt = 0;
  private lastAttemptAt = 0;
  private secret: string;
  constructor(options: EquityCompanionOptions) {
    this.opts = options;
    absolute('EQUITY_SOURCE', options.sourceFile);
    absolute('EQUITY_STORE', options.storeFile);
    if ((options.receiver ?? RECEIVER) !== RECEIVER) throw Error('EQUITY_RECEIVER_FIXED');
    this.secret = secretFromFile(options.credentialFile);
    this.store = new LifetimeEquityStore(options.storeFile);
    if (!!options.bootstrapFile !== !!options.bootstrapSha256) throw Error('EQUITY_BOOTSTRAP_PAIR_REQUIRED');
    if (options.bootstrapFile && options.bootstrapSha256)
      this.store.importReceiverCapture(options.bootstrapFile,options.bootstrapSha256);
  }
  async tick(now = Date.now()) {
    let ingested: 'accepted' | 'duplicate' | 'unavailable' = 'unavailable';
    try {
      const {snapshot, sha256} = readPrivateOriginalSnapshot(this.opts.sourceFile, now);
      ingested = this.store.accept(snapshot, sha256, now);
    } catch {
      // Market data, financial reconciliation, and trading run independently.
    }
    const history = this.store.history(now);
    if (history.points.length === 1) return { ingested, delivered: false };
    // Send a complete bounded source-owned series on process startup, after
    // every new observation and periodically for Render restart recovery.
    if (this.delivering || now - this.lastAttemptAt < 30_000 ||
        (this.lastDeliveredSequence && now - this.lastDeliveryAt < 60_000))
      return { ingested, delivered: false };
    this.delivering = true;
    this.lastAttemptAt = now;
    try {
      const response = await (this.opts.fetch ?? fetch)(RECEIVER, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: {authorization: 'Bearer ' + this.secret, 'content-type': 'application/json'},
        body: JSON.stringify(history),
      });
      await response.body?.cancel();
      if (!response.ok) return { ingested, delivered: false };
      this.lastDeliveredSequence = history.lastSequence;
      this.lastDeliveryAt = now;
      return { ingested, delivered: true };
    } catch {
      return { ingested, delivered: false };
    } finally { this.delivering = false; }
  }
  start() {
    if (this.timer) return;
    void this.tick();
    // Match the existing source publisher's 1s file poll, but upload the
    // bounded lifetime series at most once per minute.
    this.timer = setInterval(() => { void this.tick(); }, 1_000);
  }
  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.store.close();
  }
}

async function main() {
  if (process.getuid?.() === 0) throw Error('EQUITY_NONROOT_REQUIRED');
  process.umask(0o077);
  const sourceFile = absolute('EQUITY_SOURCE', process.env.POE_EQUITY_SOURCE_FILE ?? SOURCE);
  const storeFile = absolute('EQUITY_STORE', process.env.POE_EQUITY_STORE_FILE ?? STORE);
  const credentialFile = process.env.POE_EQUITY_CREDENTIAL_FILE ??
    (process.env.CREDENTIALS_DIRECTORY ? join(process.env.CREDENTIALS_DIRECTORY, 'poe-ingest-secret') : '');
  const bootstrapFile = process.env.POE_EQUITY_BOOTSTRAP_FILE;
  const bootstrapSha256 = process.env.POE_EQUITY_BOOTSTRAP_SHA256;
  const companion = new OriginalEquityCompanion({
    sourceFile, storeFile, credentialFile, bootstrapFile, bootstrapSha256,
  });
  companion.start();
  const stop = () => { companion.close(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1]?.endsWith('/lifetime-equity-publisher.js')) {
  main().catch(() => { process.stderr.write('POE_EQUITY_COMPANION_STARTUP_UNAVAILABLE\n'); process.exitCode = 1; });
}
