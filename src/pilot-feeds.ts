import {PersistentDataWindow} from './persistent-data-window.js';
import {resolveNativeResearchProfile,type NativeResearchProfile} from './native-research-profile.js';
/** Finite PAPER-pilot feeds. Provider payloads are hints; only validated RPC
 * evidence reaches onTrade. This module has no financial or trading methods. */
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {ActivePipeline,type ActiveScope} from './active-pipeline.js';
import {canonicalPumpPoolPda} from './sdk.js';
import {dataMessage} from './network.js';
import {PUMPAPI_STREAM} from './pumpapi-probe.js';
import type {MappedTradeEvidence} from './pumpapi-mapping.js';
import type {NormalizedTrade} from './strategy.js';
import type {ComponentKind,ComponentOperation} from './component-budget.js';
import type {PilotRpcCallOptions} from './pilot-rpc.js';

const MIB=1024*1024,DISCOVERY='wss://pumpportal.fun/api/data',BACKOFF=[2000,5000,10000,20000,40000,60000],CANDIDATE_MS=180000;
export const PILOT_FEED_MAXIMUM_RECORDED_BYTES=16*MIB;
type FeedName='discovery'|'pumpapi';
export type PilotFeedControl={operateData<T>(kind:ComponentKind,work:(op:ComponentOperation)=>Promise<T>,signal?:AbortSignal,options?:PilotRpcCallOptions):Promise<T>;accountControlBytes(bytes:number):void;noteThrottle(retryAfter:string|null,at?:number):number};
export type PilotFeedRpc={call<T>(method:string,params:unknown[],signal?:AbortSignal,options?:PilotRpcCallOptions):Promise<T>};
export type PilotFeedsOptions={
  control:PilotFeedControl;persistent?:boolean;profile?:NativeResearchProfile['version'];amountConvention:'curve'|'user';maximumCandidates?:number;durationMs?:number;maxPumpApiBytes?:number;maxDiscoveryBytes?:number;maximumRecordedBytes?:number;
  record:(kind:string,data:unknown)=>void;
  onMigration:(seed:{signature:string;feedMint?:string;receivedAt:number})=>void;
  onFlowOpen?:(mint:string,at:number)=>void;
  onHint?:(mint:string,at:number)=>void;
  /** Selection hints only; these fields never become strategy or financial evidence. */
  watchedIdentities?:()=>readonly {mint:string;pool:string}[];
  onWatchActivity?:(row:{mint:string;pool:string;signature?:string;receivedAt:number;evidence:'unverified-pumpapi-activity-hint'})=>void;
  onTrade:(row:{evidence:MappedTradeEvidence&{rpcAvailableAt:number};trade:NormalizedTrade;validatedAt:number})=>void;
  onGap:(gap:{mint?:string;reason:string;at:number})=>void;
  /** The holdings scheduler may postpone low-priority socket controls. */
  admitControl?:()=>PilotRpcCallOptions|false;
};
type Connection={socket:WebSocket;seen:number;closed:boolean;opened:boolean;expectedClose:boolean;closeReason:string|null;lastTrafficMono:number;closedPromise:Promise<void>;resolveClosed:()=>void;ack?:()=>void;upgradeReject?:(e:Error)=>void;subscriptionReject?:(e:Error)=>void};
type Leg={name:FeedName;desired:boolean;connected:boolean;connecting:boolean;attempts:number;failures:number;reconnects:number;notBefore:number;timer?:unknown;connection?:Connection};
type FeatureRow=ReturnType<ActivePipeline['snapshot']>['featureRows'][number];
type Candidate={generation:number;scope:ActiveScope;pipeline:ActivePipeline;controller:AbortController;selectedMono:number;suspended:boolean;pending:Set<string>;normalized:number;mintBytes:Buffer;poolBytes:Buffer;latestFeature:FeatureRow|null};
export type PilotFeedDependencies={makeSocket?:(endpoint:string,options:WebSocket.ClientOptions)=>WebSocket;now?:()=>number;monotonic?:()=>number;setTimer?:(callback:()=>void,ms:number)=>unknown;clearTimer?:(timer:unknown)=>void};
const need=(v:unknown,reason:string)=>{if(!v)throw Error(reason);};
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,120}$/.test(e.message)?e.message:'PILOT_FEED_UNAVAILABLE';

export class PilotFeeds {
  private readonly now:()=>number;private readonly mono:()=>number;private readonly timer:(cb:()=>void,ms:number)=>unknown;private readonly cancel:(id:unknown)=>void;
  private readonly startedAt:number;private readonly startedMono:number;private readonly duration:number;private readonly pumpLimit:number;private readonly discoveryLimit:number;private readonly recordLimit:number;private readonly maximumCandidates:number;private readonly amountConvention:'curve'|'user';
  private readonly controller=new AbortController();private stopped=false;private watchActivityDesired=false;private generation=0;private readonly candidates=new Map<string,Candidate>();private readonly retryByMint=new Map<string,number>();private enriching=false;private watch:unknown;
  private readonly watchIdentities=new Map<string,{mint:string;pool:string}>();private readonly watchLastEmitted=new Map<string,number>();private readonly watchLastSignature=new Map<string,string>();private watchRefreshAt=-Infinity;private watchFrames=0;private watchParses=0;private watchHints=0;private watchFailures=0;private watchProcessingMs=0;
  private get candidate(){return this.candidates.values().next().value??null;}
  private current(c:Candidate){return this.candidates.get(c.scope.mint)===c;}
  private activeCandidates(){return [...this.candidates.values()].filter(c=>!c.suspended);}
  private readonly legs:Record<FeedName,Leg>={discovery:{name:'discovery',desired:false,connected:false,connecting:false,attempts:0,failures:0,reconnects:0,notBefore:0},pumpapi:{name:'pumpapi',desired:false,connected:false,connecting:false,attempts:0,failures:0,reconnects:0,notBefore:0}};
  private readonly rollingPump=new PersistentDataWindow(128*MIB);private readonly rollingDiscovery=new PersistentDataWindow(2*MIB);private pumpBytes=0;private discoveryBytes=0;private controlBytes=0;private frames=0;private irrelevant=0;private selectedFrames=0;private recordedBytes=0;private trades=0;private gaps=0;private rawParses=0;private firstFailure:string|null=null;private lastAnyTrafficAt:number|null=null;private candidateRetryAt=0;private readonly migrationSeen=new Map<string,number>();
  constructor(private readonly options:PilotFeedsOptions,private readonly dependencies:PilotFeedDependencies={}){
    this.now=dependencies.now??Date.now;this.mono=dependencies.monotonic??(()=>performance.now());this.timer=dependencies.setTimer??((cb,ms)=>setTimeout(cb,ms));this.cancel=dependencies.clearTimer??(id=>clearTimeout(id as ReturnType<typeof setTimeout>));this.startedAt=this.now();this.startedMono=this.mono();
    const researchProfile=resolveNativeResearchProfile(options.profile);
    this.duration=options.durationMs??researchProfile?.durationMs??1800000;this.pumpLimit=options.maxPumpApiBytes??researchProfile?.broadWatchBytes??1024*MIB;this.discoveryLimit=options.maxDiscoveryBytes??researchProfile?.discoveryBytes??5*MIB;this.recordLimit=options.maximumRecordedBytes??researchProfile?.feedRecordedBytes??6*MIB;
    need(Number.isSafeInteger(this.duration)&&this.duration>0&&this.duration<=(researchProfile?.maximumDurationMs??1800000)&&Number.isSafeInteger(this.pumpLimit)&&this.pumpLimit>=4*MIB&&this.pumpLimit<=(researchProfile?.broadWatchBytes??1024*MIB)&&Number.isSafeInteger(this.discoveryLimit)&&this.discoveryLimit>=256*1024&&this.discoveryLimit<=(researchProfile?.discoveryBytes??5*MIB)&&Number.isSafeInteger(this.recordLimit)&&this.recordLimit>=64*1024&&this.recordLimit<=(researchProfile?.feedRecordedBytes??PILOT_FEED_MAXIMUM_RECORDED_BYTES)&&Number.isSafeInteger(options.maximumCandidates??1)&&(options.maximumCandidates??1)>=1&&(options.maximumCandidates??1)<=(researchProfile?.maximumDeep??20)&&['curve','user'].includes(options.amountConvention),'PILOT_FEED_INVALID_LIMITS');
    need(options.persistent===undefined||typeof options.persistent==='boolean','PILOT_FEED_INVALID_PERSISTENCE');this.maximumCandidates=options.maximumCandidates??1;
    this.amountConvention=options.amountConvention;
    this.scheduleWatch();
  }
  private record(kind:string,data:unknown){const n=Buffer.byteLength(JSON.stringify({kind,data}));need(this.options.persistent||this.recordedBytes+n+4096<=this.recordLimit,'PILOT_FEED_EVIDENCE_CAP');this.recordedBytes+=n;this.options.record(kind,data);}
  private gap(reason:string,mint?:string){this.gaps++;this.firstFailure??=reason;try{this.options.onGap({...(mint?{mint}:{}),reason,at:this.now()});}catch{this.firstFailure='PILOT_GAP_CALLBACK_FAILED';this.controller.abort();for(const c of this.candidates.values()){c.suspended=true;c.controller.abort();}for(const leg of Object.values(this.legs)){leg.desired=false;this.closeLeg(leg,'PILOT_GAP_CALLBACK_FAILED',true);}}}
  private backgroundStop(){void this.stop().catch(e=>{this.firstFailure??=safe(e);this.gap(safe(e));});}
  private live(){return !this.stopped&&!this.controller.signal.aborted&&(this.options.persistent||this.now()-this.startedAt<this.duration&&this.mono()-this.startedMono<this.duration);}
  private scheduleWatch(){this.watch=this.timer(()=>{try{
    if(!this.live()){this.gap('PILOT_FEED_DURATION_LIMIT');this.backgroundStop();return;}
    for(const c of this.activeCandidates()){
      if(!this.options.persistent&&this.mono()-c.selectedMono>=CANDIDATE_MS)this.invalidate(c,'PILOT_CANDIDATE_OBSERVATION_LIMIT');
      else{c.pipeline.tick(this.now());const head=c.pipeline.peekHint();if(head&&this.now()>head.deadlineAt){c.pipeline.refuseHint(head.hint.signature,'PILOT_SELECTED_ENRICHMENT_QUEUE_EXPIRED',this.now());}}
    }
    const p=this.legs.pumpapi;if(p.connected&&p.connection&&this.mono()-p.connection.lastTrafficMono>15000)this.closeLeg(p,'PILOT_PUMPAPI_NO_TRANSPORT_RECEIPT',false);
  }catch(e){this.firstFailure??=safe(e);this.invalidateAll(safe(e));}finally{if(this.live())this.scheduleWatch();}},100);}
  private makeCandidate(scope:ActiveScope,selectedMono=this.mono()):Candidate{
    const mint=new PublicKey(scope.mint);need(canonicalPumpPoolPda(mint).toBase58()===scope.pool&&typeof scope.supportedPoolEvidence==='string'&&scope.supportedPoolEvidence.length>0&&scope.supportedPoolEvidence.length<=512,'PILOT_CANDIDATE_SUPPORTED_SCOPE_REQUIRED');
    const c={} as Candidate;c.generation=++this.generation;c.scope={...scope};c.controller=new AbortController();c.selectedMono=selectedMono;c.suspended=false;c.pending=new Set();c.normalized=0;c.mintBytes=Buffer.from(scope.mint);c.poolBytes=Buffer.from(scope.pool);c.latestFeature=null;
    c.pipeline=new ActivePipeline({scope,now:this.now,record:(kind,data)=>{
      this.record(kind,data);
      if(kind==='research-feature-view')c.latestFeature=data as FeatureRow;
      if(kind==='research-quality-gap'){this.invalidate(c,'PILOT_'+String((data as any).reason).toUpperCase().replace(/[^A-Z0-9_]/g,'_'));return;}
      if(kind==='research-normalized-trade'){
        const row=data as any,validatedAt=this.now(),signature=row.executedEvidence.identity.signature,hintAt=row.executedEvidence.providerReceivedAt;
        if(!this.current(c)||c.suspended||!this.live()||hintAt===null||validatedAt-hintAt>5000){this.invalidate(c,'PILOT_SELECTED_VALIDATION_UNAVAILABLE_OR_LATE');return;}
        const trade={...row[this.amountConvention].trade,receivedAt:validatedAt},evidence={...row.executedEvidence,rpcAvailableAt:row.rpcAvailableAt};
        this.options.onTrade({evidence,trade,validatedAt});this.trades++;c.normalized++;c.pending.delete(signature);
      }
    }});return c;
  }
  private invalidate(c:Candidate,reason:string,sharedRetryAt?:number){
    if(c.suspended)return;c.suspended=true;c.controller.abort();
    const retry=sharedRetryAt??Math.max(this.legs.pumpapi.notBefore,this.now()+BACKOFF[Math.min(this.legs.pumpapi.failures++,BACKOFF.length-1)]!);
    this.candidateRetryAt=Math.max(this.candidateRetryAt,retry);this.retryByMint.set(c.scope.mint,retry);this.gap(reason,c.scope.mint);
    if(this.current(c)&&this.activeCandidates().length===0&&!this.watchActivityDesired){this.legs.pumpapi.desired=false;this.closeLeg(this.legs.pumpapi,reason,true);}
  }
  private invalidateAll(reason:string){const selected=this.activeCandidates();if(!selected.length){if(this.watchActivityDesired)this.gap(reason);return;}const retry=Math.max(this.legs.pumpapi.notBefore,this.now()+BACKOFF[Math.min(this.legs.pumpapi.failures++,BACKOFF.length-1)]!);for(const c of selected)this.invalidate(c,reason,retry);}
  async startDiscovery(signal?:AbortSignal){need(this.live(),'PILOT_FEEDS_CLOSED');if(signal?.aborted)throw Error('PILOT_FEED_ABORTED');signal?.addEventListener('abort',()=>this.backgroundStop(),{once:true});this.legs.discovery.desired=true;await this.connect(this.legs.discovery);}
  /** Keep the existing broad WATCH scheduling hints without registering any
   * legacy deep candidate or getTransaction enrichment. Required native deep
   * events are collected through PilotNativeFlow, not through these hints. */
  async startWatchActivity(signal?:AbortSignal){need(this.live(),'PILOT_FEEDS_CLOSED');need(!!this.options.watchedIdentities&&!!this.options.onWatchActivity,'PILOT_WATCH_ACTIVITY_CALLBACKS_REQUIRED');if(signal?.aborted)throw Error('PILOT_FEED_ABORTED');signal?.addEventListener('abort',()=>this.backgroundStop(),{once:true});this.watchActivityDesired=true;this.legs.pumpapi.desired=true;await this.connect(this.legs.pumpapi);}
  /** Legacy API deliberately retains replacement behavior, even when explicit
   * multi-candidate mode is selected. addCandidate is the only additive API. */
  async selectCandidate(scope:ActiveScope){need(this.live(),'PILOT_FEEDS_CLOSED');this.checkCandidateBackoff(scope.mint);await this.clearCandidate('PILOT_CANDIDATE_REPLACED');await this.addCandidate(scope);}
  private checkCandidateBackoff(mint:string){need(this.now()>=Math.max(this.retryByMint.get(mint)??0,this.legs.pumpapi.notBefore,this.legs.pumpapi.connected?0:this.candidateRetryAt),'PILOT_CANDIDATE_RECONNECT_BACKOFF');}
  async addCandidate(scope:ActiveScope){
    need(this.live(),'PILOT_FEEDS_CLOSED');this.checkCandidateBackoff(scope.mint);
    const old=this.candidates.get(scope.mint);if(old&&!old.suspended){need(JSON.stringify(old.scope)===JSON.stringify(scope),'PILOT_CANDIDATE_SCOPE_CONFLICT');return;}
    need(old||this.candidates.size<this.maximumCandidates,'PILOT_CANDIDATE_CAPACITY');
    for(const [mint,at]of this.retryByMint)if(at<=this.now()&&!this.candidates.has(mint))this.retryByMint.delete(mint);
    need(this.retryByMint.has(scope.mint)||this.retryByMint.size<256,'PILOT_CANDIDATE_RETRY_RECORD_CAP');
    const c=this.makeCandidate(scope);old?.controller.abort();this.candidates.set(scope.mint,c);this.legs.pumpapi.desired=true;
    if(this.legs.pumpapi.connected){try{const at=this.now();c.pipeline.open(at);this.options.onFlowOpen?.(scope.mint,at);}catch(e){this.invalidate(c,safe(e));throw e;}}else await this.connect(this.legs.pumpapi);
  }
  async removeCandidate(mint:string,reason='PILOT_CANDIDATE_CLEARED',options:{waitForSettlement?:boolean}={}){
    const c=this.candidates.get(mint);if(c){c.suspended=true;c.controller.abort();this.candidates.delete(mint);this.gap(reason,c.scope.mint);this.record('pilot-candidate-cleared',{mint:c.scope.mint,at:this.now(),reason,pending:c.pending.size,normalized:c.normalized});}
    if(this.activeCandidates().length||this.watchActivityDesired)return;
    const leg=this.legs.pumpapi;leg.desired=false;if(leg.timer!==undefined){this.cancel(leg.timer);leg.timer=undefined;}this.closeLeg(leg,reason,true);if(options.waitForSettlement!==false&&leg.connection&&!leg.connection.closed)await this.waitClosed(leg.connection);
  }
  async clearCandidate(reason='PILOT_CANDIDATE_CLEARED'){
    for(const mint of [...this.candidates.keys()])await this.removeCandidate(mint,reason);
    // A separately requested WATCH stream does not belong to a legacy candidate.
    if(this.watchActivityDesired)return;
    // Also close an in-progress physical upgrade when no candidate remains.
    const leg=this.legs.pumpapi;leg.desired=false;if(leg.timer!==undefined){this.cancel(leg.timer);leg.timer=undefined;}this.closeLeg(leg,reason,true);if(leg.connection&&!leg.connection.closed)await this.waitClosed(leg.connection);
  }
  /** Earliest deadline first. Registration order breaks equal-deadline ties;
   * no queued trade is removed until the caller actually dispatches it. */
  peekHint(){
    if(this.enriching||!this.legs.pumpapi.connected)return null;
    const rows=this.activeCandidates().flatMap(c=>{const p=c.pipeline.peekHint();return p?[{...p,id:p.hint.signature,mint:c.scope.mint,eligible:this.now()>=p.eligibleAt&&this.now()<=p.deadlineAt}]:[];});
    rows.sort((a,b)=>a.deadlineAt-b.deadlineAt||a.eligibleAt-b.eligibleAt);return rows[0]??null;
  }
  async enrichNext(rpc:PilotFeedRpc,signal?:AbortSignal,request:PilotRpcCallOptions={}){
    const next=this.peekHint();if(!next?.eligible)return [];
    const selected=this.activeCandidates().flatMap(c=>{const p=c.pipeline.peekHint();if(p?.hint.signature!==next.hint.signature||this.now()<p.eligibleAt)return [];const hint=c.pipeline.nextHint(this.now());return hint?[{c,hint}]:[];});
    if(!selected.length)return [];this.enriching=true;
    // One confirmed response serves all currently eligible same-signature heads.
    // Other scopes remain independent; a later hint is not backdated or sampled.
    const active=AbortSignal.any([this.controller.signal,...(signal?[signal]:[])]),requestedAt=this.now(),deadline=Math.min(...selected.map(s=>s.hint.receivedAt+5000));
    const current=()=>selected.some(({c})=>this.current(c)&&!c.suspended);
    try{
      const transaction=await rpc.call<any>('getTransaction',[next.hint.signature,{encoding:'json',commitment:'confirmed',maxSupportedTransactionVersion:1}],active,{...request,latestStartAt:Math.min(request.latestStartAt??Infinity,deadline-1),admissionOpen:()=>this.live()&&current()&&this.now()<=deadline&&(request.admissionOpen?.()??true)}),rpcAvailableAt=this.now();
      this.record('pilot-confirmed-enrichment',{hint:selected[0]!.hint,selectedHints:selected.map(({c,hint})=>({mint:c.scope.mint,...hint})),requestedAt,rpcAvailableAt,transaction});const mapped:MappedTradeEvidence[]=[];
      for(const {c,hint}of selected){if(!this.current(c)||c.suspended)continue;mapped.push(...c.pipeline.completeHint(hint,transaction,rpcAvailableAt));c.pending.delete(hint.signature);}return mapped;
    }catch(e){for(const {c}of selected)if(this.current(c)&&!c.suspended&&this.legs.pumpapi.connected)c.pipeline.failHint('pilot-confirmed-enrichment-unavailable',this.now());throw e;}
    finally{this.enriching=false;}
  }
  private reconnect(leg:Leg){
    if(!this.live()||!leg.desired||leg.timer!==undefined)return;if(!this.options.persistent&&(leg.attempts>=9||leg.reconnects>=8)){leg.desired=false;if(leg.name==='pumpapi')this.invalidateAll('PILOT_PUMPAPI_RECONNECT_LIMIT');else this.gap('PILOT_DISCOVERY_RECONNECT_LIMIT');return;}
    const delay=Math.max(BACKOFF[Math.min(leg.failures++,BACKOFF.length-1)]!,leg.notBefore-this.now());leg.reconnects++;try{this.record('pilot-feed-reconnect-scheduled',{feed:leg.name,at:this.now(),delayMs:delay,desiredSubscriptions:leg.name==='discovery'?['subscribeMigration']:[],requiresFreshCandidateWindow:leg.name==='pumpapi'});}catch{leg.desired=false;this.gap('PILOT_FEED_EVIDENCE_CAP',leg.name==='pumpapi'?this.candidate?.scope.mint:undefined);return;}leg.timer=this.timer(()=>{leg.timer=undefined;void this.connect(leg).catch(()=>{});},delay);
  }
  private closeLeg(leg:Leg,reason:string,expected:boolean){const c=leg.connection;if(!c||c.closed)return;c.closeReason??=reason;c.expectedClose=expected;leg.connected=false;c.socket.terminate();}
  private sample(leg:Leg,c:Connection,atUpgrade=false,override?:number){
    const n=override??(c.socket as unknown as {_socket?:{bytesRead:number}})._socket?.bytesRead;need(Number.isSafeInteger(n)&&Number(n)>=c.seen,'PILOT_FEED_SOCKET_COUNTER');const delta=Number(n)-c.seen;c.seen=Number(n);if(delta){c.lastTrafficMono=this.mono();this.lastAnyTrafficAt=this.now();}
    if(leg.name==='pumpapi'){this.pumpBytes+=delta;if(atUpgrade){for(let left=delta;left;){const d=Math.min(left,65536);this.options.control.accountControlBytes(d);this.controlBytes+=d;left-=d;}}if(this.options.persistent){const traffic=this.rollingPump.observe(this.mono(),delta);if(traffic.pressure&&!c.closeReason){leg.notBefore=Math.max(leg.notBefore,this.now()+traffic.recoveryAfterMs);this.closeLeg(leg,'PILOT_PUMPAPI_ROLLING_TRAFFIC_PRESSURE',false);this.invalidateAll('PILOT_PUMPAPI_ROLLING_TRAFFIC_PRESSURE');}}else if(this.pumpBytes>=this.pumpLimit-2*MIB){leg.desired=false;this.closeLeg(leg,'PILOT_PUMPAPI_BYTE_LIMIT',true);this.invalidateAll('PILOT_PUMPAPI_BYTE_LIMIT');}}
    else{this.discoveryBytes+=delta;for(let left=delta;left;){const d=Math.min(left,65536);this.options.control.accountControlBytes(d);this.controlBytes+=d;left-=d;}if(this.options.persistent){const traffic=this.rollingDiscovery.observe(this.mono(),delta);if(traffic.pressure&&!c.closeReason){leg.notBefore=Math.max(leg.notBefore,this.now()+traffic.recoveryAfterMs);this.closeLeg(leg,'PILOT_DISCOVERY_ROLLING_TRAFFIC_PRESSURE',false);this.gap('PILOT_DISCOVERY_ROLLING_TRAFFIC_PRESSURE');}}else if(this.discoveryBytes>=this.discoveryLimit-128*1024){leg.desired=false;this.closeLeg(leg,'PILOT_DISCOVERY_BYTE_LIMIT',true);this.gap('PILOT_DISCOVERY_BYTE_LIMIT');}}
  }
  /** The public broad stream has already been received and charged. A cached
   * lookup gives O(1) identity matching rather than scanning150 watch strings
   * per frame. Ordinary transport fields only trigger a fresh deep window;
   * they do not establish a swap, commitment, trader, amount or buying score.
   * Escaped/unusual field encodings may miss this best-effort hint; periodic
   * watch revisits must remain independent of notification completeness. */
  private observeWatchActivity(bytes:Buffer,receivedAt:number){
    if(!this.options.watchedIdentities||!this.options.onWatchActivity)return;
    const started=performance.now();this.watchFrames++;
    try{
      if(receivedAt>=this.watchRefreshAt){
        this.watchRefreshAt=receivedAt+1000;
        const identities=this.options.watchedIdentities();need(Array.isArray(identities)&&identities.length<=512,'PILOT_WATCH_IDENTITY_CAP');
        this.watchIdentities.clear();
        for(const row of identities){need(row&&typeof row.mint==='string'&&typeof row.pool==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.pool),'PILOT_WATCH_IDENTITY');this.watchIdentities.set(row.mint,{mint:row.mint,pool:row.pool});}
        for(const mint of this.watchLastEmitted.keys())if(!this.watchIdentities.has(mint)){this.watchLastEmitted.delete(mint);this.watchLastSignature.delete(mint);}
      }
      if(!this.watchIdentities.size)return;
      // Pre-filter only. JSON parsing below verifies the actual top-level keys,
      // so nested metadata or an escaped text match cannot create a watch hint.
      const text=bytes.toString(),mint=/"mint"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,44})"/.exec(text)?.[1];
      if(!mint)return;const identity=this.watchIdentities.get(mint);if(!identity||receivedAt-(this.watchLastEmitted.get(mint)??-Infinity)<10000)return;
      this.watchParses++;let payload:any;try{payload=JSON.parse(text);}catch{return;}
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.mint!==identity.mint||payload.poolId!==identity.pool)return;
      let signature:string|undefined;try{if(typeof payload.signature==='string'&&payload.signature.length<=100&&bs58.decode(payload.signature).length===64)signature=payload.signature;}catch{}
      if(!signature||this.watchLastSignature.get(mint)===signature)return;
      this.watchLastEmitted.set(mint,receivedAt);this.watchLastSignature.set(mint,signature);
      this.options.onWatchActivity({mint:identity.mint,pool:identity.pool,signature,receivedAt,evidence:'unverified-pumpapi-activity-hint'});this.watchHints++;
    }catch{this.watchFailures++;}
    finally{this.watchProcessingMs+=performance.now()-started;}
  }
  private message(leg:Leg,c:Connection,raw:WebSocket.RawData){
    if(c.closed||leg.connection!==c||!this.live())return;const receivedAt=this.now(),b=Array.isArray(raw)?Buffer.concat(raw):Buffer.from(raw as ArrayBuffer);this.frames++;this.sample(leg,c);need(b.length<=65536,'PILOT_FEED_PAYLOAD_LIMIT');if(!leg.desired||c.closeReason)return;
    if(leg.name==='discovery'){
      const p=JSON.parse(b.toString());if(p?.message==="Subscribed to 'migration' events."){c.ack?.();return;}if(p?.txType!=='migrate')return;
      need(typeof p.signature==='string'&&p.signature.length<=100&&bs58.decode(p.signature).length===64,'PILOT_DISCOVERY_SIGNATURE');if(this.migrationSeen.has(p.signature))return;
      for(const [sig,at]of this.migrationSeen)if(at<receivedAt-300000)this.migrationSeen.delete(sig);if(this.migrationSeen.size>=256)this.migrationSeen.delete(this.migrationSeen.keys().next().value!);this.migrationSeen.set(p.signature,receivedAt);
      let feedMint:string|undefined;try{if(typeof p.mint==='string'&&new PublicKey(p.mint).toBase58()===p.mint)feedMint=p.mint;}catch{}
      const seed={signature:p.signature,...(feedMint?{feedMint}:{}),receivedAt};this.record('pilot-migration-hint',{...seed,commitment:'processed',identityVerified:false});this.options.onMigration(seed);return;
    }
    this.observeWatchActivity(b,receivedAt);
    const active=this.activeCandidates(),possible=active.filter(candidate=>b.includes(candidate.mintBytes)||b.includes(candidate.poolBytes));if(!possible.length){this.irrelevant++;return;}
    this.rawParses++;let payload:any;
    try{payload=JSON.parse(b.toString());need(payload&&typeof payload==='object'&&!Array.isArray(payload),'PILOT_SELECTED_PAYLOAD_SHAPE');}
    catch(e){for(const candidate of possible)this.invalidate(candidate,safe(e));return;}
    const selected=possible.filter(candidate=>payload.poolId===candidate.scope.pool||payload.mint===candidate.scope.mint&&(payload.poolId===undefined||payload.poolId===null));if(!selected.length){this.irrelevant++;return;}
    this.selectedFrames++;this.record('pilot-selected-pumpapi-payload',{receivedAt,payloadUtf8:b.toString(),sha256:createHash('sha256').update(b).digest('hex'),selectedMints:selected.map(c=>c.scope.mint)});
    for(const candidate of selected){
      // Keep the previous sixteen-hint aggregate ceiling. Extra scopes never
      // silently multiply the required enrichment backlog or discard a trade.
      if(!candidate.pending.has(payload.signature)&&this.activeCandidates().reduce((n,c)=>n+c.pending.size,0)>=16){this.invalidate(candidate,'PILOT_AGGREGATE_ENRICHMENT_CAPACITY');continue;}
      try{const result=candidate.pipeline.observe(payload,receivedAt);if(result==='queued'){candidate.pending.add(payload.signature);this.options.onHint?.(candidate.scope.mint,receivedAt);}if(result==='invalid')this.invalidate(candidate,'PILOT_SELECTED_FIELDS_UNAVAILABLE');}
      catch(e){this.invalidate(candidate,safe(e));}
    }
  }

  private async connect(leg:Leg){
    if(!this.live()||!leg.desired||leg.connecting||leg.connected)return;if(this.now()<leg.notBefore){this.reconnect(leg);return;}const admission=this.options.admitControl?.()??{};if(admission===false){this.reconnect(leg);return;}if(leg.connection&&!leg.connection.closed){this.reconnect(leg);return;}leg.connecting=true;
    try{
      await this.options.control.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>new Promise<void>((resolve,reject)=>{
        const endpoint=leg.name==='discovery'?DISCOVERY:PUMPAPI_STREAM,config:WebSocket.ClientOptions={agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:65536,perMessageDeflate:false,followRedirects:false,handshakeTimeout:1200},ws=this.dependencies.makeSocket?.(endpoint,config)??new WebSocket(endpoint,config);let resolveClosed!:()=>void;const closedPromise=new Promise<void>(r=>{resolveClosed=r;}),c:Connection={socket:ws,seen:0,closed:false,opened:false,expectedClose:false,closeReason:null,lastTrafficMono:this.mono(),closedPromise,resolveClosed,upgradeReject:reject};leg.connection=c;leg.attempts++;
        const abort=()=>this.closeLeg(leg,'PILOT_FEED_OPERATION_ABORTED',false);op.signal.addEventListener('abort',abort,{once:true});
        ws.on('open',()=>{try{this.sample(leg,c,true);need(this.live()&&leg.desired&&!c.closeReason,'PILOT_FEED_OPEN_UNAVAILABLE');const rawSocket=(ws as unknown as {_socket?:{prependListener?:(name:string,cb:()=>void)=>void}})._socket;need(rawSocket?.prependListener,'PILOT_FEED_PREPARSE_COUNTER_REQUIRED');rawSocket!.prependListener!('data',()=>{try{this.sample(leg,c);}catch(e){this.closeLeg(leg,safe(e),false);}});c.opened=true;leg.connected=true;leg.failures=0;if(leg.name==='pumpapi'){const selected=this.activeCandidates();need(selected.length>0||this.watchActivityDesired,'PILOT_NO_CANDIDATE');const at=this.now();for(const old of selected){const fresh=this.makeCandidate(old.scope,old.selectedMono);old.controller.abort();this.candidates.set(old.scope.mint,fresh);fresh.pipeline.open(at);this.options.onFlowOpen?.(fresh.scope.mint,at);}}this.record('pilot-feed-open',{feed:leg.name,at:this.now(),endpoint,connection:leg.attempts,dataOnly:true,paidSubscriptions:0});op.signal.removeEventListener('abort',abort);c.upgradeReject=undefined;op.completeResponse();resolve();}catch(e){this.closeLeg(leg,safe(e),false);}});
        ws.on('message',raw=>{try{this.message(leg,c,raw);}catch(e){if(leg.name==='pumpapi')this.invalidateAll(safe(e));else{leg.desired=false;this.gap(safe(e));}this.closeLeg(leg,safe(e),false);}});
        ws.on('unexpected-response',(_req,response)=>{let reason=response.statusCode===429?'COMPONENT_HTTP_429':'PILOT_FEED_UPGRADE_REFUSED';try{this.sample(leg,c,true,response.socket?.bytesRead);if(response.statusCode===429){const until=this.options.control.noteThrottle(String(response.headers['retry-after']??'')||null,this.now());need(Number.isSafeInteger(until)&&until>=this.now(),'PILOT_FEED_COOLDOWN_INVALID');leg.notBefore=Math.max(leg.notBefore,until);}else leg.desired=false;}catch(e){reason=safe(e);leg.desired=false;if(leg.name==='pumpapi')this.invalidateAll(reason);else this.gap(reason);}finally{c.closeReason=reason;response.destroy();ws.terminate();}});
        ws.on('error',()=>{c.closeReason??='COMPONENT_WS_TRANSPORT';ws.terminate();});
        ws.on('close',()=>{if(c.closed)return;try{this.sample(leg,c);}catch{c.closeReason??='PILOT_FEED_SOCKET_COUNTER';}c.closed=true;leg.connected=false;op.signal.removeEventListener('abort',abort);c.resolveClosed();const reason=c.closeReason??'COMPONENT_WS_TRANSPORT',controlReason=reason.startsWith('COMPONENT_')?reason:c.expectedClose?'COMPONENT_ABORTED':!c.opened?'COMPONENT_WS_TRANSPORT':reason,error=Error(controlReason);c.upgradeReject?.(error);c.subscriptionReject?.(error);if(!c.expectedClose&&this.live()&&leg.desired){if(leg.name==='pumpapi'){this.invalidateAll(reason);if(this.watchActivityDesired&&leg.desired)this.reconnect(leg);}else{this.gap(reason);this.reconnect(leg);}}});
      }),this.controller.signal,{timeoutMs:1500,...admission});
      if(leg.name==='discovery'){
        const c=leg.connection!;await this.options.control.operateData({transport:'ws',method:'subscribeMigration'},async op=>new Promise<void>((resolve,reject)=>{if(c.closed||!this.live()||!leg.desired){reject(Error('COMPONENT_WS_TRANSPORT'));return;}c.subscriptionReject=reject;const abort=()=>this.closeLeg(leg,'COMPONENT_WS_TRANSPORT',false);op.signal.addEventListener('abort',abort,{once:true});c.ack=()=>{c.ack=undefined;c.subscriptionReject=undefined;op.signal.removeEventListener('abort',abort);op.completeResponse();resolve();};try{c.socket.send(dataMessage('subscribeMigration'),e=>{if(e)this.closeLeg(leg,'COMPONENT_WS_TRANSPORT',false);});}catch{this.closeLeg(leg,'COMPONENT_WS_TRANSPORT',false);}}),this.controller.signal,{timeoutMs:1500,...admission});
      }
    }catch(e){this.firstFailure??=safe(e);this.closeLeg(leg,safe(e),false);this.reconnect(leg);throw e;}
    finally{leg.connecting=false;}
  }
  private async waitClosed(c:Connection){if(c.closed)return;let id:unknown;try{await Promise.race([c.closedPromise,new Promise<never>((_r,reject)=>{id=this.timer(()=>reject(Error('PILOT_FEED_TRANSPORT_UNSETTLED')),2500);})]);}finally{if(id!==undefined)this.cancel(id);}}
  /** Equivalent current readiness without the full diagnostic projection. */
  readiness(mint?:string){const c=mint===undefined?this.candidate:this.candidates.get(mint);if(!c)return null;const state=c.pipeline.readiness(this.now()),last=state.latestFeature;return {...state,pending:c.pending.size,fullyEnriched:c.pending.size===0&&!c.suspended,warm:!c.suspended&&last?.curve.sufficientlyObserved===true&&last?.user.sufficientlyObserved===true,windowEndAt:last?.curve.windowEndAt??null,hasQualityLoss:c.suspended||state.hasQualityLoss,failedCandidate:c.suspended};}
  snapshot(mint?:string){const c=mint===undefined?this.candidate:this.candidates.get(mint);if(!c)return null;const state=c.pipeline.snapshot(this.now(),{recordFeatures:false}),last=state.latestFeature,fullyEnriched=c.pending.size===0&&!c.suspended;return {...state,latestFeature:last,pending:c.pending.size,fullyEnriched,warm:!c.suspended&&last?.curve.sufficientlyObserved===true&&last?.user.sufficientlyObserved===true,windowEndAt:last?.curve.windowEndAt??null,hasQualityLoss:c.suspended||state.qualityGaps.length>0,failedCandidate:c.suspended};}
  snapshots(){return Object.fromEntries([...this.candidates.keys()].map(mint=>[mint,this.snapshot(mint)]));}
  usage(){return {persistent:this.options.persistent===true,lifetimeCapsEnabled:this.options.persistent!==true,rollingTraffic:{pumpapi:this.rollingPump.view(this.mono()),discovery:this.rollingDiscovery.view(this.mono())},maximumCandidates:this.maximumCandidates,watchActivity:{requested:this.watchActivityDesired,semantics:this.watchActivityDesired?'unverified selection hints only; explicitly requested broad WATCH stream, independent of selected deep observations':'unverified selection hints only; observed only while a deep stream is already open',knownIdentities:this.watchIdentities.size,framesExamined:this.watchFrames,matchedPayloadParses:this.watchParses,hints:this.watchHints,failures:this.watchFailures,processingMs:this.watchProcessingMs,coalesceMs:10000},candidates:[...this.candidates.values()].map(c=>({mint:c.scope.mint,pool:c.scope.pool,suspended:c.suspended,pending:c.pending.size,normalized:c.normalized,selectedForMs:this.mono()-c.selectedMono})),enrichmentInFlight:this.enriching,startedAt:this.startedAt,durationMs:this.duration,stopped:this.stopped,firstFailure:this.firstFailure,pumpApiSocketBytes:this.pumpBytes,discoverySocketBytes:this.discoveryBytes,controlBytesCharged:this.controlBytes,totalSocketBytes:this.pumpBytes+this.discoveryBytes,lastAnyTrafficAt:this.lastAnyTrafficAt,frames:this.frames,irrelevantFrames:this.irrelevant,selectedFrames:this.selectedFrames,parsedPumpApiFrames:this.rawParses,recordedBytes:this.recordedBytes,normalizedTrades:this.trades,gaps:this.gaps,discoveryConnected:this.legs.discovery.connected,pumpApiConnected:this.legs.pumpapi.connected,discoveryDesired:this.legs.discovery.desired,pumpApiDesired:this.legs.pumpapi.desired,failedCandidate:[...this.candidates.values()].some(c=>c.suspended),candidateRetryAt:this.candidateRetryAt,connections:{discovery:this.legs.discovery.attempts,pumpapi:this.legs.pumpapi.attempts},candidate:this.candidate?{mint:this.candidate.scope.mint,pool:this.candidate.scope.pool,suspended:this.candidate.suspended,pending:this.candidate.pending.size,normalized:this.candidate.normalized,selectedForMs:this.mono()-this.candidate.selectedMono}:null,physicalTransportsSettled:Object.values(this.legs).every(l=>!l.connection||l.connection.closed),streamFieldCompleteness:'REQUIRES_BOUNDED_INDEPENDENT_AUDIT',liveTrading:false};}
  async stop(){if(!this.stopped){this.stopped=true;this.watchActivityDesired=false;this.controller.abort();this.cancel(this.watch);for(const c of this.candidates.values())c.controller.abort();for(const leg of Object.values(this.legs)){leg.desired=false;if(leg.timer!==undefined)this.cancel(leg.timer);this.closeLeg(leg,'PILOT_FEEDS_STOP',true);}}await Promise.all(Object.values(this.legs).map(l=>l.connection?this.waitClosed(l.connection):Promise.resolve()));}
}
