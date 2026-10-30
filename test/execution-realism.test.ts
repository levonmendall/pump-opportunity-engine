import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PAPER_EXECUTION_MODEL_VERSION,PAPER_EXECUTION_POLICY,PAPER_EXECUTION_POLICY_SHA256,planPaperExecution,validatePaperExecutionPlan,validatePaperExecutionLanding,validatePaperExecutionAttempt,paperExecutionPlanSha256,paperExecutionFee,executionAttempt,type PaperExecutionPlan,type PaperExecutionLanding} from '../src/execution-realism.js';
const START=100000,SHA='a'.repeat(64),LANDING_SHA='b'.repeat(64),INTENT_SHA='c'.repeat(64);
const input=()=>({plannedAt:START,decisionQuoteAt:START-20,sourceSlot:1234,constructionSha256:SHA,intentSha256:INTENT_SHA,temporaryQuoteRentLamports:'1000000',quoteRentProofSha256:SHA,constructionMs:10,observedRpcMs:90});
function plan(){const p=planPaperExecution(input());assert.ok(p);return p;}
function landing(p=plan()):PaperExecutionLanding{return {version:PAPER_EXECUTION_MODEL_VERSION,planSha256:paperExecutionPlanSha256(p),constructionSha256:LANDING_SHA,intentSha256:p.intentSha256,temporaryQuoteRentLamports:p.temporaryQuoteRentLamports,quoteRentProofSha256:LANDING_SHA,preparedAt:p.executeAt+50,landingAt:p.executeAt,sourceSlot:p.sourceSlot+1,outcome:'scenario-landed',feeLamports:paperExecutionFee(p)};}
const changed=<T>(value:T,key:string,newValue:unknown)=>({...value,[key]:newValue});

test('default plan explicitly labels nominal chain conditions and declared fee scenarios',()=>{
 const p=plan();assert.equal(validatePaperExecutionPlan(p),true);assert.equal(p.version,PAPER_EXECUTION_MODEL_VERSION);assert.equal(p.policySha256,PAPER_EXECUTION_POLICY_SHA256);assert.equal(p.slotDurationBasis,'scenario');assert.equal(p.slotDurationMs,400);assert.equal(p.propagationMs,250);assert.equal(p.inclusionSlots,2);
 assert.equal(p.executeAt,START+10+90+250+2*400);assert.equal(p.expiresAt,START+5000);assert.equal(p.baseFeeLamports,'5000');assert.equal(p.priorityFeeLamports,'2000');assert.equal(p.routingTipLamports,'0');assert.equal(paperExecutionFee(p),'7000');
 assert.equal(PAPER_EXECUTION_POLICY.meaning,'DETERMINISTIC_PAPER_SCENARIO_NOT_OBSERVED_CHAIN_LANDING');assert.equal(PAPER_EXECUTION_POLICY.feeBasis,'DECLARED_SCENARIO_NOT_RPC_FEE_OR_COMPUTE_MEASUREMENT');assert.match(PAPER_EXECUTION_POLICY.blockhashValidity,/UNOBSERVED/);assert.match(PAPER_EXECUTION_POLICY.historicalPolicy,/without executionModel retain original semantics/);
 assert.equal('successProbability'in p,false);assert.equal('signature'in p,false);
});
test('observed construction/RPC/slot latency changes due time with integer rounding and truthful basis',()=>{
 const initial=plan(),slow=planPaperExecution({...input(),observedRpcMs:290}),observed=planPaperExecution({...input(),slotDurationMs:600,slotDurationBasis:'observed'}),rounded=planPaperExecution({...input(),constructionMs:10.01,observedRpcMs:90.01});
 assert.ok(slow&&observed&&rounded);assert.equal(slow.executeAt-initial.executeAt,200);assert.equal(observed.executeAt-initial.executeAt,400);assert.equal(observed.slotDurationBasis,'observed');assert.equal(observed.slotDurationMs,600);assert.equal(rounded.constructionMs,11);assert.equal(rounded.observedRpcMs,91);assert.equal(rounded.executeAt,initial.executeAt+2);
 assert.equal(planPaperExecution({...input(),slotDurationBasis:'observed'}),null,'a missing slot-duration measurement must not relabel nominal400ms as observed');
});
test('congestion which consumes order lifetime is unavailable, never clipped into an optimistic landing',()=>{
 const edge=planPaperExecution({...input(),constructionMs:0,observedRpcMs:3949});assert.ok(edge);assert.equal(edge.executeAt,edge.expiresAt-1);
 for(const rpc of [3950,3950.01,4000,10000])assert.equal(planPaperExecution({...input(),constructionMs:0,observedRpcMs:rpc}),null);
 assert.equal(planPaperExecution({...input(),constructionMs:2000,observedRpcMs:1000,slotDurationMs:1000,slotDurationBasis:'observed'}),null);
});
test('plan validation rejects forged policy, malformed values, extra fields and altered economic/timing assumptions',()=>{
 const p=plan();for(const [key,value]of [
 ['version','paper-chain-conditioned-v0'],['policySha256','c'.repeat(64)],['constructionSha256','A'.repeat(64)],['constructionSha256','a'.repeat(63)],['constructionSha256','https://provider.invalid/key'],['intentSha256','C'.repeat(64)],['intentSha256','0'.repeat(63)],['slotDurationBasis','measured-on-chain'],['slotDurationMs',99],['slotDurationMs',2001],['observedRpcMs',10001],['constructionMs',2001],['decisionQuoteAt',START+1],['decisionQuoteAt',START-2001],['propagationMs',0],['inclusionSlots',0],['baseFeeLamports','0'],['priorityFeeLamports','1999'],['routingTipLamports','1'],['computeUnitLimit',200001],['computeUnitPriceMicroLamports','10001'],['executeAt',p.executeAt-1],['expiresAt',p.expiresAt+1],['sourceSlot',1.5],['plannedAt',Number.MAX_SAFE_INTEGER+1],['sourceSlot',true],['observedRpcMs','90'],['extra',true],
 ]as Array<[string,unknown]>)assert.equal(validatePaperExecutionPlan(changed(p,key,value)),false,key+':'+String(value));
 for(const key of ['plannedAt','decisionQuoteAt','sourceSlot','observedRpcMs','slotDurationMs','propagationMs','inclusionSlots','constructionMs','executeAt','expiresAt','computeUnitLimit'])for(const value of [-1,NaN,Infinity,undefined,null])assert.equal(validatePaperExecutionPlan(changed(p,key,value)),false,key+':'+String(value));
 for(const value of [null,[],42,'plan'])assert.equal(validatePaperExecutionPlan(value),false);
 const missing={...p}as Partial<PaperExecutionPlan>;delete missing.sourceSlot;assert.equal(validatePaperExecutionPlan(missing),false);
});
test('invalid plan inputs fail closed without inventing a current latency/source observation',()=>{
 for(const [key,value]of [['plannedAt',-1],['decisionQuoteAt',START+1],['sourceSlot',NaN],['constructionSha256','not-a-hash'],['intentSha256','not-a-hash'],['constructionMs',Infinity],['observedRpcMs',NaN],['slotDurationMs',99],['slotDurationBasis','provider-measured']]as Array<[string,unknown]>)assert.equal(planPaperExecution(changed(input(),key,value)as Parameters<typeof planPaperExecution>[0]),null,key);
});
test('landing binds the exact plan, fresh new construction and nonregressing source without claiming chain confirmation',()=>{
 const p=plan(),q=landing(p);assert.equal(validatePaperExecutionLanding(q,p,q.preparedAt),true);assert.equal(validatePaperExecutionLanding(q,p),true);assert.notEqual(q.constructionSha256,p.constructionSha256,'post-delay state is independently reconstructed');assert.equal(q.outcome,'scenario-landed');assert.equal(q.intentSha256,p.intentSha256,'original exact input/minimum instruction intent is preserved despite independently fresh state');
 const other=planPaperExecution({...input(),observedRpcMs:91})!;assert.equal(validatePaperExecutionLanding(q,other,q.preparedAt),false);assert.equal(validatePaperExecutionLanding({...q,planSha256:paperExecutionPlanSha256(other)},p,q.preparedAt),false);
 assert.notEqual(paperExecutionPlanSha256(p),paperExecutionPlanSha256(other));
});
test('landing before due, after expiry, stale at preparation/use, wrong slot, wrong fee or malformed hashes is rejected',()=>{
 const p=plan(),q=landing(p);
 for(const [key,value]of [['version','confirmed-live'],['planSha256','0'.repeat(64)],['constructionSha256','B'.repeat(64)],['constructionSha256','x'],['intentSha256','d'.repeat(64)],['intentSha256','C'.repeat(64)],['sourceSlot',p.sourceSlot-1],['sourceSlot',NaN],['landingAt',p.executeAt-1],['preparedAt',q.landingAt-1],['preparedAt',p.expiresAt],['feeLamports','0'],['feeLamports','7001'],['outcome','confirmed'],['extra','untrusted']]as Array<[string,unknown]>)assert.equal(validatePaperExecutionLanding(changed(q,key,value),p,q.preparedAt),false,key);
 assert.equal(validatePaperExecutionLanding(q,p,q.preparedAt-1),false,'future preparation');assert.equal(validatePaperExecutionLanding(q,p,p.expiresAt),false,'expiry is not a supported landing');assert.equal(validatePaperExecutionLanding(q,p,q.landingAt+2001),false,'stale at actual financial use');
 const stale={...q,preparedAt:q.landingAt+2001};assert.ok(stale.preparedAt<p.expiresAt);assert.equal(validatePaperExecutionLanding(stale,p),false,'intrinsic quote freshness applies even when optional at is omitted');assert.equal(validatePaperExecutionLanding(stale,p,stale.preparedAt),false);
 for(const bad of [null,[],42,'landing'])assert.equal(validatePaperExecutionLanding(bad,p,q.preparedAt),false);assert.equal(validatePaperExecutionLanding(q,{...p,executeAt:p.executeAt-1},q.preparedAt),false);
});
test('unsubmitted preparation and expiry carry zero fee; only supported scenario landing carries modeled7000',()=>{
 const p=plan(),unavailable=executionAttempt(p,false),expired=executionAttempt(p,false,true),landed=executionAttempt(p,true);
 assert.equal(unavailable.stage,'preflight-unsubmitted');assert.equal(unavailable.feeLamports,'0');assert.equal(unavailable.reasonCode,'LANDING_STATE_UNAVAILABLE');assert.equal(expired.stage,'preflight-unsubmitted');assert.equal(expired.feeLamports,'0');assert.equal(expired.reasonCode,'ORDER_EXPIRED_UNSUBMITTED');assert.equal(landed.stage,'scenario-landed');assert.equal(landed.feeLamports,'7000');assert.equal(landed.reasonCode,'SCENARIO_LANDING_SUPPORTED');
 for(const a of [unavailable,expired,landed]){assert.equal(validatePaperExecutionAttempt(a,p),true);assert.equal(a.planSha256,paperExecutionPlanSha256(p));}
});
test('attempt validator refuses forged plan binding, stage/reason/fee mismatch and undocumented optimistic flags',()=>{
 const p=plan(),unavailable=executionAttempt(p,false),landed=executionAttempt(p,true),other=planPaperExecution({...input(),observedRpcMs:91})!;
 for(const [base,key,value]of [[unavailable,'feeLamports','7000'],[landed,'feeLamports','0'],[unavailable,'reasonCode','SCENARIO_LANDING_SUPPORTED'],[landed,'reasonCode','LANDING_STATE_UNAVAILABLE'],[landed,'stage','confirmed'],[landed,'planSha256','A'.repeat(64)],[landed,'planSha256',paperExecutionPlanSha256(other)],[landed,'version','v0'],[landed,'extra',true],[landed,'successProbability',1],[landed,'signature','fake']]as Array<[unknown,string,unknown]>)assert.equal(validatePaperExecutionAttempt(changed(base,key,value),p),false,key+':'+String(value));
 for(const bad of [null,[],42,'attempt'])assert.equal(validatePaperExecutionAttempt(bad,p),false);assert.equal(validatePaperExecutionAttempt(landed,{...p,executeAt:p.executeAt-1}),false);
});
