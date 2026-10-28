/** Deferred pages for the existing auditor. This owns no client, queue, timer,
 * provider allowance or physical-operation settlement. The caller dispatches
 * at most one exposed page through its existing scheduler and physical gate. */
import {auditNativeFlowWindow,type NativeFlowAuditOptions,type NativeFlowAuditResult} from './native-flow-audit.js';
import type {PilotRpcCallOptions} from './pilot-rpc.js';

export type NativeAuditSessionOptions=Omit<NativeFlowAuditOptions,'call'|'maximumElapsedMs'|'maximumPages'> & {
 deadlineAt:number;maximumPages?:1|2|3|4;audit?:typeof auditNativeFlowWindow;
};
export type NativeAuditPage={page:number;method:'getSignaturesForAddress';params:unknown[];signal:AbortSignal;options:PilotRpcCallOptions};
type DeferredPage={request:NativeAuditPage;resolve:(value:unknown)=>void;reject:(error:unknown)=>void;detach:()=>void};
const int=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const code=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,150}$/.test(error.message)?error.message:'NATIVE_AUDIT_SESSION_UNAVAILABLE';

export class NativeAuditSession {
 readonly startedAt:number;readonly deadlineAt:number;
 private readonly now:()=>number;private readonly abort=new AbortController();private readonly signal:AbortSignal;
 private pendingPage:DeferredPage|null=null;private nextPage=0;private completed=false;private failure:string|null=null;private value:NativeFlowAuditResult|null=null;private diagnostic:NativeFlowAuditResult|null=null;
 private readonly helper:Promise<void>;
 constructor(options:NativeAuditSessionOptions){
  if(!Array.isArray(options.notifications)||options.notifications.length>8192)throw Error('NATIVE_AUDIT_SESSION_INPUT_BOUND');
  this.now=options.now??Date.now;this.startedAt=this.now();this.deadlineAt=options.deadlineAt;
  if(!int(this.startedAt)||!int(this.deadlineAt)||this.deadlineAt<=this.startedAt||this.deadlineAt>options.target.endAt+9999||this.startedAt<options.target.endAt||this.deadlineAt-this.startedAt>10000)throw Error('NATIVE_AUDIT_SESSION_DEADLINE');
  this.signal=options.signal?AbortSignal.any([options.signal,this.abort.signal]):this.abort.signal;
  const {deadlineAt:_deadline,maximumPages=4,audit=auditNativeFlowWindow,...original}=options;
  // The source generation and fences are captured once. Fresh response and
  // helper completion times remain actual; advancing a page never backdates.
  const captured={...original,target:{...original.target},notifications:structuredClone(original.notifications),...(original.contextFences?{contextFences:structuredClone(original.contextFences)}:{}),admission:original.admission?{...original.admission}:undefined};
  this.helper=audit({...captured,now:this.now,signal:this.signal,maximumPages,maximumElapsedMs:this.deadlineAt-this.startedAt,call:<T>(method:string,params:unknown[],signal?:AbortSignal,admission?:PilotRpcCallOptions)=>this.defer<T>(method,params,signal,admission)}).then(result=>{
   this.diagnostic=structuredClone(result);
   if(!this.expired()&&result.availableAt<=this.deadlineAt)this.value=structuredClone(result);
   else if(!this.failure)this.cancel('NATIVE_AUDIT_SESSION_DEADLINE');
  },error=>{this.failure??=code(error);}).finally(()=>{this.completed=true;this.pendingPage?.detach();this.pendingPage=null;});
 }
 private expired(){
  if(this.failure||this.completed)return this.failure!==null;
  const at=this.now();if(!int(at)||at<this.startedAt){this.cancel('NATIVE_AUDIT_SESSION_CLOCK');return true;}
  if(at>this.deadlineAt){this.cancel('NATIVE_AUDIT_SESSION_DEADLINE');return true;}
  if(this.signal.aborted){this.cancel('NATIVE_AUDIT_SESSION_ABORTED');return true;}
  return false;
 }
 private defer<T>(method:string,params:unknown[],signal?:AbortSignal,admission?:PilotRpcCallOptions):Promise<T>{
  if(this.expired())return Promise.reject(Error(this.failure!));
  if(method!=='getSignaturesForAddress'||this.pendingPage!==null||this.nextPage>=4)return Promise.reject(Error('NATIVE_AUDIT_SESSION_PAGE_BOUND'));
  const combined=signal?AbortSignal.any([signal,this.signal]):this.signal;
  return new Promise<T>((resolve,reject)=>{
   const request:NativeAuditPage={page:++this.nextPage,method,params:structuredClone(params),signal:combined,options:{...admission,latestStartAt:Math.min(admission?.latestStartAt??this.deadlineAt,this.deadlineAt),admissionOpen:()=>!this.expired()&&(admission?.admissionOpen?.()??true)}};
   const aborted=()=>{if(this.pendingPage?.request.page===request.page){this.pendingPage.detach();this.pendingPage=null;}reject(Error(this.failure??'NATIVE_AUDIT_SESSION_ABORTED'));};
   combined.addEventListener('abort',aborted,{once:true});this.pendingPage={request,resolve:value=>resolve(value as T),reject,detach:()=>combined.removeEventListener('abort',aborted)};
   if(combined.aborted)aborted();
  });
 }
 pending():NativeAuditPage|null{
  if(this.expired()||!this.pendingPage)return null;
  const r=this.pendingPage.request;return {...r,params:structuredClone(r.params),options:{...r.options}};
 }
 /** A stale/duplicate response cannot settle a newer logical page. False is an
  * explicit refusal, not a retry, dequeue or assertion of physical settlement. */
 respond(page:number,value:unknown):boolean{
  if(this.expired()||this.pendingPage?.request.page!==page)return false;
  const pending=this.pendingPage;this.pendingPage=null;pending.detach();pending.resolve(value);return true;
 }
 reject(page:number,error:unknown):boolean{
  if(this.expired()||this.pendingPage?.request.page!==page)return false;
  const pending=this.pendingPage;this.pendingPage=null;pending.detach();pending.reject(error);return true;
 }
 result():NativeFlowAuditResult|null{this.expired();return this.value?structuredClone(this.value):null;}
 /** Historical helper outcome, including late/unavailable/cancelled results.
  * Diagnostic evidence only; error(), generation and current-window admission
  * must still pass before any assessment. */
 diagnosticResult():NativeFlowAuditResult|null{return this.diagnostic?structuredClone(this.diagnostic):null;}
 error():string|null{this.expired();return this.failure;}
 cancel(reason='NATIVE_AUDIT_SESSION_CANCELLED'){
  if(this.completed||this.failure)return;
  this.failure=/^[A-Z][A-Z0-9_:-]{0,150}$/.test(reason)?reason:'NATIVE_AUDIT_SESSION_CANCELLED';this.value=null;
  const pending=this.pendingPage;this.pendingPage=null;pending?.detach();pending?.reject(Error(this.failure));this.abort.abort();
  // Aborting the logical helper NEVER proves a caller's physical request has
  // settled. Its gate/cancellation accounting remains entirely caller-owned.
 }
 /** Bounded microtask progress only; never waits on a deferred physical call. */
 async advance(){this.expired();for(let i=0;i<8;i++)await Promise.resolve();this.expired();}
}
