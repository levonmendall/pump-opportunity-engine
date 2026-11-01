import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {readSaleReviewPrice} from '../src/sale-review-price.js';
import type {PoolWireAccount} from '../src/pool.js';
function fixture(){
 const run='2026-10-26T19-42-16.130Z',proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
 const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x)),state=structuredClone(rows.find(x=>x.kind==='pool-state').data);
 const now=Date.parse(proof.quote.validatedAt),bytes=Buffer.alloc(40);bytes.writeBigUInt64LE(BigInt(state.context.slot),0);bytes.writeBigInt64LE(BigInt(proof.quote.marketBlockTime),32);
 const clock:PoolWireAccount={owner:'Sysvar1111111111111111111111111111111111111',data:[bytes.toString('base64'),'base64'],lamports:1169280,executable:false,rentEpoch:0};
 const accounts=new Map<string,PoolWireAccount|null>(state.addresses.map((address:string,i:number)=>[address,state.value[i]??null]));accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(),clock);
 const calls:{method:string;params:unknown[]}[]=[];
 const rpc={async call<T>(method:string,params:unknown[]=[]):Promise<T>{calls.push({method,params});return structuredClone({context:state.context,value:(params[0] as string[]).map(key=>accounts.get(key)??null)}) as T;}};
 return {proof,state,now,clock,accounts,calls,rpc};
}
test('checkpoint gets only current pool price with one six-account batch and original quote units',async()=>{
 const f=fixture(),price=await readSaleReviewPrice(f.rpc,f.proof.quote.mint,undefined,()=>f.now);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0]!.method,'getMultipleAccounts');assert.equal((f.calls[0]!.params[0] as string[]).length,6);
 assert.ok(BigInt(price.quoteLamports)>0n);assert.ok(BigInt(price.baseUnits)>0n);assert.equal(price.observedAt,f.now);assert.equal(price.sourceAt,f.proof.quote.marketBlockTime*1000);assert.ok(price.decimals>=0);
 const keys=f.calls[0]!.params[0] as string[],quote=f.accounts.get(keys[4]!)!;
 const bytes=Buffer.from(quote.data[0],'base64');bytes.writeBigUInt64LE(bytes.readBigUInt64LE(64)+1000n,64);quote.data[0]=bytes.toString('base64');
 const next=await readSaleReviewPrice(f.rpc,f.proof.quote.mint,undefined,()=>f.now);
 assert.equal(BigInt(next.quoteLamports)-BigInt(price.quoteLamports),1000n);assert.equal(next.baseUnits,price.baseUnits);assert.equal(f.calls.length,2,'one read per checkpoint, not a monitoring subscription');
});
test('missing canonical pool and stale bank time do not yield a zero or substitute price',async()=>{
 const f=fixture();await readSaleReviewPrice(f.rpc,f.proof.quote.mint,undefined,()=>f.now);
 const keys=f.calls[0]!.params[0] as string[];f.accounts.set(keys[0]!,null);
 await assert.rejects(readSaleReviewPrice(f.rpc,f.proof.quote.mint,undefined,()=>f.now));assert.equal(f.calls.length,2);
 const g=fixture();await assert.rejects(readSaleReviewPrice(g.rpc,g.proof.quote.mint,undefined,()=>g.now+600000));assert.equal(g.calls.length,1);
});
