/** Existing nonsecret local health read model. No ledger, provider or publisher. */
import {chmodSync,closeSync,lstatSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
export type PoePublicStatus={schemaVersion:1;project:'pump-opportunity-engine';mode:'PAPER';liveTrading:false;accountId:string;inceptionAt:string;release:string;strategy:string;generatedAt:string;lastUsefulProgressAt:string|null;usdPriceAt:string|null;lastReconciledAt:string|null;feedConnected:boolean;lastMigrationReceivedAt:string|null;shortlistCount:number;entriesDisabled:boolean;flowVerified:boolean;blocker:string|null;reportingConfigured:boolean};
const keys:readonly(keyof PoePublicStatus)[]=['schemaVersion','project','mode','liveTrading','accountId','inceptionAt','release','strategy','generatedAt','lastUsefulProgressAt','usdPriceAt','lastReconciledAt','feedConnected','lastMigrationReceivedAt','shortlistCount','entriesDisabled','flowVerified','blocker','reportingConfigured'];
/** Same ownership/path/4KiB policy as the original observer; callers supply
 * actual source timestamps and explicit entry permission, never a heartbeat age. */
export function writePoePublicStatus(input:{path:string;privateDirectory:string;status:PoePublicStatus}):boolean{
 let temp:string|undefined;
 try{
  const {path}=input;if(!isAbsolute(path)||basename(path)!=='status.json'||resolve(path)!==path)throw Error('PUBLIC_STATUS_PATH');
  const parent=dirname(path),dir=lstatSync(parent),owner=process.getuid?.(),privateRoot=realpathSync(input.privateDirectory);
  if(!dir.isDirectory()||dir.isSymbolicLink()||dir.uid!==owner||(dir.mode&0o777)!==0o755||realpathSync(parent)!==parent||parent===privateRoot||parent.startsWith(privateRoot+'/'))throw Error('PUBLIC_STATUS_DIRECTORY');
  try{const current=lstatSync(path);if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||current.uid!==owner||(current.mode&0o777)!==0o644||current.size>4096)throw Error('PUBLIC_STATUS_FILE');const prior=JSON.parse(readFileSync(path,'utf8'));if(prior.schemaVersion!==1||prior.project!=='pump-opportunity-engine'||prior.mode!=='PAPER'||prior.accountId!==input.status.accountId)throw Error('PUBLIC_STATUS_IDENTITY');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const body=JSON.stringify(Object.fromEntries(keys.map(k=>[k,input.status[k]])))+'\n';if(Buffer.byteLength(body)>4096)throw Error('PUBLIC_STATUS_SIZE');
  temp=resolve(parent,`.poe-status-${randomUUID()}.tmp`);const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,body);}finally{closeSync(fd);}chmodSync(temp,0o644);renameSync(temp,path);temp=undefined;return true;
 }catch{return false;}finally{if(temp)try{unlinkSync(temp);}catch{/* Remove only our unique failed staging path. */}}
}
