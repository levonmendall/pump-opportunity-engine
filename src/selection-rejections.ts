/** Bounded research-selection history; never a financial or provider-budget file. */
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync,type Stats} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {PublicKey} from '@solana/web3.js';

export type RejectionScope={mint:string;pool:string};
export type SelectionRejection={
  mint:string;pool:string;reason:string;observedAt:number;expiresAt:number|null;
  policyVersion:string;evidenceRef:string;
  releaseCondition:'cooldown-elapsed-and-fresh-revalidation'|'support-policy-version-change-and-fresh-revalidation';
};
export type TechnicalCapacityReassessment={
  kind:'technical-observation-capacity';reassessAt:number;recordedExpiresAt:number;
  releaseScope:'bounded-capacity-probe-only';predictiveRejection:false;entryPermission:false;
};
export type SelectionRejectionLookup={blocked:boolean;record:SelectionRejection|null;technicalCapacity?:TechnicalCapacityReassessment;releaseReason:'no-prior-rejection'|'cooldown-active'|'support-policy-unchanged'|'cooldown-expired-revalidate'|'support-policy-changed-revalidate'};
export type SelectionRejectionStore={lookup(scope:RejectionScope,at?:number):SelectionRejectionLookup;reject(scope:RejectionScope,reason:string,evidenceRef:string,at?:number):SelectionRejection};
const MAX_RECORDS=128,MAX_BYTES=64*1024;
const TECHNICAL_REASONS=new Set(['POOL_HISTORY_WINDOW_TRUNCATED_CAPACITY_UNKNOWN','SELECTED_ENRICHMENT_WOULD_EXCEED_RESERVED_CAPACITY']),CAPACITY_REASSESS_MS=30000,LEGACY_CAPACITY_MS=24*60*60*1000;
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function need(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
function text(value:unknown,max:number):value is string {return typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);}
function scopeValid(scope:RejectionScope){for(const key of [scope.mint,scope.pool]){need(text(key,44),'INVALID_REJECTION_SCOPE');try{need(new PublicKey(key).toBase58()===key,'INVALID_REJECTION_SCOPE');}catch{throw Error('INVALID_REJECTION_SCOPE');}}}
/** Global throttles/aborts/budget faults must never become per-pool cooldowns. */
export function isPoolRejection(reason:string){return /^[A-Z][A-Z0-9_]{0,96}(?::[A-Za-z][A-Za-z0-9_]{0,48})?$/.test(reason)&&!reason.startsWith('RESEARCH_')&&!reason.startsWith('PREFLIGHT_')&&!reason.startsWith('SELECTION_REJECTIONS_')&&!reason.startsWith('PILOT_RPC_')&&!reason.startsWith('COMPONENT_')&&reason!=='TRANSACTION_SIGNATURE_MISMATCH'&&reason!=='TRANSACTION_HISTORY_CONTEXT_MISMATCH';}
function expiry(reason:string,at:number):number|null {
  if(TECHNICAL_REASONS.has(reason))return at+CAPACITY_REASSESS_MS;
  if(reason==='INSUFFICIENT_RECENT_POOL_ACTIVITY'||reason==='FEWER_THAN_TWO_VERIFIED_RECENT_SWAP_TRANSACTIONS'||reason==='POOL_ACTIVITY_BASELINE_TOO_SHORT')return at+10*60*1000;
  if(reason==='POOL_HISTORY_HAS_UNKNOWN_BLOCK_TIME'||reason==='VERIFIED_POOL_ACTIVITY_IS_NO_LONGER_CURRENT'||reason==='VERIFIED_POOL_ACTIVITY_AGED_DURING_SUPPORT_CHECK'||reason==='SUPPORTED_QUOTE_STALE'||reason==='POOL_STATE_NOT_CURRENT_WITHIN_30_SECONDS'||reason==='MISSING_ACCOUNT'||reason==='MISSING_POOL_STATE'||reason==='POOL_LINKS_CHANGED')return at+60*1000;
  return null;
}

/** Legacy technical records remain immutable evidence. Only their current
 * reassessment gate is capped; expiry never proves capacity or entry safety. */
function effectiveExpiry(row:SelectionRejection):number|null {
  return TECHNICAL_REASONS.has(row.reason)?Math.min(row.expiresAt!,row.observedAt+CAPACITY_REASSESS_MS):row.expiresAt;
}
function technicalCapacity(row:SelectionRejection):TechnicalCapacityReassessment|undefined {
  return TECHNICAL_REASONS.has(row.reason)?{kind:'technical-observation-capacity',reassessAt:effectiveExpiry(row)!,recordedExpiresAt:row.expiresAt!,releaseScope:'bounded-capacity-probe-only',predictiveRejection:false,entryPermission:false}:undefined;
}

/** One standard flock lease, atomic replacement, fixed-size append history.
 * policyVersion identifies a reviewed SUPPORT/DECODER policy, not an attempt ID
 * or arbitrary source SHA. Expiry merely permits new checks; never admission.
 */
export class SelectionRejections implements SelectionRejectionStore {
  private readonly path:string;private readonly lease:number;private records:SelectionRejection[]=[];private closed=false;private failed=false;
  private readonly now:()=>number;
  constructor(private readonly options:{path:string;policyVersion:string;now?:()=>number}){
    need(text(options.policyVersion,96),'SELECTION_REJECTIONS_INVALID_POLICY');this.now=options.now??Date.now;this.path=resolve(options.path);
    const directory=lstatSync(dirname(this.path));need(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===process.getuid?.()&&(directory.mode&0o022)===0,'SELECTION_REJECTIONS_UNSAFE_DIRECTORY');
    this.lease=openSync(this.path+'.lock',constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try{
      const lock=fstatSync(this.lease);need(lock.isFile()&&lock.nlink===1&&lock.uid===process.getuid?.()&&(lock.mode&0o077)===0,'SELECTION_REJECTIONS_UNSAFE_LOCK');
      const result=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',this.lease],timeout:5000});need(!result.error&&result.status===0,'SELECTION_REJECTIONS_OWNED');
      let file:Stats|undefined;
      try{file=lstatSync(this.path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('SELECTION_REJECTIONS_UNREADABLE');}
      if(file){
        need(file.isFile()&&!file.isSymbolicLink()&&file.nlink===1&&file.uid===process.getuid?.()&&(file.mode&0o077)===0&&file.size<=MAX_BYTES,'SELECTION_REJECTIONS_UNSAFE_FILE');
        let body:any;try{body=JSON.parse(readFileSync(this.path,'utf8'));}catch{throw Error('SELECTION_REJECTIONS_CORRUPT');}
        need(body&&body.schemaVersion===1&&Object.keys(body).sort().join('|')==='records|schemaVersion'&&Array.isArray(body.records)&&body.records.length<=MAX_RECORDS,'SELECTION_REJECTIONS_CORRUPT');
        for(const row of body.records){this.validate(row);const prior=this.records.findLast(r=>r.mint===row.mint&&r.pool===row.pool);need(!prior||row.observedAt>=prior.observedAt,'SELECTION_REJECTIONS_CORRUPT');this.records.push(row);}
      }else this.persist([]);
    }catch(error){closeSync(this.lease);throw error;}
  }
  private validate(row:SelectionRejection){
    need(row&&Object.keys(row).sort().join('|')==='evidenceRef|expiresAt|mint|observedAt|policyVersion|pool|reason|releaseCondition','SELECTION_REJECTIONS_CORRUPT');
    try{scopeValid(row);}catch{throw Error('SELECTION_REJECTIONS_CORRUPT');}
    need(integer(row.observedAt)&&isPoolRejection(row.reason)&&text(row.evidenceRef,192)&&text(row.policyVersion,96),'SELECTION_REJECTIONS_CORRUPT');
    need(row.expiresAt===null?row.releaseCondition==='support-policy-version-change-and-fresh-revalidation':integer(row.expiresAt)&&row.expiresAt>row.observedAt&&(row.expiresAt===expiry(row.reason,row.observedAt)||TECHNICAL_REASONS.has(row.reason)&&row.expiresAt===row.observedAt+LEGACY_CAPACITY_MS)&&row.releaseCondition==='cooldown-elapsed-and-fresh-revalidation','SELECTION_REJECTIONS_CORRUPT');
    // A timed rejection must not be forged into a policy-change-only record.
    need((expiry(row.reason,row.observedAt)===null)===(row.expiresAt===null),'SELECTION_REJECTIONS_CORRUPT');
  }
  private ready(){need(!this.closed,'SELECTION_REJECTIONS_CLOSED');need(!this.failed,'SELECTION_REJECTIONS_UNAVAILABLE');}
  private persist(next:SelectionRejection[]){
    need(next.length<=MAX_RECORDS,'SELECTION_REJECTIONS_RECORD_CAP');
    const body=JSON.stringify({schemaVersion:1,records:next})+'\n';need(Buffer.byteLength(body)<=MAX_BYTES,'SELECTION_REJECTIONS_BYTE_CAP');
    const tmp=this.path+'.pending-'+process.pid;let fd:number|undefined,created=false;
    try{fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;writeFileSync(fd,body);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(tmp,this.path);created=false;const parent=openSync(dirname(this.path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}
    catch{this.failed=true;if(fd!==undefined)try{closeSync(fd);}catch{}if(created)try{unlinkSync(tmp);}catch{}throw Error('SELECTION_REJECTIONS_STORAGE_UNAVAILABLE');}
  }
  lookup(scope:RejectionScope,at=this.now()):SelectionRejectionLookup {
    this.ready();scopeValid(scope);need(integer(at),'SELECTION_REJECTIONS_INVALID_TIME');
    const matching=this.records.filter(r=>r.mint===scope.mint&&r.pool===scope.pool),latest=matching.at(-1);
    if(!latest)return {blocked:false,record:null,releaseReason:'no-prior-rejection'};
    need(at>=latest.observedAt,'SELECTION_REJECTIONS_CLOCK_REGRESSION');
    // A newer, shorter-lived refusal cannot erase an older active guard.
    const active=matching.findLast(r=>r.expiresAt!==null?at<effectiveExpiry(r)!:r.policyVersion===this.options.policyVersion),row=active??latest;
    if(row.expiresAt!==null){const blocked=at<effectiveExpiry(row)!,capacity=technicalCapacity(row);return {blocked,record:structuredClone(row),...(capacity?{technicalCapacity:capacity}:{}),releaseReason:blocked?'cooldown-active':'cooldown-expired-revalidate'};}
    const same=row.policyVersion===this.options.policyVersion;
    return {blocked:same,record:structuredClone(row),releaseReason:same?'support-policy-unchanged':'support-policy-changed-revalidate'};
  }
  reject(scope:RejectionScope,reason:string,evidenceRef:string,at=this.now()):SelectionRejection {
    this.ready();scopeValid(scope);need(integer(at)&&isPoolRejection(reason)&&text(evidenceRef,192),'SELECTION_REJECTIONS_INVALID_RECORD');
    const last=this.records.findLast(r=>r.mint===scope.mint&&r.pool===scope.pool);need(!last||at>=last.observedAt,'SELECTION_REJECTIONS_CLOCK_REGRESSION');
    const expiresAt=expiry(reason,at);need(expiresAt===null||integer(expiresAt),'SELECTION_REJECTIONS_INVALID_TIME');
    const row:SelectionRejection={mint:scope.mint,pool:scope.pool,reason,observedAt:at,expiresAt,policyVersion:this.options.policyVersion,evidenceRef,releaseCondition:expiresAt===null?'support-policy-version-change-and-fresh-revalidation':'cooldown-elapsed-and-fresh-revalidation'};
    this.persist([...this.records,row]);this.records.push(row);return structuredClone(row);
  }
  snapshot(){this.ready();return structuredClone(this.records);}
  close(){need(!this.closed,'SELECTION_REJECTIONS_CLOSED');this.closed=true;closeSync(this.lease);}
}
