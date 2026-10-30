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
