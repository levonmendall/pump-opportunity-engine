import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDashboard} from '../src/dashboard.js';
import {projectPilotStatus} from '../src/pilot-telemetry.js';
const original='fixture-original-report-key-'.repeat(3),pilot='fixture-pilot-report-key-'.repeat(3);
const at=Date.now()-1000;
const raw={experimental:true,authoritative:false,liveTradingEnabled:false,accountId:'poe-pilot-integration-fixture',inceptionAt:at,runId:'fixture',generatedAt:at,source:{commit:'a'.repeat(40)},strategyVersion:'pilot-v1',running:false,entriesEnabled:false,status:'stopped',funnel:{evaluated:7},usage:{rpc:{newUnits:2},feeds:{frames:20,normalizedTrades:4,totalSocketBytes:200}},timing:{completedEvaluationGaps:[]},decisions:[],refusals:{}};
test('original and pilot HTTP authentication and source caches remain independent',async t=>{
 const keys=['POE_PILOT_INGEST_SECRET','POE_PILOT_ACCOUNT_ID','POE_PILOT_INCEPTION_AT'] as const,old=keys.map(k=>process.env[k]);
 process.env.POE_PILOT_INGEST_SECRET=pilot;process.env.POE_PILOT_ACCOUNT_ID=raw.accountId;process.env.POE_PILOT_INCEPTION_AT=String(at);
 t.after(()=>keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}));
 const app=createDashboard({ingestionSecret:original,publicViewer:true,viewerUser:'',viewerPassword:''});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>app.server.close(()=>r())));
 const address=app.server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
 const post=(path:string,key:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/pilot',original,projectPilotStatus(raw))).status,401);
 assert.equal((await post('/api/snapshot',pilot,{})).status,401);
 assert.equal((await post('/api/pilot',pilot,projectPilotStatus(raw))).status,200);
 assert.equal((await post('/api/pilot',pilot,{...projectPilotStatus(raw),accountId:'poe-pilot-wrong-source'})).status,400);
 assert.equal(app.cache.read(),null);
 const report=await fetch(base+'/api/pilot').then(r=>r.json());assert.equal(report.snapshot.accountId,raw.accountId);assert.equal(report.state,'stopped');
 const connections=await fetch(base+'/api/connections').then(r=>r.json());assert.equal(connections.source,null);assert.equal(connections.experimentalPilot.connected,true);assert.equal(connections.experimentalPilot.state,'stopped');
 const html=await fetch(base+'/').then(r=>r.text());assert.ok(!html.includes(original)&&!html.includes(pilot));
});
test('reusing the original ingestion credential for pilot reporting is rejected',()=>{
 const before=process.env.POE_PILOT_INGEST_SECRET;try{process.env.POE_PILOT_INGEST_SECRET=original;assert.throws(()=>createDashboard({ingestionSecret:original,publicViewer:true,viewerUser:'',viewerPassword:''}),/credentials must differ/);}finally{if(before===undefined)delete process.env.POE_PILOT_INGEST_SECRET;else process.env.POE_PILOT_INGEST_SECRET=before;}
});
