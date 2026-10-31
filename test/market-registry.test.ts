import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.js';
import type {WatchRow} from '../src/pilot-watch.js';
const AT=Date.parse('2026-10-30T22:00:00Z');
const row=(n:number):WatchRow=>({signature:`sig-${n}`,feedMint:`mint-${n}`,mint:`mint-${n}`,pool:`pool-${n}`,migrationAt:AT-300000,verifiedAt:AT,firstSeenAt:AT,state:'WATCH',reason:'verified origin only',lastActivityAt:null,lastActivityEvidence:null,lastDemotedAt:null,deepSince:null,deferUntil:0,waitingSince:AT,promotions:0,repromotions:0,demotions:0,completeWindows:0,everHadWindow:false,lastWindowAt:null,history:[{at:AT,state:'WATCH',reason:'verified origin only'}]});

test('persistent awareness, indexed rows and verification queues have no 174/256 identity ceiling',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-'));const path=join(dir,'market.sqlite');let r=new MarketRegistry(path,{now:()=>AT});
 try{
  r.transaction(()=>{for(let n=0;n<1200;n++){r.put(row(n));r.enqueueVerification({signature:`sig-${n}`,feedMint:`mint-${n}`,receivedAt:AT+n});}});
  assert.equal(r.count(),1200);assert.equal(r.verificationCount(),1200);assert.equal(r.coverageSnapshot(AT+3600000).lifetime.uniqueTokensDiscovered,1200);
  assert.equal(r.queryRows({where:'w.mint=?',params:['mint-1199']})[0]?.signature,'sig-1199');assert.equal(r.queryRows({limit:4}).length,4);
  r.putOrigin('mint-1199',{identity:{mint:'mint-1199'},proof:{confirmed:true}});r.deferVerification('sig-0',AT+100000);
  r.close();r=new MarketRegistry(path,{now:()=>AT+1000});assert.equal(r.count(),1200);assert.equal(r.verificationCount(),1200);assert.equal(r.nextVerification(AT+1000)?.signature,'sig-1');assert.equal(r.hasOrigin('mint-1199'),true);
  assert.deepEqual(r.getOrigin('mint-1199'),{identity:{mint:'mint-1199'},proof:{confirmed:true}});assert.equal(r.enqueueVerification({signature:'sig-1',receivedAt:AT}),false);
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});

test('archival and provisional alias merging retain unique market history and canonical proofs',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT});try{
  r.put(row(1));r.put({...row(2),mint:'mint-1'});r.mergeWatchAlias('sig-2','sig-1');assert.equal(r.count(),1);assert.equal(r.get('sig-2')?.signature,'sig-1');
  r.putOrigin('mint-1',{proof:'evidence'});r.archiveOrigin('mint-1','not currently scheduled',AT);assert.equal(r.hasOrigin('mint-1'),false);assert.deepEqual(r.getOrigin('mint-1'),{proof:'evidence'});
  r.delete('sig-1',AT,'inactive working-set row');assert.equal(r.count(),0);assert.equal(r.coverageSnapshot(AT).lifetime.uniqueTokensDiscovered,1);
 }finally{r.close();}
});

test('shared lightweight hints deduplicate volume, preserve unknowns and prioritize economically observed activity',()=>{
 let now=AT;const r=new MarketRegistry(':memory:',{now:()=>now});try{
  r.observeIdentity({mint:'unknown',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});
  r.observeIdentity({mint:'active',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});
  r.enqueueVerification({signature:'first-seed',feedMint:'unknown',receivedAt:AT});r.enqueueVerification({signature:'active-seed',feedMint:'active',receivedAt:AT+1});
  const hint={mint:'active',receivedAt:AT+2,source:'pumpapi-broad',kind:'activity',signature:'same-transaction',side:'buy' as const,quoteLamports:'2000000000',tokenAmount:'15.2'};
  now=AT+2;assert.equal(r.observeActivity(hint),true);assert.equal(r.observeActivity(hint),false);assert.equal(r.nextVerification(AT+3)?.signature,'active-seed');
  let snapshot=r.coverageSnapshot(AT+3);assert.equal(snapshot.lifetime.uniqueTokensDiscovered,2);assert.equal(snapshot.lifetime.lightweightScreened,2);assert.equal(snapshot.lifetime.lightweightWithActivity,1);assert.equal(snapshot.lifetime.lightweightUnavailable,1);assert.equal(snapshot.active.awaitingLightweight,0);assert.equal(snapshot.marketDenominator,null);
  r.observeActivity({mint:'unknown',receivedAt:AT+4,source:'pumpapi-broad',kind:'activity',signature:'foreign-quote',side:'buy',tokenAmount:'90000'});
  snapshot=r.coverageSnapshot(AT+4);assert.equal(snapshot.lifetime.lightweightWithActivity,1,'unknown quote amount cannot become economic participation');
  r.observeFeed({source:'pumpapi-broad',at:AT,connected:true,scope:'broad shared activity'});r.observeFeed({source:'pumpapi-broad',at:AT+5,connected:false,scope:'broad shared activity'});r.observeFeed({source:'pumpapi-broad',at:AT+6,connected:false,scope:'broad shared activity'});assert.equal(r.coverageSnapshot(AT+6).feeds[0]?.coverageGaps,1);
 }finally{r.close();}
});

test('failed market transaction rolls back queue and identity together without financial access',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT});try{
  assert.throws(()=>r.transaction(()=>{r.enqueueVerification({signature:'rollback',feedMint:'mint-new',receivedAt:AT});throw Error('stop');}),/stop/);
  assert.equal(r.verificationCount(),0);assert.equal(r.coverageSnapshot(AT).lifetime.uniqueTokensDiscovered,0);assert.equal(r.markDistinct('source-one:evaluated','mint-one',AT),true);assert.equal(r.markDistinct('source-one:evaluated','mint-one',AT),false);assert.equal(r.distinctCount('source-one:evaluated'),1);
 }finally{r.close();}
});

test('conditional origin enrichment uses real recent shared signatures without relabeling them migration evidence',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT});try{
  r.observeActivity({mint:'momentum',signature:'actual-trade-signature',receivedAt:AT,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'5000000000'});
  const selected=r.nextOriginCandidate(AT+1000)!;assert.equal(selected.signature,'actual-trade-signature');assert.ok(selected.priority>0);assert.equal(selected.source,'pumpapi-broad');
  r.enqueueVerification({signature:selected.signature,feedMint:selected.mint,receivedAt:selected.receivedAt},selected.priority,{source:'conditional-shared-activity-origin-lookup',kind:'activity'});assert.equal(r.nextOriginCandidate(AT+2000),undefined);
  r.removeVerification(selected.signature,AT+3000,'independent origin resolution unavailable');assert.equal(r.nextOriginCandidate(AT+4000),undefined,'do not repeatedly resolve the same signature');
  r.observeActivity({mint:'unknown-size',signature:'not-economic',receivedAt:AT,source:'pumpapi-broad',kind:'activity',side:'buy'});assert.equal(r.nextOriginCandidate(AT+61000),undefined,'stale activity is not fresh research demand');
 }finally{r.close();}
});

test('SQLite contention is visible and candidate admission can recover only after a real successful write',async()=>{
 const {default:Database}=await import('better-sqlite3');const dir=mkdtempSync(join(tmpdir(),'poe-market-lock-'));const path=join(dir,'market.sqlite');const r=new MarketRegistry(path,{now:()=>AT});const lock=new Database(path);
 try{
  lock.exec('BEGIN IMMEDIATE');assert.throws(()=>r.observeIdentity({mint:'not-persisted',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'}),/locked/);assert.equal(r.health().available,false);assert.equal(r.health().storageFailures,1);assert.equal(r.coverageSnapshot(AT).persistence.state,'unavailable');assert.ok(r.coverageSnapshot(AT).limitations.includes('REGISTRY_STORAGE_UNAVAILABLE'));r.transaction(()=>r.getMetadata('createdAt'));assert.equal(r.health().available,false,'successful read must not clear a failed durable-write gate');
  lock.exec('ROLLBACK');r.observeIdentity({mint:'persisted',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});assert.equal(r.health().available,true);assert.equal(r.health().storageFailures,1);assert.equal(r.coverageSnapshot(AT).lifetime.uniqueTokensDiscovered,1);
 }finally{lock.close();r.close();rmSync(dir,{recursive:true,force:true});}
});

test('hint-dedup maintenance expires only replay cache, preserves identities and ignores stale ranking input',()=>{
 let now=AT;const r=new MarketRegistry(':memory:',{now:()=>now});try{
  r.observeActivity({mint:'retained',signature:'historic-hint',receivedAt:AT,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000'});r.putOrigin('retained',{proof:'retained'});r.enqueueVerification({signature:'pending-obligation',feedMint:'pending-mint',receivedAt:AT});
  now=AT+3600001;assert.equal(r.maintenance(now),1);assert.equal(r.coverageSnapshot(now).lifetime.uniqueTokensDiscovered,2);assert.equal(r.getOrigin('retained')!==undefined,true);assert.equal(r.verificationCount(),1);
  assert.equal(r.observeActivity({mint:'retained',signature:'historic-hint',receivedAt:AT,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000'}),false,'expired evidence must not be replayed as fresh demand');assert.equal(r.nextOriginCandidate(now),undefined);assert.equal(r.coverageSnapshot(now).lightweight.staleActivityObservations,1);
  assert.ok(r.coverageSnapshot(now).limitations.includes('SHARED_HINT_DEDUP_RETENTION_1H'));
 }finally{r.close();}
});

test('operational metric observations are idempotent, durable and use exact indexed nearest-rank quantiles',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-metrics-'));const path=join(dir,'market.sqlite');let r=new MarketRegistry(path,{now:()=>AT});try{
  for(let n=1;n<=20;n++)assert.equal(r.recordMetric('source-one','eligible-wait',`promotion-${n}`,n*.25,AT+n),true);assert.equal(r.recordMetric('source-one','eligible-wait','promotion-1',9000,AT),false);
  assert.deepEqual(r.metricSummary('source-one','eligible-wait'),{count:20,sum:52.5,mean:2.625,max:5,p50:2.5,p95:4.75});assert.deepEqual(r.metricSummary('other-source','eligible-wait'),{count:0,sum:0,mean:null,max:null,p50:null,p95:null});
  r.close();r=new MarketRegistry(path,{now:()=>AT});assert.equal(r.metricSummary('source-one','eligible-wait').count,20);
  for(let n=1;n<=20;n++)r.put({...row(n),waitingSince:AT-n});assert.deepEqual(r.valueSummary({expression:'?-w.waiting_since',where:'w.state=?',params:[AT,'WATCH']}),{count:20,sum:210,mean:10.5,max:20,p50:10,p95:19});
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});

test('market evidence distinguishes exact known economic changes from unknown or replayed activity',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT});try{
  r.observeIdentity({mint:'evidence',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});const unknown=r.marketEvidence('evidence')!;assert.equal(unknown.lastEconomicActivityAt,null);
  r.observeActivity({mint:'evidence',receivedAt:AT,source:'pumpapi-broad',kind:'activity',signature:'unknown-amount',side:'buy'});assert.equal(r.marketEvidence('evidence')!.fingerprint,unknown.fingerprint);
  const economic={mint:'evidence',receivedAt:AT,source:'pumpapi-broad',kind:'activity',signature:'known-amount',side:'buy' as const,quoteLamports:'1234567890'};r.observeActivity(economic);const next=r.marketEvidence('evidence')!;assert.equal(next.buyLamports,'1234567890');assert.equal(next.lastEconomicActivityAt,AT);assert.notEqual(next.fingerprint,unknown.fingerprint);
  r.observeActivity(economic);assert.equal(r.marketEvidence('evidence')!.fingerprint,next.fingerprint);assert.equal(r.marketEvidence('evidence')!.buyLamports,'1234567890');
 }finally{r.close();}
});

test('re-observation readiness and last completed decision remain indexed and survive restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-market-gate-'));const path=join(dir,'market.sqlite');let r=new MarketRegistry(path,{now:()=>AT});try{
  const gated={...row(1),reobservation:{kind:'economic-rejection' as const,decisionAt:AT,windowEndAt:AT,evidence:'complete independently audited economic rejection',minimumEconomicChangeLamports:'1000',baseline:null,ready:null as {at:number;reason:string;evidence:string}|null}};
  r.put(gated);r.put(row(2));assert.equal(r.count('w.reobserve_ready=1'),1);assert.equal(r.count('w.last_decision_kind=? AND w.last_decision_at=?',['economic-rejection',AT]),1);
  r.close();r=new MarketRegistry(path,{now:()=>AT});assert.equal(r.count('w.reobserve_ready=0'),1);gated.reobservation.ready={at:AT+1,reason:'new independently supported evidence',evidence:'verified pool state changed'};r.put(gated);assert.equal(r.count('w.reobserve_ready=1'),2);
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});

test('read-only watch transactions never mutate commit metadata or require a FULL WAL write lock',async()=>{
 const {default:Database}=await import('better-sqlite3');const dir=mkdtempSync(join(tmpdir(),'poe-market-read-'));const path=join(dir,'market.sqlite');let now=AT;const r=new MarketRegistry(path,{now:()=>now});const other=new Database(path);try{
  r.put(row(1));const committed=r.getMetadata<number>('updatedAt');const health=r.health();const checkpointBefore=other.pragma('wal_checkpoint(PASSIVE)');const walBefore=readFileSync(path+'-wal');const walBytesBefore=statSync(path+'-wal').size;now+=1000;other.exec('BEGIN IMMEDIATE');
  assert.equal(r.transaction(()=>r.lookup('mint-1'))?.mint,'mint-1');assert.equal(r.transaction(()=>r.queryRows({limit:4})).length,1);assert.equal(r.transaction(()=>undefined),undefined);
  assert.equal(r.getMetadata('updatedAt'),committed);assert.equal(r.health().lastSuccessfulWriteAt,health.lastSuccessfulWriteAt);assert.equal(r.health().storageFailures,0);assert.equal(r.health().transactions.writeCommits,health.transactions.writeCommits);assert.equal(r.health().transactions.readOnlyCommits,health.transactions.readOnlyCommits+3);assert.equal(statSync(path+'-wal').size,walBytesBefore);assert.deepEqual(readFileSync(path+'-wal'),walBefore);other.exec('ROLLBACK');assert.deepEqual(other.pragma('wal_checkpoint(PASSIVE)'),checkpointBefore);
  r.observeIdentity({mint:'really-new',at:now,source:'pumpportal-new-token',kind:'creation'});assert.equal(r.getMetadata('updatedAt'),now);
 }finally{if(other.inTransaction)other.exec('ROLLBACK');other.close();r.close();rmSync(dir,{recursive:true,force:true});}
});

test('canonical re-verification reactivates completed work and preserves queue completion and original raw proof history',async()=>{
 const {default:Database}=await import('better-sqlite3');const dir=mkdtempSync(join(tmpdir(),'poe-market-reverify-'));const path=join(dir,'market.sqlite');const r=new MarketRegistry(path,{now:()=>AT});try{
  r.enqueueVerification({signature:'canonical',feedMint:'mint-canonical',receivedAt:AT-1000},7);r.removeVerification('canonical',AT-500,'previous independent origin verified');r.putOrigin('mint-canonical',{rawProof:'original-corrupt-source-bytes'});
  r.transaction(()=>{r.archiveOrigin('mint-canonical','proof mismatch',AT);r.requeueVerification({signature:'canonical',feedMint:'mint-canonical',receivedAt:AT},AT+100,'proof mismatch');});assert.equal(r.hasOrigin('mint-canonical'),false);assert.equal(r.verificationCount(),1);assert.equal(r.nextVerification(AT+99),undefined);assert.equal(r.nextVerification(AT+100)?.receivedAt,AT-1000);
  r.putOrigin('mint-canonical',{rawProof:'new independently verified bytes'});const inspect=new Database(path,{readonly:true});try{
   const archived=inspect.prepare('SELECT body FROM origin_proof_history WHERE mint=?').get('mint-canonical') as {body:string};assert.deepEqual(JSON.parse(archived.body),{rawProof:'original-corrupt-source-bytes'});
   const prior=inspect.prepare('SELECT body FROM verification_history WHERE signature=?').get('canonical') as {body:string};assert.equal(JSON.parse(prior.body).state,'DONE');assert.equal(JSON.parse(prior.body).last_reason,'previous independent origin verified');assert.equal((inspect.prepare('SELECT priority FROM verification_queue WHERE signature=?').get('canonical') as {priority:number}).priority,7);
  }finally{inspect.close();}
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});

test('explicit read snapshots stay consistent while an independent WAL writer commits and acquire no writer lease',async()=>{
 const {default:Database}=await import('better-sqlite3');const dir=mkdtempSync(join(tmpdir(),'poe-market-snapshot-'));const path=join(dir,'market.sqlite');let now=AT;const r=new MarketRegistry(path,{now:()=>now,concurrentIntake:true});const other=new Database(path);try{
  r.setMetadata('snapshot-value','before');const baseline=r.health();const committed=r.getMetadata('updatedAt');now+=1000;
  r.readTransaction(()=>{assert.equal(r.getMetadata('snapshot-value'),'before');other.prepare('UPDATE registry_metadata SET body=? WHERE key=?').run(JSON.stringify('after'),'snapshot-value');assert.equal(r.getMetadata('snapshot-value'),'before','one read scope keeps a consistent WAL snapshot');});
  assert.equal(r.getMetadata('snapshot-value'),'after');other.exec('BEGIN IMMEDIATE');assert.equal(r.readTransaction(()=>r.getMetadata('snapshot-value')),'after','ordinary writer ownership does not block WAL read snapshots');other.exec('ROLLBACK');assert.equal(r.getMetadata('updatedAt'),committed);
  assert.equal(r.health().transactions.writeCommits,baseline.transactions.writeCommits);assert.equal(r.health().transactions.writerLeaseReadOnlyCommits,baseline.transactions.writerLeaseReadOnlyCommits);assert.equal(r.health().transactions.readSnapshotCommits,baseline.transactions.readSnapshotCommits+2);assert.equal(r.health().storageFailures,0);
 }finally{if(other.inTransaction)other.exec('ROLLBACK');other.close();r.close();rmSync(dir,{recursive:true,force:true});}
});

test('read snapshots reject every mutation path, restore write permission and never replay callbacks',async()=>{
 const {MarketRegistryReadOnlyViolation}=await import('../src/market-registry.js');const r=new MarketRegistry(':memory:',{now:()=>AT,concurrentIntake:true});try{
  let calls=0;assert.throws(()=>r.readTransaction(()=>{calls++;r.setMetadata('forbidden',true);}),MarketRegistryReadOnlyViolation);assert.equal(calls,1);assert.equal(r.getMetadata('forbidden'),undefined);assert.equal(r.health().available,true);
  assert.throws(()=>r.readTransaction(()=>r.transaction(()=>r.putOrigin('forbidden',{proof:true}))),MarketRegistryReadOnlyViolation);assert.equal(r.getOrigin('forbidden'),undefined);assert.throws(()=>r.readTransaction(()=>r.close()),MarketRegistryReadOnlyViolation);
  assert.throws(()=>r.readTransaction(()=>{(r as any).db.prepare('INSERT INTO registry_metadata(key,body) VALUES(?,?)').run('sqlite-guard','true');}),MarketRegistryReadOnlyViolation);assert.equal(r.getMetadata('sqlite-guard'),undefined,'SQLite query_only guards bypasses too');
  r.transaction(()=>{r.setMetadata('outer-write','before');assert.throws(()=>r.readTransaction(()=>r.setMetadata('nested-forbidden',true)),MarketRegistryReadOnlyViolation);assert.throws(()=>r.readTransaction(()=>{(r as any).db.prepare('INSERT INTO registry_metadata(key,body) VALUES(?,?)').run('nested-sqlite-guard','true');}),MarketRegistryReadOnlyViolation);r.setMetadata('outer-write','after');});assert.equal(r.getMetadata('outer-write'),'after');assert.equal(r.getMetadata('nested-forbidden'),undefined);
  r.setMetadata('normal-write',true);assert.equal(r.getMetadata('normal-write'),true);assert.equal(r.health().available,true);
  let asyncCalled=false;assert.throws(()=>r.readTransaction(async()=>{asyncCalled=true;}),MarketRegistryReadOnlyViolation);assert.equal(asyncCalled,false);
 }finally{r.close();}
});


test('new identity cohort counts are indexed unique first observations, not repeated market messages',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>AT+1000,concurrentIntake:true});try{
  r.observeIdentity({mint:'before-cohort',receivedAt:AT-1,source:'pumpportal-new-token',kind:'creation'});r.observeIdentity({mint:'inside-cohort',receivedAt:AT+5,source:'pumpportal-new-token',kind:'creation'});r.observeActivity({mint:'inside-cohort',signature:'same-mint-activity',receivedAt:AT+6,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'1000000000'});r.observeIdentity({mint:'after-cohort',receivedAt:AT+101,source:'pumpportal-new-token',kind:'creation'});
  const before=r.health().transactions.writeCommits;assert.deepEqual(r.cohortCounts(AT,AT+100),{discoveredDistinct:1,lightweightArrivals:1,lightweightCompleted:1});assert.equal(r.health().transactions.writeCommits,before);assert.deepEqual(r.cohortCounts(AT+7,AT+100),{discoveredDistinct:0,lightweightArrivals:0,lightweightCompleted:0});
 }finally{r.close();}
});

test('post-decision flow excludes late old hints in a mixed batch and keeps exact bigint quote totals',()=>{
 let now=AT+1000;const r=new MarketRegistry(':memory:',{now:()=>now});try{
  const hint=(signature:string,at:number,quoteLamports?:string,side:'buy'|'sell'='buy',quoteMint?:string)=>({mint:'decision-token',signature,receivedAt:at,source:'pumpapi-broad',kind:'activity',side,...(quoteLamports?{quoteLamports}:{}),...(quoteMint?{quoteMint}:{} )});
  r.observeIdentity({mint:'decision-token',receivedAt:AT-100,source:'pumpportal-new-token',kind:'creation'});const baseline=r.economicFlowAfter('decision-token',AT);assert.equal(baseline.knownEvents,0);
  r.observeActivityBatch([hint('late-old',AT-1,'9000000000000000000'),hint('at-decision',AT,'7000000000000000000'),hint('new-small',AT+1,'5'),hint('unknown-new',AT+2),hint('foreign-new',AT+3,'1000000000','buy','foreign-quote')]);
  let result=r.economicFlowAfter('decision-token',AT);assert.equal(result.buyLamports,'5','large old hints cannot inflate true post-decision demand');assert.equal(result.sellLamports,'0');assert.equal(result.knownEvents,1);assert.equal(result.unknownEvents,2);assert.equal(result.latestAt,AT+1,'later unknown/foreign hints cannot imply later known economic progress');assert.equal(result.complete,false);
  const cached=r.health().economicFlow;r.observeActivity({mint:'unrelated',signature:'other',receivedAt:AT+4,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'100'});r.economicFlowAfter('decision-token',AT);assert.equal(r.health().economicFlow.coldQueries,cached.coldQueries);assert.equal(r.health().economicFlow.incrementalQueries,cached.incrementalQueries);assert.equal(r.health().economicFlow.hits,cached.hits+1);
  r.observeActivityBatch([hint('new-huge-one',AT+4,'9000000000000000000'),hint('new-huge-two',AT+5,'9000000000000000000'),hint('new-sell',AT+6,'17','sell'),hint('late-old-later',AT-2,'9000000000000000000')]);result=r.economicFlowAfter('decision-token',AT);assert.equal(result.buyLamports,'18000000000000000005');assert.equal(result.sellLamports,'17');assert.equal(result.latestAt,AT+6);assert.equal(r.health().economicFlow.incrementalQueries,cached.incrementalQueries+1);
  now=AT+3600001;assert.equal(r.economicFlowAfter('decision-token',AT).complete,false);
 }finally{r.close();}
});

test('post-decision aggregates treat legacy NULL quote records as unknown and never cache rolled-back hint totals',async()=>{
 const {default:Database}=await import('better-sqlite3');const dir=mkdtempSync(join(tmpdir(),'poe-market-flow-'));const path=join(dir,'market.sqlite');const r=new MarketRegistry(path,{now:()=>AT+1000});const other=new Database(path);try{
  r.observeIdentity({mint:'token',receivedAt:AT,source:'pumpportal-new-token',kind:'creation'});other.prepare('INSERT INTO market_activity_seen(mint,signature,side,first_seen_at) VALUES(?,?,?,?)').run('token','legacy','buy',AT+1);let result=r.economicFlowAfter('token',AT);assert.equal(result.knownEvents,0);assert.equal(result.unknownEvents,1);assert.equal(result.buyLamports,'0');assert.equal(result.complete,false);
  assert.throws(()=>r.transaction(()=>{r.observeActivity({mint:'token',signature:'rolled-back',receivedAt:AT+2,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'999'});assert.equal(r.economicFlowAfter('token',AT).buyLamports,'999');throw Error('rollback');}),/rollback/);
  const worker=new MarketRegistry(path,{now:()=>AT+1000});try{worker.observeActivity({mint:'token',signature:'real-next',receivedAt:AT+3,source:'pumpapi-broad',kind:'activity',side:'buy',quoteLamports:'7'});}finally{worker.close();}result=r.economicFlowAfter('token',AT);assert.equal(result.buyLamports,'7');assert.equal(result.unknownEvents,1);
 }finally{other.close();r.close();rmSync(dir,{recursive:true,force:true});}
});
