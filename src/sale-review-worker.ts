/** Reporting-only coordinator: receipt ingestion, one-shot prices and report delivery. */
import {SaleReviewStore,runSaleReviewOnce,type ReviewSqlDatabase,type SaleReviewPriceReader} from './sale-review-store.js';
import {readSaleReviewSales} from './sale-review-source.js';
import type {SaleReviewBatch} from './sale-review-reporting.js';
const RECEIVER='https://meme-machine-dashboard-staging.onrender.com/api/sale-reviews';
export class SaleReviewCompanion{
 private publishing:Promise<void>|null=null;private lastAttempt=-Infinity;private deliveredSequence:string|null=null;private lastDelivery=-Infinity;private busy=false;
 constructor(readonly store:SaleReviewStore,private readonly source:ReviewSqlDatabase,private readonly price:SaleReviewPriceReader,private readonly secret:string,private readonly transport:typeof fetch=fetch){}
 async tick(now:()=>number=Date.now){
  if(this.busy)return;this.busy=true;
  try{
   // Ingestion failures affect reports only. Already-durable due reviews can run.
   try{const start=performance.now();do{const page=readSaleReviewSales(this.source,{accountId:this.store.accountId,inceptionAt:this.store.inceptionAt},this.store.cursor(),now());if(page.throughRevision===this.store.cursor())break;this.store.ingest(page.sales,page.throughRevision,now());if(performance.now()-start>=20)break;}while(true);}catch{process.stderr.write('POE_SALE_REVIEW_SOURCE_UNAVAILABLE\n');}
   await runSaleReviewOnce(this.store,this.price,now);
   const at=now();if(!this.publishing&&at-this.lastAttempt>=15_000&&(this.deliveredSequence!==this.store.sequence()||at-this.lastDelivery>=60_000)){
    const batch:SaleReviewBatch={schemaVersion:1,accountId:this.store.accountId,inceptionAt:this.store.inceptionAt,sequence:this.store.sequence(),generatedAt:at,reviews:this.store.recent()};this.lastAttempt=at;
    // Delivery is independent of the next price checkpoint and retries only
    // stored reports, never a token price request.
    this.publishing=(async()=>{try{const r=await this.transport(RECEIVER,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:'Bearer '+this.secret,'content-type':'application/json'},body:JSON.stringify(batch)});await r.body?.cancel();if(r.ok){if(this.deliveredSequence!==batch.sequence)process.stdout.write('POE_SALE_REVIEW_REPORT_ACCEPTED sequence='+batch.sequence+'\n');this.deliveredSequence=batch.sequence;this.lastDelivery=Date.now();}}catch{/* Reporting retry only. */}finally{this.publishing=null;}})();
   }
  }finally{this.busy=false;}
 }
 async settle(){await this.publishing;}
}
