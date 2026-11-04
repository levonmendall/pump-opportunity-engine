import assert from 'node:assert/strict';
import test from 'node:test';
import fs,{chmodSync,existsSync,linkSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync,lstatSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {NativeManualAdmissionPause,readNativeManualAdmissionPause} from '../src/native-manual-admission-pause.js';
import {serveNativeAccountControl} from '../src/native-account-control.js';
import {runtimeCommand} from '../src/runtime.js';

function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'poe-OFFLINE-manual-marker-'));chmodSync(directory,0o700);
 const path=join(directory,'manual-admission-pause.json'),identity={directory,accountId:'original-marker-fixture',inceptionAt:1000,ownerUid:process.getuid!(),ownerGid:process.getgid!()};
 const marker=(at=2000,task=false)=>({schemaVersion:1,accountId:identity.accountId,inceptionAt:identity.inceptionAt,at,reason:task?'task-owned source verification in progress; normal financial controls remain authoritative':'owner paused new entries',...(task?{authorizationId:'poe-h11-deployment-original-task'}:{})});
 const write=(value:unknown=marker())=>{const raw=JSON.stringify(value)+'\n';writeFileSync(path,raw,{mode:0o600});chmodSync(path,0o600);return raw;};
 return {directory,path,identity,marker,write,remove:()=>rmSync(directory,{recursive:true,force:true})};
}
const sha=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex');

test('established five-field owner and six-field task markers retain exact original clocks and bytes',()=>{
 for(const task of [false,true]){
  const f=fixture();try{
   const raw=f.write(f.marker(2000,task)),before=lstatSync(f.path),value=readNativeManualAdmissionPause(f.identity,5000);
   assert.deepEqual(value,{state:'present',observedAt:5000,markerAt:2000,markerSha256:sha(raw),markerKind:task?'task':'owner'});
   assert.equal(readFileSync(f.path,'utf8'),raw);const after=lstatSync(f.path);
   for(const key of ['dev','ino','size','mtimeMs','ctimeMs','mode'] as const)assert.equal(after[key],before[key]);
  }finally{f.remove();}
 }
});

test('a marker arriving after startup closes the same cached entry gate and disappearance never resumes it',()=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);try{
  let manualPaused=owner.reconcile(3000).paused;const mayEnter=()=>!manualPaused;
  assert.equal(mayEnter(),true);const raw=f.write();manualPaused=owner.reconcile(5000).paused;
  assert.equal(mayEnter(),false);assert.equal(owner.usage().validMarkerLatched,true);
  unlinkSync(f.path);manualPaused=owner.reconcile(6000).paused;assert.equal(mayEnter(),false);
  assert.deepEqual(owner.usage().lastVerifiedMarker,{firstObservedAt:5000,markerAt:2000,markerSha256:sha(raw),markerKind:'owner'});
  owner.ownerResumeAcknowledged();manualPaused=owner.reconcile(7000).paused;assert.equal(mayEnter(),true);
 }finally{f.remove();}
});

test('repeated successful reads do not refresh original or first-observed marker evidence',()=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);try{
  const raw=f.write();assert.equal(owner.reconcile(5000).changed,true);
  for(let at=5001;at<5101;at++)assert.equal(owner.reconcile(at).changed,false);
  const view=owner.usage();assert.equal(view.transitionCount,1);assert.equal(view.recentTransitions.length,1);
  assert.equal(view.lastVerifiedMarker?.firstObservedAt,5000);assert.equal(view.lastVerifiedMarker?.markerAt,2000);
  assert.equal(view.recentTransitions[0]?.observedAt,5000);assert.equal(readFileSync(f.path,'utf8'),raw);
 }finally{f.remove();}
});

test('owner intent remains authoritative if its marker is absent or a temporary read inhibition clears',()=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);try{
  assert.equal(owner.reconcile(3000).paused,false);owner.ownerPauseRequested();
  assert.equal(owner.reconcile(4000).paused,true);assert.equal(owner.usage().validMarkerLatched,false);
  assert.equal(owner.usage().ownerIntentLatched,true);owner.ownerResumeAcknowledged();assert.equal(owner.reconcile(5000).paused,false);
 }finally{f.remove();}
});

test('transient read failure closes only current entry and cannot fabricate a sticky valid owner pause',t=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);const original=fs.lstatSync;
 try{
  assert.equal(owner.reconcile(3000).paused,false);
  t.mock.method(fs,'lstatSync',(function(path:any,options:any){if(path===f.path)throw Object.assign(Error('PRIVATE_IO_SENTINEL'),{code:'EACCES'});return original(path,options);}) as typeof fs.lstatSync);syncBuiltinESMExports();
  const failure=owner.reconcile(4000);assert.equal(failure.paused,true);assert.deepEqual(failure.observation,{state:'unavailable',observedAt:4000,reason:'marker-read'});
  assert.equal(owner.entryReason(),'MANUAL_ADMISSION_MARKER_UNAVAILABLE');
  assert.equal(owner.usage().validMarkerLatched,false);assert.equal(owner.usage().ownerIntentLatched,false);
  assert.equal(JSON.stringify(owner.usage()).includes('PRIVATE_IO_SENTINEL'),false);
  t.mock.restoreAll();syncBuiltinESMExports();assert.equal(owner.reconcile(5000).paused,false);assert.equal(owner.entryReason(),null);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();f.remove();}
});

test('a genuine owner pause requested during a failed read is not cleared by read recovery',t=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);const original=fs.lstatSync;
 try{
  t.mock.method(fs,'lstatSync',(function(path:any,options:any){if(path===f.path)throw Object.assign(Error('PRIVATE'),{code:'EIO'});return original(path,options);}) as typeof fs.lstatSync);syncBuiltinESMExports();
  assert.equal(owner.reconcile(4000).paused,true);owner.ownerPauseRequested();t.mock.restoreAll();syncBuiltinESMExports();
  assert.equal(owner.reconcile(5000).paused,true);owner.ownerResumeAcknowledged();assert.equal(owner.reconcile(6000).paused,false);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();f.remove();}
});

test('malformed, expanded, wrong-account or future marker data close entry without changing retained bytes',()=>{
 const f=fixture();try{
  const cases=[
   {value:{...f.marker(),schemaVersion:2},reason:'marker-schema'},
   {value:{...f.marker(),extra:'untrusted'},reason:'marker-schema'},
   {value:{...f.marker(),reason:{}},reason:'marker-schema'},
   {value:{...f.marker(),authorizationId:''},reason:'marker-schema'},
   {value:{...f.marker(),accountId:'another-account'},reason:'marker-identity'},
   {value:{...f.marker(),inceptionAt:999},reason:'marker-identity'},
   {value:{...f.marker(),at:0},reason:'marker-clock'},
   {value:{...f.marker(),at:5001},reason:'marker-clock'},
   {value:{...f.marker(),at:2000.5},reason:'marker-clock'},
  ];
  for(const {value,reason} of cases){const raw=f.write(value),owner=new NativeManualAdmissionPause(f.identity);const view=owner.reconcile(5000);assert.equal(view.paused,true);assert.deepEqual(view.observation,{state:'unavailable',observedAt:5000,reason});assert.equal(owner.usage().validMarkerLatched,false);assert.equal(readFileSync(f.path,'utf8'),raw);}
 }finally{f.remove();}
});

test('invalid UTF-8, duplicate and escaped duplicate keys cannot create verified marker evidence',()=>{
 const f=fixture();try{
  const good=JSON.stringify(f.marker());const cases=[Buffer.from('not-json'),Buffer.concat([Buffer.from(good.slice(0,-1)+',"unknown":"'),Buffer.from([0xff]),Buffer.from('"}')]),Buffer.from(good.replace('"accountId":','"accountId":"wrong","accountId":')),Buffer.from(good.replace('"accountId":','"account\\u0049d":"wrong","accountId":'))];
  for(const raw of cases){writeFileSync(f.path,raw,{mode:0o600});const result=readNativeManualAdmissionPause(f.identity,5000);assert.deepEqual(result,{state:'unavailable',observedAt:5000,reason:'marker-json'});assert.equal(readFileSync(f.path).equals(raw),true);}
 }finally{f.remove();}
});

test('symlink, hardlink and wrong-mode paths are refused without following or removing them',()=>{
 const f=fixture();try{
  const target=join(f.directory,'retained-other.json');writeFileSync(target,JSON.stringify(f.marker()),{mode:0o600});symlinkSync(target,f.path);
  assert.equal(readNativeManualAdmissionPause(f.identity,5000).state,'unavailable');assert.equal(lstatSync(f.path).isSymbolicLink(),true);unlinkSync(f.path);
  f.write();linkSync(f.path,join(f.directory,'second-link'));assert.deepEqual(readNativeManualAdmissionPause(f.identity,5000),{state:'unavailable',observedAt:5000,reason:'marker-owner'});unlinkSync(join(f.directory,'second-link'));
  chmodSync(f.path,0o640);assert.deepEqual(readNativeManualAdmissionPause(f.identity,5000),{state:'unavailable',observedAt:5000,reason:'marker-owner'});
  assert.equal(readFileSync(target,'utf8'),JSON.stringify(f.marker()));assert.equal(existsSync(f.path),true);
 }finally{f.remove();}
});

test('canonical private parent and actual file ownership are required even for otherwise valid JSON',()=>{
 const f=fixture();try{
  f.write();chmodSync(f.directory,0o755);assert.deepEqual(readNativeManualAdmissionPause(f.identity,5000),{state:'unavailable',observedAt:5000,reason:'marker-owner'});chmodSync(f.directory,0o700);
  assert.deepEqual(readNativeManualAdmissionPause({...f.identity,ownerUid:f.identity.ownerUid+1},5000),{state:'unavailable',observedAt:5000,reason:'marker-owner'});
  const alias=f.directory+'-alias';symlinkSync(f.directory,alias);try{assert.deepEqual(readNativeManualAdmissionPause({...f.identity,directory:alias},5000),{state:'unavailable',observedAt:5000,reason:'marker-path'});}finally{unlinkSync(alias);}
 }finally{f.remove();}
});

test('empty and oversized files are bounded refusals while their bytes remain untouched',()=>{
 const f=fixture();try{for(const size of [0,4097]){const raw=Buffer.alloc(size,32);writeFileSync(f.path,raw,{mode:0o600});assert.deepEqual(readNativeManualAdmissionPause(f.identity,5000),{state:'unavailable',observedAt:5000,reason:'marker-size'});assert.equal(readFileSync(f.path).equals(raw),true);}}finally{f.remove();}
});

test('a file changed during its bounded read is unavailable rather than a successful pause witness',t=>{
 const f=fixture(),original=fs.readSync;try{
  f.write();t.mock.method(fs,'readSync',(function(...args:any[]){const result=(original as any)(...args);chmodSync(f.path,0o640);return result;}) as typeof fs.readSync);syncBuiltinESMExports();
  const owner=new NativeManualAdmissionPause(f.identity),view=owner.reconcile(5000);assert.equal(view.paused,true);assert.deepEqual(view.observation,{state:'unavailable',observedAt:5000,reason:'marker-changed'});assert.equal(owner.usage().validMarkerLatched,false);
 }finally{t.mock.restoreAll();syncBuiltinESMExports();f.remove();}
});

test('a parent made unsafe during the read cannot certify a valid marker',t=>{
 const f=fixture(),original=fs.readSync;try{
  f.write();t.mock.method(fs,'readSync',(function(...args:any[]){const result=(original as any)(...args);chmodSync(f.directory,0o755);return result;}) as typeof fs.readSync);syncBuiltinESMExports();
  assert.deepEqual(readNativeManualAdmissionPause(f.identity,5000),{state:'unavailable',observedAt:5000,reason:'marker-owner'});
 }finally{t.mock.restoreAll();syncBuiltinESMExports();chmodSync(f.directory,0o700);f.remove();}
});

test('ENOENT during a parent-permission race does not falsely certify marker absence',t=>{
 const f=fixture(),original=fs.lstatSync;try{
  t.mock.method(fs,'lstatSync',(function(path:any,options:any){if(path===f.path){chmodSync(f.directory,0o755);throw Object.assign(Error('PRIVATE'),{code:'ENOENT'});}return original(path,options);}) as typeof fs.lstatSync);syncBuiltinESMExports();
  assert.deepEqual(readNativeManualAdmissionPause(f.identity,5000),{state:'unavailable',observedAt:5000,reason:'marker-owner'});
 }finally{t.mock.restoreAll();syncBuiltinESMExports();chmodSync(f.directory,0o700);f.remove();}
});

test('a resumed owner immediately notices a replacement marker and does not grant entry',()=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);try{
  f.write();assert.equal(owner.reconcile(5000).paused,true);unlinkSync(f.path);owner.ownerResumeAcknowledged();
  const raw=f.write(f.marker(5500,true));assert.equal(owner.reconcile(6000).paused,true);assert.equal(owner.usage().lastVerifiedMarker?.markerSha256,sha(raw));assert.equal(owner.usage().lastVerifiedMarker?.markerAt,5500);
 }finally{f.remove();}
});

test('transition diagnostics remain bounded and record actual changes rather than every check',()=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);try{
  for(let i=0;i<30;i++){if(i%2)f.write({...f.marker(),at:2000+i});else if(existsSync(f.path))unlinkSync(f.path);owner.reconcile(5000+i);}
  const view=owner.usage();assert.equal(view.recentTransitions.length,8);assert.equal(view.transitionCount,30);assert.equal(view.recentTransitions.at(-1)?.observedAt,5029);
  owner.reconcile(6000);assert.equal(owner.usage().transitionCount,30,'the read time alone is not a state transition');
 }finally{f.remove();}
});

test('the real bounded owner status transport synchronizes the actual entry gate without invoking financial pause',async()=>{
 const f=fixture(),owner=new NativeManualAdmissionPause(f.identity);let at=3000,manualPaused=owner.reconcile(at).paused,financialCalls=0;
 const server=await serveNativeAccountControl({path:join(f.directory,'control.sock'),status:()=>{manualPaused=owner.reconcile(++at).paused;return {manualPaused};},pause:()=>{financialCalls++;return {};},resume:()=>{financialCalls++;return {};},safeStop:()=>{financialCalls++;return {};},onError:()=>{}});
 try{
  const mayEnter=()=>!manualPaused;assert.equal(mayEnter(),true);f.write(f.marker(2000,true));
  const reply=await runtimeCommand(join(f.directory,'control.sock'),'status');assert.equal(reply.manualPaused,true);assert.equal(mayEnter(),false);assert.equal(financialCalls,0);
  unlinkSync(f.path);await runtimeCommand(join(f.directory,'control.sock'),'status');assert.equal(mayEnter(),false);assert.equal(financialCalls,0);
 }finally{await server.close();f.remove();}
});
