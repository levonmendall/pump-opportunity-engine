/** Process-local proof production for a narrowly authenticated technical pause.
 * Ledger independently validates the control-history authority and CAS. */
import type {LedgerState} from './ledger.js';
import type {ExecutionContext} from './execution.js';
export type TechnicalProtectionRecoveryAuthority={verified:true;accountId:string;inceptionAt:number;stateRevision:number;controlChangedAt:number;controlReason:string;originRevision:number;authoritySha256:string}|{verified:false;reason:string};
export type TechnicalProtectionRecoveryProof={version:'paper-technical-protection-recovery-v1';authoritySha256:string;originRevision:number;accountId:string;inceptionAt:number;stateRevision:number;controlChangedAt:number;controlReason:string;positionUnits:Record<string,string>;startedAt:number;completedAt:number;completedEvaluations:number;maximumCompletedGapMs:number;lastQuoteAt:number};
type Completion={units:string;quoteAt:number;at:number};
type Progress={inventory:string;controlChangedAt:number;controlReason:string;positionUnits:Record<string,string>;startedAt:number;completedAt:number;completedEvaluations:number;maximumCompletedGapMs:number;lastQuoteAt:number;lastReconciliationAt:number;quotes:Record<string,number>};
const inventory=(s:LedgerState)=>Object.fromEntries(Object.entries(s.positions).sort(([a],[b])=>a.localeCompare(b)).map(([mint,p])=>[mint,p.units]));
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;
const validPrice=(c:ExecutionContext,at:number)=>!!c.price&&integer(c.price.at)&&c.price.at<=at&&at-c.price.at<=10000&&/^[1-9][0-9]{0,38}$/.test(c.price.microUsdPerSol)&&typeof c.price.source==='string'&&c.price.source.length>0&&c.price.source.length<=512&&!/[\u0000-\u001f]/.test(c.price.source);
export class TechnicalProtectionRecoveryTracker{
 private progress:Progress|null=null;
 private readonly completed=new Map<string,Completion>();
 private issued=new WeakSet<TechnicalProtectionRecoveryProof>();
 private recorded=new WeakSet<TechnicalProtectionRecoveryProof>();
 private authoritySha256:string|null=null;
 reset(){this.progress=null;this.completed.clear();this.issued=new WeakSet();this.recorded=new WeakSet();this.authoritySha256=null;}
 private safe(s:LedgerState,c:ExecutionContext,at:number){
  return integer(at)&&at>=s.lastAt&&(s.mode==='PAPER'||s.mode==='DISPOSABLE_PAPER')&&!s.controls.entriesEnabled&&!s.controls.stopRequested&&!s.daily.lossPaused&&!Object.keys(s.pending).length&&s.daily.day===new Date(at).toISOString().slice(0,10)&&s.daily.reconciledAt>0&&s.daily.reconciledAt<=at&&at-s.daily.reconciledAt<=2000&&validPrice(c,at);
 }
 private marks(s:LedgerState,c:ExecutionContext,at:number){
  const positions=Object.values(s.positions);
  return !!positions.length&&integer(c.sourceValidUntil??-1)&&c.sourceValidUntil!>=at&&Object.keys(c.marks).length===positions.length&&positions.every(p=>{const m=c.marks[p.mint];return !!m&&m.pricedBaseUnits===p.units&&integer(m.at)&&m.at>=p.enteredAt&&m.at<=at&&at-m.at<=2000&&/^(0|[1-9][0-9]{0,38})$/.test(m.netLamports)&&typeof m.evidence==='string'&&m.evidence.length>0&&m.evidence.length<=512&&!/[\u0000-\u001f]/.test(m.evidence);});
 }
 private advance(s:LedgerState,at:number,lastQuoteAt:number,quotes:Record<string,number>,extraGap=0){
  const units=inventory(s),key=JSON.stringify(units),old=this.progress;
  if(!old||old.inventory!==key||old.controlChangedAt!==s.controls.changedAt||old.controlReason!==s.controls.reason||at<old.completedAt||at-old.completedAt>4000){this.progress={inventory:key,controlChangedAt:s.controls.changedAt,controlReason:s.controls.reason,positionUnits:units,startedAt:at,completedAt:at,completedEvaluations:1,maximumCompletedGapMs:0,lastQuoteAt,lastReconciliationAt:s.daily.reconciledAt,quotes};return;}
  this.progress={...old,completedAt:at,completedEvaluations:old.completedEvaluations+1,maximumCompletedGapMs:Math.max(old.maximumCompletedGapMs,at-old.completedAt,extraGap),lastQuoteAt,lastReconciliationAt:s.daily.reconciledAt,quotes};
 }
 /** Called only after the required trader-held-evaluation record returned. A
  * cache reuse or proof polling never advances a held completion. */
 observeHeld(s:LedgerState,c:ExecutionContext,event:{mint:string;units:string;quoteAt:number|null;usable:boolean},at:number,financialSafe:boolean){
  if(!financialSafe||!this.safe(s,c,at)||!this.marks(s,c,at)||!event.usable||event.quoteAt===null||!s.positions[event.mint]||s.positions[event.mint]!.units!==event.units||c.marks[event.mint]?.at!==event.quoteAt){this.reset();return;}
  const units=inventory(s),key=JSON.stringify(units);if(this.progress&&(this.progress.inventory!==key||this.progress.controlChangedAt!==s.controls.changedAt||this.progress.controlReason!==s.controls.reason))this.reset();
  const previous=this.completed.get(event.mint);if(previous&&event.quoteAt<=previous.quoteAt)return;
  if(previous&&(at<previous.at||at-previous.at>4000))this.reset();
  this.completed.set(event.mint,{units:event.units,quoteAt:event.quoteAt,at});
  const all=Object.entries(units);if(!all.every(([mint,size])=>{const e=this.completed.get(mint);return !!e&&e.units===size&&e.quoteAt===c.marks[mint]!.at&&at-e.at<=4000;}))return;
  const quotes=Object.fromEntries(all.map(([mint])=>[mint,this.completed.get(mint)!.quoteAt]));
  if(this.progress&&all.some(([mint])=>quotes[mint]!<=this.progress!.quotes[mint]!))return;
  this.advance(s,at,Math.min(...Object.values(quotes)),quotes,previous?at-previous.at:0);
 }
 proof(authority:TechnicalProtectionRecoveryAuthority,s:LedgerState,c:ExecutionContext,at:number,operationalHealthy:boolean,financialSafe:boolean):TechnicalProtectionRecoveryProof|null{
  if(!operationalHealthy||!financialSafe||!authority.verified||!this.safe(s,c,at)||authority.accountId!==s.accountId||authority.inceptionAt!==s.inceptionAt||authority.stateRevision!==s.revision||authority.controlChangedAt!==s.controls.changedAt||authority.controlReason!==s.controls.reason||!integer(authority.originRevision)||authority.originRevision>s.revision||!/^[a-f0-9]{64}$/.test(authority.authoritySha256)){this.reset();return null;}
  if(this.authoritySha256!==authority.authoritySha256){this.reset();this.authoritySha256=authority.authoritySha256;}
  const units=inventory(s),key=JSON.stringify(units);
  if(!Object.keys(units).length){
   // Cash recovery is explicitly financial reconciliation, never a fictitious
   // held liquidation/protection check. Only actual new commits advance it.
   if(Object.keys(c.marks).length){this.reset();return null;}
   if(!this.progress||this.progress.inventory!==key||s.daily.reconciledAt>this.progress.lastReconciliationAt)this.advance(s,at,c.price!.at,{});
  }else if(!this.marks(s,c,at)){this.reset();return null;}
  const p=this.progress;if(!p||p.inventory!==key||at<p.completedAt||at-p.completedAt>2000||p.completedAt-p.startedAt<60000||p.maximumCompletedGapMs>4000||p.completedEvaluations<16||p.lastQuoteAt>at||at-p.lastQuoteAt>2000)return null;
  const proof:TechnicalProtectionRecoveryProof=Object.freeze({version:'paper-technical-protection-recovery-v1',authoritySha256:authority.authoritySha256,originRevision:authority.originRevision,accountId:s.accountId,inceptionAt:s.inceptionAt,stateRevision:s.revision,controlChangedAt:s.controls.changedAt,controlReason:s.controls.reason,positionUnits:Object.freeze({...units}),startedAt:p.startedAt,completedAt:p.completedAt,completedEvaluations:p.completedEvaluations,maximumCompletedGapMs:p.maximumCompletedGapMs,lastQuoteAt:p.lastQuoteAt});this.issued.add(proof);return proof;
 }
 private postResume(proof:TechnicalProtectionRecoveryProof,s:LedgerState,at:number){return this.issued.has(proof)&&integer(at)&&at>=s.lastAt&&s.accountId===proof.accountId&&s.inceptionAt===proof.inceptionAt&&s.revision===proof.stateRevision+1&&s.controls.entriesEnabled&&!s.controls.stopRequested&&!s.daily.paused&&!s.daily.lossPaused&&s.controls.reason==='explicit verified operating financial readiness'&&!Object.keys(s.pending).length&&JSON.stringify(inventory(s))===JSON.stringify(proof.positionUnits)&&at>=proof.completedAt&&at-proof.completedAt<=2000;}
 recordRetained(proof:TechnicalProtectionRecoveryProof,s:LedgerState,at:number){const valid=this.postResume(proof,s,at);if(valid)this.recorded.add(proof);return valid;}
 committed(proof:TechnicalProtectionRecoveryProof,s:LedgerState,at:number){
  const valid=this.recorded.has(proof)&&this.postResume(proof,s,at);
  this.reset();return valid;
 }
 hasIssued(proof:TechnicalProtectionRecoveryProof){return this.issued.has(proof);}
 view(){const p=this.progress;return p?{startedAt:p.startedAt,completedAt:p.completedAt,completedEvaluations:p.completedEvaluations,maximumCompletedGapMs:p.maximumCompletedGapMs,lastQuoteAt:p.lastQuoteAt,heldPositions:Object.keys(p.positionUnits).length}:null;}
}
