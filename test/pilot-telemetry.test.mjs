import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createPilotTelemetryChannel,projectPilotStatus,validatePilotTelemetry} from '../dist/src/pilot-telemetry.js';
import {CONNECTIONS_SCRIPT} from '../dist/src/dashboard-connections.js';
const origin=Date.parse('2026-10-27T18:00:00Z');
const config={secret:'dedicated-report-secret-'.repeat(3),accountId:'poe-pilot-test',inceptionAt:origin,publicViewer:true,viewerUser:'owner',viewerPassword:'private-viewer-password'};
function raw(){return {experimental:true,authoritative:false,liveTradingEnabled:false,accountId:'poe-pilot-test',inceptionAt:origin,runId:'pilot-test-run',generatedAt:origin+1000,source:{commit:'abcdef',private:'NEVER_PUBLISH'},strategyVersion:'persistent-buying-pilot-v1',running:true,entriesEnabled:false,status:'waiting for full window',funnel:{discovered:20,supported:1,evaluated:0,usableWindows:0},usage:{rpc:{newUnits:17,privateCredential:'NEVER_PUBLISH'},feeds:{frames:150,normalizedTrades:3,totalSocketBytes:123456},eventLoopDelayP95Ms:20.096},timing:{maximumCompletedGapMs:2056,maximumQuoteAgeAtUseMs:39,protectionBreaches:0,unavailableChecks:0},decisions:[{at:origin+900,mint:'mint-test',stage:'strategy-rejection',reason:'persistent buying not met',features:{private:'NEVER_PUBLISH'}}],refusals:{'strategy rejection':1},financial:{cash:'NEVER_PUBLISH'},journal:[{private:'NEVER_PUBLISH'}],pending:{private:'NEVER_PUBLISH'}};}
test('projection is an allowlist and does not leak raw financial/source/credential objects',()=>{const p=projectPilotStatus(raw());assert.equal(p.funnel.discovered,20);assert.equal(p.metrics.rpcRequests,17);assert.ok(!JSON.stringify(p).includes('NEVER_PUBLISH'));assert.equal(p.funnel.qualified,null);assert.equal(p.authoritative,false);});
test('projection cannot accept original account as pilot',()=>{const p=raw();p.accountId='poe-original-account';assert.throws(()=>projectPilotStatus(p),/pilot account/);});
test('projection cannot accept a live or authoritative source',()=>{for(const k of ['authoritative','liveTradingEnabled']){const p=raw();p[k]=true;assert.throws(()=>projectPilotStatus(p));}});
test('extra top-level fields are rejected rather than cached',()=>{const p=projectPilotStatus(raw());p.secret='no';assert.throws(()=>validatePilotTelemetry(p),/unexpected/);});
test('invalid negative, nonfinite and noninteger counts rejected',()=>{for(const value of [-1,NaN,Infinity,1.5]){const p=raw();p.funnel.evaluated=value;assert.throws(()=>projectPilotStatus(p));}});
test('channel pins pilot account and inception',()=>{const c=createPilotTelemetryChannel(config,()=>origin+2000);const p=projectPilotStatus(raw());p.inceptionAt--;assert.throws(()=>c.accept(p),/source mismatch/);});
test('duplicate replay cannot refresh receiver freshness',()=>{let time=origin+2000;const c=createPilotTelemetryChannel(config,()=>time),p=projectPilotStatus(raw());assert.equal(c.accept(p),'accepted');const before=c.read().receivedAt;time+=95000;assert.equal(c.accept(p),'duplicate');assert.equal(c.read().receivedAt,before);assert.equal(c.read().state,'stale');assert.equal(c.read().lastContactAt,time);assert.equal(c.read().publisherConnected,true);});
test('stale source remains stale even if first received now',()=>{const c=createPilotTelemetryChannel(config,()=>origin+100000);c.accept(projectPilotStatus(raw()));assert.equal(c.read().state,'stale');});
test('source timestamp and same-run counters cannot regress',()=>{const c=createPilotTelemetryChannel(config,()=>origin+10000),p=projectPilotStatus(raw());c.accept(p);const old=structuredClone(p);old.generatedAt--;assert.throws(()=>c.accept(old),/regression/);const lower=structuredClone(p);lower.generatedAt++;lower.funnel.discovered=1;assert.throws(()=>c.accept(lower),/regression/);});
test('new run may reset run counters without changing original pilot identity',()=>{const c=createPilotTelemetryChannel(config,()=>origin+10000),p=projectPilotStatus(raw());c.accept(p);p.runId='second';p.generatedAt++;p.funnel.discovered=1;assert.equal(c.accept(p),'accepted');});
test('conflicting equal-time payload rejected',()=>{const c=createPilotTelemetryChannel(config,()=>origin+2000),p=projectPilotStatus(raw());c.accept(p);p.status='different';assert.throws(()=>c.accept(p),/conflict/);});
test('stopped and disconnected are not presented as running',()=>{const c=createPilotTelemetryChannel(config,()=>origin+2000),p=projectPilotStatus(raw());p.running=false;c.accept(p);assert.equal(c.read().state,'stopped');});
test('unconfigured pilot channel remains distinct from original snapshot',()=>{const c=createPilotTelemetryChannel({...config,secret:''});assert.equal(c.read().state,'not-configured');assert.equal(c.read().snapshot,null);});
test('frontend is syntactically valid and never uses innerHTML for telemetry',()=>{const js=CONNECTIONS_SCRIPT.replace(/^<script>\n?/,'').replace(/<\/script>$/,'');assert.doesNotThrow(()=>new Function(js));assert.ok(!js.includes('.innerHTML'));assert.doesNotMatch(js,/showSnapshot|renderFunnel|api\/snapshot|Bearer/);assert.match(js,/lastContactAt/);assert.match(js,/snapshot\.generatedAt/);});
async function server(t,options=config){const channel=createPilotTelemetryChannel(options,()=>origin+2000);const srv=createServer(async(req,res)=>{if(!await channel.handle(req,res,req.url)){res.writeHead(404);res.end();}});await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>srv.close(r)));return `http://127.0.0.1:${srv.address().port}`;}
test('HTTP public GET but authenticated POST, no original-token fallback',async t=>{const url=await server(t);assert.equal((await fetch(url+'/api/pilot')).status,200);const options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(projectPilotStatus(raw()))};assert.equal((await fetch(url+'/api/pilot',options)).status,401);options.headers.authorization='Bearer original-report-secret';assert.equal((await fetch(url+'/api/pilot',options)).status,401);options.headers.authorization='Bearer '+config.secret;assert.equal((await fetch(url+'/api/pilot',options)).status,200);const p=await(await fetch(url+'/api/pilot')).json();assert.equal(p.snapshot.accountId,'poe-pilot-test');assert.equal(p.state,'reporting');assert.equal((await fetch(url+'/api/pilot',{method:'DELETE'})).status,405);});
test('private viewer mode is preserved',async t=>{const url=await server(t,{...config,publicViewer:false});assert.equal((await fetch(url+'/api/pilot')).status,401);const r=await fetch(url+'/api/pilot',{headers:{authorization:'Basic '+Buffer.from(config.viewerUser+':'+config.viewerPassword).toString('base64')}});assert.equal(r.status,200);});
test('HTTP wrong content type / oversized telemetry rejected',async t=>{const url=await server(t),headers={authorization:'Bearer '+config.secret};assert.equal((await fetch(url+'/api/pilot',{method:'POST',headers,body:'{}'})).status,415);headers['content-type']='application/json';assert.equal((await fetch(url+'/api/pilot',{method:'POST',headers,body:' '.repeat(200000)})).status,413);});

test('stopped stale source and disconnected publisher remain distinct',()=>{let time=origin+2000;const c=createPilotTelemetryChannel(config,()=>time),p=projectPilotStatus(raw());p.running=false;c.accept(p);time+=100000;assert.equal(c.read().state,'stopped');assert.equal(c.read().publisherConnected,false);assert.equal(c.read().sourceStale,true);c.accept(p);assert.equal(c.read().state,'stopped');assert.equal(c.read().publisherConnected,true);assert.equal(c.read().snapshot.generatedAt,p.generatedAt);});
test('no holding evaluations do not become measured zero protection gaps',()=>{const p=raw();p.timing.completedEvaluationGaps=[];const projected=projectPilotStatus(p);assert.equal(projected.metrics.maximumCompletedGapMs,null);assert.equal(projected.metrics.maximumQuoteAgeMs,null);});
test('telemetry requires full explicit nullable shape and integer event counters',()=>{const p=projectPilotStatus(raw());delete p.funnel.qualified;assert.throws(()=>validatePilotTelemetry(p),/missing/);const q=projectPilotStatus(raw());q.metrics.providerEvents=1.5;assert.throws(()=>validatePilotTelemetry(q),/integer/);});


test('dynamic watch projection excludes identities/history and preserves missing measurements',()=>{
 const p=raw();p.watch={summary:{known:120,watch:90,eligibleKnown:100,deepActive:3,maximumDeep:6,queued:7,waitMs:{mean:1250,maximum:5000},promoted:18,repromoted:2,demoted:9,expired:4,capacityExclusions:1,structuralExclusions:3,completeWindows:12,private:'NEVER_PUBLISH'},rows:[{secret:'NEVER_PUBLISH'}]};
 const projected=projectPilotStatus(p);assert.equal(projected.watch.deepActive,3);assert.equal(projected.watch.maximumDeep,6);assert.equal(projected.watch.waitMs.maximum,5000);
 assert.equal(projected.watch.incompleteDataExclusions,null);assert.equal(projected.watch.enrichmentDeadlineFailures,null);
 assert.ok(!JSON.stringify(projected).includes('NEVER_PUBLISH'));assert.equal(projectPilotStatus(raw()).watch,null);
});
test('dynamic watch validation bounds identities/deep capacity and rejects extra fields',()=>{
 const source=raw();source.watch={summary:{known:120,watch:90,eligibleKnown:100,deepActive:3,maximumDeep:6,queued:7,waitMs:{mean:1250,maximum:5000}}};
 for(const [field,value]of [['known',513],['maximumDeep',21],['deepActive',7],['known',2],['queued',-1],['promoted',1.5]]){const p=structuredClone(source);p.watch.summary[field]=value;assert.throws(()=>projectPilotStatus(p));}
 const p=projectPilotStatus(source);p.watch.apiKey='not-a-permitted-field';assert.throws(()=>validatePilotTelemetry(p),/unexpected/);
 const q=projectPilotStatus(source);q.watch.waitMs.mean=5001;assert.throws(()=>validatePilotTelemetry(q),/inconsistent/);
});
test('receiver accepts legacy diagnostic payload without an optional watch section',()=>{
 const p=projectPilotStatus(raw());delete p.watch;assert.doesNotThrow(()=>validatePilotTelemetry(p));
 const channel=createPilotTelemetryChannel(config,()=>origin+2000);assert.equal(channel.accept(p),'accepted');
});


test('completed promotion wait is separate from current queue wait and remains optional',()=>{
 const p=raw();p.watch={summary:{known:1,deepActive:1,maximumDeep:3,waitMs:{mean:0,maximum:0},promotionWaitMs:{mean:2000,maximum:4000}}};
 const projected=projectPilotStatus(p);assert.equal(projected.watch.waitMs.maximum,0);assert.equal(projected.watch.promotionWaitMs.maximum,4000);
 delete projected.watch.promotionWaitMs;assert.doesNotThrow(()=>validatePilotTelemetry(projected));
 delete p.watch.summary.promotionWaitMs;assert.deepEqual(projectPilotStatus(p).watch.promotionWaitMs,{mean:null,maximum:null});
 for(const measured of [{mean:-1,maximum:2},{mean:3,maximum:2},{mean:NaN,maximum:2},{mean:1,maximum:2,private:'no'}]){
  const q=projectPilotStatus(p);q.watch.promotionWaitMs=measured;assert.throws(()=>validatePilotTelemetry(q));
 }
});


test('feature-only diagnostics remain distinct from primary decisions and optional for legacy sources',()=>{
 const p=raw();p.watch={summary:{known:1,deepActive:1,maximumDeep:3,waitMs:{mean:0,maximum:0},predictiveAssessments:12,predictiveFailures:10,strategyRejections:2}};
 const projected=projectPilotStatus(p);assert.equal(projected.watch.predictiveAssessments,12);assert.equal(projected.watch.predictiveFailures,10);assert.equal(projected.watch.strategyRejections,2);assert.equal(projected.funnel.qualified,null);
 delete projected.watch.predictiveAssessments;delete projected.watch.predictiveFailures;assert.doesNotThrow(()=>validatePilotTelemetry(projected));
 delete p.watch.summary.predictiveAssessments;delete p.watch.summary.predictiveFailures;assert.equal(projectPilotStatus(p).watch.predictiveAssessments,null);assert.equal(projectPilotStatus(p).watch.predictiveFailures,null);
 for(const value of [-1,1.5,NaN,Infinity]){const q=projectPilotStatus(p);q.watch.predictiveAssessments=value;assert.throws(()=>validatePilotTelemetry(q));}
});


const agePolicy=()=>({version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:7200000,selectedOlderMaximumAgeMs:21600000});
function ageSource(){const p=raw();p.observationAgePolicy={...agePolicy(),totalWatchCapacity:174,private:'NEVER_PUBLISH'};p.watch={summary:{known:174,watch:120,eligibleKnown:90,deepActive:6,maximumDeep:6,queued:3,waitMs:{mean:0,maximum:0},observationEligibleKnown:116,observationQueued:8,maximumOlderResearchIdentities:24,ageCohorts:{preEntry:20,entryEligible:90,olderSelected:6,private:'NEVER_PUBLISH'}}};return p;}
test('observation policy and age cohorts are bounded allowlisted source facts separate from entry eligibility',()=>{
 const source=ageSource(),p=projectPilotStatus(source);assert.deepEqual(p.observationAgePolicy,agePolicy());assert.deepEqual(p.watch.ageCohorts,{preEntry:20,entryEligible:90,olderSelected:6});assert.equal(p.watch.eligibleKnown,90);assert.equal(p.watch.observationEligibleKnown,116);assert.equal(p.watch.observationQueued,8);assert.equal(p.watch.maximumOlderResearchIdentities,24);assert.equal(p.generatedAt,source.generatedAt);assert.equal(p.entriesEnabled,false);assert.ok(!JSON.stringify(p).includes('NEVER_PUBLISH'));
 const legacy=projectPilotStatus(raw());assert.equal(legacy.observationAgePolicy,undefined);const explicit=raw();explicit.observationAgePolicy=null;assert.equal(projectPilotStatus(explicit).observationAgePolicy,null);
});
test('observation policy rejects partial, malformed, nonfinite, out-of-order and unbounded values',()=>{
 for(const change of [{minimumObservationAgeMs:-1},{recentMaximumAgeMs:Infinity},{selectedOlderMaximumAgeMs:86400001},{selectedOlderMaximumAgeMs:1},{minimumObservationAgeMs:7200000},{version:'https://example.com/private'},{minimumObservationAgeMs:0.1}]){const p=ageSource();p.observationAgePolicy={...agePolicy(),...change};assert.throws(()=>projectPilotStatus(p));}
 const p=ageSource();delete p.observationAgePolicy.minimumObservationAgeMs;assert.throws(()=>projectPilotStatus(p));const q=projectPilotStatus(ageSource());q.observationAgePolicy.secret='forbidden';assert.throws(()=>validatePilotTelemetry(q),/unexpected/);
});
test('age cohort validation rejects contradictions and preserves unknown values instead of inventing zeros',()=>{
 for(const change of [{observationEligibleKnown:513},{observationQueued:117},{maximumOlderResearchIdentities:25},{ageCohorts:{preEntry:19,entryEligible:90,olderSelected:6}},{ageCohorts:{preEntry:20,entryEligible:91,olderSelected:5}},{ageCohorts:{preEntry:1,entryEligible:90,olderSelected:25}}]){const p=ageSource();Object.assign(p.watch.summary,change);assert.throws(()=>projectPilotStatus(p));}
 const p=projectPilotStatus(ageSource());p.watch.ageCohorts.secret='forbidden';assert.throws(()=>validatePilotTelemetry(p),/unexpected/);const q=ageSource();q.watch.summary.ageCohorts={preEntry:null,entryEligible:90,olderSelected:null};q.watch.summary.observationEligibleKnown=null;const projected=projectPilotStatus(q);assert.equal(projected.watch.ageCohorts.preEntry,null);assert.equal(projected.watch.ageCohorts.olderSelected,null);assert.equal(projected.watch.observationEligibleKnown,null);
});


const sourceTimes=at=>({lastMarketNotificationAt:at-900,lastFreshSupportAt:at-800,lastBankClockAt:at-700,lastAuditAt:at-600,lastPredictiveAt:at-500,financialReconciliationAt:null});
test('actual source timestamps survive projection independently of reporting generation and exclude private fields',()=>{
 const source=raw();source.sourceTimes={...sourceTimes(source.generatedAt),privateCredential:'NEVER_PUBLISH'};const p=projectPilotStatus(source);assert.deepEqual(p.sourceTimes,sourceTimes(source.generatedAt));assert.equal(p.generatedAt,source.generatedAt);assert.equal(p.sourceTimes.financialReconciliationAt,null);assert.ok(!JSON.stringify(p).includes('NEVER_PUBLISH'));
 const legacy=projectPilotStatus(raw());assert.equal(legacy.sourceTimes,undefined);const explicit=raw();explicit.sourceTimes=null;assert.equal(projectPilotStatus(explicit).sourceTimes,null);const partial=raw();partial.sourceTimes={lastAuditAt:partial.generatedAt-1};assert.equal(projectPilotStatus(partial).sourceTimes.lastMarketNotificationAt,null);assert.equal(projectPilotStatus(partial).sourceTimes.lastAuditAt,partial.generatedAt-1);
});
test('source timestamps are bounded integer facts and receiver rejects unknown or missing fields',()=>{
 for(const name of Object.keys(sourceTimes(origin+1000)))for(const bad of [-1,1.5,Infinity,NaN,'1000',origin+1001]){const source=raw();source.sourceTimes={...sourceTimes(source.generatedAt),[name]:bad};assert.throws(()=>projectPilotStatus(source));}
 for(const bad of [[],false,'invalid']){const source=raw();source.sourceTimes=bad;assert.throws(()=>projectPilotStatus(source));}
 const p=projectPilotStatus({...raw(),sourceTimes:sourceTimes(origin+1000)});p.sourceTimes.privateCredential='not-permitted';assert.throws(()=>validatePilotTelemetry(p),/unexpected/);delete p.sourceTimes.privateCredential;delete p.sourceTimes.lastAuditAt;assert.throws(()=>validatePilotTelemetry(p),/missing source fact/);
 const future=projectPilotStatus({...raw(),sourceTimes:sourceTimes(origin+1000)});future.sourceTimes.lastBankClockAt=future.generatedAt+1;assert.throws(()=>validatePilotTelemetry(future),/newer than generatedAt/);
});
test('fresh source heartbeat cannot manufacture fresh market, audit, predictive or financial facts',()=>{
 let now=origin+2000;const channel=createPilotTelemetryChannel(config,()=>now),source=raw();source.sourceTimes=sourceTimes(source.generatedAt);const before=projectPilotStatus(source);channel.accept(before);now+=120000;source.generatedAt=now;channel.accept(projectPilotStatus(source));const current=channel.read();assert.equal(current.state,'reporting');assert.equal(current.sourceAgeMs,0);assert.deepEqual(current.snapshot.sourceTimes,before.sourceTimes);assert.ok(now-current.snapshot.sourceTimes.lastMarketNotificationAt>90000);assert.ok(now-current.snapshot.sourceTimes.lastAuditAt>90000);assert.ok(now-current.snapshot.sourceTimes.lastPredictiveAt>90000);assert.equal(current.snapshot.sourceTimes.financialReconciliationAt,null);
});


test('candidate-only reporting cannot claim financial reconciliation and legacy payloads remain accepted',()=>{
 const source=raw();source.mode='candidate-evaluation';source.financialExecutionAuthorized=false;source.sourceTimes=sourceTimes(source.generatedAt);assert.doesNotThrow(()=>projectPilotStatus(source));source.sourceTimes.financialReconciliationAt=source.generatedAt;assert.throws(()=>projectPilotStatus(source),/cannot claim financial reconciliation/);
 const wire=projectPilotStatus({...raw(),mode:'candidate-evaluation',financialExecutionAuthorized:false,sourceTimes:sourceTimes(origin+1000)});wire.sourceTimes.financialReconciliationAt=wire.generatedAt;assert.throws(()=>validatePilotTelemetry(wire),/cannot claim financial reconciliation/);
 delete source.sourceTimes;assert.doesNotThrow(()=>projectPilotStatus(source));assert.doesNotThrow(()=>projectPilotStatus(raw()));const paper={...source,mode:'paper',financialExecutionAuthorized:true,sourceTimes:{...sourceTimes(source.generatedAt),financialReconciliationAt:source.generatedAt}};assert.equal(projectPilotStatus(paper).sourceTimes.financialReconciliationAt,paper.generatedAt);
});
