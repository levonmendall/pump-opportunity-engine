import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PumpSwapTokenAgeAdmission} from '../src/market-age-admission.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';

const AT=Date.parse('2026-11-03T04:00:00Z'),mint=new PublicKey(Buffer.alloc(32,7)).toBase58(),pool=new PublicKey(Buffer.alloc(32,8)).toBase58(),signature=bs58.encode(Buffer.alloc(64,7));
const proof=(createdAt:number):TokenCreationProof=>({version:TOKEN_AGE_POLICY.version,mint,signature,slot:7,createdAt,availableAt:AT-1000,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)});

test('deep retry and continuous resume use upstream cached age, including exact clock expiry, without durable proof lookups',t=>{
 let at=AT;const expiresAt=AT+60000,registry=new MarketRegistry(':memory:',{now:()=>at});
 try{
  registry.putTokenCreationProof(proof(expiresAt-TOKEN_AGE_POLICY.maximumAgeMs));
  const cache=new PumpSwapTokenAgeAdmission(registry.tokenCreationScopeSnapshot(at,true)),decisions:Array<{mint:string;at:number;allowed:boolean}>=[];
  const read=t.mock.method(registry,'tokenAgeEligibility',()=>{throw Error('DEEP_MUST_NOT_LOOK_UP_TOKEN_AGE');});
  const watch=new PilotWatch({registry,maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:()=>{},tokenAgeEligibility:(mint,at)=>{const allowed=cache.decision(mint,at)==='eligible';decisions.push({mint,at,allowed});return allowed;}});
  watch.discover({signature,feedMint:mint,receivedAt:at});watch.verify(signature,{mint,pool,migrationAt:AT-600000,verifiedAt:AT});
  const initial=watch.transition(mint,'DEEP_OBSERVATION','upstream age-qualified scope',at);
  assert.equal(watch.requestTechnicalReevaluation(mint,{reason:'entry-quote-unavailable',failedWindowEndAt:AT-10000},at),true);
  at+=10000;assert.equal(watch.claimTechnicalReevaluation(mint,at,at),true);
  at+=10000;assert.equal(watch.requestTechnicalReevaluation(mint,{reason:'entry-action-expired',failedWindowEndAt:AT+10000},at),true);
  watch.transition(mint,'ENTRY_PENDING','existing unfilled action',at);
  const resumed=watch.resumeContinuousObservation(mint,'uninterrupted source after resolved action',at);
  assert.equal(resumed.deepSince,initial.deepSince);assert.equal(resumed.promotions,initial.promotions,'resuming a continuous scope does not allocate another slot');
  at=expiresAt;assert.equal(watch.claimTechnicalReevaluation(mint,at,at),true,'the verified 24h boundary remains inclusive');
  assert.equal(watch.requestTechnicalReevaluation(mint,{reason:'entry-quote-unavailable',failedWindowEndAt:at},at),true);
  at++;assert.equal(watch.claimTechnicalReevaluation(mint,at,at),false,'expired cached age cannot claim a later deep decision');
  assert.equal(watch.requestTechnicalReevaluation(mint,{reason:'entry-preparation-unavailable',failedWindowEndAt:at},at),false,'expired cached age cannot renew the retry');
  watch.transition(mint,'ENTRY_PENDING','existing action still requires resolution',at);
  assert.throws(()=>watch.resumeContinuousObservation(mint,'expired scope cannot resume',at),/CONTINUOUS_OBSERVATION_REQUIRED/);
  assert.equal(watch.lookupIdentity(mint,at)!.state,'ENTRY_PENDING','age expiry preserves the existing financial obligation');
  watch.transition(mint,'HELD','authoritative fill remains protected',at);assert.equal(watch.lookupIdentity(mint,at)!.state,'HELD');
  assert.equal(read.mock.calls.length,0);assert.ok(decisions.some(row=>row.at===expiresAt&&row.allowed));
  assert.equal(decisions.filter(row=>row.at===expiresAt+1&&!row.allowed).length,3,'request, claim and resume each use the current cached decision');
  assert.ok(decisions.every(row=>row.mint===mint));
 }finally{registry.close();}
});

test('standalone watch callers retain the durable token-age fallback when no upstream predicate is supplied',t=>{
 let at=AT;const registry=new MarketRegistry(':memory:',{now:()=>at});
 try{
  registry.putTokenCreationProof(proof(AT-TOKEN_AGE_POLICY.maximumAgeMs));
  const original=registry.tokenAgeEligibility.bind(registry),read=t.mock.method(registry,'tokenAgeEligibility',original);
  const watch=new PilotWatch({registry,maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:()=>{}});
  watch.discover({signature,feedMint:mint,receivedAt:at});watch.verify(signature,{mint,pool,migrationAt:AT-600000,verifiedAt:AT});
  assert.equal(watch.transition(mint,'DEEP_OBSERVATION','standalone proof remains required',at).state,'DEEP_OBSERVATION');
  at++;assert.equal(watch.requestTechnicalReevaluation(mint,{reason:'entry-quote-unavailable',failedWindowEndAt:at},at),false);
  assert.ok(read.mock.calls.length>=2);assert.equal(read.mock.calls.at(-1)!.arguments[1],at);
 }finally{registry.close();}
});
