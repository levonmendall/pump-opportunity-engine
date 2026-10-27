import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {performance} from 'node:perf_hooks';

/** Initial measurement only. No sockets, keys, funding, ledger writes or entry capability. */
export const MEASUREMENT_LIMITS=Object.freeze({durationMs:120_000,minimumWindowMs:60_000,eventCeiling:1000,inFlightHeadroomEvents:100,
  billingWallet:'6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ',
  feeLamportsPerPotentialEvent:'1000',walletFloorLamports:'20000000',dailyLamports:'10000000',totalLamports:'40000000',dailyMicroUsd:'2500000',totalMicroUsd:'10000000',
  maximumPayloadBytes:65_536,maximumFields:64,maximumFingerprints:2048,balanceAgeMs:30_000,priceAgeMs:10_000});
export type MeasurementBudgetProjection={
  wallet:{address:string;at:number;balanceLamports:string};price:{at:number;microUsdPerSol:string};
  /** Remaining approval BEFORE this experiment's local estimates; caller owns durable accounting. */
  remainingDailyLamports:string;remainingTotalLamports:string;remainingDailyMicroUsd:string;remainingTotalMicroUsd:string;
  heldReserveLamports:string;heldReserveMicroUsd:string;
};
type FieldType='null'|'array'|'string'|'number'|'boolean'|'object';
type Refusal='unverified-pool'|'selected-token-is-held'|'insufficient-time-for-full-window'|'wallet-balance-stale'|'sol-usd-stale'|'wallet-floor-or-reserve'|'held-monitoring-budget-insufficient'|'measurement-sol-budget-insufficient'|'measurement-usd-budget-insufficient'|'usd-cost-unknown'|'duration-limit'|'utc-day-boundary'|'event-ceiling'|'headroom-exhausted';
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const unsigned=(s:string)=>{if(typeof s!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(s))throw new Error('bounded unsigned integer required');return BigInt(s);};
const ceiling=(n:bigint,d:bigint)=>(n+d-1n)/d;
const costUsd=(lamports:bigint,price:bigint)=>ceiling(lamports*price,1_000_000_000n);
const utcDay=(t:number)=>new Date(t).toISOString().slice(0,10);

/** A replaceable read-only experiment projection, never durable spending authority. */
export class FeedMeasurement {
  private readonly options:{startedAt:number;mint:string;verifiedPool:boolean;heldMints:readonly string[]};
  private projection:MeasurementBudgetProjection;
  private readonly initialBalance:bigint;
  private informationAt:number;
  private readonly monotonicNow:()=>number;private readonly startedMonotonic:number;private informationMonotonic:number;
  private connectedSince:number|null=null;private connectedTotalMs=0;
  private subscriptionSince:number|null=null;private acknowledgedTotalMs=0;
  private continuousSince:number|null=null;private longestContinuousMs=0;
  private subscribed=false;private gaps=0;private reconnects=0;private everConnected=false;
  private stopAt:number|null=null;private stopMonotonic:number|null=null;private stopReason:Refusal|null=null;
  private frames=0;private potentialEvents=0;private bytes=0;private selectedFrames=0;private selectedBytes=0;private selectedTradeFrames=0;
  private malformedFrames=0;private oversizedFrames=0;private batchFrames=0;private duplicatePayloads=0;private repeatedSignatures=0;
  private afterStopEvents=0;private unknownUsdEvents=0;private knownUsd=0n;private inventoryLimited=false;private duplicateHistoryLimited=false;
  private readonly exact=new Set<string>();private readonly signatures=new Set<string>();
  private readonly fields=new Map<string,Partial<Record<FieldType,number>>>();
  constructor(options:{startedAt:number;mint:string;verifiedPool:boolean;budget:MeasurementBudgetProjection;heldMints?:readonly string[];monotonicNow?:()=>number}) {
    if(!integer(options.startedAt)||typeof options.mint!=='string'||new PublicKey(options.mint).toBase58()!==options.mint)throw new Error('valid experiment start/mint required');
    if((options.heldMints?.length??0)>3)throw new Error('bounded held-position context required');
    for(const mint of options.heldMints??[])if(typeof mint!=='string'||new PublicKey(mint).toBase58()!==mint)throw new Error('valid held mint required');
    this.options={startedAt:options.startedAt,mint:options.mint,verifiedPool:options.verifiedPool===true,heldMints:[...(options.heldMints??[])]};
    this.monotonicNow=options.monotonicNow??(()=>performance.now());this.startedMonotonic=this.informationMonotonic=this.monotonicNow();
    if(!Number.isFinite(this.startedMonotonic)||this.startedMonotonic<0)throw new Error('valid monotonic clock required');
    this.informationAt=options.startedAt;this.projection=this.validateProjection(options.budget,options.startedAt);
    this.initialBalance=unsigned(options.budget.wallet.balanceLamports);
  }
  private validateProjection(p:MeasurementBudgetProjection,now:number) {
    if(p.wallet.address!==MEASUREMENT_LIMITS.billingWallet||!integer(p.wallet.at)||!integer(p.price.at)||p.wallet.at>now||p.price.at>now||unsigned(p.price.microUsdPerSol)===0n)throw new Error('actual available approved-wallet/price observations required');
    for(const [key,max] of [['remainingDailyLamports',MEASUREMENT_LIMITS.dailyLamports],['remainingTotalLamports',MEASUREMENT_LIMITS.totalLamports],['remainingDailyMicroUsd',MEASUREMENT_LIMITS.dailyMicroUsd],['remainingTotalMicroUsd',MEASUREMENT_LIMITS.totalMicroUsd]] as const)if(unsigned(p[key])>BigInt(max))throw new Error('projection cannot increase approved caps');
    unsigned(p.wallet.balanceLamports);unsigned(p.heldReserveLamports);unsigned(p.heldReserveMicroUsd);
    return {wallet:{address:p.wallet.address,at:p.wallet.at,balanceLamports:p.wallet.balanceLamports},price:{at:p.price.at,microUsdPerSol:p.price.microUsdPerSol},remainingDailyLamports:p.remainingDailyLamports,remainingTotalLamports:p.remainingTotalLamports,remainingDailyMicroUsd:p.remainingDailyMicroUsd,remainingTotalMicroUsd:p.remainingTotalMicroUsd,heldReserveLamports:p.heldReserveLamports,heldReserveMicroUsd:p.heldReserveMicroUsd};
  }
  private time(now:number){const mono=this.monotonicNow();if(!integer(now)||now<this.informationAt||!Number.isFinite(mono)||mono<this.informationMonotonic)throw new Error('measurement information cannot arrive early');this.informationAt=now;this.informationMonotonic=mono;}
  updateBudget(projection:MeasurementBudgetProjection,now:number){this.time(now);this.projection=this.validateProjection(projection,now);}
  private freshPrice(now:number){const p=this.projection.price;return now>=p.at&&now-p.at<=MEASUREMENT_LIMITS.priceAgeMs?BigInt(p.microUsdPerSol):null;}
  private budgetReason(now:number,admission=false):Refusal|null {
    const p=this.projection,L=MEASUREMENT_LIMITS;
    if(this.options.verifiedPool!==true)return 'unverified-pool';
    if(this.options.heldMints?.includes(this.options.mint))return 'selected-token-is-held';
    if(utcDay(now)!==utcDay(this.options.startedAt))return 'utc-day-boundary';
    if(this.informationMonotonic-this.startedMonotonic>=L.durationMs)return 'duration-limit';
    if(this.potentialEvents>=L.eventCeiling+L.inFlightHeadroomEvents)return 'headroom-exhausted';
    if(this.potentialEvents>=L.eventCeiling)return 'event-ceiling';
    const dayEnd=Date.parse(utcDay(this.options.startedAt)+'T00:00:00.000Z')+86_400_000;
    if(admission&&Math.min(L.durationMs-(this.informationMonotonic-this.startedMonotonic),dayEnd-now)<L.minimumWindowMs)return 'insufficient-time-for-full-window';
    if(now-p.wallet.at>L.balanceAgeMs)return 'wallet-balance-stale';
    const price=this.freshPrice(now);if(price===null)return 'sol-usd-stale';
    if(this.unknownUsdEvents)return 'usd-cost-unknown';
    const heldSol=BigInt(p.heldReserveLamports),heldUsd=BigInt(p.heldReserveMicroUsd);
    const solRemaining=[BigInt(p.remainingDailyLamports),BigInt(p.remainingTotalLamports)];
    const usdRemaining=[BigInt(p.remainingDailyMicroUsd),BigInt(p.remainingTotalMicroUsd)];
    const spent=BigInt(this.potentialEvents)*BigInt(L.feeLamportsPerPotentialEvent);
    if(solRemaining.some(n=>n<heldSol+spent)||usdRemaining.some(n=>n<heldUsd+this.knownUsd))return 'held-monitoring-budget-insufficient';
    const future=BigInt(Math.max(0,L.eventCeiling-this.potentialEvents)+L.inFlightHeadroomEvents)*BigInt(L.feeLamportsPerPotentialEvent);
    if(solRemaining.some(n=>n<heldSol+spent+future))return 'measurement-sol-budget-insufficient';
    const futureUnits=BigInt(Math.max(0,L.eventCeiling-this.potentialEvents)+L.inFlightHeadroomEvents);
    if(usdRemaining.some(n=>n<heldUsd+this.knownUsd+futureUnits*costUsd(BigInt(L.feeLamportsPerPotentialEvent),price)))return 'measurement-usd-budget-insufficient';
    // Reserve the full experiment cost conservatively even if some has settled.
    const fullReserve=BigInt(L.eventCeiling+L.inFlightHeadroomEvents)*BigInt(L.feeLamportsPerPotentialEvent);
    if(BigInt(p.wallet.balanceLamports)<BigInt(L.walletFloorLamports)+heldSol+fullReserve)return 'wallet-floor-or-reserve';
    return null;
  }
  admission(now:number){this.time(now);const reason=this.stopReason??this.budgetReason(now,true);return {allowed:reason===null,reason,maximumTokens:1 as const,requiredContinuousWindowMs:MEASUREMENT_LIMITS.minimumWindowMs};}
  connected(now:number){this.time(now);if(this.connectedSince!==null)return;if(this.everConnected)this.reconnects++;this.everConnected=true;this.connectedSince=this.informationMonotonic;this.subscribed=false;this.continuousSince=null;this.subscriptionSince=null;}
  acknowledgeSubscription(now:number){this.time(now);if(this.connectedSince===null)throw new Error('socket opening is not subscription acknowledgement');if(this.subscribed)return;const reason=this.stopReason??this.budgetReason(now,true);if(reason)throw new Error('measurement subscription admission refused');this.subscribed=true;this.continuousSince=this.subscriptionSince=this.informationMonotonic;}
  private activeEnd(){return Math.min(this.informationMonotonic,this.stopMonotonic??this.informationMonotonic,this.startedMonotonic+MEASUREMENT_LIMITS.durationMs);}
  gap(now:number,disconnected=false){
    this.time(now);this.finishContinuous();this.gaps++;
    if(disconnected){if(this.connectedSince!==null)this.connectedTotalMs+=this.informationMonotonic-this.connectedSince;if(this.subscriptionSince!==null)this.acknowledgedTotalMs+=Math.max(0,this.activeEnd()-this.subscriptionSince);this.connectedSince=null;this.subscribed=false;this.continuousSince=this.subscriptionSince=null;}
    else this.continuousSince=this.subscribed?this.informationMonotonic:null;
  }
  private finishContinuous(){if(this.continuousSince!==null)this.longestContinuousMs=Math.max(this.longestContinuousMs,Math.max(0,this.activeEnd()-this.continuousSince));}
  private requestStop(reason:Refusal,now:number){if(this.stopAt===null){this.finishContinuous();this.stopAt=now;this.stopMonotonic=this.informationMonotonic;this.stopReason=reason;}}
  private bill(units:number,now:number){
    this.potentialEvents+=units;if(this.stopAt!==null)this.afterStopEvents+=units;
    const price=this.freshPrice(now);if(price===null)this.unknownUsdEvents+=units;else this.knownUsd+=BigInt(units)*costUsd(BigInt(MEASUREMENT_LIMITS.feeLamportsPerPotentialEvent),price);
  }
  /** Count before parsing, deduplication or local discard. No raw values are retained. */
  ingest(raw:string,receivedAt:number){
    this.time(receivedAt);this.frames++;this.bytes+=Buffer.byteLength(raw);this.bill(1,receivedAt);
    if(Buffer.byteLength(raw)>MEASUREMENT_LIMITS.maximumPayloadBytes){this.oversizedFrames++;this.gap(receivedAt);}
    else {
      try{
        const parsed:unknown=JSON.parse(raw);
        if(Array.isArray(parsed)){this.batchFrames++;if(parsed.length>1)this.bill(parsed.length-1,receivedAt);this.gap(receivedAt);}
        else if(parsed&&typeof parsed==='object')this.inspect(parsed as Record<string,unknown>,raw);
        else {this.malformedFrames++;this.gap(receivedAt);}
      }catch{this.malformedFrames++;this.gap(receivedAt);}
    }
    const reason=this.budgetReason(receivedAt);if(reason)this.requestStop(reason,receivedAt);
    return this.status(receivedAt);
  }
  private inspect(row:Record<string,unknown>,raw:string){
    for(const [name,value] of Object.entries(row)){
      if(!/^[A-Za-z_][A-Za-z_0-9]{0,39}$/.test(name)){this.inventoryLimited=true;continue;}
      if(!this.fields.has(name)&&this.fields.size>=MEASUREMENT_LIMITS.maximumFields){this.inventoryLimited=true;continue;}
      const type:FieldType=value===null?'null':Array.isArray(value)?'array':typeof value as FieldType;
      const counts=this.fields.get(name)??{};counts[type]=(counts[type]??0)+1;this.fields.set(name,counts);
    }
    const signature=typeof row.signature==='string'&&row.signature.length<=100?row.signature:null;
    if(signature!==null){
      const id=createHash('sha256').update(signature).digest('hex'),exact=createHash('sha256').update(signature).update('\0').update(raw).digest('hex');
      if(this.signatures.has(id))this.repeatedSignatures++;if(this.exact.has(exact))this.duplicatePayloads++;
      if(this.exact.size>=MEASUREMENT_LIMITS.maximumFingerprints||this.signatures.size>=MEASUREMENT_LIMITS.maximumFingerprints){this.duplicateHistoryLimited=true;this.exact.clear();this.signatures.clear();}
      this.exact.add(exact);this.signatures.add(id);
    }
    if(row.mint===this.options.mint){this.selectedFrames++;this.selectedBytes+=Buffer.byteLength(raw);if(row.txType==='buy'||row.txType==='sell')this.selectedTradeFrames++;}
  }
  status(now:number){
    this.time(now);const currentReason=this.budgetReason(now);if(currentReason)this.requestStop(currentReason,now);
    this.finishContinuous();
    const p=this.projection,L=MEASUREMENT_LIMITS,cost=BigInt(this.potentialEvents)*BigInt(L.feeLamportsPerPotentialEvent);
    const connectedMs=Math.floor(this.connectedTotalMs+(this.connectedSince===null?0:this.informationMonotonic-this.connectedSince)),price=this.freshPrice(now);
    const measurementActiveMs=Math.floor(this.acknowledgedTotalMs+(this.subscriptionSince===null?0:Math.max(0,this.activeEnd()-this.subscriptionSince)));
    const daily=measurementActiveMs>=1000?ceiling(cost*86_400_000n,BigInt(measurementActiveMs)):null;
    const minimumSixty=measurementActiveMs>=1000?ceiling(cost*60_000n,BigInt(measurementActiveMs))+BigInt(L.inFlightHeadroomEvents)*BigInt(L.feeLamportsPerPotentialEvent):null;
    const eventsSixty=measurementActiveMs>=1000?ceiling(BigInt(this.potentialEvents)*60_000n,BigInt(measurementActiveMs)):null;
    const fullWindowFits=eventsSixty===null?null:eventsSixty<=BigInt(L.eventCeiling);
    const protectedToken=this.options.heldMints?.includes(this.options.mint)===true;
    return {schemaVersion:1,project:'pump-opportunity-engine',purpose:'INITIAL_FEED_MEASUREMENT_ONLY',mode:'PAPER',liveTrading:false,entriesEnabled:false,qualified:false,fieldContractVerified:false,
      startedAt:this.options.startedAt,at:now,wallElapsedMs:now-this.options.startedAt,durationMs:Math.floor(this.informationMonotonic-this.startedMonotonic),durationClock:'monotonic',connectedMs,measurementActiveMs,connected:this.connectedSince!==null,subscriptionAcknowledged:this.subscribed,gaps:this.gaps,reconnects:this.reconnects,
      longestContinuousObservationMs:Math.floor(this.longestContinuousMs),completedObservationWindow:this.longestContinuousMs>=L.minimumWindowMs,observationWindowComplete:this.stopAt===null&&this.continuousSince!==null&&this.subscribed&&this.connectedSince!==null&&this.activeEnd()-this.continuousSince>=L.minimumWindowMs,featureWindowReady:false,
      frames:this.frames,potentialBillableEvents:this.potentialEvents,receivedBytes:this.bytes,malformedFrames:this.malformedFrames,oversizedFrames:this.oversizedFrames,unsupportedBatchFrames:this.batchFrames,
      selectedToken:{mint:this.options.mint,frames:this.selectedFrames,bytes:this.selectedBytes,tradeLikeFrames:this.selectedTradeFrames,ratePerSecond:measurementActiveMs>=1000?this.selectedFrames*1000/measurementActiveMs:null},
      aggregatePotentialEventsPerSecond:measurementActiveMs>=1000?this.potentialEvents*1000/measurementActiveMs:null,duplicateSignatureAndExactPayloads:this.duplicatePayloads,repeatedSignatures:this.repeatedSignatures,duplicateDetectionIsEventIdentityProof:false,duplicateHistoryLimited:this.duplicateHistoryLimited,
      fieldInventory:[...this.fields].map(([name,typeCounts])=>({name,typeCounts:{...typeCounts}})).sort((a,b)=>a.name.localeCompare(b.name)),inventoryLimited:this.inventoryLimited,
      costs:{label:'estimated',estimatedLamports:cost.toString(),estimatedMicroUsd:this.unknownUsdEvents?null:this.knownUsd.toString(),knownEstimatedMicroUsd:this.knownUsd.toString(),unvaluedPotentialEvents:this.unknownUsdEvents,actualProviderChargesLamports:null,observedWalletBalanceDeltaLamports:(BigInt(p.wallet.balanceLamports)-this.initialBalance).toString(),balanceDeltaIsProofOfCharges:false,
        projectedDailyLamports:daily?.toString()??null,projectedDailyMicroUsd:daily===null||price===null?null:costUsd(daily,price).toString(),measuredMeanMinimumSixtySecondLamports:minimumSixty?.toString()??null,measuredMeanEventsForSixtySeconds:eventsSixty?.toString()??null,fullWindowFitsEventCeilingAtObservedMean:fullWindowFits},
      budget:{remainingDailyLamportsBeforeExperiment:p.remainingDailyLamports,remainingTotalLamportsBeforeExperiment:p.remainingTotalLamports,remainingDailyMicroUsdBeforeExperiment:p.remainingDailyMicroUsd,remainingTotalMicroUsdBeforeExperiment:p.remainingTotalMicroUsd,heldReserveLamports:p.heldReserveLamports,heldReserveMicroUsd:p.heldReserveMicroUsd,inFlightHeadroomEvents:L.inFlightHeadroomEvents,headroomEventsRemaining:Math.max(0,L.eventCeiling+L.inFlightHeadroomEvents-this.potentialEvents),headroomExhausted:this.potentialEvents>=L.eventCeiling+L.inFlightHeadroomEvents,durableCrossRestartSpendingEnforced:false,billingGranularityVerified:false},
      control:{pauseNewAdmissions:this.stopAt!==null||fullWindowFits===false,upstreamUnsubscribeRequired:this.stopAt!==null,unsubscribeMeasurementTokens:this.stopAt!==null&&!protectedToken?[this.options.mint]:[],heldPositionMonitoringRequired:true,heldTradeFlowRequired:false,heldFullSizeRpcMonitoringRequired:this.options.heldMints.length>0,measurementMayAlterHeldSubscriptions:false,heldMonitoringBudgetInsufficient:currentReason==='held-monitoring-budget-insufficient',authorizedRpcFallbackRequired:this.options.heldMints.length>0&&currentReason==='held-monitoring-budget-insufficient',stopRequestedAt:this.stopAt,reason:currentReason??this.stopReason,eventsAfterStopRequest:this.afterStopEvents},
    };
  }
}
