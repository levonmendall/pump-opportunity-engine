/** Offline-developed research adapter. Not a production freshness replacement.
 * A same-batch Clock is bank-time evidence, never an invented block timestamp.
 */
import {PublicKey,SYSVAR_CLOCK_PUBKEY,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda,type Pool} from './sdk.js';
import {decodeSupportedPoolAccounts,positionSellFromState,type PoolWireAccount,type PositionSellRequest} from './pool.js';
import type {ReadOnlyRpc} from './network.js';
import type {Recorder} from './recorder.js';

type Rpc=Pick<ReadOnlyRpc,'call'>;
type Rec=Pick<Recorder,'record'>;
type Batch={context:{slot:number};value:(PoolWireAccount|null)[]};
const SYSVAR_OWNER='Sysvar1111111111111111111111111111111111111';
const MAX_UNITS=(1n<<64n)-1n;
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
function checkedBatch(batch:Batch,count:number,minSlot:number){
  need(batch&&Number.isSafeInteger(batch.context?.slot)&&batch.context.slot>=minSlot&&Array.isArray(batch.value)&&batch.value.length===count,'RESEARCH_CLOCK_REGRESSING_OR_MALFORMED_BATCH');
}
function poolInfo(wire:PoolWireAccount|null|undefined):AccountInfo<Buffer>{
  need(wire&&wire.owner===PUMP_AMM_PROGRAM_ID.toBase58()&&wire.data?.[1]==='base64','BAD_POOL_OWNER');
  return {...wire,owner:new PublicKey(wire.owner),data:Buffer.from(wire.data[0],'base64')};
}

/** Solana Clock rust layout: slot u64,epoch_start_timestamp i64,epoch u64,
 * leader_schedule_epoch u64,unix_timestamp i64. Synthetic fixture coverage does
 * not establish current RPC clock/account behavior; a live comparison is pending.
 */
export function decodeResearchBankClock(wire:PoolWireAccount|null|undefined,slot:number,at=Date.now()){
  need(Number.isSafeInteger(slot)&&slot>=0&&Number.isSafeInteger(at)&&at>=0,'RESEARCH_CLOCK_INVALID_CONTEXT');
  need(wire&&wire.owner===SYSVAR_OWNER&&wire.executable===false&&wire.data?.[1]==='base64','RESEARCH_CLOCK_OWNER_OR_ENCODING');
  need(typeof wire.data[0]==='string','RESEARCH_CLOCK_OWNER_OR_ENCODING');
  const raw=Buffer.from(wire.data[0],'base64');need(raw.length===40&&raw.toString('base64')===wire.data[0],'RESEARCH_CLOCK_LAYOUT');
  const accountSlot=raw.readBigUInt64LE(0),unix=raw.readBigInt64LE(32);
  need(accountSlot===BigInt(slot),'RESEARCH_CLOCK_CONTEXT_MISMATCH');
  need(unix>0n&&unix<=BigInt(Number.MAX_SAFE_INTEGER),'RESEARCH_CLOCK_TIMESTAMP_RANGE');
  const marketClockUnixSeconds=Number(unix);
  need(marketClockUnixSeconds*1000<=at&&at-marketClockUnixSeconds*1000<=30_000,'RESEARCH_CLOCK_NOT_CURRENT_WITHIN_30_SECONDS');
  return {timeEvidence:'confirmed-bank-clock' as const,clockAccount:SYSVAR_CLOCK_PUBKEY.toBase58(),clockSlot:slot,marketClockUnixSeconds,maxMarketAgeMs:30_000};
}

type ClockSummary=ReturnType<typeof decodeSupportedPoolAccounts>['summary']&ReturnType<typeof decodeResearchBankClock>&{validatedAt:string;researchOnly:true};
export type ResearchClockQuote=ReturnType<typeof positionSellFromState<ClockSummary>>;
export type ResearchClockQuoteBatch={quotes:Record<string,ResearchClockQuote>;unavailable:Record<string,string>;context:{slot:number;requestedAt:string;receivedAt:string;marketClockUnixSeconds:number}|null};
function refusal(error:unknown){const message=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_]{0,96}(?::[A-Za-z][A-Za-z0-9_]{0,48})?$/.test(message)?message:'RESEARCH_CLOCK_POOL_UNAVAILABLE';}

export class ResearchClockPositionPricer {
  private readonly cached=new Map<string,{first:Pool;slot:number}>();
  private readonly holdingSlots=new Map<string,number>();private highestSlot=0;private busy=false;
  private networkCalls=0;private linkHits=0;private invalidations=0;
  constructor(private readonly rpc:Rpc,private readonly rec:Rec){}
  invalidate(reason='explicit-research-invalidation'){
    this.cached.clear();this.invalidations++;
    this.rec.record('research-clock-cache-invalidation',{at:Date.now(),reason});
  }
  private invalidatePool(mint:string,reason:string){
    this.cached.delete(mint);this.invalidations++;
    this.rec.record('research-clock-cache-invalidation',{at:Date.now(),mint,reason});
  }
  usage(){return {networkCalls:this.networkCalls,linkCacheHits:this.linkHits,invalidations:this.invalidations,highestVerifiedSlot:this.highestSlot,highestHoldingSlots:Object.fromEntries(this.holdingSlots),cachedPoolSlot:this.cached.size===1?[...this.cached.values()][0]!.slot:null,cachedPoolSlots:Object.fromEntries([...this.cached].map(([mint,value])=>[mint,value.slot])),timeEvidence:'confirmed-bank-clock',liveValidation:'UNTESTED'};}
  /** Compatibility API: one holding either yields one fresh quote or refuses. */
  async quote(request:PositionSellRequest,signal?:AbortSignal):Promise<ResearchClockQuote>{
    const name=request.mint.toBase58(),batch=await this.quoteMany([request],signal),quote=batch.quotes[name];
    if(!quote)throw Error(batch.unavailable[name]??'RESEARCH_CLOCK_POOL_UNAVAILABLE');
    return quote;
  }
  /** One fresh union batch for1–3 hypothetical holdings. Only dependency links
   * are reused. Every quoted pool/config/fee/mint/vault and the common Clock is
   * newly read in this single context. A per-pool fault cannot price that pool;
   * a common batch/Clock/source-age fault makes the entire batch unavailable.
   */
  async quoteMany(requests:readonly PositionSellRequest[],signal?:AbortSignal):Promise<ResearchClockQuoteBatch>{
    need(!this.busy,'RESEARCH_CLOCK_CONCURRENT_QUOTE');
    need(requests.length>0&&requests.length<=3,'POSITION_BATCH_CAPACITY');
    const selected=requests.map(r=>({mint:new PublicKey(r.mint),units:r.fullBaseUnits,minSlot:r.minSlot??0}));
    const names=selected.map(r=>r.mint.toBase58());need(new Set(names).size===names.length,'DUPLICATE_POSITION_MINT');
    for(const r of selected){need(Number.isSafeInteger(r.minSlot)&&r.minSlot>=0,'INVALID_MINIMUM_SLOT');need(typeof r.units==='bigint'&&r.units>0n&&r.units<=MAX_UNITS,'POSITION_SELL_SIZE_OUT_OF_RANGE');}
    this.busy=true;
    const quotes:Record<string,ResearchClockQuote>={},unavailable:Record<string,string>={};
    try{
      signal?.throwIfAborted();
      // The union has a fixed maximum of three holdings. The shared highest slot
      // remains a conservative floor even after a holding leaves this cache.
      const active=new Set(names);for(const mint of this.cached.keys())if(!active.has(mint))this.cached.delete(mint);
      for(const mint of this.holdingSlots.keys())if(!active.has(mint))this.holdingSlots.delete(mint);
      let floor=Math.max(this.highestSlot,...selected.map(r=>Math.max(r.minSlot,this.holdingSlots.get(r.mint.toBase58())??0)));
      const missing=selected.filter(r=>!this.cached.has(r.mint.toBase58()));
      const discovered=new Map<string,Pool>();
      if(missing.length){
        const keys=missing.map(r=>canonicalPumpPoolPda(r.mint).toBase58());this.networkCalls++;
        const initial=await this.rpc.call<Batch>('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',minContextSlot:floor}],signal);
        checkedBatch(initial,missing.length,floor);floor=Math.max(floor,initial.context.slot);this.highestSlot=Math.max(this.highestSlot,initial.context.slot);
        for(let i=0;i<missing.length;i++){
          const name=missing[i]!.mint.toBase58();
          try{discovered.set(name,PUMP_AMM_SDK.decodePool(poolInfo(initial.value[i])));}
          catch(error){signal?.throwIfAborted();const reason=refusal(error);unavailable[name]=reason;this.invalidatePool(name,reason);}
        }
      }
      const holdings=selected.flatMap(request=>{
        const name=request.mint.toBase58(),cached=this.cached.get(name),first=cached?.first??discovered.get(name);
        if(!first)return [];
        if(cached)this.linkHits++;
        const key=canonicalPumpPoolPda(request.mint),addresses=[key,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,request.mint,NATIVE_MINT,first.poolBaseTokenAccount,first.poolQuoteTokenAccount].map(a=>a.toBase58());
        return [{request,name,key,first,addresses}];
      });
      if(!holdings.length)return {quotes,unavailable,context:null};
      const addresses=[...new Set([...holdings.flatMap(h=>h.addresses),SYSVAR_CLOCK_PUBKEY.toBase58()])];
      need(addresses.length<=16,'RESEARCH_CLOCK_DEPENDENCY_CAP');
      const requestedAt=new Date(Date.now()).toISOString();this.networkCalls++;
      const batch=await this.rpc.call<Batch>('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot:floor}],signal);
      const receivedAt=new Date(Date.now()).toISOString();checkedBatch(batch,addresses.length,floor);
      this.rec.record('research-clock-pool-state',{requestedAt,receivedAt,addresses,context:batch.context,value:batch.value});
      const indexed=new Map(addresses.map((address,i)=>[address,batch.value[i]??null]));
      const timing=decodeResearchBankClock(indexed.get(SYSVAR_CLOCK_PUBKEY.toBase58()),batch.context.slot);
      // A current shared bank context remains a floor even when every pool is
      // unavailable. Later recovery cannot borrow an older favorable snapshot.
      this.highestSlot=Math.max(this.highestSlot,batch.context.slot);
      const pendingCache=new Map<string,Pool>();
      const fresh=()=>{const now=Date.now();need(now-Date.parse(receivedAt)>=0&&now-Date.parse(receivedAt)<=2000,'RESEARCH_CLOCK_QUOTE_AGE_AT_USE');need(timing.marketClockUnixSeconds*1000<=now&&now-timing.marketClockUnixSeconds*1000<=30_000,'RESEARCH_CLOCK_NOT_CURRENT_WITHIN_30_SECONDS');};
      for(const h of holdings){
        signal?.throwIfAborted();let quote:ResearchClockQuote;
        try{
          const state=decodeSupportedPoolAccounts(h.request.mint,h.key,h.first,h.addresses.map(a=>indexed.get(a)??null),batch.context,requestedAt,receivedAt);
          const summary:ClockSummary={...state.summary,...timing,validatedAt:new Date(Date.now()).toISOString(),researchOnly:true};
          quote=positionSellFromState({...state,summary},h.request.units,{record(){}},signal);
          // Only exact bytes validated by the shared decoder can seed future
          // address discovery. No cached reserve/fee/value becomes a fresh mark.
          pendingCache.set(h.name,PUMP_AMM_SDK.decodePool(poolInfo(indexed.get(h.key.toBase58()))));
        }catch(error){signal?.throwIfAborted();const reason=refusal(error);unavailable[h.name]=reason;this.invalidatePool(h.name,reason);continue;}
        fresh();this.rec.record('research-clock-position-sell-quote',quote);fresh();quotes[h.name]=quote;
      }
      // A slow recorder cannot make earlier per-pool results fresh. Nothing is
      // returned or cached if this common availability condition has expired.
      fresh();signal?.throwIfAborted();
      for(const [mint,first] of pendingCache){this.cached.set(mint,{first,slot:batch.context.slot});this.holdingSlots.set(mint,Math.max(this.holdingSlots.get(mint)??0,batch.context.slot));}
      if(pendingCache.size)this.highestSlot=Math.max(this.highestSlot,batch.context.slot);
      return {quotes,unavailable,context:{slot:batch.context.slot,requestedAt,receivedAt,marketClockUnixSeconds:timing.marketClockUnixSeconds}};
    }catch(error){this.invalidate('quote-unavailable');throw error;}
    finally{this.busy=false;}
  }
}
