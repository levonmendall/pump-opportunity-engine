/** One existing read-only RPC call; spot price only, never a trade quote or audit. */
import {PublicKey,SYSVAR_CLOCK_PUBKEY,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda,pumpPoolAuthorityPda} from './sdk.js';
import {decodeResearchBankClock} from './research-clock-pricing.js';
import type {PoolWireAccount} from './pool.js';
import type {SalePricePoint} from './sale-review.js';
type Rpc={call<T>(method:string,params?:unknown[],signal?:AbortSignal):Promise<T>};
function need(v:unknown):asserts v{if(!v)throw Error('SALE_REVIEW_PRICE_UNAVAILABLE');}
function info(w:PoolWireAccount|null|undefined):AccountInfo<Buffer>{need(w&&w.executable===false&&w.data?.[1]==='base64'&&typeof w.data[0]==='string');const data=Buffer.from(w.data[0],'base64');need(data.toString('base64')===w.data[0]);return {...w,owner:new PublicKey(w.owner),data};}
export async function readSaleReviewPrice(rpc:Rpc,mintText:string,signal?:AbortSignal,now=Date.now):Promise<SalePricePoint> {
  const mint=new PublicKey(mintText),poolKey=canonicalPumpPoolPda(mint);
  const legacy=getAssociatedTokenAddressSync(mint,poolKey,true,TOKEN_PROGRAM_ID),extended=getAssociatedTokenAddressSync(mint,poolKey,true,TOKEN_2022_PROGRAM_ID),quoteKey=getAssociatedTokenAddressSync(NATIVE_MINT,poolKey,true,TOKEN_PROGRAM_ID);
  const addresses=[poolKey,mint,legacy,extended,quoteKey,SYSVAR_CLOCK_PUBKEY];
  const batch=await rpc.call<{context:{slot:number};value:(PoolWireAccount|null)[]}>('getMultipleAccounts',[addresses.map(p=>p.toBase58()),{encoding:'base64',commitment:'confirmed'}],signal);
  const observedAt=now();need(batch&&Number.isSafeInteger(batch.context?.slot)&&batch.context.slot>=0&&Array.isArray(batch.value)&&batch.value.length===6);
  const clock=decodeResearchBankClock(batch.value[5],batch.context.slot,observedAt),poolInfo=info(batch.value[0]),mintInfo=info(batch.value[1]);
  need(poolInfo.owner.equals(PUMP_AMM_PROGRAM_ID));need(mintInfo.owner.equals(TOKEN_PROGRAM_ID)||mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID));
  const pool=PUMP_AMM_SDK.decodePool(poolInfo),baseMint=unpackMint(mint,mintInfo,mintInfo.owner),baseKey=mintInfo.owner.equals(TOKEN_PROGRAM_ID)?legacy:extended;
  need(baseMint.isInitialized&&pool.index===0&&pool.baseMint.equals(mint)&&pool.quoteMint.equals(NATIVE_MINT)&&pool.creator.equals(pumpPoolAuthorityPda(mint))&&pool.poolBaseTokenAccount.equals(baseKey)&&pool.poolQuoteTokenAccount.equals(quoteKey));
  const base=unpackAccount(baseKey,info(batch.value[mintInfo.owner.equals(TOKEN_PROGRAM_ID)?2:3]),mintInfo.owner),quote=unpackAccount(quoteKey,info(batch.value[4]),TOKEN_PROGRAM_ID);
  need(base.isInitialized&&quote.isInitialized&&base.owner.equals(poolKey)&&quote.owner.equals(poolKey)&&base.mint.equals(mint)&&quote.mint.equals(NATIVE_MINT));
  const effective=quote.amount+BigInt(pool.virtualQuoteReserves.toString());need(base.amount>0n&&effective>0n);
  // Same reserve basis as existing pool pricing, with no fee/slippage simulation.
  return {quoteLamports:effective.toString(),baseUnits:base.amount.toString(),observedAt,sourceAt:clock.marketClockUnixSeconds*1000,decimals:baseMint.decimals};
}
