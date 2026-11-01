import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,chmodSync,readFileSync,linkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {pendingSaleReview,completeSaleReview,validateSaleReviewReport,SaleReviewCache,SALE_REVIEW_DELAY_MS,SALE_REVIEW_GRACE_MS,type SalePricePoint} from '../src/sale-review.js';
import {SaleReviewStore,openSaleReviewLedger} from '../src/sale-review-store.js';
const MINT='So11111111111111111111111111111111111111112',AT=Date.parse('2026-10-31T12:00:00.000Z'),DUE=AT+SALE_REVIEW_DELAY_MS;
const ID='paper-fill:'+'a'.repeat(32),identity={accountId:'poe-reporting-fixture',inceptionAt:new Date(AT-86400000*3).toISOString()};
const review=()=>pendingSaleReview(ID,MINT,AT,{quoteLamports:'100000000',baseUnits:'1000000'});
const point=(quoteLamports='100000000',observedAt=DUE):SalePricePoint=>({quoteLamports,baseUnits:'1000000',observedAt,sourceAt:observedAt,decimals:6});
function folder(t:TestContext){const dir=mkdtempSync(join(tmpdir(),'poe-sale-review-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function store(t:TestContext){const dir=folder(t),path=join(dir,'sale-reviews.sqlite');let s=new SaleReviewStore(path,identity);t.after(()=>s.close());return {path,get s(){return s;},restart(){s.close();s=new SaleReviewStore(path,identity);}};}
function report(r=review(),at=AT){return {schemaVersion:1 as const,...identity,generatedAt:at,basis:'four-hour-price-only' as const,reviews:[r]};}
for(const [name,price,status,change]of [['higher','140000000','BAD SALE','40.000000'],['lower','60000000','GOOD SALE','-40.000000'],['equal','100000000','UNCHANGED','0.000000']]as const){
 test(name+' four-hour price has exactly the requested classification',()=>{const r=completeSaleReview(review(),point(price),DUE);assert.equal(r.status,status);assert.equal(r.changePercent,change);assert.deepEqual(r.price,point(price));validateSaleReviewReport(report(r,DUE),identity.accountId,identity.inceptionAt,DUE);});
}
test('classification uses exact amounts, not floating point or displayed rounding',()=>{
 const r=pendingSaleReview(ID,MINT,AT,{quoteLamports:'9007199254740992',baseUnits:'1'});
 assert.equal(completeSaleReview(r,{...point('9007199254740993'),baseUnits:'1'},DUE).status,'BAD SALE');
 assert.equal(completeSaleReview(review(),{...point('200000000'),baseUnits:'2000000'},DUE).status,'UNCHANGED');
});
test('pending before due, eligible at due and grace boundary, unavailable after boundary',()=>{
 assert.equal(completeSaleReview(review(),point(),DUE-1).status,'PENDING');
 assert.equal(completeSaleReview(review(),point(),DUE).status,'UNCHANGED');
 const last=DUE+SALE_REVIEW_GRACE_MS;assert.equal(completeSaleReview(review(),point('100000000',last),last).status,'UNCHANGED');
 assert.equal(completeSaleReview(review(),point('100000000',last+1),last+1).status,'UNAVAILABLE');
});
test('missing, zero, malformed, stale, future and early prices are never classified as good sales',()=>{
 const invalid=[null,{...point(),quoteLamports:'0'},{...point(),baseUnits:'0'},{...point(),quoteLamports:'NaN'},{...point(),observedAt:DUE-1},{...point(),sourceAt:DUE+1},{...point(),sourceAt:DUE-30001},{...point(),observedAt:DUE+1},{...point(),decimals:-1}];
 for(const p of invalid){const r=completeSaleReview(review(),p,DUE);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.price,null);assert.equal(r.changePercent,null);}
});
test('one pending record survives restart and produces just one lookup',async t=>{
 const f=store(t);assert.equal(f.s.add(review()),true);assert.equal(f.s.add(review()),false);f.restart();let calls=0;
 const read=async()=>{calls++;return point('60000000');};
 assert.equal(await f.s.checkOne(read,()=>DUE-1),false);assert.equal(calls,0);
 assert.equal(await f.s.checkOne(read,()=>DUE),true);f.restart();assert.equal(await f.s.checkOne(read,()=>DUE+1000),false);
 assert.equal(calls,1);assert.equal(f.s.get(ID)!.status,'GOOD SALE');
});
test('a durable request claim is not repeated after an interrupted lookup',async t=>{
 const f=store(t);f.s.add(review());assert.ok(f.s.claim(DUE));f.restart();let calls=0;
 await f.s.checkOne(async()=>{calls++;return point();},()=>DUE+1000);
 assert.equal(calls,0);assert.equal(f.s.get(ID)!.status,'UNAVAILABLE');assert.equal(f.s.get(ID)!.reason,'LOOKUP_INTERRUPTED');
});
test('a missed checkpoint never obtains or substitutes a current price',async t=>{
 const f=store(t);f.s.add(review());let calls=0;await f.s.checkOne(async()=>{calls++;return point();},()=>DUE+SALE_REVIEW_GRACE_MS+1);
 assert.equal(calls,0);assert.equal(f.s.get(ID)!.reason,'CHECKPOINT_MISSED');
});
test('network errors and delayed responses finish unavailable without a retry',async t=>{
 const f=store(t);f.s.add(review());let calls=0;
 await f.s.checkOne(async()=>{calls++;throw Error('provider failure');},()=>DUE);f.restart();await f.s.checkOne(async()=>{calls++;return point();},()=>DUE+1000);
 assert.equal(calls,1);assert.equal(f.s.get(ID)!.status,'UNAVAILABLE');
 const second={...review(),fillId:'paper-fill:'+'b'.repeat(32)};f.s.add(second);let time=DUE;
 await f.s.checkOne(async()=>{time=DUE+SALE_REVIEW_GRACE_MS+1;return point('140000000',time);},()=>time);
 assert.equal(f.s.get(second.fillId)!.status,'UNAVAILABLE');assert.equal(f.s.get(second.fillId)!.price,null);
});
test('token age over 24 hours does not enter review eligibility or provider lookup',async t=>{
 const f=store(t),createdAt=AT-48*3600000;assert.ok(DUE-createdAt>86400000);f.s.add(review());let mint='';
 await f.s.checkOne(async m=>{mint=m;return point('140000000');},()=>DUE);assert.equal(mint,MINT);assert.equal(f.s.get(ID)!.status,'BAD SALE');
});
function ledgerFixture(dir:string){
 const path=join(dir,'ledger.sqlite'),db=new Database(path);chmodSync(path,0o600);
 db.exec('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT);CREATE TABLE journal(revision INTEGER PRIMARY KEY,action_id TEXT UNIQUE,at INTEGER,kind TEXT,detail TEXT);CREATE TABLE actions(id TEXT PRIMARY KEY,payload_hash TEXT,result TEXT);');
 let revision=0;const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const insert=(id:string,kind:string,payload:unknown,result:unknown)=>{db.prepare('INSERT INTO journal VALUES(?,?,?,?,?)').run(++revision,id,AT,kind,JSON.stringify(payload));db.prepare('INSERT INTO actions VALUES(?,?,?)').run(id,digest({kind,payload}),JSON.stringify(result));};
 insert('order:partial-order','order',{input:{id:'partial-order',mint:MINT,side:'sell'}},{accepted:true});
 for(const [id,quantity,received,status]of [['partial-1','400000','40000000','filled'],['partial-2','600000','66000000','filled'],['failed','100000','10000000','failed']]as const)insert(id,'attempt',{orderId:'partial-order',now:AT,quote:{receiveUnits:received,pricedBaseUnits:quantity,spendLamports:'0'}},{at:AT,status});
 insert('order:buy-order','order',{input:{id:'buy-order',mint:MINT,side:'buy'}},{accepted:true});insert('buy-1','attempt',{orderId:'buy-order',now:AT,quote:{receiveUnits:'100000',spendLamports:'1000'}},{at:AT,status:'filled'});
 db.prepare('INSERT INTO financial_state VALUES(1,?)').run(JSON.stringify({accountId:identity.accountId,inceptionAt:Date.parse(identity.inceptionAt),mode:'PAPER',revision}));db.close();return path;
}
test('read-only ingestion records each partial fill separately and ignores buys/failures',t=>{
 const f=store(t),ledger=ledgerFixture(join(f.path,'..')),before=readFileSync(ledger),source=openSaleReviewLedger(ledger);
 try{
  assert.throws(()=>source.exec('DELETE FROM journal'),/readonly/i);
  const one=f.s.ingest(source,AT),two=f.s.ingest(source,AT+1);assert.equal(one.discovered,2);assert.equal(two.discovered,0);
  const rows=f.s.report(AT+1).reviews;assert.equal(rows.length,2);assert.equal(new Set(rows.map(r=>r.fillId)).size,2);
  assert.deepEqual(rows.map(r=>r.salePrice.baseUnits).sort(),['400000','600000']);assert.deepEqual(rows.map(r=>r.salePrice.quoteLamports).sort(),['40000000','66000000']);
  f.restart();assert.equal(f.s.ingest(source,AT+2).discovered,0);assert.equal(f.s.report(AT+2).reviews.length,2);
 }finally{source.close();}assert.deepEqual(readFileSync(ledger),before);
});
test('historical missed checkpoints are marked unavailable without fabricated observations',t=>{
 const f=store(t),ledger=ledgerFixture(join(f.path,'..')),source=openSaleReviewLedger(ledger);
 try{f.s.ingest(source,DUE+86400000);for(const r of f.s.report(DUE+86400000).reviews){assert.equal(r.status,'UNAVAILABLE');assert.equal(r.price,null);}}finally{source.close();}
});
test('foreign, renamed and hardlinked databases are rejected without changing financial bytes',t=>{
 const dir=folder(t),path=join(dir,'sale-reviews.sqlite'),db=new Database(path);db.exec('CREATE TABLE financial_sentinel(value);');db.close();chmodSync(path,0o600);const before=readFileSync(path);
 assert.throws(()=>new SaleReviewStore(path,identity),/FOREIGN_DATABASE/);assert.deepEqual(readFileSync(path),before);
 const second=folder(t),alias=join(second,'sale-reviews.sqlite');linkSync(path,alias);assert.throws(()=>new SaleReviewStore(alias,identity),/PRIVATE_FILE_REQUIRED/);assert.deepEqual(readFileSync(path),before);
});
test('receiver rejects forged outcomes, foreign accounts, unknown fields and wrong fill bindings',()=>{
 const done=completeSaleReview(review(),point('140000000'),DUE),r=report(done,DUE);
 assert.throws(()=>validateSaleReviewReport({...r,accountId:'foreign'},identity.accountId,identity.inceptionAt,DUE));
 assert.throws(()=>validateSaleReviewReport({...r,secret:'forbidden'},identity.accountId,identity.inceptionAt,DUE));
 assert.throws(()=>validateSaleReviewReport({...r,reviews:[{...done,status:'GOOD SALE'}]},identity.accountId,identity.inceptionAt,DUE));
 const cache=new SaleReviewCache();cache.accept(r,identity.accountId,identity.inceptionAt,DUE);
 const trade={id:ID,mint:MINT,at:new Date(AT).toISOString(),side:'sell',quantity:'1000000'};
 assert.equal(cache.forTrades([trade]).length,1);assert.equal(cache.forTrades([{...trade,quantity:'999'}]).length,0);assert.equal(cache.forTrades([{...trade,side:'buy'}]).length,0);
 assert.throws(()=>cache.accept(report(review(),DUE+1),identity.accountId,identity.inceptionAt,DUE+1),/CONFLICT/);
});
test('dashboard appends the review inside Explain and preserves financial snapshot validation',()=>{
 const s=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
 assert.match(s,/renderSaleReview\(detail,trade\)/);assert.match(s,/4-hour sale review/);assert.match(s,/saleReviews\.forTrades\(current\.snapshot\.trades\)/);
 assert.doesNotMatch(readFileSync(new URL('../src/native-paper.ts',import.meta.url),'utf8'),/sale-review/);
 assert.doesNotMatch(readFileSync(new URL('../src/ledger.ts',import.meta.url),'utf8'),/sale-review/);
});
