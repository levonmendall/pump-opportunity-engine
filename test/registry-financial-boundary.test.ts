import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {MarketRegistry,MarketRegistryContention} from '../src/market-registry.js';
import {NativeRegistryFollowups} from '../src/native-registry-followups.js';
import {REVIEWED_MARKET_CONTENTION as p,REVIEWED_MARKET_CONTENTION_CONTROLS as expected,reviewedMarketContentionLineage,type ReviewedContentionHistory} from '../src/reviewed-market-contention.js';
import {PaperLedger,type LedgerState} from '../src/ledger.js';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

test('diagnostic fingerprint exactly matches the typed nonfinancial registry exception',()=>{
 const error=new MarketRegistryContention('SQLITE_BUSY');assert.equal(sha(error.message),p.errorSha256);assert.equal(error.callbackStarted,false);assert.equal(error.code,'MARKET_REGISTRY_CONTENTION');
});
test('real contended SQLite writer lease retries only the unstarted registry callback',t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-registry-followup-')),path=join(dir,'market.sqlite');
 const registry=new MarketRegistry(path,{concurrentIntake:true}),lock=new Database(path),events:any[]=[];let mutations=0;
 t.after(()=>{if(lock.inTransaction)lock.exec('ROLLBACK');lock.close();registry.close();rmSync(dir,{recursive:true,force:true});});
 const queue=new NativeRegistryFollowups(()=>1,(kind,data)=>events.push({kind,data}),()=>1000);
 lock.exec('BEGIN IMMEDIATE');
 assert.equal(queue.submit('technical-reevaluation','OFFLINE-MINT',999,()=>registry.transaction(()=>{mutations++;registry.setMetadata('followup','done');})),false);
 assert.equal(mutations,0);assert.equal(queue.pending(),true);assert.equal(queue.drain(),false);assert.equal(mutations,0);
 lock.exec('ROLLBACK');assert.equal(queue.drain(),true);assert.equal(mutations,1);assert.equal(registry.getMetadata('followup'),'done');assert.equal(queue.drain(),false);assert.equal(mutations,1);
 assert.equal(events.length,1,'one deferred transition, not repeated error storms');assert.equal(events[0].data.financialReplay,false);
});
test('followups are FIFO, one attempt per turn, and abandoned across source generations',()=>{
 let generation=1,blocked=true;const done:string[]=[],events:any[]=[];
 const q=new NativeRegistryFollowups(()=>generation,(kind,data)=>events.push({kind,data}),()=>100);
 q.submit('evaluation-complete','a',90,()=>{if(blocked)throw new MarketRegistryContention('SQLITE_LOCKED');done.push('a');});
 q.submit('economic-rejection','a',91,()=>done.push('b'));assert.deepEqual(done,[]);blocked=false;
 q.drain();assert.deepEqual(done,['a']);assert.equal(q.view().pending,1);q.drain();assert.deepEqual(done,['a','b']);
 blocked=true;q.submit('technical-reevaluation','a',92,()=>{if(blocked)throw new MarketRegistryContention('SQLITE_BUSY');done.push('stale');});generation=2;blocked=false;q.drain();
 assert.deepEqual(done,['a','b']);assert.equal(q.view().generationDiscarded,1);assert.equal(q.pending(),false);
});
test('same-text errors, raw financial SQLite errors and post-callback errors are not silently retried',()=>{
 const after=new MarketRegistryContention('SQLITE_BUSY');Object.defineProperty(after,'callbackStarted',{value:true});
 for(const error of [new Error('Market registry writer lease unavailable before callback'),Object.assign(new Error('busy'),{code:'SQLITE_BUSY'}),new MarketRegistryContention('SQLITE_IOERR'),after]){
  const q=new NativeRegistryFollowups(()=>1,()=>{},()=>100);assert.throws(()=>q.submit('evaluation-complete','a',90,()=>{throw error;}),e=>e===error);assert.equal(q.pending(),false);
 }
});
function fixture(){
 const temporary='execution startup: fresh reconciliation/readiness required',at=1793548000000;
 const state={accountId:p.accountId,inceptionAt:p.inceptionAt,mode:'PAPER',revision:240001,lastAt:at,lamports:p.cashLamports,paperEpoch:{id:p.epochId,version:'poe-paper-epoch-v3'},equityRisk:{version:'paper-equity-risk-v3-no-daily-stop-v1'},positions:{},pending:{},daily:{lossPaused:false,paused:true},controls:{entriesEnabled:false,stopRequested:false,changedAt:at,reason:temporary}} as unknown as LedgerState;
 const history:ReviewedContentionHistory={anchor:{revision:p.anchorRevision,at:p.anchorAt,kind:'resume',actionSha256:p.anchorActionSha256},controls:expected.map(e=>({revision:e.revision,at:e.at,actionSha256:e.actionSha256,detailSha256:e.detailSha256,reasonSha256:'0'.repeat(64),ordinary:e.kind==='ordinary',startup:e.kind==='startup',restored:e.kind==='restored',temporary:false,kind:'pause',paused:true,cancellations:0}))};
 history.controls.push({revision:240001,at,actionSha256:sha('execution-recovery:'+p.accountId+':240000'),detailSha256:'1'.repeat(64),reasonSha256:sha(temporary),ordinary:false,startup:true,restored:false,temporary:true,kind:'pause',paused:true,cancellations:0});
 return {state,history};
}
test('reviewed control proof is read-only and requires evidence plus independently checked financial closure',()=>{
 const {state,history}=fixture(),before=structuredClone(state);assert.equal(reviewedMarketContentionLineage(state,history,true,true),true);assert.deepEqual(state,before);assert.equal(state.controls.entriesEnabled,false);
 assert.equal(reviewedMarketContentionLineage(state,history,false,true),false);assert.equal(reviewedMarketContentionLineage(state,history,true,false),false);
});
test('changed identity, money, intent, exact rows or any new hard failure cannot inherit the reviewed proof',()=>{
 const cases:Array<[string,(s:LedgerState,h:ReviewedContentionHistory)=>void]>=[
 ['account',s=>{s.accountId='other';}],['inception',s=>{s.inceptionAt++;}],['cash',s=>{s.lamports='1';}],['funded',s=>{(s as any).mode='LIVE';}],['epoch',s=>{(s.paperEpoch as any).id='other';}],['stop',s=>{s.controls.stopRequested=true;}],['loss',s=>{s.daily.lossPaused=true;}],['holding',s=>{(s.positions as any).x={};}],['pending',s=>{(s.pending as any).x={};}],['already enabled',s=>{s.controls.entriesEnabled=true;}],['new anchor',(_s,h)=>{h.anchor!.revision++;}],['changed pause hash',(_s,h)=>{h.controls[0]!.detailSha256='f'.repeat(64);}],['changed action',(_s,h)=>{h.controls[2]!.actionSha256='f'.repeat(64);}],['unproven source recovery',(_s,h)=>{h.controls[3]!.detailSha256='f'.repeat(64);}],['cancelled order',(_s,h)=>{h.controls[0]!.cancellations=1;}],['new hard',(s,h)=>{const last=h.controls.at(-1)!;h.controls.push({...last,revision:last.revision+1,at:last.at+1,temporary:false,startup:false,ordinary:true});s.controls.changedAt++;s.revision++;}],['new owner pause',(s,h)=>{const last=h.controls.at(-1)!;h.controls.push({...last,revision:last.revision+1,at:last.at+1,startup:false,ordinary:false});s.controls.changedAt++;s.revision++;}],['changed current reason',s=>{s.controls.reason='unknown';}]
 ];
 for(const [name,mutate]of cases){const {state,history}=fixture();mutate(state,history);assert.equal(reviewedMarketContentionLineage(state,history,true,true),false,name);}
});
test('registering diagnostic evidence alone cannot change a disposable ledger or recover foreign history',t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-contention-proof-')),ledger=new PaperLedger(join(dir,'fixture.sqlite'),'OFFLINE-contention-fixture');
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});const at=1793548000000;ledger.initialize({at,microUsdPerSol:'100000000',source:'OFFLINE'},at);const before=ledger.state();
 assert.equal(ledger.authorizeReviewedMarketContentionEvidence('wrong'),false);assert.equal(ledger.authorizeReviewedMarketContentionEvidence(p.reportSha256),true);assert.equal(ledger.reviewedMarketContentionRecoveryAllowed(at),false);assert.deepEqual(ledger.state(),before);assert.equal(ledger.state().controls.entriesEnabled,false);
});
