/** Existing physical HTTP observations only; method context does not establish
 * a method-specific provider quota. No requests or provider errors are copied. */
export const PROVIDER_HTTP_REPORTING_VERSION='pilot-provider-http-observations-v1' as const;
export const PROVIDER_HTTP_METHODS=['getBlock','getSlot','getMultipleAccounts','getTransaction','getSignaturesForAddress','getMinimumBalanceForRentExemption','getBlockTime','getGenesisHash'] as const;
type Count=number|null;
type Counters={httpStarts:Count;httpResponses:Count;rateLimitedResponses:Count;unavailableResponses:Count};
export type ProviderHttpReporting={version:typeof PROVIDER_HTTP_REPORTING_VERSION;scope:'CURRENT_PILOT_RPC_INSTANCE';runId:string;startedAt:string;methodSpecificProviderScopeKnown:false;extraProviderRequests:0;byMethod:({method:typeof PROVIDER_HTTP_METHODS[number]}&Counters)[];lastRestriction:null|{at:string;method:typeof PROVIDER_HTTP_METHODS[number]|null;domain:'rpc'|'history';status:429|502|503|504;explicitRetryAfter:boolean;retryAfterMs:Count;cooldownUntil:string;physicalRequestId:Count;observedAfterLogicalCompletion:boolean}}&Counters;
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z'),record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const count=(v:unknown):Count=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
const duration=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER?v:null;
const keys=['httpStarts','httpResponses','rateLimitedResponses','unavailableResponses'];
const counters=(r:Record<string,any>)=>Object.fromEntries(keys.map(key=>[key,count(r[key])]));
function need(v:unknown):asserts v {if(!v)throw Error('PROVIDER_HTTP_REPORTING_INVALID');}
function exact(v:unknown,fields:string){const r=record(v);need(v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(r).sort().join(' ')===fields.split(' ').sort().join(' '));return r;}
function iso(value:unknown,generated:number,future=false){const at=count(value);need(at!==null&&at>=INCEPTION&&(future||at<=generated)&&at<=8640000000000000);return new Date(at).toISOString();}
export function projectProviderHttpReporting(value:unknown,generated:number):ProviderHttpReporting|undefined {
 const r=record(value);if(r.version!==PROVIDER_HTTP_REPORTING_VERSION)return undefined;
 try{const l=record(r.lastRestriction),byMethod=PROVIDER_HTTP_METHODS.flatMap(method=>{const row=(Array.isArray(r.byMethod)?r.byMethod:[]).map(record).find(row=>row.method===method);return row?[{method,...counters(row)}]:[];});
  const validRestriction=r.lastRestriction&&[429,502,503,504].includes(l.status)&&['rpc','history'].includes(l.domain)&&typeof l.explicitRetryAfter==='boolean'&&typeof l.observedAfterLogicalCompletion==='boolean';
  return validateProviderHttpReporting({version:r.version,scope:r.scope,runId:r.runId,startedAt:iso(r.startedAt,generated),...counters(r),byMethod,lastRestriction:validRestriction?{at:iso(l.at,generated),method:(PROVIDER_HTTP_METHODS as readonly unknown[]).includes(l.method)?l.method:null,domain:l.domain,status:l.status,explicitRetryAfter:l.explicitRetryAfter,retryAfterMs:duration(l.retryAfterMs),cooldownUntil:iso(l.cooldownUntil,generated,true),physicalRequestId:count(l.physicalRequestId),observedAfterLogicalCompletion:l.observedAfterLogicalCompletion}:null,methodSpecificProviderScopeKnown:r.methodSpecificProviderScopeKnown,extraProviderRequests:r.extraProviderRequests},generated);
 }catch{return undefined;}
}
export function validateProviderHttpReporting(value:unknown,generated:number):ProviderHttpReporting {
 const r=exact(value,'version scope runId startedAt httpStarts httpResponses rateLimitedResponses unavailableResponses byMethod lastRestriction methodSpecificProviderScopeKnown extraProviderRequests');need(r.version===PROVIDER_HTTP_REPORTING_VERSION&&r.scope==='CURRENT_PILOT_RPC_INSTANCE'&&typeof r.runId==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(r.runId)&&r.methodSpecificProviderScopeKnown===false&&r.extraProviderRequests===0);
 const time=(v:unknown,future=false)=>{const at=typeof v==='string'?Date.parse(v):NaN;need(Number.isSafeInteger(at)&&at>=INCEPTION&&(future||at<=generated)&&new Date(at).toISOString()===v);};time(r.startedAt);const n=(v:unknown)=>need(v===null||count(v)!==null);keys.forEach(key=>n(r[key]));
 need(Array.isArray(r.byMethod)&&r.byMethod.length<=PROVIDER_HTTP_METHODS.length);const seen=new Set<string>();for(const item of r.byMethod){const row=exact(item,'method httpStarts httpResponses rateLimitedResponses unavailableResponses');need((PROVIDER_HTTP_METHODS as readonly unknown[]).includes(row.method)&&!seen.has(row.method));seen.add(row.method);keys.forEach(key=>n(row[key]));}
 if(r.lastRestriction!==null){const l=exact(r.lastRestriction,'at method domain status explicitRetryAfter retryAfterMs cooldownUntil physicalRequestId observedAfterLogicalCompletion');time(l.at);time(l.cooldownUntil,true);need(l.at>=r.startedAt&&(l.method===null||(PROVIDER_HTTP_METHODS as readonly unknown[]).includes(l.method))&&['rpc','history'].includes(l.domain)&&[429,502,503,504].includes(l.status)&&typeof l.explicitRetryAfter==='boolean'&&typeof l.observedAfterLogicalCompletion==='boolean');need(l.retryAfterMs===null||duration(l.retryAfterMs)!==null);n(l.physicalRequestId);}
 need(Buffer.byteLength(JSON.stringify(r))<=4096);return r as ProviderHttpReporting;
}
