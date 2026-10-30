/** Offline owner-controlled transition command. No service/provider/signer calls. */
import {PaperLedger} from './ledger.js';
import {POE_OPERATING_ACCOUNT,assertPoeOperatingAccount} from './poe-operating-account.js';
import {PAPER_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION,PAPER_EPOCH_ASSET_SEGREGATION,paperEpochStateSha256} from './paper-epoch.js';
import Database from 'better-sqlite3';
import {lstatSync} from 'node:fs';
/** Import-only packaging proof. Opens memory only; never selects a financial path. */
export function epochRuntimeSqliteProof(){const db=new Database(':memory:');try{return {sqliteVersion:db.prepare('SELECT sqlite_version() AS version').get() as {version:string},financialDatabaseOpened:false};}finally{db.close();}}
export function parseAuthorizedEpochArguments(argv:readonly string[]){
const args=new Map<string,string>();
for(const arg of argv){const match=/^--([a-z-]+)=(.+)$/.exec(arg);if(!match||args.has(match[1]!))throw Error('PAPER_EPOCH_CLI_ARGUMENT_INVALID');args.set(match[1]!,match[2]!);}
const required=['backup-directory','price-micro-usd-per-sol','price-at','price-source','authorization'];
const v3=args.get('epoch')==='v3';
if([...args.keys()].some(key=>![...required,'asset-disposition','epoch'].includes(key))||args.has('epoch')&&!v3||args.has('asset-disposition')&&args.get('asset-disposition')!==PAPER_EPOCH_ASSET_SEGREGATION||required.some(key=>!args.has(key))||args.get('authorization')!==(v3?PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION:PAPER_TEN_SOL_EPOCH_AUTHORIZATION))throw Error('PAPER_EPOCH_CLI_EXPLICIT_ARGUMENTS_REQUIRED');
const priceAt=args.get('price-at')!;if(!/^(0|[1-9][0-9]*)$/.test(priceAt)||!Number.isSafeInteger(Number(priceAt)))throw Error('PAPER_EPOCH_CLI_PRICE_TIME_INVALID');
return {args,v3,priceAt:Number(priceAt)};
}
export async function runAuthorizedEpochCommand(){
const {args,v3,priceAt}=parseAuthorizedEpochArguments(process.argv.slice(2));
// An offline transition must never create or seed a missing original account.
const file=lstatSync(POE_OPERATING_ACCOUNT.ledgerPath);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size===0)throw Error('PAPER_EPOCH_EXISTING_ORIGINAL_LEDGER_REQUIRED');
const ledger=new PaperLedger(POE_OPERATING_ACCOUNT.ledgerPath,POE_OPERATING_ACCOUNT.accountId,'PAPER');
try{
 const before=ledger.state();assertPoeOperatingAccount(before);
 const input={backupDirectory:args.get('backup-directory')!,...(args.has('asset-disposition')?{assetDisposition:PAPER_EPOCH_ASSET_SEGREGATION}:{}),price:{microUsdPerSol:args.get('price-micro-usd-per-sol')!,at:priceAt,source:args.get('price-source')!}};
 const result=v3?await ledger.beginAuthorizedV3TenSolEpoch({...input,authorization:PAPER_V3_TEN_SOL_EPOCH_AUTHORIZATION}):await ledger.beginAuthorizedTenSolEpoch({...input,authorization:PAPER_TEN_SOL_EPOCH_AUTHORIZATION});
 const after=ledger.state();
 process.stdout.write(JSON.stringify({kind:v3?'POE_AUTHORIZED_V3_TEN_SOL_PAPER_EPOCH_RESULT':'POE_AUTHORIZED_TEN_SOL_PAPER_EPOCH_RESULT',accountId:after.accountId,inceptionAt:after.inceptionAt,epoch:result.epoch,backup:result.backup,alreadyApplied:result.alreadyApplied,...('riskPolicy'in result&&'equityRisk'in result?{riskPolicy:result.riskPolicy,equityRisk:result.equityRisk}:{}),revisionBefore:before.revision,revisionAfter:after.revision,stateSha256Before:paperEpochStateSha256(before),stateSha256After:paperEpochStateSha256(after),financialJournalPrefixPreserved:true,entryPermissionGranted:false,liveTrading:false,meaning:'Explicit virtual capital adjustment recorded once; original identity, journal, actions, lifetime counters and operating-cost evidence retained. Read-only backup recovery verification does not claim a production restart drill.'})+'\n');
}finally{ledger.close();}
}
if(process.argv[1]?.endsWith('/paper-epoch-cli.js')||process.argv[1]?.endsWith('/paper-epoch-cli.ts')||process.argv[1]?.endsWith('/paper-epoch.mjs'))await runAuthorizedEpochCommand();
