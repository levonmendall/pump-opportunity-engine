import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import type {WatchRow,WatchSeed,WatchIdentityMetadata} from './pilot-watch.js';
import type {MarketIdentityHint,MarketActivityHint,MarketFeedStatus} from './market-discovery.js';
import {OPPORTUNITY_PRIORITY_POLICY,observationFairnessBonus} from './opportunity-priority-policy.js';
import {TOKEN_AGE_POLICY,validTokenCreationProof,tokenAgeDecision,type TokenCreationProof} from './token-age-policy.js';
import {MIGRATION_AGE_POLICY,validMigrationAgeProof,migrationAgeDecision,type MigrationAgeProof} from './migration-age-policy.js';
import {TOKEN_CREATION_HISTORY_POLICY,type TokenCreationHistoryRequest,type TokenCreationHistoryPage} from './token-creation-history.js';

export class MarketRegistryContention extends Error {readonly code='MARKET_REGISTRY_CONTENTION';readonly callbackStarted=false;constructor(readonly sqliteCode:string){super('Market registry writer lease unavailable before callback');this.name='MarketRegistryContention';}}
export function isMarketRegistryContention(error:unknown):error is MarketRegistryContention {return error instanceof MarketRegistryContention;}
export class MarketRegistryReadOnlyViolation extends Error {readonly code='MARKET_REGISTRY_READ_ONLY_VIOLATION';constructor(message='Mutation is forbidden inside a market registry read snapshot'){super(message);this.name='MarketRegistryReadOnlyViolation';}}
export type RegistryParameter=string|number|bigint|null|Buffer;
export type RegistryMetricSummary={count:number;sum:number;mean:number|null;max:number|null;p50:number|null;p95:number|null};
export type ObservationPriorityHints={version:'shared-flow-opportunity-priority-v2';horizonMs:number;recentNetSol:number|null;priorNetSol:number|null;netAccelerationSolPerMinute:number|null;priceReturnBps:number|null;priceDemandAgreement:number|null;priceMovePerGrossSol:number|null;twoSidedPriceStability:number|null;priceScope:{pool:string;source:string;firstAt:number;lastAt:number}|null;serviceableWaitMs:number;economicMerit:number;priority:number;hasCurrentEconomicEvidence:boolean;fairnessBonus:number;economicLeaderMint:string;economicLeaderMerit:number;waitChangedWinner:boolean;preparationAgeRoute?:'verified-token-age'|'creation-request-available'|'creation-request-unavailable';directLiquidity:'unknown';financialPermission:false};
export type MarketEvidence={buyLamports:string;sellLamports:string;buyHints:number;sellHints:number;activityHints:number;lastActivityAt:number|null;lastEconomicActivityAt:number|null;lastPrice:number|null;fingerprint:string};
export type EconomicFlowAfter={buyLamports:string;sellLamports:string;knownEvents:number;unknownEvents:number;latestAt:number|null;complete:boolean;retentionStartAt:number};
export type ObservationPreparation={mint:string;pool:string;checkedAt:number;state:'pool-ready'|'pool-absent'|'pool-unsupported'|'provider-unavailable'|'awaiting-dispatch';reason:string;sourceSlot?:number};
export type TokenCreationScopeEntry=Readonly<{mint:string;createdAt:number;availableAt:number;expiresAt:number}>;
export type PumpSwapQualificationHint={mint:string;receivedAt:number;source:'pumpportal-migration'|'pumpapi-broad';signature?:string;kind:'migration'|'activity';venue?:'pump-amm'};
export type PumpSwapQualificationRecord={mint:string;firstSeenAt:number;lastSeenAt:number;source:PumpSwapQualificationHint['source'];kind:PumpSwapQualificationHint['kind'];signature:string|null};
type EconomicFlowCache=Omit<EconomicFlowAfter,'complete'|'retentionStartAt'>&{decisionAt:number;counter:number;bytes:number};
type RegistryTransactionCounters={readSnapshotCommits:number;writerLeaseReadOnlyCommits:number;contentionBeforeCallback:number;attempted:number;readOnlyCommits:number;writeCommits:number;failed:number;fsyncEligibleCommits:number};
export type RegistryReportingIndex='watch_rows_report_summary_v1'|'watch_rows_report_page_v1'|'watch_rows_report_entry_age_v2'|'watch_rows_report_waiting_v2';
export type RegistryQuery={where?:string;params?:RegistryParameter[];orderBy?:string;limit?:number;offset?:number;index?:RegistryReportingIndex;tokenAgeAt?:number};
type IdentityInput=Omit<MarketIdentityHint,'receivedAt'|'evidence'|'source'|'kind'>&{receivedAt?:number;at?:number;source:string;kind?:string;evidence?:string};
type ActivityInput=Omit<MarketActivityHint,'receivedAt'|'evidence'|'source'|'kind'>&{receivedAt?:number;at?:number;source:string;kind?:string;evidence?:string};
const json=(v:unknown)=>JSON.stringify(v,(_key,value)=>typeof value==='bigint'?value.toString():value);
const cloneRow=(row:unknown):WatchRow|undefined=>row?JSON.parse((row as {body:string}).body) as WatchRow:undefined;
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const name=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f]/.test(value);
function need(condition:unknown,reason:string):asserts condition {if(!condition)throw Error(reason);}
export const SHARED_ACTIVITY_HORIZON_MS=60000;
export const HINT_DEDUP_RETENTION_MS=3600000;
/** Retire only detail for a verified, expired nontrade candidate. Identity and
 * creation proofs remain available, so cleanup cannot make an old token new. */
export const CANDIDATE_RETENTION_POLICY=Object.freeze({version:'expired-nontrade-candidate-48h-v1',minimumTokenAgeMs:2*86_400_000,unusedGraceMs:86_400_000,maximumBatchRows:128,maximumBatchBytes:4*1024*1024,maximumScannedMints:16});
export type CandidateRetentionInput={at:number;protectedMints:Pick<ReadonlySet<string>,'has'>;protectedSignatures?:ReadonlySet<string>;tradeHistoryComplete:true;batch?:number};
export type CandidateRetentionResult={policy:typeof CANDIDATE_RETENTION_POLICY.version;at:number;scannedMints:number;protectedMints:number;oversizedRowsDeferred:number;retiredHistoryRows:number;compactedWatchRows:number;retiredBodyBytes:number;cursor:{createdAt:number;mint:string}|null};
type CandidateRetentionTotals={last:CandidateRetentionResult|null;retiredHistoryRows:number;compactedWatchRows:number;retiredBodyBytes:number};
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
 private readonly writerTurn:Int32Array|null;private readonly writerRole:'main'|'intake';private writerRequests=0;private writerTurns=0;private writerYields=0;private writerExpiries=0;
 private readonly economicFlowCache=new Map<string,EconomicFlowCache>();private economicFlowCacheBytes=0;private economicFlowCacheHits=0;private economicFlowColdQueries=0;private economicFlowIncrementalQueries=0;private readonly economicTouchedMints=new Set<string>();
 private rollbackActions:Array<()=>void>=[];private commitActions:Array<()=>void>=[];
 private migrationAge=false;
 private readonly migrationAgeProofListeners=new Set<(proof:Readonly<MigrationAgeProof>)=>void>();
 private readonly tokenCreationProofListeners=new Set<(proof:Readonly<TokenCreationProof>)=>void>();
 private readDepth=0;private readSnapshotCommits=0;private writerLeaseReadOnlyCommits=0;private contentionAttempts=0;private transactionAttempts=0;private readOnlyCommits=0;private writeCommits=0;private failedTransactions=0;
 // Reporting may run inside an unresolved transaction. Retain its genuine
 // prior settled counters; live health still includes the active attempt.
 private reportingTransactionBaseline:RegistryTransactionCounters|null=null;
 // These summaries live only inside one synchronous SQLite read snapshot.
 // They are discarded before any later publication or write can observe them.
 private reportingPopulation:Record<string,number>|null=null;
 private reportingVerification:Map<number,{pending:number;ready:number;oldestReceivedAt:number|null;maxWaitMs:number}>|null=null;
 private writes=0;private writeTotalMs=0;private writeMaximumMs=0;private storageFailures=0;private transactionDepth=0;private storageAvailable=true;private lastFailureAt:number|null=null;private lastSuccessfulWriteAt:number|null=null;
 constructor(path:string,options:{now?:()=>number;concurrentIntake?:boolean;writerTurn?:SharedArrayBuffer;writerRole?:'main'|'intake';migrationAge?:true}={}){
  this.migrationAge=options.migrationAge===true;this.path=path;this.locator={version:'persistent-market-registry-v1',path};this.clock=options.now??Date.now;this.concurrentIntake=options.concurrentIntake===true;this.writerRole=options.writerRole??'main';
  if(options.writerTurn!==undefined&&(!(options.writerTurn instanceof SharedArrayBuffer)||options.writerTurn.byteLength!==8))throw Error('MARKET_REGISTRY_WRITER_TURN_BUFFER');
  this.writerTurn=this.concurrentIntake?new Int32Array(options.writerTurn??new SharedArrayBuffer(8)):null;
  if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
  this.db=new Database(path);this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('busy_timeout = 25');this.db.pragma('foreign_keys = ON');
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS registry_metadata(key TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS pumpswap_hint_tokens(mint TEXT PRIMARY KEY,first_seen_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS observation_preparations(mint TEXT PRIMARY KEY,pool TEXT NOT NULL,checked_at INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,source_slot INTEGER);
   CREATE INDEX IF NOT EXISTS observation_preparations_state ON observation_preparations(state,mint);
   CREATE TABLE IF NOT EXISTS pumpswap_qualification_hints_v1(mint TEXT PRIMARY KEY,first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,signature TEXT,pool_state TEXT NOT NULL DEFAULT 'unprepared',pool_checked_at INTEGER,birth_signature TEXT,birth_seen_at INTEGER,promoted_at INTEGER);
   CREATE INDEX IF NOT EXISTS pumpswap_qualification_recent_v1 ON pumpswap_qualification_hints_v1(pool_state,last_seen_at,first_seen_at,mint);
   CREATE INDEX IF NOT EXISTS pumpswap_qualification_promotion_v1 ON pumpswap_qualification_hints_v1(promoted_at,last_seen_at,mint);
   CREATE TRIGGER IF NOT EXISTS pumpswap_qualification_prepared_insert_v1 AFTER INSERT ON observation_preparations BEGIN UPDATE pumpswap_qualification_hints_v1 SET pool_state=NEW.state,pool_checked_at=NEW.checked_at WHERE mint=NEW.mint; END;
   CREATE TRIGGER IF NOT EXISTS pumpswap_qualification_prepared_update_v1 AFTER UPDATE OF state,checked_at,pool ON observation_preparations BEGIN UPDATE pumpswap_qualification_hints_v1 SET pool_state=NEW.state,pool_checked_at=NEW.checked_at WHERE mint=NEW.mint; END;
   CREATE TRIGGER IF NOT EXISTS pumpswap_qualification_prepared_delete_v1 AFTER DELETE ON observation_preparations BEGIN UPDATE pumpswap_qualification_hints_v1 SET pool_state='unprepared',pool_checked_at=NULL WHERE mint=OLD.mint; END;
   CREATE TABLE IF NOT EXISTS market_venue_hints(mint TEXT NOT NULL,source TEXT NOT NULL,venue TEXT NOT NULL,pool TEXT NOT NULL DEFAULT '',first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,PRIMARY KEY(mint,source,venue,pool));
   CREATE INDEX IF NOT EXISTS market_venue_hints_recent ON market_venue_hints(mint,last_seen_at DESC);
   CREATE TABLE IF NOT EXISTS pumpswap_migration_ages_v1(mint TEXT PRIMARY KEY,migrated_at INTEGER NOT NULL,verified_at INTEGER NOT NULL,proof TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS pumpswap_migration_ages_time_v1 ON pumpswap_migration_ages_v1(migrated_at,mint);
   CREATE TABLE IF NOT EXISTS pumpswap_migration_requests_v1(mint TEXT PRIMARY KEY,signature TEXT NOT NULL,received_at INTEGER NOT NULL,direct INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,last_reason TEXT NOT NULL DEFAULT 'MIGRATION_AGE_UNVERIFIED');
   CREATE INDEX IF NOT EXISTS pumpswap_migration_requests_due_v1 ON pumpswap_migration_requests_v1(next_attempt_at,direct,received_at,mint);
   CREATE TABLE IF NOT EXISTS token_creations(mint TEXT PRIMARY KEY,created_at INTEGER NOT NULL,verified_at INTEGER NOT NULL,proof TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS token_creations_age ON token_creations(created_at,mint);
   CREATE TABLE IF NOT EXISTS token_creation_requests(mint TEXT NOT NULL,signature TEXT NOT NULL,next_attempt_at INTEGER NOT NULL,terminal INTEGER NOT NULL,last_reason TEXT NOT NULL,PRIMARY KEY(mint,signature));
   CREATE TABLE IF NOT EXISTS token_creation_history(mint TEXT PRIMARY KEY,before_signature TEXT,before_slot INTEGER,until_signature TEXT,until_slot INTEGER,oldest_candidate TEXT,oldest_candidate_slot INTEGER,next_attempt_at INTEGER NOT NULL,turns INTEGER NOT NULL DEFAULT 0,terminal INTEGER NOT NULL,last_reason TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS migration_deliveries(signature TEXT PRIMARY KEY,received_at INTEGER NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING');
   CREATE INDEX IF NOT EXISTS migration_deliveries_order ON migration_deliveries(state,received_at,signature);
   CREATE TABLE IF NOT EXISTS market_tokens(mint TEXT PRIMARY KEY,first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,last_activity_at INTEGER,activity_score REAL NOT NULL DEFAULT 0,screen_state TEXT NOT NULL DEFAULT 'UNAVAILABLE',activity_hints INTEGER NOT NULL DEFAULT 0,buy_hints INTEGER NOT NULL DEFAULT 0,sell_hints INTEGER NOT NULL DEFAULT 0,buy_lamports TEXT NOT NULL DEFAULT '0',sell_lamports TEXT NOT NULL DEFAULT '0',last_price REAL,screened_at INTEGER NOT NULL,last_signature TEXT,last_activity_source TEXT,last_activity_kind TEXT,last_economic_activity_at INTEGER);
   CREATE INDEX IF NOT EXISTS market_tokens_discovery ON market_tokens(first_seen_at,mint);
   CREATE INDEX IF NOT EXISTS market_tokens_activity ON market_tokens(last_activity_at DESC,activity_score DESC,mint);
   CREATE INDEX IF NOT EXISTS market_tokens_score ON market_tokens(activity_score DESC,last_activity_at DESC,mint);
   CREATE INDEX IF NOT EXISTS market_tokens_screen ON market_tokens(screen_state,mint);
   CREATE TABLE IF NOT EXISTS identity_provenance(mint TEXT NOT NULL,source TEXT NOT NULL,kind TEXT NOT NULL,pool TEXT NOT NULL DEFAULT '',signature TEXT NOT NULL DEFAULT '',first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,PRIMARY KEY(mint,source,kind,pool,signature));
   CREATE INDEX IF NOT EXISTS identity_provenance_recent_kind ON identity_provenance(kind,last_seen_at DESC,mint);
   CREATE INDEX IF NOT EXISTS identity_provenance_pool_progress ON identity_provenance(mint,pool,first_seen_at);
   CREATE TABLE IF NOT EXISTS watch_rows(signature TEXT PRIMARY KEY,mint TEXT,pool TEXT,migration_at INTEGER,verified_at INTEGER,first_seen_at INTEGER NOT NULL,state TEXT NOT NULL,last_activity_at INTEGER,last_demoted_at INTEGER,deep_since INTEGER,defer_until INTEGER NOT NULL,waiting_since INTEGER NOT NULL,promotions INTEGER NOT NULL,repromotions INTEGER NOT NULL,demotions INTEGER NOT NULL,complete_windows INTEGER NOT NULL,ever_had_window INTEGER NOT NULL,last_window_at INTEGER,older_research INTEGER NOT NULL,capacity_status TEXT,capacity_reassess_at INTEGER,technical_state TEXT,technical_expires_at INTEGER,technical_not_before INTEGER,technical_requested_at INTEGER,body TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0,last_decision_kind TEXT,last_decision_at INTEGER,reobserve_ready INTEGER NOT NULL DEFAULT 1);
   CREATE INDEX IF NOT EXISTS watch_rows_mint ON watch_rows(mint,archived,verified_at);
   CREATE INDEX IF NOT EXISTS watch_rows_mint_signature ON watch_rows(mint,signature);
   CREATE INDEX IF NOT EXISTS watch_rows_state ON watch_rows(archived,state,defer_until,waiting_since);
   CREATE INDEX IF NOT EXISTS watch_rows_age ON watch_rows(archived,migration_at,first_seen_at);
   CREATE INDEX IF NOT EXISTS watch_rows_capacity ON watch_rows(archived,capacity_status,capacity_reassess_at);
   CREATE INDEX IF NOT EXISTS watch_rows_technical ON watch_rows(archived,technical_state,technical_expires_at,technical_not_before);
   CREATE TABLE IF NOT EXISTS watch_aliases(alias TEXT PRIMARY KEY,signature TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS watch_history(id INTEGER PRIMARY KEY,signature TEXT NOT NULL,at INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS watch_history_signature ON watch_history(signature,at,id);
   CREATE TABLE IF NOT EXISTS watch_history_retirements(id INTEGER PRIMARY KEY,signature TEXT NOT NULL,at INTEGER NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64),retired_at INTEGER NOT NULL,mint TEXT NOT NULL,created_at INTEGER NOT NULL,policy TEXT NOT NULL,financial_history_complete INTEGER NOT NULL CHECK(financial_history_complete=1),obligations_absent INTEGER NOT NULL CHECK(obligations_absent=1));
   CREATE INDEX IF NOT EXISTS watch_history_retirements_signature ON watch_history_retirements(signature,at,id);
   CREATE TABLE IF NOT EXISTS candidate_retirements(signature TEXT PRIMARY KEY,mint TEXT NOT NULL,created_at INTEGER NOT NULL,retired_at INTEGER NOT NULL,policy TEXT NOT NULL,original_body_sha256 TEXT NOT NULL CHECK(length(original_body_sha256)=64));
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
  {const columns=new Set((this.statement('PRAGMA table_info(token_creation_history)').all() as {name:string}[]).map(r=>r.name));for(const [column,definition] of [['until_signature','TEXT'],['until_slot','INTEGER'],['turns','INTEGER NOT NULL DEFAULT 0']])if(!columns.has(column!))this.db.exec(`ALTER TABLE token_creation_history ADD COLUMN ${column} ${definition}`);}
  {const columns=new Set((this.statement('PRAGMA table_info(watch_rows)').all() as {name:string}[]).map(r=>r.name));for(const [column,definition] of [['last_decision_kind','TEXT'],['last_decision_at','INTEGER'],['reobserve_ready','INTEGER NOT NULL DEFAULT 1']])if(!columns.has(column!))this.db.exec(`ALTER TABLE watch_rows ADD COLUMN ${column} ${definition}`);this.db.exec('CREATE INDEX IF NOT EXISTS watch_rows_reobservation ON watch_rows(archived,state,reobserve_ready,defer_until,last_decision_at)');}
  {const columns=new Set((this.statement('PRAGMA table_info(market_activity_seen)').all() as {name:string}[]).map(r=>r.name));for(const [column,definition] of [['quote_lamports','TEXT'],['activity_sequence','INTEGER'],['pool','TEXT'],['sol_ui_price','REAL'],['hint_source','TEXT']])if(!columns.has(column!))this.db.exec(`ALTER TABLE market_activity_seen ADD COLUMN ${column} ${definition}`);this.db.exec('CREATE INDEX IF NOT EXISTS market_activity_seen_mint_time ON market_activity_seen(mint,first_seen_at);CREATE INDEX IF NOT EXISTS market_activity_seen_mint_sequence ON market_activity_seen(mint,activity_sequence);CREATE INDEX IF NOT EXISTS market_activity_seen_pool_progress ON market_activity_seen(mint,pool,first_seen_at)');}
  // Reporting reads the full current population from compact scalar/expression
  // indexes. Inactive history/body pages remain retained. These indexes are
  // maintained by SQLite in the same transaction as every row mutation, so a
  // report cannot reuse an older eligibility observation.
  // Selection has its own covering scalar/expression index, including the
  // signature needed for a single final body lookup; no source rows are copied.
  this.db.exec(`
   CREATE INDEX IF NOT EXISTS watch_rows_report_summary_v1 ON watch_rows(state,mint,pool,migration_at,verified_at,deep_since,last_decision_kind,reobserve_ready,capacity_status,defer_until,technical_state,technical_not_before,waiting_since,first_seen_at,ever_had_window,last_window_at,older_research,json_extract(body,'$.observationIdentity.basis'),json_extract(body,'$.observationIdentity.availableAt'),json_extract(body,'$.reobservation.ready.at')) WHERE archived=0;
   CREATE INDEX IF NOT EXISTS watch_rows_report_page_v1 ON watch_rows(CASE WHEN state IN ('HELD','ENTRY_PENDING','DEEP_OBSERVATION','QUALIFIED') THEN 0 ELSE 1 END,COALESCE(last_activity_at,first_seen_at) DESC,signature) WHERE archived=0;
   CREATE INDEX IF NOT EXISTS watch_rows_report_population_v2 ON watch_rows(state,last_decision_kind,reobserve_ready,verified_at,deep_since) WHERE archived=0;
   CREATE INDEX IF NOT EXISTS watch_rows_report_entry_age_v2 ON watch_rows(migration_at) WHERE archived=0 AND migration_at IS NOT NULL AND verified_at IS NOT NULL AND mint IS NOT NULL AND pool IS NOT NULL AND state NOT IN ('EXPIRED','PERMANENTLY_UNSUPPORTED');
   CREATE INDEX IF NOT EXISTS watch_rows_report_waiting_v2 ON watch_rows(COALESCE(migration_at,0)) WHERE archived=0 AND mint IS NOT NULL AND pool IS NOT NULL AND ((migration_at IS NOT NULL AND verified_at IS NOT NULL) OR json_extract(body,'$.observationIdentity.basis')='canonical-pool-hint') AND state IN ('WATCH','DEFERRED');
   CREATE INDEX IF NOT EXISTS watch_rows_opportunity_v1 ON watch_rows(state,reobserve_ready,defer_until,mint,pool,signature,waiting_since,first_seen_at,verified_at,migration_at,technical_state,technical_not_before,capacity_status,older_research,json_extract(body,'$.observationIdentity.basis'),json_extract(body,'$.observationIdentity.availableAt'),json_extract(body,'$.reobservation.ready.at')) WHERE archived=0;
   CREATE INDEX IF NOT EXISTS watch_rows_current_scope_v1 ON watch_rows(mint,first_seen_at,signature,verified_at,state,json_extract(body,'$.observationIdentity.basis')) WHERE archived=0;
   CREATE INDEX IF NOT EXISTS market_tokens_activity_hints_v1 ON market_tokens(last_activity_at,mint) WHERE activity_hints>0;
  `);
  if(this.getMetadata<number>('createdAt')===undefined)this.setMetadata('createdAt',this.clock());
  // One-time classification of retained nonfinancial hints. A canonical address
  // derived from a launch is deliberately insufficient: require actual venue,
  // migration, or successfully checked pool evidence. No financial rows change.
  if(this.getMetadata('pumpswap-hint-routing-v1')===undefined)this.transaction(()=>{
   this.statement("INSERT OR IGNORE INTO pumpswap_hint_tokens SELECT mint,MIN(first_seen_at) FROM identity_provenance WHERE kind='migration' GROUP BY mint").run();
   this.statement("INSERT OR IGNORE INTO pumpswap_hint_tokens SELECT mint,MIN(first_seen_at) FROM market_venue_hints WHERE venue='pump-amm' GROUP BY mint").run();
   this.statement("INSERT OR IGNORE INTO pumpswap_hint_tokens SELECT mint,checked_at FROM observation_preparations WHERE state='pool-ready'").run();
   this.setMetadata('pumpswap-hint-routing-v1',{at:this.clock(),meaning:'routing hints only; current pool validation remains mandatory'});
  });
  this.initializeActivityProjection();
  // The old page classifier could stop at an older address reference even
  // after retaining a potentially young successful transaction. Retry only
  // that exact refusal; every original cursor and candidate remains intact.
  const historyRecovery='token-creation-history-young-prefix-recovery-v1';
  if(this.getMetadata(historyRecovery)===undefined)this.transaction(()=>{
   if(this.getMetadata(historyRecovery)!==undefined)return;
   const at=this.clock(),requeued=this.statement("UPDATE token_creation_history SET terminal=0,next_attempt_at=? WHERE terminal=1 AND last_reason='TOKEN_CREATION_HISTORY_PRECEDES_24H' AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=token_creation_history.mint)").run(at).changes;
   this.setMetadata(historyRecovery,{at,requeued,cursorsRetained:true,reason:'TOKEN_CREATION_HISTORY_PRECEDES_24H',financialPermission:false});
  });
 }
 /** Rebuildable nonfinancial scheduling index. Source rows and their history
  * remain authoritative. Triggers share every source transaction, including
  * worker commits and rollbacks, so a lost ACK or restart cannot lose work.
  * A mint is ordered by its oldest pending eligible alias, then signature.
  * The former DISTINCT query left the choice among aliases planner-dependent.
  * Table creation is the version marker: schema, triggers and initial backfill
  * commit atomically; reopening an intake connection never repeats the scan. */
 private initializeActivityProjection():void {
  const eligible="w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED') AND t.last_activity_at>COALESCE(w.last_activity_at,-1)";
  const sources='watch_rows w INDEXED BY watch_rows_activity_mint_v1 JOIN market_tokens t ON t.mint=w.mint';
  const observed="EXISTS(SELECT 1 FROM watch_rows w INDEXED BY watch_rows_activity_mint_v1 WHERE w.mint=NEW.mint AND w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED'))";
  // Only fixed NEW/OLD column references enter these trigger templates.
  const refresh=(mint:'NEW.mint'|'OLD.mint')=>`
   DELETE FROM watch_activity_pending_v1 WHERE mint=${mint} AND NOT EXISTS(SELECT 1 FROM ${sources} WHERE w.mint=${mint} AND ${eligible});
   INSERT INTO watch_activity_pending_v1(mint,activity_at,watch_activity_at,signature,pumpswap_hint)
    SELECT w.mint,t.last_activity_at,COALESCE(w.last_activity_at,0),w.signature,EXISTS(SELECT 1 FROM pumpswap_hint_tokens swap WHERE swap.mint=w.mint)
    FROM ${sources} WHERE w.mint=${mint} AND ${eligible} ORDER BY COALESCE(w.last_activity_at,0),w.signature LIMIT 1
    ON CONFLICT(mint) DO UPDATE SET activity_at=excluded.activity_at,watch_activity_at=excluded.watch_activity_at,signature=excluded.signature,pumpswap_hint=excluded.pumpswap_hint
    WHERE activity_at IS NOT excluded.activity_at OR watch_activity_at IS NOT excluded.watch_activity_at OR signature IS NOT excluded.signature OR pumpswap_hint IS NOT excluded.pumpswap_hint;
  `;
  this.db.transaction(()=>{
   const initialize=!this.statement("SELECT 1 FROM sqlite_master WHERE type='table' AND name='watch_activity_pending_v1'").get();
   this.db.exec(`
    CREATE INDEX IF NOT EXISTS watch_rows_activity_mint_v1 ON watch_rows(mint,COALESCE(last_activity_at,0),signature,last_activity_at) WHERE archived=0 AND state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED');
    CREATE TABLE IF NOT EXISTS watch_activity_pending_v1(mint TEXT PRIMARY KEY,activity_at INTEGER NOT NULL,watch_activity_at INTEGER NOT NULL,signature TEXT NOT NULL,pumpswap_hint INTEGER NOT NULL CHECK(pumpswap_hint IN (0,1)));
    CREATE INDEX IF NOT EXISTS watch_activity_pending_order_v1 ON watch_activity_pending_v1(watch_activity_at,signature,mint,activity_at);
    CREATE INDEX IF NOT EXISTS watch_activity_pending_swap_order_v1 ON watch_activity_pending_v1(pumpswap_hint,watch_activity_at,signature,mint,activity_at);
    CREATE TRIGGER IF NOT EXISTS watch_activity_watch_insert_v1 AFTER INSERT ON watch_rows BEGIN ${refresh('NEW.mint')} END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_watch_update_v1 AFTER UPDATE OF signature,mint,last_activity_at,state,archived ON watch_rows WHEN OLD.signature IS NOT NEW.signature OR OLD.mint IS NOT NEW.mint OR OLD.last_activity_at IS NOT NEW.last_activity_at OR OLD.state IS NOT NEW.state OR OLD.archived IS NOT NEW.archived BEGIN ${refresh('NEW.mint')} END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_watch_move_v1 AFTER UPDATE OF mint ON watch_rows WHEN OLD.mint IS NOT NEW.mint BEGIN ${refresh('OLD.mint')} END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_watch_delete_v1 AFTER DELETE ON watch_rows BEGIN ${refresh('OLD.mint')} END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_market_insert_v1 AFTER INSERT ON market_tokens WHEN NEW.last_activity_at IS NOT NULL AND ${observed} BEGIN ${refresh('NEW.mint')} END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_market_update_v1 AFTER UPDATE OF mint,last_activity_at ON market_tokens WHEN (OLD.mint IS NOT NEW.mint OR OLD.last_activity_at IS NOT NEW.last_activity_at) AND ${observed} BEGIN ${refresh('NEW.mint')} END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_market_move_v1 AFTER UPDATE OF mint ON market_tokens WHEN OLD.mint IS NOT NEW.mint BEGIN DELETE FROM watch_activity_pending_v1 WHERE mint=OLD.mint; END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_market_delete_v1 AFTER DELETE ON market_tokens BEGIN DELETE FROM watch_activity_pending_v1 WHERE mint=OLD.mint; END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_venue_insert_v1 AFTER INSERT ON pumpswap_hint_tokens BEGIN UPDATE watch_activity_pending_v1 SET pumpswap_hint=1 WHERE mint=NEW.mint; END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_venue_delete_v1 AFTER DELETE ON pumpswap_hint_tokens BEGIN UPDATE watch_activity_pending_v1 SET pumpswap_hint=0 WHERE mint=OLD.mint; END;
    CREATE TRIGGER IF NOT EXISTS watch_activity_venue_move_v1 AFTER UPDATE OF mint ON pumpswap_hint_tokens WHEN OLD.mint IS NOT NEW.mint BEGIN UPDATE watch_activity_pending_v1 SET pumpswap_hint=0 WHERE mint=OLD.mint; UPDATE watch_activity_pending_v1 SET pumpswap_hint=1 WHERE mint=NEW.mint; END;
   `);
   if(initialize)this.db.exec(`INSERT OR IGNORE INTO watch_activity_pending_v1(mint,activity_at,watch_activity_at,signature,pumpswap_hint)
    SELECT w.mint,t.last_activity_at,COALESCE(w.last_activity_at,0),w.signature,EXISTS(SELECT 1 FROM pumpswap_hint_tokens swap WHERE swap.mint=w.mint)
    FROM ${sources} WHERE ${eligible} ORDER BY w.mint,COALESCE(w.last_activity_at,0),w.signature`);
  }).immediate();
 }
 private statement(sql:string):Database.Statement {let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}return statement;}
 private reportingIndex(index?:RegistryReportingIndex):string {if(index===undefined)return '';need(index==='watch_rows_report_summary_v1'||index==='watch_rows_report_page_v1'||index==='watch_rows_report_entry_age_v2'||index==='watch_rows_report_waiting_v2','MARKET_REGISTRY_REPORT_INDEX');return ' INDEXED BY '+index;}
 /** Shared scheduling hint only; SQLite remains the exclusive writer authority.
  * A worker yields between commits, never while a transaction is open. A main
  * request expires after one second so a paused/dead parent cannot stop intake. */
 writerTurnBuffer():SharedArrayBuffer|undefined{return this.writerTurn?.buffer as SharedArrayBuffer|undefined;}
 private requestWriterTurn(){if(!this.writerTurn||this.writerRole!=='main')return;Atomics.store(this.writerTurn,1,(performance.timeOrigin+performance.now()+1000)|0);if(Atomics.compareExchange(this.writerTurn,0,0,1)===0)this.writerRequests++;}
 private releaseWriterTurn(){if(!this.writerTurn||this.writerRole!=='main')return;const state=Atomics.exchange(this.writerTurn,0,0);if(state===2)this.writerTurns++;}
 deferToMainWriter():boolean{
  if(!this.writerTurn||this.writerRole!=='intake')return false;
  const state=Atomics.load(this.writerTurn,0);if(state===0)return false;
  const deadline=Atomics.load(this.writerTurn,1);if((((performance.timeOrigin+performance.now())|0)-deadline|0)>=0){if(Atomics.compareExchange(this.writerTurn,0,state,0)===state)this.writerExpiries++;return false;}
  if(state===1&&Atomics.compareExchange(this.writerTurn,0,1,2)===1)this.writerYields++;
  return Atomics.load(this.writerTurn,0)!==0;
 }
 /** Hooks are for bounded nonfinancial in-memory mirrors and subscription
  * ownership only. Nested callers share the outer commit/rollback boundary. */
 onRollback(undo:()=>void){if(this.readDepth||!this.transactionDepth)throw new MarketRegistryReadOnlyViolation('Rollback hook requires a write transaction');this.rollbackActions.push(undo);}
 afterCommit(action:()=>void){if(this.readDepth||!this.transactionDepth)throw new MarketRegistryReadOnlyViolation('Commit hook requires a write transaction');this.commitActions.push(action);}
 private write<T>(fn:()=>T):T {
  if(this.readDepth>0)throw new MarketRegistryReadOnlyViolation();
  if(this.transactionDepth>0)return fn();
  this.rollbackActions=[];this.commitActions=[];let result!:T;
  const priorReportingBaseline=this.reportingTransactionBaseline;this.reportingTransactionBaseline??=this.transactionCounters();
  this.economicTouchedMints.clear();this.transactionAttempts++;const start=performance.now();let committedAt:number|null=null,mutated=false,failed=false,callbackStarted=false,leaseContended=false;
  try{const transaction=this.db.transaction(()=>{callbackStarted=true;this.transactionDepth++;try{
   const before=Number((this.statement('SELECT total_changes() n').get() as {n:number}).n);
   const value=fn();const after=Number((this.statement('SELECT total_changes() n').get() as {n:number}).n);
   // Lookup/no-op watch operations are read transactions. Writing diagnostic
   // metadata here used to turn each global activity lookup into a FULL fsync.
   mutated=after!==before;if(mutated){committedAt=Math.max(this.clock(),this.getMetadata<number>('updatedAt')??0);
    this.statement('INSERT INTO registry_metadata(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run('updatedAt',json(committedAt));}return value;
  }finally{this.transactionDepth--;}});result=this.concurrentIntake?transaction.immediate():transaction();if(mutated){this.writeCommits++;this.storageAvailable=true;this.lastSuccessfulWriteAt=committedAt;}else{this.readOnlyCommits++;if(this.concurrentIntake)this.writerLeaseReadOnlyCommits++;}this.rollbackActions=[];
  }catch(error){const undo=this.rollbackActions.splice(0).reverse();this.commitActions=[];for(const restore of undo)restore();failed=true;this.failedTransactions++;const code=(error as {code?:unknown})?.code;if(this.concurrentIntake&&!callbackStarted&&typeof code==='string'&&/^(SQLITE_BUSY|SQLITE_LOCKED)(_|$)/.test(code)){this.contentionAttempts++;leaseContended=true;this.requestWriterTurn();throw new MarketRegistryContention(code);}if(typeof (error as {code?:unknown})?.code==='string'&&String((error as {code:string}).code).startsWith('SQLITE_')){this.storageFailures++;this.storageAvailable=false;this.lastFailureAt=this.clock();}throw error;
  }finally{if(!leaseContended)this.releaseWriterTurn();this.economicTouchedMints.clear();if(mutated||failed){const elapsed=performance.now()-start;this.writes++;this.writeTotalMs+=elapsed;this.writeMaximumMs=Math.max(this.writeMaximumMs,elapsed);}this.reportingTransactionBaseline=priorReportingBaseline;}
  // SQLite has committed and the lease is released. A post-commit callback
  // failure cannot undo the durable transaction or be retried as lease refusal.
  const committed=this.commitActions.splice(0);for(const action of committed)action();return result;
 }
 /** Synchronous, consistent deferred snapshot. It takes no writer lease,
  * cannot upgrade to a writer, never changes commit metadata, and never replays
  * its callback. A nested read scope temporarily guards an existing write scope. */
 readTransaction<T>(fn:()=>T):T {
  if(fn.constructor.name==='AsyncFunction')throw new MarketRegistryReadOnlyViolation('Read snapshot callbacks must be synchronous');
  if(this.readDepth>0)return fn();
  const priorQueryOnly=Number(this.db.pragma('query_only',{simple:true}));
  const run=()=>{const priorPopulation=this.reportingPopulation,priorVerification=this.reportingVerification;this.reportingPopulation=null;this.reportingVerification=new Map();this.readDepth++;try{const result=fn();if(result&&typeof (result as {then?:unknown}).then==='function')throw new MarketRegistryReadOnlyViolation('Read snapshot callbacks must be synchronous');return result;}catch(error){const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^SQLITE_READONLY(?:_|$)/.test(code))throw new MarketRegistryReadOnlyViolation();throw error;}finally{this.readDepth--;this.reportingPopulation=priorPopulation;this.reportingVerification=priorVerification;}};
  this.db.pragma('query_only = ON');
  try{
   if(this.transactionDepth>0)return run();
   const priorReportingBaseline=this.reportingTransactionBaseline;this.reportingTransactionBaseline??=this.transactionCounters();
   this.transactionAttempts++;try{const result=this.db.transaction(run).deferred();this.readOnlyCommits++;this.readSnapshotCommits++;return result;}
   catch(error){this.failedTransactions++;const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^SQLITE_READONLY(?:_|$)/.test(code))throw new MarketRegistryReadOnlyViolation();if(typeof code==='string'&&code.startsWith('SQLITE_')){this.storageFailures++;this.storageAvailable=false;this.lastFailureAt=this.clock();}throw error;}
   finally{this.reportingTransactionBaseline=priorReportingBaseline;}
  }finally{this.db.pragma('query_only = '+(priorQueryOnly?'ON':'OFF'));}
 }
 transaction<T>(fn:()=>T):T{return this.write(fn);}
 private transactionCounters():RegistryTransactionCounters{return {readSnapshotCommits:this.readSnapshotCommits,writerLeaseReadOnlyCommits:this.writerLeaseReadOnlyCommits,contentionBeforeCallback:this.contentionAttempts,attempted:this.transactionAttempts,readOnlyCommits:this.readOnlyCommits,writeCommits:this.writeCommits,failed:this.failedTransactions,fsyncEligibleCommits:this.writeCommits};}
 health(){return {writerCoordination:{requests:this.writerRequests,mainTurns:this.writerTurns,workerYields:this.writerYields,expired:this.writerExpiries,state:this.writerTurn?Atomics.load(this.writerTurn,0):null,scope:'NONFINANCIAL_LOCAL_SQLITE_WRITER_TURNS'},economicFlow:{cacheBytes:this.economicFlowCacheBytes,cacheEntries:this.economicFlowCache.size,hits:this.economicFlowCacheHits,coldQueries:this.economicFlowColdQueries,incrementalQueries:this.economicFlowIncrementalQueries},transactions:this.transactionCounters(),available:this.storageAvailable,lastFailureAt:this.lastFailureAt,lastSuccessfulWriteAt:this.lastSuccessfulWriteAt,storageFailures:this.storageFailures,maximumWriteMs:this.writeMaximumMs,meanWriteMs:this.writes?this.writeTotalMs/this.writes:0};}
 enqueueMigrationDelivery(seed:WatchSeed):boolean{return this.transaction(()=>{need(name(seed.signature)&&integer(seed.receivedAt)&&(seed.feedMint===undefined||name(seed.feedMint)),'MARKET_REGISTRY_MIGRATION_DELIVERY');return this.statement('INSERT OR IGNORE INTO migration_deliveries(signature,received_at,body) VALUES(?,?,?)').run(seed.signature,seed.receivedAt,json({signature:seed.signature,...(seed.feedMint===undefined?{}:{feedMint:seed.feedMint}),receivedAt:seed.receivedAt})).changes===1;});}
 nextMigrationDelivery():WatchSeed|undefined{const row=this.statement("SELECT body FROM migration_deliveries WHERE state='PENDING' ORDER BY received_at,signature LIMIT 1").get() as {body:string}|undefined;return row?JSON.parse(row.body) as WatchSeed:undefined;}
 completeMigrationDelivery(signature:string):void{this.transaction(()=>{need(name(signature),'MARKET_REGISTRY_MIGRATION_DELIVERY');this.statement("UPDATE migration_deliveries SET state='DELIVERED' WHERE signature=? AND state='PENDING'").run(signature);});}
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
 queryRows(q:RegistryQuery={}):WatchRow[]{const limit=q.limit??256;need(integer(limit)&&limit>0,'MARKET_REGISTRY_QUERY_LIMIT');const rows=this.statement(`SELECT w.body FROM watch_rows w${this.reportingIndex(q.index)} WHERE w.archived=0${q.where?` AND (${q.where})`:''} ORDER BY ${q.orderBy??'w.signature'} LIMIT ? OFFSET ?`).all(...(q.params??[]),limit,q.offset??0) as {body:string}[];return rows.map(r=>JSON.parse(r.body) as WatchRow);}
 /** Ranking only, after the caller's ordinary serviceability gates. Both equal
  * sixty-second flow windows use the available deduplicated broad-feed sequence,
  * never selected-callback counts. Unknown observations stay neutral. Ordinal
  * midranks include a neutral zero reference; their equal mean is an explicitly
  * uncalibrated scheduling heuristic, not a profit probability or entry rule. */
 nextOpportunity(q:RegistryQuery,at:number,readyAnchorSql:string,preparationWithTokenAge=false,preparedMintLookup=false):{row:WatchRow;hints:ObservationPriorityHints}|undefined{
  need(integer(at)&&(q.tokenAgeAt===undefined||q.tokenAgeAt===at),'MARKET_REGISTRY_OPPORTUNITY_TIME');
  // A prepared slot set is already bounded by the caller. Keep its exact mint
  // lookup instead of scanning the global population's defer-time range.
  // Ordinary age-qualified preparation starts from the current proof set;
  // retained unknown/expired WatchRows do not participate in its scan. Keep
  // every original caller predicate and all downstream ranking unchanged.
  const ageScoped=q.tokenAgeAt!==undefined&&!preparationWithTokenAge&&!preparedMintLookup,index=preparedMintLookup||ageScoped?'watch_rows_mint':'watch_rows_opportunity_v1';
  const from=ageScoped?`${this.admissionAgeTable} selection_age INDEXED BY ${this.admissionAgeIndex} CROSS JOIN watch_rows w INDEXED BY watch_rows_mint ON w.mint=selection_age.mint`:`watch_rows w INDEXED BY ${index}`;
  const scope=ageScoped?`selection_age.${this.admissionAgeColumn}<=? AND selection_age.${this.admissionAgeColumn}>=? AND selection_age.verified_at<=? AND `:'';
  const scopeParams=ageScoped?[at-this.admissionMinimumAgeMs,at-TOKEN_AGE_POLICY.maximumAgeMs,at]:[];
  if(!this.statement(`SELECT 1 FROM ${from} WHERE ${scope}w.archived=0${q.where?` AND (${q.where})`:''} LIMIT 1`).get(...scopeParams,...(q.params??[])))return undefined;
  const recent=at-SHARED_ACTIVITY_HORIZON_MS,prior=Math.max(0,at-2*SHARED_ACTIVITY_HORIZON_MS);
  // Preparation precedes immutable age verification. Prefer candidates that
  // already have valid age or can request its proof now, before work with no
  // current route to admission. The request predicates match the existing
  // creation dispatcher, except for the pool check this operation supplies.
  // Correlated indexed lookups stay inside this query; awareness and fallback
  // preparation remain intact, and economics still rank each feasible tier.
  const ageRoute=preparationWithTokenAge?`CASE
   WHEN EXISTS(SELECT 1 FROM token_creations preparation_age WHERE preparation_age.mint=w.mint AND preparation_age.created_at<=? AND preparation_age.created_at>=? AND preparation_age.verified_at<=?) THEN 2
   WHEN NOT EXISTS(SELECT 1 FROM token_creations existing_age WHERE existing_age.mint=w.mint)
    AND EXISTS(SELECT 1 FROM market_tokens preparation_token WHERE preparation_token.mint=w.mint
     AND (preparation_token.last_activity_at>=? AND preparation_token.last_activity_at<=?
      OR EXISTS(SELECT 1 FROM identity_provenance preparation_migration INDEXED BY identity_provenance_pool_progress WHERE preparation_migration.mint=w.mint AND preparation_migration.kind='migration' AND preparation_migration.last_seen_at>=? AND preparation_migration.last_seen_at<=?))
     AND EXISTS(SELECT 1 FROM identity_provenance preparation_birth LEFT JOIN token_creation_requests preparation_retry ON preparation_retry.mint=preparation_birth.mint AND preparation_retry.signature=preparation_birth.signature
      WHERE preparation_birth.mint=w.mint AND preparation_birth.kind='creation' AND preparation_birth.source IN ('pumpportal-new-token','finalized-mint-history') AND preparation_birth.signature!=''
       AND preparation_birth.first_seen_at>=? AND preparation_birth.first_seen_at<=?
       AND (preparation_retry.mint IS NULL OR (preparation_retry.terminal=0 AND preparation_retry.next_attempt_at<=?)))) THEN 1 ELSE 0 END`:'0';
  const ageParams=preparationWithTokenAge?[at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,recent,at,recent,at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at-this.admissionMinimumAgeMs,at]:[];
  // Materialize scalar eligibility once, preserving every current candidate.
  // Rank each distinct non-NULL value with its full population weight. This is
  // exactly RANK()-1-nullCount = count(smaller values); NULL stays neutral.
  // The wide candidate records no longer pass through each dimension's sort.
  const row=this.statement(`WITH eligible AS MATERIALIZED (
   SELECT w.signature,w.mint,w.pool,w.waiting_since,w.first_seen_at,MAX(0,?-(${readyAnchorSql})) serviceable_wait_ms,${ageRoute} preparation_age_route FROM ${from} WHERE ${scope}w.archived=0${q.where?` AND (${q.where})`:''}
  ),scoped_flow AS (
   SELECT a.mint,a.pool,a.hint_source,SUM(CASE WHEN a.first_seen_at>? AND a.quote_lamports IS NOT NULL THEN 1 ELSE 0 END) recent_known,
    SUM(CASE WHEN a.first_seen_at>? AND a.quote_lamports IS NOT NULL AND a.side='buy' THEN 1 ELSE 0 END) recent_buys,
    SUM(CASE WHEN a.first_seen_at>? AND a.quote_lamports IS NOT NULL AND a.side='sell' THEN 1 ELSE 0 END) recent_sells,
    SUM(CASE WHEN a.first_seen_at<=? AND a.quote_lamports IS NOT NULL THEN 1 ELSE 0 END) prior_known,
    SUM(CASE WHEN a.first_seen_at>? THEN CASE a.side WHEN 'buy' THEN CAST(a.quote_lamports AS REAL) WHEN 'sell' THEN -CAST(a.quote_lamports AS REAL) ELSE 0 END ELSE 0 END)/1e9 recent_net,
    SUM(CASE WHEN a.first_seen_at<=? THEN CASE a.side WHEN 'buy' THEN CAST(a.quote_lamports AS REAL) WHEN 'sell' THEN -CAST(a.quote_lamports AS REAL) ELSE 0 END ELSE 0 END)/1e9 prior_net,
    SUM(CASE WHEN a.first_seen_at>? THEN CAST(a.quote_lamports AS REAL) ELSE 0 END)/1e9 recent_gross
   FROM market_activity_seen a JOIN eligible e ON e.mint=a.mint WHERE a.first_seen_at>? AND a.first_seen_at<=? GROUP BY a.mint,a.pool,a.hint_source
  ),flow AS (
   SELECT mint,SUM(recent_known) recent_known,SUM(prior_known) prior_known,SUM(recent_net) recent_net,SUM(prior_net) prior_net,SUM(recent_gross) recent_gross FROM scoped_flow GROUP BY mint
  ),price_rows AS (
   SELECT a.mint,a.pool,a.hint_source,a.first_seen_at,a.signature,a.side,a.sol_ui_price,ROW_NUMBER() OVER(PARTITION BY a.mint,a.pool,a.hint_source ORDER BY a.first_seen_at,a.signature,a.side) first_rank,
    ROW_NUMBER() OVER(PARTITION BY a.mint,a.pool,a.hint_source ORDER BY a.first_seen_at DESC,a.signature DESC,a.side DESC) last_rank
   FROM market_activity_seen a JOIN eligible e ON e.mint=a.mint AND e.pool=a.pool WHERE a.first_seen_at>? AND a.first_seen_at<=? AND a.sol_ui_price IS NOT NULL AND a.hint_source IS NOT NULL
  ),prices AS (
   SELECT mint,pool,hint_source,MIN(first_seen_at) first_at,MAX(first_seen_at) last_at,
    MAX(CASE WHEN first_rank=1 THEN sol_ui_price END) first_price,MAX(CASE WHEN last_rank=1 THEN sol_ui_price END) last_price
   FROM price_rows GROUP BY mint,pool,hint_source
  ),latest_prices AS (
   SELECT *,ROW_NUMBER() OVER(PARTITION BY mint,pool ORDER BY last_at DESC,hint_source) source_rank FROM prices WHERE first_at<last_at
  ),observed AS (
   SELECT e.*,CASE WHEN f.recent_known>0 THEN f.recent_net END recent_net,CASE WHEN f.prior_known>0 THEN f.prior_net END prior_net,
    CASE WHEN f.recent_known>0 AND f.prior_known>0 THEN f.recent_net-f.prior_net END acceleration,
    CASE WHEN p.first_price>0 AND p.last_price>0 THEN p.last_price/p.first_price-1 END price_return,
    CASE WHEN sf.recent_known>0 AND sf.prior_known>0 THEN sf.recent_net-sf.prior_net END scoped_acceleration,
    CASE WHEN sf.recent_known>0 THEN sf.recent_net END scoped_net,sf.recent_gross,sf.recent_buys,sf.recent_sells,p.hint_source price_hint_source,p.first_at price_first_at,p.last_at price_last_at
   FROM eligible e LEFT JOIN flow f ON f.mint=e.mint LEFT JOIN latest_prices p ON p.mint=e.mint AND p.pool=e.pool AND p.source_rank=1 LEFT JOIN scoped_flow sf ON sf.mint=e.mint AND sf.pool=e.pool AND sf.hint_source=p.hint_source
  ),dimensions AS MATERIALIZED (
   SELECT *,CASE WHEN price_return IS NULL OR scoped_net IS NULL OR scoped_acceleration IS NULL THEN NULL
    WHEN price_return>0 AND scoped_acceleration<0 THEN -price_return WHEN price_return<0 AND scoped_net>0 THEN price_return ELSE 0 END price_agreement,
    CASE WHEN price_return IS NOT NULL AND recent_gross>0 AND recent_buys>0 AND recent_sells>0 THEN -ABS(price_return)/recent_gross END price_stability
   FROM observed
  ),dimension_values AS (
   SELECT 0 metric,recent_net value FROM dimensions WHERE recent_net IS NOT NULL
   UNION ALL SELECT 1,acceleration FROM dimensions WHERE acceleration IS NOT NULL
   UNION ALL SELECT 2,price_agreement FROM dimensions WHERE price_agreement IS NOT NULL
   UNION ALL SELECT 3,price_stability FROM dimensions WHERE price_stability IS NOT NULL
  ),dimension_counts AS (
   SELECT metric,value,COUNT(*) n FROM dimension_values GROUP BY metric,value
  ),ordinal_scores AS MATERIALIZED (
   SELECT metric,value,(COALESCE(SUM(n) OVER(PARTITION BY metric ORDER BY value ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)+n/2.0+CASE WHEN value>0 THEN 1.0 WHEN value=0 THEN 0.5 ELSE 0 END)/(SUM(n) OVER(PARTITION BY metric)+1.0) score FROM dimension_counts
  ),ranked AS MATERIALIZED (
   SELECT d.*,(COALESCE(n.score,0.5)+COALESCE(a.score,0.5)+COALESCE(p.score,0.5)+COALESCE(s.score,0.5))/4.0 economic_merit,CASE WHEN d.recent_net IS NULL THEN 0 ELSE 1 END current_evidence
   FROM dimensions d LEFT JOIN ordinal_scores n ON n.metric=0 AND n.value=d.recent_net LEFT JOIN ordinal_scores a ON a.metric=1 AND a.value=d.acceleration LEFT JOIN ordinal_scores p ON p.metric=2 AND p.value=d.price_agreement LEFT JOIN ordinal_scores s ON s.metric=3 AND s.value=d.price_stability
  ),leader AS (
   SELECT mint,economic_merit FROM ranked ORDER BY (preparation_age_route>0) DESC,current_evidence DESC,economic_merit DESC,waiting_since,first_seen_at,signature LIMIT 1
  ),selection AS (
   SELECT *,economic_merit+CASE WHEN current_evidence=1 THEN ${OPPORTUNITY_PRIORITY_POLICY.fairnessMaximum}*MIN(1.0,serviceable_wait_ms/${OPPORTUNITY_PRIORITY_POLICY.fairnessSaturationMs}.0) ELSE 0 END selection_priority FROM ranked
   ORDER BY (preparation_age_route>0) DESC,current_evidence DESC,selection_priority DESC,waiting_since,first_seen_at,signature LIMIT 1
  ) SELECT selection.*,selected.body,leader.mint economic_leader_mint,leader.economic_merit economic_leader_merit FROM selection CROSS JOIN leader JOIN watch_rows selected ON selected.signature=selection.signature`).get(at,...ageParams,...scopeParams,...(q.params??[]),recent,recent,recent,recent,recent,recent,recent,prior,at,recent,at) as {body:string;mint:string;preparation_age_route:number;recent_net:number|null;prior_net:number|null;acceleration:number|null;price_return:number|null;price_agreement:number|null;price_stability:number|null;recent_gross:number|null;pool:string;price_hint_source:string|null;price_first_at:number|null;price_last_at:number|null;serviceable_wait_ms:number;economic_merit:number;selection_priority:number;current_evidence:number;economic_leader_mint:string;economic_leader_merit:number}|undefined;
  return row?{row:JSON.parse(row.body) as WatchRow,hints:{version:'shared-flow-opportunity-priority-v2',horizonMs:SHARED_ACTIVITY_HORIZON_MS,recentNetSol:row.recent_net,priorNetSol:row.prior_net,netAccelerationSolPerMinute:row.acceleration,priceReturnBps:row.price_return===null?null:row.price_return*10000,priceDemandAgreement:row.price_agreement,priceMovePerGrossSol:row.price_return===null||!row.recent_gross?null:Math.abs(row.price_return)/row.recent_gross,twoSidedPriceStability:row.price_stability,priceScope:row.price_return===null?null:{pool:row.pool,source:row.price_hint_source!,firstAt:row.price_first_at!,lastAt:row.price_last_at!},serviceableWaitMs:row.serviceable_wait_ms,economicMerit:row.economic_merit,priority:row.selection_priority,hasCurrentEconomicEvidence:row.current_evidence===1,fairnessBonus:row.current_evidence===1?observationFairnessBonus(row.serviceable_wait_ms):0,economicLeaderMint:row.economic_leader_mint,economicLeaderMerit:row.economic_leader_merit,waitChangedWinner:row.mint!==row.economic_leader_mint,...(preparationWithTokenAge?{preparationAgeRoute:row.preparation_age_route===2?'verified-token-age' as const:row.preparation_age_route===1?'creation-request-available' as const:'creation-request-unavailable' as const}:{}),directLiquidity:'unknown',financialPermission:false}}:undefined;
 }
 count(where?:string,params:RegistryParameter[]=[]):number{return Number((this.statement(`SELECT COUNT(*) AS n FROM watch_rows w WHERE w.archived=0${where?` AND (${where})`:''}`).get(...params) as {n:number}).n);}
 private reportingRows(index?:RegistryReportingIndex,tokenAgeAt?:number){
  if(tokenAgeAt===undefined)return {from:`watch_rows w${this.reportingIndex(index)}`,where:'w.archived=0',bindings:[] as unknown[]};
  need(integer(tokenAgeAt),'MARKET_REGISTRY_REPORT_AGE');
  // A reporting population already requiring verified age can start with that
  // exact indexed population. Do not probe a creation row for every historical
  // watch identity. CROSS JOIN retains this small-to-large indexed lookup order.
  return {from:`${this.admissionAgeTable} report_age INDEXED BY ${this.admissionAgeIndex} CROSS JOIN watch_rows w INDEXED BY watch_rows_mint`,where:`report_age.${this.admissionAgeColumn}<=@poeReportAt-${this.admissionMinimumAgeMs} AND report_age.${this.admissionAgeColumn}>=@poeReportFloor AND report_age.verified_at<=@poeReportAt AND w.mint=report_age.mint AND w.archived=0`,bindings:[{poeReportAt:tokenAgeAt,poeReportFloor:tokenAgeAt-TOKEN_AGE_POLICY.maximumAgeMs}] as unknown[]};
 }
 aggregate(expressions:Record<string,string>,where?:string,params:RegistryParameter[]=[],index?:RegistryReportingIndex,tokenAgeAt?:number):Record<string,number|null>{need(Object.keys(expressions).every(k=>/^[A-Za-z][A-Za-z0-9_]*$/.test(k)),'MARKET_REGISTRY_AGGREGATE_ALIAS');const source=this.reportingRows(index,tokenAgeAt);return this.statement(`SELECT ${Object.entries(expressions).map(([key,expr])=>`${expr} AS ${key}`).join(',')} FROM ${source.from} WHERE ${source.where}${where?` AND (${where})`:''}`).get(...source.bindings,...params) as Record<string,number|null>;}
 /** Complete reporting-only state counts, shared only by one WAL snapshot. */
 watchReportingPopulation():Record<string,number>{
  return this.readTransaction(()=>{
   if(this.reportingPopulation)return {...this.reportingPopulation};
   // Only the complete state/verification totals need a population scan. The
   // narrow covering index also lets deep and dormant counts seek their own
   // states without evaluating several SUM predicates for every old identity.
   // All three queries remain inside this same current WAL snapshot.
   const groups=this.statement(`SELECT w.state,COUNT(*) n,COUNT(w.verified_at) verified
    FROM watch_rows w INDEXED BY watch_rows_report_population_v2 WHERE w.archived=0 GROUP BY w.state`).all() as Array<{state:string;n:number;verified:number}>;
   const result:Record<string,number>={known:0,watch:0,unverified:0,deep:0,unchangedEconomic:0,unchangedTechnical:0,tracked:0,awaitingDeep:0,deepObserving:0};
   for(const row of groups){result['state_'+row.state]=row.n;result.known!+=row.n;result.unverified!+=row.n-row.verified;
    if(!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state))result.tracked!+=row.n;
    if(['WATCH','DEFERRED'].includes(row.state)){result.watch!+=row.n;result.awaitingDeep!+=row.verified;}
    if(['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(row.state))result.deepObserving!+=row.n;
   }
   result.deep=(this.statement(`SELECT COUNT(w.deep_since) assigned FROM watch_rows w INDEXED BY watch_rows_report_population_v2
    WHERE w.archived=0 AND w.state IN ('DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING')`).get() as {assigned:number}).assigned;
   const dormant=this.statement(`SELECT w.state,w.last_decision_kind,COUNT(*) n FROM watch_rows w INDEXED BY watch_rows_report_population_v2
    WHERE w.archived=0 AND w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=0 AND w.last_decision_kind IN ('economic-rejection','technical-unavailable')
    GROUP BY w.state,w.last_decision_kind`).all() as Array<{state:string;last_decision_kind:'economic-rejection'|'technical-unavailable';n:number}>;
   for(const row of dormant)result[row.last_decision_kind==='economic-rejection'?'unchangedEconomic':'unchangedTechnical']!+=row.n;
   this.reportingPopulation=result;return {...result};
  });
 }

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
 verificationStats(at:number){const retained=this.reportingVerification?.get(at);if(retained)return {...retained};const r=this.statement("SELECT COUNT(*) pending,SUM(CASE WHEN not_before<=? THEN 1 ELSE 0 END) ready,MIN(received_at) oldestReceivedAt FROM verification_queue WHERE state='PENDING'").get(at) as {pending:number;ready:number|null;oldestReceivedAt:number|null};const value={...r,ready:r.ready??0,maxWaitMs:r.oldestReceivedAt===null?0:Math.max(0,at-r.oldestReceivedAt)};this.reportingVerification?.set(at,value);return {...value};}
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
  if(input.venue!==undefined){need(name(input.venue),'MARKET_REGISTRY_VENUE_HINT');this.statement('INSERT INTO market_venue_hints(mint,source,venue,pool,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?) ON CONFLICT(mint,source,venue,pool) DO UPDATE SET last_seen_at=MAX(last_seen_at,excluded.last_seen_at)').run(mint,input.source,input.venue,input.pool??'',at,at);}
  if(input.kind==='migration'||input.venue==='pump-amm')this.statement('INSERT OR IGNORE INTO pumpswap_hint_tokens(mint,first_seen_at) VALUES(?,?)').run(mint,at);
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
  // Only explicitly SOL-denominated amounts with UI-token units can form a
  // comparable same-pool price hint. Provider p.price has unspecified units.
  const tokenAmount=typeof input.tokenAmount==='string'&&input.tokenAmount.length<=128&&/^\d+(?:\.\d+)?$/.test(input.tokenAmount)?Number(input.tokenAmount):NaN;
  const derivedPrice=economic&&input.quoteMint==='So11111111111111111111111111111111111111112'&&input.pool&&tokenAmount>0&&Number.isFinite(tokenAmount)?Number(amount)/1e9/tokenAmount:NaN;
  const price=Number.isFinite(derivedPrice)&&derivedPrice>0?derivedPrice:null;
  if(input.signature&&this.statement('INSERT OR IGNORE INTO market_activity_seen(mint,signature,side,first_seen_at,quote_lamports,activity_sequence,pool,sol_ui_price,hint_source) VALUES(?,?,?,?,?,?,?,?,?)').run(input.mint,input.signature,side,at,economic?amount.toString():null,r.activity_hints+1,input.pool??null,price,input.source).changes===0)return false;
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
 valueSummary(query:{expression:string;where?:string;params?:RegistryParameter[];index?:RegistryReportingIndex;tokenAgeAt?:number}):RegistryMetricSummary {
  const rows=this.reportingRows(query.index,query.tokenAgeAt),source=`SELECT (${query.expression}) value FROM ${rows.from} WHERE ${rows.where}${query.where?` AND (${query.where})`:''}`;
  // Evaluate the same current population once. Exact nearest-rank quantiles
  // share its single ordered window; NULL sorting/counting and Number(NULL)
  // retain the established public summary semantics. No cross-report cache.
  const row=this.statement(`WITH sample AS MATERIALIZED (${source}),ranked AS (
   SELECT value,ROW_NUMBER() OVER(ORDER BY value) position,COUNT(*) OVER() count,
    SUM(value) OVER() total,AVG(value) OVER() mean,MAX(value) OVER() maximum FROM sample
  ) SELECT COUNT(*) count,COALESCE(MAX(total),0) sum,MAX(mean) mean,MAX(maximum) max,
   MAX(CASE WHEN position=(count+1)/2 THEN value END) p50,
   MAX(CASE WHEN position=(count*95+99)/100 THEN value END) p95 FROM ranked`).get(...rows.bindings,...(query.params??[])) as RegistryMetricSummary;
  return {...row,p50:row.count?Number(row.p50):null,p95:row.count?Number(row.p95):null};
 }
 nextWatchActivities(limit=16,pumpswapOnly=false,at?:number):{mint:string;at:number;evidence:'unverified-provider-activity-hint'}[]{
  need(integer(limit)&&limit>0&&(at===undefined||integer(at)),'MARKET_REGISTRY_ACTIVITY_BATCH');
  // In the configured target market, start with the indexed young-proof set.
  // Old and unverified retained hints cannot make a no-work lookup scan the
  // historical population or consume a main-thread writer turn.
  const rows=at===undefined?this.statement(`SELECT mint,activity_at at FROM watch_activity_pending_v1 INDEXED BY ${pumpswapOnly?'watch_activity_pending_swap_order_v1':'watch_activity_pending_order_v1'} ${pumpswapOnly?'WHERE pumpswap_hint=1':''} ORDER BY watch_activity_at,signature LIMIT ?`).all(limit):this.statement(`SELECT pending.mint,pending.activity_at at
   FROM ${this.admissionAgeTable} age INDEXED BY ${this.admissionAgeIndex} CROSS JOIN watch_activity_pending_v1 pending ON pending.mint=age.mint
   WHERE age.${this.admissionAgeColumn}>=? AND age.${this.admissionAgeColumn}<=? AND age.verified_at<=? AND pending.activity_at<=? ${pumpswapOnly?'AND pending.pumpswap_hint=1':''}
   ORDER BY pending.watch_activity_at,pending.signature LIMIT ?`).all(Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at-this.admissionMinimumAgeMs,at,at,limit);
  return (rows as {mint:string;at:number}[]).map(r=>({...r,evidence:'unverified-provider-activity-hint' as const}));
 }
 /** First receipt of new content is source progress; repeated delivery time
  * is not. A matching provider pool hint schedules another strict account
  * check, never establishes that the account exists or is executable. */
 canonicalPoolHintAfter(mint:string,pool:string,after:number,at=this.clock()):{at:number;fingerprint:string}|undefined{
  need(name(mint)&&name(pool)&&integer(after)&&integer(at)&&after<=at,'MARKET_REGISTRY_POOL_HINT_PROGRESS');
  const row=this.statement("SELECT source,kind,pool,signature,first_seen_at at FROM identity_provenance WHERE mint=? AND pool=? AND first_seen_at>? AND first_seen_at<=? UNION ALL SELECT 'shared-activity' source,'activity' kind,pool,signature,first_seen_at at FROM market_activity_seen WHERE mint=? AND pool=? AND first_seen_at>? AND first_seen_at<=? ORDER BY at,source,kind,signature LIMIT 1").get(mint,pool,after,at,mint,pool,after,at) as {source:string;kind:string;pool:string;signature:string;at:number}|undefined;
  return row?{at:row.at,fingerprint:createHash('sha256').update(json([row.source,row.kind,row.pool,row.signature])).digest('hex')}:undefined;
 }
 nextPoolSourceProgress(at:number,limit=16):{mint:string}[]{
  need(integer(at)&&integer(limit)&&limit>0,'MARKET_REGISTRY_POOL_HINT_PROGRESS');
  return this.statement(`SELECT w.mint FROM watch_rows w WHERE w.archived=0 AND w.state IN ('WATCH','DEFERRED') AND w.reobserve_ready=0 AND w.last_decision_kind='technical-unavailable' AND json_extract(w.body,'$.reobservation.windowEndAt') IS NULL AND w.mint IS NOT NULL AND w.pool IS NOT NULL AND (EXISTS(SELECT 1 FROM identity_provenance p WHERE p.mint=w.mint AND p.pool=w.pool AND p.first_seen_at>w.last_decision_at AND p.first_seen_at<=?) OR EXISTS(SELECT 1 FROM market_activity_seen a WHERE a.mint=w.mint AND a.pool=w.pool AND a.first_seen_at>w.last_decision_at AND a.first_seen_at<=?)) ORDER BY w.last_decision_at,w.signature LIMIT ?`).all(at,at,limit) as {mint:string}[];
 }
 /** Current observation selects actual retained mint hints, without needing a
  * transaction signature or creation archive. The SDK still has to establish
  * the canonical pool's existence and supported account state. */
 nextObservationCandidate(at:number,enforceTokenAge24h=false,pumpswapOnly=false):{mint:string;signature:string;receivedAt:number;activityAt:number|null;source:string;priority:number}|undefined {
  need(integer(at),'MARKET_REGISTRY_OBSERVATION_TIME');
  // This mint-only exclusion distributes over both UNION inputs. Apply it
  // before materializing/sorting current hints, using compact scalar entries
  // instead of rereading every retained watch-history body on each turn.
  const unobserved=(mint:'market_tokens.mint'|'identity_provenance.mint')=>`NOT EXISTS(SELECT 1 FROM watch_rows w INDEXED BY watch_rows_current_scope_v1 WHERE w.mint=${mint} AND w.archived=0 AND (w.verified_at IS NOT NULL OR json_extract(w.body,'$.observationIdentity.basis')='canonical-pool-hint' OR w.state IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED')))`;
  return this.statement(`${enforceTokenAge24h?`WITH age_scope AS MATERIALIZED (SELECT mint FROM ${this.admissionAgeTable} INDEXED BY ${this.admissionAgeIndex} WHERE ${this.admissionAgeColumn}>=? AND ${this.admissionAgeColumn}<=? AND verified_at<=?),`:'WITH'} hints AS (
   SELECT market_tokens.mint,last_activity_at received_at FROM ${enforceTokenAge24h?'age_scope scope CROSS JOIN market_tokens ON market_tokens.mint=scope.mint':'market_tokens INDEXED BY market_tokens_activity_hints_v1'} WHERE last_activity_at>=? AND last_activity_at<=? AND activity_hints>0 AND ${unobserved('market_tokens.mint')}
   UNION
   SELECT identity_provenance.mint,MAX(last_seen_at) received_at FROM ${enforceTokenAge24h?'age_scope scope CROSS JOIN identity_provenance ON identity_provenance.mint=scope.mint':'identity_provenance'} WHERE kind='migration' AND last_seen_at>=? AND last_seen_at<=? AND ${unobserved('identity_provenance.mint')} GROUP BY identity_provenance.mint
  ) SELECT t.mint,
   COALESCE((SELECT w.signature FROM watch_rows w INDEXED BY watch_rows_current_scope_v1 WHERE w.archived=0 AND w.mint=t.mint ORDER BY w.first_seen_at,w.signature LIMIT 1),(SELECT w.signature FROM verification_queue q JOIN watch_rows w ON w.signature=q.signature WHERE q.feed_mint=t.mint AND w.archived=0 ORDER BY q.received_at,q.signature LIMIT 1),t.last_signature,'current-pool:'||t.mint) signature,
   hints.received_at receivedAt,t.last_activity_at activityAt,COALESCE(t.last_activity_source,'retained-market-identity') source,t.activity_score priority FROM hints JOIN market_tokens t ON t.mint=hints.mint
   WHERE (t.last_activity_at IS NULL OR t.last_activity_at<=?)
    ${pumpswapOnly?'AND EXISTS(SELECT 1 FROM pumpswap_hint_tokens swap WHERE swap.mint=t.mint)':''}
   AND NOT EXISTS(SELECT 1 FROM distinct_events d WHERE d.kind='native-current-hint-invalid' AND d.key=t.mint)
   ORDER BY t.activity_score DESC,hints.received_at DESC,t.mint LIMIT 1`).get(...(enforceTokenAge24h?[Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at-this.admissionMinimumAgeMs,at]:[]),at-SHARED_ACTIVITY_HORIZON_MS,at,at-SHARED_ACTIVITY_HORIZON_MS,at,at) as {mint:string;signature:string;receivedAt:number;activityAt:number|null;source:string;priority:number}|undefined;
 }
 /** Durable routing hints remain explicitly unverified; they never replace
  * current canonical account validation, token age, or execution adapters. */
 venueHints(mint:string){return (this.statement('SELECT source,venue,pool,first_seen_at firstSeenAt,last_seen_at lastSeenAt FROM market_venue_hints WHERE mint=? ORDER BY last_seen_at DESC,source,venue,pool').all(mint) as Array<{source:string;venue:string;pool:string;firstSeenAt:number;lastSeenAt:number}>).map(row=>({...row,verified:false as const}));}
 /** Minimal pre-admission identification. Unknown-age PumpSwap traffic is
  * coalesced here without recording economic activity, general identities,
  * migration provenance or watch rows. Source receipt time is never refreshed
  * by a retry, pool check, history response or publication. */
 observePumpSwapQualificationHint(hint:PumpSwapQualificationHint):boolean{return this.transaction(()=>{
  need(name(hint.mint)&&integer(hint.receivedAt)&&(hint.signature===undefined||name(hint.signature))&&(hint.source==='pumpportal-migration'&&hint.kind==='migration'||hint.source==='pumpapi-broad'&&hint.kind==='activity'&&hint.venue==='pump-amm'),'PUMPSWAP_QUALIFICATION_HINT_INVALID');
  if(this.migrationAge&&hint.signature){
   this.statement(`INSERT INTO pumpswap_migration_requests_v1(mint,signature,received_at,direct) VALUES(?,?,?,?)
    ON CONFLICT(mint) DO UPDATE SET signature=CASE WHEN excluded.direct>direct THEN excluded.signature ELSE signature END,
     received_at=CASE WHEN excluded.direct>direct THEN excluded.received_at ELSE received_at END,
     next_attempt_at=CASE WHEN excluded.direct>direct THEN 0 ELSE next_attempt_at END,direct=MAX(direct,excluded.direct)`)
    .run(hint.mint,hint.signature,hint.receivedAt,hint.kind==='migration'?1:0);
  }
  if(!this.migrationAge&&this.statement('SELECT 1 FROM token_creations WHERE mint=?').get(hint.mint))return false;
  return this.statement(`INSERT INTO pumpswap_qualification_hints_v1(mint,first_seen_at,last_seen_at,source,kind,signature) VALUES(?,?,?,?,?,?)
   ON CONFLICT(mint) DO UPDATE SET last_seen_at=excluded.last_seen_at,source=excluded.source,kind=excluded.kind,signature=excluded.signature
   WHERE excluded.last_seen_at>pumpswap_qualification_hints_v1.last_seen_at`).run(hint.mint,hint.receivedAt,hint.receivedAt,hint.source,hint.kind,hint.signature??null).changes===1;
 });}
 pumpSwapQualificationHint(mint:string):PumpSwapQualificationRecord|undefined{
  return this.statement('SELECT mint,first_seen_at firstSeenAt,last_seen_at lastSeenAt,source,kind,signature FROM pumpswap_qualification_hints_v1 WHERE mint=?').get(mint) as PumpSwapQualificationRecord|undefined;
 }
 private qualificationExclusion(excludedMints?:ReadonlySet<string>){
  const params=[...(excludedMints??[])];need(params.every(name),'PUMPSWAP_QUALIFICATION_EXCLUSIONS');
  // Qualification belongs upstream of deep observation and financial work,
  // including after restart when the caller's in-memory exclusions are empty.
  // A covering mint lookup also sees any protected alias of the same token.
  // promoted_at remains an admission receipt, not a permanent ban on repairing
  // missing proof for a now-inactive identity with a fresh real venue receipt.
  const active=" AND NOT EXISTS(SELECT 1 FROM watch_rows scope INDEXED BY watch_rows_current_scope_v1 WHERE scope.mint=q.mint AND scope.archived=0 AND scope.state IN ('DEEP_OBSERVATION','QUALIFIED','HELD','ENTRY_PENDING'))";
  return {where:active+(params.length?' AND q.mint NOT IN ('+params.map(()=>'?').join(',')+')':''),params};
 }
 /** Pool qualification is preliminary work in the existing request budget.
  * Negative account results require a genuinely newer venue receipt; provider
  * or dispatch failures keep the existing one-minute retry interval. */
 nextPumpSwapQualification(at:number,excludedMints?:ReadonlySet<string>):PumpSwapQualificationRecord|undefined{
  need(integer(at),'PUMPSWAP_QUALIFICATION_TIME');const excluded=this.qualificationExclusion(excludedMints);return this.statement(`SELECT q.mint,q.first_seen_at firstSeenAt,q.last_seen_at lastSeenAt,q.source,q.kind,q.signature
   FROM pumpswap_qualification_hints_v1 q INDEXED BY pumpswap_qualification_recent_v1
   WHERE q.pool_state IN ('unprepared','pool-absent','pool-unsupported','provider-unavailable','awaiting-dispatch') AND q.last_seen_at>=? AND q.last_seen_at<=?
    AND ${this.migrationAge?this.admissionAgeSql('q.mint',String(at)):'NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=q.mint)'}
    AND (q.pool_state='unprepared' OR q.pool_state IN ('pool-absent','pool-unsupported') AND q.last_seen_at>q.pool_checked_at OR q.pool_state IN ('provider-unavailable','awaiting-dispatch') AND q.pool_checked_at<=?)${excluded.where}
   ORDER BY COALESCE(q.pool_checked_at,q.first_seen_at),q.first_seen_at,q.mint LIMIT 1`).get(Math.max(0,at-SHARED_ACTIVITY_HORIZON_MS),at,at-60_000,...excluded.params) as PumpSwapQualificationRecord|undefined;
 }
 /** Once birth is proven, a fresh real venue receipt may introduce a minimal
  * ordinary identity. Prior unqualified price/volume/trades are never replayed. */
 nextQualifiedPumpSwapIdentity(at:number,excludedMints?:ReadonlySet<string>):PumpSwapQualificationRecord|undefined{
  need(integer(at),'PUMPSWAP_QUALIFICATION_TIME');const excluded=this.qualificationExclusion(excludedMints);return this.statement(`SELECT q.mint,q.first_seen_at firstSeenAt,q.last_seen_at lastSeenAt,q.source,q.kind,q.signature
   FROM ${this.admissionAgeTable} age INDEXED BY ${this.admissionAgeIndex} CROSS JOIN pumpswap_qualification_hints_v1 q ON q.mint=age.mint
   WHERE age.${this.admissionAgeColumn}>=? AND age.${this.admissionAgeColumn}<=? AND age.verified_at<=? AND q.promoted_at IS NULL AND q.pool_state='pool-ready' AND q.last_seen_at>=? AND q.last_seen_at<=?
    AND EXISTS(SELECT 1 FROM observation_preparations p WHERE p.mint=q.mint AND p.state='pool-ready' AND p.checked_at=q.pool_checked_at)${excluded.where}
   ORDER BY q.first_seen_at,q.mint LIMIT 1`).get(Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at-this.admissionMinimumAgeMs,at,Math.max(0,at-SHARED_ACTIVITY_HORIZON_MS),at,...excluded.params) as PumpSwapQualificationRecord|undefined;
 }
 markPumpSwapQualificationPromoted(mint:string,at:number):boolean{return this.transaction(()=>{
  need(name(mint)&&integer(at),'PUMPSWAP_QUALIFICATION_TIME');if(!this.marketAgeEligibility(mint,at).allowed)return false;
  return this.statement(`UPDATE pumpswap_qualification_hints_v1 SET promoted_at=? WHERE mint=? AND promoted_at IS NULL AND pool_state='pool-ready' AND last_seen_at>=? AND last_seen_at<=?`).run(at,mint,Math.max(0,at-SHARED_ACTIVITY_HORIZON_MS),at).changes===1;
 });}
 putObservationPreparation(row:ObservationPreparation){this.write(()=>{need(name(row.mint)&&name(row.pool)&&integer(row.checkedAt)&&['pool-ready','pool-absent','pool-unsupported','provider-unavailable','awaiting-dispatch'].includes(row.state)&&name(row.reason)&&(row.sourceSlot===undefined||integer(row.sourceSlot)),'MARKET_OBSERVATION_PREPARATION');this.statement('INSERT INTO observation_preparations(mint,pool,checked_at,state,reason,source_slot) VALUES(?,?,?,?,?,?) ON CONFLICT(mint) DO UPDATE SET pool=excluded.pool,checked_at=excluded.checked_at,state=excluded.state,reason=excluded.reason,source_slot=excluded.source_slot').run(row.mint,row.pool,row.checkedAt,row.state,row.reason,row.sourceSlot??null);if(row.state==='pool-ready')this.statement('INSERT OR IGNORE INTO pumpswap_hint_tokens(mint,first_seen_at) VALUES(?,?)').run(row.mint,row.checkedAt);});}
 observationPreparation(mint:string):ObservationPreparation|undefined {const row=this.statement('SELECT mint,pool,checked_at checkedAt,state,reason,source_slot sourceSlot FROM observation_preparations WHERE mint=?').get(mint) as ObservationPreparation|undefined;return row?{...row,...(row.sourceSlot===null?{sourceSlot:undefined}:{})}:undefined;}
 /** Select the owner-approved live age basis without mutating old evidence. */
 useMigrationAge(){this.migrationAge=true;}
 get admissionAgeTable(){return this.migrationAge?'pumpswap_migration_ages_v1':'token_creations';}
 get admissionAgeIndex(){return this.migrationAge?'pumpswap_migration_ages_time_v1':'token_creations_age';}
 get admissionAgeColumn(){return this.migrationAge?'migrated_at':'created_at';}
 get admissionMinimumAgeMs(){return this.migrationAge?MIGRATION_AGE_POLICY.minimumAgeMs:0;}
 admissionAgeSql(mint:string,at:string){return `EXISTS(SELECT 1 FROM ${this.admissionAgeTable} age WHERE age.mint=${mint} AND age.${this.admissionAgeColumn}<=${at}-${this.admissionMinimumAgeMs} AND age.${this.admissionAgeColumn}>=${at}-${MIGRATION_AGE_POLICY.maximumAgeMs} AND age.verified_at<=${at})`;}
 marketAgeEligibility(mint:string,at:number){return this.migrationAge?migrationAgeDecision(mint,at,this.migrationAgeProof(mint)):this.tokenAgeEligibility(mint,at);}
 migrationAgeProof(mint:string):MigrationAgeProof|null{
  const row=this.statement('SELECT migrated_at,verified_at,proof FROM pumpswap_migration_ages_v1 WHERE mint=?').get(mint) as {migrated_at:number;verified_at:number;proof:string}|undefined;if(!row)return null;
  const proof:unknown=JSON.parse(row.proof);need(validMigrationAgeProof(proof)&&proof.mint===mint&&proof.migrationAt===row.migrated_at&&proof.availableAt===row.verified_at,'MIGRATION_AGE_STORED_PROOF_INVALID');return proof;
 }
 migrationAgeProofSnapshot(at:number):readonly MigrationAgeProof[]{
  need(integer(at),'MIGRATION_AGE_SCOPE_TIME');
  const rows=this.statement('SELECT mint FROM pumpswap_migration_ages_v1 WHERE verified_at<=? ORDER BY migrated_at,mint').all(at) as {mint:string}[];
  return Object.freeze(rows.map(row=>Object.freeze(this.migrationAgeProof(row.mint)!)));
 }
 onMigrationAgeProofCommitted(listener:(proof:Readonly<MigrationAgeProof>)=>void){this.migrationAgeProofListeners.add(listener);return()=>{this.migrationAgeProofListeners.delete(listener);};}
 putMigrationAgeProof(proof:MigrationAgeProof){this.transaction(()=>{
  need(validMigrationAgeProof(proof)&&proof.availableAt<=this.clock(),'MIGRATION_AGE_PROOF_INVALID');const old=this.migrationAgeProof(proof.mint);
  need(!old||old.signature===proof.signature&&old.pool===proof.pool&&old.slot===proof.slot&&old.migrationAt===proof.migrationAt&&old.confirmedTransactionSha256===proof.confirmedTransactionSha256&&old.finalizedTransactionSha256===proof.finalizedTransactionSha256,'MIGRATION_AGE_PROOF_CONFLICT');
  const saved=Object.freeze({...proof}),inserted=this.statement('INSERT OR IGNORE INTO pumpswap_migration_ages_v1(mint,migrated_at,verified_at,proof) VALUES(?,?,?,?)').run(saved.mint,saved.migrationAt,saved.availableAt,json(saved)).changes===1;
  if(inserted){this.statement('UPDATE pumpswap_qualification_hints_v1 SET promoted_at=NULL WHERE mint=?').run(saved.mint);this.afterCommit(()=>{for(const listener of this.migrationAgeProofListeners)listener(saved);});}
 });}
 nextMigrationAgeRequest(at:number,excludedMints?:ReadonlySet<string>):WatchSeed|undefined{
  need(integer(at),'MIGRATION_AGE_REQUEST_TIME');const excluded=this.qualificationExclusion(excludedMints);
  return this.statement(`SELECT r.signature,r.mint feedMint,r.received_at receivedAt FROM pumpswap_migration_requests_v1 r
   JOIN pumpswap_qualification_hints_v1 q ON q.mint=r.mint
   WHERE r.next_attempt_at<=? AND r.received_at<=? AND (r.direct=1 AND r.received_at>=? OR q.last_seen_at>=?)
    AND NOT EXISTS(SELECT 1 FROM pumpswap_migration_ages_v1 age WHERE age.mint=r.mint)${excluded.where}
   ORDER BY r.direct DESC,r.next_attempt_at,r.received_at,r.mint LIMIT 1`).get(at,at,Math.max(0,at-MIGRATION_AGE_POLICY.maximumAgeMs),Math.max(0,at-SHARED_ACTIVITY_HORIZON_MS),...excluded.params) as WatchSeed|undefined;
 }
 deferMigrationAgeRequest(seed:WatchSeed,at:number,reason:string){this.write(()=>{need(name(seed.feedMint)&&name(seed.signature)&&integer(at)&&name(reason),'MIGRATION_AGE_REQUEST_INVALID');this.statement('UPDATE pumpswap_migration_requests_v1 SET next_attempt_at=?,attempts=attempts+1,last_reason=? WHERE mint=? AND signature=?').run(at+60_000,reason,seed.feedMint,seed.signature);});}
 migrationAgeSummary(at:number){
  need(integer(at),'MIGRATION_AGE_SCOPE_TIME');const counts=this.statement(`SELECT COUNT(*) verified,SUM(CASE WHEN migrated_at<=? AND migrated_at>=? AND verified_at<=? THEN 1 ELSE 0 END) eligible,SUM(CASE WHEN migrated_at>? THEN 1 ELSE 0 END) tooYoung,SUM(CASE WHEN migrated_at<? THEN 1 ELSE 0 END) expired FROM pumpswap_migration_ages_v1`).get(at-MIGRATION_AGE_POLICY.minimumAgeMs,at-MIGRATION_AGE_POLICY.maximumAgeMs,at,at-MIGRATION_AGE_POLICY.minimumAgeMs,at-MIGRATION_AGE_POLICY.maximumAgeMs) as Record<string,number|null>;
  const pending=this.statement('SELECT COUNT(*) n FROM pumpswap_migration_requests_v1 r WHERE NOT EXISTS(SELECT 1 FROM pumpswap_migration_ages_v1 p WHERE p.mint=r.mint)').get() as {n:number};
  return {...MIGRATION_AGE_POLICY,verified:counts.verified??0,eligible:counts.eligible??0,tooYoung:counts.tooYoung??0,expired:counts.expired??0,pendingVerification:pending.n};
 }
 tokenCreationProof(mint:string):TokenCreationProof|null{
  const row=this.statement('SELECT created_at,verified_at,proof FROM token_creations WHERE mint=?').get(mint) as {created_at:number;verified_at:number;proof:string}|undefined;if(!row)return null;
  const proof:unknown=JSON.parse(row.proof);need(validTokenCreationProof(proof)&&proof.mint===mint&&proof.createdAt===row.created_at&&proof.availableAt===row.verified_at,'TOKEN_CREATION_STORED_PROOF_INVALID');return proof;
 }
 /** Load the small current admission set once. Scalar indexes only locate
  * candidates; every stored proof and its scalar binding is validated before
  * it can enter a feed cache. Migration/discovery time is never an age basis. */
 tokenCreationScopeSnapshot(at:number,includeExpired=false):readonly TokenCreationScopeEntry[]{
  need(integer(at)&&typeof includeExpired==='boolean','TOKEN_CREATION_SCOPE_TIME');
  const rows=this.statement('SELECT mint,created_at,verified_at,proof FROM token_creations INDEXED BY token_creations_age WHERE created_at>=? AND created_at<=? AND verified_at<=? ORDER BY created_at,mint').all(includeExpired?0:Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,at) as Array<{mint:string;created_at:number;verified_at:number;proof:string}>;
  return Object.freeze(rows.map(row=>{const proof:unknown=JSON.parse(row.proof);need(validTokenCreationProof(proof)&&proof.mint===row.mint&&proof.createdAt===row.created_at&&proof.availableAt===row.verified_at,'TOKEN_CREATION_STORED_PROOF_INVALID');return Object.freeze({mint:proof.mint,createdAt:proof.createdAt,availableAt:proof.availableAt,expiresAt:proof.createdAt+TOKEN_AGE_POLICY.maximumAgeMs});}));
 }
 /** Mirrors are updated only after the outer SQLite commit. A failed or
  * rolled-back write never makes a mint appear qualified in feed memory. */
 onTokenCreationProofCommitted(listener:(proof:Readonly<TokenCreationProof>)=>void):()=>void{
  this.tokenCreationProofListeners.add(listener);return()=>{this.tokenCreationProofListeners.delete(listener);};
 }
 tokenAgeEligibility(mint:string,at:number){return tokenAgeDecision(mint,at,this.tokenCreationProof(mint));}
 putTokenCreationProof(proof:TokenCreationProof){this.transaction(()=>{
  need(validTokenCreationProof(proof)&&proof.availableAt<=this.clock(),'TOKEN_CREATION_PROOF_INVALID');const old=this.tokenCreationProof(proof.mint);
  need(!old||old.signature===proof.signature&&old.slot===proof.slot&&old.createdAt===proof.createdAt&&old.transactionSha256===proof.transactionSha256,'TOKEN_CREATION_PROOF_CONFLICT');
  const committedProof=Object.freeze({...proof});
  const inserted=this.statement('INSERT OR IGNORE INTO token_creations(mint,created_at,verified_at,proof) VALUES(?,?,?,?)').run(committedProof.mint,committedProof.createdAt,committedProof.availableAt,json(committedProof)).changes===1;
  if(inserted)this.afterCommit(()=>{for(const listener of this.tokenCreationProofListeners)listener(committedProof);});
 });}
 /** Only already observed creation signatures for currently active/migrated
  * candidates are queried. No token-history scan or per-launch RPC fan-out. */
 nextTokenCreationRequest(at:number,requirePreparedPool=false,qualificationOnly=false,excludedMints?:ReadonlySet<string>):{mint:string;signature:string}|undefined{
  need(integer(at),'TOKEN_CREATION_REQUEST_TIME');
  if(qualificationOnly){const excluded=this.qualificationExclusion(excludedMints);return this.statement(`WITH qualified AS MATERIALIZED (
   SELECT q.mint,q.first_seen_at,q.birth_signature,q.birth_seen_at FROM pumpswap_qualification_hints_v1 q INDEXED BY pumpswap_qualification_recent_v1
    CROSS JOIN observation_preparations p ON p.mint=q.mint
   WHERE q.pool_state='pool-ready' AND q.last_seen_at>=? AND q.last_seen_at<=? AND p.state='pool-ready' AND p.checked_at=q.pool_checked_at${excluded.where}
    AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=q.mint)
  ), births AS (
   SELECT mint,birth_signature signature,birth_seen_at received_at,first_seen_at qualification_at FROM qualified WHERE birth_signature IS NOT NULL
   UNION ALL
   SELECT birth.mint,birth.signature,birth.first_seen_at received_at,q.first_seen_at qualification_at FROM qualified q
    CROSS JOIN identity_provenance birth ON birth.mint=q.mint
   WHERE birth.kind='creation' AND birth.source IN ('pumpportal-new-token','finalized-mint-history') AND birth.signature!=''
  ) SELECT birth.mint,birth.signature FROM births birth LEFT JOIN token_creation_requests r ON r.mint=birth.mint AND r.signature=birth.signature
   WHERE birth.received_at>=? AND birth.received_at<=? AND (r.mint IS NULL OR r.terminal=0 AND r.next_attempt_at<=?)
   ORDER BY COALESCE(r.next_attempt_at,birth.qualification_at),birth.qualification_at,birth.received_at DESC,birth.mint,birth.signature LIMIT 1`).get(Math.max(0,at-SHARED_ACTIVITY_HORIZON_MS),at,...excluded.params,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,at) as {mint:string;signature:string}|undefined;}
  return this.statement(`WITH active AS MATERIALIZED (
   ${requirePreparedPool?`SELECT prepared.mint FROM observation_preparations prepared WHERE prepared.state='pool-ready' AND
    (EXISTS(SELECT 1 FROM market_tokens t WHERE t.mint=prepared.mint AND t.last_activity_at>=? AND t.last_activity_at<=?)
    OR EXISTS(SELECT 1 FROM identity_provenance hint WHERE hint.mint=prepared.mint AND hint.kind='migration' AND hint.last_seen_at>=? AND hint.last_seen_at<=?))`:
   `SELECT mint FROM market_tokens WHERE last_activity_at>=? AND last_activity_at<=?
    UNION SELECT mint FROM identity_provenance WHERE kind='migration' AND last_seen_at>=? AND last_seen_at<=?`}
  ) SELECT p.mint,p.signature FROM active CROSS JOIN market_tokens t ON t.mint=active.mint
   CROSS JOIN identity_provenance p ON p.mint=t.mint
   LEFT JOIN token_creation_requests r ON r.mint=p.mint AND r.signature=p.signature
    WHERE p.kind='creation' AND p.source IN ('pumpportal-new-token','finalized-mint-history') AND p.signature!='' AND p.first_seen_at>=? AND p.first_seen_at<=?
    AND NOT EXISTS(SELECT 1 FROM token_creations c WHERE c.mint=p.mint)
    AND (r.mint IS NULL OR (r.terminal=0 AND r.next_attempt_at<=?))
    ${requirePreparedPool?"AND EXISTS(SELECT 1 FROM observation_preparations prepared WHERE prepared.mint=p.mint AND prepared.state='pool-ready')":''}
    AND (EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=p.mint AND w.pool IS NOT NULL AND w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED')) OR EXISTS(SELECT 1 FROM identity_provenance m WHERE m.mint=p.mint AND m.kind='migration'))
   ORDER BY t.activity_score DESC,p.first_seen_at DESC,p.mint,p.signature LIMIT 1`).get(at-SHARED_ACTIVITY_HORIZON_MS,at,at-SHARED_ACTIVITY_HORIZON_MS,at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,at) as {mint:string;signature:string}|undefined;
 }
 deferTokenCreationRequest(request:{mint:string;signature:string},at:number,reason:string,terminal=false){this.write(()=>{need(name(request.mint)&&name(request.signature)&&integer(at)&&name(reason),'TOKEN_CREATION_REQUEST_INVALID');this.statement('INSERT INTO token_creation_requests(mint,signature,next_attempt_at,terminal,last_reason) VALUES(?,?,?,?,?) ON CONFLICT(mint,signature) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,terminal=excluded.terminal,last_reason=excluded.last_reason').run(request.mint,request.signature,at+60000,terminal?1:0,reason);});}
 tokenCreationRequestPending(request:{mint:string;signature:string},startedAt:number):boolean{
  need(name(request.mint)&&name(request.signature)&&integer(startedAt),'TOKEN_CREATION_REQUEST_INVALID');
  return !!this.statement("SELECT 1 FROM token_creation_requests WHERE mint=? AND signature=? AND terminal=0 AND next_attempt_at=? AND last_reason='TOKEN_CREATION_REQUEST_PENDING'").get(request.mint,request.signature,startedAt+60_000);
 }
 /** Migration-only discovery no longer records every launch. Discover the
  * missing birth signature cooperatively, only after an existing supported
  * PumpSwap pool and recent activity/migration make that work useful. Oldest
  * ready turn precedes activity score; per-mint turns settle millisecond ties.
  * Unseen candidates enter at their real pool-check time, so continuing new
  * arrivals cannot jump ahead of an already waiting history cursor. */
 nextTokenCreationHistoryRequest(at:number,qualificationOnly=false,excludedMints?:ReadonlySet<string>):TokenCreationHistoryRequest|undefined {
  need(integer(at),'TOKEN_CREATION_HISTORY_TIME');
  if(qualificationOnly){const excluded=this.qualificationExclusion(excludedMints);return this.statement(`SELECT p.mint,h.before_signature before,h.before_slot beforeSlot,h.until_signature until,h.until_slot untilSlot,h.oldest_candidate oldestCandidate,h.oldest_candidate_slot oldestCandidateSlot
   FROM pumpswap_qualification_hints_v1 q INDEXED BY pumpswap_qualification_recent_v1 CROSS JOIN observation_preparations p ON p.mint=q.mint LEFT JOIN token_creation_history h ON h.mint=q.mint
   WHERE q.pool_state='pool-ready' AND q.last_seen_at>=? AND q.last_seen_at<=? AND p.state='pool-ready' AND p.checked_at=q.pool_checked_at${excluded.where}
    AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=q.mint)
    AND (h.mint IS NULL OR h.terminal=0 AND h.next_attempt_at<=?)
    AND NOT (q.birth_signature IS NOT NULL AND q.birth_seen_at>=? AND q.birth_seen_at<=? AND NOT EXISTS(SELECT 1 FROM token_creation_requests r WHERE r.mint=q.mint AND r.signature=q.birth_signature AND r.terminal=1))
    AND NOT EXISTS(SELECT 1 FROM identity_provenance birth LEFT JOIN token_creation_requests r ON r.mint=birth.mint AND r.signature=birth.signature WHERE birth.mint=q.mint AND birth.kind='creation' AND birth.source IN ('pumpportal-new-token','finalized-mint-history') AND birth.signature!='' AND birth.first_seen_at>=? AND birth.first_seen_at<=? AND (r.mint IS NULL OR r.terminal=0))
   ORDER BY COALESCE(h.next_attempt_at,q.pool_checked_at),COALESCE(h.turns,0),q.first_seen_at,q.mint LIMIT 1`).get(Math.max(0,at-SHARED_ACTIVITY_HORIZON_MS),at,...excluded.params,at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at) as TokenCreationHistoryRequest|undefined;}
  return this.statement(`SELECT p.mint,h.before_signature before,h.before_slot beforeSlot,h.until_signature until,h.until_slot untilSlot,h.oldest_candidate oldestCandidate,h.oldest_candidate_slot oldestCandidateSlot
   FROM observation_preparations p JOIN market_tokens t ON t.mint=p.mint LEFT JOIN token_creation_history h ON h.mint=p.mint
   WHERE p.state='pool-ready' AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=p.mint)
    AND (h.mint IS NULL OR h.terminal=0 AND h.next_attempt_at<=?)
    AND (t.last_activity_at>=? AND t.last_activity_at<=? OR EXISTS(SELECT 1 FROM identity_provenance migration WHERE migration.mint=p.mint AND migration.kind='migration' AND migration.last_seen_at>=? AND migration.last_seen_at<=?))
    AND NOT EXISTS(SELECT 1 FROM identity_provenance birth LEFT JOIN token_creation_requests request ON request.mint=birth.mint AND request.signature=birth.signature WHERE birth.mint=p.mint AND birth.kind='creation' AND birth.source IN ('pumpportal-new-token','finalized-mint-history') AND birth.signature!='' AND birth.first_seen_at>=? AND birth.first_seen_at<=? AND (request.mint IS NULL OR request.terminal=0))
    AND EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=p.mint AND w.pool=p.pool AND w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED'))
   ORDER BY COALESCE(h.next_attempt_at,p.checked_at),COALESCE(h.turns,0),t.activity_score DESC,p.checked_at,p.mint LIMIT 1`).get(at,at-SHARED_ACTIVITY_HORIZON_MS,at,at-SHARED_ACTIVITY_HORIZON_MS,at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at) as TokenCreationHistoryRequest|undefined;
 }
 deferTokenCreationHistory(request:TokenCreationHistoryRequest,at:number,reason:string):void {
  this.write(()=>{need(name(request.mint)&&integer(at)&&name(reason),'TOKEN_CREATION_HISTORY_REQUEST_INVALID');this.statement(`INSERT INTO token_creation_history(mint,before_signature,before_slot,until_signature,until_slot,oldest_candidate,oldest_candidate_slot,next_attempt_at,turns,terminal,last_reason) VALUES(?,?,?,?,?,?,?,?,1,0,?) ON CONFLICT(mint) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,turns=token_creation_history.turns+1,last_reason=excluded.last_reason`).run(request.mint,request.before,request.beforeSlot,request.until,request.untilSlot,request.oldestCandidate,request.oldestCandidateSlot,at+TOKEN_CREATION_HISTORY_POLICY.retryMs,reason);});
 }
 tokenCreationHistoryPending(request:TokenCreationHistoryRequest,startedAt:number):boolean{
  need(name(request.mint)&&integer(startedAt),'TOKEN_CREATION_HISTORY_REQUEST_INVALID');
  return !!this.statement("SELECT 1 FROM token_creation_history WHERE mint=? AND before_signature IS ? AND before_slot IS ? AND until_signature IS ? AND until_slot IS ? AND oldest_candidate IS ? AND oldest_candidate_slot IS ? AND terminal=0 AND next_attempt_at=? AND last_reason='TOKEN_CREATION_HISTORY_PENDING'").get(request.mint,request.before,request.beforeSlot,request.until,request.untilSlot,request.oldestCandidate,request.oldestCandidateSlot,startedAt+TOKEN_CREATION_HISTORY_POLICY.retryMs);
 }
 applyTokenCreationHistoryPage(request:TokenCreationHistoryRequest,result:TokenCreationHistoryPage,at:number):boolean {
  return this.transaction(()=>{
   need(integer(at),'TOKEN_CREATION_HISTORY_TIME');const current=this.statement('SELECT before_signature before,before_slot beforeSlot,until_signature until,until_slot untilSlot FROM token_creation_history WHERE mint=?').get(request.mint) as Pick<TokenCreationHistoryRequest,'before'|'beforeSlot'|'until'|'untilSlot'>|undefined;
   if(!current||current.before!==request.before||current.beforeSlot!==request.beforeSlot||current.until!==request.until||current.untilSlot!==request.untilSlot||this.tokenCreationProof(request.mint)!==null||this.observationPreparation(request.mint)?.state!=='pool-ready')return false;
   if(result.kind==='continue')this.statement('UPDATE token_creation_history SET before_signature=?,before_slot=?,oldest_candidate=?,oldest_candidate_slot=?,next_attempt_at=?,terminal=0,last_reason=? WHERE mint=?').run(result.before,result.beforeSlot,result.oldestCandidate,result.oldestCandidateSlot,at,'TOKEN_CREATION_HISTORY_CONTINUE',request.mint);
   else if(result.kind==='candidate'){
    const qualification=this.statement('UPDATE pumpswap_qualification_hints_v1 SET birth_signature=?,birth_seen_at=? WHERE mint=?').run(result.signature,at,request.mint).changes;
    if(!qualification)this.observeIdentity({mint:request.mint,signature:result.signature,at,source:'finalized-mint-history',kind:'creation'});
    this.statement('UPDATE token_creation_history SET oldest_candidate=?,oldest_candidate_slot=?,next_attempt_at=?,terminal=1,last_reason=? WHERE mint=?').run(result.signature,result.slot,at,'TOKEN_CREATION_SIGNATURE_REQUIRES_FINALIZED_CREATE_PROOF',request.mint);
   }else this.statement('UPDATE token_creation_history SET next_attempt_at=?,terminal=?,last_reason=? WHERE mint=?').run(at+TOKEN_CREATION_HISTORY_POLICY.retryMs,result.terminal?1:0,result.reason,request.mint);
   return true;
  });
 }
 /** An earlier address reference can be a transfer, not mint creation. Move
  * the exclusive lower bound past a rejected history candidate and search the
  * newer interval; no raw pages or arbitrary oldest-signature assumption. */
 advanceTokenCreationHistory(request:{mint:string;signature:string},at:number):boolean {
  return this.transaction(()=>{
   need(name(request.mint)&&name(request.signature)&&integer(at),'TOKEN_CREATION_HISTORY_REQUEST_INVALID');
   if(this.tokenCreationProof(request.mint)!==null)return false;
   return this.statement(`UPDATE token_creation_history SET until_signature=oldest_candidate,until_slot=oldest_candidate_slot,before_signature=NULL,before_slot=NULL,oldest_candidate=NULL,oldest_candidate_slot=NULL,next_attempt_at=?,terminal=0,last_reason='TOKEN_CREATION_HISTORY_CANDIDATE_REJECTED_CONTINUE'
    WHERE mint=? AND oldest_candidate=? AND oldest_candidate_slot IS NOT NULL AND terminal=1 AND last_reason='TOKEN_CREATION_SIGNATURE_REQUIRES_FINALIZED_CREATE_PROOF'
    AND EXISTS(SELECT 1 FROM token_creation_requests request WHERE request.mint=token_creation_history.mint AND request.signature=token_creation_history.oldest_candidate AND request.terminal=1)`).run(at,request.mint,request.signature).changes===1;
  });
 }
 tokenAgeSummary(at:number){need(integer(at),'TOKEN_CREATION_REPORT_TIME');const row=this.statement('SELECT COUNT(*) verified,SUM(CASE WHEN created_at<=? AND created_at>=? AND verified_at<=? THEN 1 ELSE 0 END) within24h FROM token_creations').get(at,at-TOKEN_AGE_POLICY.maximumAgeMs,at) as {verified:number;within24h:number|null};return {policy:TOKEN_AGE_POLICY.version,maximumAgeMs:TOKEN_AGE_POLICY.maximumAgeMs,verified:row.verified,within24h:row.within24h??0,unknownExcluded:true,creationNotMigration:true};}
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
 /** The caller synchronously supplies the complete lifetime financial mint set
  * plus live preparation, held, pending and sale-review dependencies. A partial
  * history snapshot is not deletion authority. Intake never invokes this path.
  * Exact digest tombstones preserve old installer snapshot membership checks;
  * they are committed atomically with the corresponding nonfinancial deletion.
  * Identity, creation proof, origin, queue keys and all financial stores stay.
  */
 retireExpiredCandidates(input:CandidateRetentionInput):CandidateRetentionResult {
  need(input.tradeHistoryComplete===true,'REGISTRY_RETENTION_FINANCIAL_HISTORY_REQUIRED');
  const at=input.at,batch=input.batch??CANDIDATE_RETENTION_POLICY.maximumBatchRows;
  need(integer(at)&&at<=this.clock()&&integer(batch)&&batch>0&&batch<=CANDIDATE_RETENTION_POLICY.maximumBatchRows&&typeof input.protectedMints?.has==='function'&&(input.protectedSignatures===undefined||typeof input.protectedSignatures.has==='function'),'REGISTRY_RETENTION_INPUT');
  return this.transaction(()=>{
   const totals=this.getMetadata<CandidateRetentionTotals>('candidateRetention')??{last:null,retiredHistoryRows:0,compactedWatchRows:0,retiredBodyBytes:0};
   const cursor=totals.last?.cursor??null,createdBefore=at-CANDIDATE_RETENTION_POLICY.minimumTokenAgeMs,historyBefore=at-CANDIDATE_RETENTION_POLICY.unusedGraceMs;
   const result:CandidateRetentionResult={policy:CANDIDATE_RETENTION_POLICY.version,at,scannedMints:0,protectedMints:0,oversizedRowsDeferred:0,retiredHistoryRows:0,compactedWatchRows:0,retiredBodyBytes:0,cursor};
   const candidates=this.statement(`SELECT mint,created_at FROM token_creations WHERE created_at<? AND verified_at<=?${cursor?' AND (created_at,mint)>(?,?)':''} ORDER BY created_at,mint LIMIT ?`).all(createdBefore,at,...(cursor?[cursor.createdAt,cursor.mint]:[]),CANDIDATE_RETENTION_POLICY.maximumScannedMints) as {mint:string;created_at:number}[];
   // INTEGER PRIMARY KEY (including legacy runtimes) can reuse a deleted maximum.
   // Keep the single global maximum live row as a sequence anchor. Future inserts
   // advance it, after which the formerly newest row can expire normally.
   const maximumId=Number((this.statement('SELECT MAX(id) maximumId FROM watch_history').get() as {maximumId:number|null}).maximumId??0);
   let processedBytes=0,workedRows=0,fullyScanned=true;
   for(const candidate of candidates){
    if(workedRows>=batch||processedBytes>=CANDIDATE_RETENTION_POLICY.maximumBatchBytes){fullyScanned=false;break;}
    result.scannedMints++;result.cursor={createdAt:candidate.created_at,mint:candidate.mint};
    const age=this.tokenAgeEligibility(candidate.mint,at);
    need(age.reason==='TOKEN_AGE_EXCEEDS_24H'&&age.createdAt===candidate.created_at,'REGISTRY_RETENTION_VERIFIED_AGE_REQUIRED');
    const blocked=input.protectedMints.has(candidate.mint)||!!this.statement("SELECT 1 FROM watch_rows WHERE mint=? AND (state IN ('HELD','ENTRY_PENDING','DEEP_OBSERVATION','QUALIFIED','VERIFYING') OR technical_state IN ('CLAIMED','WAITING')) LIMIT 1").get(candidate.mint)||!!this.statement("SELECT 1 FROM verification_queue WHERE feed_mint=? AND state='PENDING' LIMIT 1").get(candidate.mint)||!!this.statement("SELECT 1 FROM watch_rows w JOIN verification_queue q ON q.signature=w.signature WHERE w.mint=? AND q.state='PENDING' LIMIT 1").get(candidate.mint)||!!this.statement("SELECT 1 FROM observation_preparations WHERE mint=? AND state='awaiting-dispatch' LIMIT 1").get(candidate.mint);
    if(blocked){result.protectedMints++;continue;}
    // Bound both body reads and mutations. A mint with many signatures is visited
    // over repeated sweeps; the per-mint signature cursor avoids starving later
    // signatures behind permanent historical placeholders.
    const signatureKey='candidateRetentionSignature:'+candidate.mint;
    const after=this.getMetadata<string>(signatureKey)??'';
    const rowLimit=Math.min(batch-workedRows,16);
    const rows=this.statement('SELECT signature,state,archived,length(CAST(body AS BLOB)) bodyBytes FROM watch_rows WHERE mint=? AND signature>? ORDER BY signature LIMIT ?').all(candidate.mint,after,rowLimit) as {signature:string;state:string;archived:number;bodyBytes:number}[];
    let lastCompletedSignature=after,completedSignatures=true;
    for(const row of rows){
     if(workedRows>=batch||processedBytes>=CANDIDATE_RETENTION_POLICY.maximumBatchBytes){completedSignatures=false;break;}
     if(input.protectedSignatures?.has(row.signature)){lastCompletedSignature=row.signature;continue;}
     const remaining=batch-workedRows;
     const history=this.statement('SELECT id,signature,at,state,reason,length(CAST(body AS BLOB)) bodyBytes FROM watch_history WHERE signature=? AND at<=? AND id<? ORDER BY at,id LIMIT ?').all(row.signature,historyBefore,maximumId,remaining) as {id:number;signature:string;at:number;state:string;reason:string;bodyBytes:number}[];
     for(const entry of history){
      const bytes=entry.bodyBytes;
      if(bytes>CANDIDATE_RETENTION_POLICY.maximumBatchBytes){result.oversizedRowsDeferred++;continue;}
      if(processedBytes+bytes>CANDIDATE_RETENTION_POLICY.maximumBatchBytes){completedSignatures=false;break;}
      const original=this.statement('SELECT body FROM watch_history WHERE id=?').get(entry.id) as {body:string};
      const digest=createHash('sha256').update(original.body).digest('hex');
      this.statement('INSERT INTO watch_history_retirements(id,signature,at,state,reason,body_sha256,retired_at,mint,created_at,policy,financial_history_complete,obligations_absent) VALUES(?,?,?,?,?,?,?,?,?,?,1,1)').run(entry.id,entry.signature,entry.at,entry.state,entry.reason,digest,at,candidate.mint,candidate.created_at,CANDIDATE_RETENTION_POLICY.version);
      need(this.statement('DELETE FROM watch_history WHERE id=? AND signature=?').run(entry.id,entry.signature).changes===1,'REGISTRY_RETENTION_HISTORY_CHANGED');
      processedBytes+=bytes;workedRows++;result.retiredHistoryRows++;result.retiredBodyBytes+=bytes;
     }
     if(!completedSignatures)break;
     if(workedRows>=batch||processedBytes>=CANDIDATE_RETENTION_POLICY.maximumBatchBytes){completedSignatures=false;break;}
     if(!row.archived&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state)){lastCompletedSignature=row.signature;continue;}
     if(this.statement('SELECT 1 FROM watch_history WHERE signature=? AND at>? LIMIT 1').get(row.signature,historyBefore)){lastCompletedSignature=row.signature;continue;}
     if(row.bodyBytes>CANDIDATE_RETENTION_POLICY.maximumBatchBytes){result.oversizedRowsDeferred++;lastCompletedSignature=row.signature;continue;}
     if(processedBytes+row.bodyBytes>CANDIDATE_RETENTION_POLICY.maximumBatchBytes){completedSignatures=false;break;}
     const priorBody=(this.statement('SELECT body FROM watch_rows WHERE signature=?').get(row.signature) as {body:string}).body;
     const original=JSON.parse(priorBody) as WatchRow&{retention?:{policy:string}};
     if(original.retention?.policy===CANDIDATE_RETENTION_POLICY.version){lastCompletedSignature=row.signature;continue;}
     const reason='expired nontrade candidate detail retired';
     const compact:WatchRow&{retention:{policy:string;createdAt:number;retiredAt:number}}={signature:original.signature,feedMint:original.feedMint,mint:original.mint,pool:original.pool,migrationAt:original.migrationAt,verifiedAt:original.verifiedAt,firstSeenAt:original.firstSeenAt,state:'EXPIRED',reason,lastActivityAt:original.lastActivityAt,lastActivityEvidence:null,lastDemotedAt:original.lastDemotedAt,deepSince:null,deferUntil:0,waitingSince:original.waitingSince,promotions:original.promotions,repromotions:original.repromotions,demotions:original.demotions,completeWindows:original.completeWindows,everHadWindow:original.everHadWindow,lastWindowAt:original.lastWindowAt,history:[],retention:{policy:CANDIDATE_RETENTION_POLICY.version,createdAt:candidate.created_at,retiredAt:at}};
     const body=json(compact),bytes=row.bodyBytes;
     if(processedBytes+bytes>CANDIDATE_RETENTION_POLICY.maximumBatchBytes){completedSignatures=false;break;}
     this.statement('INSERT OR IGNORE INTO candidate_retirements(signature,mint,created_at,retired_at,policy,original_body_sha256) VALUES(?,?,?,?,?,?)').run(row.signature,candidate.mint,candidate.created_at,at,CANDIDATE_RETENTION_POLICY.version,createHash('sha256').update(priorBody).digest('hex'));
     this.statement("UPDATE watch_rows SET archived=1,state='EXPIRED',deep_since=NULL,defer_until=0,capacity_status=NULL,capacity_reassess_at=NULL,technical_state=NULL,technical_expires_at=NULL,technical_not_before=NULL,technical_requested_at=NULL,last_decision_kind=NULL,last_decision_at=NULL,reobserve_ready=0,older_research=0,body=? WHERE signature=? AND mint=?").run(body,row.signature,candidate.mint);
     processedBytes+=bytes;workedRows++;result.compactedWatchRows++;result.retiredBodyBytes+=Math.max(0,bytes-Buffer.byteLength(body));
     lastCompletedSignature=row.signature;
    }
    // Revisit a partially processed signature before advancing. This is just a
    // compact scheduler cursor, not additional retained candidate evidence.
    const nextSignature=completedSignatures&&rows.length<rowLimit?'':lastCompletedSignature;
    if(nextSignature!==after)this.setMetadata(signatureKey,nextSignature);
   }
   if(fullyScanned&&candidates.length<CANDIDATE_RETENTION_POLICY.maximumScannedMints)result.cursor=null;
   this.setMetadata('candidateRetention',{last:result,retiredHistoryRows:totals.retiredHistoryRows+result.retiredHistoryRows,compactedWatchRows:totals.compactedWatchRows+result.compactedWatchRows,retiredBodyBytes:totals.retiredBodyBytes+result.retiredBodyBytes} satisfies CandidateRetentionTotals);
   return result;
  });
 }
 retentionStatus(){const totals=this.getMetadata<CandidateRetentionTotals>('candidateRetention')??{last:null,retiredHistoryRows:0,compactedWatchRows:0,retiredBodyBytes:0};return {policy:CANDIDATE_RETENTION_POLICY,...totals,retiredBytesMeaning:'Logical removed body bytes; SQLite pages are reusable and file size may not shrink immediately.',reusablePages:Number(this.db.pragma('freelist_count',{simple:true})),pageBytes:Number(this.db.pragma('page_size',{simple:true}))};}
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
 coverageSnapshot(at:number){const registryTransactions={...(this.reportingTransactionBaseline??this.transactionCounters())};return this.readTransaction(()=>{const hour=Math.floor(at/3600000)*3600000;const tokens=this.statement("SELECT (SELECT COUNT(*) FROM market_tokens) total,(SELECT COUNT(*) FROM market_tokens WHERE screen_state='WITH_ACTIVITY') with_activity").get() as {total:number;with_activity:number};const queue=this.verificationStats(at);const feeds=(this.statement('SELECT source,connected,last_observed_at,scope,coverage_gaps FROM market_feeds ORDER BY source').all() as {source:string;connected:number;last_observed_at:number;scope:string;coverage_gaps:number}[]).map(f=>({source:f.source,connected:!!f.connected,lastObservedAt:f.last_observed_at,scope:f.scope,coverageGaps:f.coverage_gaps}));
  const population=this.watchReportingPopulation(),active={tracked:population.tracked,awaitingDeep:population.awaitingDeep,deep:population.deepObserving};
  // Count the available proof population against the mint index. Historical
  // orphan proofs cannot subtract identities which the registry never saw.
  const withOrigin=Number((this.statement('SELECT COUNT(*) n FROM origin_proofs o WHERE o.available=1 AND EXISTS(SELECT 1 FROM market_tokens t WHERE t.mint=o.mint)').get() as {n:number}).n);
  return {version:'poe-market-coverage-v1' as const,generatedAt:at,persistence:{state:this.storageAvailable?'sqlite-wal' as const:'unavailable' as const,createdAt:this.getMetadata<number>('createdAt')??null,updatedAt:this.getMetadata<number>('updatedAt')??this.getMetadata<number>('createdAt')??null},lifetime:{uniqueTokensDiscovered:tokens.total,lightweightScreened:this.distinctCount('lightweight-screened'),lightweightWithActivity:this.distinctCount('lightweight-with-activity'),lightweightUnavailable:tokens.total-(tokens.with_activity??0),deepAdmitted:this.distinctCount('deep-admitted'),verifiedAudited:this.distinctCount('verified-audit')},currentHour:{startedAt:hour,uniqueTokensDiscovered:Number((this.statement('SELECT COUNT(*) n FROM market_tokens WHERE first_seen_at>=? AND first_seen_at<=?').get(hour,at) as {n:number}).n)},active:{trackedIdentities:active.tracked??0,awaitingOrigin:tokens.total-withOrigin,awaitingLightweight:0,awaitingVerification:queue.pending,awaitingDeep:active.awaitingDeep??0,deepObserving:active.deep??0},lightweight:{activityHorizonMs:SHARED_ACTIVITY_HORIZON_MS,dedupRetentionMs:HINT_DEDUP_RETENTION_MS,hintDedupKeysPruned:this.getMetadata<number>('hintDedupKeysPruned')??0,staleActivityObservations:this.getMetadata<number>('staleActivityObservations')??0},resource:{registryTransactions,durableVerificationBacklog:queue.pending,oldestVerificationAt:queue.oldestReceivedAt,maximumVerificationWaitMs:queue.maxWaitMs,storageFailures:this.storageFailures,maximumWriteMs:this.writeMaximumMs,meanWriteMs:this.writes?this.writeTotalMs/this.writes:0},feeds,marketDenominator:null,wholeMarketCoveragePercent:null,limitations:['MARKET_DENOMINATOR_UNKNOWN','PROVIDER_HINTS_UNVERIFIED','PREMIGRATION_EXECUTION_NOT_SUPPORTED','SOURCE_OUTAGES_NOT_RECONSTRUCTED','SHARED_ACTIVITY_PARTIAL_WHEN_FEED_UNAVAILABLE','PREEXISTING_MARKET_BACKFILL_UNAVAILABLE','UNVERIFIED_ORIGIN_DISCOVERY_PENDING','SHARED_HINT_DEDUP_RETENTION_1H',...(!this.storageAvailable?['REGISTRY_STORAGE_UNAVAILABLE']:[])]};});
 }
 close():void{if(this.readDepth>0)throw new MarketRegistryReadOnlyViolation('Closing the registry is forbidden inside a read snapshot');this.statements.clear();this.economicFlowCache.clear();this.economicFlowCacheBytes=0;this.db.close();}
}
