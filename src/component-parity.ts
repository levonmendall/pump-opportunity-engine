/** Same-byte parity for the isolated public-RPC component; no network or account writes. */
import {PublicKey,SYSVAR_CLOCK_PUBKEY,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,unpackAccount} from '@solana/spl-token';
import BN from 'bn.js';
import {PUMP_AMM_SDK,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda,buyQuoteInput} from './sdk.js';
import {decodeSupportedPoolAccounts,positionSellFromState,type PoolWireAccount} from './pool.js';
import {decodeResearchBankClock,type ResearchClockQuote} from './research-clock-pricing.js';

export type ComponentSnapshot={addresses:string[];value:(PoolWireAccount|null)[];context:{slot:number};requestedAt:string;receivedAt:string};
function need(v:unknown,m:string):asserts v {if(!v)throw Error(m);}
function info(w:PoolWireAccount|null|undefined):AccountInfo<Buffer>{
  need(w&&w.data?.[1]==='base64'&&typeof w.data[0]==='string','COMPONENT_PARITY_MISSING_ACCOUNT');
  const data=Buffer.from(w.data[0],'base64');need(data.toString('base64')===w.data[0],'COMPONENT_PARITY_ACCOUNT_ENCODING');
  return {...w,data,owner:new PublicKey(w.owner)};
}
function decoded(snapshot:ComponentSnapshot,mint:string|PublicKey){
  const keyMint=new PublicKey(mint),key=canonicalPumpPoolPda(keyMint),receivedAt=Date.parse(snapshot.receivedAt),requestedAt=Date.parse(snapshot.requestedAt);
  need(Number.isSafeInteger(receivedAt)&&Number.isSafeInteger(requestedAt)&&requestedAt<=receivedAt,'COMPONENT_PARITY_TIMESTAMPS');
  need(snapshot.addresses.length===8&&snapshot.value.length===8&&new Set(snapshot.addresses).size===8,'COMPONENT_PARITY_DEPENDENCIES');
  const accounts=new Map(snapshot.addresses.map((a,i)=>[a,snapshot.value[i]]));
  const pool=PUMP_AMM_SDK.decodePool(info(accounts.get(key.toBase58())));
  const expected=[key,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,keyMint,NATIVE_MINT,pool.poolBaseTokenAccount,pool.poolQuoteTokenAccount].map(a=>a.toBase58());
  need([...expected,SYSVAR_CLOCK_PUBKEY.toBase58()].every(a=>accounts.has(a)),'COMPONENT_PARITY_DEPENDENCIES');
  const state=decodeSupportedPoolAccounts(keyMint,key,pool,expected.map(a=>accounts.get(a)??null),snapshot.context,snapshot.requestedAt,snapshot.receivedAt);
  const clockWire=accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58()),timing=decodeResearchBankClock(clockWire,snapshot.context.slot,receivedAt),raw=Buffer.from(clockWire!.data[0],'base64');
  const clock={...timing,owner:clockWire!.owner,executable:clockWire!.executable,rawBytes:raw.length,slot:raw.readBigUInt64LE(0).toString(),epochStartTimestamp:raw.readBigInt64LE(8).toString(),epoch:raw.readBigUInt64LE(16).toString(),leaderScheduleEpoch:raw.readBigUInt64LE(24).toString(),unixTimestamp:raw.readBigInt64LE(32).toString(),sourceAgeAtReceiptMs:receivedAt-timing.marketClockUnixSeconds*1000,provenance:'bank-clock-account-not-independent-block-timestamp' as const};
  const quoteWire=accounts.get(pool.poolQuoteTokenAccount.toBase58())!,quoteAccount=unpackAccount(pool.poolQuoteTokenAccount,info(quoteWire),TOKEN_PROGRAM_ID);
  need(quoteAccount.isNative&&quoteAccount.rentExemptReserve!==null,'COMPONENT_PARITY_WSOL_NOT_NATIVE');
  need(Number.isSafeInteger(quoteWire.lamports)&&quoteWire.lamports>=0,'COMPONENT_PARITY_LAMPORT_PRECISION');
  const required=quoteAccount.amount+quoteAccount.rentExemptReserve,native=BigInt(quoteWire.lamports);
  need(required<=native,'COMPONENT_PARITY_WSOL_BACKING');
  const nativeVault={address:pool.poolQuoteTokenAccount.toBase58(),tokenUnits:quoteAccount.amount.toString(),rentReserveLamports:quoteAccount.rentExemptReserve.toString(),nativeLamports:native.toString(),sufficientBacking:true as const,uncreditedExtraLamports:(native-required).toString()};
  return {state,clock,nativeVault};
}

/** Derive a fixed hypothetical quantity once from a same-state0.01SOL buy quote.
 * This constructs no transaction, financial position, or simulated fill.
 */
export function deriveComponentHypothetical(snapshot:ComponentSnapshot,mint:string|PublicKey){
  const {state,clock,nativeVault}=decoded(snapshot,mint),buy=buyQuoteInput({...state.opts,quote:new BN('10000000')});
  need(buy.base.gtn(0),'COMPONENT_PARITY_ZERO_HYPOTHETICAL');
  const sameStateSell=positionSellFromState(state,BigInt(buy.base.toString()),{record(){}});
  return {classification:'HYPOTHETICAL_COMPONENT_ONLY' as const,fullBaseUnits:buy.base.toString(),inputLamports:'10000000' as const,entryGasLamports:'7000' as const,entryCostLamports:'10007000' as const,exitGasLamports:'7000' as const,sameStateSell:sameStateSell.sell,clock,nativeVault,limitations:'Same-state quote-derived quantity and modeled gas assumptions, not an actual entry, position or financial result.'};
}

/** Re-run the established account decoder and SDK on identical captured bytes,
 * context, quantity and ORIGINAL observation times. This proves software parity,
 * not independent provider completeness or current freshness after replay.
 */
export function validateComponentParity(snapshot:ComponentSnapshot,mint:string|PublicKey,units:bigint,quote:ResearchClockQuote){
  const {state,clock,nativeVault}=decoded(snapshot,mint),established=positionSellFromState(state,units,{record(){}});
  need(JSON.stringify(established.sell)===JSON.stringify(quote.sell),'COMPONENT_PARITY_SELL_MISMATCH');
  need(Object.entries(state.summary).every(([k,v])=>JSON.stringify(v)===JSON.stringify((quote as unknown as Record<string,unknown>)[k])),'COMPONENT_PARITY_STATE_MISMATCH');
  need(quote.timeEvidence==='confirmed-bank-clock'&&quote.clockSlot===snapshot.context.slot&&quote.marketClockUnixSeconds===clock.marketClockUnixSeconds&&!('marketBlockTime'in quote),'COMPONENT_PARITY_CLOCK_MISMATCH');
  return {matches:true as const,comparison:'established-decoder-and-pinned-SDK-on-identical-bytes-times-and-size' as const,sdk:state.summary.sdk,slot:snapshot.context.slot,requestedAt:snapshot.requestedAt,receivedAt:snapshot.receivedAt,fullBaseUnits:units.toString(),sell:established.sell,feeBps:state.summary.feeBps,clock,nativeVault};
}
