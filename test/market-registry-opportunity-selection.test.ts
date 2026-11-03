import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {MarketRegistry,isMarketRegistryContention,type RegistryParameter,type ObservationPriorityHints} from '../src/market-registry.js';
import {PilotWatch,type WatchRow} from '../src/pilot-watch.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';
import {TOKEN_AGE_POLICY} from '../src/token-age-policy.js';
import {legacyOpportunitySelection} from './fixtures/opportunity-selection-before-r6.js';

const AT=Date.parse('2026-11-02T05:55:00Z'),SOL='So11111111111111111111111111111111111111112';
const mint=(i:number)=>new PublicKey(createHash('sha256').update('OFFLINE-R6-mint-'+i).digest()).toBase58();
const signature=(i:number)=>bs58.encode(createHash('sha512').update('OFFLINE-R6-signature-'+i).digest());
type Internals={db:Database.Database;statement(sql:string):Database.Statement};
const internal=(r:MarketRegistry)=>r as unknown as Internals;
function fixture(enforceTokenAge24h=false,path=':memory:'){
 const registry=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true}),events:Array<{kind:string;data:any}>=[];
 const watch=new PilotWatch({registry,maximumDeep:4,...(enforceTokenAge24h?{enforceTokenAge24h:true as const}:{}),observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT+1000,record:(kind,data)=>events.push({kind,data})});
 const base=watch.discover({signature:'OFFLINE-unidentified-base',receivedAt:AT-86400000})!;
 const seed=(i:number,patch:Partial<WatchRow>={})=>{const row:WatchRow={...base,signature:'OFFLINE-watch-'+String(i).padStart(5,'0'),mint:mint(i),pool:'OFFLINE-pool-'+i,state:'WATCH',firstSeenAt:AT-100000,waitingSince:AT-60000,observationIdentity:{basis:'canonical-pool-hint',availableAt:AT-100000,evidence:'OFFLINE canonical scope hint'},history:Array.from({length:16},(_,j)=>({at:AT-100000+j,state:'WATCH',reason:'OFFLINE preserved history '+i+':'+j})),...patch};registry.put(row);return row;};
 const hint=(i:number,id:string,when:number,lamports:string|null,side:'buy'|'sell'='buy',extra:Record<string,unknown>={})=>registry.observeActivity({mint:mint(i),pool:'OFFLINE-pool-'+i,signature:'OFFLINE-hint-'+i+'-'+id,source:'OFFLINE-broad',at:when,side,...(lamports===null?{}:{quoteLamports:lamports}),quoteMint:SOL,...extra});
 const age=(i:number,createdAt=AT-3600000,availableAt=AT-1000)=>registry.putTokenCreationProof({version:TOKEN_AGE_POLICY.version,mint:mint(i),signature:signature(i),slot:i+1,createdAt,availableAt,commitment:'finalized',instruction:'create',transactionSha256:createHash('sha256').update('OFFLINE-proof-'+i).digest('hex')});
 const birth=(i:number,when=AT-1000)=>registry.observeIdentity({mint:mint(i),source:'pumpportal-new-token',kind:'creation',signature:signature(i),at:when});
 const current=registry.nextOpportunity.bind(registry);let parityCalls=0;
 registry.nextOpportunity=(q,at,anchor,preparation,preparedMintLookup)=>{const expected=legacyOpportunitySelection.call(internal(registry),q,at,anchor,preparation),actual=current(q,at,anchor,preparation,preparedMintLookup);assert.deepEqual(actual,expected,'selected full row and every hint match the frozen deployed query in one transaction');parityCalls++;return actual;};
 const next=(at=AT,excluded=new Set<string>(),options:Parameters<PilotWatch['next']>[2]={})=>watch.next(at,excluded,options);
 const priority=()=>events.filter(r=>r.kind==='pilot-watch-opportunity-priority').at(-1)?.data as (ObservationPriorityHints&{stage?:string})|undefined;
 return {registry,watch,seed,hint,age,birth,next,priority,events,parityCalls:()=>parityCalls};
}

test('all-null dimensions remain neutral and preserve all waiting, first-seen and signature ties',()=>{
 const f=fixture();try{
  f.seed(1,{signature:'tie-b'});f.seed(2,{signature:'tie-a'});f.seed(3,{signature:'tie-c',waitingSince:AT-59999});f.seed(4,{signature:'tie-d',firstSeenAt:AT-99999});
  assert.equal(f.next()!.mint,mint(2));assert.equal(f.priority()!.economicMerit,0.5);assert.equal(f.priority()!.fairnessBonus,0);assert.equal(f.priority()!.hasCurrentEconomicEvidence,false);
  assert.equal(f.next(AT,new Set([mint(2)]))!.mint,mint(1));assert.equal(f.next(AT,new Set([mint(1),mint(2)]))!.mint,mint(4));
  assert.equal(f.next(AT,new Set([mint(1),mint(2),mint(3),mint(4)])),null);assert.equal(f.parityCalls(),4);
 }finally{f.registry.close();}
});

test('singleton and uneven duplicate dimensions preserve negative, zero, positive and NULL midranks',()=>{
 const f=fixture();try{
  const values:[number,number|null][]=[[1,null],[2,0],[3,1],[4,-1],[5,-1],[6,-1],[7,2],[8,2],[9,2],[10,2],[11,9]];
  for(const [i,value]of values){f.seed(i);if(value!==null){f.hint(i,'prior',AT-90000,String((i%3)*1000000000),i%2?'buy':'sell');if(value===0){f.hint(i,'zero-buy',AT-1000,'1000000000','buy');f.hint(i,'zero-sell',AT-1000,'1000000000','sell');}else f.hint(i,'recent',AT-1000,String(Math.abs(value)*1000000000),value<0?'sell':'buy');}}
  const excluded=new Set<string>();for(let turn=0;turn<values.length;turn++){const row=f.next(AT,excluded)!;assert.ok(row);const hints=f.priority()!;assert.ok(hints.economicMerit>=0&&hints.economicMerit<=1);excluded.add(row.mint!);}
  assert.equal(excluded.size,values.length);assert.equal(f.next(AT,excluded),null);
 }finally{f.registry.close();}
});

test('bounded fairness can change the winner while the no-bonus economic leader remains exact',()=>{
 const f=fixture();try{
  for(let i=0;i<48;i++){f.seed(i,{waitingSince:i===46?AT-60000:AT,observationIdentity:{basis:'canonical-pool-hint',availableAt:i===46?AT-60000:AT,evidence:'OFFLINE fairness anchor'}});f.hint(i,'recent',AT-1000,String((i+1)*1000000));}
  assert.equal(f.next()!.mint,mint(46));const p=f.priority()!;assert.equal(p.economicLeaderMint,mint(47));assert.equal(p.waitChangedWinner,true);assert.equal(p.fairnessBonus,0.05);assert.ok(p.economicLeaderMerit>p.economicMerit);
  assert.equal(f.next(AT,new Set([mint(46)]))!.mint,mint(47));
 }finally{f.registry.close();}
});

test('productive age routes share one tier, fallback rows retain their full ordinal weight, and route diagnostics survive',()=>{
 const f=fixture(true);try{
  f.seed(1);f.age(1);f.hint(1,'recent',AT-1000,'1000000000');
  f.seed(2);f.birth(2);f.hint(2,'recent',AT-1000,'2000000000');
  f.seed(3);f.hint(3,'recent',AT-1000,'9000000000');
  assert.equal(f.next(AT,new Set(),{preparation:true})!.mint,mint(2),'requestable age and verified age share a productive tier');assert.equal(f.priority()!.preparationAgeRoute,'creation-request-available');assert.equal(f.priority()!.stage,'creation-request-available');
  const withFallback=f.priority()!.economicMerit;f.next(AT,new Set([mint(3)]),{preparation:true});assert.notEqual(f.priority()!.economicMerit,withFallback,'unreachable fallback still contributes to the global dimension population');
  assert.equal(f.next(AT,new Set([mint(2),mint(3)]),{preparation:true})!.mint,mint(1));assert.equal(f.priority()!.stage,'verified-token-age');
  assert.equal(f.next(AT,new Set([mint(1),mint(2)]),{preparation:true})!.mint,mint(3));assert.equal(f.priority()!.stage,'creation-request-unavailable');
  assert.equal(f.next()!.mint,mint(1),'ordinary allocation still requires verified age');assert.equal(Object.hasOwn(f.priority()!,'stage'),false);assert.equal(f.priority()!.financialPermission,false);
 }finally{f.registry.close();}
});

test('exact age, request retry, observation and flow time boundaries agree with the deployed selector',()=>{
 const f=fixture(true);try{
  f.seed(1);f.age(1,AT-TOKEN_AGE_POLICY.maximumAgeMs,AT-1000);
  f.seed(2);f.age(2,AT-1000,AT+1);
  f.seed(3);f.birth(3,AT-TOKEN_AGE_POLICY.maximumAgeMs);f.hint(3,'active',AT-60000,'1000000000');f.registry.deferTokenCreationRequest({mint:mint(3),signature:signature(3)},AT-60000,'OFFLINE_RETRY');
  f.seed(4,{deferUntil:AT+1});f.age(4);
  f.seed(5,{observationIdentity:{basis:'canonical-pool-hint',availableAt:AT+1,evidence:'OFFLINE future identity'}});f.age(5);
  for(const when of [AT-1,AT,AT+1,AT+60000,AT+60001])for(const preparation of [false,true])f.next(when,new Set(),{preparation});
  assert.equal(f.next(AT,new Set([mint(2),mint(3),mint(4),mint(5)]))!.mint,mint(1));assert.equal(f.next(AT+1,new Set([mint(2),mint(3),mint(4),mint(5)])),null,'known age beyond24hours is still excluded');
  assert.equal(f.next(AT,new Set([mint(1),mint(2),mint(4),mint(5)]),{preparation:true})!.mint,mint(3));assert.equal(f.priority()!.preparationAgeRoute,'creation-request-available');
  f.next(AT+1,new Set([mint(1),mint(2),mint(4),mint(5)]),{preparation:true});assert.equal(f.priority()!.preparationAgeRoute,'creation-request-unavailable','creation signature outside24hours loses only its productive route');
 }finally{f.registry.close();}
});

test('deterministic mixed evidence preserves full-population results across scopes, replay, gates and exclusions',()=>{
 const f=fixture(true);let state=0x6c8e9cf5;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
 try{
  for(let i=0;i<160;i++){
   f.seed(i,{state:i%23===0?'HELD':i%19===0?'DEFERRED':'WATCH',deferUntil:i%17===0?AT+1:0,waitingSince:AT-random()%120000});
   if(i%4===0)f.age(i,AT-(i%8===0?TOKEN_AGE_POLICY.maximumAgeMs:3600000));else if(i%4===1)f.birth(i,i%9===0?AT-TOKEN_AGE_POLICY.maximumAgeMs-1:AT-1000);
   if(i%13===0)f.registry.deferTokenCreationRequest({mint:mint(i),signature:signature(i)},AT-60000,'OFFLINE_TERMINAL',true);
   for(let j=0;j<6;j++){
    const times=[AT-120001,AT-120000,AT-60000,AT-59999,AT,AT+1],amount=random()%7,side=(random()%2?'buy':'sell') as 'buy'|'sell';
    f.hint(i,String(j),times[j]!,amount===0?null:String(amount*1000000000),side,{tokenAmount:String(random()%9+1),...(i%11===0&&j%2?{pool:'OFFLINE-other-pool'}:{}),...(i%7===0&&j%2?{source:'OFFLINE-other-source'}:{})});
    if(j===3)f.hint(i,String(j),AT+1000,'999999999999',side,{tokenAmount:'1'});
   }
   if(i%31===0){f.watch.noteEvaluation(mint(i),{kind:'technical-unavailable',windowEndAt:null,evidence:JSON.stringify({reason:'NATIVE_OBSERVATION_POOL_MISSING',pool:'OFFLINE-pool-'+i,supportRefusedAt:AT,completedWindow:false})},AT);f.watch.transition(mint(i),'DEFERRED','OFFLINE closed unchanged pool',AT);}
  }
  for(const at of [AT-1,AT,AT+1,AT+60000,AT+60001])for(const preparation of [false,true])for(const mod of [2,7]){
   const excluded=new Set(Array.from({length:160},(_,i)=>i).filter(i=>i%mod===0).map(mint));const selected=f.next(at,excluded,{preparation});if(selected)assert.equal(excluded.has(selected.mint!),false);
  }
  assert.equal(f.parityCalls(),20);
 }finally{f.registry.close();}
});

test('selection builds one scalar eligibility population and fetches only the final body after ranking',()=>{
 const f=fixture();try{
  f.registry.transaction(()=>{for(let i=0;i<2048;i++)f.seed(i);});for(let i=0;i<24;i++){f.hint(i,'prior',AT-90000,'1000000000');f.hint(i,'recent',AT-1000,String((i%5)*1000000000));}
  const before=f.registry.health().transactions,raw=internal(f.registry),statement=raw.statement.bind(f.registry);let sql='',params:RegistryParameter[]=[];
  raw.statement=(text:string)=>{const s=statement(text);if(!text.startsWith('WITH eligible AS MATERIALIZED'))return s;return new Proxy(s,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return(...values:RegistryParameter[])=>{sql=text;params=values;return value.apply(target,values);};}});};
  assert.ok(f.next());const plan=(raw.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params) as {detail:string}[]).map(r=>r.detail);
  assert.equal(plan.filter(d=>d==='MATERIALIZE eligible').length,1);assert.equal(plan.filter(d=>d.includes('SEARCH w USING INDEX watch_rows_opportunity_v1')).length,1);assert.ok(plan.some(d=>d.includes('MATERIALIZE dimension_counts')||d.includes('CO-ROUTINE dimension_counts')));assert.ok(plan.some(d=>d.includes('SEARCH selected USING INDEX sqlite_autoindex_watch_rows_1 (signature=?)')));
  assert.equal(f.registry.count(),2049,'every identity remains retained');const after=f.registry.health().transactions;assert.equal(after.writeCommits,before.writeCommits);assert.equal(after.fsyncEligibleCommits,before.fsyncEligibleCommits);assert.equal(after.writerLeaseReadOnlyCommits,before.writerLeaseReadOnlyCommits+1,'watch selection keeps its existing writer-lease transaction');
 }finally{f.registry.close();}
});

test('one-to-four prepared mints use exact indexed lookups with exclusions and all allocation gates retained',()=>{
 const f=fixture(true);try{
  f.registry.transaction(()=>{for(let i=0;i<2048;i++)f.seed(i);});const prepared=Array.from({length:4},(_,n)=>2044+n);for(const i of prepared)f.age(i);
  const raw=internal(f.registry),statement=raw.statement.bind(f.registry),plans:string[][]=[];
  raw.statement=sql=>{const s=statement(sql);if(!sql.startsWith('WITH eligible AS MATERIALIZED'))return s;return new Proxy(s,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return(...params:RegistryParameter[])=>{plans.push((raw.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params) as {detail:string}[]).map(r=>r.detail));return value.apply(target,params);};}});};
  assert.equal(f.next(AT,new Set(),{preparedMints:[mint(prepared[0]!)]})!.mint,mint(prepared[0]!));
  assert.equal(f.next(AT,new Set([mint(prepared[0]!)]),{preparedMints:prepared.map(mint)})!.mint,mint(prepared[1]!));
  const first=f.registry.lookup(mint(prepared[1]!))!;f.registry.put({...first,deferUntil:AT+1});assert.equal(f.next(AT,new Set([mint(prepared[0]!)]),{preparedMints:prepared.map(mint)})!.mint,mint(prepared[2]!));
  for(const plan of plans){assert.ok(plan.some(d=>/SEARCH w USING INDEX watch_rows_mint \(mint=\? AND archived=\?/.test(d)));assert.equal(plan.some(d=>d.includes('watch_rows_opportunity_v1')),false,'bounded prepared scopes do not scan the full defer-time index');}
  assert.equal(f.registry.count(),2049);assert.equal(f.next(AT,new Set(),{preparedMints:[]}),null);
 }finally{f.registry.close();}
});

test('ordinary age-qualified selection seeks current proofs before retained unknown WatchRows and keeps exact ranking parity',()=>{
 const f=fixture(true);try{
  f.registry.transaction(()=>{for(let i=0;i<4096;i++)f.seed(i);});
  const raw=internal(f.registry),statement=raw.statement.bind(f.registry),plans:Array<{sql:string;steps:string[]}>=[];
  raw.statement=sql=>{const s=statement(sql);if(!sql.includes('FROM token_creations selection_age'))return s;return new Proxy(s,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return(...params:RegistryParameter[])=>{plans.push({sql,steps:(raw.db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params) as {detail:string}[]).map(r=>r.detail)});return value.apply(target,params);};}});};
  assert.equal(f.next(),null,'a zero-young population needs no historical WatchRow scan');
  f.age(4090,AT-TOKEN_AGE_POLICY.maximumAgeMs);f.age(4091);f.age(4092,AT-TOKEN_AGE_POLICY.maximumAgeMs-1000);f.age(4093,AT-1000,AT+1);
  f.hint(0,'unknown-high-merit',AT-1000,'999999999999999');f.hint(4090,'young-small',AT-1000,'1000000000');f.hint(4091,'young-large',AT-1000,'2000000000');f.hint(4092,'expired-high-merit',AT-1000,'999999999999999');
  assert.equal(f.next()!.mint,mint(4091));assert.equal(f.next(AT,new Set([mint(4091)]))!.mint,mint(4090));
  assert.equal(f.next(AT+1,new Set([mint(4091)]))!.mint,mint(4093),'the exact24h mint expires and the previously future proof becomes available');
  assert.equal(f.next(AT+1,new Set([mint(4091),mint(4093)])),null);
  assert.ok(plans.some(p=>p.sql.startsWith('WITH eligible AS MATERIALIZED')));assert.ok(plans.some(p=>p.sql.startsWith('SELECT 1')));
  for(const plan of plans){assert.ok(plan.steps.some(d=>d.includes('SEARCH selection_age USING INDEX token_creations_age (created_at>? AND created_at<?)')));assert.ok(plan.steps.some(d=>d.includes('SEARCH w USING INDEX watch_rows_mint (mint=? AND archived=?)')));assert.ok(!plan.steps.some(d=>d.includes('watch_rows_opportunity_v1')),'neither existence nor ranking scans retained non-target rows');}
  assert.equal(f.registry.count(),4097);assert.equal(f.parityCalls(),5);
 }finally{f.registry.close();}
});

test('new selection index preserves stored rows and history, and rollback immediately restores the former winner',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-selection-upgrade-')),path=join(dir,'market.sqlite');let f=fixture(true,path);
 try{
  f.seed(1);f.age(1);f.seed(2);f.age(2);f.hint(1,'active',AT-1000,'2000000000');f.hint(2,'active',AT-1000,'1000000000');
  const contents=(db:Database.Database)=>Object.fromEntries(['watch_rows','watch_history','market_tokens','identity_provenance','token_creations','registry_metadata'].map(table=>[table,createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())).digest('hex')]));
  internal(f.registry).db.exec('DROP INDEX watch_rows_opportunity_v1');const before=contents(internal(f.registry).db);f.registry.close();
  const reopened=new MarketRegistry(path,{now:()=>AT+1000,concurrentIntake:true});assert.deepEqual(contents(internal(reopened).db),before);reopened.close();
  f=fixture(true,path);assert.equal(f.next()!.mint,mint(1));
  assert.throws(()=>f.registry.transaction(()=>{const row=f.registry.lookup(mint(1))!;f.registry.put({...row,deferUntil:AT+1});assert.equal(f.next()!.mint,mint(2));throw Error('OFFLINE_ROLLBACK');}),/OFFLINE_ROLLBACK/);
  assert.equal(f.next()!.mint,mint(1));
 }finally{f.registry.close();rmSync(dir,{recursive:true,force:true});}
});

test('ranking and final body stay inside existing writer authority while another connection attempts a change',()=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-selection-authority-')),path=join(dir,'market.sqlite'),f=fixture(false,path),writer=new MarketRegistry(path,{now:()=>AT,concurrentIntake:true});
 try{
  f.seed(1);f.seed(2);f.hint(1,'recent',AT-1000,'2000000000');f.hint(2,'recent',AT-1000,'1000000000');const raw=internal(f.registry),original=raw.statement.bind(f.registry);let attempted=false,callbackStarted=false;
  raw.statement=sql=>{const s=original(sql);if(!sql.startsWith('WITH eligible AS MATERIALIZED'))return s;return new Proxy(s,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;if(key!=='get')return value.bind(target);return(...args:RegistryParameter[])=>{if(!attempted){attempted=true;assert.throws(()=>writer.transaction(()=>{callbackStarted=true;writer.put({...writer.lookup(mint(1))!,deferUntil:AT+1000});}),isMarketRegistryContention);}return value.apply(target,args);};}});};
  const selected=f.next()!;assert.equal(attempted,true);assert.equal(callbackStarted,false);assert.equal(selected.mint,mint(1));assert.equal(selected.deferUntil,0);
  writer.put({...writer.lookup(mint(1))!,deferUntil:AT+1000});assert.equal(f.next()!.mint,mint(2),'a later selection observes the committed change without cached eligibility');
 }finally{writer.close();f.registry.close();rmSync(dir,{recursive:true,force:true});}
});
