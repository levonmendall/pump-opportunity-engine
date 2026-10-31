/** OFFLINE controlled-clock regression. Disposable fixture account only;
 * no provider requests, real account, quote, entry or execution. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PublicKey} from '@solana/web3.js';
import {PaperLedger} from '../src/ledger.js';
import {NativePaper} from '../src/native-paper.js';
import {FlowWindow,assessPredictiveBuying,type NormalizedTrade} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256,CONCURRENT_PILOTS,type PilotBinding} from '../src/pilot-contract.js';
import type {PilotMarket} from '../src/pilot-market.js';
import {canonicalObservationPool,type NativeObservationIdentity} from '../src/native-observation-identity.js';
import type {ResearchClockObservationSupport} from '../src/research-clock-pricing.js';

const offlineIdentity=(mint:string,at:number,migrationAt:number):NativeObservationIdentity=>({schemaVersion:1,baseMint:mint,pool:canonicalObservationPool(mint),migrationAt,migrationVerified:true,identityBasis:'retained-verified-metadata',identityAvailableAt:at,identityEvidence:'OFFLINE synthetic retained migration metadata',minimumSlot:1});
const offlineSupport=(mint:string,at:number):ResearchClockObservationSupport=>({mint,pool:canonicalObservationPool(mint),at,sourceSlot:1,evidence:'OFFLINE synthetic current canonical pool validation',summary:{} as ResearchClockObservationSupport['summary']});

test('native bridge retains every same-packet event when callback recording advances the clock',t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-native-multi-event-')),accountId='poe-pilot-native-multi-event-fixture',base=Date.parse('2026-10-29T03:00:00Z'),mint='So11111111111111111111111111111111111111112';
 const ledger=new PaperLedger(join(directory,'fixture.sqlite'),accountId);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 let at=base,advanceDuringFirstRecord=true;ledger.initialize({at,microUsdPerSol:'100000000',source:'OFFLINE controlled USD'},at);
 const slots:number[]=[],trades:NormalizedTrade[]=[];
 const unavailable=async()=>{throw Error('OFFLINE unexpected market request');};
 const market={registerPool(){},minimumSlot(_mint:string,slot:number){slots.push(slot);},quote:unavailable,executionQuote:unavailable,context:unavailable} as unknown as PilotMarket;
 const bridge=new NativePaper({ledger,market,fixtureAccountBinding:{accountId,inceptionAt:ledger.state().inceptionAt},binding:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},source:{usage:()=>({dataContract:'confirmed-program-activity-v3-shadow'}) as any,snapshot:()=>null},certificate:()=>null,record:(kind,data)=>{const row=data as {kind?:string;trade?:NormalizedTrade};if(kind==='trader-input'&&row.kind==='trade'){trades.push(structuredClone(row.trade!));if(advanceDuringFirstRecord){advanceDuringFirstRecord=false;at++;}}},now:()=>at,admitNewRisk:()=>false});
 bridge.allocated(offlineIdentity(mint,at,base-600000));bridge.currentPoolValidated(offlineSupport(mint,at));bridge.opened({mint,at});
 assert.equal(bridge.trader.hasCandidate(mint),true);assert.equal(bridge.trader.hasCandidate('OFFLINE-UNSELECTED'),false);
 const native=new FlowWindow(mint,at),availableAt=base+100;at=availableAt;
 for(let n=0;n<2;n++){
  // Native notification admission stamps the whole validated packet once.
  const trade:NormalizedTrade={identity:{signature:'OFFLINE-SHARED-PACKET',instructionIndex:0,eventIndex:n},mint,wallet:'OFFLINE-BUYER-'+n,side:'buy',quoteLamports:'300000000',tokenUnits:'300000',receivedAt:availableAt,commitment:'confirmed',slot:100+n};
  assert.equal(native.ingest(trade),'accepted');bridge.trade({trade,evidence:{} as any,validatedAt:availableAt,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});
 }
 assert.equal(at,availableAt+1,'actual callback time advances without retiming the packet');assert.deepEqual(trades.map(r=>r.receivedAt),[availableAt,availableAt]);assert.deepEqual(slots,[1,100,101],'current pool proof establishes slot floor before both packet events');
 at=base+60000;const nativeFeatures=native.features(at),bridgeFeatures=bridge.trader.candidateFeatures(mint,at)!;assert.equal(nativeFeatures.sufficientlyObserved,true);assert.equal(bridgeFeatures.sufficientlyObserved,true);assert.equal(bridgeFeatures.tradeCount,2);assert.equal(nativePaperFeaturesSha256(bridgeFeatures),nativePaperFeaturesSha256(nativeFeatures),'both complete windows retain the exact same packet evidence');
 assert.deepEqual(ledger.state().positions,{});assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().executionCosts,'0');
});

/** Complete synthetic feature/certificate evidence, with real disposable
 * accounting. Market-call counters distinguish capacity refusal from missing
 * information; no live qualification, pricing or trade is represented. */
function capacityFixture(t:TestContext,concurrent=false){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-native-capacity-')),accountId='poe-pilot-native-capacity-fixture',base=Date.parse('2026-10-29T03:00:00Z');let at=base;
 const ledger=new PaperLedger(join(directory,'fixture.sqlite'),accountId);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const price=()=>({at,microUsdPerSol:'100000000',source:'OFFLINE controlled USD'});ledger.initialize(price(),at);
 const heldMint=new PublicKey(Buffer.alloc(32,21)).toBase58(),candidateMint=new PublicKey(Buffer.alloc(32,23)).toBase58(),pool=canonicalObservationPool(candidateMint),window=new FlowWindow(candidateMint,base),records:Array<{kind:string;data:any}>=[];
 const calls={preparation:0,quote:0,proof:0,protection:0};
 const market={registerPool(){},minimumSlot(){},async prepareEntryCosts(){calls.preparation++;return {depositLamports:'0',evidence:'OFFLINE modeled existing account costs',at};},async quote(){calls.quote++;return null;},async executionQuote(){throw Error('OFFLINE no execution expected');},async context(positions:ReturnType<PaperLedger['state']>['positions']){calls.protection++;return {price:price(),marks:Object.fromEntries(Object.values(positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:(BigInt(p.entryLamports)+BigInt(p.entryGas)).toString(),evidence:'OFFLINE current actual-size liquidation mark'}])),sourceValidUntil:at+30000};}}as unknown as PilotMarket;
 const binding:PilotBinding=concurrent?{version:CONCURRENT_PILOTS[2].contract.version,stage:2,contractSha256:CONCURRENT_PILOTS[2].contractSha256,maxPositions:2}:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1};
 const bridge=new NativePaper({ledger,market,binding,fixtureAccountBinding:{accountId,inceptionAt:ledger.state().inceptionAt},now:()=>at,admitNewRisk:()=>true,pinQualification:()=>{calls.proof++;},record:(kind,data)=>records.push({kind,data:structuredClone(data)}),source:{usage:()=>({dataContract:'confirmed-program-activity-v3-shadow'})as any,snapshot:(_mint,when)=>({dataContract:'confirmed-program-activity-v3-shadow',openedAt:base,connectionId:1,subscription:11,connected:true,sourceSupportFresh:true,hasQualityLoss:false,features:window.features(when??at)})as any},certificate:(_mint,when)=>{const f=window.features(when);return {schemaVersion:1,mint:candidateMint,pool,dataContract:'confirmed-program-activity-v3-shadow',openedAt:base,connectionId:1,subscriptionId:11,windowStartAt:f.windowStartAt,windowEndAt:f.windowEndAt,auditAvailableAt:when,admittedAt:when,deadlineAt:f.windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(f)};}});
 bridge.allocated(offlineIdentity(heldMint,at,base-600000));bridge.currentPoolValidated(offlineSupport(heldMint,at));
 bridge.allocated(offlineIdentity(candidateMint,at,base-600000));bridge.currentPoolValidated(offlineSupport(candidateMint,at));bridge.opened({mint:candidateMint,at});
 for(let i=0;i<6;i++){at=base+100+i*10000;const trade:NormalizedTrade={identity:{signature:'OFFLINE-CAPACITY-BUY-'+i,instructionIndex:0,eventIndex:0},mint:candidateMint,wallet:'OFFLINE-CAPACITY-BUYER-'+i,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:at,commitment:'confirmed',slot:100+i};assert.equal(window.ingest(trade),'accepted');bridge.trade({trade,evidence:{}as any,validatedAt:at,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});}
 at=base+60000;
 const ready=()=>{const state=ledger.state(),marks=Object.fromEntries(Object.values(state.positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:(BigInt(p.entryLamports)+BigInt(p.entryGas)).toString(),evidence:'OFFLINE current mark'}]));ledger.reconcile('fixture-reconcile:'+state.revision,at,price(),marks);assert.equal(ledger.resume('fixture-ready:'+ledger.state().revision,at,price(),marks,{version:'OFFLINE capacity fixture',evidence:'Controlled readiness only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true}).enabled,true);};
 const reserve=()=>{ready();const result=ledger.order({id:'OFFLINE-FIRST-BUY',mint:heldMint,side:'buy',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'OFFLINE capacity setup'},price(),{});assert.equal(result.reserved,'10007000');};
 const hold=()=>{reserve();at+=1000;assert.equal(ledger.attempt('OFFLINE-FIRST-FILL','OFFLINE-FIRST-BUY',at,{at,spendLamports:'10000000',receiveUnits:'1000',evidence:'OFFLINE setup fill only'},price()).status,'filled');};
 return {ledger,bridge,heldMint,candidateMint,calls,records,binding,reserve,hold,features:()=>window.features(at),at:()=>at};
}

test('full frozen position capacity avoids proof/rent/quote work while holding protection continues',async t=>{
 const f=capacityFixture(t);f.hold();assert.equal(f.bridge.ready(f.candidateMint),true);assert.equal(assessPredictiveBuying(f.features(),f.at()).status,'not-rejected');
 // The constructor captures the validated stage limit; changing the caller's
 // mutable object cannot admit extra exposure during the measured interval.
 (f.binding as {maxPositions:number}).maxPositions=3;
 const before=f.ledger.state();assert.equal(f.bridge.qualificationProof(f.candidateMint),null);assert.deepEqual(await f.bridge.candidate(f.candidateMint,true),{kind:'capacity-refused'});assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.calls,{preparation:0,quote:0,proof:0,protection:0});
 const refusal=f.records.find(r=>r.kind==='native-paper-entry-unavailable')!.data;assert.equal(refusal.reason,'simulated-position-capacity-reserved');assert.equal(refusal.heldPositions,1);assert.equal(refusal.pendingBuyOrders,0);assert.equal(refusal.maximumPositions,1);assert.equal(refusal.executableQualification,false);
 await f.bridge.protection();assert.equal(f.calls.protection,1);assert.deepEqual(f.ledger.state().positions,before.positions);assert.equal(f.calls.quote,0);assert.ok(f.records.some(r=>r.kind==='trader-held-evaluation'));assert.equal(f.bridge.ready(f.candidateMint),true,'financial capacity does not invalidate independent market evidence');
});

test('pending buys occupy capacity without cancellation or unneeded candidate preparation',async t=>{
 const f=capacityFixture(t);f.reserve();const before=f.ledger.state();assert.equal(f.bridge.ready(f.candidateMint),true);assert.equal(assessPredictiveBuying(f.features(),f.at()).status,'not-rejected');assert.equal(f.bridge.qualificationProof(f.candidateMint),null);
 assert.deepEqual(await f.bridge.candidate(f.candidateMint,true),{kind:'capacity-refused'});assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.calls,{preparation:0,quote:0,proof:0,protection:0});const refusal=f.records.find(r=>r.kind==='native-paper-entry-unavailable')!.data;assert.equal(refusal.pendingBuyOrders,1);assert.equal(refusal.heldPositions,0);assert.equal(refusal.existingFinancialActionsPreserved,true);
});

test('a free concurrent-stage slot still permits preparation and feature-only assessment without forcing a fill',async t=>{
 const f=capacityFixture(t,true);f.hold();const held=f.ledger.state().positions[f.heldMint];assert.ok(f.bridge.qualificationProof(f.candidateMint));assert.equal((await f.bridge.candidate(f.candidateMint,true)).kind,'evaluated');assert.equal(f.calls.preparation,1);assert.equal(f.calls.proof,1);assert.equal(f.calls.quote,1);assert.ok(f.calls.protection>=1);assert.deepEqual(f.ledger.state().positions[f.heldMint],held);assert.equal(f.ledger.state().positions[f.candidateMint],undefined);assert.deepEqual(f.ledger.state().pending,{});assert.ok(f.records.some(r=>r.kind==='trader-predictive-assessment'&&r.data.status==='not-rejected'));assert.equal(f.records.some(r=>r.kind==='native-paper-entry-unavailable'),false);
});
