/** Read-only, bounded reporting of the durable discovery registry.
 * Registry lifetime begins when this store was created, not account inception.
 * Missing evidence stays unavailable; observed identities are not a market denominator. */
export const MARKET_COVERAGE_REPORTING_VERSION='poe-market-coverage-v1' as const;
export const MARKET_COVERAGE_FEED_SOURCES=['pumpportal-new-token','pumpportal-migration','pumpapi-broad','confirmed-migration'] as const;
export const MARKET_COVERAGE_FEED_SCOPES=['CREATION_HINTS','MIGRATION_HINTS','SHARED_ACTIVITY_HINTS','WATCHED_ACTIVITY_HINTS','UNKNOWN'] as const;
export const MARKET_COVERAGE_LIMITATIONS=['MARKET_DENOMINATOR_UNKNOWN','PROVIDER_HINTS_UNVERIFIED','PREMIGRATION_EXECUTION_NOT_SUPPORTED','SOURCE_OUTAGES_NOT_RECONSTRUCTED','SHARED_ACTIVITY_PARTIAL_WHEN_FEED_UNAVAILABLE','PREEXISTING_MARKET_BACKFILL_UNAVAILABLE','UNVERIFIED_ORIGIN_DISCOVERY_PENDING','SHARED_HINT_DEDUP_RETENTION_1H','REGISTRY_STORAGE_UNAVAILABLE','OTHER_UNEXPORTED_LIMITATION'] as const;
type Count=number|null;
export type MarketCoverageReporting={
 version:typeof MARKET_COVERAGE_REPORTING_VERSION;generatedAt:string;
 persistence:{state:'sqlite-wal'|'unavailable';createdAt:string|null;updatedAt:string|null};
 lifetime:{uniqueTokensDiscovered:Count;lightweightScreened:Count;lightweightWithActivity:Count;lightweightUnavailable:Count;deepAdmitted:Count;verifiedAudited:Count};
 currentHour:{startedAt:string|null;uniqueTokensDiscovered:Count};
 active:{trackedIdentities:Count;awaitingLightweight:Count;awaitingOrigin:Count;awaitingVerification:Count;awaitingDeep:Count;deepObserving:Count};
 resource:{durableVerificationBacklog:Count;oldestVerificationAt:string|null;maximumVerificationWaitMs:Count;storageFailures:Count;maximumWriteMs:number|null;meanWriteMs:number|null};
 financial:{scope:'current-source-instance';qualified:Count;entries:Count;exits:Count};
 feeds:{source:typeof MARKET_COVERAGE_FEED_SOURCES[number];connected:boolean|null;lastObservedAt:string|null;scope:typeof MARKET_COVERAGE_FEED_SCOPES[number];coverageGaps:Count}[];
 marketDenominator:null;wholeMarketCoveragePercent:null;limitations:typeof MARKET_COVERAGE_LIMITATIONS[number][];
};
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z');
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const count=(v:unknown):Count=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
const duration=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER?v:null;
const iso=(v:unknown,generated:number):string|null=>count(v)!==null&&Number(v)>=INCEPTION&&Number(v)<=generated?new Date(Number(v)).toISOString():null;
function need(v:unknown):asserts v {if(!v)throw Error('MARKET_COVERAGE_REPORTING_INVALID');}
function exact(v:unknown,keys:string){const r=record(v);need(Object.getPrototypeOf(v)===Object.prototype&&Object.keys(r).sort().join(' ')===keys.split(' ').sort().join(' '));return r;}
/** No registry, provider, financial writer or arbitrary provider text is loaded here. */
export function projectMarketCoverageReporting(status:unknown,generated:number):MarketCoverageReporting|undefined {
 const s=record(status),m=record(s.marketCoverage);
 if(m.version!==MARKET_COVERAGE_REPORTING_VERSION)return undefined;
 const at=count(m.generatedAt);if(at===null||at<INCEPTION||at>generated)return undefined;
 try{
 const asOf=at;
 const p=record(m.persistence),l=record(m.lifetime),h=record(m.currentHour),a=record(m.active),r=record(m.resource),f=record(s.funnel);
 const values=(value:Record<string,any>,keys:string)=>Object.fromEntries(keys.split(' ').map(key=>[key,count(value[key])])) as Record<string,Count>;
 const feeds:MarketCoverageReporting['feeds']=[];
 // Bound the public diagnostics by finite feed kinds, never token identities.
 for(const source of MARKET_COVERAGE_FEED_SOURCES){
  const found=(Array.isArray(m.feeds)?m.feeds:[]).map(record).find(feed=>feed.source===source);
  if(!found)continue;
  feeds.push({source,connected:typeof found.connected==='boolean'?found.connected:null,lastObservedAt:iso(found.lastObservedAt,asOf),scope:(MARKET_COVERAGE_FEED_SCOPES as readonly unknown[]).includes(found.scope)?found.scope:'UNKNOWN',coverageGaps:count(found.coverageGaps)});
 }
 const limitations=new Set<MarketCoverageReporting['limitations'][number]>(['MARKET_DENOMINATOR_UNKNOWN']);
 for(const code of Array.isArray(m.limitations)?m.limitations:[])limitations.add((MARKET_COVERAGE_LIMITATIONS as readonly unknown[]).includes(code)?code:'OTHER_UNEXPORTED_LIMITATION');
 const hour=iso(h.startedAt,asOf),hourAt=hour===null?null:Date.parse(hour);
 const currentHour=hourAt!==null&&hourAt===Math.floor(asOf/3600000)*3600000?{startedAt:hour,uniqueTokensDiscovered:count(h.uniqueTokensDiscovered)}:{startedAt:null,uniqueTokensDiscovered:null};
 return validateMarketCoverageReporting({version:MARKET_COVERAGE_REPORTING_VERSION,generatedAt:new Date(asOf).toISOString(),persistence:{state:p.state==='sqlite-wal'?'sqlite-wal':'unavailable',createdAt:iso(p.createdAt,asOf),updatedAt:iso(p.updatedAt,asOf)},
  lifetime:values(l,'uniqueTokensDiscovered lightweightScreened lightweightWithActivity lightweightUnavailable deepAdmitted verifiedAudited'),currentHour,
  active:values(a,'trackedIdentities awaitingLightweight awaitingOrigin awaitingVerification awaitingDeep deepObserving'),
  resource:{durableVerificationBacklog:count(r.durableVerificationBacklog),oldestVerificationAt:iso(r.oldestVerificationAt,asOf),maximumVerificationWaitMs:count(r.maximumVerificationWaitMs),storageFailures:count(r.storageFailures),maximumWriteMs:duration(r.maximumWriteMs),meanWriteMs:duration(r.meanWriteMs)},
  financial:{scope:'current-source-instance',qualified:count(f.qualified),entries:count(f.paperFilled),exits:count(f.exited)},feeds,marketDenominator:null,wholeMarketCoveragePercent:null,limitations:[...limitations]},generated);
 }catch{return undefined;}
}
export function validateMarketCoverageReporting(value:unknown,generated:number):MarketCoverageReporting {
 const m=exact(value,'version generatedAt persistence lifetime currentHour active resource financial feeds marketDenominator wholeMarketCoveragePercent limitations');
 need(m.version===MARKET_COVERAGE_REPORTING_VERSION&&m.marketDenominator===null&&m.wholeMarketCoveragePercent===null);
 const time=(v:unknown,nullable=false)=>{if(v===null&&nullable)return;const at=typeof v==='string'?Date.parse(v):NaN;need(Number.isSafeInteger(at)&&at>=INCEPTION&&at<=generated&&new Date(at).toISOString()===v);};
 const n=(v:unknown)=>need(v===null||count(v)!==null);
 time(m.generatedAt);const asOf=Date.parse(m.generatedAt);
 const p=exact(m.persistence,'state createdAt updatedAt');need(['sqlite-wal','unavailable'].includes(p.state));time(p.createdAt,true);time(p.updatedAt,true);
 for(const [key,keys] of [['lifetime','uniqueTokensDiscovered lightweightScreened lightweightWithActivity lightweightUnavailable deepAdmitted verifiedAudited'],['active','trackedIdentities awaitingLightweight awaitingOrigin awaitingVerification awaitingDeep deepObserving']] as const){const section=exact(m[key],keys);Object.values(section).forEach(n);}
 const l=m.lifetime;for(const key of ['lightweightScreened','lightweightWithActivity','lightweightUnavailable','deepAdmitted','verifiedAudited'])need(l[key]===null||l.uniqueTokensDiscovered===null||l[key]<=l.uniqueTokensDiscovered);
 need(l.lightweightWithActivity===null||l.lightweightScreened===null||l.lightweightWithActivity<=l.lightweightScreened);
 const h=exact(m.currentHour,'startedAt uniqueTokensDiscovered');time(h.startedAt,true);n(h.uniqueTokensDiscovered);need(h.startedAt===null?h.uniqueTokensDiscovered===null:Date.parse(h.startedAt)===Math.floor(asOf/3600000)*3600000);need(h.uniqueTokensDiscovered===null||l.uniqueTokensDiscovered===null||h.uniqueTokensDiscovered<=l.uniqueTokensDiscovered);
 const r=exact(m.resource,'durableVerificationBacklog oldestVerificationAt maximumVerificationWaitMs storageFailures maximumWriteMs meanWriteMs');time(r.oldestVerificationAt,true);for(const key of ['durableVerificationBacklog','maximumVerificationWaitMs','storageFailures'])n(r[key]);for(const key of ['maximumWriteMs','meanWriteMs'])need(r[key]===null||duration(r[key])!==null);
 const f=exact(m.financial,'scope qualified entries exits');need(f.scope==='current-source-instance');for(const key of ['qualified','entries','exits'])n(f[key]);
 need(Array.isArray(m.feeds)&&m.feeds.length<=MARKET_COVERAGE_FEED_SOURCES.length);const seen=new Set<string>();
 for(const row of m.feeds){const feed=exact(row,'source connected lastObservedAt scope coverageGaps');need((MARKET_COVERAGE_FEED_SOURCES as readonly unknown[]).includes(feed.source)&&!seen.has(feed.source)&&(MARKET_COVERAGE_FEED_SCOPES as readonly unknown[]).includes(feed.scope));seen.add(feed.source);need(feed.connected===null||typeof feed.connected==='boolean');time(feed.lastObservedAt,true);n(feed.coverageGaps);}
 need(Array.isArray(m.limitations)&&m.limitations.length<=MARKET_COVERAGE_LIMITATIONS.length&&new Set(m.limitations).size===m.limitations.length&&m.limitations.includes('MARKET_DENOMINATOR_UNKNOWN'));for(const code of m.limitations)need((MARKET_COVERAGE_LIMITATIONS as readonly unknown[]).includes(code));
 // A retained observation cannot be newer than this projection's source facts.
 for(const at of [p.createdAt,p.updatedAt,r.oldestVerificationAt,...m.feeds.map((feed:any)=>feed.lastObservedAt)])need(at===null||Date.parse(at)<=asOf);
 need(Buffer.byteLength(JSON.stringify(m))<=6144);return m as MarketCoverageReporting;
}
