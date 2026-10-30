/** Retained real account bytes with synthetic timing and disposable accounting.
 * No network, production account, natural fill or economic edge is tested. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {DisposableLedger,type UsdPrice} from '../src/ledger.js';
import {PaperExecutionCoordinator} from '../src/execution.js';
import {PilotMarket} from '../src/pilot-market.js';
import type {PoolWireAccount} from '../src/pool.js';
import {PilotRpc,PilotRpcUnavailable} from '../src/pilot-rpc.js';
import {nativePaperRpcConfiguration} from '../src/run-native-paper.js';

const signal=()=>new AbortController().signal;
function fixture(t:TestContext,timeoutMs=1000,cooperative=false,paced=false){
  const runs=['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'];
  const captures=runs.map(run=>{
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    return {proof,state:structuredClone(rows.find(row=>row.kind==='pool-state').data)};
  });
  let at=Date.parse(captures[1]!.proof.quote.validatedAt),slot=Math.max(...captures.map(c=>c.state.context.slot)),rentOffset=0;
  const oldNow=Date.now;Date.now=()=>at;
  const records:Array<{kind:string;data:any}>=[],calls:Array<{method:string;params:any[];at:number}>=[];let recordHook:((kind:string)=>void)|undefined,preparationHook:((input:{method:string;signal:AbortSignal})=>Promise<void>)|undefined;
  const accounts=new Map<string,PoolWireAccount>();
  for(const {state}of captures)for(let i=0;i<state.addresses.length;i++)accounts.set(state.addresses[i],state.value[i]);
  const root=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-pilot-market-')),path=join(root,'fixture.sqlite'),ledger=new DisposableLedger(path,'fixture-pilot-market-mechanics');
  const price=():UsdPrice=>({microUsdPerSol:'100000000',at,source:'DISPOSABLE fixed USD snapshot'});
  ledger.initialize(price(),at);
  t.after(()=>{physical?.close();ledger.close();Date.now=oldNow;rmSync(root,{recursive:true,force:true});});
  let wait:Promise<void>|undefined,rpcHook:((method:string)=>void)|undefined,activity:((ms:number)=>void)|undefined;
  const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{
    calls.push({method,params:structuredClone(params),at});
    rpcHook?.(method);
    if(wait){const pending=wait;wait=undefined;await pending;}
    if(method==='getMinimumBalanceForRentExemption')return (1000000+Number(params[0])+rentOffset)as T;
    if(method==='getBlockTime')return Math.floor(at/1000)as T;
    assert.equal(method,'getMultipleAccounts');
    const addresses=params[0] as string[],raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(slot));raw.writeBigInt64LE(BigInt(Math.floor(at/1000)),32);
    const clock:PoolWireAccount={data:[raw.toString('base64'),'base64'],owner:'Sysvar1111111111111111111111111111111111111',lamports:1169280,executable:false,rentEpoch:0};
    return {context:{slot},value:addresses.map(address=>address===SYSVAR_CLOCK_PUBKEY.toBase58()?clock:structuredClone(accounts.get(address)??null))}as T;
  },usage:()=>({calls:calls.length})};
  let physical:PilotRpc|undefined;
  if(paced){const old=join(root,'prior.json');writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:0,lastObservedAt:at-120000,starts:[at-121000],pending:[]}));physical=new PilotRpc({directory:join(root,'paced-rpc'),runId:'offline-entry-quote-pacing',baselinePaths:[old],priorPhysicalSettled:true,...nativePaperRpcConfiguration(true),now:()=>at,monotonic:()=>at,sleep:async ms=>{at+=ms;activity?.(ms);},fetcher:(async(_url,init)=>{const q=JSON.parse(String(init?.body)),result=await rpc.call(q.method,q.params);return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));}),record:(kind,data)=>records.push({kind,data:structuredClone(data)})});}
  const market=new PilotMarket({rpc:physical??rpc,inventory:()=>ledger.state(),price,now:()=>at,recorder:{record(kind,data){records.push({kind,data:structuredClone(data)});recordHook?.(kind);}},...(cooperative?{beforeEntryPreparationRead:async(input:{method:string;signal:AbortSignal})=>{await preparationHook?.(input);}}:{}),gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'DISPOSABLE7k simulated network/priority cost'},timeoutMs});
  for(const c of captures)market.registerPool({mint:c.proof.quote.mint,migrationVerified:true,migrationSlot:c.proof.origin.slot,evidence:'retained actual migration; synthetic current timing'});
  const coordinator=new PaperExecutionCoordinator({ledger,now:()=>at,timeoutMs:1000,context:s=>market.context(ledger.state().positions,s),quote:market.executionQuote});
  coordinator.recover();ledger.reconcile('initial-reconcile',at,price(),{});ledger.resume('fixture-ready',at,price(),{},{version:'isolated-pilot-market-fixture',evidence:'synthetic readiness for market/ledger mechanics only',marketAt:at,recoveryComplete:true,candidateWindowsReady:true,budgetAvailable:true});
  return {captures,ledger,market,coordinator,price,calls,records,now:()=>at,advance:(ms:number)=>{at+=ms;},rentChanged:()=>{rentOffset++;},bumpSlot:()=>{slot++;},slot:()=>slot,setSlot:(value:number)=>{slot=value;},pause:(p:Promise<void>)=>{wait=p;},account:(address:string)=>accounts.get(address),onRpc:(hook:(method:string)=>void)=>{rpcHook=hook;},onPacingWait:(hook:(ms:number)=>void)=>{activity=hook;},onRecord:(hook:(kind:string)=>void)=>{recordHook=hook;},beforePreparationRead:(hook:(input:{method:string;signal:AbortSignal})=>Promise<void>)=>{preparationHook=hook;}};
}


// Independent adversarial caller/adapter probes. Real retained SDK account bytes,
// disposable ledger, no provider traffic or operating account access.
const independentUnchanged=(f:ReturnType<typeof fixture>,before:unknown)=>{assert.deepEqual(f.ledger.state(),before);assert.deepEqual(f.ledger.state().pending,{});assert.deepEqual(f.ledger.state().positions,{});};

test('independent: reorder really makes rent precede the final coherent SDK quote',async t=>{
 const f=fixture(t,3000,false,true),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),n=f.calls.length;let next=f.now()+400;
 f.onPacingWait(()=>{while(f.now()>=next){next+=400;f.bumpSlot();f.market.minimumSlot(mint,f.slot());}});
 const q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);assert.deepEqual(f.calls.slice(n).map(x=>x.method),['getMinimumBalanceForRentExemption','getMinimumBalanceForRentExemption','getMultipleAccounts']);assert.equal(q.slot,f.slot());assert.equal(q.at,f.now());independentUnchanged(f,before);
});

test('independent: rent changes between the two sizes refuse before a market quote',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),n=f.calls.length;let rents=0;f.onRpc(method=>{if(method==='getMinimumBalanceForRentExemption'&&++rents===2)f.rentChanged();});
 assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.calls.length-n,2);assert.equal(f.market.usage().entryQuoteFailures.last?.reasonCode,'PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH');independentUnchanged(f,before);
});

for(const badRent of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])test('independent: malformed current rent '+String(badRent)+' cannot authorize a quote',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),internal=f.market as any,original=internal.options.rpc.call.bind(internal.options.rpc);internal.options.rpc.call=async(method:string,params:any[],sig:AbortSignal)=>method==='getMinimumBalanceForRentExemption'?badRent:original(method,params,sig);
 assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.market.usage().entryQuoteFailures.last?.reasonCode,'PILOT_MARKET_RENT_UNAVAILABLE');independentUnchanged(f,before);
});

for(const field of ['base','quote']as const)test('independent: final '+field+' account-size change refuses after freshly read rent',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),pricer=(f.market as any).pricer,original=pricer.quoteBuy.bind(pricer);pricer.quoteBuy=async(...args:any[])=>{const q=await original(...args);q[field+'AssociatedAccount'].accountLengthBytes++;return q;};
 assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.market.usage().entryQuoteFailures.last?.reasonCode,'PILOT_MARKET_ACCOUNT_LENGTH');assert.equal(f.market.usage().entryQuoteFailures.last?.phase,'pool-state');independentUnchanged(f,before);
});

for(const index of [0,2,3,5])test('independent: final actual SDK ownership corruption at dependency '+index+' cannot use prepared rent',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state();let changed=false;f.onRpc(method=>{if(method==='getMultipleAccounts'&&!changed){changed=true;f.account(f.captures[1]!.state.addresses[index]!)!.owner='11111111111111111111111111111111';}});
 assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal()),null);assert.equal(f.market.usage().entryQuoteFailures.last?.phase,'pool-state');independentUnchanged(f,before);
});

for(const mutation of ['age','floor','invalidate','abort']as const)test('independent: post-evidence '+mutation+' cannot retain a final entry snapshot',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),controller=new AbortController();f.onRecord(kind=>{if(kind==='rpc-market-quote'){if(mutation==='age')f.advance(2001);if(mutation==='floor')f.market.minimumSlot(mint,f.slot()+1);if(mutation==='invalidate')f.market.invalidate('independent in-record source mutation');if(mutation==='abort')controller.abort();}});
 assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000'},controller.signal),null);assert.equal((f.market as any).entrySnapshots.has(mint),false);assert.equal(f.market.usage().entryQuoteFailures.count,1);independentUnchanged(f,before);
});

test('independent: changed expected deposit refuses before spending any RPC capacity',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint;await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),n=f.calls.length;
 assert.equal(await f.market.quote({mint,side:'buy',inputUnits:'10000000',requiredDepositLamports:'1'},signal()),null);assert.equal(f.calls.length,n);independentUnchanged(f,before);
});

test('independent: mutating a returned preparation clone cannot change internal required rent',async t=>{
 const f=fixture(t),mint=f.captures[1]!.proof.quote.mint,plan=await f.market.prepareEntryCosts(mint,signal());const before=f.ledger.state(),deposit=plan.depositLamports;plan.accountLengths.base=1;plan.accountPlan.baseExists=true;plan.depositLamports='0';
 const q=await f.market.quote({mint,side:'buy',inputUnits:'10000000'},signal());assert.ok(q);assert.equal(q.requiredDepositLamports,deposit);independentUnchanged(f,before);
});
