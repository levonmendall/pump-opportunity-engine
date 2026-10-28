/** Offline retained-creation identity plus synthetic coordinator timing only.
 * No provider, fresh pool support, economic edge or financial execution is proved. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NativeCandidateRunner,type NativeOrigin} from '../src/native-candidate-runner.js';
import {PilotWatch} from '../src/pilot-watch.js';
import {decodeMigrationIdentity,type MigrationIdentity} from '../src/migration-identity.js';
import {entryAgeEligible} from '../src/observation-age.js';
import type {PilotMigrationProof,PilotMigrationSeed} from '../src/pilot-discovery.js';
const creation=(path:string)=>readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(row=>row.kind==='migration-transaction')!.data;
const actual=creation('evidence/integration-2026-10-26T23-32-41.255Z.ndjson');
const otherActual=creation('evidence/integration-2026-10-26T19-41-20.717Z.ndjson');
const sig=(tx:any)=>tx.transaction.signatures[0] as string;
function identity(tx:any,at:number):MigrationIdentity{const decoded=decodeMigrationIdentity(tx,{signature:sig(tx),commitment:'finalized',availableAt:at});assert.ok(decoded.ok);return decoded.identity;}
function origin(tx:any,at:number,older=false):NativeOrigin{return {originConfirmed:{signature:sig(tx),availableAt:at,transaction:structuredClone(tx)},originFinalized:{signature:sig(tx),availableAt:at,transaction:structuredClone(tx)},...(older?{olderSelection:{observedAt:at,evidence:'OFFLINE_SYNTHETIC_FRESH_WATCH_HINT'}}:{})};}
function metadata(tx:any,at:number){let clock=at;const watch=new PilotWatch({maximumIdentities:174,maximumOlderResearch:24,maximumDeep:2,now:()=>clock,record(){}}),id=identity(tx,at);watch.discover({signature:id.signature,feedMint:id.baseMint,receivedAt:id.chainBlockTime*1000});watch.verify(id.signature,{mint:id.baseMint,pool:id.pool,migrationAt:id.chainBlockTime*1000,verifiedAt:at});return watch.export();}
function fixture(config:{at?:number;restoredWatch?:unknown;refuse?:number}={}){
 let at=config.at??actual.blockTime*1000+600000,resolutions=0;const added:string[]=[],states=new Map<string,{mint:string;pool:string;minSlot?:number}>(),records:Array<{kind:string;data:any}>=[],seeds:PilotMigrationSeed[]=[];
 const flow={addCandidate(scope:{mint:string;pool:string;minSlot?:number}){assert.ok(!states.has(scope.mint));states.set(scope.mint,{...scope});added.push(scope.mint);},removeCandidate(mint:string){states.delete(mint);},snapshot(){return null;},notificationLedger(){return [];},requestSupportRefresh(){},requestHeartbeat(){},async service(){return {kind:'idle'};},usage(){return {candidates:states.size,retiring:0,nextServiceAt:at+20000,connected:true,physicalTransportsSettled:true};},async stop(){states.clear();}};
 const rpc={async call(){throw Error('UNEXPECTED_PROVIDER_OR_FINANCIAL_QUOTE');},usage(){return {dispatchWindow:{readyAt:at},waitingOrOperating:false,inFlight:0};},cooldownUntil(){return 0;}};
 const resolve=async(seed:PilotMigrationSeed)=>{resolutions++;seeds.push({...seed});if(resolutions<=(config.refuse??0))return {ok:false as const,reason:'PILOT_MIGRATION_LOOKUP_UNAVAILABLE'};assert.equal(seed.signature,sig(actual));assert.equal(seed.feedMint,identity(actual,at).baseMint);const id=identity(actual,at),read=(commitment:'confirmed'|'finalized')=>({signature:sig(actual),commitment,requestedAt:at,availableAt:at,transaction:structuredClone(actual)}),confirmed=read('confirmed'),finalized=read('finalized');const proof:PilotMigrationProof={source:'direct-confirmed-creation',seed,initialConfirmed:confirmed,history:null,originCandidates:[],originConfirmed:confirmed,originFinalized:finalized,finalizedIdentityMatchesConfirmed:true,currentPoolSupportVerified:false,entryEligibilityVerified:false};return {ok:true as const,identity:id,evidence:'OFFLINE_REDECODED_ACTUAL_CREATION',proof};};
 const runner=new NativeCandidateRunner({rpc:rpc as any,flow:flow as any,record(kind,data){records.push({kind,data:structuredClone(data)});},now:()=>at,maximumDeep:2,restoredWatch:config.restoredWatch,resolve:resolve as any});
 return {runner,added,records,seeds,get now(){return at;},get resolutions(){return resolutions;},advance(ms:number){at+=ms;}};
}

test('fresh WATCH hint reselects an age-expired2–6h identity without widening entry eligibility',async()=>{
 const f=fixture();f.runner.importOrigin(origin(actual,f.now));const mint=identity(actual,f.now).baseMint;f.advance(3*3600000);assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.state,'EXPIRED');
 f.runner.onActivity({mint,at:f.now,evidence:'unverified-pumpapi-activity-hint'});const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.ok(row.olderResearch);assert.equal(row.olderResearch!.activityAt,f.now);assert.equal(row.state,'WATCH');assert.equal(entryAgeEligible(row.migrationAt!,f.now),false);assert.equal(f.runner.status().financialExecutionAuthorized,false);assert.ok(f.records.some(r=>r.kind==='pilot-watch-older-research-selected'&&r.data.entryEligible===false));await f.runner.stop();
});

test('stale WATCH activity cannot select an older cohort or resurrect an expired identity',async()=>{
 const f=fixture();f.runner.importOrigin(origin(actual,f.now));const mint=identity(actual,f.now).baseMint;f.advance(3*3600000);f.runner.onActivity({mint,at:f.now-60001,evidence:'STALE_OFFLINE_WATCH_HINT'});const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.equal(row.state,'EXPIRED');assert.equal(row.olderResearch,undefined);assert.equal(entryAgeEligible(row.migrationAt!,f.now),false);assert.ok(f.records.some(r=>r.kind==='native-older-observation-selection-refused'&&r.data.reason==='PILOT_WATCH_OLDER_ACTIVITY'));await f.runner.stop();
});

test('older re-selection preserves an outstanding technical capacity cause and defer rather than inventing qualification',async()=>{
 const f=fixture();f.runner.importOrigin(origin(actual,f.now));const mint=identity(actual,f.now).baseMint;f.runner.watch.deferCapacity(mint,'OFFLINE_NATIVE_CAPACITY_OBLIGATION',null,f.now);f.advance(3*3600000);assert.equal(f.runner.watch.lookupIdentity(mint,f.now)!.state,'EXPIRED');f.runner.onActivity({mint,at:f.now,evidence:'OFFLINE_FRESH_ACTIVITY_HINT'});const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.ok(row.olderResearch);assert.equal(row.state,'DEFERRED');assert.equal(row.reason,'OFFLINE_NATIVE_CAPACITY_OBLIGATION');assert.equal(row.capacityCoverage!.status,'AWAITING_CAPACITY');assert.ok(row.deferUntil>=f.now+5000);assert.equal(entryAgeEligible(row.migrationAt!,f.now),false);await f.runner.step();assert.equal(f.added.length,0);await f.runner.stop();
});

test('older re-selection never clears an existing explicit defer deadline',async()=>{
 const f=fixture();f.runner.importOrigin(origin(actual,f.now));const mint=identity(actual,f.now).baseMint;f.advance(3*3600000);const until=f.now+90000;f.runner.watch.transition(mint,'DEFERRED','OFFLINE_EXPLICIT_DEFERRAL',f.now,{deferUntil:until});f.runner.onActivity({mint,at:f.now,evidence:'OFFLINE_FRESH_ACTIVITY_HINT'});const row=f.runner.watch.lookupIdentity(mint,f.now)!;assert.ok(row.olderResearch);assert.ok(row.deferUntil>=until);assert.equal(f.runner.watch.next(f.now,new Set()),null);await f.runner.stop();
});

test('oldest WATCH metadata without proof cannot block a ready real origin and retries exact known canonical identity',async()=>{
 const at=actual.blockTime*1000+600000,restored=metadata(actual,at),f=fixture({at,restoredWatch:restored,refuse:1}),missing=identity(actual,at),other=identity(otherActual,at);
 assert.equal(f.runner.status().verificationQueue,1);assert.ok(f.records.some(r=>r.kind==='native-known-origin-proof-queued'&&r.data.signature===missing.signature&&r.data.mint===missing.baseMint&&r.data.deepAdmissionAllowed===false));
 f.runner.importOrigin(origin(otherActual,at,true));await f.runner.step();assert.deepEqual(f.added,[other.baseMint],'missing oldest proof is excluded from runnable allocation, not a head-of-line veto');assert.equal(f.resolutions,1);assert.equal(f.seeds[0]!.signature,missing.signature);assert.equal(f.seeds[0]!.feedMint,missing.baseMint);let row=f.runner.watch.lookupIdentity(missing.baseMint,f.now)!;assert.equal(row.state,'DEFERRED');assert.equal(row.mint,missing.baseMint);assert.equal(row.pool,missing.pool);assert.equal(row.signature,missing.signature);assert.equal(f.runner.status().verificationQueue,1);assert.match(row.reason,/known origin proof unavailable/);
 const retryAt=row.deferUntil;f.advance(retryAt-f.now-1);await f.runner.step();assert.equal(f.resolutions,1);f.advance(1);await f.runner.step();assert.equal(f.resolutions,2);assert.equal(f.runner.status().verificationQueue,0);row=f.runner.watch.lookupIdentity(missing.baseMint,f.now)!;assert.equal(row.mint,missing.baseMint);assert.equal(row.pool,missing.pool);assert.equal(row.migrationAt,missing.chainBlockTime*1000);assert.equal(row.signature,missing.signature);await f.runner.step();assert.deepEqual(new Set(f.added),new Set([other.baseMint,missing.baseMint]));assert.equal(f.runner.status().counters.verifiedOrigins,2);assert.equal(f.runner.status().financialWriterOpened,false);await f.runner.stop();
});
