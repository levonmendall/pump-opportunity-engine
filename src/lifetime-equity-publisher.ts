import { constants, closeSync, fstatSync, openSync, readFileSync,writeFileSync,renameSync,unlinkSync } from 'node:fs';
import { dirname,isAbsolute, join, resolve } from 'node:path';
import { LifetimeEquityStore, readPrivateOriginalSnapshot } from './lifetime-equity-store.js';

const RECEIVER = 'https://meme-machine-dashboard-staging.onrender.com/api/equity-history';
const SOURCE = '/var/lib/poe/native-engine/snapshot.json';
const STORE = '/var/lib/poe/lifetime-equity/equity.sqlite';

function absolute(name: string, value: string) {
  if (!isAbsolute(value) || resolve(value) !== value || value.length > 4096) throw Error(name + '_INVALID');
  return value;
}
export function equityCredentialOwnerModeAccepted(path:string,file:{uid:number;gid:number;mode:number},uid:number|undefined,credentialDirectory?:string) {
  const directories=['/run/credentials/poe-lifetime-equity.service','/run/credentials/poe-runtime.service'];
  const systemd=directories.some(directory=>credentialDirectory===directory&&path===directory+'/poe-ingest-secret')&&
    file.uid===0&&file.gid===0&&(file.mode&0o7777)===0o440;
  return systemd||[0,uid].includes(file.uid)&&(file.mode&0o077)===0;
}
function secretFromFile(path: string): string {
  const file = absolute('EQUITY_SECRET_PATH', path);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const a = fstatSync(fd);
    if (!a.isFile() || a.nlink !== 1 || a.size === 0 || a.size > 4096 ||
        !equityCredentialOwnerModeAccepted(file,a,process.getuid?.(),process.env.CREDENTIALS_DIRECTORY)) throw Error('EQUITY_CREDENTIAL_MODE');
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
  bootstrapFile?: string; bootstrapSha256?: string;statusFile?:string;
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
  private closed = false;
  private lastDeliveredSequence = '';
  private lastDeliveryAt = 0;
  private lastAttemptAt = 0;
  private secret: string;
  private readonly telemetry={version:'poe-lifetime-equity-health-v1',generatedAt:0,sourceState:'not-observed',ingestionReasonCode:null as string|null,deliveryState:'not-attempted',httpStatus:null as number|null,attempts:0,deliveryFailures:0,lastDeliveredAt:null as number|null,lastSourceAt:null as string|null,statusWriteFailures:0};
  status(){return {...this.telemetry,store:this.store.stats(),readOnlyFinancialSource:true,financialDatabaseOpened:false};}
  private publishStatus(now:number){
    if(this.closed)return;
    this.telemetry.generatedAt=now;const target=this.opts.statusFile??join(dirname(this.opts.storeFile),'status.json');
    const temporary=target+'.'+process.pid+'.tmp';
    try{writeFileSync(temporary,JSON.stringify(this.status())+'\n',{flag:'wx',mode:0o600});renameSync(temporary,target);}
    catch{this.telemetry.statusWriteFailures++;try{unlinkSync(temporary);}catch{}}
  }
  constructor(options: EquityCompanionOptions) {
    this.opts = options;
    absolute('EQUITY_SOURCE', options.sourceFile);
    absolute('EQUITY_STORE', options.storeFile);
    if(options.statusFile){absolute('EQUITY_STATUS',options.statusFile);if(dirname(options.statusFile)!==dirname(options.storeFile))throw Error('EQUITY_STATUS_SIDECAR_DIRECTORY_REQUIRED');}
    if ((options.receiver ?? RECEIVER) !== RECEIVER) throw Error('EQUITY_RECEIVER_FIXED');
    this.secret = secretFromFile(options.credentialFile);
    this.store = new LifetimeEquityStore(options.storeFile);
    if (!!options.bootstrapFile !== !!options.bootstrapSha256) throw Error('EQUITY_BOOTSTRAP_PAIR_REQUIRED');
    if (options.bootstrapFile && options.bootstrapSha256)
      this.store.importReceiverCapture(options.bootstrapFile,options.bootstrapSha256);
  }
  async tick(now = Date.now()) {
    if(this.closed)return {ingested:'unavailable' as const,delivered:false};
    let ingested: 'accepted' | 'duplicate' | 'unavailable' = 'unavailable';
    try {
      const {snapshot, sha256} = readPrivateOriginalSnapshot(this.opts.sourceFile, now);
      ingested = this.store.accept(snapshot, sha256, now);
      this.telemetry.sourceState=ingested;this.telemetry.lastSourceAt=snapshot.times.generatedAt;this.telemetry.ingestionReasonCode=null;
    } catch(error) {
      this.telemetry.sourceState='unavailable';
      const code=(error as NodeJS.ErrnoException)?.code;
      this.telemetry.ingestionReasonCode=code==='ENOENT'?'SOURCE_FILE_MISSING':code==='EACCES'?'SOURCE_FILE_ACCESS_DENIED':'SOURCE_VALIDATION_OR_STORE_UNAVAILABLE';
      // Market data, financial reconciliation, and trading run independently.
    }
    this.publishStatus(now);
    const history = this.store.history(now);
    if (history.points.length === 1) return { ingested, delivered: false };
    // Send a complete bounded source-owned series on process startup, after
    // every new observation and periodically for Render restart recovery.
    if (this.delivering || now - this.lastAttemptAt < 30_000 ||
        (this.lastDeliveredSequence && now - this.lastDeliveryAt < 60_000))
      return { ingested, delivered: false };
    this.delivering = true;
    this.lastAttemptAt = now;this.telemetry.attempts++;this.telemetry.deliveryState='pending';
    try {
      const response = await (this.opts.fetch ?? fetch)(RECEIVER, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: {authorization: 'Bearer ' + this.secret, 'content-type': 'application/json'},
        body: JSON.stringify(history),
      });
      await response.body?.cancel();
      this.telemetry.httpStatus=response.status;
      if (!response.ok){this.telemetry.deliveryState='http-refused';this.telemetry.deliveryFailures++;return { ingested, delivered: false };}
      this.lastDeliveredSequence = history.lastSequence;
      this.lastDeliveryAt = now;this.telemetry.lastDeliveredAt=now;this.telemetry.deliveryState='accepted';
      return { ingested, delivered: true };
    } catch {
      this.telemetry.deliveryState='network-unavailable';this.telemetry.httpStatus=null;this.telemetry.deliveryFailures++;
      return { ingested, delivered: false };
    } finally { this.delivering = false;this.publishStatus(now); }
  }
  start() {
    if (this.timer||this.closed) return;
    void this.tick();
    // Match the existing source publisher's 1s file poll, but upload the
    // bounded lifetime series at most once per minute.
    this.timer = setInterval(() => { void this.tick(); }, 1_000);
  }
  close() {
    if(this.closed)return;this.closed=true;
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
  // Independent, optional reporting loop. Its read-only ledger connection and
  // separate store never enter the financial runtime or equity calculations.
  const reviews = process.env.POE_SALE_REVIEWS_ENABLED === '1'
    ? new (await import('./sale-review-companion.js')).SaleReviewCompanion({
        ledgerFile:'/var/lib/poe/state/ledger.sqlite', equityStoreFile:storeFile,
        secret:secretFromFile(credentialFile),
      }) : null;
  reviews?.start();
  const stop = () => { companion.close(); void reviews?.stop(); process.exitCode = 0; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1]?.endsWith('/lifetime-equity-publisher.js')||process.argv[1]?.endsWith('/lifetime-equity-publisher.mjs')) {
  main().catch(() => { process.stderr.write('POE_EQUITY_COMPANION_STARTUP_UNAVAILABLE\n'); process.exitCode = 1; });
}
