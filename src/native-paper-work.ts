import {performance} from 'node:perf_hooks';

export type NativePaperWork = 'idle'|'source'|'candidate'|'protection'|'pending';
type WorkFrame={kind:NativePaperWork;parent:WorkFrame|null;retired:boolean};

/** Nested work can restore its caller only while it still owns the phase.
 * A timeout's outer transition invalidates late asynchronous restorations. */
export class NativePaperWorkState {
 private frame:WorkFrame={kind:'idle',parent:null,retired:false};
 get current(){return this.frame.kind;}
 set(kind:NativePaperWork){this.frame={kind,parent:null,retired:false};}
 enter(kind:NativePaperWork){
  const owned:WorkFrame={kind,parent:this.frame,retired:false};this.frame=owned;
  return ()=>{
   if(owned.retired)return false;owned.retired=true;
   if(this.frame!==owned)return false;
   let previous=owned.parent;while(previous?.retired)previous=previous.parent;
   this.frame=previous??{kind:'idle',parent:null,retired:false};return true;
  };
 }
}

export const NATIVE_PAPER_SOURCE_WORK_QUANTUM_MS=125;
/** A fulfilled Promise is only a microtask, so a sequence of otherwise async
 * candidate phases can keep the cash timer and socket callbacks waiting. Give
 * them a real event-loop turn between completed local phases. This is not a
 * timeout or an admission grant: one synchronous operation can still overrun,
 * and callers must recheck their original deadlines after the yield.
 * The supplied cash operation retains sole authority over flat/owned work,
 * its one-second pacing, actual reconciliation time and financial failures. */
export class NativePaperSourceWork {
 private readonly monotonic:()=>number;
 private lastYieldAt:number;
 constructor(private readonly options:{maintainCash:(boundMs:number)=>void;monotonic?:()=>number;yield?:()=>Promise<void>}){
  this.monotonic=options.monotonic??(()=>performance.now());this.lastYieldAt=this.monotonic();
 }
 async checkpoint(beforeStep=false){
  const due=this.monotonic()-this.lastYieldAt>=NATIVE_PAPER_SOURCE_WORK_QUANTUM_MS;
  if(beforeStep||due)this.options.maintainCash(NATIVE_PAPER_SOURCE_WORK_QUANTUM_MS);
  if(!due)return;
  await (this.options.yield?.()??new Promise<void>(resolve=>setTimeout(resolve,0)));
  this.lastYieldAt=this.monotonic();
  this.options.maintainCash(NATIVE_PAPER_SOURCE_WORK_QUANTUM_MS);
 }
}
