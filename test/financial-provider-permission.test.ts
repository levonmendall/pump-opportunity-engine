/** Independent OFFLINE permission regression. Real NativePaper/Ledger/Trader,
 * synthetic fresh liquidation contexts; no provider or operating account. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PaperLedger} from '../src/ledger.js';
import {NativePaper} from '../src/native-paper.js';
import {resolvePilotStage} from '../src/pilot.js';
import {nativePaperFinancialProviderAvailable} from '../src/run-native-paper.js';

function fixture(t:TestContext,legacy=false,held=true){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-provider-permission-'));
 const ledger=new PaperLedger(join(root,'fixture.sqlite'),'poe-pilot-independent-provider-permission');
 let at=Date.parse('2026-10-29T04:00:00Z'),ordinaryUntil=0,restrictionUntil=0,missing=false;
 const records:Array<{kind:string;data:any}>=[];
 const price=()=>({at,microUsdPerSol:'100000000',source:'OFFLINE synthetic USD100/SOL'});
 const marks=()=>Object.fromEntries(Object.values(ledger.state().positions).map(p=>[p.mint,{at,pricedBaseUnits:p.units,netLamports:(BigInt(p.entryLamports)+BigInt(p.entryGas)).toString(),evidence:'OFFLINE fresh exact-size liquidation context'}]));
 ledger.initialize(price(),at);
 const market:any={context:async()=>({price:price(),marks:missing?{}:marks(),...(Object.keys(ledger.state().positions).length?{sourceValidUntil:at+30000}:{})}),quote:async()=>null,executionQuote:async()=>null,registerPool(){},retirementReady(){return true;}};
 const bridge=new NativePaper({ledger,market,binding:resolvePilotStage('two').binding,operatingFinancialReadiness:true,fixtureAccountBinding:{accountId:ledger.state().accountId,inceptionAt:ledger.state().inceptionAt},source:{snapshot:()=>null,usage:()=>({dataContract:'confirmed-program-activity-v3-shadow',connected:true,stopped:false,fatal:null,lastFreshSupportAt:at,lastBankClockAt:at})}as any,certificate:()=>null,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),now:()=>at,admitNewRisk:()=>false,admitFinancialReadiness:()=>legacy?ordinaryUntil<=at:nativePaperFinancialProviderAvailable(at,Object.keys(ledger.state().positions).length>0,true,{closed:false,fatal:null,cooldownUntil:ordinaryUntil,protectionRecovery:{providerRestrictionUntil:restrictionUntil}})});
 const initialize=async()=>{
  await bridge.protection();assert.equal(ledger.state().controls.entriesEnabled,true);
  if(held){
   bridge.allocated({baseMint:'fixture-token',pool:'fixture-pool',signature:'fixture-migration',slot:1,chainBlockTime:Math.floor((at-600000)/1000)}as any);
   ledger.order({id:'fixture-entry',side:'buy',mint:'fixture-token',decidedAt:at,executeAt:at+1000,expiresAt:at+5000,gas:'7000',deposit:'0',maxSpend:'10000000',minReceive:'1000',decisionEvidence:'OFFLINE controlled initial entry'},price(),{});at+=1000;
   assert.equal(ledger.attempt('fixture-fill','fixture-entry',at,{at,evidence:'OFFLINE controlled initial fill',spendLamports:'10000000',receiveUnits:'1000'},price(),{}).status,'filled');
   await bridge.protection();
  }
  bridge.trader.pauseNewEntries('completed PAPER protection gap exceeded research boundary');
 };
 t.after(()=>{ledger.close();rmSync(root,{recursive:true,force:true});});
 return {ledger,bridge,records,initialize,price,marks,tick:async()=>{at+=2000;await bridge.protection();},get at(){return at;},set ordinaryUntil(v:number){ordinaryUntil=v;},set restrictionUntil(v:number){restrictionUntil=v;},set missing(v:boolean){missing=v;}};
}

test('actual held protection can complete strict recovery despite recurring candidate-only timeout backoff',async t=>{
 for(const legacy of [true,false])await t.test(legacy?'old coupled admission':'held explicit-restriction admission',async st=>{
  const f=fixture(st,legacy);await f.initialize();const initial=f.ledger.state(),started=f.at;let recoveredAt:number|null=null;
  for(let i=0;i<65;i++){
   // Models the exact ordinary primary backoff read by the launcher: an
   // unrelated incident every20s, while actual held contexts remain complete.
   if(i%10===0)f.ordinaryUntil=f.at+7000;
   await f.tick();if(f.ledger.state().controls.entriesEnabled&&recoveredAt===null)recoveredAt=f.at;
  }
  const current=f.ledger.state(),recoveries=f.records.filter(r=>r.kind==='native-paper-financial-readiness-recovered'&&r.data.technicalProtectionRecovery);
  assert.equal(current.controls.entriesEnabled,!legacy);
  if(legacy){assert.equal(recoveredAt,null);assert.equal(recoveries.length,0);}
  else{assert.ok(recoveredAt!==null&&recoveredAt-started>=60000);assert.equal(recoveries.length,1);const proof=recoveries[0]!.data.technicalProtectionRecovery;assert.ok(proof.completedAt-proof.startedAt>=60000);assert.ok(proof.maximumCompletedGapMs<=4000);assert.deepEqual(proof.positionUnits,{'fixture-token':'1000'});assert.equal(recoveries[0]!.data.orderCreated,false);assert.equal(recoveries[0]!.data.candidateWindowClaimed,false);}
  assert.deepEqual(current.positions,initial.positions);assert.deepEqual(current.pending,{});assert.equal(current.lamports,initial.lamports);assert.equal(current.executionCosts,initial.executionCosts);assert.equal(f.records.filter(r=>r.kind==='trader-held-evaluation'&&r.data.usable).length,66);
 });
});

test('cash inventory retains ordinary provider backoff and cannot invent held recovery credit',async t=>{
 const f=fixture(t,false,false);await f.initialize();const initial=f.ledger.state();
 for(let i=0;i<65;i++){if(i%10===0)f.ordinaryUntil=f.at+7000;await f.tick();}
 assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.deepEqual(f.ledger.state().positions,{});assert.equal(f.ledger.state().lamports,initial.lamports);assert.equal(f.records.filter(r=>r.kind==='trader-held-evaluation').length,0);
});

test('actual provider restriction resets the recovery interval even with complete fresh held contexts',async t=>{
 const f=fixture(t);await f.initialize();const started=f.at;let restrictionEnded=0,recoveredAt:number|null=null;
 for(let i=0;i<75;i++){
  if(i===10){restrictionEnded=f.at+12000;f.restrictionUntil=restrictionEnded;}
  await f.tick();if(f.at<restrictionEnded)assert.equal(f.ledger.state().controls.entriesEnabled,false);
  if(f.ledger.state().controls.entriesEnabled&&recoveredAt===null)recoveredAt=f.at;
 }
 assert.ok(recoveredAt!==null&&recoveredAt>=restrictionEnded+60000&&recoveredAt>started+60000);
 assert.equal(f.records.filter(r=>r.kind==='native-paper-financial-readiness-recovered'&&r.data.technicalProtectionRecovery).length,1);
});

test('held provider admission cannot override owner stop or missing liquidation evidence',async t=>{
 for(const failure of ['owner-stop','missing-marks']as const)await t.test(failure,async st=>{
  const f=fixture(st);await f.initialize();const initial=f.ledger.state();
  for(let i=0;i<45;i++){
   if(i===8){if(failure==='owner-stop')f.ledger.safeStop('owner-stop:OFFLINE-independent',f.at);else f.missing=true;}
   if(i%10===0)f.ordinaryUntil=f.at+7000;await f.tick();
  }
  assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.ledger.state().controls.stopRequested,failure==='owner-stop');assert.deepEqual(f.ledger.state().positions,initial.positions);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().lamports,initial.lamports);
 });
});
