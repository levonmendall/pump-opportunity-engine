import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContext,Script} from 'node:vm';
import {CONNECTIONS_HTML,CONNECTIONS_SCRIPT} from '../src/dashboard-connections.js';

class Element {
  textContent='';children:Element[]=[];className='';
  readonly classes=new Set<string>();
  readonly classList={add:(name:string)=>this.classes.add(name),toggle:(name:string,on:boolean)=>on?this.classes.add(name):this.classes.delete(name)};
  append(...children:Element[]){this.children.push(...children);}
  replaceChildren(...children:Element[]){this.children=children;}
  set innerHTML(_value:string){throw Error('Untrusted HTML rendering forbidden');}
}
const now=Date.now();
function snapshot(){return {kind:'experimental-pilot',authoritative:false,liveTrading:false,accountId:'poe-pilot-ui-fixture',inceptionAt:now-600000,runId:'ui-fixture',generatedAt:now-180000,source:{release:'abc123',strategy:'pilot-v1'},running:false,entriesEnabled:false,status:'graceful stop',funnel:{evaluated:3,reconciled:20},metrics:{rpcRequests:4},decisions:[{at:now-190000,mint:'<img src=x>',stage:'strategy-rejection',reason:'<script>alert(1)</script>'}],refusals:[]};}
async function browser(first:unknown){
  const nodes=new Map<string,Element>();for(const id of ['pilot-link-state','pilot-link-detail','pilot-source-detail','pilot-funnel','pilot-watch','pilot-age-policy','pilot-metrics','pilot-decisions','pilot-refusals'])nodes.set(id,new Element());
  let response=first,mono=0,fail=false;const paths:string[]=[],timeouts:Array<()=>Promise<void>>=[],intervals:Array<()=>void>=[],primary:Array<{snapshot:unknown;state:unknown}|null>=[];
  const context=createContext({document:{getElementById:(id:string)=>nodes.get(id),createElement:()=>new Element(),addEventListener:()=>{},hidden:false},performance:{now:()=>mono},Date,Intl,Number,JSON,Array,Object,String,Error,AbortSignal:{timeout:()=>undefined},setPilotIntelligence:(snapshot:unknown,state:unknown)=>primary.push({snapshot,state}),clearPilotIntelligence:()=>primary.push(null),fetch:async(path:string)=>{paths.push(path);if(fail)throw Error('Disconnected');return {ok:true,text:async()=>JSON.stringify(response)};},setTimeout:(fn:()=>Promise<void>)=>{timeouts.push(fn);return 1;},clearTimeout:()=>{},setInterval:(fn:()=>void)=>{intervals.push(fn);return 1;}});
  const code=CONNECTIONS_SCRIPT.replace(/^<script>\s*/,'').replace(/\s*<\/script>$/,'');new Script(code).runInContext(context);await new Promise(setImmediate);
  return {nodes,paths,primary,advance:(ms:number)=>{mono+=ms;for(const fn of intervals)fn();},poll:async(next:unknown,failed=false)=>{response=next;fail=failed;await timeouts.pop()!();await new Promise(setImmediate);}};
}
test('pilot extension updates candidate intelligence only, never authoritative financial portfolio data',()=>{
  assert.match(CONNECTIONS_HTML,/EXPERIMENTAL PAPER/);assert.match(CONNECTIONS_HTML,/No pilot balances or results are merged/);
  assert.doesNotMatch(CONNECTIONS_SCRIPT,/showSnapshot|renderCards|renderMetrics|positionsCount|tradesCount|tradingPnlUsd|balances|api\/snapshot|innerHTML|Bearer|ingestionSecret/);
  assert.match(CONNECTIONS_SCRIPT,/setPilotIntelligence/);assert.match(CONNECTIONS_SCRIPT,/clearPilotIntelligence/);
  assert.match(CONNECTIONS_SCRIPT,/fetch\('\/api\/pilot'/);
});
test('stopped stale source remains separate from active publisher contact and renders untrusted strings as text',async()=>{
  const s=snapshot(),b=await browser({state:'stale',snapshot:s,receivedAt:now-180000,lastContactAt:now-1000,sourceAgeMs:180000,lastContactAgeMs:1000});
  assert.deepEqual(b.paths,['/api/pilot']);
  assert.equal(b.primary.length,1);assert.equal((b.primary[0] as any).state,'stale');assert.equal((b.primary[0] as any).snapshot.accountId,s.accountId);
  const state=b.nodes.get('pilot-link-state')!.textContent;assert.match(state,/STOPPED/);assert.match(state,/SOURCE STALE/);assert.doesNotMatch(state,/DISCONNECTED/);
  assert.match(b.nodes.get('pilot-link-detail')!.textContent,/no ongoing monitoring/);
  assert.match(b.nodes.get('pilot-source-detail')!.textContent,new RegExp(String(s.runId)));
  assert.ok(b.nodes.get('pilot-decisions')!.children[0]!.textContent.includes('<script>alert(1)</script>'));
  b.advance(100000);assert.match(b.nodes.get('pilot-link-state')!.textContent,/PUBLISHER DISCONNECTED.*STOPPED.*SOURCE STALE/);
});
test('failed browser fetch retains last diagnostics and valid cache loss clears them without fabricating counters',async()=>{
  const b=await browser({snapshot:snapshot(),receivedAt:now,sourceAgeMs:180000,receiverAgeMs:0});
  const count=b.nodes.get('pilot-funnel')!.children.length;assert.ok(count>0);
  await b.poll(null,true);assert.match(b.nodes.get('pilot-link-state')!.textContent,/DASHBOARD READ FAILED/);assert.equal(b.nodes.get('pilot-funnel')!.children.length,count);
  await b.poll({state:'awaiting-data',snapshot:null,message:'No pilot report received.'});assert.equal(b.nodes.get('pilot-funnel')!.children.length,0);assert.equal(b.nodes.get('pilot-link-state')!.textContent,'AWAITING DATA');assert.equal(b.nodes.get('pilot-source-detail')!.textContent,'');
  assert.equal(b.primary.at(-1),null);
});
test('malformed response does not replace a valid experimental source',async()=>{
  const b=await browser({snapshot:snapshot(),receivedAt:now,sourceAgeMs:180000,receiverAgeMs:0});
  await b.poll({snapshot:{running:true}});assert.match(b.nodes.get('pilot-link-state')!.textContent,/DASHBOARD READ FAILED.*STOPPED/);assert.match(b.nodes.get('pilot-source-detail')!.textContent,/poe-pilot-ui-fixture/);
});


test('dynamic watch capacity stays separate from portfolio and unavailable fields are not zeros',async()=>{
 const s={...snapshot(),watch:{known:120,watch:90,eligibleKnown:100,deepActive:3,maximumDeep:6,queued:7,waitMs:{mean:1250,maximum:5000},promotionWaitMs:{mean:2000,maximum:4000},promoted:18,repromoted:2,demoted:9,completeWindows:12,predictiveAssessments:12,predictiveFailures:10,strategyRejections:2,capacityExclusions:1,incompleteDataExclusions:null,enrichmentDeadlineFailures:null,structuralExclusions:3,expired:4}};
 const b=await browser({snapshot:s,receivedAt:now,sourceAgeMs:180000,receiverAgeMs:0});
 const cards=b.nodes.get('pilot-watch')!.children;const text=cards.map(c=>c.children.map(v=>v.textContent).join(': ')).join('\n');
 assert.match(text,/Deep slots active \/ maximum: 3 \/ 6/);assert.match(text,/Promotions \/ re-promotions: 18 \/ 2/);
 assert.match(text,/Current queue wait: average \/ maximum \(s\): 1.25 \/ 5/);assert.match(text,/Completed admission wait: average \/ maximum \(s\): 2 \/ 4/);
 assert.match(text,/Feature-only assessments: 12/);assert.match(text,/Feature-only failures: 10/);assert.match(text,/Primary strategy rejections: 2/);
 assert.match(text,/Incomplete-data exclusions: Not reported/);assert.doesNotMatch(text,/%|cash|equity|P&L/i);
 await b.poll({state:'awaiting-data',snapshot:null});assert.equal(b.nodes.get('pilot-watch')!.children.length,0);
});
test('older pilot report makes watch unavailability explicit',async()=>{
 const b=await browser({snapshot:snapshot(),receivedAt:now,sourceAgeMs:180000,receiverAgeMs:0});
 assert.match(b.nodes.get('pilot-watch')!.children[0]!.textContent,/not reported/);
});


test('observation-age cohorts are shown separately from unchanged baseline entry and do not imply performance',async()=>{
 const s={...snapshot(),observationAgePolicy:{version:'observation-age-v1',minimumObservationAgeMs:0,recentMaximumAgeMs:7200000,selectedOlderMaximumAgeMs:21600000},watch:{known:174,watch:120,eligibleKnown:90,deepActive:6,maximumDeep:6,queued:3,waitMs:{mean:0,maximum:0},observationEligibleKnown:116,observationQueued:8,maximumOlderResearchIdentities:24,ageCohorts:{preEntry:20,entryEligible:90,olderSelected:6}}};
 const b=await browser({snapshot:s,receivedAt:now,sourceAgeMs:180000,receiverAgeMs:0});assert.match(b.nodes.get('pilot-age-policy')!.textContent,/Observation 0–120 min; selected older research 120–360 min/);assert.match(b.nodes.get('pilot-age-policy')!.textContent,/Baseline entry comparison remains 5–120 minutes/);assert.match(b.nodes.get('pilot-age-policy')!.textContent,/not predictive quality or returns/);
 const values=b.nodes.get('pilot-watch')!.children.map(c=>c.children.map(v=>v.textContent).join(': ')).join('\n');assert.match(values,/Observation-eligible identities: 116/);assert.match(values,/Observation-ready queue: 8/);assert.match(values,/Pre-entry observation cohort \(<5 min\): 20/);assert.match(values,/Baseline entry-age cohort \(5–120 min\): 90/);assert.match(values,/Selected older research cohort: 6/);assert.match(values,/Selected older watch capacity: 24/);assert.doesNotMatch(values,/%|return|profit/i);
 await b.poll({state:'awaiting-data',snapshot:null});assert.match(b.nodes.get('pilot-age-policy')!.textContent,/not reported/);
});
