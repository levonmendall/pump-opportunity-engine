import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {join} from 'node:path';
import {PaperServiceResources,PAPER_SERVICE_POLICY as policy,paperServiceSupervision,parseHostMemoryAvailable} from '../src/paper-service-policy.js';
const MIB=1024*1024;
test('service resource admission is rolling across days and never expires on cumulative CPU',()=>{
 const r=new PaperServiceResources();let cpu=0;
 for(let ms=0;ms<=3*86400000;ms+=1000){cpu+=200000;r.sample({at:ms,mono:ms,cpu,rss:300*MIB,disk:8*1024*MIB});}
 const v=r.view();assert.equal(v.candidateAdmissionAllowed,true);assert.ok(v.samples<=64);assert.ok(v.rollingWindowMs<=60000);assert.ok(v.rollingCpuFraction!<=.201);assert.equal(v.lifetimeCapReached,false);
});
test('healthy busy CPU remains telemetry while actual memory and disk pressure suspend admission and recover',()=>{
 const r=new PaperServiceResources();let cpu=0;const sample=(mono:number,rate=1.8,rss=600*MIB,disk=2*1024*MIB,availableMemory:number|null=6*1024*MIB)=>{cpu+=rate*1000000;return r.sample({at:mono,mono,cpu,rss,disk,availableMemory});};
 for(let t=0;t<=20000;t+=1000)sample(t);assert.equal(r.view().candidateAdmissionAllowed,true);assert.ok(r.view().rollingCpuFraction!>1.7);assert.equal(r.view().cpuUtilizationAdmissionEnforced,false);assert.deepEqual(r.view().reasons,[]);
 sample(21000,1.8,1537*MIB);assert.equal(r.view().candidateAdmissionAllowed,false);assert.deepEqual(r.view().reasons,['resident-memory-pressure']);
 for(let t=22000;t<=60000;t+=1000)sample(t,1.8,1450*MIB);assert.equal(r.view().candidateAdmissionAllowed,false,'resume threshold prevents oscillation despite unused host RAM');
 for(let t=61000;t<=92000;t+=1000)sample(t);assert.equal(r.view().candidateAdmissionAllowed,true,'busy CPU does not block memory recovery');
 sample(93000,1.8,600*MIB,128*MIB);assert.equal(r.view().candidateAdmissionAllowed,false);assert.equal(r.view().ownedFinancialManagementContinues,true);
 for(let t=94000;t<=125000;t+=1000)sample(t);assert.equal(r.view().candidateAdmissionAllowed,true);
 assert.throws(()=>r.sample({at:1,mono:1,cpu:0,rss:1,disk:1}),/REGRESSION/);
});
test('host MemAvailable is measured independently of RSS and unknown memory cannot clear a prior measured shortage',()=>{
 const r=new PaperServiceResources();let cpu=0;const sample=(mono:number,memory:number|null)=>r.sample({at:mono,mono,cpu:cpu+=1000000,rss:400*MIB,disk:2*1024*MIB,availableMemory:memory});
 sample(0,null);assert.equal(r.view().availableMemoryBytes,null);assert.equal(r.view().candidateAdmissionAllowed,true,'unknown is not invented as zero; the independent supervisor still gates new risk');
 sample(1000,700*MIB);assert.equal(r.view().candidateAdmissionAllowed,false);assert.deepEqual(r.view().reasons,['host-memory-pressure']);assert.equal(r.view().availableMemoryBytes,700*MIB);
 for(let t=2000;t<=40000;t+=1000)sample(t,null);assert.equal(r.view().candidateAdmissionAllowed,false,'unknown measurements never establish recovery');
 for(let t=41000;t<=80000;t+=1000)sample(t,900*MIB);assert.equal(r.view().candidateAdmissionAllowed,false,'known host memory must meet the recovery watermark');
 for(let t=81000;t<=112000;t+=1000)sample(t,2*1024*MIB);assert.equal(r.view().candidateAdmissionAllowed,true);
 assert.throws(()=>sample(113000,-1),/RESOURCE_SAMPLE/);
});
test('kernel memory parsing is bounded and preserves unavailable data instead of deriving host headroom from process RSS',()=>{
 assert.equal(parseHostMemoryAvailable('MemTotal: 8000000 kB\nMemAvailable: 6900000 kB\n'),6900000*1024);assert.equal(parseHostMemoryAvailable('MemAvailable: 0 kB\n'),0);
 for(const text of ['MemFree: 1000000 kB\n','MemAvailable: -1 kB\n','MemAvailable: 12 MB\n','MemAvailable: 1 kB\nMemAvailable: 2 kB\n','MemAvailable: 99999999999999999 kB\n','x'.repeat(65537)])assert.equal(parseHostMemoryAvailable(text),null);
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


test('a mixed resident-memory incident cannot erase an unresolved host-memory shortage before actual recovery',()=>{
 const r=new PaperServiceResources();let cpu=0;const sample=(at:number,rss:number,availableMemory:number|null)=>r.sample({at,mono:at,cpu:cpu+=1000000,rss,disk:2*1024*MIB,availableMemory});
 sample(0,400*MIB,700*MIB);assert.deepEqual(r.view().reasons,['host-memory-pressure']);sample(1000,1600*MIB,900*MIB);assert.ok(r.view().reasons.includes('host-memory-pressure'));assert.ok(r.view().reasons.includes('resident-memory-pressure'));
 for(let t=2000;t<=35000;t+=1000)sample(t,400*MIB,null);assert.equal(r.view().candidateAdmissionAllowed,false,'unknown host memory cannot establish recovery after a different pressure overwrote the immediate condition');
 for(let t=36000;t<=67000;t+=1000)sample(t,400*MIB,2*1024*MIB);assert.equal(r.view().candidateAdmissionAllowed,true);assert.deepEqual(r.view().reasons,[]);
});
