import type {MarketRegistry} from './market-registry.js';

/** Actual source-instance observations only. No RPC, timer, trading permission,
 * financial writer or scheduler ownership. Slot intervals are mutually exclusive. */
export const NATIVE_SLOT_STATES=['VACANT','SUBSCRIPTION_WAIT','EVIDENCE_WARMING','AUDIT_READY','AUDIT_WAIT','AUDIT_ACTIVE','PROVIDER_WAIT','UNUSABLE','REPLACEMENT_WAIT'] as const;
export type NativeSlotState=typeof NATIVE_SLOT_STATES[number];
export type NativeSlotFinancialKind='primary-evaluated'|'qualified'|'entry-fill'|'exit-fill';
export const NATIVE_SLOT_LIMITATIONS=['FOUR_SLOTS_DO_NOT_IMPLY_PRODUCTIVE_WORK','PHYSICAL_START_REQUIRES_RECEIPT','PRELIMINARY_EVALUATION_NOT_FINANCIAL_QUALIFICATION','FINANCIAL_EVENTS_REQUIRE_ACTUAL_CALLBACK','NO_PER_SLOT_PROFIT_ATTRIBUTION','NO_WHOLE_MARKET_DENOMINATOR'] as const;
type Slot={slot:number;mint:string|null;state:NativeSlotState;sinceAt:number;allocatedAt:number|null;openedAt:number|null;windowEndAt:number|null;readyAt:number|null;firstPhysicalAt:number|null;retiredAt:number|null;warmAt:number|null;assignment:number;lastVerifiedCoverageEnd:number|null};
type Options={registry:MarketRegistry;sourceInstanceId:string;runId?:string;startedAt:number;maximumSlots:number;record?:(kind:string,data:unknown)=>void};
const waits=['queueToAllocation','allocationToAck','ackToWarm','auditReadyToPhysicalStart','retirementToReplacement'] as const;
const zeroCounts=()=>({allocations:0,repromotions:0,distinctAudited:0,distinctPreliminaryEvaluated:0,distinctPrimaryEvaluated:0,qualified:0,entryFills:0,exitFills:0,unattributedFinancialEvents:0});
const validTime=(v:number)=>Number.isSafeInteger(v)&&v>=0;

export class NativeSlotProductivity{
 private readonly slots:Slot[];
 private readonly durations=Object.fromEntries(NATIVE_SLOT_STATES.map(state=>[state,0])) as Record<NativeSlotState,number>;
 private readonly counts=zeroCounts();private readonly failureCounts={historyNotObservedWindows:0,decisionDeadlineWindows:0,auditUnusableWindows:0,providerUnavailableWindows:0};private serial=0;private verifiedEvidenceMs=0;
 constructor(private readonly options:Options){
  if(!validTime(options.startedAt)||!Number.isSafeInteger(options.maximumSlots)||options.maximumSlots<1||options.maximumSlots>20)throw Error('NATIVE_SLOT_PRODUCTIVITY_OPTIONS');
  this.slots=Array.from({length:options.maximumSlots},(_,slot)=>({slot,mint:null,state:'VACANT',sinceAt:options.startedAt,allocatedAt:null,openedAt:null,windowEndAt:null,readyAt:null,firstPhysicalAt:null,retiredAt:null,warmAt:null,assignment:0,lastVerifiedCoverageEnd:null}));this.persist();
 }
 /** A refused/rolled-back nonfinancial write must not consume an in-memory
  * transition or add elapsed time a second time. The snapshot is bounded by
  * configured slots, independent of discovered market identity count. */
 private mutate<T>(fn:()=>T):T {
  const before={slots:this.slots.map(slot=>({...slot})),durations:{...this.durations},counts:{...this.counts},failureCounts:{...this.failureCounts},serial:this.serial,verifiedEvidenceMs:this.verifiedEvidenceMs};
  const restore=()=>{for(let i=0;i<this.slots.length;i++)Object.assign(this.slots[i]!,before.slots[i]!);Object.assign(this.durations,before.durations);Object.assign(this.counts,before.counts);Object.assign(this.failureCounts,before.failureCounts);this.serial=before.serial;this.verifiedEvidenceMs=before.verifiedEvidenceMs;};
  try{return this.options.registry.transaction(()=>{this.options.registry.onRollback(restore);return fn();});}catch(error){restore();throw error;}
 }
 assignedMints(){return this.slots.flatMap(slot=>slot.mint?[slot.mint]:[]); }
 hasAssignment(mint:string,allocatedAt:number){const slot=this.live(mint);return !!slot&&slot.allocatedAt===allocatedAt;}
 private live(mint:string){return this.slots.find(slot=>slot.mint===mint);}
 private key(suffix:string){return this.options.sourceInstanceId+':slot-productivity:'+suffix;}
 private persist(){this.options.registry.setMetadata(this.key('latest'),{version:'native-slot-productivity-v1',startedAt:this.options.startedAt,counts:this.counts,failureCounts:this.failureCounts,stateMs:this.durations,slots:this.slots,serial:this.serial,verifiedEvidenceMs:this.verifiedEvidenceMs});}
 private sample(name:typeof waits[number],key:string,value:number,at:number){if(Number.isFinite(value)&&value>=0)this.options.registry.recordMetric(this.key('metrics'),name,key,value,at);}
 private distinct(name:string,key:string,at:number){return this.options.registry.markDistinct(this.key(name),key,at);}
 private move(slot:Slot,state:NativeSlotState,at:number,reason:string){
  if(!validTime(at)||at<slot.sinceAt||slot.state===state)return;
  const previous=slot.state,elapsed=at-slot.sinceAt;this.durations[previous]+=elapsed;
  this.options.registry.recordMetric(this.key('metrics'),'state:'+previous,String(++this.serial)+':'+slot.slot+':'+(slot.mint??'vacant')+':'+previous+'>'+state,elapsed,at);
  slot.state=state;slot.sinceAt=at;this.persist();this.options.record?.('native-slot-productivity-transition',{at,sourceInstanceId:this.options.sourceInstanceId,slot:slot.slot,mint:slot.mint,previous,state,elapsedMs:elapsed,reason,financialPermission:false});
 }
 allocated(mint:string,at:number,waitingSince:number,priorPromotions:number){
  if(this.live(mint))return;const slot=this.slots.find(row=>row.mint===null);if(!slot)throw Error('NATIVE_SLOT_PRODUCTIVITY_CAPACITY');
  this.mutate(()=>{if(slot.retiredAt!==null)this.sample('retirementToReplacement',String(slot.assignment),at-slot.retiredAt,at);
   slot.mint=mint;slot.allocatedAt=at;slot.openedAt=null;slot.windowEndAt=null;slot.readyAt=null;slot.firstPhysicalAt=null;slot.warmAt=null;slot.lastVerifiedCoverageEnd=null;slot.assignment=++this.serial;
   this.counts.allocations++;if(priorPromotions>0)this.counts.repromotions++;
   this.sample('queueToAllocation',String(slot.assignment),Math.max(0,at-waitingSince),at);
   this.options.registry.setMetadata(this.key('assignment:'+mint),{slot:slot.slot,assignment:slot.assignment,allocatedAt:at});this.move(slot,'SUBSCRIPTION_WAIT',at,'actual-deep-allocation');this.persist();
  });
 }
 opened(mint:string,at:number){const slot=this.live(mint);if(!slot||slot.allocatedAt===null||at<slot.allocatedAt)return;
  this.mutate(()=>{if(slot.openedAt===null)this.sample('allocationToAck',String(slot.assignment),at-slot.allocatedAt!,at);slot.openedAt=at;slot.lastVerifiedCoverageEnd=at;slot.warmAt=null;slot.windowEndAt=null;slot.readyAt=null;slot.firstPhysicalAt=null;this.move(slot,'EVIDENCE_WARMING',at,'actual-subscription-ack');this.persist();});
 }
 warmed(mint:string,at:number){const slot=this.live(mint);if(!slot||slot.openedAt===null||slot.warmAt!==null)return;this.mutate(()=>{slot.warmAt=at;this.sample('ackToWarm',String(slot.assignment),at-slot.openedAt!,at);this.persist();});}
 ready(mint:string,windowEndAt:number,at:number){const slot=this.live(mint);if(!slot||slot.windowEndAt===windowEndAt)return;this.mutate(()=>{slot.windowEndAt=windowEndAt;slot.readyAt=at;slot.firstPhysicalAt=null;this.move(slot,'AUDIT_READY',at,'actual-auditable-window-ready');this.persist();});}
 waiting(mint:string,at:number,provider:boolean,reason:string){const slot=this.live(mint),state=provider?'PROVIDER_WAIT':'AUDIT_WAIT';if(!slot||slot.windowEndAt===null||slot.state==='AUDIT_ACTIVE'||slot.state===state)return;this.mutate(()=>this.move(slot,state,at,reason));}
 physicalStarted(mint:string,windowEndAt:number,at:number,physicalId:string){const slot=this.live(mint);if(!slot||slot.windowEndAt!==windowEndAt||slot.readyAt===null||at<slot.readyAt)return false;
  this.mutate(()=>{if(slot.firstPhysicalAt===null){slot.firstPhysicalAt=at;this.sample('auditReadyToPhysicalStart',String(slot.assignment)+':'+windowEndAt,at-slot.readyAt!,at);}this.distinct('physical-start',physicalId,at);this.move(slot,'AUDIT_ACTIVE',at,'actual-component-physical-start');this.persist();});return true;
 }
 physicalSettled(mint:string,at:number){const slot=this.live(mint);if(slot?.state==='AUDIT_ACTIVE')this.mutate(()=>this.move(slot,'AUDIT_WAIT',at,'physical-operation-returned-to-validation'));}
 evaluated(mint:string,windowStartAt:number,windowEndAt:number,at:number){const slot=this.live(mint);if(!slot)return;
  this.mutate(()=>{const begin=Math.max(windowStartAt,slot.openedAt??at,slot.allocatedAt??at,this.options.startedAt,slot.lastVerifiedCoverageEnd??0),end=Math.min(windowEndAt,at);if(end>begin){this.verifiedEvidenceMs+=end-begin;slot.lastVerifiedCoverageEnd=end;}if(this.distinct('audited',mint,at))this.counts.distinctAudited++;if(this.distinct('preliminary-evaluated',mint,at))this.counts.distinctPreliminaryEvaluated++;this.options.registry.recordMetric(this.key('metrics'),'completed-window',mint+':'+windowEndAt,1,at);slot.windowEndAt=null;slot.readyAt=null;slot.firstPhysicalAt=null;this.move(slot,'EVIDENCE_WARMING',at,'verified-window-preliminary-assessment-complete');this.persist();});
 }
 unusable(mint:string,at:number,reason:string){const slot=this.live(mint);if(slot&&slot.state!=='UNUSABLE')this.mutate(()=>this.move(slot,'UNUSABLE',at,reason));}
 retired(mint:string,at:number,reason:string){const slot=this.live(mint);if(!slot)return;this.mutate(()=>{this.move(slot,'REPLACEMENT_WAIT',at,reason);slot.mint=null;slot.retiredAt=at;slot.allocatedAt=null;slot.openedAt=null;slot.windowEndAt=null;slot.readyAt=null;slot.firstPhysicalAt=null;slot.warmAt=null;this.persist();});}
 failed(mint:string,windowEndAt:number,at:number,kind:string,reason:string){if(!validTime(windowEndAt)||windowEndAt===0||windowEndAt>at)return;const names:Array<keyof typeof this.failureCounts>=[];if(reason==='NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED')names.push('historyNotObservedWindows');if(kind==='decision-expired')names.push('decisionDeadlineWindows');if(kind==='audit-unusable')names.push('auditUnusableWindows');if(/PHYSICAL_TIMEOUT|HTTP_429|HTTP_STATUS_50[234]|HTTP_TRANSPORT|RPC_OVERLOAD/.test(reason))names.push('providerUnavailableWindows');if(!names.length)return;this.mutate(()=>{for(const name of names)if(this.distinct('failure:'+name,mint+':'+windowEndAt,at))this.failureCounts[name]++;this.persist();});}
 financial(input:{mint:string;kind:NativeSlotFinancialKind;at:number;key:string}){
  if(!validTime(input.at)||input.at<this.options.startedAt)return;const assignment=this.options.registry.getMetadata<{slot:number;assignment:number;allocatedAt:number}>(this.key('assignment:'+input.mint));
  this.mutate(()=>{if(!this.distinct('financial:'+input.kind,input.mint+':'+input.key,input.at))return;
   if(!assignment){this.counts.unattributedFinancialEvents++;this.persist();return;}
   if(input.kind==='primary-evaluated'){if(this.distinct('primary-evaluated',input.mint,input.at))this.counts.distinctPrimaryEvaluated++;}else if(input.kind==='qualified')this.counts.qualified++;else if(input.kind==='entry-fill')this.counts.entryFills++;else this.counts.exitFills++;
   this.options.registry.setMetadata(this.key('financial:'+input.kind+':'+input.mint+':'+input.key),{...input,slot:assignment.slot,assignment:assignment.assignment,financialPermission:false});this.persist();
  });
 }
 snapshot(at:number){const stateMs={...this.durations};for(const slot of this.slots)stateMs[slot.state]+=Math.max(0,at-slot.sinceAt);
  const occupiedSlotMs=Object.entries(stateMs).reduce((sum,[state,value])=>sum+(state==='VACANT'||state==='REPLACEMENT_WAIT'?0:value),0);return {version:'native-slot-productivity-v1' as const,scope:'CURRENT_SOURCE_INSTANCE' as const,sourceInstanceId:this.options.sourceInstanceId,runId:this.options.runId??null,startedAt:this.options.startedAt,generatedAt:at,configuredSlots:this.options.maximumSlots,stateMs,slots:this.slots.map(({slot,mint,state,sinceAt,allocatedAt,openedAt,windowEndAt})=>({slot,mint,state,sinceAt,stateAgeMs:Math.max(0,at-sinceAt),allocatedAt,openedAt,windowEndAt})),counts:{...this.counts},failureCounts:{...this.failureCounts},waits:Object.fromEntries(waits.map(name=>[name,this.options.registry.metricSummary(this.key('metrics'),name)])) as Record<typeof waits[number],ReturnType<MarketRegistry['metricSummary']>>,percentileScope:'ALL_ACTUAL_STARTS_IN_SOURCE_INSTANCE' as const,evidenceCoverage:{verifiedEvidenceMs:this.verifiedEvidenceMs,occupiedSlotMs,percent:occupiedSlotMs?this.verifiedEvidenceMs*100/occupiedSlotMs:null,basis:'RETROSPECTIVE_UNION_OF_VERIFIED_WINDOWS_PER_ACTUAL_SLOT_ASSIGNMENT' as const},limitations:[...NATIVE_SLOT_LIMITATIONS]};
 }
}
