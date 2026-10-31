/** Pure interpretation of already observed PumpSwap reserves. The raw quote
 * vault can contain retained fees. Economic comparisons must be invariant to
 * an offsetting raw/virtual/fee-bucket accounting movement such as a fee sweep.
 * Snapshot differences describe effects; they do not prove the transaction
 * that caused them, beneficial ownership, or a liquidity withdrawal. */
export const ECONOMIC_RESERVE_COMPARISON_VERSION='effective-curve-and-available-funds-v1' as const;

export type EconomicReserveInput={
 baseReserveUnits:string;rawQuoteReserveLamports:string;virtualQuoteReserveLamports:string;
 /** Omit when the source does not report accumulated fees. Never infer zero. */
 feeBucketsLamports?:string;
};
export type EconomicReserves={baseReserveUnits:string;effectiveQuoteReserveLamports:string;availableQuoteReserveLamports:string|null};
export type EconomicReserveChange={
 version:typeof ECONOMIC_RESERVE_COMPARISON_VERSION;
 classification:'UNCHANGED'|'ACCOUNTING_OFFSET_COMPATIBLE'|'EFFECTIVE_DEPTH_UNCHANGED_REAL_FUNDS_UNKNOWN'|'SELL_LIKE_CHANGE_CAUSE_UNVERIFIED'|'BOTH_RESERVES_DECREASED_CAUSE_UNVERIFIED'|'ECONOMIC_RESERVE_DECREASE_CAUSE_UNVERIFIED'|'RESERVES_NONDECREASING'|'EFFECTIVE_DEPTH_NONDECREASING_REAL_FUNDS_UNKNOWN';
 cause:'UNVERIFIED_SNAPSHOT_DIFFERENCE';
 effectiveQuoteChangeLamports:string;availableQuoteChangeLamports:string|null;baseReserveChangeUnits:string;
 effectiveQuoteDecreaseLamports:string;availableQuoteDecreaseLamports:string|null;
 economicDecreaseObserved:boolean;economicNondecreaseObserved:boolean;
};
const unsigned=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const signed=(v:unknown):v is string=>typeof v==='string'&&/^(0|-?[1-9][0-9]{0,38})$/.test(v);
const positivePart=(v:bigint)=>v>0n?v:0n;

export function normalizeEconomicReserves(input:EconomicReserveInput):EconomicReserves|null{
 if(!input||!unsigned(input.baseReserveUnits)||!unsigned(input.rawQuoteReserveLamports)||!signed(input.virtualQuoteReserveLamports)||input.feeBucketsLamports!==undefined&&!unsigned(input.feeBucketsLamports))return null;
 const base=BigInt(input.baseReserveUnits),raw=BigInt(input.rawQuoteReserveLamports),effective=raw+BigInt(input.virtualQuoteReserveLamports),buckets=input.feeBucketsLamports===undefined?null:BigInt(input.feeBucketsLamports);
 if(base<=0n||effective<0n||buckets!==null&&buckets>raw)return null;
 return {baseReserveUnits:base.toString(),effectiveQuoteReserveLamports:effective.toString(),availableQuoteReserveLamports:buckets===null?null:(raw-buckets).toString()};
}

export function describeEconomicReserveChange(before:EconomicReserveInput,after:EconomicReserveInput):EconomicReserveChange|null{
 const a=normalizeEconomicReserves(before),b=normalizeEconomicReserves(after);if(!a||!b)return null;
 const base=BigInt(b.baseReserveUnits)-BigInt(a.baseReserveUnits),effective=BigInt(b.effectiveQuoteReserveLamports)-BigInt(a.effectiveQuoteReserveLamports),available=a.availableQuoteReserveLamports===null||b.availableQuoteReserveLamports===null?null:BigInt(b.availableQuoteReserveLamports)-BigInt(a.availableQuoteReserveLamports);
 const decrease=effective<0n||available!==null&&available<0n;
 let classification:EconomicReserveChange['classification'];
 if(effective===0n&&base===0n&&available===0n)classification=before.rawQuoteReserveLamports===after.rawQuoteReserveLamports&&before.virtualQuoteReserveLamports===after.virtualQuoteReserveLamports&&before.feeBucketsLamports===after.feeBucketsLamports?'UNCHANGED':'ACCOUNTING_OFFSET_COMPATIBLE';
 else if(effective===0n&&base===0n&&available===null)classification='EFFECTIVE_DEPTH_UNCHANGED_REAL_FUNDS_UNKNOWN';
 else if(effective<0n&&base>0n)classification='SELL_LIKE_CHANGE_CAUSE_UNVERIFIED';
 else if(effective<0n&&base<0n)classification='BOTH_RESERVES_DECREASED_CAUSE_UNVERIFIED';
 else if(decrease)classification='ECONOMIC_RESERVE_DECREASE_CAUSE_UNVERIFIED';
 else classification=available===null?'EFFECTIVE_DEPTH_NONDECREASING_REAL_FUNDS_UNKNOWN':'RESERVES_NONDECREASING';
 return {version:ECONOMIC_RESERVE_COMPARISON_VERSION,classification,cause:'UNVERIFIED_SNAPSHOT_DIFFERENCE',effectiveQuoteChangeLamports:effective.toString(),availableQuoteChangeLamports:available?.toString()??null,baseReserveChangeUnits:base.toString(),effectiveQuoteDecreaseLamports:positivePart(-effective).toString(),availableQuoteDecreaseLamports:available===null?null:positivePart(-available).toString(),economicDecreaseObserved:decrease,economicNondecreaseObserved:effective>=0n&&available!==null&&available>=0n};
}

/** Repeat only measured economic-coordinate reductions as an explicit scenario.
 * Missing historical fee buckets do not invent a reduction in available funds.
 * Holding base reserves and fee buckets fixed is a scenario assumption, not a
 * reconstructed trade, replay of a withdrawal, or observed future execution. */
export function repeatEconomicReserveDecrease<T extends {raw:bigint;virtual:bigint;buckets:bigint}>(pool:T,change:EconomicReserveChange):T{
 const effective=positivePart(pool.raw+pool.virtual-BigInt(change.effectiveQuoteDecreaseLamports)),available=positivePart(pool.raw-pool.buckets-BigInt(change.availableQuoteDecreaseLamports??'0'));
 const raw=available+pool.buckets;return {...pool,raw,virtual:effective-raw};
}
