/** Complete isolated pilot composition. Real retained pool account bytes are
 * combined with synthetic clocks, qualifying flow and a private PAPER-schema
 * fixture account. No network, natural entry, performance or deployment proof. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {PaperLedger,type UsdPrice} from '../src/ledger.js';
import {PilotMarket} from '../src/pilot-market.js';
import {PaperTrader} from '../src/trader.js';
import {PILOT_CONTRACT_SHA256,PILOT_VERSION} from '../src/pilot-contract.js';
import type {PoolWireAccount} from '../src/pool.js';

test('isolated pilot composes current rent, delayed coherent pricing, gap cancellation and same-account recovery',async t=>{
  const run='2026-10-26T19-41-20.717Z';
  const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
  const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const state=rows.find(row=>row.kind==='pool-state').data,mint:string=proof.quote.mint;
  const accounts=new Map<string,PoolWireAccount>(state.addresses.map((address:string,i:number)=>[address,state.value[i]]));
  const directory=mkdtempSync(join(tmpdir(),'poe-ISOLATED-pilot-integration-')),path=join(directory,'fixture.sqlite');
  const accountId='poe-pilot-integration-fixture';
  let ledger=new PaperLedger(path,accountId),at=Math.ceil(Date.parse(proof.quote.validatedAt)/10000)*10000,slot:number=state.context.slot;
  const inceptionAt=at,originalNow=Date.now;Date.now=()=>at;
  t.after(()=>{ledger.close();Date.now=originalNow;rmSync(directory,{recursive:true,force:true});});
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'ISOLATED synthetic USD; not an economic result'});
  const records:Array<{kind:string;data:any}>=[],calls:Array<{method:string;params:unknown[];at:number}>=[];
  const recorder={record(kind:string,data:unknown){records.push({kind,data:structuredClone(data)});}};
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:structuredClone(params),at});
    if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0]))as T;
    if(method==='getBlockTime')return Math.floor(at/1000)as T;
    assert.equal(method,'getMultipleAccounts','all physical operations use an explicit read-only fixture method');
    const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
    const clock:PoolWireAccount={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot},value:(params[0]as string[]).map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))}as T;
  }};
  const compose=()=>{
    const market=new PilotMarket({rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder,gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'ISOLATED simulated 5000base+2000priority'},timeoutMs:3000});
    market.registerPool({mint,migrationVerified:true,migrationSlot:proof.origin.slot,evidence:'retained real supported migration identity; current time is synthetic'});
    const trader=new PaperTrader({ledger,now:()=>at,context:market.context,quote:market.quote,costs:{gasLamports:'7000',depositLamports:'0',slippageBps:100,evidence:'ISOLATED pilot execution assumptions'},recorder,flowVerification:{verified:true,evidence:'ISOLATED normalized synthetic curve flow; not feed validation'},experimentalPilot:{version:PILOT_VERSION,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1},pilotExecution:{context:market.context,quote:market.executionQuote}});
    trader.start();return {market,trader};
  };
  const warm=(trader:PaperTrader,epoch:number)=>{
    trader.activateFlow(mint,'ISOLATED fresh complete synthetic flow collection');
    // Re-activation invalidates the inclusive boundary; use six entirely new
    // closed bins after that boundary, not a partial allegedly warmed window.
    const collectionAt=epoch+10000;
    for(let i=0;i<6;i++){
      at=collectionAt+i*10000+100;
      trader.ingest({identity:{signature:`fixture-pilot-integration-${epoch}-${i}`,instructionIndex:0,eventIndex:0},mint,wallet:`fixture-buyer-${i}`,side:'buy',quoteLamports:'300000000',tokenUnits:String(300000-i*20000),receivedAt:at,commitment:'confirmed',slot},'curve');
    }
    at=collectionAt+60000;
  };
  const ready=()=>{
    ledger.reconcile(`fixture-ready-reconcile:${ledger.state().revision}`,at,price(),{});
    const result=ledger.resume(`fixture-ready:${ledger.state().revision}`,at,price(),{},{version:PILOT_VERSION,evidence:'ISOLATED synthetic window/account readiness; not production acceptance',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
    assert.equal(result.enabled,true);
  };
  ledger.initialize(price(),at);const initial=ledger.state();
  let {market,trader}=compose();
  trader.admit({mint,migrationAt:at-300000,migrationVerified:true,supportedPool:true,evidence:'ISOLATED age eligibility; retained pool bytes do not establish this synthetic migration age'});
  const preparation=await market.prepareEntryCosts(mint,new AbortController().signal);
  assert.deepEqual(preparation.accountLengths,{base:170,quote:165});
  assert.equal(preparation.depositLamports,'2000335');
  trader.setPilotEntryDeposit(preparation.depositLamports,preparation.evidence);
  warm(trader,at);ready();await trader.tick();
  const canceled=Object.values(ledger.state().pending)[0]!;
  assert.equal(canceled.side,'buy');assert.equal(canceled.deposit,preparation.depositLamports);
  assert.equal(canceled.reserved,'500000000');
  trader.feedGap();
  assert.deepEqual(ledger.state().pending,{});assert.deepEqual(ledger.state().positions,{});
  assert.equal(ledger.state().lamports,initial.lamports);assert.equal(ledger.state().executionCosts,'0');
  assert.equal(ledger.state().controls.entriesEnabled,false);

  // A canceled entry cannot reappear from old flow. A full new collection
  // window and explicit fresh readiness precede the second fixture decision.
  at+=10000;warm(trader,at);ready();await trader.tick();
  const buy=Object.values(ledger.state().pending)[0]!;
  assert.notEqual(buy.id,canceled.id);assert.equal(buy.side,'buy');
  const preDelayCalls=calls.length;at=buy.executeAt-1;await trader.tick();
  assert.equal(ledger.state().positions[mint],undefined);assert.equal(ledger.state().executionCosts,'0');assert.equal(calls.length,preDelayCalls);
  const beforeExecution=calls.length;at=buy.executeAt;slot++;await trader.tick();
  const entryReads=calls.slice(beforeExecution),position=ledger.state().positions[mint]!;
  assert.ok(position);assert.equal(trader.funnel.paperFilled,1);
  assert.equal(entryReads.filter(c=>c.method==='getMinimumBalanceForRentExemption').length,2,'actual post-delay buy rechecks both required account rents');
  assert.ok(entryReads.every(c=>c.at>=buy.executeAt),'no pre-delay state supplies a fill');
  assert.equal(position.deposit,preparation.depositLamports);assert.equal(ledger.state().lockedDeposits[mint],preparation.depositLamports);
  assert.equal(ledger.state().executionCosts,'7000');assert.deepEqual(ledger.state().pending,{});
  const delegated=records.find(r=>r.kind==='research-held-market-delegated-entry')!;
  assert.ok(delegated.data.quoteAt>=buy.executeAt);assert.ok(delegated.data.quoteSlot>=slot);

  trader.feedGap();const exposed=ledger.state();
  assert.deepEqual(exposed.positions[mint],position);assert.equal(exposed.controls.entriesEnabled,false);
  ledger.close();ledger=new PaperLedger(path,accountId);
  assert.deepEqual(ledger.state(),exposed,'reopening preserves the entire existing account before recovery');
  assert.throws(()=>new PaperLedger(path,accountId),/owner|writer|locked/i,'there is still one financial writer');
  ({market,trader}=compose());
  assert.deepEqual(ledger.state().positions[mint],position);assert.equal(ledger.state().lamports,exposed.lamports);
  assert.equal(ledger.state().inceptionAt,inceptionAt);assert.equal(ledger.state().controls.entriesEnabled,false);
  assert.equal(trader.nextDueAt(),null);

  // Maximum holding time is a frozen rule, not a fabricated stop crossing.
  // Account bytes are unchanged; the new Clock/receipt time is synthetic.
  at=position.enteredAt+900000;slot++;
  const beforeManagement=calls.length;await trader.tick();
  const sell=Object.values(ledger.state().pending)[0]!;
  assert.equal(sell.side,'sell');assert.equal(sell.mint,mint);
  assert.equal(trader.decisions().find(d=>d.stage==='exit-reserved')!.reason,'maximum-holding-time; fresh executable quote still required');
  assert.equal(calls.slice(beforeManagement).filter(c=>c.method==='getMinimumBalanceForRentExemption').length,0,'held-only management does not need entry rent retrieval');
  const heldBeforeGap=structuredClone(ledger.state().positions[mint]);trader.feedGap();
  assert.deepEqual(ledger.state().positions[mint],heldBeforeGap);assert.ok(ledger.state().pending[sell.id],'gap retains decided exit and exposure');
  const beforeExit=calls.length;at=sell.executeAt;slot++;await trader.tick();
  assert.equal(trader.funnel.exited,1);assert.deepEqual(ledger.state().positions,{});assert.deepEqual(ledger.state().pending,{});
  assert.equal(calls.length-beforeExit,1,'fresh post-delay Clock union supplies mark and exact-size sell without a redundant read');
  assert.equal(calls[beforeExit]!.at,sell.executeAt);
  assert.equal(ledger.state().executionCosts,'14000');assert.equal(ledger.state().lockedDeposits[mint],preparation.depositLamports,'refundable account rent stays locked; no fictional refund');
  assert.equal(ledger.state().inceptionAt,inceptionAt);assert.equal(ledger.state().controls.entriesEnabled,false);
  const exitRecord=records.find(r=>r.kind==='trader-pilot-execution-quote'&&r.data.orderId===sell.id)!;
  assert.equal(exitRecord.data.quote.pricedBaseUnits,position.units);assert.ok(exitRecord.data.quote.at>=sell.executeAt);
  const proceeds=BigInt(exitRecord.data.quote.receiveUnits),expectedPnl=proceeds-BigInt(position.entryLamports)-14000n;
  assert.equal(ledger.state().realizedLamports,expectedPnl.toString());
  assert.equal(BigInt(ledger.state().lamports)+BigInt(preparation.depositLamports)-BigInt(initial.lamports),expectedPnl);
  assert.equal((ledger.exportJournal(1000)as Array<{kind:string}>).filter(row=>row.kind==='inception').length,1);
});
