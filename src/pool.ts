import {createHash} from 'node:crypto';
import BN from 'bn.js';
import bs58 from 'bs58';
import {PublicKey,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,getAssociatedTokenAddressSync,getExtensionTypes,ExtensionType,MintLayout} from '@solana/spl-token';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda,pumpPoolAuthorityPda,lpMintPda,buyQuoteInput,sellBaseInput,computeFeesBps,type Pool} from './sdk.js';
import {ReadOnlyRpc} from './network.js';
import type {Recorder} from './recorder.js';

function need(condition:unknown,reason:string):asserts condition {if(!condition)throw new Error(reason);}
type WireAccount={data:[string,string];owner:string;lamports:number;executable:boolean;rentEpoch:number};
type Batch={context:{slot:number};value:(WireAccount|null)[]};
function info(a:WireAccount|null|undefined):AccountInfo<Buffer>{need(a,'MISSING_ACCOUNT');return {...a,data:Buffer.from(a.data[0],'base64'),owner:new PublicKey(a.owner)};}
const n=(x:bigint|BN)=>new BN(x.toString());
const allowedMintExtensions=new Set([ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]);
export function checkMintExtensions(types:ExtensionType[]) {for(const t of types)need(allowedMintExtensions.has(t),`UNMODELED_BASE_EXTENSION:${ExtensionType[t]??t}`);}
function canonical(pool:Pool,mint:PublicKey,key:PublicKey){
  need(pool.index===0 && pool.baseMint.equals(mint) && pool.quoteMint.equals(NATIVE_MINT),'NOT_SUPPORTED_SOL_CANONICAL_POOL');
  need(pool.creator.equals(pumpPoolAuthorityPda(mint)) && key.equals(canonicalPumpPoolPda(mint)),'BAD_POOL_IDENTITY');
  need(pool.lpMint.equals(lpMintPda(key)),'BAD_LP_MINT');
}

export async function verifyMigration(rpc:ReadOnlyRpc,mint:PublicKey,signature:string,rec:Recorder){
  // Current mainnet v1 retains compiled JSON instruction indices; unlike web3's
  // v0 wire decoder this read path also accepts v1 (no signing/construction).
  const tx=await rpc.call<any>('getTransaction',[signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}]);
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

export async function quotePool(rpc:ReadOnlyRpc,mint:PublicKey,buyLamports:bigint,rec:Recorder,minSlot=0){
  need(buyLamports>10n && buyLamports<=1_000_000_000n,'INTEGRATION_SIZE_OUT_OF_RANGE');
  const key=canonicalPumpPoolPda(mint);
  const initial=await rpc.call<Batch>('getMultipleAccounts',[[key.toBase58()],{encoding:'base64',commitment:'confirmed',minContextSlot:minSlot}]);
  const firstInfo=info(initial.value[0]);need(firstInfo.owner.equals(PUMP_AMM_PROGRAM_ID),'BAD_POOL_OWNER');
  const first=PUMP_AMM_SDK.decodePool(firstInfo);canonical(first,mint,key);
  const addresses=[key,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,mint,NATIVE_MINT,first.poolBaseTokenAccount,first.poolQuoteTokenAccount];
  const requestedAt=new Date().toISOString();
  const batch=await rpc.call<Batch>('getMultipleAccounts',[addresses.map(k=>k.toBase58()),{encoding:'base64',commitment:'confirmed',minContextSlot:Math.max(minSlot,initial.context.slot)}]);
  const receivedAt=new Date().toISOString();
  rec.record('pool-state',{requestedAt,receivedAt,addresses:addresses.map(a=>a.toBase58()),...batch});
  const [pi,gi,fi,mi,qi,bi,vi]=batch.value.map(info);
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
  const buy=buyQuoteInput({...opts,quote:n(buyLamports)});need(buy.base.gtn(0),'ZERO_BUY_OUTPUT');
  const sell=sellBaseInput({...opts,base:buy.base});
  // Corresponding sell at the SAME observed pool state, not a simulated future fill.
  const fees=computeFeesBps({...opts,baseMintSupply:n(baseMint.supply),quoteReserve:effective});
  const marketBlockTime=await rpc.call<number|null>('getBlockTime',[batch.context.slot]);
  need(marketBlockTime!==null && Math.abs(Date.now()-marketBlockTime*1000)<=30_000,'POOL_STATE_NOT_CURRENT_WITHIN_30_SECONDS');
  const result={pool:key.toBase58(),mint:mint.toBase58(),slot:batch.context.slot,commitment:'confirmed',requestedAt,receivedAt,tokenProgram:mi.owner.toBase58(),mintExtensions:extensions.map(t=>ExtensionType[t]),decimals:baseMint.decimals,poolFlags:{mayhem:pool.isMayhemMode,cashback:pool.isCashbackCoin,holderReward:pool.isHolderReward},rawBaseReserve:base.amount.toString(),rawQuoteReserve:quote.amount.toString(),virtualQuoteReserves:pool.virtualQuoteReserves.toString(),effectiveQuoteReserve:effective.toString(),feeBuckets:opts.feeBucketsTotal.toString(),feeBps:Object.fromEntries(Object.entries(fees).map(([k,v])=>[k,v.toString()])),buy:{inputLamports:buyLamports.toString(),outputBaseUnits:buy.base.toString(),internalQuoteWithoutFees:buy.internalQuoteWithoutFees.toString()},correspondingSell:{inputBaseUnits:buy.base.toString(),outputLamports:sell.uiQuote.toString()},sdk:'@pump-fun/pump-swap-sdk@2.2.0',mode:'QUOTE_ONLY',limitations:['Same-state independent buy and sell estimates; no financial fill or future execution guarantee.','Excludes gas/rent/priority costs at quote layer; accounting must add them.','Confirmed batch context is retained; no claim of cross-source atomicity.']};
  const currentResult={...result,marketBlockTime,validatedAt:new Date().toISOString(),maxMarketAgeMs:30_000};
  rec.record('size-specific-quote',currentResult);return currentResult;
}
