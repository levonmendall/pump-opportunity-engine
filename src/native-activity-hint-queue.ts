/** Native packets already have their independent flow/audit evidence. This
 * queue moves only optional scheduling hints out of the WebSocket callback;
 * it never manufactures a trade, source receipt, feature or timestamp. */
export type NativeActivityHint={mint:string;at:number;evidence:string};
export type PendingNativeActivityHint<G>={readonly row:Readonly<NativeActivityHint>;readonly generation:G};

export class NativeActivityHintQueue<G>{
 private readonly pending=new Map<string,PendingNativeActivityHint<G>>();
 private received=0;private coalesced=0;private applied=0;private stale=0;private discarded=0;
 private prune(isCurrent:(mint:string,generation:G)=>boolean){for(const [mint,p]of this.pending)if(!isCurrent(mint,p.generation)){this.pending.delete(mint);this.stale++;}}
 enqueue(row:NativeActivityHint,generation:G,isCurrent:(mint:string,generation:G)=>boolean):boolean{
  if(!row||typeof row.mint!=='string'||!row.mint||!Number.isSafeInteger(row.at)||row.at<0||typeof row.evidence!=='string'||!row.evidence||row.evidence.length>256)throw Error('NATIVE_ACTIVITY_HINT_INVALID');
  // Membership is the actual selected-generation set, not a market registry
  // quota. Prune before insertion so successive physical slot generations do
  // not leave an unbounded set of retired token references behind.
  this.prune(isCurrent);if(!isCurrent(row.mint,generation))return false;this.received++;
  const prior=this.pending.get(row.mint);if(prior){this.coalesced++;if(prior.generation===generation&&prior.row.at>=row.at)return true;}
  this.pending.set(row.mint,{row:Object.freeze({mint:row.mint,at:row.at,evidence:row.evidence}),generation});return true;
 }
 next(isCurrent:(mint:string,generation:G)=>boolean):PendingNativeActivityHint<G>|undefined{
  this.prune(isCurrent);let first:PendingNativeActivityHint<G>|undefined;for(const p of this.pending.values())if(!first||p.row.at<first.row.at)first=p;return first;
 }
 complete(pending:PendingNativeActivityHint<G>):void{if(this.pending.get(pending.row.mint)!==pending)return;this.pending.delete(pending.row.mint);this.applied++;}
 discard(pending:PendingNativeActivityHint<G>):void{if(this.pending.get(pending.row.mint)!==pending)return;this.pending.delete(pending.row.mint);this.discarded++;}
 clear():void{this.discarded+=this.pending.size;this.pending.clear();}
 usage(){return {pending:this.pending.size,received:this.received,coalesced:this.coalesced,applied:this.applied,stale:this.stale,discarded:this.discarded,meaning:'Coalesced scheduling hints only; independent native trade/audit evidence is not queued or backdated.'};}
}
