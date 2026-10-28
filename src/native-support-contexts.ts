/** Historical confirmed-bank fences, never current quotes or fresh pool state.
 * The old180s horizon remains. A read-count cap must not erase a60s window's
 * lower fence when audit-ceiling/runway work performs extra current reads. */
import {PROVISIONAL_RULE} from './strategy.js';

export type NativeSupportContext={slot:number;availableAt:number;bankClockAt:number};
const retentionMs=180000,bucketMs=PROVISIONAL_RULE.bucketMs;
export const NATIVE_SUPPORT_CONTEXT_RETENTION=Object.freeze({
 version:'native-bank-context-time-buckets-v1',bucketMs,retentionMs,
 maximumBuckets:retentionMs/bucketMs+1,maximumContexts:2*(retentionMs/bucketMs+1),
 windowMs:PROVISIONAL_RULE.windowMs,decisionSpanMs:PROVISIONAL_RULE.bucketMs,
 meaning:'Actual earliest/latest coherent context per availability bucket; no timestamp, slot, source expiry or quote age is changed. Contexts are cleared by the existing subscription ACK generation reset.'
});

export function retainNativeSupportContexts(previous:readonly NativeSupportContext[],next:NativeSupportContext):NativeSupportContext[]{
 if(previous.length>NATIVE_SUPPORT_CONTEXT_RETENTION.maximumContexts)throw Error('NATIVE_SUPPORT_CONTEXT_BOUND');
 const input=[...previous,next];
 for(const c of input)if(![c.slot,c.availableAt,c.bankClockAt].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('NATIVE_SUPPORT_CONTEXT_FIELDS');
 const anchor=Math.max(...input.map(c=>c.availableAt)),cutoff=anchor-retentionMs;
 const buckets=new Map<number,{first:NativeSupportContext;last:NativeSupportContext}>();
 for(const c of input){if(c.availableAt<cutoff)continue;const key=Math.floor(c.availableAt/bucketMs),pair=buckets.get(key);if(!pair)buckets.set(key,{first:c,last:c});else{if(c.availableAt<=pair.first.availableAt)pair.first=c;if(c.availableAt>=pair.last.availableAt)pair.last=c;}}
 const result=[...buckets].sort((a,b)=>a[0]-b[0]).flatMap(([,pair])=>pair.first===pair.last||pair.first.slot===pair.last.slot&&pair.first.availableAt===pair.last.availableAt&&pair.first.bankClockAt===pair.last.bankClockAt?[pair.first]:[pair.first,pair.last]);
 if(buckets.size>NATIVE_SUPPORT_CONTEXT_RETENTION.maximumBuckets||result.length>NATIVE_SUPPORT_CONTEXT_RETENTION.maximumContexts)throw Error('NATIVE_SUPPORT_CONTEXT_BOUND');
 return result.map(c=>({...c}));
}
