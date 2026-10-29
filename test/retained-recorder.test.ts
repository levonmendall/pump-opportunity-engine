import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync,lstatSync,unlinkSync,symlinkSync,chmodSync,linkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Recorder,BoundedRotatingRecorder} from '../src/recorder.js';
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
function fixture(options:Record<string,unknown>={}){const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-retention-')),directory=join(root,'service');let at=1000000,mono=0;const config={directory,segmentBytes:4096,diagnosticBytes:12288,minRetentionMs:300000,minimumDiskReserveBytes:0,now:()=>at,monotonic:()=>mono,...options};return {root,directory,config,open:()=>new BoundedRotatingRecorder(config),advance(ms:number){at+=ms;mono+=ms;},jumpWall(ms:number){at+=ms;},get at(){return at;}};}
// A process exit closes every descriptor without invoking recorder.close().  Restart
// tests must never simulate a crash by running two writers over the same files.
function crashed(f:ReturnType<typeof fixture>,body:string){
  const {now,monotonic,...options}=f.config;
  const module=new URL('../src/recorder.ts',import.meta.url).href;
  const source=`import {BoundedRotatingRecorder} from ${JSON.stringify(module)}; const r=new BoundedRotatingRecorder({...${JSON.stringify(options)},now:()=>1000000,monotonic:()=>0}); ${body}; process.exit(0);`;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr||String(child.error));
}
const payload=(n=1500)=>({raw:'x'.repeat(n)});
function fill(r:BoundedRotatingRecorder){let n=0;while(n<100&&r.record('native-provider-packet',payload()))n++;assert.ok(n>0&&n<100);return n;}
function receipts(f:ReturnType<typeof fixture>){return JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8')).receipts as any[];}

test('finite research Recorder still has its original capacity and append shape',()=>{const f=fixture(),p=join(f.root,'finite.ndjson'),r=new Recorder(p,300);r.record('one',{value:1n});assert.throws(()=>r.record('two',payload()),/EVIDENCE_CAPACITY_REACHED/);r.close();const row=JSON.parse(readFileSync(p,'utf8'));assert.equal(row.kind,'one');assert.equal(row.data.value,'1');assert.equal(row.recordSha256,undefined);});

test('young diagnostic pressure is explicit while durable financial proof continues',async()=>{const f=fixture(),r=f.open(),n=fill(r);assert.equal(r.usage().candidateAdmissionAllowed,false);assert.ok(r.usage().refusedRecords>0);assert.ok(r.record('trader-pilot-execution-quote',{order:'same-order',quote:{at:f.at,receiveUnits:'7'}},{essential:true}));assert.equal(r.usage().candidateAdmissionAllowed,false,'critical append cannot clear diagnostic pressure');await r.maintenance();assert.equal(readdirSync(f.directory).filter(x=>x.startsWith('diagnostic-')).length,Math.ceil(n/2));assert.equal(r.usage().retiredBytes,0);await r.close();const essential=readdirSync(f.directory).filter(x=>/^essential-.*\.ndjson$/.test(x));assert.equal(essential.length,1);const raw=readFileSync(join(f.directory,essential[0]!), 'utf8');assert.match(raw,/same-order/);assert.ok(receipts(f).some(v=>v.kind==='record-refused'));});

test('old closed diagnostics rotate with hash-linked receipts; new and historical files survive',async()=>{const f=fixture(),historical=join(f.root,'old-irreplaceable.ndjson');writeFileSync(historical,'ORIGINAL');const r=f.open();fill(r);const before=readdirSync(f.directory).filter(x=>/^diagnostic-.*\.ndjson$/.test(x));f.advance(299999);await r.maintenance();assert.equal(r.usage().retiredBytes,0);f.advance(1);await r.maintenance();assert.ok(r.usage().retiredBytes>0);assert.equal(r.usage().candidateAdmissionAllowed,true);assert.equal(readFileSync(historical,'utf8'),'ORIGINAL');assert.ok(r.record('new-current-packet',payload()));const rs=receipts(f);assert.ok(rs.some(v=>v.kind==='diagnostic-retention-eviction'));for(let i=1;i<rs.length;i++)assert.equal(rs[i].previousSha256,rs[i-1].sha256);assert.ok(before.some(file=>!readdirSync(f.directory).includes(file)));await r.close();});

test('wall-clock jumps cannot expire five-minute monotonic retention',async()=>{const f=fixture(),r=f.open();fill(r);f.jumpWall(86400000);await r.maintenance();assert.equal(r.usage().retiredBytes,0);await r.close();});

test('full raw qualification and quote proof survives diagnostic eviction with no hardlinks',async()=>{const f=fixture(),r=f.open(),start=f.at;assert.ok(r.record('native-flow-raw-log',{rawLog:'EXACT_SELECTED_LOG_BYTES'}));f.advance(100);assert.ok(r.record('independent-history-raw-page',{page:[{signature:'ACTUAL_SIGNATURE',slot:7}]}));const pinned=await r.pinRange('candidate:window',start,f.at);assert.equal(pinned.complete,true);assert.ok(pinned.bytes>0);for(const name of pinned.files){const p=join(f.directory,name);assert.equal(lstatSync(p).nlink,1);assert.match(readFileSync(p,'utf8'),/EXACT_SELECTED_LOG_BYTES|ACTUAL_SIGNATURE/);}assert.ok(r.record('research-clock-pool-state',{rawAccounts:['FULL_QUOTE_DEPENDENCY_BYTES']},{essential:true}));fill(r);f.advance(300000);await r.maintenance();for(const name of pinned.files)assert.ok(readFileSync(join(f.directory,name)).length);const manifest=readFileSync(join(f.directory,pinned.files[0]!.split('/')[0]!,'manifest.json'));assert.equal(sha(manifest),pinned.manifestSha256);await r.close();const ess=readdirSync(f.directory).filter(x=>/^essential-.*\.ndjson$/.test(x));assert.match(ess.map(p=>readFileSync(join(f.directory,p),'utf8')).join(''),/FULL_QUOTE_DEPENDENCY_BYTES/);});

test('pending async pin owns its source files before maintenance can retire them',async()=>{const f=fixture({segmentBytes:65536,diagnosticBytes:196608}),r=f.open(),start=f.at;for(let i=0;i<6;i++)assert.ok(r.record('native-flow-raw-log',payload(29000)));f.advance(300000);const task=r.pinRange('in-flight-proof',start,f.at);await r.maintenance();const pin=await task;assert.equal(pin.complete,true);for(const file of pin.files)assert.ok(readFileSync(join(f.directory,file)).length);await r.close();});

test('an absent historical range and identity-conflicting proof never become complete',async()=>{const f=fixture(),r=f.open();r.record('source',payload());assert.equal((await r.pinRange('old',f.at-1,f.at)).complete,false);const original=await r.pinRange('same',f.at,f.at);assert.equal(original.complete,true);f.advance(1);r.record('next',{});assert.equal((await r.pinRange('same',f.at,f.at)).complete,false);await r.close();});

test('restart recovers both diagnostic and essential append state and conservatively retains old files',async()=>{const f=fixture();crashed(f,`r.record('raw-before-crash',{value:'DIAGNOSTIC'});r.record('actual-quote',{value:'ESSENTIAL'},{essential:true})`);const reopened=f.open();f.advance(300001);await reopened.maintenance();assert.ok(readdirSync(f.directory).some(x=>/^essential-.*manifest\.json$/.test(x)));assert.ok(reopened.record('new-current',{value:1}));assert.match(readdirSync(f.directory).filter(x=>/^essential-.*\.ndjson$/.test(x)).map(x=>readFileSync(join(f.directory,x),'utf8')).join(''),/ESSENTIAL/);await reopened.close();});

test('foreign directories and symlink proof targets are refused without touching external files',async()=>{const f=fixture();mkdirSync(f.directory,{mode:0o700});writeFileSync(join(f.directory,'legacy-history'),'DO_NOT_DELETE');assert.throws(()=>f.open(),/FOREIGN_DIRECTORY/);assert.equal(readFileSync(join(f.directory,'legacy-history'),'utf8'),'DO_NOT_DELETE');const g=fixture(),r=g.open();r.record('source',{});const target=join(g.root,'foreign');mkdirSync(target,{mode:0o700});writeFileSync(join(target,'manifest.json'),'PRIVATE');symlinkSync(target,join(g.directory,'proof-'+sha('unsafe')));const p=await r.pinRange('unsafe',g.at,g.at);assert.equal(p.complete,false);assert.equal(readFileSync(join(target,'manifest.json'),'utf8'),'PRIVATE');await r.close();});

test('tampered segment bytes cannot be promoted into a qualification proof',async()=>{const f=fixture(),r=f.open();r.record('source',payload());const first=await r.pinRange('first',f.at,f.at);assert.equal(first.complete,true);const diag=readdirSync(f.directory).find(x=>/^diagnostic-.*\.ndjson$/.test(x))!;const raw=readFileSync(join(f.directory,diag));writeFileSync(join(f.directory,diag),Buffer.from('z'.repeat(raw.length)));const second=await r.pinRange('second',f.at,f.at);assert.equal(second.complete,false);assert.equal(second.manifestSha256,null);await r.close();});

test('a torn diagnostic tail is retained opaque and cannot certify an old window',async()=>{const f=fixture();crashed(f,`r.record('source',{exact:'KEEP_DIAGNOSTIC'});r.record('financial-checkpoint',{}, {essential:true})`);const state=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8')),name=state.activeDiagnostic.file;writeFileSync(join(f.directory,name),Buffer.concat([readFileSync(join(f.directory,name)),Buffer.from('{"torn":')]));const reopened=f.open();assert.equal(reopened.usage().requiresCriticalRecovery,false);assert.equal((await reopened.pinRange('unusable-history',f.at,f.at)).complete,false);assert.match(readFileSync(join(f.directory,name),'utf8'),/KEEP_DIAGNOSTIC/);assert.match(readFileSync(join(f.directory,name),'utf8'),/torn/);assert.ok(receipts(f).some(v=>v.data.unusableTailBytes>0));assert.ok(reopened.record('fresh-capture',{}));await reopened.close();});

test('torn essential proof closes new-risk admission while financial recording and verified recovery continue',async()=>{const f=fixture();crashed(f,`r.record('quote',{exact:'KEEP_ESSENTIAL'},{essential:true})`);const state=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8')),name=state.activeEssential.file;writeFileSync(join(f.directory,name),Buffer.concat([readFileSync(join(f.directory,name)),Buffer.from('{"torn":')]));const reopened=f.open();assert.equal(reopened.usage().requiresCriticalRecovery,true);assert.equal(reopened.usage().candidateAdmissionAllowed,false);assert.ok(reopened.record('held-protection',{actual:'CURRENT_VALID_QUOTE'},{essential:true}));assert.throws(()=>reopened.resolveCriticalRecovery({financialRevision:-1,evidence:'invalid'}),/RECOVERY_VERIFICATION/);assert.equal(reopened.usage().requiresCriticalRecovery,true);assert.equal(reopened.resolveCriticalRecovery({financialRevision:7,evidence:'OFFLINE canonical original-account journal and fresh marks independently verified'}),true);assert.equal(reopened.usage().requiresCriticalRecovery,false);assert.equal(reopened.usage().candidateAdmissionAllowed,true);assert.match(readFileSync(join(f.directory,name),'utf8'),/KEEP_ESSENTIAL/);assert.match(readFileSync(join(f.directory,name),'utf8'),/torn/);await reopened.close();});

test('durably receipted deletion interrupted before checkpoint resumes without losing financial proof',async()=>{const f=fixture(),r=f.open();fill(r);await r.maintenance();const before=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8'));f.advance(300000);await r.maintenance();const after=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8'));const removed=before.diagnostics.find((m:any)=>!after.diagnostics.some((n:any)=>n.file===m.file));assert.ok(removed);after.diagnostics.unshift(removed);after.retiredBytes-=removed.bytes;await r.close();writeFileSync(join(f.directory,'state.json'),JSON.stringify(after)+'\n');const reopened=f.open();assert.equal(reopened.usage().retiredBytes,r.usage().retiredBytes);assert.ok(reopened.record('financial-recovery-proof',{revision:1},{essential:true}));await reopened.close();});

test('missing diagnostics without a valid eviction receipt fail closed',async()=>{const f=fixture(),r=f.open();r.record('source',payload());await r.pinRange('first',f.at,f.at);await r.close();const file=readdirSync(f.directory).find(x=>/^diagnostic-.*\.ndjson$/.test(x))!;unlinkSync(join(f.directory,file));assert.throws(()=>f.open(),/SEGMENT_MISSING/);});

test('the actual filesystem reserve blocks records honestly rather than consuming financial recovery space',async()=>{const f=fixture({minimumDiskReserveBytes:Number.MAX_SAFE_INTEGER}),r=f.open();assert.equal(r.usage().candidateAdmissionAllowed,false);assert.equal(r.record('raw-source',{}),false);assert.equal(r.record('critical-financial',{}, {essential:true}),false);assert.equal(r.usage().pressureReason,'FILESYSTEM_RESERVE');await r.close();});

test('a completed protected proof remains idempotently verifiable after its diagnostic source is retired',async()=>{const f=fixture(),r=f.open(),start=f.at;r.record('source',{full:'PINNED_RAW'});const first=await r.pinRange('durable-proof',start,f.at);assert.equal(first.complete,true);fill(r);await r.maintenance();f.advance(300000);await r.maintenance();assert.ok(r.usage().retiredBytes>0);const next=await r.pinRange('durable-proof',start,start);assert.equal(next.complete,true);assert.deepEqual(next.files,first.files);assert.equal(next.manifestSha256,first.manifestSha256);const evidence=next.files.map(file=>readFileSync(join(f.directory,file),'utf8')).join('');assert.match(evidence,/PINNED_RAW/);await r.close();});

test('overlapping pins retain shared source files until both copies have settled',async()=>{const f=fixture({segmentBytes:65536,diagnosticBytes:196608}),r=f.open(),start=f.at;for(let i=0;i<6;i++)assert.ok(r.record('source',payload(29000)));f.advance(300000);const one=r.pinRange('one',start,f.at),two=r.pinRange('two',start,f.at);await r.maintenance();const results=await Promise.all([one,two]);assert.equal(results.every(p=>p.complete),true);assert.equal((await r.pinRange('one',start,f.at)).complete,true);await r.close();});


test('a foreign hardlinked legacy pending file is never opened for truncation',async()=>{const f=fixture(),r=f.open(),outside=join(f.root,'original-financial-record');writeFileSync(outside,'IRREPLACEABLE_ORIGINAL',{mode:0o600});linkSync(outside,join(f.directory,'state.pending'));assert.equal(r.record('held-protection',{cost:'7'},{essential:true}),true);assert.equal(readFileSync(outside,'utf8'),'IRREPLACEABLE_ORIGINAL');await r.close();assert.equal(readFileSync(outside,'utf8'),'IRREPLACEABLE_ORIGINAL');});

test('only one recorder writer can own a namespace and a settled writer permits restart',async()=>{const f=fixture(),r=f.open();r.record('original',{raw:'A'});assert.throws(()=>f.open(),/WRITER_EXISTS/);assert.equal(r.record('original-after-rejected-second-writer',{raw:'B'}),true);await r.close();const next=f.open();assert.equal(next.record('same-namespace-restart',{raw:'C'}),true);await next.close();});

test('a pin arriving during asynchronous retirement verification prevents source deletion',async()=>{const f=fixture(),r=f.open(),start=f.at;for(let i=0;i<6;i++)assert.equal(r.record('raw',payload()),true);await r.maintenance();f.advance(300001);let releaseMaintenance!:()=>void,maintenanceReached!:()=>void,releasePin!:()=>void,pinReached!:()=>void;const maintenanceGate=new Promise<void>(resolve=>releaseMaintenance=resolve),seenMaintenance=new Promise<void>(resolve=>maintenanceReached=resolve),pinGate=new Promise<void>(resolve=>releasePin=resolve),seenPin=new Promise<void>(resolve=>pinReached=resolve);const internal=r as any,original=internal.verifyFile.bind(r);let paused=false,pinPaused=false;internal.verifyFile=async(m:any,destination?:string)=>{if(!destination&&!paused){paused=true;await original(m,destination);maintenanceReached();await maintenanceGate;return;}if(destination&&!pinPaused){pinPaused=true;pinReached();await pinGate;}return original(m,destination);};const maintenance=r.maintenance();await seenMaintenance;const files=readdirSync(f.directory).filter(x=>/^diagnostic-.*ndjson$/.test(x)),pinTask=r.pinRange('arriving-during-retirement',start,f.at);await seenPin;releaseMaintenance();await maintenance;assert.deepEqual(files.filter(x=>!existsSync(join(f.directory,x))),[]);releasePin();assert.equal((await pinTask).complete,true);await r.close();});

test('every refused timestamp invalidates a requested proof range despite coalesced receipts',async()=>{const f=fixture(),r=f.open();fill(r);await r.maintenance();f.advance(50);assert.equal(r.record('required-selected-event',payload()),false);await r.maintenance();f.advance(300001);await r.maintenance();assert.equal(r.record('fresh-later',{}),true);const pin=await r.pinRange('actual-refusal-inside',1000001,1000100);assert.equal(pin.complete,false);assert.ok(['RANGE_CONTAINS_REFUSAL','RANGE_NOT_RETAINED'].includes(pin.reason!));assert.ok(r.usage().refusalIntervals.some(v=>v.fromAt<=1000050&&v.toAt>=1000050));await r.close();});


test('loss of an entire committed essential prefix blocks new risk even with a zero-byte surviving file',async()=>{const f=fixture();crashed(f,`r.record('financial-checkpoint',{full:'ESSENTIAL_MUST_SURVIVE'},{essential:true})`);const before=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8')),meta=before.activeEssential;assert.ok(meta.bytes>0);writeFileSync(join(f.directory,meta.file),'');const r=f.open();assert.equal(r.usage().requiresCriticalRecovery,true);assert.equal(r.usage().candidateAdmissionAllowed,false);const recovered=receipts(f).find(v=>v.kind==='recovered-segment'&&v.data.kind==='essential');assert.equal(recovered.data.bytes,0);assert.equal(recovered.data.unusableTailBytes,0);assert.equal(recovered.data.invalidCommittedPrefix.expectedBytes,meta.bytes);assert.equal(recovered.data.invalidCommittedPrefix.expectedSha256,meta.prefixSha256);assert.equal(recovered.data.fullEssentialBytesPreserved,false);assert.ok(r.record('current-held-evaluation',{quote:'CURRENT'},{essential:true}));await r.close();const next=f.open();assert.equal(next.usage().requiresCriticalRecovery,true,'restart must preserve unresolved financial evidence loss');await next.close();});

test('loss of an entire committed diagnostic prefix cannot certify its historical window',async()=>{const f=fixture();crashed(f,`r.record('native-flow-raw-log',{full:'SELECTED_FLOW_MUST_SURVIVE'});r.record('financial-checkpoint',{}, {essential:true})`);const before=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8')),meta=before.activeDiagnostic;assert.ok(meta.bytes>0);writeFileSync(join(f.directory,meta.file),'');const r=f.open();assert.equal(r.usage().requiresCriticalRecovery,false,'diagnostic loss does not claim financial journal loss');const proof=await r.pinRange('lost-committed-flow',f.at,f.at);assert.equal(proof.complete,false);assert.equal(proof.reason,'RANGE_NOT_RETAINED');const recovered=receipts(f).find(v=>v.kind==='recovered-segment'&&v.data.kind==='diagnostic');assert.equal(recovered.data.invalidCommittedPrefix.expectedBytes,meta.bytes);assert.equal(recovered.data.invalidCommittedPrefix.expectedSha256,meta.prefixSha256);assert.ok(r.record('new-fresh-flow',{}));await r.close();});

test('proactive verified retirement preserves capture admission across a mature-history hard-watermark crossing',async()=>{
 const f=fixture(),r=f.open();assert.equal(r.record('held-financial-proof',{retain:'IRREPLACEABLE'},{essential:true}),true);
 for(let i=0;i<4;i++)assert.equal(r.record('required-selected-packet',payload()),true);await r.maintenance();
 const before=r.usage(),hard=before.diagnosticLimitBytes-4096;assert.equal(before.candidateAdmissionAllowed,true);assert.ok(before.diagnosticBytes< hard);
 f.advance(300001);await r.maintenance();
 assert.ok(r.usage().retiredBytes>0,'eligible history is verified/retired before the existing hard admission boundary');
 assert.equal(r.record('required-selected-packet',payload()),true);assert.equal(r.usage().candidateAdmissionAllowed,true,'the actual runtime pressure term stays false; no source quarantine is required');assert.equal(r.usage().refusedRecords,0);
 const current=await r.pinRange('fresh-current-proof',f.at,f.at);assert.equal(current.complete,true);assert.ok(current.files.some(file=>readFileSync(join(f.directory,file),'utf8').includes('required-selected-packet')));
 await r.close();const essential=readdirSync(f.directory).filter(n=>/^essential-.*\.ndjson$/.test(n)).map(n=>readFileSync(join(f.directory,n),'utf8')).join('');assert.match(essential,/IRREPLACEABLE/);
});

test('proactive maintenance keeps young required evidence and the unchanged hard admission guard',async()=>{
 const f=fixture(),r=f.open();for(let i=0;i<5;i++)assert.equal(r.record('required-selected-packet',payload()),true);await r.maintenance();assert.equal(r.usage().candidateAdmissionAllowed,false);assert.equal(r.usage().pressureReason,'DIAGNOSTIC_HEADROOM');assert.equal(r.usage().retiredBytes,0);assert.equal(r.usage().refusedRecords,0);
 f.advance(299999);await r.maintenance();assert.equal(r.usage().retiredBytes,0);assert.equal(r.usage().candidateAdmissionAllowed,false);
 f.advance(1);await r.maintenance();assert.equal(r.usage().candidateAdmissionAllowed,true);assert.ok(r.usage().retiredBytes>0);await r.close();
});

test('bounded proactive passes verify at most two files and concurrent callers share one worker',async()=>{
 const f=fixture({diagnosticBytes:40960}),r=f.open();for(let i=0;i<20;i++)assert.equal(r.record('raw',payload(1530)),true);await r.maintenance();assert.equal(r.usage().candidateAdmissionAllowed,true);f.advance(300001);
 const internal=r as any,verify=internal.verifyFile.bind(r);let verifications=0,release!:()=>void,reached!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>reached=resolve);
 internal.verifyFile=async(...args:any[])=>{verifications++;if(verifications===1){reached();await gate;}return verify(...args);};
 const first=r.maintenance();await seen;const second=r.maintenance();assert.equal(verifications,1,'a pending verification is not duplicated by a second caller');assert.equal(r.record('held-financial-proof',{current:'PRESERVED'},{essential:true}),true);
 release();await Promise.all([first,second]);assert.equal(verifications,2);assert.ok(r.usage().retiredBytes>0);assert.equal(r.usage().candidateAdmissionAllowed,true);assert.ok(r.usage().diagnosticBytes>40960-3*4096,'a pass remains bounded even when a third eligible file would reach the target');await r.close();
});

test('mature segments owned by a pending proof cannot be retired by proactive maintenance',async()=>{
 const f=fixture(),r=f.open(),start=f.at;for(let i=0;i<6;i++)assert.equal(r.record('required-packet',payload()),true);await r.maintenance();f.advance(300001);
 const internal=r as any,verify=internal.verifyFile.bind(r);let release!:()=>void,reached!:()=>void,blocked=false;const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>reached=resolve);
 internal.verifyFile=async(m:any,destination?:string)=>{if(destination&&!blocked){blocked=true;reached();await gate;}return verify(m,destination);};
 const proof=r.pinRange('pending-qualification',start,f.at);await seen;await r.maintenance();assert.equal(r.usage().retiredBytes,0);assert.equal(r.usage().candidateAdmissionAllowed,false,'pin ownership cannot be bypassed to restore admission');assert.equal(r.record('held-financial-proof',{current:'CONTINUES'},{essential:true}),true);
 release();assert.equal((await proof).complete,true);await r.maintenance();assert.ok(r.usage().retiredBytes>0);assert.equal(r.usage().candidateAdmissionAllowed,true);await r.close();
});

test('proactive retirement refuses corrupted files and small namespaces avoid maintenance below a segment',async()=>{
 const small=fixture({diagnosticBytes:8192}),tiny=small.open(),tinyInternal=tiny as any,tinyRefresh=tinyInternal.refreshDisk.bind(tiny);let forcedChecks=0;
 tinyInternal.refreshDisk=(force?:boolean)=>{if(force)forcedChecks++;return tinyRefresh(force);};assert.equal(tiny.record('small-current-diagnostic',{v:1}),true);await Promise.resolve();assert.equal(forcedChecks,0,'a valid two-segment namespace does not run maintenance on every small record');await tiny.close();
 const f=fixture(),r=f.open();for(let i=0;i<4;i++)assert.equal(r.record('required-packet',payload()),true);await r.maintenance();const file=readdirSync(f.directory).find(n=>/^diagnostic-.*\.ndjson$/.test(n))!,raw=readFileSync(join(f.directory,file));writeFileSync(join(f.directory,file),Buffer.alloc(raw.length,120));f.advance(300001);await r.maintenance();assert.equal(r.usage().candidateAdmissionAllowed,false);assert.equal(r.usage().pressureReason,'RETENTION_IO_OR_INTEGRITY_FAILURE');assert.equal(r.usage().retiredBytes,0);assert.equal(existsSync(join(f.directory,file)),true);assert.equal(r.record('new-unverified-input',{}),false);assert.equal(r.record('current-financial-proof',{retained:true},{essential:true}),true);await r.close();
});

test('continuous service sizes young mandatory flow from actual disk headroom without changing the legacy base policy',async()=>{
 const f=fixture({diagnosticBytes:24576,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open();
 for(let i=0;i<40;i++)assert.equal(r.record('required-executed-flow',payload()),true);await r.maintenance();
 const u=r.usage();assert.ok(u.diagnosticBytes>u.baseDiagnosticLimitBytes);assert.equal(u.candidateAdmissionAllowed,true);assert.equal(u.refusedRecords,0);assert.equal(u.retiredBytes,0,'young raw evidence remains lossless');assert.equal(u.baseDiagnosticLimitBytes,24576);assert.ok(u.diagnosticLimitBytes>=u.diagnosticBytes+4096);assert.ok(u.diagnosticLimitBytes<=131072);assert.ok(u.diagnosticLimitBytes<=u.baseDiagnosticLimitBytes+Math.floor((u.availableDiskBytes-2*u.minimumDiskReserveBytes)/32));
 assert.equal(JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8')).policy.diagnosticBytes,24576);await r.close();
});

test('continuous service grants bounded legacy working room on restart without pretending old diagnostics have matured',async()=>{
 const f=fixture(),legacy=f.open();for(let i=0;i<6;i++)assert.equal(legacy.record('required-legacy-flow',payload()),true);await legacy.close();
 const before=JSON.parse(readFileSync(join(f.directory,'state.json'),'utf8'));f.jumpWall(86400000);
 const r=new BoundedRotatingRecorder({...f.config,continuousRotation:true,maximumDiagnosticBytes:65536});const restored=r.usage();assert.equal(restored.diagnosticBytes,before.diagnostics.reduce((n:number,m:any)=>n+m.bytes,0));assert.equal(restored.candidateAdmissionAllowed,true);assert.ok(restored.diagnosticLimitBytes>restored.baseDiagnosticLimitBytes);assert.equal(restored.retiredBytes,0);
 await r.maintenance();f.advance(299999);await r.maintenance();assert.equal(r.usage().retiredBytes,0,'restart still requires the full monotonic retention horizon');
 f.advance(1);await r.maintenance();assert.ok(r.usage().retiredBytes>0);await r.maintenance();assert.equal(r.usage().diagnosticBytes,0);assert.equal(r.usage().diagnosticLimitBytes,12288,'working allocation shrinks to the unchanged base after old flow expires');await r.close();
});

test('continuous rotation retires verified mature diagnostics below the old capacity trigger while retaining financial proof',async()=>{
 const f=fixture({diagnosticBytes:40960,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open(),start=f.at;
 for(let i=0;i<4;i++)assert.equal(r.record('required-flow',payload()),true);await r.maintenance();const proof=await r.pinRange('durable-before-continuous-expiry',start,f.at);assert.equal(proof.complete,true);assert.equal(r.record('held-accounting',{retain:'FINANCIAL'},{essential:true}),true);
 assert.ok(r.usage().diagnosticBytes<40960-2*4096);f.advance(300000);await r.maintenance();assert.equal(r.usage().diagnosticBytes,0);assert.ok(r.usage().retiredBytes>0);for(const file of proof.files)assert.ok(existsSync(join(f.directory,file)));assert.equal((await r.pinRange('durable-before-continuous-expiry',start,start)).complete,true);await r.close();
 const control=fixture({diagnosticBytes:40960}),bounded=control.open();for(let i=0;i<4;i++)assert.equal(bounded.record('required-flow',payload()),true);await bounded.maintenance();control.advance(300000);await bounded.maintenance();assert.equal(bounded.usage().retiredBytes,0,'finite research retains the legacy bounded occupancy policy');await bounded.close();
});

test('adaptive capacity is bounded by its explicit maximum and cannot consume the actual filesystem reserve',async()=>{
 const f=fixture({diagnosticBytes:12288,continuousRotation:true,maximumDiagnosticBytes:32768}),r=f.open();let accepted=0;while(accepted<50&&r.record('required-flow',payload()))accepted++;assert.ok(accepted>6&&accepted<50);assert.equal(r.usage().diagnosticLimitBytes,32768);assert.equal(r.usage().candidateAdmissionAllowed,false);assert.ok(r.usage().refusedRecords>0);assert.equal(r.recordOutcome().kind,'unavailable');assert.equal((await r.pinRange('mandatory-gap',f.at,f.at)).complete,false);await r.close();
 const blocked=fixture({diagnosticBytes:12288,continuousRotation:true,maximumDiagnosticBytes:65536,minimumDiskReserveBytes:Number.MAX_SAFE_INTEGER}),noDisk=blocked.open();assert.equal(noDisk.usage().diagnosticLimitBytes,12288);assert.equal(noDisk.record('required-flow',payload()),false);assert.equal(noDisk.recordOutcome().kind,'unavailable');assert.equal(noDisk.usage().pressureReason,'FILESYSTEM_RESERVE');assert.equal(noDisk.usage().retiredBytes,0);await noDisk.close();
});

test('the adaptive allocation uses a bounded fraction of a measured disk snapshot and accounts for pending proof reservations',async()=>{
 const f=fixture({diagnosticBytes:12288,continuousRotation:true,maximumDiagnosticBytes:65536}),r=f.open(),internal=r as any;
 // Synthetic pressure snapshot only; the preceding test exercises the actual
 // statfs reserve. No filesystem is filled or provider resource consumed here.
 internal.refreshDisk=()=>{internal.availableBytes=131072;};for(let i=0;i<4;i++)assert.equal(r.record('required-flow',payload()),true);await r.maintenance();assert.ok(r.usage().diagnosticLimitBytes<=12288+131072/32);assert.ok(r.usage().diagnosticLimitBytes>12288);
 internal.pendingPinBytes=65536;assert.ok(r.usage().diagnosticLimitBytes<=12288+(131072-65536)/32);internal.pendingPinBytes=0;const before=r.usage().diagnosticLimitBytes;assert.equal(r.record('optional-never-expands',payload(3900),{required:false}),false);assert.equal(r.recordOutcome().kind,'optional-capacity-omitted');assert.equal(r.usage().diagnosticLimitBytes,before);await r.close();
});

test('continuous retirement remains limited to two verified files per pass even below every occupancy threshold',async()=>{
 const f=fixture({diagnosticBytes:131072,continuousRotation:true,maximumDiagnosticBytes:262144}),r=f.open();for(let i=0;i<12;i++)assert.equal(r.record('required-flow',payload()),true);await r.maintenance();await r.pinRange('bounded-continuous-retirement-proof',f.at,f.at);f.advance(300000);
 const internal=r as any,verify=internal.verifyFile.bind(r);let checked=0;internal.verifyFile=async(...args:any[])=>{checked++;return verify(...args);};const before=r.usage().diagnosticSegments;assert.ok(before>2);await r.maintenance();assert.equal(checked,2);assert.equal(r.usage().diagnosticSegments,before-2);await r.close();
});

test('explicit optional capacity omissions cannot grow allocation, close capture, or invalidate a complete mandatory-flow proof',async()=>{
 const f=fixture({diagnosticBytes:24576,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open(),start=f.at;
 for(let i=0;i<18;i++)assert.equal(r.record('required-selected-trade',payload()),true);await r.maintenance();const before=r.usage();
 assert.equal(r.record('optional-repeated-trace',payload(),{required:false}),false);assert.deepEqual(r.recordOutcome(),{kind:'optional-capacity-omitted',reason:'OPTIONAL_DIAGNOSTIC_HEADROOM'});const after=r.usage();assert.equal(after.optionalOmittedRecords,1);assert.ok(after.optionalOmittedBytes>0);assert.equal(after.diagnosticBytes,before.diagnosticBytes);assert.equal(after.diagnosticLimitBytes,before.diagnosticLimitBytes);assert.equal(after.refusedRecords,0);assert.deepEqual(after.refusalIntervals,[]);assert.equal(after.candidateAdmissionAllowed,true);
 const proof=await r.pinRange('mandatory-complete-despite-optional-trace-omission',start,f.at);assert.equal(proof.complete,true);const manifest=JSON.parse(readFileSync(join(f.directory,proof.files[0]!.split('/')[0]!,'manifest.json'),'utf8'));assert.equal(manifest.optionalDiagnostics.omittedRecords,1);assert.equal(manifest.optionalDiagnostics.requiredTradingFlowUnaffected,true);assert.match(manifest.optionalDiagnostics.meaning,/not missing executed trading flow/);await r.close();
 const reopened=new BoundedRotatingRecorder({...f.config,continuousRotation:true,maximumDiagnosticBytes:131072});assert.equal(reopened.usage().optionalOmittedRecords,1);assert.equal(reopened.usage().refusedRecords,0);await reopened.close();
});

test('adaptive proof larger than the legacy base remains verifiable after its raw diagnostic source rotates',async()=>{
 const f=fixture({diagnosticBytes:12288,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open(),start=f.at;
 for(let i=0;i<12;i++)assert.equal(r.record('required-full-market-flow',payload()),true);await r.maintenance();const proof=await r.pinRange('greater-than-legacy-cap-proof',start,f.at);assert.equal(proof.complete,true);assert.ok(proof.bytes>12288);f.advance(300000);for(let i=0;i<4;i++)await r.maintenance();assert.equal(r.usage().diagnosticBytes,0);assert.equal(r.usage().diagnosticLimitBytes,12288);
 const revalidated=await r.pinRange('greater-than-legacy-cap-proof',start,start);assert.equal(revalidated.complete,true);assert.equal(revalidated.manifestSha256,proof.manifestSha256);assert.deepEqual(revalidated.files,proof.files);await r.close();
});

test('an optional append with partial filesystem failure is unavailable rather than a harmless diagnostic omission',async()=>{
 const f=fixture({diagnosticBytes:24576,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open();assert.equal(r.record('held-financial-proof',{retain:'FINANCIAL'},{essential:true}),true);assert.equal(r.record('required-flow',{}),true);await r.maintenance();
 const internal=r as any,write=internal.write.bind(r);let fail=true;internal.write=(fd:number,raw:Buffer)=>{if(fail){fail=false;write(fd,raw.subarray(0,7));throw Error('OFFLINE injected partial write');}return write(fd,raw);};assert.equal(r.record('optional-trace',{v:1},{required:false}),false);assert.equal(r.recordOutcome().kind,'unavailable');assert.equal(r.usage().optionalOmittedRecords,0);assert.equal(r.usage().candidateAdmissionAllowed,false);assert.equal(r.usage().pressureReason,'RECORD_IO_OR_INTEGRITY_FAILURE');assert.equal((await r.pinRange('partial-io-cannot-certify',f.at,f.at)).complete,false);assert.equal(r.record('held-financial-proof',{current:'CONTINUES'},{essential:true}),true);await r.close();
 const invalid=fixture(),forbidden=invalid.open();assert.equal(forbidden.record('financial-must-be-required',{}, {essential:true,required:false}),false);assert.equal(forbidden.recordOutcome().kind,'unavailable');assert.equal(forbidden.usage().optionalOmittedRecords,0);assert.equal(forbidden.usage().candidateAdmissionAllowed,false);await forbidden.close();
});

test('required refusals and integrity failures during raw-copy or manifest awaits cannot publish a complete proof; optional omissions remain distinct',async()=>{
 // Regression for a pre-existing race found by independent review, not an
 // observed live qualification failure. Same-millisecond capture can extend a
 // refusal interval while a requested upper boundary is being copied.
 for(const phase of ['copy','manifest'] as const)for(const incident of ['required-refusal','integrity-failure','optional-omission'] as const){
  const f=fixture({diagnosticBytes:24576,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open(),internal=r as any,label=phase+':'+incident;assert.equal(r.record('required-executed-flow',{signature:'EXACT_REQUIRED_FLOW'}),true);await r.maintenance();
  let release!:()=>void,reached!:()=>void,paused=false;const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>reached=resolve);
  if(phase==='copy'){const verify=internal.verifyFile.bind(r);internal.verifyFile=async(m:any,destination?:string)=>{if(destination&&!paused){paused=true;reached();await gate;}return verify(m,destination);};}
  else{const stage=internal.stageProofManifest.bind(r);internal.stageProofManifest=async(...args:any[])=>{const pending=await stage(...args);reached();await gate;return pending;};}
  const task=r.pinRange('independent-review-race:'+label,f.at,f.at);await seen;
  if(incident==='required-refusal'){assert.equal(r.record('required-flow-cannot-fit',payload(5000)),false,label);assert.equal(r.usage().refusalIntervals.length,1,label);}
  else if(incident==='integrity-failure'){const write=internal.write.bind(r);internal.write=()=>{throw Error('OFFLINE injected capture I/O failure');};assert.equal(r.record('required-capture-io',{}),false,label);internal.write=write;assert.equal(r.usage().pressureReason,'RECORD_IO_OR_INTEGRITY_FAILURE',label);}
  else{assert.equal(r.record('optional-oversized-trace',payload(5000),{required:false}),false,label);assert.equal(r.recordOutcome().kind,'optional-capacity-omitted',label);assert.equal(r.usage().refusalIntervals.length,0,label);}
  release();const proof=await task,proofDirectory=join(f.directory,'proof-'+sha('independent-review-race:'+label));
  if(incident==='optional-omission'){assert.equal(proof.complete,true,label);assert.equal(existsSync(join(proofDirectory,'manifest.json')),true,label);}
  else{assert.equal(proof.complete,false,label);assert.equal(proof.reason,incident==='required-refusal'?'RANGE_CONTAINS_REFUSAL':'RECORDER_INTEGRITY_UNAVAILABLE',label);assert.equal(existsSync(join(proofDirectory,'manifest.json')),false,label);if(phase==='manifest')assert.ok(readdirSync(proofDirectory).some(name=>/^manifest-.*\.pending$/.test(name)),'unaccepted staged evidence remains preserved');}
  await r.close();
 }
});

test('protected-proof revalidation rechecks concurrent mandatory loss without deleting the original historical proof',async()=>{
 for(const incident of ['required-refusal','integrity-failure','optional-omission'] as const){
  const f=fixture({diagnosticBytes:24576,continuousRotation:true,maximumDiagnosticBytes:131072}),r=f.open(),internal=r as any,id='revalidation-race:'+incident;assert.equal(r.record('required-flow',{signature:'ORIGINAL'}),true);await r.maintenance();const original=await r.pinRange(id,f.at,f.at);assert.equal(original.complete,true);const manifest=join(f.directory,original.files[0]!.split('/')[0]!,'manifest.json'),originalBytes=readFileSync(manifest);
  let release!:()=>void,reached!:()=>void,paused=false;const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>reached=resolve),verify=internal.verifyFile.bind(r);internal.verifyFile=async(m:any,destination?:string)=>{if(m.file.startsWith('proof-')&&!paused){paused=true;reached();await gate;}return verify(m,destination);};
  const task=r.pinRange(id,f.at,f.at);await seen;
  if(incident==='required-refusal')assert.equal(r.record('missing-required-flow',payload(5000)),false);
  else if(incident==='integrity-failure'){const write=internal.write.bind(r);internal.write=()=>{throw Error('OFFLINE injected revalidation I/O failure');};assert.equal(r.record('required-flow',{}),false);internal.write=write;}
  else assert.equal(r.record('optional-trace',payload(5000),{required:false}),false);
  release();const checked=await task;assert.equal(checked.complete,incident==='optional-omission',incident);if(incident!=='optional-omission')assert.equal(checked.reason,incident==='required-refusal'?'RANGE_CONTAINS_REFUSAL':'RECORDER_INTEGRITY_UNAVAILABLE');assert.deepEqual(readFileSync(manifest),originalBytes,'already committed historical evidence is preserved');await r.close();
 }
});
