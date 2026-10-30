/** Hard suballocations around the single durable research counterbook. */
export type CountedReadRpc={readonly calls:number;readonly bytes:number;readonly inFlight:number;call<T>(method:string,params?:unknown[],signal?:AbortSignal):Promise<T>};
const RESPONSE_HEADROOM=2*1024*1024;
export class ResearchPhaseRpc {
  private readonly startCalls:number;private readonly startBytes:number;private readonly operations:Record<string,number>={};
  constructor(private readonly rpc:CountedReadRpc,readonly name:string,readonly maxCalls:number,readonly maxBytes:number,private readonly methodCaps:Record<string,number>={}){
    if(!/^[A-Z_]+$/.test(name)||!Number.isSafeInteger(maxCalls)||maxCalls<1||!Number.isSafeInteger(maxBytes)||maxBytes<RESPONSE_HEADROOM)throw Error('INVALID_RESEARCH_PHASE');
    this.startCalls=rpc.calls;this.startBytes=rpc.bytes;
  }
  get calls(){return this.rpc.calls;}get bytes(){return this.rpc.bytes;}get inFlight(){return this.rpc.inFlight;}
  usage(){return {phase:this.name,calls:this.rpc.calls-this.startCalls,responseBytes:this.rpc.bytes-this.startBytes,maxCalls:this.maxCalls,maxBytes:this.maxBytes,operations:{...this.operations}};}
  async call<T>(method:string,params:unknown[]=[],signal?:AbortSignal):Promise<T>{
    const used=this.usage();
    if(used.calls>=this.maxCalls)throw Error('RESEARCH_PHASE_REQUEST_CAP');
    if(used.responseBytes+RESPONSE_HEADROOM>this.maxBytes)throw Error('RESEARCH_PHASE_RESPONSE_RESERVE');
    if(this.methodCaps[method]!==undefined&&(this.operations[method]??0)>=this.methodCaps[method]!)throw Error('RESEARCH_PHASE_METHOD_CAP');
    this.operations[method]=(this.operations[method]??0)+1;
    return this.rpc.call<T>(method,params,signal);
  }
}
