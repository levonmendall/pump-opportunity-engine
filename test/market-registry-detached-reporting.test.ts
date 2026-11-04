/** Actual worker, SQLite/WAL and parent reporting bridge; disposable discovery
 * data only. No engine, provider, order or financial writer runs in the worker. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import {readMarketRegistryReporting,type MarketRegistryReportingScope} from '../src/market-registry-reporting.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,2));
async function until(condition:()=>boolean,label:string){const deadline=performance.now()+10000;while(!condition()){assert.ok(performance.now()<deadline,label);await pause();}}
const databaseContents=(registry:MarketRegistry)=>{const db=(registry as unknown as {db:Database.Database}).db;return createHash('sha256').update(JSON.stringify(['watch_rows','watch_history','registry_metadata'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()))).digest('hex');};

test('real optional worker snapshot follows durable intake ACKs without watch recovery, membership writes or main-thread aggregate fallback',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-detached-summary-')),path=join(directory,'market-registry.sqlite');
 const registry=new MarketRegistry(path,{concurrentIntake:true}),at=Date.now(),watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,record:()=>{}});
 const first=watch.discover({signature:'OFFLINE-watch',feedMint:'OFFLINE-observed',receivedAt:at})!;watch.verify(first.signature,{mint:'OFFLINE-observed',pool:'OFFLINE-pool',migrationAt:at-300000,verifiedAt:at});watch.transition('OFFLINE-observed','DEEP_OBSERVATION','OFFLINE actual allocation retained',at);
 const messages:any[]=[],scope:MarketRegistryReportingScope={registryId:watch.export().registry!.id,sourceInstanceId:'native-runner:OFFLINE:detached-a',startedAt:at,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,strategy:'liquidity-resilient-momentum-v3.1',requireOrigin:false,pumpswapOnly:false,enforceTokenAge24h:false,enforceMigrationAge:false};
 const code=`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();const {startMarketRegistryIntakeWorker}=await import(${JSON.stringify(new URL('../src/market-registry-intake-worker.ts',import.meta.url).href)});const {workerData}=await import('node:worker_threads');startMarketRegistryIntakeWorker(workerData);`;
 const intake=new NativeMarketIntake({createWorker:()=>{const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{path,writerTurn:registry.writerTurnBuffer(),maximumComputeMs:1,pendingBytesBudget:1024*1024,writerYieldMs:3}});worker.on('message',m=>messages.push(m));return worker;},onCommitted:()=>{},onPressure:()=>{}});
 try{
  await until(()=>intake.available(),'worker ready');
  for(let n=0;n<300;n++)intake.observeIdentity({mint:'OFFLINE-intake-'+n,receivedAt:Date.now(),source:'pumpapi-broad',kind:'activity',evidence:'unverified-provider-discovery-hint'});
  await until(()=>intake.usage().durableCommitted===300,'initial intake drain');intake.registryReporting(scope);
  await until(()=>messages.some(m=>m.kind==='reporting-result'),'optional result after initial drain');
  const result=messages.find(m=>m.kind==='reporting-result');assert.equal(result.reasonCode,null);assert.ok(result.durationMs>=0);assert.ok(result.completedAt>=result.observedAt);
  const index=messages.indexOf(result),acks=messages.slice(0,index).filter(m=>m.kind==='committed');assert.equal(acks.flatMap(m=>m.ids).length,300,'all already queued records commit and ACK before optional summary');
  const before=databaseContents(registry),expected=readMarketRegistryReporting(registry,scope,result.observedAt);
  assert.deepEqual(result.snapshot.watch,expected.watch);assert.deepEqual(result.snapshot.backlog,expected.backlog);assert.deepEqual(result.snapshot.verification,expected.verification);assert.deepEqual(result.snapshot.cohort,expected.cohort);assert.deepEqual(result.snapshot.coverage.lifetime,expected.coverage.lifetime);
  assert.equal(registry.lookup('OFFLINE-observed')!.state,'DEEP_OBSERVATION','worker must never run PilotWatch restart recovery');
  const view=intake.registryReporting(scope);assert.equal(view.health.state,'FRESH');assert.equal(view.health.observedAt,result.observedAt);assert.equal(view.health.completedAt,result.completedAt);assert.equal(view.health.sampleWorkerGeneration,1);assert.equal(view.snapshot?.coverage.lifetime.uniqueTokensDiscovered,301);assert.equal(databaseContents(registry),before);
  const bad={...scope,registryId:'wrong-source-registry'};await new Promise(resolve=>setTimeout(resolve,1000));intake.registryReporting(bad);
  await until(()=>messages.filter(m=>m.kind==='reporting-result').length===2,'failed optional scope read');assert.equal(messages.at(-1).reasonCode,'REPORTING_SCOPE_UNAVAILABLE');assert.equal(intake.available(),true);assert.equal(intake.usage().failures,0);
  intake.observeIdentity({mint:'OFFLINE-after-report-refusal',receivedAt:Date.now(),source:'pumpapi-broad',kind:'activity',evidence:'unverified-provider-discovery-hint'});await until(()=>intake.usage().durableCommitted===301,'intake after optional refusal');assert.equal(messages.some(m=>m.kind==='failure'),false);
 }finally{await intake.close();registry.close();rmSync(directory,{recursive:true,force:true});}
});

test('read snapshot contention never poisons registry health or masquerades as permanent unsupported state',()=>{
 const registry=new MarketRegistry(':memory:');try{
  const before=registry.health(),error=Object.assign(Error('OFFLINE busy snapshot'),{code:'SQLITE_BUSY_SNAPSHOT'});
  assert.throws(()=>registry.readTransaction(()=>{throw error;}),candidate=>candidate===error);
  const after=registry.health();assert.equal(after.available,true);assert.equal(after.storageFailures,before.storageFailures);assert.equal(after.transactions.failed,before.transactions.failed+1);
  registry.observeIdentity({mint:'still-observable',receivedAt:Date.now(),source:'pumpapi-broad',kind:'activity',evidence:'unverified-provider-discovery-hint'});assert.equal(registry.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,1);
 }finally{registry.close();}
});

test('real parent and worker refresh optional snapshots during sustained ACK backlog, after FULL committed receipts',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-report-fairness-')),path=join(directory,'market-registry.sqlite');
 const registry=new MarketRegistry(path,{concurrentIntake:true}),at=Date.now(),watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,record:()=>{}});
 const scope:MarketRegistryReportingScope={registryId:watch.export().registry!.id,sourceInstanceId:'native-runner:OFFLINE:backlogged',startedAt:at,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,strategy:'liquidity-resilient-momentum-v3.1',requireOrigin:false,pumpswapOnly:false,enforceTokenAge24h:false,enforceMigrationAge:false};
 const code=`import {register} from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))};register();const {startMarketRegistryIntakeWorker}=await import(${JSON.stringify(new URL('../src/market-registry-intake-worker.ts',import.meta.url).href)});const {workerData}=await import('node:worker_threads');startMarketRegistryIntakeWorker(workerData);`;
 const messages:any[]=[],reportReceipts:Array<{result:any;acknowledged:number;pending:number}>=[];let worker!:Worker;
 const intake=new NativeMarketIntake({createWorker:()=>{worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{path,writerTurn:registry.writerTurnBuffer(),maximumComputeMs:0.001,pendingBytesBudget:1024*1024,writerYieldMs:3}});worker.on('message',message=>{messages.push(message);if(message.kind==='reporting-result')reportReceipts.push({result:message,acknowledged:intake.usage().processedAcknowledged,pending:intake.usage().pending});});return worker;},onCommitted:()=>{},onPressure:()=>{}});
 try{
  await until(()=>intake.available(),'fairness worker ready');
  for(let n=0;n<1200;n++)intake.observeIdentity({mint:'OFFLINE-fairness-'+n,receivedAt:Date.now(),source:'pumpapi-broad',kind:'activity',evidence:'unverified-provider-discovery-hint'});
  intake.registryReporting(scope);assert.equal(messages.some(row=>row.kind==='reporting-result'),false);
  await until(()=>{intake.registryReporting(scope);return reportReceipts.length>=2;},'two optional snapshots while intake remains backlogged');
  for(const receipt of reportReceipts.slice(0,2)){
   const {result,acknowledged,pending}=receipt,index=messages.indexOf(result),prior=messages.slice(0,index).filter(row=>row.kind==='committed');
   assert.equal(result.reasonCode,null);assert.ok(pending>0,'reporting must not wait for complete queue drainage');assert.ok(acknowledged>0&&acknowledged<1200);
   assert.equal(prior.flatMap(row=>row.ids).length,acknowledged,'every certified prefix ACK is actually sent and applied before the optional result');
   assert.equal(result.snapshot.coverage.lifetime.uniqueTokensDiscovered,acknowledged,'the coherent read certifies only actually committed identities');
   assert.ok(prior.at(-1).stats.pending>0,'the actual worker queue is still nonempty at its preceding FULL commit');
   assert.ok(result.observedAt>=prior.at(-1).committedAt);assert.ok(result.completedAt>=result.observedAt);
  }
  const [first,second]=reportReceipts;assert.ok(first&&second);
  assert.ok(second.acknowledged>first.acknowledged,'intake continues between refreshed snapshots');
  assert.ok(second.result.requestedAt-first.result.requestedAt>=1000,'the existing refresh budget still bounds optional requests');
  const view=intake.registryReporting(scope);assert.equal(view.health.state,'FRESH');assert.equal(view.health.observedAt,second.result.observedAt);assert.equal(view.health.sampleWorkerGeneration,1);
  const bad={...scope,registryId:'OFFLINE-wrong-backlog-scope'};await until(()=>{intake.registryReporting(bad);return reportReceipts.length>=3;},'optional scope refusal during backlog');
  const refused=reportReceipts[2]!;assert.equal(refused.result.reasonCode,'REPORTING_SCOPE_UNAVAILABLE');assert.ok(refused.pending>0);
  const retained=intake.registryReporting(scope);assert.equal(retained.health.observedAt,second.result.observedAt);assert.equal(retained.health.reasonCode,'REPORTING_SCOPE_UNAVAILABLE');assert.equal(intake.available(),true);
  await until(()=>intake.usage().processedAcknowledged===1200,'remaining durable intake drain');assert.equal(intake.usage().durableCommitted,1200);assert.equal(intake.usage().pending,0);assert.equal(intake.usage().failures,0);assert.equal(intake.usage().restarts,0);assert.equal(intake.usage().financialWriterOpened,false);assert.equal(messages.some(row=>row.kind==='failure'),false);
  assert.equal(registry.coverageSnapshot(Date.now()).lifetime.uniqueTokensDiscovered,1200);
  t.diagnostic(JSON.stringify({fixture:'REAL_PARENT_AND_WORKER_WAL_BACKLOG',received:1200,reports:reportReceipts.slice(0,3).map(({result,acknowledged,pending})=>({reasonCode:result.reasonCode,requestedAt:result.requestedAt,observedAt:result.observedAt,completedAt:result.completedAt,durationMs:result.durationMs,acknowledged,pending})),finalAcknowledged:intake.usage().processedAcknowledged,finalPending:intake.usage().pending,sourceFailures:intake.usage().failures,sourceRestarts:intake.usage().restarts,financialWriterOpened:intake.usage().financialWriterOpened}));
 }finally{await intake.close();await worker.terminate();registry.close();rmSync(directory,{recursive:true,force:true});}
});
