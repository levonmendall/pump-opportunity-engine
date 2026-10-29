export type NativePaperWork = 'idle'|'source'|'candidate'|'protection'|'pending';

/** Nested work can restore its caller only while it still owns the phase.
 * A timeout's outer transition invalidates late asynchronous restorations. */
export class NativePaperWorkState {
 private frame:{kind:NativePaperWork}={kind:'idle'};
 get current(){return this.frame.kind;}
 set(kind:NativePaperWork){this.frame={kind};}
 enter(kind:NativePaperWork){
  const previous=this.frame,owned={kind};this.frame=owned;
  return ()=>{if(this.frame!==owned)return false;this.frame=previous;return true;};
 }
}
