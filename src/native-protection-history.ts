/** Read-only lower bounds. Old observations never become current protection. */
export const NATIVE_PROTECTION_HISTORY_KIND='native-paper-service-protection-history-v1' as const;
export type NativeProtectionCounters={maxCompletedGapMs:number;maxQuoteAgeMs:number;breaches:number;unavailableChecks:number};
export type NativeProtectionHistory=NativeProtectionCounters&{fromCheckpoint:boolean;fromPreviousStatus:boolean;historyUnavailable:boolean;scope:'known-lower-bound'};
export type NativeProtectionHistoryInput={accountId:string;inceptionAt:number;knownRunIds:readonly string[];at:number;checkpoint:unknown;previousStatus:unknown};
const names=['maxCompletedGapMs','maxQuoteAgeMs','breaches','unavailableChecks'] as const;
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f]/.test(value);
const empty=():NativeProtectionHistory=>({maxCompletedGapMs:0,maxQuoteAgeMs:0,breaches:0,unavailableChecks:0,fromCheckpoint:false,fromPreviousStatus:false,historyUnavailable:true,scope:'known-lower-bound'});
const counters=(value:unknown):NativeProtectionCounters|null=>{
 if(!record(value)||Object.keys(value).sort().join('|')!==[...names].sort().join('|')||!names.every(key=>integer(value[key])))return null;
 return {maxCompletedGapMs:Number(value.maxCompletedGapMs),maxQuoteAgeMs:Number(value.maxQuoteAgeMs),breaches:Number(value.breaches),unavailableChecks:Number(value.unavailableChecks)};
};

/** Merge cumulative known bounds with MAX, never SUM. Missing or corrupt
 * optional statistics cannot block financial management. No completion time,
 * quote, inventory, permission or healthy-proof streak is returned/restored. */
export function readNativeProtectionHistory(input:NativeProtectionHistoryInput):NativeProtectionHistory{
 const result=empty();let known:Set<string>;
 try{
  if(!record(input)||!text(input.accountId)||!integer(input.inceptionAt)||!integer(input.at)||input.at<input.inceptionAt||!Array.isArray(input.knownRunIds)||input.knownRunIds.length>1024||!input.knownRunIds.every(text))return result;
  known=new Set(input.knownRunIds);
 }catch{return result;}
 const identity=(value:Record<string,unknown>,runKey:'sourceRunId'|'runId')=>value.accountId===input.accountId&&value.inceptionAt===input.inceptionAt&&text(value[runKey])&&known.has(value[runKey] as string)&&integer(value.generatedAt)&&value.generatedAt>=input.inceptionAt&&value.generatedAt<=input.at;
 const merge=(value:NativeProtectionCounters)=>{for(const key of names)result[key]=Math.max(result[key],value[key]);};
 try{
  const checkpoint=input.checkpoint;
  if(record(checkpoint)&&Object.keys(checkpoint).sort().join('|')==='accountId|counters|generatedAt|inceptionAt|kind|sourceRunId'&&checkpoint.kind===NATIVE_PROTECTION_HISTORY_KIND&&identity(checkpoint,'sourceRunId')){
   const value=counters(checkpoint.counters);if(value){merge(value);result.fromCheckpoint=true;}
  }
 }catch{/* An unreadable optional checkpoint is not a financial failure. */}
 try{
  const status=input.previousStatus;
  if(record(status)&&identity(status,'runId')&&record(status.source)&&typeof status.source.commit==='string'&&/^[a-f0-9]{40}$/.test(status.source.commit)&&typeof status.source.sha256==='string'&&/^[a-f0-9]{64}$/.test(status.source.sha256)&&record(status.timing)){
   // Deliberately project only known fields: source/timing can contain other
   // runtime metadata, but none can restore current-run protection evidence.
   const value=counters({maxCompletedGapMs:status.timing.maximumCompletedGapMs,maxQuoteAgeMs:status.timing.maximumQuoteAgeAtUseMs,breaches:status.timing.protectionBreaches,unavailableChecks:status.timing.unavailableChecks});
   if(value){merge(value);result.fromPreviousStatus=true;}
  }
 }catch{/* Preserve any independently valid checkpoint lower bound. */}
 result.historyUnavailable=!result.fromCheckpoint&&!result.fromPreviousStatus;return result;
}
