/** OFFLINE, disposable ledger and explicitly synthetic bank/Clock/flow. Uses
 * retained supported account bytes and real SDK pricing adapters, never a live
 * opportunity, provider, account file, funded signer or profitability claim. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,type UsdPrice} from '../src/ledger.js';
import {POE_OPERATING_ACCOUNT} from '../src/poe-operating-account.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION} from '../src/paper-epoch.js';
import {PAPER_V3_EQUITY_RISK_VERSION} from '../src/paper-equity-risk.js';
import {LIQUIDITY_RESILIENT_PILOT_BINDING} from '../src/pilot-contract.js';
import {LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION} from '../src/liquidity-resilient-momentum-v3.js';
import {PilotMarket} from '../src/pilot-market.js';
import {NativePaper,nativePaperDerivedEntryBlocker} from '../src/native-paper.js';
import {FlowWindow,type NormalizedTrade} from '../src/strategy.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {decodeMigrationIdentity} from '../src/migration-identity.js';
import {parseNativePaperArgs,nativePaperConfigurationSha256,resolveNativePaperStrategy} from '../src/run-native-paper.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';
import type {PoolWireAccount} from '../src/pool.js';

async function fixture(t:TestContext,v3=true){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-v3-native-')),path=join(directory,'fixture.sqlite'),backups=join(directory,'backups');mkdirSync(backups,{mode:0o700});
 let at=Date.parse('2026-10-30T18:00:00Z'),ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId),closed=false;
 const oldNow=Date.now;Date.now=()=>at;
 const price=(when=at):UsdPrice=>({at:when,microUsdPerSol:'100000000',source:'OFFLINE synthetic USD100/SOL'});
 ledger.initialize(price(POE_OPERATING_ACCOUNT.inceptionAt),POE_OPERATING_ACCOUNT.inceptionAt);ledger.activateEquityRiskPolicy(at);ledger.reconcile('fixture-current-day',at,price(),{});
 at+=100;await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price()},()=>at);
 if(v3){at+=100;await ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price()},()=>at);}
 at=Math.ceil(at/10000)*10000;const openedAt=at;
 const run='2026-10-26T19-57-35.882Z',proof=JSON.parse(readFileSync('evidence/integration-proof-'+run+'.json','utf8')),
  rows=readFileSync('evidence/integration-'+run+'.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line)),state=rows.find(row=>row.kind==='pool-state').data,
  origin=rows.find(row=>row.kind==='migration-transaction').data;
 const decoded=decodeMigrationIdentity(origin,{signature:origin.transaction.signatures[0],commitment:'finalized',availableAt:at});assert.equal(decoded.ok,true);if(!decoded.ok)throw Error('retained fixture origin');
 const identity=decoded.identity,mint=proof.quote.mint as string,accounts=new Map<string,PoolWireAccount>(state.addresses.map((address:string,i:number)=>[address,structuredClone(state.value[i])])),calls:string[]=[],records:Array<{kind:string;data:any}>=[];
 let slot=state.context.slot+100,quoteMissing=false,audit=true,bridge!:NativePaper,market!:PilotMarket;
 const reserve=(amount:bigint)=>{const address=state.addresses[6],wire=structuredClone(accounts.get(address)!),bytes=Buffer.from(wire.data[0],'base64');bytes.writeBigUInt64LE(amount,64);wire.lamports=Number(amount+bytes.readBigUInt64LE(113));wire.data[0]=bytes.toString('base64');accounts.set(address,wire);slot++;};reserve(20000000000n);
 const window=new FlowWindow(mint,openedAt);
 const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push(method);assert.ok(['getMultipleAccounts','getMinimumBalanceForRentExemption','getBlockTime'].includes(method),'read-only fixture request only');if(quoteMissing&&method==='getMultipleAccounts')throw Error('OFFLINE unavailable pool quote');if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0]))as T;if(method==='getBlockTime')return Math.floor(at/1000)as T;const clock=Buffer.alloc(40);clock.writeBigUInt64LE(BigInt(slot));clock.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);return {context:{slot},value:(params[0]as string[]).map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?{owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0,data:[clock.toString('base64'),'base64']}:structuredClone(accounts.get(address)??null))}as T;}};
 const source={snapshot(name:string,when=at){return name!==mint?null:{scope:{mint,pool:identity.pool},dataContract:'confirmed-program-activity-v3-shadow',openedAt,connectionId:1,subscription:5,connected:true,sourceSupportFresh:true,hasQualityLoss:false,features:window.features(when)};},usage(){return {dataContract:'confirmed-program-activity-v3-shadow',connected:true,stopped:false,fatal:null,lastFreshSupportAt:at,lastBankClockAt:at-1000};}};
 const certificate=(name:string,when=at)=>{if(!audit||name!==mint)return null;const f=window.features(when);return {schemaVersion:1 as const,mint,pool:identity.pool,dataContract:'confirmed-program-activity-v3-shadow' as const,openedAt,connectionId:1,subscriptionId:5,windowStartAt:f.windowStartAt,windowEndAt:f.windowEndAt,auditAvailableAt:when,admittedAt:when,deadlineAt:f.windowEndAt+9999,notificationCompletenessVerified:true,executedFlowCompletenessVerified:true,featuresSha256:nativePaperFeaturesSha256(f)};};
 const compose=(restoredPools?:ReturnType<NativePaper['poolsForRecovery']>)=>{
  market=new PilotMarket({rpc,inventory:()=>ledger.state(),price,now:()=>at,executionRealism:true,recorder:{record:(kind,data)=>records.push({kind,data:structuredClone(data)})},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'OFFLINE explicit realistic modeled fees'}});
  bridge=new NativePaper({ledger,market,binding:LIQUIDITY_RESILIENT_PILOT_BINDING,executionRealism:true,operatingFinancialReadiness:true,source:source as any,certificate,now:()=>at,record:(kind,data)=>records.push({kind,data:structuredClone(data)}),admitNewRisk:()=>true,admitFinancialReadiness:()=>true,restoredPools});
 };
 compose();bridge.allocated(identity);bridge.opened({mint,at});
 t.after(()=>{if(!closed)ledger.close();Date.now=oldNow;rmSync(directory,{recursive:true,force:true});});
 return {mint,calls,records,price,reserve,window,source,get at(){return at;},set at(value:number){at=value;slot++;},get ledger(){return ledger;},get bridge(){return bridge;},get market(){return market;},set audit(value:boolean){audit=value;},set quoteMissing(value:boolean){quoteMissing=value;},
  warm(){for(let n=0;n<6;n++){at=openedAt+n*10000+100;slot++;const trade:NormalizedTrade={mint,wallet:'OFFLINE independent actor-'+n,side:'buy',quoteLamports:'500000000',tokenUnits:String(1000000-n*20000),receivedAt:at,commitment:'confirmed',slot,identity:{signature:'OFFLINE native trade-'+n,instructionIndex:0,eventIndex:0}};window.ingest(trade);bridge.trade({trade,evidence:{trader:trade.wallet,eventBytesSha256:String(n).repeat(64),userBaseTokenReserveUnits:'0',reserveObservation:{baseReserveUnits:'1000000000000',rawQuoteReserveLamports:'20000000000',virtualQuoteReserveLamports:'0'}}as any,validatedAt:at,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});}at=openedAt+60000;slot++;},
  restart(){const pools=bridge.poolsForRecovery();ledger.close();ledger=new PaperLedger(path,POE_OPERATING_ACCOUNT.accountId);compose(pools);},close(){ledger.close();closed=true;}};
}

test('V3 native lifecycle uses all four audited assessments, exact SDK execution and durable profit protection across restart',async t=>{
 const f=await fixture(t);f.warm();assert.equal(f.ledger.v3RiskPolicyActive(),true);assert.equal(f.bridge.ready(f.mint,f.at),true);
 const before=f.calls.length,assessment=f.bridge.candidateAssessment(f.mint,f.bridge.trader.candidateFeatures(f.mint,f.at)!,f.at);assert.equal(assessment.status,'not-rejected');assert.equal(assessment.components?.rawBuyerCount,6);assert.equal(assessment.components?.reserveStability.observations,0,'prequote reserve-economics remain unqualified');assert.equal(f.calls.length,before,'audited flow assessment adds no provider work');
 const result=await f.bridge.candidate(f.mint,true);assert.equal(result.kind,'evaluated',JSON.stringify(f.records.slice(-8)));const order=Object.values(f.ledger.state().pending)[0]!;assert.equal(order?.side,'buy',JSON.stringify({decisions:f.bridge.trader.decisions(),market:f.market.usage(),events:f.records.slice(-16)}));assert.equal(order.entryStrategy?.version,LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION);assert.equal(BigInt(order.maxSpend)+BigInt(order.gas),500000000n);
 const decision=f.records.filter(row=>row.kind==='trader-decision'&&row.data.stage==='qualified').at(-1)!;assert.ok(decision);assert.equal(decision.data.adaptiveComponents.rawBuyerCount,6);assert.equal(decision.data.adaptiveComponents.externalSellerInventory,'UNKNOWN');assert.ok(decision.data.adaptiveComponents.reserveStability.observations>0);
 f.at=Math.max(f.at+1500,order.executeAt);await f.bridge.protection();assert.equal(Object.keys(f.ledger.state().positions).length,1);assert.equal(f.ledger.state().executionCosts,'7000');assert.equal(f.ledger.state().positions[f.mint]!.executionModelVersion,'paper-chain-conditioned-v1');
 f.reserve(25000000000n);f.at+=1000;await f.bridge.protection();const held=f.ledger.state().positions[f.mint]!,floor=held.strategy?.profitProtectionFloorLamports;assert.ok(floor&&BigInt(floor)>BigInt(held.entryLamports)+BigInt(held.entryGas));assert.deepEqual(f.ledger.state().pending,{});
 f.restart();f.at+=1000;await f.bridge.protection();assert.ok(BigInt(f.ledger.state().positions[f.mint]!.strategy!.profitProtectionFloorLamports!)>=BigInt(floor));
 f.reserve(21000000000n);f.at+=1000;await f.bridge.protection();const exit=Object.values(f.ledger.state().pending)[0]!;assert.equal(exit?.side,'sell');assert.ok(f.bridge.trader.decisions().some(d=>d.stage==='exit-reserved'&&d.reason.startsWith('v3-')));
 f.at=Math.max(f.at+1500,exit.executeAt);await f.bridge.protection();assert.deepEqual(f.ledger.state().positions,{});assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.state().executionCosts,'14000');assert.equal(f.ledger.state().paperEpoch?.id,'poe-paper-10sol-v3-20261030');assert.equal(f.ledger.state().equityRisk?.version,PAPER_V3_EQUITY_RISK_VERSION);assert.ok(f.records.some(row=>row.kind==='trader-held-evaluation'&&row.data.usable&&row.data.liquidityResilientHolding));assert.ok(f.calls.every(method=>!['sendTransaction','simulateTransaction'].includes(method)));
});

test('V3 runtime refuses preepoch financial permission and incomplete audit without substituting V2',async t=>{
 const f=await fixture(t,false);f.warm();const before=f.calls.length;assert.equal((await f.bridge.candidate(f.mint,true)).kind,'capacity-refused');assert.equal(f.calls.length,before);assert.deepEqual(f.ledger.state().pending,{});assert.equal(f.ledger.v3RiskPolicyActive(),false);
 const state=f.ledger.state(),projection=f.ledger.projection(f.at,f.price(),{});assert.equal(nativePaperDerivedEntryBlocker({at:f.at,state,projection,safety:f.bridge.trader.entryReadinessSafety(),requireV3Policy:true}),'POE_ENTRY_RISK_POLICY_REQUIRED');
 f.audit=false;assert.equal(f.bridge.ready(f.mint,f.at),false);assert.equal(f.bridge.candidateAssessment(f.mint,f.bridge.trader.candidateFeatures(f.mint,f.at)!,f.at).status,'unavailable');
});

test('V3 CLI and immutable binding select exact version, four deep slots and no policy position cap',()=>{
 const args=parseNativePaperArgs(['--resume','--directory','/OFFLINE-only','--input','/OFFLINE-only','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION,'--service','--stage','two','--strategy',LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION]),selected=resolveNativePaperStrategy(args.stage,args.strategy);
 assert.equal(args.deepSlots,4);assert.equal(args.strategy,LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION);assert.equal(selected.binding.maxPositions,null);assert.equal(selected.contract.version,LIQUIDITY_RESILIENT_MOMENTUM_V3_VERSION);assert.notEqual(nativePaperConfigurationSha256(args),nativePaperConfigurationSha256({...args,strategy:'adaptive-momentum-v2'}));assert.throws(()=>nativePaperConfigurationSha256({...args,deepSlots:3}),/FOUR_DEEP_SLOTS/);
});

test('continuous audited trade evidence follows the current flow window rather than imposing a hidden two-minute volume cap',async t=>{
 const f=await fixture(t),from=f.at;
 // More than4096 total events, always fewer than4096 in the actual closed60s
 // plus partial10s window. Both native/trader feature owners receive every row.
 for(let n=0;n<4500;n++){
  f.at=from+n*20;
  const trade:NormalizedTrade={mint:f.mint,wallet:'OFFLINE actor-'+n%20,side:'buy',quoteLamports:'1000000',tokenUnits:'1000',receivedAt:f.at,commitment:'confirmed',slot:n+1,identity:{signature:'OFFLINE sustained-'+n,instructionIndex:0,eventIndex:0}};
  f.window.ingest(trade);f.bridge.trade({trade,evidence:{}as any,validatedAt:f.at,dataContract:'confirmed-program-activity-v3-shadow',transferCrossCheck:'UNAVAILABLE'});
 }
 f.at=Math.floor(f.at/10000)*10000+10000;
 const features=f.bridge.trader.candidateFeatures(f.mint,f.at)!;
 assert.equal(features.sufficientlyObserved,true);assert.equal(features.qualityReason,null);assert.ok(features.tradeCount<4096);assert.equal(f.bridge.ready(f.mint,f.at),true);
 assert.equal(f.bridge.candidateAssessment(f.mint,features,f.at).status,'not-rejected');assert.ok(!f.records.some(row=>row.kind==='trader-input'&&row.data.reason==='V3_COMPLETE_TRADE_RETENTION_UNAVAILABLE'));assert.deepEqual(f.calls,[],'no provider work was added for retained flow');
});

test('twelve owned positions do not consume the four V3 deep/deposit slots through the retired legacy plus-three cap',async t=>{
 const f=await fixture(t),trader=f.bridge.trader;
 const marked=()=>Object.fromEntries(Object.values(f.ledger.state().positions).map(p=>[p.mint,{at:f.at,pricedBaseUnits:p.units,netLamports:p.entryLamports,evidence:'OFFLINE actual synthetic position mark'}]));
 for(let n=0;n<12;n++){
  f.at+=1000;const marks=marked();f.ledger.reconcile('fixture-many-reconcile-'+n,f.at,f.price(),marks);const state=f.ledger.state();
  f.ledger.resume('fixture-many-ready-'+n,f.at,f.price(),marks,{version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE explicit coherent synthetic inventory',accountId:state.accountId,stateRevision:state.revision,reconciledAt:state.daily.reconciledAt,positionUnits:Object.fromEntries(Object.values(state.positions).map(p=>[p.mint,p.units])),source:{kind:n?'complete-held-liquidation-context':'selected-native-support',bankClockAt:f.at-1000,receivedAt:f.at,validUntil:f.at+29000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true});
  const mint='OFFLINE owned-'+n,id='fixture-many-buy-'+n;assert.ok('reserved'in f.ledger.order({id,side:'buy',mint,decidedAt:f.at,executeAt:f.at+500,expiresAt:f.at+3000,gas:'7000',deposit:'0',maxSpend:'1000000',minReceive:'1',decisionEvidence:'OFFLINE direct accounting fixture only'},f.price(),marks));
  f.at+=500;assert.equal(f.ledger.attempt('fixture-many-fill-'+n,id,f.at,{at:f.at,spendLamports:'1000000',receiveUnits:'100',evidence:'OFFLINE synthetic exact-size fill'},f.price(),marked()).status,'filled');
  assert.equal(trader.admit({mint,migrationAt:f.at-600000,migrationVerified:true,supportedPool:true,evidence:'OFFLINE owned candidate identity'}),true);trader.setPilotEntryDeposit('0','OFFLINE actual zero-deposit fixture',mint);
 }
 for(let n=0;n<3;n++){const mint='OFFLINE fresh deep-'+n;assert.equal(trader.admit({mint,migrationAt:f.at-600000,migrationVerified:true,supportedPool:true,evidence:'OFFLINE new deep identity'}),true);trader.setPilotEntryDeposit('0','OFFLINE actual zero-deposit fixture',mint);}
 assert.equal(Object.keys(f.ledger.state().positions).length,12);assert.equal(trader.admit({mint:'OFFLINE fifth deep',migrationAt:f.at-600000,migrationVerified:true,supportedPool:true,evidence:'OFFLINE above genuinefourdeepcapacity'}),false,'the existing actual four-deep cap remains');
});
