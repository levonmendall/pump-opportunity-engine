import {canonicalTransactionSignature} from './transaction-signature.js';

/** Diagnostic memory only. Never supplies audit coverage, trade information,
 * transport health or admission. Successful packets add no record/FS call. */
export const NATIVE_NOTIFICATION_INGRESS_POLICY=Object.freeze({version:'bounded-json-notification-router-v1',maximumRows:2048,maximumSignatures:8,maximumMatches:16,rawPayloadRetained:false,scope:'JSON_DECODED_ROUTER_ONLY'});
export type IngressGeneration={mint:string;pool:string;openedAt:number;connectionId:number;subscriptionId:number};
export type IngressDisposition='ROUTING'|'ACTIVE_PROCESSOR'|'QUEUED_BEFORE_ACK'|'ACK_RETIRED'|'UNRECOGNIZED_SUBSCRIPTION'|'EARLY_QUEUE_CAPACITY'|'IGNORED_SUSPENDED'|'IGNORED_UNREGISTERED'|'ROUTER_REFUSED';
type Stage='INITIAL_CALLBACK'|'EARLY_ACK_REPLAY';
type Row={sequence:number;signature:string|null;slot:number|null;success:boolean|null;receivedAt:number|null;routedAt:number|null;connectionId:number;subscriptionId:number|null;generationAtRouting:IngressGeneration|null;stage:Stage;disposition:IngressDisposition;refusalCode:string|null};
export type NativeIngressQuery={target:{startAt:number;endAt:number};availableAt:number;generation:IngressGeneration|null;missingSignatures:readonly string[];missingSignaturesTotal:number};
const time=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const refusalCodes=new Set(['NATIVE_FLOW_RPC_ENVELOPE','NATIVE_FLOW_NOTIFICATION_SCHEMA','NATIVE_FLOW_UNSCOPED_NOTIFICATION','NATIVE_FLOW_SIGNATURE','NATIVE_FLOW_CLEANUP_DEADLINE_OR_GENERATION']);
const sameGeneration=(a:IngressGeneration|null,b:IngressGeneration|null)=>!!a&&!!b&&a.mint===b.mint&&a.pool===b.pool&&a.openedAt===b.openedAt&&a.connectionId===b.connectionId&&a.subscriptionId===b.subscriptionId;

export class NativeNotificationIngress {
 private readonly rows:Array<Row|undefined>=new Array(NATIVE_NOTIFICATION_INGRESS_POLICY.maximumRows);
 private sequence=0;private evictedRows=0;private evictedThroughRoutedAt:number|null=null;
 private clockFaults=0;private lastRoutedAt:number;private initialCallbacks=0;private earlyAckReplays=0;private noncanonicalSignatures=0;
 private readonly dispositions:Partial<Record<IngressDisposition,number>>={};
 constructor(private readonly startedAt:number){this.lastRoutedAt=startedAt;}
 observe(input:{body:any;receivedAt:number;routedAt:number;connectionId:number;generation:IngressGeneration|null;stage:Stage}):Row{
  const {body,receivedAt,routedAt,connectionId,stage}=input,value=body?.params?.result?.value,slot=body?.params?.result?.context?.slot,subscription=body?.params?.subscription;
  const signature=canonicalTransactionSignature(value?.signature)?value.signature as string:null;
  if(signature===null)this.noncanonicalSignatures++;
  if(!time(receivedAt)||!time(routedAt)||routedAt<receivedAt||routedAt<this.lastRoutedAt)this.clockFaults++;
  if(time(routedAt))this.lastRoutedAt=Math.max(this.lastRoutedAt,routedAt);
  if(stage==='INITIAL_CALLBACK')this.initialCallbacks++;else this.earlyAckReplays++;
  const sequence=++this.sequence,index=(sequence-1)%this.rows.length,old=this.rows[index];
  if(old){this.evictedRows++;if(old.routedAt!==null)this.evictedThroughRoutedAt=Math.max(this.evictedThroughRoutedAt??0,old.routedAt);}
  const row:Row={sequence,signature,slot:time(slot)?slot:null,success:value&&Object.hasOwn(value,'err')&&value.err===null?true:value&&Object.hasOwn(value,'err')&&typeof value.err==='object'&&!Array.isArray(value.err)?false:null,
   receivedAt:time(receivedAt)?receivedAt:null,routedAt:time(routedAt)?routedAt:null,connectionId,subscriptionId:time(subscription)?subscription:null,
   generationAtRouting:input.generation?{...input.generation}:null,stage,disposition:'ROUTING',refusalCode:null};
  this.rows[index]=row;return row;
 }
 finish(row:Row,disposition:Exclude<IngressDisposition,'ROUTING'>,error?:unknown){
  if(row.disposition!=='ROUTING')return;
  row.disposition=disposition;
  if(disposition==='ROUTER_REFUSED'){const message=error instanceof Error?error.message:'';row.refusalCode=refusalCodes.has(message)?message:'OTHER_ROUTER_REFUSAL';}
  this.dispositions[disposition]=(this.dispositions[disposition]??0)+1;
 }
 usage(){return {policy:NATIVE_NOTIFICATION_INGRESS_POLICY,startedAt:this.startedAt,rowsObserved:this.sequence,retainedRows:Math.min(this.sequence,this.rows.length),evictedRows:this.evictedRows,evictedThroughRoutedAt:this.evictedThroughRoutedAt,initialCallbacks:this.initialCallbacks,earlyAckReplays:this.earlyAckReplays,noncanonicalSignatures:this.noncanonicalSignatures,clockFaults:this.clockFaults,dispositions:{...this.dispositions}};}
 evidence(query:NativeIngressQuery,observedAt:number){
  const generation=query.generation?{...query.generation}:null,fromAt=generation?.openedAt??query.target.startAt;
  const selected=query.missingSignatures.slice(0,NATIVE_NOTIFICATION_INGRESS_POLICY.maximumSignatures),requested=new Set(selected);
  const matches:Row[]=[];let matchingRows=0,scopeRows=0;
  // One fixed-size scan only after an actual missing-history outcome. A match
  // may belong to an older/replayed generation; preserve those facts explicitly.
  for(let n=Math.max(1,this.sequence-this.rows.length+1);n<=this.sequence;n++){
   const row=this.rows[(n-1)%this.rows.length];if(!row||row.sequence!==n)continue;
   if(sameGeneration(row.generationAtRouting,generation))scopeRows++;
   if(row.signature!==null&&requested.has(row.signature)){matchingRows++;if(matches.length<NATIVE_NOTIFICATION_INGRESS_POLICY.maximumMatches)matches.push({...row,generationAtRouting:row.generationAtRouting?{...row.generationAtRouting}:null});}
  }
  const rangeValid=time(query.target.startAt)&&time(query.target.endAt)&&query.target.startAt<query.target.endAt&&time(query.availableAt)&&query.availableAt>=query.target.endAt&&time(fromAt)&&fromAt<=query.target.startAt&&time(observedAt)&&observedAt>=query.availableAt&&observedAt>=this.lastRoutedAt;
  return {kind:'NATIVE_MISSING_HISTORY_ROUTER_WITNESS',version:NATIVE_NOTIFICATION_INGRESS_POLICY.version,
   target:{...query.target},auditAvailableAt:query.availableAt,observedAt,requestedGeneration:generation,requestedRoutingInterval:{fromAt,untilAt:query.availableAt},
   missingSignatures:selected,missingSignaturesTotal:query.missingSignaturesTotal,missingSignaturesOmitted:Math.max(0,query.missingSignaturesTotal-selected.length),
   retention:this.usage(),matchingRows,matchingRowsOmitted:matchingRows-matches.length,retainedRowsForRequestedGeneration:scopeRows,
   retainedRouterIntervalComplete:rangeValid&&this.clockFaults===0&&this.startedAt<=fromAt&&(this.evictedThroughRoutedAt===null||this.evictedThroughRoutedAt<fromAt),
   matches:matches.map(row=>({...row,generationAtRoutingEqualsRequested:generation===null?null:sameGeneration(row.generationAtRouting,generation),
    receivedAfterRequestedAck:generation===null||row.receivedAt===null?null:row.receivedAt>=generation.openedAt,
    inRequestedRoutingInterval:row.routedAt!==null&&row.routedAt>=fromAt&&row.routedAt<=query.availableAt})),
   wholeSocketReceiptTrace:false,missingTransactionRelevanceEstablished:false,providerLossProved:false,localLossProved:false,
   financialQualification:false,originalAuditOutcomeUnchanged:true,
   limitations:'Only callbacks already JSON-decoded and passed to the router are observed. Closed/settling transport callbacks and invalid JSON have no signature witness here. Ring eviction, omitted matches and earlier generations remain explicit; absence never proves delivery loss.'};
 }
}
