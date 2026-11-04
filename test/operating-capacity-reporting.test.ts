import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createContext,Script} from 'node:vm';
import {createDashboard} from '../src/dashboard.js';
import {MIGRATION_AGE_POLICY} from '../src/migration-age-policy.js';
import {PAPER_TWO_HOLDING_OPERATING_POLICY,paperEntryCapacity} from '../src/paper-operating-capacity.js';
import {projectFinancialPolicyReporting,validateFinancialPolicyReporting} from '../src/financial-policy-reporting.js';
import {projectOperatingIntelligence,validateOperatingIntelligence,ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from '../src/operating-intelligence.js';

const T=Date.parse('2026-11-04T16:00:00.000Z'),iso=(at:number)=>new Date(at).toISOString();
function source(held=1,buy=1,sell=1,historical:number|null=null,policyReady=true){
 const state={positions:Object.fromEntries(Array.from({length:held},(_,n)=>['held-'+n,{}])),pending:Object.fromEntries([...Array.from({length:buy},(_,n)=>['buy-'+n,{side:'buy'}]),...Array.from({length:sell},(_,n)=>['sell-'+n,{side:'sell'}])])};
 return {accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:Date.parse(ORIGINAL_POE_INCEPTION),generatedAt:T-1234,startedAt:T-60000,runId:'source-capacity-fixture',strategyVersion:'liquidity-resilient-momentum-v3.1',configurationSha256:'a'.repeat(64),persistent:true,...state,entriesEnabled:false,usage:{market:{}},operatingCapacity:{policy:PAPER_TWO_HOLDING_OPERATING_POLICY,...paperEntryCapacity(state,historical,PAPER_TWO_HOLDING_OPERATING_POLICY,policyReady)},marketAdmissionAgePolicy:MIGRATION_AGE_POLICY};
}
test('actual producer capacity counts held positions and pending BUY reservations while keeping the historical V3 bound separate',()=>{
 const raw=source(),before=structuredClone(raw),p=projectFinancialPolicyReporting(raw,T)!;
 assert.deepEqual(p.operatingCapacity,{version:'poe-effective-holding-capacity-v1',scope:'CURRENT_SOURCE_SNAPSHOT',asOf:iso(T-1234),operatingPolicyVersion:'owner-paper-two-holdings-v1',policyMaximumPositions:2,historicalMaximumPositions:null,maximumPositions:2,heldPositions:1,pendingBuyOrders:1,occupiedPositions:2,available:false,occupiedCapacity:'held-positions-plus-pending-buy-reservations',existingObligations:'retain-and-manage-without-forced-liquidation',grantsFinancialPermission:false});
 assert.equal(p.risk,null);assert.equal(raw.entriesEnabled,false);assert.deepEqual(raw,before);validateFinancialPolicyReporting(p,T);
});
test('a lower historical limit is preserved and absent policy readiness never becomes available capacity',()=>{
 for(const [historical,ready,maximum,available]of [[1,true,1,false],[null,false,2,false],[null,true,2,true]] as const){const p=projectFinancialPolicyReporting(source(1,0,2,historical,ready),T)!;assert.equal(p.operatingCapacity!.maximumPositions,maximum);assert.equal(p.operatingCapacity!.available,available);assert.equal(p.operatingCapacity!.pendingBuyOrders,0);validateFinancialPolicyReporting(p,T);}
});
test('already held obligations above two remain faithfully visible without a forced-liquidation or admission claim',()=>{
 const p=projectFinancialPolicyReporting(source(3,0,0),T)!;assert.equal(p.operatingCapacity!.occupiedPositions,3);assert.equal(p.operatingCapacity!.maximumPositions,2);assert.equal(p.operatingCapacity!.available,false);assert.equal(p.operatingCapacity!.existingObligations,'retain-and-manage-without-forced-liquidation');validateFinancialPolicyReporting(p,T);
});
test('legacy source absence remains absent and explicit unavailable capacity remains null',()=>{
 assert.equal(projectFinancialPolicyReporting({generatedAt:T,positions:{},pending:{}},T),undefined);
 const legacy=projectFinancialPolicyReporting({financial:{equityRisk:{version:'unavailable'}}},T)!;assert.equal(Object.hasOwn(legacy,'operatingCapacity'),false);assert.equal(Object.hasOwn(legacy,'marketAdmissionAge'),false);validateFinancialPolicyReporting(legacy,T);
 const missing=projectFinancialPolicyReporting({generatedAt:T,operatingCapacity:null,marketAdmissionAgePolicy:null},T)!;assert.equal(missing.operatingCapacity,null);assert.equal(missing.marketAdmissionAge,null);validateFinancialPolicyReporting(missing,T);
});
test('malformed or contradictory capacity cannot masquerade as an effective source limit',()=>{
 const changes:Array<(s:any)=>void>=[s=>s.operatingCapacity.policy.version='private://DO_NOT_EXPORT',s=>s.operatingCapacity.policy.maximumPositions=3,s=>s.operatingCapacity.policy.extra='DO_NOT_EXPORT',s=>s.operatingCapacity.operatingPolicyVersion='other',s=>s.operatingCapacity.maximumPositions=null,s=>s.operatingCapacity.historicalMaximumPositions=1,s=>s.operatingCapacity.heldPositions=0,s=>s.operatingCapacity.pendingBuyOrders=2,s=>s.operatingCapacity.occupiedPositions=1,s=>s.operatingCapacity.available=true,s=>s.generatedAt=T+1,s=>delete s.positions,s=>s.pending=[]];
 for(const change of changes){const raw=structuredClone(source());change(raw);const p=projectFinancialPolicyReporting(raw,T)!;assert.equal(p.operatingCapacity,null);assert.doesNotMatch(JSON.stringify(p),/DO_NOT_EXPORT/);if(raw.generatedAt>T)assert.equal(p.marketAdmissionAge,null);else assert.ok(p.marketAdmissionAge);validateFinancialPolicyReporting(p,T);}
});
test('public capacity validation rejects unknown fields, extra permission and refreshed source clocks',()=>{
 const good=projectFinancialPolicyReporting(source(),T)!;
 for(const change of [(p:any)=>p.operatingCapacity.grantsFinancialPermission=true,(p:any)=>p.operatingCapacity.secret='DO_NOT_EXPORT',(p:any)=>p.operatingCapacity.asOf=iso(T+1),(p:any)=>p.operatingCapacity.occupiedPositions=Number.MAX_SAFE_INTEGER,(p:any)=>p.operatingCapacity.available=true]){const bad=structuredClone(good);change(bad);assert.throws(()=>validateFinancialPolicyReporting(bad,T),/FINANCIAL_POLICY_REPORTING_INVALID/);}
});
test('unknown pending obligations make optional capacity unavailable instead of being silently counted as no pending BUY',()=>{
 for(const unresolved of [null,{side:'unknown'}]){const raw=structuredClone(source(0,0,0));(raw.pending as Record<string,unknown>).unresolved=unresolved;assert.equal(raw.operatingCapacity.available,true);const p=projectFinancialPolicyReporting(raw,T)!;assert.equal(p.operatingCapacity,null);assert.ok(p.marketAdmissionAge);validateFinancialPolicyReporting(p,T);}
});
test('migration policy uses the actual canonical migration clock and original source time, independently of token creation',()=>{
 const raw={...source(),tokenCreationAgeMs:9_000_000_000},p=projectFinancialPolicyReporting(raw,T)!;
 assert.deepEqual(p.marketAdmissionAge,{version:MIGRATION_AGE_POLICY.version,scope:'CURRENT_SOURCE_SNAPSHOT',asOf:iso(raw.generatedAt),basis:MIGRATION_AGE_POLICY.basis,minimumAgeMs:60000,maximumAgeMs:86400000,boundary:MIGRATION_AGE_POLICY.boundary,grantsFinancialPermission:false});
 assert.doesNotMatch(JSON.stringify(p),/tokenCreation|9_000_000_000/);validateFinancialPolicyReporting(p,T);
 for(const field of ['minimumAgeMs','maximumAgeMs','basis','version','boundary']){const bad=structuredClone(raw) as any;bad.marketAdmissionAgePolicy[field]='unsupported';assert.equal(projectFinancialPolicyReporting(bad,T)!.marketAdmissionAge,null);}
});
test('optional capacity and migration facts survive the complete intelligence validator without changing admission or source identity',()=>{
 const raw=source(0,0,0),before=structuredClone(raw),report=projectOperatingIntelligence(raw);assert.ok(report.financialPolicy!.operatingCapacity);assert.ok(report.financialPolicy!.marketAdmissionAge);validateOperatingIntelligence(report,iso(T));assert.equal(report.financialPolicy!.operatingCapacity!.available,true);assert.equal(raw.entriesEnabled,false);assert.deepEqual(raw,before);assert.equal(report.run.configurationSha256,raw.configurationSha256);
});
test('served Portfolio Overview distinguishes effective capacity, historical strategy and migration age without claiming permission',async t=>{
 const app=createDashboard({viewerUser:'',viewerPassword:'',publicViewer:true,ingestionSecret:'disposable-source-capacity-reporting-secret'});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 t.after(async()=>{app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));});const address=app.server.address();assert.ok(address&&typeof address==='object');
 const html=await fetch('http://127.0.0.1:'+address.port+'/').then(r=>r.text()),start=html.indexOf('function financialPolicyCards(s){'),end=html.indexOf('function renderCards(s){',start);assert.ok(start>0&&end>start);
 const context=createContext({money:(value:number)=>String(value),Number,Math});new Script(html.slice(start,end)).runInContext(context);
 const raw=source(),policy=projectFinancialPolicyReporting(raw,T)!,before=structuredClone(policy),cards=(context as any).financialPolicyCards({intelligence:{financialPolicy:policy}}) as string[][],text=cards.flat().join('\n');
 assert.match(text,/HELD \+ PENDING BUY CAPACITY\n2 \/ 2/);assert.match(text,/1 held and 1 pending buys/);assert.match(text,/Historical strategy bound has no fixed count/);assert.match(text,/Existing holdings retain protection and exit management/);assert.match(text,/new entries still require current financial readiness/);assert.match(text,/VERIFIED PUMPSWAP MIGRATION AGE\n1 minute – 24 hours/);assert.match(text,/Time since verified canonical PumpSwap migration; both boundaries inclusive/);assert.ok(text.includes(iso(raw.generatedAt)));assert.doesNotMatch(text,/entries enabled|permission granted|unlimited positions|creation age/i);assert.deepEqual(policy,before);
 const old=(context as any).financialPolicyCards({}).flat().join('\n');assert.match(old,/no operating limit is inferred/);assert.match(old,/Migration-age policy is unavailable from this source/);assert.doesNotMatch(old,/2 \/ 2|1 minute – 24 hours/);
 const unavailable=projectFinancialPolicyReporting(source(0,0,0,null,false),T)!,closed=(context as any).financialPolicyCards({intelligence:{financialPolicy:unavailable}}).flat().join('\n');assert.match(closed,/0 \/ 2/);assert.match(closed,/Source capacity gate closed/);assert.doesNotMatch(closed,/Source capacity gate available|entries enabled/);
});
