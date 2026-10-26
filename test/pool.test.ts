import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PublicKey} from '@solana/web3.js';
import {ExtensionType,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {ReadOnlyRpc} from '../src/network.js';
import {Recorder} from '../src/recorder.js';
import {quotePool,quotePositionSell,verifyMigration,checkMintExtensions,associatedAccountRequirements} from '../src/pool.js';

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

function capturedPoolFixture(run='2026-10-26T19-42-16.130Z'){
  const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
  const state=structuredClone(rows.find(x=>x.kind==='pool-state').data);
  const initial={context:{...state.context},value:[state.value[0]]};
  const rpc=new ReadOnlyRpc('https://fixture.invalid',(async(_url,init)=>{
    const body=JSON.parse(String(init?.body));let result;
    if(body.method==='getMultipleAccounts'){
      assert.ok(body.params[1].minContextSlot>=proof.origin.slot);
      result=body.params[0].length===1?initial:state;
    }else if(body.method==='getBlockTime'){
      assert.equal(body.params[0],state.context.slot);result=proof.quote.marketBlockTime;
    }else throw new Error('unexpected pricing replay request');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
  }) as typeof fetch);
  const dir=mkdtempSync(join(tmpdir(),'poe-position-pricing-fixture-'));
  const path=join(dir,'selected.ndjson'),rec=new Recorder(path);
  return {proof,state,initial,rpc,rec,path,close(){rec.close();rmSync(dir,{recursive:true});}};
}

for(const run of ['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z']){
  test(`actual position size uses signed curve reserves, retained-fee payout checks and rounded embedded fees: ${run}`,async()=>{
    const f=capturedPoolFixture(run),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
    try{
      const fullUnits=BigInt(f.proof.quote.buy.outputBaseUnits)*3n+1n;
      const quote=await quotePositionSell(f.rpc,new PublicKey(f.proof.quote.mint),fullUnits,f.rec,f.proof.origin.slot);
      assert.notEqual(quote.sell.inputBaseUnits,f.proof.quote.correspondingSell.inputBaseUnits);
      assert.equal(quote.sell.inputBaseUnits,String(fullUnits));
      const effective=BigInt(quote.rawQuoteReserve)+BigInt(quote.virtualQuoteReserves);
      const gross=effective*fullUnits/(BigInt(quote.rawBaseReserve)+fullUnits);
      const fee=(bps:string)=>(gross*BigInt(bps)+9_999n)/10_000n;
      const totalFee=fee(quote.feeBps.lpFeeBps!)+fee(quote.feeBps.protocolFeeBps!)+(quote.creatorFeeApplied?fee(quote.feeBps.creatorFeeBps!):0n);
      assert.equal(quote.sell.grossCurveOutputLamports,String(gross));
      assert.equal(quote.sell.outputLamports,String(gross-totalFee));
      assert.equal(quote.sell.embeddedPoolFeeLamports,String(totalFee));
      assert.equal(quote.slot,f.proof.quote.slot);assert.equal(quote.commitment,'confirmed');
      assert.equal(quote.marketBlockTime,f.proof.quote.marketBlockTime);
      assert.ok(Date.parse(quote.receivedAt)<=Date.parse(quote.validatedAt));
      assert.equal(f.rpc.calls,3);assert.equal(quote.baseAssociatedAccount.accountLengthBytes,170);
      assert.equal(quote.baseAssociatedAccount.rentLamports,null);assert.equal(quote.mode,'QUOTE_ONLY');
      const records=readFileSync(f.path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
      assert.deepEqual(records.map(row=>row.kind),['pool-state','position-size-sell-quote']);
      assert.equal(records[1]!.data.sell.inputBaseUnits,String(fullUnits));
    }finally{Date.now=realNow;f.close();}
  });
}

test('a position quote needs no hypothetical buy and refuses zero, oversized and unsupported holdings',async()=>{
  const f=capturedPoolFixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    for(const units of [0n,-1n,1n<<64n])await assert.rejects(quotePositionSell(f.rpc,new PublicKey(f.proof.quote.mint),units,f.rec,f.proof.origin.slot),/POSITION_SELL_SIZE_OUT_OF_RANGE/);
    assert.equal(f.rpc.calls,0);
    // Tiny positions have a deterministic zero rounded output, not a free exit.
    await assert.rejects(quotePositionSell(f.rpc,new PublicKey(f.proof.quote.mint),1n,f.rec,f.proof.origin.slot),/ZERO_POSITION_SELL_OUTPUT/);
    const mintBytes=Buffer.from(f.state.value[3].data[0],'base64');
    const supply=mintBytes.readBigUInt64LE(36);
    await assert.rejects(quotePositionSell(f.rpc,new PublicKey(f.proof.quote.mint),supply+1n,f.rec,f.proof.origin.slot),/EXCEEDS_MINT_SUPPLY/);
    // A synthetic unsupported-extension perturbation is a safety regression,
    // never new observed chain evidence or financial performance.
    mintBytes.writeUInt16LE(ExtensionType.TransferHook,166);
    f.state.value[3].data[0]=mintBytes.toString('base64');
    await assert.rejects(quotePositionSell(f.rpc,new PublicKey(f.proof.quote.mint),1000n,f.rec,f.proof.origin.slot),/UNMODELED_BASE_EXTENSION:TransferHook/);
  }finally{Date.now=realNow;f.close();}
});

test('retained fee buckets can make an actual-size exit unavailable despite positive virtual curve reserves',async()=>{
  const f=capturedPoolFixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    const bytes=Buffer.from(f.state.value[0].data[0],'base64');
    const quoteVault=Buffer.from(f.state.value[6].data[0],'base64');
    bytes.writeBigUInt64LE(quoteVault.readBigUInt64LE(64),271);bytes.writeBigUInt64LE(0n,279);
    f.state.value[0].data[0]=bytes.toString('base64');
    await assert.rejects(quotePositionSell(f.rpc,new PublicKey(f.proof.quote.mint),BigInt(f.proof.quote.buy.outputBaseUnits),f.rec,f.proof.origin.slot),/Insufficient real quote reserves/);
    assert.ok(BigInt(f.proof.quote.effectiveQuoteReserve)>0n);
    assert.equal(readFileSync(f.path,'utf8').includes('position-size-sell-quote'),false);
  }finally{Date.now=realNow;f.close();}
});

test('pricing rejects malformed or regressing RPC contexts instead of trusting minContextSlot requests',async()=>{
  const f=capturedPoolFixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    const mint=new PublicKey(f.proof.quote.mint),units=BigInt(f.proof.quote.buy.outputBaseUnits);
    f.initial.context.slot=f.proof.origin.slot-1;
    await assert.rejects(quotePositionSell(f.rpc,mint,units,f.rec,f.proof.origin.slot),/REGRESSING_INITIAL_POOL_CONTEXT/);
    f.initial.context.slot=NaN;
    await assert.rejects(quotePositionSell(f.rpc,mint,units,f.rec,f.proof.origin.slot),/REGRESSING_INITIAL_POOL_CONTEXT/);
    f.initial.context.slot=f.state.context.slot+1;
    await assert.rejects(quotePositionSell(f.rpc,mint,units,f.rec,f.proof.origin.slot),/REGRESSING_POOL_BATCH_CONTEXT/);
    assert.equal(readFileSync(f.path,'utf8').includes('position-size-sell-quote'),false);
  }finally{Date.now=realNow;f.close();}
});

test('buy fee-budget difference is labeled separately from sell deductions and account deposits remain unknown',async()=>{
  const f=capturedPoolFixture(),realNow=Date.now;Date.now=()=>Date.parse(f.proof.quote.validatedAt);
  try{
    const quote=await quotePool(f.rpc,new PublicKey(f.proof.quote.mint),10_000_000n,f.rec,f.proof.origin.slot);
    assert.equal(quote.embeddedCosts.buyBudgetAboveInternalCurveInputLamports,String(10_000_000n-BigInt(quote.buy.internalQuoteWithoutFees)));
    assert.match(quote.embeddedCosts.buyClassification,/rounding/);
    assert.ok(BigInt(quote.embeddedCosts.correspondingSellPoolFeeLamports)>0n);
    assert.equal(quote.quoteAssociatedAccount.accountLengthBytes,165);assert.equal(quote.quoteAssociatedAccount.rentLamports,null);
  }finally{Date.now=realNow;f.close();}
  assert.deepEqual(associatedAccountRequirements(TOKEN_PROGRAM_ID,[]).accountExtensions,[]);
  assert.deepEqual(associatedAccountRequirements(TOKEN_2022_PROGRAM_ID,[ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]).accountExtensions,['ImmutableOwner']);
  assert.throws(()=>associatedAccountRequirements(TOKEN_2022_PROGRAM_ID,[ExtensionType.TransferFeeConfig]),/UNMODELED/);
});
