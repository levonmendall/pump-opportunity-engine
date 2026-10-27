/** Research-only read reuse. This is never loaded by the production runtime.
 * Every quote still decodes a newly received, complete confirmed dependency
 * batch through the established pricing helper. Only pool-link discovery and
 * a very recent timestamp for the exact same slot can be reused.
 */
import {PublicKey} from '@solana/web3.js';
import {type ReadOnlyRpc} from './network.js';
import {quotePositionsSell,type PositionSellRequest} from './pool.js';
import {type Recorder} from './recorder.js';

type Rpc=Pick<ReadOnlyRpc,'call'>;
type WireAccount={data:[string,string];owner:string;lamports:number;executable:boolean;rentEpoch:number};
type Batch={context:{slot:number};value:(WireAccount|null)[]};
type RecorderLike=Pick<Recorder,'record'>;
type LinkCache={mint:string;batch:Batch;fetchedAt:number};
type TimeCache={slot:number;value:number;fetchedAt:number};
const copy=<T>(value:T):T=>structuredClone(value);

export class ResearchPositionPricer {
  private links:LinkCache|null=null;private time:TimeCache|null=null;private busy=false;
  private networkCalls=0;private linkHits=0;private timeHits=0;private invalidations=0;private highestVerifiedSlot=0;
  private readonly timeAge:number;
  constructor(private readonly rpc:Rpc,private readonly rec:RecorderLike,options:{maxBlockTimeCacheAgeMs?:number}={}){
    this.timeAge=options.maxBlockTimeCacheAgeMs??2000;
    if(!Number.isSafeInteger(this.timeAge)||this.timeAge<0||this.timeAge>2000)throw Error('RESEARCH_PRICING_TIMESTAMP_CACHE_AGE');
  }
  invalidate(reason='explicit-research-invalidation'){
    this.links=null;this.time=null;this.invalidations++;
    this.rec.record('research-pricing-cache-invalidation',{reason,at:Date.now()});
  }
  usage(){return {networkCalls:this.networkCalls,linkCacheHits:this.linkHits,sameSlotBlockTimeHits:this.timeHits,invalidations:this.invalidations,cachedPoolSlot:this.links?.batch.context.slot??null,cachedBlockTimeSlot:this.time?.slot??null,maxBlockTimeCacheAgeMs:this.timeAge,highestVerifiedSlot:this.highestVerifiedSlot};}
  async quote(request:PositionSellRequest,signal?:AbortSignal){
    if(this.busy)throw Error('RESEARCH_PRICING_CONCURRENT_CALL');
    const requestedMin=request.minSlot??0;
    if(!Number.isSafeInteger(requestedMin)||requestedMin<0)throw Error('INVALID_MINIMUM_SLOT');
    const selected={mint:new PublicKey(request.mint),fullBaseUnits:request.fullBaseUnits,minSlot:Math.max(requestedMin,this.highestVerifiedSlot)};
    this.busy=true;
    const mint=selected.mint.toBase58();let freshBatch:Batch|null=null,pendingTime:TimeCache|null=null;
    try{
      // Existing helper validates all quantities/context/pool fields and enforces
      // the 30s source-block limit. Cached discovery keeps its ORIGINAL context;
      // it is not represented as a newer confirmed read.
      const adapter={call:async<T>(method:string,params:unknown[]=[],abort?:AbortSignal):Promise<T>=>{
        abort?.throwIfAborted();
        if(method==='getMultipleAccounts'){
          const addresses=params[0] as string[];
          if(addresses.length===1&&this.links?.mint===mint&&this.links.batch.context.slot>=selected.minSlot){
            this.linkHits++;this.rec.record('research-pricing-cache-hit',{kind:'pool-link-discovery',sourceSlot:this.links.batch.context.slot,originalFetchedAt:this.links.fetchedAt,usedAt:Date.now()});
            return copy(this.links.batch) as T;
          }
          this.networkCalls++;const batch=await this.rpc.call<Batch>(method,params,abort);
          if(addresses.length>1)freshBatch=copy(batch);
          return batch as T;
        }
        if(method==='getBlockTime'){
          const slot=params[0] as number,now=Date.now();
          if(this.time?.slot===slot&&now>=this.time.fetchedAt&&now-this.time.fetchedAt<=this.timeAge&&this.timeAge>0){
            this.timeHits++;this.rec.record('research-pricing-cache-hit',{kind:'same-slot-block-time',sourceSlot:slot,originalFetchedAt:this.time.fetchedAt,usedAt:now,ageMs:now-this.time.fetchedAt,maxAgeMs:this.timeAge});
            return this.time.value as T;
          }
          this.networkCalls++;const value=await this.rpc.call<number|null>(method,params,abort);
          if(Number.isSafeInteger(value))pendingTime={slot,value:value!,fetchedAt:Date.now()};
          return value as T;
        }
        throw Error('RESEARCH_PRICING_UNEXPECTED_METHOD');
      }};
      const result=await quotePositionsSell(adapter as ReadOnlyRpc,[selected],this.rec,signal);
      if(!result.quotes[mint]||!freshBatch){this.invalidate('quote-unavailable');return result;}
      const verified=freshBatch as Batch;
      this.highestVerifiedSlot=Math.max(this.highestVerifiedSlot,verified.context.slot);
      // Position0 is the pool in the helper's single-pool dependency batch.
      // The helper has now verified these exact bytes and all linked accounts.
      this.links={mint,batch:{context:copy(verified.context),value:[copy(verified.value[0]??null)]},fetchedAt:Date.parse(result.quotes[mint]!.receivedAt)};
      if(pendingTime)this.time=pendingTime;
      return result;
    }catch(error){this.invalidate('quote-error');throw error;}
    finally{this.busy=false;}
  }
}
