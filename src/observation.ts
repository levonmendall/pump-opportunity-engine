import {PublicKey} from '@solana/web3.js';
import type {LedgerState,Mark} from './ledger.js';
import {PROVISIONAL_RULE} from './strategy.js';

/** Requirements of the existing rule, not permission to collect paid data. */
export const OBSERVATION_REQUIREMENTS=Object.freeze({
  strategyVersion:PROVISIONAL_RULE.version,
  candidateTradeFlow:true,
  candidateClosedWindowMs:PROVISIONAL_RULE.windowMs,
  candidateBinMs:PROVISIONAL_RULE.bucketMs,
  heldTradeFlow:false,
  heldFullSizeRpcPricing:true,
  maximumMarkAgeMs:PROVISIONAL_RULE.maximumQuoteAgeMs,
  maximumHeldFlowHandoffMs:5_000,
  reason:'Qualification uses flow; holding exits use net liquidation, entry cost and elapsed time.',
} as const);

export type ObservationCandidate={mint:string;wanted:boolean;supported:boolean;alreadyTraded:boolean};
export type RpcProtectionEvidence={pathVerified:boolean;mark:Mark|null;handoffPending?:boolean};
type Input={
  now:number;
  candidates:readonly ObservationCandidate[];
  financial:Pick<LedgerState,'positions'|'pending'>;
  currentTradeSubscriptions:readonly string[];
  rpcProtection:Readonly<Record<string,RpcProtectionEvidence>>;
  /** Actual durable allowance/floor/headroom projection, not candidate-count limits. */
  budgetAllowsObservation:boolean;
};
const text=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=512&&!/[\u0000-\u001f]/.test(s);
function mint(value:string){try{if(new PublicKey(value).toBase58()===value)return value;}catch{}throw new Error('valid observation mint required');}
const amount=(value:string)=>typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value);

/** Bounded orchestration policy. No socket, ledger mutation or enable-entry path.
 * An RPC protection gap cannot be fixed by pretending a trade stream is a mark.
 * Existing held streams may bridge a handoff only while allowance remains.
 */
export function planObservation(input:Input){
  if(!Number.isSafeInteger(input.now)||input.now<0||input.candidates.length>12||input.currentTradeSubscriptions.length>15||Object.keys(input.financial.positions).length>3||Object.keys(input.financial.pending).length>3||Object.keys(input.rpcProtection).length>3)throw new Error('bounded observation context required');
  const current=new Set(input.currentTradeSubscriptions.map(mint)),held=new Set(Object.keys(input.financial.positions).map(mint));
  const candidates=new Set<string>();
  for(const c of input.candidates){mint(c.mint);if(candidates.has(c.mint))throw new Error('duplicate observation candidate');candidates.add(c.mint);}
  const dueSells=new Set(Object.values(input.financial.pending).filter(o=>o.side==='sell').map(o=>mint(o.mint)));
  const rpcPriorityMints=[...held].sort((a,b)=>Number(dueSells.has(b))-Number(dueSells.has(a))||a.localeCompare(b));
  const unavailableProtectionMints=rpcPriorityMints.filter(m=>{
    const p=input.financial.positions[m]!,e=input.rpcProtection[m],mark=e?.mark;
    return e?.pathVerified!==true||!mark||mark.pricedBaseUnits!==p.units||!amount(mark.netLamports)||!text(mark.evidence)||!Number.isSafeInteger(mark.at)||mark.at>input.now||input.now-mark.at>OBSERVATION_REQUIREMENTS.maximumMarkAgeMs;
  });
  // A restart/heartbeat cannot renew this initial transition: its deadline is
  // derived from the original durable fill time, not caller-supplied freshness.
  const handoff=new Set(unavailableProtectionMints.filter(m=>current.has(m)&&input.rpcProtection[m]?.handoffPending===true&&input.financial.positions[m]!.enteredAt<=input.now&&input.now-input.financial.positions[m]!.enteredAt<OBSERVATION_REQUIREMENTS.maximumHeldFlowHandoffMs));
  const desired=new Set<string>();
  if(input.budgetAllowsObservation){
    // Keep a pending entry's inputs until its explicit outcome, not for the
    // whole resulting holding period. Held SELLs need current-size RPC state.
    for(const o of Object.values(input.financial.pending))if(o.side==='buy'&&!held.has(o.mint)&&o.expiresAt>input.now)desired.add(mint(o.mint));
    for(const c of input.candidates)if(c.wanted&&c.supported&&!c.alreadyTraded&&!held.has(c.mint)&&!unavailableProtectionMints.length)desired.add(c.mint);
    for(const m of handoff)desired.add(m);
  }
  const desiredTradeMints=[...desired].sort();
  return {
    strategyVersion:OBSERVATION_REQUIREMENTS.strategyVersion,
    candidateFlowWindowMs:OBSERVATION_REQUIREMENTS.candidateClosedWindowMs,
    heldTradeFlowRequired:false as const,
    heldMandatoryPaidFlowReserveEvents:0,
    rpcPriorityMints,
    unavailableProtectionMints,
    temporaryHandoffTradeMints:input.budgetAllowsObservation?[...handoff].sort():[],
    desiredTradeMints,
    subscribeTradeMints:desiredTradeMints.filter(m=>!current.has(m)),
    unsubscribeTradeMints:[...current].filter(m=>!desired.has(m)).sort(),
    pauseNewAdmissions:!input.budgetAllowsObservation||unavailableProtectionMints.length>0,
    closeEntryRiskBeforeRetirement:!input.budgetAllowsObservation||unavailableProtectionMints.length>0,
    pendingEntryIdsToCancelOrQuarantine:!input.budgetAllowsObservation||unavailableProtectionMints.length>0?Object.values(input.financial.pending).filter(o=>o.side==='buy').map(o=>o.id).sort():[],
    // Preserve uncertain actions if a financial write fails, but never keep
    // receiving paid traffic beyond the cap while waiting for storage recovery.
    stopPaidTrafficAtLimitEvenIfFinancialWriteFails:!input.budgetAllowsObservation,
    criticalProtectionUnavailable:unavailableProtectionMints.length>0,
    flowFieldsVerified:false as const,
    entriesMayBeEnabled:false as const,
  };
}
