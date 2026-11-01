import {test} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {SaleReviewStore,runSaleReviewOnce} from '../src/sale-review-store.js';
import {saleReviewTradeId,SALE_REVIEW_POLICY, pendingSaleReview} from '../src/sale-review.js';
import {saleReviewPriceReader} from '../src/sale-review-price.js';

test('production native SQLite persists a partial sale and completes once after reopen',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'poe-sale-native-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const at=Date.now(),due=at+SALE_REVIEW_POLICY.horizonMs,path=join(dir,'reviews.sqlite');
 const sale={accountId:'fixture-native',actionId:'partial-native',tradeId:saleReviewTradeId('partial-native'),mint:'fixture-mint',soldAt:at,salePrice:{quoteLamports:'100',baseUnits:'1000'}};
 let db=new Database(path),store=new SaleReviewStore(db,sale.accountId,at-1);store.ingest([sale],1,at);db.close();
 db=new Database(path);t.after(()=>db.close());store=new SaleReviewStore(db,sale.accountId,at-1);let calls=0;
 const reader=async()=>{calls++;return {mint:sale.mint,price:{quoteLamports:'120',baseUnits:'1000'},observedAt:due,sourceAt:due,decimals:6,source:'offline fixture'};};
 await runSaleReviewOnce(store,reader,()=>due);await runSaleReviewOnce(store,reader,()=>due+1);
 assert.equal(calls,1);assert.equal(store.get(sale.tradeId)?.status,'BAD SALE');assert.equal(store.get(sale.tradeId)?.changePercent,'20.000000');
});

test('production adapter obtains only one current account batch and never a deep analysis',async()=>{
 const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
 const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x));
 const state=structuredClone(rows.find(x=>x.kind==='pool-state').data);
 const at=Date.parse(proof.quote.validatedAt),raw=Buffer.alloc(40);raw.writeBigUInt64LE(BigInt(state.context.slot));raw.writeBigInt64LE(BigInt(proof.quote.marketBlockTime),32);
 const accounts=new Map<string,any>(state.addresses.map((address:string,i:number)=>[address,state.value[i]??null]));
 accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(),{owner:'Sysvar1111111111111111111111111111111111111',data:[raw.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0});
 const calls:string[]=[];const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push(method);assert.equal(method,'getMultipleAccounts');return {context:state.context,value:(params[0] as string[]).map(address=>accounts.get(address)??null)} as T;}};
 const review=pendingSaleReview({accountId:'fixture-native',actionId:'adapter-sale',tradeId:saleReviewTradeId('adapter-sale'),mint:proof.quote.mint,soldAt:at-SALE_REVIEW_POLICY.horizonMs,salePrice:{quoteLamports:'100',baseUnits:'1000'}});
 const clock=Date.now;Date.now=()=>at;
 try {const result=await saleReviewPriceReader(rpc)(review,new AbortController().signal);assert.ok(result);assert.equal(result.mint,proof.quote.mint);assert.deepEqual(calls,['getMultipleAccounts']);assert.ok(BigInt(result.price.quoteLamports)>0n);assert.ok(BigInt(result.price.baseUnits)>0n);}
 finally{Date.now=clock;}
});
