/** Pure, unsigned PumpSwap construction over an already acquired coherent batch.
 * This module has no RPC client, signer, blockhash, transaction submission or
 * financial writer. PAPER inventory is explicit; it is never chain ownership.
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import BN from 'bn.js';
import {PublicKey,SystemProgram,type AccountInfo,type TransactionInstruction} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {decodeSupportedPoolAccounts,type PoolWireAccount} from './pool.js';
import {PUMP_AMM_SDK,PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda,buyQuoteInput,sellBaseInput} from './sdk.js';
const SDK=createRequire(import.meta.url)('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');
export const PAPER_UNSIGNED_PUMPSWAP_VERSION='paper-unsigned-pumpswap-v2' as const;
/** Off-curve placeholder deliberately supplies no keypair or usable signature.
 * It is not represented as a funded or on-chain-owned trading wallet. */
export const PAPER_CONSTRUCTION_WALLET=PublicKey.findProgramAddressSync([Buffer.from('poe-paper-construction-v1')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
export type PaperUnsignedMarketBatch={
 mint:string;slot:number;requestedAt:string;receivedAt:string;
 /** Exact validated dependency order: pool/global/fee/base mint/WSOL/base vault/quote vault. */
 accounts:readonly (PoolWireAccount|null)[];
};
export type PaperUnsignedAccountPlan={baseExists:boolean;quoteExists:boolean;at:number;evidence:string};
export type PaperUnsignedRequest={side:'buy'|'sell';inputUnits:string;minimumOutputUnits:string;/** Current read-only RPC rent quote for the transient legacy WSOL ATA, bound by accountPlan evidence/time. */quoteRentLamports:string;accountPlan:PaperUnsignedAccountPlan};
export type PaperUnsignedInstruction={programId:string;keys:Array<{pubkey:string;isSigner:boolean;isWritable:boolean}>;dataBase64:string};
export type PaperUnsignedConstruction={
 version:typeof PAPER_UNSIGNED_PUMPSWAP_VERSION;state:'constructed';mint:string;pool:string;side:'buy'|'sell';sourceSlot:number;
 requestedAt:string;receivedAt:string;constructedAt:number;sourceSha256:string;constructionSha256:string;
 instructionVariant:'buy_exact_quote_in'|'sell';inputUnits:string;minimumOutputUnits:string;expectedOutputUnits:string;quoteMeetsMinimum:boolean;temporaryQuoteRentLamports:string;quoteRentProofSha256:string;
 wallet:{publicKey:string;identity:'OFF_CURVE_PAPER_PLACEHOLDER';signerAvailable:false;chainOwnershipVerified:false;chainBalancesVerified:false};
 accounts:{baseAssociatedAccount:string;quoteAssociatedAccount:string;baseAccountLengthBytes:number;quoteAccountLengthBytes:number;baseCreationRequired:boolean;quoteCreationRequired:boolean;quoteClosedByInstructions:true;poolExtensionRequired:boolean;poolExtensionTargetBytes:number|null;inventoryEvidenceSha256:string};
 poolCosts:{embeddedInOutput:true;feeBps:Record<string,string>;buyBudgetAboveInternalCurveInputLamports:string|null;sellEmbeddedFeeLamports:string|null;effectiveQuoteReserveLamports:string};
 instructions:PaperUnsignedInstruction[];instructionCount:number;requiredSignerCount:number;writableAccountCount:number;
 preflight:'NOT_RUN';landing:'UNVERIFIED';networkRequests:0;limitations:readonly string[];
};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function need(value:unknown,code:string):asserts value{if(!value)throw Error('PAPER_UNSIGNED_'+code);}
function amount(v:string){need(typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v),'POSITIVE_U64_REQUIRED');const n=BigInt(v);need(n<1n<<64n,'POSITIVE_U64_REQUIRED');return n;}
function info(a:PoolWireAccount):AccountInfo<Buffer>{need(a&&Array.isArray(a.data)&&a.data.length===2&&a.data[1]==='base64'&&typeof a.data[0]==='string'&&a.data[0].length>0&&a.data[0].length<=16384&&a.executable===false,'ACCOUNT_ENCODING_REQUIRED');const data=Buffer.from(a.data[0],'base64');need(data.toString('base64')===a.data[0],'ACCOUNT_ENCODING_REQUIRED');return {...a,data,owner:new PublicKey(a.owner)};}
const serialized=(ix:TransactionInstruction):PaperUnsignedInstruction=>({programId:ix.programId.toBase58(),keys:ix.keys.map(k=>({pubkey:k.pubkey.toBase58(),isSigner:k.isSigner,isWritable:k.isWritable})),dataBase64:ix.data.toString('base64')});
function current(batch:PaperUnsignedMarketBatch,now:number){const requested=Date.parse(batch.requestedAt),received=Date.parse(batch.receivedAt);need(Number.isSafeInteger(now)&&Number.isSafeInteger(batch.slot)&&batch.slot>=0&&Number.isSafeInteger(requested)&&Number.isSafeInteger(received)&&requested<=received&&received<=now&&now-received<=2000,'FRESH_COHERENT_BATCH_REQUIRED');}
/** Actual SDK setup/remaining accounts and IDL byte encoding. Constructed bytes
 * are a reproducible PAPER template, never proof that a validator could execute
 * this placeholder wallet or that a transaction landed. */
export async function buildPaperUnsignedPumpSwap(batchInput:PaperUnsignedMarketBatch,requestInput:PaperUnsignedRequest,now:()=>number=Date.now):Promise<PaperUnsignedConstruction>{
 const batch=structuredClone(batchInput),request=structuredClone(requestInput);current(batch,now());
 need(request.side==='buy'||request.side==='sell','SIDE_REQUIRED');const input=amount(request.inputUnits),minimum=amount(request.minimumOutputUnits),plan=request.accountPlan;
 const quoteRent=amount(request.quoteRentLamports);need(plan&&typeof plan.baseExists==='boolean'&&typeof plan.quoteExists==='boolean'&&Number.isSafeInteger(plan.at)&&plan.at<=now()&&now()-plan.at<=10000&&typeof plan.evidence==='string'&&plan.evidence.length>0&&plan.evidence.length<=512,'SIMULATED_ACCOUNT_PLAN_REQUIRED');need(plan.quoteExists===false,'TRANSIENT_QUOTE_ACCOUNT_REQUIRED');
 need(batch.accounts.length===7&&batch.accounts.every(a=>a!==null),'COMPLETE_DEPENDENCY_BATCH_REQUIRED');
 const accounts=batch.accounts as PoolWireAccount[];for(const account of accounts)info(account);const mint=new PublicKey(batch.mint),key=canonicalPumpPoolPda(mint),poolInfo=info(accounts[0]!),first=PUMP_AMM_SDK.decodePool(poolInfo);
 const state=decodeSupportedPoolAccounts(mint,key,first,accounts,{slot:batch.slot},batch.requestedAt,batch.receivedAt),pool=PUMP_AMM_SDK.decodePool(poolInfo);
 const user=new PublicKey(PAPER_CONSTRUCTION_WALLET),baseProgram=new PublicKey(state.summary.tokenProgram),baseAta=getAssociatedTokenAddressSync(mint,user,true,baseProgram),quoteAta=getAssociatedTokenAddressSync(NATIVE_MINT,user,true,TOKEN_PROGRAM_ID);
 // SDK randomly selects an allowed recipient. Repeating a single actually
 // configured non-default recipient in a LOCAL copy makes bytes reproducible
 // without changing process randomness or the current source configuration.
 const original=state.opts.globalConfig,valid=(a:PublicKey[])=>a.find(x=>!x.equals(PublicKey.default));
 const protocol=valid(pool.isMayhemMode?[original.reservedFeeRecipient,...original.reservedFeeRecipients]:original.protocolFeeRecipients),buyback=valid(original.buybackFeeRecipients);
 need(protocol&&buyback,'CONFIGURED_FEE_RECIPIENT_REQUIRED');
 const globalConfig={...original,protocolFeeRecipients:original.protocolFeeRecipients.map(()=>protocol),reservedFeeRecipient:protocol,reservedFeeRecipients:original.reservedFeeRecipients.map(()=>protocol),buybackFeeRecipients:original.buybackFeeRecipients.map(()=>buyback)};
 const synthetic=(exists:boolean,owner:PublicKey,bytes:number):AccountInfo<Buffer>|null=>exists?{data:Buffer.alloc(bytes),owner,lamports:0,executable:false,rentEpoch:0}:null;
 const swap={globalConfig,feeConfig:state.opts.feeConfig,poolKey:key,poolAccountInfo:poolInfo,pool,poolBaseAmount:state.opts.baseReserve,poolQuoteAmount:state.opts.quoteReserve,baseTokenProgram:baseProgram,quoteTokenProgram:TOKEN_PROGRAM_ID,baseMint:mint,baseMintAccount:state.opts.baseMintAccount,user,userBaseTokenAccount:baseAta,userQuoteTokenAccount:quoteAta,userBaseAccountInfo:synthetic(plan.baseExists,baseProgram,state.summary.baseAssociatedAccount.accountLengthBytes),userQuoteAccountInfo:null,quoteTransferFee:null};
 let expected:BN,buyBudget:string|null=null,sellFee:string|null=null,instructions:TransactionInstruction[],tradeInstruction:TransactionInstruction;
 if(request.side==='buy'){
  const q=buyQuoteInput({...state.opts,quote:new BN(input.toString())});expected=q.base;buyBudget=(input-BigInt(q.internalQuoteWithoutFees.toString())).toString();
  // v1 buyExactQuoteIn uses exactly the same accounts and remaining accounts as
  // SDK buy. Verify the packaged IDL contract before replacing ONLY the bytes.
  const program=SDK.OFFLINE_PUMP_AMM_PROGRAM,from=program.idl.instructions.find(i=>i.name==='buy'),to=program.idl.instructions.find(i=>i.name==='buyExactQuoteIn');
  need(from&&to&&JSON.stringify(from.accounts)===JSON.stringify(to.accounts),'PACKAGED_EXACT_QUOTE_LAYOUT_REQUIRED');
  instructions=await PUMP_AMM_SDK.buyInstructions(swap,new BN(minimum.toString()),new BN(input.toString()));
  const matches=instructions.filter(ix=>ix.programId.equals(PUMP_AMM_PROGRAM_ID)&&ix.data.subarray(0,8).equals(Buffer.from(from.discriminator)));need(matches.length===1,'SINGLE_BUY_INSTRUCTION_REQUIRED');
  tradeInstruction=matches[0]!;tradeInstruction.data=program.coder.instruction.encode('buyExactQuoteIn',{spendableQuoteIn:new BN(input.toString()),minBaseAmountOut:new BN(minimum.toString()),trackVolume:{0:true}});
 }else{
  need(plan.baseExists,'SELL_REQUIRES_SIMULATED_BASE_ACCOUNT');need(input<=state.mintSupply,'SELL_EXCEEDS_SUPPLY');
  const q=sellBaseInput({...state.opts,base:new BN(input.toString())});expected=q.uiQuote;sellFee=q.internalQuoteAmountOut.sub(q.uiQuote).toString();
  instructions=await PUMP_AMM_SDK.sellInstructions(swap,new BN(input.toString()),new BN(minimum.toString()));const sellDefinition=SDK.OFFLINE_PUMP_AMM_PROGRAM.idl.instructions.find(i=>i.name==='sell');need(sellDefinition,'PACKAGED_SELL_LAYOUT_REQUIRED');const matches=instructions.filter(ix=>ix.programId.equals(PUMP_AMM_PROGRAM_ID)&&ix.data.subarray(0,8).equals(Buffer.from(sellDefinition.discriminator)));need(matches.length===1,'SINGLE_SELL_INSTRUCTION_REQUIRED');tradeInstruction=matches[0]!;
 }
 // The quote ATA is transient. Keep the REAL SDK create/unwrap sequence and
 // prove its exact account/authority layout and order around this single swap.
 // Current rent is temporary funding returned by the same atomic success; it
 // is neither permanent base-account rent nor a fee, income or extra proceeds.
 const closes=instructions.filter(i=>i.programId.equals(TOKEN_PROGRAM_ID)&&i.data.length===1&&i.data[0]===9);
 need(closes.length===1,'SINGLE_EXPECTED_WSOL_CLOSE_REQUIRED');const close=closes[0]!;
 need(close.keys.length===3&&close.keys[0]!.pubkey.equals(quoteAta)&&close.keys[0]!.isWritable&&!close.keys[0]!.isSigner&&close.keys[1]!.pubkey.equals(user)&&close.keys[1]!.isWritable&&!close.keys[1]!.isSigner&&close.keys[2]!.pubkey.equals(user)&&!close.keys[2]!.isWritable&&close.keys[2]!.isSigner,'EXPECTED_WSOL_CLOSE_LAYOUT_REQUIRED');
 const creates=instructions.filter(i=>i.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)&&i.keys[1]?.pubkey.equals(quoteAta));need(creates.length===1,'SINGLE_EXPECTED_WSOL_CREATE_REQUIRED');const create=creates[0]!;
 need(create.data.length===1&&create.data[0]===1&&create.keys.length===6&&create.keys[0]!.pubkey.equals(user)&&create.keys[0]!.isSigner&&create.keys[0]!.isWritable&&create.keys[1]!.pubkey.equals(quoteAta)&&!create.keys[1]!.isSigner&&create.keys[1]!.isWritable&&create.keys[2]!.pubkey.equals(user)&&!create.keys[2]!.isSigner&&!create.keys[2]!.isWritable&&create.keys[3]!.pubkey.equals(NATIVE_MINT)&&!create.keys[3]!.isSigner&&!create.keys[3]!.isWritable&&create.keys[4]!.pubkey.equals(SystemProgram.programId)&&!create.keys[4]!.isSigner&&!create.keys[4]!.isWritable&&create.keys[5]!.pubkey.equals(TOKEN_PROGRAM_ID)&&!create.keys[5]!.isSigner&&!create.keys[5]!.isWritable,'EXPECTED_WSOL_CREATE_LAYOUT_REQUIRED');
 need(instructions.indexOf(create)<instructions.indexOf(tradeInstruction)&&instructions.indexOf(tradeInstruction)<instructions.indexOf(close),'ATOMIC_WSOL_CREATE_SWAP_CLOSE_ORDER_REQUIRED');
 const sourceSha256=hash(batch),quoteRentProofSha256=hash({version:'paper-transient-wsol-rent-v1',sourceSha256,inventoryEvidenceSha256:hash(plan),quoteAta:quoteAta.toBase58(),rentLamports:quoteRent.toString(),create:serialized(create),close:serialized(close),meaning:'CURRENT_RPC_RENT_ASSUMPTION_AND_UNSIGNED_ATOMIC_CREATE_CLOSE_NOT_CHAIN_RECEIPT'});
 need(expected.gtn(0),'POSITIVE_SUPPORTED_QUOTE_REQUIRED');need(instructions.length>0&&instructions.length<=16&&instructions.every(i=>i.keys.length<=64&&i.data.length<=1024),'INSTRUCTION_BOUND');current(batch,now());
 const encoded=instructions.map(serialized),signers=new Set(instructions.flatMap(i=>i.keys.filter(k=>k.isSigner).map(k=>k.pubkey.toBase58()))),writable=new Set(instructions.flatMap(i=>i.keys.filter(k=>k.isWritable).map(k=>k.pubkey.toBase58())));
 need(signers.size===1&&signers.has(user.toBase58()),'ONLY_PLACEHOLDER_SIGNER_REQUIRED');
 const result={version:PAPER_UNSIGNED_PUMPSWAP_VERSION,state:'constructed' as const,mint:mint.toBase58(),pool:key.toBase58(),side:request.side,sourceSlot:batch.slot,requestedAt:batch.requestedAt,receivedAt:batch.receivedAt,constructedAt:now(),sourceSha256,instructionVariant:request.side==='buy'?'buy_exact_quote_in' as const:'sell' as const,inputUnits:input.toString(),minimumOutputUnits:minimum.toString(),expectedOutputUnits:expected.toString(),quoteMeetsMinimum:expected.gte(new BN(minimum.toString())),temporaryQuoteRentLamports:quoteRent.toString(),quoteRentProofSha256,wallet:{publicKey:user.toBase58(),identity:'OFF_CURVE_PAPER_PLACEHOLDER' as const,signerAvailable:false as const,chainOwnershipVerified:false as const,chainBalancesVerified:false as const},accounts:{baseAssociatedAccount:baseAta.toBase58(),quoteAssociatedAccount:quoteAta.toBase58(),baseAccountLengthBytes:state.summary.baseAssociatedAccount.accountLengthBytes,quoteAccountLengthBytes:state.summary.quoteAssociatedAccount.accountLengthBytes,baseCreationRequired:request.side==='buy'&&!plan.baseExists,quoteCreationRequired:!plan.quoteExists,quoteClosedByInstructions:true as const,poolExtensionRequired:poolInfo.data.length<300,poolExtensionTargetBytes:poolInfo.data.length<300?300:null,inventoryEvidenceSha256:hash(plan)},poolCosts:{embeddedInOutput:true as const,feeBps:state.summary.feeBps,buyBudgetAboveInternalCurveInputLamports:buyBudget,sellEmbeddedFeeLamports:sellFee,effectiveQuoteReserveLamports:state.summary.effectiveQuoteReserve},instructions:encoded,instructionCount:encoded.length,requiredSignerCount:signers.size,writableAccountCount:writable.size,preflight:'NOT_RUN' as const,landing:'UNVERIFIED' as const,networkRequests:0 as const,limitations:['Unsigned instruction template only; no signature, blockhash, submission, simulation or landing evidence.','The off-curve PAPER placeholder has no signer; account ownership and balances are simulated inventory assumptions, not on-chain claims.','Current pool reserves/fees and size-specific impact are validated; later market movement, account locks, inclusion and execution can still fail.','ATA and optional pool-extension instructions require actual rent funding; network/priority fees, compute consumption and any routing tip remain separately unestimated.','Actual SDK quote-ATA creation and CloseAccount unwrap remain in order around the swap. Quote rent is temporarily reserved and returned within atomic success, never fee or profit; collectible sell proceeds unwrap to SOL. Base-account rent remains separately persistent.']};
 return {...result,constructionSha256:hash(result)};
}
