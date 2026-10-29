// Actual ComponentBudget durability-latency replay. No network or financial DB.
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const modulePath=resolve(process.argv[2]),output=resolve(process.argv[3]);
const {ComponentBudget}=await import(pathToFileURL(modulePath).href);
const sourceHash=createHash('sha256').update(readFileSync(modulePath)).digest('hex');
const directory=mkdtempSync(join(tmpdir(),'poe-passive-accounting-latency-')),startedAt=Date.now();let inject=false;
const gate=new ComponentBudget({statePath:join(directory,'counterbook.json'),grantId:'offline-passive-accounting-latency',baseline:{calls:0,bytes:0,starts:[],refusal:'RPC_HTTP_429',refusalAt:0,sha256:'a'.repeat(64)},startedAt,continuousAccounting:true,limits:{maxCumulativeUnits:null,maxCumulativeBytes:null},beforePersist(){if(inject)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}});
let last=performance.now(),maxGap=0,ticks=0;
const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},50);
await new Promise(r=>setTimeout(r,70));const begin=performance.now();inject=true;
for(let i=0;i<1200;i++)gate.chargePassiveWs(4096);
inject=false;const elapsed=performance.now()-begin;await new Promise(r=>setTimeout(r,70));clearInterval(timer);
const usage=gate.usage(),beforeClose=JSON.parse(readFileSync(join(directory,'counterbook.json'),'utf8'));gate.close();
const closed=JSON.parse(readFileSync(join(directory,'counterbook.json'),'utf8'));
const result={kind:'OFFLINE_PASSIVE_ACCOUNTING_SYNCHRONOUS_BLOCK_REPRODUCTION',modulePath,sourceSha256:sourceHash,receipts:1200,bytes:1200*4096,injectedBeforeEachDurablePersistMs:10,elapsedMs:elapsed,maximum50msTimerGapMs:maxGap,timerTicks:ticks,actualCalls:usage.newUnits,httpBytes:usage.httpBytes,wsBytes:usage.wsBytes,durableObservedBeforeClose:beforeClose.wsBytes,durableCrashTailBeforeClose:beforeClose.byteAccounting?.reservedBytes??0,durableWsBytesAfterClose:closed.wsBytes,persistence:usage.persistence,receiptAccounting:usage.byteAccounting??null,providerRequests:0,financialDatabaseOpened:false,productionTouched:false,liveFailureAttribution:false,meaning:'Actual ComponentBudget passive-receipt path with explicit offline durability-latency injection; compares same-thread timer starvation and durable crash coverage. This does not attribute the live protection breach.'};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
