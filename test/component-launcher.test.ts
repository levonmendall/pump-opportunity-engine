/** Offline filesystem races only. Never launches a child or contacts a provider. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,unlinkSync,symlinkSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scanActiveComponentEvidence,COMPONENT_ATOMIC_TEMP_HEADROOM,componentWatchFailure} from '../scripts/component-launcher.js';
const pid=12345;
function fixture(t:{after:(f:()=>void)=>void}){const dir=mkdtempSync(join(tmpdir(),'poe-active-scan-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('exact active budget temp can vanish between readdir and stat; full transient headroom remains counted',t=>{
 const dir=fixture(t),temp=join(dir,'rpc-budget.json.pending-'+pid);writeFileSync(join(dir,'rpc-budget.json'),'stable');writeFileSync(temp,'transient');
 const r=scanActiveComponentEvidence(dir,{writerPid:pid,beforeStat(path){if(path===temp)unlinkSync(path);}});
 assert.equal(r.stableBytes,6);assert.equal(r.observedAtomicBytes,0);assert.equal(r.vanishedAtomicFiles,1);assert.equal(r.countedBytes,6+128*1024);assert.equal(r.atomicTempHeadroomBytes,COMPONENT_ATOMIC_TEMP_HEADROOM);
});
test('present atomic temp is rounded up inside the fixed128KiB transient slot, never omitted or counted twice',t=>{
 const dir=fixture(t);writeFileSync(join(dir,'observations.ndjson'),'evidence');writeFileSync(join(dir,'rpc-budget.json.pending-'+pid),Buffer.alloc(1024));
 const r=scanActiveComponentEvidence(dir,{writerPid:pid});assert.equal(r.measuredBytes,8+1024);assert.equal(r.countedBytes,8+128*1024);
});
test('stable file deletion and another writer temp deletion still fail closed',t=>{
 for(const name of ['rpc-budget.json','observations.ndjson','rpc-budget.json.pending-'+(pid+1)]){
  const dir=fixture(t),file=join(dir,name);writeFileSync(file,'record');assert.throws(()=>scanActiveComponentEvidence(dir,{writerPid:pid,beforeStat(path){if(path===file)unlinkSync(path);}}),(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT');
 }
});
test('root, stable and recognized temporary symlinks are all refused',t=>{
 const outer=fixture(t),target=join(outer,'real');mkdirSync(target);const alias=join(outer,'alias');symlinkSync(target,alias);assert.throws(()=>scanActiveComponentEvidence(alias,{writerPid:pid}),/COMPONENT_EVIDENCE_SYMLINK/);
 for(const name of ['rpc-budget.json','rpc-budget.json.pending-'+pid]){const dir=fixture(t);symlinkSync(target,join(dir,name));assert.throws(()=>scanActiveComponentEvidence(dir,{writerPid:pid}),/COMPONENT_EVIDENCE_SYMLINK/);}
});
test('oversized or directory-shaped atomic temp is refused; nested lookalike gets no disappearance exception',t=>{
 const dir=fixture(t),temp=join(dir,'rpc-budget.json.pending-'+pid);writeFileSync(temp,Buffer.alloc(128*1024+1));assert.throws(()=>scanActiveComponentEvidence(dir,{writerPid:pid}),/COMPONENT_ATOMIC_TEMP_SIZE/);unlinkSync(temp);mkdirSync(temp);assert.throws(()=>scanActiveComponentEvidence(dir,{writerPid:pid}),/COMPONENT_ATOMIC_TEMP_FILE_TYPE/);
 const nested=fixture(t),sub=join(nested,'nested');mkdirSync(sub);const f=join(sub,'rpc-budget.json.pending-'+pid);writeFileSync(f,'record');assert.throws(()=>scanActiveComponentEvidence(nested,{writerPid:pid,beforeStat(path){if(path===f)unlinkSync(path);}}),(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT');
});
test('transient slot is reserved on every scan, including an empty active directory',t=>{
 const dir=fixture(t),r=scanActiveComponentEvidence(dir,{writerPid:pid});assert.equal(r.measuredBytes,0);assert.equal(r.countedBytes,128*1024);
 for(const bad of [0,-1,1.5,Number.NaN])assert.throws(()=>scanActiveComponentEvidence(dir,{writerPid:bad}),/COMPONENT_CHILD_PID_UNAVAILABLE/);
});
test('only proc ENOENT waits for the child exit event; permissions and stable missing evidence stop immediately',()=>{
 const error=Object.assign(Error('untrusted path and message must not be retained'),{code:'ENOENT'});
 for(const stage of ['child-proc-status','child-proc-stat'] as const){const r=componentWatchFailure(stage,error);assert.deepEqual(r,{stage,errno:'ENOENT',failureCode:null,disposition:'await-child-exit'});}
 assert.equal(componentWatchFailure('active-evidence-scan',error).disposition,'stop');assert.equal(componentWatchFailure('prior-counterbook-hash',error).disposition,'stop');
 for(const code of ['EACCES','EPERM','ESRCH'])assert.equal(componentWatchFailure('child-proc-status',Object.assign(Error('secret path'),{code})).disposition,'stop');
 assert.deepEqual(componentWatchFailure('active-evidence-scan',Error('COMPONENT_EVIDENCE_SYMLINK')),{stage:'active-evidence-scan',errno:null,failureCode:'COMPONENT_EVIDENCE_SYMLINK',disposition:'stop'});
 const sanitized=componentWatchFailure('child-proc-status',Object.assign(Error('sensitive unknown native message'),{code:'bad\nsecret'}));assert.equal(sanitized.errno,null);assert.equal(sanitized.failureCode,null);assert.equal(JSON.stringify(sanitized).includes('secret'),false);
});
