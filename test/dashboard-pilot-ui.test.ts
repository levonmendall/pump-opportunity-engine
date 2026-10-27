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
  const nodes=new Map<string,Element>();for(const id of ['pilot-link-state','pilot-link-detail','pilot-source-detail','pilot-funnel','pilot-metrics','pilot-decisions','pilot-refusals'])nodes.set(id,new Element());
  let response=first,mono=0,fail=false;const paths:string[]=[],timeouts:Array<()=>Promise<void>>=[],intervals:Array<()=>void>=[];
  const context=createContext({document:{getElementById:(id:string)=>nodes.get(id),createElement:()=>new Element(),addEventListener:()=>{},hidden:false},performance:{now:()=>mono},Date,Intl,Number,JSON,Array,Object,String,Error,AbortSignal:{timeout:()=>undefined},fetch:async(path:string)=>{paths.push(path);if(fail)throw Error('Disconnected');return {ok:true,text:async()=>JSON.stringify(response)};},setTimeout:(fn:()=>Promise<void>)=>{timeouts.push(fn);return 1;},clearTimeout:()=>{},setInterval:(fn:()=>void)=>{intervals.push(fn);return 1;}});
  const code=CONNECTIONS_SCRIPT.replace(/^<script>\s*/,'').replace(/\s*<\/script>$/,'');new Script(code).runInContext(context);await new Promise(setImmediate);
  return {nodes,paths,advance:(ms:number)=>{mono+=ms;for(const fn of intervals)fn();},poll:async(next:unknown,failed=false)=>{response=next;fail=failed;await timeouts.pop()!();await new Promise(setImmediate);}};
}
test('pilot extension has no original portfolio hooks, snapshot reads, credentials or financial cards',()=>{
  assert.match(CONNECTIONS_HTML,/EXPERIMENTAL PAPER/);assert.match(CONNECTIONS_HTML,/No pilot balances or results are merged/);
  assert.doesNotMatch(CONNECTIONS_SCRIPT,/showSnapshot|renderFunnel|renderMetrics|api\/snapshot|innerHTML|Bearer|ingestionSecret/);
  assert.match(CONNECTIONS_SCRIPT,/fetch\('\/api\/pilot'/);
});
test('stopped stale source remains separate from active publisher contact and renders untrusted strings as text',async()=>{
  const s=snapshot(),b=await browser({state:'stale',snapshot:s,receivedAt:now-180000,lastContactAt:now-1000,sourceAgeMs:180000,lastContactAgeMs:1000});
  assert.deepEqual(b.paths,['/api/pilot']);
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
});
test('malformed response does not replace a valid experimental source',async()=>{
  const b=await browser({snapshot:snapshot(),receivedAt:now,sourceAgeMs:180000,receiverAgeMs:0});
  await b.poll({snapshot:{running:true}});assert.match(b.nodes.get('pilot-link-state')!.textContent,/DASHBOARD READ FAILED.*STOPPED/);assert.match(b.nodes.get('pilot-source-detail')!.textContent,/poe-pilot-ui-fixture/);
});
