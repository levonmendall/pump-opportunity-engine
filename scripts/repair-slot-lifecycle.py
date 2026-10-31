"""Apply the reviewed slot-lifecycle changes to the exact pre-repair source.
Run only in a disposable checkout; each replacement must match exactly once.
This script has no EC2, provider, credential or financial-database access.
"""
from pathlib import Path
import json

def edit(path, fn):
    p=Path(path); old=p.read_text(); new=fn(old)
    assert new!=old,path
    p.write_text(new)

def replace(s,a,b):
    assert s.count(a)==1, (a[:100],s.count(a))
    return s.replace(a,b,1)

def registry(s):
    s=replace(s,' private readDepth=0;', ' private rollbackActions:Array<()=>void>=[];private commitActions:Array<()=>void>=[];\n private readDepth=0;')
    s=replace(s,' private write<T>(fn:()=>T):T {', ''' /** Hooks are for bounded nonfinancial in-memory mirrors and subscription
  * ownership only. Nested callers share the outer commit/rollback boundary. */
 onRollback(undo:()=>void){if(this.readDepth||!this.transactionDepth)throw new MarketRegistryReadOnlyViolation('Rollback hook requires a write transaction');this.rollbackActions.push(undo);}
 afterCommit(action:()=>void){if(this.readDepth||!this.transactionDepth)throw new MarketRegistryReadOnlyViolation('Commit hook requires a write transaction');this.commitActions.push(action);}
 private write<T>(fn:()=>T):T {''')
    s=replace(s,'  this.economicTouchedMints.clear();this.transactionAttempts++;const start=', '  this.rollbackActions=[];this.commitActions=[];let result!:T;\n  this.economicTouchedMints.clear();this.transactionAttempts++;const start=')
    s=replace(s,'});const result=this.concurrentIntake?transaction.immediate():transaction();','});result=this.concurrentIntake?transaction.immediate():transaction();')
    s=replace(s,'this.writerLeaseReadOnlyCommits++;}return result;','this.writerLeaseReadOnlyCommits++;}this.rollbackActions=[];')
    s=replace(s,'  }catch(error){failed=true;this.failedTransactions++;', '  }catch(error){const undo=this.rollbackActions.splice(0).reverse();this.commitActions=[];for(const restore of undo)restore();failed=true;this.failedTransactions++;')
    s=replace(s,'this.writeMaximumMs=Math.max(this.writeMaximumMs,elapsed);}}\n }', '''this.writeMaximumMs=Math.max(this.writeMaximumMs,elapsed);}}
  // SQLite has committed and the lease is released. A post-commit callback
  // failure cannot undo the durable transaction or be retried as lease refusal.
  const committed=this.commitActions.splice(0);for(const action of committed)action();return result;
 }''')
    return s
edit('src/market-registry.ts',registry)

def watch(s):
    a='const prior=this.persistentState(),saved=this.savedPersistentState;try{return this.options.registry.transaction(()=>{const result=run();'
    b="const prior=this.persistentState(),saved=this.savedPersistentState,admissions=new Map(this.capacityAdmissions);const restore=()=>{this.counters=prior.counters;this.capacityProbeAdmissions=prior.capacityProbeAdmissions;this.entryAgePromotionCount=prior.entryAgePromotionCount;this.savedPersistentState=saved;this.capacityAdmissions.clear();for(const [key,value]of admissions)this.capacityAdmissions.set(key,value);};try{return this.options.registry.transaction(()=>{this.options.registry!.onRollback(restore);const result=run();"
    s=replace(s,a,b)
    s=replace(s,'}catch(error){this.counters=prior.counters;this.capacityProbeAdmissions=prior.capacityProbeAdmissions;this.entryAgePromotionCount=prior.entryAgePromotionCount;this.savedPersistentState=saved;throw error;}','}catch(error){restore();throw error;}')
    a='(this as any)[name]=(...args:unknown[])=>this.observationAgePolicy'
    b="(this as any)[name]=(...args:unknown[])=>name==='technicalReevaluation'?this.readTechnicalReevaluation(args,original):this.observationAgePolicy"
    s=replace(s,a,b)
    a='  private emit(kind:string,data:unknown)'
    b='''  /** Ordinary sorting/readiness polls do not need an exclusive writer when
   * there is no ticket or no expiry/backoff migration to persist. Recheck under
   * the normal write lease only for an actual ticket mutation. */
  private readTechnicalReevaluation(args:unknown[],original:(...args:unknown[])=>unknown){
    const mint=args[0] as string,at=args[1]===undefined?this.clock():args[1] as number;
    this.at(at);need(at<=this.clock(),'PILOT_WATCH_TECHNICAL_REEVALUATION_TIME');
    const ticket=this.readOperation(()=>copy(this.row(mint)?.technicalReevaluation??null));
    const changes=!!ticket&&(['WAITING','CLAIMED'].includes(ticket.state)&&at>=ticket.expiresAt||ticket.state==='WAITING'&&at>=ticket.requestedAt&&ticket.notBefore>at);
    return changes?this.operation(()=>original(...args)):ticket;
  }
  private emit(kind:string,data:unknown)'''
    return replace(s,a,b)
edit('src/pilot-watch.ts',watch)

def prod(s):
    a='  try{return this.options.registry.transaction(fn);}catch(error){for(let i=0;i<this.slots.length;i++)Object.assign(this.slots[i]!,before.slots[i]!);Object.assign(this.durations,before.durations);Object.assign(this.counts,before.counts);Object.assign(this.failureCounts,before.failureCounts);this.serial=before.serial;this.verifiedEvidenceMs=before.verifiedEvidenceMs;throw error;}'
    b='  const restore=()=>{for(let i=0;i<this.slots.length;i++)Object.assign(this.slots[i]!,before.slots[i]!);Object.assign(this.durations,before.durations);Object.assign(this.counts,before.counts);Object.assign(this.failureCounts,before.failureCounts);this.serial=before.serial;this.verifiedEvidenceMs=before.verifiedEvidenceMs;};\n  try{return this.options.registry.transaction(()=>{this.options.registry.onRollback(restore);return fn();});}catch(error){restore();throw error;}'
    s=replace(s,a,b)
    return replace(s,' private live(mint:string)'," assignedMints(){return this.slots.flatMap(slot=>slot.mint?[slot.mint]:[]); }\n hasAssignment(mint:string,allocatedAt:number){const slot=this.live(mint);return !!slot&&slot.allocatedAt===allocatedAt;}\n private live(mint:string)")
edit('src/native-slot-productivity.ts',prod)
edit('src/pilot-native-flow.ts',lambda s:replace(s," removeCandidate(mint:string,reason=", " /** Selected scopes only; retiring scopes retain physical capacity until ACK/close. */\n candidateMints(){return [...this.candidates.keys()];}\n removeCandidate(mint:string,reason="))

def runner(s):
    s=replace(s,"'servicePlan'|'captureState'", "'servicePlan'|'captureState'|'candidateMints'")
    s=replace(s,' private readonly cancelledAuditDiagnostics:', ' private readonly retirementRequests=new Map<string,{candidate:Candidate;reason:string;at:number;deferMs:number}>();\n private readonly cancelledAuditDiagnostics:')
    start=s.index(' private retire(mint:'); end=s.index(' private async drainCancelledAuditDiagnostics',start)
    s=s[:start]+''' /** Persist logical retirement as one write before changing native ownership.
  * A refused lease retains the exact generation and blocks its further audits;
  * physical occupancy is released only by the native unsubscribe/close ACK. */
 private retire(mint:string,reason:string,at:number,deferMs:number){
  this.certificates.delete(mint);const c=this.candidates.get(mint);if(!c)return true;
  this.retirementRequests.set(mint,{candidate:c,reason,at,deferMs});return this.commitRetirement(mint);
 }
 private commitRetirement(mint:string){
  const request=this.retirementRequests.get(mint);if(!request)return true;
  const c=request.candidate;if(this.candidates.get(mint)!==c){this.retirementRequests.delete(mint);return true;}
  let callbackStarted=false;
  try{this.registry.transaction(()=>{
   callbackStarted=true;const {reason,deferMs}=request,at=Math.max(request.at,this.now());
   const row=this.watch.lookupIdentity(mint,at),owned=this.options.financialOwnership?.(mint);
   if(row&&(owned||!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state)))this.watch.transition(mint,owned??'DEFERRED',reason,at,{deferUntil:Math.max(row.deferUntil,at+deferMs)});
   this.productivity.retired(mint,at,reason);
   this.registry.afterCommit(()=>{
    if(this.candidates.get(mint)!==c)return;
    this.finishAuditDispatch(c,'candidate-retired:'+reason,at);
    if(c.auditSession){const active=c.auditSession;active.session.cancel('NATIVE_AUDIT_CANDIDATE_RETIRED');need(this.cancelledAuditDiagnostics.length<6,'NATIVE_AUDIT_DIAGNOSTIC_BOUND');this.cancelledAuditDiagnostics.push({mint,targetEndAt:active.windowEndAt,deadlineAt:active.deadlineAt,cancelledAt:at,session:active.session});}
    delete c.auditSession;this.candidates.delete(mint);this.retirementRequests.delete(mint);
    this.options.flow.removeCandidate(mint,reason);this.options.onCandidateRetired?.(mint,reason);
    this.record('native-candidate-retired',{mint,at,reason,allocatedAt:c.allocatedAt,openedAt:c.openedAt,awarenessRetained:true,completeWindows:c.lastAssessmentEnd?1:0});
   });
  });return true;}catch(error){if(!callbackStarted&&isMarketRegistryContention(error))return false;throw error;}
 }
 private observationMember(c:Candidate,at:number){
  const mint=c.identity.baseMint;if(this.candidates.get(mint)!==c||this.retirementRequests.has(mint))return false;
  const row=this.watch.lookupIdentity(mint,at);
  return !!row&&row.pool===c.identity.pool&&row.deepSince===c.allocatedAt&&['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'].includes(row.state)&&this.productivity.hasAssignment(mint,c.allocatedAt);
 }
 private reconcileObservationMembership(){
  for(const mint of this.retirementRequests.keys())if(!this.commitRetirement(mint))return false;
  for(const c of [...this.candidates.values()])if(!this.observationMember(c,this.now())){
   const mint=c.identity.baseMint;this.record('native-candidate-membership-invalid',{at:this.now(),mint,allocatedAt:c.allocatedAt,action:'retire-original-generation',freshObservationRequired:true,financialPermission:false});
   if(!this.retire(mint,'observation membership mismatch; fresh allocation required',this.now(),0))return false;
  }
  // Recovery from a partial old transition must retire, not adopt, a physical
  // scope lacking a coordinator owner. Never manufacture a warm observation.
  const orphans=new Set([...(this.options.flow.candidateMints?.()??[]),...this.productivity.assignedMints(),...this.watch.identitiesInStates(['DEEP_OBSERVATION','QUALIFIED','ENTRY_PENDING'],this.now()).filter(row=>row.deepSince!==null).flatMap(row=>row.mint?[row.mint]:[])]);
  for(const mint of orphans)if(!this.candidates.has(mint)){
   let started=false;
   try{this.registry.transaction(()=>{
    started=true;const at=this.now(),row=this.watch.lookupIdentity(mint,at),owned=this.options.financialOwnership?.(mint);
    if(row&&!['EXPIRED','PERMANENTLY_UNSUPPORTED'].includes(row.state))this.watch.transition(mint,owned??(['HELD','ENTRY_PENDING'].includes(row.state)?row.state:'DEFERRED'),'orphan observation owner; fresh allocation required',at,{deferUntil:Math.max(row.deferUntil,at)});
    this.productivity.retired(mint,at,'orphan observation owner');this.certificates.delete(mint);
    this.registry.afterCommit(()=>{this.options.flow.removeCandidate(mint,'orphan selected scope; native settlement required');this.options.onCandidateRetired?.(mint,'orphan observation owner');this.record('native-candidate-orphan-retired',{at,mint,physicalCapacityReleased:false,financialPermission:false});});
   });}catch(error){if(!started&&isMarketRegistryContention(error))return false;throw error;}
  }
  return true;
 }
''' +s[end:]
    a="   this.options.flow.addCandidate({mint:id.baseMint"
    start=s.index(a);end=s.index('\n  }\n }\n /** This prerequisite',start)
    old=s[start:end]
    mapstart=old.index('this.candidates.set');mapend=old.index(';this.productivity.allocated',mapstart)
    mapset=old[mapstart:mapend]+';'
    add=old[:old.index('\n')].strip()
    new='''   // Acquire the writer before any slot/transport mirror is changed. Hooks
   // restore watch/productivity mirrors if an outer transaction rolls back.
   this.registry.transaction(()=>{
    const waitingSince=this.watch.allocationReadySince(id.baseMint,at,{requireOrigin:!this.currentPoolObservation})??at;
    this.watch.transition(id.baseMint,'DEEP_OBSERVATION','fresh native confirmed pool observation allocated; no financial permission',at);
    this.productivity.allocated(id.baseMint,at,waitingSince,row.promotions);this.registry.markStage(id.baseMint,'deep-admitted',at);
    this.registry.afterCommit(()=>{
     '''+mapset+'\n     try{'+add+'''
      this.maximumSimultaneous=Math.max(this.maximumSimultaneous,this.candidates.size);this.options.onCandidateAllocated?.(structuredClone(id));
     }catch(error){this.retire(id.baseMint,'native allocation setup failed; fresh allocation required',this.now(),0);throw error;}
    });
   });'''
    s=s[:start]+new+s[end:]
    s=replace(s,'   this.reconcileFlowOpen();','   if(!this.reconcileObservationMembership()){this.lastOutcome=\'MARKET_REGISTRY_CONTENTION\';return \'wait\';}\n   this.reconcileFlowOpen();')
    s=replace(s,'return [...this.candidates.values()].flatMap(candidate=>{const view=', 'return [...this.candidates.values()].filter(c=>this.observationMember(c,at)).flatMap(candidate=>{const view=')
    s=replace(s,"at>certificate.deadlineAt)return null;","at>certificate.deadlineAt||!this.observationMember(c,at))return null;")
    s=replace(s,'if(this.candidates.get(mint)!==c)return;\n  if(sessionFailure)',"if(this.candidates.get(mint)!==c)return;\n  if(!this.observationMember(c,availableAt)){this.retire(mint,'audit result lost deep-observation membership; fresh allocation required',availableAt,0);return;}\n  if(sessionFailure)")
    s=replace(s,'  if(Number.isSafeInteger(current.connectionId)', '  this.watch.noteWindow(mint,availableAt);\n  if(Number.isSafeInteger(current.connectionId)')
    s=replace(s,'this.decisions.shift();this.watch.noteWindow(mint,availableAt);','this.decisions.shift();')
    s=replace(s,"private drainCommittedActivity(){if(!this.options.marketIntake||!this.committedActivityPending||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs))return;const began=performance.now();", "private drainCommittedActivity(){if(!this.options.marketIntake||!this.committedActivityPending||!this.sourceWorkAllowed(NATIVE_DEADLINE_POLICY.postValidationMs))return;if(!this.registry.nextWatchActivities(1).length){this.committedActivityPending=false;return;}const began=performance.now();")
    return s
edit('src/native-candidate-runner.ts',runner)
with Path('test/native-candidate-runner.test.ts').open('a') as f:
    f.write('\n'+Path('scripts/slot-lifecycle-regressions.txt').read_text())
print(json.dumps({'changedFiles':['src/market-registry.ts','src/pilot-watch.ts','src/native-slot-productivity.ts','src/pilot-native-flow.ts','src/native-candidate-runner.ts'],'financialChanges':False,'slots':4}))
