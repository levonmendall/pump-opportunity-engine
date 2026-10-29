/** Controlled real trader/ledger recovery; no operating financial data/RPC. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DisposableLedger,OPERATING_FINANCIAL_READINESS_VERSION,type Mark} from '../src/ledger.js';
import {PaperTrader,type TechnicalProtectionRecoveryProof} from '../src/trader.js';

function fixture(t:TestContext,flat=false,two=false){
 const root=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-technical-protection-')),ledger=new DisposableLedger(join(root,'ledger.sqlite'),'fixture-technical-protection-recovery');
 let at=Date.parse('2026-10-29T04:00:00Z'),missing=false,missingMint:string|null=null,recordFailure=false;const records:Array<{kind:string;data:any}>=[];
 const price=()=>({at,microUsdPerSol:'100000000',source:'CONTROLLED original USD timestamp'}),marks=()=>Object.fromEntries(Object.values(ledger.state().positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:(BigInt(p.entryLamports)+BigInt(p.entryGas)).toString(),evidence:'CONTROLLED exact-size liquidation'}]));
 ledger.initialize(price(),at);ledger.reconcile('initial',at,price(),{});ledger.resume('initial-permission',at,price(),{},{version:'CONTROLLED',evidence:'fixture initial explicit readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
 ledger.order({id:'fixture-entry',side:'buy',mint:'fixture-token',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'CONTROLLED entry'},price(),{});at+=1000;assert.equal(ledger.attempt('fixture-fill','fixture-entry',at,{at,evidence:'CONTROLLED post-delay fill',spendLamports:'10000000',receiveUnits:'1000'},price(),{}).status,'filled');
 if(two){ledger.order({id:'fixture-second-entry',side:'buy',mint:'fixture-second-token',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'2000',decisionEvidence:'CONTROLLED second entry'},price(),marks());at+=1000;assert.equal(ledger.attempt('fixture-second-fill','fixture-second-entry',at,{at,evidence:'CONTROLLED second post-delay fill',spendLamports:'10000000',receiveUnits:'2000'},price(),marks()).status,'filled');}
 ledger.pause(`trader:pause:${ledger.state().revision}:${at}`,at,'completed PAPER protection gap exceeded research boundary');
 if(flat){ledger.order({id:'fixture-close',side:'sell',mint:'fixture-token',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'CONTROLLED close before recovery'},price(),marks());at+=1000;assert.equal(ledger.attempt('fixture-close-fill','fixture-close',at,{at,evidence:'CONTROLLED close actual-size',spendLamports:'0',receiveUnits:'10014000',pricedBaseUnits:'1000'},price(),marks()).status,'filled');}
 const trader=new PaperTrader({ledger,now:()=>at,context:async()=>({price:price(),marks:missing?{}:Object.fromEntries(Object.entries(marks()).filter(([mint])=>mint!==missingMint)),...(Object.keys(ledger.state().positions).length?{sourceValidUntil:at+30000}:{})}),quote:async()=>null,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'CONTROLLED financial assumptions'},recorder:{record(kind,data){if(recordFailure&&kind==='native-paper-financial-readiness-recovered')throw Error('CONTROLLED required record failure');records.push({kind,data:structuredClone(data)});}}});trader.start();
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 const proof=(healthy=true)=>trader.technicalProtectionRecoveryProof(ledger.technicalProtectionRecoveryAuthority(at),healthy,at);
 const tick=async(healthy=true)=>{at+=2000;await trader.tick({evaluateCandidates:false});return proof(healthy);};
 const resume=(p:TechnicalProtectionRecoveryProof)=>{const state=ledger.state(),currentMarks=marks();return ledger.resume('technical-recover:'+state.revision,at,price(),currentMarks,{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'CONTROLLED authenticated technical proof and current inventory/source',accountId:state.accountId,stateRevision:state.revision,reconciledAt:state.daily.reconciledAt,positionUnits:Object.fromEntries(Object.values(state.positions).map(p=>[p.mint,p.units])),source:{kind:Object.keys(state.positions).length?'complete-held-liquidation-context':'selected-native-support',bankClockAt:at,receivedAt:at,validUntil:at+30000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true,technicalProtectionRecovery:p});};
 return {ledger,trader,price,marks,records,proof,tick,resume,get at(){return at;},advance:(ms:number)=>{at+=ms;},set missing(v:boolean){missing=v;},set missingMint(v:string|null){missingMint=v;},set recordFailure(v:boolean){recordFailure=v;}};
}

test('known technical hard pause requires a full new measured held interval before revision-bound recovery',async t=>{
 const f=fixture(t),before=f.ledger.state();assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);let proof:TechnicalProtectionRecoveryProof|null=null;
 for(let i=0;i<32;i++){proof=await f.tick();if(i<31)assert.equal(proof,null);}
 assert.ok(proof,JSON.stringify({authority:f.ledger.technicalProtectionRecoveryAuthority(f.at),status:f.trader.technicalProtectionRecoveryStatus(),safety:f.trader.entryReadinessSafety()}));assert.equal(proof.completedAt-proof.startedAt,60000);assert.equal(proof.maximumCompletedGapMs,2000);assert.equal(proof.completedEvaluations,31);assert.deepEqual(proof.positionUnits,{'fixture-token':'1000'});
 assert.equal(f.ledger.state().controls.entriesEnabled,false,'proof production never arms the account');assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);
 assert.equal(f.resume(proof).enabled,true);assert.equal(f.trader.recordFinancialReadiness({version:proof.version,orderCreated:false,entryQuoteClaimed:false}),true);assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),true);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,true);
 assert.equal(f.ledger.state().inceptionAt,before.inceptionAt);assert.equal(f.ledger.state().lamports,before.lamports);assert.deepEqual(f.ledger.state().positions,before.positions);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),false,'the proof cannot be consumed twice');assert.equal(f.ledger.state().controls.entriesEnabled,true,'replaying an already consumed completion cannot invent a new interruption');
});

test('polling/reused quotes cannot replace completed held protection and source faults reset the whole interval',async t=>{
 const f=fixture(t);for(let i=0;i<20;i++)assert.equal(await f.tick(),null);const before=f.trader.technicalProtectionRecoveryStatus();
 for(let i=0;i<30;i++)assert.equal(f.proof(),null);assert.deepEqual(f.trader.technicalProtectionRecoveryStatus(),before,'proof polling creates no holding completions');
 assert.equal(f.proof(false),null);assert.equal(f.trader.technicalProtectionRecoveryStatus(),null);
 for(let i=0;i<30;i++)assert.equal(await f.tick(),null);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);
});

for(const failure of ['missing-quote','gap','new-technical-failure'] as const)test(`a ${failure} cannot be hidden inside the recovery interval`,async t=>{
 const f=fixture(t);for(let i=0;i<25;i++)assert.equal(await f.tick(),null);
 if(failure==='missing-quote'){f.missing=true;await f.tick();f.missing=false;}
 if(failure==='gap'){f.advance(5000);await f.tick();}
 if(failure==='new-technical-failure')f.trader.pauseNewEntries('PAPER protection unavailable; exposure retained');
 for(let i=0;i<20;i++)assert.equal(await f.tick(),null);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);
});

for(const stop of ['owner-pause','owner-stop','unknown-hard','pending-exit'] as const)test(`recovery does not clear ${stop}`,async t=>{
 const f=fixture(t);let proof:TechnicalProtectionRecoveryProof|null=null;for(let i=0;i<32;i++)proof=await f.tick();assert.ok(proof);
 if(stop==='owner-pause')f.ledger.pause('owner-explicit-pause',f.at,'operator paused new entries');
 if(stop==='owner-stop')f.ledger.safeStop('owner-explicit-stop',f.at);
 if(stop==='unknown-hard')f.trader.pauseNewEntries('unknown required financial condition');
 if(stop==='pending-exit')f.ledger.order({id:'owned-exit',side:'sell',mint:'fixture-token',decidedAt:f.at,executeAt:f.at+1000,expiresAt:f.at+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'CONTROLLED pending financial obligation'},f.price(),f.marks());
 assert.equal(f.proof(),null);assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),false);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('a required recovery record failure retains the safety latch after a financial resume',async t=>{
 const f=fixture(t);let proof:TechnicalProtectionRecoveryProof|null=null;for(let i=0;i<32;i++)proof=await f.tick();assert.ok(proof);assert.equal(f.resume(proof).enabled,true);
 f.recordFailure=true;assert.equal(f.trader.recordFinancialReadiness({version:proof.version}),false);assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),false);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);
});

test('closed inventory recovers only through new durable cash checks without invented held evaluations',async t=>{
 const f=fixture(t,true);let proof:TechnicalProtectionRecoveryProof|null=null;for(let i=0;i<31;i++)proof=await f.tick();assert.ok(proof);assert.deepEqual(proof.positionUnits,{});assert.equal(proof.lastQuoteAt,f.price().at);assert.equal(f.records.filter(r=>r.kind==='trader-held-evaluation').length,0);
 assert.equal(f.resume(proof).enabled,true);assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),true);assert.deepEqual(f.ledger.state().positions,{});
});

test('both holdings must complete fresh protection; a partial inventory cannot accumulate recovery credit',async t=>{
 const f=fixture(t,false,true);let proof:TechnicalProtectionRecoveryProof|null=null;for(let i=0;i<32;i++)proof=await f.tick();assert.ok(proof);assert.deepEqual(proof.positionUnits,{'fixture-second-token':'2000','fixture-token':'1000'});assert.equal(proof.completedEvaluations,31,'one complete union evaluation per tick, not twice per holding');
 f.missingMint='fixture-second-token';assert.equal(await f.tick(),null);assert.equal(f.trader.technicalProtectionRecoveryStatus(),null);f.missingMint=null;
 for(let i=0;i<30;i++)assert.equal(await f.tick(),null);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('an owner stop arriving after the resume commit cannot be cleared by late proof completion',async t=>{
 const f=fixture(t);let proof:TechnicalProtectionRecoveryProof|null=null;for(let i=0;i<32;i++)proof=await f.tick();assert.ok(proof);assert.ok(Object.isFrozen(proof));assert.ok(Object.isFrozen(proof.positionUnits));assert.equal(f.resume(proof).enabled,true);
 f.ledger.safeStop('owner-stop-after-recovery-commit',f.at);assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),false);assert.equal(f.ledger.state().controls.stopRequested,true);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);
});

test('a slow post-resume evidence phase closes permission again rather than consuming expired protection proof',async t=>{
 const f=fixture(t);let proof:TechnicalProtectionRecoveryProof|null=null;for(let i=0;i<32;i++)proof=await f.tick();assert.ok(proof);assert.equal(f.resume(proof).enabled,true);
 f.advance(2500);assert.equal(f.trader.technicalProtectionRecoveryCommitted(proof),false);assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.deepEqual(f.ledger.state().pending,{});
});
