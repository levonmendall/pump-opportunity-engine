import {constants,type Stats} from 'node:fs';
import {lstat,open,realpath,rename,unlink} from 'node:fs/promises';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {MarketRegistryIntakeMessage} from './market-registry-intake-worker.js';

export type MarketIntakeTailRow={message:MarketRegistryIntakeMessage;queuedAt:number};
const VERSION='native-market-intake-shutdown-tail-v1';
const MAXIMUM_BYTES=128*1024*1024;
const absent=(error:unknown)=>(error as {code?:unknown})?.code==='ENOENT';
const time=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
const name=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\u0000-\u001f]/.test(value);
const optionalName=(value:unknown)=>value===undefined||name(value);
function validMessage(message:any):message is MarketRegistryIntakeMessage {
 if(message?.kind!=='intake'||!Number.isSafeInteger(message.id)||message.id<1||!message.value||typeof message.value!=='object'||Array.isArray(message.value))return false;
 const row=message.value;if(message.operation==='migration')return name(row.signature)&&optionalName(row.feedMint)&&time(row.receivedAt);
 const source=['pumpportal-new-token','pumpportal-migration','pumpapi-broad'].includes(row.source);
 if(message.operation==='feed')return source&&time(row.at)&&typeof row.connected==='boolean'&&name(row.scope)&&(row.gapReason===undefined||typeof row.gapReason==='string');
 if(!source||!name(row.mint)||!time(row.receivedAt)||!optionalName(row.signature))return false;
 if(message.operation==='qualification')return row.source==='pumpportal-migration'&&row.kind==='migration'||row.source==='pumpapi-broad'&&row.kind==='activity'&&row.venue==='pump-amm';
 if(!['creation','migration','activity'].includes(row.kind)||!optionalName(row.pool)||!optionalName(row.venue))return false;
 if(message.operation==='identity')return row.evidence==='unverified-provider-discovery-hint';
 return message.operation==='activity'&&row.evidence==='unverified-provider-activity-hint'&&(row.side===undefined||row.side==='buy'||row.side==='sell')&&optionalName(row.quoteMint)&&(row.quoteLamports===undefined||typeof row.quoteLamports==='string'&&/^\d+$/.test(row.quoteLamports))&&(row.tokenAmount===undefined||typeof row.tokenAmount==='string')&&(row.price===undefined||typeof row.price==='number'&&Number.isFinite(row.price));
}
const sameFile=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.uid===b.uid&&a.mode===b.mode&&a.nlink===b.nlink&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
function validRows(rows:unknown):asserts rows is MarketIntakeTailRow[]{if(!Array.isArray(rows))throw Error('MARKET_INTAKE_SPOOL_CONTENT');const ids=new Set<number>();for(const row of rows){const message=row?.message;if(!time(row?.queuedAt)||!validMessage(message)||ids.has(message.id))throw Error('MARKET_INTAKE_SPOOL_CONTENT');ids.add(message.id);}}
/** A graceful-stop handoff, not a journal of live network receipts. It owns no
 * financial file and preserves the original evidence clocks for revalidation. */
export class NativeMarketIntakeSpool {
 constructor(private readonly path:string){if(!isAbsolute(path)||resolve(path)!==path||basename(path)!=='market-intake-tail.json')throw Error('MARKET_INTAKE_SPOOL_PATH');}
 private async directory(){const path=dirname(this.path),stat=await lstat(path),uid=process.geteuid?.()??process.getuid?.();if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(path)!==path||stat.uid!==uid||(stat.mode&0o022)!==0)throw Error('MARKET_INTAKE_SPOOL_DIRECTORY');return path;}
 private validFile(stat:Stats){if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==(process.geteuid?.()??process.getuid?.())||(stat.mode&0o777)!==0o600)throw Error('MARKET_INTAKE_SPOOL_FILE');}
 private async syncDirectory(directory:string){const handle=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}}
 async load():Promise<MarketIntakeTailRow[]>{
  await this.directory();let handle,named:Stats;try{named=await lstat(this.path);this.validFile(named);handle=await open(this.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(absent(error))return [];throw error;}
  try{const stat=await handle.stat();this.validFile(stat);if(!sameFile(stat,named))throw Error('MARKET_INTAKE_SPOOL_CHANGED');if(stat.size>MAXIMUM_BYTES)throw Error('MARKET_INTAKE_SPOOL_SIZE');const raw=Buffer.alloc(stat.size+1);let length=0;while(length<raw.length){const {bytesRead}=await handle.read(raw,length,raw.length-length,null);if(!bytesRead)break;length+=bytesRead;}if(length!==stat.size||!sameFile(stat,await handle.stat())||!sameFile(stat,await lstat(this.path)))throw Error('MARKET_INTAKE_SPOOL_CHANGED');const value=JSON.parse(raw.subarray(0,length).toString('utf8')) as {version?:unknown;rows?:unknown};if(value.version!==VERSION)throw Error('MARKET_INTAKE_SPOOL_CONTENT');validRows(value.rows);return value.rows;}finally{await handle.close();}
 }
 async save(rows:MarketIntakeTailRow[]){
  validRows(rows);const raw=Buffer.from(JSON.stringify({version:VERSION,rows}));if(raw.length>MAXIMUM_BYTES)throw Error('MARKET_INTAKE_SPOOL_SIZE');
  const directory=await this.directory();try{this.validFile(await lstat(this.path));}catch(error){if(!absent(error))throw error;}
  const temporary=this.path+'.'+randomUUID()+'.tmp',handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let renamed=false;
  try{await handle.writeFile(raw);await handle.sync();await handle.close();await rename(temporary,this.path);renamed=true;await this.syncDirectory(directory);}finally{await handle.close().catch(()=>{});if(!renamed)await unlink(temporary).catch(()=>{});}
 }
 async clear(){const directory=await this.directory();try{this.validFile(await lstat(this.path));await unlink(this.path);await this.syncDirectory(directory);}catch(error){if(!absent(error))throw error;}}
}
