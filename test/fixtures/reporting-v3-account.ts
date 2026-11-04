/** Disposable, synthetic finance for reporting regressions. Every epoch,
 * order, fill and control is produced by the ordinary ledger implementation;
 * none is operating permission or evidence about the real account. */
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,type Mark,type UsdPrice} from '../../src/ledger.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION} from '../../src/paper-epoch.js';
import {POE_OPERATING_ACCOUNT} from '../../src/poe-operating-account.js';
import {projectPilotFilledTrades} from '../../src/pilot-reporting.js';

export const reportingFixturePrice=(at:number):UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE independently timestamped USD100/SOL'});
export function retainFixtureFills(ledger:PaperLedger,at:number){
 const state=ledger.state(),journal=ledger.exportJournal(50),actionResults=new Map<string,unknown>();
 for(const raw of journal){const row=raw as {kind:string;action_id:string};if(row.kind==='attempt')actionResults.set(row.action_id,ledger.actionResult(row.action_id));}
 return ledger.recordReportingTrades(projectPilotFilledTrades({at,state,journal,actionResults}).trades);
}
export function resumeReportingFixture(ledger:PaperLedger,at:number,marks:Record<string,Mark>={}){
 const price=reportingFixturePrice(at);ledger.reconcile('report-fixture-ready:'+at,at,price,marks);const state=ledger.state();
 const readiness=state.paperEpoch?{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only' as const,evidence:'OFFLINE complete inventory and original native support clock',accountId:state.accountId,stateRevision:state.revision,reconciledAt:state.daily.reconciledAt,positionUnits:Object.fromEntries(Object.entries(state.positions).map(([mint,p])=>[mint,p.units])),source:{kind:Object.keys(state.positions).length?'complete-held-liquidation-context' as const:'selected-native-support' as const,bankClockAt:at-1000,receivedAt:at,validUntil:at+29000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true}:{version:'OFFLINE legacy reporting fixture',evidence:'OFFLINE original synthetic account readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true};
 assert.equal(ledger.resume('report-fixture-resume:'+at,at,price,marks,readiness).enabled,true);
}
export async function prepareV3ReportingAccount(ledger:PaperLedger,backupDirectory:string,at:number,heldMint?:string){
 mkdirSync(backupDirectory,{mode:0o700});ledger.initialize(reportingFixturePrice(POE_OPERATING_ACCOUNT.inceptionAt),POE_OPERATING_ACCOUNT.inceptionAt);
 ledger.activateEquityRiskPolicy(at-700000);
 for(let n=0;n<38;n++){
  const when=at-600000+n*3000,mint='OFFLINE-reporting-roundtrip-'+n,buy='report-fixture-buy-'+n,sell='report-fixture-sell-'+n;
  resumeReportingFixture(ledger,when);
  ledger.order({id:buy,mint,side:'buy',decidedAt:when,executeAt:when+500,expiresAt:when+2500,gas:'7000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'OFFLINE full publication retained round trip'},reportingFixturePrice(when),{});
  assert.equal(ledger.attempt('report-fixture-entry-'+n,buy,when+500,{at:when+500,spendLamports:'1000000',receiveUnits:'100',evidence:'OFFLINE original entry fill'},reportingFixturePrice(when+500)).status,'filled');
  ledger.order({id:sell,mint,side:'sell',decidedAt:when+501,executeAt:when+1001,expiresAt:when+2500,gas:'7000',deposit:'0',maxSpend:'0',minReceive:'1',decisionEvidence:'OFFLINE complete retained liquidation'},reportingFixturePrice(when+501),{});
  assert.equal(ledger.attempt('report-fixture-exit-'+n,sell,when+1001,{at:when+1001,spendLamports:'0',receiveUnits:'1000000',pricedBaseUnits:'100',evidence:'OFFLINE original full-size exit fill'},reportingFixturePrice(when+1001)).status,'filled');
  retainFixtureFills(ledger,when+1001);
 }
 ledger.pause('report-fixture-epoch-preparation',at-480000,'OFFLINE owner-authorized synthetic epoch preparation');
 await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory,price:reportingFixturePrice(at-470000)},()=>at-470000);
 await ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory,price:reportingFixturePrice(at-460000)},()=>at-460000);
 if(heldMint){
  resumeReportingFixture(ledger,at-5000);
  ledger.order({id:'fixture-buy',side:'buy',mint:heldMint,decidedAt:at-5000,executeAt:at-4000,expiresAt:at-1000,gas:'7000',deposit:'2000000',maxSpend:'497993000',minReceive:'900',decisionEvidence:'OFFLINE synthetic actual-size entry'},reportingFixturePrice(at-5000),{});
  assert.equal(ledger.attempt('fixture-buy-fill','fixture-buy',at-4000,{at:at-4000,spendLamports:'497993000',receiveUnits:'1000',evidence:'OFFLINE synthetic delayed fill'},reportingFixturePrice(at-4000)).status,'filled');
  retainFixtureFills(ledger,at-4000);
 }
 assert.equal(ledger.getReportingTrades().trades.length,50);
 for(let n=0;n<720;n++){const observedAt=at-720000+n*1000;ledger.recordOperatingReportingPoint({at:observedAt,tradingMicroUsd:n%50===0?null:'0',economicMicroUsd:null},observedAt);}
 return {closedRoundTrips:38,cachedFills:50,sourceHistoryPoints:ledger.getOperatingReportingHistory().points.length};
}
