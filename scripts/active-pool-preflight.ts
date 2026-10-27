/** Public read-only activity selection. No feed, wallet, account or transaction simulation. */
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {ReadOnlyRpc} from '../src/network.js';
import {readSourceVersion} from '../src/source-version.js';

const root='evidence/free-data-20261027';
if(process.argv[2]!=='--run-public'){console.log('No network. Use --run-public for at most5 public RPC reads/30s; no PumpApi connection.');}
else{
  const size=(p:string):number=>readdirSync(p).reduce((n,f)=>{const x=p+'/'+f,s=statSync(x);return n+(s.isDirectory()?size(x):s.size);},0);
  if(size(root)>30*1024*1024)throw Error('EVIDENCE_RESERVATION_UNAVAILABLE');
  const proofPath='evidence/integration-proof-2026-10-26T19-57-35.882Z.json',proof=JSON.parse(readFileSync(proofPath,'utf8'));
  if(!proof.origin.instructionVerified||!proof.origin.creationCpiVerified||proof.origin.commitment!=='confirmed')throw Error('CONFIRMED_ORIGIN_REQUIRED');
  const selected={mint:proof.quote.mint,pool:proof.quote.pool,proof:proofPath,selection:'Highest effective SOL reserve among retained independently verified distinct canonical pools; recent activity checked before any stream. This is transport selection, outside entry age, not unbiased strategy evidence.'};
  const began=performance.now(),at=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
  let requests=0;const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',(async(url,init)=>{if(++requests>5||rpc.bytes>6_000_000)throw Error('PREFLIGHT_REQUEST_OR_BYTE_CAP');return fetch(url,init);}) as typeof fetch,{profile:'runtime',maxCallsPerMinute:5,maxInFlight:1,timeoutMs:8000});
  let signatures:any[]=[],transactions:any[]=[],failure:string|null=null;
  try{
    const result=await rpc.call<any[]>('getSignaturesForAddress',[selected.pool,{commitment:'confirmed',limit:20}],controller.signal);
    if(!Array.isArray(result)||result.length>20)throw Error('INVALID_SIGNATURE_RESPONSE');signatures=result;
    const recent=signatures.filter(r=>r.err===null&&Number.isSafeInteger(r.blockTime)&&r.blockTime*1000>=at-10*60_000&&r.blockTime*1000<=at+2000).slice(0,4);
    for(const r of recent){const receivedAt=Date.now(),value=await rpc.call<any>('getTransaction',[r.signature,{commitment:'confirmed',encoding:'json',maxSupportedTransactionVersion:0}],controller.signal);transactions.push({signature:r.signature,requestedAt:receivedAt,availableAt:Date.now(),value});}
  }catch(e){failure=e instanceof Error&&/^RPC_/.test(e.message)?e.message:'ACTIVITY_PREFLIGHT_UNAVAILABLE';}
  finally{clearTimeout(timer);}
  const recent=signatures.filter(r=>r.err===null&&Number.isSafeInteger(r.blockTime)&&r.blockTime*1000>=at-10*60_000&&r.blockTime*1000<=at+2000);
  const record={schemaVersion:1,classification:'READ_ONLY_ACTIVE_POOL_PREFLIGHT_NOT_STRATEGY_OR_FEED_COVERAGE',recordedAt:new Date().toISOString(),sourceVersion:readSourceVersion(),scriptSha256:createHash('sha256').update(readFileSync('scripts/active-pool-preflight.ts')).digest('hex'),selected,queryAt:at,recentWindowMs:10*60_000,signatures,successfulRecentAddressTransactions:recent.length,transactions,independentlyDecodedSwapCount:null,activitySelectionVerified:false,apiDataFeeUsd:'0',networkTransferAllocationVerified:false,pumpApiConnections:0,paidProviderRequests:0,credentialsLoaded:false,productionChanged:false,financialAccountCreated:false,limits:{reads:5,bytes:8_000_000,wallMs:30_000,retainedBytes:2_000_000},rpc:rpc.usage(),actualWallMs:performance.now()-began,failure,limitations:['Address activity includes nonswaps; instruction/event decoder must verify swaps before pool is considered active.','Retained pool is outside strategy migration age and selected for transport/pricing only.','A later capture must independently recheck current activity; this is not permission to stream or proof of ongoing future activity.']};
  const body=JSON.stringify(record,null,2)+'\n';if(Buffer.byteLength(body)>2_000_000)throw Error('PREFLIGHT_EVIDENCE_CAP');
  const path=root+'/active-preflight-'+new Date().toISOString().replaceAll(':','-')+'.json';writeFileSync(path,body,{flag:'wx',mode:0o600});console.log(JSON.stringify({path,calls:rpc.calls,bytes:rpc.bytes,recentAddressTransactions:recent.length,transactionsFetched:transactions.length,failure}));if(failure)process.exitCode=1;
}
