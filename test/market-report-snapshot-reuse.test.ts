import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const AT=Date.parse('2026-11-02T18:00:00Z');
const watchFor=(registry:MarketRegistry)=>new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record:()=>{}});

test('shared reporting counts stay in one WAL snapshot and the next publication sees external commits',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-report-snapshot-')),path=join(directory,'market.sqlite');
 const reader=new MarketRegistry(path,{now:()=>AT}),writer=new MarketRegistry(path,{now:()=>AT});
 try{
  const watch=watchFor(reader),base=watch.discover({signature:'before',feedMint:'before',receivedAt:AT})!;
  reader.enqueueVerification({signature:'verification-before',receivedAt:AT},0);
  reader.readTransaction(()=>{
   const first=reader.watchReportingPopulation(),verification=reader.verificationStats(AT);
   writer.put({...base,signature:'after',state:'WATCH',verifiedAt:AT,mint:'after',pool:'after-pool',migrationAt:AT-1000});
   writer.enqueueVerification({signature:'verification-after',receivedAt:AT},0);
   const second=reader.watchReportingPopulation();assert.deepEqual(second,first);assert.deepEqual(reader.verificationStats(AT),verification);
   first.known=9000;verification.pending=9000;
   assert.equal(reader.watchReportingPopulation().known,1,'returned report values cannot mutate the shared snapshot');
   assert.equal(reader.verificationStats(AT).pending,1);
  });
  const next=reader.watchReportingPopulation();assert.equal(next.known,2);assert.equal(next.awaitingDeep,1);
  assert.equal(reader.verificationStats(AT).pending,2,'a later publication never reuses the old snapshot');
 }finally{writer.close();reader.close();rmSync(directory,{recursive:true,force:true});}
});

test('report summaries inside an aborted write cannot survive into the next read',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>AT});
 try{
  const watch=watchFor(registry),base=watch.discover({signature:'original',receivedAt:AT})!,before=registry.watchReportingPopulation();
  assert.throws(()=>registry.transaction(()=>{
   registry.put({...base,signature:'rolled-back'});
   assert.equal(registry.watchReportingPopulation().known,2);
   registry.enqueueVerification({signature:'rolled-back-verification',receivedAt:AT},0);
   registry.readTransaction(()=>assert.equal(registry.verificationStats(AT).pending,1));
   throw Error('OFFLINE_ROLLBACK');
  }),/OFFLINE_ROLLBACK/);
  assert.deepEqual(registry.watchReportingPopulation(),before);assert.equal(registry.verificationStats(AT).pending,0);
  registry.put({...base,signature:'committed'});assert.equal(registry.watchReportingPopulation().known,2);
 }finally{registry.close();}
});

test('verification reuse preserves time-dependent readiness and never permits writes inside a report',()=>{
 const registry=new MarketRegistry(':memory:',{now:()=>AT});
 try{
  registry.enqueueVerification({signature:'delayed',receivedAt:AT},0);registry.deferVerification('delayed',AT+1000);
  registry.readTransaction(()=>{
   assert.equal(registry.verificationStats(AT).ready,0);assert.equal(registry.verificationStats(AT+1000).ready,1);
   assert.equal(registry.verificationStats(AT).ready,0);
   assert.throws(()=>registry.deferVerification('delayed',AT),/forbidden|VIOLATION/i);
  });
  assert.equal(registry.verificationStats(AT).ready,0);
 }finally{registry.close();}
});

test('split prerequisite counts and shared totals retain one WAL snapshot across external age and identity changes',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-backlog-snapshot-')),path=join(directory,'market.sqlite');
 const reader=new MarketRegistry(path,{now:()=>AT}),writer=new MarketRegistry(path,{now:()=>AT});
 try{
  const watch=new PilotWatch({registry:reader,maximumDeep:4,enforceTokenAge24h:true,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record:()=>{}});
  const base=watch.discover({signature:'ready',feedMint:'ready',receivedAt:AT-1000})!;
  const ready={...base,mint:'ready',pool:'ready-pool',state:'WATCH' as const,migrationAt:AT-1000,verifiedAt:AT};reader.put(ready);
  (reader as any).db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)').run('ready',AT-1000,AT,'{}');
  let committed=false;const aggregate=reader.aggregate.bind(reader);
  reader.aggregate=(...args)=>{
   const result=aggregate(...args);
   if(!committed&&'waiting' in args[0]){
    committed=true;writer.transaction(()=>{
     writer.put({...ready,signature:'later',mint:'later',pool:'later-pool'});
     (writer as any).db.prepare('DELETE FROM token_creations WHERE mint=?').run('ready');
     (writer as any).db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)').run('later',AT-1000,AT,'{}');
    });
   }
   return result;
  };
  const before=reader.health().transactions.writeCommits,first=watch.serviceableBacklog(AT);
  assert.equal(committed,true);assert.equal(first.population.retained,1);assert.equal(first.population.verifiedAwaitingPrerequisites,0);assert.equal(first.population.eligibleNow,1);assert.equal(first.waits.eligibleQueue.count,1);
  const next=watch.serviceableBacklog(AT);
  assert.equal(next.population.retained,2);assert.equal(next.population.verifiedAwaitingPrerequisites,1);assert.equal(next.population.eligibleNow,1);
  assert.equal(reader.health().transactions.writeCommits,before,'reporting never acquires the registry writer');
 }finally{writer.close();reader.close();rmSync(directory,{recursive:true,force:true});}
});
