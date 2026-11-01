#!/usr/bin/env python3
"""Reviewable source authoring only. No EC2, provider or financial access."""
from pathlib import Path
import hashlib
ROOT=Path.cwd()
EXPECTED={'src/ledger.ts':'f6f06cb14c23c4454b43a308bc74d446ad94c50e45e6f7f63df093153f494bd0','src/trader.ts':'eb7706ef279915488c22055666f15def59852c30a031bbec74c8346b4fd92f07','src/run-native-paper.ts':'d7c2c91657d72719d918f9ef1af3430e96e3ed7c62d7cb1e0acfebb5dc3addd2','test/reviewed-candidate-control-lineage.test.ts':'6636c64042fbbcb3e5b2a2e19601c7a0d3a8925ac00b844908c27e15316ce2c7','test/trader.test.ts':'d7f66274c7a146ad8d7c51fcbfc96da66031ccd99fa0004285890a0397fd2167'}
outputs={}
def load(path):
 p=ROOT/path
 if p.is_symlink():raise RuntimeError('SYMLINK_REFUSED:'+path)
 raw=p.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=EXPECTED[path]:raise RuntimeError('EXACT_BASE_REQUIRED:'+path)
 return raw.decode()
def change(s,old,new):
 if s.count(old)!=1:raise RuntimeError('UNIQUE_ANCHOR_REQUIRED:'+old[:90])
 return s.replace(old,new)
p='src/ledger.ts';s=load(p)
s=change(s,' * One owner-reviewed, source-versioned exception to a historical *local',' * Finite owner-reviewed, source-versioned exceptions to historical *local')
s=change(s,' anchorAt:1793480966760,\n sourcePauseRevision'," anchorAt:1793480966760,\n anchorActionId:'native-paper-operating-financial-ready:190148:1793480966760',\n sourcePauseActionId:'trader:pause:190298:1793481124040',\n sourcePauseRevision")
s=change(s,'''export function reviewedCandidateControlLineage(state:State,history:OperatingControlHistory|null):boolean {
 const c=REVIEWED_CANDIDATE_CONTROL_INCIDENT,h=history;''','''/** Owner request 2026-11-01 UTC: recover this verified inherited incident.
 * Source exception was not retained; this is an explicit incident review, not
 * a declaration that the old error was harmless or all future errors transient.
 * The +1 ms in sourcePauseActionId is present in the authenticated action.
 * This proof grants no trade or financial permission by itself.
 */
export const REVIEWED_CANDIDATE_CONTROL_INCIDENT_20261101=Object.freeze({
 accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',
 inceptionAt:1793052456212,
 epochId:'poe-paper-10sol-v3-20261030',
 originSource:'f8ab5d74c5f8c8e792ab0b099388a6f3ad68d2d2',
 anchorRevision:201388,
 anchorAt:1793493697261,
 anchorActionId:'native-paper-operating-financial-ready:201387:1793493697261',
 sourcePauseRevision:202366,
 sourcePauseAt:1793494775698,
 sourcePauseActionId:'trader:pause:202365:1793494775699',
 sourcePauseReason:'native candidate financial evaluation unavailable',
 startupRevision:202420,
 startupAt:1793495044518,
 restoreRevision:202421,
 restoreAt:1793495044523,
} as const);
type ReviewedCandidateIncident=typeof REVIEWED_CANDIDATE_CONTROL_INCIDENT|typeof REVIEWED_CANDIDATE_CONTROL_INCIDENT_20261101;
function reviewedCandidateControlLineageFor(state:State,history:OperatingControlHistory|null,c:ReviewedCandidateIncident):boolean {
 const h=history;''')
s=change(s,"||h.anchor?.kind!=='resume'||h.anchor.revision!==c.anchorRevision||h.anchor.at!==c.anchorAt\n","||h.anchor?.kind!=='resume'||h.anchor.revision!==c.anchorRevision||h.anchor.at!==c.anchorAt||h.anchor.actionId!==c.anchorActionId\n")
s=change(s,"'trader:pause:190298:1793481124040',c.sourcePauseReason,'ordinary')","c.sourcePauseActionId,c.sourcePauseReason,'ordinary')")
s=change(s,"'execution-recovery:'+c.accountId+':190463','execution startup: fresh reconciliation/readiness required','startup')","'execution-recovery:'+c.accountId+':'+(c.startupRevision-1),'execution startup: fresh reconciliation/readiness required','startup')")
s=change(s,"'trader:restore-hard-pause:190464:1793481488425',c.sourcePauseReason,'restored')","'trader:restore-hard-pause:'+c.startupRevision+':'+c.restoreAt,c.sourcePauseReason,'restored')")
s=change(s,'\n\nfunction validateLedgerEpochAnchor','''
export function reviewedCandidateControlLineage(state:State,history:OperatingControlHistory|null):boolean {
 return reviewedCandidateControlLineageFor(state,history,REVIEWED_CANDIDATE_CONTROL_INCIDENT)
     ||reviewedCandidateControlLineageFor(state,history,REVIEWED_CANDIDATE_CONTROL_INCIDENT_20261101);
}

function validateLedgerEpochAnchor''')
outputs[p]=s
p='src/trader.ts';s=load(p)
s=change(s,'export type AdaptiveHoldingDiagnosticsRow=',"export type CandidateEvaluationFailureDiagnostic=Omit<FinancialMaintenanceFailureDiagnostic,'version'|'phase'>&{version:'candidate-financial-evaluation-failure-v1';phase:'dispatch'|'candidate-evaluation'};\nexport type AdaptiveHoldingDiagnosticsRow=")
s=change(s,'  private firstMaintenanceFailure:FinancialMaintenanceFailureDiagnostic|null=null;','  private firstMaintenanceFailure:FinancialMaintenanceFailureDiagnostic|null=null;\n  private firstCandidateFailure:CandidateEvaluationFailureDiagnostic|null=null;')
s=change(s,'  financialMaintenanceFailureDiagnostics(){return this.firstMaintenanceFailure?{...this.firstMaintenanceFailure}:null;}','''  financialMaintenanceFailureDiagnostics(){return this.firstMaintenanceFailure?{...this.firstMaintenanceFailure}:null;}
  /** Preserve the existing hard latch, recording only a bounded fingerprint and
   * known SQLite code. A new failure never inherits an older incident review. */
  candidateEvaluationFailed(error:unknown,phase:'dispatch'|'candidate-evaluation',attemptedStateRevision:number){
    const first=this.firstCandidateFailure===null;
    if(first)this.firstCandidateFailure={...maintenanceFailureDiagnostic(this.clock(),'runtime-failure',error,attemptedStateRevision),version:'candidate-financial-evaluation-failure-v1',phase};
    try{this.pause('native candidate financial evaluation unavailable');}
    finally{if(first)try{this.options.recorder.record('trader-candidate-financial-evaluation-failed',this.firstCandidateFailure);}catch{this.evidenceUnavailable=true;}}
  }
  candidateEvaluationFailureDiagnostics(){return this.firstCandidateFailure?{...this.firstCandidateFailure}:null;}''')
outputs[p]=s
p='src/run-native-paper.ts';s=load(p)
s=change(s,"if(kind==='trader-financial-maintenance-failed'||kind==='trader-config'","if(kind==='trader-candidate-financial-evaluation-failed'||kind==='trader-financial-maintenance-failed'||kind==='trader-config'")
s=change(s,'maintenanceFailure:currentBridge.trader.financialMaintenanceFailureDiagnostics()},observationAgePolicy','maintenanceFailure:currentBridge.trader.financialMaintenanceFailureDiagnostics(),candidateFailure:currentBridge.trader.candidateEvaluationFailureDiagnostics()},observationAgePolicy')
s=change(s,"const evaluatedBefore=currentBridge.trader.funnel.evaluated;workOwner.set('candidate');try{financialHandoff.dispatch(currentCertificate,Date.now());await asyncPhase('candidate-entry-preparation',9000,()=>currentBridge.candidate(candidate,true));}catch{currentBridge.trader.pauseNewEntries('native candidate financial evaluation unavailable');}","const evaluatedBefore=currentBridge.trader.funnel.evaluated,candidateRevision=currentLedger.state().revision;let candidatePhase:'dispatch'|'candidate-evaluation'='dispatch';workOwner.set('candidate');try{financialHandoff.dispatch(currentCertificate,Date.now());candidatePhase='candidate-evaluation';await asyncPhase('candidate-entry-preparation',9000,()=>currentBridge.candidate(candidate,true));}catch(error){currentBridge.trader.candidateEvaluationFailed(error,candidatePhase,candidateRevision);}")
outputs[p]=s
p='test/reviewed-candidate-control-lineage.test.ts';s=load(p)
s=change(s,'REVIEWED_CANDIDATE_CONTROL_INCIDENT as c,reviewedCandidateControlLineage','REVIEWED_CANDIDATE_CONTROL_INCIDENT as c,REVIEWED_CANDIDATE_CONTROL_INCIDENT_20261101 as current,reviewedCandidateControlLineage')
s+='''
function currentFixture(){
 const f=fixture();f.state.controls.changedAt=current.restoreAt;
 f.history.anchor={...f.history.anchor,revision:current.anchorRevision,at:current.anchorAt,actionId:current.anchorActionId};
 f.history.decoded=[
  pause(current.sourcePauseRevision,current.sourcePauseAt,current.sourcePauseActionId,reason,'ordinary'),
  pause(current.startupRevision,current.startupAt,'execution-recovery:'+account+':'+(current.startupRevision-1),temporary,'startup'),
  pause(current.restoreRevision,current.restoreAt,'trader:restore-hard-pause:'+current.startupRevision+':'+current.restoreAt,reason,'restored')];
 return f;
}
test('owner-reviewed November 1 incident allows readiness review, never directly arms or trades',()=>{
 const {state,history}=currentFixture(),before=structuredClone(state);
 assert.equal(current.originSource,'f8ab5d74c5f8c8e792ab0b099388a6f3ad68d2d2');
 assert.equal(reviewedCandidateControlLineage(state,history),true);assert.deepEqual(state,before);
 history.decoded.push(pause(203001,1793496000000,'execution-recovery:'+account+':203000',temporary,'startup'));
 state.controls.reason=temporary;state.controls.changedAt=1793496000000;
 assert.equal(reviewedCandidateControlLineage(state,history),true);
 history.decoded.push(pause(203002,1793496000001,'trader:restore-hard-pause:203001:1793496000001',reason,'restored'));
 state.controls.reason=reason;state.controls.changedAt=1793496000001;
 assert.equal(reviewedCandidateControlLineage(state,history),true);
});
test('new incident requires its exact action, millisecond boundary and unchanged flat financial intent',()=>{
 const cases:[string,(s:LedgerState,h:any)=>void][]=[
 ['different account',s=>{s.accountId='other';}],['different inception',s=>{s.inceptionAt++;}],
 ['different epoch',s=>{(s.paperEpoch as any).id='other';}],['funded mode',s=>{(s as any).mode='LIVE';}],
 ['owner stop',s=>{s.controls.stopRequested=true;}],['enabled already',s=>{s.controls.entriesEnabled=true;}],
 ['holding',s=>{(s.positions as any).held={};}],['pending',s=>{(s.pending as any).pending={};}],
 ['loss stop',s=>{s.daily.lossPaused=true;}],['new anchor',(_s,h)=>{h.anchor.revision++;}],
 ['anchor ID',(_s,h)=>{h.anchor.actionId='owner-resume';}],['pause time',(_s,h)=>{h.decoded[0].row.at++;}],
 ['one ms action difference',(_s,h)=>{h.decoded[0].row.actionId='trader:pause:202365:1793494775698';}],
 ['different reason',(_s,h)=>{h.decoded[0].payload.reason='owner paused new entries';}],
 ['canceled pending buy',(_s,h)=>{h.decoded[0].result.pendingBuyCancellations.push('buy-1');}],
 ['restore revision',(_s,h)=>{h.decoded[2].row.revision++;}],['current time',s=>{s.controls.changedAt++;}],
 ['new same-text hard failure',(s,h)=>{const at=1793496000000;h.decoded.push(pause(203001,at,'trader:pause:203000:'+at,reason,'ordinary'));s.controls.changedAt=at;}],
 ['new other hard failure',(s,h)=>{const at=1793496000000;h.decoded.push(pause(203001,at,'trader:pause:203000:'+at,'financial maintenance unavailable; preserve records and close entries','ordinary'));s.controls.changedAt=at;s.controls.reason='financial maintenance unavailable; preserve records and close entries';}],
 ['safe stop',(s,h)=>{const at=1793496000000;h.decoded.push({...pause(203001,at,'owner-stop','safe stop requested','ordinary'),row:{...h.decoded[2].row,kind:'safe-stop',revision:203001,at}});s.controls.changedAt=at;s.controls.reason='safe stop requested';}]
 ];
 for(const [name,mutate]of cases){const f=currentFixture();mutate(f.state,f.history);assert.equal(reviewedCandidateControlLineage(f.state,f.history),false,name);}
});
'''
outputs[p]=s
p='test/trader.test.ts';s=load(p)
s+='''
test('candidate failures retain a sanitized first diagnostic and still hard-close new entries',t=>{
 const f=fixture(t);f.ready();const before=f.ledger.state();
 f.trader.candidateEvaluationFailed(Object.assign(new Error('provider https://fixture.invalid/?secret=never-log-this'),{code:'SQLITE_BUSY'}),'candidate-evaluation',before.revision);
 const d=f.trader.candidateEvaluationFailureDiagnostics();assert.ok(d);
 assert.equal(d.version,'candidate-financial-evaluation-failure-v1');assert.equal(d.phase,'candidate-evaluation');
 assert.equal(d.sqliteCode,'SQLITE_BUSY');assert.match(d.errorSha256!,/^[a-f0-9]{64}$/);assert.equal(d.attemptedStateRevision,before.revision);
 assert.equal(d.commitOutcome,'unknown');assert.equal(f.ledger.state().controls.entriesEnabled,false);
 assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.equal(f.trader.entryReadinessSafety().newHardPauseObserved,true);
 assert.equal(f.ledger.state().lamports,before.lamports);assert.deepEqual(f.ledger.state().positions,before.positions);assert.deepEqual(f.ledger.state().pending,before.pending);
 const events=f.records().filter(r=>r.kind==='trader-candidate-financial-evaluation-failed');assert.equal(events.length,1);
 assert.ok(!JSON.stringify(events).includes('never-log-this'));assert.ok(!JSON.stringify(events).includes('https://'));
 f.set(f.now()+1);f.trader.candidateEvaluationFailed(new Error('another failure'),'dispatch',before.revision);
 assert.deepEqual(f.trader.candidateEvaluationFailureDiagnostics(),d,'retain actual first fingerprint');
 assert.equal(f.records().filter(r=>r.kind==='trader-candidate-financial-evaluation-failed').length,1);
});
test('candidate diagnostic recorder failure cannot reopen or erase the hard safety latch',t=>{
 const f=fixture(t);f.ready();f.recorder.record=()=>{throw Error('fixture evidence unavailable');};
 f.trader.candidateEvaluationFailed(Object.assign(new Error('unknown'),{code:'SECRET_VALUE'}),'dispatch',f.ledger.state().revision);
 assert.equal(f.ledger.state().controls.entriesEnabled,false);assert.equal(f.trader.entryReadinessSafety().evidenceAvailable,false);
 assert.equal(f.trader.entryReadinessSafety().automaticRecoveryAllowed,false);assert.equal(f.trader.candidateEvaluationFailureDiagnostics()!.sqliteCode,null);
});
'''
outputs[p]=s
outputs['docs/CANDIDATE_PAUSE_RECOVERY_20261101.md']='''# Reviewed candidate-pause recovery, November 1 UTC

Owner requested restored dashboard delivery and PAPER entry resumption. Render release binding was corrected separately; no authentication or history checks were removed.

The inherited pause is authenticated revision 202366 at 1793494775698 with action trader:pause:202365:1793494775699, following successful-readiness anchor 201388. It originated on f8ab5d74 before installation of the scheduling/24h repair. Recovery startup 202420 and exact restoration 202421 retained it. The original exception was not retained and remains unknown; temporal overlap with installation does not prove causality.

This release permits only that exact finite reviewed sequence, original account/inception/epoch and no positions, pending obligations, stop or daily-loss latch. It reuses the existing fresh-reconciliation/readiness path; it never directly enables entries, resets capital, creates orders or acknowledges newer hard intent. Any later candidate failure, even with identical wording, remains closed and does not match this authorization. Future failures retain a bounded fingerprint, approved SQLite error code, attempted ledger revision and dispatch/evaluation phase without credentials or raw exception text.

Four slots, verified actual token creation age <=24h, PAPER-only execution, existing exit policy, accounting history and all market/quote/admission checks are unchanged. Exact tested executable and owner-root approval are required before activation. Deployment alone is not proof of resumed entries or profit.
'''
for path in outputs:
 if path not in EXPECTED and (ROOT/path).exists():raise RuntimeError('NEW_PATH_REQUIRED:'+path)
for path,s in outputs.items():
 target=ROOT/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(s)
print('Materialized six reviewable files. No host, provider, credential or financial access.')
