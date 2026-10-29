/** OFFLINE ONLY. A scheduling workload experiment using the actual PilotRpc and
 * ComponentBudget. Injected fetch never connects to any endpoint. No ledger. */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PilotRpc} from '/workspace/pump-opportunity-engine/src/pilot-rpc.ts';
import {PUBLICNODE_HISTORY_ROUTE} from '/workspace/pump-opportunity-engine/src/component-transport.ts';

const repository='/workspace/pump-opportunity-engine',MIB=1024*1024;
const prefix='/tmp/poe-local-60-90-capacity-20261029';
const sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const sourceFiles=['src/pilot-rpc.ts','src/component-budget.ts','src/component-transport.ts','src/native-research-profile.ts','src/research-baseline.ts','src/network.ts'];
const sources=Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(join(repository,p)))]));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
type Kind='held'|'audit'|'heartbeat'|'support';
type Job={id:string;kind:Kind;candidate:number|null;due:number;deadline:number;latestStart:number;priority:number;tie:number;status?:string;started?:number;finished?:number;code?:string};
const horizon=180000,epoch=200000,declaredTimeout=1500;

async function run(candidates:number,limit:60|90,latencyCase:'fast120ms'|'adverse1200_1400ms'){
 const directory=mkdtempSync(prefix+'-books-');chmodSync(directory,0o700);
 const old=join(directory,'prior.json'),prior=JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:0,bytes:0,lastObservedAt:2000,starts:[],pending:[]})+'\n';
 writeFileSync(old,prior,{mode:0o600});
 let now=epoch,mono=epoch,active=0,maxActive=0,wireBytes=0,calls=0,selected:Job|null=null;
 const advance=(ms:number)=>{assert.ok(Number.isSafeInteger(ms)&&ms>=0);now+=ms;mono+=ms;};
 const trace:Array<{kind:string;data:any}>=[],wire:Array<{at:number;method:string;latencyMs:number;responseBytes:number;job:string}>=[];
 const fetcher=(async(_url:any,init:any)=>{
  assert.ok(selected);assert.equal(active,0,'No concurrent synthetic fetch');active++;maxActive=Math.max(maxActive,active);
  try{
   const request=JSON.parse(String(init.body)),at=now,latencyMs=latencyCase==='fast120ms'?120:(calls%5===4?1400:1200);calls++;
   // Advance only injected scheduling clocks. Real timers/CPU/network are not
   // advanced; this case does not test real timer firing or HTTP timeouts.
   advance(latencyMs);
   const result=request.method==='getSignaturesForAddress'?[]:{context:{slot:123},value:[]};
   const body=JSON.stringify({jsonrpc:'2.0',id:request.id,result}),bytes=Buffer.byteLength(body);wireBytes+=bytes;
   wire.push({at,method:request.method,latencyMs,responseBytes:bytes,job:selected.id});
   return new Response(body,{status:200,headers:{'content-length':String(bytes)}});
  }finally{active--;}
 }) as typeof fetch;
 const rpc=new PilotRpc({directory:join(directory,'run'),runId:`offline-${candidates}-${limit}-${latencyCase.toLowerCase().replaceAll('_','-')}`,baselinePaths:[old],priorPhysicalSettled:true,priorCooldownUntil:0,priorHistoryCooldownUntil:0,historyRoute:PUBLICNODE_HISTORY_ROUTE.version,persistent:true,profile:limit===90?'candidate-native-two-hour-90-research-v1':'candidate-native-two-hour-research-v1',...(limit===90?{maxStartsPerMinute:90}:{}),maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,maxResponseBytes:256*MIB,maxUnits:1500,maxChapters:64,now:()=>now,monotonic:()=>mono,sleep:async ms=>advance(ms),fetcher,record:(kind,data)=>trace.push({kind,data:structuredClone(data)})});
 const jobs:Job[]=[];
 function add(kind:Kind,candidate:number|null,due:number,deadline:number,priority:number,tie:number){jobs.push({id:`${kind}-${candidate??'shared'}-${due}`,kind,candidate,due:epoch+due,deadline:epoch+deadline,latestStart:epoch+deadline-declaredTimeout,priority,tie});}
 for(let due=0,round=0;due<horizon;due+=10000,round++)for(let candidate=0;candidate<candidates;candidate++)add('audit',candidate,due,due+9999,1,(candidate-round%candidates+candidates)%candidates);
 for(let due=0;due<horizon;due+=2000)add('held',null,due,due+2000,0,0);
 for(let due=0;due<horizon;due+=10000)add('heartbeat',null,due,due+9999,2,0);
 for(let due=0;due<horizon;due+=25000)add('support',null,due,due+10000,3,0);
 jobs.sort((a,b)=>a.due-b.due||a.priority-b.priority||a.tie-b.tie);
 const pending:Job[]=[],arrivals=[...jobs];let transitions=0;
 while(arrivals.length||pending.length){
  assert.ok(++transitions<100000,'bounded scheduler progress');
  while(arrivals.length&&arrivals[0]!.due<=now)pending.push(arrivals.shift()!);
  if(!pending.length){advance(arrivals[0]!.due-now);continue;}
  pending.sort((a,b)=>a.priority-b.priority||a.deadline-b.deadline||a.tie-b.tie||a.id.localeCompare(b.id));
  const job=pending[0]!,usage=rpc.usage(),dispatch=job.kind==='audit'?usage.historyDispatchWindow:usage.rpcDispatchWindow;
  const readyAt=dispatch?.readyAt??now;
  if(readyAt>now&&readyAt<=job.latestStart){advance(Math.min(readyAt,arrivals[0]?.due??Infinity)-now);continue;}
  pending.shift();selected=job;job.started=now;
  try{
   const method=job.kind==='audit'?'getSignaturesForAddress':'getMultipleAccounts';
   const params=job.kind==='audit'?['11111111111111111111111111111111',{commitment:'confirmed',limit:100}]:[[],{commitment:'confirmed'}];
   await rpc.call(method,params,undefined,{timeoutMs:declaredTimeout,latestStartAt:job.latestStart,admissionOpen:()=>now<=job.latestStart,...(job.kind==='audit'?{queryTimeoutScope:'independent-history' as const}:{})});
   job.finished=now;job.status=now<=job.deadline?'completed':'completed-after-deadline';
  }catch(error){job.finished=now;job.code=error instanceof Error?error.message:String(error);job.status=/DISPATCH_EXPIRED|ADMISSION_CLOSED/.test(job.code)?'local-refused':'other-error';}
  selected=null;
 }
 const final=rpc.usage();rpc.close();assert.equal(readFileSync(old,'utf8'),prior,'Synthetic prior book preserved');assert.equal(active,0);assert.equal(final.inFlight,0);assert.equal(final.uncertainResponseBytes,0);assert.equal(final.newUnits,wire.length);assert.equal(final.newAccountedResponseBytes,wireBytes);
 const starts=wire.map(x=>x.at),maxWithin=(ms:number)=>Math.max(0,...starts.map(at=>starts.filter(t=>t<=at&&t>at-ms).length));
 const minimumSpacing=starts.length>1?Math.min(...starts.slice(1).map((at,i)=>at-starts[i]!)):null;
 assert.ok(minimumSpacing!==null&&minimumSpacing>=250);assert.ok(maxWithin(10000)<=20);assert.ok(maxWithin(60000)<=limit);assert.equal(maxActive,1);
 const grouped=Object.fromEntries((['held','audit','heartbeat','support'] as const).map(kind=>{const list=jobs.filter(j=>j.kind===kind);return[kind,{arrived:list.length,completedOnTime:list.filter(j=>j.status==='completed').length,completedLate:list.filter(j=>j.status==='completed-after-deadline').length,localRefused:list.filter(j=>j.status==='local-refused').length,otherErrors:list.filter(j=>j.status==='other-error').length,deadlineMisses:list.filter(j=>j.status!=='completed').length,maximumDispatchDelayMs:Math.max(0,...list.filter(j=>j.status?.startsWith('completed')).map(j=>j.started!-j.due))}];}));
 const held=jobs.filter(j=>j.kind==='held'&&j.status?.startsWith('completed')).sort((a,b)=>a.finished!-b.finished!);
 const heldGaps=held.slice(1).map((j,i)=>j.finished!-held[i]!.finished!);
 const summary={candidates,limit,latencyCase,classification:'SYNTHETIC_OFFLINE_GATE_EXPERIMENT_NO_PROVIDER_REQUESTS_NO_LEDGER',directory,scheduledArrivalHorizonMs:horizon,actualFakeClockElapsedMs:now-epoch,steadyDemandPerMinute:candidates*6+30+6+60/25,actualArrivals:jobs.length,actualArrivalRatePerMinute:jobs.length/(horizon/60000),jobs:grouped,heldMaximumCompletionGapMs:heldGaps.length?Math.max(...heldGaps):null,heldFirstCompletedAtMs:held[0]?.finished!==undefined?held[0].finished-epoch:null,heldLastCompletedAtMs:held.at(-1)?.finished!==undefined?held.at(-1)!.finished!-epoch:null,physical:{maximumConcurrentFetch:maxActive,minimumStartSpacingMs:minimumSpacing,maximumStartsPer10Seconds:maxWithin(10000),maximumStartsPerMinute:maxWithin(60000),completedPhysicalRequests:wire.length,actualDecodedResponseBytes:wireBytes,accountedResponseBytes:final.newAccountedResponseBytes,unsettledAtEnd:final.inFlight,uncertainResponseBytes:final.uncertainResponseBytes},perCandidate:jobs.filter(j=>j.kind==='audit').reduce((out,j)=>{const key=String(j.candidate);out[key]??={arrivals:0,completed:0,missed:0};out[key].arrivals++;out[key][j.status==='completed'?'completed':'missed']++;return out;},{} as Record<string,{arrivals:number;completed:number;missed:number}>),errors:[...new Set(jobs.flatMap(j=>j.code?[j.code]:[]))]};
 const rawPath=`${prefix}-${candidates}-${limit}-${latencyCase}-raw.json`;
 writeFileSync(rawPath,JSON.stringify({summary,jobs,wire,trace,finalRpcUsage:final},null,2)+'\n',{mode:0o600});
 return{...summary,rawPath,rawSha256:sha(readFileSync(rawPath))};
}
const output:any={createdAt:new Date().toISOString(),source:{head,sourceHashes:sources,scriptSha256:sha(readFileSync(import.meta.filename))},assumptions:{horizonMs:horizon,heldIntervalMs:2000,heldCompletionDeadlineAfterDueMs:2000,auditIntervalMs:10000,auditDeadlineAfterDueMs:9999,heartbeatIntervalMs:10000,heartbeatCompletionDeadlineAfterDueMs:9999,supportIntervalMs:25000,supportCompletionDeadlineAfterDueMs:10000,latestStartReserveMs:declaredTimeout,priority:'Due held coherent reads, then earliest-deadline audits with rotating tie fairness, then heartbeat, then support. A single in-flight request is non-preemptible. Future arrivals are considered while waiting for the real shared gate.',latencies:'Injected fake-clock120ms, or1200ms with every fifth operation1400ms; every response is valid synthetic HTTP200. Real timeout timers are not exercised.',methodSemantics:'Audit is one getSignaturesForAddress page; held/heartbeat/support each modeled as one getMultipleAccounts physical request. No trade-flow/window/price/financial validation implied.'},limitations:['Not the installed runtime scheduler, native capture, actual historical auditing, provider latency, provider rate entitlement, hosting resource capacity or PAPER position protection acceptance.','The workload assumes exactly one history page per audit; busy multipage histories and execution actions add demand.','Real source fsync/serialization CPU and wall latency are not charged to the fake scheduling clock. Raw records preserve actual class behavior; synthetic timing is a deliberately declared model.','No HTTP429/503, response truncation, real timer timeout, reconnect or uncertain physical settlement is injected.','An arrival horizon starts with empty rolling history and includes eight support jobs over180s; steady rate differs slightly from finite-boundary rate.'],scenarios:[]};
for(const candidates of [4,6])for(const limit of [60,90] as const)for(const latencyCase of ['fast120ms','adverse1200_1400ms'] as const)output.scenarios.push(await run(candidates,limit,latencyCase));
output.source.hashesUnchangedAfterRun=Object.fromEntries(sourceFiles.map(p=>[p,sha(readFileSync(join(repository,p)))===sources[p]]));assert.ok(Object.values(output.source.hashesUnchangedAfterRun).every(Boolean),'Imported source changed during experiment');
writeFileSync(prefix+'-result.json',JSON.stringify(output,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({resultPath:prefix+'-result.json',source:output.source,scenarios:output.scenarios},null,2));
