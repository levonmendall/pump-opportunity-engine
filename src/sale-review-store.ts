/** Separate durable reporting database. The financial connection is read-only. */
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {closeSync,constants,lstatSync,mkdirSync,openSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {pendingSaleReview,unavailableSaleReview,completeSaleReview,positiveAmount,reviewTime,SALE_REVIEW_GRACE_MS,type SaleReview,type SaleReviewReport,type SalePricePoint} from './sale-review.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from './operating-intelligence.js';
const APP_ID=0x504f4553;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fillId=(action:string)=>'paper-fill:'+createHash('sha256').update(action).digest('hex').slice(0,32);
function need(v:unknown,reason:string):asserts v {if(!v)throw Error(reason);}
function privateFile(path:string){const s=lstatSync(path);need(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&s.uid===process.getuid?.()&&(s.mode&0o077)===0&&realpathSync(path)===path,'SALE_REVIEW_PRIVATE_FILE_REQUIRED');return s;}
function openStore(path:string,accountId:string,inceptionAt:string){
  need(isAbsolute(path)&&resolve(path)===path&&path.endsWith('/sale-reviews.sqlite'),'SALE_REVIEW_STORE_PATH_REQUIRED');
  const parent=dirname(path);mkdirSync(parent,{recursive:true,mode:0o700});const dir=lstatSync(parent);
  need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid?.()&&(dir.mode&0o077)===0&&realpathSync(parent)===parent,'SALE_REVIEW_PRIVATE_DIRECTORY_REQUIRED');
  try{const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);closeSync(fd);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  const before=privateFile(path);
  if(before.size){
    const inspect=new Database(path,{readonly:true,fileMustExist:true,timeout:0});
    try{
      const tables=inspect.prepare("SELECT type,name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as {type:string;name:string}[];
      need(inspect.pragma('application_id',{simple:true})===APP_ID&&JSON.stringify(tables)===JSON.stringify([{type:'table',name:'sale_review_identity'},{type:'table',name:'sale_reviews'},{type:'index',name:'sale_reviews_due'},{type:'index',name:'sale_reviews_time'}]),'SALE_REVIEW_FOREIGN_DATABASE');
      const expected:Record<string,string[]>= {sale_review_identity:['id','account_id','inception_at','cursor'],sale_reviews:['fill_id','due_at','phase','body']};
      for(const name of Object.keys(expected)){const cols=inspect.pragma('table_info('+name+')') as {name:string}[];need(JSON.stringify(cols.map(c=>c.name))===JSON.stringify(expected[name]),'SALE_REVIEW_FOREIGN_DATABASE');}
      const identity=inspect.prepare('SELECT account_id,inception_at FROM sale_review_identity WHERE id=1').get() as {account_id:string;inception_at:string}|undefined;
      need(identity?.account_id===accountId&&identity.inception_at===inceptionAt,'SALE_REVIEW_ACCOUNT_CONFLICT');
    }finally{inspect.close();}
  }
  const after=privateFile(path);need(before.ino===after.ino&&before.dev===after.dev&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'SALE_REVIEW_STORE_CHANGED');
  const db=new Database(path,{fileMustExist:true,timeout:100});
  try{
    db.pragma('journal_mode = WAL');db.pragma('synchronous = FULL');
    db.transaction(()=>{
      db.pragma('application_id = '+APP_ID);
      db.exec('CREATE TABLE IF NOT EXISTS sale_review_identity(id INTEGER PRIMARY KEY CHECK(id=1),account_id TEXT NOT NULL,inception_at TEXT NOT NULL,cursor INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sale_reviews(fill_id TEXT PRIMARY KEY,due_at INTEGER NOT NULL,phase TEXT NOT NULL,body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS sale_reviews_due ON sale_reviews(phase,due_at,fill_id); CREATE INDEX IF NOT EXISTS sale_reviews_time ON sale_reviews(due_at DESC,fill_id);');
      db.prepare('INSERT OR IGNORE INTO sale_review_identity VALUES(1,?,?,0)').run(accountId,inceptionAt);
    })();
    return db;
  }catch(e){db.close();throw e;}
}
export type ReviewIdentity={accountId:string;inceptionAt:string};
export class SaleReviewStore {
  private readonly db:Database.Database;
  readonly identity:ReviewIdentity;
  constructor(path:string,identity:ReviewIdentity={accountId:ORIGINAL_POE_ACCOUNT,inceptionAt:ORIGINAL_POE_INCEPTION}){
    this.identity=identity;this.db=openStore(path,identity.accountId,identity.inceptionAt);
    // A durable pre-request claim is never retried after a crash. At-most-once
    // lookup is preferred to silently substituting another observation time.
    this.db.transaction(()=>{
      const rows=this.db.prepare("SELECT body FROM sale_reviews WHERE phase='claimed'").all() as {body:string}[];
      for(const row of rows)this.finish(unavailableSaleReview(JSON.parse(row.body),'LOOKUP_INTERRUPTED'));
    })();
  }
  close(){this.db.close();}
  cursor(){return (this.db.prepare('SELECT cursor FROM sale_review_identity WHERE id=1').get() as {cursor:number}).cursor;}
  add(review:SaleReview){
    const prior=this.get(review.fillId);
    if(prior){need(prior.mint===review.mint&&prior.filledAt===review.filledAt&&JSON.stringify(prior.salePrice)===JSON.stringify(review.salePrice),'SALE_REVIEW_FILL_CONFLICT');return false;}
    this.db.prepare('INSERT INTO sale_reviews VALUES(?,?,?,?)').run(review.fillId,review.dueAt,review.status==='PENDING'?'pending':'done',JSON.stringify(review));return true;
  }
  get(id:string):SaleReview|null{const row=this.db.prepare('SELECT body FROM sale_reviews WHERE fill_id=?').get(id) as {body:string}|undefined;return row?JSON.parse(row.body):null;}
  finish(review:SaleReview){need(review.status!=='PENDING','SALE_REVIEW_FINAL_RESULT_REQUIRED');this.db.prepare("UPDATE sale_reviews SET phase='done',body=? WHERE fill_id=? AND phase!='done'").run(JSON.stringify(review),review.fillId);}
  /** Bounded local page, no full ledger scans per tick and no journal mutations. */
  ingest(ledger:Database.Database,now:number){
    const state=ledger.prepare("SELECT json_extract(body,'$.accountId') accountId,json_extract(body,'$.inceptionAt') inceptionAt,json_extract(body,'$.mode') mode,json_extract(body,'$.revision') revision FROM financial_state WHERE singleton=1").get() as {accountId:string;inceptionAt:number;mode:string;revision:number}|undefined;
    need(state?.mode==='PAPER'&&state.accountId===this.identity.accountId&&state.inceptionAt===Date.parse(this.identity.inceptionAt)&&reviewTime(state.revision)&&state.revision>=this.cursor(),'SALE_REVIEW_LEDGER_IDENTITY');
    const rows=ledger.prepare("SELECT revision,action_id,at,kind,CASE WHEN kind='attempt' AND length(CAST(detail AS BLOB))<=65536 THEN detail END detail FROM journal WHERE revision>? AND revision<=? ORDER BY revision LIMIT 512").all(this.cursor(),state.revision) as {revision:number;action_id:string;at:number;kind:string;detail:string|null}[];
    const reviews:SaleReview[]=[];
    for(const row of rows){
      if(row.kind!=='attempt')continue;
      need(row.detail,'SALE_REVIEW_ATTEMPT_UNAVAILABLE');
      const attempt=JSON.parse(row.detail),receipt=ledger.prepare('SELECT payload_hash,result FROM actions WHERE id=? AND length(CAST(result AS BLOB))<=65536').get(row.action_id) as {payload_hash:string;result:string}|undefined;
      need(receipt&&receipt.payload_hash===hash({kind:'attempt',payload:attempt}),'SALE_REVIEW_ATTEMPT_INVALID');
      const result=JSON.parse(receipt.result);if(result.status!=='filled')continue;
      const orderRow=ledger.prepare("SELECT j.detail,a.payload_hash FROM journal j JOIN actions a ON a.id=j.action_id WHERE j.action_id=? AND j.kind='order' AND length(CAST(j.detail AS BLOB))<=65536").get('order:'+attempt.orderId) as {detail:string;payload_hash:string}|undefined;
      need(orderRow,'SALE_REVIEW_ORDER_UNAVAILABLE');const order=JSON.parse(orderRow.detail);
      need(orderRow.payload_hash===hash({kind:'order',payload:order}),'SALE_REVIEW_ORDER_INVALID');
      const o=order.input,q=attempt.quote;if(o?.side!=='sell')continue;
      need(o.id===attempt.orderId&&result.at===row.at&&attempt.now===row.at&&row.at<=now&&q&&positiveAmount(q.receiveUnits)&&positiveAmount(q.pricedBaseUnits),'SALE_REVIEW_SELL_INVALID');
      // Every action ID has its own row, including multiple partial fills of an order.
      let review=pendingSaleReview(fillId(row.action_id),o.mint,row.at,{quoteLamports:q.receiveUnits,baseUnits:q.pricedBaseUnits});
      if(now>review.dueAt+SALE_REVIEW_GRACE_MS)review=unavailableSaleReview(review,'CHECKPOINT_MISSED');
      reviews.push(review);
    }
    this.db.transaction(()=>{for(const review of reviews)this.add(review);if(rows.length)this.db.prepare('UPDATE sale_review_identity SET cursor=? WHERE id=1').run(rows.at(-1)!.revision);})();
    return {scanned:rows.length,discovered:reviews.length,caughtUp:rows.length<512};
  }
  claim(now:number):SaleReview|null {
    return this.db.transaction(()=>{
      const missed=this.db.prepare("SELECT body FROM sale_reviews WHERE phase='pending' AND due_at<? ORDER BY due_at LIMIT 128").all(now-SALE_REVIEW_GRACE_MS) as {body:string}[];
      for(const old of missed)this.finish(unavailableSaleReview(JSON.parse(old.body),'CHECKPOINT_MISSED'));
      const row=this.db.prepare("SELECT body FROM sale_reviews WHERE phase='pending' AND due_at>=? AND due_at<=? ORDER BY due_at,fill_id LIMIT 1").get(now-SALE_REVIEW_GRACE_MS,now) as {body:string}|undefined;
      if(!row)return null;const review=JSON.parse(row.body) as SaleReview;
      if(now>review.dueAt+SALE_REVIEW_GRACE_MS){this.finish(unavailableSaleReview(review,'CHECKPOINT_MISSED'));return null;}
      this.db.prepare("UPDATE sale_reviews SET phase='claimed' WHERE fill_id=? AND phase='pending'").run(review.fillId);return review;
    })();
  }
  async checkOne(readPrice:(mint:string,signal:AbortSignal)=>Promise<SalePricePoint|null>,now=Date.now){
    const review=this.claim(now());if(!review)return false;
    let point:SalePricePoint|null=null;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try{point=await Promise.race([readPrice(review.mint,controller.signal),new Promise<null>(r=>{timer=setTimeout(()=>{controller.abort();r(null);},5000);})]);}catch{}finally{clearTimeout(timer);}
    this.finish(completeSaleReview(review,point,now()));return true;
  }
  report(now=Date.now()):SaleReviewReport {
    const rows=this.db.prepare('SELECT body FROM sale_reviews ORDER BY due_at DESC,fill_id LIMIT 50').all() as {body:string}[];
    return {schemaVersion:1,accountId:this.identity.accountId,inceptionAt:this.identity.inceptionAt,generatedAt:now,basis:'four-hour-price-only',reviews:rows.map(row=>{const r=JSON.parse(row.body) as SaleReview;return r.status==='PENDING'&&now>r.dueAt+SALE_REVIEW_GRACE_MS?unavailableSaleReview(r,'CHECKPOINT_MISSED'):r;})};
  }
}
export function openSaleReviewLedger(path:string){
  need(isAbsolute(path)&&resolve(path)===path,'SALE_REVIEW_LEDGER_PATH');privateFile(path);
  const db=new Database(path,{readonly:true,fileMustExist:true,timeout:0});db.pragma('query_only = ON');return db;
}
