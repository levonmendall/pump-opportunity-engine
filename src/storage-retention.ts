import type {PaperLedger,LedgerState} from './ledger.js';

/** A disposable in-memory index, rebuilt from the complete indexed order history
 * after every restart. Financial rows and their original evidence are never edited.
 * Synchronous reservation protection closes the gap for orders added during or
 * after the initial scan, even if their IDs sort before the scan cursor. */
export class FinancialRetentionIndex {
  private readonly mints=new Set<string>();
  private cursor='order:';
  private complete=false;
  private orders=0;
  private failure:string|null=null;
  protect(mint:string){
    if(typeof mint!=='string'||!mint||mint.length>256)throw Error('RETENTION_FINANCIAL_MINT_REQUIRED');
    this.mints.add(mint);
  }
  bootstrap(ledger:Pick<PaperLedger,'retentionOrderReferences'>){
    if(this.complete)return;
    try{
      const page=ledger.retentionOrderReferences(this.cursor,128);
      for(const mint of page.mints)this.protect(mint);
      this.cursor=page.after;this.orders+=page.orders;this.complete=page.complete;this.failure=null;
    }catch{this.failure='FINANCIAL_REFERENCE_HISTORY_UNAVAILABLE';}
  }
  protectedMints(state:Readonly<LedgerState>,active:Iterable<string>=[]){
    const current=new Set(Object.keys(state.positions));
    for(const order of Object.values(state.pending))current.add(order.mint);
    for(const mint of active)current.add(mint);
    // Membership lookup only: never copy or iterate the lifetime financial set
    // in a bounded housekeeping turn. The event loop cannot interleave this pass.
    return {has:(mint:string)=>this.mints.has(mint)||current.has(mint)};
  }
  ready(){return this.complete&&this.failure===null;}
  status(){return {schemaVersion:1,financialHistoryComplete:this.ready(),financialOrdersIndexed:this.orders,permanentlyProtectedMints:this.mints.size,reason:this.failure,financialWrites:0 as const};}
}
