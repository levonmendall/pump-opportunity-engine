import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';

const dashboardSource=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const holographicSource=readFileSync(new URL('../src/dashboard-holographic.ts',import.meta.url),'utf8');
const begin=dashboardSource.indexOf('function renderFunnel(');
const end=dashboardSource.indexOf('function renderMetrics(',begin);
assert.ok(begin>=0&&end>begin,'actual Candidate Progression renderer is present');
const renderer=dashboardSource.slice(begin,end);

class FakeElement{
 textContent='';
 className='';
 children:FakeElement[]=[];
 dataset:Record<string,string>={};
 style:Record<string,string>={};
 readonly classes=new Set<string>();
 readonly classList={add:(name:string)=>this.classes.add(name)};
 get lastElementChild():FakeElement|null{return this.children.at(-1)??null;}
 replaceChildren(){this.children=[];}
 querySelector(selector:string):FakeElement|null{
  const name=selector.startsWith('.')?selector.slice(1):selector;
  for(const child of this.children){
   if(child.className.split(' ').includes(name))return child;
   const nested=child.querySelector(selector);
   if(nested)return nested;
  }
  return null;
 }
}
function draw(f:Record<string,unknown>,intelligence:unknown=null,isObserver=false){
 const root=new FakeElement();
 const add=(parent:FakeElement,_tag:string,value?:unknown,klass?:string)=>{
  const child=new FakeElement();child.className=klass??'';child.textContent=value===undefined?'':String(value);parent.children.push(child);return child;
 };
 const context=createContext({byId:(id:string)=>{assert.equal(id,'funnel');return root;},add,Number,Math});
 new Script(renderer).runInContext(context);
 (context as unknown as {renderFunnel:(f:unknown,i:unknown,o:boolean)=>void}).renderFunnel(f,intelligence,isObserver);
 const rows=root.children[0]!.children;
 const stage=(key:string)=>{
  const item=rows.find(item=>item.dataset.funnelStage===key);
  assert.ok(item,'rendered stage '+key);
  const bar=item.querySelector('.funnel-fill');
  assert.ok(bar,'stage bar '+key);
  return {width:bar.style.width,count:item.children[2]?.textContent,classes:item.classes};
 };
 return {root,stage};
}

test('live candidate and financial counters restore visible proportional bars without invented counts',()=>{
 const candidates={migrationsReceived:24,known:15,watch:10,eligible:null,queued:3,auditedWindows:4,uniqueAudited:2,predictiveAssessments:4,predictivePasses:1,predictiveFailures:3,deepActive:2,deepMaximum:4};
 const f={qualified:1,attempted:0,paperFilled:0,exited:0};
 const {stage,root}=draw(f,{candidates});
 assert.equal(stage('migrationsReceived').width,'100.00%');
 assert.equal(stage('watch').width,'41.67%');
 assert.equal(stage('predictivePasses').width,'4.17%');
 assert.equal(stage('qualified').width,'4.17%');
 assert.equal(stage('paperFilled').width,'0.00%');
 assert.equal(stage('eligible').width,'0%');
 assert.equal(stage('eligible').count,'Unavailable');
 assert.equal(stage('deepActive').width,'50.00%');
 assert.equal(stage('deepActive').count,'2 / 4');
 assert.equal(root.children[1]?.textContent.includes('market-wide denominator has not been established'),true);
});

test('missing or zero counts do not create fictional progress bars',()=>{
 const keys=['migrationsReceived','known','watch','eligible','queued','auditedWindows','uniqueAudited','predictiveAssessments','predictivePasses','predictiveFailures'];
 const candidates=Object.fromEntries(keys.map(key=>[key,null]));
 const {stage}=draw({qualified:0,attempted:0,paperFilled:0,exited:0},{candidates:{...candidates,deepActive:null,deepMaximum:null}});
 assert.equal(stage('migrationsReceived').width,'0%');
 assert.equal(stage('migrationsReceived').count,'Unavailable');
 assert.equal(stage('qualified').width,'0.00%');
 assert.equal(stage('deepActive').count,'? / ?');
 assert.equal(stage('deepActive').width,'0%');
});

test('durable discovery bars distinguish registry lifetime, hourly arrivals, active stocks and financial scope',()=>{
 const marketCoverage={version:'poe-market-coverage-v1',persistence:{createdAt:'2026-10-30T22:00:00.000Z'},lifetime:{uniqueTokensDiscovered:1200,lightweightScreened:1190,lightweightWithActivity:900,lightweightUnavailable:290,deepAdmitted:36,verifiedAudited:30},currentHour:{startedAt:'2026-10-30T22:00:00.000Z',uniqueTokensDiscovered:600},active:{trackedIdentities:1100,awaitingLightweight:10,awaitingVerification:20,awaitingDeep:60,deepObserving:4},financial:{scope:'current-source-instance',qualified:2,entries:1,exits:0}};
 const {stage,root}=draw({qualified:999,paperFilled:999,exited:999},{candidates:{known:174,deepActive:0,deepMaximum:4},marketCoverage});
 assert.equal(stage('uniqueTokensDiscovered').count,'1,200');assert.equal(stage('uniqueTokensDiscovered').width,'100.00%');assert.equal(stage('hourUniqueTokens').width,'50.00%');
 assert.equal(stage('trackedIdentities').count,'1,100');assert.equal(stage('awaitingLightweight').count,'10');assert.equal(stage('lightweightUnavailable').count,'290');
 assert.equal(stage('paperFilled').count,'1');assert.equal(stage('deepActive').count,'4 / 4');assert.equal(stage('deepActive').width,'100.00%');
 assert.equal(root.children[0]!.children.some(item=>item.dataset.funnelStage==='known'),false,'restored legacy retained cap is not relabelled as discovery');
 const note=root.children[1]!.textContent;assert.match(note,/registry lifetime begins/);assert.match(note,/financial stages are current-source counters/);assert.match(note,/does not imply complete market data or economic qualification/);assert.match(note,/market-wide denominator has not been established/);
});

test('unavailable durable activity and backlog stay unavailable while real zero entries remain visible',()=>{
 const marketCoverage={version:'poe-market-coverage-v1',persistence:{createdAt:null},lifetime:{uniqueTokensDiscovered:2000,lightweightScreened:2000,lightweightWithActivity:null,lightweightUnavailable:null,deepAdmitted:0,verifiedAudited:0},currentHour:{startedAt:null,uniqueTokensDiscovered:null},active:{trackedIdentities:2000,awaitingLightweight:0,awaitingVerification:null,awaitingDeep:0,deepObserving:0},financial:{qualified:null,entries:0,exits:0}};
 const {stage}=draw({},{candidates:{deepMaximum:4},marketCoverage});
 assert.equal(stage('lightweightWithActivity').count,'Unavailable');assert.equal(stage('lightweightWithActivity').width,'0%');assert.equal(stage('awaitingVerification').count,'Unavailable');assert.equal(stage('paperFilled').count,'0');
});

test('coverage metrics expose real durable delays and feed gaps without manufacturing a full-market percentage',()=>{
 const root=new FakeElement(),start=dashboardSource.indexOf('function renderMetrics('),through=dashboardSource.indexOf('// Display only the durable',start);
 const add=(parent:FakeElement,_tag:string,value?:unknown,klass?:string)=>{const child=new FakeElement();child.className=klass??'';child.textContent=value===undefined?'':String(value);parent.children.push(child);return child;};
 const context=createContext({byId:()=>root,add,Number,Math});new Script(dashboardSource.slice(start,through)).runInContext(context);
 const marketCoverage={version:'poe-market-coverage-v1',persistence:{state:'sqlite-wal',createdAt:'2026-10-30T22:00:00.000Z',updatedAt:'2026-10-30T22:43:00.000Z'},lifetime:{uniqueTokensDiscovered:1000,lightweightScreened:900},active:{awaitingLightweight:100,awaitingDeep:60},resource:{durableVerificationBacklog:25,oldestVerificationAt:'2026-10-30T22:40:00.000Z',maximumVerificationWaitMs:180000,storageFailures:0,meanWriteMs:.125,maximumWriteMs:4,registryTransactions:{scope:'CURRENT_SOURCE_PROCESS',runId:'native-paper-current',attempted:100,readOnlyCommits:90,writeCommits:9,failed:1,fsyncEligibleCommits:9}},feeds:[{source:'pumpportal-new-token',connected:true,lastObservedAt:'2026-10-30T22:43:00.000Z',scope:'CREATION_HINTS',coverageGaps:2},{source:'pumpapi-broad',connected:false,lastObservedAt:null,scope:'SHARED_ACTIVITY_HINTS',coverageGaps:3}],limitations:['MARKET_DENOMINATOR_UNKNOWN','PREEXISTING_MARKET_BACKFILL_UNAVAILABLE','PREMIGRATION_EXECUTION_NOT_SUPPORTED']};
 (context as unknown as {renderMetrics:(m:unknown,s:unknown,i:unknown)=>void}).renderMetrics({}, {}, {marketCoverage,candidates:{},quality:{limitations:[]},provider:{},resources:{cpuOneCoreFraction:null},protection:{},times:{},run:{}});
 const facts=new Map<string,string>();const walk=(node:FakeElement)=>{if(node.className==='metric')facts.set(node.children[0]!.textContent,node.children[1]!.textContent);node.children.forEach(walk);};walk(root);
 assert.equal(facts.get('Registry counter run'),'native-paper-current');assert.equal(facts.get('Transactions attempted / read-only / write / failed'),'100 / 90 / 9 / 1');assert.equal(facts.get('Fsync-eligible commits (not observed OS calls)'),'9');assert.equal(facts.get('Unique identities locally classified'),'90.0% of encountered identities');assert.equal(facts.get('Maximum pending verification wait (ms)'),'180000');assert.equal(facts.get('Mean / maximum registry write (ms)'),'0.125 / 4');
 assert.equal(facts.get('Independent whole-market denominator'),'Unknown');assert.equal(facts.get('Capacity-related missed tokens'),'Not independently measured');assert.match(facts.get('Pump.fun creations')!,/Connected; CREATION_HINTS.*gap events 2/);assert.match(facts.get('Shared activity')!,/Disconnected.*last state observation Unavailable.*gap events 3/);
 const notes=root.children.filter(child=>child.className==='panel-sub').map(child=>child.textContent).join('\n');assert.match(notes,/complete market coverage is not claimed/);assert.match(notes,/backfill of tokens predating discovery/);assert.match(notes,/does not trade bonding-curve tokens/);assert.match(notes,/fsync-eligible write commits are not observed operating-system fsync calls/);
});

test('four-slot metrics distinguish occupancy, completed work, physical waits and actual financial callbacks',()=>{
 const root=new FakeElement(),start=dashboardSource.indexOf('function renderMetrics('),through=dashboardSource.indexOf('// Display only the durable',start);
 const add=(parent:FakeElement,_tag:string,value?:unknown,klass?:string)=>{const child=new FakeElement();child.className=klass??'';child.textContent=value===undefined?'':String(value);parent.children.push(child);return child;};
 const context=createContext({byId:()=>root,add,Number,Math});new Script(dashboardSource.slice(start,through)).runInContext(context);
 const emptyWait={count:0,sum:0,mean:null,max:null,p50:null,p95:null};
 const slotProductivity={version:'native-slot-productivity-v1',sourceInstanceId:'native-runner:current:source',startedAt:'2026-10-30T22:00:00.000Z',generatedAt:'2026-10-30T22:01:00.000Z',configuredSlots:4,stateMs:{VACANT:120000,SUBSCRIPTION_WAIT:1000,EVIDENCE_WARMING:118000,AUDIT_READY:0,AUDIT_WAIT:0,AUDIT_ACTIVE:1000,PROVIDER_WAIT:0,UNUSABLE:0,REPLACEMENT_WAIT:0},slots:Array.from({length:4},(_,slot)=>({slot,mint:null,state:slot===0?'EVIDENCE_WARMING':'VACANT',stateAgeMs:1000,openedAt:null})),failureCounts:{historyNotObservedWindows:3,decisionDeadlineWindows:2,auditUnusableWindows:1,providerUnavailableWindows:0},counts:{allocations:2,repromotions:0,distinctAudited:1,distinctPreliminaryEvaluated:1,distinctPrimaryEvaluated:1,qualified:0,entryFills:0,exitFills:0,unattributedFinancialEvents:0},waits:{queueToAllocation:{count:2,sum:4.5,mean:2.25,max:3,p50:1.5,p95:3},allocationToAck:emptyWait,ackToWarm:emptyWait,auditReadyToPhysicalStart:emptyWait,retirementToReplacement:emptyWait}};
 (context as unknown as {renderMetrics:(m:unknown,s:unknown,i:unknown)=>void}).renderMetrics({}, {}, {slotProductivity,candidates:{},quality:{limitations:[]},provider:{},resources:{cpuOneCoreFraction:null},protection:{},times:{},run:{}});
 const facts=new Map<string,string>();const walk=(node:FakeElement)=>{if(node.className==='metric')facts.set(node.children[0]!.textContent,node.children[1]!.textContent);node.children.forEach(walk);};walk(root);
 assert.equal(facts.get('Unique windows: history missing / deadline / unusable / provider unavailable'),'3 / 2 / 1 / 0');assert.equal(facts.get('Configured slots'),'4');assert.equal(facts.get('Occupied time'),'50.0% of observed slot time');assert.equal(facts.get('Distinct audited / preliminary / primary evaluations'),'1 / 1 / 1');assert.equal(facts.get('Qualifications / PAPER entries / exits'),'0 / 0 / 0');assert.equal(facts.get('Primary evaluations per hour (observed)'),'60.0');
 assert.match(facts.get('Queue → allocation')!,/n 2; mean \/ p50 \/ p95 \/ max 2.25 \/ 1.5 \/ 3 \/ 3/);assert.match(facts.get('Audit ready → physical receipt')!,/n 0.*Unavailable/);assert.match(facts.get('Slot 1')!,/Evidence warming/);
 const notes=root.children.filter(child=>child.className==='panel-sub').map(child=>child.textContent).join('\n');assert.match(notes,/Occupancy does not prove productive work/);assert.match(notes,/physical starts require a transport receipt/);assert.match(notes,/no per-slot profit/);assert.match(notes,/do not make history absence a provider failure/);
});

test('observer fallback retains its original distinction between discovery and inactive trading',()=>{
 const {stage}=draw({discovered:9,supported:5},null,true);
 assert.equal(stage('discovered').width,'100.00%');
 assert.equal(stage('supported').width,'0%');
 assert.equal(stage('supported').count,'NOT ACTIVE');
 assert.ok(stage('supported').classes.has('inactive-stage'));
});

test('holographic desktop and mobile styles provide visible bar tracks rather than a 15px column',()=>{
 assert.ok(holographicSource.includes('.funnel-track{height:8px'));
 assert.ok(holographicSource.includes('grid-template-columns:minmax(100px,1.05fr) minmax(90px,1.4fr)'));
 assert.ok(holographicSource.includes('grid-template-columns:minmax(95px,1fr) minmax(65px,.9fr)'));
 assert.ok(!holographicSource.includes('grid-template-columns:minmax(95px,1fr) 15px'));
});
