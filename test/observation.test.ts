import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planObservation,OBSERVATION_REQUIREMENTS} from '../src/observation.js';
import type {Position,Order} from '../src/ledger.js';

const A='So11111111111111111111111111111111111111112',B='11111111111111111111111111111111',C='6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ';
const T=1_700_000_000_000;
const pos=(mint=A):Position=>({mint,units:'1000',entryLamports:'1000000',entryGas:'5000',costMicroUsd:'200000',deposit:'0',enteredAt:T-10000});
const order=(mint=A,side:'buy'|'sell'='buy'):Order=>({id:'fixture-order',mint,side,decidedAt:T-100,executeAt:T+900,expiresAt:T+4900,gas:'5000',deposit:'0',maxSpend:'1000000',minReceive:'1',reserved:'1005000',decisionEvidence:'DISPOSABLE delayed order'});
const mark=(at=T,units='1000')=>({pathVerified:true,mark:{netLamports:'900000',pricedBaseUnits:units,at,evidence:'DISPOSABLE tested actual-size RPC path'}});
const base=()=>({now:T,candidates:[{mint:A,wanted:true,supported:true,alreadyTraded:false}],financial:{positions:{},pending:{}},currentTradeSubscriptions:[] as string[],rpcProtection:{},budgetAllowsObservation:true});

test('qualification requires flow; current holding policy requires full-size RPC, not ongoing paid flow',()=>{
  assert.equal(OBSERVATION_REQUIREMENTS.candidateTradeFlow,true);assert.equal(OBSERVATION_REQUIREMENTS.heldTradeFlow,false);
  const p=planObservation(base());assert.deepEqual(p.subscribeTradeMints,[A]);assert.equal(p.candidateFlowWindowMs,60000);assert.equal(p.entriesMayBeEnabled,false);assert.equal(p.flowFieldsVerified,false);
});
test('successful full-size RPC handoff releases held paid flow without removing protection',()=>{
  const p=planObservation({...base(),financial:{positions:{[A]:pos()},pending:{}},currentTradeSubscriptions:[A],rpcProtection:{[A]:mark()}});
  assert.deepEqual(p.rpcPriorityMints,[A]);assert.deepEqual(p.desiredTradeMints,[]);assert.deepEqual(p.unsubscribeTradeMints,[A]);assert.equal(p.heldMandatoryPaidFlowReserveEvents,0);assert.equal(p.pauseNewAdmissions,false);
});
test('unknown, stale, future or wrong-size protection blocks new observation and never becomes a fresh zero',()=>{
  for(const protection of [{pathVerified:false,mark:null},mark(T-2001),mark(T+1),mark(T,'999')]){
    const p=planObservation({...base(),candidates:[{mint:B,wanted:true,supported:true,alreadyTraded:false}],financial:{positions:{[A]:pos()},pending:{}},currentTradeSubscriptions:[A],rpcProtection:{[A]:protection}});
    assert.deepEqual(p.rpcPriorityMints,[A]);assert.deepEqual(p.subscribeTradeMints,[]);assert.deepEqual(p.temporaryHandoffTradeMints,[]);assert.deepEqual(p.unsubscribeTradeMints,[A]);assert.deepEqual(p.unavailableProtectionMints,[A]);assert.equal(p.pauseNewAdmissions,true);assert.equal(p.criticalProtectionUnavailable,true);
  }
});
test('initial held-flow handoff is explicit, bounded by original fill time, and cannot renew',()=>{
  const input={...base(),financial:{positions:{[A]:{...pos(),enteredAt:T-1000}},pending:{}},currentTradeSubscriptions:[A],rpcProtection:{[A]:{pathVerified:false,mark:null,handoffPending:true}}};
  assert.deepEqual(planObservation(input).temporaryHandoffTradeMints,[A]);
  const expired=planObservation({...input,now:T+4000});assert.deepEqual(expired.temporaryHandoffTradeMints,[]);assert.deepEqual(expired.unsubscribeTradeMints,[A]);assert.equal(expired.criticalProtectionUnavailable,true);
  assert.deepEqual(planObservation({...input,rpcProtection:{[A]:{pathVerified:false,mark:null}}}).temporaryHandoffTradeMints,[]);
});
test('exhausted paid allowance stops upstream flow while RPC protection remains mandatory',()=>{
  const p=planObservation({...base(),financial:{positions:{[A]:pos()},pending:{}},currentTradeSubscriptions:[A,B],rpcProtection:{[A]:{pathVerified:false,mark:null}},budgetAllowsObservation:false});
  assert.deepEqual(p.unsubscribeTradeMints,[A,B].sort());assert.deepEqual(p.rpcPriorityMints,[A]);assert.deepEqual(p.desiredTradeMints,[]);assert.equal(p.criticalProtectionUnavailable,true);assert.equal(p.pauseNewAdmissions,true);
});
test('pending entry flow stops at explicit expiry; rejected/inactive/traded tokens unsubscribe',()=>{
  const p=planObservation({...base(),candidates:[{mint:A,wanted:false,supported:true,alreadyTraded:false},{mint:B,wanted:true,supported:false,alreadyTraded:false},{mint:C,wanted:true,supported:true,alreadyTraded:true}],financial:{positions:{},pending:{entry:order()}},currentTradeSubscriptions:[A,B,C]});
  assert.deepEqual(p.desiredTradeMints,[A]);assert.deepEqual(p.unsubscribeTradeMints,[B,C].sort());
  const expired=planObservation({...base(),candidates:[],now:T+5000,financial:{positions:{},pending:{entry:order()}},currentTradeSubscriptions:[A]});assert.deepEqual(expired.desiredTradeMints,[]);
  const limited=planObservation({...base(),financial:{positions:{},pending:{entry:order()}},currentTradeSubscriptions:[A],budgetAllowsObservation:false});assert.deepEqual(limited.pendingEntryIdsToCancelOrQuarantine,['fixture-order']);assert.equal(limited.closeEntryRiskBeforeRetirement,true);assert.equal(limited.stopPaidTrafficAtLimitEvenIfFinancialWriteFails,true);assert.deepEqual(limited.unsubscribeTradeMints,[A]);
});
test('held sells take RPC priority; planning does not mutate balances, actions or subscription inputs',()=>{
  const input={...base(),financial:{positions:{[A]:pos(A),[B]:pos(B)},pending:{sell:order(B,'sell')}},currentTradeSubscriptions:[A,B],rpcProtection:{[A]:mark(),[B]:mark()}};
  const before=structuredClone(input),p=planObservation(input);assert.deepEqual(p.rpcPriorityMints,[B,A]);assert.deepEqual(input,before);
  assert.throws(()=>planObservation({...base(),candidates:Array.from({length:13},()=>base().candidates[0]!)}),/bounded/);
});
