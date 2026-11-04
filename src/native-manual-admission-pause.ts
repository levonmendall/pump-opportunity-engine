import {constants,openSync,closeSync,lstatSync,fstatSync,readSync,realpathSync} from 'node:fs';
import type {Stats} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const MAXIMUM_BYTES=4096;
const FILE_NAME='manual-admission-pause.json';
const FAILURE_REASONS=['marker-path','marker-owner','marker-size','marker-changed','marker-json','marker-schema','marker-identity','marker-clock','marker-read'] as const;
type FailureReason=typeof FAILURE_REASONS[number];
export type NativeManualPauseObservation=
 |{state:'absent';observedAt:number}
 |{state:'present';observedAt:number;markerAt:number;markerSha256:string;markerKind:'owner'|'task'}
 |{state:'unavailable';observedAt:number;reason:FailureReason};
export type NativeManualPauseIdentity={directory:string;accountId:string;inceptionAt:number;ownerUid:number;ownerGid:number};

function requireMarker(value:unknown,reason:FailureReason):asserts value{if(!value)throw Error(reason);}
function stable(before:Stats,after:Stats){return before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&before.uid===after.uid&&before.gid===after.gid&&before.mode===after.mode&&before.nlink===after.nlink;}
/** A marker has only scalar fields. Scan JSON string tokens before decoding so
 * duplicate or escaped duplicate property names cannot hide an identity/time. */
function uniqueMarker(raw:string):unknown{
 const names=new Set<string>();
 for(let at=0;at<raw.length;at++){
  if(raw[at]!=='"')continue;
  const start=at++;
  while(at<raw.length){if(raw[at]==='\\'){at+=2;continue;}if(raw[at]==='"')break;at++;}
  requireMarker(at<raw.length,'marker-json');let next=at+1;while(/\s/.test(raw[next]??'')&&next<raw.length)next++;
  if(raw[next]!==':')continue;
  const name=JSON.parse(raw.slice(start,at+1));requireMarker(typeof name==='string'&&!names.has(name),'marker-json');names.add(name);
 }
 return JSON.parse(raw);
}

/** The only filesystem operation is a bounded read of the existing fixed
 * marker. Refusals inhibit entry; none mutates a marker, ledger or provider. */
export function readNativeManualAdmissionPause(input:NativeManualPauseIdentity,observedAt:number):NativeManualPauseObservation{
 try{
  requireMarker(Number.isSafeInteger(observedAt)&&observedAt>0,'marker-clock');
  requireMarker(resolve(input.directory)===input.directory,'marker-path');
  const parent=lstatSync(input.directory);
  requireMarker(parent.isDirectory()&&!parent.isSymbolicLink()&&realpathSync(input.directory)===input.directory,'marker-path');
  requireMarker(parent.uid===input.ownerUid&&parent.gid===input.ownerGid&&(parent.mode&0o777)===0o700,'marker-owner');
  const verifyParent=()=>{
   const current=lstatSync(input.directory);
   requireMarker(parent.dev===current.dev&&parent.ino===current.ino&&current.isDirectory()&&!current.isSymbolicLink()&&realpathSync(input.directory)===input.directory,'marker-path');
   requireMarker(current.uid===input.ownerUid&&current.gid===input.ownerGid&&(current.mode&0o777)===0o700,'marker-owner');
  };
  const path=join(input.directory,FILE_NAME);
  let named:Stats;
  try{named=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){verifyParent();return {state:'absent',observedAt};}throw error;}
  requireMarker(named.isFile()&&!named.isSymbolicLink(),'marker-path');
  requireMarker(named.uid===input.ownerUid&&named.gid===input.ownerGid&&named.nlink===1&&(named.mode&0o777)===0o600,'marker-owner');
  requireMarker(named.size>0&&named.size<=MAXIMUM_BYTES,'marker-size');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let raw:Buffer;
  try{
   requireMarker(stable(named,fstatSync(fd)),'marker-changed');
   const buffer=Buffer.alloc(named.size+1),bytes=readSync(fd,buffer,0,buffer.length,0);raw=buffer.subarray(0,bytes);
   requireMarker(bytes===named.size&&bytes<=MAXIMUM_BYTES,'marker-size');
   requireMarker(stable(named,fstatSync(fd))&&stable(named,lstatSync(path)),'marker-changed');
   verifyParent();
  }finally{closeSync(fd);}
  let marker:unknown;try{const text=raw.toString('utf8');requireMarker(Buffer.from(text,'utf8').equals(raw),'marker-json');marker=uniqueMarker(text);}catch{throw Error('marker-json');}
  requireMarker(!!marker&&typeof marker==='object'&&!Array.isArray(marker),'marker-schema');
  const value=marker as Record<string,unknown>,keys=Object.keys(value),task=Object.hasOwn(value,'authorizationId');
  const expected=['schemaVersion','accountId','inceptionAt','at','reason',...(task?['authorizationId']:[])];
  requireMarker(keys.length===expected.length&&keys.every(k=>expected.includes(k))&&value.schemaVersion===1&&typeof value.reason==='string'&&value.reason.length>0&&value.reason.length<=1024&&(!task||typeof value.authorizationId==='string'&&value.authorizationId.length>0&&value.authorizationId.length<=256),'marker-schema');
  requireMarker(value.accountId===input.accountId&&value.inceptionAt===input.inceptionAt,'marker-identity');
  requireMarker(Number.isSafeInteger(value.at)&&Number(value.at)>0&&Number(value.at)<=observedAt,'marker-clock');
  return {state:'present',observedAt,markerAt:value.at as number,markerSha256:createHash('sha256').update(raw).digest('hex'),markerKind:task?'task':'owner'};
 }catch(error){const reason=error instanceof Error&&FAILURE_REASONS.includes(error.message as FailureReason)?error.message as FailureReason:'marker-read';return {state:'unavailable',observedAt,reason};}
}

/** A valid pause/owner intent is sticky. A failed read is a separate temporary
 * entry inhibition; resolving it never certifies a previously unread marker. */
export class NativeManualAdmissionPause{
 private validMarkerLatched=false;
 private ownerIntentLatched=false;
 private observation:NativeManualPauseObservation|null=null;
 private lastVerifiedMarker:{firstObservedAt:number;markerAt:number;markerSha256:string;markerKind:'owner'|'task'}|null=null;
 private lastTransition:string|null=null;
 private transitions:Array<{observedAt:number;state:NativeManualPauseObservation['state'];reason:FailureReason|null;paused:boolean;validMarkerLatched:boolean;ownerIntentLatched:boolean;markerAt:number|null;markerSha256:string|null}>=[];
 private transitionCount=0;
 constructor(private readonly identity:NativeManualPauseIdentity){}
 ownerPauseRequested(){this.ownerIntentLatched=true;}
 /** Caller uses only the existing authorized resume after its identity check
  * and removal. This method performs no filesystem or financial operation. */
 ownerResumeAcknowledged(){this.validMarkerLatched=false;this.ownerIntentLatched=false;this.lastTransition=null;}
 entryReason(){return this.validMarkerLatched||this.ownerIntentLatched?'OWNER_PAUSE' as const:this.observation?.state==='unavailable'?'MANUAL_ADMISSION_MARKER_UNAVAILABLE' as const:null;}
 reconcile(at:number){
  const observation=readNativeManualAdmissionPause(this.identity,at);this.observation=observation;
  if(observation.state==='present'){
   this.validMarkerLatched=true;
   if(this.lastVerifiedMarker?.markerSha256!==observation.markerSha256)this.lastVerifiedMarker={firstObservedAt:at,markerAt:observation.markerAt,markerSha256:observation.markerSha256,markerKind:observation.markerKind};
  }
  const paused=this.validMarkerLatched||this.ownerIntentLatched||observation.state==='unavailable';
  const key=[observation.state,observation.state==='unavailable'?observation.reason:'',observation.state==='present'?observation.markerSha256:'',this.validMarkerLatched,this.ownerIntentLatched,paused].join(':');
  const changed=key!==this.lastTransition;this.lastTransition=key;
  if(changed){this.transitionCount++;this.transitions.push({observedAt:at,state:observation.state,reason:observation.state==='unavailable'?observation.reason:null,paused,validMarkerLatched:this.validMarkerLatched,ownerIntentLatched:this.ownerIntentLatched,markerAt:observation.state==='present'?observation.markerAt:null,markerSha256:observation.state==='present'?observation.markerSha256:null});if(this.transitions.length>8)this.transitions.shift();}
  return {paused,changed,observation:{...observation}};
 }
 usage(){return {policy:'native-manual-admission-marker-v1' as const,paused:this.validMarkerLatched||this.ownerIntentLatched||this.observation?.state==='unavailable',validMarkerLatched:this.validMarkerLatched,ownerIntentLatched:this.ownerIntentLatched,observation:this.observation?{...this.observation}:null,lastVerifiedMarker:this.lastVerifiedMarker?{...this.lastVerifiedMarker}:null,transitionCount:this.transitionCount,recentTransitions:this.transitions.map(row=>({...row}))};}
}
