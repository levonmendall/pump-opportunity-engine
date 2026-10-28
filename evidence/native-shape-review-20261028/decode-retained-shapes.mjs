import fs from 'node:fs';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
const require=createRequire('/workspace/pump-opportunity-engine/package.json');
const {BorshCoder}=require('@coral-xyz/anchor');
const {PublicKey}=require('@solana/web3.js');
const {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID}=require('@solana/spl-token');
const idlPath='/workspace/pump-opportunity-engine/node_modules/@pump-fun/pump-swap-sdk/src/idl/pump_amm.json';
const idlBytes=fs.readFileSync(idlPath),idl=JSON.parse(idlBytes),coder=new BorshCoder(idl);
const input=JSON.parse(fs.readFileSync(new URL('./retained-two-shapes.json',import.meta.url)));
const safe=x=>typeof x==='bigint'?x.toString():x?.constructor?.name==='BN'?x.toString(10):x?.toBase58?x.toBase58():Array.isArray(x)?x.map(safe):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,safe(v)])):x;
const out={schemaVersion:1,sourceCommit:input.sourceCommit,idlSha256:crypto.createHash('sha256').update(idlBytes).digest('hex'),idlVersion:idl.metadata?.version,decodedOnly:true,fullTransactionFetched:false,cases:[]};
for(const [signature,c]of Object.entries(input.retainedCases)){
 const raw=c.records['native-flow-raw-refusal'].data,stack=[],frames=[],events=[];
 for(let i=0;i<raw.logs.length;i++){
  const l=raw.logs[i],m=/^Program (\w+) invoke \[(\d+)\]$/.exec(l),end=/^Program (\w+) (success|failed:.*)$/.exec(l);
  if(m){const f={program:m[1],depth:Number(m[2]),label:null,invokeLogIndex:i,parent:stack.at(-1)?.invokeLogIndex??null,childCalls:0};if(stack.length)stack.at(-1).childCalls++;stack.push(f);frames.push(f);continue;}
  if(end){const f=stack.pop();if(!f||f.program!==end[1])throw Error('stack');f.endLogIndex=i;f.outcome=end[2];continue;}
  if(l.startsWith('Program log: Instruction: ')&&stack.length)stack.at(-1).label=l.slice('Program log: Instruction: '.length);
  if(l.startsWith('Program data: ')&&stack.at(-1)?.program==='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'){
   const b64=l.slice('Program data: '.length),b=Buffer.from(b64,'base64'),ev=coder.events.decode(b64);if(!ev)throw Error('event');if(!coder.types.encode(ev.name,ev.data).equals(b.subarray(8)))throw Error('layout');events.push({logIndex:i,frameInvokeLogIndex:stack.at(-1).invokeLogIndex,frameLabel:stack.at(-1).label,name:ev.name,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),data:safe(ev.data)});
  }
 }
 out.cases.push({signature,slot:raw.slot,sourceRawRef:c.records['native-flow-raw-refusal'].ref,sourceRefusalRef:c.records['native-flow-refusal'].ref,sourceRefusal:c.records['native-flow-refusal'].data,priorSupport:c.priorSupport,frames,events});
}
for(const c of out.cases){
 const events=c.events.map(e=>({name:e.name,data:e.data}));
 const buy=events.find(e=>e.name==='BuyEvent')?.data,boost=events.find(e=>e.name==='BoostBuyAndBurnEvent')?.data;
 if(boost){
  const actor=PublicKey.findProgramAddressSync([Buffer.from('boost_vault'),new PublicKey(boost.pool).toBuffer()],new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'))[0];
  c.offlineChecks={programUserIsBoostVaultPda:buy.user===actor.toBase58(),quoteAccountIsBoostWsolAta:buy.user_quote_token_account===getAssociatedTokenAddressSync(NATIVE_MINT,actor,true,TOKEN_PROGRAM_ID).toBase58(),scopeMatchesOfficialPair:buy.pool===boost.pool&&boost.pool===c.sourceRefusal.subscriptionPool&&boost.mint===c.sourceRefusal.subscriptionMint,pairedTimesAgree:buy.timestamp===boost.timestamp,pairedQuoteAmountsAgree:['quote_amount_in_requested','quote_amount_in_used'].every(k=>boost[k]===buy.quote_amount_in)&&buy.quote_amount_in===buy.user_quote_amount_in,pairedBaseAmountAgrees:buy.base_amount_out===boost.base_amount_burned,allReportedFeeAmountsZero:['lp_fee','protocol_fee','coin_creator_fee','cashback','buyback_fee','holder_rewards','quote_transfer_fee'].every(k=>buy[k]==='0'),baseReserveDelta:BigInt(buy.pool_base_token_reserves)-BigInt(boost.base_reserves_after)===BigInt(boost.base_amount_burned),quoteReserveDelta:BigInt(boost.real_quote_reserves_after)-BigInt(buy.pool_quote_token_reserves)===BigInt(boost.quote_amount_in_used),boostReserveDelta:BigInt(buy.user_quote_token_reserves)-BigInt(boost.boost_vault_remaining)===BigInt(boost.quote_amount_in_used),baseUserPlaceholder:buy.user_base_token_account==='11111111111111111111111111111111',ordinaryUserBaseReceived:false,transferBytesAndRolesVerified:false,extraClassicChildInstructionVerified:false};
 }else c.offlineChecks={scopePoolMatchesBuyEvent:buy.pool===c.sourceRefusal.subscriptionPool,multiHopLabelAndEventVariantAgree:buy.ix_name==='multi_hop_swap'&&c.events.find(e=>e.name==='BuyEvent').frameLabel==='MultiHopSwap',baseUserAccountPlaceholder:buy.user_base_token_account==='11111111111111111111111111111111',grossMinusReportedProtocolFeeMatchesNetQuote:BigInt(buy.quote_amount_in)-BigInt(buy.protocol_fee)===BigInt(buy.user_quote_amount_in),buybackIsReportedProtocolSlice:BigInt(buy.buyback_fee)<=BigInt(buy.protocol_fee),scopeTransferAndTraderRolesVerified:false,compiledRemainingAccountRouteVerified:false,normalizedForStrategy:false};
}
out.pinnedInterfaces=idl.instructions.filter(i=>['multi_hop_swap','boost_buy_and_burn'].includes(i.name)).map(i=>({name:i.name,discriminator:i.discriminator,args:i.args,accounts:i.accounts.map(a=>({name:a.name,signer:a.signer??false,writable:a.writable??false}))}));
out.pinnedSourceFiles=['src/sdk/multiHop.ts','src/sdk/offlinePumpAmm.ts'].map(file=>{const bytes=fs.readFileSync('/workspace/pump-opportunity-engine/node_modules/@pump-fun/pump-swap-sdk/'+file);return {file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};});
fs.writeFileSync(new URL('./decoded-two-shapes.json',import.meta.url),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out.cases.map(c=>({signature:c.signature,scopePool:c.sourceRefusal.subscriptionPool,scopeMint:c.sourceRefusal.subscriptionMint,frames:c.frames.filter(f=>f.program==='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'),events:c.events})),null,2));
