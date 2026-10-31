/** Offline current-pool provenance regression. Retained account bytes and
 * synthetic clocks/slots exercise real decoders without a provider or ledger. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {ReadOnlyRpc} from '../src/network.js';
import {RpcMarket,type VerifiedMarketPool} from '../src/rpc-market.js';
import {PilotMarket,type PilotInventory} from '../src/pilot-market.js';
import {ResearchHeldMarket} from '../src/research-held-market.js';
import type {ResearchClockQuote} from '../src/research-clock-pricing.js';
import type {PoolWireAccount} from '../src/pool.js';
import type {SizeRequest} from '../src/trader.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';

const run='2026-10-26T23-32-41.255Z';
const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
const retained=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(row=>row.kind==='pool-state').data;
const mint:string=proof.quote.mint,pool:string=proof.quote.pool,baseSlot:number=proof.origin.slot;
const signal=()=>new AbortController().signal;
const generatedMint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
type RecordRow={kind:string;data:any};
type RequestRow={method:string;params:any[]};
const legacy=(slot=baseSlot):VerifiedMarketPool=>({mint,migrationSlot:slot,migrationVerified:true,evidence:'OFFLINE retained origin with synthetic timing'});
const current=(now:number,slot=baseSlot,name=mint):VerifiedMarketPool=>({basis:'current-canonical-pool',mint:name,pool:canonicalPumpPoolPda(new PublicKey(name)).toBase58(),sourceSlot:slot,verifiedAt:now-100,evidence:'OFFLINE accepted current account proof; no creation time claimed'});

function fixture(t:TestContext){
  const now=Date.parse(proof.quote.validatedAt),pendingMint=generatedMint(117);
  let bankSlot=baseSlot;
  const oldNow=Date.now;Date.now=()=>now;t.after(()=>{Date.now=oldNow;});
  const inventory:PilotInventory={
    positions:{[mint]:{mint,units:proof.quote.buy.outputBaseUnits,entryLamports:'10000000',entryGas:'7000',deposit:'2000000',costMicroUsd:'1200700',enteredAt:now-1000}},
    pending:{entry:{id:'entry',side:'buy',mint:pendingMint,decidedAt:now,executeAt:now+1000,expiresAt:now+5000,gas:'7000',deposit:'2000000',maxSpend:'10000000',minReceive:'1',reserved:'12007000',decisionEvidence:'OFFLINE pending ownership fixture'}},
    lockedDeposits:{[mint]:'2000000',[generatedMint(118)]:'2000000'}
  };
  const original=structuredClone(inventory),records:RecordRow[]=[],calls:RequestRow[]=[];
  const accounts=new Map<string,PoolWireAccount>();
  retained.addresses.forEach((address:string,i:number)=>accounts.set(address,retained.value[i]));
  const record=(kind:string,data:unknown)=>records.push({kind,data:structuredClone(data)});
  const price=()=>({microUsdPerSol:'100000000',at:now,source:'OFFLINE fixed USD'});
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:structuredClone(params)});
    if(method==='getBlockTime')return Math.floor(now/1000)as T;
    if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0]))as T;
    assert.equal(method,'getMultipleAccounts','the fixture refuses archival/transaction/provider methods');
    const raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(bankSlot));raw.writeBigInt64LE(BigInt(Math.floor(now/1000)),32);
    const clock:PoolWireAccount={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot:bankSlot},value:(params[0]as string[]).map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))}as T;
  }};
  const readonlyRpc=new ReadOnlyRpc('https://offline-fixture.invalid',async(_url,init)=>{
    const body=JSON.parse(String(init?.body)),result=await rpc.call(body.method,body.params);
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
  },{profile:'runtime'});
  const gas={baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'OFFLINE simulated network cost'};
  return {now,inventory,original,pendingMint,records,calls,record,price,rpc,readonlyRpc,gas,setSlot:(slot:number)=>{bankSlot=slot;},slot:()=>bankSlot};
}

function assertRequestedFloor(calls:RequestRow[],from:number,expected:number){
  const reads=calls.slice(from).filter(call=>call.method==='getMultipleAccounts');
  assert.ok(reads.length>0,'a fresh quote must actually request account state');
  for(const read of reads)assert.equal(read.params[1].minContextSlot,expected,'the actual account request preserves the strongest known slot floor');
}
function assertCurrentEvidence(records:RecordRow[],sourceSlot:number,now:number){
  const row=records.findLast(row=>row.kind==='rpc-market-quote');assert.ok(row);
  assert.equal(row.data.source.identityBasis,'current-canonical-pool');
  assert.equal(row.data.source.pool,pool);assert.equal(row.data.source.sourceSlot,sourceSlot);
  assert.equal(row.data.source.verifiedAt,now-100);
  assert.equal(Object.hasOwn(row.data.source,'migrationSlot'),false,'a current account context is never relabeled as a creation slot');
}
function assertInvalidProofs(market:{registerPool:(pool:VerifiedMarketPool)=>void},now:number){
  const good=current(now)as Extract<VerifiedMarketPool,{basis:'current-canonical-pool'}>;
  for(const [label,invalid]of [
    ['wrong mint',{...good,mint:generatedMint(119)}],
    ['wrong canonical pool',{...good,pool:generatedMint(120)}],
    ['future proof',{...good,verifiedAt:now+1}],
    ['negative source slot',{...good,sourceSlot:-1}],
    ['fractional source slot',{...good,sourceSlot:baseSlot+0.5}],
    ['missing evidence',{...good,evidence:''}]
  ]as const)assert.throws(()=>market.registerPool(invalid),Error,label);
}
function registrations(now:number):Array<{pool:VerifiedMarketPool;floor:number}>{
  return [
    {pool:legacy(),floor:baseSlot},
    {pool:current(now,baseSlot+10),floor:baseSlot+10},
    {pool:legacy(),floor:baseSlot+10},
    {pool:current(now,baseSlot+20),floor:baseSlot+20},
    {pool:current(now,baseSlot+5),floor:baseSlot+20}
  ];
}

test('RpcMarket rejects unrelated or future current proofs and preserves actual quote floors through provenance changes',async t=>{
  const f=fixture(t),market=new RpcMarket({rpc:f.readonlyRpc,now:()=>f.now,recorder:{record:f.record},gas:f.gas});
  market.registerPool(current(f.now));assertInvalidProofs(market,f.now);assert.equal(f.calls.length,0);
  for(const step of registrations(f.now)){
    market.registerPool(step.pool);f.setSlot(step.floor);const before=f.calls.length;
    const q=await market.quote({mint,side:'sell',inputUnits:f.inventory.positions[mint]!.units},signal());
    assert.ok(q);assert.equal(q.slot,step.floor);assertRequestedFloor(f.calls,before,step.floor);
    if(step.pool.basis==='current-canonical-pool')assertCurrentEvidence(f.records,step.pool.sourceSlot,f.now);
  }
  f.setSlot(baseSlot+30);let before=f.calls.length;
  assert.ok(await market.quote({mint,side:'sell',inputUnits:f.inventory.positions[mint]!.units,minSlot:baseSlot+30},signal()));
  assertRequestedFloor(f.calls,before,baseSlot+30);
  market.registerPool(current(f.now,baseSlot+5));assertInvalidProofs(market,f.now);before=f.calls.length;
  assert.ok(await market.quote({mint,side:'sell',inputUnits:f.inventory.positions[mint]!.units},signal()));
  assertRequestedFloor(f.calls,before,baseSlot+30);assertCurrentEvidence(f.records,baseSlot+5,f.now);
  assert.deepEqual(f.inventory,f.original);
});

test('PilotMarket current proofs preserve owned records and real entry/holding request floors without fabricated migration evidence',async t=>{
  const f=fixture(t),market=new PilotMarket({rpc:f.rpc,inventory:()=>f.inventory,now:()=>f.now,price:f.price,recorder:{record:f.record},gas:f.gas});
  market.registerPool(current(f.now));assertInvalidProofs(market,f.now);assert.equal(f.calls.length,0);
  market.registerPool(current(f.now,baseSlot,f.pendingMint));
  assert.throws(()=>market.unregisterPool(mint),/OWNED_FINANCIAL_EXPOSURE/);
  assert.throws(()=>market.unregisterPool(f.pendingMint),/OWNED_FINANCIAL_EXPOSURE/);
  await market.prepareEntryCosts(mint,signal());
  for(const step of registrations(f.now)){
    market.registerPool(step.pool);f.setSlot(step.floor);const before=f.calls.length;
    const q=await market.quote({mint,side:'buy',inputUnits:'10000000'},signal());
    assert.ok(q,JSON.stringify(market.usage().entryQuoteFailures));assert.equal(q.slot,step.floor);
    assertRequestedFloor(f.calls,before,step.floor);
    if(step.pool.basis==='current-canonical-pool')assertCurrentEvidence(f.records,step.pool.sourceSlot,f.now);
    const holdingStart=f.calls.length,context=await market.context(f.inventory.positions,signal());
    assert.ok(context.marks[mint]);assertRequestedFloor(f.calls,holdingStart,step.floor);
  }
  market.minimumSlot(mint,baseSlot+30);f.setSlot(baseSlot+30);
  market.registerPool(legacy());let before=f.calls.length;
  assert.ok(await market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));assertRequestedFloor(f.calls,before,baseSlot+30);
  market.registerPool(current(f.now,baseSlot+40));f.setSlot(baseSlot+50);assertInvalidProofs(market,f.now);before=f.calls.length;
  assert.ok(await market.quote({mint,side:'buy',inputUnits:'10000000',minSlot:baseSlot+50},signal()));assertRequestedFloor(f.calls,before,baseSlot+50);
  market.registerPool(current(f.now,baseSlot+5));before=f.calls.length;
  assert.ok(await market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));assertRequestedFloor(f.calls,before,baseSlot+50);assertCurrentEvidence(f.records,baseSlot+5,f.now);
  assert.throws(()=>market.unregisterPool(mint),/OWNED_FINANCIAL_EXPOSURE/);assert.deepEqual(f.inventory,f.original);
});

test('ResearchHeldMarket carries monotonic current proof floors into actual pricer/delegate requests and preserves owned inventory',async t=>{
  const f=fixture(t),heldRequests:Array<{mint:string;units:string;minSlot:number}>=[],entryRequests:SizeRequest[]=[];
  const market=new ResearchHeldMarket({inventory:()=>f.inventory,now:()=>f.now,usd:f.price,gasLamports:'7000',gasEvidence:f.gas.evidence,recorder:{record:f.record},pricer:{
    invalidate(){},
    async quoteMany(requests){
      assert.equal(requests.length,1);const request=requests[0]!;
      heldRequests.push({mint:request.mint.toBase58(),units:request.fullBaseUnits.toString(),minSlot:request.minSlot??0});
      const at=new Date(f.now).toISOString(),quote={...proof.quote,slot:f.slot(),requestedAt:at,receivedAt:at,validatedAt:at,commitment:'confirmed',timeEvidence:'confirmed-bank-clock',clockSlot:f.slot(),marketClockUnixSeconds:Math.floor(f.now/1000),sell:proof.quote.correspondingSell}as ResearchClockQuote;
      return {quotes:{[mint]:quote},unavailable:{},context:{slot:quote.slot,requestedAt:at,receivedAt:at,marketClockUnixSeconds:quote.marketClockUnixSeconds}};
    }
  },entryQuote:async request=>{
    entryRequests.push(structuredClone(request));return {...request,outputUnits:proof.quote.buy.outputBaseUnits,slot:f.slot(),at:f.now,evidence:'OFFLINE captured delegated entry request'};
  }});
  market.registerPool(current(f.now));assertInvalidProofs(market,f.now);assert.equal(heldRequests.length,0);assert.equal(entryRequests.length,0);
  market.registerPool(current(f.now,baseSlot,f.pendingMint));
  assert.throws(()=>market.unregisterPool(mint),/OWNED_FINANCIAL_EXPOSURE/);assert.throws(()=>market.unregisterPool(f.pendingMint),/OWNED_FINANCIAL_EXPOSURE/);
  for(const step of registrations(f.now)){
    market.registerPool(step.pool);f.setSlot(step.floor);
    const context=await market.context(f.inventory.positions,signal());assert.ok(context.marks[mint]);
    assert.deepEqual(heldRequests.at(-1),{mint,units:f.inventory.positions[mint]!.units,minSlot:step.floor});
    const q=await market.quote({mint,side:'sell',inputUnits:f.inventory.positions[mint]!.units},signal());assert.ok(q);assert.equal(q.slot,step.floor);assert.equal(Object.hasOwn(q,'migrationSlot'),false);
    assert.ok(await market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));assert.equal(entryRequests.at(-1)!.minSlot,step.floor);
  }
  market.minimumSlot(mint,baseSlot+30);f.setSlot(baseSlot+30);market.registerPool(legacy());
  assert.ok((await market.context(f.inventory.positions,signal())).marks[mint]);assert.equal(heldRequests.at(-1)!.minSlot,baseSlot+30);
  market.registerPool(current(f.now,baseSlot+40));f.setSlot(baseSlot+50);assertInvalidProofs(market,f.now);
  assert.ok(await market.quote({mint,side:'buy',inputUnits:'10000000',minSlot:baseSlot+50},signal()));assert.equal(entryRequests.at(-1)!.minSlot,baseSlot+50);
  market.registerPool(current(f.now,baseSlot+5));
  assert.ok((await market.context(f.inventory.positions,signal())).marks[mint]);assert.equal(heldRequests.at(-1)!.minSlot,baseSlot+50);
  assert.ok(await market.quote({mint,side:'buy',inputUnits:'10000000'},signal()));assert.equal(entryRequests.at(-1)!.minSlot,baseSlot+50);
  assert.throws(()=>market.unregisterPool(mint),/OWNED_FINANCIAL_EXPOSURE/);assert.deepEqual(f.inventory,f.original);assert.equal(f.calls.length,0);
});
