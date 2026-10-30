import { performance } from 'node:perf_hooks';

const RPC_METHODS = Object.freeze(['getBlock','getSlot','getMultipleAccounts','getTransaction','getSignaturesForAddress','getMinimumBalanceForRentExemption','getBlockTime','getGenesisHash']);
const DATA_METHODS = Object.freeze(['subscribeMigration','subscribeTokenTrade','unsubscribeTokenTrade']);
export function validateRpc(body: unknown): asserts body is {method:string} {
  if (!body || typeof body !== 'object' || !('method' in body) || !RPC_METHODS.includes(String(body.method))) throw new Error('PAPER_RPC_METHOD_DENIED');
}
export function dataMessage(method: string, keys?: string[], meteredApproved=false): string {
  if (!DATA_METHODS.includes(method)) throw new Error('PAPER_DATA_METHOD_DENIED');
  if (method==='subscribeTokenTrade' && !meteredApproved) throw new Error('DATA_BUDGET_NOT_APPROVED');
  return JSON.stringify({method,...(keys?{keys}: {})});
}
export type RpcOptions={profile?:'integration'|'runtime';maxCallsPerMinute?:number;maxInFlight?:number;timeoutMs?:number;durationSamples?:number;monotonicNow?:()=>number};
/** Shared read-only client: no retries or waiting queue. A canceled transport that
 * ignores AbortSignal retains its physical slot until it actually settles.
 */
export class ReadOnlyRpc {
  calls=0; bytes=0; readonly durationsMs:number[]=[];
  private readonly starts:number[]=[];
  private active=0;
  private readonly limit:number;private readonly concurrency:number;private readonly timeout:number;private readonly samples:number;private readonly clock:()=>number;
  constructor(private readonly endpoint='https://api.mainnet.solana.com',private readonly transport:typeof fetch=fetch,private readonly options:RpcOptions={}) {
    const u=new URL(endpoint); if(u.protocol!=='https:' || u.username || u.password || u.hash || /(^|\.)pumpportal\.fun$/i.test(u.hostname) || /(?:trade|sign|sendtransaction)/i.test(u.pathname)) throw new Error('Invalid RPC endpoint');
    this.limit=options.maxCallsPerMinute??60;this.concurrency=options.maxInFlight??1;this.timeout=options.timeoutMs??12_000;this.samples=options.durationSamples??128;this.clock=options.monotonicNow??(()=>performance.now());
    if(options.profile!==undefined&&!['integration','runtime'].includes(options.profile)||!Number.isSafeInteger(this.limit)||this.limit<1||this.limit>60||!Number.isSafeInteger(this.concurrency)||this.concurrency<1||this.concurrency>3||!Number.isSafeInteger(this.timeout)||this.timeout<1||this.timeout>12_000||!Number.isSafeInteger(this.samples)||this.samples<1||this.samples>128)throw new Error('Invalid bounded RPC profile');
  }
  get inFlight(){return this.active;}
  private prune(now:number){while(this.starts.length&&this.starts[0]!<=now-60_000)this.starts.shift();}
  usage(){const now=this.clock();this.prune(now);return {profile:this.options.profile??'integration',calls:this.calls,bytes:this.bytes,inFlight:this.active,rollingMinuteCalls:this.starts.length,rollingMinuteLimit:this.limit,durationSamples:this.durationsMs.length};}
  async call<T>(method:string,params:unknown[]=[],outer?:AbortSignal):Promise<T> {
    validateRpc({method});if(outer?.aborted)throw new Error('RPC_ABORTED');
    const start=this.clock();this.prune(start);
    if((this.options.profile??'integration')==='integration'&&this.calls>=100)throw new Error('INTEGRATION_RPC_CALL_CAP');
    if((this.options.profile??'integration')==='runtime'&&this.starts.length>=this.limit)throw new Error('RUNTIME_RPC_RATE_CAP');
    if(this.active>=this.concurrency)throw new Error('RPC_IN_FLIGHT_CAP');
    const body={jsonrpc:'2.0',id:this.calls+1,method,params},encoded=JSON.stringify(body);
    if(Buffer.byteLength(encoded)>64_000)throw new Error('RPC_REQUEST_TOO_LARGE');
    this.calls++;this.starts.push(start);this.active++;
    const controller=new AbortController(),signal=outer?AbortSignal.any([outer,controller.signal]):controller.signal;
    let timer:ReturnType<typeof setTimeout>|undefined,abortListener:(()=>void)|undefined;
    const operation=(async()=>{
      const res=await this.transport(this.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:encoded,signal,redirect:'error'});
      if(signal.aborted){await res.body?.cancel().catch(()=>{});signal.throwIfAborted();}
      if(!res.ok){await res.body?.cancel();throw new Error(`RPC_HTTP_${res.status}`);}
      if(Number(res.headers.get('content-length'))>2_000_000){await res.body?.cancel();throw new Error('RPC_RESPONSE_TOO_LARGE');}
      const reader=res.body?.getReader();if(!reader)throw new Error('RPC_EMPTY_BODY');
      const chunks:Uint8Array[]=[];let size=0;
      let cancelPromise:Promise<void>|undefined;
      const cancel=()=>{cancelPromise??=reader.cancel().catch(()=>{});return cancelPromise;};signal.addEventListener('abort',cancel,{once:true});
      try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;this.bytes+=value.byteLength;if(size>2_000_000){await cancel();throw new Error('RPC_RESPONSE_TOO_LARGE');}chunks.push(value);}}
      finally{signal.removeEventListener('abort',cancel);if(signal.aborted)cancel();if(cancelPromise)await cancelPromise;reader.releaseLock();}
      signal.throwIfAborted();const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(data.jsonrpc!=='2.0'||data.id!==body.id||(!('result' in data)&&!data.error))throw new Error('RPC_INVALID_ENVELOPE');
      if(data.error){if(!Number.isSafeInteger(data.error.code))throw new Error('RPC_INVALID_ENVELOPE');throw new Error(`RPC_ERROR_${data.error.code}`);}
      return data.result as T;
    })().catch((error:unknown)=>{
      // Key-bearing endpoints and provider bodies can appear in transport or
      // JSON errors. Only bounded internal categories/codes may leave this client.
      const message=error instanceof Error?error.message:'';
      if(/^(RPC_(HTTP_\d{3}|ERROR_-?\d{1,16}|RESPONSE_TOO_LARGE|EMPTY_BODY|INVALID_ENVELOPE|ABORTED))$/.test(message))throw new Error(message);
      throw new Error(signal.aborted?'RPC_ABORTED':'RPC_TRANSPORT_OR_RESPONSE_UNAVAILABLE');
    });
    const settled=()=>{this.active--;this.durationsMs.push(Math.max(0,this.clock()-start));if(this.durationsMs.length>this.samples)this.durationsMs.shift();};
    void operation.then(settled,settled);
    try{return await Promise.race([operation,new Promise<never>((_resolve,reject)=>{abortListener=()=>reject(new Error('RPC_ABORTED'));signal.addEventListener('abort',abortListener,{once:true});timer=setTimeout(()=>controller.abort(),this.timeout);if(signal.aborted)abortListener();})]);}
    finally{clearTimeout(timer);if(abortListener)signal.removeEventListener('abort',abortListener);}
  }
}
