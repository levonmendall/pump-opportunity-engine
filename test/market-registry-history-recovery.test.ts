import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry,SHARED_ACTIVITY_HORIZON_MS} from '../src/market-registry.js';
import {PilotWatch,type WatchRow} from '../src/pilot-watch.js';
import {TOKEN_AGE_POLICY} from '../src/token-age-policy.js';

const AT=Date.parse('2026-11-03T01:05:31Z'),RECOVERY='token-creation-history-young-prefix-recovery-v1';
const internal=(registry:MarketRegistry)=>registry as unknown as {db:Database.Database};
function fixture(path=':memory:'){
 const registry=new MarketRegistry(path,{now:()=>AT+1000}),db=internal(registry).db;
 const watch=new PilotWatch({registry,maximumDeep:4,now:()=>AT+1000,record:()=>{}}),base=watch.discover({signature:'OFFLINE-base',receivedAt:AT-100000})!;
 const seed=(mint:string,options:{activityAt?:number;poolReady?:boolean}={})=>{
  const row:WatchRow={...base,signature:'OFFLINE-watch-'+mint,mint,pool:'OFFLINE-pool-'+mint,state:'WATCH',history:[{at:AT-100000,state:'WATCH',reason:'OFFLINE history recovery'}]};registry.put(row);
  registry.observeActivity({mint,pool:row.pool!,signature:'OFFLINE-activity-'+mint,source:'OFFLINE-broad',kind:'activity',at:options.activityAt??AT,side:'buy',venue:'pump-amm'});
  registry.putObservationPreparation({mint,pool:row.pool!,checkedAt:AT-1000,state:options.poolReady===false?'pool-absent':'pool-ready',reason:'OFFLINE_TEST_ACCOUNT_RESULT'});
 };
 return {registry,db,seed};
}

test('only directly requestable creation-hint receipt windows suppress history qualification',()=>{
 for(const source of ['pumpportal-new-token','finalized-mint-history'])for(const offset of [-TOKEN_AGE_POLICY.maximumAgeMs-1,-TOKEN_AGE_POLICY.maximumAgeMs,0,1]){
  const f=fixture();try{
   f.seed('candidate');f.registry.observeIdentity({mint:'candidate',source,kind:'creation',signature:'OFFLINE-birth',at:AT+offset});
   const inWindow=offset>=-TOKEN_AGE_POLICY.maximumAgeMs&&offset<=0;
   assert.equal(f.registry.nextTokenCreationRequest(AT,true)?.mint,inWindow?'candidate':undefined);
   assert.equal(f.registry.nextTokenCreationHistoryRequest(AT)?.mint,inWindow?undefined:'candidate',source+' offset '+offset);
   f.registry.deferTokenCreationRequest({mint:'candidate',signature:'OFFLINE-birth'},AT,'OFFLINE_COOLDOWN');
   assert.equal(f.registry.nextTokenCreationRequest(AT,true),undefined);
   assert.equal(f.registry.nextTokenCreationHistoryRequest(AT)?.mint,inWindow?undefined:'candidate','an eligible direct request keeps its cooldown priority; old/future hints cannot block both paths');
   f.registry.deferTokenCreationRequest({mint:'candidate',signature:'OFFLINE-birth'},AT,'OFFLINE_TERMINAL',true);
   assert.equal(f.registry.nextTokenCreationHistoryRequest(AT)?.mint,'candidate');
  }finally{f.registry.close();}
 }
});

test('one-time recovery requeues only the exact old history refusal and retains all cursor evidence',()=>{
 const directory=mkdtempSync(join(tmpdir(),'poe-history-recovery-')),path=join(directory,'market.sqlite');let f=fixture(path);
 try{
  const reasons=['recover','recover-no-candidate','known-proof','different-terminal','nonterminal','stale','missing-pool'];
  for(const mint of reasons)f.seed(mint,{activityAt:mint==='stale'?AT-SHARED_ACTIVITY_HORIZON_MS-1:AT,poolReady:mint!=='missing-pool'});
  const insert=f.db.prepare('INSERT INTO token_creation_history(mint,before_signature,before_slot,until_signature,until_slot,oldest_candidate,oldest_candidate_slot,next_attempt_at,turns,terminal,last_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  for(const mint of reasons)insert.run(mint,'OFFLINE-before-'+mint,100,'OFFLINE-until-'+mint,1,mint==='recover-no-candidate'?null:'OFFLINE-candidate-'+mint,mint==='recover-no-candidate'?null:10,AT+60000,7,mint==='nonterminal'?0:1,mint==='different-terminal'?'TOKEN_CREATION_SIGNATURE_REQUIRES_FINALIZED_CREATE_PROOF':'TOKEN_CREATION_HISTORY_PRECEDES_24H');
  f.db.prepare('INSERT INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)').run('known-proof',AT-3600000,AT-1,'{"OFFLINE":"already verified immutable row"}');
  f.db.prepare('DELETE FROM registry_metadata WHERE key=?').run(RECOVERY);
  const before=f.db.prepare('SELECT * FROM token_creation_history ORDER BY mint').all() as Array<Record<string,unknown>>;
  const proofs=f.db.prepare('SELECT * FROM token_creations ORDER BY mint').all(),history=f.db.prepare('SELECT * FROM watch_history ORDER BY id').all();
  f.registry.close();const registry=new MarketRegistry(path,{now:()=>AT+1000});f={...f,registry,db:internal(registry).db};
  const after=f.db.prepare('SELECT * FROM token_creation_history ORDER BY mint').all() as Array<Record<string,unknown>>;
  for(let i=0;i<before.length;i++){
   const original=before[i]!,changed=original.terminal===1&&original.last_reason==='TOKEN_CREATION_HISTORY_PRECEDES_24H'&&original.mint!=='known-proof';
   assert.deepEqual(after[i],changed?{...original,terminal:0,next_attempt_at:AT+1000}:original,'only retry permission/time can change; all six cursor/candidate fields, turns and refusal evidence stay exact');
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM token_creations ORDER BY mint').all(),proofs);assert.deepEqual(f.db.prepare('SELECT * FROM watch_history ORDER BY id').all(),history);
  assert.deepEqual(registry.getMetadata(RECOVERY),{at:AT+1000,requeued:4,cursorsRetained:true,reason:'TOKEN_CREATION_HISTORY_PRECEDES_24H',financialPermission:false});
  const admitted=[];for(let i=0;i<2;i++){const request=registry.nextTokenCreationHistoryRequest(AT+1000)!;assert.ok(request);admitted.push(request.mint);registry.deferTokenCreationHistory(request,AT+1000,'OFFLINE_RETRY_PENDING');}
  assert.deepEqual(admitted.sort(),['recover','recover-no-candidate']);assert.equal(registry.nextTokenCreationHistoryRequest(AT+1000),undefined,'missing pool, stale activity, other terminals, known proof and cooldown still refuse');
  f.db.prepare("UPDATE token_creation_history SET terminal=1,next_attempt_at=?,last_reason='TOKEN_CREATION_HISTORY_PRECEDES_24H' WHERE mint='recover'").run(AT+5000);
  const once=f.db.prepare('SELECT * FROM token_creation_history ORDER BY mint').all();registry.close();f.registry=new MarketRegistry(path,{now:()=>AT+2000});f.db=internal(f.registry).db;
  assert.deepEqual(f.db.prepare('SELECT * FROM token_creation_history ORDER BY mint').all(),once,'a later terminal cannot be reset again by opening another process');
 }finally{f.registry.close();rmSync(directory,{recursive:true,force:true});}
});
