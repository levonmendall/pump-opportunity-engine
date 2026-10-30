import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,ExtensionType} from '@solana/spl-token';
import {buildPaperUnsignedPumpSwap,PAPER_CONSTRUCTION_WALLET,type PaperUnsignedMarketBatch,type PaperUnsignedRequest} from '../src/paper-unsigned-pumpswap.js';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
const SDK=createRequire(import.meta.url)('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');
function fixture(run='2026-10-26T19-42-16.130Z'){
 const rows=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(x=>JSON.parse(x)),proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8')),raw=structuredClone(rows.find(x=>x.kind==='pool-state').data),at=Date.parse(proof.quote.validatedAt);
 const batch:PaperUnsignedMarketBatch={mint:proof.quote.mint,slot:raw.context.slot,requestedAt:proof.quote.requestedAt,receivedAt:proof.quote.receivedAt,accounts:raw.value};
 const request:PaperUnsignedRequest={side:'buy',inputUnits:proof.quote.buy.inputLamports,minimumOutputUnits:'1',accountPlan:{baseExists:false,quoteExists:false,at,evidence:'retained actual market bytes; explicitly simulated PAPER account inventory'}};
 return {batch,request,at,proof};
}
const decode=(data:string)=>(SDK.OFFLINE_PUMP_AMM_PROGRAM.coder.instruction as unknown as {decode:(data:Buffer)=>{name:string;data:unknown}|null}).decode(Buffer.from(data,'base64'));
for(const run of ['2026-10-26T19-41-20.717Z','2026-10-26T19-42-16.130Z'])test(`actual SDK exact-input unsigned buy bytes and same-state cost reproduction: ${run}`,async()=>{
 const f=fixture(run),old=globalThis.fetch;let requests=0;globalThis.fetch=(async()=>{requests++;throw Error('OFFLINE_NETWORK_FORBIDDEN');})as typeof fetch;
 try{
  const q=await buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at),again=await buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at);
  assert.equal(requests,0);assert.equal(q.networkRequests,0);assert.equal(q.preflight,'NOT_RUN');assert.equal(q.landing,'UNVERIFIED');assert.equal(q.wallet.signerAvailable,false);assert.equal(q.wallet.chainBalancesVerified,false);assert.equal(PublicKey.isOnCurve(new PublicKey(PAPER_CONSTRUCTION_WALLET)),false);
  assert.equal(q.expectedOutputUnits,f.proof.quote.buy.outputBaseUnits);assert.equal(q.poolCosts.buyBudgetAboveInternalCurveInputLamports,(BigInt(f.proof.quote.buy.inputLamports)-BigInt(f.proof.quote.buy.internalQuoteWithoutFees)).toString());assert.equal(q.constructionSha256,again.constructionSha256);assert.deepEqual(q.instructions,again.instructions);
  const swap=q.instructions.filter(i=>i.programId===PUMP_AMM_PROGRAM_ID.toBase58()&&decode(i.dataBase64)?.name==='buyExactQuoteIn');assert.equal(swap.length,1);
  const ix=swap[0]!,decoded=decode(ix.dataBase64)!.data as any;assert.equal(decoded.spendableQuoteIn.toString(),f.request.inputUnits);assert.equal(decoded.minBaseAmountOut.toString(),'1');assert.equal(ix.keys[1]!.pubkey,PAPER_CONSTRUCTION_WALLET);assert.equal(ix.keys[1]!.isSigner,true);
  assert.equal(Buffer.from(ix.dataBase64,'base64').subarray(0,8).toString('hex'),createHash('sha256').update('global:buy_exact_quote_in').digest().subarray(0,8).toString('hex'));
  assert.equal(q.requiredSignerCount,1);assert.equal(q.accounts.baseCreationRequired,true);assert.equal(q.accounts.quoteCreationRequired,true);assert.equal(q.accounts.quoteClosedByInstructions,false);assert.ok(q.accounts.baseAccountLengthBytes>=165&&q.accounts.baseAccountLengthBytes<=170);
  assert.ok(q.instructions.some(i=>i.programId===ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()));assert.ok(q.instructions.some(i=>i.programId===SystemProgram.programId.toBase58()));
  assert.equal(q.instructions.some(i=>i.programId===TOKEN_PROGRAM_ID.toBase58()&&Buffer.from(i.dataBase64,'base64')[0]===9),false,'only validated optional WSOL close omitted; dedicated-account rent remains locked');
 }finally{globalThis.fetch=old;}
});
test('actual full-size sell uses current fee-adjusted liquidation and independent slippage constraint',async()=>{
 const f=fixture();f.request={...f.request,side:'sell',inputUnits:f.proof.quote.correspondingSell.inputBaseUnits,minimumOutputUnits:f.proof.quote.correspondingSell.outputLamports,accountPlan:{...f.request.accountPlan,baseExists:true}};
 const q=await buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at),swap=q.instructions.find(i=>i.programId===PUMP_AMM_PROGRAM_ID.toBase58()&&decode(i.dataBase64)?.name==='sell')!,decoded=decode(swap.dataBase64)!.data as any;
 assert.equal(q.expectedOutputUnits,f.proof.quote.correspondingSell.outputLamports);assert.equal(q.quoteMeetsMinimum,true);assert.equal(q.accounts.baseCreationRequired,false);assert.equal(decoded.baseAmountIn.toString(),f.request.inputUnits);assert.equal(decoded.minQuoteAmountOut.toString(),f.request.minimumOutputUnits);
 const failure=await buildPaperUnsignedPumpSwap(f.batch,{...f.request,minimumOutputUnits:(BigInt(f.request.minimumOutputUnits)+1n).toString()},()=>f.at);assert.equal(failure.quoteMeetsMinimum,false,'validly constructed instruction can fail its current market minimum; never an optimistic fill');assert.equal(failure.landing,'UNVERIFIED');assert.notEqual(failure.constructionSha256,q.constructionSha256);
});
test('exact-input buy minimum constraint is preserved rather than repriced downward',async()=>{
 const f=fixture(),minimum=(BigInt(f.proof.quote.buy.outputBaseUnits)+1n).toString(),q=await buildPaperUnsignedPumpSwap(f.batch,{...f.request,minimumOutputUnits:minimum},()=>f.at),ix=q.instructions.find(i=>i.programId===PUMP_AMM_PROGRAM_ID.toBase58()&&decode(i.dataBase64)?.name==='buyExactQuoteIn')!;
 assert.equal(q.quoteMeetsMinimum,false);assert.equal((decode(ix.dataBase64)!.data as any).minBaseAmountOut.toString(),minimum);assert.equal(q.inputUnits,f.request.inputUnits);
});
test('unsupported, incomplete, stale, future or malformed source/account assumptions fail closed',async()=>{
 for(const perturb of [
  (f:ReturnType<typeof fixture>)=>{f.batch.accounts=[...f.batch.accounts.slice(0,6)];},
  (f:ReturnType<typeof fixture>)=>{f.batch.accounts=[null,...f.batch.accounts.slice(1)];},
  (f:ReturnType<typeof fixture>)=>{f.batch.slot=-1;},
  (f:ReturnType<typeof fixture>)=>{f.batch.receivedAt=new Date(f.at+1).toISOString();},
  (f:ReturnType<typeof fixture>)=>{f.batch.receivedAt=new Date(f.at-2001).toISOString();f.batch.requestedAt=f.batch.receivedAt;},
  (f:ReturnType<typeof fixture>)=>{f.batch.accounts[0]!.owner=TOKEN_PROGRAM_ID.toBase58();},
  (f:ReturnType<typeof fixture>)=>{const b=Buffer.from(f.batch.accounts[3]!.data[0],'base64');b.writeUInt16LE(ExtensionType.TransferHook,166);f.batch.accounts[3]!.data[0]=b.toString('base64');},
  (f:ReturnType<typeof fixture>)=>{f.request.accountPlan.at=f.at-10001;},
  (f:ReturnType<typeof fixture>)=>{f.request.accountPlan.evidence='';},
 ]){const f=fixture();perturb(f);await assert.rejects(buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at));}
 for(const value of ['0','-1','1.2','01',String(1n<<64n)]){const f=fixture();await assert.rejects(buildPaperUnsignedPumpSwap(f.batch,{...f.request,inputUnits:value},()=>f.at),/POSITIVE_U64_REQUIRED/);await assert.rejects(buildPaperUnsignedPumpSwap(f.batch,{...f.request,minimumOutputUnits:value},()=>f.at),/POSITIVE_U64_REQUIRED/);}
 const f=fixture();await assert.rejects(buildPaperUnsignedPumpSwap(f.batch,{...f.request,side:'sell'},()=>f.at),/SELL_REQUIRES_SIMULATED_BASE_ACCOUNT/);
});
test('construction snapshots caller inputs before async work and retains source association',async()=>{
 const f=fixture(),original=structuredClone(f.batch),a=buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at);f.batch.accounts[6]!.owner=TOKEN_2022_PROGRAM_ID.toBase58();f.request.inputUnits='1';
 const q=await a,b=await buildPaperUnsignedPumpSwap(original,fixture().request,()=>f.at);assert.equal(q.sourceSha256,b.sourceSha256);assert.equal(q.constructionSha256,b.constructionSha256);
 const source=structuredClone(original),buffer=Buffer.from(source.accounts[6]!.data[0],'base64');buffer.writeBigUInt64LE(buffer.readBigUInt64LE(64)+1000000n,64);source.accounts[6]!.data[0]=buffer.toString('base64');const changed=await buildPaperUnsignedPumpSwap(source,fixture().request,()=>f.at);assert.notEqual(changed.sourceSha256,q.sourceSha256);assert.notEqual(changed.expectedOutputUnits,q.expectedOutputUnits);
});

test('only the exact optional WSOL close is removed; real SDK swap/setup bytes and account flags stay intact',async()=>{
 const f=fixture(),original=SDK.PUMP_AMM_SDK.buyInstructions;let produced:import('@solana/web3.js').TransactionInstruction[]=[];
 SDK.PUMP_AMM_SDK.buyInstructions=async function(...args){produced=await original.apply(this,args);return produced;};
 try{
  const q=await buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at);
  const closes=produced.filter(i=>i.programId.equals(TOKEN_PROGRAM_ID)&&i.data.length===1&&i.data[0]===9);assert.equal(closes.length,1);assert.equal(q.instructions.length,produced.length-1);
  const retained=produced.filter(i=>i!==closes[0]).map(i=>({programId:i.programId.toBase58(),keys:i.keys.map(k=>({pubkey:k.pubkey.toBase58(),isSigner:k.isSigner,isWritable:k.isWritable})),dataBase64:i.data.toString('base64')}));
  assert.deepEqual(q.instructions,retained,'constructor retains every other SDK instruction exactly; the real buy bytes are the checked exact-quote variant');
  assert.equal(q.accounts.quoteClosedByInstructions,false);assert.ok(q.limitations.some(x=>x.includes('locked rent persist')));
 }finally{SDK.PUMP_AMM_SDK.buyInstructions=original;}
});
test('missing, duplicate or changed WSOL close layout fails closed rather than dropping unrelated instructions',async()=>{
 const original=SDK.PUMP_AMM_SDK.buyInstructions;
 for(const mode of ['missing','duplicate','authority','writable']){
  SDK.PUMP_AMM_SDK.buyInstructions=async function(...args){const ix=await original.apply(this,args),close=ix.find(i=>i.programId.equals(TOKEN_PROGRAM_ID)&&i.data.length===1&&i.data[0]===9)!;
   if(mode==='missing')return ix.filter(i=>i!==close);if(mode==='duplicate')return [...ix,close];if(mode==='authority')close.keys[2]!.pubkey=SystemProgram.programId;if(mode==='writable')close.keys[2]!.isWritable=true;return ix;
  };
  try{const f=fixture();await assert.rejects(buildPaperUnsignedPumpSwap(f.batch,f.request,()=>f.at),/WSOL_CLOSE/);}finally{SDK.PUMP_AMM_SDK.buyInstructions=original;}
 }
});
test('retained dedicated PAPER account inventory does not charge or recreate either ATA on re-entry',async()=>{
 const f=fixture(),q=await buildPaperUnsignedPumpSwap(f.batch,{...f.request,accountPlan:{...f.request.accountPlan,baseExists:true,quoteExists:true}},()=>f.at);
 assert.equal(q.accounts.baseCreationRequired,false);assert.equal(q.accounts.quoteCreationRequired,false);assert.equal(q.accounts.quoteClosedByInstructions,false);assert.equal(q.instructions.some(i=>i.programId===ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()),false);
 assert.equal('rentRefundLamports'in q,false);assert.equal(q.wallet.chainOwnershipVerified,false);
});
test('instruction construction cannot relabel a source which becomes stale while awaiting SDK work',async()=>{
 const f=fixture(),original=SDK.PUMP_AMM_SDK.buyInstructions;let at=f.at;
 SDK.PUMP_AMM_SDK.buyInstructions=async function(...args){const result=await original.apply(this,args);at+=2001;return result;};
 try{await assert.rejects(buildPaperUnsignedPumpSwap(f.batch,f.request,()=>at),/FRESH_COHERENT_BATCH_REQUIRED/);}finally{SDK.PUMP_AMM_SDK.buyInstructions=original;}
});
