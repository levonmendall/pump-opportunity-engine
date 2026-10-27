import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {PROVISIONAL_RULE} from './strategy.js';

export const PUMPAPI_STREAM='wss://stream.pumpapi.io/' as const;
export const PUMPAPI_LIMITS=Object.freeze({maximumAggregateBytes:128*1024*1024,maximumAggregateMs:30*60_000,maximumPayloadBytes:65_536,maximumQueue:16,maximumInventoryFields:96,maximumFingerprints:256,maximumRssBytes:256*1024*1024,staleReceiveMs:2000,maximumEventLoopLagMs:500});
export type ProbeLimits={durationMs:number;applicationBytes:number;transportBytes:number;evidenceBytes:number;cpuMs:number};
export const PUMPAPI_SCHEMA_LIMITS:ProbeLimits=Object.freeze({durationMs:10_000,applicationBytes:7*1024*1024,transportBytes:8*1024*1024,evidenceBytes:7*1024*1024,cpuMs:8000});
export const PUMPAPI_CAPTURE_LIMITS:ProbeLimits=Object.freeze({durationMs:80_000,applicationBytes:103*1024*1024,transportBytes:104*1024*1024,evidenceBytes:7*1024*1024,cpuMs:20_000});
/** The socket process itself owns this flock across both exec wrappers. A dead
 * supervisor cannot release the connection lock while its child is still alive. */
export function pumpApiChildArguments(lock:string,script:string,limits:ProbeLimits){return ['-n','-F',lock,'prlimit',`--cpu=${Math.ceil(limits.cpuMs/1000)}:${Math.ceil(limits.cpuMs/1000)+1}`,'--fsize=8388608:8388608','--nofile=64:64','--',process.execPath,'--max-old-space-size=128','--import','tsx',script,'--child'];}
export type ProbeOptions={limits:ProbeLimits;trackedMints:readonly string[];write:(line:string)=>void;now?:()=>number;monotonic?:()=>number};
type Selected={kind:string;data:unknown;at:number;mono:number};
const validText=(s:unknown,max=100):s is string=>typeof s==='string'&&s.length>0&&s.length<=max&&!/[\u0000-\u001f]/.test(s);
const bytes=(raw:string|Uint8Array)=>typeof raw==='string'?Buffer.byteLength(raw):raw.byteLength;

/** Evidence-only policy. It has no socket/send/sign/trading API and produces no
 * normalized trades: PumpApi's aggregate/UI-amount/event identity is unverified.
 */
export class PumpApiProbe {
  private readonly options:ProbeOptions;private readonly now:()=>number;private readonly mono:()=>number;
  private readonly startedAt:number;private readonly startedMono:number;private informationMono:number;private informationAt:number;
  private connected=false;private openedMono:number|null=null;private continuousMono:number|null=null;private closedWindowObserved=false;private connections=0;private socketBytes=0;private transportBytes=0;
  private frames=0;private applicationBytes=0;private afterStopFrames=0;private malformed=0;private unsupportedArrays=0;private oversize=0;
  private parsed=0;private selected=0;private selectedCompleted=0;private selectedDuplicates=0;private repeatedSignatures=0;private missingSelectedFields=0;
  private lastReceiveAt:number|null=null;private lastReceiveMono:number|null=null;private continuousFrom:number|null=null;private lastSelectedAt:number|null=null;private gaps=0;
  private stopReason:string|null=null;private evidenceBytes=0;private sequence=0;private failedWrites=0;private queueHighWater=0;private inventoryOverflow=0;
  private readonly queue:Selected[]=[];private readonly inventory=new Map<string,Record<string,number>>();
  private readonly selectedPerMint=new Map<string,number>();private readonly actionCounts=new Map<string,number>();private readonly venueCounts=new Map<string,number>();private readonly queueAges:number[]=[];private maximumSelectedQueueAgeMs=0;
  private readonly selectedHashes=new Map<string,number>();private readonly signatures=new Set<string>();
  private peakRssBytes=0;private peakEventLoopLagMs=0;private cpuMs=0;private usefulAt:number|null=null;
  constructor(options:ProbeOptions){
    const limits={...options.limits};
    if(!Number.isSafeInteger(limits.durationMs)||limits.durationMs<1||limits.durationMs>80_000||!Number.isSafeInteger(limits.applicationBytes)||limits.applicationBytes<1||limits.applicationBytes>103*1024*1024||!Number.isSafeInteger(limits.transportBytes)||limits.transportBytes<limits.applicationBytes||limits.transportBytes>104*1024*1024||!Number.isSafeInteger(limits.evidenceBytes)||limits.evidenceBytes<1||limits.evidenceBytes>8*1024*1024||!Number.isSafeInteger(limits.cpuMs)||limits.cpuMs<1||limits.cpuMs>20_000)throw new Error('bounded probe limits required');
    if(options.trackedMints.length<1||options.trackedMints.length>16||new Set(options.trackedMints).size!==options.trackedMints.length||options.trackedMints.some(m=>!validText(m,44)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)))throw new Error('bounded exact tracked-mint list required');
    this.options={...options,limits:Object.freeze(limits),trackedMints:Object.freeze([...options.trackedMints])};this.now=options.now??Date.now;this.mono=options.monotonic??(()=>performance.now());
    this.startedAt=this.informationAt=this.now();this.startedMono=this.informationMono=this.mono();
    if(!Number.isSafeInteger(this.startedAt)||this.startedAt<0||!Number.isFinite(this.startedMono)||this.startedMono<0)throw new Error('valid probe clocks required');
    this.write('configuration',{endpoint:PUMPAPI_STREAM,limits,trackedMints:this.options.trackedMints,fieldContract:'UNVERIFIED',normalizedTrades:0,qualificationEnabled:false,featureWindowMs:PROVISIONAL_RULE.windowMs,closedBucketMs:PROVISIONAL_RULE.bucketMs,quoteAgeMs:PROVISIONAL_RULE.maximumQuoteAgeMs});
  }
  private clock(){const at=this.now(),mono=this.mono();if(!Number.isSafeInteger(at)||at<this.informationAt||!Number.isFinite(mono)||mono<this.informationMono){this.stopReason??='clock-regression';this.continuousFrom=null;return null;}this.informationMono=mono;this.informationAt=at;return {at,mono};}
  private write(kind:string,data:unknown,at=this.now(),mono=this.mono()){
    if(this.failedWrites)return false;const clock=this.clock();if(!clock)return false;if(!Number.isSafeInteger(at)||at<0||at>clock.at||!Number.isFinite(mono)||mono<0||mono>clock.mono){this.stopReason??='clock-regression';this.continuousFrom=null;return false;}const line=JSON.stringify({schemaVersion:1,sequence:this.sequence+1,receivedAt:at,receivedMonotonicMs:mono,kind,data})+'\n',size=Buffer.byteLength(line);
    if(this.evidenceBytes+size>this.options.limits.evidenceBytes){this.stopReason??='evidence-cap';this.continuousFrom=null;return false;}
    try{this.options.write(line);this.sequence++;this.evidenceBytes+=size;return true;}catch{this.failedWrites++;this.stopReason='storage-unavailable';this.continuousFrom=null;return false;}
  }
  private gap(reason:string,at=this.now(),mono=this.mono()){this.gaps++;this.continuousFrom=null;this.continuousMono=null;this.write('source-gap',{reason},at,mono);}
  get stopped(){return this.stopReason!==null;}
  opened(){const t=this.clock();if(!t||this.stopped)return;if(this.connected){this.finish('overlapping-connection');return;}if(this.connections)this.gap('reconnect',t.at,t.mono);this.connections++;this.connected=true;this.socketBytes=0;this.openedMono=t.mono;this.lastReceiveMono=null;this.continuousFrom=t.at;this.continuousMono=t.mono;this.write('source-open',{connection:this.connections},t.at,t.mono);}
  closed(reason='transport-close'){if(this.connected){this.connected=false;this.gap(reason);}}
  observeTransport(total:number){
    if(!Number.isSafeInteger(total)||total<0||total<this.socketBytes){this.finish('transport-counter-unavailable-or-regressed');return;}
    this.transportBytes+=total-this.socketBytes;this.socketBytes=total;
    // Leave1MiB read/cancellation headroom beneath the hard transport ceiling.
    if(this.transportBytes>=this.options.limits.transportBytes-Math.min(1024*1024,Math.floor(this.options.limits.transportBytes/8)))this.finish('transport-byte-headroom');
  }
  private field(path:string,value:unknown){
    if(!/^[A-Za-z_][A-Za-z0-9_.]{0,63}$/.test(path)){this.inventoryOverflow++;return;}
    if(!this.inventory.has(path)){if(this.inventory.size>=PUMPAPI_LIMITS.maximumInventoryFields){this.inventoryOverflow++;return;}this.inventory.set(path,{});}
    const type=value===null?'null':Array.isArray(value)?'array':typeof value;const stats=this.inventory.get(path)!;stats[type]=(stats[type]??0)+1;
  }
  receive(raw:string|Uint8Array,transportCounter:number){
    const size=bytes(raw);this.frames++;this.applicationBytes+=size;this.observeTransport(transportCounter);
    if(this.stopped){this.afterStopFrames++;return;}
    const t=this.clock();if(!t)return;
    if(t.mono-this.startedMono>=this.options.limits.durationMs){this.finish('duration-limit');return;}
    if(size>PUMPAPI_LIMITS.maximumPayloadBytes){this.oversize++;this.gap('oversized-message',t.at,t.mono);this.finish('payload-limit');return;}
    if(this.applicationBytes>=this.options.limits.applicationBytes){this.finish('application-byte-limit');return;}
    if(!this.connected){this.finish('data-without-open-connection');return;}
    if((this.lastReceiveMono??this.openedMono)!==null&&t.mono-(this.lastReceiveMono??this.openedMono!)>PUMPAPI_LIMITS.staleReceiveMs&&this.continuousFrom!==null)this.gap('stale-receive',t.at,t.mono);
    this.lastReceiveAt=t.at;this.lastReceiveMono=t.mono;
    let event:any;try{event=JSON.parse(typeof raw==='string'?raw:Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength).toString('utf8'));}catch{this.malformed++;this.gap('malformed-json',t.at,t.mono);return;}
    if(!event||typeof event!=='object'||Array.isArray(event)){if(Array.isArray(event))this.unsupportedArrays++;else this.malformed++;this.gap('unsupported-message-shape',t.at,t.mono);return;}
    this.parsed++;if(this.continuousFrom===null){this.continuousFrom=t.at+1;this.continuousMono=t.mono;} // A lost event at an inclusive boundary remains excluded.
    for(const [map,value] of [[this.actionCounts,event.action],[this.venueCounts,event.pool]] as const)if(validText(value,80)&&(map.has(value)||map.size<64))map.set(value,(map.get(value)??0)+1);
    for(const [key,value] of Object.entries(event))this.field(key,value);
    if(Array.isArray(event.breakdown))for(const item of event.breakdown.slice(0,8))if(item&&typeof item==='object'&&!Array.isArray(item))for(const [key,value] of Object.entries(item))this.field('breakdown.'+key,value);
    if(validText(event.signature)){if(this.signatures.has(event.signature))this.repeatedSignatures++;else{if(this.signatures.size>=256)this.signatures.delete(this.signatures.values().next().value!);this.signatures.add(event.signature);}}
    if(!this.options.trackedMints.includes(event.mint))return; // Broad payloads are never persisted.
    this.selected++;this.lastSelectedAt=t.at;this.selectedPerMint.set(event.mint,(this.selectedPerMint.get(event.mint)??0)+1);
    const required=['signature','action','poolId','mint','quoteMint','pool','tokenAmount','quoteAmount','breakdown'];const missing=required.filter(key=>event[key]===undefined||event[key]===null);this.missingSelectedFields+=missing.length;
    const hash=createHash('sha256').update(raw).digest('hex'),prior=this.selectedHashes.get(hash);
    const data=prior===undefined?{payloadHash:hash,payload:typeof raw==='string'?raw:Buffer.from(raw.buffer,raw.byteOffset,raw.byteLength).toString('utf8'),missingFields:missing,signature:validText(event.signature)?event.signature:null,providerSlotClaim:Number.isSafeInteger(event.block)?event.block:null,providerTimestampClaim:typeof event.timestamp==='number'||typeof event.timestamp==='string'?event.timestamp:null,contract:'UNVERIFIED; UI amounts, aggregate event and no verified instruction/event identity'}:{payloadHash:hash,firstSelectedNumber:prior,contract:'identical payload observation; not proof of duplicate chain event'};
    if(prior===undefined){if(this.selectedHashes.size>=256)this.selectedHashes.delete(this.selectedHashes.keys().next().value!);this.selectedHashes.set(hash,this.selected);}else this.selectedDuplicates++;
    if(this.queue.length>=PUMPAPI_LIMITS.maximumQueue){this.gap('selected-queue-pressure',t.at,t.mono);this.finish('selected-queue-cap');return;}
    this.queue.push({kind:prior===undefined?'selected-observation':'selected-identical-payload',data,at:t.at,mono:t.mono});this.queueHighWater=Math.max(this.queueHighWater,this.queue.length);
  }
  flush(maximum=8){for(let i=0;i<maximum&&this.queue.length;i++){const row=this.queue[0]!;if(!this.write(row.kind,row.data,row.at,row.mono))return;const age=Math.max(0,this.mono()-row.mono);this.maximumSelectedQueueAgeMs=Math.max(this.maximumSelectedQueueAgeMs,age);if(this.queueAges.length>=256)this.queueAges.shift();this.queueAges.push(age);this.queue.shift();this.selectedCompleted++;this.usefulAt=this.now();}}
  tick(resources:{rssBytes:number;cpuMs:number;eventLoopLagMs:number},transportCounter?:number){
    if(transportCounter!==undefined)this.observeTransport(transportCounter);const t=this.clock();if(!t||this.stopped)return;
    if(!Number.isSafeInteger(resources.rssBytes)||resources.rssBytes<0||!Number.isFinite(resources.cpuMs)||resources.cpuMs<this.cpuMs||!Number.isFinite(resources.eventLoopLagMs)||resources.eventLoopLagMs<0){this.finish('invalid-resource-reading');return;}
    this.updateWindow(t.at,t.mono);
    this.peakRssBytes=Math.max(this.peakRssBytes,resources.rssBytes);this.peakEventLoopLagMs=Math.max(this.peakEventLoopLagMs,resources.eventLoopLagMs);this.cpuMs=Math.max(this.cpuMs,resources.cpuMs);
    if(resources.rssBytes>PUMPAPI_LIMITS.maximumRssBytes)this.finish('rss-limit');else if(resources.cpuMs>=this.options.limits.cpuMs)this.finish('cpu-limit');else if(resources.eventLoopLagMs>PUMPAPI_LIMITS.maximumEventLoopLagMs)this.finish('event-loop-lag-limit');else if(t.mono-this.startedMono>=this.options.limits.durationMs)this.finish('duration-limit');
    if((this.lastReceiveMono??this.openedMono)!==null&&t.mono-(this.lastReceiveMono??this.openedMono!)>PUMPAPI_LIMITS.staleReceiveMs&&this.continuousFrom!==null)this.gap('stale-receive',t.at,t.mono);
    this.flush();
  }
  private updateWindow(at:number,mono:number){if(this.connected&&this.continuousFrom!==null&&this.continuousMono!==null&&this.lastReceiveMono!==null&&mono-this.lastReceiveMono<=PUMPAPI_LIMITS.staleReceiveMs&&mono-this.continuousMono>=PROVISIONAL_RULE.windowMs&&Math.floor(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs-PROVISIONAL_RULE.windowMs>=this.continuousFrom)this.closedWindowObserved=true;}
  finish(reason:string){if(!this.stopReason){this.stopReason=validText(reason,80)?reason:'stopped';this.continuousFrom=null;this.continuousMono=null;this.flush(16);this.write('probe-stop',{reason:this.stopReason});}}
  snapshot(){const t=this.clock(),at=t?.at??this.informationAt,mono=t?.mono??this.informationMono,end=Math.floor(at/PROVISIONAL_RULE.bucketMs)*PROVISIONAL_RULE.bucketMs;return {mode:'OBSERVATION_ONLY',endpoint:PUMPAPI_STREAM,startedAt:this.startedAt,at,durationMs:Math.max(0,mono-this.startedMono),stopReason:this.stopReason,connections:this.connections,connected:this.connected,frames:this.frames,applicationBytes:this.applicationBytes,observedSocketBytes:this.transportBytes,transportCounterMeaning:'Node socket bytesRead, including received websocket framing/handshake as exposed by transport; not a packet-capture measurement of TLS/proxy/TCP overhead',afterStopFrames:this.afterStopFrames,parsedFrames:this.parsed,malformedFrames:this.malformed,unsupportedArrayFrames:this.unsupportedArrays,oversizeFrames:this.oversize,selectedFrames:this.selected,selectedPersisted:this.selectedCompleted,identicalSelectedPayloads:this.selectedDuplicates,repeatedSignatures:this.repeatedSignatures,signatureDedupApplied:false,missingSelectedFields:this.missingSelectedFields,evidenceBytes:this.evidenceBytes,pendingSelected:this.queue.length,queueHighWater:this.queueHighWater,maximumSelectedQueueAgeMs:this.maximumSelectedQueueAgeMs,selectedQueueAgeP50Ms:this.queueAges.length?[...this.queueAges].sort((a,b)=>a-b)[Math.floor((this.queueAges.length-1)*0.5)]:null,selectedQueueAgeP95Ms:this.queueAges.length?[...this.queueAges].sort((a,b)=>a-b)[Math.ceil((this.queueAges.length-1)*0.95)]:null,selectedQueueAgeSampleLimit:256,selectedPerMint:Object.fromEntries(this.selectedPerMint),actionCounts:Object.fromEntries(this.actionCounts),venueCounts:Object.fromEntries(this.venueCounts),inventoryOverflow:this.inventoryOverflow,inventory:Object.fromEntries(this.inventory),lastReceiveAt:this.lastReceiveAt,lastSelectedAt:this.lastSelectedAt,lastUsefulAt:this.usefulAt,sourceAgeMs:this.lastReceiveAt===null?null:Math.max(0,at-this.lastReceiveAt),sourceGaps:this.gaps,transportWindowReady:!this.stopped&&this.connected&&this.lastReceiveMono!==null&&mono-this.lastReceiveMono<=PUMPAPI_LIMITS.staleReceiveMs&&this.continuousFrom!==null&&this.continuousMono!==null&&mono-this.continuousMono>=PROVISIONAL_RULE.windowMs&&end-PROVISIONAL_RULE.windowMs>=this.continuousFrom,closedWindowEverObserved:this.closedWindowObserved,featureWindowMs:PROVISIONAL_RULE.windowMs,closedBucketMs:PROVISIONAL_RULE.bucketMs,requiredWorstCaseWarmMs:PROVISIONAL_RULE.windowMs+PROVISIONAL_RULE.bucketMs,fieldContract:'UNVERIFIED',normalizedTradesProduced:0,qualificationEnabled:false,entriesEnabled:false,peakRssBytes:this.peakRssBytes,peakEventLoopLagMs:this.peakEventLoopLagMs,cpuMs:this.cpuMs,failedWrites:this.failedWrites};}
}
