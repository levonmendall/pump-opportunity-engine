/** Fixed-endpoint public data transport for ONE component grant. No retry/signing. */
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {ComponentBudget,type ComponentOperation} from './component-budget.js';
import {validateRpc} from './network.js';
import {createHash} from 'node:crypto';
const HTTP='https://api.mainnet.solana.com',WS='wss://api.mainnet.solana.com';
export type SignatureHistoryBatchRequest={key:string;params:readonly unknown[]};
export type SignatureHistoryBatchItem<T=unknown>={key:string;id:string;status:'result'|'rpc-error';result?:T;errorCode?:number;requestedAt:number;responseReceivedAt:number;validatedAt:number};
export type SignatureHistoryBatchResponse<T=unknown>={physicalRequestId:number;requestedAt:number;responseReceivedAt:number;validatedAt:number;responseBytes:number;physicalHttpStarts:1;logicalQueries:number;overloaded:boolean;items:SignatureHistoryBatchItem<T>[]};
export type ComponentNotice={at:number;connection:number;address:string;slot:number;hash:string;account:any;changed:boolean};
type RecordFn=(kind:string,data:unknown)=>void;
type Pending={id:number;method:string;address?:string;resolve:(v:any)=>void;reject:(e:Error,acknowledged?:boolean)=>void};
type Connection={id:number;socket:WebSocket;seen:number;expectedClose:boolean;closed:boolean;closedPromise:Promise<void>;resolveClosed:()=>void};
export class ComponentTransport {
  socket:WebSocket|undefined;connection=0;applicationBytes=0;socketBytes=0;notifications=0;changes=0;
  readonly subscriptions=new Map<number,string>();readonly notices:ComponentNotice[]=[];
  private pending:Pending|null=null;private early:Array<{message:any;at:number}>=[];
  private activeConnection:Connection|undefined;private fatal:Error|null=null;private hashes=new Map<string,string>();
  constructor(readonly budget:ComponentBudget,private readonly record:RecordFn,private readonly onNotice:(n:ComponentNotice)=>void,private readonly now=Date.now,private readonly fetcher:typeof fetch=fetch,private readonly makeSocket?:()=>WebSocket){}
  error(){return this.fatal;}
  private fail(reason:string){
    if(this.fatal)return;this.fatal=Error(reason);
    try{this.budget.halt(reason);}finally{this.pending?.reject(this.fatal);this.pending=null;this.socket?.terminate();}
  }
  private sampleConnection(c:Connection){
    const n=(c.socket as unknown as {_socket?:{bytesRead:number}})?._socket?.bytesRead;
    if(typeof n==='number'&&Number.isSafeInteger(n)&&n>=c.seen){while(c.seen<n){const delta=Math.min(65536,n-c.seen);c.seen+=delta;this.socketBytes+=delta;this.budget.chargeWs(delta);}if(this.socketBytes>=7*1024*1024)this.fail('COMPONENT_WS_SOCKET_STOP');}
    return n;
  }
  sampleSocket(){return this.activeConnection?this.sampleConnection(this.activeConnection):undefined;}
  private async httpJson(op:ComponentOperation,method:string,envelope:unknown,onHttpInvoked?:()=>void){
    const requestedAt=this.now(),startedMono=performance.now();onHttpInvoked?.();
    let res:Response|undefined,headersAt:number|null=null,firstBodyAt:number|null=null,lastBodyAt:number|null=null,bodyCompleteAt:number|null=null,jsonDecodedAt:number|null=null,decodeMs:number|null=null,size=0,chunksReceived=0,outcome='not-completed';
    try{
      try{res=await this.fetcher(HTTP,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope),signal:op.signal,redirect:'error'});}catch{throw Error('COMPONENT_HTTP_TRANSPORT');}
      headersAt=this.now();const retryAfter=res.headers.get('retry-after');this.record('http-headers',{id:op.id,method,status:res.status,retryAfter:retryAfter?.slice(0,128)??null,at:headersAt,byteAccounting:'measured-body; response-header-and-wire-overhead-unmeasured'});
      // Stop at throttle headers; the unread body remains reserved uncertainty.
      if(res.status===429){await res.body?.cancel().catch(()=>{});throw Error('COMPONENT_HTTP_429');}
      if(Number(res.headers.get('content-length'))>2*1024*1024){await res.body?.cancel().catch(()=>{});throw Error('COMPONENT_HTTP_RESPONSE_SIZE');}
      const reader=res.body?.getReader();if(!reader)throw Error('COMPONENT_HTTP_EMPTY_RESPONSE');
      const chunks:Uint8Array[]=[];let complete=false;const abort=()=>{void reader.cancel().catch(()=>{});};op.signal.addEventListener('abort',abort,{once:true});
      // Fetch yields decoded bytes. Compressed Content-Length is not that size.
      const length=res.headers.get('content-length'),encoding=res.headers.get('content-encoding');
      const expectedLength=length!==null&&/^[0-9]+$/.test(length)&&Number.isSafeInteger(Number(length))&&(!encoding||encoding==='identity')?Number(length):null;
      try{for(;;){if(op.signal.aborted)throw Error('COMPONENT_ABORTED');const {done,value}=await reader.read();if(done){if(op.signal.aborted)throw Error('COMPONENT_ABORTED');if(expectedLength!==null&&size!==expectedLength)throw Error('COMPONENT_HTTP_TRUNCATED_RESPONSE');op.completeResponse();complete=true;bodyCompleteAt=this.now();break;}const at=this.now();firstBodyAt??=at;lastBodyAt=at;chunksReceived++;size+=value.byteLength;op.chargeHttp(value.byteLength);if(size>2*1024*1024)throw Error('COMPONENT_HTTP_RESPONSE_SIZE');if(res.ok)chunks.push(value);}}
      finally{op.signal.removeEventListener('abort',abort);if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
      const responseReceivedAt=this.now();this.record('http-response-timing',{id:op.id,method,requestedAt,availableAt:responseReceivedAt,responseBytes:size,status:res.status});
      if(!res.ok)throw Error('COMPONENT_HTTP_STATUS_'+res.status);
      let body:any;const decodeStarted=performance.now();try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('COMPONENT_HTTP_MALFORMED_JSON');}finally{decodeMs=performance.now()-decodeStarted;}
      jsonDecodedAt=this.now();outcome='json-decoded';return {body,requestedAt,responseReceivedAt,responseBytes:size};
    }catch(error){outcome=error instanceof Error&&/^COMPONENT_[A-Z0-9_:-]{1,100}$/.test(error.message)?error.message:'COMPONENT_HTTP_BODY_INTERRUPTED';throw error;}
    finally{
      // Bounded metadata also survives partial bodies. No payload, headers,
      // provider text, inferred TTFB origin or fabricated connection reuse.
      const httpWorkEndedAt=this.now();this.record('http-lifecycle-timing',{id:op.id,method,requestedAt,headersAt,firstBodyAt,lastBodyAt,bodyCompleteAt,jsonDecodedAt,httpWorkEndedAt,status:res?.status??null,responseBytes:size,chunksReceived,outcome,aborted:op.signal.aborted,headersDelayMs:headersAt===null?null:headersAt-requestedAt,bodyAfterHeadersMs:bodyCompleteAt===null||headersAt===null?null:bodyCompleteAt-headersAt,jsonDecodeMonotonicMs:decodeMs,elapsedMonotonicMs:performance.now()-startedMono,connectionReuse:'not-instrumented; inherited fetch dispatcher retained',validationScope:'HTTP body/JSON only; caller owns envelope/domain validation and physical settlement'});
    }
  }
  async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal,options:{latestStartAt?:number;timeoutMs?:number;admissionOpen?:()=>boolean}={}):Promise<T>{
    validateRpc({method});
    return this.budget.operate({transport:'http',method},async op=>{
      const {body}=await this.httpJson(op,method,{jsonrpc:'2.0',id:op.id,method,params});
      if(body?.jsonrpc!=='2.0'||body.id!==op.id||!('result'in body)&&!body.error)throw Error('COMPONENT_HTTP_ENVELOPE');
      if(body.error){const code=body.error.code;if(!Number.isSafeInteger(code))throw Error('COMPONENT_RPC_ERROR');throw Error(code===-32005?'COMPONENT_RPC_-32005':'COMPONENT_RPC_ERROR_'+code);}
      return body.result as T;
    },signal,{timeoutMs:1000,...options});
  }
  private readonly historyBatchCounts={plans:0,plannedLogicalQueries:0,physicalHttpStarts:0,logicalQueriesStarted:0,successfulLogicalQueries:0,rpcErrorResponses:0,providerBackoffBatches:0};
  signatureHistoryBatchUsage(){return {scope:'THIS_TRANSPORT_INSTANCE',...this.historyBatchCounts,logicalQueriesWithoutValidatedResponse:this.historyBatchCounts.logicalQueriesStarted-this.historyBatchCounts.successfulLogicalQueries-this.historyBatchCounts.rpcErrorResponses,meaning:'One physical HTTP envelope is not one provider query or billing unit; provider batch eligibility/metering is unverified.'};}
  /** A targeted transport only. Every item remains an independent provider query
   * and must still pass the existing pool-window audit. No automatic retry. */
  async callSignatureHistoryBatch<T=unknown>(requests:readonly SignatureHistoryBatchRequest[],signal?:AbortSignal,options:{latestStartAt?:number;timeoutMs?:number;admissionOpen?:()=>boolean}={}):Promise<SignatureHistoryBatchResponse<T>>{
    if(!Array.isArray(requests)||requests.length<1||requests.length>6)throw Error('COMPONENT_HISTORY_BATCH_SIZE');
    const keys=new Set<string>();const copied=requests.map(request=>{
      if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!['key','params'].includes(key)))throw Error('COMPONENT_HISTORY_BATCH_REQUEST');
      const key=request.key,params=request.params;
      if(typeof key!=='string'||!key||key.length>100||/[\u0000-\u001f]/.test(key)||keys.has(key)||!Array.isArray(params)||params.length!==2)throw Error('COMPONENT_HISTORY_BATCH_REQUEST');keys.add(key);
      const pool=params[0],config=params[1] as Record<string,unknown>;
      if(typeof pool!=='string'||pool.length<32||pool.length>44||!/^[1-9A-HJ-NP-Za-km-z]+$/.test(pool)||!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(k=>!['before','until','limit','commitment','minContextSlot'].includes(k))||config.commitment!=='confirmed'||![100,1000].includes(Number(config.limit))||typeof config.limit!=='number')throw Error('COMPONENT_HISTORY_BATCH_REQUEST');
      for(const key of ['before','until'])if(config[key]!==undefined&&(typeof config[key]!=='string'||(config[key] as string).length<64||(config[key] as string).length>88||!/^[1-9A-HJ-NP-Za-km-z]+$/.test(config[key] as string)))throw Error('COMPONENT_HISTORY_BATCH_REQUEST');
      if(config.minContextSlot!==undefined&&(!Number.isSafeInteger(config.minContextSlot)||Number(config.minContextSlot)<0))throw Error('COMPONENT_HISTORY_BATCH_REQUEST');
      return Object.freeze({key,params:Object.freeze([pool,Object.freeze({...config})])});
    });
    if(signal?.aborted)throw Error('COMPONENT_ABORTED');
    // Invoke the caller's recorder before admission. Live callers must preserve
    // this plan durably; an un-settled reservation retains logical uncertainty.
    // Planned queries are not mislabeled as provider invocations.
    this.record('signature-history-batch-plan',{at:this.now(),logicalQueries:copied.length,requests:structuredClone(copied),physicalStartNotYetAdmitted:true});this.historyBatchCounts.plans++;this.historyBatchCounts.plannedLogicalQueries+=copied.length;
    const batch=await this.budget.operate({transport:'http',method:'getSignaturesForAddress'},async op=>{
      const wire=copied.map((request,index)=>({jsonrpc:'2.0',id:'signature-history:'+op.id+':'+index,method:'getSignaturesForAddress',params:request.params}));
      if(Buffer.byteLength(JSON.stringify(wire))>64000)throw Error('COMPONENT_HISTORY_BATCH_REQUEST_SIZE');
      const response=await this.httpJson(op,'getSignaturesForAddress',wire,()=>{this.historyBatchCounts.physicalHttpStarts++;this.historyBatchCounts.logicalQueriesStarted+=wire.length;});
      if(!Array.isArray(response.body)||response.body.length!==wire.length)throw Error('COMPONENT_HISTORY_BATCH_ENVELOPE');
      const byId=new Map<string,any>();for(const item of response.body){if(!item||typeof item!=='object'||Array.isArray(item)||item.jsonrpc!=='2.0'||typeof item.id!=='string'||!wire.some(w=>w.id===item.id)||byId.has(item.id)||Object.hasOwn(item,'result')===Object.hasOwn(item,'error')||Object.hasOwn(item,'error')&&(!item.error||typeof item.error!=='object'||Array.isArray(item.error)||!Number.isSafeInteger(item.error.code)))throw Error('COMPONENT_HISTORY_BATCH_ENVELOPE');byId.set(item.id,item);}
      const validatedAt=this.now(),items:SignatureHistoryBatchItem<T>[]=wire.map((request,index)=>{const item=byId.get(request.id),common={key:copied[index]!.key,id:request.id,requestedAt:response.requestedAt,responseReceivedAt:response.responseReceivedAt,validatedAt};return Object.hasOwn(item,'error')?{...common,status:'rpc-error' as const,errorCode:item.error.code}:{...common,status:'result' as const,result:item.result as T};});
      const overloaded=items.some(item=>item.errorCode===-32005||item.errorCode===429);this.historyBatchCounts.successfulLogicalQueries+=items.filter(item=>item.status==='result').length;this.historyBatchCounts.rpcErrorResponses+=items.filter(item=>item.status==='rpc-error').length;if(overloaded)this.historyBatchCounts.providerBackoffBatches++;
      this.record('signature-history-batch-response',{physicalRequestId:op.id,requestedAt:response.requestedAt,responseReceivedAt:response.responseReceivedAt,validatedAt,responseBytes:response.responseBytes,physicalHttpStarts:1,logicalQueries:wire.length,overloaded,items:items.map(({result:_result,...item})=>item),providerErrorTextRetained:false});
      return {physicalRequestId:op.id,requestedAt:response.requestedAt,responseReceivedAt:response.responseReceivedAt,validatedAt,responseBytes:response.responseBytes,physicalHttpStarts:1 as const,logicalQueries:wire.length,overloaded,items};
    },signal,{timeoutMs:1000,...options});
    // Halt only after the response and physical operation have settled; halting
    // inside its callback would abort the same response and obscure partials.
    if(batch.overloaded)this.budget.halt(batch.items.some(item=>item.errorCode===429)?'COMPONENT_HTTP_429':'COMPONENT_RPC_OVERLOAD');
    return batch;
  }
  private accept(message:any,at:number){
    if(!message||message.jsonrpc!=='2.0'){this.fail('COMPONENT_WS_ENVELOPE');return;}
    if(message.method==='accountNotification'){
      const address=this.subscriptions.get(message.params?.subscription);
      if(!address){if(this.pending?.method==='accountSubscribe'&&this.early.length<8){this.early.push({message,at});return;}this.fail('COMPONENT_UNSCOPED_NOTIFICATION');return;}
      const result=message.params?.result,slot=result?.context?.slot,account=result?.value;
      if(!Number.isSafeInteger(slot)||slot<0||!account||typeof account.owner!=='string'||!Number.isSafeInteger(account.lamports)||account.lamports<0||typeof account.executable!=='boolean'||!Array.isArray(account.data)||account.data[1]!=='base64'||typeof account.data[0]!=='string'||Buffer.from(account.data[0],'base64').toString('base64')!==account.data[0]){this.fail('COMPONENT_MALFORMED_NOTIFICATION');return;}
      const hash=createHash('sha256').update(JSON.stringify({owner:account.owner,lamports:account.lamports,executable:account.executable,data:account.data})).digest('hex'),prior=this.hashes.get(address),changed=prior!==undefined&&prior!==hash;this.hashes.set(address,hash);
      const n={at,connection:this.connection,address,slot,hash,account,changed};this.notifications++;if(changed)this.changes++;
      if(this.notices.length>=2048){this.fail('COMPONENT_NOTIFICATION_CAP');return;}this.notices.push(n);this.record('account-notification',n);this.onNotice(n);return;
    }
    const pending=this.pending;if(!pending||message.id!==pending.id){this.fail('COMPONENT_UNEXPECTED_WS_RESPONSE');return;}
    if(message.error){pending.reject(Error(message.error.code===-32005?'COMPONENT_RPC_-32005':'COMPONENT_WS_RPC_ERROR'),true);return;}
    if(pending.method==='accountSubscribe'){
      if(!Number.isSafeInteger(message.result)||message.result<0||this.subscriptions.has(message.result)){pending.reject(Error('COMPONENT_WS_ACK_INVALID'),true);return;}
      this.subscriptions.set(message.result,pending.address!);
    }else if(message.result!==true){pending.reject(Error('COMPONENT_WS_UNSUBSCRIBE_REFUSED'),true);return;}
    this.record('ws-ack',{connection:this.connection,id:pending.id,method:pending.method,address:pending.address??null,at});pending.resolve(message.result);
    const queued=this.early;this.early=[];for(const e of queued){if(this.fatal)break;this.accept(e.message,e.at);}
  }
  seedAccountHashes(addresses:string[],accounts:any[]){for(let i=0;i<addresses.length;i++)this.hashes.set(addresses[i]!,createHash('sha256').update(JSON.stringify({owner:accounts[i].owner,lamports:accounts[i].lamports,executable:accounts[i].executable,data:accounts[i].data})).digest('hex'));}
  async connect(signal?:AbortSignal){
    if(this.fatal)throw this.fatal;
    if(this.connection>=2)throw Error('COMPONENT_CONNECTION_CAP');
    if(this.activeConnection&&!this.activeConnection.closed)throw Error('COMPONENT_OLD_SOCKET_NOT_CLOSED');
    return this.budget.operate({transport:'ws-upgrade',method:'upgrade'},async op=>new Promise<void>((resolve,reject)=>{
      this.connection++;this.subscriptions.clear();this.early=[];
      const ws=this.makeSocket?.()??new WebSocket(WS,{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:65536,perMessageDeflate:false,followRedirects:false,handshakeTimeout:1200});this.socket=ws;
      let resolveClosed!:()=>void;const closedPromise=new Promise<void>(r=>{resolveClosed=r;});
      const c:Connection={id:this.connection,socket:ws,seen:0,expectedClose:false,closed:false,closedPromise,resolveClosed};this.activeConnection=c;
      const isCurrent=()=>this.activeConnection===c&&!c.closed;
      let settled=false;const settle=(error?:Error)=>{if(settled)return;settled=true;op.signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
      const abort=()=>{ws.terminate();settle(Error('COMPONENT_ABORTED'));};op.signal.addEventListener('abort',abort,{once:true});
      ws.on('open',()=>{if(!isCurrent())return;try{const rawSocket=(ws as unknown as {_socket?:{prependListener?:(event:string,listener:()=>void)=>void}})._socket;rawSocket?.prependListener?.('data',()=>{if(!isCurrent())return;try{this.sampleConnection(c);}catch{this.fail('COMPONENT_WS_COUNTER_FAILURE');}});if(this.sampleConnection(c)===undefined)throw Error('COMPONENT_SOCKET_COUNTER_UNAVAILABLE');op.completeResponse();this.record('ws-open',{connection:c.id,at:this.now()});settle();}catch{settle(Error('COMPONENT_WS_OPEN_INVALID'));}});
      ws.on('message',raw=>{if(!isCurrent())return;try{const b=Array.isArray(raw)?Buffer.concat(raw):typeof raw==='string'?Buffer.from(raw):Buffer.from(raw as ArrayBuffer);this.applicationBytes+=b.byteLength;if(this.sampleConnection(c)===undefined)throw Error('COMPONENT_SOCKET_COUNTER_UNAVAILABLE');if(b.byteLength>65536){this.fail('COMPONENT_WS_PAYLOAD_STOP');return;}if(this.applicationBytes>=6*1024*1024){this.fail('COMPONENT_WS_APPLICATION_STOP');return;}this.accept(JSON.parse(b.toString('utf8')),this.now());}catch{this.fail('COMPONENT_WS_MESSAGE_INVALID');}});
      ws.on('ping',()=>{if(!isCurrent())return;try{this.sampleConnection(c);this.record('ws-control-ping',{connection:c.id,at:this.now()});}catch{this.fail('COMPONENT_WS_COUNTER_FAILURE');}});
      ws.on('unexpected-response',(_req,res)=>{if(!isCurrent())return;try{const n=res.socket?.bytesRead;if(typeof n==='number'&&n>c.seen){this.budget.chargeWs(n-c.seen);this.socketBytes+=n-c.seen;c.seen=n;}this.record('ws-upgrade-refused',{connection:c.id,status:res.statusCode,retryAfter:String(res.headers['retry-after']??'').slice(0,128)});}finally{res.destroy();settle(Error(res.statusCode===429?'COMPONENT_HTTP_429':'COMPONENT_WS_UPGRADE_REFUSED'));}});
      ws.on('error',()=>{if(!isCurrent())return;settle(Error('COMPONENT_WS_TRANSPORT'));if(ws.readyState!==WebSocket.CONNECTING)this.fail('COMPONENT_WS_TRANSPORT');});
      ws.on('close',code=>{if(c.closed)return;try{this.sampleConnection(c);}catch{}c.closed=true;c.resolveClosed();this.record('ws-close',{connection:c.id,code,expected:c.expectedClose,at:this.now()});if(!c.expectedClose&&this.activeConnection===c){settle(Error('COMPONENT_WS_UNEXPECTED_CLOSE'));this.fail('COMPONENT_WS_UNEXPECTED_CLOSE');}});
    }),signal,{timeoutMs:1500});
  }
  async manage(method:'accountSubscribe'|'accountUnsubscribe',value:string|number,signal?:AbortSignal){
    if(this.fatal)throw this.fatal;
    return this.budget.operate({transport:'ws',method},async op=>new Promise<number|boolean>((resolve,reject)=>{
      if(!this.socket||this.socket.readyState!==WebSocket.OPEN||this.pending){reject(Error('COMPONENT_WS_NOT_READY'));return;}
      let settled=false;const finish=(error:Error|null,v:any,acknowledged:boolean)=>{if(settled)return;settled=true;op.signal.removeEventListener('abort',abort);if(this.pending===pending)this.pending=null;if(acknowledged)op.completeResponse();if(error)reject(error);else{if(method==='accountUnsubscribe')this.subscriptions.delete(Number(value));resolve(v);}};
      const abort=()=>{this.socket?.terminate();finish(Error('COMPONENT_ABORTED'),undefined,false);};op.signal.addEventListener('abort',abort,{once:true});
      const pending:Pending={id:op.id,method,...(method==='accountSubscribe'?{address:String(value)}:{}),resolve:v=>finish(null,v,true),reject:(e,acknowledged=false)=>finish(e,undefined,acknowledged)};this.pending=pending;
      const params=method==='accountSubscribe'?[value,{encoding:'base64',commitment:'confirmed'}]:[value];this.record('ws-request',{connection:this.connection,id:op.id,method,address:method==='accountSubscribe'?value:null,at:this.now()});
      try{this.socket.send(JSON.stringify({jsonrpc:'2.0',id:op.id,method,params}),error=>{if(error)pending.reject(Error('COMPONENT_WS_SEND_FAILED'));});}catch{pending.reject(Error('COMPONENT_WS_SEND_FAILED'));}
    }),signal,{timeoutMs:1000});
  }
  terminate(reason:string){const c=this.activeConnection;if(!c||c.closed)return;c.expectedClose=true;try{this.sampleConnection(c);}catch{}this.record('ws-local-terminate',{connection:c.id,reason,at:this.now()});c.socket.terminate();}
  async terminateAndWait(reason:string,timeoutMs=1000){
    const c=this.activeConnection;if(!c||c.closed)return;
    this.terminate(reason);let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([c.closedPromise,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{this.fail('COMPONENT_WS_CLOSE_TIMEOUT');reject(Error('COMPONENT_WS_CLOSE_TIMEOUT'));},timeoutMs);})]);}
    finally{clearTimeout(timer);}
  }
}
