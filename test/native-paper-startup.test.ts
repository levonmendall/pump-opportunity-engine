/** Explicit offline orchestration. Synthetic delays are not provider evidence. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serviceNativePaperStartup,parseNativePaperArgs,nativePaperConfigurationSha256} from '../src/run-native-paper.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';

test('resumed exposure is evaluated before each discretionary startup connection',async()=>{
 let at=10000,lastCompleted=0;const trace:Array<{kind:string;at:number}>=[];
 const source=(kind:string)=>async()=>{assert.equal(at-lastCompleted,0);trace.push({kind,at});at+=1500;};
 const shared={managementOnly:false,owned:()=>true,protect:async()=>{trace.push({kind:'protection',at});at+=700;lastCompleted=at;},sourceAdmission:()=>at-lastCompleted<=100,sources:[source('discovery'),source('watch')] as const,record:()=>{},now:()=>at};
 let index=await serviceNativePaperStartup({...shared,nextSource:0});assert.equal(index,1);
 index=await serviceNativePaperStartup({...shared,nextSource:index});assert.equal(index,2);
 assert.deepEqual(trace.map(x=>x.kind),['protection','discovery','protection','watch']);
 assert.equal(trace[2]!.at-trace[0]!.at,2200,'a source control never erases the next financial evaluation');
 assert.equal(await serviceNativePaperStartup({...shared,nextSource:index}),2);assert.equal(trace.length,4);
});

test('unavailable or unusable recovery defers only source startup and can be retried after a fresh financial check',async()=>{
 let failing=true,usable=false,protects=0,sources=0;const records:string[]=[];
 const shared={managementOnly:false,owned:()=>true,protect:async()=>{protects++;if(failing)throw Error('SYNTHETIC outage');},sourceAdmission:()=>usable,sources:[async()=>{sources++;},async()=>{sources++;}] as const,record:(kind:string)=>records.push(kind)};
 assert.equal(await serviceNativePaperStartup({...shared,nextSource:0}),0);assert.equal(sources,0);
 failing=false;assert.equal(await serviceNativePaperStartup({...shared,nextSource:0}),0);assert.equal(sources,0);
 usable=true;assert.equal(await serviceNativePaperStartup({...shared,nextSource:0}),1);assert.equal(sources,1);assert.equal(protects,3);
 assert.deepEqual(records,['native-paper-startup-source-deferred','native-paper-startup-protection','native-paper-startup-source-deferred','native-paper-startup-protection']);
});

test('management-only recovery attempts owned obligations while never connecting candidate/discovery feeds',async()=>{
 for(const failure of [false,true]){let protects=0,source=0;const index=await serviceNativePaperStartup({managementOnly:true,nextSource:0,owned:()=>true,protect:async()=>{protects++;if(failure)throw Error('SYNTHETIC physical refusal');},sourceAdmission:()=>true,sources:[async()=>{source++;},async()=>{source++;}],record:()=>{}});assert.equal(index,2);assert.equal(protects,1);assert.equal(source,0);}
 let work=0;assert.equal(await serviceNativePaperStartup({managementOnly:true,nextSource:0,owned:()=>false,protect:async()=>{work++;},sourceAdmission:()=>true,sources:[async()=>{work++;},async()=>{work++;}],record:()=>{}}),2);assert.equal(work,0);
});

test('management-only is explicit and frozen into configuration rather than implied by source failure',()=>{
 const base=['--resume','--directory','/offline','--input','/offline-input','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION];
 assert.equal(parseNativePaperArgs(base).managementOnly,false);assert.equal(parseNativePaperArgs([...base,'--management-only']).managementOnly,true);
 assert.throws(()=>parseNativePaperArgs([...base,'--management-only','--management-only']),/DUPLICATE_ARGUMENT/);
 const initial=nativePaperConfigurationSha256({stage:'single',deepSlots:3,durationMs:1800000}),recovery=nativePaperConfigurationSha256({stage:'single',deepSlots:1,durationMs:1800000,managementOnly:true});assert.notEqual(initial,recovery);assert.equal(recovery,nativePaperConfigurationSha256({stage:'single',deepSlots:1,durationMs:1800000,managementOnly:true}));
 assert.throws(()=>nativePaperConfigurationSha256({managementOnly:'yes' as any}),/FINITE_RESEARCH_LIMIT/);
});

test('reported all-position completion uses the final actual callback, not the oldest scheduling watermark',async()=>{
 const {nativePaperCompletedProtectionAt}=await import('../src/run-native-paper.js');
 const positions=[{mint:'fixture-a',units:'7'},{mint:'fixture-b',units:'8'}],completed=new Map<string,{units:string;at:number;quoteAt:number}>([['fixture-a',{units:'7',at:10010,quoteAt:10000}],['fixture-b',{units:'8',at:9990,quoteAt:9900}]]);
 assert.equal(nativePaperCompletedProtectionAt({at:10020,epoch:10000,positions,completed}),null,'old other-position completion cannot freshen this pass');
 completed.set('fixture-b',{units:'8',at:10020,quoteAt:10000});
 assert.equal(nativePaperCompletedProtectionAt({at:10020,epoch:10000,positions,completed}),10020);
 assert.equal(nativePaperCompletedProtectionAt({at:10020,epoch:10000,positions:[...positions,{mint:'new-fixture',units:'1'}],completed}),null);
 assert.equal(nativePaperCompletedProtectionAt({at:12001,epoch:10000,positions,completed}),null,'source heartbeat cannot relabel now-stale quotes');
 completed.set('fixture-b',{units:'88',at:10020,quoteAt:10000});assert.equal(nativePaperCompletedProtectionAt({at:10020,epoch:10000,positions,completed}),null,'size changes invalidate prior completion');
 assert.equal(nativePaperCompletedProtectionAt({at:10020,epoch:null,positions,completed}),null);
 assert.equal(nativePaperCompletedProtectionAt({at:10020,epoch:10000,positions:[],completed}),null);
});

test('candidate CPU work gives way before management handoff without weakening quote or cadence contracts',async()=>{
 const {nativePaperProcessingAdmission:admission,NATIVE_PAPER_PROCESSING_RESERVE:r}=await import('../src/run-native-paper.js');
 assert.deepEqual(admission(299999999,300*1024*1024),{candidateAllowed:true,entryAllowed:true});
 assert.deepEqual(admission(300000000,300*1024*1024),{candidateAllowed:true,entryAllowed:false});
 assert.deepEqual(admission(360000000,300*1024*1024),{candidateAllowed:false,entryAllowed:false});
 assert.deepEqual(admission(0,384*1024*1024+1),{candidateAllowed:false,entryAllowed:false});
 assert.deepEqual(admission(0,1,80*1024*1024),{candidateAllowed:true,entryAllowed:false});assert.deepEqual(admission(0,1,95*1024*1024),{candidateAllowed:false,entryAllowed:false});assert.equal(r.maximumEvidenceBytes-r.candidateEvidenceBytes,32*1024*1024);assert.equal(r.supervisorRecoveryCpuMicros-r.candidateCpuMicros,60000000);assert.equal(r.processSoftCpuMicros-r.supervisorRecoveryCpuMicros,60000000);
 assert.throws(()=>admission(NaN,1),/PROCESSING_VIEW/);assert.throws(()=>admission(0,-1),/PROCESSING_VIEW/);
});
