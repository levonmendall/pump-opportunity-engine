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

export class ResearchClockPositionPricer {
  private cached:{mint:string;first:Pool;slot:number}|null=null;private highestSlot=0;private busy=false;
  private networkCalls=0;private linkHits=0;private invalidations=0;
  constructor(private readonly rpc:Rpc,private readonly rec:Rec){}
  invalidate(reason='explicit-research-invalidation'){
    this.cached=null;this.invalidations++;
    this.rec.record('research-clock-cache-invalidation',{at:Date.now(),reason});
  }
  usage(){return {networkCalls:this.networkCalls,linkCacheHits:this.linkHits,invalidations:this.invalidations,highestVerifiedSlot:this.highestSlot,cachedPoolSlot:this.cached?.slot??null,timeEvidence:'confirmed-bank-clock',liveValidation:'UNTESTED'};}
  async quote(request:PositionSellRequest,signal?:AbortSignal){
    need(!this.busy,'RESEARCH_CLOCK_CONCURRENT_QUOTE');
    const minSlot=request.minSlot??0,units=request.fullBaseUnits,mint=new PublicKey(request.mint),name=mint.toBase58();
    need(Number.isSafeInteger(minSlot)&&minSlot>=0,'INVALID_MINIMUM_SLOT');
    need(typeof units==='bigint'&&units>0n&&units<=MAX_UNITS,'POSITION_SELL_SIZE_OUT_OF_RANGE');
    this.busy=true;
    try{
      signal?.throwIfAborted();
      let floor=Math.max(minSlot,this.highestSlot),first:Pool;
      const key=canonicalPumpPoolPda(mint);
      if(this.cached?.mint===name){first=this.cached.first;this.linkHits++;}
      else{
        this.networkCalls++;
        const initial=await this.rpc.call<Batch>('getMultipleAccounts',[[key.toBase58()],{encoding:'base64',commitment:'confirmed',minContextSlot:floor}],signal);
        checkedBatch(initial,1,floor);floor=Math.max(floor,initial.context.slot);
        first=PUMP_AMM_SDK.decodePool(poolInfo(initial.value[0]));
      }
      const addresses=[key,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,mint,NATIVE_MINT,first.poolBaseTokenAccount,first.poolQuoteTokenAccount,SYSVAR_CLOCK_PUBKEY].map(a=>a.toBase58());
      const requestedAt=new Date(Date.now()).toISOString();this.networkCalls++;
      const batch=await this.rpc.call<Batch>('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot:floor}],signal);
      const receivedAt=new Date(Date.now()).toISOString();checkedBatch(batch,8,floor);
      this.rec.record('research-clock-pool-state',{requestedAt,receivedAt,addresses,context:batch.context,value:batch.value});
      const timing=decodeResearchBankClock(batch.value[7],batch.context.slot);
      const state=decodeSupportedPoolAccounts(mint,key,first,batch.value.slice(0,7),batch.context,requestedAt,receivedAt);
      const summary={...state.summary,...timing,validatedAt:new Date(Date.now()).toISOString(),researchOnly:true as const};
      const quote=positionSellFromState({...state,summary},units,{record(){}},signal);
      const fresh=()=>need(Date.now()-Date.parse(receivedAt)>=0&&Date.now()-Date.parse(receivedAt)<=2000,'RESEARCH_CLOCK_QUOTE_AGE_AT_USE');
      fresh();
      this.rec.record('research-clock-position-sell-quote',quote);
      // A slow recorder cannot renew the original batch's availability time.
      fresh();
      // Only current bytes that passed every shared account check become link
      // discovery evidence. They never substitute a cached reserve or fee input.
      this.cached={mint:name,first:PUMP_AMM_SDK.decodePool(poolInfo(batch.value[0])),slot:batch.context.slot};
      this.highestSlot=Math.max(this.highestSlot,batch.context.slot);
      return quote;
    }catch(error){this.invalidate('quote-unavailable');throw error;}
    finally{this.busy=false;}
  }
}
