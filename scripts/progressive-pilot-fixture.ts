/** Offline composition only. Captured account bytes are placed in an explicitly
 * synthetic shared bank; clocks, flow, USD and reserve shocks are fixtures.
 * Never opens the live pilot/production account or a network connection. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {PaperLedger,type UsdPrice} from '../src/ledger.js';
import {PaperTrader} from '../src/trader.js';
import {PilotMarket} from '../src/pilot-market.js';
import {FinancialBackupStore} from '../src/backup.js';
import {PILOT_CONTRACT_SHA256,PILOT_VERSION,CONCURRENT_PILOTS,type PilotBinding} from '../src/pilot-contract.js';
import type {PoolWireAccount} from '../src/pool.js';

const MIB=1024*1024;
const SOURCES=[
 ['evidence','2026-10-26T19-57-35.882Z'],
 ['evidence','2026-10-26T19-42-16.130Z'],
 ['evidence','2026-10-26T23-32-41.255Z'],
 ['evidence/free-data-20261027/discovery/evidence','2026-10-27T01-15-44.429Z'],
] as const;
type Phase={stage:string;positions:number;candidates:number;pending:number;physicalRequests:number;executionCostsLamports:string;at:number;details:Record<string,unknown>};

export async function runProgressivePilotFixture(){
 const retained=SOURCES.map(([directory,run])=>{
  const proof=JSON.parse(readFileSync(`${directory}/integration-proof-${run}.json`,'utf8'));
  const rows=readFileSync(`${directory}/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  return {proof,state:rows.find(r=>r.kind==='pool-state').data};
 });
 const mints=retained.map(r=>String(r.proof.quote.mint));assert.equal(new Set(mints).size,4);
 const accounts=new Map<string,PoolWireAccount|null>();
 // Use one explicitly selected set of shared config bytes for all fixture
 // computations. These captures were not a simultaneous observed bank.
 for(const r of retained)for(let i=0;i<7;i++)if(!accounts.has(r.state.addresses[i]))accounts.set(r.state.addresses[i],structuredClone(r.state.value[i]));
 const syntheticLiquidityChanges:Array<{mint:string;vault:string;originalAccountSha256:string;beforeLamports:string;afterLamports:string}>=[];
 const setQuoteVault=(r:typeof retained[number],amount:bigint,recordChange=false)=>{
  const vault=String(r.state.addresses[6]),wire=structuredClone(accounts.get(vault))!;
  const bytes=Buffer.from(wire.data[0],'base64'),before=bytes.readBigUInt64LE(64);
  if(recordChange)syntheticLiquidityChanges.push({mint:r.proof.quote.mint,vault,originalAccountSha256:createHash('sha256').update(bytes).digest('hex'),beforeLamports:before.toString(),afterLamports:amount.toString()});
  bytes.writeBigUInt64LE(amount,64);
  // This fixture quote mint is WSOL. Keep its native balance/rent relation
  // coherent while changing only the disposable in-memory account copy.
  assert.equal(bytes.readUInt32LE(109),1);wire.lamports=Number(amount+bytes.readBigUInt64LE(113));assert.ok(Number.isSafeInteger(wire.lamports));
  wire.data[0]=bytes.toString('base64');accounts.set(vault,wire);
 };
 let at=Math.ceil(Math.max(...retained.map(r=>Date.parse(r.proof.quote.validatedAt)))/10000)*10000;
 let slot=Math.max(...retained.map(r=>Number(r.state.context.slot))),outage=false;
 const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-progressive-')),db=join(directory,'fixture.sqlite'),id='poe-pilot-disposable-progressive-fixture';
 let ledger=new PaperLedger(db,id),closed=false;
 const actualNow=Date.now;Date.now=()=>at;
 const inceptionAt=at,price=():UsdPrice=>({microUsdPerSol:'1000000000',at,source:'DISPOSABLE synthetic USD1000/SOL; not an economic measurement'});
 const calls:Array<{method:string;at:number;addresses:number}>=[],events:Array<{kind:string;at:number;mint?:string;reason?:string}>=[],phases:Phase[]=[];
 let totalEntries=0,totalExits=0,maxPositions=0,maxPending=0,maxCandidates=0,currentCandidates=0,maxHeldGap=0,unavailable=0,maxAggregateCost=0n;
 const lastHeldAt=new Map<string,number>(),heldEvaluationGaps:Array<{mint:string;at:number;gapMs:number}>=[];
 const recorder={record(kind:string,data:unknown){
  if(events.length>=5000)throw Error('FIXTURE_EVENT_LIMIT');
  if(kind.startsWith('trader-')){const d=data as any;events.push({kind,at,mint:d?.mint,reason:d?.reason});
   if(kind==='trader-held-evaluation'){if(d.usable){const previous=lastHeldAt.get(d.mint);if(previous!==undefined){const gapMs=d.completedAt-previous;heldEvaluationGaps.push({mint:d.mint,at:d.completedAt,gapMs});maxHeldGap=Math.max(maxHeldGap,gapMs);}lastHeldAt.set(d.mint,d.completedAt);}else unavailable++;}
  }
 }};
 const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
  assert.ok(['getMultipleAccounts','getBlockTime','getMinimumBalanceForRentExemption'].includes(method),'fixture has no network/transaction method');
  assert.ok(calls.length<500,'bounded offline fixture request trace');calls.push({method,at,addresses:method==='getMultipleAccounts'?(params[0]as string[]).length:0});
  if(outage)throw Error('DISPOSABLE_FIXTURE_RPC_OUTAGE');
  if(method==='getBlockTime')return Math.floor(at/1000)as T;
  if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0]))as T;
  const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
  const clock:PoolWireAccount={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};
  return {context:{slot},value:(params[0]as string[]).map(a=>a===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(a)??null))}as T;
 }};
 const single:PilotBinding={version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1};
 const binding=(n:2|3):PilotBinding=>n===2?{version:CONCURRENT_PILOTS[2].contract.version,stage:2,contractSha256:CONCURRENT_PILOTS[2].contractSha256,maxPositions:2}:{version:CONCURRENT_PILOTS[3].contract.version,stage:3,contractSha256:CONCURRENT_PILOTS[3].contractSha256,maxPositions:3};
 let market!:PilotMarket,trader!:PaperTrader,version:string=PILOT_VERSION;
 const compose=(policy:PilotBinding)=>{
  version=policy.version;currentCandidates=0;
  market=new PilotMarket({rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder,gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE frozen7000lamport execution assumption'}});
  for(const r of retained)market.registerPool({mint:r.proof.quote.mint,migrationVerified:true,migrationSlot:r.proof.origin.slot,evidence:'retained pool identity; synthetic current bank and migration age'});
  const context=async(positions:Parameters<PilotMarket['context']>[0],signal:AbortSignal)=>market.context(positions,signal);
  trader=new PaperTrader({ledger,now:()=>at,context,quote:market.quote,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'DISPOSABLE frozen pilot fees and current fixture rent'},recorder,flowVerification:{verified:true,evidence:'DISPOSABLE complete synthetic curve trades; not live field evidence'},experimentalPilot:policy,pilotExecution:{context,quote:market.executionQuote}});
  trader.start();
 };
 const observe=()=>{
  const s=ledger.state();maxPositions=Math.max(maxPositions,Object.keys(s.positions).length);maxPending=Math.max(maxPending,Object.keys(s.pending).length);maxCandidates=Math.max(maxCandidates,currentCandidates);const cost=Object.values(s.positions).reduce((n,p)=>n+BigInt(p.costMicroUsd),0n);maxAggregateCost=cost>maxAggregateCost?cost:maxAggregateCost;assert.ok(cost<=150000000n,'existing aggregate position-cost limit preserved');
 };
 const tick=async(evaluateCandidates=false,mint?:string)=>{
  const before=trader.funnel.paperFilled,beforeExit=trader.funnel.exited;
  await trader.tick({evaluateCandidates,...(mint?{candidateMint:mint}:{}),maximumDueActions:1});
  totalEntries+=trader.funnel.paperFilled-before;totalExits+=trader.funnel.exited-beforeExit;
  observe();
 };
 const recordPhase=(stage:string,details:Record<string,unknown>={})=>{const s=ledger.state();phases.push({stage,positions:Object.keys(s.positions).length,candidates:currentCandidates,pending:Object.keys(s.pending).length,physicalRequests:calls.length,executionCostsLamports:s.executionCosts,at,details});};
 const ready=async()=>{const c=await market.context(ledger.state().positions,new AbortController().signal);ledger.reconcile('fixture-ready-reconcile:'+ledger.state().revision,at,price(),c.marks);const result=ledger.resume('fixture-ready:'+ledger.state().revision,at,price(),c.marks,{version,evidence:'DISPOSABLE chronological fixture readiness',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});assert.equal(result.enabled,true);};
 const admit=async(mint:string)=>{
  assert.ok(trader.admit({mint,migrationAt:at-300000,migrationVerified:true,supportedPool:true,evidence:'DISPOSABLE discovery callback + retained supported identity; migration age is synthetic'}));currentCandidates++;
  const plan=await market.prepareEntryCosts(mint,new AbortController().signal);trader.setPilotEntryDeposit(plan.depositLamports,plan.evidence,mint);trader.activateFlow(mint,'DISPOSABLE continuously collected complete fixture window');observe();
 };
 const warm=async(selected:string[],manageHeld:boolean)=>{
  const start=Math.ceil((at+10000)/10000)*10000,end=start+60000;let bin=0,nextProtection=manageHeld?at+2000:Infinity;
  while(bin<6||nextProtection<=end){const nextTrade=bin<6?start+bin*10000+100:Infinity;at=Math.min(nextTrade,nextProtection);slot++;
   if(at===nextTrade){for(const mint of selected)trader.ingest({identity:{signature:`fixture-${mint}-${start}-${bin}`,instructionIndex:0,eventIndex:0},mint,wallet:'DISPOSABLE-buyer-'+bin,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-bin*20000),receivedAt:at,commitment:'confirmed',slot},'curve');bin++;}
   if(at===nextProtection){await tick(false);nextProtection+=2000;}
  }
  at=end;slot++;
 };
 const buy=async(mint:string)=>{
  await ready();await tick(true,mint);const order=Object.values(ledger.state().pending).find(o=>o.mint===mint&&o.side==='buy');
  assert.ok(order,'complete frozen qualifying fixture must produce an isolated pending entry: '+JSON.stringify(trader.decisions().slice(-2)));
  at=order.executeAt-1;await tick(false);assert.equal(ledger.state().positions[mint],undefined);
  at=order.executeAt;slot++;await tick(false);assert.ok(ledger.state().positions[mint]);
  trader.deactivateFlow(mint,'DISPOSABLE filled holding uses current pool state, not other traders\' flow');currentCandidates--;
 };
 const backup=async()=>{const store=new FinancialBackupStore({directory:join(directory,'backups'),sourcePath:db,identity:{accountId:id,mode:'PAPER',inceptionAt},maxBytes:16*MIB});const b=await store.create(ledger);assert.equal(store.latest().backup?.revision,b.revision);return {generation:b.generation,revision:b.revision};};
 try{
  ledger.initialize(price(),at);const initial=ledger.state();compose(single);
  await admit(mints[0]!);await warm([mints[0]!],false);await buy(mints[0]!);
  const held=structuredClone(ledger.state().positions[mints[0]!]!);assert.equal(ledger.state().executionCosts,'7000');const openBackup=await backup();
  at=held.enteredAt+900000;slot++;await tick(false);const unresolved=Object.values(ledger.state().pending).find(o=>o.side==='sell')!;assert.ok(unresolved);
  const beforeRestart=ledger.state();ledger.close();closed=true;ledger=new PaperLedger(db,id);closed=false;assert.deepEqual(ledger.state(),beforeRestart);compose(single);
  at=unresolved.executeAt;await tick(false);assert.ok(ledger.state().positions[mints[0]!]);assert.ok(ledger.state().pending[unresolved.id]);
  at=unresolved.expiresAt;slot++;await tick(false);assert.ok(ledger.state().positions[mints[0]!]);assert.equal(ledger.state().pending[unresolved.id],undefined);
  let pending=Object.values(ledger.state().pending).find(o=>o.side==='sell');if(!pending){at+=1;await tick(false);pending=Object.values(ledger.state().pending).find(o=>o.side==='sell');}assert.ok(pending);
  at=pending.executeAt;slot++;await tick(false);assert.equal(Object.keys(ledger.state().positions).length,0);assert.equal(ledger.state().executionCosts,'14000');assert.equal(totalEntries,1);assert.equal(totalExits,1);
  await tick(false);assert.equal(ledger.state().executionCosts,'14000');recordPhase('single-lifecycle-complete',{openBackup,restartPreservedEntireState:true,uncertainExitRetainedUntilExpiry:true,idempotentRepeat:true});

  // Start another genuine fixture lifecycle on a distinct mint; no re-entry.
  compose(single);await admit(mints[1]!);await warm([mints[1]!],false);await ready();await tick(true,mints[1]!);
  const refused=trader.decisions().at(-1)!;assert.equal(refused.reason,'order-size-exceeds-execution-liquidity-bound');assert.equal(Object.keys(ledger.state().pending).length,0);
  recordPhase('retained-low-liquidity-safety-refusal',{mint:mints[1],reason:refused.reason,inputLamports:refused.quote?.inputUnits,effectiveQuoteLiquidityLamports:refused.quote?.effectiveQuoteLiquidityLamports,notAFill:true});
  // The concurrency mechanics scenario uses explicitly declared100SOL quote
  // vaults for each later fixture token. Historical quiet pools are not being
  // represented as currently liquid or entry-eligible natural opportunities.
  for(const r of retained.slice(1))setQuoteVault(r,100000000000n,true);slot++;
  compose(single);await admit(mints[1]!);await warm([mints[1]!],false);await buy(mints[1]!);
  await admit(mints[2]!);await admit(mints[3]!);const positionsBeforeShadow=structuredClone(ledger.state().positions),entriesBeforeShadow=totalEntries;
  const shadowStart=at;await warm([mints[2]!,mints[3]!],true);await tick(true,mints[2]!);await tick(true,mints[3]!);
  assert.deepEqual(ledger.state().positions,positionsBeforeShadow);assert.equal(totalEntries,entriesBeforeShadow);assert.equal(Object.keys(ledger.state().pending).length,0);recordPhase('shadow-two-candidates-while-held',{syntheticDiscoveryCallbacks:2,completeSyntheticFlowTrades:12,exposureUnchanged:true,maximumCompletedExitEvaluationGapMs:Math.max(0,...heldEvaluationGaps.filter(g=>g.at>shadowStart).map(g=>g.gapMs))});

  compose(binding(2));await admit(mints[2]!);await admit(mints[3]!);await warm([mints[2]!,mints[3]!],true);await buy(mints[2]!);assert.equal(Object.keys(ledger.state().positions).length,2);recordPhase('two-held-with-one-shadow-candidate');
  compose(binding(3));await admit(mints[3]!);await warm([mints[3]!],true);await buy(mints[3]!);assert.equal(Object.keys(ledger.state().positions).length,3);recordPhase('three-held-frozen-baseline');

  // Physical outage must retain exposure and close entries, never invent marks
  // or an exit. No host/provider/network fault is induced.
  const exposed=structuredClone(ledger.state().positions);outage=true;at+=2000;await tick(false);assert.deepEqual(ledger.state().positions,exposed);assert.equal(ledger.state().controls.entriesEnabled,false);outage=false;at+=2000;slot++;await tick(false);assert.deepEqual(ledger.state().positions,exposed);recordPhase('rpc-outage-retains-three-positions',{unavailableChecks:unavailable});
  // Explicit synthetic quote-vault shock, not a captured natural price move.
  // Every sell calculation still passes the supported pool/fee/SDK decoder.
  for(const r of retained.slice(1)){const wire=accounts.get(r.state.addresses[6])!;setQuoteVault(r,Buffer.from(wire.data[0],'base64').readBigUInt64LE(64)/2n);}
  at+=2000;slot++;await tick(false);assert.equal(Object.values(ledger.state().pending).filter(o=>o.side==='sell').length,3);recordPhase('three-simultaneous-exit-reservations',{shock:'SYNTHETIC quote-vault balance halved; not natural market evidence'});
  const pendingCount=Object.keys(ledger.state().pending).length;
  while(Object.keys(ledger.state().pending).length){at=Math.max(at,Object.values(ledger.state().pending)[0]!.executeAt);slot++;const before=Object.keys(ledger.state().positions).length;await tick(false);assert.ok(before-Object.keys(ledger.state().positions).length<=1,'one pending financial action per bounded tick');}
  assert.equal(pendingCount,3);assert.equal(Object.keys(ledger.state().positions).length,0);assert.equal(totalEntries,4);assert.equal(totalExits,4);assert.equal(ledger.state().executionCosts,'56000');
  const final=ledger.state(),locked=Object.values(final.lockedDeposits).reduce((n,v)=>n+BigInt(v),0n);assert.equal(BigInt(final.lamports)+locked-BigInt(initial.lamports),BigInt(final.realizedLamports));assert.equal(final.inceptionAt,inceptionAt);
  assert.equal((ledger.exportJournal(1000)as Array<{kind:string}>).filter(r=>r.kind==='inception').length,1);assert.equal(final.daily.lossPaused,true);assert.equal(final.controls.entriesEnabled,false);const finalBackup=await backup();ledger.close();closed=true;ledger=new PaperLedger(db,id);closed=false;assert.deepEqual(ledger.state(),final,'loss pause and entire completed same-account history survive another restart');recordPhase('three-exits-reconciled',{finalBackup,lockedRentPreserved:true,dailyLossPausePreservedAcrossRestart:true,bankrollIdentity:'cash + locked deposits - initial SOL = realized SOL after all gas and pool fees'});
  const summary={schemaVersion:1,classification:'DISPOSABLE OFFLINE COMPOSITION; NOT NATURAL PAPER PERFORMANCE',networkRequests:0,productionTouched:false,pilotAccountTouched:false,account:{id,inceptionAt,initialMicroUsd:initial.initialMicroUsd,inceptionCount:1},maximumObserved:{positions:maxPositions,candidates:maxCandidates,pending:maxPending,aggregatePositionCostMicroUsd:maxAggregateCost.toString()},simulated:{entries:totalEntries,exits:totalExits,executionCostsLamports:final.executionCosts,realizedLamports:final.realizedLamports,lockedDepositLamports:locked.toString(),dailyLossPausePersisted:true},physicalFixtureRequests:{total:calls.length,maximumAccountsInCoherentBatch:Math.max(...calls.map(c=>c.addresses)),byMethod:Object.fromEntries(['getMultipleAccounts','getBlockTime','getMinimumBalanceForRentExemption'].map(m=>[m,calls.filter(c=>c.method===m).length]))},syntheticTiming:{maximumCompletedExitEvaluationGapMs:maxHeldGap,unavailableChecks:unavailable,notProviderCapacity:true,intentionalMaximumHoldTimeJumpMs:900000},syntheticLiquidityChanges,phases,limitations:['Four independently captured pools are composed in a synthetic common bank; no concurrent natural bank claimed.','The retained low-liquidity refusal remains recorded; only in-memory WSOL vault balances are increased to100SOL for the subsequent concurrency mechanics scenario.','Discovery callbacks and complete curve trades are synthetic fixtures, not provider completeness evidence.','Clock, USD valuation, availability and reserve shock are synthetic.','No real request pacing/CPU/latency/endpoint entitlement is established.','No jitter, burst or pending-action deadline capacity claim follows from zero-duration fixture RPC responses.','Natural maximum-hold/stop/profit behavior remains a separate forward question.']};
  assert.ok(Buffer.byteLength(JSON.stringify(summary))<128*1024);return summary;
 }finally{if(!closed)ledger.close();Date.now=actualNow;rmSync(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 void runProgressivePilotFixture().then(summary=>{
  const output=process.argv[2];if(output){const file=resolve(output);assert.ok(file.startsWith(resolve('evidence/progressive-pilot-20261027')+'/'));mkdirSync(resolve('evidence/progressive-pilot-20261027'),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(summary,null,2)+'\n',{mode:0o600});}
  console.log(JSON.stringify(summary,null,2));
 }).catch(e=>{console.error(e);process.exitCode=1;});
}
