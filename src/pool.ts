import {createHash} from 'node:crypto';
import BN from 'bn.js';
import bs58 from 'bs58';
import {PublicKey,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,getAssociatedTokenAddressSync,getExtensionTypes,getAccountTypeOfMintType,getAccountLen,ExtensionType,MintLayout} from '@solana/spl-token';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda,pumpPoolAuthorityPda,lpMintPda,buyQuoteInput,sellBaseInput,computeFeesBps,type Pool} from './sdk.js';
import {ReadOnlyRpc} from './network.js';
import type {Recorder} from './recorder.js';
type EvidenceRecorder=Pick<Recorder,'record'>;

function need(condition:unknown,reason:string):asserts condition {if(!condition)throw new Error(reason);}
export type PoolWireAccount={data:[string,string];owner:string;lamports:number;executable:boolean;rentEpoch:number};
type WireAccount=PoolWireAccount;
type Batch={context:{slot:number};value:(WireAccount|null)[]};
function info(a:WireAccount|null|undefined):AccountInfo<Buffer>{need(a,'MISSING_ACCOUNT');return {...a,data:Buffer.from(a.data[0],'base64'),owner:new PublicKey(a.owner)};}
const n=(x:bigint|BN)=>new BN(x.toString());
const timestamp=()=>new Date(Date.now()).toISOString();
const MAX_TOKEN_UNITS=(1n<<64n)-1n;
const allowedMintExtensions=new Set([ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]);
export function checkMintExtensions(types:ExtensionType[]) {for(const t of types)need(allowedMintExtensions.has(t),`UNMODELED_BASE_EXTENSION:${ExtensionType[t]??t}`);}
/** Account sizing only. A fresh rent quote and actual account-existence check remain necessary. */
export function associatedAccountRequirements(program:PublicKey,mintExtensions:ExtensionType[]){
  need(program.equals(TOKEN_PROGRAM_ID)||program.equals(TOKEN_2022_PROGRAM_ID),'UNSUPPORTED_TOKEN_PROGRAM');
  checkMintExtensions(mintExtensions);
  const required=mintExtensions.map(getAccountTypeOfMintType).filter(t=>t!==ExtensionType.Uninitialized);
  const accountExtensions=program.equals(TOKEN_2022_PROGRAM_ID)?[...new Set([...required,ExtensionType.ImmutableOwner])]:required;
  return {accountLengthBytes:getAccountLen(accountExtensions),accountExtensions:accountExtensions.map(t=>ExtensionType[t]),rentLamports:null,rentStatus:'requires-current-RPC-and-account-existence-check' as const,depositTreatment:'refundable locked capital when a new account is required' as const};
}
function canonical(pool:Pool,mint:PublicKey,key:PublicKey){
  need(pool.index===0 && pool.baseMint.equals(mint) && pool.quoteMint.equals(NATIVE_MINT),'NOT_SUPPORTED_SOL_CANONICAL_POOL');
  need(pool.creator.equals(pumpPoolAuthorityPda(mint)) && key.equals(canonicalPumpPoolPda(mint)),'BAD_POOL_IDENTITY');
  need(pool.lpMint.equals(lpMintPda(key)),'BAD_LP_MINT');
}

export async function verifyMigration(rpc:ReadOnlyRpc,mint:PublicKey,signature:string,rec:EvidenceRecorder,signal?:AbortSignal){
  // Current mainnet v1 retains compiled JSON instruction indices; unlike web3's
  // v0 wire decoder this read path also accepts v1 (no signing/construction).
  const tx=await rpc.call<any>('getTransaction',[signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],signal);
  rec.record('migration-transaction',tx);
  need(tx && tx.meta && tx.meta.err===null,'MIGRATION_NOT_CONFIRMED_SUCCESSFUL');
  need(tx.version==='legacy'||tx.version===0||tx.version===1,'UNSUPPORTED_TRANSACTION_VERSION');
  const keys:string[]=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  const pool=canonicalPumpPoolPda(mint).toBase58();
  const discriminators=['migrate','migrate_v2'].map(name=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8));
  const matches=(ix:any,program:PublicKey,ds:Buffer[])=>keys[ix.programIdIndex]===program.toBase58() && typeof ix.data==='string' && ds.some(d=>Buffer.from(bs58.decode(ix.data)).subarray(0,8).equals(d)) && ix.accounts.some((i:number)=>keys[i]===mint.toBase58()) && ix.accounts.some((i:number)=>keys[i]===pool);
  const groups:any[]=[];
  tx.transaction.message.instructions.forEach((ix:any,index:number)=>{
    const inner=tx.meta.innerInstructions?.find((g:any)=>g.index===index)?.instructions??[];
    if(matches(ix,PUMP_PROGRAM_ID,discriminators)||inner.some((i:any)=>matches(i,PUMP_PROGRAM_ID,discriminators)))groups.push(inner);
  });
  need(groups.length>0,'MIGRATION_INSTRUCTION_NOT_VERIFIED');
  const createPool=createHash('sha256').update('global:create_pool').digest().subarray(0,8);
  need(groups.some(group=>group.some((ix:any)=>matches(ix,PUMP_AMM_PROGRAM_ID,[createPool]))),tx.meta.logMessages?.some((l:string)=>l.includes('Bonding curve already migrated'))?'MIGRATION_ALREADY_COMPLETED_RETRY':'POOL_CREATION_CPI_NOT_VERIFIED');
  return {signature,slot:tx.slot,blockTime:tx.blockTime,commitment:'confirmed',instructionVerified:true,creationCpiVerified:true,transactionVersion:tx.version};
}

async function readSupportedPool(rpc:ReadOnlyRpc,mint:PublicKey,rec:EvidenceRecorder,minSlot:number,signal?:AbortSignal){
  need(Number.isSafeInteger(minSlot)&&minSlot>=0,'INVALID_MINIMUM_SLOT');
  const key=canonicalPumpPoolPda(mint);
  const initial=await rpc.call<Batch>('getMultipleAccounts',[[key.toBase58()],{encoding:'base64',commitment:'confirmed',minContextSlot:minSlot}],signal);
  need(initial&&Number.isSafeInteger(initial.context?.slot)&&initial.context.slot>=minSlot,'REGRESSING_INITIAL_POOL_CONTEXT');
  const firstInfo=info(initial.value[0]);need(firstInfo.owner.equals(PUMP_AMM_PROGRAM_ID),'BAD_POOL_OWNER');
  const first=PUMP_AMM_SDK.decodePool(firstInfo);canonical(first,mint,key);
  const addresses=[key,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,mint,NATIVE_MINT,first.poolBaseTokenAccount,first.poolQuoteTokenAccount];
  const requestedAt=timestamp();
  const batch=await rpc.call<Batch>('getMultipleAccounts',[addresses.map(k=>k.toBase58()),{encoding:'base64',commitment:'confirmed',minContextSlot:Math.max(minSlot,initial.context.slot)}],signal);
  need(batch&&Number.isSafeInteger(batch.context?.slot)&&batch.context.slot>=Math.max(minSlot,initial.context.slot),'REGRESSING_POOL_BATCH_CONTEXT');
  const receivedAt=timestamp();
  rec.record('pool-state',{requestedAt,receivedAt,addresses:addresses.map(a=>a.toBase58()),...batch});
  const marketBlockTime=await rpc.call<number|null>('getBlockTime',[batch.context.slot],signal);
  return decodeSupportedPool(mint,key,first,batch.value,batch.context,requestedAt,receivedAt,marketBlockTime);
}

/** Pure pricing inputs from one complete confirmed dependency batch. Time
 * provenance is validated by the caller, never inferred from slot ordering. */
export function decodeSupportedPoolAccounts(mint:PublicKey,key:PublicKey,first:Pool,values:(WireAccount|null)[],context:{slot:number},requestedAt:string,receivedAt:string){
  const [pi,gi,fi,mi,qi,bi,vi]=values.map(info);
  need(pi&&gi&&fi&&mi&&qi&&bi&&vi,'MISSING_POOL_STATE');
  need(pi.owner.equals(PUMP_AMM_PROGRAM_ID)&&gi.owner.equals(PUMP_AMM_PROGRAM_ID)&&fi.owner.equals(PUMP_FEE_PROGRAM_ID),'BAD_CONFIG_OWNER');
  const pool=PUMP_AMM_SDK.decodePool(pi);canonical(pool,mint,key);
  need(pool.poolBaseTokenAccount.equals(first.poolBaseTokenAccount)&&pool.poolQuoteTokenAccount.equals(first.poolQuoteTokenAccount),'POOL_LINKS_CHANGED');
  need(mi.owner.equals(TOKEN_PROGRAM_ID)||mi.owner.equals(TOKEN_2022_PROGRAM_ID),'UNSUPPORTED_TOKEN_PROGRAM');
  need(qi.owner.equals(TOKEN_PROGRAM_ID),'QUOTE_PROGRAM_NOT_LEGACY_SOL');
  const baseMint=unpackMint(mint,mi,mi.owner);const quoteMint=unpackMint(NATIVE_MINT,qi,TOKEN_PROGRAM_ID);
  const extensions=getExtensionTypes(baseMint.tlvData);checkMintExtensions(extensions);
  need(baseMint.isInitialized && quoteMint.isInitialized && baseMint.freezeAuthority===null && baseMint.mintAuthority===null,'UNSAFE_OR_UNINITIALIZED_MINT');
  need(pool.poolBaseTokenAccount.equals(getAssociatedTokenAddressSync(mint,key,true,mi.owner))&&pool.poolQuoteTokenAccount.equals(getAssociatedTokenAddressSync(NATIVE_MINT,key,true,TOKEN_PROGRAM_ID)),'BAD_VAULT_ADDRESS');
  const base=unpackAccount(pool.poolBaseTokenAccount,bi,mi.owner),quote=unpackAccount(pool.poolQuoteTokenAccount,vi,TOKEN_PROGRAM_ID);
  for(const v of [base,quote]){
    need(v.isInitialized&&!v.isFrozen&&v.owner.equals(key)&&!v.delegate&&!v.closeAuthority,'UNUSABLE_VAULT');
    need(getExtensionTypes(v.tlvData).every(t=>t===ExtensionType.ImmutableOwner),'UNMODELED_VAULT_EXTENSION');
  }
  need(base.mint.equals(mint)&&quote.mint.equals(NATIVE_MINT),'VAULT_MINT_MISMATCH');
  const globalConfig=PUMP_AMM_SDK.decodeGlobalConfig(gi),feeConfig=PUMP_AMM_SDK.decodeFeeConfig(fi);
  // Conservative integration policy: any disabled instruction flag requires inspection.
  need(globalConfig.disableFlags===0,'POOL_PROGRAM_DISABLED_FLAGS');
  const baseReserve=n(base.amount),quoteReserve=n(quote.amount),effective=quoteReserve.add(pool.virtualQuoteReserves);
  need(baseReserve.gtn(0)&&effective.gtn(0),'NONPOSITIVE_EFFECTIVE_RESERVES');
  const opts={baseReserve,quoteReserve,virtualQuoteReserves:pool.virtualQuoteReserves,feeBucketsTotal:pool.protocolFees.add(pool.creatorFees),globalConfig,feeConfig,baseMintAccount:MintLayout.decode(mi.data.subarray(0,82)),baseMint:mint,coinCreator:pool.coinCreator,creator:pool.creator,quoteMint:NATIVE_MINT,isMayhemMode:pool.isMayhemMode,creatorFeeBps:pool.creatorFeeBps,slippage:0,tradeV2:false};
  const fees=computeFeesBps({...opts,baseMintSupply:n(baseMint.supply),quoteReserve:effective});
  const summary={pool:key.toBase58(),mint:mint.toBase58(),slot:context.slot,commitment:'confirmed' as const,requestedAt,receivedAt,tokenProgram:mi.owner.toBase58(),mintExtensions:extensions.map(t=>ExtensionType[t]),decimals:baseMint.decimals,poolFlags:{mayhem:pool.isMayhemMode,cashback:pool.isCashbackCoin,holderReward:pool.isHolderReward},rawBaseReserve:base.amount.toString(),rawQuoteReserve:quote.amount.toString(),virtualQuoteReserves:pool.virtualQuoteReserves.toString(),effectiveQuoteReserve:effective.toString(),feeBuckets:opts.feeBucketsTotal.toString(),feeBps:Object.fromEntries(Object.entries(fees).map(([k,v])=>[k,v.toString()])),creatorFeeApplied:!pool.coinCreator.equals(PublicKey.default),baseAssociatedAccount:associatedAccountRequirements(mi.owner,extensions),quoteAssociatedAccount:associatedAccountRequirements(TOKEN_PROGRAM_ID,[]),sdk:'@pump-fun/pump-swap-sdk@2.2.0' as const,mode:'QUOTE_ONLY' as const};
  return {opts,summary,mintSupply:baseMint.supply};
}

/** Existing production/read-only path retains exact slot-block-time evidence. */
function decodeSupportedPool(mint:PublicKey,key:PublicKey,first:Pool,values:(WireAccount|null)[],context:{slot:number},requestedAt:string,receivedAt:string,marketBlockTime:number|null){
  const state=decodeSupportedPoolAccounts(mint,key,first,values,context,requestedAt,receivedAt);
  need(marketBlockTime!==null && Math.abs(Date.now()-marketBlockTime*1000)<=30_000,'POOL_STATE_NOT_CURRENT_WITHIN_30_SECONDS');
  return {...state,summary:{...state.summary,marketBlockTime,validatedAt:timestamp(),maxMarketAgeMs:30_000}};
}

export async function quotePool(rpc:ReadOnlyRpc,mint:PublicKey,buyLamports:bigint,rec:EvidenceRecorder,minSlot=0,signal?:AbortSignal){
  need(typeof buyLamports==='bigint'&&buyLamports>0n && buyLamports<=MAX_TOKEN_UNITS,'INTEGRATION_SIZE_OUT_OF_RANGE');
  const state=await readSupportedPool(rpc,mint,rec,minSlot,signal);
  return buyFromState(state,buyLamports,rec,signal);
}

/** Identical exact-input SDK buy math over independently validated state. Clock
 * callers retain their own source evidence; no block timestamp is invented. */
export function buyFromState<S extends ReturnType<typeof decodeSupportedPoolAccounts>['summary']>({opts,summary}:{opts:ReturnType<typeof decodeSupportedPoolAccounts>['opts'];summary:S},buyLamports:bigint,rec:EvidenceRecorder,signal?:AbortSignal){
  need(typeof buyLamports==='bigint'&&buyLamports>0n&&buyLamports<=MAX_TOKEN_UNITS,'INTEGRATION_SIZE_OUT_OF_RANGE');
  signal?.throwIfAborted();
  const buy=buyQuoteInput({...opts,quote:n(buyLamports)});need(buy.base.gtn(0),'ZERO_BUY_OUTPUT');
  const sell=sellBaseInput({...opts,base:buy.base});
  // Independent quotes at one observed state; never a modeled future round trip.
  const currentResult={...summary,buy:{inputLamports:buyLamports.toString(),outputBaseUnits:buy.base.toString(),internalQuoteWithoutFees:buy.internalQuoteWithoutFees.toString()},correspondingSell:{inputBaseUnits:buy.base.toString(),outputLamports:sell.uiQuote.toString()},embeddedCosts:{buyBudgetAboveInternalCurveInputLamports:(buyLamports-BigInt(buy.internalQuoteWithoutFees.toString())).toString(),buyClassification:'SDK fee budget and integer rounding; not an itemized charged-fee total' as const,correspondingSellPoolFeeLamports:sell.internalQuoteAmountOut.sub(sell.uiQuote).toString()},limitations:['Same-state independent buy and sell estimates; no financial fill or future execution guarantee.','Pool deductions are already embedded in amounts; do not debit them again. Buy budget difference includes SDK rounding.','Excludes gas/rent/priority costs at quote layer; accounting must add them.','Confirmed batch context is retained; no claim of cross-source atomicity.']};
  rec.record('size-specific-quote',currentResult);return currentResult;
}

/** Price the actual full holding without requiring a hypothetical entry to succeed. */
export async function quotePositionSell(rpc:ReadOnlyRpc,mint:PublicKey,fullBaseUnits:bigint,rec:EvidenceRecorder,minSlot=0,signal?:AbortSignal){
  need(typeof fullBaseUnits==='bigint'&&fullBaseUnits>0n&&fullBaseUnits<=MAX_TOKEN_UNITS,'POSITION_SELL_SIZE_OUT_OF_RANGE');
  const {opts,summary,mintSupply}=await readSupportedPool(rpc,mint,rec,minSlot,signal);
  return positionSellFromState({opts,summary,mintSupply},fullBaseUnits,rec,signal);
}

export function positionSellFromState<S extends ReturnType<typeof decodeSupportedPoolAccounts>['summary']>({opts,summary,mintSupply}:{opts:ReturnType<typeof decodeSupportedPoolAccounts>['opts'];summary:S;mintSupply:bigint},fullBaseUnits:bigint,rec:EvidenceRecorder,signal?:AbortSignal){
  signal?.throwIfAborted();
  need(typeof fullBaseUnits==='bigint'&&fullBaseUnits>0n&&fullBaseUnits<=MAX_TOKEN_UNITS,'POSITION_SELL_SIZE_OUT_OF_RANGE');
  need(fullBaseUnits<=mintSupply,'POSITION_SELL_EXCEEDS_MINT_SUPPLY');
  // The SDK checks payout against the real vault net of retained fees; virtual
  // curve reserves alone cannot establish available exit proceeds.
  const sell=sellBaseInput({...opts,base:n(fullBaseUnits)});
  need(sell.uiQuote.gtn(0),'ZERO_POSITION_SELL_OUTPUT');
  const result={...summary,sell:{inputBaseUnits:fullBaseUnits.toString(),outputLamports:sell.uiQuote.toString(),grossCurveOutputLamports:sell.internalQuoteAmountOut.toString(),embeddedPoolFeeLamports:sell.internalQuoteAmountOut.sub(sell.uiQuote).toString()},limitations:['Current supported-pool full-size sell estimate only; no live fill or stop-price guarantee.','Embedded pool fees already reduce output; do not debit them again.','Output excludes network/priority fees and any separately evidenced account-deposit refund.','Confirmed state/context and original receive time are retained; callers must enforce execution/mark freshness.']};
  rec.record('position-size-sell-quote',result);return result;
}


export type PositionSellRequest={mint:PublicKey;fullBaseUnits:bigint;minSlot?:number};
export type PositionSellQuote=Awaited<ReturnType<typeof quotePositionSell>>;
/** Isolated comparison adapter: 1–3 holdings, exactly two coherent account reads
 * and one block-time check. No cache, stream state, USD source or account writes.
 * Unsupported/missing pools are isolated; shared context/network faults throw.
 */
export async function quotePositionsSell(rpc:ReadOnlyRpc,requests:readonly PositionSellRequest[],rec:EvidenceRecorder,signal?:AbortSignal){
  need(requests.length>0&&requests.length<=3,'POSITION_BATCH_CAPACITY');
  // Copy before the first asynchronous boundary; caller mutations cannot change
  // the quoted size, pool identity or minimum verification slot mid-request.
  const selected=requests.map(r=>({mint:new PublicKey(r.mint),fullBaseUnits:r.fullBaseUnits,minSlot:r.minSlot??0}));
  const names=selected.map(r=>r.mint.toBase58());
  need(new Set(names).size===names.length,'DUPLICATE_POSITION_MINT');
  for(const r of selected){need(typeof r.fullBaseUnits==='bigint'&&r.fullBaseUnits>0n&&r.fullBaseUnits<=MAX_TOKEN_UNITS,'POSITION_SELL_SIZE_OUT_OF_RANGE');need(Number.isSafeInteger(r.minSlot)&&r.minSlot>=0,'INVALID_MINIMUM_SLOT');}
  const minimum=Math.max(...selected.map(r=>r.minSlot));
  const keys=selected.map(r=>canonicalPumpPoolPda(r.mint));
  const initial=await rpc.call<Batch>('getMultipleAccounts',[keys.map(k=>k.toBase58()),{encoding:'base64',commitment:'confirmed',minContextSlot:minimum}],signal);
  need(initial&&Number.isSafeInteger(initial.context?.slot)&&initial.context.slot>=minimum&&Array.isArray(initial.value)&&initial.value.length===selected.length,'REGRESSING_INITIAL_POOL_CONTEXT');
  const unavailable:Record<string,string>={},quotes:Record<string,PositionSellQuote>={},valid:Array<{request:typeof selected[number];key:PublicKey;first:Pool;addresses:PublicKey[]}>=[];
  for(let i=0;i<selected.length;i++){
    const request=selected[i]!,key=keys[i]!;
    try{const firstInfo=info(initial.value[i]);need(firstInfo.owner.equals(PUMP_AMM_PROGRAM_ID),'BAD_POOL_OWNER');const first=PUMP_AMM_SDK.decodePool(firstInfo);canonical(first,request.mint,key);valid.push({request,key,first,addresses:[key,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,request.mint,NATIVE_MINT,first.poolBaseTokenAccount,first.poolQuoteTokenAccount]});}
    catch{unavailable[request.mint.toBase58()]='UNSUPPORTED_OR_MISSING_INITIAL_POOL';}
  }
  if(!valid.length)return {quotes,unavailable,context:null};
  const addresses=[...new Set(valid.flatMap(v=>v.addresses.map(a=>a.toBase58())))],requestedAt=timestamp();
  const batch=await rpc.call<Batch>('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',minContextSlot:Math.max(minimum,initial.context.slot)}],signal);
  need(batch&&Number.isSafeInteger(batch.context?.slot)&&batch.context.slot>=Math.max(minimum,initial.context.slot)&&Array.isArray(batch.value)&&batch.value.length===addresses.length,'REGRESSING_POOL_BATCH_CONTEXT');
  const receivedAt=timestamp();rec.record('pools-state',{requestedAt,receivedAt,addresses,...batch});
  const marketBlockTime=await rpc.call<number|null>('getBlockTime',[batch.context.slot],signal);
  need(marketBlockTime!==null&&Number.isSafeInteger(marketBlockTime)&&Math.abs(Date.now()-marketBlockTime*1000)<=30_000,'POOL_STATE_NOT_CURRENT_WITHIN_30_SECONDS');
  const indexed=new Map(addresses.map((address,i)=>[address,batch.value[i]!]));
  for(const {request,key,first,addresses:dependencies} of valid){
    signal?.throwIfAborted();
    let quote:PositionSellQuote;
    try{const state=decodeSupportedPool(request.mint,key,first,dependencies.map(a=>indexed.get(a.toBase58())??null),batch.context,requestedAt,receivedAt,marketBlockTime);quote=positionSellFromState(state,request.fullBaseUnits,{record(){}},signal);}
    catch{signal?.throwIfAborted();unavailable[request.mint.toBase58()]='UNSUPPORTED_MISSING_OR_UNAVAILABLE_POSITION_QUOTE';continue;}
    // Storage pressure is a collection failure, not a per-pool market rejection.
    rec.record('position-size-sell-quote',quote);quotes[request.mint.toBase58()]=quote;
  }
  return {quotes,unavailable,context:{slot:batch.context.slot,requestedAt,receivedAt,marketBlockTime}};
}
