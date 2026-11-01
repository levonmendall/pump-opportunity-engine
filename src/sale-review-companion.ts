/** Independent reporting process. Never imports PaperLedger or a trading controller. */
import Database from 'better-sqlite3';
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ReadOnlyRpc} from './network.js';
import {POE_OPERATING_ACCOUNT} from './poe-operating-account.js';
import {SaleReviewStore} from './sale-review-store.js';
import {SaleReviewCompanion} from './sale-review-worker.js';
import {saleReviewPriceReader} from './sale-review-price.js';
import {readSaleReviewSales} from './sale-review-source.js';
const DIRECTORY='/var/lib/poe/sale-reviews';
function credential(path:string){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=fstatSync(fd),systemd=path==='/run/credentials/poe-sale-reviews.service/poe-ingest-secret'&&stat.uid===0&&stat.gid===0&&(stat.mode&0o7777)===0o440;
  if(!stat.isFile()||stat.nlink!==1||stat.size<24||stat.size>4096||!systemd&&(![0,process.getuid?.()].includes(stat.uid)||(stat.mode&0o077)!==0))throw Error('SALE_REVIEW_CREDENTIAL_FILE');
  const result=readFileSync(fd,'utf8').trim();if(!/^[A-Za-z0-9._~+/=-]{24,512}$/.test(result))throw Error('SALE_REVIEW_CREDENTIAL_FORMAT');return result;
 }finally{closeSync(fd);}
}
function privateDirectory(path:string){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('SALE_REVIEW_PRIVATE_DIRECTORY_REQUIRED');}
function lease(path:string){const fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o7777)!==0o600||spawnSync('/usr/bin/flock',['-xn','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000}).status!==0)throw Error('SALE_REVIEW_OWNER_EXISTS');return fd;}catch(e){closeSync(fd);throw e;}}
export async function runSaleReviewCompanion(env=process.env){
 if(process.getuid?.()===0)throw Error('SALE_REVIEW_NONROOT_REQUIRED');process.umask(0o077);
 const directory=env.POE_SALE_REVIEW_DIRECTORY??DIRECTORY;
 if(!isAbsolute(directory)||resolve(directory)!==directory||directory!==DIRECTORY)throw Error('SALE_REVIEW_DIRECTORY_BINDING');privateDirectory(directory);
 const owner=lease(join(directory,'owner.lock'));let source:Database.Database|undefined,reporting:Database.Database|undefined;
 try{
  const path=POE_OPERATING_ACCOUNT.ledgerPath,stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('SALE_REVIEW_LEDGER_FILE');
  source=new Database(path,{readonly:true,fileMustExist:true,timeout:100});source.pragma('query_only=ON');
  const storePath=join(directory,'reviews.sqlite');try{const s=lstatSync(storePath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('SALE_REVIEW_STORE_FILE');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  reporting=new Database(storePath,{timeout:100});const store=new SaleReviewStore(reporting,POE_OPERATING_ACCOUNT.accountId,POE_OPERATING_ACCOUNT.inceptionAt);
  const endpoint=env.POE_SALE_REVIEW_RPC_URL??env.POE_RPC_URL;if(!endpoint)throw Error('SALE_REVIEW_EXISTING_RPC_REQUIRED');
  const secretPath=env.POE_SALE_REVIEW_CREDENTIAL_FILE??join(env.CREDENTIALS_DIRECTORY??'/run/credentials/poe-sale-reviews.service','poe-ingest-secret');
  if(!isAbsolute(secretPath)||resolve(secretPath)!==secretPath)throw Error('SALE_REVIEW_CREDENTIAL_PATH');
  const rpc=new ReadOnlyRpc(endpoint,fetch,{profile:'runtime',maxInFlight:1,timeoutMs:5000});
  const secret=credential(secretPath);
  if(env.POE_SALE_REVIEW_CHECK_ONLY==='1'){readSaleReviewSales(source,{accountId:store.accountId,inceptionAt:store.inceptionAt},store.cursor(),Date.now(),1);process.stdout.write('POE_SALE_REVIEW_PREFLIGHT_OK\n');return;}
  const worker=new SaleReviewCompanion(store,source,saleReviewPriceReader(rpc),secret);
  store.recoverInterrupted(Date.now());let stopped=false;const stop=()=>{stopped=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{while(!stopped){const start=Date.now();try{await worker.tick();}catch{process.stderr.write('POE_SALE_REVIEW_CHECK_UNAVAILABLE\n');}if(!stopped)await delay(Math.max(0,1000-(Date.now()-start)));}await worker.settle();}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
 }finally{source?.close();reporting?.close();closeSync(owner);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runSaleReviewCompanion().catch(()=>{process.stderr.write('POE_SALE_REVIEW_STARTUP_UNAVAILABLE\n');process.exitCode=1;});
