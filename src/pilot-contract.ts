/** Frozen isolated PAPER pilot contract. No signer, provider or account owner. */
import {createHash} from 'node:crypto';
import {PROVISIONAL_RULE} from './strategy.js';
import {ADAPTIVE_MOMENTUM_V2_POLICY,ADAPTIVE_MOMENTUM_V2_SHA256,ADAPTIVE_MOMENTUM_V2_VERSION} from './adaptive-momentum-v2.js';

export const PILOT_VERSION='persistent-buying-pilot-v1' as const;
const baseline=Object.freeze({version:'persistent-buying-v0-unfrozen',windowMs:60000,bucketMs:10000,minimumAgeMs:300000,maximumAgeMs:7200000,minimumNetBuyLamports:'1000000000',minimumPositiveBuckets:4,minimumBuyers:5,maximumLargestBuyerBps:3500,maximumSizeToLiquidityBps:500,maximumInitialCostMicroUsd:'50000000',maximumHoldingMs:900000,stopLossBps:1500,takeProfitBps:3000,modeledDelayMs:1000,orderExpiryMs:5000,maximumQuoteAgeMs:2000});
export const PILOT_CONTRACT=Object.freeze({schemaVersion:1,version:PILOT_VERSION,mode:'PAPER',accountPrefix:'poe-pilot-',amountConvention:'curve',flowCommitment:'confirmed-or-finalized-executed-evidence',baseline,risk:Object.freeze({initialMicroUsd:'1000000000',maximumInitialCostMicroUsd:'50000000',maximumSimultaneousPositions:1,baselinePositionLimit:3,maximumAggregatePositionCostMicroUsd:'150000000',utcDailyLossPauseMicroUsd:'50000000',leverage:false,adds:false,reentry:false}),execution:Object.freeze({modeledDelayMs:1000,orderExpiryMs:5000,slippageBps:100,gasLamports:'7000',baseGasLamports:'5000',priorityGasLamports:'2000',maximumAdapterTimeoutMs:3000,embeddedPoolFees:'already included in size-specific quotes; never charged again',accountDeposits:'actual required rent reserved as refundable locked capital; no invented exit refund'}),liveTradingEnabled:false});
export const PILOT_CONTRACT_SHA256='665b28e6cdc326b20cd5e921fbddbaf9fdfd786ce80cbd2286d98a00a8fef2a9' as const;
if(createHash('sha256').update(JSON.stringify(PILOT_CONTRACT)).digest('hex')!==PILOT_CONTRACT_SHA256)throw Error('frozen pilot contract hash mismatch');
export type ConcurrentPilotStage=2|3;
/** Two explicit later stages; the original single-position contract above is
 * immutable. No automatic stage change or entry/exit parameter change exists. */
function concurrentContract<const S extends ConcurrentPilotStage>(stage:S){return Object.freeze({...PILOT_CONTRACT,version:`persistent-buying-pilot-concurrent-stage-${stage}-v1` as const,stage,risk:Object.freeze({...PILOT_CONTRACT.risk,maximumSimultaneousPositions:stage}),progression:Object.freeze({singlePositionContractSha256:PILOT_CONTRACT_SHA256,changes:'isolated simultaneous-position admission only; entry/exit, sizing and financial risk rules unchanged',automaticStageChanges:false})});}
const stage2=concurrentContract(2),stage3=concurrentContract(3);
export const CONCURRENT_PILOTS=Object.freeze({
  2:Object.freeze({contract:stage2,contractSha256:'416dda5b84dd2e282534fcf20c77137afd61afb7de178d418bf2772bd6f2f100'}),
  3:Object.freeze({contract:stage3,contractSha256:'ebec988c7b87a5be0cdc2e9ddcc0d9ff42a35363418dd528dc3eb9e26d7474dd'})
});
for(const spec of Object.values(CONCURRENT_PILOTS))if(createHash('sha256').update(JSON.stringify(spec.contract)).digest('hex')!==spec.contractSha256)throw Error('frozen concurrent pilot contract hash mismatch');
/** Owner-authorized active PAPER variant. The original contracts above remain
 * byte-identical rollback/benchmark profiles. Dollar limits are an explicitly
 * reported temporary accounting fallback, never an appreciation/sale ceiling. */
export const ADAPTIVE_PILOT_CONTRACT=Object.freeze({...PILOT_CONTRACT,version:ADAPTIVE_MOMENTUM_V2_VERSION,stage:2 as const,risk:Object.freeze({...PILOT_CONTRACT.risk,maximumSimultaneousPositions:2 as const,reentry:true}),adaptive:Object.freeze({policy:ADAPTIVE_MOMENTUM_V2_POLICY,policySha256:ADAPTIVE_MOMENTUM_V2_SHA256,activation:'owner-authorized-active-paper; no economic promotion gate',legacyRiskFallback:'initial $50 entry/$150 aggregate; no appreciation ceiling; preserve actual daily loss control',capacity:'two holdings/four deep; further capacity requires operational serviceability'})});
// The hash binds the bundled immutable policy; callers cannot supply settings.
export const ADAPTIVE_PILOT_CONTRACT_SHA256=createHash('sha256').update(JSON.stringify(ADAPTIVE_PILOT_CONTRACT)).digest('hex');
export const ADAPTIVE_PILOT_BINDING=Object.freeze({version:ADAPTIVE_MOMENTUM_V2_VERSION,stage:2 as const,contractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256,maxPositions:2 as const});
type SinglePilotBinding={version:typeof PILOT_VERSION;contractSha256:string;maxPositions:1};
type ConcurrentPilotBinding={[S in ConcurrentPilotStage]:{version:(typeof CONCURRENT_PILOTS)[S]['contract']['version'];stage:S;contractSha256:string;maxPositions:S}}[ConcurrentPilotStage];
export type PilotBinding=SinglePilotBinding|ConcurrentPilotBinding|typeof ADAPTIVE_PILOT_BINDING;
type PilotContract=typeof PILOT_CONTRACT|(typeof CONCURRENT_PILOTS)[ConcurrentPilotStage]['contract']|typeof ADAPTIVE_PILOT_CONTRACT;
export type ResolvedPilotBinding={version:PilotBinding['version'];stage:ConcurrentPilotStage|null;contract:PilotContract;contractSha256:string;maxPositions:1|2|3};
/** Resolve only the three known frozen contracts, never arbitrary settings. */
export function resolvePilotBinding(value:unknown):Readonly<ResolvedPilotBinding>|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const p=value as Record<string,unknown>;
  if(p.version===PILOT_VERSION&&p.contractSha256===PILOT_CONTRACT_SHA256&&p.maxPositions===1&&!Object.hasOwn(p,'stage'))return Object.freeze({version:PILOT_VERSION,stage:null,contract:PILOT_CONTRACT,contractSha256:PILOT_CONTRACT_SHA256,maxPositions:1});
  if(p.version===ADAPTIVE_PILOT_BINDING.version&&p.stage===2&&p.maxPositions===2&&p.contractSha256===ADAPTIVE_PILOT_CONTRACT_SHA256)return Object.freeze({version:ADAPTIVE_PILOT_BINDING.version,stage:2,contract:ADAPTIVE_PILOT_CONTRACT,contractSha256:ADAPTIVE_PILOT_CONTRACT_SHA256,maxPositions:2});
  if(p.stage!==2&&p.stage!==3)return null;
  const spec=CONCURRENT_PILOTS[p.stage];
  return p.version===spec.contract.version&&p.contractSha256===spec.contractSha256&&p.maxPositions===p.stage?Object.freeze({version:spec.contract.version,stage:p.stage,contract:spec.contract,contractSha256:spec.contractSha256,maxPositions:p.stage}):null;
}

export function resolveAdaptivePilotBinding(stage:2=2):Readonly<ResolvedPilotBinding>{
 if(stage!==2)throw Error('ADAPTIVE_TWO_POSITION_STAGE_REQUIRED');
 return resolvePilotBinding(ADAPTIVE_PILOT_BINDING)!;
}

/** A later global strategy change cannot silently alter this frozen pilot. */
export function assertPilotBaseline(){for(const [key,value]of Object.entries(baseline))if((PROVISIONAL_RULE as unknown as Record<string,unknown>)[key]!==value)throw Error('pilot baseline differs from frozen contract');}
