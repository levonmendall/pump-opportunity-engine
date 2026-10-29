/** Retrospective local-only analysis. No transport, account or runtime action. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {REFERENCE_SCHEDULE,referenceOutcome,validateReferenceOhlcvInterval} from '../../../../scripts/capture-independent-two-hour-reference.js';
const root=dirname(fileURLToPath(import.meta.url)),hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const receiptRaw=readFileSync(join(root,'receipt.json')),receipt=JSON.parse(receiptRaw.toString()),planRaw=readFileSync(join(root,'plan.json')),plan=JSON.parse(planRaw.toString());
if(hash(planRaw)!==receipt.planSha256||receipt.stopReason!=='OHLC_BAR'||receipt.requests.length!==14||receipt.outcomes.length!==1||receipt.physicalTransportsSettled!==true)throw Error('EXACT_RETAINED_PARTIAL_STATE_REQUIRED');
const untilAt=plan.measurement.startedAt+REFERENCE_SCHEDULE.outcomeOffsetMs;
const recovered=receipt.requests.filter((r:any)=>r.purpose.startsWith('frozen-outcome-')).map((r:any)=>{
 const raw=readFileSync(join(root,r.file));if(hash(raw)!==r.sha256||raw.length!==r.bodyBytes||!r.settled||r.status!==200)throw Error('RAW_RECEIPT_REQUIRED');
 const lead=receipt.selected.find((s:any)=>r.purpose==='frozen-outcome-'+s.pool);if(!lead)throw Error('FROZEN_COHORT_REQUIRED');
 const validated=validateReferenceOhlcvInterval(JSON.parse(raw.toString()),lead.mint,lead.frozenAt,untilAt);
 return {pool:lead.pool,mint:lead.mint,name:lead.name,arm:lead.arm,frozenAt:lead.frozenAt,rawAvailableAt:r.responseReceivedAt,rawFile:r.file,rawSha256:r.sha256,validationScope:validated.scope,originalCollectorCaptured:receipt.outcomes.some((o:any)=>o.pool===lead.pool),outcome:referenceOutcome(validated.bars,lead.frozenAt,untilAt),executableOpportunityVerified:false,financialReturnVerified:false};
});
const out={kind:'retained-partial-independent-outcomes-local-analysis-v1',analyzedAt:new Date().toISOString(),planSha256:hash(planRaw),originalReceiptSha256:hash(receiptRaw),measurement:plan.measurement,originalStopReason:receipt.stopReason,selected:receipt.selected.length,originalCapturedOutcomes:receipt.outcomes.length,locallyValidatedRetainedOutcomes:recovered.length,unrequestedOutcomePools:receipt.selected.filter((s:any)=>!recovered.some((r:any)=>r.pool===s.pool)).map((s:any)=>({pool:s.pool,mint:s.mint,name:s.name,reason:'Not requested before retained collector stopped; no retrospective opportunity outcome asserted.'})),usage:receipt.usage,cumulative:receipt.cumulative,newProviderRequests:0,newFinancialOperations:0,originalReceiptModified:false,measurementExtended:false,continuousCollectionClaim:false,marketRecall:null,executableMissedProfits:null,recovered,limitations:['Six fixed index leads are not six verified migration identities or executable opportunities.','Local scoped validation happened after raw retrieval. Candle data was never decision-time predictive evidence.','All missing indexed minutes remain unknown; no interpolation or proof of no trading.','Collector stopped at22:04 with OHLC_BAR and did not complete the remaining four outcomes. Original measurement deadline remains unchanged.','Cloud observer gaps do not establish EC2 runtime downtime or continuous operation.','Historical cumulative uncertainBodyBytes remain262416.']};
writeFileSync(join(root,'partial-outcome-analysis.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({selected:out.selected,captured:out.originalCapturedOutcomes,locallyValidated:out.locallyValidatedRetainedOutcomes,unrequested:out.unrequestedOutcomePools.length,newProviderRequests:0,originalStopReason:out.originalStopReason}));
