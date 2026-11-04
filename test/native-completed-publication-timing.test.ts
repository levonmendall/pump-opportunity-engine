/** OFFLINE deterministic timing and the actual scheduled-report closure. No
 * financial writer, network, native service or production file is opened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePaperReportTimings,nativePaperCompletedPublicationTiming,nativePaperReportAdmissionBound,NATIVE_PAPER_REPORT_PHASES,NATIVE_PAPER_REPORT_ADMISSION_RESERVE_MS} from '../src/native-paper-reporting-timing.js';
import {NativePaperReportingHealth,runNativePaper,nativePaperReportingAdmission,NATIVE_PAPER_REPORT_BUDGET_MS} from '../src/run-native-paper.js';
import {PILOT_TIMING} from '../src/pilot.js';
import {projectFinancialReadinessReporting,validateFinancialReadinessReporting} from '../src/financial-readiness-reporting.js';

test('completed publication phases are same-cycle deltas, with missing phases distinct from measured zero',()=>{
 let clock=0;const timings=new NativePaperReportTimings(()=>clock);
 timings.measure('financial-portfolio',()=>{clock+=900;});timings.measure('candidate-status',()=>{clock+=100;});
 const before=timings.usage();timings.measure('candidate-status',()=>{clock+=7;});timings.measure('cash-maintenance',()=>{});timings.measure('publication-checkpoint',()=>{clock+=11;});
 const completed=nativePaperCompletedPublicationTiming({startedAt:100000,completedAt:100030,durationMs:30,before,after:timings.usage(),timingAvailable:timings.timingAvailable})!;
 assert.equal(completed.durationMs,30,'unmeasured surrounding work is retained in the original whole duration');assert.equal(completed.startedAt,100000);assert.equal(completed.completedAt,100030);
 assert.deepEqual(completed.phases.map(p=>[p.stage,p.count,p.elapsedMs]),NATIVE_PAPER_REPORT_PHASES.map(stage=>[stage,...(stage==='candidate-status'?[1,7]:stage==='cash-maintenance'?[1,0]:stage==='publication-checkpoint'?[1,11]:[0,null])]));
 assert.equal(timings.usage().find(p=>p.stage==='financial-portfolio')!.lastMs,900,'lifetime phase history remains unchanged');
 assert.ok(Object.isFrozen(completed)&&Object.isFrozen(completed.phases)&&completed.phases.every(Object.isFrozen));
 const original=JSON.stringify(completed);timings.measure('candidate-status',()=>{clock+=500;});assert.equal(JSON.stringify(completed),original,'a later phase cannot alter an earlier completed publication');
});

test('unavailable or regressing timing cannot fabricate a completed same-cycle record',()=>{
 const valid={startedAt:1000,completedAt:1010,durationMs:10,before:[],after:[{stage:'candidate-status' as const,count:1,totalMs:5,lastMs:5,maximumMs:5}],timingAvailable:true};
 assert.ok(nativePaperCompletedPublicationTiming(valid));
 for(const patch of [{startedAt:NaN},{completedAt:999},{durationMs:Infinity},{durationMs:-1},{timingAvailable:false},{after:[...valid.after,...valid.after]},{before:[{...valid.after[0]!,count:2}]},{before:[{...valid.after[0]!,totalMs:6,lastMs:6,maximumMs:6}]},{before:[{...valid.after[0]!,totalMs:4,lastMs:4,maximumMs:4}]}])assert.equal(nativePaperCompletedPublicationTiming({...valid,...patch}),null);
 const empty=nativePaperCompletedPublicationTiming({...valid,after:[],durationMs:0})!;assert.ok(empty.phases.every(p=>p.count===0&&p.elapsedMs===null));
});

function scheduledFixture(){
 let wall=100000,monotonic=0,cycle=0,fail=false;const timings=new NativePaperReportTimings(()=>monotonic),health=new NativePaperReportingHealth(),published:any[]=[],events:any[]=[];
 const advance=(ms:number)=>{wall+=ms;monotonic+=ms;};let owner:any;
 const report=()=>{
  advance(7);timings.measure('candidate-status',()=>advance(cycle===0?10:200));timings.measure('financial-history',()=>advance(20));
  published.push({at:wall,completedPublication:owner.view().completedPublication,phases:timings.usage()});
  return timings.measure('publication-checkpoint',()=>{advance(30);if(fail)throw Error('OFFLINE publication failed');advance(5);cycle++;});
 };
 const context:any={__name:(v:unknown)=>v,Date:{now:()=>wall},reportTimings:timings,reportingCompletedPublication:null,reportingMaximumMs:0,reportingLastMs:null,reportingLastCompletedAt:null,reportingOverruns:0,reportingDeferrals:0,lastReportingDeferral:null,lastReport:0,
  reportingHealth:{get entryAllowed(){return health.entryAllowed;},complete:(publish:()=>unknown,projection:()=>boolean)=>health.complete(publish,projection,()=>monotonic)},
  currentEngine:{hasPendingFinancialEvaluation:()=>false,discretionaryAdmission:()=>({admitted:true,latestStartAt:wall+10000})},currentLedger:{state:()=>({positions:{}})},currentBridge:{trader:{nextDueAt:()=>null}},lastProtectionStart:0,
  nativePaperReportAdmissionBound,nativePaperReportingAdmission,nativePaperCompletedPublicationTiming,NATIVE_PAPER_REPORT_ADMISSION_RESERVE_MS,NATIVE_PAPER_REPORT_BUDGET_MS,PILOT_TIMING,financialProjectionReady:true,report,localPhase:(_name:string,_bound:number,fn:()=>unknown)=>fn(),record:(kind:string,data:unknown)=>events.push({kind,data})};
 const source=runNativePaper.toString(),start=source.search(/const\s+maybeReport\s*=/),tail=source.slice(start),end=tail.search(/;\s*const\s+quarantineSources\s*=/);assert.ok(start>=0&&end>0,'actual complete scheduled publication is exercised');
 owner=Function(...Object.keys(context),tail.slice(0,end)+';return {run:maybeReport,view:()=>({completedPublication:reportingCompletedPublication,lastDurationMs:reportingLastMs,lastCompletedAt:reportingLastCompletedAt,overruns:reportingOverruns})};')(...Object.values(context));
 return {owner,timings,published,events,health,advance,set fail(value:boolean){fail=value;}};
}

test('actual scheduled publication publishes prior completed timings without mixing the next report and retains the same overrun record',()=>{
 const f=scheduledFixture();f.owner.run();assert.equal(f.published[0].completedPublication,null);
 const first=f.owner.view();assert.equal(first.lastDurationMs,72);assert.equal(first.completedPublication.durationMs,72);assert.equal(first.completedPublication.completedAt,first.lastCompletedAt);
 f.advance(15000);f.owner.run();const second=f.owner.view();assert.equal(second.lastDurationMs,262);assert.equal(second.overruns,1);assert.equal(f.published[1].completedPublication,first.completedPublication);
 assert.equal(f.published[1].phases.find((p:any)=>p.stage==='candidate-status').count,2);assert.equal(f.published[1].phases.find((p:any)=>p.stage==='publication-checkpoint').count,1,'the retained legacy view really does include partial later work');
 assert.equal(first.completedPublication.phases.find((p:any)=>p.stage==='candidate-status').elapsedMs,10);assert.equal(second.completedPublication.phases.find((p:any)=>p.stage==='candidate-status').elapsedMs,200);
 assert.equal(f.events.length,1);const event=f.events[0];assert.equal(event.kind,'native-paper-reporting-overrun');assert.equal(event.data.elapsedMs,262);assert.equal(event.data.budgetMs,250);assert.equal(event.data.publicationTiming,second.completedPublication,'the existing event carries the same original immutable completed record');assert.equal(event.data.completedPublication,true);assert.equal(event.data.timingGrantsNoEntryPermission,true);assert.equal(event.data.protectionTimingStillMeasured,true);
 f.advance(15000);f.fail=true;assert.throws(()=>f.owner.run(),/OFFLINE publication failed/);assert.equal(f.owner.view().completedPublication,second.completedPublication,'a failed publication cannot replace the previous completed record');assert.equal(f.owner.view().lastCompletedAt,second.lastCompletedAt);assert.equal(f.health.entryAllowed,false);
});

function wireFixture(){
 const generated=Date.parse('2026-11-04T02:11:39.912Z'),completedAt=generated-16909,startedAt=completedAt-224;
 const completed=nativePaperCompletedPublicationTiming({startedAt,completedAt,durationMs:223.17298100003973,before:[],after:NATIVE_PAPER_REPORT_PHASES.map(stage=>({stage,count:1,totalMs:stage==='publication-checkpoint'?54:10,lastMs:stage==='publication-checkpoint'?54:10,maximumMs:stage==='publication-checkpoint'?54:10})),timingAvailable:true})!;
 const raw:any={runId:'native-paper-offline-consistent-report',startedAt:generated-100000,generatedAt:generated,entriesEnabled:false,financial:{controls:{entriesEnabled:false,stopRequested:false},daily:{paused:true,reconciledAt:generated-100}},financialReadiness:{maintenance:{outcomeVersion:'cash-reconciliation-independent-permission-v1',healthyMaintenanceArmed:true,attempts:1502,reconciled:1501,recoveries:1,unavailable:1,financialFailures:0,busyDeferrals:0,deadlineMisses:0,maximumLatenessMs:0,maximumElapsedMs:50.125,lastStartedAt:generated-102,lastCompletedAt:generated-100}},reporting:{lastProjectionMs:completed.durationMs,maximumProjectionMs:684.7673960000102,lastCompletedAt:completedAt,projectionOverruns:3,phaseTimings:NATIVE_PAPER_REPORT_PHASES.map(stage=>({stage,count:113,totalMs:4000.125,lastMs:40.125,maximumMs:400.125})),phaseTimingsScope:'CUMULATIVE_SAMPLES_NOT_A_PUBLICATION_BREAKDOWN',completedPublication:completed}};
 return {raw,generated,completed};
}

test('existing financial-readiness interface accepts legacy data and exports bounded original completed-report clocks separately',()=>{
 const {raw,generated,completed}=wireFixture(),wire=projectFinancialReadinessReporting(raw,generated)!;assert.ok(wire);validateFinancialReadinessReporting(wire,generated);
 assert.equal(wire.reporting.completedPublication!.completedAt,new Date(completed.completedAt).toISOString());assert.equal(wire.reporting.completedPublication!.startedAt,new Date(completed.startedAt).toISOString());assert.equal(wire.reporting.completedPublication!.durationMs,wire.reporting.lastDurationMs);assert.equal(wire.reporting.stagesScope,'CUMULATIVE_SAMPLES_NOT_A_PUBLICATION_BREAKDOWN');assert.equal(wire.permission.currentEntriesEnabled,false);assert.ok(Buffer.byteLength(JSON.stringify(wire))<=4096);
 const legacy=structuredClone(raw);delete legacy.reporting.completedPublication;delete legacy.reporting.phaseTimingsScope;const previous=projectFinancialReadinessReporting(legacy,generated)!;assert.ok(previous);assert.equal(Object.hasOwn(previous.reporting,'completedPublication'),false);validateFinancialReadinessReporting(previous,generated);
 raw.reporting.completedPublication={...completed,secret:'DO_NOT_EXPORT',phases:completed.phases.map(p=>({...p,secret:'DO_NOT_EXPORT'}))};assert.equal(JSON.stringify(projectFinancialReadinessReporting(raw,generated)).includes('DO_NOT_EXPORT'),false);
});

test('public completed timing refuses mismatched full-report identity, future clocks, false zeroes and unknown phase fields',()=>{
 const {raw,generated}=wireFixture(),valid=projectFinancialReadinessReporting(raw,generated)!;
 for(const change of [(r:any)=>{r.reporting.completedPublication.completedAt=new Date(generated+1).toISOString();},(r:any)=>{r.reporting.completedPublication.durationMs+=1;},(r:any)=>{r.reporting.completedPublication.startedAt=new Date(generated).toISOString();},(r:any)=>{r.reporting.completedPublication.phases[0].count=0;},(r:any)=>{r.reporting.completedPublication.phases[0].stage='PRIVATE';},(r:any)=>{r.reporting.completedPublication.phases[0].secret='PRIVATE';},(r:any)=>{r.reporting.completedPublication.phases.pop();},(r:any)=>{delete r.reporting.stagesScope;}]){const bad=structuredClone(valid);change(bad);assert.throws(()=>validateFinancialReadinessReporting(bad,generated),/FINANCIAL_READINESS/);}
 const absent:any=structuredClone(valid);absent.reporting.completedPublication.phases[0]={stage:'candidate-status',count:0,elapsedMs:null};validateFinancialReadinessReporting(absent,generated);
});

test('the unchanged4KiB readiness budget accommodates actual H5 long-number shapes and a synthetic completed-cycle record',()=>{
 // Numeric shapes copied from authenticated final H5 private capture
 //41760701025. Its phase samples span different reports; the constructed delta
 // below is only a wire-size fixture, never a reconstruction of that live cycle.
 const rows=[[168,2342.2437269991724,10.824494000058621,47.13234899996314],[168,108.94891399764674,.3865269999951124,9.689229999901727],[168,244.33805699909908,.9654330001212656,7.479897999903187],[168,265.6873330000153,2.2092820000834763,9.871632999973372],[168,3201.8029100000126,12.779273000080138,52.98458899999969],[168,4031.335339001598,14.321853999979794,78.88651799992658],[168,2774.7670259994557,11.31042500026524,165.40870899999572],[167,6634.5492319992,38.610086999833584,441.90067600000475]];
 const {raw,generated}=wireFixture(),phases=NATIVE_PAPER_REPORT_PHASES.map((stage,i)=>{const [count,totalMs,lastMs,maximumMs]=rows[i]!;return {stage,count:count!,totalMs:totalMs!,lastMs:lastMs!,maximumMs:maximumMs!};});
 raw.reporting.phaseTimings=phases;raw.financialReadiness.maintenance.maximumElapsedMs=239.02107000001706;raw.financialReadiness.maintenance.maximumLatenessMs=782;
 raw.reporting.completedPublication=nativePaperCompletedPublicationTiming({startedAt:raw.reporting.lastCompletedAt-224,completedAt:raw.reporting.lastCompletedAt,durationMs:raw.reporting.lastProjectionMs,before:phases.map(p=>({...p,count:p.count-1,totalMs:p.totalMs-p.lastMs})),after:phases,timingAvailable:true});
 assert.ok(raw.reporting.completedPublication);const wire=projectFinancialReadinessReporting(raw,generated);assert.ok(wire,'the complete financial readiness block remains available');validateFinancialReadinessReporting(wire,generated);assert.equal(wire.reporting.completedPublication!.phases.length,8);assert.ok(Buffer.byteLength(JSON.stringify(wire))<4096);assert.equal(wire.permission.currentEntriesEnabled,false);
});
