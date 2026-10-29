/** OFFLINE controlled-clock regression. Disposable fixture account only;
 * no provider requests, real account, quote, entry or execution. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PaperLedger} from '../src/ledger.js';
import {NativePaper} from '../src/native-paper.js';
import {FlowWindow,type NormalizedTrade} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {PILOT_VERSION,PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
import type {PilotMarket} from '../src/pilot-market.js';
import type {MigrationIdentity} from '../src/migration-identity.js';

test('native bridge retains every same-packet event when callback recording advances the clock',t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-native-multi-event-')),accountId='poe-pilot-native-multi-event-fixture',base=Date.parse('2026-10-29T03:00:00Z'),mint='So11111111111111111111111111111111111111112';
 const ledger=new PaperLedger(join(directory,'fixture.sqlite'),accountId);t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 let at=base,advanceDuringFirstRecord=true;ledger.initialize({at,microUsdPerSol:'100000000',source:'OFFLINE controlled USD'},at);
 const slots:number[]=[],trades:NormalizedTrade[]=[];
 const unavailable=async()=>{throw Error('OFFLINE unexpected market request');};
 const market={registerPool(){},minimumSlot(_mint:string,slot:number){slots.push(slot);},quote:unavailable,executionQuote:unavailable,context:unavailable} as unknown as PilotMarket;
 const bridge=new NativePaper({ledger,market,fixtureAccountBinding:{accountId,inceptionAt:ledger.state().inceptionAt},binding:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},source:{usage:()=>({dataContract:'confirmed-program-activity-v3-shadow'}) as any,snapshot:()=>null},certificate:()=>null,record:(kind,data)=>{const row=data as {kind?:string;trade?:NormalizedTrade};if(kind==='trader-input'&&row.kind==='trade'){trades.push(structuredClone(row.trade!));if(advanceDuringFirstRecord){advanceDuringFirstRecord=false;at++;}}},now:()=>at,admitNewRisk:()=>false});
 bridge.allocated({baseMint:mint,pool:'OFFLINE-POOL',signature:'OFFLINE-ORIGIN',chainBlockTime:Math.floor((base-600000)/1000),slot:1} as MigrationIdentity);bridge.opened({mint,at});
 assert.equal(bridge.trader.hasCandidate(mint),true);assert.equal(bridge.trader.hasCandidate('OFFLINE-UNSELECTED'),false);
 const native=new FlowWindow(mint,at),availableAt=base+100;at=availableAt;
 for(let n=0;n<2;n++){
  // Native notification admission stamps the whole validated packet once.
  const trade:NormalizedTrade={identity:{signature:'OFFLINE-SHARED-PACKET',instructionIndex:0,eventIndex:n},mint,wallet:'OFFLINE-BUYER-'+n,side:'buy',quoteLamports:'300000000',tokenUnits:'300000',receivedAt:availableAt,commitment:'confirmed',slot:100+n};
  assert.equal(native.ingest(trade),'accepted');bridge.trade({trade,evidence:{} as any,validatedAt:availableAt,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});
 }
 assert.equal(at,availableAt+1,'actual callback time advances without retiming the packet');assert.deepEqual(trades.map(r=>r.receivedAt),[availableAt,availableAt]);assert.deepEqual(slots,[100,101]);
 at=base+60000;const nativeFeatures=native.features(at),bridgeFeatures=bridge.trader.candidateFeatures(mint,at)!;assert.equal(nativeFeatures.sufficientlyObserved,true);assert.equal(bridgeFeatures.sufficientlyObserved,true);assert.equal(bridgeFeatures.tradeCount,2);assert.equal(nativePaperFeaturesSha256(bridgeFeatures),nativePaperFeaturesSha256(nativeFeatures),'both complete windows retain the exact same packet evidence');
 assert.deepEqual(ledger.state().positions,{});assert.deepEqual(ledger.state().pending,{});assert.equal(ledger.state().executionCosts,'0');
});
