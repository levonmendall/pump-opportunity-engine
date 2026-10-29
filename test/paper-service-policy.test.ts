import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {join} from 'node:path';
import {PaperServiceResources,PAPER_SERVICE_POLICY as policy,paperServiceSupervision} from '../src/paper-service-policy.js';
const MIB=1024*1024;
test('service resource admission is rolling across days and never expires on cumulative CPU',()=>{
 const r=new PaperServiceResources();let cpu=0;
 for(let ms=0;ms<=3*86400000;ms+=1000){cpu+=200000;r.sample({at:ms,mono:ms,cpu,rss:300*MIB,disk:8*1024*MIB});}
 const v=r.view();assert.equal(v.candidateAdmissionAllowed,true);assert.ok(v.samples<=64);assert.ok(v.rollingWindowMs<=60000);assert.ok(v.rollingCpuFraction!<=.201);assert.equal(v.lifetimeCapReached,false);
});
test('rolling CPU, actual memory and disk pressure suspend admission and recover with hysteresis',()=>{
 const r=new PaperServiceResources();let cpu=0;const sample=(mono:number,rate=.2,rss=300*MIB,disk=2*1024*MIB)=>{cpu+=rate*1000000;return r.sample({at:mono,mono,cpu,rss,disk});};
 for(let t=0;t<=20000;t+=1000)sample(t,.8);assert.equal(r.view().candidateAdmissionAllowed,false);assert.ok(r.view().reasons.includes('rolling-cpu-pressure'));
 for(let t=21000;t<=130000;t+=1000)sample(t);assert.equal(r.view().candidateAdmissionAllowed,true);
 sample(131000,.2,385*MIB);assert.equal(r.view().candidateAdmissionAllowed,false);
 for(let t=132000;t<=170000;t+=1000)sample(t,.2,375*MIB);assert.equal(r.view().candidateAdmissionAllowed,false,'resume threshold prevents oscillation');
 for(let t=171000;t<=202000;t+=1000)sample(t);assert.equal(r.view().candidateAdmissionAllowed,true);
 sample(203000,.2,300*MIB,128*MIB);assert.equal(r.view().candidateAdmissionAllowed,false);assert.equal(r.view().ownedFinancialManagementContinues,true);
 for(let t=204000;t<=235000;t+=1000)sample(t);assert.equal(r.view().candidateAdmissionAllowed,true);
 assert.throws(()=>r.sample({at:1,mono:1,cpu:0,rss:1,disk:1}),/REGRESSION/);
});
test('reporting supervision is account/source/run bound, recovers without owner approval and cannot freshen an older source',()=>{
 const input={at:100000,accountId:'experimental',inceptionAt:1,source:{commit:'a'.repeat(40),sha256:'b'.repeat(64)},runId:'service-one'};
 const marker={schemaVersion:1,owner:'poe-runtime-service-supervisor',accountId:input.accountId,inceptionAt:1,source:input.source,runId:input.runId,generatedAt:99900,suspended:false,reason:'accepted current source'};
 assert.equal(paperServiceSupervision(marker,input).newRiskAllowed,true);
 for(const bad of [null,{...marker,runId:'other'},{...marker,generatedAt:0},{...marker,generatedAt:100001},{...marker,accountId:'authoritative'},{...marker,suspended:true},{...marker,runId:null}]){const v=paperServiceSupervision(bad,input);assert.equal(v.newRiskAllowed,false);assert.equal(v.ownedFinancialManagementContinues,true);assert.equal(v.candidateCaptureContinues,true);}
 assert.equal(policy.lifetimeRequestCap,null);assert.equal(policy.lifetimeEvidenceCap,null);
});

test('actual original Python supervisor marker authorizes only the exact current source and run in TypeScript',()=>{
 const path=join(process.cwd(),'operator/native-paper-ec2/run-authoritative-service.py'),fixture=join(process.cwd(),'operator/native-paper-ec2/fixture-authoritative-marker.json');
 const code=`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('poe_ops',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
f=json.load(open(sys.argv[2]));print(json.dumps(m.marker({'source':f['source']},{'runId':f['runId']},False,f['reason'],f['generatedAt'])))`;
 const marker=JSON.parse(execFileSync('python3',['-c',code,path,fixture],{encoding:'utf8',timeout:5000,maxBuffer:16384}));
 const input={at:marker.generatedAt,accountId:marker.accountId,inceptionAt:marker.inceptionAt,source:marker.source,runId:marker.runId};
 assert.equal(paperServiceSupervision(marker,input).newRiskAllowed,true);assert.equal(paperServiceSupervision(marker,{...input,runId:'different-source-run'}).newRiskAllowed,false);assert.equal(paperServiceSupervision({...marker,owner:'obsolete-experimental-supervisor'},input).newRiskAllowed,false);
});
