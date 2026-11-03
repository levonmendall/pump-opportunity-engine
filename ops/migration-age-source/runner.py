from pathlib import Path
root=Path('.')
def rep(s,a,b,n=1):
 assert s.count(a)==n,(a[:100],s.count(a),n)
 return s.replace(a,b)
p=root/'src/pilot-discovery.ts';s=p.read_text()
s=rep(s,'signal:AbortSignal):Promise<PilotMigrationResult>{','signal:AbortSignal,allowCurrentPoolFallback=false):Promise<PilotMigrationResult>{')
s=rep(s,"need(initialDecoded.reason==='MIGRATION_IDENTITY_CREATION_CPI_NOT_VERIFIED',initialDecoded.reason);","need(initialDecoded.reason==='MIGRATION_IDENTITY_CREATION_CPI_NOT_VERIFIED'||allowCurrentPoolFallback,initialDecoded.reason);")
s += "\n/** Live migration-age scope uses the same six-read/20s verified resolver.\n * A shared swap may locate the canonical pool history but never proves age. */\nexport function resolvePumpSwapMigrationAge(seed:PilotMigrationSeed,rpc:PilotMigrationRpc,signal:AbortSignal):Promise<PilotMigrationResult>{return resolvePilotMigration(seed,rpc,signal,true);}\n";p.write_text(s)
p=root/'src/native-candidate-runner.ts';s=p.read_text()
s=rep(s,"import {PumpSwapTokenAgeAdmission,type TokenCreationScope as MarketTokenAgeScope}","import {PumpSwapTokenAgeAdmission,type TokenCreationScope as CreationMarketAgeScope}")
s=rep(s,"import {TOKEN_AGE_POLICY", "import {PumpSwapMigrationAgeAdmission,decodeMigrationAgeProof,type MigrationAgeScope} from './migration-age-policy.js';\ntype MarketTokenAgeScope=CreationMarketAgeScope|MigrationAgeScope;\nimport {TOKEN_AGE_POLICY")
s=rep(s,"import {resolvePilotMigration,", "import {resolvePilotMigration,resolvePumpSwapMigrationAge,")
s=rep(s,'pumpswapOnly?:true;enforceTokenAge24h?:true;marketIntake?', 'pumpswapOnly?:true;enforceTokenAge24h?:true;enforceMigrationAge?:true;marketIntake?')
s=rep(s,'private readonly marketAgeAdmission:PumpSwapTokenAgeAdmission|null;', 'private readonly marketAgeAdmission:PumpSwapTokenAgeAdmission|PumpSwapMigrationAgeAdmission|null;')
s=rep(s,' constructor(private readonly options:NativeRunnerOptions){', ''' constructor(private readonly options:NativeRunnerOptions){
  if(options.enforceMigrationAge){need(options.pumpswapOnly===true,'MIGRATION_AGE_PUMPSWAP_SCOPE_REQUIRED');this.options=options={...options,enforceTokenAge24h:true};}''')
s=rep(s,'this.resolve=options.resolve??resolvePilotMigration;', 'this.resolve=options.resolve??(options.enforceMigrationAge?resolvePumpSwapMigrationAge:resolvePilotMigration);')
s=rep(s,'  this.marketAgeAdmission=options.pumpswapOnly&&options.enforceTokenAge24h?new PumpSwapTokenAgeAdmission(this.registry.tokenCreationScopeSnapshot(this.now(),true)):null;', '''  if(options.enforceMigrationAge)this.registry.useMigrationAge();
  this.marketAgeAdmission=options.enforceMigrationAge?new PumpSwapMigrationAgeAdmission(this.registry.migrationAgeProofSnapshot(this.now())):options.pumpswapOnly&&options.enforceTokenAge24h?new PumpSwapTokenAgeAdmission(this.registry.tokenCreationScopeSnapshot(this.now(),true)):null;''')
s=rep(s,'  this.unsubscribeTokenCreationProof=this.marketAgeAdmission?this.registry.onTokenCreationProofCommitted(proof=>this.marketAgeAdmission!.observeProof(proof)):()=>{};', '''  const admission=this.marketAgeAdmission;
  this.unsubscribeTokenCreationProof=admission instanceof PumpSwapMigrationAgeAdmission?this.registry.onMigrationAgeProofCommitted(proof=>admission.observeProof(proof)):admission?this.registry.onTokenCreationProofCommitted(proof=>admission.observeProof(proof)):()=>{};''')
s=rep(s,'at>=scope.createdAt&&at>=scope.availableAt&&at<=scope.expiresAt',"at>=('eligibleAt' in scope?scope.eligibleAt:scope.createdAt)&&at>=scope.availableAt&&at<=scope.expiresAt")
s=s.replace('this.registry.tokenAgeEligibility(mint,at).allowed','this.registry.marketAgeEligibility(mint,at).allowed').replace('this.registry.tokenAgeEligibility(mint,commitAt).allowed','this.registry.marketAgeEligibility(mint,commitAt).allowed')
s=s.replace("this.marketAgeAdmission!.decision(hint.mint,this.now())!=='unknown'", "this.marketAgeAdmission!.decision(hint.mint,this.now())!==(this.options.enforceMigrationAge?'eligible':'unknown')")
s=s.replace("this.marketAgeAdmission?.decision(mint,commitAt)!=='unknown'", "this.marketAgeAdmission?.decision(mint,commitAt)!==(this.options.enforceMigrationAge?'eligible':'unknown')")
s=rep(s,' private nextVerification(at:number):PilotMigrationSeed|undefined{', ''' private nextVerification(at:number):PilotMigrationSeed|undefined{
  if(this.options.enforceMigrationAge)return this.registry.nextMigrationAgeRequest(at,this.qualificationExclusions());''')
a="const row=this.watch.observeIdentity(signature,{mint:hint.mint,pool,availableAt:hint.receivedAt,evidence:('unverified current-pool scope hint from '+hint.source).slice(0,512)});this.watch.releaseArchiveDeferral"
b="""let row=this.watch.observeIdentity(signature,{mint:hint.mint,pool,availableAt:hint.receivedAt,evidence:('unverified current-pool scope hint from '+hint.source).slice(0,512)});
  if(this.options.enforceMigrationAge){const scope=this.marketAgeAdmission!.scope(hint.mint);need(scope&&'migrationAt' in scope&&scope.pool===pool,'MIGRATION_AGE_ADMISSION_SCOPE_REQUIRED');row=this.watch.verify(row.signature,{mint:hint.mint,pool,migrationAt:scope.migrationAt,verifiedAt:scope.availableAt});}
  this.watch.releaseArchiveDeferral"""
s=rep(s,a,b)
s=rep(s,"if(decision!=='unknown'||this.candidates.has(row.mint)", "if(decision!=='unknown'&&!(this.options.enforceMigrationAge&&decision==='too-young')||this.candidates.has(row.mint)")
s=rep(s,'tokenCreatedAt:this.marketAgeAdmission!.scope(hint.mint)!.createdAt,tokenProofAvailableAt:this.marketAgeAdmission!.scope(hint.mint)!.availableAt', "...('migrationAt' in this.marketAgeAdmission!.scope(hint.mint)!?{migrationAt:(this.marketAgeAdmission!.scope(hint.mint) as MigrationAgeScope).migrationAt,migrationProofAvailableAt:this.marketAgeAdmission!.scope(hint.mint)!.availableAt}:{tokenCreatedAt:(this.marketAgeAdmission!.scope(hint.mint) as CreationMarketAgeScope).createdAt,tokenProofAvailableAt:this.marketAgeAdmission!.scope(hint.mint)!.availableAt})")
needle="  if(this.qualificationEnabled()&&!this.financialOwner(id.baseMint)&&!this.tokenAgeAllowed(id.baseMint,at)){"
s=rep(s,needle,"  if(this.options.enforceMigrationAge){const proof=decodeMigrationAgeProof(origin,at);need(proof&&proof.mint===id.baseMint,'MIGRATION_AGE_PROOF_INVALID');this.registry.putMigrationAgeProof(proof);}\n"+needle)
s=rep(s,"reason:'TOKEN_CREATION_AGE_NOT_ADMITTED'", "reason:this.options.enforceMigrationAge?'MIGRATION_AGE_NOT_ADMITTED':'TOKEN_CREATION_AGE_NOT_ADMITTED'")
needle='  const result=session.result;if(!result)return false;const seed=session.seed,at=this.now();this.verificationSession=null;'
replace='''  const result=session.result;if(!result)return false;const seed=session.seed,at=this.now();
  if(this.options.enforceMigrationAge){
   // A completed result survives pre-callback writer contention. No RPC is
   // repeated merely because the intake writer owns the SQLite lease.
   if(this.stopped||this.sourceAdmissionStopReason!==null||this.verificationSession!==session||session.controller.signal.aborted){this.verificationSession=null;this.record('native-migration-age-result-discarded',{at,signature:seed.signature,reason:'MIGRATION_SOURCE_CHANGED',financialPermission:false});return true;}
   if(seed.feedMint&&(this.observationOwnsMint(seed.feedMint)||this.financialOwner(seed.feedMint))){this.verificationSession=null;this.record('native-migration-age-result-discarded',{at,signature:seed.signature,reason:'MIGRATION_OWNERSHIP_CHANGED',financialPermission:false});return true;}
   if(result.ok){
    const origin={originConfirmed:result.proof.originConfirmed,originFinalized:result.proof.originFinalized},proof=decodeMigrationAgeProof(origin,at);
    if(proof&&proof.mint===seed.feedMint){this.registry.transaction(()=>{this.registry.putMigrationAgeProof(proof);this.storeOrigin(result.identity,origin);});this.counters.verifiedOrigins++;this.record('native-migration-age-verified',{at,...proof,financialPermission:false});}
    else{this.registry.deferMigrationAgeRequest(seed,at,'MIGRATION_AGE_PROOF_INVALID');this.counters.verificationRefusals++;this.record('native-migration-age-unavailable',{at,seed,reason:'MIGRATION_AGE_PROOF_INVALID',financialPermission:false});}
   }else{this.registry.deferMigrationAgeRequest(seed,at,result.reason);this.counters.verificationRefusals++;this.record('native-migration-age-unavailable',{at,seed,reason:result.reason,financialPermission:false});}
   this.verificationSession=null;this.record('native-origin-workflow-settled',{at,signature:seed.signature,startedAt:session.startedAt,elapsedMs:at-session.startedAt,reads:session.reads,result:result.ok?'verified':result.reason,ageBasis:'verified-pumpswap-migration',partialProofAdmitted:false});return true;
  }
  this.verificationSession=null;'''
s=rep(s,needle,replace)
needle='  let session=this.verificationSession;\n  if(!session){this.counters.verificationAttempts++;'
replace='''  let session=this.verificationSession;
  if(!session&&this.options.enforceMigrationAge&&seed.feedMint){
   if(this.observationOwnsMint(seed.feedMint)||this.financialOwner(seed.feedMint))return;
   const retained=this.registry.getOrigin<NativeOrigin>(seed.feedMint),proof=retained&&decodeMigrationAgeProof(retained,this.now());
   if(proof&&proof.mint===seed.feedMint){this.registry.putMigrationAgeProof(proof);this.record('native-migration-age-restored',{at:this.now(),...proof,providerRequests:0,financialPermission:false});return;}
   this.registry.deferMigrationAgeRequest(seed,this.now(),'MIGRATION_AGE_REQUEST_PENDING');
  }
  if(!session){this.counters.verificationAttempts++;'''
s=rep(s,needle,replace)
s=rep(s,'  if(!row.mint||!row.pool)return;\n  const origin=this.currentPoolObservation?undefined:this.origin(row.mint);','''  if(!row.mint||!row.pool)return;
  if(this.options.enforceMigrationAge){
   const scope=this.marketAgeAdmission?.scope(row.mint);
   if(!scope||!('migrationAt' in scope)||scope.pool!==row.pool)return;
   const identity:NativeObservationIdentity={schemaVersion:1,baseMint:scope.mint,pool:scope.pool,migrationAt:scope.migrationAt,migrationVerified:true,identityBasis:'retained-verified-metadata',identityAvailableAt:scope.availableAt,identityEvidence:'verified PumpSwap migration '+scope.signature,minimumSlot:scope.slot};
   assertNativeObservationIdentity(identity,this.now());return identity;
  }
  const origin=this.currentPoolObservation?undefined:this.origin(row.mint);''')
s=rep(s,'let creation=this.options.enforceTokenAge24h&&','let creation=!this.options.enforceMigrationAge&&this.options.enforceTokenAge24h&&')
s=rep(s,'let creationHistory=this.options.pumpswapOnly&&','let creationHistory=!this.options.enforceMigrationAge&&this.options.pumpswapOnly&&')
s=rep(s,"...(this.options.enforceTokenAge24h?{tokenAgeScope:this.registry.tokenAgeSummary(at)}:{})", "...(this.options.enforceMigrationAge?{migrationAgeScope:this.registry.migrationAgeSummary(at)}:{}),...(!this.options.enforceMigrationAge&&this.options.enforceTokenAge24h?{tokenAgeScope:this.registry.tokenAgeSummary(at)}:{})");p.write_text(s)
p=root/'src/market-registry-intake-worker.ts';s=p.read_text()
s=rep(s,'enforceTokenAge24h?:true};','enforceTokenAge24h?:true;enforceMigrationAge?:true};')
s=rep(s,"{concurrentIntake:true,writerRole:'intake',", "{concurrentIntake:true,writerRole:'intake',...(options.enforceMigrationAge?{migrationAge:true as const}:{}),")
s=rep(s,'enforceTokenAge24h:options.enforceTokenAge24h===true,','enforceTokenAge24h:options.enforceTokenAge24h===true,enforceMigrationAge:options.enforceMigrationAge===true,')
s=rep(s,'  if(!options.enforceTokenAge24h)return null;','  if(!options.enforceTokenAge24h&&!options.enforceMigrationAge)return null;')
needle="  const proof=registry.tokenCreationProof(mint);if(!proof)return 'TOKEN_AGE_UNVERIFIED';"
s=rep(s,needle,"  if(options.enforceMigrationAge){const received=registry.marketAgeEligibility(mint,receivedAt);if(!received.allowed)return received.reason;const current=registry.marketAgeEligibility(mint,at);return current.allowed?null:current.reason;}\n"+needle);p.write_text(s)
p=root/'src/run-native-paper.ts';s=p.read_text()
s=rep(s,"import {TOKEN_AGE_POLICY", "import {MIGRATION_AGE_POLICY,migrationAgeDecision} from './migration-age-policy.js';\nimport {TOKEN_AGE_POLICY")
s=s.replace('tokenAgePolicy:TOKEN_AGE_POLICY','migrationAgePolicy:MIGRATION_AGE_POLICY')
s=s.replace('marketRegistry?.tokenAgeEligibility(mint,at)??tokenAgeDecision(mint,at,null)','marketRegistry?.marketAgeEligibility(mint,at)??migrationAgeDecision(mint,at,null)')
s=rep(s,"{concurrentIntake:service,...(registryWriterTurn?", "{concurrentIntake:service,...(service&&args.strategy===LIQUIDITY_RESILIENT_MOMENTUM_V31_VERSION?{migrationAge:true as const}:{}),...(registryWriterTurn?")
s=s.replace('{enforceTokenAge24h:true}', '{enforceMigrationAge:true}')
s=s.replace('{enforceTokenAge24h:true as const,pumpswapOnly:true as const}', '{enforceMigrationAge:true as const,pumpswapOnly:true as const}')
needle="additionalMeanings:[...(engine?.tokenAgeScope?"
s=rep(s,needle,"additionalMeanings:[...(engine?.migrationAgeScope?[`New-entry scope: verified PumpSwap migration age from 1 minute through 24 hours, inclusive; ${engine.migrationAgeScope.eligible} eligible, ${engine.migrationAgeScope.pendingVerification} awaiting verification. Mint creation time is not used. Existing holdings keep their exit policy.`]:[]),...(engine?.tokenAgeScope?")
s=s.replace('...(engine?.tokenAgeScope?{tokenAgeScope:engine.tokenAgeScope}:{}),','...(engine?.migrationAgeScope?{migrationAgeScope:engine.migrationAgeScope}:{}),...(engine?.tokenAgeScope?{tokenAgeScope:engine.tokenAgeScope}:{}),');p.write_text(s)
p=root/'src/dashboard.ts';s=p.read_text().replace("'New tokens · current UTC hour'","'Newly admitted tokens · current UTC hour'").replace("'New tokens discovered · current UTC hour'","'Newly admitted tokens · current UTC hour'")
s=s.replace('Lightweight classification uses available shared facts and does not imply complete market data or economic qualification.','The hourly count is newly admitted registry identities, not all on-chain launches or migrations. Lightweight classification uses available shared facts and does not imply complete market data or economic qualification.');p.write_text(s)
