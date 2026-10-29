/** Isolated native-flow mechanics. Retained real logs retain their original
 * program clock/availability; explicitly changed bytes below are synthetic
 * correction/failure fixtures, never natural trading or financial results. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import WebSocket from 'ws';
import bs58 from 'bs58';
import BN from 'bn.js';
import {PublicKey} from '@solana/web3.js';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import {auditNativeFlowWindow} from '../src/native-flow-audit.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import type {PilotFeedControl} from '../src/pilot-feeds.js';
import type {ComponentKind,ComponentOperation} from '../src/component-budget.js';
import {PilotRpcUnavailable,type PilotRpcCallOptions} from '../src/pilot-rpc.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {parseProgramLogEvidence,CONFIRMED_PROGRAM_EVENTS_V2,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '../src/program-log-mapping.js';

const retained=JSON.parse(readFileSync('evidence/dynamic-funnel-20261027/retained-log-events.ndjson','utf8').split('\n')[0]!);
const tx=retained.data.transaction,signature=retained.data.hint.signature,scope={mint:retained.data.selectedHints[0].mint as string,pool:'FUKUVc3MffnDK7dq877GT3wa8M5pmF5NNvrWUuXANhbt',minSlot:tx.slot};
const require=createRequire(import.meta.url),coder=new BorshCoder(JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl);
const clone=<T>(value:T):T=>structuredClone(value);
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

class Socket extends EventEmitter {
  readonly _receiver={writableLength:0,_state:0,_bufferedBytes:0,_fragmented:0};
  readonly _socket=Object.assign(new EventEmitter(),{bytesRead:200});
  readonly sent:Array<{jsonrpc:string;id:number;method:string;params:any[]}>=[];
  readonly controls:string[]=[];
  readonly _sender={sendFrame:(_parts:Buffer[],callback?:()=>void)=>callback?.()};
  readyState:number=WebSocket.CONNECTING;autoClose=true;private subscription=100;
  constructor(readonly endpoint:string){super();}
  open(){this.readyState=WebSocket.OPEN;this.emit('open');}
  frame(value:unknown,declaredBytes?:number){if(this.readyState!==WebSocket.OPEN)return;const raw=Buffer.from(typeof value==='string'?value:JSON.stringify(value));this._socket.bytesRead+=declaredBytes??raw.length+4;this._socket.emit('data',raw);this.emit('message',raw);}
  send(data:string,callback?:(error?:Error)=>void){const request=JSON.parse(data);assert.equal(request.jsonrpc,'2.0');assert.ok(['logsSubscribe','logsUnsubscribe'].includes(request.method),'only filtered read-only logs management');this.sent.push(request);callback?.();queueMicrotask(()=>this.frame({jsonrpc:'2.0',id:request.id,result:request.method==='logsSubscribe'?++this.subscription:true}));}
  ping(payload:Buffer,_mask?:unknown,callback?:(error?:Error)=>void){this.controls.push('ping');this._sender.sendFrame([Buffer.from([0x89]),payload]);callback?.();queueMicrotask(()=>{this._socket.bytesRead+=payload.length+2;this._socket.emit('data',Buffer.alloc(0));this.emit('pong',Buffer.from(payload));});}
  pong(payload:Buffer,_mask?:unknown,callback?:(error?:Error)=>void){this.controls.push('pong');this._sender.sendFrame([Buffer.from([0x8a]),payload]);callback?.();}
  close(code=1000){this.controls.push('close');this._sender.sendFrame([Buffer.from([0x88])]);this.readyState=WebSocket.CLOSING;if(this.autoClose)queueMicrotask(()=>this.drop(code));}
  terminate(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSING;if(this.autoClose)queueMicrotask(()=>this.drop(1006));}
  drop(code=1006){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;this.emit('close',code);}
}

function setup(config:{persistent?:boolean;durationMs?:number;maximumCpuMicros?:number;maximumRssBytes?:number;retainRecords?:boolean;baseTokenProgram?:string;dataContract?:typeof CONFIRMED_PROGRAM_EVENTS_V2|typeof CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW;at?:number;slot?:number;bankClockOffsetMs?:number;maximumCandidates?:number;maximumNotificationsPerCandidate?:number;maximumTransactions?:number;maximumProcessingMs?:number;maximumReceivedBytes?:number;maximumRecordedBytes?:number;hangOpen?:boolean;supportUnavailable?:string;informationAdmissionOpen?:()=>boolean;onFlowOpen?:(row:{mint:string;at:number})=>void;onGap?:(row:{mint?:string;at:number;reason:string;requiresFreshWindow:true})=>void}={}){
  let supportSlot=config.slot??tx.slot,at=config.at??retained.data.rpcAvailableAt as number,mono=0,sequence=0,active=0,id=0,controlBytes=0,recordDelay=0,chargeFailure=false,supportFailure:Error|null=null,supportBefore:(()=>Promise<void>)|null=null,controlFailure:Error|null=null,httpCooldown=0,controlCooldown=0;
  const timers=new Map<number,{at:number;fn:()=>void}>(),sockets:Socket[]=[],operations:ComponentKind[]=[],supportCalls:any[]=[],records:Array<{kind:string;data:any}>=[],trades:any[]=[],gaps:any[]=[],opens:any[]=[];
  const control:PilotFeedControl&{cooldownUntil:()=>number;controlCooldownUntil:()=>number}={cooldownUntil:()=>httpCooldown,controlCooldownUntil:()=>controlCooldown,async operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal,admission?:PilotRpcCallOptions){assert.equal(active,0,'one shared physical control gate');signal?.throwIfAborted();if(admission?.admissionOpen&&!admission.admissionOpen())throw Error('COMPONENT_ADMISSION_CLOSED');if(admission?.latestStartAt!==undefined&&at>admission.latestStartAt)throw Error('COMPONENT_DISPATCH_EXPIRED');if(controlFailure)throw controlFailure;if(at<controlCooldown)throw new PilotRpcUnavailable('COOLDOWN',controlCooldown);operations.push(clone(kind));active++;try{return await work({id:++id,signal:signal??new AbortController().signal,chargeHttp(){throw Error('unexpected HTTP through WS control');},completeResponse(){}});}finally{active--;}},accountControlBytes(bytes){assert.ok(Number.isSafeInteger(bytes)&&bytes>=0);controlBytes+=bytes;if(chargeFailure)throw Error('COMPONENT_STORAGE_UNAVAILABLE');},noteThrottle(_value,when=at){return when+65000;}};
  const support={async validateMany(requests:any[],signal?:AbortSignal,admission?:{latestStartAt:number;admissionOpen:()=>boolean}){signal?.throwIfAborted();if(admission&&(!admission.admissionOpen()||at>admission.latestStartAt))throw Error('RESEARCH_CLOCK_ADMISSION_CLOSED');supportCalls.push(clone(requests));if(supportBefore)await supportBefore();if(at<httpCooldown)throw new PilotRpcUnavailable('COOLDOWN',httpCooldown);if(supportFailure)throw supportFailure;if(config.supportUnavailable)return {validations:{},unavailable:Object.fromEntries(requests.map(r=>[r.mint.toBase58(),config.supportUnavailable])),context:null};return {validations:Object.fromEntries(requests.map(r=>{const mint=r.mint.toBase58();return [mint,{mint,pool:canonicalPumpPoolPda(r.mint).toBase58(),at,sourceSlot:supportSlot,evidence:'OFFLINE_CURRENT_SUPPORT:'+mint,summary:{marketClockUnixSeconds:Math.floor((at-(config.bankClockOffsetMs??0))/1000),tokenProgram:config.baseTokenProgram}}];})),unavailable:{},context:{slot:supportSlot,requestedAt:new Date(at).toISOString(),receivedAt:new Date(at).toISOString(),marketClockUnixSeconds:Math.floor((at-(config.bankClockOffsetMs??0))/1000)}};} };
  const flow=new PilotNativeFlow({persistent:config.persistent,maximumCpuMicros:config.maximumCpuMicros,maximumRssBytes:config.maximumRssBytes,dataContract:config.dataContract,control,support:support as any,informationAdmissionOpen:config.informationAdmissionOpen,maximumCandidates:config.maximumCandidates??1,maximumNotificationsPerCandidate:config.maximumNotificationsPerCandidate,maximumTransactions:config.maximumTransactions,maximumProcessingMs:config.maximumProcessingMs,maximumReceivedBytes:config.maximumReceivedBytes,maximumRecordedBytes:config.maximumRecordedBytes,durationMs:config.durationMs??300000,record(kind,data){if(config.retainRecords!==false)records.push({kind,data:clone(data)});if(recordDelay){at+=recordDelay;mono+=recordDelay;recordDelay=0;}},onFlowOpen:row=>{opens.push(clone(row));config.onFlowOpen?.(row);},onTrade:row=>trades.push(clone(row)),onGap:row=>{gaps.push(clone(row));config.onGap?.(row);}},{now:()=>at,monotonic:()=>mono,setTimer(fn,ms){const key=++sequence;timers.set(key,{at:mono+ms,fn});return key;},clearTimer(timer){timers.delete(timer as number);},makeSocket(endpoint,options){assert.equal(endpoint,'wss://api.mainnet.solana.com');assert.equal(options.autoPong,false);assert.equal(options.allowSynchronousEvents,false);assert.equal(options.followRedirects,false);assert.equal(options.maxPayload,512*1024);const socket=new Socket(endpoint);sockets.push(socket);if(!config.hangOpen)queueMicrotask(()=>socket.open());return socket as unknown as WebSocket;}});
  const advance=async(ms:number)=>{const end=mono+ms;for(let steps=0;steps<10000;steps++){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;at+=next[1].at-mono;mono=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}at+=end-mono;mono=end;await settle();};
  const drive=async(count=1)=>{for(let i=0;i<count;i++){await flow.service();await settle();}};
  const open=async(candidate=scope)=>{await flow.addCandidate(candidate);for(let i=0;i<12&&!flow.snapshot(candidate.mint)?.connected;i++)await drive();assert.equal(flow.snapshot(candidate.mint)?.connected,true,JSON.stringify({usage:flow.usage(),gaps,operations}));return sockets.at(-1)!;};
  const notice=(socket:Socket,payload:{signature?:string;err?:unknown;logs?:unknown}={})=>{const current=flow.snapshot(scope.mint);assert.ok(current?.subscription!==null&&current?.subscription!==undefined);socket.frame({jsonrpc:'2.0',method:'logsNotification',params:{subscription:current.subscription,result:{context:{slot:tx.slot},value:{signature:payload.signature??signature,err:payload.err??null,logs:payload.logs??clone(tx.meta.logMessages)}}}});};
  return {setSupportSlot(slot:number){supportSlot=slot;},flow,control,advance,drive,open,notice,sockets,operations,supportCalls,records,trades,gaps,opens,timers,get now(){return at;},get active(){return active;},get controlBytes(){return controlBytes;},elapseWithoutTimers(ms:number){at+=ms;mono+=ms;},delayNextRecord(ms:number){recordDelay=ms;},failControlCharging(){chargeFailure=true;},setSupportFailure(error:Error|null){supportFailure=error;},setSupportBefore(work:(()=>Promise<void>)|null){supportBefore=work;},setSupportUnavailable(reason:string|undefined){config.supportUnavailable=reason;},setControlFailure(error:Error|null){controlFailure=error;},setHttpCooldown(until:number){httpCooldown=until;},setControlCooldown(until:number){controlCooldown=until;}};
}


export {setup,retained,tx,signature,scope,coder,clone,settle};
