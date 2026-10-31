import {performance} from 'node:perf_hooks';
import type {MarketIdentityHint,MarketActivityHint,MarketFeedStatus} from './market-discovery.js';
import type {MarketRegistryCommittedActivity,MarketRegistryIntakeMessage} from './market-registry-intake-worker.js';

export const NATIVE_MARKET_INTAKE_POLICY=Object.freeze({version:'off-thread-full-durable-market-intake-v1',pendingBytesBudget:32*1024*1024,sendQuantumMs:5,workerComputeMs:10,writerYieldMs:3,workerOldGenerationMiB:256,closeTimeoutMs:30000});
type Handle={postMessage:(value:unknown)=>void;on:(event:string,listener:(value:any)=>void)=>unknown;terminate:()=>Promise<number>};
type Pending={message:MarketRegistryIntakeMessage;bytes:number;queuedAt:number;sent:boolean};
type Options={createWorker:()=>Handle;onCommitted:(rows:MarketRegistryCommittedActivity[])=>void;onPressure:(value:{paused:boolean;pendingBytes:number;budgetBytes:number})=>void;now?:()=>number;budgetBytes?:number;record?:(kind:string,data:unknown)=>void};
/** Nonfinancial IPC bridge. Records remain owned here until the worker ACKs a
 * FULL commit; its byte high-water mark pauses shared transports, never evicts
 * token identities. A process crash can lose unacknowledged network intake;
 * that explicit in-flight tail is never counted as durable discovery. */
export class NativeMarketIntake {
 private readonly pending=new Map<number,Pending>();private readonly now:()=>number;private readonly budget:number;
 private worker:Handle|null=null;private workerGeneration=0;private ready=false;private stopping=false;private closed=false;
 private serial=0;private bytes=0;private received=0;private committed=0;private restarts=0;private failures=0;private retryAt:number|null=null;private reasonCode:string|null=null;private lastCommitAt:number|null=null;private workerStats:unknown=null;
 private sendTimer:ReturnType<typeof setImmediate>|null=null;private retryTimer:ReturnType<typeof setTimeout>|null=null;private closeResolve:(()=>void)|null=null;private pressureState:string|null=null;
 constructor(private readonly options:Options){this.now=options.now??Date.now;this.budget=options.budgetBytes??NATIVE_MARKET_INTAKE_POLICY.pendingBytesBudget;if(!Number.isSafeInteger(this.budget)||this.budget<1)throw Error('MARKET_INTAKE_BYTE_BUDGET');this.start();}
 private pressure(){const paused=!this.ready||this.bytes>=this.budget;const key=paused+':'+this.bytes;if(key!==this.pressureState){this.pressureState=key;this.options.onPressure({paused,pendingBytes:this.bytes,budgetBytes:this.budget});}}
 private start(){if(this.closed)return;this.workerGeneration++;const generation=this.workerGeneration;
  try{const worker=this.options.createWorker();this.worker=worker;worker.on('message',value=>{if(this.worker===worker)this.message(value);});worker.on('error',()=>{if(this.worker===worker)this.failed('WORKER_ERROR');});worker.on('exit',code=>{if(this.worker===worker&&!this.closed)this.failed(code===0?'WORKER_EXIT_BEFORE_DRAIN':'WORKER_EXIT');});}
  catch{this.failed('WORKER_START_FAILED');}this.options.record?.('native-market-intake-worker-start',{at:this.now(),generation,financialWriterOpened:false});this.pressure();
 }
 private failed(reasonCode:string){if(this.closed)return;const prior=this.worker;this.worker=null;this.ready=false;if(this.sendTimer)clearImmediate(this.sendTimer);this.sendTimer=null;this.failures++;this.reasonCode=reasonCode;for(const row of this.pending.values())row.sent=false;void prior?.terminate().catch(()=>{});this.pressure();
  this.options.record?.('native-market-intake-worker-unavailable',{at:this.now(),reasonCode,pending:this.pending.size,pendingBytes:this.bytes,unacknowledgedTailRetained:true,financialManagerContinues:true});
  if(this.stopping){this.closeResolve?.();return;}if(!this.retryTimer){const delay=Math.min(30000,500*2**Math.min(6,this.failures-1));this.retryAt=this.now()+delay;this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.restarts++;this.start();},delay);}
 }
 private message(value:any){
  if(value?.kind==='ready'){this.ready=true;this.reasonCode=null;this.retryAt=null;this.workerStats=value.stats;this.pressure();this.scheduleSend();return;}
  if(value?.kind==='committed'&&Array.isArray(value.ids)){let applied=0;for(const id of value.ids){const row=this.pending.get(id);if(!row)continue;this.pending.delete(id);this.bytes-=row.bytes;applied++;}this.committed+=applied;this.lastCommitAt=value.committedAt;this.workerStats=value.stats;this.pressure();if(applied)this.options.onCommitted(Array.isArray(value.activities)?value.activities:[]);this.scheduleSend();this.maybeStop();return;}
  if(value?.kind==='failure'){this.workerStats=value.stats;this.failed(typeof value.reasonCode==='string'&&/^[A-Z0-9_]+$/.test(value.reasonCode)?value.reasonCode:'WORKER_FAILURE');return;}
  if(value?.kind==='closed'){if(this.pending.size){this.failed('WORKER_CLOSED_WITH_UNACKNOWLEDGED_INTAKE');return;}this.closed=true;this.ready=false;this.worker=null;this.closeResolve?.();}
 }
 private enqueue(operation:'identity'|'activity'|'feed',value:MarketIdentityHint|MarketActivityHint|MarketFeedStatus){if(this.stopping||this.closed)throw Error('MARKET_INTAKE_CLOSED');const message={kind:'intake',id:++this.serial,operation,value:structuredClone(value)} as MarketRegistryIntakeMessage;const bytes=Buffer.byteLength(JSON.stringify(message));this.pending.set(message.id,{message,bytes,queuedAt:this.now(),sent:false});this.bytes+=bytes;this.received++;this.pressure();this.scheduleSend();}
 observeIdentity(value:MarketIdentityHint){this.enqueue('identity',value);}
 observeActivity(value:MarketActivityHint){this.enqueue('activity',value);}
 observeFeed(value:MarketFeedStatus){this.enqueue('feed',value);}
 private scheduleSend(){if(this.sendTimer||!this.ready||!this.worker||this.closed)return;this.sendTimer=setImmediate(()=>{this.sendTimer=null;if(!this.ready||!this.worker||this.closed)return;const start=performance.now();for(const row of this.pending.values()){if(row.sent)continue;try{this.worker!.postMessage(row.message);row.sent=true;}catch{this.failed('WORKER_SEND_FAILED');return;}if(performance.now()-start>=NATIVE_MARKET_INTAKE_POLICY.sendQuantumMs){this.scheduleSend();return;}}this.maybeStop();});}
 private maybeStop(){if(this.stopping&&this.ready&&this.worker&&this.pending.size===0)this.worker.postMessage({kind:'stop'});}
 available(){return this.ready&&!this.closed&&!this.stopping;}
 usage(){const oldest=this.pending.values().next().value as Pending|undefined;return {version:NATIVE_MARKET_INTAKE_POLICY.version,state:this.closed?'closed':this.ready?'ready':'recovering',received:this.received,durableCommitted:this.committed,pending:this.pending.size,pendingBytes:this.bytes,pendingBytesBudget:this.budget,oldestPendingAt:oldest?.queuedAt??null,maximumPendingAgeMs:oldest?Math.max(0,this.now()-oldest.queuedAt):0,lastCommitAt:this.lastCommitAt,workerGeneration:this.workerGeneration,restarts:this.restarts,failures:this.failures,retryAt:this.retryAt,reasonCode:this.reasonCode,worker:this.workerStats,inFlightTailMeaning:'UNACKNOWLEDGED_NETWORK_INTAKE_IS_NOT_YET_DURABLE',financialWriterOpened:false};}
 async close(){if(this.closed)return;this.stopping=true;if(this.retryTimer)clearTimeout(this.retryTimer);this.retryTimer=null;if(!this.worker&&!this.pending.size){this.closed=true;this.ready=false;return;}let timer:ReturnType<typeof setTimeout>|null=null;await new Promise<void>(resolve=>{this.closeResolve=resolve;timer=setTimeout(resolve,NATIVE_MARKET_INTAKE_POLICY.closeTimeoutMs);if(!this.worker)this.start();this.scheduleSend();this.maybeStop();});if(timer)clearTimeout(timer);if(this.sendTimer)clearImmediate(this.sendTimer);this.sendTimer=null;const worker=this.worker;this.worker=null;this.closed=true;this.ready=false;if(this.pending.size)this.options.record?.('native-market-intake-undrained-shutdown',{at:this.now(),pending:this.pending.size,pendingBytes:this.bytes,durableCommitted:this.committed,coverageComplete:false,financialHistoryPreserved:true});await worker?.terminate().catch(()=>{});}
}
