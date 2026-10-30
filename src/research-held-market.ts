/** Isolated release-candidate adapter. Not imported by the production runtime.
 * One complete Clock batch can supply net held marks and a compatible gross
 * post-delay exit quote. Notifications alone never price a holding.
 */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import type {ExecutionContext,QuoteRequest} from './execution.js';
import type {ExecutionQuote,Order,Position,UsdPrice} from './ledger.js';
import type {VerifiedMarketPool} from './rpc-market.js';
import type {ResearchClockPositionPricer,ResearchClockQuote} from './research-clock-pricing.js';
import {RESEARCH_CLOCK_COHERENT_POOL_CAPACITY} from './research-clock-pricing.js';
import type {SizeQuote,SizeRequest} from './trader.js';

type Inventory={positions:Readonly<Record<string,Position>>;pending:Readonly<Record<string,Order>>};
type Options={
  pricer:Pick<ResearchClockPositionPricer,'quoteMany'|'invalidate'>;
  inventory:()=>Inventory;
  gasLamports:string;
  gasEvidence:string;
  recorder:{record:(kind:string,data:unknown)=>void};
  now?:()=>number;
  usd?:()=>UsdPrice|null;
  /** Existing validated entry path only; this adapter adds no new entry rule/math. */
  entryQuote?:(request:SizeRequest,signal:AbortSignal)=>Promise<SizeQuote|null>;
};
const amount=(v:string)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v))throw Error('RESEARCH_HELD_INVALID_AMOUNT');return BigInt(v);};
const validText=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/.test(v);
const need=(v:unknown,m:string)=>{if(!v)throw Error(m);};
export const HELD_PRICING_FAILURE_CODES=['HELD_PRICING_BUSY','HELD_PRICING_PROVIDER_CAPACITY','HELD_PRICING_ABORTED','HELD_PRICING_PROVIDER_TIMEOUT','HELD_PRICING_PROVIDER_COOLDOWN','HELD_PRICING_DISPATCH_UNAVAILABLE','HELD_PRICING_PROVIDER_RESPONSE_UNAVAILABLE','HELD_PRICING_BANK_CLOCK_UNAVAILABLE','HELD_PRICING_SLOT_UNAVAILABLE','HELD_PRICING_STALE_EVIDENCE','HELD_PRICING_INVENTORY_CHANGED','HELD_PRICING_DATA_UNAVAILABLE'] as const;
export type HeldPricingFailureCode=typeof HELD_PRICING_FAILURE_CODES[number];
/** Only static categories leave the pricing adapter. Never publish arbitrary
 * provider messages, URLs, account bytes or a false successful evaluation. */
export function heldPricingFailureCode(error:unknown):HeldPricingFailureCode{
 const name=error instanceof Error?error.name:'',message=error instanceof Error?error.message:typeof error==='string'?error:'';
 if(name==='AbortError'||/ABORT|CANCEL/.test(message))return 'HELD_PRICING_ABORTED';
 if(/POSITION_BATCH_CAPACITY|DEPENDENCY_CAP|HELD_POSITION_CAPACITY/.test(message))return 'HELD_PRICING_PROVIDER_CAPACITY';
 if(/CONCURRENT|READ_IN_FLIGHT|PHYSICAL_SLOT_OCCUPIED|DISPATCH_BUSY/.test(message))return 'HELD_PRICING_BUSY';
 if(/PHYSICAL_TIMEOUT|REQUEST_TIMEOUT|preparation timeout/.test(message))return 'HELD_PRICING_PROVIDER_TIMEOUT';
 if(/COOLDOWN|HTTP_STATUS_429|HTTP_STATUS_503/.test(message))return 'HELD_PRICING_PROVIDER_COOLDOWN';
 if(/ADMISSION|DISPATCH_EXPIRED|START_DEADLINE|START_LIMIT|SPACING|RESOURCE_RESERVE/.test(message))return 'HELD_PRICING_DISPATCH_UNAVAILABLE';
 if(/SLOT|REGRESSING|INCOHERENT_BATCH|SOURCE_CONTEXT|CONTEXT_MISMATCH/.test(message))return 'HELD_PRICING_SLOT_UNAVAILABLE';
 if(/RESEARCH_CLOCK_(OWNER_OR_ENCODING|LAYOUT|TIMESTAMP_RANGE|NOT_CURRENT_WITHIN)|RESEARCH_HELD_CLOCK_AGE/.test(message))return 'HELD_PRICING_BANK_CLOCK_UNAVAILABLE';
 if(/AGE|EXPIRED|STALE/.test(message))return 'HELD_PRICING_STALE_EVIDENCE';
 if(/POSITION_CHANGED|INTERRUPTED_CONTEXT/.test(message))return 'HELD_PRICING_INVENTORY_CHANGED';
 if(/HTTP|RPC|RESPONSE/.test(message))return 'HELD_PRICING_PROVIDER_RESPONSE_UNAVAILABLE';
 return 'HELD_PRICING_DATA_UNAVAILABLE';
}

export class ResearchHeldMarket {
  private readonly pools=new Map<string,VerifiedMarketPool>();
  private readonly floors=new Map<string,number>();
  private readonly snapshots=new Map<string,ResearchClockQuote>();
  private busy=false;
  private inFlightQuotes=0;
  private generation=0;
  private lastContext:{at:number;state:'available'|'unavailable';reasonCode:HeldPricingFailureCode|null;heldPositions:number}|null=null;
  private readonly contextFailureCounts:Partial<Record<HeldPricingFailureCode,number>>={};
  private readonly now:()=>number;
  constructor(private readonly options:Options){
    this.now=options.now??Date.now;need(amount(options.gasLamports)>0n&&validText(options.gasEvidence),'RESEARCH_HELD_EXPLICIT_GAS_REQUIRED');
    this.options={...options,gasLamports:options.gasLamports,gasEvidence:options.gasEvidence};
  }
  registerPool(pool:VerifiedMarketPool){
    need(new PublicKey(pool.mint).toBase58()===pool.mint&&pool.migrationVerified===true&&Number.isSafeInteger(pool.migrationSlot)&&pool.migrationSlot>=0&&validText(pool.evidence),'RESEARCH_HELD_VERIFIED_POOL_REQUIRED');
    need(this.pools.has(pool.mint)||this.pools.size<RESEARCH_CLOCK_COHERENT_POOL_CAPACITY+7,'RESEARCH_HELD_POOL_CAPACITY');
    const old=this.pools.get(pool.mint);need(!old||old.migrationSlot===pool.migrationSlot,'RESEARCH_HELD_MIGRATION_CONFLICT');
    this.pools.set(pool.mint,Object.freeze({...pool}));
  }
  /** Retire replaceable observation ownership only. Financial inventory and
   * its migration/accounting evidence belong to the caller and are untouched.
   * Other held snapshots remain usable; the pricer's provider-bounded link cache
   * already evicts unrequested mints on its next coherent holding read.
   */
  unregisterPool(mint:string){
    need(new PublicKey(mint).toBase58()===mint,'RESEARCH_HELD_INVALID_RETIREMENT_MINT');
    const inventory=this.options.inventory();
    need(!inventory.positions[mint]&&!Object.values(inventory.pending).some(order=>order.mint===mint),'RESEARCH_HELD_OWNED_FINANCIAL_EXPOSURE');
    need(!this.busy&&this.inFlightQuotes===0,'RESEARCH_HELD_MARKET_READ_IN_FLIGHT');
    if(!this.pools.has(mint))return false;
    this.options.recorder.record('research-held-market-pool-retired',{at:this.clock(),mint,financialStateChanged:false,otherHeldSnapshotsPreserved:true});
    this.generation++;this.pools.delete(mint);this.floors.delete(mint);this.snapshots.delete(mint);return true;
  }
  minimumSlot(mint:string,slot:number){
    need(this.pools.has(mint)&&Number.isSafeInteger(slot)&&slot>=0,'RESEARCH_HELD_MINIMUM_SLOT');
    this.floors.set(mint,Math.max(slot,this.floors.get(mint)??0));
  }
  invalidate(reason:string){
    need(validText(reason),'RESEARCH_HELD_INVALIDATION_REASON');this.generation++;this.snapshots.clear();this.options.pricer.invalidate(reason);
    this.options.recorder.record('research-held-market-invalidation',{at:this.clock(),reason,financialStateChanged:false});
  }
  private clock(){const now=this.now();need(Number.isSafeInteger(now)&&now>=0,'RESEARCH_HELD_CLOCK');return now;}
  private price():UsdPrice|null{
    try{const p=this.options.usd?.(),at=this.clock();if(p&&amount(p.microUsdPerSol)>0n&&validText(p.source)&&Number.isSafeInteger(p.at)&&p.at<=at&&at-p.at<=10000)return {...p};}catch{}
    return null;
  }
  private current(mint:string,units:string){const p=this.options.inventory().positions[mint];return !!p&&p.mint===mint&&p.units===units;}
  private noteContext(heldPositions:number,reasonCode:HeldPricingFailureCode|null){this.lastContext={at:this.clock(),state:reasonCode?'unavailable':'available',reasonCode,heldPositions};if(reasonCode)this.contextFailureCounts[reasonCode]=Math.min(Number.MAX_SAFE_INTEGER,(this.contextFailureCounts[reasonCode]??0)+1);}
  usage(){return {lastContext:this.lastContext?{...this.lastContext}:null,contextFailureCounts:{...this.contextFailureCounts}};}
  /** Reuse only an existing fresh actual-inventory snapshot. No request, cached
   * reserve refresh, quote-size substitution or financial mutation occurs. */
  currentObservation(mint:string,units:string):ResearchClockQuote|null{
    try{const q=this.snapshots.get(mint);need(q&&q.sell.inputBaseUnits===units&&this.current(mint,units),'RESEARCH_HELD_EXACT_SIZE_REQUIRED');this.source(q!);return structuredClone(q!);}catch{return null;}
  }
  private source(q:ResearchClockQuote,minSlot=0){
    const now=this.clock(),requestedAt=Date.parse(q.requestedAt),receivedAt=Date.parse(q.receivedAt),validatedAt=Date.parse(q.validatedAt),pool=this.pools.get(q.mint),floor=Math.max(minSlot,this.floors.get(q.mint)??0,pool?.migrationSlot??0);
    need(pool&&q.commitment==='confirmed'&&q.timeEvidence==='confirmed-bank-clock'&&Number.isSafeInteger(q.slot)&&q.slot>=floor&&q.clockSlot===q.slot,'RESEARCH_HELD_SOURCE_CONTEXT');
    need(Number.isSafeInteger(requestedAt)&&Number.isSafeInteger(receivedAt)&&Number.isSafeInteger(validatedAt)&&requestedAt<=receivedAt&&receivedAt<=validatedAt&&validatedAt<=now&&receivedAt<=now&&now-receivedAt<=2000,'RESEARCH_HELD_SOURCE_AGE');
    need(Number.isSafeInteger(q.marketClockUnixSeconds)&&q.marketClockUnixSeconds*1000<=now&&now-q.marketClockUnixSeconds*1000<=30000,'RESEARCH_HELD_CLOCK_AGE');
    return {requestedAt,receivedAt};
  }
  private evidence(q:ResearchClockQuote){return 'research-held-market:'+createHash('sha256').update(JSON.stringify({quote:q,gasLamports:this.options.gasLamports,gasEvidence:this.options.gasEvidence})).digest('hex');}
  /** Always refresh once per explicit context request. No cached price is
   * relabeled fresh. The caller schedules refreshes; this adapter adds no poller.
   */
  readonly context=async(positions:Readonly<Record<string,Position>>,signal:AbortSignal):Promise<ExecutionContext>=>{
    const result:ExecutionContext={price:this.price(),marks:{}};
    if(this.busy||signal.aborted){this.noteContext(Object.keys(positions).length,signal.aborted?'HELD_PRICING_ABORTED':'HELD_PRICING_BUSY');return result;}
    const selected=Object.entries(positions).map(([mint,p])=>({mint,units:p.units,positionMint:p.mint}));
    if(selected.length>RESEARCH_CLOCK_COHERENT_POOL_CAPACITY){this.snapshots.clear();this.noteContext(selected.length,'HELD_PRICING_PROVIDER_CAPACITY');return result;}
    const sourceExpiry=()=>{
      // Missing/changed holdings cannot inherit the expiry of an unaffected
      // subset. Cash-only context has no invented bank Clock or source expiry.
      delete result.sourceValidUntil;
      if(!selected.length||!selected.every(p=>p.mint===p.positionMint&&this.current(p.mint,p.units)&&result.marks[p.mint]?.pricedBaseUnits===p.units&&this.snapshots.get(p.mint)?.sell.inputBaseUnits===p.units))return;
      const expiry=Math.min(...selected.map(p=>this.snapshots.get(p.mint)!.marketClockUnixSeconds*1000+30000));
      // Preserve a known expiry even if wall time crossed it after the last
      // source check. Missing metadata must never disguise known stale facts.
      if(Number.isSafeInteger(expiry))result.sourceValidUntil=expiry;
    };
    this.snapshots.clear();this.busy=true;const generation=this.generation;let failure:HeldPricingFailureCode|null=null;
    try{
      signal.throwIfAborted();
      const requests=selected.filter(p=>p.mint===p.positionMint&&this.pools.has(p.mint)&&this.current(p.mint,p.units)).map(p=>({mint:new PublicKey(p.mint),fullBaseUnits:amount(p.units),minSlot:Math.max(this.pools.get(p.mint)!.migrationSlot,this.floors.get(p.mint)??0)}));
      if(requests.length){
        const batch=await this.options.pricer.quoteMany(requests,signal);signal.throwIfAborted();need(generation===this.generation,'RESEARCH_HELD_INTERRUPTED_CONTEXT');
        for(const r of requests){
          const mint=r.mint.toBase58(),q=batch.quotes[mint];if(!q){failure??=heldPricingFailureCode(batch.unavailable[mint]);continue;}
          try{
            need(q.mint===mint,'RESEARCH_HELD_QUOTE_MINT_MISMATCH');
            const time=this.source(q,r.minSlot);need(batch.context&&q.slot===batch.context.slot&&q.requestedAt===batch.context.requestedAt&&q.receivedAt===batch.context.receivedAt,'RESEARCH_HELD_INCOHERENT_BATCH');
            need(q.sell.inputBaseUnits===r.fullBaseUnits.toString()&&this.current(mint,q.sell.inputBaseUnits),'RESEARCH_HELD_POSITION_CHANGED');
            // A collapsed position can still have an executable positive gross
            // liquidation quote while cash pays more in gas than it returns.
            // Keep that quote and a conservative zero asset mark; suppressing
            // it would blind the cost stop. The ledger separately reserves and
            // charges cash fees and may still refuse an unaffordable exit.
            const output=amount(q.sell.outputLamports),gas=amount(this.options.gasLamports);
            this.floors.set(mint,Math.max(this.floors.get(mint)??0,q.slot));this.snapshots.set(mint,structuredClone(q));
            result.marks[mint]={netLamports:(output>gas?output-gas:0n).toString(),pricedBaseUnits:q.sell.inputBaseUnits,at:time.receivedAt,evidence:this.evidence(q)};
          }catch(error){failure??=heldPricingFailureCode(error);/* Unaffected holdings may continue. */}
        }
      }
      result.price=this.price();sourceExpiry();this.options.recorder.record('research-held-market-context',{at:this.clock(),context:result,classification:'ISOLATED_RESEARCH_ONLY',gasLamports:this.options.gasLamports,gasClassification:'simulated; subtracted once from marks, gross sell quote excludes separate execution gas'});
      signal.throwIfAborted();need(generation===this.generation,'RESEARCH_HELD_INTERRUPTED_CONTEXT');
      // Recorder delay or simultaneous account changes cannot leave stale marks.
      for(const [mint,q]of this.snapshots){try{this.source(q);need(this.current(mint,q.sell.inputBaseUnits),'RESEARCH_HELD_POSITION_CHANGED');}catch(error){failure??=heldPricingFailureCode(error);this.snapshots.delete(mint);delete result.marks[mint];}}
      result.price=this.price();sourceExpiry();
      this.noteContext(selected.length,Object.keys(result.marks).length===selected.length?null:failure??'HELD_PRICING_DATA_UNAVAILABLE');
      return structuredClone(result);
    }catch(error){this.noteContext(selected.length,heldPricingFailureCode(error));this.snapshots.clear();return {price:this.price(),marks:{}};}
    finally{this.busy=false;}
  };
  /** Decision quotes reuse only a current actual-size coherent snapshot. Buys
   * delegate the existing validated adapter and are never inferred from marks.
   */
  readonly quote=async(request:SizeRequest,signal:AbortSignal):Promise<SizeQuote|null>=>{
    const r=Object.freeze({...request});if(signal.aborted||!this.pools.has(r.mint))return null;
    this.inFlightQuotes++;
    try{
      need(['buy','sell'].includes(r.side)&&amount(r.inputUnits)>0n,'RESEARCH_HELD_SIZE_REQUEST');
      const floor=r.minSlot??0;need(Number.isSafeInteger(floor)&&floor>=0,'RESEARCH_HELD_MINIMUM_SLOT');
      if(r.side==='buy'){
        const generation=this.generation,required=Math.max(floor,this.pools.get(r.mint)!.migrationSlot,this.floors.get(r.mint)??0),q=await this.options.entryQuote?.({...r,minSlot:required},signal),at=this.clock(),currentFloor=Math.max(required,this.floors.get(r.mint)??0);
        need(q&&!signal.aborted&&generation===this.generation&&q.mint===r.mint&&q.side===r.side&&q.inputUnits===r.inputUnits&&Number.isSafeInteger(q.slot)&&q.slot!>=currentFloor&&q.at<=at&&at-q.at<=2000,'RESEARCH_HELD_ENTRY_DELEGATE_UNAVAILABLE');
        this.floors.set(r.mint,Math.max(this.floors.get(r.mint)??0,q!.slot!));return structuredClone(q!);
      }
      const q=this.snapshots.get(r.mint);need(q&&q.sell.inputBaseUnits===r.inputUnits&&this.current(r.mint,r.inputUnits),'RESEARCH_HELD_EXACT_SIZE_REQUIRED');
      const time=this.source(q!,floor);signal.throwIfAborted();
      return {...r,slot:q!.slot,outputUnits:q!.sell.outputLamports,at:time.receivedAt,evidence:this.evidence(q!),effectiveQuoteLiquidityLamports:q!.effectiveQuoteReserve};
    }catch{return null;}
    finally{this.inFlightQuotes--;}
  };
  /** Coordinator context must run AFTER the modeled delay. A pre-delay batch
   * cannot fill merely because its receive timestamp or age looks acceptable.
   * No missing quote causes an extra/retried network attempt here.
   */
  readonly executionQuote=async(request:QuoteRequest,signal:AbortSignal):Promise<ExecutionQuote|null>=>{
    const validPending=()=>{const current=this.options.inventory().pending[request.order.id];return current&&JSON.stringify(current)===JSON.stringify(request.order);};
    try{
      const order=request.order,now=this.clock();need(validPending()&&order.gas===this.options.gasLamports&&now>=order.executeAt&&now<order.expiresAt&&request.attemptedAt>=order.executeAt&&request.attemptedAt<=now,'RESEARCH_HELD_OWN_CURRENT_ACTION_REQUIRED');
      const q=await this.quote({mint:order.mint,side:order.side,inputUnits:order.side==='buy'?order.maxSpend:request.fullPositionBaseUnits!},signal);
      need(q&&validPending()&&!signal.aborted,'RESEARCH_HELD_ACTION_CHANGED');
      const at=this.clock();need(q!.at>=Math.max(order.executeAt,request.attemptedAt)&&q!.at<=at&&at-q!.at<=2000&&at<order.expiresAt,'RESEARCH_HELD_POST_DELAY_QUOTE_REQUIRED');
      if(order.side==='sell'){
        const state=this.snapshots.get(order.mint);need(state&&this.source(state).requestedAt>=Math.max(order.executeAt,request.attemptedAt)&&state.sell.inputBaseUnits===request.fullPositionBaseUnits&&this.current(order.mint,request.fullPositionBaseUnits!),'RESEARCH_HELD_POST_DELAY_STATE_REQUIRED');
      }
      this.options.recorder.record(order.side==='sell'?'research-held-market-execution-reuse':'research-held-market-delegated-entry',{at,orderId:order.id,side:order.side,quoteAt:q!.at,quoteSlot:q!.slot??null,classification:'ISOLATED_RESEARCH_ONLY',newNetworkRequests:order.side==='sell'?0:null,entryDelegateUsage:order.side==='buy'?'Count requests in the existing entry adapter; this wrapper does not claim an entry request saving.':null});
      return {at:q!.at,spendLamports:order.side==='buy'?q!.inputUnits:'0',receiveUnits:q!.outputUnits,evidence:q!.evidence,...(order.side==='sell'?{pricedBaseUnits:q!.inputUnits,refundedDepositLamports:q!.refundedDepositLamports,refundEvidence:q!.refundEvidence}:{})};
    }catch{return null;}
  };
}
