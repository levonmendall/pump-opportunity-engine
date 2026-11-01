import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {MarketRegistry,MarketRegistryContention,MarketRegistryReadOnlyViolation} from '../src/market-registry.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

test('registry lifecycle hooks follow the outer durable transaction and never replay committed failures',()=>{
 const r=new MarketRegistry(':memory:'),order:string[]=[];
 try{
  assert.throws(()=>r.transaction(()=>{r.setMetadata('attempt',1);r.onRollback(()=>order.push('outer-undo'));r.transaction(()=>{r.onRollback(()=>order.push('inner-undo'));r.afterCommit(()=>order.push('forbidden-commit'));});throw Error('OFFLINE rollback');}),/OFFLINE rollback/);
  assert.equal(r.getMetadata('attempt'),undefined);assert.deepEqual(order,['inner-undo','outer-undo']);
  order.length=0;r.transaction(()=>{r.setMetadata('committed',2);r.afterCommit(()=>{assert.equal(r.getMetadata('committed'),2);r.transaction(()=>r.setMetadata('callback-write',3));order.push('committed');});r.onRollback(()=>order.push('forbidden-undo'));});assert.deepEqual(order,['committed']);assert.equal(r.getMetadata('callback-write'),3);
  const failed=r.health().transactions.failed;
  assert.throws(()=>r.transaction(()=>{r.setMetadata('stays',4);r.onRollback(()=>order.push('bad-undo'));r.afterCommit(()=>{throw Error('OFFLINE after-commit failure');});}),/OFFLINE after-commit failure/);
  assert.equal(r.getMetadata('stays'),4);assert.equal(r.health().transactions.failed,failed);assert.equal(order.includes('bad-undo'),false);
  assert.throws(()=>r.readTransaction(()=>r.afterCommit(()=>{})),MarketRegistryReadOnlyViolation);assert.throws(()=>r.onRollback(()=>{}),MarketRegistryReadOnlyViolation);
 }finally{r.close();}
});

test('unchanged technical-status polling uses WAL reads while an intake writer holds its lease',()=>{
 let at=1000000;const dir=mkdtempSync(join(tmpdir(),'watch-ticket-read-')),path=join(dir,'registry.sqlite'),r=new MarketRegistry(path,{concurrentIntake:true,now:()=>at}),lock=new Database(path),events:string[]=[];
 const w=new PilotWatch({registry:r,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,record:k=>events.push(k)});
 try{
  w.discover({signature:'read-ticket',receivedAt:at});w.verify('read-ticket',{mint:'read-ticket-mint',pool:'read-ticket-pool',migrationAt:at-300000,verifiedAt:at});
  const before=r.health().transactions;lock.exec('BEGIN IMMEDIATE');for(let i=0;i<100;i++)assert.equal(w.technicalReevaluation('read-ticket-mint'),null);lock.exec('ROLLBACK');
  assert.equal(r.health().transactions.writerLeaseReadOnlyCommits,before.writerLeaseReadOnlyCommits);assert.equal(r.health().transactions.contentionBeforeCallback,before.contentionBeforeCallback);
  w.requestTechnicalReevaluation('read-ticket-mint',{reason:'entry-quote-unavailable',failedWindowEndAt:at});const ticket=w.technicalReevaluation('read-ticket-mint')!;
  lock.exec('BEGIN IMMEDIATE');assert.deepEqual(w.technicalReevaluation('read-ticket-mint'),ticket);at=ticket.expiresAt;assert.throws(()=>w.technicalReevaluation('read-ticket-mint'),MarketRegistryContention);assert.equal(r.lookup('read-ticket-mint')!.technicalReevaluation!.state,'WAITING');lock.exec('ROLLBACK');
  assert.equal(w.technicalReevaluation('read-ticket-mint')!.state,'EXPIRED');assert.equal(r.lookup('read-ticket-mint')!.technicalReevaluation!.state,'EXPIRED');assert.equal(events.filter(k=>k==='pilot-watch-technical-reevaluation-expired').length,1);
 }finally{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();r.close();rmSync(dir,{recursive:true,force:true});}
});
