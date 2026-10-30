/** Bounded public-read comparison ONLY. No account, ledger, wallet or signer. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {ReadOnlyRpc} from '../src/network.js';
import {Recorder} from '../src/recorder.js';
import {quotePositionSell,quotePositionsSell} from '../src/pool.js';
import {readSourceVersion} from '../src/source-version.js';

const DIRECTORY='evidence/free-data-20261027',MAX_BYTES=8*1024*1024,MAX_CALLS=9,MAX_RSS=256*1024*1024;
const directoryBytes=(path:string):number=>readdirSync(path).reduce((n,f)=>{const p=path+'/'+f,s=statSync(p);return n+(s.isDirectory()?directoryBytes(p):s.size);},0);
if(directoryBytes(DIRECTORY)>28*1024*1024)throw Error('aggregate evidence reservation unavailable');
const start=performance.now(),startedAt=new Date().toISOString(),id=startedAt.replaceAll(':','-'),prefix=DIRECTORY+'/batch-live-'+id;
if(existsSync(prefix+'.json')||existsSync(prefix+'.ndjson'))throw Error('completed evidence cannot be overwritten');
const rec=new Recorder(prefix+'.ndjson',3_000_000),controller=new AbortController();
const cpu=process.cpuUsage();let requests=0,peakRss=process.memoryUsage().rss;const methods:Record<string,number>={};
const deadline=setTimeout(()=>controller.abort(),30_000),watch=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);if(peakRss>MAX_RSS)controller.abort();},100);
const rpc=new ReadOnlyRpc('https://api.mainnet.solana.com',(async(url,init)=>{if(++requests>MAX_CALLS||rpc.bytes>MAX_BYTES-2_000_000)throw Error('assignment public RPC budget exhausted');const method=JSON.parse(String(init?.body)).method;methods[method]=(methods[method]??0)+1;return fetch(url,init);}) as typeof fetch,{profile:'runtime',maxCallsPerMinute:9,maxInFlight:1,timeoutMs:10_000});
const selected=[
  {proof:'evidence/free-data-20261027/discovery/evidence/integration-proof-2026-10-27T01-15-44.429Z.json',selection:'first successful next observed migration; supported real pool'},
  {proof:'evidence/integration-proof-2026-10-26T23-32-41.255Z.json',selection:'previously captured supported pool; now outside candidate age, hypothetical held pricing only'}
].map(x=>{const p=JSON.parse(readFileSync(x.proof,'utf8'));if(!p.origin.instructionVerified||!p.origin.creationCpiVerified||p.origin.commitment!=='confirmed')throw Error('retained verified migration required');return {...x,mint:new PublicKey(p.quote.mint),fullBaseUnits:BigInt(p.quote.buy.outputBaseUnits),minSlot:p.origin.slot};});
const rounds:any[]=[],captured:any[]=[];let failure:string|null=null;
const recorder={record(kind:string,data:any){rec.record(kind,data);if(kind==='pools-state')captured.push(structuredClone(data));}};
try{
  for(let round=0;round<3;round++){
    if(controller.signal.aborted)throw Error('bounded observation aborted');const begin=performance.now(),before=rpc.calls;
    const result=await quotePositionsSell(rpc,selected,recorder,controller.signal);peakRss=Math.max(peakRss,process.memoryUsage().rss);
    const usableAt=Date.now();rounds.push({round,availableAt:usableAt,durationMs:performance.now()-begin,calls:rpc.calls-before,context:result.context,unavailable:result.unavailable,quotes:Object.fromEntries(Object.entries(result.quotes).map(([mint,q])=>[mint,{sell:q.sell,slot:q.slot,tokenProgram:q.tokenProgram,mintExtensions:q.mintExtensions,feeBps:q.feeBps,rawQuoteReserve:q.rawQuoteReserve,virtualQuoteReserves:q.virtualQuoteReserves,effectiveQuoteReserve:q.effectiveQuoteReserve,requestedAt:q.requestedAt,receivedAt:q.receivedAt,validatedAt:q.validatedAt,sourceAgeAtAvailabilityMs:usableAt-Date.parse(q.receivedAt)}]))});
    // Reproduce the established single-pool helper against these exact captured
    // dependencies. No new HTTP call or fabricated cross-time account mixture.
    const batch=captured.at(-1);if(!batch)throw Error('missing retained coherent batch');
    const bytes=new Map<string,any>(batch.addresses.map((address:string,i:number)=>[address,batch.value[i]]));
    const realNow=Date.now;Date.now=()=>usableAt;
    try{for(const request of selected){const minted=request.mint.toBase58();if(!result.quotes[minted])continue;
      const replay=new ReadOnlyRpc('https://fixture.invalid',(async(_url,init)=>{const b=JSON.parse(String(init?.body));let value;if(b.method==='getMultipleAccounts')value={context:batch.context,value:b.params[0].map((address:string)=>bytes.get(address)??null)};else if(b.method==='getBlockTime')value=result.context!.marketBlockTime;else throw Error('unexpected replay RPC');return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result:value}));}) as typeof fetch);
      const baseline=await quotePositionSell(replay,request.mint,request.fullBaseUnits,{record(){}},request.minSlot);const current=result.quotes[minted]!;
      assert.deepEqual(current.sell,baseline.sell);assert.deepEqual(current.feeBps,baseline.feeBps);assert.equal(current.effectiveQuoteReserve,baseline.effectiveQuoteReserve);assert.equal(replay.calls,3);
    }}finally{Date.now=realNow;}
    rounds.at(-1).sameCapturedBytesSingleHelperParity=true;
  }
}catch(error){failure=error instanceof Error?/^(RPC_|POSITION_|POOL_|REGRESSING_)/.test(error.message)?error.message:'bounded probe or same-byte comparison unavailable':'bounded probe unavailable';}
finally{clearTimeout(deadline);clearInterval(watch);rec.close();}
const used=process.cpuUsage(cpu),summary={schemaVersion:1,classification:'ISOLATED_HYPOTHETICAL_HOLDING_PUBLIC_RPC_BATCH_TEST',startedAt,completedAt:new Date().toISOString(),actualWallMs:performance.now()-start,sourceVersion:readSourceVersion(),sourceHashes:Object.fromEntries(['src/pool.ts','src/network.ts','src/source-version.ts','scripts/batched-pricing-probe.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),productionChanged:false,financialAccountCreated:false,paperEntriesEnabled:false,naturalPaperTrades:0,liveTradingDisabled:true,providerCredentialsLoaded:false,apiDataChargeUsd:'0',networkTransferAllocationVerified:false,hardLimits:{calls:MAX_CALLS,totalResponseBytes:MAX_BYTES,singleResponseBytes:2_000_000,wallMs:30_000,rssBytes:MAX_RSS,recordBytes:3_000_000},cohort:selected.map(s=>({mint:s.mint.toBase58(),hypotheticalBaseUnits:s.fullBaseUnits.toString(),migrationSlot:s.minSlot,proof:s.proof,selection:s.selection})),rpc:rpc.usage(),callsByMethod:methods,durationsMs:rpc.durationsMs,rounds,failure,resources:{cpuMs:(used.user+used.system)/1000,peakSampledRssBytes:Math.max(peakRss,process.memoryUsage().rss),kernelMaxRssBytes:process.resourceUsage().maxRSS*1024,currentRssBytes:process.memoryUsage().rss},limitations:['Three immediate rounds are a small current quote probe, not continuous freshness/position-protection acceptance.','Quantities are hypothetical retained integration sizes, not new accounts, balances, positions, trades or performance.','Two pool dependency sets share one actual confirmed batch context; USD is absent and no cross-source atomicity is asserted.','The established helper is compared with identical captured bytes offline; no provider completeness is implied.','No account subscriptions or flow reconstruction are measured by this probe.']};
const encoded=JSON.stringify(summary,null,2)+'\n';if(Buffer.byteLength(encoded)>500_000)throw Error('summary capacity');writeFileSync(prefix+'.json',encoded,{flag:'wx',mode:0o600});console.log(JSON.stringify({summary:prefix+'.json',records:prefix+'.ndjson',calls:rpc.calls,bytes:rpc.bytes,rounds:rounds.length,failure}));if(failure)process.exitCode=1;
