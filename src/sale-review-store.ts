/** Separate durable reporting database. Never receives a financial writer. */
import {randomUUID} from 'node:crypto';
import {SALE_REVIEW_POLICY,pendingSaleReview,unavailableSaleReview,finishSaleReview,validateSaleReview,type SaleReview,type SaleReviewSale,type SaleReviewObservation} from './sale-review.js';
export type ReviewSqlValue=string|number|bigint|null;
export type ReviewSqlDatabase={exec(sql:string):unknown;prepare(sql:string):{get(...params:any[]):unknown;all(...params:any[]):unknown[];run(...params:any[]):{changes:number|bigint}}};
export class SaleReviewStore{
 constructor(readonly db:ReviewSqlDatabase,readonly accountId:string,readonly inceptionAt:number){
  db.exec(`PRAGMA busy_timeout=100; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS sale_review_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS sale_reviews(trade_id TEXT PRIMARY KEY,action_id TEXT NOT NULL UNIQUE,sold_at INTEGER NOT NULL,due_at INTEGER NOT NULL,state TEXT NOT NULL,claim TEXT,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS sale_reviews_due ON sale_reviews(state,due_at);
   CREATE INDEX IF NOT EXISTS sale_reviews_recent ON sale_reviews(sold_at DESC);`);
  this.transaction(()=>{const binding=JSON.stringify({accountId,inceptionAt});const prior=this.meta('binding');if(prior!==null&&prior!==binding)throw Error('SALE_REVIEW_WRONG_ACCOUNT');this.setMeta('binding',binding);if(this.meta('cursor')===null)this.setMeta('cursor','-1');if(this.meta('sequence')===null)this.setMeta('sequence','0');});
 }
 private transaction<T>(work:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 private meta(key:string){return (this.db.prepare('SELECT value FROM sale_review_meta WHERE key=?').get(key) as {value:string}|undefined)?.value??null;}
 private setMeta(key:string,value:string){this.db.prepare('INSERT INTO sale_review_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
 private changed(){this.setMeta('sequence',(BigInt(this.meta('sequence')!)+1n).toString());}
 cursor(){return Number(this.meta('cursor'));}
 sequence(){return this.meta('sequence')!;}
 get(tradeId:string):SaleReview|null{const row=this.db.prepare('SELECT body FROM sale_reviews WHERE trade_id=?').get(tradeId) as {body:string}|undefined;return row?validateSaleReview(JSON.parse(row.body)):null;}
 /** Cursor and new jobs commit atomically, so a crash cannot lose a sale. */
 ingest(sales:SaleReviewSale[],throughRevision:number,now:number){
  if(!Number.isSafeInteger(throughRevision)||throughRevision<this.cursor()||!Number.isSafeInteger(now))throw Error('SALE_REVIEW_CURSOR_INVALID');
  return this.transaction(()=>{let added=0;for(const sale of sales){if(sale.accountId!==this.accountId||sale.soldAt<this.inceptionAt||sale.soldAt>now)throw Error('SALE_REVIEW_IDENTITY_OR_TIME');let r=pendingSaleReview(sale);const existing=this.get(r.tradeId);if(existing){if(existing.actionId!==r.actionId||existing.mint!==r.mint||existing.soldAt!==r.soldAt||JSON.stringify(existing.salePrice)!==JSON.stringify(r.salePrice))throw Error('SALE_REVIEW_FILL_CONFLICT');continue;}
   if(now>r.dueAt+SALE_REVIEW_POLICY.checkpointGraceMs)r=unavailableSaleReview(r,now,'CHECKPOINT_MISSED');
   this.db.prepare('INSERT INTO sale_reviews VALUES(?,?,?,?,?,NULL,?)').run(r.tradeId,r.actionId,r.soldAt,r.dueAt,r.status,JSON.stringify(r));added++;}
   this.setMeta('cursor',String(throughRevision));if(added)this.changed();return added;});
 }
 /** Call only after obtaining the companion's exclusive OS lease. Never retry a claimed price read. */
 recoverInterrupted(now:number){return this.transaction(()=>{const rows=this.db.prepare("SELECT trade_id,body FROM sale_reviews WHERE state='CHECKING'").all() as {trade_id:string;body:string}[];for(const row of rows){const r=unavailableSaleReview(validateSaleReview(JSON.parse(row.body)),now,'INTERRUPTED_CHECKPOINT');this.db.prepare('UPDATE sale_reviews SET state=?,claim=NULL,body=? WHERE trade_id=?').run(r.status,JSON.stringify(r),row.trade_id);}if(rows.length)this.changed();return rows.length;});}
 claimDue(now:number):{review:SaleReview;claim:string}|null{
  return this.transaction(()=>{
   const row=this.db.prepare("SELECT trade_id,body FROM sale_reviews WHERE state='PENDING' AND due_at<=? ORDER BY due_at,trade_id LIMIT 1").get(now) as {trade_id:string;body:string}|undefined;if(!row)return null;
   const review=validateSaleReview(JSON.parse(row.body));
   if(now>review.dueAt+SALE_REVIEW_POLICY.checkpointGraceMs){const missed=unavailableSaleReview(review,now,'CHECKPOINT_MISSED');this.db.prepare('UPDATE sale_reviews SET state=?,body=? WHERE trade_id=?').run(missed.status,JSON.stringify(missed),row.trade_id);this.changed();return null;}
   const claim=randomUUID();const changed=this.db.prepare("UPDATE sale_reviews SET state='CHECKING',claim=? WHERE trade_id=? AND state='PENDING'").run(claim,row.trade_id);return Number(changed.changes)===1?{review,claim}:null;
  });
 }
 complete(tradeId:string,claim:string,result:SaleReview){
  const validated=validateSaleReview(result);if(validated.tradeId!==tradeId||validated.accountId!==this.accountId||validated.status==='PENDING')throw Error('SALE_REVIEW_COMPLETION_INVALID');
  return this.transaction(()=>{const old=this.get(tradeId);if(!old||old.actionId!==validated.actionId||old.mint!==validated.mint||old.soldAt!==validated.soldAt||JSON.stringify(old.salePrice)!==JSON.stringify(validated.salePrice))throw Error('SALE_REVIEW_FILL_CONFLICT');const updated=this.db.prepare("UPDATE sale_reviews SET state=?,claim=NULL,body=? WHERE trade_id=? AND state='CHECKING' AND claim=?").run(validated.status,JSON.stringify(validated),tradeId,claim);if(Number(updated.changes))this.changed();return Number(updated.changes)===1;});
 }
 recent(limit=100){if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('SALE_REVIEW_REPORT_BOUND');return (this.db.prepare('SELECT body FROM sale_reviews ORDER BY sold_at DESC,trade_id LIMIT ?').all(limit) as {body:string}[]).map(row=>validateSaleReview(JSON.parse(row.body)));}
}
export type SaleReviewPriceReader=(review:SaleReview,signal:AbortSignal)=>Promise<SaleReviewObservation|null>;
/** At-most-one provider attempt. Provider failure never enters trading code. */
export async function runSaleReviewOnce(store:SaleReviewStore,readPrice:SaleReviewPriceReader,now:()=>number=Date.now){
 const claimed=store.claimDue(now());if(!claimed)return false;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let observation:SaleReviewObservation|null=null;
 try{observation=await Promise.race([Promise.resolve().then(()=>readPrice(claimed.review,controller.signal)),new Promise<null>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},SALE_REVIEW_POLICY.requestTimeoutMs);})]);}catch{/* Unavailable is final; there is no price retry. */}finally{clearTimeout(timer);controller.abort();}
 const result=finishSaleReview(claimed.review,observation,now());store.complete(claimed.review.tradeId,claimed.claim,result);return true;
}
