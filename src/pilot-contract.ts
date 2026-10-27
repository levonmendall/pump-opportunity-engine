/** Frozen isolated PAPER pilot contract. No signer, provider or account owner. */
import {createHash} from 'node:crypto';
import {PROVISIONAL_RULE} from './strategy.js';

export const PILOT_VERSION='persistent-buying-pilot-v1' as const;
const baseline=Object.freeze({version:'persistent-buying-v0-unfrozen',windowMs:60000,bucketMs:10000,minimumAgeMs:300000,maximumAgeMs:7200000,minimumNetBuyLamports:'1000000000',minimumPositiveBuckets:4,minimumBuyers:5,maximumLargestBuyerBps:3500,maximumSizeToLiquidityBps:500,maximumInitialCostMicroUsd:'50000000',maximumHoldingMs:900000,stopLossBps:1500,takeProfitBps:3000,modeledDelayMs:1000,orderExpiryMs:5000,maximumQuoteAgeMs:2000});
export const PILOT_CONTRACT=Object.freeze({schemaVersion:1,version:PILOT_VERSION,mode:'PAPER',accountPrefix:'poe-pilot-',amountConvention:'curve',flowCommitment:'confirmed-or-finalized-executed-evidence',baseline,risk:Object.freeze({initialMicroUsd:'1000000000',maximumInitialCostMicroUsd:'50000000',maximumSimultaneousPositions:1,baselinePositionLimit:3,maximumAggregatePositionCostMicroUsd:'150000000',utcDailyLossPauseMicroUsd:'50000000',leverage:false,adds:false,reentry:false}),execution:Object.freeze({modeledDelayMs:1000,orderExpiryMs:5000,slippageBps:100,gasLamports:'7000',baseGasLamports:'5000',priorityGasLamports:'2000',maximumAdapterTimeoutMs:3000,embeddedPoolFees:'already included in size-specific quotes; never charged again',accountDeposits:'actual required rent reserved as refundable locked capital; no invented exit refund'}),liveTradingEnabled:false});
export const PILOT_CONTRACT_SHA256='665b28e6cdc326b20cd5e921fbddbaf9fdfd786ce80cbd2286d98a00a8fef2a9' as const;
if(createHash('sha256').update(JSON.stringify(PILOT_CONTRACT)).digest('hex')!==PILOT_CONTRACT_SHA256)throw Error('frozen pilot contract hash mismatch');
export type PilotBinding={version:typeof PILOT_VERSION;contractSha256:string;maxPositions:1};

/** A later global strategy change cannot silently alter this frozen pilot. */
export function assertPilotBaseline(){for(const [key,value]of Object.entries(baseline))if((PROVISIONAL_RULE as unknown as Record<string,unknown>)[key]!==value)throw Error('pilot baseline differs from frozen contract');}
