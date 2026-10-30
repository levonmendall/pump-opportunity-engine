/** Offline-only schedule comparisons. Every RPC is simulated; no network client. */
import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {PublicKey} from '@solana/web3.js';
import {PUMP_AMM_SDK} from '../src/sdk.js';
import {decodeSupportedPoolAccounts,positionSellFromState,type PoolWireAccount} from '../src/pool.js';
import {runMonitoringReplay,type MonitoringPolicy,type MonitoringReplayInput,type MonitoringNotification,type MonitoringBackgroundJob} from '../src/adaptive-monitoring.js';
import {readCapturedTrace} from './free-data-quote-replay.js';

const ROOT='evidence/adaptive-monitoring',MIB=1024*1024,START=1_000_000,DURATION=120_000;
const POLICIES:MonitoringPolicy[]=['fixed-2s','fixed-5s','fixed-10s','hybrid-5s','adaptive','adaptive-quiet'];
const PLAN=JSON.parse(readFileSync(ROOT+'/hypotheses.json','utf8'));
const prior=JSON.parse(readFileSync(ROOT+'/budget-baseline.json','utf8')) as Record<string,string>;
const sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const checkPrior=()=>{for(const [p,h] of Object.entries(prior))if(sha(readFileSync('evidence/free-data-20261027/'+p))!==h)throw Error('PRIOR_COUNTER_OR_RECEIPT_CHANGED');};
const disk=(p:string):number=>readdirSync(p).reduce((n,f)=>{const q=p+'/'+f,s=statSync(q);return n+(s.isDirectory()?disk(q):s.size);},0);
const proofPath='evidence/integration-proof-2026-10-26T19-57-35.882Z.json',recordPath='evidence/integration-2026-10-26T19-57-35.882Z.ndjson';
const proof=JSON.parse(readFileSync(proofPath,'utf8'));
const raw=readFileSync(recordPath,'utf8').trim().split('\n').map(s=>JSON.parse(s)).find(r=>r.kind==='pool-state').data;
const mint=new PublicKey(proof.quote.mint),pool=new PublicKey(proof.quote.pool),units=BigInt(proof.quote.buy.outputBaseUnits),ENTRY=10_007_000n,GAS=7000n;
const first=PUMP_AMM_SDK.decodePool({...raw.value[0],owner:new PublicKey(raw.value[0].owner),data:Buffer.from(raw.value[0].data[0],'base64')});
const base0=BigInt(proof.quote.rawBaseReserve),effective0=BigInt(proof.quote.effectiveQuoteReserve),virtual=BigInt(proof.quote.virtualQuoteReserves);
function sqrt(n:bigint){if(n<2n)return n;let a=n,b=(a+1n)/2n;while(b<a){a=b;b=(a+n/a)/2n;}return a;}
const values=new Map<number,{netLamports:string;grossLamports:string;feeLamports:string}>();
function sdkValue(priceBps:number){
  let old=values.get(priceBps);if(old)return old;
  const accounts=structuredClone(raw.value) as PoolWireAccount[],effective=sqrt(effective0*effective0*BigInt(priceBps)/10000n),base=base0*effective0/effective;
  for(const [index,amount] of [[5,base],[6,effective-virtual]] as const){
    const b=Buffer.from(accounts[index]!.data[0],'base64');b.writeBigUInt64LE(amount,64);accounts[index]!.data[0]=b.toString('base64');
    // Synthetic WSOL must remain backed by lamports, including its native rent
    // reserve. This changes fixture coherence, not SDK pricing or policy settings.
    if(b.readUInt32LE(109)===1){const lamports=amount+b.readBigUInt64LE(113);if(lamports>BigInt(Number.MAX_SAFE_INTEGER))throw Error('SYNTHETIC_NATIVE_BALANCE_RANGE');accounts[index]!.lamports=Number(lamports);}
  }
  const state=decodeSupportedPoolAccounts(mint,pool,first,accounts,raw.context,new Date(START).toISOString(),new Date(START).toISOString());
  const q=positionSellFromState(state,units,{record(){}});const gross=BigInt(q.sell.outputLamports);if(gross<=GAS)throw Error('HYPOTHETICAL_SIZE_NOT_EXECUTABLE');
  old={netLamports:(gross-GAS).toString(),grossLamports:gross.toString(),feeLamports:q.sell.embeddedPoolFeeLamports};values.set(priceBps,old);return old;
}
type Case={id:string;points:Array<[number,number]>;phase?:boolean;silent?:boolean;disconnect?:boolean;rpcDelay?:boolean;rpcOutage?:boolean;hold?:boolean};
const cases:Case[]=[
 {id:'quiet',points:[[0,10000]]},
 {id:'gradual-fall',points:[[0,10000],[20000,9300],[25000,8700],[30000,8200],[40000,7500],[60000,7000]]},
 {id:'step-drop',phase:true,points:[[0,10000],[20300,8400],[26300,6000],[50000,6500]]},
 {id:'short-rally',phase:true,points:[[0,10000],[20300,13500],[26300,11000],[40000,10000]]},
 {id:'gradual-rally',points:[[0,10000],[10000,11500],[20000,12200],[30000,13500],[50000,15000]]},
 {id:'rapid-roundtrip',phase:true,points:[[0,10000],[2501,8000],[4501,10000],[50000,11000]]},
 {id:'known-disconnect',disconnect:true,points:[[0,10000],[30300,8400],[36300,6500]]},
 {id:'silent-notification-loss',silent:true,phase:true,points:[[0,10000],[2501,8000],[4501,10000],[20300,8400],[26300,6000]]},
 {id:'rpc-delay',rpcDelay:true,points:[[0,10000],[20300,8000],[45000,11000]]},
 {id:'rpc-outage',rpcOutage:true,points:[[0,10000],[20300,8000],[45000,11000]]},
 {id:'high-churn',points:[[0,10000],...Array.from({length:479},(_,i)=>[250+i*250,i%2?10050:9950] as [number,number])]},
 {id:'maximum-hold',hold:true,points:[[0,10000]]},
];
function inputFor(c:Case,phase:number,policy:MonitoringPolicy):MonitoringReplayInput{
  const points=c.points.map(([at,bps])=>({at:START+at+(at?phase:0),netLamports:sdkValue(bps).netLamports}));
  const notifications:MonitoringNotification[]=Array.from({length:13},(_,i)=>({at:START+i*10000,kind:'heartbeat'}));
  if(!c.silent)for(const p of points.slice(1))notifications.push({at:p.at+150,positionId:'H1',kind:'change'});
  if(c.disconnect)notifications.push({at:START+20000,kind:'disconnect'},{at:START+48000,kind:'reconnected'},{at:START+50000,kind:'subscriptions-restored'});
  return {policy,startAt:START,endAt:START+DURATION,sourceMode:'dense-synthetic',positions:[{id:'H1',enteredAt:START-(c.hold?885000:0),entryCostLamports:ENTRY.toString(),units:units.toString(),observations:points}],notifications,latencyMs:200,minimumStartGapMs:1000,backgroundStartsPerMinute:24,stopAfterExit:false,failedAttemptCostLamports:'7000',exitSlippageBps:500,...(c.rpcDelay?{requestLatency:(at:number)=>at>=START+18000&&at<START+34000?2600:200}:{}),...(c.rpcOutage?{failures:[{startAt:START+18000,endAt:START+34000}]}:{})};
}
function compact(r:ReturnType<typeof runMonitoringReplay>){
  return {...r,requests:undefined,positions:r.positions.map(({evaluations,observablePriceChanges,...p})=>({...p,firstActionableExit:p.firstActionableExit,observablePriceChanges:observablePriceChanges.length,evaluationsCount:evaluations.length})),requestsScope:'Simulated one-call coherent Clock union, established links; +1 cold link read/setup and WS management extra; no actual provider requests'};
}
function run(){
  checkPrior();if(disk(ROOT)+disk('evidence/free-data-20261027')+8*MIB>32*MIB)throw Error('EVIDENCE_RESERVATION');
  const began=performance.now(),cpu=process.cpuUsage(),rows:any[]=[];
  for(const c of cases)for(const phase of c.phase?PLAN.phaseOffsetsMs:[0])for(const policy of POLICIES){
    const cfg=inputFor(c,phase,policy),t=performance.now(),before=process.cpuUsage();
    const result=runMonitoringReplay(cfg),used=process.cpuUsage(before);
    const life=runMonitoringReplay({...cfg,stopAfterExit:true});
    rows.push({case:c.id,phaseMs:phase,label:'SYNTHETIC_COHERENT_RESERVE_TRANSITIONS_NOT_NATURAL_PERFORMANCE',monitoring:compact(result),lifecycle:compact(life),processing:{wallMs:performance.now()-t,cpuMs:(used.user+used.system)/1000}});
  }
  const captured=readCapturedTrace(),actualStart=captured.samples[0]!.availableAt,actualEnd=captured.samples.at(-1)!.availableAt+1;
  const actual=POLICIES.map(policy=>{
    const obs=captured.samples.map(s=>({at:s.availableAt,availableAt:s.availableAt,sourceAt:s.receivedAt,marketTimeAt:s.blockTime===null?s.receivedAt:s.blockTime*1000,netLamports:s.outputLamports===null?null:(BigInt(s.outputLamports)-GAS).toString()}));
    const notifications=captured.samples.map(s=>({at:s.availableAt,kind:'heartbeat' as const}));
    return compact(runMonitoringReplay({policy,startAt:actualStart,endAt:actualEnd,sourceMode:'sparse-captured',positions:[{id:'retained-quiet',enteredAt:actualStart,entryCostLamports:(BigInt(captured.samples.find(s=>s.outputLamports!==null)!.outputLamports!)-GAS).toString(),units:captured.inputUnits,observations:obs}],notifications,latencyMs:0,minimumStartGapMs:1000}));
  });
  const load=[];
  for(const held of [1,2,3])for(const candidates of [1,3,5])for(const churn of [false,true])for(const backgroundCap of [24,60])for(const policy of ['fixed-2s','fixed-5s','fixed-10s','hybrid-5s','adaptive'] as MonitoringPolicy[]){
    const c=cases.find(c=>c.id===(churn?'high-churn':'quiet'))!,cfg=inputFor(c,0,policy);
    cfg.positions=Array.from({length:held},(_,i)=>({...cfg.positions[0]!,id:'H'+(i+1)}));
    cfg.notifications=cfg.notifications!.map(n=>({...n,positionId:undefined}));
    cfg.backgroundStartsPerMinute=backgroundCap;
    const jobs:MonitoringBackgroundJob[]=[];
    for(let j=0;j<candidates;j++)for(let t=2000+j*150;t<DURATION;t+=10000)jobs.push({at:START+t+1000,kind:'candidate',deadlineAt:START+t+5000});
    for(let t=6000;t<DURATION;t+=10000)jobs.push({at:START+t,kind:'verification'});
    cfg.backgroundJobs=jobs;
    load.push({held,candidates,selectedSignaturesPerCandidateMinute:6,integrityJobsPerMinute:6,churn,backgroundCap,comparison:'SYNTHETIC_RPC_WORK_TOKENS_NOT_OBSERVED_CANDIDATE_WINDOWS',result:compact(runMonitoringReplay(cfg))});
  }
  const used=process.cpuUsage(cpu),result={schemaVersion:1,classification:'OFFLINE_ADAPTIVE_MONITORING_REPLAY_AND_EXPLICIT_SYNTHETIC_STRESS',recordedAt:new Date().toISOString(),networkRequests:0,productionChanged:false,entriesEnabled:false,liveTrading:false,acceptanceClockStarted:false,hypothesisSha256:sha(readFileSync(ROOT+'/hypotheses.json')),sources:{poolRecord:recordPath,poolRecordSha256:sha(readFileSync(recordPath)),poolProof:proofPath,poolProofSha256:sha(readFileSync(proofPath)),selection:'Deepest SOL reserve among retained verified pools, chosen for a stable small-order SDK stress seed, not representative market/strategy evidence.'},financialAssumptions:{referenceCapitalUsd:1000,referenceSolUsd:100,fx:'SYNTHETIC constant; passiveSOL benchmark0 change; no SOLprice-selectionconflation',entryBudgetLamports:'10000000',entryGasLamports:'7000',entryCostLamports:ENTRY.toString(),baseUnits:units.toString(),exitGasLamports:GAS.toString(),failedAttemptGasLamports:'7000',accountDeposit:'0 onlyunderexplicitexisting-accountfixtureassumption',risk:'Eachhypotheticalpositioncost$1.0007<50,3positions$3.0021<150;max3,noleverage/adds. Thisisnotanauthoritativeaccountoratradingbacktest.'},syntheticConstruction:'Piecewise constant hypothetical constant-product reserve states, integer sqrt and rounding, fixed captured fees/config/extensions; SDK full-size sell recomputed for each distinct reserve factor. These are not inferred chain trades or interpolated natural observations.',sdkFactorQuotes:Object.fromEntries(values),policies:POLICIES,cases:rows,retainedSparse:{sourceHash:captured.recordSha256,sourceIsQuiet:true,noFreshPriceInventedAtUncapturedPollTimes:true,outputScope:'Sparse-availability sensitivity only; no actual threshold crossing, exit-delay or policy superiority can be inferred.',results:actual},load,resources:{wallMs:performance.now()-began,cpuMs:(used.user+used.system)/1000,peakRssBytes:process.resourceUsage().maxRSS*1024,scope:'Cloudofflineprocess; simulatedtimeisnotelapsedunattendedoperation; perrunJIT/ordernotcontrolled'},sourceSha256:Object.fromEntries(['src/adaptive-monitoring.ts','src/research-clock-pricing.ts','src/pool.ts','src/strategy.ts','scripts/adaptive-monitoring-evaluation.ts'].map(p=>[p,sha(readFileSync(p))]))};
  const encoded=JSON.stringify(result)+'\n';if(Buffer.byteLength(encoded)>8*MIB)throw Error('RESULT_PAYLOAD_CAP');checkPrior();
  if(process.argv.includes('--verify-existing')){
    const existing=JSON.parse(readFileSync(ROOT+'/monitoring-results.json','utf8'));
    const semantic=(value:any):any=>Array.isArray(value)?value.map(semantic):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['processing','recordedAt','resources','sourceSha256'].includes(k)).map(([k,v])=>[k,semantic(v)])):value;
    if(JSON.stringify(semantic(result))!==JSON.stringify(semantic(existing)))throw Error('RECORDED_SEMANTICS_CHANGED');
    if(!existsSync(ROOT+'/parity-verification.json'))writeFileSync(ROOT+'/parity-verification.json',JSON.stringify({classification:'OFFLINE_SEMANTIC_REPLAY_VERIFICATION_AFTER_LEDGER_BOUNDARY_FIXES',recordedAt:new Date().toISOString(),resultSha256:sha(readFileSync(ROOT+'/monitoring-results.json')),sourceSha256:result.sourceSha256,all168MonitoringAnd180LoadOutcomesUnchanged:true,corrections:['Expiry is at or after deadline, charges no gas','Fresh execution quote must have source time at or after modeled executeAt','Committed baseline manifest replaces temporary selector'],networkRequests:0,priorCountersUnchanged:true},null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({verified:true,syntheticComparisons:rows.length,loadComparisons:load.length,networkRequests:0}));return;
  }
  writeFileSync(ROOT+'/monitoring-results.json',encoded,{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({output:ROOT+'/monitoring-results.json',syntheticComparisons:rows.length,loadComparisons:load.length,retainedPolicies:actual.length,bytes:Buffer.byteLength(encoded),cpuMs:result.resources.cpuMs,networkRequests:0}));
}
run();
