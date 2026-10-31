/** Explicit owner acknowledgement of one reviewed historical maintenance
 * incident. The pinned root installer proves executing source, stopped service
 * and consistent backup, then hands the original writer lease to PaperLedger.
 * No entry permission, capital change, provider call or order is performed. */
import Database from 'better-sqlite3';
import {lstatSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
import {PaperLedger,REVIEWED_MAINTENANCE_ACKNOWLEDGEMENT,inspectReviewedMaintenanceAcknowledgement,readReviewedMaintenanceAcknowledgement,type LedgerState,type ReviewedMaintenanceAcknowledgementInput,type ReviewedMaintenanceAcknowledgementPlan,type ReviewedMaintenanceAcknowledgementReceipt} from './ledger.js';
import {POE_OPERATING_ACCOUNT,assertPoeOperatingAccount} from './poe-operating-account.js';
export type ReviewedMaintenanceRecoveryRequest=ReviewedMaintenanceAcknowledgementInput&{mode:'inspect'|'apply';ledgerPath:string;expectedPlan?:ReviewedMaintenanceAcknowledgementPlan};
const outcome=(receipt:ReviewedMaintenanceAcknowledgementReceipt,alreadyApplied:boolean)=>({kind:'POE_REVIEWED_MAINTENANCE_ACKNOWLEDGEMENT' as const,alreadyApplied,historicalReceiptOnly:alreadyApplied,receipt,financialControlWrites:alreadyApplied?0 as const:1 as const,capitalWrites:0 as const,entryPermissionGranted:false as const});
export function acknowledgeReviewedMaintenancePause(input:ReviewedMaintenanceRecoveryRequest){
 const c=REVIEWED_MAINTENANCE_ACKNOWLEDGEMENT;
 if(process.getuid?.()!==988||process.getgid?.()!==982||!['inspect','apply'].includes(input.mode)||input.ledgerPath!==POE_OPERATING_ACCOUNT.ledgerPath||input.authorization!==c.authorization||typeof input.expectedSourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(input.expectedSourceCommit)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<c.reviewedCutoffRevision||!Number.isSafeInteger(input.at)||input.at<c.inceptionAt||input.at>Date.now()+5000)throw Error('OWNER_MAINTENANCE_EXACT_INSTALLER_REQUEST_REQUIRED');
 const file=lstatSync(input.ledgerPath);
 if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.uid!==988||file.gid!==982||(file.mode&0o7777)!==0o600||file.size<=0||realpathSync(input.ledgerPath)!==input.ledgerPath||realpathSync(dirname(input.ledgerPath))!==dirname(input.ledgerPath))throw Error('OWNER_MAINTENANCE_ORIGINAL_LEDGER_REQUIRED');
 const db=new Database(input.ledgerPath,{readonly:true,fileMustExist:true,timeout:100});
 try{
  db.pragma('query_only=ON');db.exec('BEGIN');
  const row=db.prepare('SELECT body FROM financial_state WHERE singleton=1').get()as{body:string}|undefined;
  if(!row)throw Error('OWNER_MAINTENANCE_EXISTING_ACCOUNT_REQUIRED');
  const state=JSON.parse(row.body)as LedgerState;assertPoeOperatingAccount(state);
  const existing=readReviewedMaintenanceAcknowledgement(db,state,Math.max(input.at,Date.now(),state.lastAt));
  if(existing)return outcome(existing,true);
  if(input.mode==='inspect')return {kind:'POE_REVIEWED_MAINTENANCE_ACKNOWLEDGEMENT_INSPECTION' as const,alreadyApplied:false as const,plan:inspectReviewedMaintenanceAcknowledgement(db,state,input),financialControlWrites:0 as const,capitalWrites:0 as const,entryPermissionGranted:false as const};
 }finally{db.close();}
 if(!input.expectedPlan)throw Error('OWNER_MAINTENANCE_INSPECTED_PLAN_REQUIRED');
 // The installer releases only its stopped-process probe lease here. This
 // constructor must acquire the original financial writer lease itself.
 const ledger=new PaperLedger(input.ledgerPath,POE_OPERATING_ACCOUNT.accountId,'PAPER');
 try{
  const alreadyApplied=ledger.actionResult(c.actionId)!==undefined;
  return outcome(ledger.acknowledgeReviewedMaintenancePause(input,input.expectedPlan),alreadyApplied);
 }finally{ledger.close();}
}
