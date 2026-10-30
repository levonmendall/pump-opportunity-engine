/** Cooperative protection between physical source operations. A candidate step
 * can contain several awaits, so main-loop priority alone is insufficient.
 * This never cancels an in-flight operation or renews a protection timestamp;
 * only the trader's existing completed-evaluation records can do that. */
export const NATIVE_PROTECTION_DISPATCH_POLICY=Object.freeze({version:'cooperative-owned-protection-between-source-operations-v1',candidateDeadlinesExtended:false,physicalPreemption:false,completedEvaluationRequired:true});
export class NativeProtectionDispatch {
 private active:Promise<void>|null=null;
 private readonly counts={yielded:0,failed:0,busyRefusals:0};
 constructor(private readonly options:{
  sourceWork:()=>boolean;owned:()=>boolean;runway:(boundMs:number)=>boolean;
  physicalIdle:()=>boolean;financialIdle:()=>boolean;protect:()=>Promise<void>;
  record:(kind:string,data:unknown)=>void;now?:()=>number;
 }){}
 async beforeSourceRead(boundMs:number){
  if(!this.options.sourceWork()||!this.options.owned()||this.options.runway(boundMs))return;
  if(this.active){await this.active;return;}
  if(!this.options.physicalIdle()||!this.options.financialIdle()){this.counts.busyRefusals++;return;}
  const at=(this.options.now??Date.now)();this.counts.yielded++;
  this.active=(async()=>{try{await this.options.protect();}
   catch{this.counts.failed++;}
   finally{this.options.record('native-paper-protection-dispatch-yield',{at,completedAt:(this.options.now??Date.now)(),operationBoundMs:boundMs,runwayRestored:this.options.runway(boundMs),protectionCompletionClaimed:false});}
  })();
  try{await this.active;}finally{this.active=null;}
 }
 usage(){return {policy:NATIVE_PROTECTION_DISPATCH_POLICY.version,...this.counts,active:this.active!==null,meaning:'Current-run source-operation yields, not completed protection evaluations'};}
}
