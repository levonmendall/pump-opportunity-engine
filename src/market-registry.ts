import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import type {WatchRow,WatchSeed,WatchIdentityMetadata} from './pilot-watch.js';
import type {MarketIdentityHint,MarketActivityHint,MarketFeedStatus} from './market-discovery.js';

export class MarketRegistryContention extends Error {readonly code='MARKET_REGISTRY_CONTENTION';readonly callbackStarted=false;constructor(readonly sqliteCode:string){super('Market registry writer lease unavailable before callback');this.name='MarketRegistryContention';}}
export function isMarketRegistryContention(error:unknown):error is MarketRegistryContention {return error instanceof MarketRegistryContention;}
export class MarketRegistryReadOnlyViolation extends Error {readonly code='MARKET_REGISTRY_READ_ONLY_VIOLATION';constructor(message='Mutation is forbidden inside a market registry read snapshot'){super(message);this.name='MarketRegistryReadOnlyViolation';}}
export type RegistryParameter=string|number|bigint|null|Buffer;
export type RegistryMetricSummary={count:number;sum:number;mean:number|null;max:number|null;p50:number|null;p95:number|null};
export type MarketEvidence={buyLamports:string;sellLamports:string;buyHints:number;sellHints:number;activityHints:number;lastActivityAt:number|null;lastEconomicActivityAt:number|null;lastPrice:number|null;fingerprint:string};
export type EconomicFlowAfter={buyLamports:string;sellLamports:string;knownEvents:number;unknownEvents:number;latestAt:number|null;complete:boolean;retentionStartAt:number};
type EconomicFlowCache=Omit<EconomicFlowAfter,'complete'|'retentionStartAt'>&{decisionAt:number;counter:number;bytes:number};
export type RegistryQuery={where?:string;params?:RegistryParameter[];orderBy?:string;limit?:number;offset?:number};
type IdentityInput=Omit<MarketIdentityHint,'receivedAt'|'evidence'|'source'|'kind'>&{receivedAt?:number;at?:number;source:string;kind?:string;evidence?:string};
type ActivityInput=Omit<MarketActivityHint,'receivedAt'|'evidence'|'source'|'kind'>&{receivedAt?:number;at?:number;source:string;kind?:string;evidence?:string};
const json=(v:unknown)=>JSON.stringify(v,(_key,value)=>typeof value==='bigint'?value.toString():value);
const cloneRow=(row:unknown):WatchRow|undefined=>row?JSON.parse((row as {body:string}).body) as WatchRow:undefined;
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const name=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f]/.test(value);
function need(condition:unknown,reason:string):asserts condition {if(!condition)throw Error(reason);}
export const SHARED_ACTIVITY_HORIZON_MS=60000;
export const HINT_DEDUP_RETENTION_MS=3600000;
const FEEDS=['pumpportal-new-token','pumpportal-migration','pumpapi-broad'] as const;
const SCOPES=['CREATION_HINTS','MIGRATION_HINTS','SHARED_ACTIVITY_HINTS','WATCHED_ACTIVITY_HINTS','UNKNOWN'];
/** Nonfinancial, indexed market awareness. No method authorizes a trade or supplies
 * audited flow/quotes. SQL predicates are trusted application-source expressions;
 * provider values MUST be bound parameters. Result limits bound individual work,
 * never retention or the total number of observable identities. */
export class MarketRegistry {
 readonly locator:{version:'persistent-market-registry-v1';path:string};
 readonly path:string;
 private readonly db:Database.Database;
 private readonly statements=new Map<string,Database.Statement>();
 private readonly clock:()=>number;
 private readonly concurrentIntake:boolean;
 private readonly economicFlowCache=new Map<string,EconomicFlowCache>();private economicFlowCacheBytes=0;private economicFlowCacheHits=0;private economicFlowColdQueries=0;private economicFlowIncrementalQueries=0;private readonly economicTouchedMints=new Set<string>();
 private readDepth=0;private readSnapshotCommits=0;private writerLeaseReadOnlyCommits=0;private contentionAttempts=0;private transactionAttempts=0;private readOnlyCommits=0;private writeCommits=0;private failedTransactions=0;
 private writes=0;private writeTotalMs=0;private writeMaximumMs=0;private storageFailures=0;private transactionDepth=0;private storageAvailable=true;private lastFailureAt:number|null=null;private lastSuccessfulWriteAt:number|null=null;
 constructor(path:string,options:{now?:()=>number;concurrentIntake?:boolean}={}){
  this.path=path;this.locator={version:'persistent-market-registry-v1',path};this.clock=options.now??Date.now;this.concurrentIntake=options.concurrentIntake===true;
  if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
  this.db=new Database(path);this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 25');this.db.pragma('foreign_keys = ON');
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS registry_metadata(key TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS market_tokens(mint TEXT PRIMARY KEY,first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,last_activity_at INTEGER,activity_score REAL NOT NULL DEFAULT 0,screen_state TEXT NOT NULL DEFAULT 'UNAVAILABLE',activity_hints INTEGER NOT NULL DEFAULT 0,buy_hints INTEGER NOT NULL DEFAULT 0,sell_hints INTEGER NOT NULL DEFAULT 0,buy_lamports TEXT NOT NULL DEFAULT '0',sell_lamports TEXT NOT NULL DEFAULT '0',last_price REAL,screened_at INTEGER NOT NULL,last_signature TEXT,last_activity_source TEXT,last_activity_kind TEXT,last_economic_activity_at INTEGER);
   CREATE INDEX IF NOT EXISTS market_tokens_discovery ON market_tokens(first_seen_at,mint);
   CREATE INDEX IF NOT EXISTS market_tokens_activity ON market_tokens(last_activity_at DESC,activity_score DESC,mint);
   CREATE INDEX IF NOT EXISTS market_tokens_score ON market_tokens(activity_score DESC,last_activity_at DESC,mint);
   CREATE INDEX IF NOT EXISTS market_tokens_screen ON market_tokens(screen_state,mint);
   CREATE TABLE IF NOT EXISTS identity_provenance(mint TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,pool TEXT NOT NULL DEFAULT '',signature TEXT NOT NULL DEFAULT '',first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,PRIMARY KEY(mint,source,kind,pool,signature));
   CREATE INDEX IF NOT EXISTS identity_provenance_recent_kind ON identity_provenance(kind,last_seen_at DESC,mint);
   CREATE TABLE IF NOT EXISTS watch_rows(signature TEXT PRIMARY KEY,mint TEXT,pool TEXT,migration_at INTEGER,verified_at INTEGER,first_seen_at INTEGER NOT NULL,state TEXT NOT NULL,last_activity_at INTEGER,last_demoted_at INTEGER,deep_since INTEGER,defer_until INTEGER NOT NULL,waiting_since INTEGER NOT NULL,promotions INTEGER NOT NULL,repromotions INTEGER NOT NULL,demotions INTEGER NOT NULL,complete_windows INTEGER NOT NULL,ever_had_window INTEGER NOT NULL,last_window_at INTEGER,older_research INTEGER NOT NULL,capacity_status TEXT,capacity_reassess_at INTEGER,technical_state TEXT,technical_expires_at INTEGER,technical_not_before INTEGER,technical_requested_at INTEGER,body TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,last_decision_kind TEXT,last_decision_at INTEGER,reobserve_ready INTEGER NOT NULL DEFAULT 1);
   CREATE INDEX IF NOT EXISTS watch_rows_mint ON watch_rows(mint,archived,verified_at);
   CREATE INDEX IF NOT EXISTS watch_rows_state ON watch_rows(archived,state,defer_until,waiting_since);
   CREATE INDEX IF NOT EXISTS watch_rows_age ON watch_rows(archived,migration_at,first_seen_at);
   CREATE INDEX IF NOT EXISTS watch_rows_capacity ON watch_rows(archived,capacity_status,capacity_reassess_at);
   CREATE INDEX IF NOT EXISTS watch_rows_technical ON watch_rows(archived,technical_state,technical_expires_at,technical_not_before);
   CREATE TABLE IF NOT EXISTS watch_aliases(alias TEXT PRIMARY KEY,signature TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS watch_history(id INTEGER PRIMARY KEY,signature TEXT NOT NULL,at INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS watch_history_signature ON watch_history(signature,at,id);
   CREATE TABLE IF NOT EXISTS verification_queue(signature TEXT PRIMARY KEY,feed_mint TEXT,received_at INTEGER NOT NULL,not_before INTEGER NOT NULL,priority REAL NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,last_reason TEXT,finished_at INTEGER,source TEXT,kind TEXT);
   CREATE TABLE IF NOT EXISTS verification_history(id INTEGER PRIMARY KEY,signature TEXT NOT NULL,at INTEGER NOT NULL,event TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS verification_history_signature ON verification_history(signature,at,id);
   CREATE INDEX IF NOT EXISTS verification_due ON verification_queue(state,not_before,priority DESC,received_at,signature);
   CREATE INDEX IF NOT EXISTS verification_priority ON verification_queue(state,priority DESC,received_at,signature);
   CREATE INDEX IF NOT EXISTS verification_mint ON verification_queue(feed_mint,state);
   CREATE TABLE IF NOT EXISTS origin_proofs(mint TEXT PRIMARY KEY,body TEXT NOT NULL,available INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,archived_at INTEGER,archive_reason TEXT);
   CREATE TABLE IF NOT EXISTS origin_proof_history(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,archived_at INTEGER NOT NULL,reason TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS origin_proof_history_mint ON origin_proof_history(mint,archived_at,id);
   CREATE TABLE IF NOT EXISTS distinct_events(kind TEXT NOT NULL,key TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(kind,key));
   CREATE INDEX IF NOT EXISTS distinct_events_time ON distinct_events(kind,at);
   CREATE TABLE IF NOT EXISTS market_activity_seen(mint TEXT NOT NULL,signature TEXT NOT NULL,side TEXT NOT NULL,first_seen_at INTEGER NOT NULL,PRIMARY KEY(mint,signature,side));
   CREATE INDEX IF NOT EXISTS market_activity_seen_age ON market_activity_seen(first_seen_at);
   CREATE TABLE IF NOT EXISTS operating_metrics(scope TEXT NOT NULL,name TEXT NOT NULL,key TEXT NOT NULL,value REAL NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(scope,name,key));
   CREATE INDEX IF NOT EXISTS operating_metrics_values ON operating_metrics(scope,name,value);
   CREATE TABLE IF NOT EXISTS market_feeds(source TEXT PRIMARY KEY,connected INTEGER NOT NULL,last_observed_at INTEGER NOT NULL,scope TEXT NOT NULL,coverage_gaps INTEGER NOT NULL DEFAULT 0,last_gap_at INTEGER);
  `);
  for(const [table,fields] of [['market_tokens',['last_signature','last_activity_source','last_activity_kind']],['verification_queue',['source','kind']]] as const){const columns=new Set((this.statement(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(r=>r.name));for(const field of fields)if(!columns.has(field))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${field} TEXT`);}
  {const columns=new Set((this.statement('PRAGMA table_info(market_tokens)').all() as {name:string}[]).map(r=>r.name));if(!columns.has('last_economic_activity_at'))this.db.exec('ALTER TABLE market_tokens ADD COLUMN last_economic_activity_at INTEGER');}
  {const columns=new Set((this.statement('PRAGMA table_info(watch_rows)').all() as {name:string}[]).map(r=>r.name));for(const [column,definition] of [['last_decision_kind','TEXT'],['last_decision_at','INTEGER'],['reobserve_ready','INTEGER NOT NULL DEFAULT 1']])if(!columns.has(column!))this.db.exec(`ALTER TABLE watch_rows ADD COLUMN ${column} ${definition}`);this.db.exec('CREATE INDEX IF NOT EXISTS watch_rows_reobservation ON watch_rows(archived,state,reobserve_ready,defer_until,last_decision_at)');}
  {const columns=new Set((this.statement('PRAGMA table_info(market_activity_seen)').all() as {name:string}[]).map(r=>r.name));for(const [column,definition] of [['quote_lamports','TEXT'],['activity_sequence','INTEGER']])if(!columns.has(column!))this.db.exec(`ALTER TABLE market_activity_seen ADD COLUMN ${column} ${definition}`);this.db.exec('CREATE INDEX IF NOT EXISTS market_activity_seen_mint_time ON market_activity_seen(mint,first_seen_at);CREATE INDEX IF NOT EXISTS market_activity_seen_mint_sequence ON market_activity_seen(mint,activity_sequence)');}
  if(this.getMetadata<number>('createdAt')===undefined)this.setMetadata('createdAt',this.clock());
 }
 private statement(sql:string):Database.Statement {let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}return statement;}
 private write<T>(fn:()=>T):T {
  if(this.readDepth>0)throw new MarketRegistryReadOnlyViolation();
  if(this.transactionDepth>0)return fn();
  this.economicTouchedMints.clear();this.transactionAttempts++;const start=performance.now();let committedAt:number|null=null,mutated=false,failed=false,callbackStarted=false;
  try{const transaction=this.db.transaction(()=>{callbackStarted=true;this.transactionDepth++;try{
   const before=Number((this.statement('SELECT total_changes() n').get() as {n:number}).n);
   const value=fn();const after=Number((this.statement('SELECT total_changes() n').get() as {n:number}).n);
   // Lookup/no-op watch operations are read transactions. Writing diagnostic
   // metadata here used to turn each global activity lookup into a FULL fsync.
   mutated=after!==before;if(mutated){committedAt=Math.max(this.clock(),this.getMetadata<number>('updatedAt')??0);
    this.statement('INSERT INTO registry_metadata(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run('updatedAt',json(committedAt));}return value;
  }finally{this.transactionDepth--;}});const result=this.concurrentIntake?transaction.immediate():transaction();if(mutated){this.writeCommits++;this.storageAvailable=true;this.lastSuccessfulWriteAt=committedAt;}else{this.readOnlyCommits++;if(this.concurrentIntake)this.writerLeaseReadOnlyCommits++;}return result;
  }catch(error){failed=true;this.failedTransactions++;const code=(error as {code?:unknown})?.code;if(this.concurrentIntake&&!callbackStarted&&typeof code==='string'&&/^(SQLITE_BUSY|SQLITE_LOCKED)(_|$)/.test(code)){this.contentionAttempts++;throw new MarketRegistryContention(code);}if(typeof (error as {code?:unknown})?.code==='string'&&String((error as {code:string}).code).startsWith('SQLITE_')){this.storageFailures++;this.storageAvailable=false;this.lastFailureAt=this.clock();}throw error;
  }finally{this.economicTouchedMints.clear();if(mutated||failed){const elapsed=performance.now()-start;this.writes++;this.writeTotalMs+=elapsed;this.writeMaximumMs=Math.max(this.writeMaximumMs,elapsed);}}
 }
 /** Synchronous, consistent deferred snapshot. It takes no writer lease,
  * cannot upgrade to a writer, never changes commit metadata, and never replays
  * its callback. A nested read scope temporarily guards an existing write scope. */
 readTransaction<T>(fn:()=>T):T {
  if(fn.constructor.name==='AsyncFunction')throw new MarketRegistryReadOnlyViolation('Read snapshot callbacks must be synchronous');
  if(this.readDepth>0)return fn();
  const priorQueryOnly=Number(this.db.pragma('query_only',{simple:true}));
  const run=()=>{this.readDepth++;try{const result=fn();if(result&&typeof (result as {then?:unknown}).then==='function')throw new MarketRegistryReadOnlyViolation('Read snapshot callbacks must be synchronous');return result;}catch(error){const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^SQLITE_READONLY(?:_|$)/.test(code))throw new MarketRegistryReadOnlyViolation();throw error;}finally{this.readDepth--;}};
  this.db.pragma('query_only = ON');
  try{
   if(this.transactionDepth>0)return run();
   this.transactionAttempts++;try{const result=this.db.transaction(run).deferred();this.readOnlyCommits++;this.readSnapshotCommits++;return result;}
   catch(error){this.failedTransactions++;const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^SQLITE_READONLY(?:_|$)/.test(code))throw new MarketRegistryReadOnlyViolation();if(typeof code==='string'&&code.startsWith('SQLITE_')){this.storageFailures++;this.storageAvailable=false;this.lastFailureAt=this.clock();}throw error;}
  }finally{this.db.pragma('query_only = '+(priorQueryOnly?'ON':'OFF'));}
 }
 transaction<T>(fn:()=>T):T{return this.write(fn);}
 health(){return {economicFlow:{cacheBytes:this.economicFlowCacheBytes,cacheEntries:this.economicFlowCache.size,hits:this.economicFlowCacheHits,coldQueries:this.economicFlowColdQueries,incrementalQueries:this.economicFlowIncrementalQueries},transactions:{readSnapshotCommits:this.readSnapshotCommits,writerLeaseReadOnlyCommits:this.writerLeaseReadOnlyCommits,contentionBeforeCallback:this.contentionAttempts,attempted:this.transactionAttempts,readOnlyCommits:this.readOnlyCommits,writeCommits:this.writeCommits,failed:this.failedTransactions,fsyncEligibleCommits:this.writeCommits},available:this.storageAvailable,lastFailureAt:this.lastFailureAt,lastSuccessfulWriteAt:this.lastSuccessfulWriteAt,storageFailures:this.storageFailures,maximumWriteMs:this.writeMaximumMs,meanWriteMs:this.writes?this.writeTotalMs/this.writes:0};}
 getMetadata<T>(key:string):T|undefined {const row=this.statement('SELECT body FROM registry_metadata WHERE key=?').get(key) as {body:string}|undefined;return row?JSON.parse(row.body) as T:undefined;}
 setMetadata(key:string,value:unknown):void{this.write(()=>{this.statement('INSERT INTO registry_metadata(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,json(value));});}
 get(signature:string):WatchRow|undefined{return this.getBySignature(signature);}
 getBySignature(signature:string):WatchRow|undefined{return cloneRow(this.statement('SELECT w.body FROM watch_rows w WHERE w.signature=COALESCE((SELECT signature FROM watch_aliases WHERE alias=?),?) AND w.archived=0').get(signature,signature));}
 lookup(id:string):WatchRow|undefined{return this.getBySignature(id)??cloneRow(this.statement('SELECT body FROM watch_rows WHERE mint=? AND archived=0 ORDER BY verified_at DESC,first_seen_at LIMIT 1').get(id));}
 getById(id:string):WatchRow|undefined{return this.lookup(id);}
 put(row:WatchRow):void{this.transaction(()=>{
  const prior=this.statement('SELECT body FROM watch_rows WHERE signature=?').get(row.signature) as {body:string}|undefined;
  const gate=(row as WatchRow&{reobservation?:{kind:string;decisionAt:number;ready:unknown}}).reobservation;
  const fields=['signature','mint','pool','migration_at','verified_at','first_seen_at','state','last_activity_at','last_demoted_at','deep_since','defer_until','waiting_since','promotions','repromotions','demotions','complete_windows','ever_had_window','last_window_at','older_research','capacity_status','capacity_reassess_at','technical_state','technical_expires_at','technical_not_before','technical_requested_at','last_decision_kind','last_decision_at','reobserve_ready','body'];
  const values:RegistryParameter[]=[row.signature,row.mint,row.pool,row.migrationAt,row.verifiedAt,row.firstSeenAt,row.state,row.lastActivityAt,row.lastDemotedAt,row.deepSince,row.deferUntil,row.waitingSince,row.promotions,row.repromotions,row.demotions,row.completeWindows,row.everHadWindow?1:0,row.lastWindowAt,row.olderResearch?1:0,row.capacityCoverage?.status??null,row.capacityCoverage?.reassessAt??null,row.technicalReevaluation?.state??null,row.technicalReevaluation?.expiresAt??null,row.technicalReevaluation?.notBefore??null,row.technicalReevaluation?.requestedAt??null,gate?.kind??null,gate?.decisionAt??null,!gate||gate.ready!==null?1:0,json(row)];
  this.statement(`INSERT INTO watch_rows(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')}) ON CONFLICT(signature) DO UPDATE SET ${fields.slice(1).map(f=>`${f}=excluded.${f}`).join(',')},archived=0`).run(...values);
  const old=prior?JSON.parse(prior.body) as WatchRow:undefined;
  if(!old||old.state!==row.state||old.reason!==row.reason||old.history.at(-1)?.at!==row.history.at(-1)?.at){const h=row.history.at(-1);this.statement('INSERT INTO watch_history(signature,at,state,reason,body) VALUES(?,?,?,?,?)').run(row.signature,h?.at??this.clock(),row.state,row.reason,json(row));}
  if(row.mint)this.observeIdentity({mint:row.mint,signature:row.signature,pool:row.pool??undefined,at:row.verifiedAt??row.observationIdentity?.availableAt??row.firstSeenAt,source:row.verifiedAt!==null?'confirmed-migration':row.observationIdentity?'current-pool-scope':'legacy-watch-import',kind:row.verifiedAt!==null?'migration':row.observationIdentity?'current-pool-observation':'legacy-import'});
 });}
 upsert(row:WatchRow):void{this.put(row);}
 delete(signature:string,at=this.clock(),reason='watch row archived'):void{this.transaction(()=>{this.statement('UPDATE watch_rows SET archived=1 WHERE signature=?').run(signature);this.statement('INSERT INTO watch_history(signature,at,state,reason,body) VALUES(?,?,?,?,?)').run(signature,at,'ARCHIVED',reason,json({archived:true}));});}
 mergeWatchAlias(from:string,to:string):void{this.transaction(()=>{need(from!==to&&!!this.getBySignature(to),'MARKET_REGISTRY_ALIAS_TARGET');this.statement('UPDATE watch_aliases SET signature=? WHERE signature=?').run(to,from);this.statement('INSERT INTO watch_aliases(alias,signature) VALUES(?,?) ON CONFLICT(alias) DO UPDATE SET signature=excluded.signature').run(from,to);this.delete(from,this.clock(),'duplicate provisional seed merged into canonical verified identity');});}
 /** Only source-controlled SQL expressions are accepted here. */
 queryRows(q:RegistryQuery={}):WatchRow[]{const limit=q.limit??256;need(integer(limit)&&limit>0,'MARKET_REGISTRY_QUERY_LIMIT');const rows=this.statement(`SELECT w.body FROM watch_rows w WHERE w.archived=0${q.where?` AND (${q.where})`:''} ORDER BY ${q.orderBy??'w.signature'} LIMIT ? OFFSET ?`).all(...(q.params??[]),limit,q.offset??0) as {body:string}[];return rows.map(r=>JSON.parse(r.body) as WatchRow);}
 count(where?:string,params:RegistryParameter[]=[]):number{return Number((this.statement(`SELECT COUNT(*) AS n FROM watch_rows w WHERE w.archived=0${where?` AND (${where})`:''}`).get(...params) as {n:number}).n);}
 aggregate(expressions:Record<string,string>,where?:string,params:RegistryParameter[]=[]):Record<string,number|null>{need(Object.keys(expressions).every(k=>/^[A-Za-z][A-Za-z0-9_]*$/.test(k)),'MARKET_REGISTRY_AGGREGATE_ALIAS');return this.statement(`SELECT ${Object.entries(expressions).map(([key,expr])=>`${expr} AS ${key}`).join(',')} FROM watch_rows w WHERE w.archived=0${where?` AND (${where})`:''}`).get(...params) as Record<string,number|null>;}
 listMetadata(q:{after?:string;limit?:number;where?:string;params?:RegistryParameter[]}={}):WatchIdentityMetadata[]{const params=[...(q.params??[])];const conditions=[q.where??'1'];if(q.after){conditions.push('w.signature>?');params.push(q.after);}return this.queryRows({where:conditions.join(' AND '),params,orderBy:'w.signature',limit:q.limit??256}).map(r=>({signature:r.signature,mint:r.mint,pool:r.pool,migrationAt:r.migrationAt,verifiedAt:r.verifiedAt,state:r.state,olderResearch:!!r.olderResearch}));}
 enqueueVerification(seed:WatchSeed,priority=0,provenance?:{source:string;kind:string}):boolean{return this.transaction(()=>{need(name(seed.signature)&&integer(seed.receivedAt),'MARKET_REGISTRY_VERIFICATION_SEED');const result=this.statement('INSERT OR IGNORE INTO verification_queue(signature,feed_mint,received_at,not_before,priority,source,kind) VALUES(?,?,?,?,?,?,?)').run(seed.signature,seed.feedMint??null,seed.receivedAt,seed.receivedAt,priority,provenance?.source??'pumpportal-migration',provenance?.kind??'migration');if(seed.feedMint)this.observeIdentity({mint:seed.feedMint,signature:seed.signature,at:seed.receivedAt,source:provenance?.source??'pumpportal-migration',kind:provenance?.kind??'migration'});return result.changes===1;});}
 requeueVerification(seed:WatchSeed,notBefore=seed.receivedAt,reason='canonical creation re-verification required'):boolean{return this.transaction(()=>{
  need(name(seed.signature)&&integer(seed.receivedAt)&&integer(notBefore)&&name(reason),'MARKET_REGISTRY_REVERIFICATION');const prior=this.statement('SELECT * FROM verification_queue WHERE signature=?').get(seed.signature) as Record<string,unknown>|undefined;
  if(prior)this.statement('INSERT INTO verification_history(signature,at,event,body) VALUES(?,?,?,?)').run(seed.signature,this.clock(),'reverification-requeued-preserving-prior-state',json(prior));
  this.statement(`INSERT INTO verification_queue(signature,feed_mint,received_at,not_before,priority,state,last_reason) VALUES(?,?,?,?,0,'PENDING',?) ON CONFLICT(signature) DO UPDATE SET feed_mint=COALESCE(excluded.feed_mint,verification_queue.feed_mint),received_at=MIN(verification_queue.received_at,excluded.received_at),not_before=excluded.not_before,state='PENDING',last_reason=excluded.last_reason,finished_at=NULL`).run(seed.signature,seed.feedMint??null,seed.receivedAt,notBefore,reason);return true;
 });}
 removeVerification(signature:string,at=this.clock(),reason='verification completed'):void{this.write(()=>{this.statement("UPDATE verification_queue SET state='DONE',finished_at=?,last_reason=? WHERE signature=?").run(at,reason,signature);});}
 nextVerification(at:number):WatchSeed|undefined{const r=this.statement("SELECT signature,feed_mint,received_at FROM verification_queue WHERE state='PENDING' AND not_before<=? ORDER BY priority DESC,received_at,signature LIMIT 1").get(at) as {signature:string;feed_mint:string|null;received_at:number}|undefined;return r?{signature:r.signature,...(r.feed_mint?{feedMint:r.feed_mint}:{}),receivedAt:r.received_at}:undefined;}
 deferVerification(signature:string,until:number,reason='verification retry deferred'):void{this.write(()=>{this.statement("UPDATE verification_queue SET not_before=?,attempts=attempts+1,last_reason=? WHERE signature=? AND state='PENDING'").run(until,reason,signature);});}
 verificationCount():number{return Number((this.statement("SELECT COUNT(*) n FROM verification_queue WHERE state='PENDING'").get() as {n:number}).n);}
 verificationStats(at:number){const r=this.statement("SELECT COUNT(*) pending,SUM(CASE WHEN not_before<=? THEN 1 ELSE 0 END) ready,MIN(received_at) oldestReceivedAt FROM verification_queue WHERE state='PENDING'").get(at) as {pending:number;ready:number|null;oldestReceivedAt:number|null};return {...r,ready:r.ready??0,maxWaitMs:r.oldestReceivedAt===null?0:Math.max(0,at-r.oldestReceivedAt)};}
 putOrigin(mint:string,origin:unknown):void{this.write(()=>{const at=this.clock();this.statement('INSERT INTO origin_proofs(mint,body,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(mint) DO UPDATE SET body=excluded.body,available=1,updated_at=excluded.updated_at,archived_at=NULL,archive_reason=NULL').run(mint,json(origin),at,at);});}
 getOrigin<T=unknown>(mint:string):T|undefined{const row=this.statement('SELECT body FROM origin_proofs WHERE mint=?').get(mint) as {body:string}|undefined;return row?JSON.parse(row.body) as T:undefined;}
 hasOrigin(mint:string):boolean{return !!this.statement('SELECT 1 FROM origin_proofs WHERE mint=? AND available=1').get(mint);}
 archiveOrigin(mint:string,reason:string,at=this.clock()):void{this.transaction(()=>{this.statement('INSERT INTO origin_proof_history(mint,archived_at,reason,body,created_at,updated_at) SELECT mint,?,?,body,created_at,updated_at FROM origin_proofs WHERE mint=? AND available=1').run(at,reason,mint);this.statement('UPDATE origin_proofs SET available=0,archived_at=?,archive_reason=? WHERE mint=? AND available=1').run(at,reason,mint);});}
 markDistinct(kind:string,key:string,at:number):boolean{return this.write(()=>this.statement('INSERT OR IGNORE INTO distinct_events(kind,key,at) VALUES(?,?,?)').run(kind,key,at).changes===1);}
 distinctCount(kind:string):number{return Number((this.statement('SELECT COUNT(*) n FROM distinct_events WHERE kind=?').get(kind) as {n:number}).n);}
 markStage(mint:string,stage:'lightweight-screened'|'deep-admitted'|'verified-audit'|'evaluated',at:number):boolean{return this.markDistinct(stage,mint,at);}
 observeIdentity(input:IdentityInput):boolean{return this.transaction(()=>{const at=input.at??input.receivedAt;need(name(input.mint)&&integer(at)&&name(input.source),'MARKET_REGISTRY_IDENTITY');const mint=input.mint!;
  const inserted=this.statement("INSERT OR IGNORE INTO market_tokens(mint,first_seen_at,last_seen_at,screened_at) VALUES(?,?,?,?)").run(mint,at,at,at).changes===1;
  this.statement('UPDATE market_tokens SET first_seen_at=MIN(first_seen_at,?),last_seen_at=MAX(last_seen_at,?),screened_at=MAX(screened_at,?) WHERE mint=?').run(at,at,at,mint);
  this.statement('INSERT INTO identity_provenance(mint,source,kind,pool,signature,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(mint,source,kind,pool,signature) DO UPDATE SET last_seen_at=MAX(last_seen_at,excluded.last_seen_at)').run(mint,input.source,input.kind??'activity',input.pool??'',input.kind==='activity'?'':input.signature??'',at,at);
  this.markDistinct('lightweight-screened',mint,at);return inserted;
 });}
 /** Shared activity is an unverified prioritization hint, never an independent
  * audit, wallet-ownership claim, executable price, or trade qualification. */
 observeActivity(input:ActivityInput):boolean{return this.transaction(()=>{const at=input.at??input.receivedAt;need(integer(at),'MARKET_REGISTRY_ACTIVITY_TIME');this.observeIdentity({...input,at,kind:'activity'});
  const now=this.clock();this.maintenance(now,32);
  if(at<now-HINT_DEDUP_RETENTION_MS){this.setMetadata('staleActivityObservations',(this.getMetadata<number>('staleActivityObservations')??0)+1);return false;}
  const side=input.side??'unknown';
  const r=this.statement('SELECT last_activity_at,activity_score,buy_lamports,sell_lamports,activity_hints FROM market_tokens WHERE mint=?').get(input.mint) as {last_activity_at:number|null;activity_score:number;buy_lamports:string;sell_lamports:string;activity_hints:number};
  const amount=input.quoteLamports&&/^\d{1,20}$/.test(input.quoteLamports)&&BigInt(input.quoteLamports)<=18446744073709551615n?BigInt(input.quoteLamports):0n;
  const economic=!!input.signature&&amount>0n&&(side==='buy'||side==='sell')&&(input.quoteMint===undefined||input.quoteMint==='So11111111111111111111111111111111111111112');const buy=economic&&side==='buy'?amount:0n,sell=economic&&side==='sell'?amount:0n;
  if(input.signature&&this.statement('INSERT OR IGNORE INTO market_activity_seen(mint,signature,side,first_seen_at,quote_lamports,activity_sequence) VALUES(?,?,?,?,?,?)').run(input.mint,input.signature,side,at,economic?amount.toString():null,r.activity_hints+1).changes===0)return false;
  this.economicTouchedMints.add(input.mint);
  // A decaying measured shared-stream demand priority, not a profit probability.
  const decay=Math.exp(-Math.max(0,at-(r.last_activity_at??at))/60000),sol=Number(amount)/1e9;
  const impulse=economic?(side==='buy'?1:-1)*Math.log1p(Number.isFinite(sol)?sol:0):0;
  const fresh=at<=now&&now-at<=SHARED_ACTIVITY_HORIZON_MS;
  const score=fresh?r.activity_score*decay+impulse:r.activity_score;
  this.statement(`UPDATE market_tokens SET last_seen_at=MAX(last_seen_at,?),last_activity_at=MAX(COALESCE(last_activity_at,0),?),activity_score=?,screen_state=CASE WHEN ? THEN 'WITH_ACTIVITY' ELSE screen_state END,activity_hints=activity_hints+1,buy_hints=buy_hints+?,sell_hints=sell_hints+?,buy_lamports=?,sell_lamports=?,last_price=COALESCE(?,last_price),screened_at=MAX(screened_at,?),last_signature=COALESCE(?,last_signature),last_activity_source=?,last_activity_kind=?,last_economic_activity_at=CASE WHEN ? THEN MAX(COALESCE(last_economic_activity_at,0),?) ELSE last_economic_activity_at END WHERE mint=?`).run(at,at,score,economic?1:0,side==='buy'?1:0,side==='sell'?1:0,(BigInt(r.buy_lamports)+buy).toString(),(BigInt(r.sell_lamports)+sell).toString(),typeof input.price==='number'&&Number.isFinite(input.price)&&input.price>0?input.price:null,at,input.signature??null,input.source,input.kind??'activity',economic?1:0,at,input.mint);
  this.statement("UPDATE verification_queue SET priority=? WHERE feed_mint=? AND state='PENDING'").run(Math.max(0,score),input.mint);if(economic)this.markDistinct('lightweight-with-activity',input.mint,at);return true;
 });}
 marketEvidence(mint:string):MarketEvidence|undefined {
  const row=this.statement('SELECT buy_lamports buyLamports,sell_lamports sellLamports,buy_hints buyHints,sell_hints sellHints,activity_hints activityHints,last_activity_at lastActivityAt,last_economic_activity_at lastEconomicActivityAt,last_price lastPrice FROM market_tokens WHERE mint=?').get(mint) as Omit<MarketEvidence,'fingerprint'>|undefined;
  return row?{...row,fingerprint:createHash('sha256').update(json([row.buyLamports,row.sellLamports,row.lastPrice])).digest('hex')}:undefined;
 }
 /** Exact known SOL-hint lower bounds strictly after the decision timestamp.
  * Unknown/legacy/foreign quote amounts stay unknown. Cache retention may be
  * shorter than the decision age; completeness is explicit, never inferred. */
 economicFlowAfter(mint:string,decisionAt:number):EconomicFlowAfter {
  need(name(mint)&&integer(decisionAt),'MARKET_REGISTRY_ECONOMIC_FLOW_WINDOW');
  return this.readTransaction(()=>{
   const retentionStartAt=Math.max(0,this.clock()-HINT_DEDUP_RETENTION_MS),token=this.statement('SELECT activity_hints FROM market_tokens WHERE mint=?').get(mint) as {activity_hints:number}|undefined,counter=Number(token?.activity_hints??0),cache=this.economicFlowCache.get(mint),canCache=!this.economicTouchedMints.has(mint),incremental=canCache&&cache?.decisionAt===decisionAt&&cache.counter<=counter;
   if(incremental&&cache.counter===counter){this.economicFlowCacheHits++;this.economicFlowCache.delete(mint);this.economicFlowCache.set(mint,cache);return {buyLamports:cache.buyLamports,sellLamports:cache.sellLamports,knownEvents:cache.knownEvents,unknownEvents:cache.unknownEvents,latestAt:cache.latestAt,complete:token!==undefined&&decisionAt>=retentionStartAt&&cache.unknownEvents===0,retentionStartAt};}
   let buy=BigInt(incremental?cache.buyLamports:'0'),sell=BigInt(incremental?cache.sellLamports:'0'),knownEvents=incremental?cache.knownEvents:0,unknownEvents=incremental?cache.unknownEvents:0,latestAt=incremental?cache.latestAt:null;
   const query=incremental?'SELECT side,first_seen_at,quote_lamports FROM market_activity_seen WHERE mint=? AND activity_sequence>? AND first_seen_at>?':'SELECT side,first_seen_at,quote_lamports FROM market_activity_seen WHERE mint=? AND first_seen_at>?';
   if(incremental)this.economicFlowIncrementalQueries++;else this.economicFlowColdQueries++;
   for(const row of this.statement(query).iterate(...(incremental?[mint,cache.counter,decisionAt]:[mint,decisionAt])) as IterableIterator<{side:string;first_seen_at:number;quote_lamports:string|null}>){if(row.quote_lamports!==null&&/^\d+$/.test(row.quote_lamports)&&(row.side==='buy'||row.side==='sell')){const amount=BigInt(row.quote_lamports);if(row.side==='buy')buy+=amount;else sell+=amount;knownEvents++;latestAt=Math.max(latestAt??0,row.first_seen_at);}else unknownEvents++;}
   const result={buyLamports:buy.toString(),sellLamports:sell.toString(),knownEvents,unknownEvents,latestAt,complete:token!==undefined&&decisionAt>=retentionStartAt&&unknownEvents===0,retentionStartAt};
   if(canCache){if(cache)this.economicFlowCacheBytes-=cache.bytes;const bytes=256+2*(mint.length+result.buyLamports.length+result.sellLamports.length);this.economicFlowCache.delete(mint);this.economicFlowCache.set(mint,{...result,decisionAt,counter,bytes});this.economicFlowCacheBytes+=bytes;
    // This bounds only an expendable aggregate cache, never market identities,
    // evidence, eligibility, or the ability to query any token again.
    while(this.economicFlowCacheBytes>1024*1024){const first=this.economicFlowCache.keys().next().value;if(first===undefined)break;this.economicFlowCacheBytes-=this.economicFlowCache.get(first)!.bytes;this.economicFlowCache.delete(first);}
   }return result;
  });
 }
 /** Idempotent operational observations only; these are never ledger entries. */
 recordMetric(scope:string,metric:string,key:string,value:number,at:number):boolean{return this.write(()=>{need(name(scope)&&name(metric)&&name(key)&&Number.isFinite(value)&&value>=0&&integer(at),'MARKET_REGISTRY_METRIC');return this.statement('INSERT OR IGNORE INTO operating_metrics(scope,name,key,value,at) VALUES(?,?,?,?,?)').run(scope,metric,key,value,at).changes===1;});}
 /** Exact nearest-rank quantiles, selected in SQLite without loading samples. */
 metricSummary(scope:string,metric:string):RegistryMetricSummary {
  const row=this.statement('SELECT COUNT(*) count,COALESCE(SUM(value),0) sum,AVG(value) mean,MAX(value) max FROM operating_metrics WHERE scope=? AND name=?').get(scope,metric) as Omit<RegistryMetricSummary,'p50'|'p95'>;
  const quantile=(p:number)=>row.count?Number((this.statement('SELECT value FROM operating_metrics WHERE scope=? AND name=? ORDER BY value LIMIT 1 OFFSET ?').get(scope,metric,Math.max(0,Math.ceil(row.count*p)-1)) as {value:number}).value):null;
  return {...row,p50:quantile(.5),p95:quantile(.95)};
 }
 /** Trusted expression bindings precede WHERE bindings in query.params. */
 valueSummary(query:{expression:string;where?:string;params?:RegistryParameter[]}):RegistryMetricSummary {
  const source=`SELECT (${query.expression}) value FROM watch_rows w WHERE w.archived=0${query.where?` AND (${query.where})`:''}`;
  const params=query.params??[];const row=this.statement(`SELECT COUNT(*) count,COALESCE(SUM(value),0) sum,AVG(value) mean,MAX(value) max FROM (${source})`).get(...params) as Omit<RegistryMetricSummary,'p50'|'p95'>;
  const quantile=(p:number)=>row.count?Number((this.statement(`SELECT value FROM (${source}) ORDER BY value LIMIT 1 OFFSET ?`).get(...params,Math.max(0,Math.ceil(row.count*p)-1)) as {value:number}).value):null;
  return {...row,p50:quantile(.5),p95:quantile(.95)};
 }
 nextWatchActivities(limit=16):{mint:string;at:number;evidence:'unverified-provider-activity-hint'}[]{
  need(integer(limit)&&limit>0,'MARKET_REGISTRY_ACTIVITY_BATCH');return (this.statement(`SELECT DISTINCT w.mint mint,t.last_activity_at at FROM watch_rows w JOIN market_tokens t ON t.mint=w.mint WHERE w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED') AND t.last_activity_at>COALESCE(w.last_activity_at,-1) ORDER BY COALESCE(w.last_activity_at,0),w.signature LIMIT ?`).all(limit) as {mint:string;at:number}[]).map(r=>({...r,evidence:'unverified-provider-activity-hint' as const}));
 }
 /** Current observation selects actual retained mint hints, without needing a
  * transaction signature or creation archive. The SDK still has to establish
  * the canonical pool's existence and supported account state. */
 nextObservationCandidate(at:number):{mint:string;signature:string;receivedAt:number;activityAt:number|null;source:string;priority:number}|undefined {
  need(integer(at),'MARKET_REGISTRY_OBSERVATION_TIME');
  return this.statement(`WITH hints AS (
   SELECT mint,last_activity_at received_at FROM market_tokens WHERE last_activity_at>=? AND last_activity_at<=? AND activity_hints>0
   UNION
   SELECT mint,MAX(last_seen_at) received_at FROM identity_provenance WHERE kind='migration' AND last_seen_at>=? AND last_seen_at<=? GROUP BY mint
  ) SELECT t.mint,
   COALESCE((SELECT w.signature FROM watch_rows w WHERE w.archived=0 AND w.mint=t.mint ORDER BY w.first_seen_at,w.signature LIMIT 1),(SELECT w.signature FROM verification_queue q JOIN watch_rows w ON w.signature=q.signature WHERE q.feed_mint=t.mint AND w.archived=0 ORDER BY q.received_at,q.signature LIMIT 1),t.last_signature,'current-pool:'||t.mint) signature,
   hints.received_at receivedAt,t.last_activity_at activityAt,COALESCE(t.last_activity_source,'retained-market-identity') source,t.activity_score priority FROM hints JOIN market_tokens t ON t.mint=hints.mint
   WHERE (t.last_activity_at IS NULL OR t.last_activity_at<=?)
   AND NOT EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=t.mint AND w.archived=0 AND (w.verified_at IS NOT NULL OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint' OR w.state IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED')))
   AND NOT EXISTS(SELECT 1 FROM distinct_events d WHERE d.kind='native-current-hint-invalid' AND d.key=t.mint)
   ORDER BY t.activity_score DESC,hints.received_at DESC,t.mint LIMIT 1`).get(at-SHARED_ACTIVITY_HORIZON_MS,at,at-SHARED_ACTIVITY_HORIZON_MS,at,at) as {mint:string;signature:string;receivedAt:number;activityAt:number|null;source:string;priority:number}|undefined;
 }
 nextOriginCandidate(at:number):{mint:string;signature:string;receivedAt:number;source:string;priority:number}|undefined {
  const row=this.statement(`SELECT t.mint,t.last_signature signature,t.last_activity_at receivedAt,t.last_activity_source source,t.activity_score priority FROM market_tokens t
   WHERE t.activity_score>0 AND t.last_activity_at>=? AND t.last_activity_at<=? AND t.last_signature IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM origin_proofs o WHERE o.mint=t.mint AND o.available=1)
   AND NOT EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=t.mint AND w.verified_at IS NOT NULL AND w.archived=0)
   AND NOT EXISTS(SELECT 1 FROM verification_queue q WHERE q.signature=t.last_signature OR (q.feed_mint=t.mint AND q.state='PENDING'))
   ORDER BY t.activity_score DESC,t.last_activity_at DESC,t.mint LIMIT 1`).get(at-SHARED_ACTIVITY_HORIZON_MS,at) as {mint:string;signature:string;receivedAt:number;source:string;priority:number}|undefined;
  return row;
 }
 /** Only the lightweight replay-dedup cache expires. Token identities, proof,
  * candidate state/history and all financial/audit evidence remain untouched.
  * One bounded delete joins each intake transaction; it never refuses intake. */
 maintenance(at=this.clock(),batch=128):number{return this.transaction(()=>{need(integer(at)&&integer(batch)&&batch>0,'MARKET_REGISTRY_MAINTENANCE');const removed=this.statement('DELETE FROM market_activity_seen WHERE rowid IN (SELECT rowid FROM market_activity_seen WHERE first_seen_at<? ORDER BY first_seen_at LIMIT ?)').run(at-HINT_DEDUP_RETENTION_MS,batch).changes;if(removed)this.setMetadata('hintDedupKeysPruned',(this.getMetadata<number>('hintDedupKeysPruned')??0)+removed);return removed;});}
 observeActivityBatch(inputs:ActivityInput[]):void{this.transaction(()=>{for(const input of inputs)this.observeActivity(input);});}
 observeFeed(feed:MarketFeedStatus):void{this.recordFeed(feed);}
 recordFeed(feed:MarketFeedStatus):void{this.write(()=>{need((FEEDS as readonly string[]).includes(feed.source)&&integer(feed.at),'MARKET_REGISTRY_FEED');const scope=SCOPES.includes(feed.scope)?feed.scope:feed.source==='pumpportal-new-token'?'CREATION_HINTS':feed.source==='pumpportal-migration'?'MIGRATION_HINTS':'SHARED_ACTIVITY_HINTS';this.statement('INSERT INTO market_feeds(source,connected,last_observed_at,scope,coverage_gaps,last_gap_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET connected=excluded.connected,last_observed_at=MAX(last_observed_at,excluded.last_observed_at),scope=excluded.scope,coverage_gaps=coverage_gaps+CASE WHEN connected=1 AND excluded.connected=0 THEN 1 ELSE 0 END,last_gap_at=CASE WHEN connected=1 AND excluded.connected=0 THEN excluded.last_observed_at ELSE last_gap_at END').run(feed.source,feed.connected?1:0,feed.at,scope,feed.connected?0:1,feed.connected?null:feed.at);});}
 /** First-observed unique-identity cohort and first local classification
  * completions, not market activity messages or repeated screens. */
 cohortCounts(startedAt:number,untilAt:number):{discoveredDistinct:number;lightweightArrivals:number;lightweightCompleted:number}{
  need(integer(startedAt)&&integer(untilAt)&&startedAt<=untilAt,'MARKET_REGISTRY_COHORT_WINDOW');
  return this.readTransaction(()=>{const discoveredDistinct=Number((this.statement('SELECT COUNT(*) n FROM market_tokens WHERE first_seen_at>=? AND first_seen_at<=?').get(startedAt,untilAt) as {n:number}).n),lightweightCompleted=Number((this.statement('SELECT COUNT(*) n FROM distinct_events WHERE kind=? AND at>=? AND at<=?').get('lightweight-screened',startedAt,untilAt) as {n:number}).n);return {discoveredDistinct,lightweightArrivals:discoveredDistinct,lightweightCompleted};});
 }
 coverage(at:number){return this.coverageSnapshot(at);}
 coverageSnapshot(at:number){const hour=Math.floor(at/3600000)*3600000;const tokens=this.statement("SELECT COUNT(*) total,SUM(CASE WHEN screen_state='WITH_ACTIVITY' THEN 1 ELSE 0 END) with_activity,MAX(last_seen_at) updated_at FROM market_tokens").get() as {total:number;with_activity:number|null;updated_at:number|null};const queue=this.verificationStats(at);const feeds=(this.statement('SELECT source,connected,last_observed_at,scope,coverage_gaps FROM market_feeds ORDER BY source').all() as {source:string;connected:number;last_observed_at:number;scope:string;coverage_gaps:number}[]).map(f=>({source:f.source,connected:!!f.connected,lastObservedAt:f.last_observed_at,scope:f.scope,coverageGaps:f.coverage_gaps}));
  const active=this.aggregate({tracked:"SUM(CASE WHEN w.state NOT IN ('EXPIRED','PERMANENTLY_UNSUPPORTED') THEN 1 ELSE 0 END)",awaitingDeep:"SUM(CASE WHEN w.state IN ('WATCH','DEFERRED') AND w.verified_at IS NOT NULL THEN 1 ELSE 0 END)",deep:"SUM(CASE WHEN w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING') THEN 1 ELSE 0 END)"});
  return {version:'poe-market-coverage-v1' as const,generatedAt:at,persistence:{state:this.storageAvailable?'sqlite-wal' as const:'unavailable' as const,createdAt:this.getMetadata<number>('createdAt')??null,updatedAt:this.getMetadata<number>('updatedAt')??this.getMetadata<number>('createdAt')??null},lifetime:{uniqueTokensDiscovered:tokens.total,lightweightScreened:this.distinctCount('lightweight-screened'),lightweightWithActivity:this.distinctCount('lightweight-with-activity'),lightweightUnavailable:tokens.total-(tokens.with_activity??0),deepAdmitted:this.distinctCount('deep-admitted'),verifiedAudited:this.distinctCount('verified-audit')},currentHour:{startedAt:hour,uniqueTokensDiscovered:Number((this.statement('SELECT COUNT(*) n FROM market_tokens WHERE first_seen_at>=? AND first_seen_at<=?').get(hour,at) as {n:number}).n)},active:{trackedIdentities:active.tracked??0,awaitingOrigin:Number((this.statement('SELECT COUNT(*) n FROM market_tokens t WHERE NOT EXISTS(SELECT 1 FROM origin_proofs o WHERE o.mint=t.mint AND o.available=1)').get() as {n:number}).n),awaitingLightweight:0,awaitingVerification:queue.pending,awaitingDeep:active.awaitingDeep??0,deepObserving:active.deep??0},lightweight:{activityHorizonMs:SHARED_ACTIVITY_HORIZON_MS,dedupRetentionMs:HINT_DEDUP_RETENTION_MS,hintDedupKeysPruned:this.getMetadata<number>('hintDedupKeysPruned')??0,staleActivityObservations:this.getMetadata<number>('staleActivityObservations')??0},resource:{registryTransactions:this.health().transactions,durableVerificationBacklog:queue.pending,oldestVerificationAt:queue.oldestReceivedAt,maximumVerificationWaitMs:queue.maxWaitMs,storageFailures:this.storageFailures,maximumWriteMs:this.writeMaximumMs,meanWriteMs:this.writes?this.writeTotalMs/this.writes:0},feeds,marketDenominator:null,wholeMarketCoveragePercent:null,limitations:['MARKET_DENOMINATOR_UNKNOWN','PROVIDER_HINTS_UNVERIFIED','PREMIGRATION_EXECUTION_NOT_SUPPORTED','SOURCE_OUTAGES_NOT_RECONSTRUCTED','SHARED_ACTIVITY_PARTIAL_WHEN_FEED_UNAVAILABLE','PREEXISTING_MARKET_BACKFILL_UNAVAILABLE','UNVERIFIED_ORIGIN_DISCOVERY_PENDING','SHARED_HINT_DEDUP_RETENTION_1H',...(!this.storageAvailable?['REGISTRY_STORAGE_UNAVAILABLE']:[])]};
 }
 close():void{if(this.readDepth>0)throw new MarketRegistryReadOnlyViolation('Closing the registry is forbidden inside a read snapshot');this.statements.clear();this.economicFlowCache.clear();this.economicFlowCacheBytes=0;this.db.close();}
}
