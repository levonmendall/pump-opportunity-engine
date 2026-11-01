/** Disposable offline registry benchmark. Run with node --import tsx. No network or existing account access. */
import {performance} from 'node:perf_hooks';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MarketRegistry} from '../src/market-registry.ts';
import {PilotWatch} from '../src/pilot-watch.ts';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.ts';
import {legacyDurableSnapshot,legacyServiceableBacklog} from '../test/fixtures/native-watch-reporting-before-repair.ts';
const AT=Date.parse('2026-11-01T21:30:00Z'),dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-report-profile-'));
const registry=new MarketRegistry(join(dir,'registry.sqlite'),{now:()=>AT}),watch=new PilotWatch({registry,maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>AT,record:()=>{}});
try {
 watch.discover({signature:'OFFLINE-base',feedMint:'OFFLINE-base-mint',receivedAt:AT-86400000});watch.verify('OFFLINE-base',{mint:'OFFLINE-base-mint',pool:'OFFLINE-base-pool',migrationAt:AT-600000,verifiedAt:AT-500000});const base=registry.get('OFFLINE-base');
 const start=performance.now();registry.transaction(()=>{for(let i=0;i<60000;i++)registry.put({...base,signature:'OFFLINE-profile-'+i,mint:'OFFLINE-mint-'+i,pool:'OFFLINE-pool-'+i,verifiedAt:i%10===0?AT-500000:null,migrationAt:i%10===0?AT-600000:null,firstSeenAt:AT-86400000+(i%86400)*1000,lastActivityAt:AT-(i%3600)*1000,waitingSince:AT-600000+(i%600000),state:i%8===0?'DEFERRED':'WATCH'});});
 const result={scope:'OFFLINE_SYNTHETIC_DISPOSABLE_REGISTRY',rows:60001,buildMs:performance.now()-start,phases:[],transactionsBefore:registry.health().transactions};
 const measure=(name,fn)=>{const samples=[],cpuSamples=[];for(let i=0;i<4;i++){const began=performance.now(),cpuBegan=process.cpuUsage();fn();const cpu=process.cpuUsage(cpuBegan);samples.push(performance.now()-began);cpuSamples.push((cpu.user+cpu.system)/1000);}result.phases.push({stage:name,cpuSamplesMs:cpuSamples,meanCpuMs:cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length,samplesMs:samples,meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,maxMs:Math.max(...samples)});};
 measure('watch.snapshot-v3.1-before',()=>watch.readOperation(()=>legacyDurableSnapshot.call(watch,AT,'liquidity-resilient-momentum-v3.1')));
 measure('watch.snapshot-v3.1-after',()=>watch.snapshot(AT,'liquidity-resilient-momentum-v3.1'));
 measure('registry.coverageSnapshot',()=>registry.coverageSnapshot(AT));
 measure('watch.serviceableBacklog-before',()=>legacyServiceableBacklog.call(watch,AT,{requireOrigin:false}));
 measure('watch.serviceableBacklog-after',()=>watch.serviceableBacklog(AT,{requireOrigin:false}));
 measure('registry.tokenAgeSummary',()=>registry.tokenAgeSummary(AT));
 result.transactionsAfter=registry.health().transactions;process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{registry.close();rmSync(dir,{recursive:true,force:true});}
