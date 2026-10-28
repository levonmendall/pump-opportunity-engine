import { createHash } from 'node:crypto';
import {validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION,type OperatingIntelligence} from './operating-intelligence.js';

export const MAX_SNAPSHOT_BYTES = 128 * 1024;
export type ReportingIdentity = { accountId: string; inceptionAt: string; release: string; strategy: string };
export type Snapshot = {
  intelligence?: OperatingIntelligence;
  project: 'pump-opportunity-engine'; mode: 'PAPER'; liveTrading: false; schemaVersion: 1;
  account: { id: string; inceptionAt: string; initialUsd: 1000 };
  sequence: string; source: { release: string; strategy: string };
  times: { generatedAt: string; marketAt: string | null; reconciledAt: string | null; usefulProgressAt: string | null };
  status: { runtime: 'running' | 'stopped' | 'unavailable'; market: 'observing' | 'warming' | 'unavailable'; entries: 'enabled' | 'paused' | 'disabled'; reconciled: boolean; blocker: string | null };
  balances: {
    cashSol: string; reservedSol: string; equitySol: string | null; equityUsd: number | null;
    realizedUsd: number | null; unrealizedUsd: number | null; tradingPnlUsd: number | null;
    economicPnlUsd: number | null; positionCostUsd: number; markedExposureUsd: number | null;
    drawdownUsd: number | null; executionCostsUsd: number | null; operatingCostsUsd: number | null;
    passiveSolEquityUsd: number | null; solPriceUsd: number | null;
  };
  costLabels: { execution: 'simulated'; operating: 'actual' | 'estimated' | 'allocated' | 'mixed' | 'unavailable' };
  positions: { mint: string; label: string; quantity: string; enteredAt: string; entryCostUsd: number; netLiquidationUsd: number | null; executionCostsUsd: number; status: string }[];
  trades: { id: string; mint: string; side: 'buy' | 'sell'; quantity: string; at: string; valueUsd: number | null; executionCostsUsd: number | null; status: string; reason: string }[];
  decisions: { id: string; mint: string; at: string; stage: string; reason: string }[];
  pnl: { at: string; tradingUsd: number | null; economicUsd: number | null }[];
  history: { windowStartAt: string | null; downsampled: boolean; label: string };
  funnel: { discovered: number; supported: number; sufficientlyObserved: number; evaluated: number; qualified: number; attempted: number; paperFilled: number; exited: number; reconciled: number };
  metrics: { processingLagMs: number | null; eventLoopLagMs: number | null; providerEvents: number; rpcRequests: number; projectedDailyDataSol: number | null; budgetRemainingSol: number | null; budgetStatus: 'available' | 'degraded' | 'unavailable'; coverage: string; latency: string };
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('object required');
  const o = value as Record<string, unknown>;
  if (Object.keys(o).sort().join('|') !== [...keys].sort().join('|')) throw new Error('unexpected/missing fields');
  return o;
}
function text(value: unknown, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('bounded text required');
}
function time(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) throw new Error('UTC millisecond timestamp required');
  const n = Date.parse(value);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== value) throw new Error('invalid timestamp');
  return n;
}
function number(value: unknown, nonnegative = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15 || nonnegative && value < 0) throw new Error('bounded finite number required');
}
function nullable(value: unknown, check: (v: unknown) => unknown) { if (value !== null) check(value); }
function oneOf(value: unknown, allowed: unknown[]) { if (!allowed.includes(value)) throw new Error('unsupported value'); }
function bool(value: unknown) { if (typeof value !== 'boolean') throw new Error('boolean required'); }
function units(value: unknown, decimals: boolean) {
  if (typeof value !== 'string' || !(decimals ? /^(0|[1-9]\d{0,20})(\.\d{1,9})?$/ : /^(0|[1-9]\d{0,39})$/).test(value)) throw new Error('decimal integer quantity required');
}
function list(value: unknown, max: number, check: (v: unknown) => void) {
  if (!Array.isArray(value) || value.length > max) throw new Error('bounded array required');
  value.forEach(check);
}
export function validateIdentity(identity: ReportingIdentity) {
  text(identity.accountId, 128); time(identity.inceptionAt); text(identity.release, 128); text(identity.strategy, 128);
}
/** Full snapshots only; unknown fields are rejected so secrets cannot ride through exports. */
export function validateSnapshot(value: unknown, expected: ReportingIdentity, now = Date.now()): Snapshot {
  validateIdentity(expected);
  const hasIntelligence=!!value&&typeof value==='object'&&Object.hasOwn(value,'intelligence');
  const s = object(value, ['project','mode','liveTrading','schemaVersion','account','sequence','source','times','status','balances','costLabels','positions','trades','decisions','pnl','history','funnel','metrics',...(hasIntelligence?['intelligence']:[])]);
  oneOf(s.project, ['pump-opportunity-engine']); oneOf(s.mode, ['PAPER']); oneOf(s.liveTrading, [false]); oneOf(s.schemaVersion, [1]);
  const a = object(s.account, ['id','inceptionAt','initialUsd']);
  if (a.id !== expected.accountId || a.inceptionAt !== expected.inceptionAt || a.initialUsd !== 1000) throw new Error('wrong account/inception');
  if (typeof s.sequence !== 'string' || !/^[1-9]\d{0,39}$/.test(s.sequence)) throw new Error('durable positive decimal sequence required');
  const source = object(s.source, ['release','strategy']);
  if (source.release !== expected.release || source.strategy !== expected.strategy) throw new Error('unexpected source version');
  const ts = object(s.times, ['generatedAt','marketAt','reconciledAt','usefulProgressAt']);
  const generated = time(ts.generatedAt);
  if (generated > now + 30_000 || generated < time(expected.inceptionAt)) throw new Error('invalid generation time');
  for (const key of ['marketAt','reconciledAt','usefulProgressAt']) nullable(ts[key], v => { if (time(v) > generated) throw new Error('source time newer than generation'); });
  const status = object(s.status, ['runtime','market','entries','reconciled','blocker']);
  oneOf(status.runtime, ['running','stopped','unavailable']); oneOf(status.market, ['observing','warming','unavailable']); oneOf(status.entries, ['enabled','paused','disabled']); bool(status.reconciled); nullable(status.blocker, v => text(v, 512));
  if (status.reconciled === true && ts.reconciledAt === null) throw new Error('reconciliation time required');
  const b = object(s.balances, ['cashSol','reservedSol','equitySol','equityUsd','realizedUsd','unrealizedUsd','tradingPnlUsd','economicPnlUsd','positionCostUsd','markedExposureUsd','drawdownUsd','executionCostsUsd','operatingCostsUsd','passiveSolEquityUsd','solPriceUsd']);
  units(b.cashSol, true); units(b.reservedSol, true); nullable(b.equitySol, v => units(v, true));
  if (Number(b.reservedSol) > Number(b.cashSol)) throw new Error('reservations exceed cash');
  for (const key of ['equityUsd','realizedUsd','unrealizedUsd','tradingPnlUsd','economicPnlUsd']) nullable(b[key], v => number(v));
  number(b.positionCostUsd, true);
  for (const key of ['markedExposureUsd','drawdownUsd','executionCostsUsd','operatingCostsUsd','passiveSolEquityUsd','solPriceUsd']) nullable(b[key], v => number(v, true));
  const costs = object(s.costLabels, ['execution','operating']); oneOf(costs.execution, ['simulated']); oneOf(costs.operating, ['actual','estimated','allocated','mixed','unavailable']);
  const eventTime = (value: unknown) => { const n = time(value); if (n < time(expected.inceptionAt) || n > generated) throw new Error('event outside account/source chronology'); };
  list(s.positions, 3, v => {
    const p = object(v, ['mint','label','quantity','enteredAt','entryCostUsd','netLiquidationUsd','executionCostsUsd','status']);
    text(p.mint, 96); text(p.label, 80); units(p.quantity, false); eventTime(p.enteredAt); number(p.entryCostUsd, true); nullable(p.netLiquidationUsd, v => number(v, true)); number(p.executionCostsUsd, true); text(p.status, 80);
  });
  list(s.trades, 50, v => {
    const t = object(v, ['id','mint','side','quantity','at','valueUsd','executionCostsUsd','status','reason']);
    text(t.id, 128); text(t.mint, 96); oneOf(t.side, ['buy','sell']); units(t.quantity, false); eventTime(t.at); nullable(t.valueUsd, v => number(v, true)); nullable(t.executionCostsUsd, v => number(v, true)); text(t.status, 80); text(t.reason, 512);
  });
  list(s.decisions, 50, v => { const d = object(v, ['id','mint','at','stage','reason']); text(d.id, 128); text(d.mint, 96); eventTime(d.at); text(d.stage, 80); text(d.reason, 512); });
  let last = -Infinity;
  list(s.pnl, 720, v => {
    const p = object(v, ['at','tradingUsd','economicUsd']); const at = time(p.at);
    if (at <= last || at < time(expected.inceptionAt) || at > generated) throw new Error('history chronology/account mismatch');
    last = at; nullable(p.tradingUsd, v => number(v)); nullable(p.economicUsd, v => number(v));
  });
  const h = object(s.history, ['windowStartAt','downsampled','label']); nullable(h.windowStartAt, eventTime); bool(h.downsampled); text(h.label, 256);
  const f = object(s.funnel, ['discovered','supported','sufficientlyObserved','evaluated','qualified','attempted','paperFilled','exited','reconciled']);
  for (const v of Object.values(f)) if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error('nonnegative counter required');
  const m = object(s.metrics, ['processingLagMs','eventLoopLagMs','providerEvents','rpcRequests','projectedDailyDataSol','budgetRemainingSol','budgetStatus','coverage','latency']);
  for (const key of ['processingLagMs','eventLoopLagMs','projectedDailyDataSol','budgetRemainingSol']) nullable(m[key], v => number(v, true));
  for (const key of ['providerEvents','rpcRequests']) if (!Number.isSafeInteger(m[key]) || (m[key] as number) < 0) throw new Error('nonnegative usage counter required');
  oneOf(m.budgetStatus, ['available','degraded','unavailable']); text(m.coverage, 512); text(m.latency, 256);
  if(hasIntelligence){if(expected.accountId!==ORIGINAL_POE_ACCOUNT||expected.inceptionAt!==ORIGINAL_POE_INCEPTION)throw Error('operating intelligence requires original account');const intelligence=validateOperatingIntelligence(s.intelligence,ts.generatedAt as string);if(intelligence.run.strategyVersion!==source.strategy)throw Error('operating strategy/source mismatch');const atoms=(v:string)=>{const [whole,part='']=v.split('.');return BigInt(whole!)*1000000000n+BigInt(part.padEnd(9,'0'));};if(intelligence.pendingOrders.reduce((n,o)=>n+atoms(o.reservedSol),0n)!==atoms(b.reservedSol as string))throw Error('operating reservation mismatch');if((s.positions as unknown[]).length>0&&intelligence.protection.state==='flat')throw Error('operating ownership mismatch');}
  if (Buffer.byteLength(JSON.stringify(s)) > MAX_SNAPSHOT_BYTES) throw new Error('snapshot payload limit');
  return s as Snapshot;
}
/** Account-bound bounded reporting cache; durable journal/actions remain authority. */
export type ReportingFilledTrade=Snapshot['trades'][number]&{actionId:string};
export type ReportingTradeCache={schemaVersion:1;accountId:string;inceptionAt:number;windowLimited:boolean;trades:ReportingFilledTrade[]};
export function validateReportingTradeCache(value:unknown,accountId:string,inceptionAt:number,now:number):ReportingTradeCache {
  const cache=object(value,['schemaVersion','accountId','inceptionAt','windowLimited','trades']);
  if(cache.schemaVersion!==1||cache.accountId!==accountId||cache.inceptionAt!==inceptionAt||!Number.isSafeInteger(inceptionAt)||!Number.isSafeInteger(now)||now<inceptionAt)throw Error('reporting trade cache identity');
  bool(cache.windowLimited);let previous=Infinity;const seen=new Set<string>();
  list(cache.trades,50,value=>{const t=object(value,['actionId','id','mint','side','quantity','at','valueUsd','executionCostsUsd','status','reason']);text(t.actionId,160);text(t.id,128);text(t.mint,96);oneOf(t.side,['buy','sell']);units(t.quantity,false);const at=time(t.at);if(at<inceptionAt||at>now||at>previous||seen.has(String(t.actionId)))throw Error('reporting trade cache chronology');previous=at;seen.add(String(t.actionId));nullable(t.valueUsd,v=>number(v,true));nullable(t.executionCostsUsd,v=>number(v,true));oneOf(t.status,['PAPER filled']);text(t.reason,512);});
  if(Buffer.byteLength(JSON.stringify(cache))>128*1024)throw Error('reporting trade cache bound');return cache as ReportingTradeCache;
}
/** Derive one filled row only from the exact durable attempt, order and result. */
export function reportingFilledTrade(actionId:string,at:number,attempt:any,order:any,result:any):ReportingFilledTrade|null {
  const integer=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
  const q=attempt?.quote,o=order?.input;
  if(result?.status!=='filled'||result.at!==at||!o||attempt.orderId!==o.id||typeof o.mint!=='string'||o.mint.length>96||!['buy','sell'].includes(o.side)||!integer(o.gas)||!q||!integer(q.receiveUnits)||!integer(q.spendLamports)||o.side==='sell'&&!integer(q.pricedBaseUnits))return null;
  const p=attempt.price,validPrice=!!p&&integer(p.microUsdPerSol)&&BigInt(p.microUsdPerSol)>0n&&Number.isSafeInteger(p.at)&&p.at<=at&&at-p.at<=10000;
  const usd=(v:string)=>validPrice?Number(BigInt(v)*BigInt(p.microUsdPerSol)/1000000000n)/1e6:null;
  return {actionId,id:'paper-fill:'+createHash('sha256').update(actionId).digest('hex').slice(0,32),mint:o.mint,side:o.side,quantity:o.side==='buy'?q.receiveUnits:q.pricedBaseUnits,at:new Date(at).toISOString(),valueUsd:usd(o.side==='buy'?q.spendLamports:q.receiveUnits),executionCostsUsd:usd(o.gas),status:'PAPER filled',reason:'Durable single modeled attempt; pool fees embedded, gas separate; no live-fill claim. '+actionId};
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
const hash = (s: Snapshot) => createHash('sha256').update(canonical(s)).digest('hex');
export const snapshotFingerprint=hash;
export type SnapshotAcknowledgement={published:true;result:'accepted'|'duplicate';accountId:string;inceptionAt:string;release:string;sequence:string;sourceAtMs:number;fingerprint:string;acknowledgedAtMs:number};

export class SnapshotCache {
  private current: { snapshot: Snapshot; fingerprint: string; receivedAt: string } | null = null;
  constructor(readonly identity: ReportingIdentity | null = null) { if (identity !== null) validateIdentity(identity); }
  accept(value: unknown, now = Date.now()): 'accepted' | 'duplicate' {
    if (this.identity === null) throw new Error('source-not-configured');
    const snapshot = validateSnapshot(value, this.identity, now); const fingerprint = hash(snapshot);
    if (this.current) {
      const previous = BigInt(this.current.snapshot.sequence), next = BigInt(snapshot.sequence);
      if (next < previous) throw new Error('snapshot regression');
      if (next === previous) {
        if (fingerprint !== this.current.fingerprint) throw new Error('snapshot sequence conflict');
        return 'duplicate'; // Retried delivery does not refresh either source or receiver time.
      }
      if (Date.parse(snapshot.times.generatedAt) < Date.parse(this.current.snapshot.times.generatedAt)) throw new Error('generation time regression');
    }
    // Replace one complete immutable value; never mutate fields of the visible read model.
    this.current = { snapshot: JSON.parse(JSON.stringify(snapshot)) as Snapshot, fingerprint, receivedAt: new Date(now).toISOString() };
    return 'accepted';
  }
  read() { return this.current ? structuredClone(this.current) : null; }
  status(now = Date.now()) {
    const c = this.current;
    if (!c) return { state: 'waiting', message: 'Awaiting POE data', sourceConfigured: this.identity !== null, receivedAt: null, generatedAt: null, marketAt: null, reconciledAt: null, sourceAgeMs: null, marketAgeMs: null, reconciliationAgeMs: null };
    const age = (at: string | null) => at === null ? null : Math.max(0, now - Date.parse(at));
    const sourceAgeMs = age(c.snapshot.times.generatedAt)!;
    const marketAgeMs = age(c.snapshot.times.marketAt), reconciliationAgeMs = age(c.snapshot.times.reconciledAt);
    const stale = Math.max(sourceAgeMs, marketAgeMs ?? 0, reconciliationAgeMs ?? 0) > 90_000;
    const unavailable = !c.snapshot.status.reconciled || c.snapshot.balances.equityUsd === null || marketAgeMs === null || reconciliationAgeMs === null;
    const state = stale ? 'stale' : c.snapshot.status.runtime !== 'running' || c.snapshot.status.market === 'unavailable' ? 'unavailable' : c.snapshot.status.market === 'warming' ? 'warming' : unavailable ? 'unavailable' : c.snapshot.status.entries === 'paused' ? 'entry-paused' : c.snapshot.funnel.paperFilled === 0 ? 'observing-with-zero-trades' : 'fresh';
    return { state, receivedAt: c.receivedAt, ...c.snapshot.times, sourceAgeMs, marketAgeMs, reconciliationAgeMs };
  }
}

/** Latest-slot publisher. It receives projections only; it has no financial or market access. */
export class SnapshotPublisher {
  private latest: { snapshot: Snapshot; body: string; fingerprint: string } | null = null;
  private highest: { sequence: bigint; fingerprint: string } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: AbortController | undefined;
  private running = false;
  private inflight: Promise<void> | undefined;
  readonly metrics = { attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0, lastSuccessAt: null as string | null, lastError: null as string | null };
  constructor(private readonly options: {
    url: string; secret: string; identity: ReportingIdentity; intervalMs?: number; timeoutMs?: number;
    maxBackoffMs?: number; fetch?: typeof fetch;
    onAcknowledgement?:(ack:SnapshotAcknowledgement)=>void;
  }) {
    const u = new URL(options.url);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || options.secret.length < 24) throw new Error('HTTPS endpoint and dedicated ingestion secret required');
    validateIdentity(options.identity);
    for (const n of [options.intervalMs ?? 30_000, options.timeoutMs ?? 3000, options.maxBackoffMs ?? 300_000]) if (!Number.isSafeInteger(n) || n < 10 || n > 300_000) throw new Error('bounded publisher timing required');
  }
  offer(value: Snapshot) {
    const snapshot = validateSnapshot(value, this.options.identity); const fingerprint = hash(snapshot); const sequence = BigInt(snapshot.sequence);
    if (this.highest && (sequence < this.highest.sequence || sequence === this.highest.sequence && fingerprint !== this.highest.fingerprint)) throw new Error('publisher sequence regression/conflict');
    this.highest = { sequence, fingerprint };
    this.latest = { snapshot: structuredClone(snapshot), body: JSON.stringify(snapshot), fingerprint };
  }
  queuedSequence() { return this.latest?.snapshot.sequence ?? null; }
  start() { if (!this.running) { this.running = true; this.schedule(0); } }
  private schedule(delay: number) {
    if (this.running) this.timer = setTimeout(() => { this.inflight = this.publish(); }, delay);
  }
  private async publish() {
    const current = this.latest;
    if (!current) { this.schedule(this.options.intervalMs ?? 30_000); return; }
    this.metrics.attempts++; this.active = new AbortController();
    const timeout = setTimeout(() => this.active?.abort(), this.options.timeoutMs ?? 3000);
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.url, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.secret}` },
        body: current.body, signal: this.active.signal, redirect: 'error',
      });
      if (!response.ok) {await response.body?.cancel();throw new Error(`http_${response.status}`);}
      if(this.options.onAcknowledgement){
        if(response.headers.get('content-type')?.split(';')[0]!=='application/json'||!response.body)throw Error('invalid_acknowledgement');
        const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
        try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2048){await reader.cancel();throw Error('invalid_acknowledgement');}chunks.push(part.value);}}finally{reader.releaseLock();}
        const ack=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {result?:unknown};
        if(!ack||typeof ack!=='object'||Array.isArray(ack)||Object.keys(ack).join('|')!=='result'||!['accepted','duplicate'].includes(ack.result as string))throw Error('invalid_acknowledgement');
        this.options.onAcknowledgement({published:true,result:ack.result as 'accepted'|'duplicate',accountId:current.snapshot.account.id,inceptionAt:current.snapshot.account.inceptionAt,release:current.snapshot.source.release,sequence:current.snapshot.sequence,sourceAtMs:Date.parse(current.snapshot.times.generatedAt),fingerprint:current.fingerprint,acknowledgedAtMs:Date.now()});
      }else await response.body?.cancel();
      this.metrics.successes++; this.metrics.consecutiveFailures = 0; this.metrics.lastSuccessAt = new Date().toISOString(); this.metrics.lastError = null;
      if (this.latest?.fingerprint === current.fingerprint) this.latest = null;
    } catch (e) {
      this.metrics.failures++; this.metrics.consecutiveFailures++;
      this.metrics.lastError = e instanceof Error && /^http_\d{3}$/.test(e.message) ? e.message : 'network_unavailable';
    } finally {
      clearTimeout(timeout); this.active = undefined;
      const interval = this.options.intervalMs ?? 30_000;
      this.schedule(Math.min(this.options.maxBackoffMs ?? 300_000, interval * 2 ** Math.min(this.metrics.consecutiveFailures, 8)));
    }
  }
  async stop() { this.running = false; clearTimeout(this.timer); this.active?.abort(); await this.inflight; }
}
