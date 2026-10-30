/** Offline owner-controlled transition command. No service/provider/signer calls. */
import {PaperLedger} from './ledger.js';
import {POE_OPERATING_ACCOUNT,assertPoeOperatingAccount} from './poe-operating-account.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION,paperEpochStateSha256} from './paper-epoch.js';
import Database from 'better-sqlite3';
/** Import-only packaging proof. Opens memory only; never selects a financial path. */
export function epochRuntimeSqliteProof(){const db=new Database(':memory:');try{return {sqliteVersion:db.prepare('SELECT sqlite_version() AS version').get() as {version:string},financialDatabaseOpened:false};}finally{db.close();}}
export async function runAuthorizedEpochCommand(){
const args=new Map<string,string>();
for(const arg of process.argv.slice(2)){const match=/^--([a-z-]+)=(.+)$/.exec(arg);if(!match||args.has(match[1]!))throw Error('PAPER_EPOCH_CLI_ARGUMENT_INVALID');args.set(match[1]!,match[2]!);}
const required=['backup-directory','price-micro-usd-per-sol','price-at','price-source','authorization'];
if([...args.keys()].some(key=>![...required,'asset-disposition'].includes(key))||(args.size!==required.length&&args.size!==required.length+1)||args.has('asset-disposition')&&args.get('asset-disposition')!==PAPER_EPOCH_ASSET_SEGREGATION||required.some(key=>!args.has(key))||args.get('authorization')!==PAPER_TEN_SOL_EPOCH_AUTHORIZATION)throw Error('PAPER_EPOCH_CLI_EXPLICIT_ARGUMENTS_REQUIRED');
const priceAt=args.get('price-at')!;if(!/^(0|[1-9][0-9]*)$/.test(priceAt)||!Number.isSafeInteger(Number(priceAt)))throw Error('PAPER_EPOCH_CLI_PRICE_TIME_INVALID');
const ledger=new PaperLedger(POE_OPERATING_ACCOUNT.ledgerPath,POE_OPERATING_ACCOUNT.accountId,'PAPER');
try{
 const before=ledger.state();assertPoeOperatingAccount(before);
 const result=await ledger.beginAuthorizedTenSolEpoch({authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION,backupDirectory:args.get('backup-directory')!,...(args.has('asset-disposition')?{assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION}:{}),price:{microUsdPerSol:args.get('price-micro-usd-per-sol')!,at:Number(priceAt),source:args.get('price-source')!}});
 const after=ledger.state();
 process.stdout.write(JSON.stringify({kind:'POE_AUTHORIZED_TEN_SOL_PAPER_EPOCH_RESULT',accountId:after.accountId,inceptionAt:after.inceptionAt,epoch:result.epoch,backup:result.backup,alreadyApplied:result.alreadyApplied,revisionBefore:before.revision,revisionAfter:after.revision,stateSha256Before:paperEpochStateSha256(before),stateSha256After:paperEpochStateSha256(after),financialJournalPrefixPreserved:true,entryPermissionGranted:false,liveTrading:false,meaning:'Explicit virtual capital adjustment recorded once; original identity, journal, actions, lifetime counters and operating-cost evidence retained. Read-only backup recovery verification does not claim a production restart drill.'})+'\n');
}finally{ledger.close();}
}
if(process.argv[1]?.endsWith('/paper-epoch-cli.js')||process.argv[1]?.endsWith('/paper-epoch-cli.ts')||process.argv[1]?.endsWith('/paper-epoch.mjs'))await runAuthorizedEpochCommand();
