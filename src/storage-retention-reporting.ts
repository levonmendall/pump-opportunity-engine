/** Fixed, nonsecret local retention projection. No financial files, provider,
 * dashboard schema changes or writes outside the existing public directory. */
import {constants,closeSync,fchmodSync,fstatSync,lstatSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync,type Stats} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const STORAGE_RETENTION_REPORT_FILE='runtime-storage-retention.json';
export const STORAGE_RETENTION_REPORT_MAX_BYTES=16*1024;
export const STORAGE_RETENTION_REPORT_FRESH_MS=300000;
export const STORAGE_RETENTION_PUBLIC_REASONS=new Set([
 'FINANCIAL_REFERENCE_HISTORY_UNAVAILABLE','REGISTRY_BUSY_RETRY','RETENTION_DEFERRED',
 'REGISTRY_OVERSIZED_ROWS_DEFERRED','RETENTION_STATUS_UNAVAILABLE','RETENTION_REPORT_STALE',
 ...['ID','DIRECTORY_NAME','PRIVATE_DIRECTORY','FILE_NAME','PRIVATE_FILE','FILE_BOUND','CHANGED_FILE',
 'MARKER_ALREADY_EXISTS','SHORT_WRITE','POLICY','DEADLINE','NEW_DIRECTORY_REQUIRED','FILES','REFERENCE',
 'RETIRING','COMPLETE_MANIFEST_REQUIRED','PROTECTION_MARKER','EVENT_KIND','RETIREMENT','UNUSED_MARKER',
 'UNRECOGNIZED_FILE','MANIFEST','CHANGED_DIRECTORY','IO_UNAVAILABLE'].map(code=>'PROVISIONAL_PROOF_'+code),
]);
export type PoeStorageRetentionProjectionInput={generatedAt:number;accountId:string;source:string;financial:unknown;registry:unknown;proofs:unknown;failure?:unknown};
export type PoeStorageRetentionReportInput=PoeStorageRetentionProjectionInput&{publicStatusPath:string;privateDirectory:string};
type SectionStatus='active'|'not-run'|'deferred'|'stale'|'unknown';
type OverallStatus='healthy'|'warming-up'|'deferred'|'stale'|'unknown';
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
const flag=(value:unknown):boolean|null=>typeof value==='boolean'?value:null;
const reason=(value:unknown):string|null=>value===null||value===undefined?null:typeof value==='string'&&STORAGE_RETENTION_PUBLIC_REASONS.has(value)?value:'RETENTION_STATUS_UNAVAILABLE';
const timestamp=(value:unknown,at:number):number|null=>count(value)!==null&&Number(value)<=at+5000?Number(value):null;
const need=(condition:unknown)=>{if(!condition)throw Error('STORAGE_RETENTION_PUBLIC_REPORT_UNAVAILABLE');};

/** Exact fields only. Never copy runtime objects, private cursors, proof/token
 * identities, path names or exception text into this public read model. */
export function projectPoeStorageRetentionReport(input:PoeStorageRetentionProjectionInput,observedAt=Date.now()){
 need(count(input.generatedAt)!==null&&count(observedAt)!==null&&input.generatedAt<=observedAt+5000);
 need(typeof input.accountId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.accountId)&&typeof input.source==='string'&&/^[a-f0-9]{40}$/.test(input.source));
 const at=input.generatedAt,financialInput=record(input.financial),registryInput=record(input.registry),proofInput=record(input.proofs);
 const financialKnown=financialInput.schemaVersion===1&&financialInput.financialWrites===0;
 const historyComplete=financialKnown?flag(financialInput.financialHistoryComplete):null;
 const ordersIndexed=financialKnown?count(financialInput.financialOrdersIndexed):null,protectedMints=financialKnown?count(financialInput.permanentlyProtectedMints):null;
 const financialReason=financialKnown?reason(financialInput.reason):'RETENTION_STATUS_UNAVAILABLE';
 const financialStatus:'ready'|'warming-up'|'deferred'|'unknown'=!financialKnown?'unknown':financialReason!==null?'deferred':historyComplete===null||ordersIndexed===null||protectedMints===null?'unknown':historyComplete?'ready':'warming-up';
 const financial={status:financialStatus,historyComplete,ordersIndexed,protectedMints,reason:financialReason};
 const registryKnown=record(registryInput.policy).version==='expired-nontrade-candidate-48h-v1',last=registryKnown?record(registryInput.last):{};
 const registryAt=timestamp(last.at,at),oversizedRowsDeferred=registryKnown?count(last.oversizedRowsDeferred):null;
 const registryCounts={retiredHistoryRows:registryKnown?count(registryInput.retiredHistoryRows):null,compactedWatchRows:registryKnown?count(registryInput.compactedWatchRows):null,retiredBodyBytes:registryKnown?count(registryInput.retiredBodyBytes):null,reusablePages:registryKnown?count(registryInput.reusablePages):null,pageBytes:registryKnown?count(registryInput.pageBytes):null};
 const registryStatus:SectionStatus=!registryKnown||Object.values(registryCounts).some(value=>value===null)||(registryInput.last!==null&&oversizedRowsDeferred===null)?'unknown':registryAt===null?(registryInput.last===null?'not-run':'unknown'):at-registryAt>STORAGE_RETENTION_REPORT_FRESH_MS?'stale':(oversizedRowsDeferred??0)>0?'deferred':'active';
 const registry={status:registryStatus,lastSweepAt:registryAt,...registryCounts,oversizedRowsDeferred};
 const proofKnown=proofInput.policy==='poe-provisional-proof-v1',proofAt=proofKnown?timestamp(proofInput.lastSweepAt,at):null;
 const proofReason=proofKnown?reason(proofInput.lastFailure):'RETENTION_STATUS_UNAVAILABLE';
 const proofCounts={skipped:proofKnown?count(proofInput.skipped):null,retiredProofs:proofKnown?count(proofInput.retiredProofs):null,retiredBytes:proofKnown?count(proofInput.retiredBytes):null};
 const proofStatus:SectionStatus=!proofKnown||Object.values(proofCounts).some(value=>value===null)?'unknown':proofReason!==null?'deferred':proofAt===null?(proofInput.lastSweepAt===null?'not-run':'unknown'):at-proofAt>STORAGE_RETENTION_REPORT_FRESH_MS?'stale':'active';
 const proofs={status:proofStatus,lastSweepAt:proofAt,lastCompletedSweepAt:proofKnown?timestamp(proofInput.lastCompletedSweepAt,at):null,...proofCounts,retiring:proofKnown?flag(proofInput.retiring):null,reason:proofReason};
 let publicReason=reason(input.failure)??financialReason??proofReason??(registryStatus==='deferred'?'REGISTRY_OVERSIZED_ROWS_DEFERRED':null);
 const publicationStale=observedAt-at>STORAGE_RETENTION_REPORT_FRESH_MS;
 const status:OverallStatus=publicationStale||registryStatus==='stale'||proofStatus==='stale'?'stale':financialStatus==='unknown'||registryStatus==='unknown'||proofStatus==='unknown'?'unknown':publicReason!==null?'deferred':financialStatus==='warming-up'||registryStatus==='not-run'||proofStatus==='not-run'?'warming-up':'healthy';
 if(status==='stale'&&publicReason===null)publicReason='RETENTION_REPORT_STALE';
 return {schemaVersion:1 as const,kind:'POE_RUNTIME_STORAGE_RETENTION' as const,project:'pump-opportunity-engine' as const,generatedAt:at,accountId:input.accountId,source:input.source,status,reason:publicReason,financial,registry,proofs};
}

function sameFile(a:Stats,b:Stats){return ['dev','ino','size','mtimeMs','ctimeMs'].every(key=>a[key as keyof Stats]===b[key as keyof Stats]);}
function boundedPublicJson(path:string,owner:number,maximum:number):Record<string,unknown>{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=fstatSync(fd);need(before.isFile()&&before.uid===owner&&before.nlink===1&&(before.mode&0o777)===0o644&&before.size>0&&before.size<=maximum);
  const raw=readFileSync(fd);need(raw.length===before.size&&sameFile(before,fstatSync(fd)));
  const named=lstatSync(path);need(!named.isSymbolicLink()&&sameFile(before,named));
  return record(JSON.parse(raw.toString('utf8')));
 }finally{closeSync(fd);}
}

/** Publish beside the existing status, never create a public directory or
 * modify status.json. Production ownership is the existing poe-runtime UID988.
 * This replaceable current read model never authorizes retention/deletion and
 * is not recovery history. Atomic replacement supplies complete current bytes;
 * it needs no file/directory durability barriers on the financial event loop.
 * Failures return false and never publish a partial report. */
export function writePoeStorageRetentionReport(input:PoeStorageRetentionReportInput):boolean{
 let directory:number|undefined,temp:string|undefined;
 try{
  const publicStatus=input.publicStatusPath,owner=process.getuid?.();
  need(owner!==undefined&&isAbsolute(publicStatus)&&basename(publicStatus)==='status.json'&&resolve(publicStatus)===publicStatus);
  const parent=dirname(publicStatus),privateRoot=realpathSync(input.privateDirectory);
  need(realpathSync(parent)===parent&&parent!==privateRoot&&!parent.startsWith(privateRoot+'/'));
  directory=openSync(parent,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const before=fstatSync(directory);need(before.isDirectory()&&before.uid===owner&&(before.mode&0o777)===0o755);
  const anchor='/proc/self/fd/'+directory,statusPath=join(anchor,'status.json'),target=join(anchor,STORAGE_RETENTION_REPORT_FILE);
  const status=boundedPublicJson(statusPath,owner!,4096);
  need(status.schemaVersion===1&&status.project==='pump-opportunity-engine'&&status.mode==='PAPER'&&status.liveTrading===false&&status.accountId===input.accountId&&status.release===input.source);
  try{
   const previous=boundedPublicJson(target,owner!,STORAGE_RETENTION_REPORT_MAX_BYTES);
   need(previous.schemaVersion===1&&previous.kind==='POE_RUNTIME_STORAGE_RETENTION'&&previous.project==='pump-opportunity-engine'&&previous.accountId===input.accountId);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const report=projectPoeStorageRetentionReport(input),body=JSON.stringify(report)+'\n';
  need(Buffer.byteLength(body)<=STORAGE_RETENTION_REPORT_MAX_BYTES);
  temp=join(anchor,'.runtime-storage-retention-'+randomUUID()+'.pending');
  const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,body);fchmodSync(fd,0o644);}finally{closeSync(fd);}
  const named=lstatSync(parent);need(!named.isSymbolicLink()&&named.dev===before.dev&&named.ino===before.ino&&named.uid===owner&&(named.mode&0o777)===0o755);
  renameSync(temp,target);temp=undefined;return true;
 }catch{return false;}
 finally{if(temp)try{unlinkSync(temp);}catch{/* Only this invocation's private staging name. */}if(directory!==undefined)closeSync(directory);}
}
