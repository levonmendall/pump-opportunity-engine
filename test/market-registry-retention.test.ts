import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type Database from 'better-sqlite3';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {CANDIDATE_RETENTION_POLICY,MarketRegistry} from '../src/market-registry.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import {MIGRATION_AGE_POLICY,type MigrationAgeProof} from '../src/migration-age-policy.js';
import {canonicalObservationPool} from '../src/native-observation-identity.js';
import type {WatchRow} from '../src/pilot-watch.js';

const DAY=86_400_000,NOW=Date.parse('2026-11-05T00:00:00Z'),OLD=NOW-3*DAY;
const mint=(n:number)=>new PublicKey(Buffer.alloc(32,n)).toBase58();
const signature=(n:number)=>bs58.encode(Buffer.alloc(64,n));
const db=(r:MarketRegistry)=>(r as unknown as {db:Database.Database}).db;
const digest=(body:string)=>createHash('sha256').update(body).digest('hex');
const proof=(n:number,createdAt=OLD):TokenCreationProof=>({version:TOKEN_AGE_POLICY.version,mint:mint(n),signature:signature(n),slot:n+1,createdAt,availableAt:Math.max(createdAt,NOW-2*DAY),commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)});
const row=(n:number,at=NOW-2*DAY):WatchRow=>({signature:signature(n),feedMint:mint(n),mint:mint(n),pool:mint(n+1),migrationAt:at-300000,verifiedAt:at,firstSeenAt:at,state:'EXPIRED',reason:'entry age expired',lastActivityAt:null,lastActivityEvidence:'unused diagnostics '.repeat(500),lastDemotedAt:null,deepSince:null,deferUntil:0,waitingSince:at,promotions:0,repromotions:0,demotions:0,completeWindows:0,everHadWindow:false,lastWindowAt:null,history:[{at,state:'EXPIRED',reason:'entry age expired'}]});
const input=(protectedMints:ReadonlySet<string>=new Set(),batch=128)=>({at:NOW,tradeHistoryComplete:true as const,protectedMints,batch});
function seed(r:MarketRegistry,n:number,count=3,change:Partial<WatchRow>={}){r.putTokenCreationProof(proof(n));for(let i=0;i<count;i++)r.put({...row(n),...change,reason:'history-'+i,history:[{at:NOW-2*DAY+i,state:change.state??'EXPIRED',reason:'history-'+i}]});}
const historyCount=(r:MarketRegistry,n:number)=>Number((db(r).prepare('SELECT COUNT(*) n FROM watch_history WHERE signature=?').get(signature(n)) as {n:number}).n);

test('expired nontrade history is replaced atomically by exact digest tombstones and compact identity rows',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1);r.enqueueVerification({signature:signature(1),feedMint:mint(1),receivedAt:OLD});r.removeVerification(signature(1),NOW-2*DAY);r.putOrigin(mint(1),{proof:'original'});r.put(row(99));
  const before=db(r).prepare('SELECT * FROM watch_history WHERE signature=? ORDER BY id').all(signature(1)) as {id:number;signature:string;at:number;state:string;reason:string;body:string}[];
  const countBefore=r.coverageSnapshot(NOW).lifetime.uniqueTokensDiscovered;
  const result=r.retireExpiredCandidates(input());
  assert.equal(result.retiredHistoryRows,3);assert.equal(result.compactedWatchRows,1);assert.ok(result.retiredBodyBytes>20_000);
  assert.equal(historyCount(r,1),0);assert.equal(r.get(signature(1)),undefined);
  const retained=db(r).prepare('SELECT signature,archived,body FROM watch_rows WHERE signature=?').get(signature(1)) as {signature:string;archived:number;body:string};
  assert.equal(retained.signature,signature(1));assert.equal(retained.archived,1);assert.ok(Buffer.byteLength(retained.body)<2000);assert.equal(JSON.parse(retained.body).lastActivityEvidence,null);
  for(const old of before){const actual=db(r).prepare('SELECT * FROM watch_history_retirements WHERE id=?').get(old.id) as Record<string,unknown>;assert.deepEqual(actual,{id:old.id,signature:old.signature,at:old.at,state:old.state,reason:old.reason,body_sha256:digest(old.body),retired_at:NOW,mint:mint(1),created_at:OLD,policy:CANDIDATE_RETENTION_POLICY.version,financial_history_complete:1,obligations_absent:1,age_basis:'token-creation'});}
  assert.equal(r.coverageSnapshot(NOW).lifetime.uniqueTokensDiscovered,countBefore);assert.deepEqual(r.tokenCreationProof(mint(1)),proof(1));assert.equal(r.tokenAgeEligibility(mint(1),NOW).allowed,false);assert.deepEqual(r.getOrigin(mint(1)),{proof:'original'});
  assert.ok(db(r).prepare('SELECT 1 FROM verification_queue WHERE signature=?').get(signature(1)));
  assert.equal(r.retentionStatus().retiredHistoryRows,3);
 }finally{r.close();}
});

test('complete financial history, held/pending/deep work, active preparation and review protections prevent deletion',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1);seed(r,2,2,{state:'HELD'});seed(r,3,2,{state:'ENTRY_PENDING'});seed(r,4,2,{state:'DEEP_OBSERVATION'});seed(r,5,2,{state:'QUALIFIED'});seed(r,6,2,{state:'VERIFYING'});seed(r,7);seed(r,8);seed(r,9);seed(r,10);seed(r,11);seed(r,12);
  db(r).prepare("UPDATE watch_rows SET technical_state='CLAIMED' WHERE mint=?").run(mint(7));
  r.enqueueVerification({signature:signature(8),feedMint:mint(8),receivedAt:OLD});r.enqueueVerification({signature:signature(9),receivedAt:OLD});
  db(r).prepare("INSERT INTO observation_preparations(mint,pool,checked_at,state,reason) VALUES(?,?,?,'awaiting-dispatch','work active')").run(mint(10),mint(11),NOW);
  const before=db(r).prepare('SELECT * FROM watch_history ORDER BY id').all();
  const result=r.retireExpiredCandidates(input(new Set([mint(1),mint(11),mint(12)])));
  assert.equal(result.retiredHistoryRows,0);assert.equal(result.compactedWatchRows,0);assert.equal(result.protectedMints,12);assert.deepEqual(db(r).prepare('SELECT * FROM watch_history ORDER BY id').all(),before);
  assert.throws(()=>r.retireExpiredCandidates({...input(),tradeHistoryComplete:false} as never),/FINANCIAL_HISTORY_REQUIRED/);
  assert.equal((db(r).prepare('SELECT COUNT(*) n FROM watch_history_retirements').get() as {n:number}).n,0);
 }finally{r.close();}
});

test('unknown age, active eligibility, exact 48h boundary and recent history remain available',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  r.put(row(1));r.putTokenCreationProof(proof(2,NOW-3600000));r.put(row(2));r.putTokenCreationProof(proof(3,NOW-2*DAY));r.put(row(3));r.putTokenCreationProof(proof(4));r.put(row(4,NOW-3600000));r.put(row(99));
  const before=db(r).prepare('SELECT * FROM watch_history ORDER BY id').all();
  const result=r.retireExpiredCandidates(input());assert.equal(result.retiredHistoryRows,0);assert.equal(result.compactedWatchRows,0);assert.deepEqual(db(r).prepare('SELECT * FROM watch_history ORDER BY id').all(),before);
  assert.equal(r.tokenAgeEligibility(mint(1),NOW).reason,'TOKEN_AGE_UNVERIFIED');assert.equal(r.tokenAgeEligibility(mint(2),NOW).allowed,true);
 }finally{r.close();}
});

test('signature-specific protection preserves its full history and body',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1);r.put(row(99));const result=r.retireExpiredCandidates({...input(),protectedSignatures:new Set([signature(1)])});assert.equal(result.retiredHistoryRows,0);assert.equal(historyCount(r,1),3);assert.equal(r.get(signature(1))?.lastActivityEvidence,row(1).lastActivityEvidence);
 }finally{r.close();}
});

test('row budget limits each sweep and restart resumes without losing exact deletion evidence',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-candidate-retention-')),path=join(dir,'registry.sqlite');let r=new MarketRegistry(path,{now:()=>NOW});try{
  seed(r,1,25);seed(r,2,9);r.put(row(99));
  let total=0;for(let pass=0;pass<20;pass++){
   const result=r.retireExpiredCandidates(input(new Set(),4));assert.ok(result.retiredHistoryRows+result.compactedWatchRows<=4);total+=result.retiredHistoryRows;
   if(pass===2){r.close();r=new MarketRegistry(path,{now:()=>NOW});}
  }
  assert.equal(total,34);assert.equal(historyCount(r,1),0);assert.equal(historyCount(r,2),0);assert.equal(r.retentionStatus().retiredHistoryRows,34);assert.equal((db(r).prepare('SELECT COUNT(*) n FROM watch_history_retirements').get() as {n:number}).n,34);
  assert.equal(r.tokenAgeEligibility(mint(1),NOW).allowed,false);assert.equal(r.tokenAgeEligibility(mint(2),NOW).allowed,false);
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});

test('protected early mints cannot starve retirement beyond the bounded candidate scan',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  const protectedMints=new Set<string>();for(let n=1;n<=40;n++){seed(r,n,1);if(n!==35)protectedMints.add(mint(n));}r.put(row(99));
  for(let pass=0;pass<8;pass++){const result=r.retireExpiredCandidates(input(protectedMints));assert.ok(result.scannedMints<=CANDIDATE_RETENTION_POLICY.maximumScannedMints);}
  assert.equal(historyCount(r,35),0);for(let n=1;n<=40;n++)if(n!==35)assert.equal(historyCount(r,n),1);
 }finally{r.close();}
});

test('the retained maximum history row prevents ID reuse by the legacy insert statement',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1,3);r.retireExpiredCandidates(input());assert.equal(historyCount(r,1),1);
  const before=(db(r).prepare('SELECT MAX(id) id FROM watch_history').get() as {id:number}).id;
  // This is the exact old INSERT path, with no knowledge of retention tables.
  db(r).prepare('INSERT INTO watch_history(signature,at,state,reason,body) VALUES(?,?,?,?,?)').run(signature(2),NOW,'WATCH','new','{}');
  assert.equal((db(r).prepare('SELECT MAX(id) id FROM watch_history').get() as {id:number}).id,before+1);
  r.retireExpiredCandidates(input());assert.equal(historyCount(r,1),0);assert.equal((db(r).prepare('SELECT COUNT(*) n FROM watch_history_retirements').get() as {n:number}).n,3);
 }finally{r.close();}
});

test('a tombstone conflict rolls back every deletion and its metrics',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1,3);r.put(row(99));const history=db(r).prepare('SELECT * FROM watch_history ORDER BY id').all() as {id:number;signature:string;at:number;state:string;reason:string;body:string}[];
  const second=history[1]!;db(r).prepare('INSERT INTO watch_history_retirements(id,signature,at,state,reason,body_sha256,retired_at,mint,created_at,policy,financial_history_complete,obligations_absent) VALUES(?,?,?,?,?,?,?,?,?,?,1,1)').run(second.id,second.signature,second.at,second.state,second.reason,'0'.repeat(64),NOW,mint(1),OLD,CANDIDATE_RETENTION_POLICY.version);
  assert.throws(()=>r.retireExpiredCandidates(input()),/UNIQUE/);assert.deepEqual(db(r).prepare('SELECT * FROM watch_history ORDER BY id').all(),history);assert.equal(r.retentionStatus().retiredHistoryRows,0);assert.equal(r.getMetadata('candidateRetention'),undefined);
 }finally{r.close();}
});

test('oversized bodies are skipped within a bounded pass instead of holding the registry writer for a large copy',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1,1);r.put(row(99));db(r).prepare('UPDATE watch_history SET body=? WHERE signature=?').run('x'.repeat(CANDIDATE_RETENTION_POLICY.maximumBatchBytes+1),signature(1));
  const result=r.retireExpiredCandidates(input());assert.equal(result.retiredHistoryRows,0);assert.equal(result.oversizedRowsDeferred,1);assert.equal(historyCount(r,1),1);assert.equal((db(r).prepare('SELECT COUNT(*) n FROM watch_history_retirements').get() as {n:number}).n,0);
 }finally{r.close();}
});

test('future timestamps, excessive batches and read snapshots cannot authorize a sweep',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW});try{
  seed(r,1);assert.throws(()=>r.retireExpiredCandidates({...input(),at:NOW+1}),/RETENTION_INPUT/);assert.throws(()=>r.retireExpiredCandidates(input(new Set(),129)),/RETENTION_INPUT/);assert.throws(()=>r.readTransaction(()=>r.retireExpiredCandidates(input())),/forbidden/);assert.equal(historyCount(r,1),3);
 }finally{r.close();}
});

const migrationProof=(n:number,migrationAt=OLD):MigrationAgeProof=>({version:MIGRATION_AGE_POLICY.version,mint:mint(n),pool:canonicalObservationPool(mint(n)),signature:signature(n),slot:n+1,migrationAt,availableAt:Math.max(migrationAt,NOW-2*DAY),confirmedTransactionSha256:'b'.repeat(64),finalizedTransactionSha256:'c'.repeat(64)});
function seedMigration(r:MarketRegistry,n:number,count=3,change:Partial<WatchRow>={}){const p=migrationProof(n);r.putMigrationAgeProof(p);for(let i=0;i<count;i++)r.put({...row(n),pool:p.pool,migrationAt:p.migrationAt,...change,reason:'migration-history-'+i,history:[{at:NOW-2*DAY+i,state:change.state??'EXPIRED',reason:'migration-history-'+i}]});}

test('migration-mode retirement uses actual migration proof, retaining fresh migrations regardless of mint creation age',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>NOW,migrationAge:true});try{
  seed(r,1); // Creation proof alone is not the configured migration-age basis.
  seed(r,2);r.putMigrationAgeProof(migrationProof(2,NOW-3600000));
  seedMigration(r,3);r.putMigrationAgeProof(migrationProof(4,NOW-2*DAY));r.put(row(4));r.put(row(99));
  const before1=db(r).prepare('SELECT * FROM watch_history WHERE signature=?').all(signature(1)),before2=db(r).prepare('SELECT * FROM watch_history WHERE signature=?').all(signature(2));
  const result=r.retireExpiredCandidates(input());
  assert.equal(result.ageBasis,'pumpswap-migration');assert.equal(result.retiredHistoryRows,3);assert.equal(result.compactedWatchRows,1);
  assert.deepEqual(db(r).prepare('SELECT * FROM watch_history WHERE signature=?').all(signature(1)),before1);
  assert.deepEqual(db(r).prepare('SELECT * FROM watch_history WHERE signature=?').all(signature(2)),before2);
  assert.equal(historyCount(r,4),1,'the exact 48h retention boundary is not yet old enough');
  assert.equal(r.marketAgeEligibility(mint(2),NOW).allowed,true);assert.deepEqual(r.migrationAgeProof(mint(3)),migrationProof(3));
  const retained=db(r).prepare('SELECT body FROM watch_rows WHERE signature=?').get(signature(3)) as {body:string};
  assert.deepEqual(JSON.parse(retained.body).retention,{policy:CANDIDATE_RETENTION_POLICY.version,ageBasis:'pumpswap-migration',ageAt:OLD,migrationAt:OLD,retiredAt:NOW});
  for(const tombstone of db(r).prepare('SELECT age_basis,created_at FROM watch_history_retirements').all() as {age_basis:string;created_at:number}[])assert.deepEqual(tombstone,{age_basis:'pumpswap-migration',created_at:OLD});
 }finally{r.close();}
});

test('migration retention preserves financial dependencies, immutable proofs and recovery request state across restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-migration-retention-')),path=join(dir,'registry.sqlite');let r=new MarketRegistry(path,{now:()=>NOW,migrationAge:true});try{
  seedMigration(r,1,7);seedMigration(r,2,2,{state:'HELD'});seedMigration(r,3,2,{state:'ENTRY_PENDING'});seedMigration(r,4,2);seedMigration(r,5,2);r.put(row(99));
  r.observePumpSwapQualificationHint({mint:mint(1),signature:signature(1),receivedAt:NOW,source:'pumpportal-migration',kind:'migration'});
  r.putObservationPreparation({mint:mint(5),pool:canonicalObservationPool(mint(5)),checkedAt:NOW,state:'awaiting-dispatch',reason:'OFFLINE unresolved preparation'});
  const requests=db(r).prepare('SELECT * FROM pumpswap_migration_requests_v1').all(),proofs=db(r).prepare('SELECT * FROM pumpswap_migration_ages_v1 ORDER BY mint').all();
  // A retained creation cursor must not skip older migration coordinates.
  r.setMetadata('candidateRetention',{last:{at:NOW-1,cursor:{createdAt:NOW-2*DAY,mint:'zz'}},retiredHistoryRows:0,compactedWatchRows:0,retiredBodyBytes:0});
  let retired=0;for(let pass=0;pass<12;pass++){const result=r.retireExpiredCandidates(input(new Set([mint(4)]),2));retired+=result.retiredHistoryRows;assert.ok(result.retiredHistoryRows+result.compactedWatchRows<=2);if(pass===2){r.close();r=new MarketRegistry(path,{now:()=>NOW,migrationAge:true});}}
  assert.equal(retired,7);assert.equal(historyCount(r,1),0);for(const n of [2,3,4,5])assert.equal(historyCount(r,n),2);
  assert.deepEqual(db(r).prepare('SELECT * FROM pumpswap_migration_requests_v1').all(),requests);
  assert.deepEqual(db(r).prepare('SELECT * FROM pumpswap_migration_ages_v1 ORDER BY mint').all(),proofs);
  assert.equal(r.retentionStatus().last?.ageBasis,'pumpswap-migration');assert.equal(r.marketAgeEligibility(mint(1),NOW).allowed,false);
 }finally{r.close();rmSync(dir,{recursive:true,force:true});}
});
