/** OFFLINE fixtures in a private temporary directory. The historical account
 * identity and inspected numbers are reproduced for fixed-scope validation;
 * no installed ledger, provider, control socket or live runtime is accessed. */
import {test,before,after,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {PaperLedger,OPERATING_FINANCIAL_READINESS_VERSION,OPERATIONAL_REPORTING_ENTRY_PAUSE,REVIEWED_MAINTENANCE_ACKNOWLEDGEMENT as C,inspectReviewedMaintenanceAcknowledgement,readReviewedMaintenanceAcknowledgement,type LedgerState,type OperatingFinancialReadiness,type UsdPrice} from '../src/ledger.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION} from '../src/paper-epoch.js';
import {acknowledgeReviewedMaintenancePause} from '../src/reviewed-maintenance-recovery.js';
const DAY=Date.parse('2026-10-30T18:00:00Z'),AT=DAY+3600000,SOURCE='a'.repeat(40),RUN='native-paper-20261030190000000';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const price=(at=AT+1):UsdPrice=>({at,microUsdPerSol:'100000000',source:'OFFLINE original-time fixture conversion'});
const proof=(s:Readonly<LedgerState>,at:number):OperatingFinancialReadiness=>({version:OPERATING_FINANCIAL_READINESS_VERSION,purpose:'financial-permission-only',evidence:'OFFLINE financial-only fixture request',accountId:s.accountId,stateRevision:s.revision,reconciledAt:s.daily.reconciledAt,positionUnits:{},source:{kind:'selected-native-support',bankClockAt:at,receivedAt:at,validUntil:at+30000},recoveryComplete:true,financialInventoryReady:true,budgetAvailable:true});
let templateDirectory:string,templatePath:string,maintenanceState:LedgerState;
before(async()=>{
 templateDirectory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-reviewed-maintenance-template-'));templatePath=join(templateDirectory,'ledger.sqlite');const backups=join(templateDirectory,'backups');mkdirSync(backups,{mode:0o700});
 const ledger=new PaperLedger(templatePath,C.accountId);
 try{
  ledger.initialize(price(C.inceptionAt),C.inceptionAt);ledger.activateEquityRiskPolicy(DAY);ledger.reconcile('OFFLINE initial',DAY+1,price(DAY+1),{});ledger.pause('OFFLINE epoch preparation',DAY+2,'OFFLINE isolated epoch fixture');
  await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION,price:price(DAY+100)},()=>DAY+100);
  await ledger.beginAuthorizedV3TenSolEpoch({authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:backups,price:price(DAY+200)},()=>DAY+200);
  const db=(ledger as any).db,s=structuredClone(ledger.state());
  // Explicit offline fixture seeding supplies the inspected accounting closure.
  // Epoch/anchor receipts are produced by real ledger APIs, and every added
  // historical test receipt has the real accepted request schema and hash.
  Object.assign(s,{revision:122328,lamports:C.cashLamports,realizedLamports:C.realizedLamports,executionCosts:C.executionCosts,lockedDeposits:{'OFFLINE retained rent A':'1513840','OFFLINE retained rent B':'1513840'}});
  db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(s));ledger.reconcile('OFFLINE fresh anchor context',AT,price(AT),{});
  assert.equal(ledger.resume('OFFLINE authentic successful anchor',AT,price(AT),{},proof(ledger.state(),AT)).enabled,true);assert.equal(ledger.state().revision,122330);
  ledger.pause('trader:pause:122330:'+AT,AT,C.maintenanceReason);assert.equal(ledger.state().revision,C.firstMaintenancePauseRevision);maintenanceState=structuredClone(ledger.state())as LedgerState;
  const insert=(revision:number,id:string,kind:string,payload:unknown,result:unknown)=>{db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id,hash({kind,payload}),JSON.stringify(result));db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(revision,id,(payload as any).now,kind,JSON.stringify(payload));};
  db.transaction(()=>{
   let revision=122332;
   for(let n=0;n<15;n++,revision++)insert(revision,'trader:restore-hard-pause:'+(revision-1)+':'+AT,'pause',{now:AT,reason:C.maintenanceReason},{paused:true,pendingBuyCancellations:[]});
   for(let n=0;n<20;n++,revision++)insert(revision,'trader:pause:'+(revision-1)+':'+AT,'pause',{now:AT,reason:'current equity or liquidation unavailable; entries closed'},{paused:true,pendingBuyCancellations:[]});
   for(let n=0;n<C.reviewedDeniedResumes;n++,revision++){const q=proof({...ledger.state(),revision:revision-1},AT);insert(revision,'OFFLINE historical denied '+n,'resume',{now:AT,price:price(AT),marks:{},readiness:q},{enabled:false,reason:'fresh reconciled inventory and authorized temporary recovery required'});}
   const last=C.reviewedCutoffRevision-1;insert(last,'execution-recovery:'+C.accountId+':'+(last-1),'pause',{now:AT+1,reason:C.newReason},{paused:true,pendingBuyCancellations:[]});
   const current=structuredClone(ledger.state())as LedgerState;current.revision=last;current.lastAt=AT+1;current.controls.reason=C.newReason;current.controls.changedAt=AT+1;db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(current));
  })();
  ledger.reconcile('OFFLINE reviewed ledger head',AT+1,price(),{});assert.equal(ledger.state().revision,C.reviewedCutoffRevision);db.pragma('wal_checkpoint(TRUNCATE)');
 }finally{ledger.close();}
});
after(()=>rmSync(templateDirectory,{recursive:true,force:true}));
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-reviewed-maintenance-')),path=join(directory,'ledger.sqlite');copyFileSync(templatePath,path);const ledger=new PaperLedger(path,C.accountId),db=(ledger as any).db;let at=AT+2;
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 const input=()=>({expectedRevision:ledger.state().revision,at,expectedSourceCommit:SOURCE,authorization:C.authorization});
 const plan=()=>inspectReviewedMaintenanceAcknowledgement(db,ledger.state(),input());
 const apply=()=>{const i=input(),p=plan();return ledger.acknowledgeReviewedMaintenancePause(i,p);};
 const logical=()=>({state:ledger.state(),journal:db.prepare('SELECT * FROM journal ORDER BY revision').all(),actions:db.prepare('SELECT * FROM actions ORDER BY id').all(),metadata:db.prepare('SELECT * FROM metadata ORDER BY key').all()});
 const startup=()=>ledger.pause('execution-recovery:'+C.accountId+':'+ledger.state().revision,at,C.newReason);
 return {ledger,db,input,plan,apply,logical,startup,get at(){return at;},set at(value:number){at=value;}};
}
function rewrite(f:ReturnType<typeof fixture>,id:string,change:(payload:any)=>void){const row=f.db.prepare('SELECT kind,detail FROM journal WHERE action_id=?').get(id),p=JSON.parse(row.detail);change(p);f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(JSON.stringify(p),id);f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run(hash({kind:row.kind,payload:p}),id);}
function moveControl(f:ReturnType<typeof fixture>,from:number,to:number,id:string){const old=f.db.prepare('SELECT action_id id FROM journal WHERE revision=?').get(from).id;f.db.prepare('UPDATE actions SET id=? WHERE id=?').run(id,old);f.db.prepare('UPDATE journal SET revision=?,action_id=? WHERE action_id=?').run(to,id,old);}
function reportingMixture(f:ReturnType<typeof fixture>,restoredCopies=1){
 // Rebuild just this isolated fixture's short historical interval through the
 // real pause writer. The same inspected 37/3674/16 totals can contain different
 // maintenance/reporting mixtures; the live account's mixture is not assumed.
 const closed=structuredClone(f.ledger.state())as LedgerState,first=122346-restoredCopies;
 f.db.transaction(()=>{
  for(const {action_id:id}of f.db.prepare('SELECT action_id FROM journal WHERE revision BETWEEN ? AND 122347').all(first)){f.db.prepare('DELETE FROM actions WHERE id=?').run(id);f.db.prepare('DELETE FROM journal WHERE action_id=?').run(id);}
  const prior={...structuredClone(maintenanceState),revision:first-1};f.db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(prior));
  const pause=(restore:boolean,reason:string)=>f.ledger.pause('trader:'+(restore?'restore-hard-pause':'pause')+':'+f.ledger.state().revision+':'+AT,AT,reason);
  pause(false,OPERATIONAL_REPORTING_ENTRY_PAUSE);for(let n=0;n<restoredCopies;n++)pause(true,OPERATIONAL_REPORTING_ENTRY_PAUSE);pause(true,C.maintenanceReason);
  assert.equal(f.ledger.state().revision,122347);f.db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(closed));
 })();
}

test('exact reviewed owner acknowledgement preserves deposits and all financial state, retains history, and grants no entries',t=>{
 const f=fixture(t),before=f.logical(),request=f.input(),plan=f.plan();assert.deepEqual(f.logical(),before,'inspection writes nothing');
 assert.deepEqual(plan.reviewedCounts,{deniedResumes:3674,pauseIntents:37,stopIntents:0,maintenancePauses:16,restoredReportingPauses:0,suspiciousControlIntents:16});assert.deepEqual(plan.lockedDeposits,{count:2,totalLamports:'3027680',sha256:hash(before.state.lockedDeposits)});assert.equal(plan.priorRevision,140833);assert.equal(plan.anchor.revision,122330);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
 const result=f.ledger.acknowledgeReviewedMaintenancePause(request,plan),after=f.logical();
 assert.equal(result.historicalCauseKnown,false);assert.equal(result.historicalFailureDeclaredHarmless,false);assert.equal(result.entryPermissionGranted,false);assert.equal(result.financialControlWrites,1);assert.equal(result.capitalWrites,0);
 assert.deepEqual(after.state,{...before.state,revision:before.state.revision+1,lastAt:f.at,controls:{...before.state.controls,reason:C.newReason,changedAt:f.at}});assert.equal(after.state.controls.entriesEnabled,false);assert.equal(after.state.daily.paused,true);assert.deepEqual(after.metadata,before.metadata);assert.deepEqual(after.journal.slice(0,-1),before.journal);assert.deepEqual(after.actions.filter((a:any)=>a.id!==C.actionId),before.actions);
 assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);assert.deepEqual(readReviewedMaintenanceAcknowledgement(f.db,after.state,f.at),result);
 f.startup();f.ledger.reconcile('OFFLINE post-ack fresh finance',f.at,price(f.at),{});assert.equal(f.ledger.resume('OFFLINE separately verified fresh readiness',f.at,price(f.at),{},proof(f.ledger.state(),f.at)).enabled,true);
 assert.deepEqual(f.ledger.state().lockedDeposits,before.state.lockedDeposits);assert.equal(f.ledger.state().lamports,before.state.lamports);
});

test('reviewed suspicious count accepts authenticated maintenance/reporting mixtures without assuming sixteen maintenance pauses',async t=>{
 for(const restoredCopies of [1,2])await t.test(String(restoredCopies)+' proven reporting copies',st=>{
  const f=fixture(st);reportingMixture(f,restoredCopies);const before=f.logical(),request=f.input(),plan=f.plan();
  assert.deepEqual(plan.reviewedCounts,{deniedResumes:3674,pauseIntents:37,stopIntents:0,maintenancePauses:16-restoredCopies,restoredReportingPauses:restoredCopies,suspiciousControlIntents:16});assert.deepEqual(f.logical(),before,'inspection writes nothing');
  const receipt=f.ledger.acknowledgeReviewedMaintenancePause(request,plan),after=f.logical();assert.equal(receipt.entryPermissionGranted,false);assert.equal(after.state.controls.entriesEnabled,false);assert.deepEqual(after.state.lockedDeposits,before.state.lockedDeposits);assert.equal(after.state.lamports,before.state.lamports);assert.deepEqual(after.journal.slice(0,-1),before.journal);
  assert.deepEqual(readReviewedMaintenanceAcknowledgement(f.db,after.state,f.at),receipt);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);
 });
});

test('proven reporting copies after the reviewed cutoff do not inflate the original suspicious count',t=>{
 const f=fixture(t);reportingMixture(f);const original=f.plan();
 f.ledger.pause('trader:restore-hard-pause:'+f.ledger.state().revision+':'+f.at,f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);f.startup();
 const before=f.logical(),plan=f.plan();assert.deepEqual(plan.reviewedCounts,original.reviewedCounts);assert.equal(plan.reviewedPrefixSha256,original.reviewedPrefixSha256);assert.notEqual(plan.controlPrefixSha256,original.controlPrefixSha256);assert.deepEqual(f.logical(),before);
 const receipt=f.ledger.acknowledgeReviewedMaintenancePause(f.input(),plan);assert.equal(receipt.entryPermissionGranted,false);assert.equal(f.ledger.state().controls.entriesEnabled,false);
});

test('a reporting restore without an authenticated ordinary reporting cause is still unreviewed',t=>{
 const f=fixture(t);f.ledger.pause('trader:restore-hard-pause:'+f.ledger.state().revision+':'+f.at,f.at,OPERATIONAL_REPORTING_ENTRY_PAUSE);f.startup();const before=f.logical();
 assert.throws(()=>f.plan(),/OWNER_MAINTENANCE_UNREVIEWED_RESTORED_INTENT/);assert.deepEqual(f.logical(),before);
});

test('matching total sixteen cannot hide a suspicious reporting restore before the reviewed first maintenance',t=>{
 const f=fixture(t);reportingMixture(f);
 moveControl(f,122330,122327,'OFFLINE authentic successful anchor');rewrite(f,'OFFLINE authentic successful anchor',p=>{p.readiness.stateRevision=122326;});
 moveControl(f,122345,122328,'trader:pause:122327:'+AT);moveControl(f,122346,122330,'trader:restore-hard-pause:122329:'+AT);
 const before=f.logical();assert.throws(()=>f.plan(),/OWNER_MAINTENANCE_REVIEWED_ORIGIN_MISMATCH/);assert.deepEqual(f.logical(),before);
});

test('changed reviewed suspicious totals remain distinct refusals',async t=>{
 for(const extra of [false,true])await t.test(extra?'seventeenth suspicious intent':'missing suspicious intent',st=>{
  const f=fixture(st);reportingMixture(f);const revision=extra?122348:122332,id='trader:'+(extra?'restore-hard-pause':'pause')+':'+(revision-1)+':'+AT;
  moveControl(f,revision,revision,id);rewrite(f,id,p=>{p.reason=extra?OPERATIONAL_REPORTING_ENTRY_PAUSE:'current equity or liquidation unavailable; entries closed';});
  const before=f.logical();assert.throws(()=>f.plan(),/OWNER_MAINTENANCE_REVIEWED_SUSPICIOUS_COUNT_MISMATCH/);assert.deepEqual(f.logical(),before);
 });
});

test('reviewed count does not silently reinterpret non-writer payload bytes or duplicate result keys',async t=>{
 for(const fault of ['payload spacing','duplicate result key','result spacing']as const)await t.test(fault,st=>{
  const f=fixture(st),row=f.db.prepare('SELECT action_id id,detail FROM journal WHERE revision=122347').get();
  if(fault==='payload spacing')f.db.prepare('UPDATE journal SET detail=? WHERE action_id=?').run(' '+row.detail,row.id);
  else f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(fault==='duplicate result key'?'{"paused":false,"paused":true,"pendingBuyCancellations":[]}':'{ "paused":true,"pendingBuyCancellations":[]}',row.id);
  const before=f.logical();assert.throws(()=>f.plan(),/OWNER_MAINTENANCE_REVIEWED_INTENT_ENCODING_MISMATCH/);assert.deepEqual(f.logical(),before);
 });
});

test('the count correction preserves distinct current control reason, timestamp and temporary classification checks',async t=>{
 for(const fault of ['reason','timestamp','not temporary']as const)await t.test(fault,st=>{
  const f=fixture(st);reportingMixture(f);const state=structuredClone(f.ledger.state())as LedgerState;
  if(fault==='reason')state.controls.reason='current equity or liquidation unavailable; entries closed';else if(fault==='timestamp')state.controls.changedAt=AT;else state.controls.reason=C.maintenanceReason;
  const code=fault==='reason'?'REASON_MISMATCH':fault==='timestamp'?'TIME_MISMATCH':'NOT_TEMPORARY';
  f.db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(state));const before=f.logical();assert.throws(()=>f.plan(),{message:'OWNER_MAINTENANCE_CURRENT_CONTROL_'+code});assert.deepEqual(f.logical(),before);
 });
});

test('replay is historical only after new owner and hard intents and never changes current controls',async t=>{
 for(const later of ['owner stop','owner pause','maintenance hard','unknown hard']as const)await t.test(later,st=>{
  const f=fixture(st),request=f.input(),plan=f.plan(),receipt=f.ledger.acknowledgeReviewedMaintenancePause(request,plan);f.at++;
  if(later==='owner stop')f.ledger.safeStop('operator-stop:OFFLINE later owner',f.at);else if(later==='owner pause')f.ledger.pause('operator-pause:OFFLINE later owner',f.at,'current equity or liquidation unavailable; entries closed');else f.ledger.pause('trader:pause:'+f.ledger.state().revision+':'+f.at,f.at,later==='maintenance hard'?C.maintenanceReason:'OFFLINE new unknown hard failure');
  f.startup();const before=f.logical();assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
  assert.deepEqual(readReviewedMaintenanceAcknowledgement(f.db,f.ledger.state(),f.at),receipt);assert.deepEqual(f.ledger.acknowledgeReviewedMaintenancePause(request,plan),receipt);assert.deepEqual(f.logical(),before);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
 });
});

test('acknowledgement anchors an actual internal-stop proof without claiming a successful resume',t=>{
 const f=fixture(t);f.apply();f.at++;f.ledger.safeStop('native-paper-stop:'+RUN,f.at);f.startup();const before=f.logical(),result=f.ledger.internalShutdownRecoveryProof([RUN],f.at);assert.equal(result.verified,true);if(!result.verified)throw Error('OFFLINE proof absent');assert.equal(result.lastSuccessfulResumeRevision,122330);assert.equal(result.stops.length,1);assert.deepEqual(f.logical(),before);assert.equal(before.state.controls.stopRequested,true);
});

test('a later authenticated successful grant supersedes the old acknowledgement without repeated prefix scans or corrupt-anchor fallback',t=>{
 const f=fixture(t);f.apply();f.ledger.reconcile('OFFLINE fresh later grant context',f.at,price(f.at),{});
 const id='OFFLINE later true grant';assert.equal(f.ledger.resume(id,f.at,price(f.at),{},proof(f.ledger.state(),f.at)).enabled,true);
 const grant=f.ledger.state().revision;f.startup();let prefixReads=0;const original=f.db.prepare.bind(f.db);
 f.db.prepare=(sql:string)=>{if(sql.includes('j.revision<=?'))prefixReads++;return original(sql);};
 try{
  assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),true);assert.equal(prefixReads,0);
  f.ledger.safeStop('native-paper-stop:'+RUN,f.at);const internal=f.ledger.internalShutdownRecoveryProof([RUN],f.at);assert.equal(internal.verified,true);if(!internal.verified)throw Error('OFFLINE proof absent');assert.equal(internal.lastSuccessfulResumeRevision,grant);assert.equal(prefixReads,0);
  assert.ok(readReviewedMaintenanceAcknowledgement(f.db,f.ledger.state(),f.at));assert.ok(prefixReads>0,'explicit historical replay still validates the complete original prefix');
  rewrite(f,id,p=>{p.readiness.stateRevision--;});prefixReads=0;assert.equal(f.ledger.internalShutdownRecoveryProof([RUN],f.at).verified,false);assert.equal(prefixReads,0,'an invalid later grant cannot fall back to the older acknowledgement');
 }finally{f.db.prepare=original;}
});

test('ordinary recovery after a newer real grant still rejects a new hard tail and a rehashed malformed grant',async t=>{
 for(const fault of ['later hard pause','malformed grant']as const)await t.test(fault,st=>{
  const f=fixture(st);f.apply();f.ledger.reconcile('OFFLINE current finance before grant',f.at,price(f.at),{});const id='OFFLINE newer true grant';assert.equal(f.ledger.resume(id,f.at,price(f.at),{},proof(f.ledger.state(),f.at)).enabled,true);
  if(fault==='later hard pause')f.ledger.pause('trader:pause:'+f.ledger.state().revision+':'+f.at,f.at,C.maintenanceReason);
  else rewrite(f,id,p=>{p.readiness.stateRevision--;});
  f.startup();assert.equal(f.ledger.state().controls.stopRequested,false);assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);
 });
});

test('any new maintenance ordinary or restored copy after the reviewed cutoff remains unacknowledged',async t=>{
 for(const restore of [false,true])await t.test(String(restore),st=>{const f=fixture(st);f.ledger.pause('trader:'+(restore?'restore-hard-pause':'pause')+':'+f.ledger.state().revision+':'+f.at,f.at,C.maintenanceReason);f.startup();const before=f.logical();assert.throws(()=>f.plan(),/UNREVIEWED_HARD_INTENT/);assert.deepEqual(f.logical(),before);});
});

test('extra denied receipts after the reviewed cutoff are streamed without a new lifetime count cap',t=>{
 const f=fixture(t),s=structuredClone(f.ledger.state())as LedgerState,q=proof(s,f.at);f.db.transaction(()=>{
  for(let n=0;n<5000;n++){const revision=s.revision+n+1,id='OFFLINE later denied '+n,payload={now:f.at,price:price(f.at),marks:{},readiness:{...q,stateRevision:revision-1}},result={enabled:false,reason:'fresh reconciled inventory and authorized temporary recovery required'};f.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id,hash({kind:'resume',payload}),JSON.stringify(result));f.db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(revision,id,f.at,'resume',JSON.stringify(payload));}
  s.revision+=5000;s.lastAt=f.at;f.db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(s));
 })();const before=f.logical(),plan=f.plan();assert.equal(plan.reviewedCounts.deniedResumes,3674);assert.equal(plan.priorRevision,145833);f.ledger.acknowledgeReviewedMaintenancePause(f.input(),plan);assert.deepEqual(f.db.prepare('SELECT * FROM journal WHERE revision<=? ORDER BY revision').all(before.state.revision),before.journal);
});

test('unreviewed owner, hard, stop, malformed, altered-count or forged-anchor evidence cannot be acknowledged',async t=>{
 for(const fault of ['owner soft copy','unknown hard','stop','missing denied','denied hash','denied result','anchor revision','head hash','future noncontrol head']as const)await t.test(fault,st=>{
  const f=fixture(st),soft=f.db.prepare("SELECT action_id id FROM journal WHERE kind='pause' AND revision=122347").get().id;
  if(fault==='owner soft copy'){f.db.prepare('UPDATE actions SET id=? WHERE id=?').run('operator-pause:OFFLINE hidden owner',soft);f.db.prepare('UPDATE journal SET action_id=? WHERE action_id=?').run('operator-pause:OFFLINE hidden owner',soft);}
  if(fault==='unknown hard')rewrite(f,soft,p=>{p.reason='OFFLINE unknown hard restriction';});
  if(fault==='stop'){f.ledger.safeStop('operator-stop:OFFLINE unreviewed stop',f.at);f.startup();}
  if(fault==='missing denied'){f.db.prepare('DELETE FROM actions WHERE id=?').run('OFFLINE historical denied 17');f.db.prepare('DELETE FROM journal WHERE action_id=?').run('OFFLINE historical denied 17');}
  if(fault==='denied hash')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),'OFFLINE historical denied 17');
  if(fault==='denied result')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({enabled:false,reason:'OFFLINE invented result'}),'OFFLINE historical denied 17');
  if(fault==='anchor revision')rewrite(f,'OFFLINE authentic successful anchor',p=>{p.readiness.stateRevision--;});
  if(fault==='head hash')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),'OFFLINE reviewed ledger head');
  if(fault==='future noncontrol head'){const payload={now:f.at,price:price(f.at),marks:{}},id='OFFLINE future impossible head';f.db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id,hash({kind:'reconcile',payload}),'{}');f.db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(140834,id,f.at,'reconcile',JSON.stringify(payload));}
  const before=f.logical();assert.throws(()=>f.plan());assert.deepEqual(f.logical(),before);assert.equal(f.ledger.actionResult(C.actionId),undefined);
 });
});

test('changed cash, deposited assets, obligations, identity or captured inspect plan abort without an acknowledgement',async t=>{
 for(const fault of ['cash','deposit total','deposit count','pending','account','inspect plan','executing source','new revision']as const)await t.test(fault,st=>{
  const f=fixture(st),request=f.input(),plan=f.plan(),s=structuredClone(f.ledger.state())as LedgerState;
  if(fault==='cash')s.lamports=(BigInt(s.lamports)+1n).toString();
  if(fault==='deposit total')s.lockedDeposits['OFFLINE retained rent A']='1513841';
  if(fault==='deposit count')s.lockedDeposits={'OFFLINE merged rent':'3027680'};
  if(fault==='pending')s.pending['OFFLINE unresolved']={}as any;
  if(fault==='account')s.accountId='poe-OFFLINE-foreign';
  if(['cash','deposit total','deposit count','pending','account'].includes(fault))f.db.prepare('UPDATE financial_state SET body=?').run(JSON.stringify(s));
  if(fault==='inspect plan')plan.controlPrefixSha256='0'.repeat(64);
  if(fault==='executing source')request.expectedSourceCommit='b'.repeat(40);
  if(fault==='new revision')f.ledger.reconcile('OFFLINE intervening financial revision',f.at,price(f.at),{});
  const before=f.db.prepare('SELECT body FROM financial_state').get().body,count=f.db.prepare('SELECT count(*) n FROM journal').get().n;
  assert.throws(()=>f.ledger.acknowledgeReviewedMaintenancePause(request,plan));assert.equal(f.db.prepare('SELECT body FROM financial_state').get().body,before);assert.equal(f.db.prepare('SELECT count(*) n FROM journal').get().n,count);assert.equal(f.ledger.actionResult(C.actionId),undefined);
 });
});

test('receipt corruption and later tampering of the original reviewed prefix cannot provide an anchor',async t=>{
 for(const fault of ['receipt hash','authorization','prior state','plan','result','old denied hash','orphan action']as const)await t.test(fault,st=>{
  const f=fixture(st);f.apply();
  if(fault==='receipt hash')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),C.actionId);
  if(fault==='authorization')rewrite(f,C.actionId,p=>{p.authorization='OFFLINE unapproved';});
  if(fault==='prior state')rewrite(f,C.actionId,p=>{p.priorState.lockedDeposits['OFFLINE retained rent A']='0';});
  if(fault==='plan')rewrite(f,C.actionId,p=>{p.plan.reviewedCounts.maintenancePauses=15;});
  if(fault==='result')f.db.prepare('UPDATE actions SET result=? WHERE id=?').run(JSON.stringify({entryPermissionGranted:true}),C.actionId);
  if(fault==='old denied hash')f.db.prepare('UPDATE actions SET payload_hash=? WHERE id=?').run('0'.repeat(64),'OFFLINE historical denied 17');
  if(fault==='orphan action')f.db.prepare('DELETE FROM journal WHERE action_id=?').run(C.actionId);
  const before=f.logical();assert.throws(()=>readReviewedMaintenanceAcknowledgement(f.db,f.ledger.state(),f.at));assert.equal(f.ledger.operatingFinancialRecoveryAllowed(f.at),false);assert.deepEqual(f.logical(),before);
 });
});

test('a post-append proof failure rolls back the complete owner acknowledgement atomically',t=>{
 const f=fixture(t),request=f.input(),plan=f.plan(),before=f.logical(),original=f.db.prepare.bind(f.db);let inserted=false,failedAfterInsert=false;
 f.db.prepare=(sql:string)=>{
  if(inserted&&sql==='SELECT body FROM financial_state WHERE singleton=1'){failedAfterInsert=true;throw Error('OFFLINE injected post-append read failure');}
  const statement=original(sql);
  if(sql==='INSERT INTO journal VALUES(?,?,?,?,?)'){const run=statement.run.bind(statement);statement.run=(...args:unknown[])=>{const result=run(...args);if(args[3]===C.kind)inserted=true;return result;};}
  return statement;
 };
 try{assert.throws(()=>f.ledger.acknowledgeReviewedMaintenancePause(request,plan),/injected post-append read failure/);}finally{f.db.prepare=original;}
 assert.equal(inserted,true);assert.equal(failedAfterInsert,true);assert.deepEqual(f.logical(),before);assert.equal(f.ledger.actionResult(C.actionId),undefined);
});

test('native wrapper refuses an unapproved identity/path before accessing an installed account',()=>{
 assert.throws(()=>acknowledgeReviewedMaintenancePause({mode:'inspect',ledgerPath:'/tmp/OFFLINE-not-operating.sqlite',expectedRevision:140833,at:AT,expectedSourceCommit:SOURCE,authorization:C.authorization}),/EXACT_INSTALLER_REQUEST_REQUIRED/);
});
