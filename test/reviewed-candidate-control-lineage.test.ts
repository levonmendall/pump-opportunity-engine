import {test} from 'node:test';
import assert from 'node:assert/strict';
import {REVIEWED_CANDIDATE_CONTROL_INCIDENT as c,REVIEWED_CANDIDATE_CONTROL_INCIDENT_20261101 as current,reviewedCandidateControlLineage,type LedgerState} from '../src/ledger.js';

const account='poe-3123e352-4581-455b-85db-acd7e825e99e';
const reason='native candidate financial evaluation unavailable';
const temporary='execution startup: fresh reconciliation/readiness required';
const pause=(revision:number,at:number,actionId:string,pauseReason:string,kind:'ordinary'|'startup'|'restored')=>({
 row:{revision,at,actionId,kind:'pause',detail:'',payloadHash:'',result:''},
 payload:{now:at,reason:pauseReason},
 result:{paused:true,pendingBuyCancellations:[]},
 ordinary:kind==='ordinary',restored:kind==='restored',startup:kind==='startup'
});
function fixture(){
 const state={accountId:account,inceptionAt:1793052456212,mode:'PAPER',paperEpoch:{id:'poe-paper-10sol-v3-20261030',version:'poe-paper-epoch-v3'},equityRisk:{version:'paper-equity-risk-v3-no-daily-stop-v1'},
 controls:{entriesEnabled:false,stopRequested:false,changedAt:1793481488425,reason},positions:{},pending:{},daily:{lossPaused:false,paused:true}}as unknown as LedgerState;
 const history={anchor:{revision:190149,at:1793480966760,kind:'resume',actionId:'native-paper-operating-financial-ready:190148:1793480966760',detail:'',payloadHash:'',result:''},
 decoded:[
 pause(190299,1793481124040,'trader:pause:190298:1793481124040',reason,'ordinary'),
 pause(190464,1793481488417,'execution-recovery:'+account+':190463',temporary,'startup'),
 pause(190465,1793481488425,'trader:restore-hard-pause:190464:1793481488425',reason,'restored')],
 controlPrefixSha256:'',reviewedPrefixSha256:'',reviewedCounts:{deniedResumes:0,pauseIntents:3,stopIntents:0}
 };
 return {state,history};
}
test('exact reviewed candidate pause lineage is eligible only as an original authenticated sequence',()=>{
 const {state,history}=fixture();assert.equal(c.sourcePauseRevision,190299);assert.equal(c.originSource,'983e90c0e053b27d3b93c37c91e8788e5d98c255');
 assert.equal(reviewedCandidateControlLineage(state,history),true);
 history.decoded.push(pause(191908,1793484000000,'execution-recovery:'+account+':191907',temporary,'startup'));
 state.controls.changedAt=1793484000000;state.controls.reason=temporary;
 assert.equal(reviewedCandidateControlLineage(state,history),true,'a new authenticated startup is a temporary control, not a grant');
 const restoreAt=1793484000005;history.decoded.push(pause(191909,restoreAt,'trader:restore-hard-pause:191908:'+restoreAt,reason,'restored'));
 state.controls.changedAt=restoreAt;state.controls.reason=reason;
 assert.equal(reviewedCandidateControlLineage(state,history),true,'another exact inherited startup/restore pair is not a new hard intent');
});
test('a changed account, sequence, financial obligation or later hard intent cannot inherit the exception',()=>{
 const badCases:[string,(s:LedgerState,h:any)=>void][]=[
 ['account',(s)=>{s.accountId='other';}],
 ['epoch',(s)=>{(s.paperEpoch as any).id='other';}],
 ['stop',(s)=>{s.controls.stopRequested=true;}],
 ['owner already enabled',(s)=>{s.controls.entriesEnabled=true;}],
 ['held',(s)=>{(s.positions as any).held={};}],
 ['pending',(s)=>{(s.pending as any).unresolved={};}],
 ['loss',(s)=>{s.daily.lossPaused=true;}],
 ['different anchor',(_s,h)=>{h.anchor.revision=190150;}],
 ['wrong first action',(_s,h)=>{h.decoded[0].row.actionId='trader:pause:190298:1793481124041';}],
 ['wrong original reason',(_s,h)=>{h.decoded[0].payload.reason='owner paused new entries';}],
 ['wrong startup',(_s,h)=>{h.decoded[1].startup=false;}],
 ['wrong restoration',(_s,h)=>{h.decoded[2].row.revision=190466;}],
 ['changed current control',(s)=>{s.controls.changedAt++;}],
 ['canceled financial entry',(_s,h)=>{h.decoded[0].result.pendingBuyCancellations.push('buy-1');}],
 ['new hard intent',(s,h)=>{const at=1793484000000;h.decoded.push(pause(191908,at,'trader:pause:191907:'+at,'financial maintenance unavailable; preserve records and close entries','ordinary'));s.controls.changedAt=at;s.controls.reason='financial maintenance unavailable; preserve records and close entries';}],
 ['new safe stop',(s,h)=>{const at=1793484000000;h.decoded.push({...pause(191908,at,'owner-stop','safe stop requested','ordinary'),row:{...h.decoded[2].row,kind:'safe-stop',revision:191908,at}});s.controls.changedAt=at;s.controls.reason='safe stop requested';}]
 ];
 for(const [name,mutate] of badCases){const {state,history}=fixture();mutate(state,history);assert.equal(reviewedCandidateControlLineage(state,history),false,name);}
});

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
