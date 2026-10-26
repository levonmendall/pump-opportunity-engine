/** Disposable normalized replay only. Never loads a provider, account or secret. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir,availableParallelism} from 'node:os';
import {join,resolve} from 'node:path';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {Recorder} from '../src/recorder.js';
import {OpportunityBook,PROVISIONAL_RULE,evaluatePrimary,type FlowFeatures,type FlowWindow,type NormalizedTrade} from '../src/strategy.js';

const START=1_700_000_000_000,DURATION=72_000,STEP=100,CANDIDATES=12,RECORD_CAP=8_000_000;
const QUOTE=10_000_000n,UNITS='1000000',CHUNK=64;
const MINTS=Array.from({length:CANDIDATES},(_,i)=>`synthetic-mint-${i}`);
const round=(n:number)=>Math.round(n*1000)/1000;
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const immediate=()=>new Promise<void>(resolve=>setImmediate(resolve));
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const percentile=(sorted:number[],p:number)=>round(sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))]??0);

function createRecord(path:string){
  const recorder=new Recorder(path,RECORD_CAP),availability:number[]=[];
  try{
    for(let batch=0;batch<DURATION/STEP;batch++){
      let first:NormalizedTrade|undefined;
      for(let mint=0;mint<CANDIDATES;mint++){
        const trade:NormalizedTrade={identity:{signature:`synthetic-transaction-${batch}`,instructionIndex:1,eventIndex:mint},mint:MINTS[mint]!,wallet:`synthetic-wallet-${batch%32}`,side:batch%4===3?'sell':'buy',quoteLamports:QUOTE.toString(),tokenUnits:UNITS,receivedAt:START+batch*STEP,commitment:'processed',slot:100_000+batch};
        recorder.record('DISPOSABLE_SYNTHETIC_NORMALIZED_TRADE',trade);availability.push(trade.receivedAt);first??=trade;
      }
      if(batch%10===0){const duplicate={...first!,receivedAt:START+batch*STEP+1};recorder.record('DISPOSABLE_SYNTHETIC_NORMALIZED_TRADE',duplicate);availability.push(duplicate.receivedAt);}
    }
  }finally{recorder.close();}
  const bytes=statSync(path).size;assert.ok(bytes<=RECORD_CAP);
  const lines=readFileSync(path,'utf8').trimEnd().split('\n');assert.equal(lines.length,availability.length);
  const normalizedHash=createHash('sha256');
  for(let i=0;i<lines.length;i++){const row=JSON.parse(lines[i]!);assert.equal(row.schemaVersion,1);assert.equal(row.sequence,i+1);assert.equal(row.kind,'DISPOSABLE_SYNTHETIC_NORMALIZED_TRADE');assert.equal(row.data.receivedAt,availability[i]);if(i)assert.ok(availability[i]!>=availability[i-1]!);normalizedHash.update(JSON.stringify(row.data)+'\n');}
  return {lines,availability,bytes,normalizedSha256:normalizedHash.digest('hex')};
}

function oracle(at:number){
  const end=Math.floor(at/10_000)*10_000,start=end-60_000,counts=new Map<string,number>();let buys=0,sells=0;
  for(let batch=Math.max(0,(start-START)/STEP);batch<(end-START)/STEP;batch++){
    if(batch%4===3)sells++;else{buys++;const wallet=`synthetic-wallet-${batch%32}`;counts.set(wallet,(counts.get(wallet)??0)+1);}
  }
  return {tradeCount:buys+sells,buyLamports:(BigInt(buys)*QUOTE).toString(),sellLamports:(BigInt(sells)*QUOTE).toString(),netBuyLamports:(BigInt(buys-sells)*QUOTE).toString(),distinctBuyerWallets:counts.size,largestBuyerBps:buys?Math.ceil(Math.max(...counts.values())*10_000/buys):0,positiveNetBuckets:Math.min(6,(end-START)/10_000),priceReturnBps:0,sufficientlyObserved:start>=START};
}
const CHECKPOINTS=[10_000,20_000,30_000,40_000,50_000,60_000,70_000,DURATION].map(ms=>START+ms);
const EXPECTED=new Map(CHECKPOINTS.map(at=>[at,oracle(at)]));

async function replay(record:ReturnType<typeof createRecord>,speedup:number|null){
  const book=new OpportunityBook(),windows=MINTS.map(mint=>book.admit(mint,START)!);
  assert.equal(book.size,CANDIDATES);assert.equal(book.admit('synthetic-capacity-refusal',START),null);
  const usage=windows.map(window=>window.usage());let retained=0,identities=0,maxRetained=0,maxIdentities=0,maxOneRetained=0,maxOneIdentities=0;
  let accepted=0,duplicates=0,featuresCompleted=0,warmFeaturesCompleted=0,unverifiedRefusals=0,checkpoint=0,index=0,backlogPeak=0;
  const delays:number[]=[],memBefore=process.memoryUsage();let sampledRssMax=memBefore.rss,sampledHeapMax=memBefore.heapUsed,memorySamples=1;
  const sampleMemory=()=>{const value=process.memoryUsage();sampledRssMax=Math.max(sampledRssMax,value.rss);sampledHeapMax=Math.max(sampledHeapMax,value.heapUsed);memorySamples++;};
  const track=(window:FlowWindow,mint:number)=>{const next=window.usage(),old=usage[mint]!;retained+=next.retainedTrades-old.retainedTrades;identities+=next.retainedIdentities-old.retainedIdentities;usage[mint]=next;maxRetained=Math.max(maxRetained,retained);maxIdentities=Math.max(maxIdentities,identities);maxOneRetained=Math.max(maxOneRetained,next.retainedTrades);maxOneIdentities=Math.max(maxOneIdentities,next.retainedIdentities);assert.ok(next.retainedTrades<=next.maximumTrades&&next.retainedIdentities<=next.maximumIdentities);};
  const completeFeatures=(at:number)=>{
    const expected=EXPECTED.get(at)!;
    for(let mint=0;mint<windows.length;mint++){
      const window=windows[mint]!,features=window.features(at);track(window,mint);
      for(const [key,value]of Object.entries(expected))assert.equal(features[key as keyof FlowFeatures],value,`${key} at ${at-START}`);
      assert.equal(features.provisionalTradeCount,features.tradeCount);assert.equal(features.windowEndAt,Math.floor(at/10_000)*10_000);featuresCompleted++;if(features.sufficientlyObserved)warmFeaturesCompleted++;
      const refusal=evaluatePrimary(features,{mint:MINTS[mint]!,now:at,migrationAt:null,migrationVerified:false,supportedPool:false,flowFieldsVerified:false,flowVerificationEvidence:null,riskEntriesAllowed:false,alreadyTradedMint:false,quote:null});
      assert.equal(refusal.qualified,false);assert.equal(refusal.reason,'trade-feed-fields-not-verified');unverifiedRefusals++;
    }
    sampleMemory();
  };
  const dueCount=(syntheticTime:number)=>{let low=index,high=record.availability.length;while(low<high){const mid=(low+high)>>>1;if(record.availability[mid]!<=syntheticTime)low=mid+1;else high=mid;}return low;};
  const histogram=monitorEventLoopDelay({resolution:1});histogram.enable();await immediate();
  const cpuStart=process.cpuUsage(),eluStart=performance.eventLoopUtilization(),start=performance.now();
  while(index<record.lines.length){
    const scheduled=speedup===null?0:(record.availability[index]!-START)/speedup;
    const remaining=scheduled-(performance.now()-start);
    if(remaining>0){await sleep(Math.min(5,Math.max(1,remaining)));continue;}
    backlogPeak=Math.max(backlogPeak,(speedup===null?record.lines.length:dueCount(START+(performance.now()-start)*speedup))-index);
    let completed=0;
    while(index<record.lines.length&&completed<CHUNK){
      const due=speedup===null?0:(record.availability[index]!-START)/speedup;
      const now=performance.now()-start;if(now<due)break;
      const row=JSON.parse(record.lines[index]!),trade=row.data as NormalizedTrade;
      assert.equal(trade.receivedAt,record.availability[index]);
      while(checkpoint<CHECKPOINTS.length&&CHECKPOINTS[checkpoint]!<=trade.receivedAt)completeFeatures(CHECKPOINTS[checkpoint++]!);
      const mint=trade.identity.eventIndex,result=windows[mint]!.ingest(trade);track(windows[mint]!,mint);
      if(result==='accepted')accepted++;else if(result==='duplicate')duplicates++;else assert.fail(`unexpected ${result}`);
      delays.push(performance.now()-start-due);index++;completed++;
    }
    sampleMemory();await immediate();
  }
  if(speedup!==null){const remaining=DURATION/speedup-(performance.now()-start);if(remaining>0)await sleep(remaining);}
  while(checkpoint<CHECKPOINTS.length)completeFeatures(CHECKPOINTS[checkpoint++]!);
  const elapsed=performance.now()-start,cpu=process.cpuUsage(cpuStart),elu=performance.eventLoopUtilization(eluStart);histogram.disable();sampleMemory();
  assert.equal(accepted,8640);assert.equal(duplicates,72);assert.equal(featuresCompleted,96);assert.equal(warmFeaturesCompleted,36);assert.equal(unverifiedRefusals,featuresCompleted);assert.equal(index,record.lines.length);
  delays.sort((a,b)=>a-b);const memAfter=process.memoryUsage(),histogramSamples=histogram.count;
  sampledRssMax=Math.max(sampledRssMax,memAfter.rss);sampledHeapMax=Math.max(sampledHeapMax,memAfter.heapUsed);memorySamples++;
  return {label:speedup===null?'unpaced-finite-burst':`${speedup}x-synthetic-time`,speedup,offeredRowsPerSecond:speedup===null?null:round(record.lines.length/(DURATION/1000)*speedup),actualWallDurationMs:round(elapsed),completedRowsPerSecond:round(record.lines.length/(elapsed/1000)),usefulAcceptedTradesPerSecond:round(accepted/(elapsed/1000)),processedRows:index,acceptedUniqueTrades:accepted,duplicates,completedFeatureEvaluations:featuresCompleted,fullyWarmedFeatureEvaluations:warmFeaturesCompleted,unverifiedFieldRefusals:unverifiedRefusals,featureOraclePassed:true,availabilityTimesPreserved:true,finiteScheduledInputBacklog:{sampledPeakRows:backlogPeak,finalRows:record.lines.length-index,capacityRows:record.lines.length,interpretation:'offline record scheduling backlog sampled at cooperative chunks of at most 64 rows; not a production ingestion queue'},processingCompletionDelayMs:{p50:percentile(delays,.5),p95:percentile(delays,.95),p99:percentile(delays,.99),max:round(delays.at(-1)??0),meaning:'actual completion wall time minus synthetic scheduled replay availability; includes parsing, feature work and cooperative scheduler'},eventLoopDelayMs:{sampleCount:histogramSamples,mean:histogramSamples?round(histogram.mean/1e6):null,p99:histogramSamples?round(histogram.percentile(99)/1e6):null,max:histogramSamples?round(histogram.max/1e6):null,resolutionMs:1},cpu:{userMs:round(cpu.user/1000),systemMs:round(cpu.system/1000),eventLoopUtilization:round(elu.utilization)},memory:{beforeRssBytes:memBefore.rss,afterRssBytes:memAfter.rss,sampledMaxRssBytes:sampledRssMax,beforeHeapUsedBytes:memBefore.heapUsed,afterHeapUsedBytes:memAfter.heapUsed,sampledMaxHeapUsedBytes:sampledHeapMax,samples:memorySamples,interpretation:'same process sequential runs; sampled values, no forced GC or isolated peak guarantee'},boundedFeatureState:{interpretation:'logical active/pending counts from usage(); excludes stale deque prefixes and historical trades referenced by dedup identities; not a physical object-memory bound',candidates:book.size,thirteenthCandidateRefused:true,maxObservedRetainedTrades:maxRetained,maxObservedRetainedIdentities:maxIdentities,maxOneCandidateTrades:maxOneRetained,maxOneCandidateIdentities:maxOneIdentities,perCandidateTradeCap:4096,perCandidateIdentityCap:8192,finalRetainedTrades:retained,finalRetainedIdentities:identities}};
}

const actualStartedAt=new Date().toISOString(),wallStarted=performance.now(),directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-capacity-'));
let evidence:unknown;
try{
  const record=createRecord(join(directory,'synthetic.ndjson')),runs=[];
  for(const speedup of [25,100,400,null])runs.push(await replay(record,speedup));
  evidence={schemaVersion:1,classification:'SYNTHETIC_OFFLINE_CAPACITY_ONLY',acceptanceGateCompleted:false,acceptanceClockStarted:false,paperEntriesEnabled:false,naturalTrades:0,actualStartedAt,actualCompletedAt:new Date().toISOString(),actualTotalWallDurationMs:round(performance.now()-wallStarted),environment:{kind:'Codex execution workspace; not EC2 production host',node:process.version,platform:process.platform,architecture:process.arch,availableParallelism:availableParallelism()},reproduce:'node --import tsx scripts/offline-capacity.ts',sourceHashes:{strategy:hash(readFileSync(new URL('../src/strategy.ts',import.meta.url))),recorder:hash(readFileSync(new URL('../src/recorder.ts',import.meta.url))),script:hash(readFileSync(fileURLToPath(import.meta.url)))},fixture:{disposable:true,syntheticAvailabilityStart:START,syntheticDurationMs:DURATION,syntheticDurationIsNotElapsedWallTime:true,rows:record.lines.length,uniqueTrades:8640,duplicateRows:72,candidates:CANDIDATES,shape:'12 simultaneous events per 100ms synthetic interval, plus one exact duplicate per synthetic second; complete invented instruction/event identities are fixtures only',recordBytes:record.bytes,recordByteCap:RECORD_CAP,normalizedSha256:record.normalizedSha256,temporaryInputDeleted:true,usesProductionRecorder:true,usesProductionFlowWindow:true,features:'integer net buying, persistence bins, buyer concentration, price ratio and warming; exact aggregate oracle at 96 completed checkpoints/run'},rules:{version:PROVISIONAL_RULE.version,changed:false,flowFieldsVerified:false,entriesEnabled:false},runs,limitations:['No actual PumpPortal/raw feed field verification, discovery coverage or measured provider arrival rates.','No socket/network, RPC/pool pricing, ledger writes, trading/exits, publication or financial reconciliation in this benchmark.','Synthetic record availability times are preserved; accelerating replay does not establish 72 seconds, 24 hours or 72 hours of unattended operation.','Rates apply only to this short selected normalized payload and 12-candidate workload on this execution workspace; not a universal capacity or EC2 bound.','Finite offline backlog is drained; no production queue or sustained-memory/long-outage behavior is proved.','Recorder write/flush and initial record loading are outside timed replay; per-row JSON parsing, feature checks, rule refusals, metrics and cooperative yields are inside.','Runs share one process, OS scheduling and JIT/GC state; memory is sampled and rate results are sensitive to short-run overhead.','Every strategy decision refuses unverified feed fields; no qualified opportunity, fill or economic edge is established.']};
}finally{rmSync(directory,{recursive:true,force:true});}
const destination=resolve(process.argv[2]??'evidence/offline-capacity.json');writeFileSync(destination,JSON.stringify(evidence,null,2)+'\n',{mode:0o644});
console.log(JSON.stringify({status:'SYNTHETIC_OFFLINE_CAPACITY_COMPLETE',evidence:destination,acceptanceClockStarted:false}));
