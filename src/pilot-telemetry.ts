/** Reporting only: separate experimental diagnostics, never an authoritative ledger. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const LIMIT = 64 * 1024;
const eq = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const stages = ['discovered','supported','sufficientlyObserved','evaluated','qualified','reserved','attempted','paperFilled','exited','reconciled','verifiedMigrationOrigins','admitted','usableWindows'] as const;
const metricNames = ['rpcRequests','providerEvents','normalizedTrades','eventLoopLagMs','maximumCompletedGapMs','maximumQuoteAgeMs','protectionBreaches','unavailableChecks','streamBytes'] as const;
type Stage = typeof stages[number];
type Metric = typeof metricNames[number];
export type PilotTelemetry = {
  schemaVersion: 1; kind: 'experimental-pilot'; authoritative: false; liveTrading: false;
  accountId: string; inceptionAt: number; runId: string; generatedAt: number;
  source: { release: string; strategy: string; sha256: string | null };
  running: boolean; entriesEnabled: boolean; status: string;
  funnel: Record<Stage, number | null>; metrics: Record<Metric, number | null>;
  decisions: Array<{ at: number; mint: string; stage: string; reason: string }>;
  refusals: Array<{ reason: string; count: number }>;
};
function object(x: unknown): Record<string, any> { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('invalid telemetry object'); return x as Record<string, any>; }
function text(x: unknown, max: number): string { if (typeof x !== 'string' || !x || x.length > max || /[\u0000-\u001f]/.test(x)) throw new Error('invalid telemetry text'); return x; }
function number(x: unknown, nullable = true): number | null { if (nullable && (x === null || x === undefined)) return null; if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > Number.MAX_SAFE_INTEGER) throw new Error('invalid telemetry number'); return x; }
function integer(x: unknown, nullable = true): number | null { const n=number(x,nullable); if (n!==null&&!Number.isSafeInteger(n)) throw new Error('invalid telemetry integer'); return n; }
function bool(x: unknown): boolean { if (typeof x !== 'boolean') throw new Error('invalid telemetry boolean'); return x; }
const safeText = (x: unknown, max=256) => String(x ?? 'unreported').replace(/https?:\/\/\S+/gi,'[endpoint]').replace(/Bearer\s+\S+/gi,'[credential]').replace(/[\u0000-\u001f]/g,' ').slice(0,max) || 'unreported';
function keys(o: Record<string,any>, allowed: string[]) { if (Object.keys(o).some(k=>!allowed.includes(k))) throw new Error('unexpected telemetry field'); }

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
    funnel:Object.fromEntries(stages.map(k=>[k,integer(f[k])])) as Record<Stage,number|null>,
    metrics:{rpcRequests:integer(rpc.newUnits),providerEvents:integer(feeds.frames),normalizedTrades:integer(feeds.normalizedTrades),eventLoopLagMs:number(u.eventLoopDelayP95Ms),maximumCompletedGapMs:Array.isArray(t.completedEvaluationGaps)&&t.completedEvaluationGaps.length?number(t.maximumCompletedGapMs):null,maximumQuoteAgeMs:Array.isArray(t.completedEvaluationGaps)&&t.completedEvaluationGaps.length?number(t.maximumQuoteAgeAtUseMs):null,protectionBreaches:integer(t.protectionBreaches),unavailableChecks:integer(t.unavailableChecks),streamBytes:integer(feeds.totalSocketBytes)},
    decisions:(Array.isArray(p.decisions)?p.decisions:[]).slice(-30).map((d:any)=>({at:integer(d.at,false)!,mint:text(d.mint,100),stage:safeText(d.stage,100),reason:safeText(d.reason)})),
    refusals:Object.entries(object(p.refusals??{})).filter(([,v])=>typeof v==='number').slice(0,30).map(([reason,count])=>({reason:safeText(reason),count:integer(count,false)!})),
  };
  return validatePilotTelemetry(result);
}
export function validatePilotTelemetry(input: unknown): PilotTelemetry {
  const p=object(input);
  keys(p,['schemaVersion','kind','authoritative','liveTrading','accountId','inceptionAt','runId','generatedAt','source','running','entriesEnabled','status','funnel','metrics','decisions','refusals']);
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
    if(current){
      if(p.generatedAt<current.snapshot.generatedAt)throw Error('source time regression');
      if(p.generatedAt===current.snapshot.generatedAt){if(digest!==current.digest)throw Error('source time conflict');current.lastContactAt=now();return 'duplicate';}
      if(p.runId===current.snapshot.runId){for(const k of stages){const a=p.funnel[k],b=current.snapshot.funnel[k];if(a!==null&&b!==null&&a<b)throw Error('counter regression');}}
    }
    current={snapshot:p,receivedAt:now(),lastContactAt:now(),digest};return 'accepted';
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
