import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {PublicKey} from '@solana/web3.js';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {readSourceVersion} from './source-version.js';
import {ReadOnlyRpc,dataMessage} from './network.js';
import {Recorder,json} from './recorder.js';
import {verifyMigration,quotePool} from './pool.js';
import {bondingCurvePda} from './sdk.js';

mkdirSync('evidence',{recursive:true});
const runId=new Date().toISOString().replaceAll(':','-');
const recorder=new Recorder(`evidence/integration-${runId}.ndjson`);
const rpc=new ReadOnlyRpc(process.env.POE_RPC_URL??undefined);
const start=performance.now();let proved=false;
const MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const sourceVersion=readSourceVersion();
recorder.record('run-configuration',{sourceVersion,node:process.version,sdk:'@pump-fun/pump-swap-sdk@2.2.0',strategy:'NOT_IMPLEMENTED',mode:'QUOTE_ONLY',sizeLamports:'10000000',maxMarketAgeMs:30000,paidSubscriptions:false});
async function prove(data:any,firstReceivedAt:string){
  if(typeof data.mint!=='string'||typeof data.signature!=='string')throw new Error('MISSING_MIGRATION_FIELDS');
  const mint=new PublicKey(data.mint);
  let origin;
  try{origin=await verifyMigration(rpc,mint,data.signature,recorder);}
  catch(e){
    if((e as Error).message!=='MIGRATION_ALREADY_COMPLETED_RETRY')throw e;
    // A real feed sample can report an idempotent migration retry. Resolve at
    // most eight earlier curve transactions; do not claim it created the pool.
    recorder.record('feed-migration-correction',{signature:data.signature,reason:'already-migrated-no-creation-CPI'});
    const recent=await rpc.call<any[]>('getSignaturesForAddress',[bondingCurvePda(mint).toBase58(),{before:data.signature,limit:8,commitment:'confirmed'}]);
    recorder.record('bounded-origin-signatures',recent);
    for(const row of recent){
      if(row.err)continue;
      try{origin=await verifyMigration(rpc,mint,row.signature,recorder);break;}
      catch(err){recorder.record('origin-unverified',{signature:row.signature,reason:(err as Error).message});}
    }
    if(!origin)throw new Error('ACTUAL_MIGRATION_NOT_FOUND_IN_BOUNDED_HISTORY');
  }
  const quote=await quotePool(rpc,mint,10_000_000n,recorder,origin.slot);
  const result={project:'pump-opportunity-engine',runId,sourceVersion,firstReceivedAt,feedSignature:data.signature,origin,quote,rpc:{calls:rpc.calls,bytes:rpc.bytes,durationsMs:rpc.durationsMs},wallDurationMs:performance.now()-start,gate:'A_REAL_INTEGRATION_ONLY',paidDataEvents:0,paidDataCostSol:'0',naturalPaperTrades:0};
  writeFileSync(`evidence/integration-proof-${runId}.json`,json(result)+'\n');
  console.log(json(result));proved=true;
}
try {
  const genesis=await rpc.call<string>('getGenesisHash');
  if(genesis!==MAINNET_GENESIS)throw new Error('RPC_WRONG_CLUSTER');
  recorder.record('verified-cluster',{genesis,network:'mainnet-beta'});
  if(process.argv[2]){
    const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
    recorder.record('selected-migration',input);
    await prove(input.data,input.receivedAt);
  }else{
    // Free discovery ONLY. No provider key is loaded and no token-trade subscriptions.
    const duration=Math.min(600,Math.max(10,Number(process.env.POE_CAPTURE_SECONDS??300)))*1000;
    const ws=new WebSocket('wss://pumpportal.fun/api/data',{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,handshakeTimeout:12000,maxPayload:65536});
    let busy=false,attempts=0,closed=false;let fatal:Error|undefined;const seen=new Set<string>();
    await new Promise<void>(resolve=>{
      const fail=(e:unknown)=>{fatal??=e instanceof Error?e:new Error('FEED_CAPTURE_FAILED');ws.terminate();};
      const timer=setTimeout(()=>{try{recorder.record('capture-ended',{reason:'bounded-wall-time',attempts});}catch(e){fail(e);}ws.terminate();},duration);
      ws.on('open',()=>{try{recorder.record('feed-open',{});ws.send(dataMessage('subscribeMigration'));}catch(e){fail(e);}});
      ws.on('error',()=>fail(new Error('PUMPPORTAL_CONNECTION_FAILED')));
      ws.on('close',code=>{closed=true;clearTimeout(timer);try{recorder.record('feed-close',{code});}catch(e){fatal??=e as Error;}if(!busy)resolve();});
      ws.on('message',raw=>{
        try{
          const receivedAt=new Date().toISOString();let data:any;
          try{data=JSON.parse(raw.toString());}catch{recorder.record('malformed-message',{});return;}
          recorder.record('pumpportal-message',{receivedAt,commitment:'processed',data});
          if(!data||typeof data!=='object'||Array.isArray(data)){recorder.record('malformed-message',{reason:'expected object'});return;}
          if(!data.mint||!data.signature)return;
          // This is one migration per signature/mint, not trade-level deduplication.
          const id=`${data.signature}:${data.mint}`;if(seen.has(id))return;
          if(seen.size>=128){ws.terminate();return;}seen.add(id);
          if(busy){recorder.record('integration-unselected',{id,reason:'one-in-flight-probe-capacity'});return;}
          busy=true;attempts++;
          void prove(data,receivedAt).catch(e=>{
            try{recorder.record('integration-rejected',{id,reason:(e as Error).message});console.log(json({mint:data.mint,reason:(e as Error).message}));}catch(error){fail(error);}
          }).finally(()=>{busy=false;if(proved||attempts>=3)ws.terminate();if(closed)resolve();});
        }catch(e){fail(e);}
      });
    });
    if(fatal)throw fatal;
  }
}catch(e){try{recorder.record('integration-failed',{reason:(e as Error).message});}catch{}console.error((e as Error).message);}
finally{try{recorder.record('run-ended',{proved,rpcCalls:rpc.calls,rpcBytes:rpc.bytes,durationMs:performance.now()-start});}finally{recorder.close();}}
if(!proved)process.exitCode=2;
