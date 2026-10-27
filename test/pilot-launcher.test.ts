import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertPilotDirectory,validatePilotHistory,nextPreparedPilotSeed} from '../src/pilot.js';

test('pilot launcher rejects production, shared-secret and repository storage before access',()=>{
  for(const path of ['/var/lib/poe','/opt/poe','/workspace/shared/poe-secrets','/workspace/pump-opportunity-engine/data/pilot'])assert.throws(()=>assertPilotDirectory(path),/PILOT_ISOLATED/);
});
test('independent history cannot silently omit or change an enriched trade',()=>{
  const known=new Map([['known',{slot:100,chainBlockTime:10}]]);
  const row={signature:'known',slot:100,blockTime:10,err:null,confirmationStatus:'confirmed'};
  assert.deepEqual(validatePilotHistory([row],known,9000,11000),[]);
  assert.throws(()=>validatePilotHistory([],known,9000,11000),/OMITTED/);
  assert.throws(()=>validatePilotHistory([{...row,slot:99}],known,9000,11000),/CHANGED/);
  assert.throws(()=>validatePilotHistory([{...row,blockTime:null}],known,9000,11000),/INVALID/);
  const {err:_err,...withoutErr}=row;assert.throws(()=>validatePilotHistory([withoutErr as typeof row],known,9000,11000),/INVALID/);
  assert.throws(()=>validatePilotHistory([row,row],known,9000,11000),/DUPLICATE/);
  assert.throws(()=>validatePilotHistory([{...row,confirmationStatus:'processed'}],known,9000,11000),/INVALID/);
});
test('history identifies bounded unknown activity without treating it as a swap or backfilling flow',()=>{
  const row={signature:'unobserved',slot:100,blockTime:10,err:null,confirmationStatus:'finalized'};
  assert.deepEqual(validatePilotHistory([row],new Map(),9000,11000),[row]);
  assert.deepEqual(validatePilotHistory([{...row,err:{InstructionError:[0,'x']}}],new Map(),9000,11000),[]);
  assert.throws(()=>validatePilotHistory([],new Map([['x',{slot:100,chainBlockTime:null}]]),9000,11000),/CHAIN_TIME_UNKNOWN/);
});

// Chronological queue mechanics only; these are not market identities or trades.
test('ready verified origins cannot starve behind a continuously nonempty discovery queue',()=>{
  const proof=(mint:string,second:number)=>({identity:{baseMint:mint,signature:mint+'-origin',chainBlockTime:second},evidence:'fixture'});
  const proofs={young:proof('young',570),ready:proof('ready',100)} as any;
  assert.equal(nextPreparedPilotSeed(proofs,new Set(),600000)?.feedMint,'ready');
  assert.equal(nextPreparedPilotSeed(proofs,new Set(['ready']),600000),null);
  assert.equal(nextPreparedPilotSeed(proofs,new Set(),7800000),null);
});
