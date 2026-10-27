/** Evidence labels for the isolated component only; never runtime admission gates. */
import {createHash} from 'node:crypto';
import type {ComponentNotice} from './component-transport.js';
import type {ComponentSnapshot} from './component-parity.js';
export type ComponentBasicResult={pool:string;slot:number;availableAt:number;fullBaseUnits:string;quoteAgeAtUseMs:number;sameBytesSdkParity:true;bankClockValidated:true};
export type ComponentEvaluation={pool:string;slot:number;availableAt:number;sell:{inputBaseUnits:string;outputLamports:string};hypotheticalExitCondition:string|null};
export type ComponentAck={connection:number;method:string;address:string|null;at:number};
export type ComponentObjectiveEvidence={basic:ComponentBasicResult|null;blockTimeReferences:readonly unknown[];acknowledgements:readonly ComponentAck[];expectedAddresses:readonly string[];reconnect:{requested:boolean;closedAt:number|null;upgradedAt:number|null;allAcknowledgedAt:number|null;firstCoherentQuoteAt:number|null};notifications:readonly ComponentNotice[];validatedSnapshots:readonly ComponentSnapshot[];evaluations:readonly ComponentEvaluation[];stopReason:string|null};
const accountHash=(account:unknown)=>{const a=account as any;return createHash('sha256').update(JSON.stringify({owner:a.owner,lamports:a.lamports,executable:a.executable,data:a.data})).digest('hex');};
/** A later failure never erases a previously captured valid basic result.
 * ACKs, actual version delivery, liquidation changes and sampled threshold
 * recognition are distinct evidence. None establishes continuous protection.
 */
export function componentObjectiveResults(e:ComponentObjectiveEvidence){
  const acked=(connection:number)=>new Set(e.acknowledgements.filter(a=>a.connection===connection&&a.method==='accountSubscribe'&&a.address!==null).map(a=>a.address!));
  const complete=(connection:number)=>e.expectedAddresses.length===7&&new Set(e.expectedAddresses).size===7&&e.expectedAddresses.every(a=>acked(connection).has(a));
  const matches=e.notifications.filter(n=>n.changed).flatMap(n=>{
    const snapshot=e.validatedSnapshots.find(s=>Date.parse(s.receivedAt)>=n.at&&s.context.slot>=n.slot&&s.addresses.some((a,i)=>a===n.address&&s.value[i]!==null&&accountHash(s.value[i])===n.hash));
    return snapshot?[{address:n.address,notificationSlot:n.slot,notificationReceivedAt:n.at,validatedContextSlot:snapshot.context.slot,independentRefreshReceivedAt:Date.parse(snapshot.receivedAt)}]:[];
  });
  const changes:Array<{pool:string;priorSlot:number;slot:number;priorAvailableAt:number;availableAt:number;priorOutputLamports:string;outputLamports:string}>=[],thresholds:Array<{pool:string;condition:string;previousEvaluationAt:number;recognizedAt:number;crossingTime:'UNKNOWN_BETWEEN_CAPTURED_STATES'}>=[];
  for(let i=1;i<e.evaluations.length;i++){
    const previous=e.evaluations[i-1]!,current=e.evaluations[i]!;
    if(previous.pool!==current.pool||previous.sell.inputBaseUnits!==current.sell.inputBaseUnits)continue;
    if(previous.sell.outputLamports===current.sell.outputLamports)continue;
    changes.push({pool:current.pool,priorSlot:previous.slot,slot:current.slot,priorAvailableAt:previous.availableAt,availableAt:current.availableAt,priorOutputLamports:previous.sell.outputLamports,outputLamports:current.sell.outputLamports});
    if(current.hypotheticalExitCondition&&current.hypotheticalExitCondition!==previous.hypotheticalExitCondition)thresholds.push({pool:current.pool,condition:current.hypotheticalExitCondition,previousEvaluationAt:previous.availableAt,recognizedAt:current.availableAt,crossingTime:'UNKNOWN_BETWEEN_CAPTURED_STATES'});
  }
  return {
    basicCurrentState:{status:e.basic?'VERIFIED_FOR_CAPTURED_SIZE_AND_STATE':'UNVERIFIED',evidence:e.basic,requiresRecentSwap:false,entryAgeEligibility:'UNVERIFIED_SEPARATE_FROM_HYPOTHETICAL_HOLDING'},
    independentBlockTimestamp:{status:e.blockTimeReferences.length?'OBSERVED':'UNVERIFIED',references:e.blockTimeReferences,provenance:'independent-getBlockTime-not-bank-clock'},
    subscriptionAcknowledgements:{status:complete(1)?'ACKNOWLEDGED':'UNVERIFIED',uniqueAddresses:acked(1).size,changeDeliveryClaim:false},
    reconnectAcknowledgements:{status:e.reconnect.requested&&e.reconnect.closedAt!==null&&e.reconnect.upgradedAt!==null&&complete(2)?'RESTORED':'UNVERIFIED',uniqueAddresses:acked(2).size,...e.reconnect},
    freshStateAfterReconnect:{status:e.reconnect.upgradedAt!==null&&e.reconnect.firstCoherentQuoteAt!==null&&e.reconnect.firstCoherentQuoteAt>=e.reconnect.upgradedAt?'OBSERVED':'UNVERIFIED',availableAt:e.reconnect.firstCoherentQuoteAt,notificationDeliveryClaim:false},
    changedAccountDelivery:{status:matches.length?'MATCHED_CAPTURED_VERSIONS':'UNVERIFIED',changedNotifications:e.notifications.filter(n=>n.changed).length,matched:matches,limitation:'Intermediate unmatched versions are not proof of loss; no complete-delivery denominator.'},
    actualSizePriceChanges:{status:changes.length?'OBSERVED':'UNVERIFIED',changes,clockSlotAdvanceIsPriceChange:false},
    sampledExitRecognition:{status:thresholds.length?'OBSERVED_AT_QUOTED_SAMPLES':'UNVERIFIED',transitions:thresholds,exactThresholdCrossingDelay:'UNVERIFIED',continuousProtection:'UNVERIFIED'},
    laterStopReason:e.stopReason,basicEvidenceSurvivesLaterFailure:e.basic!==null&&e.stopReason!==null,
  };
}
