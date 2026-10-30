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
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID,PUMP_PROGRAM_ID,PUMP_FEE_PROGRAM_ID,GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,bondingCurvePda} from './sdk.js';
import {parseProgramLogEvidence} from './program-log-mapping.js';
import type {NormalizedTrade} from './strategy.js';

const require=createRequire(import.meta.url);
const idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;
const coder=new BorshCoder(idl),PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),SOL='So11111111111111111111111111111111111111112';
const EVENT_PREFIX=Buffer.from('e445a52e51cb9a1d','hex');
const AUTHORITY=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
const TOKEN_PROGRAMS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const SUPPORTED_SWAPS=new Set(['buy','buy_exact_quote_in','buy_v2','buy_exact_quote_in_v2','sell','sell_v2']);
const KNOWN_NON_SWAPS=new Set(['admin_cto_pool','admin_update_token_incentives','claim_cashback','claim_token_incentives','close_user_volume_accumulator','collect_coin_creator_fee','create_config','create_pool','deposit','disable','extend_account','init_boost','init_user_volume_accumulator','migrate_pool_coin_creator','set_boost_authority','set_coin_creator','set_reserved_fee_recipients','sweep_creator_fee','sweep_protocol_fee','sync_user_volume_accumulator','toggle_boost','toggle_cashback_enabled','toggle_mayhem_mode','transfer_creator_fees_to_pump','transfer_creator_fees_to_pump_v2','update_admin','update_buyback_config','update_creator_fee_config','update_fee_config','withdraw']);
function need(condition:unknown,reason:string):asserts condition {if(!condition)throw Error(reason);}
const integer=(value:any):string=>{need(BN.isBN(value),'UNVERIFIED_INTEGER');const s=value.toString(10);need(/^(0|[1-9][0-9]*)$/.test(s),'UNVERIFIED_INTEGER');return s;};
const key=(value:any):string=>{need(value&&typeof value.toBase58==='function','UNVERIFIED_EVENT_KEY');return value.toBase58();};
const bytes=(ix:any)=>{need(typeof ix?.data==='string'&&ix.data.length<=4096,'UNVERIFIED_INSTRUCTION_BYTES');return Buffer.from(bs58.decode(ix.data));};
export type DecodedPumpSwapInstruction={name:string;data:Record<string,unknown>;layout:'pinned-sdk'|'observed-exact-quote-two-u64'|'observed-buy-two-u64';exactLayout:true;trackVolumeAvailable:boolean};
/** Retained successful buy and buy_exact_quote_in forms can omit the packaged
 * IDL's trailing track_volume field. Decode only the two actual u64s; never pad
 * or invent the missing option. Event, role and transfer checks remain required.
 * Other layouts must round-trip through the pinned SDK exactly. */
export function decodePumpSwapInstruction(encoded:Buffer):DecodedPumpSwapInstruction{
  need(Buffer.isBuffer(encoded)&&encoded.length>=8&&encoded.length<=4096,'UNVERIFIED_INSTRUCTION_BYTES');
  const definition=idl.instructions.find(i=>Buffer.from(i.discriminator).equals(encoded.subarray(0,8)));
  need(definition,'UNKNOWN_SWAP_INSTRUCTION');
  if(['buy','buy_exact_quote_in'].includes(definition.name)&&encoded.length===24){
    const names=definition.name==='buy'?['base_amount_out','max_quote_amount_in']:['spendable_quote_in','min_base_amount_out'];
    need(definition.args.length===3&&definition.args[0]!.name===names[0]&&definition.args[0]!.type==='u64'&&definition.args[1]!.name===names[1]&&definition.args[1]!.type==='u64'&&definition.args[2]!.name==='track_volume'&&JSON.stringify(definition.args[2]!.type)===JSON.stringify({defined:{name:'OptionBool'}}),'PINNED_SWAP_INTERFACE_MISMATCH');
    return {name:definition.name,data:{[names[0]!]:new BN(encoded.subarray(8,16),'le'),[names[1]!]:new BN(encoded.subarray(16,24),'le')},layout:definition.name==='buy'?'observed-buy-two-u64':'observed-exact-quote-two-u64',exactLayout:true,trackVolumeAvailable:false};
  }
  try{
    const decoded=coder.instruction.decode(encoded);
    need(decoded&&decoded.name===definition.name&&coder.instruction.encode(decoded.name,decoded.data).equals(encoded),'UNSUPPORTED_SWAP_INSTRUCTION_LAYOUT');
    return {name:decoded.name,data:decoded.data as Record<string,unknown>,layout:'pinned-sdk',exactLayout:true,trackVolumeAvailable:Object.hasOwn(decoded.data,'track_volume')};
  }catch{throw Error('UNSUPPORTED_SWAP_INSTRUCTION_LAYOUT');}
}
export type ScopedPumpSwapInstructionCheck={outerInstructionIndex:number;innerInstructionIndex:number|null;discriminatorHex:string;instructionName:string|null;exactRecognizedLayout:boolean;exactPackagedLayout:boolean;instructionLayout:DecodedPumpSwapInstruction['layout']|null;trackVolumeAvailable:boolean|null;knownNonSwap:boolean;classification:'supported-swap'|'known-non-swap'|'supported-wrapper'|'unsupported'};
export class ScopedPumpSwapInstructionError extends Error {
  constructor(message:string,readonly checks:readonly ScopedPumpSwapInstructionCheck[]){super(message);this.name='ScopedPumpSwapInstructionError';}
}
/** A pool-address history row is not necessarily a swap. Before treating zero
 * mapped events as a nontrade, prove every relevant compiled AMM instruction
 * has an exact known interface. A new swap or protocol buy/burn cannot vanish
 * from the denominator merely because no supported user-trade event was found.
 * This guard uses actual instruction positions; it invents no event identities.
 */
export function inspectScopedPumpSwapInstructions(tx:any,input:{signature:string;mint:string;pool:string}){
  const checks:ScopedPumpSwapInstructionCheck[]=[];
  function require(v:unknown,reason:string):asserts v {if(!v)throw new ScopedPumpSwapInstructionError(reason,structuredClone(checks));}
  require(tx&&tx.meta?.err===null&&['legacy',0,1].includes(tx.version),'UNSUCCESSFUL_OR_UNSUPPORTED_TRANSACTION');
  require(tx.transaction?.signatures?.[0]===input.signature,'TRANSACTION_SIGNATURE_MISMATCH');
  require(canonicalPumpPoolPda(new PublicKey(input.mint)).toBase58()===input.pool,'UNVERIFIED_CANONICAL_POOL');
  const message=tx.transaction.message;
  require(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'UNVERIFIED_COMPILED_MESSAGE');
  require(tx.meta.loadedAddresses===undefined||Array.isArray(tx.meta.loadedAddresses.writable)&&Array.isArray(tx.meta.loadedAddresses.readonly),'UNVERIFIED_LOADED_ADDRESSES');
  const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  require(keys.length<=256&&keys.every(k=>typeof k==='string'),'UNVERIFIED_ACCOUNT_KEYS');
  const address=(i:unknown)=>{require(Number.isSafeInteger(i)&&Number(i)>=0&&Number(i)<keys.length,'INVALID_ACCOUNT_INDEX');return keys[Number(i)]!;};
  require(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'MISSING_INNER_INSTRUCTIONS');
  const positioned:Array<{ix:any;outerInstructionIndex:number;innerInstructionIndex:number|null}>=message.instructions.map((ix:any,i:number)=>({ix,outerInstructionIndex:i,innerInstructionIndex:null})),groups=new Set<number>();
  for(const group of tx.meta.innerInstructions){require(Number.isSafeInteger(group.index)&&group.index>=0&&group.index<message.instructions.length&&!groups.has(group.index)&&Array.isArray(group.instructions)&&group.instructions.length<=512,'UNVERIFIED_INNER_GROUP');groups.add(group.index);positioned.push(...group.instructions.map((ix:any,i:number)=>({ix,outerInstructionIndex:group.index,innerInstructionIndex:i})));}
  let supportedSwapInstructions=0,knownNonSwapInstructions=0;const wrappers:Array<{check:ScopedPumpSwapInstructionCheck;ix:any}>=[];
  for(const p of positioned){
    const ix=p.ix;if(address(ix?.programIdIndex)!==PROGRAM)continue;
    require(Array.isArray(ix.accounts)&&ix.accounts.every((i:unknown)=>Number.isSafeInteger(i)&&Number(i)>=0&&Number(i)<keys.length),'AMM_ACCOUNT_INDICES');
    if(!ix.accounts.some((i:number)=>keys[i]===input.pool))continue;
    let raw:Buffer;try{raw=bytes(ix);}catch{throw new ScopedPumpSwapInstructionError('AMM_INSTRUCTION_BYTES',structuredClone(checks));}
    let decoded:DecodedPumpSwapInstruction|null=null;try{decoded=decodePumpSwapInstruction(raw);}catch{/* Unknown relevant bytes remain a refusal below. */}
    const check:ScopedPumpSwapInstructionCheck={outerInstructionIndex:p.outerInstructionIndex,innerInstructionIndex:p.innerInstructionIndex,discriminatorHex:raw.subarray(0,8).toString('hex'),instructionName:decoded?.name??null,exactRecognizedLayout:decoded?.exactLayout??false,exactPackagedLayout:decoded?.layout==='pinned-sdk',instructionLayout:decoded?.layout??null,trackVolumeAvailable:decoded?.trackVolumeAvailable??null,knownNonSwap:false,classification:'unsupported'};checks.push(check);
    require(decoded?.exactLayout,'RELEVANT_AMM_INSTRUCTION_UNSUPPORTED');
    const definition=idl.instructions.find(i=>i.name===decoded.name)!;
    const role=(name:string)=>{const index=definition.accounts.findIndex(a=>a.name===name);return index<0?null:address(ix.accounts[index]);};
    // A verified named pool role may establish that this is another pool's
    // instruction with a coincidental mention; unknown layouts never get that
    // exemption because their roles cannot be established.
    const pool=role('pool');if(pool!==null&&pool!==input.pool){checks.pop();continue;}
    if(decoded.name==='boost_buy_and_burn')throw new ScopedPumpSwapInstructionError('UNSUPPORTED_BOOST_BUY_AND_BURN_FLOW',structuredClone(checks));
    if(SUPPORTED_SWAPS.has(decoded.name)){
      require(pool===input.pool&&role('base_mint')===input.mint&&role('quote_mint')===SOL,'SWAP_SCOPE_MISMATCH');
      check.classification='supported-swap';supportedSwapInstructions++;continue;
    }
    if(decoded.name==='multi_hop_swap'){check.classification='supported-wrapper';wrappers.push({check,ix});continue;}
    require(!/^(buy|sell)(_|$)/.test(decoded.name),'RELEVANT_SWAP_VARIANT_UNSUPPORTED');
    require(KNOWN_NON_SWAPS.has(decoded.name)&&pool===input.pool,'RELEVANT_AMM_POOL_ROLE_UNVERIFIED');
    check.knownNonSwap=true;check.classification='known-non-swap';knownNonSwapInstructions++;
  }
  for(const {check,ix}of wrappers){
    const group=tx.meta.innerInstructions.find((g:any)=>g.index===check.outerInstructionIndex)?.instructions??[];
    const start=check.innerInstructionIndex??-1,depth=start<0?1:ix.stackHeight;
    require(Number.isSafeInteger(depth)&&depth>=1,'RELEVANT_SWAP_WRAPPER_STACK_UNVERIFIED');
    let end=group.length;for(let i=start+1;i<group.length;i++)if(group[i].stackHeight<=depth){end=i;break;}
    const ordinaryChild=checks.some(c=>c.classification==='supported-swap'&&c.outerInstructionIndex===check.outerInstructionIndex&&c.innerInstructionIndex!==null&&c.innerInstructionIndex>start&&c.innerInstructionIndex<end);
    if(!ordinaryChild){
      // Actual MultiHopSwap can execute its own intermediate pool leg instead
      // of invoking Buy. It is not admitted by merely recognizing the label.
      let own:MappedTradeEvidence[];try{own=mapObservedMultiHopPoolBuy(tx,{...input,providerReceivedAt:null,availableAt:0});}catch(error){throw new ScopedPumpSwapInstructionError('RELEVANT_SWAP_WRAPPER_WITHOUT_SUPPORTED_CHILD:'+(error instanceof Error?error.message:'MULTI_HOP_UNVERIFIED'),structuredClone(checks));}
      require(own.length===1,'RELEVANT_SWAP_WRAPPER_WITHOUT_SUPPORTED_CHILD');check.classification='supported-swap';supportedSwapInstructions++;
    }
  }
  return {checks,supportedSwapInstructions,knownNonSwapInstructions};
}
export type FullTradeIdentity={signature:string;program:string;outerInstructionIndex:number;swapInnerInstructionIndex:number|null;eventInnerInstructionIndex:number;eventIndex:0};
export type MappedTradeEvidence={
  identity:FullTradeIdentity;identityKey:string;pool:string;mint:string;trader:string;side:'buy'|'sell';
  tokenUnits:string;curveQuoteLamports:string;userQuoteLamports:string;fees:Record<string,string>;
  slot:number;chainBlockTime:number|null;commitment:'confirmed';providerReceivedAt:number|null;availableAt:number;
  transferChecks:{baseTransfer:boolean;userQuoteTransfer:boolean};fingerprint:string;
  normalizedForStrategy:false;limitations:readonly string[];
  route?:{version:'observed-first-sol-pool-to-curve-buy-v1';intermediate:true;finalMint:string;finalUserTokenAccount:string;nextVenue:string;nextQuoteVault:string;userReceivedIntermediateBase:false};
};

/** First actual supported own-event route: canonical SOL pool -> one Pump
 * Token2022 curve. Other routes remain explicit refusals, not sampled away.
 * Exact native grammar/IDL economics are corroborated by compiled roles,
 * genuine CPI positions, transfer bytes and complete integer balance deltas. */
function mapObservedMultiHopPoolBuy(tx:any,input:{signature:string;mint:string;pool:string;providerReceivedAt:number|null;availableAt:number}):MappedTradeEvidence[]{
  need(tx.meta?.err===null&&['legacy',0,1].includes(tx.version)&&tx.transaction?.signatures?.[0]===input.signature,'MULTI_HOP_TRANSACTION');
  const msg=tx.transaction.message,keys=[...msg.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  need(keys.length<=256&&keys.every(k=>typeof k==='string')&&Array.isArray(tx.meta.innerInstructions),'MULTI_HOP_MESSAGE');
  const address=(i:any)=>{need(Number.isSafeInteger(i)&&i>=0&&i<keys.length,'MULTI_HOP_ACCOUNT_INDEX');return keys[i] as string;};
  const positioned:Array<{ix:any;outer:number;inner:number|null}>=msg.instructions.map((ix:any,outer:number)=>({ix,outer,inner:null}));
  for(const g of tx.meta.innerInstructions){need(Array.isArray(g.instructions)&&g.instructions.length<=512,'MULTI_HOP_GROUP');for(let i=0;i<g.instructions.length;i++)positioned.push({ix:g.instructions[i],outer:g.index,inner:i});}
  const calls=positioned.filter(p=>address(p.ix.programIdIndex)===PROGRAM&&!bytes(p.ix).subarray(0,8).equals(EVENT_PREFIX));
  need(calls.length===1,'MULTI_HOP_MULTIPLE_AMM_CALLS_UNSUPPORTED');const p=calls[0]!,instruction=decodePumpSwapInstruction(bytes(p.ix));need(instruction.name==='multi_hop_swap','MULTI_HOP_INSTRUCTION');
  need(Array.isArray(p.ix.accounts),'MULTI_HOP_INSTRUCTION_ACCOUNTS');const definition=idl.instructions.find(i=>i.name==='multi_hop_swap')!,a=p.ix.accounts.map(address);need(definition.accounts.length===16&&a.length===26,'MULTI_HOP_TWO_HOP_LAYOUT');
  const role=(name:string)=>{const i=definition.accounts.findIndex(r=>r.name===name);need(i>=0,'MULTI_HOP_FIXED_ROLE');return a[i]!;},hop=a.slice(16),[mint,quote,pool,baseVault,quoteVault,finalMint,nextQuote,nextVenue,nextBaseVault,nextQuoteVault]=hop as [string,string,string,string,string,string,string,string,string,string];
  need(mint===input.mint&&quote===SOL&&pool===input.pool&&canonicalPumpPoolPda(new PublicKey(mint)).toBase58()===pool&&nextQuote===mint&&finalMint!==mint&&bondingCurvePda(new PublicKey(finalMint)).toBase58()===nextVenue,'MULTI_HOP_ROUTE_BINDING');
  need(role('global_config')===GLOBAL_CONFIG_PDA.toBase58()&&role('fee_config')===PUMP_AMM_FEE_CONFIG_PDA.toBase58()&&role('program')===PROGRAM&&role('pump_program')===PUMP_PROGRAM_ID.toBase58()&&role('token_program')===TOKEN_PROGRAM_ID.toBase58()&&role('token_2022_program')===TOKEN_2022_PROGRAM_ID.toBase58()&&role('event_authority')===AUTHORITY,'MULTI_HOP_PROGRAM_ROLES');
  const ata=(mint:string,owner:string,program:PublicKey)=>getAssociatedTokenAddressSync(new PublicKey(mint),new PublicKey(owner),true,program).toBase58(),user=role('user');
  need(Number.isSafeInteger(msg.header?.numRequiredSignatures)&&msg.header.numRequiredSignatures>0&&msg.header.numRequiredSignatures<=msg.accountKeys.length&&msg.accountKeys.slice(0,msg.header.numRequiredSignatures).includes(user),'MULTI_HOP_USER_AUTHORITY');
  need(baseVault===ata(mint,pool,TOKEN_2022_PROGRAM_ID)&&quoteVault===ata(quote,pool,TOKEN_PROGRAM_ID)&&nextBaseVault===ata(finalMint,nextVenue,TOKEN_2022_PROGRAM_ID)&&nextQuoteVault===ata(mint,nextVenue,TOKEN_2022_PROGRAM_ID)&&role('user_in_token_account')===ata(quote,user,TOKEN_PROGRAM_ID)&&role('user_out_token_account')===ata(finalMint,user,TOKEN_2022_PROGRAM_ID),'MULTI_HOP_VAULT_ROLES');
  const pumpGlobal=PublicKey.findProgramAddressSync([Buffer.from('global')],PUMP_PROGRAM_ID)[0].toBase58(),pumpFeeConfig=PublicKey.findProgramAddressSync([Buffer.from('fee_config'),PUMP_PROGRAM_ID.toBuffer()],PUMP_FEE_PROGRAM_ID)[0].toBase58(),pumpAuthority=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_PROGRAM_ID)[0].toBase58();
  need(role('system_program')===PublicKey.default.toBase58()&&role('pump_global')===pumpGlobal&&role('pump_fee_config')===pumpFeeConfig&&role('pump_event_authority')===pumpAuthority,'MULTI_HOP_PUMP_PROGRAM_ROLES');
  const native=parseProgramLogEvidence({signature:input.signature,slot:tx.slot,err:null,logs:tx.meta.logMessages,commitment:'confirmed',availableAt:input.availableAt},[{mint,pool,supportedPoolEvidence:'exact compiled historical route binding',baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58()}]);
  need(native.length===1&&native[0]!.instructionLabel==='MultiHopSwap','MULTI_HOP_OWN_EVENT');const e=native[0]!;need(e.trader===user&&integer(instruction.data.amount_in)===e.userQuoteLamports&&BigInt(integer(instruction.data.min_amount_out))>0n,'MULTI_HOP_USER_OR_INPUT');
  const group=tx.meta.innerInstructions.find((g:any)=>g.index===p.outer)?.instructions??[],depth=p.inner===null?1:p.ix.stackHeight;need(Number.isSafeInteger(depth)&&depth>=1,'MULTI_HOP_STACK');const start=p.inner===null?-1:p.inner;let end=group.length;for(let i=start+1;i<group.length;i++)if(group[i].stackHeight<=depth){end=i;break;}
  const children=group.slice(start+1,end);need(children.length===7,'MULTI_HOP_EXECUTED_CHILDREN');
  const protectedAccounts=new Set([pool,baseVault,quoteVault,nextVenue,nextBaseVault,nextQuoteVault]);
  for(const row of positioned){
    if(row.ix===p.ix||row.outer===p.outer&&row.inner===null||row.outer===p.outer&&row.inner!==null&&row.inner>start&&row.inner<end)continue;
    need(!row.ix.accounts.map(address).some((key:string)=>protectedAccounts.has(key)),'MULTI_HOP_EXTERNAL_VAULT_ACCESS_UNSUPPORTED');
  }
  const programSequence=[TOKEN_PROGRAM_ID.toBase58(),TOKEN_PROGRAM_ID.toBase58(),PROGRAM,PUMP_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58(),PUMP_PROGRAM_ID.toBase58()];
  need(children.every((ix:any,i:number)=>address(ix.programIdIndex)===programSequence[i]&&ix.stackHeight===depth+(i>=4?2:1)),'MULTI_HOP_EXECUTED_STACK');
  const eventIx=children[2]!,eventBytes=bytes(eventIx);need(eventBytes.subarray(0,8).equals(EVENT_PREFIX)&&eventIx.accounts.length===1&&address(eventIx.accounts[0])===AUTHORITY&&eventBytes.subarray(8).equals(Buffer.from(e.eventBase64,'base64')),'MULTI_HOP_EVENT_CPI_BINDING');
  const curve=children[3]!,curveBytes=bytes(curve);need(curveBytes.length===21&&curveBytes.subarray(0,8).equals(createHash('sha256').update('global:multi_hop_curve_swap').digest().subarray(0,8))&&curveBytes.readBigUInt64LE(8)===BigInt(e.tokenUnits)&&curveBytes.subarray(16).toString('hex')==='0100000002','MULTI_HOP_CURVE_LAYOUT');
  const curveAccounts=curve.accounts.map(address);need(curveAccounts.length===18&&JSON.stringify(curveAccounts.slice(0,3))===JSON.stringify([pumpGlobal,pumpFeeConfig,GLOBAL_CONFIG_PDA.toBase58()])&&JSON.stringify(curveAccounts.slice(8,13))===JSON.stringify([TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58(),PublicKey.default.toBase58(),pumpAuthority,PUMP_PROGRAM_ID.toBase58()])&&JSON.stringify(curveAccounts.slice(13))===JSON.stringify([finalMint,mint,nextVenue,nextBaseVault,nextQuoteVault])&&curveAccounts[3]===user&&curveAccounts[4]===pool&&curveAccounts[5]===baseVault&&curveAccounts[6]===role('user_out_token_account')&&curveAccounts[7]===role('buyback_fee_recipient'),'MULTI_HOP_CURVE_ROLE_BINDING');
  const pumpEventIx=children[6]!,pumpEventBytes=bytes(pumpEventIx);need(pumpEventIx.accounts.length===1&&address(pumpEventIx.accounts[0])===pumpAuthority&&pumpEventBytes.subarray(0,8).equals(EVENT_PREFIX)&&tx.meta.logMessages.filter((line:string)=>line==='Program data: '+pumpEventBytes.subarray(8).toString('base64')).length===1,'MULTI_HOP_CURVE_EVENT_CPI_BINDING');
  const transfer=(ix:any,program:string,accounts:string[],amount:string,decimals:number)=>{const b=bytes(ix);return address(ix.programIdIndex)===program&&b.length===10&&b[0]===12&&b.readBigUInt64LE(1)===BigInt(amount)&&b[9]===decimals&&JSON.stringify(ix.accounts.map(address))===JSON.stringify(accounts);};
  const baseDecimals=tx.meta.preTokenBalances?.find((r:any)=>address(r.accountIndex)===baseVault)?.uiTokenAmount?.decimals,finalDecimals=tx.meta.preTokenBalances?.find((r:any)=>address(r.accountIndex)===nextBaseVault)?.uiTokenAmount?.decimals;need(Number.isSafeInteger(baseDecimals)&&Number.isSafeInteger(finalDecimals),'MULTI_HOP_DECIMALS');
  const finalTransferBytes=bytes(children[5]!);need(finalTransferBytes.length===10,'MULTI_HOP_FINAL_TRANSFER');const finalUnits=finalTransferBytes.readBigUInt64LE(1).toString();need(BigInt(finalUnits)>=BigInt(integer(instruction.data.min_amount_out)),'MULTI_HOP_OUTPUT_MINIMUM');
  need(transfer(children[0],TOKEN_PROGRAM_ID.toBase58(),[role('user_in_token_account'),SOL,quoteVault,user],e.userQuoteLamports,9)&&transfer(children[1],TOKEN_PROGRAM_ID.toBase58(),[quoteVault,SOL,role('buyback_fee_recipient'),pool],e.fees.buyback_fee!,9)&&transfer(children[4],TOKEN_2022_PROGRAM_ID.toBase58(),[baseVault,mint,nextQuoteVault,pool],e.tokenUnits,baseDecimals)&&transfer(children[5],TOKEN_2022_PROGRAM_ID.toBase58(),[nextBaseVault,finalMint,role('user_out_token_account'),nextVenue],finalUnits,finalDecimals),'MULTI_HOP_EXECUTED_TRANSFERS');
  const balances=(rows:any,addressValue:string,mintValue:string,owner:string,program:string)=>{need(Array.isArray(rows),'MULTI_HOP_BALANCE_EVIDENCE');const matches=rows.filter((r:any)=>address(r.accountIndex)===addressValue);need(matches.length===1&&matches[0].mint===mintValue&&matches[0].owner===owner&&matches[0].programId===program&&/^(0|[1-9][0-9]*)$/.test(matches[0].uiTokenAmount?.amount),'MULTI_HOP_BALANCE_ROLE');return BigInt(matches[0].uiTokenAmount.amount);};
  const delta=(account:string,mintValue:string,owner:string,program:string)=>balances(tx.meta.postTokenBalances,account,mintValue,owner,program)-balances(tx.meta.preTokenBalances,account,mintValue,owner,program);
  need(delta(baseVault,mint,pool,TOKEN_2022_PROGRAM_ID.toBase58())===-BigInt(e.tokenUnits)&&delta(nextQuoteVault,mint,nextVenue,TOKEN_2022_PROGRAM_ID.toBase58())===BigInt(e.tokenUnits)&&delta(quoteVault,SOL,pool,TOKEN_PROGRAM_ID.toBase58())===BigInt(e.userQuoteLamports)-BigInt(e.fees.buyback_fee!)&&delta(nextBaseVault,finalMint,nextVenue,TOKEN_2022_PROGRAM_ID.toBase58())===-BigInt(finalUnits)&&delta(role('user_out_token_account'),finalMint,user,TOKEN_2022_PROGRAM_ID.toBase58())===BigInt(finalUnits),'MULTI_HOP_BALANCE_DELTA');
  const identity:FullTradeIdentity={signature:input.signature,program:PROGRAM,outerInstructionIndex:p.outer,swapInnerInstructionIndex:p.inner,eventInnerInstructionIndex:start+3,eventIndex:0};
  const identityKey=[input.signature,PROGRAM,p.outer,p.inner??'outer',identity.eventInnerInstructionIndex,0].join(':'),fields={identity,pool,mint,trader:user,side:'buy' as const,tokenUnits:e.tokenUnits,curveQuoteLamports:e.curveQuoteLamports,userQuoteLamports:e.userQuoteLamports,fees:e.fees,slot:tx.slot},transferChecks={baseTransfer:true,userQuoteTransfer:true},route={version:'observed-first-sol-pool-to-curve-buy-v1' as const,intermediate:true as const,finalMint,finalUserTokenAccount:role('user_out_token_account'),nextVenue,nextQuoteVault,userReceivedIntermediateBase:false as const};
  return [{...fields,identityKey,transferChecks,route,chainBlockTime:Number.isSafeInteger(tx.blockTime)?tx.blockTime:null,commitment:'confirmed',providerReceivedAt:input.providerReceivedAt,availableAt:input.availableAt,normalizedForStrategy:false,fingerprint:createHash('sha256').update(JSON.stringify({...fields,transferChecks,route})).digest('hex'),limitations:['Actual intermediate pool-leg buy; the user received the final curve token, not this pool base into a user ATA.','Only the separately retained two-hop SOL-pool-to-Token2022-curve layout is supported; other multi-hop layouts remain unavailable.','Only the selected SOL pool leg amounts/fees are mapped; downstream curve costs are not asserted as this pool leg fees.','Historical proof availability must not be backdated into an earlier window.']}];
}
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
 * Retained actual fixtures establish the separately tested direct/CPI variants;
 * decoding alone never establishes unobserved instruction/fee behavior. */
export function mapConfirmedPumpSwapEvidence(tx:any,input:{signature:string;mint:string;pool:string;providerReceivedAt:number|null;availableAt:number}):MappedTradeEvidence[]{
  const inspection=inspectScopedPumpSwapInstructions(tx,input);
  need(tx&&tx.meta?.err===null&&(tx.version==='legacy'||tx.version===0||tx.version===1),'UNSUCCESSFUL_OR_UNSUPPORTED_TRANSACTION');
  need(Number.isSafeInteger(tx.slot)&&tx.slot>=0&&Number.isSafeInteger(input.availableAt)&&input.availableAt>=0,'UNVERIFIED_AVAILABILITY');
  need(input.providerReceivedAt===null||Number.isSafeInteger(input.providerReceivedAt)&&input.providerReceivedAt>=0&&input.providerReceivedAt<=input.availableAt,'UNVERIFIED_AVAILABILITY');
  if(inspection.checks.some(c=>c.classification==='supported-swap'&&c.instructionName==='multi_hop_swap'))return mapObservedMultiHopPoolBuy(tx,input);
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
      const data=event.data as any;if(key(data.pool)!==input.pool)continue;
      const swap=decodePumpSwapInstruction(bytes(parent.ix));
      const side:'buy'|'sell'=event.name==='BuyEvent'?'buy':'sell';
      need((side==='buy'?['buy','buy_exact_quote_in','buy_v2','buy_exact_quote_in_v2']:['sell','sell_v2']).includes(swap.name),'SWAP_EVENT_DIRECTION_MISMATCH');
      const definition=idl.instructions.find(i=>i.name===swap.name)!;
      const role=(name:string)=>{const index=definition.accounts.findIndex(a=>a.name===name);need(index>=0&&Array.isArray(parent.ix.accounts),'MISSING_SWAP_ROLE');return address(parent.ix.accounts[index]);};
      need(role('pool')===input.pool&&role('base_mint')===input.mint&&role('quote_mint')===SOL,'SWAP_SCOPE_MISMATCH');
      need(key(data.user)===role('user')&&key(data.user_base_token_account)===role('user_base_token_account')&&key(data.user_quote_token_account)===role('user_quote_token_account'),'EVENT_TRADER_ROLE_MISMATCH');
      const tokenUnits=integer(data[side==='buy'?'base_amount_out':'base_amount_in']);
      // Separately retained actual buy_exact_quote_in and buy_exact_quote_in_v2
      // events use quote_amount_in for the whole user debit and
      // user_quote_amount_in for net curve input. The names suggest the reverse.
      // Executed transfers prove both variants; do not generalize to other buys.
      const exactQuoteBuy=side==='buy'&&['buy_exact_quote_in','buy_exact_quote_in_v2'].includes(swap.name);
      const curveQuoteLamports=integer(data[side==='buy'?(exactQuoteBuy?'user_quote_amount_in':'quote_amount_in'):'quote_amount_out']);
      const userQuoteLamports=integer(data[side==='buy'?(exactQuoteBuy?'quote_amount_in':'user_quote_amount_in'):'user_quote_amount_out']);
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
