import {parentPort,type MessagePort} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {lstatSync,realpathSync} from 'node:fs';
import {MarketRegistry,isMarketRegistryContention} from './market-registry.js';
import type {WatchSeed} from './pilot-watch.js';
import type {MarketIdentityHint,MarketActivityHint,MarketFeedStatus} from './market-discovery.js';

export const MARKET_REGISTRY_INTAKE_WORKER_KIND='poe-market-registry-intake-v1' as const;
export type MarketRegistryIntakeMessage={kind:'intake';id:number}&({operation:'identity';value:MarketIdentityHint}|{operation:'activity';value:MarketActivityHint}|{operation:'feed';value:MarketFeedStatus}|{operation:'migration';value:WatchSeed});
export type MarketRegistryCommittedActivity={mint:string;at:number;evidence:string};
export type MarketRegistryIntakeOptions={path:string;maximumComputeMs?:number;pendingBytesBudget?:number;writerYieldMs?:number;writerTurn?:SharedArrayBuffer};
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
 const registry=new MarketRegistry(options.path,{concurrentIntake:true,writerRole:'intake',...(options.writerTurn?{writerTurn:options.writerTurn}:{})});
 type Pending={message:MarketRegistryIntakeMessage;bytes:number};const queue:Array<Pending|undefined>=[];let head=0,pendingBytes=0,scheduled:ReturnType<typeof setTimeout>|null=null,closing=false,closed=false,fatal=false;
 let received=0,committed=0,batches=0,contentions=0,maximumBatchMs=0,maximumComputeObservedMs=0,lastCommitAt:number|null=null;
 const stats=()=>({received,committed,pending:queue.length-head,pendingBytes,pendingBytesBudget:budget,batches,contentions,maximumBatchMs,maximumComputeMs:maximumComputeObservedMs,lastCommitAt,registry:registry.health()});
 const send=(value:unknown)=>port.postMessage(value);
 const close=()=>{if(closed)return;closed=true;if(scheduled)clearTimeout(scheduled);scheduled=null;registry.close();send({kind:'closed',stats:stats()});port.close();};
 const schedule=()=>{if(!scheduled&&!closed&&!fatal)scheduled=setTimeout(pump,yieldMs);};
 const fail=(error:unknown)=>{fatal=true;const code=(error as {code?:unknown})?.code;send({kind:'failure',reasonCode:typeof code==='string'&&/^SQLITE_[A-Z_]+$/.test(code)?code:'MARKET_INTAKE_WORKER_FAILED',retryable:false,unacknowledgedTailRetainedByParent:true,stats:stats()});};
 function pump(){scheduled=null;if(closed||fatal)return;if(head===queue.length){if(closing)close();return;}
  if(!closing&&registry.deferToMainWriter()){schedule();return;}
  const started=performance.now();let processed=0,computeElapsed=0;const activities=new Map<string,MarketRegistryCommittedActivity>();
  try{registry.transaction(()=>{const computeStarted=performance.now();
   while(head+processed<queue.length){const message=queue[head+processed]!.message;
    if(message.operation==='identity')registry.observeIdentity(message.value);
    else if(message.operation==='activity'){if(registry.observeActivity(message.value)){const row=message.value,old=activities.get(row.mint);if(!old||old.at<row.receivedAt)activities.set(row.mint,{mint:row.mint,at:row.receivedAt,evidence:row.evidence});}}
    else if(message.operation==='migration')registry.enqueueMigrationDelivery(message.value);
    else registry.observeFeed(message.value);
    processed++;computeElapsed=performance.now()-computeStarted;if(computeElapsed>=computeMs)break;
   }
  });
  }catch(error){if(isMarketRegistryContention(error)){contentions++;schedule();return;}fail(error);return;}
  // Queue progress and ACKs happen only after FULL WAL COMMIT returned.
  const ids:number[]=[];for(let i=0;i<processed;i++){const item=queue[head+i]!;ids.push(item.message.id);pendingBytes-=item.bytes;queue[head+i]=undefined;}
  head+=processed;committed+=processed;batches++;lastCommitAt=Date.now();maximumBatchMs=Math.max(maximumBatchMs,performance.now()-started);maximumComputeObservedMs=Math.max(maximumComputeObservedMs,computeElapsed);
  if(head===queue.length){queue.length=0;head=0;}else if(head>=1024&&head*2>=queue.length){queue.splice(0,head);head=0;}
  send({kind:'committed',ids,committedAt:lastCommitAt,eventCount:processed,activities:[...activities.values()],stats:stats()});
  if(queue.length>head||closing)schedule();
 }
 port.on('message',(value:unknown)=>{if(closed||fatal)return;try{
  if(value&&typeof value==='object'&&(value as {kind?:unknown}).kind==='stop'){closing=true;schedule();return;}
  const message=value as MarketRegistryIntakeMessage;if(closing||!message||message.kind!=='intake'||!Number.isSafeInteger(message.id)||message.id<0||!['identity','activity','feed','migration'].includes(message.operation)||!message.value||typeof message.value!=='object')throw Error('MARKET_INTAKE_MESSAGE_INVALID');
  const bytes=Buffer.byteLength(JSON.stringify(message));queue.push({message,bytes});pendingBytes+=bytes;received++;
  // A transport memory budget requests backpressure; it is not a token limit.
  // Already delivered records are retained and drained, never evicted.
  if(pendingBytes>=budget)send({kind:'backpressure',paused:true,pendingBytes,budgetBytes:budget});schedule();
 }catch(error){fail(error);}});
 send({kind:'ready',stats:stats()});return {stats,close:()=>{closing=true;schedule();}};
}
