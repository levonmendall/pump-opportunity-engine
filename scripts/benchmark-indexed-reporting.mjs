/** Offline synthetic registry benchmark; no sockets, provider, account or ledger. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MarketRegistry} from '../src/market-registry.ts';
import {NativeCandidateRunner} from '../src/native-candidate-runner.ts';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.ts';

const AT=Date.parse('2026-11-02T04:00:00Z'),WATCH_ROWS=68050,MARKET_IDENTITIES=154519;
const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-indexed-reporting-')),path=join(directory,'registry.sqlite');
const registry=new MarketRegistry(path,{now:()=>AT}),unavailable=()=>{throw Error('OFFLINE_NO_SOURCE_OR_FINANCIAL_ACTION');};
const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:AT+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:unavailable,removeCandidate:unavailable,notificationLedger:unavailable,requestSupportRefresh:unavailable,requestHeartbeat:unavailable,service:unavailable,stop:unavailable};
const rpc={usage:()=>({waitingOrOperating:false,inFlight:0,closed:false,fatal:null,dispatchWindow:{readyAt:AT,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,call:unavailable};
const runner=new NativeCandidateRunner({registry,flow,rpc,runId:'OFFLINE-indexed-reporting',maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:()=>AT,record:()=>{}});
try {
 const base=runner.watch.discover({signature:'OFFLINE-base',feedMint:'OFFLINE-base',receivedAt:AT-86400000}),buildStart=performance.now();
 registry.transaction(()=>{
  registry.observeIdentity({mint:'OFFLINE-base',at:AT-86400000,source:'pumpportal-new-token',kind:'creation'});
  const proof=registry.db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)');
  for(let i=1;i<WATCH_ROWS;i++){
   const mint='OFFLINE-index-mint-'+i;
   registry.put({...base,signature:'OFFLINE-index-signature-'+i,mint,pool:'OFFLINE-index-pool-'+i,state:i%17===0?'DEFERRED':'WATCH',migrationAt:i%10===0?AT-600000:null,verifiedAt:i%10===0?AT-500000:null,observationIdentity:i%10===0?undefined:{basis:'canonical-pool-hint',availableAt:AT-500000,evidence:'OFFLINE retained observation identity'},firstSeenAt:AT-86400000+(i%86400)*1000,lastActivityAt:AT-(i%3600)*1000,waitingSince:AT-600000+i,history:Array.from({length:16},(_,j)=>({at:AT-100000+j,state:'WATCH',reason:'OFFLINE retained history '+String(i)+':'+String(j)+' '+'.'.repeat(96)}))});
   // Scalar report-only age fixtures. No source/evidence/entry method is callable.
   if(i%128===0)proof.run(mint,AT-600000,AT-500000,'{}');
  }
  for(let i=WATCH_ROWS;i<MARKET_IDENTITIES;i++)registry.observeIdentity({mint:'OFFLINE-index-mint-'+i,at:AT-1000,source:'pumpportal-new-token',kind:'creation'});
 });
 const buildMs=performance.now()-buildStart;
 registry.db.exec('DROP INDEX watch_rows_report_summary_v1;DROP INDEX watch_rows_report_page_v1');
 const upgradeStart=performance.now(),upgrade=new MarketRegistry(path,{now:()=>AT});upgrade.close();
 const indexUpgradeMs=performance.now()-upgradeStart,dbBytes=statSync(path).size,walBytes=statSync(path+'-wal').size;
 const original=registry.statement.bind(registry),results=[];
 const selected=status=>({tokenAgeScope:status.tokenAgeScope,watch:status.watch,pipeline:status.marketCoverage.pipeline,lifetime:status.marketCoverage.lifetime,active:status.marketCoverage.active,currentHour:status.marketCoverage.currentHour});
 const measure=(label,disableIndexSelection)=>{
  // Counterfactual isolates index selection with all current predicates intact.
  // Coverage's other query rewrite remains enabled in both variants.
  registry.statement=disableIndexSelection?sql=>original(sql.replaceAll(/ INDEXED BY watch_rows_report_(summary|page)_v1/g,'')):original;
  const samples=[],cpuSamples=[];let result;
  for(let i=0;i<4;i++){const start=performance.now(),cpuStart=process.cpuUsage();result=runner.status();const cpu=process.cpuUsage(cpuStart);samples.push(performance.now()-start);cpuSamples.push((cpu.user+cpu.system)/1000);}
  results.push({label,samplesMs:samples,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,maxMs:Math.max(...samples),cpuSamplesMs:cpuSamples,meanCpuMs:cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length});return result;
 };
 const writesBefore=registry.health().transactions.writeCommits,before=measure('same-predicates-index-selection-disabled',true),after=measure('indexed-current-status',false);
 assert.deepEqual(selected(after),selected(before));assert.equal(after.watch.summary.known,WATCH_ROWS);assert.equal(after.watch.rows.length,64);assert.equal(after.marketCoverage.lifetime.uniqueTokensDiscovered,MARKET_IDENTITIES);assert.equal(after.slotProductivity.configuredSlots,4);assert.equal(registry.health().transactions.writeCommits,writesBefore);
 const newIdentity='OFFLINE-after-report';registry.observeIdentity({mint:newIdentity,at:AT,source:'pumpportal-new-token',kind:'creation'});assert.equal(runner.status().marketCoverage.lifetime.uniqueTokensDiscovered,MARKET_IDENTITIES+1,'a later report cannot reuse an old identity population');
 const hashes=Object.fromEntries(['src/market-registry.ts','src/pilot-watch.ts','src/native-candidate-runner.ts'].map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
 process.stdout.write(JSON.stringify({kind:'OFFLINE_SYNTHETIC_INDEXED_REPORTING_BENCHMARK_V1',node:process.version,sourceHashes:hashes,fixture:{watchRows:WATCH_ROWS,marketIdentities:MARKET_IDENTITIES,retainedHistoryPerWatchRow:16,enforceTokenAge24h:true,configuredSlots:4,buildMs,indexUpgradeMs,dbBytes,walBytes,synthetic:true},results,ratio:results[0].meanMs/results[1].meanMs,fullPopulationParityVerified:true,laterMutationObserved:true,reportWrites:0,networkRequests:0,financialWriterOpened:false,limitations:['Synthetic disposable registry, not a production database or financial replay.','Counterfactual disables report index selection only; it is not a claim to benchmark an entire former release.','Wall/CPU measurements apply to this execution workspace and short workload, not an EC2 latency guarantee.','Synchronous fresh reports still have population-dependent work; no continuous timing or held-position performance is proved.','Fixture creation and index-maintenance cost are outside measured status calls and reported separately.']},null,2)+'\n');
}finally{registry.close();rmSync(directory,{recursive:true,force:true});}
