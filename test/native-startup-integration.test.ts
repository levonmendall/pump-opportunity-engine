import {wsWire} from './ws-wire-fixture.js';
/** Retained source60b9392 pool/creation bytes with synthetic provider responses,
 * advancing wall clock, real SDK validation, real shared gate and real native
 * adapter. This reproduces startup scheduling; it is not another market test. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {PilotRpc} from '../src/pilot-rpc.js';
import {PilotNativeFlow} from '../src/pilot-native-flow.js';
import {NativeCandidateRunner} from '../src/native-candidate-runner.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
const captured=JSON.parse(readFileSync('evidence/native-startup-20261028/retained-six-pool-startup.json','utf8'));
class Socket extends EventEmitter{
 readonly _receiver={writableLength:0,_state:0,_bufferedBytes:0,_fragmented:0};
 readonly _socket=Object.assign(new EventEmitter(),{bytesRead:200});readonly _sender={sendFrame:(_parts:Buffer[],cb?:()=>void)=>cb?.()};readyState:number=WebSocket.CONNECTING;readonly sent:any[]=[];
 open(){this.readyState=WebSocket.OPEN;this.emit('open');}
 frame(body:unknown){const raw=Buffer.from(JSON.stringify(body));this._socket.bytesRead+=raw.length+4;this._socket.emit('data',wsWire(raw));this.emit('message',raw);}
 send(data:string,callback?:(error?:Error)=>void){const row=JSON.parse(data);this.sent.push(row);callback?.();queueMicrotask(()=>this.frame({jsonrpc:'2.0',id:row.id,result:row.method==='logsSubscribe'?100+this.sent.length:true}));}
 ping(payload:Buffer,_mask?:unknown,callback?:(error?:Error)=>void){this._sender.sendFrame([Buffer.from([0x89]),payload]);callback?.();queueMicrotask(()=>{this._socket.bytesRead+=payload.length+2;this._socket.emit('data',wsWire(payload,10));this.emit('pong',payload);});}
 pong(payload:Buffer,_mask?:unknown,callback?:(error?:Error)=>void){this._sender.sendFrame([Buffer.from([0x8a]),payload]);callback?.();}
 terminate(){if(this.readyState===WebSocket.CLOSED)return;this.readyState=WebSocket.CLOSED;queueMicrotask(()=>this.emit('close',1006));}
 close(){this._sender.sendFrame([Buffer.from([0x88])]);this.readyState=WebSocket.CLOSED;queueMicrotask(()=>this.emit('close',1000));}
}
test('retained six-pool startup subscribes before missing-origin work under an advancing clock and the real250ms shared gate',async()=>{
 let at=Date.parse(captured.poolState.receivedAt),mono=0,sequence=0,resolveCalls=0,maxInFlight=0;const start=at,realNow=Date.now;
 const clock=()=>{const value=at;at++;mono++;return value;},advance=(ms:number)=>{at+=ms;mono+=ms;};
 const directory=mkdtempSync(join(tmpdir(),'poe-native-startup-')),baseline=join(directory,'legacy.json'),records:Array<{kind:string;data:any}>=[],sockets:Socket[]=[],timers=new Map<number,()=>void>(),fetches:any[]=[];
 //20 inherited recent starts initially constrain the SAME rolling gate. Their
 // timestamps remain untouched; no separate provider budget is introduced.
 writeFileSync(baseline,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:20,bytes:272634,lastObservedAt:start-300,starts:Array.from({length:20},(_,i)=>start-400+i),pending:[]}),{mode:0o600});
 const originalBook=readFileSync(baseline),map=new Map(captured.poolState.addresses.map((key:string,index:number)=>[key,captured.poolState.value[index]]));
 const record=(kind:string,data:unknown)=>{records.push({kind,data:structuredClone(data)});advance(1);};
 let rpc:PilotRpc|undefined,native:PilotNativeFlow|undefined,runner:NativeCandidateRunner|undefined,support:ResearchClockPositionPricer|undefined;
 Date.now=clock;
 try{
  rpc=new PilotRpc({directory:join(directory,'rpc'),runId:'native-startup-replay',baselinePaths:[baseline],priorPhysicalSettled:true,priorCooldownUntil:0,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,now:clock,monotonic:()=>mono,sleep:async ms=>advance(ms),record,fetcher:(async(_url,init)=>{const call=JSON.parse(String(init?.body));assert.equal(call.method,'getMultipleAccounts');maxInFlight=Math.max(maxInFlight,rpc!.usage().inFlight);fetches.push({method:call.method,at,addresses:call.params[0]});advance(80);const value=(call.params[0] as string[]).map(key=>{assert.ok(map.has(key),key);return structuredClone(map.get(key));});return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result:{context:captured.poolState.context,value}}));}) as typeof fetch});
  const watch=new PilotWatch({maximumIdentities:174,maximumOlderResearch:24,maximumDeep:6,now:clock,record}),missingMint=new PublicKey(Buffer.alloc(32,91)).toBase58(),missingSignature=bs58.encode(Buffer.alloc(64,92));watch.discover({signature:missingSignature,feedMint:missingMint,receivedAt:start-600000});watch.verify(missingSignature,{mint:missingMint,pool:canonicalPumpPoolPda(new PublicKey(missingMint)).toBase58(),migrationAt:start-600000,verifiedAt:start-1000});
  support=new ResearchClockPositionPricer(rpc,{record});native=new PilotNativeFlow({control:rpc,support,record,maximumCandidates:6,durationMs:60000,onFlowOpen:row=>runner!.onFlowOpen(row),onTrade:()=>runner!.onTrade(),onGap:row=>runner!.onGap(row)},{now:clock,monotonic:()=>mono,setTimer(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimer(id){timers.delete(Number(id));},makeSocket(){const socket=new Socket();sockets.push(socket);queueMicrotask(()=>socket.open());return socket as unknown as WebSocket;}});
  runner=new NativeCandidateRunner({rpc,flow:native,record,now:clock,maximumDeep:6,restoredWatch:watch.export(),resolve:async()=>{resolveCalls++;return {ok:false,reason:'PILOT_MIGRATION_LOOKUP_UNAVAILABLE'};}});
  for(const origin of captured.origins)runner.importOrigin(origin);
  for(const scope of captured.support)runner.onActivity({mint:scope.mint,at:clock(),evidence:'SYNTHETIC_FRESH_WATCH_HINT_FOR_RETAINED_SCOPE'});
  for(let i=0;i<400;i++){await runner.step();if(runner.status().candidates.every(c=>c.openedAt!==null)&&runner.status().candidates.length===6)break;advance(50);}
  const scopes=runner.status().candidates;assert.equal(scopes.length,6,JSON.stringify({at,start,status:runner.status(),last:records.slice(-10)},null,0));assert.ok(scopes.every(c=>c.openedAt!==null),'all actual native ACKs must precede lower-priority origin preparation');assert.equal(resolveCalls,0);assert.equal(sockets.length,1);assert.equal(sockets[0]!.sent.filter(s=>s.method==='logsSubscribe').length,6);assert.equal(fetches.length,1,'verified creation dependency hints avoid the discovery read; one fresh union support validation remains required');assert.deepEqual(new Set(fetches[0].addresses),new Set(captured.poolState.addresses),'the one physical read contains every pool, mint, vault, fee/config and Clock dependency');assert.equal(support.usage().dependencyHints.freshValidatedPools,6);assert.equal(support.usage().dependencyHints.discoveryRequestsAvoided,1);assert.equal(records.filter(r=>r.kind==='research-clock-observation-support').length,6);assert.equal(records.filter(r=>r.kind==='native-origin-verification-service-preparation').length,0);assert.ok(records.some(r=>r.kind==='native-candidate-work-unavailable')||rpc.usage().chapter>=1);assert.equal(rpc.usage().fatal,null);assert.equal(maxInFlight,1);assert.ok(rpc.usage().chapterUsage!.actualInvocations.every((v,i,all)=>i===0||v.at-all[i-1]!.at>=250));assert.ok(at-start<30000,'setup finishes before replayed source state expires');
 }finally{await runner?.stop('offline startup fixture ended');rpc?.close();Date.now=realNow;assert.deepEqual(readFileSync(baseline),originalBook);rmSync(directory,{recursive:true,force:true});}
});
