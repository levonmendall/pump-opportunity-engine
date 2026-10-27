/** Isolated overnight measurements. Fixed public reads only, disposable quantities. */
import {readFileSync,appendFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import bs58 from 'bs58';
import {dataMessage} from '../src/network.js';
import {PublicKey,SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {PUMP_AMM_SDK,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,canonicalPumpPoolPda} from '../src/sdk.js';
import {ComponentBudget} from '../src/component-budget.js';
import {ComponentTransport} from '../src/component-transport.js';
import {componentSeedFromRetainedEvidence} from '../src/component-selection.js';
import {ResearchClockPositionPricer} from '../src/research-clock-pricing.js';
import {validateComponentParity,type ComponentSnapshot} from '../src/component-parity.js';
import {runComponentLauncher} from './component-launcher.js';
const safe=(e:unknown)=>e instanceof Error&&/^[A-Z][A-Z0-9_:-]{0,110}$/.test(e.message)?e.message:'COMPONENT_RESEARCH_VALIDATION_FAILURE';
async function child(){
 const out=process.env.POE_COMPONENT_OUT_DIR!,startedAt=Number(process.env.POE_COMPONENT_STARTED_AT),leg=process.env.POE_OVERNIGHT_LEG!;
 if(process.getuid?.()!==1000||!out||!/^\d\d-[a-z-]+$/.test(leg)||!Number.isSafeInteger(startedAt))throw Error('COMPONENT_CHILD_BINDING');
 const baselineRecord=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8'));
 const budget=new ComponentBudget({statePath:join(out,'rpc-budget.json'),grantId:'overnight-'+leg,baseline:baselineRecord.baseline,startedAt,totalMs:baselineRecord.maximumTotalMs,notBefore:Math.max(baselineRecord.providerNotBefore,baselineRecord.baseline.starts.at(-1)+1000)});
 let discoverySocket:WebSocket|undefined,discoveryClosed:Promise<void>|undefined,discoverySeen=0,discoveryBytes=0;
 let latest:ComponentSnapshot|null=null,bytes=0,reason:string|null=null,maxRss=0,maxLag=0,lastBeat=performance.now();const results:any[]=[],cpu0=process.cpuUsage(),abort=new AbortController();
 const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,recordedAt:Date.now(),data})+'\n';bytes+=Buffer.byteLength(line);if(bytes>6*1024*1024)throw Error('COMPONENT_EVIDENCE_CAP');appendFileSync(join(out,'observations.ndjson'),line,{mode:0o600});if(kind==='research-clock-pool-state')latest=data as ComponentSnapshot;};
 const transport=new ComponentTransport(budget,record,()=>{}),pricer=new ResearchClockPositionPricer(transport,{record});
 const stop=(r:string)=>{reason??=r;try{budget.halt(r);}catch{}abort.abort();transport.terminate(r);discoverySocket?.terminate();};
 process.on('SIGTERM',()=>stop('COMPONENT_PARENT_STOP'));process.on('message',(m:any)=>{if(m?.kind==='stop')stop('COMPONENT_PARENT_STOP');});
 const watcher=setInterval(()=>{try{const now=performance.now(),lag=Math.max(0,now-lastBeat-100);lastBeat=now;maxLag=Math.max(maxLag,lag);maxRss=Math.max(maxRss,process.memoryUsage().rss);const cpu=process.cpuUsage(cpu0);process.send?.({kind:'progress',stage:leg,rss:maxRss,cpuMs:(cpu.user+cpu.system)/1000,eventLoopLagMs:lag});if(maxRss>256*1024*1024||lag>500)stop('COMPONENT_RESOURCE_STOP');if(Date.now()>startedAt+baselineRecord.maximumTotalMs-5000)stop('COMPONENT_SHUTDOWN_RESERVE');}catch{stop('COMPONENT_RESOURCE_STOP');}},100);
 const discovery=async()=>{
  const seeds:any[]=[];let resolveEnded!:()=>void;const ended=new Promise<void>(r=>{resolveEnded=r;});let acknowledge:((data:any)=>void)|undefined;discoveryClosed=ended;
  const charge=()=>{const n=(discoverySocket as any)?._socket?.bytesRead;if(typeof n!=='number'||n<discoverySeen)throw Error('COMPONENT_DISCOVERY_SOCKET_COUNTER');let delta=n-discoverySeen;discoverySeen=n;discoveryBytes+=delta;while(delta){const d=Math.min(delta,65536);budget.chargeWs(d);delta-=d;}if(discoveryBytes>5*1024*1024){stop('COMPONENT_DISCOVERY_HARD_BYTE_CAP');throw Error('COMPONENT_DISCOVERY_HARD_BYTE_CAP');}if(discoveryBytes>=4*1024*1024)discoverySocket?.terminate();};
  await budget.operate({transport:'ws-upgrade',method:'upgrade'},async op=>new Promise<void>((res,rej)=>{
   const ws=new WebSocket('wss://pumpportal.fun/api/data',{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:65536,perMessageDeflate:false,followRedirects:false,handshakeTimeout:3000});discoverySocket=ws;
   op.signal.addEventListener('abort',()=>ws.terminate(),{once:true});
   ws.on('open',()=>{try{charge();(ws as any)._socket.prependListener('data',()=>{try{charge();}catch{stop('COMPONENT_DISCOVERY_SOCKET_FAILURE');}});op.completeResponse();record('discovery-open',{at:Date.now(),endpoint:'wss://pumpportal.fun/api/data',paidMethods:false});res();}catch{rej(Error('COMPONENT_DISCOVERY_SOCKET_FAILURE'));}});
   ws.on('message',raw=>{try{charge();const body=raw.toString();if(Buffer.byteLength(body)>65536)throw Error('COMPONENT_DISCOVERY_PAYLOAD');const data=JSON.parse(body);if(typeof data?.message==='string'&&(/^[Ss]ubscribed to ['" ]*migration['" ]* events\.$/.test(data.message)||/^Successfully subscribed to migration events\.?$/i.test(data.message))){record('discovery-ack',{at:Date.now(),data});acknowledge?.(data);return;}
    if(typeof data?.mint!=='string'||typeof data.signature!=='string'||data.txType!=='migrate')return;const mint=new PublicKey(data.mint).toBase58();if(bs58.decode(data.signature).length!==64)throw Error('COMPONENT_DISCOVERY_SIGNATURE');
    const hint={mint,pool:canonicalPumpPoolPda(new PublicKey(mint)).toBase58(),signature:data.signature,observedAt:Date.now(),sourceRef:'evidence/overnight-20261027/'+leg+'/observations.ndjson',commitment:'processed',support:'UNVERIFIED',payload:data};
    if(!seeds.some(s=>s.mint===mint&&s.signature===data.signature)){seeds.push(hint);record('migration-hint',hint);}
    if(seeds.length>=3)ws.terminate();
   }catch{stop('COMPONENT_DISCOVERY_PAYLOAD');}});
   ws.on('error',()=>{rej(Error('COMPONENT_DISCOVERY_TRANSPORT'));stop('COMPONENT_DISCOVERY_TRANSPORT');});ws.on('close',()=>{try{charge();}catch{}resolveEnded();});
   ws.on('unexpected-response',(_req,response)=>{record('discovery-refusal',{status:response.statusCode,retryAfter:response.headers['retry-after']??null});response.destroy();rej(Error('COMPONENT_DISCOVERY_REFUSED'));});
  }),abort.signal,{timeoutMs:4000});
  await budget.operate({transport:'ws',method:'subscribeMigration'},async op=>new Promise<void>((res,rej)=>{acknowledge=()=>{acknowledge=undefined;op.completeResponse();res();};op.signal.addEventListener('abort',()=>{discoverySocket?.terminate();rej(Error('COMPONENT_DISCOVERY_SUBSCRIPTION_ABORT'));},{once:true});discoverySocket!.send(dataMessage('subscribeMigration'),e=>{if(e)rej(Error('COMPONENT_DISCOVERY_SEND'));});}),abort.signal,{timeoutMs:5000});
  const timer=setTimeout(()=>discoverySocket?.terminate(),Math.max(1,startedAt+590000-Date.now()));await ended;clearTimeout(timer);charge();
  writeFileSync(join(out,'seeds.json'),JSON.stringify({seeds,receivedSocketBytes:discoveryBytes,oneConnection:true,paidMethods:false,sourceCommitment:'processed',support:'UNVERIFIED'},null,2)+'\n',{flag:'wx',mode:0o600});results.push({objective:'FREE_MIGRATION_DISCOVERY',seeds:seeds.map(s=>({mint:s.mint,pool:s.pool,signature:s.signature,observedAt:s.observedAt})),receivedSocketBytes:discoveryBytes});
 };
 try{
  if(leg.endsWith('-discovery'))await discovery();
  else {
  const proof='evidence/integration-proof-2026-10-26T23-32-41.255Z.json',swap='evidence/targeted-transaction-sample.json';
  const seed=componentSeedFromRetainedEvidence({integrationProof:{ref:proof,bytes:readFileSync(proof)},swapProof:{ref:swap,bytes:readFileSync(swap)}});record('hypothetical-identity-only',seed);
  const subjects=[{mint:seed.mint,baseUnits:seed.baseUnits,minSlot:seed.minSlot}];
  if(leg.endsWith('-multi'))for(const ref of ['evidence/integration-proof-2026-10-26T19-57-35.882Z.json','evidence/integration-proof-2026-10-26T19-42-16.130Z.json']){
   const proof=JSON.parse(readFileSync(ref,'utf8')),q=proof.quote;
   if(proof.project!=='pump-opportunity-engine'||proof.origin?.instructionVerified!==true||q.sdk!=='@pump-fun/pump-swap-sdk@2.2.0'||canonicalPumpPoolPda(new PublicKey(q.mint)).toBase58()!==q.pool)throw Error('COMPONENT_HISTORICAL_IDENTITY_UNVERIFIED');
   subjects.push({mint:q.mint,baseUnits:q.buy.outputBaseUnits,minSlot:q.slot});record('historical-identity-only',{ref,mint:q.mint,pool:q.pool,minSlot:q.slot,entryEligibility:'UNVERIFIED'});
  }
  for(let i=0;i<2;i++){
   const batch=await pricer.quoteMany(subjects.map(s=>({mint:new PublicKey(s.mint),fullBaseUnits:BigInt(s.baseUnits),minSlot:s.minSlot})),abort.signal);record('coherent-batch-result',{context:batch.context,unavailable:batch.unavailable,holdingCount:subjects.length});
   const availableAt=Date.now();if(!latest||!batch.context)throw Error('COMPONENT_CAPTURE_MISSING');const captured:ComponentSnapshot=latest;
   for(const subject of subjects){
    const q=batch.quotes[subject.mint];if(!q)continue;
    const raw=captured.value[captured.addresses.indexOf(q.pool)]!;
    const pool=PUMP_AMM_SDK.decodePool({...raw,owner:new PublicKey(raw.owner),data:Buffer.from(raw.data[0],'base64')});
    const addresses=[q.pool,GLOBAL_CONFIG_PDA.toBase58(),PUMP_AMM_FEE_CONFIG_PDA.toBase58(),subject.mint,NATIVE_MINT.toBase58(),pool.poolBaseTokenAccount.toBase58(),pool.poolQuoteTokenAccount.toBase58(),SYSVAR_CLOCK_PUBKEY.toBase58()];
    const snapshot={...captured,addresses,value:addresses.map(a=>captured.value[captured.addresses.indexOf(a)]??null)};
    const parity=validateComponentParity(snapshot,subject.mint,BigInt(subject.baseUnits),q);if(availableAt-Date.parse(q.receivedAt)>2000)throw Error('COMPONENT_QUOTE_AGE_AT_USE');
    const result={objective:subjects.length>1?'MULTI_POOL_COHERENT_STATE':'ONE_POOL_CURRENT_STATE',round:i,sharedContextSlot:batch.context.slot,unionAccountCount:captured.addresses.length,availableAt,quoteAgeAtUseMs:availableAt-Date.parse(q.receivedAt),quote:q,parity};results.push(result);record('validated-current-state',result);
   }
   const slot=batch.context.slot,requestedAt=Date.now(),blockTime=await transport.call<number|null>('getBlockTime',[slot],abort.signal);if(blockTime===null||!Number.isSafeInteger(blockTime))throw Error('COMPONENT_BLOCK_TIME_UNAVAILABLE');
   record('independent-block-time',{slot,requestedAt,availableAt:Date.now(),blockTime,bankClock:batch.context.marketClockUnixSeconds,differenceSeconds:batch.context.marketClockUnixSeconds-blockTime,originalAccountReceivedAt:captured.receivedAt,backdated:false});
  }
  }
 }catch(e){reason=safe(e);record('measurement-stop',{reason});try{budget.halt(reason.startsWith('COMPONENT_')?reason:'COMPONENT_VALIDATION_FAILURE');}catch{}}
 finally{
  discoverySocket?.terminate();if(discoveryClosed)await Promise.race([discoveryClosed,new Promise(r=>setTimeout(r,600))]);abort.abort();await transport.terminateAndWait('measurement-end',600).catch(()=>{});const until=Date.now()+1000;while(budget.inFlight&&Date.now()<until)await new Promise(r=>setTimeout(r,10));clearInterval(watcher);
  const summary={outcome:leg.endsWith('-discovery')?(reason?'STOPPED_'+reason:results[0]?.seeds.length?'FREE_MIGRATION_HINTS_CAPTURED':'QUIET_DISCOVERY'):(results.length?(reason?'PARTIAL_CURRENT_STATE_VALIDATED':'CURRENT_STATE_VALIDATED'):reason??'NO_RESULT'),reason,startedAt,finishedAt:Date.now(),elapsedMs:Date.now()-startedAt,results,usage:budget.usage(),resources:{maxRss,maxLag,cpu:process.cpuUsage(cpu0)},productionTouched:false,paperEntries:false,liveTrading:false,acceptanceClock:false};
  writeFileSync(join(out,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});process.send?.({kind:'final',summary});if(!budget.inFlight)budget.close();process.exitCode=reason?2:0;process.disconnect?.();
 }
}
if(process.argv[2]==='--overnight-child')await child();
else if(process.argv[2]==='run'&&process.argv[3])process.exitCode=(await runComponentLauncher(resolve(import.meta.filename),{leg:process.argv[3]})).exitCode;
else process.stdout.write('No network. Explicit run requires the current overnight grant and a new ordered leg id.\n');
