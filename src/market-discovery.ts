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
