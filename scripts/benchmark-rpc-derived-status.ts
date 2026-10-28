/** Bounded OFFLINE synthetic disk benchmark. No socket, HTTP, account or wallet. */
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {PilotRpc} from '../src/pilot-rpc.js';
const baselineCommit='90625f5',chunks=500,chunkBytes=1024,chunkIntervalMs=9,MIB=1024*1024;
const baselineSource=execFileSync('git',['show',baselineCommit+':src/pilot-rpc.ts']),baselinePath=resolve('src/.rpc-derived-benchmark-baseline-'+process.pid+'.ts');
writeFileSync(baselinePath,baselineSource,{flag:'wx',mode:0o600});
const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
try{
 const Baseline=(await import(pathToFileURL(baselinePath).href)).PilotRpc as typeof PilotRpc;
 async function measure(Ctor:typeof PilotRpc,label:string){
  const directory=mkdtempSync(join(tmpdir(),'poe-derived-bench-')),old=join(directory,'old.json');let at=200000,mono=200000;writeFileSync(old,JSON.stringify({schemaVersion:1,blockedReason:'RPC_HTTP_429',calls:1,bytes:11,lastObservedAt:2000,starts:[1000],pending:[{id:1,unobservedBytes:2*MIB}]}),{mode:0o600});
  const client=new Ctor({directory:join(directory,'run'),runId:'synthetic-benchmark',baselinePaths:[old],priorPhysicalSettled:true,maxResponseBytes:16*MIB,now:()=>at,monotonic:()=>mono,fetcher:(async()=>{throw Error('NETWORK_PROHIBITED');}) as typeof fetch}),chain=createHash('sha256');
  try{
   await client.operateData({transport:'ws-upgrade',method:'upgrade'},async op=>op.completeResponse());const before=client.usage(),path=before.activeChapterPath!,cpu=process.cpuUsage(),began=performance.now();
   for(let i=1;i<=chunks;i++){at+=chunkIntervalMs;mono+=chunkIntervalMs;client.accountControlBytes(chunkBytes);const bytes=readFileSync(path),book=JSON.parse(bytes.toString());assert.equal(book.wsBytes,i*chunkBytes);chain.update(bytes);assert.equal(client.usage().chapterUsage!.wsBytes,i*chunkBytes);}
   const elapsedMs=performance.now()-began,used=process.cpuUsage(cpu),after=client.usage(),authoritativeBookSha256=sha(readFileSync(path));client.close();const final=JSON.parse(readFileSync(join(directory,'run/status.json'),'utf8'));
   assert.equal(final.accountedCumulativeResponseBytes,after.accountedCumulativeResponseBytes);assert.equal(final.uncertainResponseBytes,after.uncertainResponseBytes);assert.equal(final.closed,true);
   return {label,chunks,receivedBytes:chunks*chunkBytes,virtualElapsedMs:chunks*chunkIntervalMs,measuredElapsedMs:elapsedMs,cpuUserUs:used.user,cpuSystemUs:used.system,cpuTotalUs:used.user+used.system,derivedWritesDuringReceipt:after.persistence.attempts-before.persistence.attempts,derivedPersistMsDuringReceipt:after.persistence.totalMs-before.persistence.totalMs,authoritativeWritesDuringReceipt:after.chapterUsage!.persistence.attempts-before.chapterUsage!.persistence.attempts,authoritativePersistMsDuringReceipt:after.chapterUsage!.persistence.totalMs-before.chapterUsage!.persistence.totalMs,perChunkAuthoritativeBookChainSha256:chain.digest('hex'),authoritativeBookSha256,actualNewUnits:after.newUnits,uncertainResponseBytes:after.uncertainResponseBytes,finalAccountedBytes:final.accountedCumulativeResponseBytes,finalStatusMatchesLive:true,derivedStatus:'derivedStatus' in after?after.derivedStatus:null};
  }finally{client.close();rmSync(directory,{recursive:true,force:true});}
 }
 const baseline=await measure(Baseline,'baseline-per-chunk-derived-status'),optimized=await measure(PilotRpc,'coalesced-derived-status');assert.equal(optimized.perChunkAuthoritativeBookChainSha256,baseline.perChunkAuthoritativeBookChainSha256);assert.equal(optimized.authoritativeBookSha256,baseline.authoritativeBookSha256);assert.equal(optimized.authoritativeWritesDuringReceipt,chunks);assert.equal(baseline.authoritativeWritesDuringReceipt,chunks);assert.equal(optimized.actualNewUnits,baseline.actualNewUnits);assert.equal(optimized.uncertainResponseBytes,baseline.uncertainResponseBytes);
 const report={classification:'OFFLINE_SYNTHETIC_CLOUD_FILESYSTEM_MICROBENCHMARK_NOT_EC2_OR_FORWARD_PERFORMANCE',networkRequests:0,financialWriterOpened:false,baselineCommit,baselineSourceSha256:sha(baselineSource),optimizedSourceSha256:sha(readFileSync('src/pilot-rpc.ts')),chunksPerVariant:chunks,totalChunks:2*chunks,chunkBytes,chunkIntervalMs,baseline,optimized,measuredDerivedWriteReduction:1-optimized.derivedWritesDuringReceipt/baseline.derivedWritesDuringReceipt,measuredWallTimeReduction:1-optimized.measuredElapsedMs/baseline.measuredElapsedMs,maximumProcessRssBytes:process.resourceUsage().maxRSS*1024,limitations:['One bounded paired synthetic sample; JIT, shared host load and filesystem cache can affect timing.','Cloud filesystem result; EC2 benefit remains unmeasured.','Every authoritative chunk write and exact per-chunk book contents are unchanged; no API/request/traffic savings.','Virtual9ms arrivals exercise the policy independently of filesystem speed; event-loop stalls can delay a timer and are not represented as timely live protection.','Final projection flush and chapter-based abrupt-exit recovery are verified separately by focused tests.']};
 const output=process.argv[2];if(output)writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{unlinkSync(baselinePath);}
