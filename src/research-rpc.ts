/** One isolated approved test budget. This does not change the production client. */
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {validateRpc} from './network.js';

export const RESEARCH_RPC_LIMITS=Object.freeze({budgetId:'active-approved-20261027',endpoint:'https://api.mainnet.solana.com',calls:240,responseBytes:64*1024*1024,singleResponseBytes:2*1024*1024,inFlightHeadroomBytes:2*1024*1024,startsPerMinute:150,startsPer10Seconds:30,timeoutMs:12_000});
type Budget={schemaVersion:1;budgetId:typeof RESEARCH_RPC_LIMITS.budgetId;calls:number;bytes:number;lastObservedAt:number;starts:number[];byMethod:Record<string,number>;pending:Array<{id:number;unobservedBytes:number}>;durationsMs:number[];blockedReason:string|null};
export type ResearchRpcOptions={budgetPath:string;transport?:typeof fetch;now?:()=>number;monotonic?:()=>number;timeoutMs?:number};
function need(value:unknown,code:string):asserts value {if(!value)throw Error(code);}
const safeInteger=(n:unknown,max=Number.MAX_SAFE_INTEGER):n is number=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;

/** No internal request queue/retry. A caller-owned dispatcher serializes complete
 * pricing/enrichment jobs. The physical slot stays occupied if cancellation is
 * ignored; uncertain response reservations also survive process restart. */
export class ResearchRpc {
  private readonly path:string;private readonly transport:typeof fetch;private readonly now:()=>number;private readonly mono:()=>number;private readonly timeout:number;
  private readonly lease:number;private state:Budget;private active=0;private closed=false;private storageFailed=false;
  constructor(options:ResearchRpcOptions){
    this.path=resolve(options.budgetPath);this.transport=options.transport??fetch;this.now=options.now??Date.now;this.mono=options.monotonic??(()=>performance.now());this.timeout=options.timeoutMs??RESEARCH_RPC_LIMITS.timeoutMs;
    need(safeInteger(this.timeout,RESEARCH_RPC_LIMITS.timeoutMs)&&this.timeout>0,'RESEARCH_RPC_INVALID_TIMEOUT');
    const directory=lstatSync(dirname(this.path));need(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.uid===process.getuid?.()&&(directory.mode&0o022)===0,'RESEARCH_RPC_UNSAFE_DIRECTORY');
    this.lease=openSync(this.path+'.lock',constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
    try{
      const lock=fstatSync(this.lease);need(lock.isFile()&&lock.nlink===1&&lock.uid===process.getuid?.()&&(lock.mode&0o077)===0,'RESEARCH_RPC_UNSAFE_LOCK');
      const lease=spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',this.lease],timeout:5000});
      need(!lease.error&&lease.status===0,'RESEARCH_RPC_BUDGET_OWNED');
      let existing:Budget|undefined;
      try{const file=lstatSync(this.path);need(file.isFile()&&!file.isSymbolicLink()&&file.nlink===1&&file.uid===process.getuid?.()&&(file.mode&0o077)===0&&file.size<=65_536,'RESEARCH_RPC_UNSAFE_BUDGET');existing=JSON.parse(readFileSync(this.path,'utf8'));}
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      this.state=existing??{schemaVersion:1,budgetId:RESEARCH_RPC_LIMITS.budgetId,calls:0,bytes:0,lastObservedAt:this.now(),starts:[],byMethod:{},pending:[],durationsMs:[],blockedReason:null};
      this.validate();this.clock();if(!existing)this.persist();
    }catch(error){closeSync(this.lease);throw error;}
  }
  get calls(){return this.state.calls;}
  get bytes(){return this.state.bytes;}
  get inFlight(){return this.active;}
  get durationsMs(){return [...this.state.durationsMs];}
  private validate(){
    const s=this.state,L=RESEARCH_RPC_LIMITS;
    need(s&&s.schemaVersion===1&&s.budgetId===L.budgetId&&safeInteger(s.calls,L.calls)&&safeInteger(s.bytes,L.responseBytes)&&safeInteger(s.lastObservedAt),'RESEARCH_RPC_INVALID_BUDGET');
    need(Array.isArray(s.starts)&&s.starts.length===s.calls&&s.starts.every((n,i)=>safeInteger(n)&&n<=s.lastObservedAt&&(i===0||n>=s.starts[i-1]!)),'RESEARCH_RPC_INVALID_STARTS');
    need(s.byMethod&&typeof s.byMethod==='object'&&!Array.isArray(s.byMethod)&&Object.keys(s.byMethod).length<=7,'RESEARCH_RPC_INVALID_METHODS');
    let sum=0;for(const [method,count] of Object.entries(s.byMethod)){validateRpc({method});need(safeInteger(count,L.calls),'RESEARCH_RPC_INVALID_METHODS');sum+=count;}need(sum===s.calls,'RESEARCH_RPC_INVALID_METHODS');
    need(Array.isArray(s.pending)&&s.pending.length<=s.calls&&s.pending.every((p,i)=>p&&safeInteger(p.id,s.calls)&&p.id>0&&safeInteger(p.unobservedBytes,L.singleResponseBytes)&&s.pending.findIndex(q=>q.id===p.id)===i),'RESEARCH_RPC_INVALID_PENDING');
    need(s.bytes+s.pending.reduce((n,p)=>n+p.unobservedBytes,0)<=L.responseBytes,'RESEARCH_RPC_INVALID_RESERVED_BYTES');
    need(Array.isArray(s.durationsMs)&&s.durationsMs.length<=128&&s.durationsMs.every(n=>Number.isFinite(n)&&n>=0)&&s.durationsMs.length<=s.calls,'RESEARCH_RPC_INVALID_DURATIONS');
    need(s.blockedReason===null||s.blockedReason==='RPC_HTTP_429'||s.blockedReason==='RPC_ERROR_-32005','RESEARCH_RPC_INVALID_BLOCK');
  }
  private clock(){const at=this.now();need(safeInteger(at)&&at>=this.state.lastObservedAt,'RESEARCH_RPC_CLOCK_REGRESSION');this.state.lastObservedAt=at;return at;}
  private persist(){
    const path=this.path+'.pending-'+process.pid;let created=false,fd:number|undefined;
    try{const body=JSON.stringify(this.state)+'\n';need(Buffer.byteLength(body)<=65_536,'RESEARCH_RPC_BUDGET_SIZE');fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;writeFileSync(fd,body);fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(path,this.path);created=false;const parent=openSync(dirname(this.path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}
    catch{this.storageFailed=true;if(fd!==undefined)try{closeSync(fd);}catch{}if(created)try{unlinkSync(path);}catch{}throw Error('RESEARCH_RPC_STORAGE_UNAVAILABLE');}
  }
  usage(){
    const now=this.clock(),L=RESEARCH_RPC_LIMITS,short=this.state.starts.filter(t=>t>now-10_000),minute=this.state.starts.filter(t=>t>now-60_000),reserved=this.state.pending.reduce((n,p)=>n+p.unobservedBytes,0);
    const next=Math.max(now,short.length>=L.startsPer10Seconds?short[short.length-L.startsPer10Seconds]!+10_000:now,minute.length>=L.startsPerMinute?minute[minute.length-L.startsPerMinute]!+60_000:now);
    return {budgetId:L.budgetId,endpoint:L.endpoint,calls:this.calls,bytes:this.bytes,uncertainResponseBytes:reserved,remainingCalls:L.calls-this.calls,remainingResponseBytes:Math.max(0,L.responseBytes-this.bytes-reserved),byMethod:{...this.state.byMethod},inFlight:this.active,rolling10SecondStarts:short.length,rollingMinuteStarts:minute.length,nextStartAfterMs:Math.max(0,next-now),durationsMs:[...this.state.durationsMs],blockedReason:this.state.blockedReason,storageFailed:this.storageFailed,closed:this.closed};
  }
  async call<T>(method:string,params:unknown[]=[],outer?:AbortSignal):Promise<T>{
    validateRpc({method});need(!this.closed,'RESEARCH_RPC_CLOSED');need(!this.storageFailed,'RESEARCH_RPC_STORAGE_UNAVAILABLE');if(outer?.aborted)throw Error('RESEARCH_RPC_ABORTED');
    const at=this.clock(),usage=this.usage(),L=RESEARCH_RPC_LIMITS;
    need(!this.state.blockedReason,'RESEARCH_RPC_PROVIDER_BLOCKED');need(this.active===0,'RESEARCH_RPC_IN_FLIGHT_CAP');need(this.calls<L.calls,'RESEARCH_RPC_CALL_CAP');
    need(usage.rolling10SecondStarts<L.startsPer10Seconds,'RESEARCH_RPC_10S_CAP');need(usage.rollingMinuteStarts<L.startsPerMinute,'RESEARCH_RPC_60S_CAP');
    // Besides the2MiB response reservation, leave2MiB for final read/cancel
    // granularity. Unknown earlier responses keep their unspent reservation.
    need(usage.remainingResponseBytes>=L.singleResponseBytes+L.inFlightHeadroomBytes,'RESEARCH_RPC_RESPONSE_BUDGET');
    const id=this.calls+1,body=JSON.stringify({jsonrpc:'2.0',id,method,params});need(Buffer.byteLength(body)<=64_000,'RESEARCH_RPC_REQUEST_SIZE');
    this.state.calls++;this.state.starts.push(at);this.state.byMethod[method]=(this.state.byMethod[method]??0)+1;
    const pending={id,unobservedBytes:L.singleResponseBytes};this.state.pending.push(pending);this.persist();this.active++;
    const began=this.mono(),controller=new AbortController(),signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;
    let timer:ReturnType<typeof setTimeout>|undefined,abortListener:(()=>void)|undefined,complete=false;
    const operation=(async()=>{
      const res=await this.transport(L.endpoint,{method:'POST',headers:{'content-type':'application/json'},body,signal,redirect:'error'});
      if(signal.aborted){await res.body?.cancel().catch(()=>{});throw Error('RESEARCH_RPC_ABORTED');}
      if(res.status===429){this.state.blockedReason='RPC_HTTP_429';this.persist();}
      if(Number(res.headers.get('content-length'))>L.singleResponseBytes){await res.body?.cancel().catch(()=>{});throw Error('RESEARCH_RPC_RESPONSE_SIZE');}
      const reader=res.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
      if(!reader)complete=true;
      else{
        let cancelPromise:Promise<void>|undefined;
        const cancel=()=>cancelPromise??=reader.cancel().catch(()=>{});signal.addEventListener('abort',cancel,{once:true});
        try{for(;;){if(signal.aborted)throw Error('RESEARCH_RPC_ABORTED');const {done,value}=await reader.read();if(done){complete=!signal.aborted;break;}size+=value.byteLength;this.state.bytes+=value.byteLength;pending.unobservedBytes=Math.max(0,L.singleResponseBytes-size);this.persist();
          if(size>L.singleResponseBytes||this.bytes>L.responseBytes){await cancel();throw Error('RESEARCH_RPC_RESPONSE_SIZE');}if(signal.aborted)throw Error('RESEARCH_RPC_ABORTED');chunks.push(value);}}
        finally{signal.removeEventListener('abort',cancel);if(signal.aborted)cancel();if(cancelPromise)await cancelPromise;reader.releaseLock();}
      }
      if(signal.aborted)throw Error('RESEARCH_RPC_ABORTED');
      if(!res.ok)throw Error('RESEARCH_RPC_HTTP_'+res.status);
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      need(data&&data.jsonrpc==='2.0'&&data.id===id&&(('result'in data)||data.error),'RESEARCH_RPC_INVALID_ENVELOPE');
      if(data.error){need(Number.isSafeInteger(data.error.code),'RESEARCH_RPC_INVALID_ENVELOPE');if(data.error.code===-32005){this.state.blockedReason='RPC_ERROR_-32005';this.persist();}throw Error('RESEARCH_RPC_ERROR_'+data.error.code);}
      return data.result as T;
    })().catch((e:unknown)=>{
      const message=e instanceof Error?e.message:'';
      if(/^RESEARCH_RPC_(ABORTED|STORAGE_UNAVAILABLE|RESPONSE_SIZE|HTTP_\d{3}|ERROR_-?\d{1,16}|INVALID_ENVELOPE)$/.test(message))throw Error(message);
      throw Error(signal.aborted?'RESEARCH_RPC_ABORTED':'RESEARCH_RPC_TRANSPORT_OR_RESPONSE_UNAVAILABLE');
    }).finally(()=>{
      this.active--;if(complete)this.state.pending=this.state.pending.filter(p=>p.id!==id);
      const elapsed=Math.max(0,this.mono()-began);this.state.durationsMs.push(Number.isFinite(elapsed)?elapsed:0);if(this.state.durationsMs.length>128)this.state.durationsMs.shift();this.persist();
    });
    // Physical capacity is released only by operation.finally, never by the
    // caller-facing timeout/abort race. A stalled cancellation retains it.
    try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{abortListener=()=>reject(Error('RESEARCH_RPC_ABORTED'));signal.addEventListener('abort',abortListener,{once:true});timer=setTimeout(()=>controller.abort(),this.timeout);if(signal.aborted)abortListener();})]);}
    finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener);}
  }
  close(){need(!this.closed,'RESEARCH_RPC_CLOSED');need(this.active===0,'RESEARCH_RPC_IN_FLIGHT_CAP');this.closed=true;closeSync(this.lease);}
}
