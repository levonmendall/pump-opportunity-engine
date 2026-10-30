import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {ActivePipeline} from '../src/active-pipeline.js';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';

const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8'));
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:raw.transaction.slot,supportedPoolEvidence:'retained actual transaction; isolated availability regression'};
const base=Math.ceil(Date.parse(raw.fetchedAt)/10_000)*10_000;
const payload={pool:'pump-amm',poolId:scope.pool,mint:scope.mint,signature:raw.signature,action:'sell'};
function fixture(preparationDelayMs=0,onNormalized?:(p:ActivePipeline,at:number)=>void){
  let at=base;
  const records:Array<{kind:string;data:any}>=[];
  const pipeline=new ActivePipeline({scope,now:()=>at,record:(kind,data)=>{
    records.push({kind,data});
    if(kind==='research-enrichment-validation-prepared'){
      // A synchronous recorder can block without yielding to the event loop.
      // It must still see zero new flow until validation commits atomically.
      assert.equal(pipeline.snapshot(at).normalizedEvents,0);at+=preparationDelayMs;
    }
    if(kind==='research-normalized-trade')onNormalized?.(pipeline,at);
  }});
  pipeline.open(at);at=base+100;pipeline.observe(payload,at);at=base+1100;
  const hint=pipeline.nextHint(at)!;
  return {pipeline,hint,records,set:(next:number)=>{at=next;},get now(){return at;}};
}

test('blocking validation preparation delays feature availability without changing executed evidence or amounts',()=>{
  const f=fixture(350);f.set(base+1500);
  const rows=f.pipeline.completeHint(f.hint,raw.transaction,base+1500);
  assert.equal(rows.length,1);
  const n=f.records.find(x=>x.kind==='research-normalized-trade')!.data;
  assert.equal(n.rpcAvailableAt,base+1500);assert.equal(n.validationCompletedAt,base+1850);assert.equal(n.at,base+1850);
  assert.equal(n.executedEvidence.availableAt,base+1500);
  assert.equal(n.curve.trade.receivedAt,base+1850);assert.equal(n.user.trade.receivedAt,base+1850);
  assert.equal(n.curve.trade.quoteLamports,'1481514');assert.equal(n.user.trade.quoteLamports,'1462993');
  assert.equal(n.curve.trade.wallet,'BwJigd5taT26gAhNcv1DMrC7epkedHBjcgbWVbEMP8Q');
  const original=mapConfirmedPumpSwapEvidence(raw.transaction,{...scope,signature:raw.signature,providerReceivedAt:base+100,availableAt:base+1500})[0]!;
  assert.deepEqual(rows[0],original);assert.deepEqual(n.curve.trade.identity,{signature:raw.signature,instructionIndex:2,eventIndex:5});
  const s=f.pipeline.snapshot(f.now);assert.equal(s.firstNormalizedAt,base+1850);assert.equal(s.enrichmentAvailableAfterHintMs.maximum,1750);assert.equal(s.noPendingFeatureWarmSeconds,0);
  assert.ok(s.featureRows.every(r=>r.at>=base+1850||r.curve.tradeCount===0));
});

test('RPC receipt before the five-second deadline cannot rescue normalization completed after it',()=>{
  const f=fixture(350);f.set(base+4800);
  assert.deepEqual(f.pipeline.completeHint(f.hint,raw.transaction,base+4800),[]);
  const s=f.pipeline.snapshot(f.now);assert.equal(f.now,base+5150);assert.equal(s.normalizedEvents,0);assert.equal(s.executedEvidence.length,0);assert.equal(s.pending,0);
  assert.equal(s.failedTransactions,1);assert.equal(s.historicalWindowInvalidated,true);assert.equal(s.qualityGaps.at(-1)!.reason,'selected-enrichment-validation-too-late');
  assert.equal(f.records.filter(x=>x.kind==='research-normalized-trade').length,0);
});

test('the actual clock controls availability even when the caller supplies an earlier RPC receipt',()=>{
  const f=fixture();f.set(base+1900);f.pipeline.completeHint(f.hint,raw.transaction,base+1500);
  const n=f.records.find(x=>x.kind==='research-normalized-trade')!.data;assert.equal(n.curve.trade.receivedAt,base+1900);assert.equal(n.executedEvidence.availableAt,base+1500);
});

function twoSwaps(badSecond=false){
  const tx=structuredClone(raw.transaction),source=tx.meta.innerInstructions.find((g:any)=>g.index===2),index=tx.transaction.message.instructions.length;
  assert.ok(source);tx.transaction.message.instructions.push(structuredClone(tx.transaction.message.instructions[2]));
  const second=structuredClone(source);second.index=index;
  if(badSecond){const transfer=second.instructions[1],encoded=Buffer.from(bs58.decode(transfer.data));encoded.writeBigUInt64LE(encoded.readBigUInt64LE(1)+1n,1);transfer.data=bs58.encode(encoded);}
  tx.meta.innerInstructions.push(second);return tx;
}

test('all synthetic multi-swap rows validate before any row enters feature windows',()=>{
  const tx=twoSwaps(true),mapped=mapConfirmedPumpSwapEvidence(tx,{...scope,signature:raw.signature,providerReceivedAt:base+100,availableAt:base+1500});
  assert.equal(mapped.length,2);assert.equal(mapped[0]!.transferChecks.baseTransfer,true);assert.equal(mapped[1]!.transferChecks.baseTransfer,false);
  const f=fixture();f.set(base+1500);assert.deepEqual(f.pipeline.completeHint(f.hint,tx,base+1500),[]);
  const s=f.pipeline.snapshot(f.now);assert.equal(s.normalizedEvents,0);assert.equal(s.executedEvidence.length,0);assert.equal(s.historicalWindowInvalidated,true);assert.equal(f.records.filter(x=>x.kind==='research-normalized-trade').length,0);
});

test('recorder callbacks cannot observe a half-ingested synthetic multi-swap transaction',()=>{
  const f=fixture(250,(pipeline,at)=>{assert.equal(pipeline.snapshot(at).normalizedEvents,2);});f.set(base+1500);
  assert.equal(f.pipeline.completeHint(f.hint,twoSwaps(),base+1500).length,2);
  const n=f.records.filter(x=>x.kind==='research-normalized-trade');assert.equal(n.length,2);assert.ok(n.every(x=>x.data.curve.trade.receivedAt===base+1750));
  const s=f.pipeline.snapshot(f.now);assert.equal(s.multipleSwapTransactions,1);assert.equal(s.normalizedSells,2);
});
