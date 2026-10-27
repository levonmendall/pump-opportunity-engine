/** One bounded free-data sampler or field capture under the overnight grant. */
import {readFileSync,appendFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import bs58 from 'bs58';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';
import {PUMPAPI_STREAM} from '../src/pumpapi-probe.js';
import {captureOvernightFields} from '../src/overnight-field.js';
import {runComponentLauncher} from './component-launcher.js';
const MIB=1024*1024;
async function child(){
 const out=process.env.POE_COMPONENT_OUT_DIR!,startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),leg=process.env.POE_OVERNIGHT_LEG!,sampler=leg.endsWith('-sampler');
 const baseline=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8'));
 const budget=new ComponentBudget({statePath:join(out,'rpc-budget.json'),grantId:'overnight-'+leg,baseline:baseline.baseline,startedAt,totalMs:baseline.maximumTotalMs,notBefore:baseline.providerNotBefore});
 const bookPath='evidence/overnight-20261027/pumpapi-budget.json',oldPath='evidence/free-data-20261027/pumpapi-budget.json';
 let pb:any;try{pb=JSON.parse(readFileSync(bookPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const old=JSON.parse(readFileSync(oldPath,'utf8'));pb={baseline:{source:oldPath,reservedBytes:old.reservedBytes,reservedMs:old.reservedMs},reservedBytes:old.reservedBytes,reservedMs:old.reservedMs,attempts:[]};}
 const reservedBytes=(sampler?16:64)*MIB,reservedMs=sampler?10000:35000;
 if(pb.reservedBytes+reservedBytes>256*MIB||pb.reservedMs+reservedMs>300000)throw Error('COMPONENT_PUMPAPI_AGGREGATE_CAP');
 pb.reservedBytes+=reservedBytes;pb.reservedMs+=reservedMs;pb.attempts.push({leg,reservedAt:Date.now(),reservedBytes,reservedMs,status:'reserved-before-network'});
 const fd=openSync(bookPath+'.pending','wx',0o600);writeFileSync(fd,JSON.stringify(pb,null,2)+'\n');fsyncSync(fd);closeSync(fd);renameSync(bookPath+'.pending',bookPath);{const d=openSync(dirname(bookPath),'r');fsyncSync(d);closeSync(d);}
 let recordBytes=0,reason:string|null=null,result:any=null,last=performance.now(),socket:WebSocket|undefined;const abort=new AbortController();
 const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,recordedAt:Date.now(),data})+'\n';recordBytes+=Buffer.byteLength(line);if(recordBytes>6*MIB)throw Error('COMPONENT_EVIDENCE_CAP');appendFileSync(join(out,'observations.ndjson'),line,{mode:0o600});};
 const rpc=new ComponentTransport(budget,record,()=>{}),stop=()=>{abort.abort();socket?.terminate();};process.on('SIGTERM',stop);
 const watcher=setInterval(()=>{const n=performance.now(),lag=Math.max(0,n-last-100);last=n;const rss=process.memoryUsage().rss;process.send?.({kind:'progress',stage:leg,rss,eventLoopLagMs:lag});if(rss>256*MIB||lag>500||Date.now()-startedAt>80000)stop();},100);
 const lease=openSync('/tmp/poe-pumpapi-probe.lock','a+',0o600);if(spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',lease]}).status!==0)throw Error('COMPONENT_PUMPAPI_CONNECTION_ALREADY_OWNED');
 try{
  if(sampler){
   const hints:any[]=[],seen=new Set<string>();let socketBytes=0,seenBytes=0,applicationBytes=0,frames=0,resolveClose!:()=>void;const closed=new Promise<void>(r=>{resolveClose=r;});
   const charge=()=>{const n=(socket as any)?._socket?.bytesRead;if(!Number.isSafeInteger(n)||n<seenBytes)throw Error('COMPONENT_PUMPAPI_SOCKET_COUNTER');socketBytes+=n-seenBytes;seenBytes=n;if(socketBytes>16*MIB){reason='COMPONENT_PUMPAPI_HARD_BYTE_CAP';socket?.terminate();throw Error(reason);}if(socketBytes>=15*MIB)socket?.terminate();};
   await budget.operate({transport:'ws-upgrade',method:'upgrade'},async op=>new Promise<void>((res,rej)=>{
    const ws=new WebSocket(PUMPAPI_STREAM,{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:65536,perMessageDeflate:false,followRedirects:false,handshakeTimeout:3000});socket=ws;op.signal.addEventListener('abort',()=>ws.terminate(),{once:true});
    ws.on('open',()=>{charge();budget.chargeWs(socketBytes);(ws as any)._socket.prependListener('data',()=>{try{charge();}catch{stop();}});op.completeResponse();record('pumpapi-sampler-open',{at:Date.now(),endpoint:PUMPAPI_STREAM,scope:'UNVERIFIED_CANDIDATE_HINTS_ONLY'});res();});
    ws.on('message',raw=>{try{charge();frames++;const b=Buffer.from(raw as any);applicationBytes+=b.length;if(applicationBytes>=14*MIB){ws.terminate();return;}if(hints.length>=3)return;if(!b.includes(Buffer.from('pump-amm'))||!b.includes(Buffer.from(NATIVE_MINT.toBase58())))return;const p=JSON.parse(b.toString());if(p.pool!=='pump-amm'||p.quoteMint!==NATIVE_MINT.toBase58()||!['buy','sell'].includes(p.action)||typeof p.mint!=='string'||typeof p.signature!=='string')return;if(p.signature.length>100||bs58.decode(p.signature).length!==64)throw Error('COMPONENT_PUMPAPI_SELECTED_SIGNATURE');const mint=new PublicKey(p.mint);if(canonicalPumpPoolPda(mint).toBase58()!==p.poolId||seen.has(p.poolId))return;seen.add(p.poolId);const h={mint:p.mint,pool:p.poolId,signature:p.signature,receivedAt:Date.now(),support:'UNVERIFIED',raw:p};hints.push(h);record('pumpapi-candidate-hint',h);if(hints.length>=3)ws.terminate();}catch{reason='COMPONENT_PUMPAPI_MALFORMED_SELECTED_HINT';ws.terminate();}});
    ws.on('close',()=>{try{charge();}catch{}resolveClose();});ws.on('error',()=>{rej(Error('COMPONENT_PUMPAPI_TRANSPORT'));stop();});ws.on('unexpected-response',(_q,r)=>{record('pumpapi-refusal',{status:r.statusCode,retryAfter:r.headers['retry-after']??null});r.destroy();rej(Error('COMPONENT_PUMPAPI_REFUSED'));});
   }),abort.signal,{timeoutMs:4000});
   const timer=setTimeout(()=>socket?.terminate(),5000);await closed;clearTimeout(timer);result={hints,socketBytes,applicationBytes,frames,oneConnection:true,elapsedMs:Date.now()-startedAt,completeFlow:false};writeFileSync(join(out,'hints.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  }else{
   const selected=JSON.parse(readFileSync('evidence/overnight-20261027/06-targeted/selected.json','utf8'));
   result=await captureOvernightFields({scope:{mint:selected.mint,pool:selected.pool,baseUnits:selected.baseUnits,minSlot:selected.minSlot,supportedPoolEvidence:selected.supportedPoolEvidence},budget,rpc,record,signal:abort.signal});
   writeFileSync(join(out,'capture.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  }
 }catch(e){reason=e instanceof Error?e.message:'COMPONENT_FIELD_UNAVAILABLE';record('field-stop',{reason});}
 finally{
  stop();clearInterval(watcher);const until=Date.now()+1000;while(budget.inFlight&&Date.now()<until)await new Promise(r=>setTimeout(r,10));closeSync(lease);
  const attempt=pb.attempts.at(-1);Object.assign(attempt,{status:'completed-with-receipt',observedSocketBytes:result?.socketBytes??null,reason,fieldStopReason:result?.stopReason??null});
  const save=openSync(bookPath+'.pending','wx',0o600);writeFileSync(save,JSON.stringify(pb,null,2)+'\n');fsyncSync(save);closeSync(save);renameSync(bookPath+'.pending',bookPath);{const d=openSync(dirname(bookPath),'r');fsyncSync(d);closeSync(d);}
  const summary={outcome:sampler?'PUMPAPI_CANDIDATE_HINT_SAMPLE':result?.normalizedEvents>0?'PUMPAPI_MATCHED_FIELD_SAMPLE':'INCONCLUSIVE_NO_MATCHED_FIELDS',reason,result,usage:budget.usage(),reservation:{reservedBytes,reservedMs,cumulativeReservedBytes:pb.reservedBytes,cumulativeReservedMs:pb.reservedMs},productionTouched:false,naturalPaperTrades:0,liveTrading:false,paperEntries:false};
  // Raw per-transaction evidence is already recorded; avoid oversized supervisor IPC.
  const compact={...summary,result:result?{...result,enrichmentTransactions:undefined,enrichmentHints:undefined,executedEvidence:undefined,featureRows:undefined}:null};writeFileSync(join(out,'summary.json'),JSON.stringify(compact,null,2)+'\n',{flag:'wx',mode:0o600});process.send?.({kind:'final',summary:compact});if(!budget.inFlight)budget.close();process.exitCode=reason?2:0;process.disconnect?.();
 }
}
if(process.argv[2]==='--overnight-child')await child();else if(process.argv[2]==='run'&&process.argv[3])process.exitCode=(await runComponentLauncher(resolve(import.meta.filename),{leg:process.argv[3]})).exitCode;else console.log('No network; bounded overnight free-data work only.');
