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
