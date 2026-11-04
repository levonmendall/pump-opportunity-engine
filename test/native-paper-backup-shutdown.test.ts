/** OFFLINE: actual signal and backup-continuation closures; no host services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMarketIntake} from '../src/native-market-intake.js';
import {NativeMarketIntakeSpool} from '../src/native-market-intake-spool.js';
import {runNativePaper,nativePaperBackupFailureDisposition} from '../src/run-native-paper.js';
import {BackupOperationError,backupFailureDiagnostic} from '../src/backup.js';
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));

function shutdownFixture(feeds:any,intake:any,events:any[]){
 const source=runNativePaper.toString(),start=source.indexOf('let serviceShutdownTask'),end=source.indexOf('process.once',start),holder:any={};assert.ok(start>0&&end>start);
 const context:any={__name:(v:unknown)=>v,service:true,stopped:false,stopReason:'before',holder,Date,feeds,marketIntake:intake,backupStore:{cancelActive:()=>{events.push('cancel-owned-backup');return Promise.resolve();}},record:(kind:string,data:unknown)=>events.push({kind,data})};
 runInNewContext(source.slice(start,end)+';holder.stop=stop;holder.shutdown=()=>serviceShutdownTask;',context,{timeout:1000});return {context,stop:holder.stop as ()=>void,shutdown:holder.shutdown as ()=>Promise<void>};
}

test('the actual persistent signal checkpoints before physical waits and closes intake only after the genuine asynchronous feed state',async()=>{
 const events:any[]=[];let settled=false,finish!:()=>void;const wait=new Promise<void>(resolve=>{finish=()=>{events.push('final-feed-state');settled=true;resolve();};});
 const f=shutdownFixture({stop:()=>{events.push('abort-feeds');return wait;},usage:()=>({physicalTransportsSettled:settled})},{preserveAcceptedTail:()=>{events.push('persist-accepted-tail');return Promise.resolve();},close:()=>{events.push('close-intake');return Promise.resolve();}},events);
 f.stop();assert.equal(f.context.stopped,true);assert.deepEqual(events,['persist-accepted-tail','cancel-owned-backup','abort-feeds']);await turn();assert.equal(events.includes('close-intake'),false);finish();await f.shutdown();assert.deepEqual(events.slice(-2),['final-feed-state','close-intake']);
 f.context.service=false;events.length=0;f.stop();assert.deepEqual(events,[],'finite research stop keeps its existing final-backup protocol');
});

for(const initiallyUnsettled of [false,true])test(`the actual shared shutdown retains asynchronous terminal feed receipts through the real intake spool (unsettled=${initiallyUnsettled})`,async t=>{
 const root=mkdtempSync(join(tmpdir(),'poe-real-stop-tail-')),path=join(root,'market-intake-tail.json'),events=new EventEmitter(),sent:any[]=[],trace:any[]=[],at=1793781839513;let now=at,intake!:NativeMarketIntake,settled=false,finish!:()=>void,firstPersisted!:()=>void;
 const persisted=new Promise<void>(resolve=>{firstPersisted=resolve;}),waiting=new Promise<void>(resolve=>{finish=()=>{now=at+5;intake.observeFeed({source:'pumpapi-broad',connected:false,at:at+5,scope:'SHARED_ACTIVITY_HINTS'});settled=true;resolve();};});
 const handle:any={on:(name:string,listener:(value:any)=>void)=>{events.on(name,listener);return handle;},postMessage:(value:any)=>sent.push(value),terminate:async()=>0};
 intake=new NativeMarketIntake({spoolPath:path,createWorker:()=>handle,now:()=>now,onCommitted:()=>assert.fail('no synthetic ACK is allowed'),onPressure:()=>{},record:(kind)=>{if(kind==='native-market-intake-shutdown-tail-persisted'){firstPersisted();if(!intake.available())queueMicrotask(()=>events.emit('message',{kind:'failure',reasonCode:'SQLITE_BUSY'}));}}});
 t.after(async()=>{await intake.close().catch(()=>{});rmSync(root,{recursive:true,force:true});});for(let n=0;intake.usage().workerGeneration===0;n++){assert.ok(n<1000,'actual intake startup completes');await turn();}events.emit('message',{kind:'ready'});intake.observeIdentity({mint:'OFFLINE',receivedAt:at,source:'pumpapi-broad',kind:'activity',evidence:'unverified-provider-discovery-hint'});
 let stopCalls=0;const owner=shutdownFixture({stop:()=>{stopCalls++;return initiallyUnsettled&&stopCalls===1?Promise.reject(Error('PILOT_FEED_TRANSPORT_UNSETTLED')):waiting;},usage:()=>({physicalTransportsSettled:settled})},intake,trace);owner.stop();await persisted;await turn();if(initiallyUnsettled){const failure=trace.find(row=>row.kind==='native-paper-stop-transport-unsettled');assert.ok(failure);assert.equal(failure.data.physicalSettlementConfirmed,false);assert.equal(failure.data.intakeRemainsOpen,true);}assert.equal(intake.available(),true,'the source still owns its future terminal status');assert.equal((await new NativeMarketIntakeSpool(path).load()).length,1);
 finish();await owner.shutdown();const rows=await new NativeMarketIntakeSpool(path).load();assert.equal(rows.length,2);const first=rows[0]!.message;assert.ok(first.operation==='identity');assert.equal(first.value.receivedAt,at);assert.deepEqual(rows[1]!.message,{kind:'intake',id:2,operation:'feed',value:{source:'pumpapi-broad',connected:false,at:at+5,scope:'SHARED_ACTIVITY_HINTS'}});assert.equal(intake.usage().durableCommitted,0);assert.equal(intake.usage().pending,2);
});

test('the exact final-backup branch starts no new optional persistent work while retaining finite experiment behavior',async()=>{
 const match=runNativePaper.toString().match(/if\(!service\)\{startBackup\(true\);if\(backupTask\)await backupTask;?\}/);assert.ok(match,'actual shutdown branch exists');
 for(const service of [true,false]){let starts=0,settled=false;const context:any={service,backupTask:null,startBackup:(final:boolean)=>{assert.equal(final,true);starts++;context.backupTask=Promise.resolve().then(()=>{settled=true;});}};await runInNewContext('(async()=>{'+match[0]+'})()',context);assert.equal(starts,service?0:1);assert.equal(settled,!service);}
});

for(const previousReady of [false,true])test(`a settled started backup cancelled for shutdown preserves previous readiness ${previousReady} without a new ledger pause`,async()=>{
 const source=runNativePaper.toString(),start=source.indexOf('const startBackup='),end=source.indexOf('const report=',start),holder:any={},events:any[]=[],state={revision:17},before=structuredClone(state);let fail!:(error:unknown)=>void,started=false,pauses=0;
 const backup:any={stopping:false,maintainPending:async()=>null,create:async()=>{started=true;return new Promise((_resolve,reject)=>{fail=reject;});}};
 const context:any={__name:(v:unknown)=>v,holder,Date:{now:()=>100000},backupTask:null,nextBackupAttemptAt:0,lastBackup:previousReady?90000:0,backupReady:previousReady,backup,service:true,stopped:false,currentLedger:{state:()=>state},localAdmission:()=>true,localPhase:(_kind:string,_bound:number,work:()=>unknown)=>work(),record:(kind:string,data:unknown)=>events.push({kind,data}),currentBridge:{trader:{pauseNewEntries:()=>{pauses++;}}},nativePaperBackupFailureDisposition,backupFailureDiagnostic};
 runInNewContext(source.slice(start,end)+';holder.start=startBackup;holder.task=()=>backupTask;',context,{timeout:1000});holder.start();await turn();assert.equal(started,true);context.stopped=true;backup.stopping=true;fail(new BackupOperationError('source-copy',Error('backup artifact worker failed; pending artifacts preserved')));await holder.task();
 assert.equal(context.backupReady,previousReady);assert.equal(context.lastBackup,previousReady?90000:0);assert.equal(pauses,0);assert.deepEqual(state,before);assert.equal(events.length,1);assert.equal(events[0].kind,'native-paper-consistent-backup-cancelled');assert.equal(events[0].data.stage,'source-copy');assert.equal(events[0].data.reasonCode,'BACKUP_WORKER_FAILED');assert.equal(events[0].data.newBackupVerified,false);assert.equal(events[0].data.financialControlMutation,false);
});


test('an optional intake save failure after real feed settlement cannot bypass the actual mandatory financial cleanup',async()=>{
 const trace:any[]=[],io=Error('OFFLINE_INTAKE_SAVE_FAILED'),owner=shutdownFixture({stop:async()=>{},usage:()=>({physicalTransportsSettled:true})},{preserveAcceptedTail:async()=>{throw io;},close:async()=>{throw io;}},trace);
 owner.stop();await owner.shutdown();
 const source=readFileSync(new URL('../src/run-native-paper.ts',import.meta.url),'utf8'),parsed=ts.createSourceFile('launcher.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),fn=parsed.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='runNativePaper')!,outer=fn.body!.statements.find((node):node is ts.TryStatement=>ts.isTryStatement(node)&&node.finallyBlock?.getText(parsed).includes('clearInterval(financialMaintenanceTimer)')===true)!;assert.ok(outer?.finallyBlock,'actual outer financial cleanup is identified');
 const code=ts.transpileModule('(async()=>'+outer.finallyBlock.getText(parsed)+')()',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 Object.assign(owner.context,{financialMaintenanceTimer:undefined,clearInterval:()=>trace.push('clear-maintenance'),engine:{stop:async()=>trace.push('engine-stop')},backupTask:null,ledger:{close:()=>trace.push('ledger-close')},bridge:{trader:{checkpointForRestart:()=>trace.push('financial-checkpoint'),financialMaintenanceFailed:()=>assert.fail('optional intake failure cannot become a financial maintenance failure')}},runtimeFailed:false,runtimeFailure:null,finalReport:()=>trace.push('financial-report'),control:{close:async()=>trace.push('control-close')},marketRegistry:{close:()=>trace.push('registry-close')},recorder:{close:()=>trace.push('recorder-close')},serviceRecorder:{close:async()=>trace.push('service-recorder-close')},failureEvidence:{close:async()=>trace.push('failure-evidence-close')},lag:{disable:()=>trace.push('lag-close')},process:{off:()=>trace.push('signal-remove')},rpc:{usage:()=>({inFlight:0,waitingOrOperating:false})},native:{usage:()=>({physicalTransportsSettled:true})},watchLease:11,global:12,closeSync:(fd:number)=>trace.push('lease-close-'+fd)});
 await assert.rejects(runInNewContext(code,owner.context,{timeout:1000}),/NATIVE_PAPER_SHUTDOWN_INTAKE_TAIL_UNAVAILABLE/);
 for(const required of ['financial-checkpoint','financial-report','ledger-close','registry-close','service-recorder-close','lease-close-11','lease-close-12'])assert.ok(trace.includes(required),required+' completes before surfacing the intake failure');
 assert.ok(trace.indexOf('financial-checkpoint')<trace.indexOf('ledger-close'));assert.ok(trace.some(row=>row.kind==='native-paper-stop-tail-unavailable'&&row.data.acceptedTailDurabilityClaimed===false));
});
