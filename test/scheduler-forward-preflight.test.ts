import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preflightSchedulerForward} from '../src/scheduler-forward-preflight.js';
const raw=JSON.parse(readFileSync('evidence/targeted-transaction-sample.json','utf8')),tx=raw.transaction;
const scope={mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD',baseUnits:'138353716808147',minSlot:tx.slot,supportedPoolEvidence:'historical seed only'};
const at=tx.blockTime*1000+10000,row={signature:raw.signature,slot:tx.slot,err:null,blockTime:tx.blockTime};
async function run(history:any[],transactions:any[]=[tx]){let calls=0;const methods:string[]=[];const rpc={async call<T>(method:string){methods.push(method);calls++;return (method==='getSignaturesForAddress'?history:transactions.shift()) as T;}};try{return {result:await preflightSchedulerForward({scope,rpc,signal:new AbortController().signal,record(){},now:()=>at}),calls,methods};}catch(error){return {error,calls,methods};}}
test('one independently verified actual swap passes without treating old accounts as current support',async()=>{
  const r=await run([row,{...row,signature:'older',blockTime:tx.blockTime-100}]);assert.equal(r.calls,2);assert.ok(r.result);assert.equal(r.result.currentPoolAccounts,'REQUIRES_FRESH_PREWARM');assert.equal(r.result.verifiedSwap.trades.length,1);assert.equal(r.result.history.expectedEnrichmentUpperBound,1);
});
test('quiet, saturated/short and over-capacity subjects refuse without a transaction search or stream',async()=>{
  for(const history of [[{...row,blockTime:tx.blockTime-100}],Array.from({length:50},(_,i)=>({...row,signature:String(i)})),[...Array.from({length:11},(_,i)=>({...row,signature:String(i)})),{...row,signature:'old',blockTime:tx.blockTime-100}]]){
    const r=await run(history);assert.ok(r.error);assert.equal(r.calls,1);assert.deepEqual(r.methods,['getSignaturesForAddress']);
  }
});
test('pool-address success cannot pass as a swap; null or unknown time fails with no retry',async()=>{
  const missing=await run([{...row,blockTime:null}]);assert.equal(missing.calls,1);assert.ok(missing.error);
  const nullTx=await run([row,{...row,signature:'old',blockTime:tx.blockTime-100}],[null]);assert.equal(nullTx.calls,2);assert.match(String(nullTx.error),/CONTEXT_UNKNOWN/);
});
test('post-decoding storage time cannot make a five-second preflight pass and unordered history is refused',async()=>{
  let clock=at,calls=0;const rpc={async call<T>(method:string){calls++;return (method==='getSignaturesForAddress'?[row,{...row,signature:'old',blockTime:tx.blockTime-100}]:tx) as T;}};
  await assert.rejects(preflightSchedulerForward({scope,rpc,signal:new AbortController().signal,now:()=>clock,record(kind){if(kind==='forward-preflight-passed')clock+=5000;}}),/ELAPSED_CAP/);assert.equal(calls,2);
  const bad=await run([row,{...row,signature:'later-slot',slot:row.slot+1,blockTime:tx.blockTime-100}]);assert.equal(bad.calls,1);assert.ok(bad.error);
});
