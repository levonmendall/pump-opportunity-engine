/** One shared-budget public-RPC identity-only recovery. No account or admission. */
import {appendFileSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync,constants,fstatSync,fsyncSync,renameSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {PilotRpc} from '../src/pilot-rpc.js';
import {recoverPilotOrigin,PILOT_ORIGIN_RECOVERY_LIMITS} from '../src/pilot-origin-recovery.js';
import {readResearchBaseline} from '../src/research-baseline.js';

const MIB=1024*1024,ROOT='/workspace/poe-pilot',holderPid=125671;
const need=(v:unknown,r:string)=>{if(!v)throw Error(r);},hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
need(!process.env.HTTPS_PROXY||process.execArgv.includes('--use-env-proxy')||process.env.NODE_USE_ENV_PROXY==='1','INHERITED_PROXY_NOT_SELECTED');
process.kill(holderPid,0);
const fd=openSync('/tmp/poe-public-component-20261027.lock',constants.O_RDWR|constants.O_NOFOLLOW),st=fstatSync(fd);
need(st.isFile()&&st.uid===process.getuid?.()&&st.nlink===1&&(st.mode&0o077)===0,'UNSAFE_EXISTING_LEASE');
need(spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',fd]}).status===1,'EXTERNAL_LEAD_LEASE_REQUIRED');closeSync(fd);
const referencePath='evidence/age-reference-20261028/continuation-001/receipt.json',referenceBytes=readFileSync(referencePath),reference=JSON.parse(referenceBytes.toString('utf8'));
const indexed=reference.leads.find((x:any)=>x.mint==='2mPwr92SEnFKdMPGJYbCkuicCmXHtVFPse2AvFXTpump');
need(indexed?.pool==='GbRwMFqRTTfSqZ5yyYG83Y3okcAq9sjtyy4WrVkEyvWt'&&indexed.indexedCreatedAt==='2026-10-27T22:05:09Z','FROZEN_INDEPENDENT_LEAD_REQUIRED');
const seed={mint:indexed.mint,pool:indexed.pool,indexedCreatedAt:Date.parse(indexed.indexedCreatedAt),receivedAt:Date.parse(indexed.observedAt)};
const manifestPath=ROOT+'/pilot.json',manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
need(!manifest.unresolvedResearch,'EXISTING_RESEARCH_UNRESOLVED');
const linked=readResearchBaseline({paths:manifest.baselinePaths,now:Date.now(),physicalSettled:true,allowCumulativeBeyondLegacy:true,maximumPaths:128});
need(linked.baseline.calls===4631,'EXPECTED_SHARED_BASELINE_CHANGED');
need(Date.now()>=manifest.cooldownUntil&&Date.now()>=(manifest.controlCooldownUntil??0),'PROVIDER_COOLDOWN_NOT_ELAPSED');
const startedAt=Date.now(),stamp=new Date(startedAt).toISOString().replace(/[^0-9]/g,''),runId='pilot-ingus-origin-'+stamp,out='evidence/age-origin-20261028/'+runId,runDir=ROOT+'/runs/'+runId;
mkdirSync(out,{recursive:true,mode:0o700});mkdirSync(runDir,{mode:0o700});
const persist=()=>{const tmp=manifestPath+'.ingus-origin-pending',d=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(d,JSON.stringify(manifest)+'\n');fsyncSync(d);}finally{closeSync(d);}renameSync(tmp,manifestPath);};
manifest.runs.push(runId);manifest.unresolvedResearch={runId,rpcDirectory:runDir+'/rpc',pid:process.pid};persist();
let rpc:PilotRpc|undefined,origin:any=null,failure:string|null=null,settled=false,retained=0,measuredBytes=0,helperStartedAt=0,physicalStarts=0;
const controller=new AbortController(),wall=setTimeout(()=>controller.abort(),23000);
const source={commit:spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),scriptSha256:hash(readFileSync(new URL(import.meta.url))),helperSha256:hash(readFileSync('src/pilot-origin-recovery.ts')),reference:{path:referencePath,sha256:hash(referenceBytes),frozenAt:reference.cohortFrozenAt}};
const record=(kind:string,data:unknown)=>{const line=JSON.stringify({kind,at:Date.now(),data})+'\n';need(retained+Buffer.byteLength(line)<=4*MIB-262144,'INGUS_EVIDENCE_CAP');appendFileSync(out+'/events.ndjson',line,{mode:0o600});retained+=Buffer.byteLength(line);if(kind==='http-response-timing')measuredBytes+=Number((data as any).responseBytes);if(kind==='component-physical-start')physicalStarts++;};
try{
 record('ingus-origin-purpose',{seed,source,indexedTimeAuthority:false,scope:'Identity recovery only; no activity, quote, support or financial execution claim',limits:PILOT_ORIGIN_RECOVERY_LIMITS,globalLeaseHolder:holderPid});
 rpc=new PilotRpc({directory:runDir+'/rpc',runId,baselinePaths:manifest.baselinePaths,priorPhysicalSettled:true,priorCooldownUntil:manifest.cooldownUntil,durationMs:25000,maxUnits:24,maxResponseBytes:8*MIB,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,maxChapters:1,record});
 helperStartedAt=Date.now();
 const call=async<T>(method:string,params:unknown[]=[],signal?:AbortSignal):Promise<T>=>{
  const at=Date.now(),usage=rpc!.usage();
  need(at+1500<helperStartedAt+20000&&usage.newAccountedResponseBytes+2*MIB<=4*MIB,'INGUS_HELPER_SHUTDOWN_OR_RESPONSE_HEADROOM');
  need(process.memoryUsage().rss<=384*MIB,'INGUS_RSS_LIMIT');
  const value=await rpc!.call<T>(method,params,signal?AbortSignal.any([signal,controller.signal]):controller.signal,{timeoutMs:1500,latestStartAt:helperStartedAt+18500});
  record('ingus-rpc-evidence',{method,params,requestedAt:at,availableAt:Date.now(),value});return value;
 };
 origin=await recoverPilotOrigin(seed,{call},controller.signal,{responseBytes:()=>rpc!.usage().newAccountedResponseBytes});
 record('ingus-origin-result',origin);if(!origin.ok)failure=origin.reason;
}catch(error){failure=error instanceof Error?error.message:'INGUS_ORIGIN_UNAVAILABLE';}
finally{
 clearTimeout(wall);controller.abort();
 try{rpc?.close();settled=rpc?!rpc.usage().inFlight&&!rpc.usage().waitingOrOperating:physicalStarts===0;}catch{}
 if(rpc){const u=rpc.usage();manifest.baselinePaths=u.chapterPaths;manifest.cooldownUntil=u.cooldownUntil;manifest.controlCooldownUntil=Math.max(manifest.controlCooldownUntil??0,u.controlCooldownUntil);}
 if(settled)delete manifest.unresolvedResearch;persist();
 const receipt={schemaVersion:1,purpose:'One frozen independent INGUS lead→strict actual migration origin; index time only chooses bounded search',runId,seed,source,startedAt,helperStartedAt,finishedAt:Date.now(),elapsedMs:Date.now()-startedAt,helperLimits:PILOT_ORIGIN_RECOVERY_LIMITS,transportLimits:{units:24,maximumOuterMs:25000,maximumPerResponseBytes:2*MIB,actualResponseAndHeadroomCeilingBytes:4*MIB,conservativeAccountingCeilingBytes:8*MIB,minimumPhysicalSpacingMs:250,maximumStartsPerMinute:60,maximumStartsPer10Seconds:20,physicalInFlight:1,automaticRetries:0},origin,failure,physicalStarts,physicalSettled:settled,measuredBodyBytes:measuredBytes,retainedEventBytes:retained,usage:rpc?.usage()??null,originalPoolsUnchanged:true,financialDatabaseOpened:false,financialWriterOpened:false,productionChanged:false};
 const encoded=JSON.stringify(receipt,null,2)+'\n';need(retained+Buffer.byteLength(encoded)<=8*MIB,'INGUS_FINAL_EVIDENCE_CAP');writeFileSync(out+'/receipt.json',encoded,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({out,ok:origin?.ok??false,failure,physicalStarts,settled,units:rpc?.usage().newUnits,cumulativeUnits:rpc?.usage().cumulativeUnits,measuredBodyBytes:measuredBytes,elapsedMs:receipt.elapsedMs,identity:origin?.ok?{signature:origin.identity.signature,mint:origin.identity.baseMint,pool:origin.identity.pool,migrationAt:origin.identity.chainBlockTime*1000,availableAt:origin.identity.availableAt}:null}));
}
