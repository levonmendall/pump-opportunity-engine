import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {readResearchBaseline} from '../src/research-baseline.js';

const historicalPaths=['evidence/free-data-20261027/active-approved-rpc-budget.json','evidence/public-component-20261027/rpc-budget.json'].map(p=>resolve(p));
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'poe-linked-baseline-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,write(name:string,value:unknown){const path=join(dir,name);writeFileSync(path,JSON.stringify(value)+'\n');return path;}};}
function old(){return {schemaVersion:1,budgetId:'old',calls:2,bytes:100,lastObservedAt:1000,starts:[900,1000],pending:[],blockedReason:'RPC_HTTP_429'};}

test('actual immutable books produce24 cumulative units and377058 bytes without double counting baseline20',()=>{
  const before=historicalPaths.map(hash),result=readResearchBaseline({paths:historicalPaths,now:1793081389445});
  assert.equal(result.baseline.calls,24);assert.equal(result.baseline.bytes,377058);assert.equal(result.observedBytes,377058);assert.equal(result.uncertainResponseBytes,0);
  assert.equal(result.baseline.refusal,'RPC_HTTP_429');assert.equal(result.baseline.refusalAt,1793070869405);assert.equal(result.baseline.sha256,before[1]);
  assert.deepEqual(result.sources.map(x=>x.incrementUnits),[20,4]);assert.deepEqual(result.baseline.starts.slice(-4),[1793081386306,1793081387309,1793081388313,1793081389315]);assert.deepEqual(historicalPaths.map(hash),before);
});

test('ordered chapters require exact preceding cumulative calls, bytes, starts and file hash',t=>{
  const f=fixture(t),a=f.write('old.json',old()),base=readResearchBaseline({paths:[a],now:2000}).baseline;
  const book={schemaVersion:1,grantId:'next',baseline:base,startedAt:1100,lastObservedAt:1200,starts:[1100],httpBytes:9,wsBytes:3,pending:[]};
  const b=f.write('next.json',book),next=readResearchBaseline({paths:[a,b],now:2000});
  assert.equal(next.baseline.calls,3);assert.equal(next.baseline.bytes,112);assert.deepEqual(next.baseline.starts,[900,1000,1100]);
  for(const key of ['calls','bytes','starts','sha256','refusalAt'] as const){const changed={...base,[key]:key==='sha256'?'f'.repeat(64):key==='starts'?[900,999]:Number(base[key])+1};f.write('next.json',{...book,baseline:changed});assert.throws(()=>readResearchBaseline({paths:[a,b],now:2000}),/CHAIN_CONFLICT/);}
  assert.throws(()=>readResearchBaseline({paths:[a,a],now:2000}),/DUPLICATE_PATH/);
});

test('pending uncertainty blocks unless physical settlement is explicitly confirmed; debit carries once',t=>{
  const f=fixture(t),a=f.write('old.json',old()),base=readResearchBaseline({paths:[a],now:2000}).baseline;
  const b=f.write('first.json',{schemaVersion:1,grantId:'first',baseline:base,startedAt:1100,lastObservedAt:1200,starts:[1100],actualInvocations:[{id:3,at:1101}],httpBytes:20,wsBytes:0,pending:[{id:3,transport:'http',reservedBytes:2000}]});
  assert.throws(()=>readResearchBaseline({paths:[a,b],now:2000}),(e:unknown)=>e instanceof Error&&e.message==='RESEARCH_BASELINE_PHYSICAL_UNCERTAINTY'&&(e as Error&{uncertainResponseBytes:number}).uncertainResponseBytes===2000);
  const first=readResearchBaseline({paths:[a,b],now:2000,physicalSettled:true});assert.equal(first.baseline.bytes,2120);
  const c=f.write('second.json',{schemaVersion:1,grantId:'second',baseline:first.baseline,startedAt:1300,lastObservedAt:1400,starts:[1300],httpBytes:30,wsBytes:5,pending:[]});
  const full=readResearchBaseline({paths:[a,b,c],now:2000,physicalSettled:true});assert.equal(full.baseline.calls,4);assert.equal(full.baseline.bytes,2155);assert.equal(full.observedBytes,155);assert.equal(full.uncertainResponseBytes,2000);assert.deepEqual(full.baseline.starts,[900,1000,1101,1300]);
});

test('future clocks, forged event identities, and cumulative overrun are rejected without writes',t=>{
  const f=fixture(t),a=f.write('old.json',old()),base=readResearchBaseline({paths:[a],now:2000}).baseline;
  assert.throws(()=>readResearchBaseline({paths:[a],now:999}),/INVALID_CLOCK/);
  const b=f.write('next.json',{schemaVersion:1,grantId:'next',baseline:base,startedAt:1100,lastObservedAt:1200,starts:[1100],actualInvocations:[{id:4,at:1101}],httpBytes:0,wsBytes:0,pending:[]});assert.throws(()=>readResearchBaseline({paths:[a,b],now:2000}),/INVALID_INVOCATIONS/);
  f.write('old.json',{...old(),bytes:64*1024*1024+1});assert.throws(()=>readResearchBaseline({paths:[a],now:2000}),/CUMULATIVE_CAP/);
});

test('explicit standing mode crosses historical lifetime caps while retaining uncertainty and the exact linked history',t=>{
  const f=fixture(t),a=f.write('old.json',old()),base=readResearchBaseline({paths:[a],now:2000}).baseline;
  const b=f.write('large.json',{schemaVersion:1,grantId:'bounded-standing',baseline:base,startedAt:1100,lastObservedAt:1400,starts:Array.from({length:239},(_,i)=>1100+i),httpBytes:65*1024*1024,wsBytes:17,pending:[{id:241,transport:'http',reservedBytes:2000}]});
  const before=[a,b].map(hash);assert.throws(()=>readResearchBaseline({paths:[a,b],now:2000,physicalSettled:true}),/CUMULATIVE_CAP/);
  assert.throws(()=>readResearchBaseline({paths:[a,b],now:2000,allowCumulativeBeyondLegacy:true}),/PHYSICAL_UNCERTAINTY/);
  const first=readResearchBaseline({paths:[a,b],now:2000,physicalSettled:true,allowCumulativeBeyondLegacy:true});assert.equal(first.baseline.calls,241);assert.equal(first.observedBytes,100+65*1024*1024+17);assert.equal(first.uncertainResponseBytes,2000);assert.equal(first.baseline.bytes,first.observedBytes+2000);
  const c=f.write('next.json',{schemaVersion:1,grantId:'another-bounded-run',baseline:first.baseline,startedAt:1500,lastObservedAt:1600,starts:[1500],actualInvocations:[{id:242,at:1501}],httpBytes:31,wsBytes:0,pending:[]});
  const next=readResearchBaseline({paths:[a,b,c],now:2000,physicalSettled:true,allowCumulativeBeyondLegacy:true});assert.equal(next.baseline.calls,242);assert.equal(next.baseline.bytes,first.baseline.bytes+31);assert.equal(next.uncertainResponseBytes,2000);assert.equal(next.baseline.starts.at(-1),1501);assert.deepEqual([a,b].map(hash),before);
});

test('an explicitly larger bounded chapter list preserves default32-path behavior and never scans directories',t=>{
  const f=fixture(t),paths=[f.write('old.json',old())];let base=readResearchBaseline({paths,now:2000}).baseline;
  for(let i=0;i<32;i++){
    const at=1100+i*2;paths.push(f.write('chapter-'+i+'.json',{schemaVersion:1,grantId:'next-'+i,baseline:base,startedAt:at,lastObservedAt:at+1,starts:[],httpBytes:0,wsBytes:0,pending:[]}));
    base=readResearchBaseline({paths,now:2000,maximumPaths:128}).baseline;
  }
  assert.equal(paths.length,33);assert.throws(()=>readResearchBaseline({paths,now:2000}),/INVALID_OPTIONS/);assert.equal(readResearchBaseline({paths,now:2000,maximumPaths:128}).baseline.calls,2);
  for(const maximumPaths of [0,129,1.5])assert.throws(()=>readResearchBaseline({paths,now:2000,maximumPaths}),/INVALID_OPTIONS/);
});
