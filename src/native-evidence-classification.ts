/** Candidate preparation is retained with its provisional proof. Financial
 * outcomes and account-control evidence remain in the permanent essential chain. */
export function nativePaperCandidatePreparationEvidence(kind:string,work:string){
 return work==='candidate'&&(kind==='trader-quote'||kind==='trader-pilot-entry-deposit'||/^(?:research-clock-|pool-state|price-|sdk-|rent-)/.test(kind)||kind==='pilot-entry-cost-preparation'||kind==='rpc-market-quote');
}
/** Raw examples explain accepted shapes or an already rejected window. They
 * supply no trade amounts, audit completeness or financial permission: those
 * records remain independently required. Capacity omission of a literal
 * supplementary sample must not close an otherwise complete candidate. */
export function nativePaperSupplementaryEvidence(kind:string,data:unknown){
 return (kind==='native-flow-raw-representative'||kind==='native-flow-raw-refusal')
  &&(data as {supplementaryOnly?:unknown}|null)?.supplementaryOnly===true;
}
export function nativePaperEssentialEvidence(kind:string,work:string,owned:boolean,data?:unknown){
 if(kind==='native-paper-entry-proof-pinned'&&(data as {provisional?:unknown}|null)?.provisional===true)return false;
 if(kind==='native-opportunity-evaluation'||kind==='pilot-entry-local-reprice')return false;
 if(kind==='trader-input'||kind==='trader-predictive-assessment'||kind==='trader-candidate-evidence-deferred'||kind==='trader-quote-deferred')return false;
 if(kind==='trader-context'||kind==='trader-context-reuse'||kind==='trader-held-evaluation')return owned;
 if(kind==='trader-decision'){const stage=(data as {stage?:unknown}|null)?.stage;return owned||stage==='qualified'||stage==='exit-reserved';}
 if(kind==='paper-unsigned-pumpswap')return owned&&(work==='pending'||work==='protection');
 if(kind.startsWith('paper-execution-')||kind==='native-paper-protection-dispatch-yield')return true;
 if(kind==='trader-candidate-financial-evaluation-failed'||kind==='trader-financial-maintenance-failed'||kind==='trader-config'||kind==='trader-execution'||kind==='trader-quote'||kind.startsWith('trader-pilot-execution-')||kind==='trader-pilot-entry-deposit')return true;
 if((work==='candidate'||owned&&(work==='pending'||work==='protection'))&&(/^(?:research-clock-|pool-state|price-|sdk-|rent-)/.test(kind)||kind==='pilot-entry-cost-preparation'||kind==='rpc-market-quote'))return true;
 return /^native-paper-(?:start|stop|frozen|entry|recovery|consistent-backup|source-unavailable|management-reserve)/.test(kind);
}
/** Lazy ownership is an optimization of classification, never a cached
 * financial permission. Both possible classifications must agree before a
 * ledger read can be omitted; ownership-dependent records read current state. */
export function nativePaperEssentialEvidenceLazy(kind:string,work:string,readOwned:()=>boolean,data?:unknown){
 const withoutOwnership=nativePaperEssentialEvidence(kind,work,false,data),withOwnership=nativePaperEssentialEvidence(kind,work,true,data);
 return withoutOwnership===withOwnership?withoutOwnership:(readOwned()?withOwnership:withoutOwnership);
}
