import type {NativeQualificationProof} from './native-paper.js';

const MAX_RETAINED_PROOFS=4;
type Task={proof:Readonly<NativeQualificationProof>;state:'pending'|'complete'|'failed';availableAt:number|null;error:string|null;invalidated:boolean;released:boolean};
const integer=(value:number)=>Number.isSafeInteger(value)&&value>=0;
const identityFields=['proofId','mint','startAt','windowEndAt','featuresSha256','certificateAt','deadlineAt']as const;
const sameCertificate=(a:NativeQualificationProof,b:NativeQualificationProof)=>identityFields.every(key=>a[key]===b[key]);

/** Bounded nonfinancial evidence retention. Four current certificates may be
 * retained, but only one asynchronous pin may run and there is no pin queue.
 * Re-selecting a certificate reuses its original immutable range; throughAt is
 * a caller sample, not a request to extend a completed proof. Current source
 * qualification and every financial admission gate remain caller-owned. */
export class NativePaperProofPreparation{
 private readonly tasks=new Map<string,Task>();
 private selectedProofId:string|null=null;
 constructor(private readonly now:()=>number=Date.now,private readonly releaseUnused?:(proofId:string)=>void){}
 private usableRequest(proof:NativeQualificationProof,at:number){
  return typeof proof.proofId==='string'&&proof.proofId.length>0&&typeof proof.mint==='string'&&proof.mint.length>0&&typeof proof.featuresSha256==='string'&&/^[a-f0-9]{64}$/.test(proof.featuresSha256)
   &&[at,proof.startAt,proof.windowEndAt,proof.certificateAt,proof.throughAt,proof.deadlineAt].every(integer)
   &&proof.startAt<=proof.windowEndAt&&proof.windowEndAt<=proof.certificateAt&&proof.certificateAt<=proof.throughAt&&proof.throughAt<=at&&at<=proof.deadlineAt;
 }
 private current(task:Task,at:number){return !task.invalidated&&integer(at)&&task.proof.throughAt<=at&&at<=task.proof.deadlineAt;}
 private retire(task:Task){
  if(!task.invalidated||task.released||task.state==='pending')return;
  try{this.releaseUnused?.(task.proof.proofId);task.released=true;}catch{/* Retry bounded cleanup; never change evidence or financial permission. */}
 }
 /** The optional predicate reads only the source's cached current certificate.
  * Invalid pending work retains physical ownership until its promise settles. */
 maintenance(isCurrent?:(proof:Readonly<NativeQualificationProof>)=>boolean){
  const at=this.now();
  for(const task of this.tasks.values()){
   if(!integer(at)||at<task.proof.throughAt||at>task.proof.deadlineAt)task.invalidated=true;
   if(!task.invalidated&&isCurrent){try{if(!isCurrent(task.proof))task.invalidated=true;}catch{task.invalidated=true;}}
   this.retire(task);
  }
 }
 prepare(proof:NativeQualificationProof,pin:(proof:NativeQualificationProof)=>Promise<void>){
  const at=this.now();if(!this.usableRequest(proof,at))return false;
  this.maintenance();
  const existing=this.tasks.get(proof.proofId);
  if(existing){if(!sameCertificate(existing.proof,proof)||proof.throughAt<existing.proof.throughAt)return false;this.selectedProofId=proof.proofId;return this.ready(proof);}
  // A second selection cannot replace or enqueue work behind a physical pin.
  if([...this.tasks.values()].some(task=>task.state==='pending'))return false;
  const previous=[...this.tasks.values()].filter(task=>task.proof.mint===proof.mint);
  if(previous.some(task=>task.proof.certificateAt>proof.certificateAt))return false;
  for(const task of previous){task.invalidated=true;this.retire(task);if(!task.released)return false;this.tasks.delete(task.proof.proofId);}
  // Keep bounded invalid identities until another certificate needs the slot,
  // so a later sample cannot reopen an expired/rejected task by changing its
  // deadline. Only obsolete released records may make room for a new mint.
  if(this.tasks.size>=MAX_RETAINED_PROOFS)for(const [id,task]of this.tasks){if(task.invalidated&&task.released){this.tasks.delete(id);break;}}
  if(this.tasks.size>=MAX_RETAINED_PROOFS)return false;
  const task:Task={proof:Object.freeze({...proof}),state:'pending',availableAt:null,error:null,invalidated:false,released:false};
  this.tasks.set(proof.proofId,task);this.selectedProofId=proof.proofId;
  const settled=(state:'complete'|'failed')=>{
   task.state=state;task.availableAt=this.now();if(state==='failed')task.error='qualification-proof-retention-unavailable';
   if(!this.current(task,task.availableAt))task.invalidated=true;
   this.retire(task);
  };
  void Promise.resolve().then(()=>{
   if(!this.current(task,this.now())){task.invalidated=true;throw Error('qualification-proof-retention-unavailable');}
   return pin(task.proof);
  }).then(()=>settled('complete'),()=>settled('failed'));
  return false;
 }
 ready(proof:NativeQualificationProof){
  const at=this.now(),task=this.tasks.get(proof.proofId);
  return !!task&&this.usableRequest(proof,at)&&sameCertificate(task.proof,proof)&&proof.throughAt>=task.proof.throughAt&&this.current(task,at)
   &&task.state==='complete'&&task.availableAt!==null&&task.availableAt>=task.proof.throughAt&&task.availableAt<=at;
 }
 usage(proof?:NativeQualificationProof){
  const at=this.now(),valid=[...this.tasks.values()].filter(task=>this.current(task,at));
  const task=proof?this.tasks.get(proof.proofId):valid.find(row=>row.state==='pending')??valid.find(row=>row.proof.proofId===this.selectedProofId)??valid.at(-1);
  if(!task||!this.current(task,at)||proof&&(!this.usableRequest(proof,at)||!sameCertificate(task.proof,proof)||proof.throughAt<task.proof.throughAt))return null;
  return {proofId:task.proof.proofId,mint:task.proof.mint,deadlineAt:task.proof.deadlineAt,state:task.state,availableAt:task.availableAt,error:task.error};
 }
 retainedMints(){const at=this.now();return [...new Set([...this.tasks.values()].filter(task=>this.current(task,at)).map(task=>task.proof.mint))];}
}
