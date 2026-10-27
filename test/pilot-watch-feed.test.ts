/** Isolated synthetic transport/capacity mechanics; no network or market claims. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import bs58 from 'bs58';
import WebSocket from 'ws';
import {PublicKey} from '@solana/web3.js';
import {PilotFeeds,type PilotFeedsOptions,type PilotFeedControl} from '../src/pilot-feeds.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {DisposableLedger} from '../src/ledger.js';
import {PaperTrader,type TraderOptions} from '../src/trader.js';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';

const scope=(n:number)=>{const bytes=Buffer.alloc(32);bytes.writeUInt32LE(n,0);const mint=new PublicKey(bytes);return {mint:mint.toBase58(),pool:canonicalPumpPoolPda(mint).toBase58(),baseUnits:'1',minSlot:1,supportedPoolEvidence:'SYNTHETIC capacity identity only'};};
const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
class Socket extends EventEmitter{
 _socket=Object.assign(new EventEmitter(),{bytesRead:200});closed=false;
 frame(payload:unknown){if(this.closed)return;const b=Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload));this._socket.bytesRead+=b.length+4;this._socket.emit('data',b);this.emit('message',b);}
 send(_data:string,callback?:(e?:Error)=>void){callback?.();queueMicrotask(()=>this.frame({message:"Subscribed to 'migration' events."}));}
 terminate(){if(this.closed)return;this.closed=true;queueMicrotask(()=>this.emit('close'));}
}
function fixture(options:Partial<PilotFeedsOptions>={}){
 let at=100000,mono=0;const sockets:Socket[]=[],records:Array<{kind:string;data:any}>=[],hints:any[]=[],trades:any[]=[],gaps:any[]=[];
 const control:PilotFeedControl={async operateData(_kind,work,signal){return await work({id:1,signal:signal??new AbortController().signal,chargeHttp(){},completeResponse(){}});},accountControlBytes(){},noteThrottle(){return at+15000;}};
 const feeds=new PilotFeeds({control,amountConvention:'curve',record:(kind,data)=>records.push({kind,data}),onMigration(){},onTrade:r=>trades.push(r),onGap:g=>gaps.push(g),onWatchActivity:r=>hints.push(r),...options},{now:()=>at,monotonic:()=>mono,setTimer:()=>1,clearTimer(){},makeSocket(){const socket=new Socket();sockets.push(socket);queueMicrotask(()=>socket.emit('open'));return socket as unknown as WebSocket;}});
 return {feeds,sockets,records,hints,trades,gaps,advance(ms:number){at+=ms;mono+=ms;}};
}

test('bounded deep stages3/6/12 and experimental20 share one data socket and preserve aggregate16',async()=>{
 for(const count of [3,6,12,20]){const f=fixture({maximumCandidates:count});for(let n=1;n<=count;n++)await f.feeds.addCandidate(scope(n));assert.equal(f.sockets.length,1);assert.equal(f.feeds.usage().maximumCandidates,count);assert.equal(Object.keys(f.feeds.snapshots()).length,count);await assert.rejects(f.feeds.addCandidate(scope(count+1)),/CANDIDATE_CAPACITY/);
  for(let n=1;n<=16;n++){const s=scope((n-1)%count+1);f.sockets[0]!.frame({mint:s.mint,poolId:s.pool,signature:signature(n),action:'buy',pool:'pump-amm'});}const extra=scope(count);f.sockets[0]!.frame({mint:extra.mint,poolId:extra.pool,signature:signature(77),action:'buy',pool:'pump-amm'});assert.ok(f.feeds.usage().candidates.reduce((n,c)=>n+c.pending,0)<=16);assert.ok(f.gaps.some(g=>g.reason==='PILOT_AGGREGATE_ENRICHMENT_CAPACITY'));await f.feeds.stop();
 }
 for(const count of [0,21,1.5,Infinity])assert.throws(()=>fixture({maximumCandidates:count}),/INVALID_LIMITS/);
});

test('watch activity remains unverified coalesced selection evidence without trade ingestion or persistence',async()=>{
 const deep=scope(1),watch=scope(200),f=fixture({watchedIdentities:()=>[watch]});await f.feeds.addCandidate(deep);const socket=f.sockets[0]!;
 const p={mint:watch.mint,poolId:watch.pool,signature:signature(1),action:'buy',quoteAmount:999999999,txSigner:'untrusted'};
 socket.frame(p);socket.frame({...p,signature:signature(2)});assert.equal(f.hints.length,1);assert.equal(f.hints[0].evidence,'unverified-pumpapi-activity-hint');assert.equal(Object.hasOwn(f.hints[0],'quoteAmount'),false);assert.equal(f.trades.length,0);assert.equal(f.feeds.peekHint(),null);assert.equal(f.feeds.snapshot(deep.mint)!.failedCandidate,false);assert.equal(f.records.filter(r=>r.kind==='pilot-selected-pumpapi-payload').length,0,'watch payloads are not archived');
 f.advance(10000);socket.frame(p);assert.equal(f.hints.length,1,'the same latest signature is not a fresh activity change');socket.frame({...p,signature:signature(3)});assert.equal(f.hints.length,2);socket.frame({...p,poolId:scope(999).pool,signature:signature(4)});assert.equal(f.hints.length,2);f.advance(10000);socket.frame({...p,signature:null});assert.equal(f.hints.length,2);socket.frame(JSON.stringify({metadata:p}));assert.equal(f.hints.length,2,'nested metadata cannot impersonate top-level activity');socket.frame('malformed '+JSON.stringify(p));assert.equal(f.feeds.snapshot(deep.mint)!.failedCandidate,false,'watch decode loss does not corrupt a separate deep scope');
 await f.feeds.removeCandidate(deep.mint);assert.equal(socket.closed,true);f.advance(10000);assert.equal(f.sockets.length,1,'watch alone does not open another broad stream');await f.feeds.stop();
});

test('bounded150 identity watch lookup avoids broad JSON parsing and reports measured offline work',async t=>{
 const watched=Array.from({length:150},(_,i)=>scope(i+200)),deep=scope(1),f=fixture({watchedIdentities:()=>watched});await f.feeds.addCandidate(deep);const socket=f.sockets[0]!,payload={mint:scope(999).mint,poolId:scope(999).pool,signature:signature(1),metadata:'x'.repeat(2000)};
 for(let i=0;i<5000;i++)socket.frame(payload);socket.frame({mint:watched[149]!.mint,poolId:watched[149]!.pool,signature:signature(2)});const usage=f.feeds.usage();assert.equal(usage.watchActivity.knownIdentities,150);assert.equal(usage.watchActivity.framesExamined,5001);assert.equal(usage.watchActivity.matchedPayloadParses,1);assert.equal(usage.watchActivity.hints,1);assert.equal(usage.parsedPumpApiFrames,0);assert.equal(usage.watchActivity.failures,0);assert.ok(Number.isFinite(usage.watchActivity.processingMs));t.diagnostic(JSON.stringify({classification:'OFFLINE_SYNTHETIC_WATCH_DECODING',watchIdentities:150,frames:5001,receivedBytes:usage.pumpApiSocketBytes,watchProcessingMs:usage.watchActivity.processingMs,entireBroadPayloadsRetained:0}));await f.feeds.stop();
});

test('watch callback failure is counted without disabling valid deep observation',async()=>{
 const watch=scope(200),f=fixture({watchedIdentities:()=>[watch],onWatchActivity(){throw Error('fixture unavailable watch recorder');}});await f.feeds.addCandidate(scope(1));f.sockets[0]!.frame({mint:watch.mint,poolId:watch.pool,signature:signature(1)});assert.equal(f.feeds.usage().watchActivity.failures,1);assert.equal(f.feeds.snapshot()!.failedCandidate,false);await f.feeds.stop();
});

test('trader deep capacity is immutable caller configuration independent of financial state',t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-deep-cap-')),ledger=new DisposableLedger(join(directory,'fixture.sqlite'),'fixture-deep-capacity');ledger.initialize({microUsdPerSol:'100000000',at:100000,source:'SYNTHETIC USD'},100000);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const base:TraderOptions={ledger,now:()=>100000,context:async()=>({price:null,marks:{}}),quote:async()=>null,recorder:{record(){}},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'SYNTHETIC capacity fixture'}};const before=ledger.state();
 for(const count of [3,6,12,20]){const options={...base,maximumCandidates:count},trader=new PaperTrader(options);options.maximumCandidates=20;for(let i=0;i<count;i++)assert.equal(trader.admit({mint:'fixture-'+i,migrationAt:0,migrationVerified:true,supportedPool:true,evidence:'SYNTHETIC verified identity'}),true);assert.equal(trader.admit({mint:'fixture-overflow',migrationAt:0,migrationVerified:true,supportedPool:true,evidence:'SYNTHETIC verified identity'}),false);assert.deepEqual(ledger.state(),before);trader.remove('fixture-0');assert.equal(trader.admit({mint:'fixture-replacement',migrationAt:0,migrationVerified:true,supportedPool:true,evidence:'SYNTHETIC verified identity'}),true);}
 for(const count of [0,21,1.5,NaN])assert.throws(()=>new PaperTrader({...base,maximumCandidates:count}),/deep candidate capacity/);
});

test('synthetic ownership projection keeps held/pending records separate and prunes only closed traded market state',()=>{
 const owned={positions:{} as Record<string,any>,pending:{} as Record<string,any>},traded=new Set<string>();
 // Pure admission-policy fixture, never a financial ledger or lifecycle claim.
 const ledger={state:()=>owned,hasTradedMint:(mint:string)=>traded.has(mint)} as unknown as import('../src/ledger.js').PaperLedger;
 const trader=new PaperTrader({ledger,maximumCandidates:3,now:()=>100000,context:async()=>({price:null,marks:{}}),quote:async()=>null,recorder:{record(){}},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'SYNTHETIC admission policy only'}}),admit=(mint:string)=>trader.admit({mint,migrationAt:0,migrationVerified:true,supportedPool:true,evidence:'SYNTHETIC verified identity'});
 assert.equal(admit('held'),true);owned.positions.held={mint:'held'};traded.add('held');for(let i=0;i<3;i++)assert.equal(admit('deep-'+i),true);assert.equal(admit('overflow'),false);assert.throws(()=>trader.remove('held'),/held\/pending/);
 delete owned.positions.held;owned.pending.exit={mint:'held',side:'sell'};assert.equal(admit('overflow'),false);assert.doesNotThrow(()=>trader.setCandidateInformationPending('held',true),'pending ownership survives pruning');
 delete owned.pending.exit;trader.remove('deep-0');assert.equal(admit('replacement'),true);assert.throws(()=>trader.setCandidateInformationPending('held',true),/admitted candidate/);assert.equal(traded.has('held'),true,'closed financial history was never changed');
});


test('deferred unowned pilot preparation releases deposit capacity without deleting candidate or owned obligations',()=>{
 const state={mode:'PAPER',accountId:'poe-pilot-fixture-deposit-cleanup',positions:{} as Record<string,any>,pending:{} as Record<string,any>},ledger={state:()=>state,hasTradedMint:()=>false} as unknown as import('../src/ledger.js').PaperLedger;
 // Policy-only projection: no financial actions or initialized account exists.
 const trader=new PaperTrader({ledger,maximumCandidates:3,now:()=>100000,context:async()=>({price:null,marks:{}}),quote:async()=>null,pilotExecution:{context:async()=>({price:null,marks:{}}),quote:async()=>null},experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},flowVerification:{verified:true,evidence:'SYNTHETIC verified flow contract'},recorder:{record(){}},costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'SYNTHETIC deposit cleanup'}});
 for(let i=0;i<6;i++)trader.setPilotEntryDeposit('2000000','SYNTHETIC prepared rent','fixture-'+i);
 assert.throws(()=>trader.setPilotEntryDeposit('2000000','SYNTHETIC overflow','fixture-overflow'),/deposit capacity/);
 assert.equal(trader.admit({mint:'fixture-0',migrationAt:0,migrationVerified:true,supportedPool:true,evidence:'SYNTHETIC identity'}),true);assert.equal(trader.clearPilotEntryDeposit('fixture-0'),true);assert.doesNotThrow(()=>trader.setCandidateInformationPending('fixture-0',true),'clearing rent does not delete the candidate');assert.doesNotThrow(()=>trader.setPilotEntryDeposit('2000000','SYNTHETIC reused capacity','fixture-overflow'));assert.equal(trader.clearPilotEntryDeposit('fixture-0'),false);
 state.positions['fixture-1']={mint:'fixture-1'};assert.throws(()=>trader.clearPilotEntryDeposit('fixture-1'),/held\/pending/);delete state.positions['fixture-1'];state.pending.buy={mint:'fixture-1',side:'buy'};assert.throws(()=>trader.clearPilotEntryDeposit('fixture-1'),/held\/pending/);state.pending.exit={mint:'fixture-2',side:'sell'};assert.throws(()=>trader.clearPilotEntryDeposit('fixture-2'),/held\/pending/);assert.equal(Object.keys(state.pending).length,2,'pending obligations preserved');
});
