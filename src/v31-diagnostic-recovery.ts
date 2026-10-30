/** Fixed, owner-authorized stopped-service repair for one recorded incident.
 * It cannot initialize capital, enable entries, change risk policy, or trade.
 * The root installer independently proves source, backup and stopped cgroup. */
import Database from 'better-sqlite3';
import {lstatSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
import {PaperLedger,V31_DIAGNOSTIC_CONTROL_REPAIR,readV31DiagnosticControlRepair,type LedgerState} from './ledger.js';
import {POE_OPERATING_ACCOUNT,assertPoeOperatingAccount} from './poe-operating-account.js';
export type V31DiagnosticRecoveryRequest={ledgerPath:string;expectedRevision:number;at:number;expectedSourceCommit:string;expectedControlChangedAt:number;expectedPauseRevision:number};
export function recoverV31DiagnosticPause(input:V31DiagnosticRecoveryRequest){
 const c=V31_DIAGNOSTIC_CONTROL_REPAIR;
 if(process.getuid?.()!==988||process.getgid?.()!==982||input.ledgerPath!==POE_OPERATING_ACCOUNT.ledgerPath||input.expectedSourceCommit!==c.sourceCommit||input.expectedControlChangedAt!==c.controlChangedAt||input.expectedPauseRevision!==c.pauseRevision||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<c.pauseRevision||!Number.isSafeInteger(input.at)||input.at<c.controlChangedAt||input.at>Date.now()+5000)throw Error('V31_DIAGNOSTIC_REPAIR_EXACT_INSTALLER_REQUEST_REQUIRED');
 const file=lstatSync(input.ledgerPath);
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.uid!==988||file.gid!==982||(file.mode&0o7777)!==0o600||file.size<=0||realpathSync(input.ledgerPath)!==input.ledgerPath||realpathSync(dirname(input.ledgerPath))!==dirname(input.ledgerPath))throw Error('V31_DIAGNOSTIC_REPAIR_ORIGINAL_LEDGER_REQUIRED');
 // A retry can read its historical receipt while the corrected engine manages
 // holdings. It never opens another financial writer or changes newer controls.
 const db=new Database(input.ledgerPath,{readonly:true,fileMustExist:true,timeout:100});
 try{
  db.pragma('query_only=ON');db.exec('BEGIN');
  const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get()as{body:string}|undefined;
  if(!row)throw Error('V31_DIAGNOSTIC_REPAIR_EXISTING_ACCOUNT_REQUIRED');
  const state=JSON.parse(row.body)as LedgerState;assertPoeOperatingAccount(state);
  const existing=readV31DiagnosticControlRepair(db,state,Math.max(input.at,Date.now()));
  if(existing)return {...existing,alreadyApplied:true,financialControlWrites:0 as const,historicalReceiptOnly:true};
 }finally{db.close();}
 // PaperLedger acquires the original writer lease; the fixed installer releases
 // its stopped-process probe lease just for this sole accounting operation.
 const ledger=new PaperLedger(input.ledgerPath,POE_OPERATING_ACCOUNT.accountId,'PAPER');
 try{
  const alreadyApplied=ledger.actionResult(c.actionId)!==undefined,receipt=ledger.recoverKnownV31DiagnosticPause(input);
  return {...receipt,alreadyApplied,financialControlWrites:alreadyApplied?0 as const:1 as const,historicalReceiptOnly:alreadyApplied};
 }finally{ledger.close();}
}
