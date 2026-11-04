/** Current owner operating control, separate from immutable financial epochs,
 * strategy economics and the historical V3 no-fixed-cap policy. It authorizes
 * at most two economically justified positions; it never requires an entry. */
export const PAPER_TWO_HOLDING_OPERATING_POLICY=Object.freeze({
 version:'owner-paper-two-holdings-v1',
 maximumPositions:2,
 occupiedCapacity:'held-positions-plus-pending-buy-reservations',
 existingObligations:'retain-and-manage-without-forced-liquidation',
 financialPolicy:'unchanged-v3-500bps-no-daily-stop',
} as const);
export type PaperOperatingCapacityPolicy=typeof PAPER_TWO_HOLDING_OPERATING_POLICY;
export function paperOperatingCapacityPolicy(value:PaperOperatingCapacityPolicy|undefined):PaperOperatingCapacityPolicy|null{
 if(value===undefined)return null;
 const expected=PAPER_TWO_HOLDING_OPERATING_POLICY;
 if(!value||typeof value!=='object'||Object.keys(value).length!==Object.keys(expected).length||Object.entries(expected).some(([key,field])=>(value as unknown as Record<string,unknown>)[key]!==field))throw Error('invalid PAPER operating capacity policy');
 return Object.freeze({...expected});
}
type CapacityState={positions:Readonly<Record<string,unknown>>;pending:Readonly<Record<string,{side:string}>>};
/** Shared by scheduling/preparation and the sole-writer BUY reservation. The
 * count grants no financial readiness and never applies to SELL or protection. */
export function paperEntryCapacity(state:CapacityState,historicalMaximumPositions:number|null,operatingPolicy:PaperOperatingCapacityPolicy|null,policyReady=true){
 const heldPositions=Object.keys(state.positions).length,pendingBuyOrders=Object.values(state.pending).filter(order=>order.side==='buy').length;
 const maximumPositions=operatingPolicy?(historicalMaximumPositions===null?operatingPolicy.maximumPositions:Math.min(historicalMaximumPositions,operatingPolicy.maximumPositions)):historicalMaximumPositions;
 return {heldPositions,pendingBuyOrders,occupiedPositions:heldPositions+pendingBuyOrders,historicalMaximumPositions,maximumPositions,operatingPolicyVersion:operatingPolicy?.version??null,available:policyReady&&(maximumPositions===null||heldPositions+pendingBuyOrders<maximumPositions)};
}
