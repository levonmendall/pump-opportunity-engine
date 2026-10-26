import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {ExtensionType} from '@solana/spl-token';
import {ReadOnlyRpc} from '../src/network.js';
import {Recorder} from '../src/recorder.js';
import {quotePool,verifyMigration,checkMintExtensions} from '../src/pool.js';

// Captured real observations are regression inputs ONLY, never performance data.
for(const run of ['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z']){
  test(`reproduce captured migration and full-size quotes: ${run}`,async()=>{
    const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
    const tx=rows.find(x=>x.kind==='migration-transaction'&&x.data.transaction.signatures.includes(proof.origin.signature)).data;
    const state=rows.find(x=>x.kind==='pool-state').data;
    let batches=0;
    const rpc=new ReadOnlyRpc('https://fixture.invalid',(async(_url,init)=>{
      const b=JSON.parse(String(init?.body));let result;
      if(b.method==='getTransaction'){
        assert.equal(b.params[1].maxSupportedTransactionVersion,1);result=tx;
      }else if(b.method==='getMultipleAccounts')result=++batches===1?{context:state.context,value:[state.value[0]]}:state;
      else if(b.method==='getBlockTime')result=proof.quote.marketBlockTime;
      else throw new Error('unexpected replay request');
      return new Response(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
    }) as typeof fetch);
    const dir=mkdtempSync(join(tmpdir(),'poe-replay-'));const rec=new Recorder(join(dir,'replay.ndjson'));
    const realNow=Date.now;Date.now=()=>Date.parse(proof.quote.validatedAt);
    try{
      const origin=await verifyMigration(rpc,new PublicKey(proof.quote.mint),proof.origin.signature,rec);
      assert.equal(origin.slot,proof.origin.slot);
      const actual=await quotePool(rpc,new PublicKey(proof.quote.mint),10_000_000n,rec,origin.slot);
      assert.deepEqual(actual.buy,proof.quote.buy);assert.deepEqual(actual.correspondingSell,proof.quote.correspondingSell);
      assert.equal(BigInt(actual.rawQuoteReserve)+BigInt(actual.virtualQuoteReserves),BigInt(actual.effectiveQuoteReserve));
      Date.now=()=>Date.parse(proof.quote.validatedAt)+60_000;
      await assert.rejects(quotePool(rpc,new PublicKey(proof.quote.mint),10_000_000n,rec,origin.slot),/NOT_CURRENT/);
    }finally{Date.now=realNow;rec.close();rmSync(dir,{recursive:true});}
  });
}
test('Token-2022 metadata is supported; transfer semantics require explicit modeling',()=>{
  checkMintExtensions([ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]);
  for(const extension of [ExtensionType.TransferFeeConfig,ExtensionType.TransferHook,ExtensionType.PermanentDelegate,ExtensionType.NonTransferable])assert.throws(()=>checkMintExtensions([extension]),/UNMODELED_BASE_EXTENSION/);
});
