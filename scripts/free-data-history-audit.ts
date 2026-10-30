/** Bounded public history audit after a closed research window; never replays it into strategy. */
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ReadOnlyRpc} from '../src/network.js';
import {readSourceVersion} from '../src/source-version.js';
const root='evidence/free-data-20261027';
const disk=(p:string):number=>readdirSync(p).reduce((n,f)=>{const x=p+'/'+f,s=statSync(x);return n+(s.isDirectory()?disk(x):s.size);},0);
if(disk(root)>28*1024*1024)throw Error('EVIDENCE_RESERVATION_UNAVAILABLE');
const source=JSON.parse(readFileSync(root+'/pumpapi-results.json','utf8'));
const windows=source.runs.map((r:any)=>({stage:r.stage,start:Date.parse(r.openedAt),end:Date.parse(r.stoppedAt)}));
if(windows.length!==2||windows.some((w:any)=>!Number.isSafeInteger(w.start)||w.end<w.start))throw Error('CLOSED_WINDOWS_REQUIRED');
const earliest=Math.floor(Math.min(...windows.map((w:any)=>w.start))/1000)-2;
const started=performance.now(),controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),30_000);
let attempts=0;
const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',(async(url,init)=>{if(++attempts>6||rpc.bytes>4_000_000)throw Error('HISTORY_BUDGET_EXHAUSTED');return fetch(url,init);}) as typeof fetch,{profile:'runtime',maxCallsPerMinute:6,maxInFlight:1,timeoutMs:8000});
const pools=[
  {mint:'CRpqtPYyBckKTwgrixiPBYQsi6YESBxA8LMJ5p3fpump',pool:'oT9d7guo6As8KqNQsBJKm62Rkzqa6ZA8XmAhcFrLVZz'},
  {mint:'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump',pool:'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD'}
];
const histories:any[]=[],transactions:any[]=[];let failure:string|null=null;
try{
  for(const p of pools){
    const receivedAt=Date.now(),rows=await rpc.call<any[]>('getSignaturesForAddress',[p.pool,{commitment:'confirmed',limit:20}],controller.signal);
    if(!Array.isArray(rows)||rows.length>20)throw Error('INVALID_HISTORY');
    const safe=rows.map(r=>({signature:r.signature,slot:r.slot,err:r.err,blockTime:r.blockTime,confirmationStatus:r.confirmationStatus}));
    const boundedBeforeWindow=safe.length<20||safe.some(r=>Number.isSafeInteger(r.blockTime)&&r.blockTime<earliest);
    const nullTimes=safe.filter(r=>r.blockTime===null).length;
    const matched=safe.filter(r=>Number.isSafeInteger(r.blockTime)&&windows.some((w:any)=>r.blockTime*1000>=w.start-2000&&r.blockTime*1000<=w.end+2000));
    histories.push({...p,queriedAt:receivedAt,availableAt:Date.now(),limit:20,boundedBeforeWindow,nullBlockTimes:nullTimes,rows:safe,possibleWindowTransactions:matched});
  }
  for(const h of histories)for(const row of h.possibleWindowTransactions){
    if(attempts>=6)break;
    const transaction=await rpc.call<any>('getTransaction',[row.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:0}],controller.signal);
    transactions.push({pool:h.pool,signature:row.signature,availableAt:Date.now(),transaction});
  }
}catch(e){failure=e instanceof Error&&/^RPC_/.test(e.message)?e.message:'HISTORY_AUDIT_UNAVAILABLE';}
finally{clearTimeout(deadline);}
const result={schemaVersion:1,classification:'LATER_BOUNDED_PUBLIC_HISTORY_AUDIT_NOT_STRATEGY_REPLAY',recordedAt:new Date().toISOString(),sourceVersion:readSourceVersion(),scriptSha256:createHash('sha256').update(readFileSync('scripts/free-data-history-audit.ts')).digest('hex'),windows,boundaryToleranceMs:2000,histories,transactions,failure,rpc:rpc.usage(),actualWallMs:performance.now()-started,limits:{calls:6,bytes:6_000_000,wallMs:30_000,perPoolSignatures:20},paidDataRequests:0,credentialsLoaded:false,productionChanged:false,limitations:['RPC history is a bounded later confirmed view, not independent full-chain indexing or proof of provider global coverage.','Address signatures include nonswap activity; each candidate transaction requires instruction-level classification.','Second-level chain timestamps do not establish precise source latency; ±2s boundary candidates are retained.','A truncated/null-time/failed history leaves completeness unknown. No historical information is backdated into original strategy windows.']};
const body=JSON.stringify(result,null,2)+'\n';if(Buffer.byteLength(body)>3_000_000)throw Error('AUDIT_EVIDENCE_CAP');
const path=root+'/history-audit-'+new Date().toISOString().replaceAll(':','-')+'.json';writeFileSync(path,body,{flag:'wx',mode:0o600});
console.log(JSON.stringify({path,calls:rpc.calls,bytes:rpc.bytes,failure,covered:histories.map(h=>({pool:h.pool,boundedBeforeWindow:h.boundedBeforeWindow,nullBlockTimes:h.nullBlockTimes,possibleWindowTransactions:h.possibleWindowTransactions.length})),transactions:transactions.length}));
if(failure)process.exitCode=1;
