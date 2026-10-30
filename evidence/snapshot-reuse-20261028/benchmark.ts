/** Synthetic same-call feature-projection microbenchmark, NOT a runtime replay. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {FlowWindow,type FlowFeatures} from '../../src/strategy.js';
const at=1793226900000,iterations=3000,rounds=7;
const cases=[{name:'quiet',trades:0,buyers:0},{name:'audited-p95-like',trades:260,buyers:48},{name:'audited-maximum-like',trades:513,buyers:199},{name:'synthetic-stress-only',trades:3000,buyers:1500}];
const four=(w:FlowWindow)=>{const f=w.features(at);return {features:f,warm:w.features(at).sufficientlyObserved,start:w.features(at).windowStartAt,end:w.features(at).windowEndAt};};
const one=(w:FlowWindow)=>{const f=w.features(at);return {features:f,warm:f.sufficientlyObserved,start:f.windowStartAt,end:f.windowEndAt};};
let checksum=0;
function measure(w:FlowWindow,fn:typeof four){const t=performance.now(),cpu=process.cpuUsage();for(let i=0;i<iterations;i++){const v=fn(w);checksum+=v.features.tradeCount+Number(v.warm)+v.end-v.start;}const used=process.cpuUsage(cpu);return {wallMs:performance.now()-t,cpuMicros:used.user+used.system};}
const median=(ns:number[])=>[...ns].sort((a,b)=>a-b)[Math.floor(ns.length/2)]!;
const results=[];
for(const scenario of cases){
 const w=new FlowWindow('SYNTHETIC_BENCH',at-70000);
 for(let i=0;i<scenario.trades;i++)w.ingest({identity:{signature:'SYNTHETIC_BENCH_'+i,instructionIndex:0,eventIndex:0},mint:'SYNTHETIC_BENCH',wallet:'synthetic-buyer-'+i%scenario.buyers,side:'buy',quoteLamports:String(1000000+i),tokenUnits:String(100000+i),receivedAt:at-60000+Math.floor(i*59000/Math.max(1,scenario.trades)),commitment:'confirmed',slot:i+1});
 assert.deepEqual(four(w),one(w));assert.equal(one(w).features.tradeCount,scenario.trades);assert.equal(one(w).features.distinctBuyerWallets,scenario.buyers);
 for(let i=0;i<300;i++){four(w);one(w);}const paired=[];
 for(let i=0;i<rounds;i++){let before,after;if(i%2===0){before=measure(w,four);after=measure(w,one);}else{after=measure(w,one);before=measure(w,four);}paired.push({round:i+1,order:i%2===0?'four-then-one':'one-then-four',before,after});}
 const beforeCpu=median(paired.map(v=>v.before.cpuMicros)),afterCpu=median(paired.map(v=>v.after.cpuMicros));results.push({...scenario,iterationsPerRound:iterations,rounds,features:one(w).features,medianBeforeCpuMicros:beforeCpu,medianAfterCpuMicros:afterCpu,cpuReductionFraction:1-afterCpu/beforeCpu,medianBeforeWallMs:median(paired.map(v=>v.before.wallMs)),medianAfterWallMs:median(paired.map(v=>v.after.wallMs)),paired});
}
const paths=['src/pilot-native-flow.ts','src/strategy.ts','test/pilot-native-flow.test.ts'];const sourceHashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const report={measuredAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes,kind:'synthetic-same-call-feature-projection-microbenchmark',naturalAuditedControlDistribution:{population:'32 retained audited assessment projections; excludes unavailable/unusable/unassessed windows',tradeCount:{median:0,p95:260,maximum:513},distinctBuyers:{median:0,p95:48,maximum:199},meaning:'Synthetic combinations approximate observed bounds; not replay of original token, amount or wallet evidence.'},results,checksum,limitations:['Times only repeated feature projections and equal small return objects, not full snapshot or runtime.','FlowWindow already incrementally maintains its sixty-second aggregates; ten-second strategy cadence is unchanged.','No provider/RPC/storage/trading/financial operation.','CPU microbenchmark savings cannot establish whole-process savings or new live capacity.','Synthetic stress-only scenario is not a claimed observed live workload.']};
writeFileSync(process.argv[2]??'evidence/snapshot-reuse-20261028/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({sourceCommit:report.sourceCommit,results:results.map(({name,medianBeforeCpuMicros,medianAfterCpuMicros,cpuReductionFraction})=>({name,medianBeforeCpuMicros,medianAfterCpuMicros,cpuReductionFraction})),checksum}));
