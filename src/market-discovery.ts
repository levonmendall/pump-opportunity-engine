/** Shared-stream discovery and screening hints. These records have no chain
 * commitment, verified origin, independent wallet identity or execution
 * authority. Canonical pool/origin checks and independent audits remain a
 * separate prerequisite for deep strategy and financial decisions. */
export type MarketFeedSource='pumpportal-new-token'|'pumpportal-migration'|'pumpapi-broad';
export type MarketIdentityHint={
  mint:string;pool?:string;signature?:string;receivedAt:number;
  source:MarketFeedSource;kind:'creation'|'migration'|'activity';venue?:string;
  evidence:'unverified-provider-discovery-hint';
};
export type MarketActivityHint=Omit<MarketIdentityHint,'evidence'>&{
  /** Includes identity so the receiver can persist identity and activity in
   * one transaction; these events do not also invoke onMarketIdentity. */
  side?:'buy'|'sell';quoteMint?:string;quoteLamports?:string;
  /** Provider UI token amount, never raw token units without verified decimals. */
  tokenAmount?:string;price?:number;
  evidence:'unverified-provider-activity-hint';
};
export type MarketFeedStatus={source:MarketFeedSource;at:number;connected:boolean;scope:string;gapReason?:string};

/** Routing only: provider venue/migration hints authorize bounded verification,
 * never trading. Creation/curve traffic cannot enter the PumpSwap work queue. */
export const PUMPSWAP_INTAKE_POLICY=Object.freeze({version:'pumpswap-after-migration-only-v1',venue:'pump-amm',creationSubscription:false,preMigrationPersistence:false,sharedTransport:'client-filtered; provider sends all venues'});
export function pumpSwapIntakeHint(row:Pick<MarketIdentityHint,'source'|'kind'|'venue'>):boolean {
 return row.source==='pumpportal-migration'&&row.kind==='migration'||row.source==='pumpapi-broad'&&row.venue===PUMPSWAP_INTAKE_POLICY.venue;
}
