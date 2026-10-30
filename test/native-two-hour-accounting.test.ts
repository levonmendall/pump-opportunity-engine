/** Size/debit/recovery fixtures only. No network or financial database. */
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ComponentBudget,COMPONENT_COUNTERBOOK_MAX_BYTES,type ComponentBudgetOptions} from '../src/component-budget.js';
import {readResearchBaseline,RESEARCH_MAXIMUM_INPUT_BYTES,RESEARCH_MAXIMUM_PATHS} from '../src/research-baseline.js';
import {PilotRpc} from '../src/pilot-rpc.js';
import {NATIVE_TWO_HOUR_RESEARCH_PROFILE as PROFILE} from '../src/native-research-profile.js';
const MIB=1024*1024,T=Date.parse('2026-10-28T06:00:00Z');
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function fixture(t:TestContext,calls=20000){const directory=mkdtempSync(join(tmpdir(),'poe-DISPOSABLE-two-hour-accounting-')),old=join(directory,'old.json');const value={schemaVersion:1,blockedReason:'RPC_HTTP_429',calls,bytes:3*MIB,lastObservedAt:T-60000,starts:Array.from({length:calls},(_,i)=>T-60000-(calls-1-i)*1000),pending:[]};writeFileSync(old,JSON.stringify(value)+'\n',{mode:0o600});t.after(()=>rmSync(directory,{recursive:true,force:true}));return {directory,old,before:readFileSync(old),baseline:readResearchBaseline({paths:[old],now:T,physicalSettled:true,allowCumulativeBeyondLegacy:true}).baseline};}

test('projected cumulative starts beyond128KiB persist, grow, close and reopen without dropping history',async t=>{
 const f=fixture(t),path=join(f.directory,'component.json');let now=T;
 const options:ComponentBudgetOptions={profile:PROFILE.version,statePath:path,grantId:'two-hour-size-fixture',baseline:f.baseline,startedAt:T,totalMs:300000,limits:{maxNewUnits:200,maxCumulativeUnits:null,maxHttpBytes:PROFILE.relatedResponseBytes,maxWsBytes:PROFILE.relatedResponseBytes,maxCombinedBytes:PROFILE.relatedResponseBytes,maxCumulativeBytes:null,minSpacingMs:250,maxStartsPerMinute:60,maxStartsPer10s:20},now:()=>now,monotonic:()=>now,sleep:async ms=>{now+=ms;}};
 const b=new ComponentBudget(options);await b.operate({transport:'http',method:'getSlot'},async operation=>{operation.chargeHttp(91);operation.completeResponse();});const before=b.usage();assert.ok(statSync(path).size>128*1024);assert.ok(statSync(path).size<=COMPONENT_COUNTERBOOK_MAX_BYTES);b.close();
 const reopened=new ComponentBudget(options);try{assert.equal(reopened.calls,20001);assert.equal(reopened.bytes,before.cumulativeResponseBytes);assert.deepEqual(reopened.usage().baseline.starts,f.baseline.starts);assert.deepEqual(reopened.usage().starts,before.starts);await reopened.operate({transport:'ws',method:'ping'},async operation=>operation.completeResponse());assert.equal(reopened.calls,20002);}finally{reopened.close();}
 assert.deepEqual(readFileSync(f.old),f.before);assert.equal(COMPONENT_COUNTERBOOK_MAX_BYTES,PROFILE.maximumComponentBookBytes);assert.equal(RESEARCH_MAXIMUM_INPUT_BYTES,PROFILE.maximumBaselineBytes);
 const linked=readResearchBaseline({paths:[f.old,path],now,physicalSettled:true,allowCumulativeBeyondLegacy:true});assert.equal(linked.baseline.calls,20002);assert.equal(linked.baseline.bytes,f.baseline.bytes+91);assert.equal(linked.baseline.starts.length,20002);assert.equal(linked.baseline.refusal,'RPC_HTTP_429');assert.equal(linked.sources[0]!.sha256,hash(f.old));assert.equal(linked.sources[1]!.sha256,hash(path));
});

test('two-hour PilotRpc preserves large books and more than256MiB debit across chapters and a new linked run',async t=>{
 const f=fixture(t);let now=T,calls=0;const fetcher=(async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:123}));}) as typeof fetch;
 const common={profile:PROFILE.version,runId:'two-hour-offline',baselinePaths:[f.old],priorPhysicalSettled:true as const,priorCooldownUntil:0,durationMs:PROFILE.durationMs,maxUnits:PROFILE.maximumUnits,maxChapters:PROFILE.maximumChapters,maxResponseBytes:PROFILE.relatedResponseBytes,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,now:()=>now,monotonic:()=>now,sleep:async(ms:number)=>{now+=ms;},fetcher};
 const rpc=new PilotRpc({...common,directory:join(f.directory,'run')});await rpc.operateData({transport:'ws-upgrade',method:'upgrade'},async operation=>operation.completeResponse());for(let i=0;i<150;i++)rpc.accountControlBytes(2*MIB);assert.equal(rpc.usage().newAccountedResponseBytes,300*MIB);assert.ok(statSync(join(f.directory,'run/status.json')).size>256*1024,'status metadata must not inherit the old256KiB ceiling');
 now+=300001;assert.equal(await rpc.call('getSlot'),123);assert.equal(rpc.usage().chapter,2);const before=rpc.usage();rpc.close();const paths=rpc.usage().chapterPaths;assert.equal(paths.length,3);assert.equal(calls,1);assert.deepEqual(readFileSync(f.old),f.before);
 const linked=readResearchBaseline({paths,now,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS});assert.equal(linked.baseline.calls,20002);assert.equal(linked.baseline.bytes,before.accountedCumulativeResponseBytes);assert.equal(linked.uncertainResponseBytes,0);assert.equal(linked.sources[0]!.sha256,hash(f.old));
 const next=new PilotRpc({...common,runId:'linked-new-run',directory:join(f.directory,'next'),baselinePaths:paths});try{assert.equal(next.usage().newUnits,0);assert.equal(next.usage().cumulativeUnits,20002);assert.equal(await next.call('getSlot'),123);assert.equal(next.usage().cumulativeUnits,20003);assert.equal(next.usage().newUnits,1);assert.ok(next.usage().newAccountedResponseBytes>0);}finally{next.close();}
});

test('7500-unit64-chapter ceiling is opt-in and does not raise physical rates or legacy defaults',t=>{
 const f=fixture(t,20);const opts={directory:join(f.directory,'refused'),runId:'two-hour-refusal',baselinePaths:[f.old],priorPhysicalSettled:true as const,durationMs:PROFILE.durationMs,maxUnits:PROFILE.maximumUnits,maxChapters:PROFILE.maximumChapters,maxResponseBytes:PROFILE.relatedResponseBytes,now:()=>T,monotonic:()=>T};
 assert.throws(()=>new PilotRpc(opts),/INVALID_OPTIONS/);assert.throws(()=>new PilotRpc({...opts,profile:'candidate-native-research-v1'}),/INVALID_OPTIONS/);
 for(const patch of [{durationMs:PROFILE.durationMs+1},{maxUnits:7501},{maxChapters:65},{maxResponseBytes:PROFILE.relatedResponseBytes+1},{maxStartsPer10s:21}])assert.throws(()=>new PilotRpc({...opts,...patch,profile:PROFILE.version}),/INVALID_OPTIONS/);
 const legacy=new PilotRpc({...opts,directory:join(f.directory,'legacy'),durationMs:1800000,maxUnits:1500,maxChapters:32,maxResponseBytes:32*MIB});try{const rates=legacy.usage().requestLimits;assert.equal(rates.maxStartsPerMinute,60);assert.equal(rates.maxStartsPer10s,10);assert.equal(rates.minSpacingMs,250);assert.equal(rates.physicalInFlight,1);assert.equal(legacy.usage().maximumNewUnits,1500);}finally{legacy.close();}
});

test('shared reader bounds each book and the32MiB aggregate while keeping every linked source immutable',t=>{
 const f=fixture(t),paths=[f.old];let baseline=f.baseline;const lastAt=T;
 // Many empty but correctly linked chapters reproduce full-start-array storage
 // duplication without pretending these are physical requests or elapsed time.
 for(let i=0;i<125;i++){const path=join(f.directory,'empty-'+i+'.json'),book={schemaVersion:1,grantId:'empty-'+i,baseline,startedAt:lastAt,lastObservedAt:lastAt,starts:[],actualInvocations:[],httpBytes:0,wsBytes:0,pending:[]};writeFileSync(path,JSON.stringify(book)+'\n',{mode:0o600});paths.push(path);baseline={...baseline,sha256:hash(path)};}
 assert.ok(paths.reduce((n,path)=>n+statSync(path).size,0)>RESEARCH_MAXIMUM_INPUT_BYTES);const before=paths.map(hash);assert.throws(()=>readResearchBaseline({paths,now:T,physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:RESEARCH_MAXIMUM_PATHS}),/AGGREGATE_INPUT_BOUND/);assert.deepEqual(paths.map(hash),before);
 const tooLarge=join(f.directory,'oversized.json');writeFileSync(tooLarge,Buffer.alloc(COMPONENT_COUNTERBOOK_MAX_BYTES+1,32),{mode:0o600});assert.throws(()=>readResearchBaseline({paths:[tooLarge],now:T,physicalSettled:true,allowCumulativeBeyondLegacy:true}),/INVALID_FILE/);
});
