/** Cloud-only bounded FREE data probe. No application deployment or credentials. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,statSync,lstatSync,mkdirSync,openSync,writeSync,fsyncSync,closeSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {readSourceVersion} from '../src/source-version.js';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import WebSocket from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {PumpApiProbe,PUMPAPI_STREAM,PUMPAPI_SCHEMA_LIMITS,PUMPAPI_CAPTURE_LIMITS,PUMPAPI_LIMITS,pumpApiChildArguments,type ProbeLimits} from '../src/pumpapi-probe.js';

const ROOT=resolve('evidence/free-data-20261027'),SCRIPT=fileURLToPath(import.meta.url),MIB=1024*1024;
const MAX_DISK=16*MIB,LOCK=resolve('/tmp/poe-pumpapi-probe.lock'),BUDGET=resolve(ROOT,'pumpapi-budget.json');
const args=process.argv.slice(2),mode=args[0];
if(mode==='--child'){
  if(!process.send||process.getuid?.()!==1000)throw new Error('supervised UID1000 IPC child required');
  process.once('message',(config:unknown)=>{void child(config).catch(()=>{process.send?.({kind:'fatal',code:'CHILD_FAILED'});process.exitCode=2;process.disconnect?.();});});
}else if(mode==='--locked'){
  await parent(args[1],args.slice(2));
}else if(mode==='schema'||mode==='capture'){
  mkdirSync(ROOT,{recursive:true,mode:0o700});
  const guard=spawn('flock',['-n','-F',LOCK+'.budget',process.execPath,'--import','tsx',SCRIPT,'--locked',...args],{stdio:'inherit'});
  process.exitCode=await new Promise<number>(resolveCode=>{guard.once('error',()=>resolveCode(2));guard.once('exit',code=>resolveCode(code??2));});
}else{
  console.log(JSON.stringify({networkStarted:false,usage:'node --import tsx scripts/pumpapi-probe.ts schema|capture <exactMint> [<exactMint>...]',endpoint:PUMPAPI_STREAM,schema:PUMPAPI_SCHEMA_LIMITS,capture:PUMPAPI_CAPTURE_LIMITS,aggregate:{bytes:PUMPAPI_LIMITS.maximumAggregateBytes,durationMs:PUMPAPI_LIMITS.maximumAggregateMs,evidenceBytes:MAX_DISK},singleIp:'ONE connection per IP, sequential flock; never bypass a shared-NAT refusal'}));
}
async function parent(stage:unknown,mints:string[]){
  if(process.getuid?.()!==1000||!['schema','capture'].includes(String(stage))||mints.length<1||mints.length>16||mints.some(x=>!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x)))throw new Error('supervised Cloud UID1000 stage and exact mint list required');
  const limits={...(stage==='schema'?PUMPAPI_SCHEMA_LIMITS:PUMPAPI_CAPTURE_LIMITS)},wallMs=limits.durationMs+5000;
  const sourceVersion=readSourceVersion(dirname(SCRIPT)),sourceHashes=Object.fromEntries([SCRIPT,resolve(dirname(SCRIPT),'../src/pumpapi-probe.ts'),resolve(dirname(SCRIPT),'../src/strategy.ts'),resolve(dirname(SCRIPT),'../package-lock.json')].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
  mkdirSync(ROOT,{recursive:true,mode:0o700});let disk=0;
  for(const name of readdirSync(ROOT).filter(n=>n.startsWith('pumpapi-'))){const p=resolve(ROOT,name),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw new Error('regular probe evidence files required');disk+=s.size;}
  if(disk+limits.evidenceBytes+65_536>MAX_DISK)throw new Error('AGGREGATE_EVIDENCE_CAP');
  let budget:{reservedBytes:number;reservedMs:number;attempts:Array<Record<string,unknown>>}={reservedBytes:0,reservedMs:0,attempts:[]};
  if(existsSync(BUDGET)){if(statSync(BUDGET).size>32_768)throw new Error('BUDGET_FILE_CAP');budget=JSON.parse(readFileSync(BUDGET,'utf8'));}
  if(!Number.isSafeInteger(budget.reservedBytes)||budget.reservedBytes<0||!Number.isSafeInteger(budget.reservedMs)||budget.reservedMs<0||!Array.isArray(budget.attempts)||budget.attempts.length>=16)throw new Error('INVALID_EXISTING_BUDGET');
  if(budget.reservedBytes+limits.transportBytes>PUMPAPI_LIMITS.maximumAggregateBytes||budget.reservedMs+wallMs>PUMPAPI_LIMITS.maximumAggregateMs)throw new Error('AGGREGATE_PROBE_BUDGET_EXHAUSTED');
  const id=String(stage)+'-'+new Date().toISOString().replace(/[:.]/g,'-'),record=resolve(ROOT,'pumpapi-'+id+'.ndjson'),summary=resolve(ROOT,'pumpapi-'+id+'.json');
  const attempt={id,stage,at:new Date().toISOString(),reservedBytes:limits.transportBytes,reservedMs:wallMs,status:'reserved-before-network',record,summary};
  budget.reservedBytes+=limits.transportBytes;budget.reservedMs+=wallMs;budget.attempts.push(attempt);saveBudget(budget);
  const childProcess=spawn('flock',pumpApiChildArguments(LOCK,SCRIPT,limits),{stdio:['ignore','pipe','pipe','ipc']});
  const began=performance.now();let lastHeartbeat=began,firstHeartbeat=false,peakRss=0,stdoutBytes=0,stderrBytes=0,supervisorStop:string|null=null,final:any=null;
  const stop=(reason:string)=>{if(supervisorStop)return;supervisorStop=reason;childProcess.kill('SIGTERM');setTimeout(()=>childProcess.kill('SIGKILL'),500).unref();};
  childProcess.stdout!.on('data',b=>{stdoutBytes+=b.byteLength;if(stdoutBytes>32_768)stop('stdout-cap');});childProcess.stderr!.on('data',b=>{stderrBytes+=b.byteLength;if(stderrBytes>32_768)stop('stderr-cap');});
  childProcess.on('message',(message:any)=>{if(message&&message.kind==='progress'){firstHeartbeat=true;lastHeartbeat=performance.now();}else if(message?.kind==='final'){final=message;lastHeartbeat=performance.now();}else if(message?.kind==='fatal')stop('child-failed');});
  const watch=setInterval(()=>{
    const now=performance.now();if(now-began>wallMs)stop('parent-wall-limit');if(now-lastHeartbeat>(firstHeartbeat?2000:5000))stop('parent-heartbeat-limit');
    if(childProcess.pid){try{const status=readFileSync(`/proc/${childProcess.pid}/status`,'utf8'),rss=Number(status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1])*1024;if(!Number.isSafeInteger(rss)||rss<0){if(firstHeartbeat)stop('parent-rss-unavailable');}else{peakRss=Math.max(peakRss,rss);if(rss>PUMPAPI_LIMITS.maximumRssBytes)stop('parent-rss-limit');}}catch{/* Child may have just exited. Exit handling follows. */}}
  },100);
  childProcess.once('spawn',()=>childProcess.send({stage,limits,trackedMints:mints,record}));
  const exit=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolveExit=>{childProcess.once('error',()=>resolveExit({code:2,signal:null}));childProcess.once('exit',(code,signal)=>resolveExit({code,signal}));});clearInterval(watch);
  const result={schemaVersion:1,project:'pump-opportunity-engine',mode:'FREE_DATA_RESEARCH',id,stage,record,limits,sourceVersion,sourceHashes,trackedMints:mints,cloudUid:process.getuid?.(),supervisor:{wallMs:performance.now()-began,wallLimitMs:wallMs,peakRssBytes:peakRss,rssLimitBytes:PUMPAPI_LIMITS.maximumRssBytes,heapMiB:128,cpuSoftSeconds:Math.ceil(limits.cpuMs/1000),cpuHardSeconds:Math.ceil(limits.cpuMs/1000)+1,maximumFileBytes:8*MIB,maximumDescriptors:64,stdoutBytes,stderrBytes,stopReason:supervisorStop,exit},observation:final?.observation??null,resourceUsage:final?.resourceUsage??null,transportRejectedOversize:final?.transportRejectedOversize??null,aggregate:{reservedBytes:budget.reservedBytes,reservedMs:budget.reservedMs,maximumBytes:PUMPAPI_LIMITS.maximumAggregateBytes,maximumMs:PUMPAPI_LIMITS.maximumAggregateMs,reservationsAreConservativeAndNeverAutomaticallyReleased:true},fieldContract:'UNVERIFIED',normalizedTrades:0,entriesEnabled:false,ec2Compatibility:'UNVERIFIED; Cloud child containment only',paidProviderRequests:0,walletUse:false,networkEndpoint:PUMPAPI_STREAM};
  const serialized=JSON.stringify(result,null,2)+'\n';if(Buffer.byteLength(serialized)>65_536)throw new Error('SUMMARY_CAP');writeFileSync(summary,serialized,{mode:0o600,flag:'wx'});
  Object.assign(attempt,{status:final?'completed-with-receipt':'uncertain-reservation-retained',supervisorStop,exit,observedSocketBytes:final?.observation?.observedSocketBytes??null});saveBudget(budget);
  console.log(JSON.stringify({summary,record,stopReason:final?.observation?.stopReason??supervisorStop,frames:final?.observation?.frames??null,applicationBytes:final?.observation?.applicationBytes??null,observedSocketBytes:final?.observation?.observedSocketBytes??null,selectedPersisted:final?.observation?.selectedPersisted??null,aggregateReservedBytes:budget.reservedBytes,supervisor:result.supervisor}));
}
function saveBudget(value:unknown){const body=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(body)>32_768)throw new Error('BUDGET_FILE_CAP');writeFileSync(BUDGET,body,{mode:0o600});}
async function child(config:any){
  if(!config||!['schema','capture'].includes(config.stage)||config.record!==resolve(ROOT,'pumpapi-'+String(config.stage)+'-'+config.record.split('pumpapi-'+config.stage+'-').at(-1))||!config.record.startsWith(ROOT+'/pumpapi-'))throw new Error('bounded parent configuration required');
  const expected=config.stage==='schema'?PUMPAPI_SCHEMA_LIMITS:PUMPAPI_CAPTURE_LIMITS;
  if(JSON.stringify(config.limits)!==JSON.stringify(expected))throw new Error('fixed stage limits required');
  const fd=openSync(config.record,'wx',0o600),cpuStart=process.cpuUsage(),probe=new PumpApiProbe({limits:expected,trackedMints:config.trackedMints,write:line=>{writeSync(fd,line);}});
  let ending=false,finalized=false,lastTick=performance.now(),progressPending=false,transportRejectedOversize=0;
  const socket=new WebSocket(PUMPAPI_STREAM,{agent:process.env.HTTPS_PROXY?new HttpsProxyAgent(process.env.HTTPS_PROXY):undefined,maxPayload:PUMPAPI_LIMITS.maximumPayloadBytes,perMessageDeflate:false,handshakeTimeout:3000,followRedirects:false});
  const socketCounter=()=>{const n=(socket as unknown as {_socket?:{bytesRead:number}})._socket?.bytesRead;return typeof n==='number'?n:undefined;};
  const finalize=()=>{if(finalized)return;finalized=true;clearInterval(timer);const n=socketCounter();if(n!==undefined)probe.observeTransport(n);probe.closed(ending?'bounded-probe-ended':'transport-close');fsyncSync(fd);closeSync(fd);const observation=probe.snapshot();if(process.connected)process.send?.({kind:'final',observation,transportRejectedOversize,resourceUsage:process.resourceUsage()},()=>{if(process.connected)process.disconnect();});};
  const end=(reason:string)=>{if(ending)return;ending=true;probe.finish(reason);clearInterval(timer);socket.terminate();setTimeout(finalize,250).unref();};
  socket.on('open',()=>{probe.opened();const n=socketCounter();if(n===undefined)end('transport-counter-unavailable');else probe.observeTransport(n);});
  socket.on('message',raw=>{const b=Array.isArray(raw)?Buffer.concat(raw):typeof raw==='string'?raw:Buffer.from(raw as ArrayBuffer),n=socketCounter();if(n===undefined){end('transport-counter-unavailable');return;}probe.receive(b,n);if(probe.stopped)end(probe.snapshot().stopReason??'policy-stop');});
  socket.on('unexpected-response',(_request,response)=>{response.resume();end('handshake-http-'+String(response.statusCode??'unknown'));});
  socket.on('error',(error:any)=>{if(error?.code==='WS_ERR_UNSUPPORTED_MESSAGE_LENGTH')transportRejectedOversize++;end(transportRejectedOversize?'ws-payload-limit':'transport-error');});
  socket.on('close',()=>{if(!ending){ending=true;probe.finish('remote-close');}finalize();});
  process.once('SIGTERM',()=>end('supervisor-stop'));process.once('SIGINT',()=>end('interrupted'));process.once('disconnect',()=>end('supervisor-disconnected'));
  const timer=setInterval(()=>{const now=performance.now(),used=process.cpuUsage(cpuStart),rss=process.memoryUsage().rss;probe.tick({rssBytes:rss,cpuMs:(used.user+used.system)/1000,eventLoopLagMs:Math.max(0,now-lastTick-100)},socketCounter());lastTick=now;
    if(!progressPending&&process.connected){progressPending=true;const s=probe.snapshot();process.send?.({kind:'progress',at:s.at,frames:s.frames,bytes:s.observedSocketBytes,pending:s.pendingSelected,rssBytes:rss},()=>{progressPending=false;});}
    if(probe.stopped)end(probe.snapshot().stopReason??'policy-stop');
  },100);
}
