import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {BoundedRotatingRecorder} from '../src/retained-recorder.js';
import {NativePaperProofPreparation} from '../src/native-paper-proof-preparation.js';
import type {NativeQualificationProof} from '../src/native-paper.js';

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');

function realRecorder(){
 const root=mkdtempSync(join(tmpdir(),'poe-OFFLINE-proof-cache-'));let at=1793758810000;
 const recorder=new BoundedRotatingRecorder({directory:join(root,'evidence'),segmentBytes:4096,diagnosticBytes:131072,minRetentionMs:300000,minimumDiskReserveBytes:0,now:()=>at,monotonic:()=>at-1793758810000});
 recorder.record('required-market-flow',{fixture:'Original bounded observation metadata; no financial database'});
 const released:string[]=[],pins:{proof:NativeQualificationProof;result:Promise<Awaited<ReturnType<BoundedRotatingRecorder['pinProvisionalRange']>>>}[]=[];
 const preparation=new NativePaperProofPreparation(()=>at,id=>{released.push(id);recorder.releaseUnusedProof('entry-'+hash(id));});
 const pin=async(proof:NativeQualificationProof)=>{
  const result=recorder.pinProvisionalRange('entry-'+hash(proof.proofId),proof.startAt,proof.throughAt,proof.deadlineAt);
  pins.push({proof:{...proof},result});const value=await result;
  assert.equal(value.complete,true,value.reason??'complete real recorder proof required');
 };
 const proof=(mint:string,certificateAt:number,throughAt:number):NativeQualificationProof=>({proofId:['entry',mint,1793758870000,certificateAt,'a'.repeat(64)].join(':'),mint,startAt:1793758810000,throughAt,windowEndAt:1793758870000,featuresSha256:'a'.repeat(64),certificateAt,deadlineAt:1793758879999});
 return {root,recorder,preparation,released,pins,pin,proof,get at(){return at;},set at(v:number){at=v;},manifest(p:NativeQualificationProof){return join(root,'evidence','proof-'+hash('entry-'+hash(p.proofId)),'manifest.json');},async settle(){await turn();await Promise.all(pins.map(p=>p.result));await turn();},async close(){await recorder.close();rmSync(root,{recursive:true,force:true});}};
}

test('XTjj to SoRS to XTjj retains the original complete proof and never repins a changed range',async()=>{
 const f=realRecorder();
 try{
  f.at=1793758874676;f.recorder.record('audit-available',{mint:'XTjj'});
  const a=f.proof('XTjj',1793758874643,f.at);
  assert.equal(f.preparation.prepare(a,f.pin),false);await f.settle();
  assert.equal(f.preparation.ready(a),true);const original=readFileSync(f.manifest(a));
  f.at=1793758875529;f.recorder.record('audit-available',{mint:'SoRS'});
  const b=f.proof('SoRS',1793758875366,f.at);
  assert.equal(f.preparation.prepare(b,f.pin),false);
  assert.equal(f.preparation.ready({...a,throughAt:f.at}),true,'a ranked peer cannot discard a still-current complete certificate');
  await f.settle();assert.equal(f.preparation.ready(b),true);
  f.at=1793758876677;
  assert.equal(f.preparation.prepare({...a,throughAt:f.at},f.pin),true,'the original completed range is reused after the peer financial turn');
  assert.equal(f.preparation.ready({...a,throughAt:f.at}),true);assert.equal(f.pins.length,2);assert.deepEqual(f.released,[]);
  assert.deepEqual(readFileSync(f.manifest(a)),original,'reuse never rewrites the immutable evidence range');
  const forbidden=await f.recorder.pinProvisionalRange('entry-'+hash(a.proofId),a.startAt,f.at,a.deadlineAt);
  assert.equal(forbidden.complete,false,'the real recorder still refuses the same immutable proof ID with a changed throughAt');
  assert.equal(forbidden.reason,'PIN_IO_OR_INTEGRITY_FAILURE');assert.deepEqual(readFileSync(f.manifest(a)),original);
  assert.equal(f.preparation.ready({...a,throughAt:f.at}),true,'a refused independent repin does not extend or destroy the original cached certificate');
  f.at=a.deadlineAt;assert.equal(f.preparation.ready({...a,throughAt:f.at}),true);
  f.at++;assert.equal(f.preparation.ready({...a,throughAt:f.at}),false);f.preparation.maintenance();assert.deepEqual(new Set(f.released),new Set([a.proofId,b.proofId]));
  assert.ok(existsSync(f.manifest(a)),'unused reference cleanup preserves the recorder deadline and grace policy');
 }finally{await f.close();}
});

function memory(){
 let at=100;const releases:string[]=[],calls:NativeQualificationProof[]=[];
 const preparation=new NativePaperProofPreparation(()=>at,id=>{releases.push(id);});
 const proof=(mint:string,changes:Partial<NativeQualificationProof>={}):NativeQualificationProof=>({proofId:'OFFLINE:'+mint,mint,startAt:1,throughAt:100,windowEndAt:90,featuresSha256:'a'.repeat(64),certificateAt:95,deadlineAt:200,...changes});
 const pin=async(p:NativeQualificationProof)=>{calls.push({...p});};
 return {preparation,proof,pin,calls,releases,get at(){return at;},set at(v:number){at=v;}};
}

test('four current proofs are reusable and a fifth cannot evict them',async()=>{
 const f=memory(),proofs=['a','b','c','d'].map(mint=>f.proof(mint));
 for(const proof of proofs){assert.equal(f.preparation.prepare(proof,f.pin),false);await turn();}
 f.at=150;for(const proof of proofs){assert.equal(f.preparation.prepare({...proof,throughAt:150},f.pin),true);assert.equal(f.preparation.usage(proof)?.availableAt,100);}
 assert.deepEqual(f.preparation.retainedMints(),['a','b','c','d']);
 assert.equal(f.preparation.prepare(f.proof('e',{throughAt:150}),f.pin),false);await turn();
 assert.equal(f.calls.length,4);assert.deepEqual(f.releases,[]);for(const proof of proofs)assert.equal(f.preparation.ready(proof),true);
 f.preparation.maintenance(proof=>proof.mint!=='b');assert.deepEqual(f.releases,['OFFLINE:b']);assert.equal(f.preparation.ready(proofs[1]!),false);
 assert.equal(f.preparation.prepare(f.proof('e',{throughAt:150}),f.pin),false);await turn();assert.equal(f.calls.length,5);assert.deepEqual(f.preparation.retainedMints(),['a','c','d','e']);
});

test('a cached peer remains ready during one pending pin and no refused work is queued',async()=>{
 const f=memory(),a=f.proof('a'),b=f.proof('b'),c=f.proof('c');
 f.preparation.prepare(a,f.pin);await turn();let finish!:()=>void;const pending=new Promise<void>(resolve=>finish=resolve);
 f.preparation.prepare(b,async p=>{await f.pin(p);await pending;});await turn();
 assert.equal(f.preparation.prepare(a,f.pin),true);assert.equal(f.preparation.usage(a)?.state,'complete');assert.equal(f.preparation.usage(b)?.state,'pending');
 assert.equal(f.preparation.usage()?.proofId,b.proofId,'global pending ownership remains visible after selecting a cached peer');
 assert.equal(f.preparation.prepare(c,f.pin),false);assert.equal(f.preparation.prepare({...b,proofId:'unaccepted'},f.pin),false);assert.equal(f.calls.length,2);
 finish();await turn();assert.equal(f.calls.length,2);assert.equal(f.preparation.ready(b),true);assert.equal(f.preparation.usage(c),null);
});

test('every stable certificate field must match; dynamic caller time never extends the stored range or deadline',async()=>{
 const f=memory(),p=f.proof('a');f.preparation.prepare(p,f.pin);await turn();f.at=150;
 const mismatches:Partial<NativeQualificationProof>[]=[{mint:'wrong'},{startAt:2},{windowEndAt:91},{featuresSha256:'b'.repeat(64)},{certificateAt:96},{deadlineAt:300}];
 for(const change of mismatches){const wrong={...p,...change,throughAt:150};assert.equal(f.preparation.ready(wrong),false);assert.equal(f.preparation.prepare(wrong,f.pin),false);assert.equal(f.preparation.usage(wrong),null);assert.equal(f.preparation.ready(p),true);}
 assert.equal(f.preparation.ready({...p,proofId:'missing'}),false);
 assert.equal(f.preparation.prepare({...p,throughAt:99},f.pin),false);assert.equal(f.preparation.prepare({...p,throughAt:151},f.pin),false);
 assert.equal(f.preparation.prepare({...p,throughAt:150},f.pin),true);assert.deepEqual(f.calls,[p]);assert.deepEqual(f.preparation.usage(p),{proofId:p.proofId,mint:p.mint,deadlineAt:200,state:'complete',availableAt:100,error:null});
 f.at=201;assert.equal(f.preparation.ready({...p,throughAt:201,deadlineAt:300}),false);assert.equal(f.preparation.prepare({...p,throughAt:201,deadlineAt:300},f.pin),false);await turn();assert.equal(f.calls.length,1);
});

test('a new current generation replaces only its own mint and an older certificate cannot displace it',async()=>{
 const f=memory(),a=f.proof('a'),b=f.proof('b');f.preparation.prepare(a,f.pin);await turn();f.preparation.prepare(b,f.pin);await turn();
 f.at=150;const next=f.proof('a',{proofId:'OFFLINE:a:new',certificateAt:145,throughAt:150,featuresSha256:'b'.repeat(64),deadlineAt:250});
 f.preparation.prepare(next,f.pin);assert.deepEqual(f.releases,[a.proofId]);assert.equal(f.preparation.ready(a),false);assert.equal(f.preparation.ready(b),true);await turn();
 assert.equal(f.preparation.ready(next),true);assert.equal(f.preparation.prepare({...a,throughAt:150},f.pin),false);assert.equal(f.preparation.ready(next),true);assert.equal(f.calls.length,3);
 f.preparation.maintenance(proof=>proof.proofId!==next.proofId);assert.deepEqual(f.releases,[a.proofId,next.proofId]);assert.equal(f.preparation.prepare(next,f.pin),false);assert.equal(f.preparation.ready(b),true);
});

test('an invalidated pending generation keeps its physical ownership until settlement and never becomes ready',async()=>{
 const f=memory(),p=f.proof('a'),peer=f.proof('b');let finish!:()=>void;const pending=new Promise<void>(resolve=>finish=resolve);
 f.preparation.prepare(p,async proof=>{await f.pin(proof);await pending;});await turn();
 f.preparation.maintenance(()=>false);assert.deepEqual(f.releases,[]);assert.equal(f.preparation.prepare(peer,f.pin),false);assert.equal(f.calls.length,1);
 finish();await turn();assert.deepEqual(f.releases,[p.proofId]);assert.equal(f.preparation.ready(p),false);assert.equal(f.preparation.prepare(p,f.pin),false);
 f.preparation.prepare(peer,f.pin);await turn();assert.equal(f.calls.length,2);assert.equal(f.preparation.ready(peer),true);
});

test('expiry during a physical pin never releases early or makes a late completion usable',async()=>{
 const f=memory(),p=f.proof('a');let finish!:()=>void;const pending=new Promise<void>(resolve=>finish=resolve);
 f.preparation.prepare(p,async proof=>{await f.pin(proof);await pending;});await turn();f.at=201;f.preparation.maintenance();assert.deepEqual(f.releases,[]);assert.equal(f.preparation.ready(p),false);
 const next=f.proof('b',{throughAt:201,deadlineAt:300});assert.equal(f.preparation.prepare(next,f.pin),false);finish();await turn();assert.deepEqual(f.releases,[p.proofId]);assert.equal(f.preparation.ready(p),false);
 f.preparation.maintenance();f.preparation.maintenance();assert.deepEqual(f.releases,[p.proofId]);f.preparation.prepare(next,f.pin);await turn();assert.equal(f.preparation.ready(next),true);
});

test('terminal pin failure stays distinguishable from pending without a repeated technical retry loop',async()=>{
 const f=memory(),p=f.proof('a');let attempts=0;
 const failed=async()=>{attempts++;throw Error('OFFLINE recorder unavailable');};
 assert.equal(f.preparation.prepare(p,failed),false);assert.equal(f.preparation.usage(p)?.state,'pending');await turn();
 assert.deepEqual(f.preparation.usage(p),{proofId:p.proofId,mint:p.mint,deadlineAt:200,state:'failed',availableAt:100,error:'qualification-proof-retention-unavailable'});
 f.at=150;for(let n=0;n<5;n++)assert.equal(f.preparation.prepare({...p,throughAt:150},failed),false);await turn();assert.equal(attempts,1);assert.equal(f.preparation.ready(p),false);
 const peer=f.proof('b',{throughAt:150});f.preparation.prepare(peer,f.pin);await turn();assert.equal(f.preparation.ready(peer),true);assert.equal(f.preparation.usage(p)?.state,'failed');
});

test('bounded cleanup retries only its failed unused reference and preserves current peers',async()=>{
 let at=100,fail=true;const attempts:string[]=[],released:string[]=[];
 const f=memory(),prep=new NativePaperProofPreparation(()=>at,id=>{attempts.push(id);if(id==='OFFLINE:a'&&fail)throw Error('OFFLINE filesystem contention');released.push(id);});
 const proofs=['a','b','c','d'].map(m=>f.proof(m));for(const p of proofs){prep.prepare(p,async()=>{});await turn();}
 prep.maintenance(p=>p.mint!=='a');assert.equal(prep.ready(proofs[0]!),false);assert.equal(prep.prepare(f.proof('e'),async()=>{}),false,'unsettled cleanup occupies its bounded record');assert.deepEqual(released,[]);
 fail=false;prep.maintenance();assert.deepEqual(released,['OFFLINE:a']);prep.prepare(f.proof('e'),async()=>{});await turn();assert.deepEqual(prep.retainedMints(),['b','c','d','e']);assert.ok(attempts.filter(id=>id==='OFFLINE:a').length>=2);
 at=201;prep.maintenance();assert.deepEqual(new Set(released),new Set(['OFFLINE:a','OFFLINE:b','OFFLINE:c','OFFLINE:d','OFFLINE:e']));
});

test('mutation, future clocks and clock regression cannot change an in-flight retained request',async()=>{
 const f=memory(),original=f.proof('a'),caller={...original};let received:NativeQualificationProof|null=null;
 f.preparation.prepare(caller,async p=>{received=p;assert.ok(Object.isFrozen(p));});caller.deadlineAt=900;caller.throughAt=900;await turn();assert.deepEqual(received,original);assert.equal(f.preparation.ready(caller),false);assert.equal(f.preparation.ready(original),true);
 f.at=99;assert.equal(f.preparation.ready(original),false);f.preparation.maintenance();f.at=150;assert.equal(f.preparation.ready(original),false);assert.deepEqual(f.releases,[original.proofId]);
 const future=f.proof('b',{certificateAt:151,throughAt:151});assert.equal(f.preparation.prepare(future,f.pin),false);assert.equal(f.calls.length,0);
});
