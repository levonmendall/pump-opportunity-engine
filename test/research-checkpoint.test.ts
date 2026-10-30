/** OFFLINE public countermetadata only. All files/processes are disposable;
 * no provider, actual pilot manifest, account or financial database is read. */
import {test,type TestContext} from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {mkdtempSync,readFileSync,writeFileSync,rmSync,chmodSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createResearchBaselineCheckpoint,readResearchBaseline,verifyResearchCheckpointSourceHandoff} from '../src/research-baseline.js';
import {ComponentBudget,type ComponentBaseline} from '../src/component-budget.js';
import {PilotRpc} from '../src/pilot-rpc.js';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function fixture(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-research-checkpoint-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,write(name:string,value:unknown){const p=join(dir,name);writeFileSync(p,JSON.stringify(value)+'\n',{mode:0o600});return p;}};}
const legacy=(at=1000)=>({schemaVersion:1,calls:2,bytes:100,lastObservedAt:at,starts:[at-100,at],pending:[{id:2,unobservedBytes:2000}],blockedReason:'RPC_HTTP_429'});
const settled={inFlight:0,waitingOrOperating:false,physicalTransportsSettled:true};
function checkpoint(paths:string[],path:string,at:number,checkpointSha256?:string){return createResearchBaselineCheckpoint({paths,outputPath:path,now:at,physicalSettled:true,allowCumulativeBeyondLegacy:true,settlement:settled,...(checkpointSha256?{checkpointSha256}:{})});}

test('quiescent append-only checkpoint preserves all cumulative counters, old429 and uncertain debits while bounding rolling starts',t=>{
 const f=fixture(t),a=f.write('legacy.json',legacy()),initial=readResearchBaseline({paths:[a],now:100000,physicalSettled:true}).baseline;
 const b=f.write('chapter.json',{schemaVersion:1,grantId:'known',baseline:initial,startedAt:2000,lastObservedAt:100000,starts:[2000,95000],actualInvocations:[{id:3,at:2001},{id:4,at:95003}],httpBytes:20,wsBytes:30,pending:[{id:4,transport:'http',reservedBytes:3000}],haltedReason:'COMPONENT_HTTP_429'});
 const hashes=[a,b].map(hash),sealed=checkpoint([a,b],join(f.dir,'checkpoint.json'),100000),r=readResearchBaseline({paths:sealed.baselinePaths,checkpointSha256:sealed.sha256,now:100000,physicalSettled:true});
 assert.equal(r.baseline.calls,4);assert.equal(r.observedBytes,150);assert.equal(r.uncertainResponseBytes,5000);assert.equal(r.baseline.bytes,5150);assert.equal(r.pendingOperations,2);assert.equal(r.baseline.refusalAt,1000);assert.equal(r.baseline.refusal,'RPC_HTTP_429');assert.deepEqual(r.baseline.starts,[95003,100000,100000]);assert.deepEqual(r.baseline.startHistory,{schemaVersion:1,omittedStarts:1,retainedSinceAt:40000});assert.deepEqual([a,b].map(hash),hashes);assert.equal(r.sources.length,1);assert.equal(r.baseline.sha256,sealed.sha256);
 assert.throws(()=>readResearchBaseline({paths:sealed.baselinePaths,now:100000,physicalSettled:true}),/CHECKPOINT_HASH_MISMATCH/);assert.throws(()=>readResearchBaseline({paths:sealed.baselinePaths,checkpointSha256:'f'.repeat(64),now:100000,physicalSettled:true}),/CHECKPOINT_HASH_MISMATCH/);
 assert.throws(()=>checkpoint([a,b],sealed.path,100000),/EEXIST/,'never overwrite an earlier checkpoint');assert.equal(hash(sealed.path),sealed.sha256);
 assert.throws(()=>readResearchBaseline({paths:sealed.baselinePaths,checkpointSha256:sealed.sha256,now:100000}),/PHYSICAL_UNCERTAINTY/);
});

test('unknown physical stamps retain their latest possible time rather than refund recent provider demand',t=>{
 const f=fixture(t),a=f.write('legacy.json',legacy()),base=readResearchBaseline({paths:[a],now:100000,physicalSettled:true}).baseline;
 const b=f.write('unknown.json',{schemaVersion:1,grantId:'unknown',baseline:base,startedAt:2000,lastObservedAt:99999,starts:Array.from({length:90},(_,i)=>2000+i*250),actualInvocations:[],httpBytes:10,wsBytes:0,pending:[]}),sealed=checkpoint([a,b],join(f.dir,'checkpoint.json'),100000),linked=readResearchBaseline({paths:[sealed.path],checkpointSha256:sealed.sha256,now:100000,physicalSettled:true});
 assert.equal(linked.baseline.calls,92);assert.deepEqual(linked.baseline.starts,Array(92).fill(100000));let at=100000,mono=100000;
 const gate=new ComponentBudget({statePath:join(f.dir,'new.json'),grantId:'new',baseline:linked.baseline,startedAt:at,now:()=>at,monotonic:()=>mono,limits:{maxCumulativeUnits:null,maxCumulativeBytes:null,minSpacingMs:250,maxStartsPerMinute:90,maxStartsPer10s:20}});t.after(()=>gate.close());assert.equal(gate.usage().rolling60SecondStarts,92);assert.equal(gate.dispatchWindow().readyAt,160000);assert.equal(gate.calls,92);assert.equal(gate.usage().baseline.startHistory?.omittedStarts,0);
 at=160000;mono=160000;assert.equal(gate.usage().rolling60SecondStarts,0);assert.equal(gate.dispatchWindow().waitMs,0);
});

test('repeated24h rollovers retain raw history, stable operationIDs and cumulative unknown bytes with a small live chain',async t=>{
 const f=fixture(t),allRaw:string[]=[],a=f.write('legacy.json',legacy());allRaw.push(a);let paths=[a],anchor:string|undefined,expectedCalls=2,expectedObserved=100,expectedUncertain=2000,at=100000;
 for(let period=0;period<72;period++){
  const before=readResearchBaseline({paths,checkpointSha256:anchor,now:at,physicalSettled:true,allowCumulativeBeyondLegacy:true}).baseline;
  const b=f.write('day-'+period+'.json',{schemaVersion:1,grantId:'day-'+period,baseline:before,startedAt:at,lastObservedAt:at+1000,starts:[at,at+500],actualInvocations:[{id:expectedCalls+1,at:at+1}],httpBytes:7,wsBytes:11,pending:[{id:expectedCalls+2,transport:'http',reservedBytes:1234}]});allRaw.push(b);expectedCalls+=2;expectedObserved+=18;expectedUncertain+=1234;
  const sealed=checkpoint([...paths,b],join(f.dir,'checkpoint-'+period+'.json'),at+1000,anchor);allRaw.push(sealed.path);paths=sealed.baselinePaths;anchor=sealed.sha256;
  const r=readResearchBaseline({paths,checkpointSha256:anchor,now:at+1000,physicalSettled:true,allowCumulativeBeyondLegacy:true});assert.equal(r.baseline.calls,expectedCalls);assert.equal(r.observedBytes,expectedObserved);assert.equal(r.uncertainResponseBytes,expectedUncertain);assert.equal(r.baseline.bytes,expectedObserved+expectedUncertain);assert.ok(r.baseline.starts.length<=(period===0?4:2));assert.ok(r.inputBytes<4096);
  at+=24*60*60*1000;
 }
 assert.ok(allRaw.every(existsSync));const priorHashes=allRaw.map(hash),base=readResearchBaseline({paths,checkpointSha256:anchor,now:at,physicalSettled:true,allowCumulativeBeyondLegacy:true}).baseline;
 let now=at,mono=at;const gate=new ComponentBudget({statePath:join(f.dir,'last.json'),grantId:'after-72-rollovers',baseline:base,startedAt:now,now:()=>now,monotonic:()=>mono,limits:{maxCumulativeUnits:null,maxCumulativeBytes:null}});const id=await gate.operate({transport:'http',method:'getSlot'},async op=>{op.chargeHttp(9);op.completeResponse();return op.id;});assert.equal(id,expectedCalls+1);gate.close();assert.deepEqual(allRaw.map(hash),priorHashes);
});

test('in-flight or unsettled transport refuses checkpoint before writing; corruption and anchor mismatch fail closed',t=>{
 const f=fixture(t),a=f.write('legacy.json',legacy()),path=join(f.dir,'checkpoint.json');
 for(const patch of [{inFlight:1},{waitingOrOperating:true},{physicalTransportsSettled:false}])assert.throws(()=>createResearchBaselineCheckpoint({paths:[a],outputPath:path,now:100000,physicalSettled:true,settlement:{...settled,...patch}}),/CHECKPOINT_PHYSICAL_UNSETTLED/);assert.equal(existsSync(path),false);
 const sealed=checkpoint([a],path,100000),original=readFileSync(path);for(const mutation of [(value:any)=>{value.accounted.calls++;},(value:any)=>{value.accounted.uncertainResponseBytes=0;value.accounted.bytes=value.accounted.observedBytes;},(value:any)=>{value.starts.retainedSinceAt++;},(value:any)=>{value.physicalSettlement.inFlight=1;},(value:any)=>{value.previousCheckpoint={path:a,sha256:'f'.repeat(64)};}]){const value=JSON.parse(original.toString());mutation(value);writeFileSync(path,JSON.stringify(value)+'\n');assert.throws(()=>readResearchBaseline({paths:[path],checkpointSha256:sealed.sha256,now:100000,physicalSettled:true}),/CHECKPOINT_HASH_MISMATCH/);assert.throws(()=>readResearchBaseline({paths:[path],checkpointSha256:hash(path),now:100000,physicalSettled:true}),/CHECKPOINT_/);}
 writeFileSync(path,original);chmodSync(path,0o644);assert.throws(()=>readResearchBaseline({paths:[path],checkpointSha256:sealed.sha256,now:100000,physicalSettled:true}),/CHECKPOINT_PRIVATE_OWNER_FILE/);
});

test('checkpointed normal chapters preserve strict hash/starts linkage, default path limits and throttle receipt requirement',t=>{
 const f=fixture(t),a=f.write('legacy.json',legacy()),base=readResearchBaseline({paths:[a],now:100000,physicalSettled:true}).baseline,b=f.write('last.json',{schemaVersion:1,grantId:'last',baseline:base,startedAt:2000,lastObservedAt:100000,starts:[],httpBytes:0,wsBytes:0,pending:[],haltedReason:'COMPONENT_HTTP_429'}),sealed=checkpoint([a,b],join(f.dir,'anchor.json'),100000);
 assert.throws(()=>new PilotRpc({directory:join(f.dir,'rpc-without-receipt'),runId:'without',baselinePaths:[sealed.path],baselineCheckpointSha256:sealed.sha256,priorPhysicalSettled:true,now:()=>100000,monotonic:()=>0}),/PRIOR_THROTTLE_RECEIPT_REQUIRED/);
 const rpc=new PilotRpc({directory:join(f.dir,'rpc'),runId:'same-ids',baselinePaths:[sealed.path],baselineCheckpointSha256:sealed.sha256,priorPhysicalSettled:true,priorCooldownUntil:165000,now:()=>100000,monotonic:()=>0});assert.equal(rpc.cooldownUntil(),165000);assert.equal(rpc.usage().cumulativeUnits,2);assert.equal(rpc.usage().baselineCheckpointSha256,sealed.sha256);rpc.close();
 const anchored=readResearchBaseline({paths:[sealed.path],checkpointSha256:sealed.sha256,now:100001,physicalSettled:true}).baseline,c=f.write('child.json',{schemaVersion:1,grantId:'child',baseline:{...anchored,startHistory:{...anchored.startHistory!,omittedStarts:anchored.startHistory!.omittedStarts+1}},startedAt:100001,lastObservedAt:100001,starts:[],httpBytes:0,wsBytes:0,pending:[]});assert.throws(()=>readResearchBaseline({paths:[sealed.path,c],checkpointSha256:sealed.sha256,now:100001,physicalSettled:true}),/CHAIN_CONFLICT/);
});

test('unpersisted physical invocation cannot escape rolling control merely because its last durable observation is old',t=>{
 const f=fixture(t),a=f.write('old-reservation.json',legacy(1000)),sealed=checkpoint([a],join(f.dir,'seal.json'),100000),r=readResearchBaseline({paths:[sealed.path],checkpointSha256:sealed.sha256,now:100000,physicalSettled:true});assert.deepEqual(r.baseline.starts,[100000,100000]);assert.equal(sealed.unknownPhysicalStartsConservativelyAtSeal,2);const second=checkpoint([sealed.path],join(f.dir,'seal2.json'),130000,sealed.sha256),later=readResearchBaseline({paths:[second.path],checkpointSha256:second.sha256,now:130000,physicalSettled:true});assert.deepEqual(later.baseline.starts,[100000,100000],'an established settlement timestamp ages normally and is never moved forward repeatedly');assert.equal(second.unknownPhysicalStartsConservativelyAtSeal,0);
});

test('settled-handoff adoption must match every exact source path/hash and counter; archived mutation is detectable without unbounded startup replay',t=>{
 const f=fixture(t),a=f.write('legacy.json',legacy()),base=readResearchBaseline({paths:[a],now:100000,physicalSettled:true}).baseline,b=f.write('child.json',{schemaVersion:1,grantId:'child',baseline:base,startedAt:2000,lastObservedAt:100000,starts:[2000],actualInvocations:[{id:3,at:2001}],httpBytes:13,wsBytes:17,pending:[]}),sealed=checkpoint([a,b],join(f.dir,'checkpoint.json'),100000),opts={checkpointPath:sealed.path,checkpointSha256:sealed.sha256,sourcePaths:[a,b],now:100000,physicalSettled:true as const};
 const verified=verifyResearchCheckpointSourceHandoff(opts);assert.equal(verified.sourceCount,2);assert.equal(verified.accountedUnits,3);assert.equal(verified.uncertainResponseBytes,2000);assert.throws(()=>verifyResearchCheckpointSourceHandoff({...opts,sourcePaths:[a]}),/CHECKPOINT_SOURCE_HANDOFF/);assert.throws(()=>verifyResearchCheckpointSourceHandoff({...opts,sourcePaths:[b,a]}),/INVALID_LEGACY_BOOK/);
 const changed=JSON.parse(readFileSync(b,'utf8'));changed.httpBytes++;writeFileSync(b,JSON.stringify(changed)+'\n');assert.throws(()=>verifyResearchCheckpointSourceHandoff(opts),/CHECKPOINT_SOURCE_HANDOFF/);assert.equal(readResearchBaseline({paths:[sealed.path],checkpointSha256:sealed.sha256,now:100000,physicalSettled:true}).baseline.calls,3,'normal startup uses its explicit pinned seal, not a fresh claim that archived files were re-read');
});

test('PilotRpc resumes the explicit pinned anchor, links ordinary physical chapters and retains the pin across another restart',async t=>{
 const f=fixture(t),a=f.write('legacy.json',legacy()),sealed=checkpoint([a],join(f.dir,'anchor.json'),100000);let at=170000,mono=170000,network=0;
 const options={runId:'anchor-restart',directory:join(f.dir,'rpc'),baselinePaths:[sealed.path],baselineCheckpointSha256:sealed.sha256,priorPhysicalSettled:true as const,priorCooldownUntil:165000,now:()=>at,monotonic:()=>mono,fetcher:(async(_url,init)=>{network++;const request=JSON.parse(String(init?.body));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:17}),{status:200});}) as typeof fetch};
 const rpc=new PilotRpc(options);assert.equal(await rpc.call<number>('getSlot'),17);assert.equal(network,1);assert.equal(rpc.usage().cumulativeUnits,3);rpc.close();const paths=rpc.usage().chapterPaths;assert.equal(paths.length,2);const raw=JSON.parse(readFileSync(paths[1]!,'utf8'));assert.deepEqual(raw.actualInvocations,[{id:3,at:170000}]);const total=readResearchBaseline({paths,checkpointSha256:sealed.sha256,now:at,physicalSettled:true});assert.equal(total.baseline.calls,3);assert.equal(total.uncertainResponseBytes,2000);assert.equal(total.baseline.startHistory?.omittedStarts,0);
 at+=1000;mono+=1000;const resumed=new PilotRpc({...options,directory:join(f.dir,'rpc-resumed'),runId:'anchor-restarted-again',baselinePaths:paths});assert.equal(resumed.usage().cumulativeUnits,3);assert.equal(resumed.usage().newUnits,0);assert.equal(resumed.usage().baselineCheckpointSha256,sealed.sha256);resumed.close();assert.equal(hash(sealed.path),sealed.sha256);
});
