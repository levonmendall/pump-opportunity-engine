/** Private, one-use operator executable; importing this file performs no work. */
import {createHash} from 'node:crypto';
import {constants,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {hostname} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PaperLedger} from '../../src/ledger.js';
import {PilotRpc} from '../../src/pilot-rpc.js';
import {PAPER_SERVICE_POLICY} from '../../src/paper-service-policy.js';
import {POE_OPERATING_ACCOUNT} from '../../src/poe-operating-account.js';
import {PUBLICNODE_HISTORY_ROUTE} from '../../src/component-transport.js';
import type {VerifiedMarketPool} from '../../src/rpc-market.js';
import {executeAuthorizedManualClose,manualCloseSha256,manualCloseStateSummary,validateManualCloseAuthorization,type ManualCloseClaim,type ManualCloseResult} from './manual-close.js';

const MIB=1024*1024;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function need(value:unknown,reason:string):asserts value{if(!value)throw Error('MANUAL_CLOSE_'+reason);}
export function parseManualCloseArguments(args:readonly string[]){
 const allowed=new Set(['--authorization','--authorization-sha256','--operating-directory','--ledger','--output-directory']),values=new Map<string,string>();
 need(args.length===10,'EXACT_ARGUMENTS');for(let i=0;i<args.length;i+=2){const key=args[i]!,value=args[i+1];need(allowed.has(key)&&!values.has(key)&&value&&!value.startsWith('--'),'EXACT_ARGUMENTS');values.set(key,value);}
 need(/^[a-f0-9]{64}$/.test(values.get('--authorization-sha256')!),'EXTERNAL_AUTHORIZATION_DIGEST');
 return {authorization:resolve(values.get('--authorization')!),authorizationSha256:values.get('--authorization-sha256')!,directory:resolve(values.get('--operating-directory')!),ledger:resolve(values.get('--ledger')!),output:resolve(values.get('--output-directory')!)};
}
function directory(path:string){const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===988&&s.gid===982&&(s.mode&0o077)===0&&realpathSync(path)===path,'PRIVATE_DIRECTORY');}
function file(path:string,max:number,allowRoot=false){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=fstatSync(fd);need(s.isFile()&&s.nlink===1&&s.size>0&&s.size<=max&&realpathSync(path)===path&&((s.uid===988&&(s.mode&0o077)===0)||(allowRoot&&s.uid===0&&s.gid===982&&(s.mode&0o037)===0)),'PRIVATE_BOUNDED_FILE');const raw=readFileSync(fd);need(raw.length===s.size,'FILE_CHANGED');return raw;}finally{closeSync(fd);}
}
function syncDirectory(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function exclusive(path:string,value:unknown){const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,JSON.stringify(value)+'\n');fsyncSync(fd);}finally{closeSync(fd);}syncDirectory(dirname(path));}
function replace(path:string,value:unknown){const temp=path+'.manual-close-'+process.pid;exclusive(temp,value);renameSync(temp,path);syncDirectory(dirname(path));}
function errorCode(error:unknown){const value=error instanceof Error?error.message:'';return /^MANUAL_CLOSE_[A-Z0-9_]+$/.test(value)?value:'MANUAL_CLOSE_OPERATION_UNAVAILABLE';}
export function validateManualCloseManifest(manifest:any,a:{accountId:string;inceptionAt:number},runId:string){
 // Native recovery permits up to192 retained run references (including a
 // checkpoint-pinned older run). The next ordinary startup performs its own
 // normal archive; this helper neither truncates nor manufactures that history.
 need(manifest?.schemaVersion===1&&manifest.experimental===false&&manifest.authoritative===true&&manifest.accountId===a.accountId&&manifest.inceptionAt===a.inceptionAt&&Array.isArray(manifest.baselinePaths)&&manifest.baselinePaths.length>0&&Array.isArray(manifest.runs)&&manifest.runs.length<192&&new Set(manifest.runs).size===manifest.runs.length&&manifest.runs.every((r:unknown)=>typeof r==='string'&&/^native-paper-\d{17}$/.test(r))&&!manifest.runs.includes(runId),'ORIGINAL_OPERATING_MANIFEST');
 need(!manifest.unresolvedResearch,'PRIOR_PHYSICAL_SETTLEMENT_UNRESOLVED');
}
export async function runManualCloseCli(args:readonly string[]){
 const p=parseManualCloseArguments(args);need(process.getuid?.()===988&&process.getgid?.()===982,'BACKEND_UID_GID_REQUIRED');
 need(p.ledger===POE_OPERATING_ACCOUNT.ledgerPath,'ORIGINAL_LEDGER_PATH');directory(p.directory);directory(join(p.directory,'runs'));
 const raw=file(p.authorization,64*1024,true);need(digest(raw)===p.authorizationSha256,'AUTHORIZATION_FILE_DIGEST');const authorization:unknown=JSON.parse(raw.toString('utf8'));validateManualCloseAuthorization(authorization);const a=authorization;
 const runId=basename(p.output);need(/^native-paper-\d{17}$/.test(runId)&&p.output===join(p.directory,'runs',runId)&&!existsSync(p.output),'NEW_NATIVE_RUN_DIRECTORY');
 const n=runId.slice(13),runAt=Date.UTC(Number(n.slice(0,4)),Number(n.slice(4,6))-1,Number(n.slice(6,8)),Number(n.slice(8,10)),Number(n.slice(10,12)),Number(n.slice(12,14)),Number(n.slice(14,17)));need(new Date(runAt).toISOString().replace(/[^0-9]/g,'')===n&&runAt>=a.issuedAt&&runAt<=Date.now(),'RUN_TIME_BINDING');
 const ls=lstatSync(p.ledger,{bigint:true});need(ls.isFile()&&!ls.isSymbolicLink()&&ls.uid===988n&&ls.gid===982n&&(ls.mode&0o077n)===0n&&ls.nlink===1n&&ls.dev.toString()===a.ledgerDevice&&ls.ino.toString()===a.ledgerInode&&realpathSync(p.ledger)===p.ledger,'EXISTING_LEDGER_INODE');
 const manifestPath=join(p.directory,'operating.json');let manifestRaw=file(manifestPath,8*MIB),manifest:any=JSON.parse(manifestRaw.toString('utf8'));
 validateManualCloseManifest(manifest,a,runId);
 const poolRecord=manifest.pools?.[a.mint],proof=poolRecord?.currentPoolProof;
 need(poolRecord?.identity?.baseMint===a.mint&&poolRecord.identity.pool===a.pool&&proof?.mint===a.mint&&proof.pool===a.pool,'EXISTING_POOL_PROOF');
 const pool:VerifiedMarketPool={basis:'current-canonical-pool',mint:proof.mint,pool:proof.pool,sourceSlot:proof.sourceSlot,verifiedAt:proof.verifiedAt,evidence:proof.evidence};
 mkdirSync(p.output,{mode:0o700});syncDirectory(dirname(p.output));
 const eventFd=openSync(join(p.output,'manual-close-events.ndjson'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let bytes=0;
 const record=(kind:string,data:unknown)=>{const line=JSON.stringify({at:Date.now(),kind,data})+'\n';need(Buffer.byteLength(line)<=8*MIB&&bytes+Buffer.byteLength(line)<=32*MIB,'EVIDENCE_BOUND');writeFileSync(eventFd,line);fsyncSync(eventFd);bytes+=Buffer.byteLength(line);};
 const persistManifest=()=>{need(digest(file(manifestPath,8*MIB))===digest(manifestRaw),'MANIFEST_CHANGED_DURING_OWNERSHIP');replace(manifestPath,manifest);manifestRaw=file(manifestPath,8*MIB);};
 let ledger:PaperLedger|undefined,rpc:PilotRpc|undefined,result:ManualCloseResult|null=null,failure:string|null=null,physicalSettled=true,accountingLinked=true,after:ReturnType<typeof manualCloseStateSummary>|null=null;
 const startedAt=Date.now();
 try{
  ledger=new PaperLedger(p.ledger,a.accountId);const same=lstatSync(p.ledger,{bigint:true});need(same.dev===ls.dev&&same.ino===ls.ino,'LEDGER_INODE_CHANGED');
  const claims=join(p.directory,'manual-close-authorizations');if(!existsSync(claims)){mkdirSync(claims,{mode:0o700});syncDirectory(p.directory);}directory(claims);
  const claim=(proposed:ManualCloseClaim)=>{const path=join(claims,a.authorizationId+'.json');if(existsSync(path))return {created:false,claim:JSON.parse(file(path,256*1024).toString('utf8')) as ManualCloseClaim};exclusive(path,proposed);return {created:true,claim:proposed};};
  const financialOwner=ledger;
  result=await executeAuthorizedManualClose({ledger:financialOwner,authorization:a,authorizationSha256:p.authorizationSha256,pool,knownRunIds:manifest.runs,claim,record,rpc:()=>{
   need(!rpc,'RPC_SINGLE_OWNER');manifest.runs.push(runId);manifest.unresolvedResearch={runId,rpcDirectory:join(p.output,'rpc'),pid:process.pid,sourceHost:hostname()};manifest.manualPaperClose={schemaVersion:1,kind:'owner-authorized-one-use-paper-close',authorizationId:a.authorizationId,authorizationSha256:p.authorizationSha256,runId,startedAt,financialAccountPreserved:true};persistManifest();accountingLinked=false;
   rpc=new PilotRpc({directory:join(p.output,'rpc'),runId,baselinePaths:manifest.baselinePaths,baselineCheckpointSha256:manifest.baselineCheckpointSha256,priorPhysicalSettled:true,priorCooldownUntil:Math.max(manifest.cooldownUntil??0,manifest.controlCooldownUntil??0,manifest.historyCooldownUntil??0),historyRoute:PUBLICNODE_HISTORY_ROUTE.version,priorHistoryCooldownUntil:manifest.historyCooldownUntil??0,persistent:false,profile:PAPER_SERVICE_POLICY.rpcProfile,maxStartsPerMinute:PAPER_SERVICE_POLICY.rpcStartsPerMinute,maxStartsPer10s:20,maxGetTransactionStartsPer10s:8,durationMs:30000,maxUnits:12,maxResponseBytes:32*MIB,chapterMs:30000,chapterUnits:12,maxChapters:1,record});return rpc;
  }});
 }catch(error){failure=errorCode(error);try{record('manual-paper-close-failure',{reasonCode:failure,errorSha256:manualCloseSha256(error instanceof Error?error.message:'unknown'),noRetry:true});}catch{/* The normal financial journal and unresolved accounting marker remain authoritative. */}}
 finally{
  // An abort is not physical settlement. Keep the writer until every accounted
  // provider operation finishes; a timeout retains the unresolved native marker.
  if(rpc){const until=Date.now()+10000;while((rpc.usage().inFlight||rpc.usage().waitingOrOperating)&&Date.now()<until)await new Promise<void>(r=>setTimeout(r,50));physicalSettled=rpc.usage().inFlight===0&&!rpc.usage().waitingOrOperating;
   if(physicalSettled)try{rpc.close();const u=rpc.usage();need(manifest.unresolvedResearch?.runId===runId&&manifest.unresolvedResearch.pid===process.pid,'OWN_ACCOUNTING_MARKER_CHANGED');manifest.baselinePaths=[...u.recoveryBaselinePaths];manifest.baselineCheckpointSha256=u.recoveryBaselineCheckpointSha256??undefined;manifest.serviceAccounting=true;manifest.cooldownUntil=Math.max(manifest.cooldownUntil??0,u.cooldownUntil);manifest.controlCooldownUntil=Math.max(manifest.controlCooldownUntil??0,u.controlCooldownUntil);manifest.historyCooldownUntil=Math.max(manifest.historyCooldownUntil??0,u.historyCooldownUntil);delete manifest.unresolvedResearch;manifest.manualPaperClose={...manifest.manualPaperClose,completedAt:Date.now(),physicalSettlementConfirmed:true,orderId:result?.orderId??null,outcome:result?.executionReceipt?.status??null};persistManifest();accountingLinked=true;}catch(error){failure??=errorCode(error);}
  }
  if(ledger){try{after=manualCloseStateSummary(ledger.state());}catch{}ledger.close();}
  try{fsyncSync(eventFd);}finally{closeSync(eventFd);}
 }
 const witness={schemaVersion:1,kind:'owner-authorized-manual-paper-close-result',runId,startedAt,completedAt:Date.now(),authorizationId:a.authorizationId,authorizationSha256:p.authorizationSha256,ledgerIdentity:{path:p.ledger,device:a.ledgerDevice,inode:a.ledgerInode},result,after,failure,physicalSettlementConfirmed:physicalSettled,accountingLinked,rpc:rpc?.usage()??null,sourceProof:{installedSource:a.installedSource,executionSource:a.executionSource},newEntryPermissionGranted:false,liveTransactionSubmitted:false};
 exclusive(join(p.output,'result.json'),witness);exclusive(join(p.output,'settlement.json'),{at:Date.now(),runId,physicalSettlementConfirmed:physicalSettled,accountingLinked,financialHistoryPreserved:true,positions:after?Object.keys(after.positions).length:null,pending:after?Object.keys(after.pending).length:null});
 const success=!failure&&physicalSettled&&accountingLinked&&result?.flat===true&&result.executionReceipt?.status==='filled';
 return {success,witness,resultPath:join(p.output,'result.json')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runManualCloseCli(process.argv.slice(2)).then(({success,witness,resultPath})=>{console.log(JSON.stringify({success,resultPath,authorizationId:witness.authorizationId,outcome:witness.result?.executionReceipt?.status??null,flat:witness.result?.flat??false,physicalSettlementConfirmed:witness.physicalSettlementConfirmed,accountingLinked:witness.accountingLinked,failure:witness.failure}));process.exitCode=success?0:2;},error=>{console.error(JSON.stringify({success:false,reasonCode:errorCode(error)}));process.exitCode=2;});
}
