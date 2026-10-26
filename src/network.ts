import { performance } from 'node:perf_hooks';

const RPC_METHODS = Object.freeze(['getSlot','getMultipleAccounts','getTransaction','getSignaturesForAddress','getMinimumBalanceForRentExemption','getBlockTime','getGenesisHash']);
const DATA_METHODS = Object.freeze(['subscribeMigration','subscribeTokenTrade','unsubscribeTokenTrade']);
export function validateRpc(body: unknown): asserts body is {method:string} {
  if (!body || typeof body !== 'object' || !('method' in body) || !RPC_METHODS.includes(String(body.method))) throw new Error('PAPER_RPC_METHOD_DENIED');
}
export function dataMessage(method: string, keys?: string[], meteredApproved=false): string {
  if (!DATA_METHODS.includes(method)) throw new Error('PAPER_DATA_METHOD_DENIED');
  if (method==='subscribeTokenTrade' && !meteredApproved) throw new Error('DATA_BUDGET_NOT_APPROVED');
  return JSON.stringify({method,...(keys?{keys}: {})});
}
// This module has no signing/submission or generic URL request API.
export class ReadOnlyRpc {
  calls=0; bytes=0; durationsMs:number[]=[];
  constructor(private readonly endpoint='https://api.mainnet.solana.com',private readonly transport:typeof fetch=fetch) {
    const u=new URL(endpoint); if(u.protocol!=='https:' || u.username || u.password || u.hash || /(^|\.)pumpportal\.fun$/i.test(u.hostname) || /(?:trade|sign|sendtransaction)/i.test(u.pathname)) throw new Error('Invalid RPC endpoint');
  }
  async call<T>(method:string,params:unknown[]=[]):Promise<T> {
    validateRpc({method});const body={jsonrpc:'2.0',id:++this.calls,method,params};
    if(this.calls>100) throw new Error('INTEGRATION_RPC_CALL_CAP');
    const start=performance.now();
    const res=await this.transport(this.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000),redirect:'error'});
    if(!res.ok) throw new Error(`RPC_HTTP_${res.status}`);
    if(Number(res.headers.get('content-length'))>2_000_000){await res.body?.cancel();throw new Error('RPC_RESPONSE_TOO_LARGE');}
    const reader=res.body?.getReader();if(!reader)throw new Error('RPC_EMPTY_BODY');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;this.bytes+=value.byteLength;if(size>2_000_000){await reader.cancel();throw new Error('RPC_RESPONSE_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
    const raw=Buffer.concat(chunks).toString('utf8');
    const data=JSON.parse(raw); this.durationsMs.push(performance.now()-start);
    if(data.jsonrpc!=='2.0'||data.id!==body.id||(!('result' in data)&&!data.error))throw new Error('RPC_INVALID_ENVELOPE');
    if(data.error) throw new Error(`RPC_ERROR_${data.error.code}:${String(data.error.message).slice(0,160)}`);
    return data.result as T;
  }
}
