import {parentPort,type MessagePort} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {lstatSync,realpathSync} from 'node:fs';
import {MarketRegistry,isMarketRegistryContention} from './market-registry.js';
import {TOKEN_AGE_POLICY} from './token-age-policy.js';
import type {WatchSeed} from './pilot-watch.js';
import {readMarketRegistryReporting,validMarketRegistryReportingRequest,MARKET_REGISTRY_REPORTING_POLICY,type MarketRegistryReportingRequest,type MarketRegistryReportingResult} from './market-registry-reporting.js';
import {pumpSwapIntakeHint,type MarketIdentityHint,type MarketActivityHint,type MarketFeedStatus,type PumpSwapQualificationHint} from './market-discovery.js';

export const MARKET_REGISTRY_INTAKE_WORKER_KIND='poe-market-registry-intake-v1' as const;
export type MarketRegistryIntakeMessage={kind:'intake';id:number}&({operation:'identity';value:MarketIdentityHint}|{operation:'activity';value:MarketActivityHint}|{operation:'feed';value:MarketFeedStatus}|{operation:'migration';value:WatchSeed}|{operation:'qualification';value:PumpSwapQualificationHint});
export type MarketRegistryCommittedActivity={mint:string;at:number;evidence:string};
export type MarketRegistryLivenessRequest={kind:'liveness';id:number;workerGeneration:number;requestedAt:number};
export type MarketRegistryLivenessResult={kind:'liveness-result';id:number;workerGeneration:number;requestedAt:number;observedAt:number;pending:number;processedAcknowledged:number;contentions:number;lastCommitAt:number|null};
export type MarketRegistryIntakeOptions={path:string;maximumComputeMs?:number;pendingBytesBudget?:number;writerYieldMs?:number;writerTurn?:SharedArrayBuffer;enforceTokenAge24h?:true;enforceMigrationAge?:true};
export type MarketRegistryIntakePort=Pick<MessagePort,'on'|'postMessage'|'close'>;
/** Runs only inside the verified native-paper bundle's worker branch. This
 * module imports no financial ledger, provider, wallet, engine or order code.
 * The parent retains each normalized record until its durable ID is ACKed. */
export function startMarketRegistryIntakeWorker(options:MarketRegistryIntakeOptions,port:MarketRegistryIntakePort|null=parentPort){
 if(!port)throw Error('MARKET_INTAKE_WORKER_PORT_REQUIRED');
 const budget=options.pendingBytesBudget??32*1024*1024,computeMs=options.maximumComputeMs??10,yieldMs=options.writerYieldMs??3;
 if(!Number.isSafeInteger(budget)||budget<=0||!Number.isFinite(computeMs)||computeMs<=0||!Number.isFinite(yieldMs)||yieldMs<1)throw Error('MARKET_INTAKE_WORKER_RESOURCE_POLICY');
 // Only the existing nonfinancial discovery store is permitted. Validate before
 // opening SQLite so a wrong financial path cannot create or modify any file.
 if(!isAbsolute(options.path)||basename(options.path)!=='market-registry.sqlite'||resolve(options.path)!==options.path)throw Error('MARKET_INTAKE_NONFINANCIAL_PATH_REQUIRED');
 const directory=dirname(options.path),parent=lstatSync(directory),uid=process.geteuid?.()??process.getuid?.();
 if(!parent.isDirectory()||parent.isSymbolicLink()||realpathSync(directory)!==directory||parent.uid!==uid||(parent.mode&0o022)!==0)throw Error('MARKET_INTAKE_PRIVATE_DIRECTORY_REQUIRED');
 try{const file=lstatSync(options.path);if(!file.isFile()||file.isSymbolicLink()||file.uid!==uid||file.nlink!==1)throw Error('MARKET_INTAKE_PRIVATE_FILE_REQUIRED');}catch(error){if((error as {code?:unknown}).code!=='ENOENT')throw error;}
 const registry=new MarketRegistry(options.path,{concurrentIntake:true,writerRole:'intake',...(options.enforceMigrationAge?{migrationAge:true as const}:{}),...(options.writerTurn?{writerTurn:options.writerTurn}:{})});
 type Pending={message:MarketRegistryIntakeMessage;bytes:number};const queue:Array<Pending|undefined>=[];let head=0,pendingBytes=0,scheduled:ReturnType<typeof setTimeout>|null=null,closing=false,closed=false,fatal=false;
 let reporting:MarketRegistryReportingRequest|null=null,reportingTurn:ReturnType<typeof setImmediate>|null=null;
 let received=0,committed=0,processedAcknowledged=0,qualificationReceived=0,qualificationCommitted=0,ageExcluded=0,venueExcluded=0,batches=0,contentions=0,maximumBatchMs=0,maximumComputeObservedMs=0,lastCommitAt:number|null=null;
 const stats=()=>({received,committed,processedAcknowledged,qualificationReceived,qualificationCommitted,ageExcluded,venueExcluded,enforceTokenAge24h:options.enforceTokenAge24h===true,enforceMigrationAge:options.enforceMigrationAge===true,pending:queue.length-head,pendingBytes,pendingBytesBudget:budget,batches,contentions,maximumBatchMs,maximumComputeMs:maximumComputeObservedMs,lastCommitAt,registry:registry.health()});
 const send=(value:unknown)=>port.postMessage(value);
 const close=()=>{if(closed)return;closed=true;if(scheduled)clearTimeout(scheduled);scheduled=null;if(reportingTurn)clearImmediate(reportingTurn);reportingTurn=null;reporting=null;registry.close();send({kind:'closed',stats:stats()});port.close();};
 const schedule=()=>{if(!scheduled&&!closed&&!fatal)scheduled=setTimeout(pump,yieldMs);};
 const fail=(error:unknown)=>{fatal=true;const code=(error as {code?:unknown})?.code;send({kind:'failure',reasonCode:typeof code==='string'&&/^SQLITE_[A-Z_]+$/.test(code)?code:'MARKET_INTAKE_WORKER_FAILED',retryable:false,unacknowledgedTailRetainedByParent:true,stats:stats()});};
 // Optional diagnostics never precede an already queued durable intake ACK.
 // One coalesced request owns no writer lease. A report refusal affects only
 // that diagnostic sample and cannot fail, discard or acknowledge intake.
 const scheduleReporting=()=>{if(!reporting||reportingTurn||queue.length!==head||closing||closed||fatal)return;reportingTurn=setImmediate(()=>{
  reportingTurn=null;if(queue.length!==head||closing||closed||fatal||!reporting)return;
  const request=reporting;reporting=null;const observedAt=Date.now(),began=performance.now();let snapshot:MarketRegistryReportingResult['snapshot']=null,reasonCode:string|null=null;
  try{
   if(request.requestedAt>observedAt||request.scope.enforceMigrationAge!==(options.enforceMigrationAge===true)||request.scope.enforceTokenAge24h!==(options.enforceTokenAge24h===true||options.enforceMigrationAge===true))throw Error('REPORTING_SCOPE_UNAVAILABLE');
   snapshot=readMarketRegistryReporting(registry,request.scope,observedAt);
   if(Buffer.byteLength(JSON.stringify(snapshot))>MARKET_REGISTRY_REPORTING_POLICY.maximumResponseBytes){snapshot=null;reasonCode='REPORTING_RESPONSE_TOO_LARGE';}
  }catch(error){const code=(error as {code?:unknown})?.code;reasonCode=typeof code==='string'&&/^SQLITE_(BUSY|LOCKED)/.test(code)?'REPORTING_READ_BUSY':error instanceof Error&&['REPORTING_SCOPE_UNAVAILABLE','REPORTING_WATCH_STATE_UNAVAILABLE'].includes(error.message)?error.message:'REPORTING_READ_UNAVAILABLE';}
  const result:MarketRegistryReportingResult={kind:'reporting-result',id:request.id,requestedAt:request.requestedAt,observedAt,completedAt:Date.now(),durationMs:performance.now()-began,snapshot,reasonCode};send(result);
 });};
 function exclusion(message:MarketRegistryIntakeMessage):string|null{
  if(message.operation==='feed')return null;
  if(message.operation==='qualification')return pumpSwapIntakeHint(message.value)?null:'PUMPSWAP_VENUE_REQUIRED';
  if(!options.enforceTokenAge24h&&!options.enforceMigrationAge)return null;
  // Migration messages originate only from the migration feed, but still need
  // a proven mint. A signature or migration time is never a creation proof.
  if(message.operation!=='migration'&&!pumpSwapIntakeHint(message.value))return 'PUMPSWAP_VENUE_REQUIRED';
  const mint=message.operation==='migration'?message.value.feedMint:message.value.mint,receivedAt=message.value.receivedAt,at=Date.now();
  if(!Number.isSafeInteger(receivedAt)||receivedAt<0||receivedAt>at)return 'TOKEN_AGE_INVALID';
  if(!mint)return 'TOKEN_AGE_UNVERIFIED';
  // The registry validates the complete stored proof and its scalar binding.
  // Reuse that immutable proof for both clocks rather than decoding it twice.
  if(options.enforceMigrationAge){const received=registry.marketAgeEligibility(mint,receivedAt);if(!received.allowed)return received.reason;const current=registry.marketAgeEligibility(mint,at);return current.allowed?null:current.reason;}
  const proof=registry.tokenCreationProof(mint);if(!proof)return 'TOKEN_AGE_UNVERIFIED';
  if(proof.availableAt>receivedAt||proof.createdAt>receivedAt)return 'TOKEN_AGE_INVALID';
  return receivedAt-proof.createdAt>TOKEN_AGE_POLICY.maximumAgeMs||at-proof.createdAt>TOKEN_AGE_POLICY.maximumAgeMs?'TOKEN_AGE_EXCEEDS_24H':null;
 }
 function pump(){scheduled=null;if(closed||fatal)return;if(head===queue.length){if(closing)close();else scheduleReporting();return;}
  if(!closing&&registry.deferToMainWriter()){schedule();return;}
  const started=performance.now();let processed=0,computeElapsed=0,qualified=0;const activities=new Map<string,MarketRegistryCommittedActivity>(),excluded:Array<{id:number;reason:string}>=[];
  try{registry.transaction(()=>{const computeStarted=performance.now();
   while(head+processed<queue.length){const message=queue[head+processed]!.message;
    const reason=exclusion(message);
    if(reason)excluded.push({id:message.id,reason});
    else if(message.operation==='qualification'){registry.observePumpSwapQualificationHint(message.value);qualified++;}
    else if(message.operation==='identity')registry.observeIdentity(message.value);
    else if(message.operation==='activity'){if(registry.observeActivity(message.value)){const row=message.value,old=activities.get(row.mint);if(!old||old.at<row.receivedAt)activities.set(row.mint,{mint:row.mint,at:row.receivedAt,evidence:row.evidence});}}
    else if(message.operation==='migration')registry.enqueueMigrationDelivery(message.value);
    else registry.observeFeed(message.value);
    processed++;computeElapsed=performance.now()-computeStarted;if(computeElapsed>=computeMs)break;
   }
  });
  }catch(error){if(isMarketRegistryContention(error)){contentions++;schedule();return;}fail(error);return;}
  // Queue progress and ACKs happen only after FULL WAL COMMIT returned.
  const ids:number[]=[];for(let i=0;i<processed;i++){const item=queue[head+i]!;ids.push(item.message.id);pendingBytes-=item.bytes;queue[head+i]=undefined;}
  head+=processed;processedAcknowledged+=processed;committed+=processed-excluded.length;qualificationCommitted+=qualified;for(const row of excluded){if(row.reason==='PUMPSWAP_VENUE_REQUIRED')venueExcluded++;else ageExcluded++;}batches++;lastCommitAt=Date.now();maximumBatchMs=Math.max(maximumBatchMs,performance.now()-started);maximumComputeObservedMs=Math.max(maximumComputeObservedMs,computeElapsed);
  if(head===queue.length){queue.length=0;head=0;}else if(head>=1024&&head*2>=queue.length){queue.splice(0,head);head=0;}
  send({kind:'committed',ids,committedAt:lastCommitAt,eventCount:processed,excluded,activities:[...activities.values()],stats:stats()});
  if(queue.length>head||closing)schedule();else scheduleReporting();
 }
 port.on('message',(value:unknown)=>{if(closed||fatal)return;try{
  if(value&&typeof value==='object'&&(value as {kind?:unknown}).kind==='liveness'){
   const request=value as MarketRegistryLivenessRequest,observedAt=Date.now();
   if(Object.keys(request).sort().join(' ')!=='id kind requestedAt workerGeneration'||![request.id,request.workerGeneration,request.requestedAt].every(n=>Number.isSafeInteger(n)&&n>=0)||request.workerGeneration<1||request.requestedAt>observedAt)return;
   // This proves only that the actual worker serviced its port. It neither
   // reads SQLite nor acknowledges a durable intake ID or market observation.
   const result:MarketRegistryLivenessResult={kind:'liveness-result',id:request.id,workerGeneration:request.workerGeneration,requestedAt:request.requestedAt,observedAt,pending:queue.length-head,processedAcknowledged,contentions,lastCommitAt};send(result);return;
  }
  if(value&&typeof value==='object'&&(value as {kind?:unknown}).kind==='stop'){closing=true;schedule();return;}
  if(value&&typeof value==='object'&&(value as {kind?:unknown}).kind==='reporting'){if(validMarketRegistryReportingRequest(value)&&!closing){reporting=value;scheduleReporting();}return;}
  const message=value as MarketRegistryIntakeMessage;if(closing||!message||message.kind!=='intake'||!Number.isSafeInteger(message.id)||message.id<0||!['identity','activity','feed','migration','qualification'].includes(message.operation)||!message.value||typeof message.value!=='object')throw Error('MARKET_INTAKE_MESSAGE_INVALID');
  const bytes=Buffer.byteLength(JSON.stringify(message));queue.push({message,bytes});pendingBytes+=bytes;received++;if(message.operation==='qualification')qualificationReceived++;
  // A transport memory budget requests backpressure; it is not a token limit.
  // Already delivered records are retained and drained, never evicted.
  if(pendingBytes>=budget)send({kind:'backpressure',paused:true,pendingBytes,budgetBytes:budget});schedule();
 }catch(error){fail(error);}});
 send({kind:'ready',stats:stats()});return {stats,close:()=>{closing=true;schedule();}};
}
