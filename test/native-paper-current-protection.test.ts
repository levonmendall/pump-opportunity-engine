/** OFFLINE actual launcher completion-accounting path. No financial writer,
 * provider, market qualification or live protection success is represented. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {runNativePaper,NATIVE_PAPER_PROCESSING_RESERVE} from '../src/run-native-paper.js';
import {PILOT_TIMING} from '../src/pilot.js';

test('actual completion accounting separates observed current-run maxima from retained historical failures',()=>{
 const source=runNativePaper.toString(),begin=source.search(/const\s+record\s*=/),rest=source.slice(begin),end=rest.search(/;\s*const\s+sourceInformationAdmission\s*=/);
 assert.ok(begin>=0&&end>0,'extract the actual complete record/completion closure');
 let at=10000;const positions:any={held:{mint:'held',units:'100',enteredAt:1000}},pauses:string[]=[],holder:any={};
 const context:any={__name:(f:unknown)=>f,holder,Buffer,Date:{now:()=>at},Math,Number,Map,Object,PILOT_TIMING,NATIVE_PAPER_PROCESSING_RESERVE,MIB:1024*1024,
  need:(value:unknown,reason:string)=>{if(!value)throw Error(reason);},service:false,recording:[],providerStats:{httpTimeouts:0,httpErrors:0,throttles:0},eventBytes:0,segmentBytes:0,
  recorder:{record(){}},ledger:{state:()=>({positions})},bridge:{trader:{pauseNewEntries:(reason:string)=>pauses.push(reason)}},completed:new Map(),startedAt:10000,
  maxCompletedGap:89426,maxQuoteAge:70,currentRunMaximumCompletedGapMs:null,currentRunMaximumQuoteAgeAtUseMs:null,protectionBreaches:72,unavailableChecks:233,
  protectionEpoch:null,firstCompletedProtectionAt:null,lastCompleted:null,lastCompletedProtectionAt:null,
  nativePaperCompletedProtectionAt:()=>null};
 runInNewContext(rest.slice(0,end)+';holder.record=record;holder.view=()=>({maxCompletedGap,maxQuoteAge,currentRunMaximumCompletedGapMs,currentRunMaximumQuoteAgeAtUseMs,protectionBreaches,unavailableChecks});',context,{timeout:1000});
 const emit=(overrides:Record<string,unknown>={})=>holder.record('trader-held-evaluation',{mint:'held',units:'100',usable:true,quoteAt:at-30,sourceValidUntil:at+1000,...overrides});
 assert.equal(holder.view().currentRunMaximumCompletedGapMs,null);assert.equal(holder.view().currentRunMaximumQuoteAgeAtUseMs,null);
 for(const bad of [{usable:false},{units:'99'},{quoteAt:at+1},{quoteAt:at-2001},{sourceValidUntil:at-1}])emit(bad);
 assert.equal(holder.view().currentRunMaximumCompletedGapMs,null,'unavailable, stale, future and wrong-inventory checks cannot claim observed healthy timing');
 at=10100;emit();assert.equal(holder.view().currentRunMaximumCompletedGapMs,100,'old holding age before this runtime is not manufactured as observed coverage');assert.equal(holder.view().currentRunMaximumQuoteAgeAtUseMs,30);
 at=12000;emit();assert.equal(holder.view().currentRunMaximumCompletedGapMs,1900);assert.equal(holder.view().maxCompletedGap,89426);assert.equal(holder.view().maxQuoteAge,70);
 at=14000;emit({quoteAt:11970});assert.equal(holder.view().currentRunMaximumCompletedGapMs,1900,'the same earlier quote cannot move a completion or either maximum');
 at=20000;emit({quoteAt:at-50});assert.equal(holder.view().currentRunMaximumCompletedGapMs,8000);assert.equal(holder.view().currentRunMaximumQuoteAgeAtUseMs,50);assert.equal(holder.view().protectionBreaches,73);assert.equal(pauses.length,1,'a newly observed long gap remains a real financial pause, despite smaller current-run maxima');
 assert.equal(holder.view().maxCompletedGap,89426,'historical lower bound is retained');assert.equal(holder.view().maxQuoteAge,70);
});
