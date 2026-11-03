/** One explicitly authorized PAPER exit. No entry, reset, SQL, signer, or live
 * transaction API exists here. The caller must already own the original writer
 * lease after the normal runtime has physically stopped. */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {PaperExecutionCoordinator} from '../../src/execution.js';
import {PaperLedger,type LedgerState,type Order,type OrderOutcome} from '../../src/ledger.js';
import {PilotMarket,type PilotRpc} from '../../src/pilot-market.js';
import {POE_OPERATING_ACCOUNT,assertPoeOperatingAccount} from '../../src/poe-operating-account.js';
import {PAPER_V3_TEN_SOL_EPOCH_ID} from '../../src/paper-epoch.js';
import {canonicalPumpPoolPda} from '../../src/sdk.js';
import {validateMarketPool,type VerifiedMarketPool} from '../../src/rpc-market.js';

export const MANUAL_CLOSE_INSTALLED_SOURCE='356083fd8f0e69297c8470d4493077a175d2bad1';
export const MANUAL_CLOSE_EXECUTION_SOURCE='c92a2b95b1c175bf67b65cbe072c9e5f5080303d';
export const MANUAL_CLOSE_SCOPE='owner-authorized-one-use-paper-close';
export const manualCloseSha256=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type ManualCloseAuthorization={
 schemaVersion:1;scope:typeof MANUAL_CLOSE_SCOPE;authorizationId:string;
 accountId:string;inceptionAt:number;epochId:string;epochSha256:string;
 mint:string;pool:string;roundTripId:string;units:string;enteredAt:number;
 installedSource:typeof MANUAL_CLOSE_INSTALLED_SOURCE;executionSource:typeof MANUAL_CLOSE_EXECUTION_SOURCE;
 issuedAt:number;expiresAt:number;ledgerDevice:string;ledgerInode:string;
};
export type ManualCloseClaim={
 schemaVersion:1;authorizationSha256:string;authorization:ManualCloseAuthorization;
 before:LedgerState;priorRecoveryAllowed:boolean;priorInternalShutdownVerified:boolean;
};
export type ManualCloseResult={
 schemaVersion:1;kind:'authorized-manual-paper-close';authorizationId:string;authorizationSha256:string;
 installedSource:string;executionSource:string;orderId:string;replay:boolean;pendingRecovery:boolean;
 before:ReturnType<typeof manualCloseStateSummary>;after:ReturnType<typeof manualCloseStateSummary>;
 order:Order|null;reservation:unknown;executionReceipt:OrderOutcome|null;
 controlRecovery:{before:{operating:boolean;internalShutdown:boolean};after:{operating:boolean;internalShutdown:boolean}};
 flat:boolean;newEntryPermissionGranted:false;liveTransactionSubmitted:false;
 market:ReturnType<PilotMarket['usage']>|null;
};
function need(value:unknown,reason:string):asserts value {if(!value)throw Error('MANUAL_CLOSE_'+reason);}
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
const amount=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v);
const keys='schemaVersion,scope,authorizationId,accountId,inceptionAt,epochId,epochSha256,mint,pool,roundTripId,units,enteredAt,installedSource,executionSource,issuedAt,expiresAt,ledgerDevice,ledgerInode'.split(',').sort().join(',');
export function validateManualCloseAuthorization(value:unknown):asserts value is ManualCloseAuthorization{
 need(value&&typeof value==='object'&&!Array.isArray(value),'AUTHORIZATION_REQUIRED');const a=value as ManualCloseAuthorization;
 need(Object.keys(a).sort().join(',')===keys&&a.schemaVersion===1&&a.scope===MANUAL_CLOSE_SCOPE,'AUTHORIZATION_SCHEMA');
 need(typeof a.authorizationId==='string'&&/^[a-z0-9][a-z0-9-]{7,79}$/.test(a.authorizationId),'AUTHORIZATION_ID');
 need(a.accountId===POE_OPERATING_ACCOUNT.accountId&&a.inceptionAt===POE_OPERATING_ACCOUNT.inceptionAt,'ORIGINAL_ACCOUNT');
 need(a.epochId===PAPER_V3_TEN_SOL_EPOCH_ID&&/^[a-f0-9]{64}$/.test(a.epochSha256),'EPOCH_BINDING');
 need(a.installedSource===MANUAL_CLOSE_INSTALLED_SOURCE&&a.executionSource===MANUAL_CLOSE_EXECUTION_SOURCE,'SOURCE_BINDING');
 need(text(a.roundTripId,100)&&amount(a.units)&&integer(a.enteredAt)&&a.enteredAt>=a.inceptionAt,'POSITION_BINDING');
 need(integer(a.issuedAt)&&integer(a.expiresAt)&&a.issuedAt>=a.enteredAt&&a.expiresAt>a.issuedAt&&a.expiresAt-a.issuedAt<=1800000,'AUTHORIZATION_TIME');
 need(typeof a.ledgerDevice==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(a.ledgerDevice)&&amount(a.ledgerInode),'LEDGER_INODE_BINDING');
 try{need(new PublicKey(a.mint).toBase58()===a.mint&&canonicalPumpPoolPda(new PublicKey(a.mint)).toBase58()===a.pool,'CANONICAL_POOL');}catch{throw Error('MANUAL_CLOSE_CANONICAL_POOL');}
}
export function manualCloseOrderId(a:ManualCloseAuthorization){return 'manual-close:'+manualCloseSha256({scope:a.scope,authorizationId:a.authorizationId,accountId:a.accountId,inceptionAt:a.inceptionAt,epochId:a.epochId,mint:a.mint,roundTripId:a.roundTripId});}
export function manualCloseStateSummary(s:LedgerState){return {accountId:s.accountId,inceptionAt:s.inceptionAt,mode:s.mode,initialMicroUsd:s.initialMicroUsd,paperEpoch:structuredClone(s.paperEpoch),epochSha256:manualCloseSha256(s.paperEpoch),revision:s.revision,lastAt:s.lastAt,cashLamports:s.lamports,reservedLamports:Object.values(s.pending).reduce((sum,o)=>sum+BigInt(o.reserved),0n).toString(),positions:structuredClone(s.positions),pending:structuredClone(s.pending),lockedDeposits:structuredClone(s.lockedDeposits),realizedLamports:s.realizedLamports,executionCostsLamports:s.executionCosts,controls:structuredClone(s.controls),daily:structuredClone(s.daily)};}
function identity(s:LedgerState,a:ManualCloseAuthorization){assertPoeOperatingAccount(s);need(s.accountId===a.accountId&&s.inceptionAt===a.inceptionAt&&s.paperEpoch?.id===a.epochId&&manualCloseSha256(s.paperEpoch)===a.epochSha256,'CURRENT_ACCOUNT_OR_EPOCH_CHANGED');}
function position(s:LedgerState,a:ManualCloseAuthorization){
 const p=s.positions[a.mint];need(Object.keys(s.positions).length===1&&p&&p.mint===a.mint&&p.units===a.units&&p.enteredAt===a.enteredAt&&p.strategy?.roundTripId===a.roundTripId,'EXACT_POSITION_CHANGED');
 need(p.strategy.version==='liquidity-resilient-momentum-v3.1','RECORDED_STRATEGY_REQUIRED');
}
export type ManualCloseOptions={
 ledger:PaperLedger;authorization:ManualCloseAuthorization;authorizationSha256:string;
 pool:VerifiedMarketPool;knownRunIds:readonly string[];
 /** Must exclusively persist the first claim, or return the exact same sealed
  * original claim. It is called before recovery, quote or reservation. */
 claim:(proposed:ManualCloseClaim)=>{created:boolean;claim:ManualCloseClaim};
 /** Deferred until all identity, pending-action and replay checks pass. */
 rpc:()=>PilotRpc;record:(kind:string,data:unknown)=>void;
 now?:()=>number;waitUntil?:(at:number)=>Promise<void>;
};
export async function executeAuthorizedManualClose(o:ManualCloseOptions):Promise<ManualCloseResult>{
 const a=o.authorization;validateManualCloseAuthorization(a);need(/^[a-f0-9]{64}$/.test(o.authorizationSha256),'EXTERNAL_AUTHORIZATION_DIGEST');
 const now=o.now??Date.now,clock=()=>{const at=now();need(integer(at),'CLOCK');return at;};
 const wait=o.waitUntil??(async(at:number)=>{while(clock()<at)await new Promise<void>(r=>setTimeout(r,Math.min(1000,at-clock())));});
 const initial=o.ledger.state(),id=manualCloseOrderId(a);identity(initial,a);need(clock()>=initial.lastAt,'FINANCIAL_TIME_REGRESSION');
 const old=o.ledger.actionResult('execution-attempt:'+id) as OrderOutcome|undefined;
 if(old)need(['filled','failed','expired'].includes(old.status)&&integer(old.at)&&text(old.reason,2000),'STORED_OUTCOME_INVALID');
 const reservation=o.ledger.actionResult('order:'+id),pending=initial.pending[id];
 need(Object.values(initial.pending).every(order=>order.id===id&&order.side==='sell'&&order.mint===a.mint),'FOREIGN_PENDING_ACTION');
 if(!old){position(initial,a);need(!initial.controls.entriesEnabled&&initial.daily.paused,'ORIGINAL_RUNTIME_MUST_CLOSE_ENTRIES');}
 if(old)need(!pending,'TERMINAL_OUTCOME_WITH_PENDING_ACTION');
 else if(pending)need(reservation!==undefined&&pending.decisionContext?.reason===`Owner authorized one PAPER close: ${o.authorizationSha256}`,'OWN_PENDING_BINDING');
 else need(reservation===undefined,'RESERVATION_WITHOUT_PENDING_OR_OUTCOME');
 if(!old&&!pending)need(a.issuedAt<=clock()&&clock()<a.expiresAt,'AUTHORIZATION_EXPIRED_OR_FUTURE');
 const proposed:ManualCloseClaim={schemaVersion:1,authorizationSha256:o.authorizationSha256,authorization:structuredClone(a),before:structuredClone(initial),priorRecoveryAllowed:o.ledger.operatingFinancialRecoveryAllowed(clock()),priorInternalShutdownVerified:initial.controls.stopRequested&&o.ledger.internalShutdownRecoveryProof(o.knownRunIds,clock()).verified};
 const owned=o.claim(proposed),claim=owned.claim;
 need(claim.schemaVersion===1&&claim.authorizationSha256===o.authorizationSha256&&manualCloseSha256(claim.authorization)===manualCloseSha256(a),'AUTHORIZATION_ALREADY_BOUND_DIFFERENTLY');identity(claim.before,a);position(claim.before,a);
 need(typeof claim.priorRecoveryAllowed==='boolean'&&typeof claim.priorInternalShutdownVerified==='boolean'&&!claim.before.controls.entriesEnabled&&claim.before.daily.paused,'CLAIM_CONTROL_BINDING');
 if(owned.created)need(!old&&!pending,'ORIGINAL_CLAIM_MISSING');
 if(!owned.created&&!old&&!pending)throw Error('MANUAL_CLOSE_AUTHORIZATION_ALREADY_USED_WITHOUT_ORDER');
 let market:PilotMarket|null=null,order:Order|null=pending?structuredClone(pending):null;
 const result=(receipt:OrderOutcome|null,replay:boolean):ManualCloseResult=>{
  const after=o.ledger.state();identity(after,a);
  const recovery={before:{operating:claim.priorRecoveryAllowed,internalShutdown:claim.priorInternalShutdownVerified},after:{operating:o.ledger.operatingFinancialRecoveryAllowed(clock()),internalShutdown:after.controls.stopRequested&&o.ledger.internalShutdownRecoveryProof(o.knownRunIds,clock()).verified}};
  if(!replay){need(!after.controls.entriesEnabled&&after.daily.paused&&after.controls.stopRequested===claim.before.controls.stopRequested,'CONTROL_INTENT_CHANGED');need(after.daily.lossPaused===claim.before.daily.lossPaused,'DAILY_LOSS_INTENT_CHANGED');if(!claim.priorRecoveryAllowed&&!claim.priorInternalShutdownVerified)need(after.controls.reason===claim.before.controls.reason,'HARD_CONTROL_NOT_PRESERVED');}
  if(!replay&&receipt){if(recovery.before.operating)need(recovery.after.operating,'TEMPORARY_CONTROL_PROVENANCE_CHANGED');if(recovery.before.internalShutdown)need(recovery.after.internalShutdown,'INTERNAL_SHUTDOWN_PROVENANCE_CHANGED');if(!recovery.before.operating&&!recovery.before.internalShutdown)need(!recovery.after.operating&&!recovery.after.internalShutdown,'HARD_CONTROL_LAUNDERED');}
  return {schemaVersion:1,kind:'authorized-manual-paper-close',authorizationId:a.authorizationId,authorizationSha256:o.authorizationSha256,installedSource:a.installedSource,executionSource:a.executionSource,orderId:id,replay,pendingRecovery:!!pending,before:manualCloseStateSummary(claim.before),after:manualCloseStateSummary(after),order,reservation:o.ledger.actionResult('order:'+id)??null,executionReceipt:receipt,controlRecovery:recovery,flat:Object.keys(after.positions).length===0&&Object.keys(after.pending).length===0,newEntryPermissionGranted:false,liveTransactionSubmitted:false,market:market?.usage()??null};
 };
 if(old)return result(old,true);
 // Recovery changes the current reason. Retain a hard/unknown original intent
 // immediately through the normal ledger pause action, never a resume/reset.
 const coordinator=new PaperExecutionCoordinator({ledger:o.ledger,now,timeoutMs:3000,context:signal=>market!.context(o.ledger.state().positions,signal),quote:(request,signal)=>market!.executionQuote(request,signal),executionPlan:input=>market!.executionPlan(input)});
 o.record('manual-paper-close-authorization',{authorization:a,authorizationSha256:o.authorizationSha256,orderId:id,claim,existingPending:!!pending});
 coordinator.recover();
 if(!claim.priorRecoveryAllowed&&!claim.priorInternalShutdownVerified)o.ledger.pause('manual-hard:'+manualCloseSha256({id,revision:o.ledger.state().revision}),clock(),claim.before.controls.reason);
 if(!pending){
  need(clock()<a.expiresAt,'AUTHORIZATION_EXPIRED_BEFORE_QUOTE');validateMarketPool(o.pool,clock());need(o.pool.mint===a.mint&&(o.pool.basis!=='current-canonical-pool'||o.pool.pool===a.pool),'POOL_PROOF_BINDING');
  market=new PilotMarket({rpc:o.rpc(),inventory:()=>o.ledger.state(),price:()=>null,recorder:{record:o.record},now,timeoutMs:3000,executionRealism:true,gas:{baseFeeLamports:'5000',priorityFeeLamports:'2000',evidence:'native PAPER unchanged explicit simulated base5000 plus priority2000 lamports'}});market.registerPool(o.pool);
  const signal=AbortSignal.timeout(3000),context=await market.context(o.ledger.state().positions,signal);
  const quote=await market.quote({mint:a.mint,side:'sell',inputUnits:a.units},signal),decidedAt=clock();
  need(quote&&quote.mint===a.mint&&quote.side==='sell'&&quote.inputUnits===a.units&&amount(quote.outputUnits)&&quote.at<=decidedAt&&decidedAt-quote.at<=2000,'FRESH_EXACT_SIZE_DECISION_QUOTE_REQUIRED');
  need(decidedAt<a.expiresAt,'AUTHORIZATION_EXPIRED_BEFORE_RESERVATION');identity(o.ledger.state(),a);position(o.ledger.state(),a);
  const minimum=BigInt(quote.outputUnits)*9900n/10000n;need(minimum>0n,'NONZERO_SLIPPAGE_MINIMUM');
  const request:Omit<Order,'reserved'|'allocation'>={id,mint:a.mint,side:'sell',decidedAt,executeAt:decidedAt+1000,expiresAt:decidedAt+5000,gas:'7000',deposit:'0',maxSpend:'0',minReceive:minimum.toString(),decisionEvidence:quote.evidence,decisionContext:{schemaVersion:1,strategyVersion:claim.before.positions[a.mint]!.strategy!.version,reason:`Owner authorized one PAPER close: ${o.authorizationSha256}`,candidateAdmittedAt:null,windowStartAt:null,windowEndAt:null,assessedAt:decidedAt,decisionQuoteAt:quote.at}};
  o.record('manual-paper-close-decision',{authorizationSha256:o.authorizationSha256,order:request,quote,context,entryPermissionGranted:false,marketPriceOverridden:false});
  coordinator.reserve(request,context);order=structuredClone(o.ledger.state().pending[id]??null);need(order,'NORMAL_RESERVATION_REFUSED');
  o.record('manual-paper-close-reserved',{order,reservation:o.ledger.actionResult('order:'+id),authorizationSha256:o.authorizationSha256});
 }
 const due=coordinator.nextDueAt();need(due!==null&&due<=clock()+30000,'PENDING_DUE_BOUND');await wait(due);
 const batch=await coordinator.runDue({maxActions:1});
 const receipt=coordinator.recordedOutcome(id);
 o.record('manual-paper-close-attempt',{orderId:id,batch,executionReceipt:receipt,liveTransactionSubmitted:false});
 return result(receipt,false);
}
