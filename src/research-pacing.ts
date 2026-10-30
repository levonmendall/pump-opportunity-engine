/** Selection-only pacing. No endpoint selection, retries or financial state.
 * All provider accounting and the physical request slot remain in ResearchRpc.
 * Phase wrappers share ONE instance; another owning process is excluded by flock.
 */
import {spawnSync} from 'node:child_process';
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import type {CountedReadRpc} from './research-phase.js';

export type PacingSource=CountedReadRpc&{usage():{blockedReason:string|null;nextStartAfterMs:number;storageFailed?:boolean;closed?:boolean}};
export type SelectionPacingOptions={statePath:string;minimumStartSpacingMs?:number;now?:()=>number;monotonic?:()=>number;sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>};
type State={schemaVersion:1;minimumStartSpacingMs:number;lastObservedAt:number;lastStartedAt:number|null;lastSettledAt:number|null;haltedReason:null|'RPC_HTTP_429'|'RPC_ERROR_-32005'};
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function pause(ms:number,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)return Promise.reject(Error('RESEARCH_PACING_ABORTED'));
  return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('RESEARCH_PACING_ABORTED'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});
}

export class SelectionPacedRpc {
  private readonly path:string;private readonly lease:number;private readonly now:()=>number;private readonly mono:()=>number;private readonly sleep:(ms:number,signal?:AbortSignal)=>Promise<void>;
  private lastStartMono:number|null=null;private lastSettledMono:number|null=null;private readonly restartMono:number;private readonly resumed:boolean;
  private state:State;private busy=false;private closed=false;private storageFailed=false;private waitedMs=0;private unknownSettlement=false;
  constructor(private readonly rpc:PacingSource,options:SelectionPacingOptions){
    this.path=resolve(options.statePath);this.now=options.now??Date.now;this.mono=options.monotonic??(()=>performance.now());this.sleep=options.sleep??pause;this.restartMono=this.monotonic();
    const spacing=options.minimumStartSpacingMs??1000;
    need(integer(spacing)&&spacing>=1000&&spacing<=5000,'RESEARCH_PACING_INVALID_SPACING');
    const dir=lstatSync(dirname(this.path));need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid?.()&&(dir.mode&0o022)===0,'RESEARCH_PACING_UNSAFE_DIRECTORY');
    this.lease=openSync(this.path+'.lock',constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try{
      const lock=fstatSync(this.lease);need(lock.isFile()&&lock.nlink===1&&lock.uid===process.getuid?.()&&(lock.mode&0o077)===0,'RESEARCH_PACING_UNSAFE_LOCK');
      const owned=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',this.lease],timeout:5000});need(!owned.error&&owned.status===0,'RESEARCH_PACING_STATE_OWNED');
      let saved:State|undefined;
      try{const file=lstatSync(this.path);need(file.isFile()&&!file.isSymbolicLink()&&file.nlink===1&&file.uid===process.getuid?.()&&(file.mode&0o077)===0&&file.size<=4096,'RESEARCH_PACING_UNSAFE_STATE');saved=JSON.parse(readFileSync(this.path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const at=this.now();need(integer(at),'RESEARCH_PACING_CLOCK');
      this.state=saved??{schemaVersion:1,minimumStartSpacingMs:spacing,lastObservedAt:at,lastStartedAt:null,lastSettledAt:null,haltedReason:null};
      const s=this.state;need(s?.schemaVersion===1&&s.minimumStartSpacingMs===spacing&&integer(s.lastObservedAt)&&(s.lastStartedAt===null||integer(s.lastStartedAt))&&(s.lastSettledAt===null||integer(s.lastSettledAt))&&(s.haltedReason===null||s.haltedReason==='RPC_HTTP_429'||s.haltedReason==='RPC_ERROR_-32005'),'RESEARCH_PACING_INVALID_STATE');
      need((s.lastStartedAt===null||s.lastStartedAt<=s.lastObservedAt)&&(s.lastSettledAt===null||s.lastSettledAt<=s.lastObservedAt),'RESEARCH_PACING_INVALID_STATE');
      this.resumed=this.state.lastStartedAt!==null;this.clock();if(!saved)this.persist();
    }catch(e){closeSync(this.lease);throw e;}
  }
  get calls(){return this.rpc.calls;}get bytes(){return this.rpc.bytes;}get inFlight(){return this.rpc.inFlight;}
  private clock(){const at=this.now();need(integer(at)&&at>=this.state.lastObservedAt,'RESEARCH_PACING_CLOCK_REGRESSION');this.state.lastObservedAt=at;return at;}
  private monotonic(){const at=this.mono();need(Number.isFinite(at)&&at>=0,'RESEARCH_PACING_MONOTONIC_CLOCK');return at;}
  private persist(){
    const tmp=this.path+'.pending-'+process.pid;let fd:number|undefined,created=false;
    try{fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;writeFileSync(fd,JSON.stringify(this.state)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(tmp,this.path);created=false;const parent=openSync(dirname(this.path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}
    catch{this.storageFailed=true;if(fd!==undefined)try{closeSync(fd);}catch{}if(created)try{unlinkSync(tmp);}catch{}throw Error('RESEARCH_PACING_STORAGE_UNAVAILABLE');}
  }
  private source(){
    need(!this.closed,'RESEARCH_PACING_CLOSED');need(!this.storageFailed,'RESEARCH_PACING_STORAGE_UNAVAILABLE');
    const usage=this.rpc.usage();need(!this.state.haltedReason&&!usage.blockedReason,'RESEARCH_PACING_PROVIDER_HALTED');need(!usage.closed&&!usage.storageFailed,'RESEARCH_PACING_SOURCE_UNAVAILABLE');need(this.rpc.inFlight===0,'RESEARCH_PACING_PHYSICAL_SLOT_OCCUPIED');
    // A caller-facing abort may return before the physical request settles.
    // The first later dispatcher observation of an empty slot starts a fresh
    // full cooldown; the old dispatch time must not permit an immediate start.
    if(this.unknownSettlement){this.state.lastSettledAt=this.clock();this.lastSettledMono=this.monotonic();this.persist();this.unknownSettlement=false;}
    need(Number.isFinite(usage.nextStartAfterMs)&&usage.nextStartAfterMs>=0,'RESEARCH_PACING_INVALID_SOURCE_DELAY');return usage;
  }
  usage(){return {...this.rpc.usage(),pacing:{...this.state,waitingOrDispatching:this.busy,waitedMs:this.waitedMs,closed:this.closed,storageFailed:this.storageFailed}};}
  async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal):Promise<T>{
    need(!this.busy,'RESEARCH_PACING_DISPATCH_BUSY');if(signal?.aborted)throw Error('RESEARCH_PACING_ABORTED');this.source();this.busy=true;
    try{
      // No queue: the sole caller-owned dispatcher waits before starting. The
      // underlying client still enforces its rolling ceilings and exact budget.
      for(;;){
        if(signal?.aborted)throw Error('RESEARCH_PACING_ABORTED');const usage=this.source(),now=this.clock();
        // Also leave the spacing after observed settlement. This conservative
        // selection-only cooldown avoids fsync/dispatch jitter shrinking the
        // actual transport-start gap; it does not slow position protection.
        const mono=this.monotonic(),origin=this.lastSettledMono??this.lastStartMono??(this.resumed?this.restartMono:null);
        const wallOrigin=this.state.lastStartedAt===null?null:Math.max(this.state.lastStartedAt,this.state.lastSettledAt??0);
        const gap=wallOrigin===null?0:Math.max(0,wallOrigin+this.state.minimumStartSpacingMs-now),monotonicGap=origin===null?0:Math.max(0,origin+this.state.minimumStartSpacingMs-mono),wait=Math.ceil(Math.max(gap,monotonicGap,usage.nextStartAfterMs));
        if(!wait)break;await this.sleep(wait,signal);const after=this.monotonic();this.clock();this.waitedMs+=Math.max(0,after-mono);if(after<=mono&&!signal?.aborted)throw Error('RESEARCH_PACING_CLOCK_DID_NOT_ADVANCE');
      }
      if(signal?.aborted)throw Error('RESEARCH_PACING_ABORTED');this.source();
      // Persist BEFORE calling transport. A crash can consume spacing but never
      // resets it into a new burst. Provider counters exist only in ResearchRpc.
      this.state.lastStartedAt=this.clock();this.lastStartMono=this.monotonic();this.persist();
      try{return await this.rpc.call<T>(method,params,signal);}
      catch(e){const message=e instanceof Error?e.message:'';if(message==='RESEARCH_RPC_HTTP_429'||message==='RESEARCH_RPC_ERROR_-32005'){this.state.haltedReason=message==='RESEARCH_RPC_HTTP_429'?'RPC_HTTP_429':'RPC_ERROR_-32005';this.clock();this.persist();}throw e;}
      finally{if(this.rpc.inFlight===0){this.state.lastSettledAt=this.clock();this.lastSettledMono=this.monotonic();this.persist();}else this.unknownSettlement=true;}
    }finally{this.busy=false;}
  }
  close(){need(!this.closed,'RESEARCH_PACING_CLOSED');need(!this.busy&&this.rpc.inFlight===0,'RESEARCH_PACING_PHYSICAL_SLOT_OCCUPIED');this.closed=true;closeSync(this.lease);}
}
