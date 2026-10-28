/** Reporting only: separate experimental diagnostics, never an authoritative ledger. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_SNAPSHOT_BYTES, validateSnapshot, type Snapshot } from './reporting.js';

export const PILOT_TELEMETRY_LIMIT = 192 * 1024;
const LIMIT = PILOT_TELEMETRY_LIMIT;
const eq = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const stages = ['discovered','supported','sufficientlyObserved','evaluated','qualified','reserved','attempted','paperFilled','exited','reconciled','verifiedMigrationOrigins','admitted','usableWindows'] as const;
const metricNames = ['rpcRequests','providerEvents','normalizedTrades','eventLoopLagMs','maximumCompletedGapMs','maximumQuoteAgeMs','protectionBreaches','unavailableChecks','streamBytes'] as const;
type Stage = typeof stages[number];
type Metric = typeof metricNames[number];
const watchCounts = ['known','watch','eligibleKnown','deepActive','maximumDeep','queued','promoted','repromoted','demoted','expired','capacityExclusions','structuralExclusions','completeWindows','strategyRejections','incompleteDataExclusions','enrichmentDeadlineFailures'] as const;
const featureCounts = ['predictiveAssessments','predictiveFailures'] as const;
type WatchCount = typeof watchCounts[number];
const observationWatchCounts=['observationEligibleKnown','observationQueued','maximumOlderResearchIdentities'] as const;
const ageCohortNames=['preEntry','entryEligible','olderSelected'] as const;
export type PilotObservationAgePolicy={version:string;minimumObservationAgeMs:number;recentMaximumAgeMs:number;selectedOlderMaximumAgeMs:number};
type WatchWait = { mean: number | null; maximum: number | null };
export type PilotWatchTelemetry = Record<WatchCount, number | null> & Partial<Record<typeof featureCounts[number],number|null>> & Partial<Record<typeof observationWatchCounts[number],number|null>> & {ageCohorts?:Record<typeof ageCohortNames[number],number|null>|null;waitMs: WatchWait; promotionWaitMs?: WatchWait | null };
export type PilotAccounting = {schemaVersion:1;at:number;totalPnlLamports:string|null;realizedLamports:string;unrealizedLamports:string|null;executionCostsLamports:string;lockedDepositLamports:string};
export type PilotTelemetry = {
  schemaVersion: 1; kind: 'experimental-pilot'; authoritative: false; liveTrading: false;
  accountId: string; inceptionAt: number; runId: string; generatedAt: number;
  source: { release: string; strategy: string; sha256: string | null };
  running: boolean; entriesEnabled: boolean; status: string;
  /** Optional for legacy diagnostics; explicit mode is mandatory for a financial report. */
  mode?: 'candidate-evaluation'|'paper'; financialExecutionAuthorized?: boolean;
  /** Source observation scope only; baseline entry eligibility is unchanged. */
  observationAgePolicy?:PilotObservationAgePolicy|null;
  /** A complete source-calculated experimental portfolio; never the original account. */
  portfolio?: Snapshot | null;
  /** Exact SOL accounting calculated by the same experimental source. */
  accounting?: PilotAccounting | null;
  funnel: Record<Stage, number | null>; metrics: Record<Metric, number | null>;
  decisions: Array<{ at: number; mint: string; stage: string; reason: string }>;
  refusals: Array<{ reason: string; count: number }>;
  /** Optional for older publishers; never carries watch identities or financial state. */
  watch?: PilotWatchTelemetry | null;
};
function object(x: unknown): Record<string, any> { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('invalid telemetry object'); return x as Record<string, any>; }
function text(x: unknown, max: number): string { if (typeof x !== 'string' || !x || x.length > max || /[\u0000-\u001f]/.test(x)) throw new Error('invalid telemetry text'); return x; }
function number(x: unknown, nullable = true): number | null { if (nullable && (x === null || x === undefined)) return null; if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > Number.MAX_SAFE_INTEGER) throw new Error('invalid telemetry number'); return x; }
function integer(x: unknown, nullable = true): number | null { const n=number(x,nullable); if (n!==null&&!Number.isSafeInteger(n)) throw new Error('invalid telemetry integer'); return n; }
function bool(x: unknown): boolean { if (typeof x !== 'boolean') throw new Error('invalid telemetry boolean'); return x; }
const safeText = (x: unknown, max=256) => String(x ?? 'unreported').replace(/https?:\/\/\S+/gi,'[endpoint]').replace(/Bearer\s+\S+/gi,'[credential]').replace(/[\u0000-\u001f]/g,' ').slice(0,max) || 'unreported';
function keys(o: Record<string,any>, allowed: string[]) { if (Object.keys(o).some(k=>!allowed.includes(k))) throw new Error('unexpected telemetry field'); }
function validateWatch(value:unknown):PilotWatchTelemetry {
  const w=object(value);keys(w,[...watchCounts,...featureCounts,...observationWatchCounts,'ageCohorts','waitMs','promotionWaitMs']);
  for(const k of watchCounts){if(!Object.hasOwn(w,k))throw Error('missing watch field');integer(w[k]);}
  for(const k of featureCounts)integer(w[k]);
  for(const key of observationWatchCounts)if(Object.hasOwn(w,key)){integer(w[key]);if(w[key]!==null&&w[key]>512)throw Error('observation watch identity limit');}
  if(w.maximumOlderResearchIdentities!==undefined&&w.maximumOlderResearchIdentities!==null&&w.maximumOlderResearchIdentities>24)throw Error('older research identity limit');
  for(const key of ['observationEligibleKnown','observationQueued'])if(w[key]!==undefined&&w[key]!==null&&w.known!==null&&w[key]>w.known)throw Error('observation watch count inconsistent');
  if(w.observationQueued!==undefined&&w.observationQueued!==null&&w.observationEligibleKnown!==undefined&&w.observationEligibleKnown!==null&&w.observationQueued>w.observationEligibleKnown)throw Error('observation queue count inconsistent');
  if(w.ageCohorts!==undefined&&w.ageCohorts!==null){const cohorts=object(w.ageCohorts);keys(cohorts,[...ageCohortNames]);for(const key of ageCohortNames){if(!Object.hasOwn(cohorts,key))throw Error('missing age cohort');integer(cohorts[key]);if(cohorts[key]!==null&&(cohorts[key]>512||w.known!==null&&cohorts[key]>w.known))throw Error('age cohort identity limit');}
    if(cohorts.entryEligible!==null&&w.eligibleKnown!==null&&cohorts.entryEligible!==w.eligibleKnown)throw Error('entry age cohort inconsistent');
    if(cohorts.olderSelected!==null&&w.maximumOlderResearchIdentities!==undefined&&w.maximumOlderResearchIdentities!==null&&cohorts.olderSelected>w.maximumOlderResearchIdentities)throw Error('older research capacity inconsistent');
    if(ageCohortNames.every(key=>cohorts[key]!==null)){const sum=ageCohortNames.reduce((n,key)=>n+cohorts[key],0);if(w.known!==null&&sum>w.known||w.observationEligibleKnown!==undefined&&w.observationEligibleKnown!==null&&sum!==w.observationEligibleKnown)throw Error('observation age cohorts inconsistent');}
  }
  const wait=object(w.waitMs);keys(wait,['mean','maximum']);
  if(!Object.hasOwn(wait,'mean')||!Object.hasOwn(wait,'maximum'))throw Error('missing watch wait');
  number(wait.mean);number(wait.maximum);
  for(const k of ['known','watch','eligibleKnown','queued'])if(w[k]!==null&&w[k]>512)throw Error('watch identity limit');
  if(w.maximumDeep!==null&&(w.maximumDeep<1||w.maximumDeep>20))throw Error('watch deep limit');
  if(w.deepActive!==null&&(w.deepActive>20||w.maximumDeep!==null&&w.deepActive>w.maximumDeep))throw Error('watch deep limit');
  for(const k of ['watch','eligibleKnown','deepActive'])if(w[k]!==null&&w.known!==null&&w[k]>w.known)throw Error('watch count inconsistent');
  if(wait.mean!==null&&wait.maximum!==null&&wait.mean>wait.maximum)throw Error('watch wait inconsistent');
  if(w.promotionWaitMs!==undefined&&w.promotionWaitMs!==null){
    const completed=object(w.promotionWaitMs);keys(completed,['mean','maximum']);
    if(!Object.hasOwn(completed,'mean')||!Object.hasOwn(completed,'maximum'))throw Error('missing promotion wait');
    number(completed.mean);number(completed.maximum);
    if(completed.mean!==null&&completed.maximum!==null&&completed.mean>completed.maximum)throw Error('promotion wait inconsistent');
  }
  return structuredClone(w) as PilotWatchTelemetry;
}
function projectWatch(value:unknown):PilotWatchTelemetry|null {
  if(value===undefined||value===null)return null;
  const w=object(object(value).summary),wait=w.waitMs===undefined?{}:object(w.waitMs),completed=w.promotionWaitMs===undefined||w.promotionWaitMs===null?{}:object(w.promotionWaitMs);
  return validateWatch({...Object.fromEntries([...watchCounts,...featureCounts].map(k=>[k,integer(w[k])])),...Object.fromEntries(observationWatchCounts.filter(k=>Object.hasOwn(w,k)).map(k=>[k,integer(w[k])])),...(w.ageCohorts===undefined?{}:{ageCohorts:w.ageCohorts===null?null:Object.fromEntries(ageCohortNames.map(k=>[k,integer(object(w.ageCohorts)[k])]))}),waitMs:{mean:number(wait.mean),maximum:number(wait.maximum)},promotionWaitMs:{mean:number(completed.mean),maximum:number(completed.maximum)}});
}

function validateObservationAgePolicy(value:unknown):PilotObservationAgePolicy {
 const policy=object(value),fields=['version','minimumObservationAgeMs','recentMaximumAgeMs','selectedOlderMaximumAgeMs'];keys(policy,fields);if(fields.some(k=>!Object.hasOwn(policy,k)))throw Error('missing observation age policy field');
 const version=text(policy.version,96);if(!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(version))throw Error('invalid observation policy version');
 for(const key of fields.slice(1)){integer(policy[key],false);if(policy[key]>86400000)throw Error('observation age policy bound');}
 if(policy.minimumObservationAgeMs>=policy.recentMaximumAgeMs||policy.recentMaximumAgeMs<60000||policy.selectedOlderMaximumAgeMs<policy.recentMaximumAgeMs)throw Error('observation age policy order');return structuredClone(policy) as PilotObservationAgePolicy;
}
function projectObservationAgePolicy(value:unknown):PilotObservationAgePolicy|null {
 if(value===null)return null;const policy=object(value);return validateObservationAgePolicy({version:policy.version,minimumObservationAgeMs:policy.minimumObservationAgeMs,recentMaximumAgeMs:policy.recentMaximumAgeMs,selectedOlderMaximumAgeMs:policy.selectedOlderMaximumAgeMs});
}

/** Explicit allowlist. No journal, financial balances, credential/config objects or arbitrary logs. */
export function projectPilotStatus(value: unknown): PilotTelemetry {
  const p=object(value);
  if (p.experimental!==true || p.authoritative!==false || p.liveTradingEnabled!==false) throw new Error('isolated PAPER pilot required');
  const f=object(p.funnel), u=object(p.usage), rpc=object(u.rpc), feeds=object(u.feeds), t=object(p.timing), source=object(p.source);
  const result: PilotTelemetry = {
    schemaVersion:1,kind:'experimental-pilot',authoritative:false,liveTrading:false,
    accountId:text(p.accountId,100),inceptionAt:integer(p.inceptionAt,false)!,runId:text(p.runId,120),generatedAt:integer(p.generatedAt,false)!,
    source:{release:text(source.commit,64),strategy:text(p.strategyVersion,100),sha256:typeof source.sha256==='string'&&/^[a-f0-9]{64}$/.test(source.sha256)?source.sha256:null},
    running:bool(p.running),entriesEnabled:bool(p.entriesEnabled),status:safeText(p.status),
    ...(p.mode===undefined?{}:{mode:p.mode,financialExecutionAuthorized:bool(p.financialExecutionAuthorized)}),
    ...(p.observationAgePolicy===undefined?{}:{observationAgePolicy:projectObservationAgePolicy(p.observationAgePolicy)}),
    portfolio:p.mode==='paper'&&p.financialExecutionAuthorized===true&&p.experimentalPortfolio!==undefined?p.experimentalPortfolio:null,
    accounting:p.mode==='paper'&&p.financialExecutionAuthorized===true&&p.experimentalPortfolio&&p.experimentalAccounting!==undefined?p.experimentalAccounting:null,
    funnel:Object.fromEntries(stages.map(k=>[k,integer(f[k])])) as Record<Stage,number|null>,
    metrics:{rpcRequests:integer(rpc.newUnits),providerEvents:integer(feeds.frames),normalizedTrades:integer(feeds.normalizedTrades),eventLoopLagMs:number(u.eventLoopDelayP95Ms),maximumCompletedGapMs:Array.isArray(t.completedEvaluationGaps)&&t.completedEvaluationGaps.length?number(t.maximumCompletedGapMs):null,maximumQuoteAgeMs:Array.isArray(t.completedEvaluationGaps)&&t.completedEvaluationGaps.length?number(t.maximumQuoteAgeAtUseMs):null,protectionBreaches:integer(t.protectionBreaches),unavailableChecks:integer(t.unavailableChecks),streamBytes:integer(feeds.totalSocketBytes)},
    decisions:(Array.isArray(p.decisions)?p.decisions:[]).slice(-30).map((d:any)=>({at:integer(d.at,false)!,mint:text(d.mint,100),stage:safeText(d.stage,100),reason:safeText(d.reason)})),
    refusals:Object.entries(object(p.refusals??{})).filter(([,v])=>typeof v==='number').slice(0,30).map(([reason,count])=>({reason:safeText(reason),count:integer(count,false)!})),
    watch:projectWatch(p.watch),
  };
  return validatePilotTelemetry(result);
}
export function validatePilotTelemetry(input: unknown): PilotTelemetry {
  const p=object(input);
  keys(p,['schemaVersion','kind','authoritative','liveTrading','accountId','inceptionAt','runId','generatedAt','source','running','entriesEnabled','status','funnel','metrics','decisions','refusals','watch','mode','financialExecutionAuthorized','portfolio','accounting','observationAgePolicy']);
  if(p.schemaVersion!==1||p.kind!=='experimental-pilot'||p.authoritative!==false||p.liveTrading!==false) throw new Error('invalid pilot identity');
  if(!/^poe-pilot-[a-z0-9-]+$/.test(text(p.accountId,100))) throw new Error('pilot account required');
  integer(p.inceptionAt,false);integer(p.generatedAt,false);if(p.generatedAt<p.inceptionAt)throw new Error('invalid source time');
  text(p.runId,120);bool(p.running);bool(p.entriesEnabled);text(p.status,256);
  const s=object(p.source);keys(s,['release','strategy','sha256']);text(s.release,64);text(s.strategy,100);if(s.sha256!==null&&!(typeof s.sha256==='string'&&/^[a-f0-9]{64}$/.test(s.sha256)))throw Error('invalid source hash');
  const f=object(p.funnel);keys(f,[...stages]);for(const k of stages){if(!Object.hasOwn(f,k))throw Error('missing funnel field');integer(f[k]);}
  const m=object(p.metrics);keys(m,[...metricNames]);for(const k of metricNames){if(!Object.hasOwn(m,k))throw Error('missing metric field');if(['eventLoopLagMs','maximumCompletedGapMs','maximumQuoteAgeMs'].includes(k))number(m[k]);else integer(m[k]);}
  if(!Array.isArray(p.decisions)||p.decisions.length>30||!Array.isArray(p.refusals)||p.refusals.length>30)throw new Error('telemetry list limit');
  for(const d of p.decisions){keys(object(d),['at','mint','stage','reason']);integer(d.at,false);if(d.at>p.generatedAt)throw new Error('future decision');text(d.mint,100);text(d.stage,100);text(d.reason,256);}
  for(const r of p.refusals){keys(object(r),['reason','count']);text(r.reason,256);integer(r.count,false);}
  if(p.watch!==undefined&&p.watch!==null)validateWatch(p.watch);
  if(p.observationAgePolicy!==undefined&&p.observationAgePolicy!==null)validateObservationAgePolicy(p.observationAgePolicy);
  if(p.mode!==undefined){
    if(!['candidate-evaluation','paper'].includes(p.mode))throw Error('invalid pilot mode');
    bool(p.financialExecutionAuthorized);
    if(p.mode==='candidate-evaluation'&&(p.financialExecutionAuthorized||p.entriesEnabled))throw Error('candidate mode cannot authorize financial execution');
  }else if(p.financialExecutionAuthorized!==undefined)throw Error('financial mode required');
  if(p.portfolio!==undefined&&p.portfolio!==null){
    if(p.mode!=='paper'||p.financialExecutionAuthorized!==true)throw Error('explicit PAPER financial mode required');
    if(Buffer.byteLength(JSON.stringify(p.portfolio))>MAX_SNAPSHOT_BYTES)throw Error('portfolio size limit');
    const portfolio=validateSnapshot(p.portfolio,{accountId:p.accountId,inceptionAt:new Date(p.inceptionAt).toISOString(),release:p.source.release,strategy:p.source.strategy},p.generatedAt);
    if(Date.parse(portfolio.times.generatedAt)>p.generatedAt)throw Error('portfolio source time newer than diagnostic source');
    if(p.running===false&&portfolio.status.runtime==='running'||p.running===true&&portfolio.status.runtime==='stopped')throw Error('portfolio runtime status inconsistent');
    if(portfolio.status.entries==='enabled'&&!p.entriesEnabled)throw Error('portfolio entry permission inconsistent');
  }
  if(p.accounting!==undefined&&p.accounting!==null){
    if(p.mode!=='paper'||p.financialExecutionAuthorized!==true||!p.portfolio)throw Error('accounting requires the experimental PAPER portfolio');
    const a=object(p.accounting),fields=['schemaVersion','at','totalPnlLamports','realizedLamports','unrealizedLamports','executionCostsLamports','lockedDepositLamports'];keys(a,fields);
    if(fields.some(k=>!Object.hasOwn(a,k))||a.schemaVersion!==1||integer(a.at,false)!==p.generatedAt)throw Error('invalid accounting source time or shape');
    const amount=(value:unknown,signed:boolean,nullable=false)=>{
      if(nullable&&value===null)return;
      if(typeof value!=='string'||value.length>40||!(signed?/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/:/^(?:0|[1-9][0-9]*)$/).test(value))throw Error('invalid accounting integer');
      const n=BigInt(value),minimum=signed?-(1n<<127n):0n,maximum=signed?(1n<<127n)-1n:(1n<<128n)-1n;
      if(n<minimum||n>maximum)throw Error('accounting integer bound');
    };
    amount(a.totalPnlLamports,true,true);amount(a.realizedLamports,true);amount(a.unrealizedLamports,true,true);amount(a.executionCostsLamports,false);amount(a.lockedDepositLamports,false);
    if(p.portfolio.balances.equitySol===null&&(a.totalPnlLamports!==null||a.unrealizedLamports!==null))throw Error('unknown marks require unavailable accounting totals');
  }
  if(Buffer.byteLength(JSON.stringify(p))>LIMIT)throw new Error('telemetry size limit');
  return structuredClone(p) as PilotTelemetry;
}
export type TelemetryConfig={secret:string;accountId:string;inceptionAt:number;publicViewer:boolean;viewerUser:string;viewerPassword:string};
function reply(res:ServerResponse,code:number,body:unknown){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}
async function body(req:IncomingMessage):Promise<unknown>{
  const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>LIMIT)throw Error('telemetry size limit');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createPilotTelemetryChannel(config:TelemetryConfig,now=Date.now){
  const configured=config.secret.length>=32&&/^poe-pilot-[a-z0-9-]+$/.test(config.accountId)&&Number.isSafeInteger(config.inceptionAt)&&config.inceptionAt>0;
  let current:{snapshot:PilotTelemetry;receivedAt:number;lastContactAt:number;digest:string}|null=null;
  let lastPortfolio:{sequence:bigint;digest:string}|null=null;
  function read(){
    if(!current)return {state:configured?'awaiting-data':'not-configured',message:configured?'No pilot report received.':'Separate pilot telemetry is not configured.',snapshot:null,receivedAt:null,lastContactAt:null,sourceAgeMs:null,lastContactAgeMs:null,publisherConnected:false};
    const sourceAgeMs=Math.max(0,now()-current.snapshot.generatedAt),receiverAgeMs=Math.max(0,now()-current.receivedAt),lastContactAgeMs=Math.max(0,now()-current.lastContactAt),sourceStale=sourceAgeMs>90000,publisherConnected=lastContactAgeMs<=90000;
    return {state:!current.snapshot.running?'stopped':sourceStale?'stale':!publisherConnected?'disconnected':'reporting',snapshot:structuredClone(current.snapshot),receivedAt:current.receivedAt,lastContactAt:current.lastContactAt,sourceAgeMs,receiverAgeMs,lastContactAgeMs,sourceStale,publisherConnected};
  }
  function accept(raw:unknown){
    if(!configured)throw Error('pilot telemetry not configured');const p=validatePilotTelemetry(raw);
    if(p.accountId!==config.accountId||p.inceptionAt!==config.inceptionAt)throw Error('pilot source mismatch');
    if(p.generatedAt>now()+5000)throw Error('future source time');
    const digest=createHash('sha256').update(JSON.stringify(p)).digest('hex');
    let nextPortfolio:typeof lastPortfolio=null;
    if(p.portfolio){
      nextPortfolio={sequence:BigInt(p.portfolio.sequence),digest:createHash('sha256').update(JSON.stringify(p.portfolio)).digest('hex')};
      if(lastPortfolio&&(nextPortfolio.sequence<lastPortfolio.sequence||nextPortfolio.sequence===lastPortfolio.sequence&&nextPortfolio.digest!==lastPortfolio.digest))throw Error('portfolio sequence regression or conflict');
    }
    if(current){
      if(p.generatedAt<current.snapshot.generatedAt)throw Error('source time regression');
      if(p.generatedAt===current.snapshot.generatedAt){if(digest!==current.digest)throw Error('source time conflict');current.lastContactAt=now();return 'duplicate';}
      if(p.runId===current.snapshot.runId){for(const k of stages){const a=p.funnel[k],b=current.snapshot.funnel[k];if(a!==null&&b!==null&&a<b)throw Error('counter regression');}}
    }
    current={snapshot:p,receivedAt:now(),lastContactAt:now(),digest};if(nextPortfolio)lastPortfolio=nextPortfolio;return 'accepted';
  }
  async function handle(req:IncomingMessage,res:ServerResponse,path:string|undefined){
    if(path!=='/api/pilot')return false;
    res.setHeader('referrer-policy','no-referrer');res.setHeader('x-frame-options','DENY');
    if(req.method==='POST'){
      if(!configured){req.resume();reply(res,503,{error:'pilot telemetry not configured'});return true;}
      if(!eq(req.headers.authorization??'',`Bearer ${config.secret}`)){req.resume();reply(res,401,{error:'unauthorized'});return true;}
      if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['content-encoding']){req.resume();reply(res,415,{error:'plain application/json required'});return true;}
      if(Number(req.headers['content-length']??0)>LIMIT){req.resume();reply(res,413,{error:'telemetry size limit'});return true;}
      try{reply(res,200,{result:accept(await body(req))});}catch(e){const message=e instanceof Error?e.message:'invalid telemetry';reply(res,/regression|conflict/.test(message)?409:/size limit/.test(message)?413:400,{error:'pilot telemetry rejected'});}
      return true;
    }
    if(!config.publicViewer&&!eq(req.headers.authorization??'','Basic '+Buffer.from(`${config.viewerUser}:${config.viewerPassword}`).toString('base64'))){req.resume();res.setHeader('www-authenticate','Basic realm="POE owner", charset="UTF-8"');reply(res,401,{error:'unauthorized'});return true;}
    if(req.method!=='GET'){req.resume();reply(res,405,{error:'read-only viewer'});return true;}
    reply(res,200,read());return true;
  }
  return {read,accept,handle};
}
