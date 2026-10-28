/** Independent read-only file publisher for the one original snapshot channel.
 * Import graph is reporting/validation only: no ledger, execution or providers. */
import {constants,openSync,closeSync,fstatSync,readFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {SnapshotPublisher,validateSnapshot,type ReportingIdentity,type SnapshotAcknowledgement} from './reporting.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from './operating-intelligence.js';
export const ORIGINAL_SNAPSHOT_URL='https://meme-machine-dashboard-staging.onrender.com/api/snapshot';
export type SnapshotFilePublisherArguments={file:string;identity:ReportingIdentity;watch:true};
export function snapshotFilePublisherArguments(args:string[]):SnapshotFilePublisherArguments{
 const values=new Map<string,string>();let watch=false;
 for(let i=0;i<args.length;i++){const key=args[i]!;if(key==='--watch'){if(watch)throw Error('PUBLISHER_DUPLICATE_ARGUMENT');watch=true;continue;}if(!['--file','--account-id','--inception-at','--release','--strategy'].includes(key)||values.has(key))throw Error('PUBLISHER_ARGUMENT');const value=args[++i];if(!value||value.startsWith('--'))throw Error('PUBLISHER_ARGUMENT_VALUE');values.set(key,value);}
 const file=values.get('--file')??'',identity={accountId:values.get('--account-id')??'',inceptionAt:values.get('--inception-at')??'',release:values.get('--release')??'',strategy:values.get('--strategy')??''};
 if(!watch||values.size!==5||!isAbsolute(file)||resolve(file)!==file||basename(file)!=='snapshot.json'||identity.accountId!==ORIGINAL_POE_ACCOUNT||identity.inceptionAt!==ORIGINAL_POE_INCEPTION||!/^[a-f0-9]{40}$/.test(identity.release)||!identity.strategy||identity.strategy.length>128||/[\u0000-\u001f]/.test(identity.strategy))throw Error('PUBLISHER_EXACT_ORIGINAL_BINDING_REQUIRED');return {file,identity,watch:true};
}
function privateRead(path:string,maximum:number,credential=false){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const a=fstatSync(fd),uid=process.getuid?.();if(!a.isFile()||a.nlink!==1||a.size<=0||a.size>maximum||(a.mode&0o077)!==0||a.uid!==uid&&!(credential&&a.uid===0))throw Error('PRIVATE_PUBLISHER_FILE');const raw=readFileSync(fd),b=fstatSync(fd);if(raw.length!==a.size||a.ino!==b.ino||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs)throw Error('PUBLISHER_FILE_CHANGED');return raw;}finally{closeSync(fd);}
}
export function publisherCredentialPath(env:NodeJS.ProcessEnv){
 const directory=env.CREDENTIALS_DIRECTORY,explicit=env.POE_PUBLISH_SECRET_FILE;
 const path=explicit??(directory?join(directory,'poe-ingest-secret'):null);
 if(!path||!isAbsolute(path)||resolve(path)!==path||path!=='/etc/poe/secrets/ingest-secret'&&!(directory&&isAbsolute(directory)&&resolve(directory)===directory&&dirname(path)===directory&&basename(path)==='poe-ingest-secret'))throw Error('ORIGINAL_PUBLISHER_CREDENTIAL_BINDING_REQUIRED');return path;
}
export function readPublisherCredential(env:NodeJS.ProcessEnv){const raw=privateRead(publisherCredentialPath(env),4096,true),secret=raw.toString('utf8').trim();if(!/^[A-Za-z0-9._~+/=-]{24,512}$/.test(secret))throw Error('ORIGINAL_PUBLISHER_CREDENTIAL_FORMAT');return secret;}
export function readSnapshotFile(file:string,identity:ReportingIdentity){return validateSnapshot(JSON.parse(privateRead(file,128*1024).toString('utf8')),identity);}
export class SnapshotFilePublisher{
 private timer:ReturnType<typeof setTimeout>|undefined;private running=false;private lastOfferAt=-Infinity;private sourceAvailability:boolean|null=null;
 private readonly publisher:SnapshotPublisher;
 constructor(private readonly options:{file:string;identity:ReportingIdentity;secret:string;fetch?:typeof fetch;now?:()=>number;monotonic?:()=>number;pollMs?:number;offerMs?:number;publishIntervalMs?:number;onAcknowledgement?:(ack:SnapshotAcknowledgement)=>void;onSourceState?:(value:{sourceAvailable:boolean;at:number;reason:string|null})=>void}){
  this.publisher=new SnapshotPublisher({url:ORIGINAL_SNAPSHOT_URL,secret:options.secret,identity:options.identity,intervalMs:options.publishIntervalMs??15000,timeoutMs:5000,maxBackoffMs:60000,fetch:options.fetch,onAcknowledgement:options.onAcknowledgement??(()=>{})});
  if(!Number.isSafeInteger(options.pollMs??1000)||(options.pollMs??1000)<10||!Number.isSafeInteger(options.offerMs??15000)||(options.offerMs??15000)<10)throw Error('PUBLISHER_CADENCE');
 }
 private inspect(){if(!this.running)return;const at=(this.options.now??Date.now)(),mono=(this.options.monotonic??(()=>performance.now()))();try{const snapshot=readSnapshotFile(this.options.file,this.options.identity);if(mono-this.lastOfferAt>=(this.options.offerMs??15000)){this.publisher.offer(snapshot);this.lastOfferAt=mono;}if(this.sourceAvailability!==true){this.sourceAvailability=true;this.options.onSourceState?.({sourceAvailable:true,at,reason:null});}}catch{if(this.sourceAvailability!==false){this.sourceAvailability=false;this.options.onSourceState?.({sourceAvailable:false,at,reason:'verified_snapshot_unavailable'});}}finally{if(this.running){this.timer=setTimeout(()=>this.inspect(),this.options.pollMs??1000);this.timer.unref();}}}
 start(){if(this.running)return;this.running=true;this.inspect();this.publisher.start();}
 async stop(){this.running=false;clearTimeout(this.timer);await this.publisher.stop();}
 metrics(){return {...this.publisher.metrics,sourceAvailable:this.sourceAvailability};}
}
export async function runSnapshotFilePublisher(args=process.argv.slice(2),env=process.env){
 if(process.getuid?.()===0)throw Error('PUBLISHER_NONROOT_REQUIRED');const settings=snapshotFilePublisherArguments(args),secret=readPublisherCredential(env);
 const write=(value:unknown)=>{process.stdout.write(JSON.stringify(value)+'\n');};
 const publisher=new SnapshotFilePublisher({...settings,secret,onAcknowledgement:write,onSourceState:write});
 let stopped=false;const stop=()=>{stopped=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);publisher.start();
 try{while(!stopped)await new Promise<void>(r=>setTimeout(r,250));}finally{await publisher.stop();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}return publisher.metrics();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runSnapshotFilePublisher().catch(()=>{process.stderr.write('POE original snapshot publisher unavailable\n');process.exitCode=1;});
