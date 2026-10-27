/** Registry ownership only, using synthetic read-only inventory and a retained
 * quote summary. No ledger initialization, live data or financial action. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import {PilotMarket,type PilotInventory} from '../src/pilot-market.js';
import {ResearchHeldMarket} from '../src/research-held-market.js';
import type {ResearchClockQuote} from '../src/research-clock-pricing.js';
const proof=JSON.parse(readFileSync('evidence/integration-proof-2026-10-26T23-32-41.255Z.json','utf8'));
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const registration=(mint:string)=>({mint,migrationSlot:proof.origin.slot,migrationVerified:true as const,evidence:'ISOLATED registry fixture; no actual migration claimed for generated public IDs'});
const signal=()=>new AbortController().signal;
function setup(){
  const now=Date.parse(proof.quote.validatedAt),held=proof.quote.mint,pending=mint(120),records:Array<{kind:string;data:any}>=[];
  const inventory:PilotInventory={positions:{[held]:{mint:held,units:proof.quote.buy.outputBaseUnits,entryLamports:'10000000',entryGas:'7000',deposit:'2000000',costMicroUsd:'1200700',enteredAt:now-1000}},pending:{entry:{id:'entry',side:'buy',mint:pending,decidedAt:now,executeAt:now+1000,expiresAt:now+5000,gas:'7000',deposit:'2000000',maxSpend:'10000000',minReceive:'1',reserved:'12007000',decisionEvidence:'ISOLATED pending fixture'}},lockedDeposits:{[held]:'2000000',[mint(121)]:'2000000'}};
  const record=(kind:string,data:unknown)=>records.push({kind,data:structuredClone(data)}),price=()=>({at:now,microUsdPerSol:'100000000',source:'ISOLATED fixed USD'});
  return {now,held,pending,inventory,records,record,price};
}

test('more than fifteen retired pools rotate through the bounded pilot registry without deleting held/pending/deposit history',async()=>{
  const f=setup(),original=structuredClone(f.inventory);let network=0;
  const market=new PilotMarket({rpc:{async call<T>():Promise<T>{network++;throw Error('NO_NETWORK_IN_REGISTRY_FIXTURE');}},inventory:()=>f.inventory,price:f.price,now:()=>f.now,recorder:{record:f.record},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'ISOLATED simulated gas'}});
  market.registerPool(registration(f.held));market.registerPool(registration(f.pending));
  assert.throws(()=>market.unregisterPool(f.held),/OWNED_FINANCIAL_EXPOSURE/);assert.throws(()=>market.unregisterPool(f.pending),/OWNED_FINANCIAL_EXPOSURE/);
  for(let i=1;i<=25;i++){const name=mint(i);market.registerPool(registration(name));market.minimumSlot(name,proof.origin.slot+100);assert.equal(market.usage().registeredPools,3);assert.equal(market.unregisterPool(name),true);assert.equal(market.unregisterPool(name),false);assert.equal(market.usage().registeredPools,2);assert.throws(()=>market.minimumSlot(name,0),/MINIMUM_SLOT/);assert.equal(await market.quote({mint:name,side:'buy',inputUnits:'10000000'},signal()),null);}
  assert.equal(network,0);assert.deepEqual(f.inventory,original);assert.equal(f.records.filter(row=>row.kind==='research-held-market-pool-retired').length,25);assert.ok(f.records.every(row=>row.data.financialStateChanged===false));
});

test('retiring another pool preserves a usable exact-size held snapshot without a global link-cache flush',async()=>{
  const f=setup();let reads=0,invalidations=0;
  const quote={...proof.quote,requestedAt:new Date(f.now).toISOString(),receivedAt:new Date(f.now).toISOString(),validatedAt:new Date(f.now).toISOString(),commitment:'confirmed',timeEvidence:'confirmed-bank-clock',clockSlot:proof.quote.slot,marketClockUnixSeconds:Math.floor(f.now/1000),sell:proof.quote.correspondingSell}as ResearchClockQuote;
  const market=new ResearchHeldMarket({inventory:()=>f.inventory,now:()=>f.now,usd:f.price,gasLamports:'7000',gasEvidence:'ISOLATED gas',recorder:{record:f.record},pricer:{invalidate(){invalidations++;},async quoteMany(){reads++;return {quotes:{[f.held]:quote},unavailable:{},context:{slot:quote.slot,requestedAt:quote.requestedAt,receivedAt:quote.receivedAt,marketClockUnixSeconds:quote.marketClockUnixSeconds}};}}});
  market.registerPool(registration(f.held));const context=await market.context(f.inventory.positions,signal());assert.ok(context.marks[f.held]);
  for(let i=1;i<=25;i++){const name=mint(i);market.registerPool(registration(name));assert.equal(market.unregisterPool(name),true);const still=await market.quote({mint:f.held,side:'sell',inputUnits:f.inventory.positions[f.held]!.units},signal());assert.ok(still);assert.equal(still.outputUnits,quote.sell.outputLamports);}
  assert.equal(reads,1);assert.equal(invalidations,0);assert.ok(f.inventory.positions[f.held]);
});

test('retirement cannot race a context or delegated entry read and never edits the caller inventory',async()=>{
  const f=setup(),original=structuredClone(f.inventory);let release!:(value:any)=>void;
  const market=new PilotMarket({rpc:{async call<T>():Promise<T>{return await new Promise<T>(resolve=>{release=resolve;});}},inventory:()=>f.inventory,price:f.price,now:()=>f.now,recorder:{record:f.record},gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'ISOLATED gas'}});
  const target=mint(1);market.registerPool(registration(target));const preparation=market.prepareEntryCosts(target,signal());await Promise.resolve();assert.throws(()=>market.unregisterPool(target),/READ_IN_FLIGHT/);release(null);await assert.rejects(preparation);assert.equal(market.unregisterPool(target),true);
  let complete!:(value:any)=>void;const held=new ResearchHeldMarket({inventory:()=>f.inventory,now:()=>f.now,gasLamports:'7000',gasEvidence:'ISOLATED gas',recorder:{record:f.record},pricer:{invalidate(){},async quoteMany(){throw Error('NO_CONTEXT_READ');}},entryQuote:async()=>await new Promise(resolve=>{complete=resolve;})});held.registerPool(registration(target));const entry=held.quote({mint:target,side:'buy',inputUnits:'10000000'},signal());await Promise.resolve();assert.throws(()=>held.unregisterPool(target),/READ_IN_FLIGHT/);complete(null);assert.equal(await entry,null);assert.equal(held.unregisterPool(target),true);assert.deepEqual(f.inventory,original);
  let finish!:(value:any)=>void;const marking=new ResearchHeldMarket({inventory:()=>f.inventory,now:()=>f.now,gasLamports:'7000',gasEvidence:'ISOLATED gas',recorder:{record:f.record},pricer:{invalidate(){},async quoteMany(){return await new Promise(resolve=>{finish=resolve;});}}});marking.registerPool(registration(f.held));marking.registerPool(registration(target));const context=marking.context(f.inventory.positions,signal());await Promise.resolve();assert.throws(()=>marking.unregisterPool(target),/READ_IN_FLIGHT/);finish({quotes:{},unavailable:{},context:null});await context;assert.equal(marking.unregisterPool(target),true);marking.minimumSlot(f.held,proof.origin.slot);assert.deepEqual(f.inventory,original);
});
