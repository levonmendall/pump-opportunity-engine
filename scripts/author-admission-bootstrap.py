#!/usr/bin/env python3
"""Author source/tests only on the exact installed baseline; no runtime access."""
import argparse,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('mode',choices=['tests','repair']);a=p.parse_args()
ROOT=pathlib.Path.cwd();BASE='0044b552ef160bf43823d16578c63431b0bcfd9d'
subprocess.run(['git','merge-base','--is-ancestor',BASE,'HEAD'],check=True)
def exact(path):
 raw=(ROOT/path).read_bytes();expected=subprocess.check_output(['git','show',BASE+':'+path])
 if raw!=expected:raise ValueError('EXACT_BASE_REQUIRED:'+path)
 return raw.decode()
def one(s,old,new):
 if s.count(old)!=1:raise ValueError('EXACT_ANCHOR_REQUIRED:'+old[:100])
 return s.replace(old,new)
runner=exact('src/native-candidate-runner.ts');registry=exact('src/market-registry.ts')
if a.mode=='tests':
 path='test/native-candidate-runner.test.ts';tests=exact(path)
 tests+='''

// Synthetic scheduling latency, not measured provider latency. These exercise
// the actual runner, actual SQLite registry and existing fake physical gate.
function bootstrapFixture(){
 const mint=new PublicKey(Buffer.alloc(32,21)).toBase58(),signature=sig(55001);
 const f=fixture({enforceTokenAge24h:true,durableMarketPolicy:true,fairEconomicCompletions:true,creationTx:tokenCreationTransaction(mint,signature,Math.floor((baseAt-3600000)/1000)*1000)});
 f.runner.onMarketIdentity({mint,signature,receivedAt:f.now,source:'pumpportal-new-token',kind:'creation',evidence:'unverified-provider-discovery-hint'});
 assert.equal(f.seed(1),mint);
 f.runner.onMarketIdentity({mint,signature:sig(1),receivedAt:f.now,source:'pumpportal-migration',kind:'migration',evidence:'unverified-provider-discovery-hint'});
 return {...f,fixture:f,mint,signature,registry:(f.runner as any).registry as MarketRegistry};
}
test('admission bootstrap: slow local creation lookup cannot consume an unstarted request envelope',async()=>{
 const b=bootstrapFixture(),f=b.fixture,lookup=b.registry.nextTokenCreationRequest.bind(b.registry);
 b.registry.nextTokenCreationRequest=(at:number)=>{const row=lookup(at);f.advance(1600);return row;};
 try{
  await f.steps(5);
  assert.deepEqual(f.rpcCalls.map(r=>r.method),['getTransaction'],'current admission is calculated AFTER local lookup, without changing physical timeout');
  assert.ok(f.states.has(b.mint),'actual verified age can proceed to its own selected scope');
  assert.equal(f.resolveCalls,0);assert.equal(f.maximumInFlight,1);
 }finally{await f.runner.stop();}
});
test('admission bootstrap: pre-callback housekeeping contention does not starve creation verification',async()=>{
 for(const phase of ['drainNativeActivity','drainMigrationDelivery','drainPoolSourceProgress','drainCommittedActivity','allocate']){
  const b=bootstrapFixture(),f=b.fixture;
  (f.runner as any)[phase]=()=>{throw new MarketRegistryContention('SQLITE_BUSY');};
  try{await f.steps(2);assert.equal(f.rpcCalls.filter(r=>r.method==='getTransaction').length,1,phase);assert.equal(f.runner.status().financialWriterOpened,false);}
  finally{await f.runner.stop();}
 }
});
test('admission bootstrap: membership repair remains mandatory before any provider work',async()=>{
 const b=bootstrapFixture(),f=b.fixture;(f.runner as any).reconcileObservationMembership=()=>false;
 try{await f.steps(3);assert.equal(f.rpcCalls.length,0);assert.equal(f.added.length,0);}finally{await f.runner.stop();}
});
test('admission bootstrap: unknown maintenance failures are not treated as harmless contention',async()=>{
 const b=bootstrapFixture(),f=b.fixture;
 (f.runner as any).drainCommittedActivity=()=>{throw Object.assign(new Error('SQLITE_CORRUPT'),{code:'SQLITE_CORRUPT',callbackStarted:false});};
 try{assert.equal(await f.runner.step(),'unavailable');assert.equal(f.rpcCalls.length,0);assert.equal(f.added.length,0);}finally{await f.runner.stop();}
});
test('admission bootstrap: current physical occupancy and source closure are rechecked after local selection',async()=>{
 for(const close of [false,true]){
  const b=bootstrapFixture(),f=b.fixture,lookup=b.registry.nextTokenCreationRequest.bind(b.registry);
  b.registry.nextTokenCreationRequest=(at:number)=>{const row=lookup(at);f.advance(1600);if(close)f.setAllow(false);else f.setPhysicalBusy(true);return row;};
  try{await f.steps(2);assert.equal(f.rpcCalls.length,0);assert.equal(f.added.length,0);}finally{await f.runner.stop();}
 }
});
test('admission bootstrap: empty eligible universe never scans the economic-ranking windows',()=>{
 const r=new MarketRegistry(':memory:',{now:()=>baseAt}),statement=(r as any).statement.bind(r);let rankedQueries=0;
 (r as any).statement=(sql:string)=>{if(sql.includes('WITH eligible AS'))rankedQueries++;return statement(sql);};
 try{assert.equal(r.nextOpportunity({where:'w.state=\\'WATCH\\''},baseAt,'w.waiting_since'),undefined);assert.equal(rankedQueries,0);}
 finally{r.close();}
});
'''
 (ROOT/path).write_text(tests)
 old=registry.split("nextTokenCreationRequest(at:number)",1)[1].split('this.statement(`',1)[1].split('`).get(',1)[0]
 plan='''/** SQL equivalence and query-plan checks use disposable nonfinancial data. */
import{test}from'node:test';import assert from'node:assert/strict';import{MarketRegistry}from'../src/market-registry.js';
const reference=REFERENCE;
test('admission bootstrap: creation selection keeps ordering and cooldown semantics with an active-first plan',()=>{
 const at=1793553252000,r=new MarketRegistry(':memory:',{now:()=>at}),db=(r as any).db;
 try{
  const token=db.prepare('INSERT INTO market_tokens(mint,first_seen_at,last_seen_at,last_activity_at,activity_score,screened_at) VALUES(?,?,?,?,?,?)');
  const provenance=db.prepare('INSERT INTO identity_provenance(mint,source,kind,pool,signature,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?)');
  db.transaction(()=>{for(let i=0;i<5002;i++){const mint='offline-mint-'+i,active=i>=5000;token.run(mint,at-3600000,at,active?at-1000:at-120000,i,at);provenance.run(mint,'pumpportal-new-token','creation','','creation-'+i,at-3600000,at-3600000);provenance.run(mint,'pumpportal-migration','migration','','migration-'+i,at-120000,at-120000);}})();
  const original=(when:number)=>db.prepare(reference).get(Math.max(0,when-86400000),when,when,when-60000,when-60000);
  let sql='',params:unknown[]=[];const statement=(r as any).statement.bind(r);
  (r as any).statement=(text:string)=>{const s=statement(text);if(text.includes('p.signature')&&text.includes('token_creation_requests'))return {get(...values:unknown[]){sql=text;params=values;return s.get(...values);}};return s;};
  for(const when of [at,at+20000,at+60001])assert.deepEqual(r.nextTokenCreationRequest(when),original(when));
  r.deferTokenCreationRequest({mint:'offline-mint-5001',signature:'creation-5001'},at,'OFFLINE_RETRY');
  assert.deepEqual(r.nextTokenCreationRequest(at),original(at));assert.equal(r.nextTokenCreationRequest(at)?.mint,'offline-mint-5000');
  const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map((row:any)=>row.detail).join('\\n');
  assert.match(plan,/SEARCH p USING .*\\(mint=\\? AND source=\\? AND kind=\\?\\)/,'creation provenance is looked up by active mint, not scanned across historical launches');
  assert.doesNotMatch(plan,/SCAN p(?:\\s|$)/);
 }finally{r.close();}
});
'''.replace('REFERENCE',json.dumps(old))
 (ROOT/'test/token-creation-request-plan.test.ts').write_text(plan)
 print('Installed regressions only; application unchanged.');raise SystemExit
# Keep safety-critical gap/membership reconciliation first. Optional metadata
# failures may defer only when SQLite refused BEFORE callback execution.
runner=one(runner," private sourceWorkAllowed(bound:number){return this.open()&&(this.options.sourceWorkAdmission?.(bound)??true);}",""" private sourceWorkAllowed(bound:number){return this.open()&&(this.options.sourceWorkAdmission?.(bound)??true);}
 private registryHousekeeping(phase:'native-activity'|'migration-delivery'|'pool-progress'|'committed-activity'|'allocation',work:()=>void){
  try{work();}catch(error){
   if(!isMarketRegistryContention(error))throw error;
   this.record('native-candidate-housekeeping-deferred',{at:this.now(),phase,reason:'MARKET_REGISTRY_CONTENTION',sqliteCode:error.sqliteCode,callbackStarted:false,providerPermissionGranted:false,financialPermission:false});
  }
 }""")
for method,phase in [('drainNativeActivity','native-activity'),('drainMigrationDelivery','migration-delivery'),('drainPoolSourceProgress','pool-progress'),('drainCommittedActivity','committed-activity')]:
 runner=one(runner,'   this.'+method+'();','   this.registryHousekeeping(\''+phase+'\',()=>this.'+method+'());')
runner=one(runner,".admitted)this.allocate(at);",".admitted)this.registryHousekeeping('allocation',()=>this.allocate(at));")
start=runner.index('   const verification=this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.discretionaryReadMs,at);',runner.index(' async step('))
end=runner.index('   const fresh=this.options.rpc.usage()',start)
runner=runner[:start]+'''   const verification=this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.discretionaryReadMs,at);
   if(!this.verificationSession&&!ready.length&&verification.admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)&&(!rpcGate||!rpcGate.physicalBusy&&rpcGate.readyAt<=at))this.enqueueActivityOrigin(at);
   const lookupStartedAt=this.now();
   const creation=this.options.enforceTokenAge24h&&!ready.length&&verification.admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)?this.registry.nextTokenCreationRequest(lookupStartedAt):undefined;
   const seed=this.verificationSession?.seed??this.nextVerification(this.now());
   // These are NEW discretionary requests, not an already-open audit window.
   // Local selection can be slow; stamp their envelope only after it completes.
   // Existing service/audit deadlines and physical cooldowns are never rebased.
   at=this.now();const bootstrap=this.discretionaryAdmission(NATIVE_DEADLINE_POLICY.discretionaryReadMs,at),bootstrapUsage=this.options.rpc.usage(),bootstrapGate=bootstrapUsage.rpcDispatchWindow??bootstrapUsage.dispatchWindow;
   const bootstrapAllowed=!ready.length&&!this.readyAudits(at).length&&bootstrap.admitted&&this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.discretionaryReadMs)&&!bootstrapUsage.waitingOrOperating&&bootstrapUsage.inFlight===0&&(!bootstrapGate||!bootstrapGate.physicalBusy&&bootstrapGate.readyAt<=this.now());
   const bootstrapDeadline=Math.min(at+2000,serviceDeadline,bootstrap.latestStartAt===null?Infinity:bootstrap.latestStartAt+NATIVE_DEADLINE_POLICY.discretionaryReadMs);
   if(creation&&bootstrapAllowed)jobs.push({id:'token-creation:'+creation.signature,kind:'reconnect',enqueuedAt:at,eligibleAt:at,deadlineAt:bootstrapDeadline,operationBoundMs:NATIVE_DEADLINE_POLICY.discretionaryReadMs});
   if(seed&&bootstrapAllowed)jobs.push({id:'verify:'+seed.signature,kind:'reconnect',enqueuedAt:this.verificationSession?.startedAt??at,eligibleAt:at,deadlineAt:bootstrapDeadline,operationBoundMs:NATIVE_DEADLINE_POLICY.discretionaryReadMs});
   if(creation||seed)this.record('native-candidate-bootstrap-planned',{at,lookupStartedAt,lookupElapsedMs:Math.max(0,at-lookupStartedAt),kind:creation?'token-creation':'origin',admitted:bootstrapAllowed,deadlineAt:Number.isFinite(bootstrapDeadline)?bootstrapDeadline:null,providerRequestStarted:false,financialPermission:false});
''' +runner[end:]
# Empty current-age eligibility must not materialize/sort the global flow CTEs.
needle="  need(integer(at),'MARKET_REGISTRY_OPPORTUNITY_TIME');const recent=at-SHARED_ACTIVITY_HORIZON_MS,prior=Math.max(0,at-2*SHARED_ACTIVITY_HORIZON_MS);"
registry=one(registry,needle,"""  need(integer(at),'MARKET_REGISTRY_OPPORTUNITY_TIME');
  if(!this.statement(`SELECT 1 FROM watch_rows w WHERE w.archived=0${q.where?` AND (${q.where})`:''} LIMIT 1`).get(...(q.params??[])))return undefined;
  const recent=at-SHARED_ACTIVITY_HORIZON_MS,prior=Math.max(0,at-2*SHARED_ACTIVITY_HORIZON_MS);""")
start=registry.index("  need(integer(at),'TOKEN_CREATION_REQUEST_TIME');")
end=registry.index('\n }',start)
registry=registry[:start]+'''  need(integer(at),'TOKEN_CREATION_REQUEST_TIME');return this.statement(`WITH active AS MATERIALIZED (
   SELECT mint FROM market_tokens WHERE last_activity_at>=? AND last_activity_at<=?
   UNION SELECT mint FROM identity_provenance WHERE kind='migration' AND last_seen_at>=? AND last_seen_at<=?
  ) SELECT p.mint,p.signature FROM active CROSS JOIN market_tokens t ON t.mint=active.mint
   CROSS JOIN identity_provenance p ON p.mint=t.mint
   LEFT JOIN token_creation_requests r ON r.mint=p.mint AND r.signature=p.signature
   WHERE p.kind='creation' AND p.source='pumpportal-new-token' AND p.signature!='' AND p.first_seen_at>=? AND p.first_seen_at<=?
    AND NOT EXISTS(SELECT 1 FROM token_creations c WHERE c.mint=p.mint)
    AND (r.mint IS NULL OR (r.terminal=0 AND r.next_attempt_at<=?))
    AND (EXISTS(SELECT 1 FROM watch_rows w WHERE w.mint=p.mint AND w.pool IS NOT NULL AND w.archived=0 AND w.state NOT IN ('HELD','ENTRY_PENDING','PERMANENTLY_UNSUPPORTED')) OR EXISTS(SELECT 1 FROM identity_provenance m WHERE m.mint=p.mint AND m.kind='migration'))
   ORDER BY t.activity_score DESC,p.first_seen_at DESC,p.mint,p.signature LIMIT 1`).get(at-SHARED_ACTIVITY_HORIZON_MS,at,at-SHARED_ACTIVITY_HORIZON_MS,at,Math.max(0,at-TOKEN_AGE_POLICY.maximumAgeMs),at,at) as {mint:string;signature:string}|undefined;''' +registry[end:]
(ROOT/'src/native-candidate-runner.ts').write_text(runner)
(ROOT/'src/market-registry.ts').write_text(registry)
(ROOT/'docs').mkdir(exist_ok=True)
(ROOT/'docs/ADMISSION_BOOTSTRAP_REPAIR_20261101.md').write_text('''# Candidate-admission bootstrap repair

Base: installed 0044b552ef160bf43823d16578c63431b0bcfd9d. No financial-control exception or trading-rule change.

Observed runtime: discovery/intake progress but zero deep admissions, audits and current-instance HTTP starts. A retained sample has registry contention and local loop lag. These observations do not establish a provider outage or prove every failed cycle has one cause.

The regressions reproduce two independent local starvation mechanisms: optional pre-callback writer contention aborted the entire runner step, and a slow creation-signature selection consumed the 2-second scheduling envelope before a 1.5-second request could start. New unstarted discretionary requests are now planned at current time after lookup. Real audit/window/service deadlines, fresh admission checks, RPC cooldowns, physical settlement and on-chain age validation remain unchanged.

Optional metadata work defers only the typed before-callback lease refusal. Safety-critical retirement/membership still gates the whole step. Unknown failures and errors after a callback starts still fail closed. No quotes, orders, or ledger work are replayed. SQL selection starts from the indexed recent active/migrated universe, preserving priority/cooldown criteria without an artificial token-count cap. Empty age-eligible watch sets skip economic-window ranking entirely.

Tests use actual SQLite and the production runner with explicitly synthetic provider/clock fixtures. Hosted red/green runs and full-suite validation are required; tests do not establish live readiness or profit. Four slots, verified token creation age <=24h, PAPER-only execution, account/history and exits are preserved.
''')
subprocess.run(['git','diff','--check'],check=True)
print('Applied targeted admission/bootstrap repair; no runtime state changed.')
