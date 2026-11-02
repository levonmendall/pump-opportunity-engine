/** Reproducible offline reporting profile. Disposable synthetic data; no provider or account access. */
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.ts';
import {NativeCandidateRunner} from '../src/native-candidate-runner.ts';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.ts';

const AT=Date.parse('2026-11-02T18:30:00Z'),WATCH_ROWS=68050,MARKET_IDENTITIES=181323;
const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-trading-report-'));
const registry=new MarketRegistry(join(directory,'registry.sqlite'),{now:()=>AT});
const unavailable=()=>{throw Error('OFFLINE_NO_SOURCE_OR_FINANCIAL_ACTION');};
const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:AT+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:unavailable,removeCandidate:unavailable,notificationLedger:unavailable,requestSupportRefresh:unavailable,requestHeartbeat:unavailable,service:unavailable,stop:unavailable};
const rpc={usage:()=>({waitingOrOperating:false,inFlight:0,closed:false,fatal:null,dispatchWindow:{readyAt:AT,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,call:unavailable};
const runner=new NativeCandidateRunner({registry,flow,rpc,runId:'OFFLINE-trading-report',maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:()=>AT,record:()=>{}});
try {
 const base=runner.watch.discover({signature:'OFFLINE-base',feedMint:'OFFLINE-base',receivedAt:AT-86400000}),buildStart=performance.now();
 registry.transaction(()=>{
  const proof=registry.db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)');
  for(let i=1;i<WATCH_ROWS;i++){
   const mint='OFFLINE-profile-mint-'+i;
   registry.put({...base,signature:'OFFLINE-profile-signature-'+i,mint,pool:'OFFLINE-profile-pool-'+i,state:i%17===0?'DEFERRED':'WATCH',migrationAt:i%10===0?AT-600000:null,verifiedAt:i%10===0?AT-500000:null,observationIdentity:i%10===0?undefined:{basis:'canonical-pool-hint',availableAt:AT-500000,evidence:'OFFLINE retained identity'},firstSeenAt:AT-86400000+(i%86400)*1000,lastActivityAt:AT-(i%3600)*1000,waitingSince:AT-600000+i});
   if(i%128===0)proof.run(mint,AT-600000,AT-500000,'{}');
  }
  for(let i=WATCH_ROWS;i<MARKET_IDENTITIES;i++)registry.observeIdentity({mint:'OFFLINE-profile-mint-'+i,at:AT-1000,source:'pumpportal-new-token',kind:'creation'});
 });
 const buildMs=performance.now()-buildStart,methods=['verificationStats','tokenAgeSummary','coverageSnapshot','cohortCounts','metricSummary','valueSummary','aggregate'],methodTotals={};
 for(const name of methods){const original=registry[name].bind(registry);registry[name]=(...args)=>{const start=performance.now();try{return original(...args);}finally{const key=name==='aggregate'?name+':'+Object.keys(args[0]).join(','):name;const row=methodTotals[key]??={calls:0,totalMs:0};row.calls++;row.totalMs+=performance.now()-start;}};}
 const samples=[];let selected;
 for(let i=0;i<5;i++){
  const start=performance.now(),cpuStart=process.cpuUsage(),status=runner.status(),cpu=process.cpuUsage(cpuStart);
  samples.push({elapsedMs:performance.now()-start,cpuMs:(cpu.user+cpu.system)/1000});
  selected={tokenAgeScope:status.tokenAgeScope,watch:status.watch,pipeline:{...status.marketCoverage.pipeline,sourceInstanceId:'OFFLINE-SCOPE'},coverage:{lifetime:status.marketCoverage.lifetime,active:status.marketCoverage.active,currentHour:status.marketCoverage.currentHour}};
 }
 const sourceHashes=Object.fromEntries(['src/market-registry.ts','src/pilot-watch.ts','src/native-candidate-runner.ts'].map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
 process.stdout.write(JSON.stringify({kind:'OFFLINE_SYNTHETIC_TRADING_REPORT_PROFILE_V1',node:process.version,sourceHashes,fixture:{watchRows:WATCH_ROWS,marketIdentities:MARKET_IDENTITIES,buildMs,synthetic:true},samples,meanMs:samples.reduce((s,r)=>s+r.elapsedMs,0)/samples.length,methodTotals,selectedHash:createHash('sha256').update(JSON.stringify(selected)).digest('hex'),selected,networkRequests:0,financialWriterOpened:false,limitations:['Synthetic short-workload profile, not a production latency guarantee.','Method timings can be nested; do not sum overlapping measurements.']},null,2)+'\n');
}finally{registry.close();rmSync(directory,{recursive:true,force:true});}
