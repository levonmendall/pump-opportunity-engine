from pathlib import Path
root=Path('.')
def rep(s,old,new,n=1):
 assert s.count(old)==n,(old[:100],s.count(old),n)
 return s.replace(old,new)
p=root/'src/token-age-policy.ts';s=p.read_text();s += "\n/** Shared entry-scope contract; live V3.1 selects migration age explicitly. */\nexport type EntryAgeDecision=TokenAgeDecision|import('./migration-age-policy.js').MigrationAgeDecision;\n";p.write_text(s)
for file in ['src/trader.ts','src/execution.ts','src/native-paper.ts']:
 p=root/file;s=p.read_text();s=s.replace('TokenAgeDecision','EntryAgeDecision');p.write_text(s)
p=root/'src/trader.ts';s=p.read_text().replace("scope?.reason==='TOKEN_AGE_EXCEEDS_24H'","scope?.reason==='TOKEN_AGE_EXCEEDS_24H'||scope?.reason==='MIGRATION_AGE_EXCEEDS_24H'||scope?.reason==='MIGRATION_AGE_BELOW_1M'");p.write_text(s)
p=root/'src/market-registry.ts';s=p.read_text()
s=rep(s,"import {TOKEN_CREATION_HISTORY_POLICY", "import {MIGRATION_AGE_POLICY,validMigrationAgeProof,migrationAgeDecision,type MigrationAgeProof} from './migration-age-policy.js';\nimport {TOKEN_CREATION_HISTORY_POLICY")
s=rep(s,' private readonly tokenCreationProofListeners=', ' private migrationAge=false;\n private readonly migrationAgeProofListeners=new Set<(proof:Readonly<MigrationAgeProof>)=>void>();\n private readonly tokenCreationProofListeners=')
s=rep(s,"writerRole?:'main'|'intake'}={})", "writerRole?:'main'|'intake';migrationAge?:true}={})")
s=rep(s,'  this.path=path;', '  this.migrationAge=options.migrationAge===true;this.path=path;')
s=rep(s,'   CREATE TABLE IF NOT EXISTS token_creations(','''   CREATE TABLE IF NOT EXISTS pumpswap_migration_ages_v1(mint TEXT PRIMARY KEY,migrated_at INTEGER NOT NULL,verified_at INTEGER NOT NULL,proof TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS pumpswap_migration_ages_time_v1 ON pumpswap_migration_ages_v1(migrated_at,mint);
   CREATE TABLE IF NOT EXISTS pumpswap_migration_requests_v1(mint TEXT PRIMARY KEY,signature TEXT NOT NULL,received_at INTEGER NOT NULL,direct INTEGER NOT NULL,next_attempt_at INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,last_reason TEXT NOT NULL DEFAULT 'MIGRATION_AGE_UNVERIFIED');
   CREATE INDEX IF NOT EXISTS pumpswap_migration_requests_due_v1 ON pumpswap_migration_requests_v1(next_attempt_at,direct,received_at,mint);
   CREATE TABLE IF NOT EXISTS token_creations(''')
ranges=[(' nextOpportunity(', ' private reportingRows('),(' private reportingRows(', ' aggregate('),(' nextWatchActivities(', ' /** First receipt'),(' nextObservationCandidate(', ' /** Minimal pre-admission'),(' nextQualifiedPumpSwapIdentity(', ' putObservationPreparation(')]
for start,end in ranges:
 a=s.index(start);b=s.index(end,a);seg=s[a:b]
 seg=seg.replace("'token_creations selection_age INDEXED BY token_creations_age CROSS JOIN watch_rows w INDEXED BY watch_rows_mint ON w.mint=selection_age.mint'",'`${this.admissionAgeTable} selection_age INDEXED BY ${this.admissionAgeIndex} CROSS JOIN watch_rows w INDEXED BY watch_rows_mint ON w.mint=selection_age.mint`')
 seg=seg.replace("'selection_age.created_at<=? AND selection_age.created_at>=? AND selection_age.verified_at<=? AND '",'`selection_age.${this.admissionAgeColumn}<=? AND selection_age.${this.admissionAgeColumn}>=? AND selection_age.verified_at<=? AND `')
 seg=seg.replace("'token_creations report_age INDEXED BY token_creations_age CROSS JOIN watch_rows w INDEXED BY watch_rows_mint'",'`${this.admissionAgeTable} report_age INDEXED BY ${this.admissionAgeIndex} CROSS JOIN watch_rows w INDEXED BY watch_rows_mint`')
 seg=seg.replace("'report_age.created_at<=@poeReportAt AND report_age.created_at>=@poeReportFloor AND report_age.verified_at<=@poeReportAt AND w.mint=report_age.mint AND w.archived=0'",'`report_age.${this.admissionAgeColumn}<=@poeReportAt-${this.admissionMinimumAgeMs} AND report_age.${this.admissionAgeColumn}>=@poeReportFloor AND report_age.verified_at<=@poeReportAt AND w.mint=report_age.mint AND w.archived=0`')
 seg=seg.replace('FROM token_creations age INDEXED BY token_creations_age','FROM ${this.admissionAgeTable} age INDEXED BY ${this.admissionAgeIndex}')
 seg=seg.replace('FROM token_creations INDEXED BY token_creations_age WHERE created_at>=? AND created_at<=?', 'FROM ${this.admissionAgeTable} INDEXED BY ${this.admissionAgeIndex} WHERE ${this.admissionAgeColumn}>=? AND ${this.admissionAgeColumn}<=?')
 seg=seg.replace('age.created_at>=? AND age.created_at<=?', 'age.${this.admissionAgeColumn}>=? AND age.${this.admissionAgeColumn}<=?')
 seg=seg.replace('scopeParams=ageScoped?[at,at-TOKEN_AGE_POLICY.maximumAgeMs,at]', 'scopeParams=ageScoped?[at-this.admissionMinimumAgeMs,at-TOKEN_AGE_POLICY.maximumAgeMs,at]')
 seg=seg.replace('Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,at','Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at-this.admissionMinimumAgeMs,at')
 seg=seg.replace('!this.tokenAgeEligibility(mint,at).allowed','!this.marketAgeEligibility(mint,at).allowed')
 s=s[:a]+seg+s[b:]
s=rep(s,"  if(this.statement('SELECT 1 FROM token_creations WHERE mint=?').get(hint.mint))return false;",'''  if(this.migrationAge&&hint.signature){
   this.statement(`INSERT INTO pumpswap_migration_requests_v1(mint,signature,received_at,direct) VALUES(?,?,?,?)
    ON CONFLICT(mint) DO UPDATE SET signature=CASE WHEN excluded.direct>direct THEN excluded.signature ELSE signature END,
     received_at=CASE WHEN excluded.direct>direct THEN excluded.received_at ELSE received_at END,
     next_attempt_at=CASE WHEN excluded.direct>direct THEN 0 ELSE next_attempt_at END,direct=MAX(direct,excluded.direct)`)
    .run(hint.mint,hint.signature,hint.receivedAt,hint.kind==='migration'?1:0);
  }
  if(!this.migrationAge&&this.statement('SELECT 1 FROM token_creations WHERE mint=?').get(hint.mint))return false;''')
s=rep(s,"    AND NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=q.mint)\n    AND (q.pool_state=", "    AND ${this.migrationAge?this.admissionAgeSql('q.mint',String(at)):'NOT EXISTS(SELECT 1 FROM token_creations age WHERE age.mint=q.mint)'}\n    AND (q.pool_state=")
point=' tokenCreationProof(mint:string):TokenCreationProof|null{'
new=''' /** Select the owner-approved live age basis without mutating old evidence. */
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
'''
s=rep(s,point,new+point);p.write_text(s)
p=root/'src/pilot-watch.ts';s=p.read_text()
s=s.replace('FROM token_creations age WHERE age.mint=w.mint),0)', 'FROM ${this.options.registry!.admissionAgeTable} age WHERE age.mint=w.mint),0)')
s=s.replace('\",COALESCE((SELECT verified_at FROM ${this.options.registry!.admissionAgeTable} age WHERE age.mint=w.mint),0)\"', '`,COALESCE((SELECT verified_at FROM ${this.options.registry!.admissionAgeTable} age WHERE age.mint=w.mint),0)`')
a=s.index('  private tokenAgeSql(');b=s.index('\n',a)
s=s[:a]+"  private tokenAgeSql(at:string){return this.options.enforceTokenAge24h?` AND ${this.options.registry!.admissionAgeSql('w.mint',at)}`:'';}"+s[b:]
s=s.replace('this.options.registry!.tokenAgeEligibility(r.mint,at).allowed','this.options.registry!.marketAgeEligibility(r.mint,at).allowed');p.write_text(s)
