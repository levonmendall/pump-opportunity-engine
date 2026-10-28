/** Synthetic offline durability tests; no provider, financial ledger or wallet. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {PilotRpc} from '../src/pilot-rpc.js';
import {readResearchBaseline} from '../src/research-baseline.js';
const MIB=1024*1024,pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'poe-rpc-derived-')),old=join(directory,'old.json'),run=join(directory,'run');let now=200000,mono=200000;
 writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:11,lastObservedAt:2000,starts:[1000],pending:[{id:1,unobservedBytes:2*MIB}]}),{mode:0o600});const original=readFileSync(old),records:Array<{kind:string;data:any}>=[];
 const client=new PilotRpc({directory:run,runId:'derived-test',baselinePaths:[old],priorPhysicalSettled:true,maxResponseBytes:16*MIB,now:()=>now,monotonic:()=>mono,sleep:async ms=>{now+=ms;mono+=ms;},fetcher:(async()=>{throw Error('NETWORK_PROHIBITED');}) as typeof fetch,record:(kind,data)=>records.push({kind,data})});
 return {client,directory,run,old,original,records,advance(ms:number){now+=ms;mono+=ms;},status:()=>JSON.parse(readFileSync(join(run,'status.json'),'utf8')),book:()=>JSON.parse(readFileSync(client.usage().activeChapterPath!,'utf8')),open:()=>client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse()),close(){client.close();assert.deepEqual(readFileSync(old),original);rmSync(directory,{recursive:true,force:true});}};
}

test('passive bursts coalesce only derived status while every authoritative byte charge is already durable',async()=>{
 const f=fixture();try{await f.open();const before=f.client.usage(),fileBefore=f.status();for(let i=1;i<=100;i++){f.client.accountControlBytes(1024);assert.equal(f.book().wsBytes,i*1024,'returning from each charge requires its durable authoritative book');}const live=f.client.usage();assert.equal(live.chapterUsage!.wsBytes,102400);assert.equal(live.chapterUsage!.persistence.attempts-before.chapterUsage!.persistence.attempts,100);assert.equal(live.persistence.attempts,before.persistence.attempts);assert.equal(live.derivedStatus.coalescedPassiveReceipts,100);assert.equal(live.derivedStatus.dirty,true);assert.equal(f.status().chapterUsage.wsBytes,fileBefore.chapterUsage.wsBytes);assert.equal(f.status().projectionGeneratedAt,fileBefore.projectionGeneratedAt,'no heartbeat relabels stale derived bytes fresh');assert.equal(live.uncertainResponseBytes,before.uncertainResponseBytes);f.client.close();const final=f.status();assert.equal(final.closed,true);assert.equal(final.cumulativeUnits,2);assert.equal(final.chapterPaths.length,2);assert.equal(final.derivedStatus.dirty,false);assert.equal(final.derivedStatus.coalescedPassiveReceipts,100);assert.equal(final.accountedCumulativeResponseBytes,live.accountedCumulativeResponseBytes);assert.equal(final.uncertainResponseBytes,live.uncertainResponseBytes);}finally{f.close();}
});

test('a silent tail flushes after one scheduled second without another receipt and close cancels future writes',async()=>{
 const f=fixture();try{await f.open();f.client.accountControlBytes(37);const before=f.client.usage().persistence.attempts;await pause(1150);assert.equal(f.status().chapterUsage.wsBytes,37);assert.equal(f.client.usage().derivedStatus.timerFlushes,1);assert.equal(f.client.usage().derivedStatus.dirty,false);assert.equal(f.client.usage().persistence.attempts,before+1);f.client.accountControlBytes(5);f.client.close();const writes=f.client.usage().persistence.attempts;await pause(1100);assert.equal(f.client.usage().persistence.attempts,writes);assert.equal(f.status().accountedCumulativeResponseBytes,11+42+2*MIB);assert.equal(f.status().derivedStatus.dirty,false);}finally{f.close();}
});

test('operation completion and cooldown changes synchronously flush the latest derived projection',async()=>{
 const f=fixture();try{await f.client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>{f.client.accountControlBytes(41);assert.equal(f.client.usage().derivedStatus.dirty,true);op.completeResponse();});assert.equal(f.status().chapterUsage.wsBytes,41);assert.equal(f.status().derivedStatus.dirty,false);assert.equal(f.status().inFlight,0);f.client.accountControlBytes(13);const until=f.client.noteThrottle('10');assert.equal(f.status().chapterUsage.wsBytes,54);assert.equal(f.status().controlCooldownUntil,until);assert.equal(f.status().derivedStatus.dirty,false);assert.equal(f.client.usage().derivedStatus.timerFlushes,0);}finally{f.close();}
});

test('derived timer write failure is observable, stops admission, and cannot erase already durable receipt',async()=>{
 const f=fixture(),pending=join(f.run,'status.json.pending');try{await f.open();f.client.accountControlBytes(61);mkdirSync(pending);await pause(1150);assert.equal(f.book().wsBytes,61);assert.equal(f.client.usage().fatal,'STORAGE_UNAVAILABLE');assert.equal(f.client.usage().derivedStatus.flushFailures,1);assert.equal(f.client.usage().derivedStatus.dirty,true);assert.equal(f.client.available(),false);assert.ok(f.records.some(r=>r.kind==='pilot-derived-status-flush-unavailable'&&r.data.automaticRetry===false));assert.equal(f.client.usage().derivedStatus.timerFlushes,1);rmSync(pending,{recursive:true});f.client.close();assert.equal(f.status().closed,true);assert.equal(f.status().fatal,'STORAGE_UNAVAILABLE');assert.equal(f.status().derivedStatus.flushFailures,1);}finally{rmSync(pending,{force:true,recursive:true});f.close();}
});

test('abrupt process exit before derived flush retains exact bytes and uncertainty for chapter-based recovery',async()=>{
 const f=fixture();try{f.client.close();const childRun=join(f.directory,'crashed'),input={directory:childRun,runId:'crashed-derived',baselinePaths:[f.old],priorPhysicalSettled:true as const,maxResponseBytes:16*MIB,now:()=>200000,monotonic:()=>200000};
  const code=`import {PilotRpc} from ${JSON.stringify(pathToFileURL(resolve('src/pilot-rpc.ts')).href)};const c=new PilotRpc({directory:${JSON.stringify(childRun)},runId:'crashed-derived',baselinePaths:[${JSON.stringify(f.old)}],priorPhysicalSettled:true,maxResponseBytes:${16*MIB},now:()=>200000,monotonic:()=>200000});await c.operateData({transport:'ws-upgrade',method:'upgrade'},async o=>o.completeResponse());c.accountControlBytes(77);process.stdout.write(JSON.stringify({path:c.usage().activeChapterPath,uncertain:c.usage().uncertainResponseBytes}));process.exit(0);`;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{encoding:'utf8',timeout:5000,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout),crashed=JSON.parse(readFileSync(result.path,'utf8')),stale=JSON.parse(readFileSync(join(childRun,'status.json'),'utf8'));assert.equal(crashed.wsBytes,77);assert.equal(stale.chapterUsage.wsBytes,0);assert.equal(stale.derivedStatus.dirty,false,'the stale file truthfully describes its older generated projection, not unseen future receipt');const recovery=readResearchBaseline({paths:[f.old,result.path],now:201000,physicalSettled:true,allowCumulativeBeyondLegacy:true});assert.equal(recovery.baseline.bytes,11+77+2*MIB);assert.equal(recovery.uncertainResponseBytes,result.uncertain);const resumed=new PilotRpc({...input,directory:join(f.directory,'resumed'),runId:'resumed-derived',baselinePaths:[f.old,result.path]});try{assert.equal(resumed.usage().accountedCumulativeResponseBytes,11+77+2*MIB);assert.equal(resumed.usage().uncertainResponseBytes,result.uncertain);assert.equal(resumed.usage().newUnits,0);}finally{resumed.close();}
 }finally{f.close();}
});
