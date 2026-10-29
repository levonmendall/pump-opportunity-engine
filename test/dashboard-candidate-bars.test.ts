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
 get lastElementChild(){return this.children.at(-1)??null;}
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

test('observer fallback retains its original distinction between discovery and inactive trading',()=>{
 const {stage}=draw({discovered:9,supported:5},null,true);
 assert.equal(stage('discovered').width,'100.00%');
 assert.equal(stage('supported').width,'0%');
 assert.equal(stage('supported').count,'NOT ACTIVE');
 assert.ok(stage('supported').classes.has('inactive-stage'));
});

test('holographic desktop and mobile styles provide visible bar tracks rather than a 15px column',()=>{
 assert.match(holographicSource,/\\.funnel-track\\{height:8px/);
 assert.match(holographicSource,/grid-template-columns:minmax\\(100px,1\\.05fr\\) minmax\\(90px,1\\.4fr\\)/);
 assert.match(holographicSource,/grid-template-columns:minmax\\(95px,1fr\\) minmax\\(65px,\\.9fr\\)/);
 assert.doesNotMatch(holographicSource,/grid-template-columns:minmax\\(95px,1fr\\) 15px/);
});
