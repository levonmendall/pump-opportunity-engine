import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mapConfirmedPumpSwapEvidence} from '../src/pumpapi-mapping.js';
import {selectActivePool} from '../src/active-selection.js';
const root='evidence/free-data-20261027';
const record=readFileSync(root+'/active-approved-record.ndjson','utf8').trim().split('\n').map(x=>JSON.parse(x));
const analysis=JSON.parse(readFileSync(root+'/active-approved-analysis.json','utf8'));

test('current actual v1 CPI-invoked Sell preserves executed amounts and real inner identity',()=>{
  const raw=record.find(r=>r.kind==='selection-transaction'&&r.data.signature===analysis.actual[0].signature)!.data;
  const mapped=mapConfirmedPumpSwapEvidence(raw.transaction,{...analysis.scope,signature:raw.signature,providerReceivedAt:null,availableAt:raw.availableAt});
  assert.equal(raw.transaction.version,1);assert.equal(mapped.length,1);const e=mapped[0]!;
  assert.equal(e.side,'sell');assert.equal(e.tokenUnits,'178680009681');assert.equal(e.curveQuoteLamports,'297140024');assert.equal(e.userQuoteLamports,'293722911');
  assert.equal(e.identity.outerInstructionIndex,3);assert.equal(e.identity.swapInnerInstructionIndex,1);assert.equal(e.identity.eventInnerInstructionIndex,7);assert.deepEqual(e.transferChecks,{baseTransfer:true,userQuoteTransfer:true});
  assert.equal(e.availableAt,raw.availableAt);assert.equal(e.providerReceivedAt,null);assert.equal(e.normalizedForStrategy,false);
});
test('actual burst-truncated activity refuses the stream before support pricing',async()=>{
  const program=record.find(r=>r.kind==='selection-program-signatures')!.data;
  const history=record.find(r=>r.kind==='selection-pool-signatures')!.data;
  const transactions=new Map(record.filter(r=>r.kind==='selection-transaction').map(r=>[r.data.signature,r.data.transaction]));
  let calls=0,quoteCalls=0;
  const result=await selectActivePool({now:()=>program.queriedAt,rpc:{async call<T>(method:string,params:unknown[]=[]){calls++;if(method==='getSignaturesForAddress')return ((params[0]===analysis.scope.pool)?history.rows:program.rows) as T;if(method==='getTransaction'){const value=transactions.get(params[0]);assert.ok(value);return value as T;}throw Error('unexpected method');}},quote:async()=>{quoteCalls++;throw Error('truncated preflight cannot price or connect');}});
  assert.equal(result.ok,false);assert.equal(result.ok?null:result.reason,'POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN');assert.equal(calls,6);assert.equal(quoteCalls,0);
});
