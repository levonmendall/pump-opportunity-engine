/** Research mapping only. PumpApi is a signature hint; confirmed RPC supplies
 * executed values/identities. No flow admission, provider client or financial API. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import BN from 'bn.js';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID} from './sdk.js';
import type {NormalizedTrade} from './strategy.js';

const require=createRequire(import.meta.url);
const idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;
const coder=new BorshCoder(idl),PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),SOL='So11111111111111111111111111111111111111112';
const EVENT_PREFIX=Buffer.from('e445a52e51cb9a1d','hex');
const AUTHORITY=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
const TOKEN_PROGRAMS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
function need(condition:unknown,reason:string):asserts condition {if(!condition)throw Error(reason);}
const integer=(value:any):string=>{need(BN.isBN(value),'UNVERIFIED_INTEGER');const s=value.toString(10);need(/^(0|[1-9][0-9]*)$/.test(s),'UNVERIFIED_INTEGER');return s;};
const key=(value:any):string=>{need(value&&typeof value.toBase58==='function','UNVERIFIED_EVENT_KEY');return value.toBase58();};
const bytes=(ix:any)=>{need(typeof ix?.data==='string'&&ix.data.length<=4096,'UNVERIFIED_INSTRUCTION_BYTES');return Buffer.from(bs58.decode(ix.data));};
export type FullTradeIdentity={signature:string;program:string;outerInstructionIndex:number;swapInnerInstructionIndex:number|null;eventInnerInstructionIndex:number;eventIndex:0};
export type MappedTradeEvidence={
  identity:FullTradeIdentity;identityKey:string;pool:string;mint:string;trader:string;side:'buy'|'sell';
  tokenUnits:string;curveQuoteLamports:string;userQuoteLamports:string;fees:Record<string,string>;
  slot:number;chainBlockTime:number|null;commitment:'confirmed';providerReceivedAt:number|null;availableAt:number;
  transferChecks:{baseTransfer:boolean;userQuoteTransfer:boolean};fingerprint:string;
  normalizedForStrategy:false;limitations:readonly string[];
};
export function compareMappedTradeEvidence(previous:MappedTradeEvidence,next:MappedTradeEvidence):'distinct'|'duplicate'|'correction'{
  return previous.identityKey!==next.identityKey?'distinct':previous.fingerprint===next.fingerprint?'duplicate':'correction';
}
/** Explicitly labeled research views only. Both conventions can be compared;
 * neither becomes the primary strategy's silently selected convention. */
export function toResearchNormalizedTrade(evidence:MappedTradeEvidence,convention:'curve'|'user',supportedPoolEvidence:string):{mode:'RESEARCH_ONLY';amountConvention:'curve'|'user';supportedPoolEvidence:string;fullIdentity:FullTradeIdentity;trade:NormalizedTrade}{
  need(convention==='curve'||convention==='user','EXPLICIT_AMOUNT_CONVENTION_REQUIRED');
  need(typeof supportedPoolEvidence==='string'&&supportedPoolEvidence.length>0&&supportedPoolEvidence.length<=512,'SUPPORTED_POOL_EVIDENCE_REQUIRED');
  need(evidence.transferChecks.baseTransfer&&evidence.transferChecks.userQuoteTransfer,'UNVERIFIED_EXECUTED_TRANSFERS');
  return {mode:'RESEARCH_ONLY',amountConvention:convention,supportedPoolEvidence,fullIdentity:evidence.identity,trade:{
    // The unique genuine event-CPI inner instruction position is retained as
    // eventIndex, not a fabricated ordinal or a lossy signature-only key.
    identity:{signature:evidence.identity.signature,instructionIndex:evidence.identity.outerInstructionIndex,eventIndex:evidence.identity.eventInnerInstructionIndex},
    mint:evidence.mint,wallet:evidence.trader,side:evidence.side,quoteLamports:convention==='curve'?evidence.curveQuoteLamports:evidence.userQuoteLamports,tokenUnits:evidence.tokenUnits,receivedAt:evidence.availableAt,commitment:evidence.commitment,slot:evidence.slot,
  }};
}

/** Select only bounded exact-scope signature hints. Numeric/UI trade values and
 * txSigner never become normalized amounts or trader identity. */
export function pumpApiSignatureHint(payload:unknown,scope:{mint:string;pool:string}):{signature:string;requiresRpcEnrichment:true}|null{
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  const p=payload as Record<string,unknown>;
  if(p.pool!=='pump-amm'||p.mint!==scope.mint||p.poolId!==scope.pool||typeof p.signature!=='string'||p.signature.length>100)return null;
  try{if(bs58.decode(p.signature).length!==64)return null;}catch{return null;}
  return {signature:p.signature,requiresRpcEnrichment:true};
}

/** Called only after a successful confirmed getTransaction response is available.
 * Actual proof currently covers one direct Sell; other shapes must retain their
 * explicitly unverified status until separately matched with real evidence. */
export function mapConfirmedPumpSwapEvidence(tx:any,input:{signature:string;mint:string;pool:string;providerReceivedAt:number|null;availableAt:number}):MappedTradeEvidence[]{
  need(tx&&tx.meta?.err===null&&(tx.version==='legacy'||tx.version===0||tx.version===1),'UNSUCCESSFUL_OR_UNSUPPORTED_TRANSACTION');
  need(Number.isSafeInteger(tx.slot)&&tx.slot>=0&&Number.isSafeInteger(input.availableAt)&&input.availableAt>=0,'UNVERIFIED_AVAILABILITY');
  need(input.providerReceivedAt===null||Number.isSafeInteger(input.providerReceivedAt)&&input.providerReceivedAt>=0&&input.providerReceivedAt<=input.availableAt,'UNVERIFIED_AVAILABILITY');
  need(tx.transaction?.signatures?.[0]===input.signature,'TRANSACTION_SIGNATURE_MISMATCH');
  need(canonicalPumpPoolPda(new PublicKey(input.mint)).toBase58()===input.pool,'UNVERIFIED_CANONICAL_POOL');
  const message=tx.transaction.message;
  need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'UNVERIFIED_COMPILED_MESSAGE');
  const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  need(keys.length<=256&&keys.every(k=>typeof k==='string'),'UNVERIFIED_ACCOUNT_KEYS');
  const address=(i:unknown)=>{need(Number.isSafeInteger(i)&&Number(i)>=0&&Number(i)<keys.length,'INVALID_ACCOUNT_INDEX');return keys[Number(i)]!;};
  const groups=new Map<number,any[]>();
  need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'MISSING_INNER_INSTRUCTIONS');
  for(const group of tx.meta.innerInstructions){need(Number.isSafeInteger(group.index)&&group.index>=0&&group.index<message.instructions.length&&!groups.has(group.index)&&Array.isArray(group.instructions)&&group.instructions.length<=512,'UNVERIFIED_INNER_GROUP');groups.set(group.index,group.instructions);}
  const result:MappedTradeEvidence[]=[];
  for(let outer=0;outer<message.instructions.length;outer++){
    const outerIx=message.instructions[outer],inner=groups.get(outer)??[];
    const stack=new Map<number,{ix:any;index:number|null}>([[1,{ix:outerIx,index:null}]]);
    for(let eventInner=0;eventInner<inner.length;eventInner++){
      const ix=inner[eventInner],depth=ix.stackHeight;
      need(Number.isSafeInteger(depth)&&depth>=2&&depth<=8,'MISSING_OR_UNSUPPORTED_STACK_HEIGHT');
      for(const level of stack.keys())if(level>=depth)stack.delete(level);
      const parent=stack.get(depth-1);need(parent,'UNRESOLVED_INSTRUCTION_PARENT');stack.set(depth,{ix,index:eventInner});
      if(address(ix.programIdIndex)!==PROGRAM)continue;
      const encoded=bytes(ix);if(!encoded.subarray(0,8).equals(EVENT_PREFIX))continue;
      need(address(parent.ix.programIdIndex)===PROGRAM,'EVENT_NOT_SELF_CPI');
      need(Array.isArray(ix.accounts)&&address(ix.accounts[0])===AUTHORITY,'EVENT_AUTHORITY_MISMATCH');
      const event=coder.events.decode(encoded.subarray(8).toString('base64'));
      if(!event||!['BuyEvent','SellEvent'].includes(event.name))continue;
      // SDK decoding can default absent trailing u64s to zero on older logs.
      // Require the exact packaged layout instead of inventing reported fees.
      need(coder.types.encode(event.name,event.data).equals(encoded.subarray(16)),'UNSUPPORTED_EVENT_LAYOUT');
      const swap=coder.instruction.decode(bytes(parent.ix));need(swap,'UNKNOWN_SWAP_INSTRUCTION');
      const side:'buy'|'sell'=event.name==='BuyEvent'?'buy':'sell';
      need((side==='buy'?['buy','buy_exact_quote_in','buy_v2','buy_exact_quote_in_v2']:['sell','sell_v2']).includes(swap.name),'SWAP_EVENT_DIRECTION_MISMATCH');
      const definition=idl.instructions.find(i=>i.name===swap.name)!;
      const role=(name:string)=>{const index=definition.accounts.findIndex(a=>a.name===name);need(index>=0&&Array.isArray(parent.ix.accounts),'MISSING_SWAP_ROLE');return address(parent.ix.accounts[index]);};
      const data=event.data as any;
      if(key(data.pool)!==input.pool)continue;
      need(role('pool')===input.pool&&role('base_mint')===input.mint&&role('quote_mint')===SOL,'SWAP_SCOPE_MISMATCH');
      need(key(data.user)===role('user')&&key(data.user_base_token_account)===role('user_base_token_account')&&key(data.user_quote_token_account)===role('user_quote_token_account'),'EVENT_TRADER_ROLE_MISMATCH');
      const tokenUnits=integer(data[side==='buy'?'base_amount_out':'base_amount_in']);
      const curveQuoteLamports=integer(data[side==='buy'?'quote_amount_in':'quote_amount_out']);
      const userQuoteLamports=integer(data[side==='buy'?'user_quote_amount_in':'user_quote_amount_out']);
      need(BigInt(tokenUnits)>0n&&BigInt(curveQuoteLamports)>0n&&BigInt(userQuoteLamports)>0n,'EMPTY_SWAP_AMOUNTS');
      const fees=Object.fromEntries(['lp_fee','protocol_fee','coin_creator_fee','cashback','buyback_fee','holder_rewards','quote_transfer_fee'].map(name=>[name,integer(data[name])]));
      const descendants:any[]=[];
      for(let index=parent.index===null?0:parent.index+1;index<inner.length;index++){
        if(parent.index!==null&&inner[index].stackHeight<=depth-1)break;
        descendants.push(inner[index]);
      }
      let base=false,quote=0n;
      for(const transfer of descendants){
        if(!TOKEN_PROGRAMS.has(address(transfer.programIdIndex)))continue;
        const b=bytes(transfer);if(b.length!==10||b[0]!==12)continue;
        need(Array.isArray(transfer.accounts)&&transfer.accounts.length>=4,'MALFORMED_TOKEN_TRANSFER');
        const [source,mint,destination]=transfer.accounts.map(address),amount=b.readBigUInt64LE(1);
        if(mint===input.mint&&source===role(side==='buy'?'pool_base_token_account':'user_base_token_account')&&destination===role(side==='buy'?'user_base_token_account':'pool_base_token_account')&&amount===BigInt(tokenUnits))base=true;
        if(mint===SOL&&(side==='buy'?source===role('user_quote_token_account'):destination===role('user_quote_token_account')))quote+=amount;
      }
      const identity:FullTradeIdentity={signature:input.signature,program:PROGRAM,outerInstructionIndex:outer,swapInnerInstructionIndex:parent.index,eventInnerInstructionIndex:eventInner,eventIndex:0};
      const identityKey=[identity.signature,PROGRAM,outer,parent.index??'outer',eventInner,0].join(':');
      const fields={identity,pool:input.pool,mint:input.mint,trader:key(data.user),side,tokenUnits,curveQuoteLamports,userQuoteLamports,fees,slot:tx.slot};
      const transferChecks={baseTransfer:base,userQuoteTransfer:quote===BigInt(userQuoteLamports)};
      result.push({...fields,identityKey,chainBlockTime:Number.isSafeInteger(tx.blockTime)?tx.blockTime:null,commitment:'confirmed',providerReceivedAt:input.providerReceivedAt,availableAt:input.availableAt,transferChecks,fingerprint:createHash('sha256').update(JSON.stringify({...fields,transferChecks})).digest('hex'),normalizedForStrategy:false,limitations:['RPC-enriched executed evidence; not proof of PumpApi field semantics or completeness.','The strategy quoteLamports economic convention is not frozen by this mapper.','Only separately recorded real transaction shapes establish tested coverage; generic decoding is not a routed/variant proof.']});
    }
  }
  return result;
}
