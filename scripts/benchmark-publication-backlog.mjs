/** Offline paired profile; disposable synthetic registry, no source/financial actions. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.ts';
import {NativeCandidateRunner} from '../src/native-candidate-runner.ts';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.ts';
import {releasedServiceableBacklog} from '../test/fixtures/native-watch-backlog-before-publication-repair.ts';

const AT=Date.parse('2026-11-02T18:30:00Z'),WATCH_ROWS=68050,MARKET_IDENTITIES=181323;
const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-publication-backlog-'));
const registry=new MarketRegistry(join(directory,'registry.sqlite'),{now:()=>AT});
const unavailable=()=>{throw Error('OFFLINE_NO_SOURCE_OR_FINANCIAL_ACTION');};
const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:AT+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:unavailable,removeCandidate:unavailable,notificationLedger:unavailable,requestSupportRefresh:unavailable,requestHeartbeat:unavailable,service:unavailable,stop:unavailable};
const rpc={usage:()=>({waitingOrOperating:false,inFlight:0,closed:false,fatal:null,dispatchWindow:{readyAt:AT,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,call:unavailable};
const runner=new NativeCandidateRunner({registry,flow,rpc,runId:'OFFLINE-publication-backlog',maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,activeStrategy:'liquidity-resilient-momentum-v3.1',now:()=>AT,record:()=>{}});
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
 const buildMs=performance.now()-buildStart,variants={released:releasedServiceableBacklog,candidate:runner.watch.serviceableBacklog};
 const samples={released:[],candidate:[]},methodTotals={released:{},candidate:{}};
 let activeVariant=null,expectedSelected,selectedHash,population;
 for(const name of ['watchReportingPopulation','verificationStats','tokenAgeSummary','coverageSnapshot','cohortCounts','metricSummary','valueSummary','aggregate']){
  const original=registry[name].bind(registry);
  registry[name]=(...args)=>{const start=performance.now();try{return original(...args);}finally{if(activeVariant){const key=name==='aggregate'?name+':'+Object.keys(args[0]).join(','):name,row=methodTotals[activeVariant][key]??={calls:0,totalMs:0};row.calls++;row.totalMs+=performance.now()-start;}}};
 }
 const inspect=(variant,measure)=>{
  runner.watch.serviceableBacklog=variants[variant];activeVariant=measure?variant:null;
  const start=performance.now(),cpuStart=process.cpuUsage(),status=runner.status(),cpu=process.cpuUsage(cpuStart);
  if(measure)samples[variant].push({elapsedMs:performance.now()-start,cpuMs:(cpu.user+cpu.system)/1000});
  activeVariant=null;
  const selected={tokenAgeScope:status.tokenAgeScope,watch:status.watch,pipeline:{...status.marketCoverage.pipeline,sourceInstanceId:'OFFLINE-SCOPE'},coverage:{lifetime:status.marketCoverage.lifetime,active:status.marketCoverage.active,currentHour:status.marketCoverage.currentHour}};
  if(expectedSelected)assert.deepEqual(selected,expectedSelected,'all selected fresh report values must be exactly equal');else expectedSelected=selected;
  selectedHash=createHash('sha256').update(JSON.stringify(selected)).digest('hex');population=selected.pipeline.population;
 };
 // Warm both exact query variants, then alternate order on the same database.
 for(let i=0;i<3;i++)for(const variant of ['released','candidate'])inspect(variant,false);
 for(let i=0;i<10;i++)for(const variant of i%2?['candidate','released']:['released','candidate'])inspect(variant,true);
 const summaries=Object.fromEntries(Object.entries(samples).map(([name,rows])=>{const sorted=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b);return [name,{samples:rows.length,meanMs:rows.reduce((s,r)=>s+r.elapsedMs,0)/rows.length,medianMs:(sorted[4]+sorted[5])/2,maximumMs:sorted.at(-1)}];}));
 const sourceHashes=Object.fromEntries(['src/market-registry.ts','src/pilot-watch.ts','src/native-candidate-runner.ts','test/fixtures/native-watch-backlog-before-publication-repair.ts'].map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
 process.stdout.write(JSON.stringify({kind:'OFFLINE_PAIRED_PUBLICATION_BACKLOG_PROFILE_V1',node:process.version,sourceHashes,fixture:{watchRows:WATCH_ROWS,marketIdentities:MARKET_IDENTITIES,buildMs,synthetic:true},summaries,samples,methodTotals,selectedHash,population,allSelectedReportsExactlyEqual:true,networkRequests:0,financialWriterOpened:false,limitations:['Synthetic warm candidate-status profile, not the complete publication or a production latency guarantee.','Method timings can be nested; do not sum overlapping measurements.']},null,2)+'\n');
}finally{registry.close();rmSync(directory,{recursive:true,force:true});}
