/** Runs only in the independent reporting process, never in the PAPER trader. */
import {join,dirname} from 'node:path';
import type Database from 'better-sqlite3';
import {ReadOnlyRpc} from './network.js';
import {SaleReviewStore,openSaleReviewLedger} from './sale-review-store.js';
import {readSaleReviewPrice} from './sale-review-price.js';
const RECEIVER='https://meme-machine-dashboard-staging.onrender.com/api/sale-reviews';
export class SaleReviewCompanion {
  private store:SaleReviewStore|null=null;
  private ledger:Database.Database|null=null;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private active:Promise<void>|null=null;
  private stopped=false;
  private lastIngest=0;
  private lastDelivery=0;
  private lastFailure=0;
  private readonly rpc=new ReadOnlyRpc(undefined,fetch,{profile:'runtime',timeoutMs:5000,maxInFlight:1,maxCallsPerMinute:60});
  constructor(private readonly options:{ledgerFile:string;equityStoreFile:string;secret:string}){}
  private async tick(){
    try{
      this.store??=new SaleReviewStore(join(dirname(this.options.equityStoreFile),'sale-reviews.sqlite'));
      this.ledger??=openSaleReviewLedger(this.options.ledgerFile);
      // Due prices are serviced before optional source catch-up and publishing.
      await this.store.checkOne((mint,signal)=>readSaleReviewPrice(this.rpc,mint,signal));
      if(this.stopped)return;
      const now=Date.now();
      if(now-this.lastIngest>=15000){const result=this.store.ingest(this.ledger,now);this.lastIngest=result.caughtUp?now:0;}
      if(now-this.lastDelivery>=30000){
        this.lastDelivery=now;
        const response=await fetch(RECEIVER,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{authorization:'Bearer '+this.options.secret,'content-type':'application/json'},body:JSON.stringify(this.store.report(now))});
        await response.body?.cancel();if(!response.ok)throw Error('SALE_REVIEW_DELIVERY_UNAVAILABLE');
      }
    }catch{
      const now=Date.now();if(now-this.lastFailure>=60000){this.lastFailure=now;process.stderr.write('POE_SALE_REVIEW_REPORTING_UNAVAILABLE; trading unaffected\n');}
    }
  }
  start(){
    if(this.timer||this.active||this.stopped)return;
    const run=()=>{if(this.stopped)return;this.active=this.tick().finally(()=>{this.active=null;if(!this.stopped)this.timer=setTimeout(run,1000);});};run();
  }
  async stop(){this.stopped=true;clearTimeout(this.timer);await this.active;this.ledger?.close();this.store?.close();this.ledger=null;this.store=null;}
}
