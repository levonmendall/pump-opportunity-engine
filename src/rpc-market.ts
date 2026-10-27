import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {ReadOnlyRpc} from './network.js';
import {quotePool,quotePositionSell} from './pool.js';
import type {Position,UsdPrice} from './ledger.js';
import type {ExecutionContext} from './execution.js';
import type {SizeQuote,SizeRequest} from './trader.js';
import type {Recorder} from './recorder.js';

export type VerifiedMarketPool={mint:string;migrationSlot:number;migrationVerified:true;evidence:string};
/** This is the simulated account inventory, not an assumption that a real wallet
 * owns an ATA. null means unknown. Deposits stay separate from liquidation marks. */
export type PaperAccountPlan={baseExists:boolean|null;quoteExists:boolean|null;at:number;evidence:string};
export type RpcMarketOptions={
  rpc:ReadOnlyRpc;recorder:Pick<Recorder,'record'>;now?:()=>number;timeoutMs?:number;
  gas:{baseFeeLamports:string;priorityFeeLamports:string;evidence:string};
  /** Already obtained timestamped USD snapshot; this adapter only calls Solana RPC. */
  usd?:()=>UsdPrice|null;
  accountPlan?:(mint:string)=>PaperAccountPlan|null;
  /** Must exactly match current required refundable rent; null blocks buys. */
  entryDepositLamports?:string|null;
};
const uint=(v:string)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v))throw new Error('bounded integer market amount required');return BigInt(v);};
const text=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=512&&!/[\u0000-\u001f]/.test(s);
const MAX_QUOTE_AGE=2000,MAX_USD_AGE=10_000;
const empty=():ExecutionContext=>({price:null,marks:{}});

/** One shared, bounded read-only market adapter. No trading/signing clients,
 * subscriptions, wallet keys, financial writer, quote retries or entry controls.
 * Each request reads a new verified pool batch; a proposal is never a fill cache.
 */
export class RpcMarket {
  private readonly pools=new Map<string,VerifiedMarketPool>();
  private readonly slots=new Map<string,number>();
  private active:Promise<unknown>|undefined;
  private readonly now:()=>number;private readonly timeout:number;
  readonly gasLamports:string;
  constructor(private readonly options:RpcMarketOptions){
    this.now=options.now??Date.now;this.timeout=options.timeoutMs??1500;
    this.gasLamports=(uint(options.gas.baseFeeLamports)+uint(options.gas.priorityFeeLamports)).toString();
    if(uint(this.gasLamports)===0n||!text(options.gas.evidence)||!Number.isSafeInteger(this.timeout)||this.timeout<1||this.timeout>10_000)throw new Error('explicit bounded simulated gas/deadline required');
    if(options.entryDepositLamports!==undefined&&options.entryDepositLamports!==null)uint(options.entryDepositLamports);
    this.options={...options,gas:Object.freeze({baseFeeLamports:options.gas.baseFeeLamports,priorityFeeLamports:options.gas.priorityFeeLamports,evidence:options.gas.evidence})};
  }
  registerPool(pool:VerifiedMarketPool){
    const mint=new PublicKey(pool.mint).toBase58();
    if(mint!==pool.mint||pool.migrationVerified!==true||!Number.isSafeInteger(pool.migrationSlot)||pool.migrationSlot<0||!text(pool.evidence))throw new Error('verified migration context required');
    if(!this.pools.has(mint)&&this.pools.size>=15)throw new Error('bounded market pool capacity');
    const prior=this.pools.get(mint);if(prior&&pool.migrationSlot!==prior.migrationSlot)throw new Error('conflicting migration context');
    this.pools.set(mint,Object.freeze({mint,migrationSlot:pool.migrationSlot,migrationVerified:true,evidence:pool.evidence}));
  }
  removePool(mint:string){if(this.active)throw new Error('market read in progress');this.pools.delete(mint);this.slots.delete(mint);}
  get blocked(){return !!this.active;}
  private clock(){const at=this.now();if(!Number.isSafeInteger(at)||at<0)throw new Error('synchronized market wall clock required');return at;}
  private async bounded<T>(signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>,unavailable:()=>T):Promise<T>{
    if(this.active||signal.aborted)return unavailable();
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let timer:ReturnType<typeof setTimeout>|undefined,listener:(()=>void)|undefined;
    const operation=Promise.resolve().then(()=>{combined.throwIfAborted();return work(combined);});this.active=operation;
    void operation.then(()=>{if(this.active===operation)this.active=undefined;},()=>{if(this.active===operation)this.active=undefined;});
    try{return await Promise.race([operation,new Promise<T>(resolve=>{listener=()=>resolve(unavailable());combined.addEventListener('abort',listener,{once:true});timer=setTimeout(()=>controller.abort(),this.timeout);if(combined.aborted)listener();})]);}
    catch{return unavailable();}
    finally{clearTimeout(timer);if(listener)combined.removeEventListener('abort',listener);controller.abort();}
  }
  private fresh(summary:{mint:string;slot:number;commitment:string;requestedAt:string;receivedAt:string;validatedAt:string;marketBlockTime:number}){
    const now=this.clock(),requested=Date.parse(summary.requestedAt),at=Date.parse(summary.receivedAt),validated=Date.parse(summary.validatedAt),floor=this.slots.get(summary.mint)??this.pools.get(summary.mint)?.migrationSlot;
    if(floor===undefined||!Number.isSafeInteger(summary.slot)||summary.slot<floor||summary.commitment!=='confirmed'||!Number.isSafeInteger(requested)||!Number.isSafeInteger(at)||!Number.isSafeInteger(validated)||requested>at||at>validated||validated>now||at>now||now-at>MAX_QUOTE_AGE||!Number.isSafeInteger(summary.marketBlockTime)||summary.marketBlockTime*1000>now||now-summary.marketBlockTime*1000>30_000)throw new Error('RPC_MARKET_SOURCE_UNAVAILABLE');
    this.slots.set(summary.mint,summary.slot);return at;
  }
  private async entryCosts(mint:string,requirements:{baseAssociatedAccount:{accountLengthBytes:number};quoteAssociatedAccount:{accountLengthBytes:number}},signal:AbortSignal){
    const raw=this.options.accountPlan?.(mint),plan=raw?{baseExists:raw.baseExists,quoteExists:raw.quoteExists,at:raw.at,evidence:raw.evidence}:null,now=this.clock(),configured=this.options.entryDepositLamports;
    if(!plan||typeof plan.baseExists!=='boolean'||typeof plan.quoteExists!=='boolean'||!text(plan.evidence)||!Number.isSafeInteger(plan.at)||plan.at>now||now-plan.at>MAX_USD_AGE||configured===undefined||configured===null)throw new Error('PAPER_ACCOUNT_COST_UNKNOWN');
    let required=0n;const rents=new Map<number,bigint>();
    for(const [exists,bytes] of [[plan.baseExists,requirements.baseAssociatedAccount.accountLengthBytes],[plan.quoteExists,requirements.quoteAssociatedAccount.accountLengthBytes]] as const){
      if(exists)continue;
      if(!rents.has(bytes)){const rent=await this.options.rpc.call<number>('getMinimumBalanceForRentExemption',[bytes,{commitment:'confirmed'}],signal);if(!Number.isSafeInteger(rent)||rent<1)throw new Error('PAPER_ACCOUNT_RENT_UNAVAILABLE');rents.set(bytes,BigInt(rent));}
      required+=rents.get(bytes)!;
    }
    if(this.clock()-plan.at>MAX_USD_AGE||plan.at>this.clock())throw new Error('PAPER_ACCOUNT_PLAN_STALE');
    if(required!==uint(configured))throw new Error('PAPER_ACCOUNT_DEPOSIT_MISMATCH');
    return {depositLamports:required.toString(),plan:{...plan},rents:Object.fromEntries([...rents].map(([bytes,rent])=>[bytes,rent.toString()])),gas:{...this.options.gas},gasLamports:this.gasLamports,classification:'simulated' as const};
  }
  private async readQuote(request:SizeRequest,signal:AbortSignal):Promise<SizeQuote|null>{
    const r=Object.freeze({mint:request.mint,side:request.side,inputUnits:request.inputUnits,...(request.minSlot===undefined?{}:{minSlot:request.minSlot})}),pool=this.pools.get(r.mint);if(!pool||!['buy','sell'].includes(r.side)||uint(r.inputUnits)===0n||r.minSlot!==undefined&&(!Number.isSafeInteger(r.minSlot)||r.minSlot<0))return null;
    const floor=Math.max(pool.migrationSlot,this.slots.get(r.mint)??0,r.minSlot??0),mint=new PublicKey(r.mint);
    const state=r.side==='buy'?await quotePool(this.options.rpc,mint,uint(r.inputUnits),this.options.recorder,floor,signal):await quotePositionSell(this.options.rpc,mint,uint(r.inputUnits),this.options.recorder,floor,signal);
    let costs:Awaited<ReturnType<RpcMarket['entryCosts']>>|undefined;
    if(r.side==='buy')costs=await this.entryCosts(r.mint,state,signal);
    signal.throwIfAborted();if(!Number.isSafeInteger(state.slot)||state.slot<floor)throw new Error('RPC_MARKET_REQUEST_SLOT_UNAVAILABLE');const at=this.fresh(state);
    const output='buy' in state?state.buy.outputBaseUnits:state.sell.outputLamports;
    if(r.side==='sell'&&uint(output)<=uint(this.gasLamports))return null;
    const evidence='rpc-market:'+createHash('sha256').update(JSON.stringify({request:r,state,costs,gas:this.options.gas,migrationEvidence:pool.evidence})).digest('hex');
    const quote:SizeQuote={...r,outputUnits:output,at,evidence,slot:state.slot,effectiveQuoteLiquidityLamports:state.effectiveQuoteReserve};
    this.options.recorder.record('rpc-market-quote',{request:r,quote,source:{slot:state.slot,commitment:state.commitment,requestedAt:state.requestedAt,receivedAt:state.receivedAt,validatedAt:state.validatedAt,marketBlockTime:state.marketBlockTime,migrationSlot:pool.migrationSlot},costs:costs??{gas:{...this.options.gas},gasLamports:this.gasLamports,classification:'simulated',refundableDepositRefund:'not assumed'}});
    signal.throwIfAborted();this.fresh(state);return quote;
  }
  readonly quote=(request:SizeRequest,signal:AbortSignal):Promise<SizeQuote|null>=>{const expected=Object.freeze({mint:request.mint,side:request.side,inputUnits:request.inputUnits,...(request.minSlot===undefined?{}:{minSlot:request.minSlot})});return this.bounded(signal,s=>this.readQuote(expected,s),()=>null);};
  readonly context=(positions:Readonly<Record<string,Position>>,signal:AbortSignal):Promise<ExecutionContext>=>{
    const entries=Object.entries(positions).map(([mint,p])=>[mint,{mint:p.mint,units:p.units}] as const);
    const result=empty();
    const available=()=>{const now=this.clock();for(const [mint,mark] of Object.entries(result.marks))if(mark.at>now||now-mark.at>MAX_QUOTE_AGE)delete result.marks[mint];if(result.price&&(result.price.at>now||now-result.price.at>MAX_USD_AGE))result.price=null;return structuredClone(result);};
    return this.bounded(signal,async s=>{
    if(entries.length>3)throw new Error('held position capacity exceeded');
    for(const [mint,position] of entries){
      s.throwIfAborted();if(mint!==position.mint)continue;
      try{const quote=await this.readQuote({mint,side:'sell',inputUnits:position.units},s);if(quote)result.marks[mint]={netLamports:(uint(quote.outputUnits)-uint(this.gasLamports)).toString(),pricedBaseUnits:position.units,at:quote.at,evidence:quote.evidence};}catch{s.throwIfAborted();}
    }
    // Held protection is priced before optional USD. Missing USD does not erase a
    // supported SOL exit or turn an unknown valuation into a zero.
    try{const price=this.options.usd?.(),now=this.clock();if(price&&uint(price.microUsdPerSol)>0n&&text(price.source)&&Number.isSafeInteger(price.at)&&price.at<=now&&now-price.at<=MAX_USD_AGE)result.price={microUsdPerSol:price.microUsdPerSol,at:price.at,source:price.source};}catch{s.throwIfAborted();}
    s.throwIfAborted();const now=this.clock();available();
    this.options.recorder.record('rpc-market-context',{at:now,context:result,compatibility:'independent confirmed pool batches; original per-mark receive times; USD has separate source/time, no cross-source atomicity'});s.throwIfAborted();return available();
  },available);};
}
