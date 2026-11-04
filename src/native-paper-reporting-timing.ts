/** Fixed, bounded synchronous report timings. These measurements never change
 * financial permission or replace the original source/quote timestamps. */
export const NATIVE_PAPER_REPORT_PHASES=['candidate-status','cash-maintenance','financial-snapshot','observation-projection','financial-history','financial-trades','financial-portfolio','publication-checkpoint'] as const;
export type NativePaperReportPhase=typeof NATIVE_PAPER_REPORT_PHASES[number];
export type NativePaperReportPhaseTiming={stage:NativePaperReportPhase;count:number;totalMs:number;lastMs:number;maximumMs:number};
export const NATIVE_COMPLETED_PUBLICATION_TIMING_VERSION='native-completed-publication-timing-v1' as const;
export type NativeCompletedPublicationTiming={
 version:typeof NATIVE_COMPLETED_PUBLICATION_TIMING_VERSION;startedAt:number;completedAt:number;durationMs:number;
 phases:readonly Readonly<{stage:NativePaperReportPhase;count:number;elapsedMs:number|null}>[];
};
/** Capture a completed report's phase deltas only after its whole publication
 * has returned. The next ordinary status can carry this immutable record with
 * its original clocks, separately from cumulative phase samples that already
 * include work from the next report. Missing phases are unknown, never an old
 * lastMs or an invented zero. This diagnostic supplies no admission decision. */
export function nativePaperCompletedPublicationTiming(input:{startedAt:number;completedAt:number;durationMs:number;before:readonly NativePaperReportPhaseTiming[];after:readonly NativePaperReportPhaseTiming[];timingAvailable:boolean}):NativeCompletedPublicationTiming|null {
 const whole=(n:number)=>Number.isSafeInteger(n)&&n>=0,finite=(n:number)=>Number.isFinite(n)&&n>=0;
 if(input.timingAvailable!==true||!whole(input.startedAt)||!whole(input.completedAt)||input.completedAt<input.startedAt||!finite(input.durationMs))return null;
 const phases=(rows:readonly NativePaperReportPhaseTiming[])=>{
  if(!Array.isArray(rows)||rows.length>NATIVE_PAPER_REPORT_PHASES.length)return null;
  const result=new Map<NativePaperReportPhase,NativePaperReportPhaseTiming>();
  for(const row of rows){if(!row||!NATIVE_PAPER_REPORT_PHASES.includes(row.stage)||result.has(row.stage)||!whole(row.count)||row.count===0||![row.totalMs,row.lastMs,row.maximumMs].every(finite)||row.lastMs>row.maximumMs||row.maximumMs>row.totalMs)return null;result.set(row.stage,row);}
  return result;
 };
 const before=phases(input.before),after=phases(input.after);if(!before||!after)return null;
 const measured:NativeCompletedPublicationTiming['phases'][number][]=[];
 for(const stage of NATIVE_PAPER_REPORT_PHASES){
  const prior=before.get(stage),current=after.get(stage),count=(current?.count??0)-(prior?.count??0),elapsed=(current?.totalMs??0)-(prior?.totalMs??0);
  if(!whole(count)||!finite(elapsed)||count===0&&elapsed!==0)return null;
  measured.push(Object.freeze({stage,count,elapsedMs:count===0?null:elapsed}));
 }
 return Object.freeze({version:NATIVE_COMPLETED_PUBLICATION_TIMING_VERSION,startedAt:input.startedAt,completedAt:input.completedAt,durationMs:input.durationMs,phases:Object.freeze(measured)});
}
export const NATIVE_PAPER_REPORT_ADMISSION_RESERVE_MS=250;
/** An observed work estimate for admission, never a promised completion time.
 * Retain the 250ms performance target, add the existing local reserve, and
 * respect the source scheduler's existing 10s maximum discretionary bound.
 * Phase maxima bootstrap admission until a complete scheduled report has been
 * measured. They can come from different reports, including startup, so their
 * sum must not replace an available whole-report maximum. Lifetime phase
 * diagnostics remain unchanged. A genuinely oversized whole report still
 * fails closed; this estimate never clips work to fit a deadline. */
export function nativePaperReportAdmissionBound(input:{maximumCompletedMs:number;hasCompletedReport:boolean;phases:readonly NativePaperReportPhaseTiming[];timingAvailable:boolean}):number|null {
 if(input.timingAvailable!==true||typeof input.hasCompletedReport!=='boolean'||!Number.isFinite(input.maximumCompletedMs)||input.maximumCompletedMs<0||!input.hasCompletedReport&&input.maximumCompletedMs!==0||!Array.isArray(input.phases)||input.phases.length>NATIVE_PAPER_REPORT_PHASES.length)return null;
 let phaseMaximumMs=0;const seen=new Set<string>();
 for(const phase of input.phases){if(!phase||!(NATIVE_PAPER_REPORT_PHASES as readonly string[]).includes(phase.stage)||seen.has(phase.stage)||!Number.isFinite(phase.maximumMs)||phase.maximumMs<0||!Number.isSafeInteger(phase.count)||phase.count<=0)return null;seen.add(phase.stage);phaseMaximumMs+=phase.maximumMs;}
 if(!Number.isFinite(phaseMaximumMs))return null;
 const observed=input.hasCompletedReport?input.maximumCompletedMs:phaseMaximumMs;
 const estimate=Math.max(250,Math.ceil(observed)),bound=estimate+NATIVE_PAPER_REPORT_ADMISSION_RESERVE_MS;
 return Number.isSafeInteger(bound)&&bound>0&&bound<=10000?bound:null;
}
export class NativePaperReportTimings {
 private readonly stages=new Map<NativePaperReportPhase,NativePaperReportPhaseTiming>();
 private measurementAvailable=true;
 constructor(private readonly monotonic:()=>number=()=>performance.now()){}
 measure<T>(stage:NativePaperReportPhase,operation:()=>T):T {
  const clock=()=>{try{const at=this.monotonic();return Number.isFinite(at)&&at>=0?at:null;}catch{return null;}},began=clock();
  try{return operation();}
  finally {
   const completed=clock(),elapsed=began===null||completed===null?NaN:completed-began;
   // Optional telemetry must not turn a successfully completed financial
   // publication into a failure if the measurement clock is unavailable.
   if(Number.isFinite(elapsed)&&elapsed>=0){const row=this.stages.get(stage)??{stage,count:0,totalMs:0,lastMs:0,maximumMs:0};row.count++;row.totalMs+=elapsed;row.lastMs=elapsed;row.maximumMs=Math.max(row.maximumMs,elapsed);this.stages.set(stage,row);}else this.measurementAvailable=false;
  }
 }
 get timingAvailable(){return this.measurementAvailable;}
 usage(){return NATIVE_PAPER_REPORT_PHASES.flatMap(stage=>{const row=this.stages.get(stage);return row?[{...row}]:[];});}
}
/** Candidate summaries may perform large read-only registry queries. Finish
 * them before the real cash checkpoint and authoritative financial sample so
 * their work cannot consume the financial snapshot's reconciliation runway.
 * Held/pending ownership and all hard controls remain with maintainCash. */
export function nativePaperReportingSample<C,F>(input:{candidateStatus:()=>C;maintainCash:()=>void;financialSnapshot:(at:number)=>F;timings:NativePaperReportTimings;now?:()=>number}):{candidate:C;at:number;financial:F} {
 const candidate=input.timings.measure('candidate-status',input.candidateStatus);
 input.timings.measure('cash-maintenance',input.maintainCash);
 const at=(input.now??Date.now)();
 return {candidate,at,financial:input.timings.measure('financial-snapshot',()=>input.financialSnapshot(at))};
}
