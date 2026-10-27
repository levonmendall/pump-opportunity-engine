import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import WebSocket from 'ws';
import bs58 from 'bs58';
import {capture,auditPool} from '../scripts/active-pumpapi-trial.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import type {ResearchRpc} from '../src/research-rpc.js';
import type {ActiveCandidate} from '../src/active-selection.js';

const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const candidate={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:raw.transaction.slot,supportedPoolEvidence:'OFFLINE retained canonical migration proof',entryEligibility:'UNVERIFIED_HELD_PRICING_ONLY',migrationAgeVerified:false} as ActiveCandidate;
const selected={pool:'pump-amm',poolId:candidate.pool,mint:candidate.mint,signature:raw.signature,action:'sell',tokenAmount:123.456,breakdown:[{trader:'UNTRUSTED_PROVIDER_CLAIM'}]};
class FakeSocket extends EventEmitter{
  _socket={bytesRead:1000};private done=false;
  constructor(closeAfter=1350){super();setTimeout(()=>this.emit('open'),0);setTimeout(()=>{this._socket.bytesRead+=2000;this.emit('message',Buffer.from(JSON.stringify(selected)));},20);setTimeout(()=>this.terminate(),closeAfter);}
  terminate(){if(this.done)return;this.done=true;queueMicrotask(()=>this.emit('close'));}
}
const price=(async()=>({mint:candidate.mint,pool:candidate.pool,slot:candidate.minSlot,commitment:'confirmed',receivedAt:new Date().toISOString(),marketBlockTime:Math.floor(Date.now()/1000),sell:{inputBaseUnits:candidate.baseUnits,outputLamports:'1000000'}})) as any;

test('combined runner retains selected raw fields and enriches at actual completion without a network connection',{timeout:5000},async()=>{
  const rows:Array<{kind:string;data:any}>=[];let calls=0;
  const rpc={get calls(){return calls;},inFlight:0,async call(){calls++;return raw.transaction;}} as unknown as ResearchRpc;
  const result=await capture(candidate,rpc,(kind,data)=>rows.push({kind,data}),new AbortController().signal,()=>{}, {makeSocket:()=>new FakeSocket() as unknown as WebSocket,quote:price});
  assert.equal(calls,1);assert.equal(result.normalizedEvents,1);assert.equal(result.physicalSlotUncertain,false);assert.equal(result.enrichments,1);
  const payload=rows.find(r=>r.kind==='selected-pumpapi-payload')!,enrichment=rows.find(r=>r.kind==='confirmed-enrichment')!,trade=rows.find(r=>r.kind==='research-normalized-trade')!;
  assert.deepEqual(JSON.parse(payload.data.payloadUtf8),selected);assert.equal(trade.data.curve.trade.receivedAt,enrichment.data.availableAt);assert.ok(enrichment.data.requestedAt>=enrichment.data.hint.receivedAt+1000);assert.equal(result.stopReason,'UNEXPECTED_SOURCE_CLOSE');
});
test('shutdown aborts an in-flight enrichment within the reserve and observes its settlement before returning',{timeout:8000},async()=>{
  let active=0,settled=false,calls=0;
  const rpc={get calls(){return calls;},get inFlight(){return active;},call(_method:string,_params:unknown,signal:AbortSignal){calls++;active++;return new Promise((_r,reject)=>signal.addEventListener('abort',()=>{active--;settled=true;reject(Error('RESEARCH_RPC_ABORTED'));},{once:true}));}} as unknown as ResearchRpc;
  const result=await capture(candidate,rpc,()=>{},new AbortController().signal,()=>{}, {makeSocket:()=>new FakeSocket() as unknown as WebSocket,quote:price});
  assert.equal(calls,1);assert.equal(settled,true);assert.equal(active,0);assert.equal(result.physicalSlotUncertain,false);assert.equal(result.pending,0);assert.ok(result.failedTransactions>=1);
});
test('available finalized event corrections invalidate a previously matched interior audit',async()=>{
  const tx=raw.transaction,at=Date.now(),evidence=mapConfirmedPumpSwapEvidence(tx,{...candidate,signature:raw.signature,providerReceivedAt:null,availableAt:at});
  const changed=structuredClone(tx),ix=changed.meta.innerInstructions[0].instructions[1],b=Buffer.from(bs58.decode(ix.data));b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);ix.data=bs58.encode(b);
  let calls=0;const rpc={get calls(){return calls;},async call(method:string){calls++;return method==='getSignaturesForAddress'?[{signature:raw.signature,slot:tx.slot,err:null,blockTime:tx.blockTime},{signature:'old',err:null,blockTime:tx.blockTime-100}]:changed;}} as unknown as ResearchRpc;
  const result=await auditPool(candidate,{openedAt:(tx.blockTime-5)*1000,endedAt:(tx.blockTime+80)*1000,enrichmentTransactions:{[raw.signature]:tx},executedEvidence:evidence,featureRows:[],qualityGaps:[]},rpc,()=>{},new AbortController().signal);
  assert.equal(result.matchedEvents,1);assert.equal(result.complete,false);assert.ok(result.unsupported.some((x:any)=>x.reason==='FINALIZED_EXECUTED_CONTENT_CHANGED'));assert.equal(result.rechecks[0].executedEvidenceIdentical,false);
});
