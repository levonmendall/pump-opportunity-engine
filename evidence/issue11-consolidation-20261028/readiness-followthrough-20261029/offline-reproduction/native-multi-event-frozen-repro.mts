import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PaperLedger} from './frozen-financial-5e55/src/ledger.ts';
import {NativePaper} from './frozen-financial-5e55/src/native-paper.ts';
import {FlowWindow} from './frozen-financial-5e55/src/strategy.ts';
import {nativePaperFeaturesSha256} from './frozen-financial-5e55/src/native-paper-contract.ts';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from './frozen-financial-5e55/src/pilot-contract.ts';

// OFFLINE, DISPOSABLE: no source edits, provider requests, real account or trades.
const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-multi-event-'));
const accountId='poe-pilot-offline-multi-event-repro';
const base=Date.parse('2026-10-29T03:00:00Z');
const mint='So11111111111111111111111111111111111111112';
const proposedFix=process.argv.includes('--side-effect-free-slot');
let at=base,advanceDuringFirstRecord=true;
const ledger=new PaperLedger(join(directory,'fixture.sqlite'),accountId);
const originalDateNow=Date.now;
Date.now=()=>at;
const records:any[]=[];
try {
  ledger.initialize({at,microUsdPerSol:'100000000',source:'OFFLINE controlled USD'},at);
  const market:any={registerPool(){},unregisterPool(){},minimumSlot(){},quote:async()=>{throw Error('UNEXPECTED_QUOTE');},executionQuote:async()=>{throw Error('UNEXPECTED_EXECUTION');},context:async()=>{throw Error('UNEXPECTED_CONTEXT');}};
  const bridge=new NativePaper({ledger,market,fixtureAccountBinding:{accountId,inceptionAt:ledger.state().inceptionAt},binding:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},source:{usage:()=>({dataContract:'confirmed-program-activity-v3-shadow'}) as any,snapshot:()=>null},certificate:()=>null,record:(kind,data:any)=>{records.push({kind,data});if(advanceDuringFirstRecord&&kind==='trader-input'&&data.kind==='trade'){advanceDuringFirstRecord=false;at++;}},now:()=>at,admitNewRisk:()=>false});
  // /tmp-only candidate fix: source has no public hasCandidate yet. Inspect the
  // same Map directly only in this fixture; production should add that query.
  if(proposedFix)(bridge as any).slot=(mint:string,slot:number)=>{market.minimumSlot(mint,slot);if((bridge.trader as any).candidates.has(mint))bridge.trader.noteCandidateSlot(mint,slot);};
  bridge.allocated({baseMint:mint,pool:'OFFLINE-POOL',signature:'OFFLINE-ORIGIN',chainBlockTime:Math.floor((base-600000)/1000),slot:1} as any);
  bridge.opened({mint,at});
  const native=new FlowWindow(mint,at),availableAt=base+100;at=availableAt;
  const trade=(n:number)=>({identity:{signature:'OFFLINE-SHARED-PACKET',instructionIndex:0,eventIndex:n},mint,wallet:'OFFLINE-BUYER-'+n,side:'buy' as const,quoteLamports:'300000000',tokenUnits:'300000',receivedAt:availableAt,commitment:'confirmed' as const,slot:100});
  const dispatch=(n:number)=>{const row=trade(n);assert.equal(native.ingest(row),'accepted');bridge.trade({trade:row,evidence:{} as any,validatedAt:availableAt,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});};
  dispatch(0);
  let failure:string|null=null;try{dispatch(1);}catch(error){failure=String((error as Error).message);}
  assert.equal(failure,proposedFix?null:'information cannot be observed before it became available');
  assert.equal(native.usage().retainedTrades,2);
  const trades=records.filter(r=>r.kind==='trader-input'&&r.data.kind==='trade');
  assert.equal(trades.length,proposedFix?2:1);
  let completedFeaturesEqual:boolean|null=null;
  if(proposedFix){assert.equal(at,availableAt+1);assert.deepEqual(trades.map(r=>r.data.trade.receivedAt),[availableAt,availableAt]);at=base+60000;const nativeFeatures=native.features(at),bridgeFeatures=bridge.trader.candidateFeatures(mint,at)!;assert.equal(nativeFeatures.sufficientlyObserved,true);assert.equal(bridgeFeatures.sufficientlyObserved,true);completedFeaturesEqual=nativePaperFeaturesSha256(nativeFeatures)===nativePaperFeaturesSha256(bridgeFeatures);assert.equal(completedFeaturesEqual,true);}
  assert.deepEqual(ledger.state().positions,{});assert.deepEqual(ledger.state().pending,{});
  const result={classification:'OFFLINE_CONTROLLED_ACTUAL_NATIVE_PAPER_CALLBACK_REPRO',proposedFix,availableAt,firstRecordCompletedAt:availableAt+1,nativeAcceptedEvents:2,bridgeRecordedEvents:trades.length,recordedReceivedAt:trades.map(r=>r.data.trade.receivedAt),completedFeaturesEqual,error:failure,positions:0,pending:0,networkRequests:0,directory};
  writeFileSync('/tmp/poe-readiness-timing-20261029/native-multi-event-'+(proposedFix?'fixed-':'')+'result.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{ledger.close();Date.now=originalDateNow;}
