import {createServer,createConnection,type Server as SocketServer} from 'node:net';
import {chmodSync,closeSync,existsSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {PublicKey} from '@solana/web3.js';
import {PaperLedger,type LedgerState,type Mark,type UsdPrice,type ReportingHistory} from './ledger.js';
import {Recorder} from './recorder.js';
import {dataMessage} from './network.js';
import {SnapshotPublisher,validateSnapshot,type ReportingIdentity,type Snapshot} from './reporting.js';

const BLOCKER='FLOW_NOT_VERIFIED_BILLING_NOT_CONFIRMED';
const iso=(at:number)=>new Date(at).toISOString();
const micro=(amount:string|null)=>amount===null?null:Number(BigInt(amount))/1_000_000;
const sol=(amount:string)=>{const n=BigInt(amount);return `${n/1_000_000_000n}.${(n%1_000_000_000n).toString().padStart(9,'0')}`;};
type Candidate={mint:string;signature:string;firstReceivedAt:number;lastReceivedAt:number;window:'unavailable';};
type Publisher=Pick<SnapshotPublisher,'offer'|'start'|'stop'>;
type Feed=Pick<WebSocket,'on'|'send'|'terminate'|'readyState'>;
export type RuntimeOptions={
  ledger:PaperLedger; directory:string; socketPath:string; release:string;
  /** Injected adapters must implement bounded request timeouts/cancellation. */
  priceProvider?:()=>Promise<UsdPrice|null>;
  /** Actual-size conservative liquidation; adapters must bound/cancel requests. */
  markProvider?:(positions:LedgerState['positions'])=>Promise<Record<string,Mark>>;
  publisher?:Publisher;
  /** Optional nonsecret local read model; directory is provisioned separately. */
  publicStatusPath?:string;
  feedFactory?:()=>Feed;
  connectFeed?:boolean;
  tickMs?:number;
  now?:()=>number;
};

/** One financial owner and bounded observer. No strategy/fill path is enabled.
 * This scaffold is NOT an accepted autonomous trader: funded flow verification,
 * deterministic rules and supported exit execution still have to be connected.
 */
export class PaperObservationRuntime {
  private readonly now:()=>number;
  private readonly epoch=randomUUID();
  private readonly identity:ReportingIdentity;
  private readonly recorder:Recorder;
  private readonly candidates=new Map<string,Candidate>();
  private readonly seen=new Set<string>();
  private readonly lag=monitorEventLoopDelay({resolution:20});
  private feed:Feed|undefined;
  private server:SocketServer|undefined;
  private ownsSocket=false;
  private reconnect:ReturnType<typeof setTimeout>|undefined;
  private timer:ReturnType<typeof setInterval>|undefined;
  private currentTick:Promise<void>|undefined;
  private running=false;
  private closed=false;
  private connected=false;
  private attempts=0;
  private marketError:string|null=null;
  private reportError=false;
  private publicStatusUnavailable=false;
  private price:UsdPrice|null=null;
  private marks:Record<string,Mark>={};
  private lastUsefulAt:number|null=null;
  private lastMigrationReceivedAt:number|null=null;
  private lastSnapshotAt=0;
  private lastHistoryAt=0;
  private history:Snapshot['pnl']=[];
  private historyWindowLimited=false;
  private historyCompacted=false;
  private discovered=0;
  private received=0;
  private selected=0;

  constructor(private readonly options:RuntimeOptions){
    this.now=options.now??Date.now;
    const state=options.ledger.state(); // Never initializes or reseeds.
    if(state.mode!=='PAPER')throw new Error('authoritative PAPER identity required');
    if(!options.release||options.release.length>128)throw new Error('source release required');
    if((options.tickMs??5000)<1000)throw new Error('bounded runtime cadence required');
    mkdirSync(options.directory,{recursive:true,mode:0o700});
    const dir=lstatSync(options.directory);
    if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==process.getuid?.()||(dir.mode&0o077)!==0)throw new Error('runtime directory must be private and owned by runtime user');
    this.identity={accountId:state.accountId,inceptionAt:iso(state.inceptionAt),release:options.release,strategy:'UNIMPLEMENTED_FLOW_BLOCKED'};
    this.restoreMarketCache();
    this.recorder=new Recorder(resolve(options.directory,'selected-evidence.ndjson'));
    this.recorder.record('runtime-recovery',{epoch:this.epoch,accountId:state.accountId,release:options.release,financialRevision:state.revision,openPositions:Object.keys(state.positions).length,pendingActions:Object.keys(state.pending).length});
  }
  private restoreMarketCache(){
    try{
      const file=resolve(this.options.directory,'candidates.json');
      if(lstatSync(file).size>16384)throw new Error('market cache too large');
      const rows=JSON.parse(readFileSync(file,'utf8'));
      if(!Array.isArray(rows)||rows.length>12)throw new Error('invalid bounded market cache');
      for(const row of rows){
        if(typeof row?.mint!=='string'||typeof row.signature!=='string'||!Number.isSafeInteger(row.firstReceivedAt)||row.firstReceivedAt>this.now()||this.now()-row.firstReceivedAt>7_200_000)continue;
        try{new PublicKey(row.mint);}catch{continue;}
        this.candidates.set(row.mint,{mint:row.mint,signature:row.signature,firstReceivedAt:row.firstReceivedAt,lastReceivedAt:row.lastReceivedAt,window:'unavailable'});
      }
    }catch{ /* Market cache is replaceable; no financial state is reconstructed from it. */ }
    // Authoritative observation history lives in the same SQLite backup as the
    // account. Invalid metadata is uncertainty, never permission to reset it.
    this.acceptHistory(this.options.ledger.getReportingHistory());
  }
  private acceptHistory(history:ReportingHistory){
    this.history=history.points.map(p=>({at:iso(p.at),tradingUsd:micro(p.tradingMicroUsd),economicUsd:micro(p.economicMicroUsd)}));
    this.lastHistoryAt=history.points.at(-1)?.at??0;
    this.historyWindowLimited=history.windowLimited;this.historyCompacted=history.downsampled;
  }
  private recordPnl(at:number,tradingMicroUsd:string|null){
    this.acceptHistory(this.options.ledger.recordReportingPoint({at,tradingMicroUsd,economicMicroUsd:null}));
  }
  private save(name:string,value:unknown){
    const file=resolve(this.options.directory,name),temp=file+'.tmp';
    writeFileSync(temp,JSON.stringify(value),{mode:0o600});renameSync(temp,file);
  }
  async start(){
    if(this.running)return;
    const now=this.now();
    const state=this.options.ledger.state();
    if(this.options.ledger.integrity()!=='ok')throw new Error('financial integrity uncertain; preserve records');
    this.options.ledger.pause(`runtime-start:${this.epoch}`,Math.max(now,state.lastAt),BLOCKER);
    // Explicit cancellation is durable; unresolved exits remain preserved.
    if(Object.values(state.pending).some(o=>o.side==='buy'))this.options.ledger.cancelEntryOrders(`runtime-obsolete-entries:${this.epoch}`,Math.max(now,state.lastAt),'restart invalidated entry signal');
    // Restart is an actual observation of unavailable market context. Retain a
    // gap even if fresh valuation arrives immediately; never connect the two
    // sides of an unobserved outage with a fabricated continuous line.
    const previous=this.history.at(-1);
    if(previous&&previous.tradingUsd!==null&&Date.parse(previous.at)<now){
      this.recordPnl(now,null);
    }
    try{
      await this.listen();
      this.running=true;this.lag.enable();
      try{this.options.publisher?.start();}catch{this.reportError=true;}
      if(this.options.connectFeed!==false)this.connect();
      await this.tick();
      this.timer=setInterval(()=>{if(!this.currentTick)this.currentTick=this.tick().catch(()=>{this.marketError='RUNTIME_PROGRESS_UNAVAILABLE';}).finally(()=>{this.currentTick=undefined;});},this.options.tickMs??5000);
    }catch(e){await this.close();throw e;}
  }
  private async listen(){
    const path=this.options.socketPath;
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    const parent=lstatSync(dirname(path));
    if(parent.uid!==process.getuid?.()||(parent.mode&0o077)!==0)throw new Error('private owner-only socket directory required');
    if(existsSync(path)){
      const old=lstatSync(path);
      if(!old.isSocket()||old.uid!==process.getuid?.())throw new Error('refusing to replace foreign control path');
      const active=await new Promise<boolean>(resolve=>{const c=createConnection(path);c.setTimeout(300);c.once('connect',()=>{c.destroy();resolve(true);});c.once('error',e=>resolve((e as NodeJS.ErrnoException).code!=='ECONNREFUSED'));c.once('timeout',()=>{c.destroy();resolve(true);});});
      if(active)throw new Error('runtime socket already active');
      unlinkSync(path);
    }
    this.server=createServer(socket=>{
      let raw='',handled=false;socket.setTimeout(2000,()=>socket.destroy());
      socket.on('error',()=>socket.destroy());
      socket.on('data',chunk=>{
        if(handled)return;
        raw+=chunk.toString();if(Buffer.byteLength(raw)>2048){socket.destroy();return;}
        if(!raw.includes('\n'))return;
        handled=true;
        try{const request=JSON.parse(raw.trim());if(Object.keys(request).join()!=='command')throw new Error();
          const result=this.command(request.command);socket.end(JSON.stringify(result)+'\n');
          if(request.command==='safe-stop'&&result.safeToExit===true)socket.once('close',()=>{void this.close();});
        }catch{socket.end(JSON.stringify({error:'unsupported control request'})+'\n');}
      });
    });
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(path,()=>{this.ownsSocket=true;chmodSync(path,0o600);resolve();});});
  }
  command(command:string):Record<string,unknown>{
    const now=Math.max(this.now(),this.options.ledger.state().lastAt);
    if(command==='status')return {accountId:this.identity.accountId,mode:'PAPER',liveTrading:false,running:this.running,feedConnected:this.connected,blocker:this.blocker(),reportingUnavailable:this.reportError,publicStatusUnavailable:this.publicStatusUnavailable,candidates:this.candidates.size,financial:this.options.ledger.projection(now,this.price??undefined,this.marks)};
    if(command==='pause')return this.options.ledger.pause(`operator-pause:${randomUUID()}`,now,'operator paused new entries');
    if(command==='resume')return {enabled:false,reason:BLOCKER};
    if(command==='safe-stop')return this.options.ledger.safeStop(`operator-stop:${randomUUID()}`,now);
    throw new Error('unsupported control command');
  }
  private blocker(){
    if(Object.keys(this.options.ledger.state().positions).length>0&&!this.options.markProvider)return 'HELD_POSITION_PRICING_UNAVAILABLE; '+BLOCKER;
    return this.marketError?`${this.marketError}; ${BLOCKER}`:BLOCKER;
  }
  private connect(){
    if(!this.running||this.feed)return;
    const factory=this.options.feedFactory??(()=>new WebSocket('wss://pumpportal.fun/api/data',{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,handshakeTimeout:12000,maxPayload:65536}));
    const feed=factory();this.feed=feed;
    feed.on('open',()=>{this.connected=true;this.attempts=0;feed.send(dataMessage('subscribeMigration'));});
    feed.on('message',(raw:Buffer)=>{
      try{this.observe(raw.toString());}catch{this.marketError='EVIDENCE_STORAGE_UNAVAILABLE';this.connected=false;feed.terminate();}
    });
    feed.on('error',()=>{this.connected=false;}); // Never log provider URLs/errors.
    feed.on('close',()=>{
      this.connected=false;this.feed=undefined;
      for(const c of this.candidates.values())c.window='unavailable';
      if(this.running&&this.marketError!=='EVIDENCE_STORAGE_UNAVAILABLE')this.reconnect=setTimeout(()=>this.connect(),Math.min(60_000,1000*2**Math.min(++this.attempts,6)));
    });
  }
  /** Free migration messages only. No trade payload or missing feature is invented. */
  observe(raw:string){
    if(Buffer.byteLength(raw)>65536)throw new Error('feed payload limit');
    this.received++;let data:any;try{data=JSON.parse(raw);}catch{return;}
    if(!data||typeof data!=='object'||data.txType!=='migrate'||typeof data.mint!=='string'||typeof data.signature!=='string'||data.signature.length>100)return;
    try{new PublicKey(data.mint);}catch{return;}
    const id=`${data.signature}:${data.mint}`;if(this.seen.has(id))return;
    this.seen.add(id);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);
    this.discovered++;const now=this.now();
    this.lastMigrationReceivedAt=now;
    for(const [mint,c] of this.candidates)if(now-c.firstReceivedAt>7_200_000)this.candidates.delete(mint);
    const existing=this.candidates.get(data.mint);
    if(!existing&&this.candidates.size>=12)return;
    this.candidates.set(data.mint,{mint:data.mint,signature:data.signature,firstReceivedAt:existing?.firstReceivedAt??now,lastReceivedAt:now,window:'unavailable'});
    this.selected++;this.lastUsefulAt=now;
    this.recorder.record('selected-migration',{epoch:this.epoch,commitment:'processed',mint:data.mint,signature:data.signature,receivedAt:iso(now),features:'unavailable-no-trade-flow'});
    this.save('candidates.json',[...this.candidates.values()]);
  }
  async tick(){
    const state=this.options.ledger.state();
    // Held state first; no mark is inferred from a generic migration or zero balance.
    try{this.marks=this.options.markProvider?await this.options.markProvider(state.positions):{};}catch{this.marks={};this.marketError='HELD_POSITION_PRICING_UNAVAILABLE';}
    try{const next=this.options.priceProvider?await this.options.priceProvider():null;if(next)this.price=next;}catch{ /* Reuse only within ledger's unchanged 10s freshness bound. */ }
    const now=this.now();
    if(this.price){try{this.options.ledger.reconcile(`reconcile:${this.epoch}:${now}`,Math.max(now,state.lastAt),this.price,this.marks);this.lastUsefulAt=now;}catch{/* Stale/unknown valuation blocks reconciliation and risk. */}}
    if(now-this.lastSnapshotAt>=30_000||this.lastSnapshotAt===0){
      this.lastSnapshotAt=now;
      const snapshot=this.snapshot(now);
      // Projection complete; no ledger lock crosses publication. Reporting
      // failure does not stop ingestion or turn into a financial action.
      try{this.options.publisher?.offer(snapshot);this.reportError=false;}catch{this.reportError=true;}
    }
    this.writePublicStatus(now);
  }
  private writePublicStatus(now:number){
    const path=this.options.publicStatusPath;if(!path)return;
    let temp:string|undefined;
    try{
      if(!isAbsolute(path)||basename(path)!=='status.json'||resolve(path)!==path)throw new Error();
      const parent=dirname(path),dir=lstatSync(parent),owner=process.getuid?.();
      const privateRoot=realpathSync(this.options.directory);
      if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==owner||(dir.mode&0o777)!==0o755||realpathSync(parent)!==parent||parent===privateRoot||parent.startsWith(privateRoot+'/'))throw new Error();
      try{
        const current=lstatSync(path);
        if(!current.isFile()||current.isSymbolicLink()||current.uid!==owner||(current.mode&0o777)!==0o644||current.size>4096)throw new Error();
        const prior=JSON.parse(readFileSync(path,'utf8'));
        if(prior.schemaVersion!==1||prior.project!=='pump-opportunity-engine'||prior.mode!=='PAPER'||prior.accountId!==this.identity.accountId)throw new Error();
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      const state=this.options.ledger.state();
      const body=JSON.stringify({
        schemaVersion:1,project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,
        accountId:this.identity.accountId,inceptionAt:this.identity.inceptionAt,release:this.identity.release,strategy:this.identity.strategy,
        generatedAt:iso(now),lastUsefulProgressAt:this.lastUsefulAt===null?null:iso(this.lastUsefulAt),
        usdPriceAt:this.price&&Number.isSafeInteger(this.price.at)&&this.price.at<=now?iso(this.price.at):null,
        lastReconciledAt:state.daily.reconciledAt?iso(state.daily.reconciledAt):null,
        feedConnected:this.connected,lastMigrationReceivedAt:this.lastMigrationReceivedAt===null?null:iso(this.lastMigrationReceivedAt),shortlistCount:this.candidates.size,
        entriesDisabled:true,flowVerified:false,blocker:this.blocker(),reportingConfigured:!!this.options.publisher,
      })+'\n';
      if(Buffer.byteLength(body)>4096)throw new Error();
      temp=resolve(parent,`.poe-status-${randomUUID()}.tmp`);
      const fd=openSync(temp,'wx',0o600);
      try{writeFileSync(fd,body);}finally{closeSync(fd);}
      chmodSync(temp,0o644);renameSync(temp,path);temp=undefined;
      this.publicStatusUnavailable=false;
    }catch{this.publicStatusUnavailable=true;}
    finally{if(temp){try{unlinkSync(temp);}catch{ /* No arbitrary error is logged. */ }}}
  }
  snapshot(now=this.now()):Snapshot{
    const state=this.options.ledger.state(),p=this.options.ledger.projection(now,this.price??undefined,this.marks);
    const price=p.usdValuationAvailable&&this.price?Number(BigInt(this.price.microUsdPerSol))/1e6:null;
    const validMark=(mint:string)=>{const m=this.marks[mint],position=state.positions[mint];return !!(m&&position&&m.pricedBaseUnits===position.units&&m.evidence&&Number.isSafeInteger(m.at)&&m.at<=now&&now-m.at<=2000);};
    const markTimes=Object.keys(state.positions).map(mint=>validMark(mint)?this.marks[mint]!.at:0);
    const marketAt=price===null||markTimes.some(t=>t===0)?null:iso(Math.min(this.price!.at,...(markTimes.length?markTimes:[this.price!.at])));
    const trading= micro(p.totalPnlMicroUsd);
    const previous=this.history.at(-1);
    const transition=previous!==undefined&&((previous.tradingUsd===null)!==(trading===null));
    if((!previous||Date.parse(previous.at)<now)&&(!previous||now-this.lastHistoryAt>=600_000||transition)){
      this.recordPnl(now,p.totalPnlMicroUsd);
    }
    const freshReconciliation=state.daily.reconciledAt>0&&state.daily.reconciledAt<=now&&now-state.daily.reconciledAt<=2000&&p.equityMicroUsd!==null;
    const snapshot:Snapshot={
      project:'pump-opportunity-engine',mode:'PAPER',liveTrading:false,schemaVersion:1,
      account:{id:state.accountId,inceptionAt:iso(state.inceptionAt),initialUsd:1000},sequence:this.options.ledger.nextSnapshotSequence(),source:{release:this.identity.release,strategy:this.identity.strategy},
      times:{generatedAt:iso(now),marketAt,reconciledAt:state.daily.reconciledAt?iso(state.daily.reconciledAt):null,usefulProgressAt:this.lastUsefulAt===null?null:iso(this.lastUsefulAt)},
      status:{runtime:this.running?'running':'stopped',market:this.connected?'observing':'unavailable',entries:'disabled',reconciled:freshReconciliation,blocker:this.blocker()},
      balances:{cashSol:sol(p.cashLamports),reservedSol:sol(p.reservedLamports),equitySol:p.equityLamports===null?null:sol(p.equityLamports),equityUsd:micro(p.equityMicroUsd),realizedUsd:null,unrealizedUsd:null,tradingPnlUsd:trading,economicPnlUsd:null,positionCostUsd:micro(p.positionCostMicroUsd)!,markedExposureUsd:p.positionLiquidationLamports===null||price===null?null:Number(BigInt(p.positionLiquidationLamports))/1e9*price,drawdownUsd:null,executionCostsUsd:null,operatingCostsUsd:null,passiveSolEquityUsd:micro(p.passiveSolEquityMicroUsd),solPriceUsd:price},
      costLabels:{execution:'simulated',operating:'unavailable'},
      positions:Object.values(state.positions).map(position=>({mint:position.mint,label:position.mint,quantity:position.units,enteredAt:iso(position.enteredAt),entryCostUsd:micro(position.costMicroUsd)!,netLiquidationUsd:price!==null&&validMark(position.mint)?Number(BigInt(this.marks[position.mint]!.netLamports))/1e9*price:null,executionCostsUsd:Number(BigInt(position.costMicroUsd)*BigInt(position.entryGas)/(BigInt(position.entryGas)+BigInt(position.entryLamports)))/1e6,status:'held; gas USD allocated from recorded entry cost; exit execution not connected'})),
      trades:[],decisions:[],pnl:[...this.history],history:{windowStartAt:this.history[0]?.at??null,downsampled:true,label:`${this.historyWindowLimited?'WINDOW LIMITED; inception context lost':'Authoritative inception/observations'}: 10-minute samples plus explicit gaps, max720points${this.historyCompacted?', compacted':''}. Historical trades not projected by this scaffold.`},
      funnel:{discovered:this.discovered,supported:0,sufficientlyObserved:0,evaluated:0,qualified:0,attempted:0,paperFilled:0,exited:0,reconciled:0},
      metrics:{processingLagMs:null,eventLoopLagMs:Number.isFinite(this.lag.mean)?this.lag.mean/1e6:null,providerEvents:this.received,rpcRequests:0,projectedDailyDataSol:0,budgetRemainingSol:null,budgetStatus:'unavailable',coverage:`Session free migration sample: selected${this.selected}, shortlist${this.candidates.size}/12. No supported-pool or full-market coverage claim.`,latency:'Not measured; processed migration receive time only'},
    };
    return validateSnapshot(snapshot,this.identity,now);
  }
  async close(){
    if(this.closed)return;this.closed=true;
    this.running=false;clearInterval(this.timer);clearTimeout(this.reconnect);this.feed?.terminate();this.feed=undefined;
    await this.currentTick;await this.options.publisher?.stop();this.lag.disable();
    if(this.server){await new Promise<void>(resolve=>this.server!.close(()=>resolve()));this.server=undefined;}
    try{if(this.ownsSocket&&existsSync(this.options.socketPath)&&lstatSync(this.options.socketPath).isSocket())unlinkSync(this.options.socketPath);}catch{}
    this.recorder.close();
    this.options.ledger.close();
  }
}

export async function runtimeCommand(path:string,command:string){
  return await new Promise<Record<string,unknown>>((resolve,reject)=>{
    const socket=createConnection(path);let result='';
    socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('runtime control timeout'));});
    socket.once('connect',()=>socket.write(JSON.stringify({command})+'\n'));
    socket.on('data',chunk=>{result+=chunk;if(result.length>128*1024){socket.destroy();reject(new Error('control response bound exceeded'));}});
    socket.once('end',()=>{try{resolve(JSON.parse(result));}catch{reject(new Error('invalid runtime control response'));}});
    socket.once('error',()=>reject(new Error('runtime control unavailable')));
  });
}

if(process.argv[1]&&existsSync(process.argv[1])&&realpathSync(fileURLToPath(import.meta.url))===realpathSync(process.argv[1])){
  const required=(key:string)=>{const value=process.env[key];if(!value)throw new Error(`missing configuration:${key}`);return value;};
  const command=process.argv[2]??'run';
  try{
    const socketPath=process.env.POE_SOCKET_PATH??'/run/poe/control.sock';
    if(command!=='run'){const result=await runtimeCommand(socketPath,command);console.log(JSON.stringify(result));if(command==='safe-stop'&&result.safeToExit!==true)process.exitCode=3;}
    else{
      if(process.getuid?.()===0)throw new Error('runtime must run as restricted nonroot poe-runtime identity');
      const path=required('POE_DB_PATH');if(!existsSync(path))throw new Error('existing authoritative account required; runtime never seeds');
      const ledger=new PaperLedger(path,required('POE_ACCOUNT_ID'));
      const state=ledger.state(),release=required('POE_RUNTIME_RELEASE');
      if(Object.keys(state.positions).length>0||Object.values(state.pending).some(order=>order.side==='sell')){ledger.close();throw new Error('existing exposure requires supported position/exit management; observer scaffold refuses startup without changing holdings');}
      const credentials=process.env.CREDENTIALS_DIRECTORY;
      const secretFile=process.env.POE_PUBLISH_SECRET_FILE??(credentials?resolve(credentials,'poe-ingest-secret'):undefined);
      const publisher=process.env.POE_PUBLISH_URL&&secretFile?new SnapshotPublisher({url:process.env.POE_PUBLISH_URL,secret:readFileSync(secretFile,'utf8').trim(),identity:{accountId:state.accountId,inceptionAt:iso(state.inceptionAt),release,strategy:'UNIMPLEMENTED_FLOW_BLOCKED'}}):undefined;
      const priceFile=process.env.POE_USD_PRICE_FILE;
      const usdSource=process.env.POE_USD_SOURCE;
      if(usdSource&&usdSource!=='coinbase-spot'){ledger.close();throw new Error('unsupported explicit USD source');}
      const priceProvider=usdSource==='coinbase-spot'?async()=>await (await import('./valuation.js')).fetchPublicUsdPrice():priceFile?async()=>{if(lstatSync(priceFile).size>2048)throw new Error('valuation file too large');return JSON.parse(readFileSync(priceFile,'utf8'));}:undefined;
      const runtime=new PaperObservationRuntime({ledger,directory:process.env.POE_DATA_DIR??'/var/lib/poe',socketPath,release,publisher,priceProvider,publicStatusPath:process.env.POE_PUBLIC_STATUS_PATH});
      await runtime.start();
      const stop=()=>{const result=runtime.command('safe-stop');if(result.safeToExit===true)void runtime.close();else process.stderr.write('POE safe stop deferred: open positions or unresolved actions require management; a forced supervisor stop would leave exposure unmonitored\n');};
      process.on('SIGTERM',stop);process.on('SIGINT',stop);
      process.stdout.write('POE PAPER observer running; entries disabled: FLOW_NOT_VERIFIED_BILLING_NOT_CONFIRMED\n');
    }
  }catch(e){process.stderr.write((e instanceof Error?e.message:'runtime unavailable')+'\n');process.exitCode=1;}
}
