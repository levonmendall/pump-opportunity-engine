/** SYNTHETIC isolated memory benchmark, not a source throughput claim. */
import {createHash} from 'node:crypto';
import {NativeTransactionRetention} from '../../src/native-transaction-retention.js';
const mode=process.argv[2];if(!['baseline-full16384','naive-full32768','compact-retired16384-active16384'].includes(mode)||!global.gc)throw Error('BENCHMARK_MODE_OR_GC');
const mints=Array.from({length:6},(_,i)=>createHash('sha256').update('scope'+i).digest('hex').slice(0,44));
const id=i=>createHash('sha512').update('synthetic-signature'+i).digest('base64url');
const row=i=>({slot:460000000+i,hash:createHash('sha256').update('synthetic-raw'+i).digest('hex'),at:1000+i,mints:[mints[i<16384?0:1]],scopes:[...mints],protocolFramesObserved:i%3});
global.gc();const before=process.memoryUsage(),began=performance.now(),cpu=process.cpuUsage();
const count=mode==='baseline-full16384'?16384:32768,c=mode.startsWith('compact')?new NativeTransactionRetention(16384):new Map();
let maximumRssBytes=before.rss;
for(let i=0;i<count;i++){if(i===16384&&mode.startsWith('compact'))c.releaseScope(mints[0]);c.set(id(i),row(i));if(i%256===0)maximumRssBytes=Math.max(maximumRssBytes,process.memoryUsage().rss);}
global.gc();const after=process.memoryUsage(),usedCpu=process.cpuUsage(cpu);maximumRssBytes=Math.max(maximumRssBytes,after.rss);const result={classification:'SYNTHETIC_MEMORY_ONLY',mode,count,elapsedMs:performance.now()-began,cpuMicros:usedCpu.user+usedCpu.system,before,after,deltas:Object.fromEntries(Object.keys(before).map(k=>[k,after[k]-before[k]])),maximumRssBytes,usage:c instanceof Map?{records:c.size}:c.usage()};
// Ensure the entire live collection remains a GC root until after measurement.
if(c instanceof Map&&c.size!==count)throw Error('LOST_ROWS');if(!(c instanceof Map)&&c.usage().records!==count)throw Error('LOST_ROWS');console.log(JSON.stringify(result));
