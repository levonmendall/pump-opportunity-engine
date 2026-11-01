export function nativePaperEssentialEvidence(kind:string,work:string,owned:boolean,data?:unknown){
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
