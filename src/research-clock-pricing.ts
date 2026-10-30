/** Offline-developed research adapter. Not a production freshness replacement.
 * A same-batch Clock is bank-time evidence, never an invented block timestamp.
 */
import {createHash} from 'node:crypto';
import {PublicKey,SYSVAR_CLOCK_PUBKEY,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda,type Pool} from './sdk.js';
import {decodeSupportedPoolAccounts,positionSellFromState,buyFromState,type PoolWireAccount,type PositionSellRequest} from './pool.js';
import type {ReadOnlyRpc} from './network.js';
import type {Recorder} from './recorder.js';
import type {PaperUnsignedMarketBatch} from './paper-unsigned-pumpswap.js';

type Admission={latestStartAt:number;admissionOpen:()=>boolean};
type Rpc={call<T>(method:string,params?:unknown[],signal?:AbortSignal,options?:{latestStartAt?:number;admissionOpen?:()=>boolean}):Promise<T>};
type Rec=Pick<Recorder,'record'>;
type Batch={context:{slot:number};value:(PoolWireAccount|null)[]};
const SYSVAR_OWNER='Sysvar1111111111111111111111111111111111111';
const MAX_UNITS=(1n<<64n)-1n;
// getMultipleAccounts accepts at most100 keys. Each supported pool adds four
// distinct keys (pool, base mint, base vault, quote vault); config, fee config,
// WSOL mint and Clock are shared. This is a coherent-read capacity, not an
// allocation/exposure policy. The actual union is checked before dispatch too.
export const RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY=100;
export const RESEARCH_CLOCK_COHERENT_POOL_CAPACITY=Math.floor((RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY-4)/4);
const OBSERVATION_POOL_CAPACITY=6;
const LINK_CACHE_CAPACITY=RESEARCH_CLOCK_COHERENT_POOL_CAPACITY+OBSERVATION_POOL_CAPACITY+1;
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
export type ResearchClockBuyQuote=ReturnType<typeof buyFromState<ClockSummary>>;
export type ResearchClockBuyRequest={mint:PublicKey;buyLamports:bigint;minSlot?:number};
export type ResearchClockObservationRequest={mint:PublicKey;minSlot?:number};
export type ResearchClockObservationSupport={mint:string;pool:string;at:number;sourceSlot:number;evidence:string;summary:ClockSummary};
export type ResearchClockObservationBatch={validations:Record<string,ResearchClockObservationSupport>;unavailable:Record<string,string>;context:ResearchClockQuoteBatch['context']};
export type ResearchClockQuoteBatch={quotes:Record<string,ResearchClockQuote>;unavailable:Record<string,string>;context:{slot:number;requestedAt:string;receivedAt:string;marketClockUnixSeconds:number}|null};
function refusal(error:unknown){const message=error instanceof Error?error.message:'';return /^[A-Z][A-Z0-9_]{0,96}(?::[A-Za-z][A-Za-z0-9_]{0,48})?$/.test(message)?message:'RESEARCH_CLOCK_POOL_UNAVAILABLE';}

// These refusals supply no contradictory pool/dependency bytes. Retaining
// already validated address links does not retain a price: every later call
// still reads and validates the full current dependency/Clock union. Unknown,
// malformed, regressing or stale source evidence keeps the invalidation path.
const transientLinkReadRefusals=new Set(['ABORTED','COOLDOWN','QUERY_COOLDOWN','PHYSICAL_SLOT_OCCUPIED','METHOD_PACING','LOWER_PRIORITY_DEFER','COMPONENT_PHYSICAL_TIMEOUT','COMPONENT_ABORTED','COMPONENT_HTTP_TRANSPORT','COMPONENT_HTTP_429','COMPONENT_HTTP_STATUS_502','COMPONENT_HTTP_STATUS_503','COMPONENT_HTTP_STATUS_504','COMPONENT_RPC_OVERLOAD','COMPONENT_RPC_ERROR_-32016','COMPONENT_DISPATCH_EXPIRED','COMPONENT_ADMISSION_CLOSED','RESEARCH_CLOCK_ADMISSION_CLOSED']);
function transientLinkReadRefusal(error:unknown):string|null{
  if(!(error instanceof Error))return null;
  if(error.name==='AbortError'||error.name==='TimeoutError')return error.name;
  const code=error.message.replace(/^PILOT_RPC_/,'');return transientLinkReadRefusals.has(code)?code:null;
}

export class ResearchClockPositionPricer {
  private readonly cached=new Map<string,{first:Pool;slot:number}>();
  // Bounded original bytes for unsigned construction only. No pricing path
  // consumes these as a fresh reserve/fee/Clock read.
  private readonly constructionBatches=new Map<string,PaperUnsignedMarketBatch>();
  constructionBatch(mint:string,slot:number|undefined,receivedAt:number):PaperUnsignedMarketBatch|null{const batch=this.constructionBatches.get(mint);return batch&&(slot===undefined||batch.slot===slot)&&Date.parse(batch.receivedAt)===receivedAt?structuredClone(batch):null;}
  private readonly holdingSlots=new Map<string,number>();private readonly observationSlots=new Map<string,number>();private readonly buySlots=new Map<string,number>();
  private heldActive=new Set<string>();private observationActive=new Set<string>();private buyActive=new Set<string>();private highestSlot=0;private busy=false;
  private networkCalls=0;private linkHits=0;private invalidations=0;private retainedLinkReadFailures=0;
  constructor(private readonly rpc:Rpc,private readonly rec:Rec){}
  invalidate(reason='explicit-research-invalidation'){
    this.cached.clear();this.constructionBatches.clear();this.invalidations++;
    this.rec.record('research-clock-cache-invalidation',{at:Date.now(),reason});
  }
  private invalidatePool(mint:string,reason:string){
    this.cached.delete(mint);this.constructionBatches.delete(mint);this.invalidations++;
    this.rec.record('research-clock-cache-invalidation',{at:Date.now(),mint,reason});
  }
  usage(){return {networkCalls:this.networkCalls,linkCacheHits:this.linkHits,invalidations:this.invalidations,retainedLinkReadFailures:this.retainedLinkReadFailures,highestVerifiedSlot:this.highestSlot,highestHoldingSlots:Object.fromEntries(this.holdingSlots),highestObservationSlots:Object.fromEntries(this.observationSlots),highestBuySlots:Object.fromEntries(this.buySlots),cachePoolCapacity:LINK_CACHE_CAPACITY,dependencyAccountCapacity:RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY,coherentPoolCapacity:RESEARCH_CLOCK_COHERENT_POOL_CAPACITY,capacityBasis:'Solana getMultipleAccounts100keys; four pool-specific and four common dependency accounts',cachedPoolSlot:this.cached.size===1?[...this.cached.values()][0]!.slot:null,cachedPoolSlots:Object.fromEntries([...this.cached].map(([mint,value])=>[mint,value.slot])),timeEvidence:'confirmed-bank-clock',liveValidation:'UNTESTED'};}
  /** Compatibility API: one holding either yields one fresh quote or refuses. */
  async quote(request:PositionSellRequest,signal?:AbortSignal):Promise<ResearchClockQuote>{
    const name=request.mint.toBase58(),batch=await this.quoteMany([request],signal),quote=batch.quotes[name];
    if(!quote)throw Error(batch.unavailable[name]??'RESEARCH_CLOCK_POOL_UNAVAILABLE');
    return quote;
  }
  /** Fresh actual-input buy state. Only validated dependency links may be
   * reused; every call obtains new reserve/config/mint/vault and Clock bytes.
   * This does not change either existing held or observation working set. */
  async quoteBuy(request:ResearchClockBuyRequest,signal?:AbortSignal,admission?:Admission):Promise<ResearchClockBuyQuote>{
    need(!this.busy,'RESEARCH_CLOCK_CONCURRENT_QUOTE');
    const mint=new PublicKey(request.mint),minSlot=request.minSlot??0;
    need(Number.isSafeInteger(minSlot)&&minSlot>=0,'INVALID_MINIMUM_SLOT');
    need(typeof request.buyLamports==='bigint'&&request.buyLamports>0n&&request.buyLamports<=MAX_UNITS,'INTEGRATION_SIZE_OUT_OF_RANGE');
    const result=await this.readMany([{mint,minSlot,buyLamports:request.buyLamports}],'buy',signal,admission),name=mint.toBase58();
    if(!result.buys[name])throw Error(result.unavailable[name]??'RESEARCH_CLOCK_POOL_UNAVAILABLE');
    return result.buys[name]!;
  }
  /** One fresh union batch within the provider's100-account limit. Only dependency links
   * are reused. Every quoted pool/config/fee/mint/vault and the common Clock is
   * newly read in this single context. A per-pool fault cannot price that pool;
   * a common batch/Clock/source-age fault makes the entire batch unavailable.
   */
  async quoteMany(requests:readonly PositionSellRequest[],signal?:AbortSignal,admission?:Admission):Promise<ResearchClockQuoteBatch>{
    need(!this.busy,'RESEARCH_CLOCK_CONCURRENT_QUOTE');
    need(requests.length>0&&requests.length<=RESEARCH_CLOCK_COHERENT_POOL_CAPACITY,'POSITION_BATCH_CAPACITY');
    const selected=requests.map(r=>({mint:new PublicKey(r.mint),units:r.fullBaseUnits,minSlot:r.minSlot??0}));
    const names=selected.map(r=>r.mint.toBase58());need(new Set(names).size===names.length,'DUPLICATE_POSITION_MINT');
    for(const r of selected){need(Number.isSafeInteger(r.minSlot)&&r.minSlot>=0,'INVALID_MINIMUM_SLOT');need(typeof r.units==='bigint'&&r.units>0n&&r.units<=MAX_UNITS,'POSITION_SELL_SIZE_OUT_OF_RANGE');}
    const result=await this.readMany(selected,'quote',signal,admission);
    return {quotes:result.quotes,unavailable:result.unavailable,context:result.context};
  }
  /** Current supported observation state needs no successful tiny hypothetical
   * buy/sell. Initial missing links use one batched discovery; all pool/mint/
   * vault/fee dependencies and Clock are then freshly read in one context. */
  async validateMany(requests:readonly ResearchClockObservationRequest[],signal?:AbortSignal,admission?:Admission):Promise<ResearchClockObservationBatch>{
    need(!this.busy,'RESEARCH_CLOCK_CONCURRENT_QUOTE');
    need(requests.length>0&&requests.length<=6,'OBSERVATION_BATCH_CAPACITY');
    const selected=requests.map(r=>({mint:new PublicKey(r.mint),minSlot:r.minSlot??0}));
    const names=selected.map(r=>r.mint.toBase58());need(new Set(names).size===names.length,'DUPLICATE_OBSERVATION_MINT');
    for(const r of selected)need(Number.isSafeInteger(r.minSlot)&&r.minSlot>=0,'INVALID_MINIMUM_SLOT');
    const result=await this.readMany(selected,'observation',signal,admission);
    return {validations:result.validations,unavailable:result.unavailable,context:result.context};
  }
  private async readMany(selected:readonly {mint:PublicKey;minSlot:number;units?:bigint;buyLamports?:bigint}[],purpose:'quote'|'observation'|'buy',signal?:AbortSignal,admission?:Admission){
    this.busy=true;let sourceReadAttempted=false;const names=selected.map(r=>r.mint.toBase58());
    const quotes:Record<string,ResearchClockQuote>={},buys:Record<string,ResearchClockBuyQuote>={},validations:Record<string,ResearchClockObservationSupport>={},unavailable:Record<string,string>={};
    try{
      signal?.throwIfAborted();
      const checkAdmission=()=>need(!admission||admission.admissionOpen()&&Date.now()<=admission.latestStartAt,'RESEARCH_CLOCK_ADMISSION_CLOSED');
      const options=admission?{latestStartAt:admission.latestStartAt,admissionOpen:admission.admissionOpen}:undefined;
      checkAdmission();
      // Separate bounded working sets preserve links across alternating held and
      // observation calls. Only links survive; reserve/fee/price bytes never do.
      const held=purpose==='quote'?new Set(names):this.heldActive,observed=purpose==='observation'?new Set(names):this.observationActive;
      let buying=purpose==='buy'?new Set(names):this.buyActive,active=new Set([...held,...observed,...buying]);
      // Replaceable entry links cannot evict the established held/observation
      // working sets. At the provider-derived capacity, only entry links give way.
      if(purpose!=='buy'&&active.size>LINK_CACHE_CAPACITY){buying=new Set();active=new Set([...held,...observed]);}
      need(active.size<=LINK_CACHE_CAPACITY,'RESEARCH_CLOCK_POOL_CACHE_CAPACITY');
      this.heldActive=held;this.observationActive=observed;this.buyActive=buying;
      for(const mint of this.buySlots.keys())if(!buying.has(mint))this.buySlots.delete(mint);
      for(const mint of this.cached.keys())if(!active.has(mint))this.cached.delete(mint);
      for(const mint of this.constructionBatches.keys())if(!active.has(mint))this.constructionBatches.delete(mint);
      const slots=purpose==='quote'?this.holdingSlots:purpose==='buy'?this.buySlots:this.observationSlots;for(const mint of slots.keys())if(!names.includes(mint))slots.delete(mint);
      let floor=Math.max(this.highestSlot,...selected.map(r=>Math.max(r.minSlot,this.holdingSlots.get(r.mint.toBase58())??0,this.observationSlots.get(r.mint.toBase58())??0,this.buySlots.get(r.mint.toBase58())??0)));
      const missing=selected.filter(r=>!this.cached.has(r.mint.toBase58()));
      const discovered=new Map<string,Pool>();
      if(missing.length){
        const keys=missing.map(r=>canonicalPumpPoolPda(r.mint).toBase58());this.networkCalls++;sourceReadAttempted=true;
        const initial=await this.rpc.call<Batch>('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',minContextSlot:floor}],signal,options);checkAdmission();
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
      if(!holdings.length)return {quotes,buys,validations,unavailable,context:null};
      const addresses=[...new Set([...holdings.flatMap(h=>h.addresses),SYSVAR_CLOCK_PUBKEY.toBase58()])];
      need(addresses.length<=RESEARCH_CLOCK_RPC_ACCOUNT_CAPACITY,'RESEARCH_CLOCK_DEPENDENCY_CAP');
      const requestedAt=new Date(Date.now()).toISOString();this.networkCalls++;
      checkAdmission();sourceReadAttempted=true;const batch=await this.rpc.call<Batch>('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot:floor}],signal,options);checkAdmission();
      const receivedAt=new Date(Date.now()).toISOString();checkedBatch(batch,addresses.length,floor);
      this.rec.record('research-clock-pool-state',{requestedAt,receivedAt,addresses,context:batch.context,value:batch.value});
      const indexed=new Map(addresses.map((address,i)=>[address,batch.value[i]??null]));
      const timing=decodeResearchBankClock(indexed.get(SYSVAR_CLOCK_PUBKEY.toBase58()),batch.context.slot);
      // A current shared bank context remains a floor even when every pool is
      // unavailable. Later recovery cannot borrow an older favorable snapshot.
      this.highestSlot=Math.max(this.highestSlot,batch.context.slot);
      const pendingCache=new Map<string,Pool>();
      const fresh=()=>{checkAdmission();const now=Date.now();need(now-Date.parse(receivedAt)>=0&&now-Date.parse(receivedAt)<=2000,purpose!=='observation'?'RESEARCH_CLOCK_QUOTE_AGE_AT_USE':'RESEARCH_CLOCK_SUPPORT_AGE_AT_USE');need(timing.marketClockUnixSeconds*1000<=now&&now-timing.marketClockUnixSeconds*1000<=30_000,'RESEARCH_CLOCK_NOT_CURRENT_WITHIN_30_SECONDS');};
      for(const h of holdings){
        signal?.throwIfAborted();let quote:ResearchClockQuote|undefined,buy:ResearchClockBuyQuote|undefined,support:ResearchClockObservationSupport|undefined;
        try{
          const state=decodeSupportedPoolAccounts(h.request.mint,h.key,h.first,h.addresses.map(a=>indexed.get(a)??null),batch.context,requestedAt,receivedAt);
          const summary:ClockSummary={...state.summary,...timing,validatedAt:new Date(Date.now()).toISOString(),researchOnly:true};
          if(purpose==='quote'){need(h.request.units!==undefined,'POSITION_SELL_SIZE_OUT_OF_RANGE');quote=positionSellFromState({...state,summary},h.request.units,{record(){}},signal);}else if(purpose==='buy'){need(h.request.buyLamports!==undefined,'INTEGRATION_SIZE_OUT_OF_RANGE');buy=buyFromState({...state,summary},h.request.buyLamports,{record(){}},signal);}else{const at=Date.now(),evidence='research-clock-observation-support:'+createHash('sha256').update(JSON.stringify({mint:h.name,summary,accounts:h.addresses.map(a=>indexed.get(a)),clock:indexed.get(SYSVAR_CLOCK_PUBKEY.toBase58())})).digest('hex');support={mint:h.name,pool:h.key.toBase58(),at,sourceSlot:batch.context.slot,evidence,summary};}
          // Only exact bytes validated by the shared decoder can seed future
          // address discovery. No cached reserve/fee/value becomes a fresh mark.
          pendingCache.set(h.name,PUMP_AMM_SDK.decodePool(poolInfo(indexed.get(h.key.toBase58()))));
        }catch(error){signal?.throwIfAborted();const reason=refusal(error);unavailable[h.name]=reason;this.invalidatePool(h.name,reason);continue;}
        fresh();if(quote){this.rec.record('research-clock-position-sell-quote',quote);fresh();quotes[h.name]=quote;}else if(buy){this.rec.record('research-clock-buy-quote',buy);fresh();buys[h.name]=buy;}else if(support){this.rec.record('research-clock-observation-support',support);fresh();validations[h.name]=support;}
      }
      // A slow recorder cannot make earlier per-pool results fresh. Nothing is
      // returned or cached if this common availability condition has expired.
      fresh();signal?.throwIfAborted();
      for(const [mint,first] of pendingCache){this.cached.set(mint,{first,slot:batch.context.slot});const slots=purpose==='quote'?this.holdingSlots:purpose==='buy'?this.buySlots:this.observationSlots;slots.set(mint,Math.max(slots.get(mint)??0,batch.context.slot));}
      if(pendingCache.size)this.highestSlot=Math.max(this.highestSlot,batch.context.slot);
      for(const h of holdings)if(quotes[h.name]||buys[h.name])this.constructionBatches.set(h.name,{mint:h.name,slot:batch.context.slot,requestedAt,receivedAt,accounts:h.addresses.map(a=>structuredClone(indexed.get(a)??null))});
      return {quotes,buys,validations,unavailable,context:{slot:batch.context.slot,requestedAt,receivedAt,marketClockUnixSeconds:timing.marketClockUnixSeconds}};
    }catch(error){
      if(sourceReadAttempted){
        const code=transientLinkReadRefusal(error);
        if(code){
          if(this.cached.size){this.retainedLinkReadFailures++;this.rec.record('research-clock-verified-links-retained',{at:Date.now(),reasonCode:code,cachedPools:this.cached.size,retainedPricesForPricing:false,unsignedConstructionBatches:this.constructionBatches.size,newLinksCommitted:false});}
        }else this.invalidate(purpose!=='observation'?'quote-unavailable':'observation-support-unavailable');
      }
      throw error;
    }
    finally{this.busy=false;}
  }
}
