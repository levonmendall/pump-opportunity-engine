import {MarketRegistry} from './market-registry.js';
/** A discovery-store fault closes optional work without closing the financial
 * manager. The inert store exists only to let already-owned source objects
 * settle; its records are never published as durable coverage or checkpointed. */
export class NativeMarketRegistryIsolation {
 readonly registry:MarketRegistry;
 private durable:MarketRegistry|undefined;private readonly inert:MarketRegistry;
 private failed=false;private readonly failures=new WeakSet<object>();private readonly handles=new Set<MarketRegistry>();
 private restoreIdentity:string|null|undefined;
 constructor(private readonly options:{open:()=>MarketRegistry;now?:()=>number;onFailure:(fact:{at:number;reasonCode:string})=>void}){
  this.inert=new MarketRegistry(':memory:',{now:options.now??Date.now});this.handles.add(this.inert);
  try{this.durable=options.open();this.handles.add(this.durable);}catch(error){if(!this.storageError(error))throw error;this.fail(error);}
  this.registry=new Proxy(this.inert,{get:(_target,key)=>{
   if(key==='health')return ()=>{const health=(this.durable??this.inert).health();return {...health,available:!this.failed&&this.durable!==undefined&&health.available};};
   if(key==='close')return ()=>this.close();
   const target=this.failed?this.inert:this.durable??this.inert,value=Reflect.get(target,key,target);
   if(typeof value!=='function')return value;
   return (...args:unknown[])=>{try{return Reflect.apply(value,target,args);}catch(error){if(this.storageError(error))this.fail(error);throw error;}};
  }});
 }
 private storageError(error:unknown){const code=(error as {code?:unknown})?.code;return error instanceof SyntaxError||typeof code==='string'&&(/^(SQLITE_|EACCES$|EPERM$|ENOSPC$|EROFS$|EIO$|ENOENT$|ENOTDIR$|EMFILE$|ENFILE$)/.test(code));}
 private fail(error:unknown,reasonCode?:string){if(error&&typeof error==='object')this.failures.add(error);if(this.failed)return;this.failed=true;const code=(error as {code?:unknown})?.code;this.options.onFailure({at:(this.options.now??Date.now)(),reasonCode:reasonCode??(typeof code==='string'&&/^SQLITE_[A-Z_]+$/.test(code)?code:'MARKET_REGISTRY_STORAGE_UNAVAILABLE')});}
 unavailable(){return this.failed;}
 caused(error:unknown){return !!error&&typeof error==='object'&&this.failures.has(error);}
 /** A durable checkpoint identity is provenance, not a reset opportunity. */
 requireHistoryRestore(error:unknown,expectedIdentity:string|null){this.restoreIdentity=expectedIdentity;this.fail(error,error instanceof Error&&['PILOT_WATCH_DURABLE_HISTORY_UNAVAILABLE','PILOT_WATCH_REGISTRY_IDENTITY'].includes(error.message)?error.message:'MARKET_REGISTRY_HISTORY_BINDING_UNAVAILABLE');}
 /** The caller already owns the existing source-recovery backoff and waits for
  * prior transports to settle. A successful real-store commit is required. */
 recover(){if(!this.failed)return true;try{
  if(this.restoreIdentity!==undefined){if(this.restoreIdentity===null)return false;if(this.durable){this.handles.delete(this.durable);this.durable.close();this.durable=undefined;}}
  if(!this.durable){this.durable=this.options.open();this.handles.add(this.durable);}
  if(this.restoreIdentity!==undefined&&this.durable.getMetadata('pilot-watch-identity')!==this.restoreIdentity)return false;
  this.durable.setMetadata('runtime-storage-health-probe',{at:(this.options.now??Date.now)()});this.failed=false;return true;
 }catch(error){if(!this.storageError(error))throw error;if(error&&typeof error==='object')this.failures.add(error);return false;}}
 coverage(at:number){return {version:'poe-market-coverage-v1' as const,generatedAt:at,persistence:{state:'unavailable' as const,createdAt:null,updatedAt:null},lifetime:{uniqueTokensDiscovered:null,lightweightScreened:null,lightweightWithActivity:null,lightweightUnavailable:null,deepAdmitted:null,verifiedAudited:null},currentHour:{startedAt:Math.floor(at/3600000)*3600000,uniqueTokensDiscovered:null},active:{trackedIdentities:null,awaitingLightweight:null,awaitingOrigin:null,awaitingVerification:null,awaitingDeep:null,deepObserving:null},resource:{durableVerificationBacklog:null,oldestVerificationAt:null,maximumVerificationWaitMs:null,storageFailures:null,maximumWriteMs:null,meanWriteMs:null},feeds:[],marketDenominator:null,wholeMarketCoveragePercent:null,limitations:['MARKET_DENOMINATOR_UNKNOWN','REGISTRY_STORAGE_UNAVAILABLE']};}
 close(){for(const handle of this.handles){try{handle.close();}catch{/* Closing discovery must not obscure financial shutdown. */}}this.handles.clear();}
}
