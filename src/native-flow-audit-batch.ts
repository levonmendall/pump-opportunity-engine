/** A bounded single HTTP-batch collector around the existing strict window
 * auditor. This module owns no provider, gate, retry, market window or ledger. */
import {auditNativeFlowWindow,type NativeFlowAuditOptions,type NativeFlowAuditResult} from './native-flow-audit.js';
import type {PilotRpcCallOptions} from './pilot-rpc.js';
import type {SignatureHistoryBatchItem,SignatureHistoryBatchResponse} from './component-transport.js';

export type NativeAuditHistoryBatchItem<T>=SignatureHistoryBatchItem<T>;
export type NativeAuditHistoryBatchTransportResult<T>=SignatureHistoryBatchResponse<T>;
export type NativeAuditBatchJob={key:string;audit:Omit<NativeFlowAuditOptions,'call'|'now'|'signal'|'maximumPages'>;signal?:AbortSignal};
export type NativeFlowAuditBatchOptions={
 jobs:readonly NativeAuditBatchJob[];
 callBatch:<T>(requests:readonly {key:string;params:unknown[]}[],signal?:AbortSignal,options?:PilotRpcCallOptions)=>Promise<NativeAuditHistoryBatchTransportResult<T>>;
 now?:()=>number;signal?:AbortSignal;admission?:PilotRpcCallOptions;record?:(kind:string,data:unknown)=>void;
};
export type NativeFlowAuditBatchResult={
 classification:'BOUNDED_NATIVE_SIGNATURE_AUDITS_ONE_HTTP_BATCH';
 jobs:Array<{key:string;result:NativeFlowAuditResult}>;batchCallAttempts:0|1;
 physicalHttpStarts:0|1|null;physicalSettlementConfirmed:true|null;logicalQueries:number|null;logicalQueriesRequested:number;futureGateBlocked:boolean;
 transport:NativeAuditHistoryBatchTransportResult<unknown>|null;transportFailure:string|null;
 limitations:readonly string[];
};
const safe=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,150}$/.test(error.message)?error.message:'NATIVE_AUDIT_BATCH_UNAVAILABLE';
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
function need(value:unknown,reason:string):asserts value{if(!value)throw Error('NATIVE_AUDIT_BATCH_'+reason);}
const failure=(reason:string)=>Error('NATIVE_AUDIT_BATCH_'+reason);
const limitations=Object.freeze([
 'A physical JSON-RPC HTTP batch contains separate provider queries; fewer physical starts do not establish provider entitlement or lower method-specific billing.',
 'Each result still passes the original strict notification/context fences, confirmed history rows, payload limits and complete-window audit. This is no new completeness claim.',
 'A pre-dispatch cancellation/expiry removes only that logical query. While waiting for the shared physical gate, loss of any selected admission conservatively refuses the unsent batch.',
 'Outer cancellation targets the single physical operation; rejection alone does not prove its physical settlement. The caller must retain the shared gate and uncertain reservation until the actual transport settles. Individual cancellation does not terminate siblings.',
 'futureGateBlocked signals a known provider backoff, not permission to reuse the shared gate after other fatal, cancelled or uncertain operations.',
 'A provider overload blocks all current audit admissions and explicitly requires future shared-gate cooldown handling; this helper never retries or clears a provider refusal.',
]);
type Waiting={key:string;params:unknown[];signal?:AbortSignal;admission?:PilotRpcCallOptions;settled:boolean;resolve:(value:unknown)=>void;reject:(error:unknown)=>void};

export async function auditNativeFlowWindowsBatch(options:NativeFlowAuditBatchOptions):Promise<NativeFlowAuditBatchResult>{
 need(Array.isArray(options.jobs)&&options.jobs.length>=1&&options.jobs.length<=6,'JOB_BOUND');
 const keys=new Set<string>(),pools=new Set<string>();
 for(const job of options.jobs){need(job&&typeof job.key==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(job.key)&&!keys.has(job.key)&&job.audit&&typeof job.audit.pool==='string'&&!pools.has(job.audit.pool),'JOB_IDENTITY');keys.add(job.key);pools.add(job.audit.pool);}
 const target=options.jobs[0]!.audit.target;
 need(target&&integer(target.startAt)&&integer(target.endAt)&&target.endAt-target.startAt===60000&&target.startAt%10000===0&&target.endAt%10000===0&&options.jobs.every(job=>job.audit.target.startAt===target.startAt&&job.audit.target.endAt===target.endAt),'SHARED_CLOSED_BUCKET');
 const now=options.now??Date.now,waiting:Waiting[]=[];
 const outcome:NativeFlowAuditBatchResult={classification:'BOUNDED_NATIVE_SIGNATURE_AUDITS_ONE_HTTP_BATCH',jobs:[],batchCallAttempts:0,physicalHttpStarts:0,physicalSettlementConfirmed:true,logicalQueries:0,logicalQueriesRequested:0,futureGateBlocked:false,transport:null,transportFailure:null,limitations};
 const settle=(item:Waiting,error:unknown,value?:unknown)=>{if(item.settled)return;item.settled=true;if(error)item.reject(error);else item.resolve(value);};
 const admissible=(item:Waiting,at:number,requestAdmission=true)=>{
  if(options.signal?.aborted||item.signal?.aborted)throw failure('ABORTED');
  need(integer(at),'CLOCK');
  if(requestAdmission&&item.admission?.latestStartAt!==undefined&&at>item.admission.latestStartAt)throw failure('DEADLINE');
  if(requestAdmission&&options.admission?.latestStartAt!==undefined&&at>options.admission.latestStartAt)throw failure('DEADLINE');
  if(!(options.admission?.admissionOpen?.()??true)||!(item.admission?.admissionOpen?.()??true))throw failure('ADMISSION_CLOSED');
 };
 // auditNativeFlowWindow runs its complete existing preflight synchronously
 // before its first await. Only jobs actually requesting a page enter waiting.
 const audits=options.jobs.map(job=>{
  const signal=options.signal&&job.signal?AbortSignal.any([options.signal,job.signal]):options.signal??job.signal;
  return auditNativeFlowWindow({...job.audit,now,signal,maximumPages:1,
   call:<T>(method:string,params:unknown[],requestSignal?:AbortSignal,admission?:PilotRpcCallOptions):Promise<T>=>{
    need(method==='getSignaturesForAddress'&&waiting.length<6&&!waiting.some(item=>item.key===job.key),'COLLECTOR_CONTRACT');
    return new Promise<T>((resolve,reject)=>waiting.push({key:job.key,params,signal:requestSignal,admission,settled:false,resolve:value=>resolve(value as T),reject}));
   }}).then(result=>({key:job.key,result}));
 });
 const selected:Waiting[]=[];
 for(const item of waiting){try{admissible(item,now());selected.push(item);}catch(error){settle(item,error);}}
 if(selected.length){
  const requests=selected.map(item=>({key:item.key,params:item.params}));outcome.batchCallAttempts=1;outcome.logicalQueriesRequested=requests.length;outcome.logicalQueries=null;outcome.physicalHttpStarts=null;outcome.physicalSettlementConfirmed=null;
  try{
   const deadlines=[options.admission?.latestStartAt,...selected.map(item=>item.admission?.latestStartAt)].filter((value):value is number=>value!==undefined);
   const timeouts=[options.admission?.timeoutMs,...selected.map(item=>item.admission?.timeoutMs)].filter((value):value is number=>value!==undefined);
   const admission:PilotRpcCallOptions={...(deadlines.length?{latestStartAt:Math.min(...deadlines)}:{}),...(timeouts.length?{timeoutMs:Math.min(...timeouts)}:{}),admissionOpen:()=>{try{const at=now();for(const item of selected)admissible(item,at);return true;}catch{return false;}}};
   const invokedAt=now(),transport=await options.callBatch<unknown>(requests,options.signal,admission);
   const availableAt=now();
   need(transport&&transport.physicalHttpStarts===1&&transport.logicalQueries===selected.length&&integer(transport.physicalRequestId)&&integer(transport.responseBytes)&&integer(transport.requestedAt)&&integer(transport.responseReceivedAt)&&integer(transport.validatedAt)&&transport.requestedAt>=invokedAt&&transport.requestedAt<=transport.responseReceivedAt&&transport.responseReceivedAt<=transport.validatedAt&&transport.validatedAt<=availableAt&&typeof transport.overloaded==='boolean'&&Array.isArray(transport.items)&&transport.items.length===selected.length,'TRANSPORT_RECEIPT');
   const items=new Map<string,NativeAuditHistoryBatchItem<unknown>>(),ids=new Set<string>();
   for(const item of transport.items){need(item&&selected.some(job=>job.key===item.key)&&!items.has(item.key)&&typeof item.id==='string'&&item.id.length>0&&!ids.has(item.id)&&['result','rpc-error'].includes(item.status)&&integer(item.requestedAt)&&integer(item.responseReceivedAt)&&integer(item.validatedAt)&&item.requestedAt===transport.requestedAt&&item.responseReceivedAt===transport.responseReceivedAt&&item.validatedAt>=transport.responseReceivedAt&&item.validatedAt<=transport.validatedAt&&(item.status!=='rpc-error'||Number.isSafeInteger(item.errorCode)),'ITEM_RECEIPT');items.set(item.key,item);ids.add(item.id);}
   outcome.transport=transport;outcome.physicalHttpStarts=1;outcome.physicalSettlementConfirmed=true;outcome.logicalQueries=transport.logicalQueries;
   const overloadCode=transport.items.find(item=>item.status==='rpc-error'&&item.errorCode===429)?.errorCode??transport.items.find(item=>item.status==='rpc-error'&&item.errorCode===-32005)?.errorCode,overloaded=transport.overloaded||overloadCode!==undefined,overloadReason=overloadCode===429?'COMPONENT_HTTP_429':overloadCode===-32005?'COMPONENT_RPC_-32005':'COMPONENT_RPC_OVERLOAD';outcome.futureGateBlocked=overloaded;
   for(const item of selected){try{
    if(overloaded)throw Error(overloadReason);
    admissible(item,now(),false);const receipt=items.get(item.key)!;
    if(receipt.status==='rpc-error')throw Error('COMPONENT_RPC_ERROR_'+receipt.errorCode);
    need(Object.hasOwn(receipt,'result'),'RESULT_ABSENT');settle(item,null,receipt.result);
   }catch(error){settle(item,error);}}
  }catch(error){const reason=safe(error);outcome.transportFailure=reason;if(/429|503|OVERLOAD|_-32005/.test(reason))outcome.futureGateBlocked=true;for(const item of selected)settle(item,error);}
 }
 outcome.jobs=await Promise.all(audits);
 options.record?.('native-flow-window-batch-audit',{...outcome,transport:outcome.transport?{...outcome.transport,items:outcome.transport.items.map(({result,...metadata})=>metadata)}:null});
 return outcome;
}
