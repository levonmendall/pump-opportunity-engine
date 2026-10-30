/** Explicit, single-use PAPER recapitalization. Original identity and complete
 * ledger history stay authoritative; an epoch is not an account reset. */
import Database from 'better-sqlite3';
import {createHash,randomUUID} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readSync,fsyncSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import type {LedgerState,UsdPrice} from './ledger.js';
export const PAPER_EPOCH_VERSION='poe-paper-epoch-v1' as const;
export const PAPER_TEN_SOL_EPOCH_ID='poe-paper-10sol-20261030' as const;
export const PAPER_EPOCH_ASSET_SEGREGATION='SEGREGATE_VERIFIED_CLOSED_POSITION_DEPOSIT_ASSETS_IN_ARCHIVED_EPOCH' as const;
export const PAPER_TEN_SOL_EPOCH_AUTHORIZATION='OWNER_AUTHORIZED_ONE_TIME_TEN_SOL_PAPER_EPOCH_20261030' as const;
export const PAPER_V3_EPOCH_VERSION='poe-paper-epoch-v3' as const;
export const PAPER_V3_TEN_SOL_EPOCH_ID='poe-paper-10sol-v3-20261030' as const;
export const PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION='OWNER_AUTHORIZED_ONE_TIME_TEN_SOL_PAPER_V3_EPOCH_20261030' as const;
export type PaperEpochArchivedAssets={cashLamports:string;lockedDeposits:Record<string,string>;totalLamports:string;provenanceSha256:string};
type PaperEpochCapital={startedAt:number;transitionRevision:number;initialLamports:'10000000000';initialMicroUsd:string;price:UsdPrice;priorStateSha256:string;backupSha256:string;priorRealizedLamports:string;priorExecutionCostsLamports:string;priorOperatingCostsMicroUsd:string|null;capitalAdjustmentLamports:string;contributionLamports:'10000000000';capitalArchivedLamports:string;archivedAssets:PaperEpochArchivedAssets};
export type LegacyPaperEpoch=PaperEpochCapital&{version:typeof PAPER_EPOCH_VERSION;id:typeof PAPER_TEN_SOL_EPOCH_ID};
export type V3PaperEpoch=PaperEpochCapital&{version:typeof PAPER_V3_EPOCH_VERSION;id:typeof PAPER_V3_TEN_SOL_EPOCH_ID;priorEpoch:LegacyPaperEpoch};
export type PaperEpoch=LegacyPaperEpoch|V3PaperEpoch;
export type PaperEpochBackupReceipt={version:'poe-paper-epoch-backup-v1';accountId:string;inceptionAt:number;revision:number;stateSha256:string;logicalSha256:string;backupSha256:string;backupPath:string;receiptPath:string;integrity:'ok';recoveryVerification:'read-only-reopen-state-schema-and-all-logical-rows';rows:{financial_state:number;actions:number;journal:number;metadata:number}};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const unsigned=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(v);
const signed=(v:unknown)=>typeof v==='string'&&/^-?(0|[1-9][0-9]{0,38})$/.test(v);
export function validatePaperEpoch(epoch:PaperEpoch,state:Pick<LedgerState,'inceptionAt'|'lastAt'|'revision'>){
 const keys='archivedAssets,backupSha256,capitalAdjustmentLamports,capitalArchivedLamports,contributionLamports,id,initialLamports,initialMicroUsd,price,priorExecutionCostsLamports,priorOperatingCostsMicroUsd,priorRealizedLamports,priorStateSha256,startedAt,transitionRevision,version';
 const v3=epoch?.version===PAPER_V3_EPOCH_VERSION&&epoch?.id===PAPER_V3_TEN_SOL_EPOCH_ID;
 if(!epoch||typeof epoch!=='object'||Array.isArray(epoch)||Object.keys(epoch).sort().join(',')!==(v3?[...keys.split(','),'priorEpoch'].sort().join(','):keys)||!v3&&(epoch.version!==PAPER_EPOCH_VERSION||epoch.id!==PAPER_TEN_SOL_EPOCH_ID)||epoch.initialLamports!=='10000000000'||!Number.isSafeInteger(epoch.startedAt)||epoch.startedAt<state.inceptionAt||epoch.startedAt>state.lastAt||!Number.isSafeInteger(epoch.transitionRevision)||epoch.transitionRevision<1||epoch.transitionRevision>state.revision||!unsigned(epoch.initialMicroUsd)||!unsigned(epoch.priorExecutionCostsLamports)||(epoch.priorOperatingCostsMicroUsd!==null&&!unsigned(epoch.priorOperatingCostsMicroUsd))||!signed(epoch.priorRealizedLamports)||!signed(epoch.capitalAdjustmentLamports)||!sha(epoch.priorStateSha256)||!sha(epoch.backupSha256))throw Error('PAPER_EPOCH_STATE_INVALID');
 if(v3){const prior=(epoch as V3PaperEpoch).priorEpoch;if(prior?.version!==PAPER_EPOCH_VERSION||prior?.id!==PAPER_TEN_SOL_EPOCH_ID||prior.startedAt>=epoch.startedAt||prior.transitionRevision>=epoch.transitionRevision)throw Error('PAPER_V3_EPOCH_CHAIN_INVALID');validatePaperEpoch(prior,state);}
 const a=epoch.archivedAssets;if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).sort().join(',')!=='cashLamports,lockedDeposits,provenanceSha256,totalLamports'||!unsigned(a.cashLamports)||!unsigned(a.totalLamports)||!sha(a.provenanceSha256)||!a.lockedDeposits||typeof a.lockedDeposits!=='object'||Array.isArray(a.lockedDeposits)||Object.keys(a.lockedDeposits).some(k=>!k||k.length>96||['__proto__','constructor','prototype'].includes(k))||!Object.values(a.lockedDeposits).every(unsigned)||BigInt(a.totalLamports)!==BigInt(a.cashLamports)+Object.values(a.lockedDeposits).reduce((n,v)=>n+BigInt(v),0n)||epoch.contributionLamports!=='10000000000'||epoch.capitalArchivedLamports!==a.totalLamports||BigInt(epoch.capitalAdjustmentLamports)!==10000000000n-BigInt(a.totalLamports))throw Error('PAPER_EPOCH_ARCHIVED_ASSETS_INVALID');
 const p=epoch.price;if(!p||typeof p!=='object'||Object.keys(p).sort().join(',')!=='at,microUsdPerSol,source'||!unsigned(p.microUsdPerSol)||BigInt(p.microUsdPerSol)<=0n||!Number.isSafeInteger(p.at)||p.at>epoch.startedAt||epoch.startedAt-p.at>10000||typeof p.source!=='string'||!p.source||p.source.length>512||/[\u0000-\u001f]/.test(p.source)||BigInt(epoch.initialMicroUsd)!==10n*BigInt(p.microUsdPerSol))throw Error('PAPER_EPOCH_CONVERSION_INVALID');
 return epoch;
}
export function requireEpochFlat(state:LedgerState,disposition?:typeof PAPER_EPOCH_ASSET_SEGREGATION){
 if(Object.keys(state.positions).length||Object.keys(state.pending).length||Object.values(state.lockedDeposits).some(v=>BigInt(v)!==0n)&&disposition!==PAPER_EPOCH_ASSET_SEGREGATION)throw Error('PAPER_EPOCH_UNRESOLVED_OBLIGATIONS');
 if(state.controls.entriesEnabled&&!state.controls.stopRequested)throw Error('PAPER_EPOCH_ENTRY_PAUSE_REQUIRED');
}
/** Stream every logical row, including historical metadata. Not a latest-N
 * journal test. Length framing prevents delimiter/embedded-newline ambiguity. */
export function paperEpochLogicalSeal(db:Database.Database){
 const digest=createHash('sha256'),rows={financial_state:0,actions:0,journal:0,metadata:0};
 const queries={financial_state:'SELECT singleton,body FROM financial_state ORDER BY singleton',actions:'SELECT id,payload_hash,result FROM actions ORDER BY id',journal:'SELECT revision,action_id,at,kind,detail FROM journal ORDER BY revision',metadata:'SELECT key,value FROM metadata ORDER BY key'};
 for(const name of Object.keys(queries) as Array<keyof typeof queries>){digest.update(name);for(const row of db.prepare(queries[name]).iterate()){const data=JSON.stringify(row);digest.update(String(Buffer.byteLength(data))+':');digest.update(data);rows[name]++;}}
 const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as {body:string}|undefined;if(!row)throw Error('PAPER_EPOCH_STATE_ABSENT');
 const state=JSON.parse(row.body) as LedgerState;return {logicalSha256:digest.digest('hex'),rows,state,stateSha256:hash(state)};
}
function fileSha(path:string){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.geteuid?.()||s.mode&0o077)throw Error('PAPER_EPOCH_BACKUP_FILE_UNSAFE');const h=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));fsyncSync(fd);return h.digest('hex');}finally{closeSync(fd);}}
/** Independently reconstruct original refundable asset book from every
 * durable filled attempt/refund/release, not a current snapshot assertion.
 * No asset is sold, refunded, valued as cash or written off by segregation. */
export function verifyArchivedEpochAssets(db:Database.Database,state:LedgerState):PaperEpochArchivedAssets{
 const locked:Record<string,string>={},proof=createHash('sha256');
 type Row={actionId:string;at:number;kind:string;detail:string;payloadHash:string|null;result:string|null};
 // Every epoch begins with an empty deposit book. Earlier deposit assets are
 // already segregated in its immutable prior-epoch receipt, never cash again.
 const boundary=state.paperEpoch?.transitionRevision??0;proof.update(hash({accountId:state.accountId,inceptionAt:state.inceptionAt,epoch:state.paperEpoch??null,boundary}));
 const query="SELECT j.action_id actionId,j.at,j.kind,j.detail,a.payload_hash payloadHash,a.result FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>? AND j.kind IN ('attempt','deposit-release') ORDER BY j.revision";
 const verify=(row:Row)=>{if(!row.result||Buffer.byteLength(row.detail)>65536||Buffer.byteLength(row.result)>65536)throw Error('PAPER_EPOCH_ASSET_PROVENANCE_UNAVAILABLE');const payload=JSON.parse(row.detail),result=JSON.parse(row.result);if(row.payloadHash!==hash({kind:row.kind,payload}))throw Error('PAPER_EPOCH_ASSET_PROVENANCE_INVALID');return {payload,result};};
 for(const row of db.prepare(query).iterate(boundary) as IterableIterator<Row>){const {payload,result}=verify(row);proof.update(hash(row));
  if(row.kind==='deposit-release'){if(!unsigned(payload.lamports)||!payload.mint||result.refundedLamports!==payload.lamports||typeof payload.evidence!=='string'||!payload.evidence)throw Error('PAPER_EPOCH_ASSET_RELEASE_INVALID');const next=BigInt(locked[payload.mint]??'0')-BigInt(payload.lamports);if(next<0n)throw Error('PAPER_EPOCH_ASSET_RELEASE_INVALID');if(next===0n)delete locked[payload.mint];else locked[payload.mint]=next.toString();continue;}
  if(result.status!=='filled')continue;
  const order=db.prepare("SELECT j.action_id actionId,j.at,j.kind,j.detail,a.payload_hash payloadHash,a.result FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.action_id=?").get('order:'+payload.orderId) as Row|undefined;if(!order||order.kind!=='order'||order.at>row.at)throw Error('PAPER_EPOCH_ASSET_ORDER_UNAVAILABLE');const bound=verify(order),o=bound.payload.input;proof.update(hash(order));if(!o||o.id!==payload.orderId||typeof o.mint!=='string'||!o.mint||o.mint.length>96||['__proto__','constructor','prototype'].includes(o.mint)||!unsigned(o.deposit)||!payload.quote)throw Error('PAPER_EPOCH_ASSET_ORDER_INVALID');
  if(o.side==='buy'){if(BigInt(o.deposit)>0n){if(BigInt(locked[o.mint]??'0')>0n)throw Error('PAPER_EPOCH_ASSET_DUPLICATE_DEPOSIT');locked[o.mint]=o.deposit;}}
  else if(o.side==='sell'){const refund=payload.quote.refundedDepositLamports??'0';if(!unsigned(refund)||BigInt(refund)>0n&&(typeof payload.quote.refundEvidence!=='string'||!payload.quote.refundEvidence))throw Error('PAPER_EPOCH_ASSET_REFUND_INVALID');const next=BigInt(locked[o.mint]??'0')-BigInt(refund);if(next<0n)throw Error('PAPER_EPOCH_ASSET_REFUND_INVALID');if(next===0n)delete locked[o.mint];else locked[o.mint]=next.toString();}
  else throw Error('PAPER_EPOCH_ASSET_ORDER_INVALID');
 }
 const positive=Object.fromEntries(Object.entries(state.lockedDeposits).filter(([,v])=>BigInt(v)>0n));if(JSON.stringify(Object.entries(locked).sort())!==JSON.stringify(Object.entries(positive).sort()))throw Error('PAPER_EPOCH_ASSET_BOOK_NOT_RECONCILED');
 const assets={cashLamports:state.lamports,lockedDeposits:structuredClone(positive),totalLamports:(BigInt(state.lamports)+Object.values(positive).reduce((n,v)=>n+BigInt(v),0n)).toString(),provenanceSha256:proof.digest('hex')};return assets;
}
/** Invoked through the source writer's SQLite backup API, never by copying a
 * live WAL file. Any concurrent source mutation makes this attempt ineligible. */
export async function verifiedEpochBackup(db:Database.Database,directory:string,validate:(state:LedgerState)=>void,disposition?:typeof PAPER_EPOCH_ASSET_SEGREGATION,epochId:PaperEpoch['id']=PAPER_TEN_SOL_EPOCH_ID):Promise<PaperEpochBackupReceipt>{
 const dir=resolve(directory),s=lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.geteuid?.()||s.mode&0o077||realpathSync(dir)!==dir)throw Error('PAPER_EPOCH_PRIVATE_DURABLE_BACKUP_DIRECTORY_REQUIRED');
 const before=paperEpochLogicalSeal(db);validate(before.state);requireEpochFlat(before.state,disposition);
 const backupPath=join(dir,`${epochId}-revision-${before.state.revision}-${randomUUID()}.sqlite`),receiptPath=backupPath+'.receipt.json';
 const fd=openSync(backupPath,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);closeSync(fd);
 await db.backup(backupPath);
 const copy=new Database(backupPath,{readonly:true,fileMustExist:true});let saved:ReturnType<typeof paperEpochLogicalSeal>;
 try{copy.pragma('query_only = ON');if(copy.pragma('integrity_check',{simple:true})!=='ok')throw Error('PAPER_EPOCH_BACKUP_INTEGRITY_FAILED');saved=paperEpochLogicalSeal(copy);validate(saved.state);}finally{copy.close();}
 const after=paperEpochLogicalSeal(db);if(before.logicalSha256!==saved.logicalSha256||saved.logicalSha256!==after.logicalSha256||before.stateSha256!==after.stateSha256)throw Error('PAPER_EPOCH_SOURCE_CHANGED_DURING_BACKUP');
 const receipt:PaperEpochBackupReceipt={version:'poe-paper-epoch-backup-v1',accountId:before.state.accountId,inceptionAt:before.state.inceptionAt,revision:before.state.revision,stateSha256:before.stateSha256,logicalSha256:before.logicalSha256,backupSha256:fileSha(backupPath),backupPath,receiptPath,integrity:'ok',recoveryVerification:'read-only-reopen-state-schema-and-all-logical-rows',rows:before.rows};
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});const receiptFd=openSync(receiptPath,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(receiptFd);}finally{closeSync(receiptFd);}const dirFd=openSync(dir,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(dirFd);}finally{closeSync(dirFd);}
 return receipt;
}
export const paperEpochStateSha256=hash;
