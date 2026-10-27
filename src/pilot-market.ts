/** Isolated PAPER-pilot composition. It owns no account, timer or financial
 * writer, and never constructs, signs or submits a blockchain transaction. */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import type {ExecutionContext,QuoteRequest} from './execution.js';
import type {ExecutionQuote,Order,Position,UsdPrice} from './ledger.js';
import type {ReadOnlyRpc} from './network.js';
import {quotePool} from './pool.js';
import {ResearchClockPositionPricer} from './research-clock-pricing.js';
import {ResearchHeldMarket} from './research-held-market.js';
import {RpcMarket,type PaperAccountPlan,type VerifiedMarketPool} from './rpc-market.js';
import type {SizeQuote,SizeRequest} from './trader.js';

export type PilotRpc={call<T>(method:string,params?:unknown[],signal?:AbortSignal):Promise<T>;usage?:()=>unknown};
export type PilotInventory={positions:Readonly<Record<string,Position>>;pending:Readonly<Record<string,Order>>;lockedDeposits:Readonly<Record<string,string>>};
export type PilotEntryCosts={
  mint:string;depositLamports:string;evidence:string;at:number;
  accountPlan:PaperAccountPlan;
  accountModel:'per-mint-dedicated-base-and-WSOL-accounts-v1';
  accountLengths:{base:number;quote:number};
  rentLamportsByBytes:Record<string,string>;sourceSlot:number;
  /** Existing locked deposits are assets; they are neither charged nor refunded here. */
  lockedDepositLamports:string;
};
export type PilotSizeQuote=SizeQuote&{requiredDepositLamports?:string;depositEvidence?:string};
export type PilotExecutionQuote=ExecutionQuote&{requiredDepositLamports?:string;depositEvidence?:string;slot?:number};
export type PilotMarketOptions={
  rpc:PilotRpc;inventory:()=>PilotInventory;price:()=>UsdPrice|null;
  recorder:{record:(kind:string,data:unknown)=>void};
  gas:{baseFeeLamports:string;priorityFeeLamports:string;evidence:string};
  now?:()=>number;timeoutMs?:number;
};
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
const integer=(value:string)=>{need(typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value),'PILOT_MARKET_AMOUNT');return BigInt(value);};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MODEL='per-mint-dedicated-base-and-WSOL-accounts-v1' as const;

/** Dedicated simulated token-account pairs deliberately over-reserve compared
 * with sharing a WSOL account. Each mint's rent is locked exactly once in the
 * ledger. No ATA is claimed to exist on chain and no deposit refund is invented.
 */
export class PilotMarket {
  private readonly pools=new Map<string,VerifiedMarketPool>();
  private readonly plans=new Map<string,PilotEntryCosts>();
  private readonly floors=new Map<string,number>();
  private readonly entrySnapshots=new Map<string,PilotSizeQuote>();
  private readonly pricer:ResearchClockPositionPricer;
  private readonly held:ResearchHeldMarket;
  private readonly now:()=>number;
  private generation=0;
  private active=false;
  private prepared=0;
  private entryEstimates=0;
  private entryAttempts=0;
  readonly gasLamports:string;
  constructor(private readonly options:PilotMarketOptions){
    this.options={...options,gas:Object.freeze({...options.gas})};
    this.now=options.now??Date.now;
    this.gasLamports=(integer(options.gas.baseFeeLamports)+integer(options.gas.priorityFeeLamports)).toString();
    need(integer(this.gasLamports)>0n&&typeof options.gas.evidence==='string'&&options.gas.evidence.length>0,'PILOT_MARKET_GAS_REQUIRED');
    need(Number.isSafeInteger(options.timeoutMs??3000)&&(options.timeoutMs??3000)>0&&(options.timeoutMs??3000)<=3000,'PILOT_MARKET_BOUNDED_TIMEOUT_REQUIRED');
    this.pricer=new ResearchClockPositionPricer(options.rpc,options.recorder);
    this.held=new ResearchHeldMarket({pricer:this.pricer,inventory:options.inventory,gasLamports:this.gasLamports,gasEvidence:options.gas.evidence,recorder:options.recorder,now:this.now,usd:options.price,entryQuote:(request,signal)=>this.entryQuote(request,signal)});
  }
  registerPool(pool:VerifiedMarketPool){
    this.held.registerPool(pool);
    this.pools.set(pool.mint,Object.freeze({...pool}));
  }
  minimumSlot(mint:string,slot:number){this.held.minimumSlot(mint,slot);this.floors.set(mint,Math.max(this.floors.get(mint)??0,slot));}
  invalidate(reason:string){this.generation++;this.plans.clear();this.entrySnapshots.clear();this.held.invalidate(reason);}
  private clock(){const at=this.now();need(Number.isSafeInteger(at)&&at>=0,'PILOT_MARKET_CLOCK');return at;}
  private locked(mint:string){const value=this.options.inventory().lockedDeposits[mint]??'0';integer(value);return value;}
  private freshPlan(mint:string){
    const plan=this.plans.get(mint),at=this.clock();
    // This is a sizing expectation, not cached rent authority. RpcMarket reads
    // current lengths/rent again for every actual buy and rejects any mismatch.
    need(plan&&plan.at<=at&&plan.lockedDepositLamports===this.locked(mint),'PILOT_MARKET_ENTRY_COSTS_UNAVAILABLE');
    return plan!;
  }
  private floor(mint:string,min=0){return Math.max(min,this.floors.get(mint)??0,this.pools.get(mint)?.migrationSlot??0);}
  /** Preparation is not an entry estimate or fill. Current supported SDK state
   * establishes account lengths (including Token2022 ImmutableOwner), then
   * current rent is read once per distinct required length. Every call counts.
   */
  async prepareEntryCosts(mint:string,signal:AbortSignal):Promise<PilotEntryCosts>{
    need(!this.active&&!signal.aborted&&this.pools.has(mint),'PILOT_MARKET_PREPARATION_UNAVAILABLE');
    this.active=true;const generation=this.generation;
    try{
      const state=await quotePool(this.options.rpc as ReadOnlyRpc,new PublicKey(mint),10000000n,this.options.recorder,this.floor(mint),signal);
      const lengths={base:state.baseAssociatedAccount.accountLengthBytes,quote:state.quoteAssociatedAccount.accountLengthBytes};
      for(const bytes of Object.values(lengths))need(Number.isSafeInteger(bytes)&&bytes>=165&&bytes<=10240,'PILOT_MARKET_ACCOUNT_LENGTH');
      const locked=this.locked(mint),exists=integer(locked)>0n,rents:Record<string,string>={};let deposit=0n;
      if(!exists)for(const bytes of Object.values(lengths)){
        if(rents[bytes]===undefined){const rent=await this.options.rpc.call<number>('getMinimumBalanceForRentExemption',[bytes,{commitment:'confirmed'}],signal);need(Number.isSafeInteger(rent)&&rent>0,'PILOT_MARKET_RENT_UNAVAILABLE');rents[bytes]=BigInt(rent).toString();}
        deposit+=integer(rents[bytes]!);
      }
      signal.throwIfAborted();const at=this.clock(),received=Date.parse(state.receivedAt);
      need(generation===this.generation&&locked===this.locked(mint)&&state.slot>=this.floor(mint)&&received<=at&&at-received<=2000&&state.marketBlockTime*1000<=at&&at-state.marketBlockTime*1000<=30000,'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
      const body={mint,depositLamports:deposit.toString(),at,accountModel:MODEL,accountLengths:lengths,rentLamportsByBytes:rents,sourceSlot:state.slot,lockedDepositLamports:locked};
      const evidence='pilot-entry-costs:'+hash({...body,poolEvidence:this.pools.get(mint)!.evidence,gas:this.options.gas});
      const plan:PilotEntryCosts={...body,evidence,accountPlan:{baseExists:exists,quoteExists:exists,at,evidence}};
      this.options.recorder.record('pilot-entry-cost-preparation',{...plan,classification:'simulated account inventory; actual read-only rent and supported account lengths',requests:'Three current pool/block-time reads plus one rent read per distinct missing-account length; no requests omitted from the shared RPC budget.',depositRefund:'Not assumed; retained locked capital after exit.'});
      need(this.clock()-at<=10000&&generation===this.generation&&locked===this.locked(mint),'PILOT_MARKET_PREPARATION_CHANGED_OR_STALE');
      this.minimumSlot(mint,state.slot);this.plans.set(mint,structuredClone(plan));this.prepared++;
      return structuredClone(plan);
    }finally{this.active=false;}
  }
  private async entryQuote(request:SizeRequest,signal:AbortSignal):Promise<PilotSizeQuote|null>{
    if(this.active||signal.aborted)return null;
    this.active=true;const generation=this.generation;
    try{
      const plan=this.freshPlan(request.mint),pool=this.pools.get(request.mint);need(pool&&request.side==='buy','PILOT_MARKET_ENTRY_POOL_REQUIRED');
      const expected=(request as SizeRequest&{requiredDepositLamports?:string}).requiredDepositLamports;
      need(expected===undefined||expected===plan.depositLamports,'PILOT_MARKET_ENTRY_DEPOSIT_MISMATCH');
      const market=new RpcMarket({rpc:this.options.rpc as ReadOnlyRpc,recorder:this.options.recorder,now:this.now,timeoutMs:this.options.timeoutMs??3000,gas:this.options.gas,usd:this.options.price,accountPlan:()=>{
        this.freshPlan(request.mint);return {...plan.accountPlan,at:this.clock()};
      },entryDepositLamports:plan.depositLamports});
      market.registerPool(pool);
      const q=await market.quote({...request,minSlot:this.floor(request.mint,request.minSlot??0)},signal);
      need(q&&!signal.aborted&&generation===this.generation&&this.freshPlan(request.mint).evidence===plan.evidence&&q.slot!==undefined&&q.slot>=this.floor(request.mint,request.minSlot??0),'PILOT_MARKET_ENTRY_STATE_CHANGED');
      this.minimumSlot(request.mint,q!.slot!);this.entryEstimates++;
      const result={...q!,requiredDepositLamports:plan.depositLamports,depositEvidence:'pilot-entry-validated-costs:'+hash({preparation:plan.evidence,quote:q!.evidence,deposit:plan.depositLamports})};
      this.entrySnapshots.set(request.mint,structuredClone(result));return result;
    }catch{return null;}
    finally{this.active=false;}
  }
  readonly context=async(positions:Readonly<Record<string,Position>>,signal:AbortSignal):Promise<ExecutionContext>=>{
    if(this.active||signal.aborted)return {price:null,marks:{}};
    this.active=true;
    try{return await this.held.context(positions,signal);}
    finally{this.active=false;}
  };
  readonly quote=(request:SizeRequest,signal:AbortSignal):Promise<PilotSizeQuote|null>=>this.held.quote(request,signal);
  readonly executionQuote=async(request:QuoteRequest&{minSlot?:number},signal:AbortSignal):Promise<PilotExecutionQuote|null>=>{
    const order=request.order;
    try{
      if(request.minSlot!==undefined)this.minimumSlot(order.mint,request.minSlot);
      if(order.side==='buy'){this.entrySnapshots.delete(order.mint);need(this.freshPlan(order.mint).depositLamports===order.deposit,'PILOT_MARKET_RESERVED_DEPOSIT_MISMATCH');}
      const q=await this.held.executionQuote(request,signal);if(!q)return null;
      const at=this.clock(),pending=this.options.inventory().pending[order.id];
      need(!signal.aborted&&pending&&JSON.stringify(pending)===JSON.stringify(order)&&q.at>=Math.max(order.executeAt,request.attemptedAt)&&q.at<=at&&at-q.at<=2000&&at<order.expiresAt,'PILOT_MARKET_EXECUTION_CHANGED_OR_STALE');
      if(order.side==='sell')return q;
      const plan=this.freshPlan(order.mint),entry=this.entrySnapshots.get(order.mint);need(plan.depositLamports===order.deposit,'PILOT_MARKET_RESERVED_DEPOSIT_MISMATCH');
      need(entry&&entry.evidence===q.evidence&&entry.at===q.at&&entry.outputUnits===q.receiveUnits&&entry.slot!==undefined&&entry.slot>=this.floor(order.mint,request.minSlot??0),'PILOT_MARKET_EXECUTION_SOURCE_REQUIRED');this.entryAttempts++;
      return {...q,slot:entry.slot,requiredDepositLamports:plan.depositLamports,depositEvidence:'pilot-execution-validated-costs:'+hash({preparation:plan.evidence,quote:q.evidence,deposit:plan.depositLamports})};
    }catch{return null;}
  };
  usage(){return {classification:'isolated PAPER pilot only',preparedEntryCostPlans:this.prepared,entryQuoteCalls:this.entryEstimates,entryExecutionQuotes:this.entryAttempts,held:this.pricer.usage(),rpc:this.options.rpc.usage?.()??null,accountModel:MODEL,depositRefundsAssumed:false};}
}
