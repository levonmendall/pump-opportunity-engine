/** Offline retained-scale selector benchmark; no provider, socket or financial ledger. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MarketRegistry} from '../src/market-registry.ts';
import {PilotWatch} from '../src/pilot-watch.ts';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.ts';
import {legacyOpportunitySelection} from '../test/fixtures/opportunity-selection-before-r6.ts';

const AT=Date.parse('2026-11-02T05:55:00Z'),WATCH_ROWS=66344,PREPARATION_ELIGIBLE=59211,MARKET_IDENTITIES=161479,ACTIVE_MINTS=5000;
const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-opportunity-selection-')),path=join(directory,'registry.sqlite');
const registry=new MarketRegistry(path,{now:()=>AT,concurrentIntake:true});let priority;
const watch=new PilotWatch({registry,maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record:(kind,data)=>{if(kind==='pilot-watch-opportunity-priority')priority=data;}});
try{
 const base=watch.discover({signature:'OFFLINE-unidentified-base',receivedAt:AT-86400000}),buildStart=performance.now();
 registry.transaction(()=>{
  for(let i=0;i<WATCH_ROWS;i++){
   const eligible=i<PREPARATION_ELIGIBLE;
   registry.put({...base,signature:'OFFLINE-watch-'+String(i).padStart(6,'0'),mint:'OFFLINE-mint-'+i,pool:eligible?'OFFLINE-pool-'+i:null,state:eligible?'WATCH':'DISCOVERED',migrationAt:null,verifiedAt:null,observationIdentity:eligible?{basis:'canonical-pool-hint',availableAt:AT-500000,evidence:'OFFLINE retained scope identity'}:undefined,firstSeenAt:AT-86400000,waitingSince:AT-600000+i,history:Array.from({length:16},(_,j)=>({at:AT-100000+j,state:eligible?'WATCH':'DISCOVERED',reason:'OFFLINE retained history '+i+':'+j+' '+'.'.repeat(96)}))});
  }
  for(let i=WATCH_ROWS;i<MARKET_IDENTITIES;i++)registry.observeIdentity({mint:'OFFLINE-mint-'+i,at:AT-1000,source:'pumpportal-new-token',kind:'creation'});
  for(let i=0;i<ACTIVE_MINTS;i++)for(let j=0;j<4;j++)registry.observeActivity({mint:'OFFLINE-mint-'+i,pool:'OFFLINE-pool-'+i,signature:'OFFLINE-event-'+i+'-'+j,source:'OFFLINE-broad',at:AT-[90000,80000,50000,1000][j],side:j%2?'sell':'buy',quoteLamports:String(((i*17+j*11)%997+1)*1000000),quoteMint:'So11111111111111111111111111111111111111112',tokenAmount:String((i+j*3)%13+1)});
 });
 const buildMs=performance.now()-buildStart,source=registry.nextOpportunity.bind(registry),statement=registry.statement.bind(registry),runs=[],plans={};let mode='deployed-algorithm',query;
 registry.statement=sql=>{const s=statement(sql);if(!sql.startsWith('WITH eligible AS'))return s;return new Proxy(s,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return(...params)=>{query={sql,params};return value.apply(target,params);};}});};
 const hashes=()=>Object.fromEntries(['watch_rows','watch_history'].map(table=>[table,registry.db.prepare('SELECT COUNT(*) n,SUM(length(body)) bytes FROM '+table).get()]));
 const before=hashes(),writesBefore=registry.health().transactions.writeCommits;let expected,indexUpgradeMs;
 for(const variant of ['deployed-algorithm','weighted-rank-selection']){
  mode=variant;
  if(variant==='deployed-algorithm'){registry.db.exec('DROP INDEX watch_rows_opportunity_v1');registry.nextOpportunity=(...args)=>legacyOpportunitySelection.call(registry,...args);}
  else{const start=performance.now(),upgrade=new MarketRegistry(path,{now:()=>AT,concurrentIntake:true});upgrade.close();indexUpgradeMs=performance.now()-start;registry.nextOpportunity=source;}
  const samplesMs=[],cpuSamplesMs=[];
  for(let trial=0;trial<3;trial++){
   const start=performance.now(),used=process.cpuUsage(),row=watch.next(AT,new Set(),{preparation:true}),cpu=process.cpuUsage(used);samplesMs.push(performance.now()-start);cpuSamplesMs.push((cpu.user+cpu.system)/1000);
   const selected={row,priority};if(expected)assert.deepEqual(selected,expected,'full winner body and every ranking/route hint remain exact');else expected=selected;
   if(!plans[mode])plans[mode]={sqlSha256:createHash('sha256').update(query.sql).digest('hex'),steps:registry.db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params).map(r=>r.detail)};
  }
  runs.push({variant,samplesMs,cpuSamplesMs,meanMs:samplesMs.reduce((a,b)=>a+b,0)/samplesMs.length,maximumMs:Math.max(...samplesMs)});
 }
 assert.deepEqual(hashes(),before);assert.equal(registry.health().transactions.writeCommits,writesBefore);
 assert.equal(registry.count(),WATCH_ROWS+1);assert.equal(registry.coverageSnapshot(AT).lifetime.uniqueTokensDiscovered,MARKET_IDENTITIES);
 assert.ok(plans['weighted-rank-selection'].steps.includes('MATERIALIZE eligible'));assert.equal(plans['weighted-rank-selection'].steps.filter(s=>s.includes('SEARCH w USING INDEX watch_rows_opportunity_v1')).length,1);
 const preparedMints=Array.from({length:4},(_,i)=>'OFFLINE-mint-'+(59000+i)),preparedScopeRuns=[];
 // Scalar age rows exercise this SQL read path only. No proof validator,
 // provider, candidate allocation or financial admission is invoked.
 registry.transaction(()=>{const insert=registry.db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)');for(const mint of preparedMints)insert.run(mint,AT-3600000,AT-1000,JSON.stringify({offline:'scalar selector fixture only'}));});
 const preparedWritesBefore=registry.health().transactions.writeCommits;
 for(const shape of [{name:'one-prepared',mints:preparedMints.slice(0,1),excluded:[]},{name:'four-prepared',mints:preparedMints,excluded:[]},{name:'four-prepared-one-excluded',mints:preparedMints,excluded:preparedMints.slice(0,1)}]){
  registry.nextOpportunity=(...args)=>legacyOpportunitySelection.call(registry,...args);const oldRow=watch.next(AT,new Set(shape.excluded),{preparedMints:shape.mints}),oldPriority=priority;registry.nextOpportunity=source;
  const samplesMs=[];for(let trial=0;trial<3;trial++){const start=performance.now(),row=watch.next(AT,new Set(shape.excluded),{preparedMints:shape.mints});samplesMs.push(performance.now()-start);assert.deepEqual({row,priority},{row:oldRow,priority:oldPriority});}
  const steps=registry.db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.params).map(r=>r.detail);assert.ok(steps.some(s=>s.includes('SEARCH w USING INDEX watch_rows_mint (mint=? AND archived=?)')));assert.ok(steps.every(s=>!s.includes('watch_rows_opportunity_v1')));
  preparedScopeRuns.push({shape:shape.name,samplesMs,exactDeployedResultParity:true,usesExistingMintIndex:true});
 }
 assert.equal(registry.health().transactions.writeCommits,preparedWritesBefore);assert.deepEqual(hashes(),before);
 const fields=['src/market-registry.ts','src/pilot-watch.ts','test/fixtures/opportunity-selection-before-r6.ts'];
 process.stdout.write(JSON.stringify({kind:'OFFLINE_FULL_POPULATION_OPPORTUNITY_SELECTION_BENCHMARK_V1',node:process.version,sourceHashes:Object.fromEntries(fields.map(file=>[file,createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),fixture:{synthetic:true,watchRows:WATCH_ROWS+1,preparationEligibleRows:PREPARATION_ELIGIBLE,marketIdentities:MARKET_IDENTITIES,activeMints:ACTIVE_MINTS,activityRows:ACTIVE_MINTS*4,retainedHistoryPerWatchRow:16,configuredSlots:4,enforceTokenAge24h:true,concurrentIntake:true,workerRunning:false,buildMs,indexUpgradeMs,dbBytes:statSync(path).size},runs,preparedScopeRuns,ratio:runs[0].meanMs/runs[1].meanMs,plans,fullSelectedRowAndHintParity:true,retainedCountsAndBodyBytesUnchanged:true,selectionWrites:0,networkRequests:0,financialWriterOpened:false,limitations:['Disposable synthetic economic distribution; retained scales follow the recorded post-owner report, not a production database copy.','The deployed algorithm uses the frozen original query with the new selection index absent. The repaired algorithm includes its index.','Measurements are this workspace workload and do not promise EC2 latency, provider recovery, token-age proof availability or financial readiness.','Selection still evaluates the full current eligibility population synchronously; it is not constant-time and remains subject to actual deadline admission.','Index construction and fixture creation are outside the measured selection calls and reported separately.','Four synthetic scalar token-age rows are added after global timing solely for prepared-set SQL timing; no cryptographic token proof or financial authorization is claimed.']},null,2)+'\n');
}finally{registry.close();rmSync(directory,{recursive:true,force:true});}
