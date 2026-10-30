/** One bounded activity-biased instruction sample; not an indexer or feed. */
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ReadOnlyRpc} from '../src/network.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import {readSourceVersion} from '../src/source-version.js';
if(process.argv[2]!=='--run-public'){console.log('No network. --run-public permits one12-signature PumpSwap page and at most3transactions,4publicreads total.');}
else{
  const root='evidence/free-data-20261027',size=(p:string):number=>readdirSync(p).reduce((n,f)=>{const x=p+'/'+f,s=statSync(x);return n+(s.isDirectory()?size(x):s.size);},0);
  if(size(root)>30*1024*1024)throw Error('EVIDENCE_RESERVATION_UNAVAILABLE');
  const started=performance.now(),queryAt=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);let calls=0;
  const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',(async(url,init)=>{if(++calls>4||rpc.bytes>6_000_000)throw Error('PUBLIC_SAMPLE_BUDGET');return fetch(url,init);}) as typeof fetch,{profile:'runtime',maxCallsPerMinute:4,maxInFlight:1,timeoutMs:8000});
  let rows:any[]=[],transactions:any[]=[],failure:string|null=null;
  try{
    const result=await rpc.call<any[]>('getSignaturesForAddress',[PUMP_AMM_PROGRAM_ID.toBase58(),{commitment:'confirmed',limit:12}],controller.signal);
    if(!Array.isArray(result)||result.length>12)throw Error('INVALID_PROGRAM_HISTORY');rows=result;
    for(const r of rows.filter(r=>r.err===null&&Number.isSafeInteger(r.blockTime)&&r.blockTime*1000>=queryAt-60_000&&r.blockTime*1000<=queryAt+2000).slice(0,3)){
      const requestedAt=Date.now(),value=await rpc.call<any>('getTransaction',[r.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:1}],controller.signal);
      transactions.push({signature:r.signature,requestedAt,availableAt:Date.now(),value});
    }
  }catch(e){failure=e instanceof Error&&/^RPC_/.test(e.message)?e.message:'PUBLIC_ACTIVITY_SAMPLE_UNAVAILABLE';}
  finally{clearTimeout(timer);}
  const record={schemaVersion:1,classification:'ACTIVITY_BIASED_BOUNDED_CONFIRMED_TRANSACTION_SAMPLE_NOT_FEED_COVERAGE',recordedAt:new Date().toISOString(),sourceVersion:readSourceVersion(),scriptSha256:createHash('sha256').update(readFileSync('scripts/public-activity-sample.ts')).digest('hex'),selection:'First three successful signatures no older than60s from one latest12-signature PumpSwap-program page; no pagination/retry or broad archive. Not strategy performance or unbiased opportunity selection.',program:PUMP_AMM_PROGRAM_ID.toBase58(),queryAt,rows,transactions,limits:{calls:4,responseBytes:8_000_000,retainedBytes:2_000_000,wallMs:30_000},rpc:rpc.usage(),actualWallMs:performance.now()-started,failure,pumpApiConnections:0,credentialsLoaded:false,apiDataFeesUsd:'0.00',networkTransferAllocationVerified:false,productionChanged:false,limitations:['Program mentions are not necessarily swaps or supported canonical pools. Decode and validate before admitting a pool.','Future stream must independently recheck activity; these historical receipts cannot appear early in its decisions.']};
  const body=JSON.stringify(record,null,2)+'\n';if(Buffer.byteLength(body)>2_000_000)throw Error('PUBLIC_SAMPLE_EVIDENCE_CAP');
  const path=root+'/public-activity-'+new Date().toISOString().replaceAll(':','-')+'.json';writeFileSync(path,body,{flag:'wx',mode:0o600});console.log(JSON.stringify({path,calls:rpc.calls,bytes:rpc.bytes,transactions:transactions.length,failure}));if(failure)process.exitCode=1;
}
