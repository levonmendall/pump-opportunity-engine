/** OFFLINE ONLY: strict evidence for the three retained top-level Boost shapes.
 * Import decodeProtocolBuyAndBurns(tx, recordedInput) from an offline replay.
 * The caller supplies the recorded request commitment and RPC availability;
 * decodedAt is this offline calculation's time, never a forward availability.
 *
 * This component is NOT adopted by the mapper, feature windows or trader. It
 * returns protocol evidence, never NormalizedTrade. Accepting mixed windows
 * requires a versioned actor/amount/price contract and separate coverage audit.
 * It does not establish transaction-wide completeness or historical funding
 * provenance. No client, financial writer, CLI side effect or network method.
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import BN from 'bn.js';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda,bondingCurvePda} from '../src/sdk.js';

const require=createRequire(import.meta.url);
const idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
const program=PUMP_AMM_PROGRAM_ID.toBase58(),sol='So11111111111111111111111111111111111111112',system='11111111111111111111111111111111';
const tokenPrograms=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const prefix=Buffer.from('e445a52e51cb9a1d','hex'),definition=idl.instructions.find(i=>i.name==='boost_buy_and_burn')!;
const eventAuthority=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
const globalConfig=PublicKey.findProgramAddressSync([Buffer.from('global_config')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function need(value:unknown,reason:string):asserts value {if(!value)throw Error('OFFLINE_BOOST_'+reason);}
const integer=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
const decimal=(n:unknown,signed=false)=>{need(BN.isBN(n),'INTEGER');const s=n.toString(10);need((signed?/^-?(0|[1-9][0-9]*)$/:/^(0|[1-9][0-9]*)$/).test(s),'INTEGER');return s;};
const key=(n:any)=>{need(n&&typeof n.toBase58==='function','EVENT_KEY');return n.toBase58() as string;};
const bytes=(ix:any)=>{need(typeof ix?.data==='string'&&ix.data.length<=4096,'INSTRUCTION_BYTES');try{return Buffer.from(bs58.decode(ix.data));}catch{throw Error('OFFLINE_BOOST_INSTRUCTION_BYTES');}};

export type ProtocolDecodeInput={signature:string;mint:string;pool:string;providerReceivedAt:number|null;availableAt:number;commitment:'confirmed'|'finalized'};
export type ProtocolBuyAndBurnEvidence={
  version:'pump-boost-offline-v1-unadopted';mode:'OFFLINE_EVIDENCE_COMPONENT';classification:'protocol-buy-and-burn';
  identity:{signature:string;program:string;outerInstructionIndex:number;protocolInnerInstructionIndex:null;buyEventInnerInstructionIndex:number;boostEventInnerInstructionIndex:number};identityKey:string;
  mint:string;pool:string;actor:{kind:'protocol-boost-vault-authority';authorityPda:string;invokingAuthority:string;ordinaryBuyer:false};
  amounts:{requestedQuoteLamports:string;usedQuoteLamports:string;burnedBaseUnits:string;minimumBurnedBaseUnits:string};
  accounts:Record<string,string>;fees:Record<string,string>;
  transfers:{quote:{innerInstructionIndex:number;amount:string;source:string;mint:string;destination:string;authority:string;decimals:9};burn:{innerInstructionIndex:number;amount:string;source:string;mint:string;authority:string}};
  events:{buyEventSha256:string;boostEventSha256:string;eventTimestamp:string;virtualQuoteReserves:string;realQuoteReservesAfter:string;baseReservesAfter:string;boostVaultRemaining:string};
  slot:number;chainBlockTime:number|null;commitment:'confirmed'|'finalized';providerReceivedAt:number|null;recordedRpcAvailableAt:number;offlineDecodedAt:number;
  fingerprint:string;normalizedForStrategy:false;transactionCompleteness:'NOT_ESTABLISHED_BY_THIS_COMPONENT';limitations:readonly string[];
};

export function decodeProtocolBuyAndBurns(transaction:unknown,input:ProtocolDecodeInput,decodedAt=Date.now()):ProtocolBuyAndBurnEvidence[]{
  const tx=transaction as any;
  need(tx?.meta?.err===null&&['legacy',0,1].includes(tx.version),'SUCCESS_AND_VERSION');
  need(integer(tx.slot)&&integer(input.availableAt)&&integer(decodedAt)&&decodedAt>=input.availableAt,'AVAILABILITY');
  need(input.commitment==='confirmed'||input.commitment==='finalized','DECLARED_REQUEST_COMMITMENT');
  need(input.providerReceivedAt===null||integer(input.providerReceivedAt)&&input.providerReceivedAt<=input.availableAt,'RECEIPT_ORDER');
  need(tx.blockTime===null||integer(tx.blockTime),'CHAIN_TIME');
  need(typeof input.signature==='string'&&input.signature.length<=100&&bs58.decode(input.signature).length===64&&tx.transaction?.signatures?.[0]===input.signature,'SIGNATURE');
  need(canonicalPumpPoolPda(new PublicKey(input.mint)).toBase58()===input.pool,'CANONICAL_POOL');
  const message=tx.transaction.message;
  need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'COMPILED_MESSAGE');
  need(tx.meta.loadedAddresses===undefined||Array.isArray(tx.meta.loadedAddresses.writable)&&Array.isArray(tx.meta.loadedAddresses.readonly),'LOADED_KEYS');
  const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
  need(keys.length<=256&&keys.every(k=>typeof k==='string'&&k.length<=44&&new PublicKey(k).toBase58()===k),'KEYS');
  const address=(i:unknown)=>{need(integer(i)&&i<keys.length,'ACCOUNT_INDEX');return keys[i] as string;};
  const accounts=(ix:any)=>{need(Array.isArray(ix?.accounts)&&ix.accounts.length<=256,'ACCOUNT_LIST');return ix.accounts.map(address) as string[];};
  const signers=message.header?.numRequiredSignatures;need(integer(signers)&&signers>0&&signers<=message.accountKeys.length,'SIGNER_HEADER');
  need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'INNER_GROUPS');
  const groups=new Map<number,any[]>();
  for(const g of tx.meta.innerInstructions){need(integer(g.index)&&g.index<message.instructions.length&&!groups.has(g.index)&&Array.isArray(g.instructions)&&g.instructions.length<=512,'INNER_GROUPS');groups.set(g.index,g.instructions);}
  // Nested Boost was not present in the retained evidence. Refuse it explicitly
  // rather than mistake a protocol BuyEvent for an ordinary routed buyer.
  for(const group of groups.values())for(const ix of group){if(address(ix.programIdIndex)!==program)continue;const raw=bytes(ix);if(raw.subarray(0,8).equals(Buffer.from(definition.discriminator))&&accounts(ix).includes(input.pool))throw Error('OFFLINE_BOOST_NESTED_SHAPE_UNTESTED');}
  const result:ProtocolBuyAndBurnEvidence[]=[];
  for(let outer=0;outer<message.instructions.length;outer++){
    const ix=message.instructions[outer];if(address(ix.programIdIndex)!==program)continue;
    const raw=bytes(ix);if(!raw.subarray(0,8).equals(Buffer.from(definition.discriminator)))continue;
    const roles=accounts(ix);need(roles.length===definition.accounts.length,'ROLE_COUNT');
    const role=(name:string)=>{const i=definition.accounts.findIndex(a=>a.name===name);need(i>=0&&roles[i]!==undefined,'ROLE');return roles[i]!;};
    if(role('pool')!==input.pool&&role('base_mint')!==input.mint)continue;
    need(ix.stackHeight===1&&role('pool')===input.pool&&role('base_mint')===input.mint&&role('quote_mint')===sol,'SCOPE_OR_STACK');
    const decoded=coder.instruction.decode(raw);need(decoded?.name==='boost_buy_and_burn'&&coder.instruction.encode(decoded.name,decoded.data).equals(raw),'EXACT_INSTRUCTION_LAYOUT');
    const args=decoded.data as any,requested=decimal(args.quote_amount_in),minimum=decimal(args.min_base_amount_burned);
    need(BigInt(requested)>0n&&BigInt(minimum)>0n,'POSITIVE_AMOUNT');
    const authority=PublicKey.findProgramAddressSync([Buffer.from('boost_vault'),new PublicKey(input.pool).toBuffer()],PUMP_AMM_PROGRAM_ID)[0].toBase58();
    need(role('boost_vault_authority')===authority&&role('global_config')===globalConfig&&role('event_authority')===eventAuthority&&role('program')===program,'PDA_OR_PROGRAM');
    need(ix.accounts[1]<signers&&address(ix.accounts[1])===role('authority'),'INVOKING_AUTHORITY_SIGNER');
    need(tokenPrograms.has(role('base_token_program'))&&role('quote_token_program')==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TOKEN_PROGRAM');
    const ata=(mint:string,owner:string,tokenProgram:string)=>getAssociatedTokenAddressSync(new PublicKey(mint),new PublicKey(owner),true,new PublicKey(tokenProgram)).toBase58();
    need(role('pool_base_token_account')===ata(input.mint,input.pool,role('base_token_program'))&&role('pool_quote_token_account')===ata(sol,input.pool,role('quote_token_program'))&&role('boost_vault')===ata(sol,authority,role('quote_token_program')),'TOKEN_ACCOUNT_RELATIONSHIPS');
    const inner=groups.get(outer);need(inner?.length===4&&inner.every(i=>i.stackHeight===2),'EXACT_CHILD_SHAPE');
    const event=(i:number,name:string)=>{const e=inner[i],data=bytes(e);need(address(e.programIdIndex)===program&&accounts(e).length===1&&address(e.accounts[0])===eventAuthority&&data.subarray(0,8).equals(prefix),'EVENT_SELF_CPI');const decodedEvent=coder.events.decode(data.subarray(8).toString('base64'));need(decodedEvent?.name===name&&coder.types.encode(name,decodedEvent.data).equals(data.subarray(16)),'EXACT_EVENT_LAYOUT');return {data:decodedEvent.data as any,bytes:data};};
    const buy=event(2,'BuyEvent'),boost=event(3,'BoostBuyAndBurnEvent'),b=buy.data,p=boost.data;
    need(key(b.pool)===input.pool&&key(p.pool)===input.pool&&key(p.mint)===input.mint&&key(p.bonding_curve)===bondingCurvePda(new PublicKey(input.mint)).toBase58()&&key(p.authority)===role('authority'),'EVENT_SCOPE');
    need(key(b.user)===authority&&key(b.user_base_token_account)===system&&key(b.user_quote_token_account)===role('boost_vault')&&decimal(b.user_base_token_reserves)==='0','PROTOCOL_ACTOR');
    need(b.ix_name==='buy_exact_quote_in'&&b.track_volume===false&&b.can_boost===true,'TESTED_BUY_EVENT_SHAPE');
    const used=decimal(p.quote_amount_in_used),burned=decimal(p.base_amount_burned);
    need(decimal(p.quote_amount_in_requested)===requested&&used===requested&&decimal(b.max_quote_amount_in)===requested&&decimal(b.quote_amount_in)===used&&decimal(b.user_quote_amount_in)===used&&decimal(b.quote_amount_in_with_lp_fee)===used&&decimal(b.base_amount_out)===burned&&decimal(b.min_base_amount_out)===minimum&&BigInt(burned)>=BigInt(minimum),'PAIRED_AMOUNTS');
    const feeFields=['lp_fee_basis_points','lp_fee','protocol_fee_basis_points','protocol_fee','coin_creator_fee_basis_points','coin_creator_fee','cashback_fee_basis_points','cashback','buyback_fee_basis_points','buyback_fee','holder_rewards_bps','holder_rewards','quote_transfer_fee'];
    const fees=Object.fromEntries(feeFields.map(f=>[f,decimal(b[f])]));need(Object.values(fees).every(f=>f==='0'),'UNTESTED_NONZERO_FEES');
    need(decimal(b.timestamp,true)===decimal(p.timestamp,true)&&decimal(b.virtual_quote_reserves,true)===decimal(p.virtual_quote_reserves,true),'PAIRED_EVENT_CONTEXT');
    need(BigInt(decimal(p.real_quote_reserves_after))===BigInt(decimal(b.pool_quote_token_reserves))+BigInt(used)&&BigInt(decimal(p.base_reserves_after))===BigInt(decimal(b.pool_base_token_reserves))-BigInt(burned)&&BigInt(decimal(p.boost_vault_remaining))===BigInt(decimal(b.user_quote_token_reserves))-BigInt(used),'PAIRED_RESERVES');
    const q=inner[0],qBytes=bytes(q),qAccounts=accounts(q),burn=inner[1],burnBytes=bytes(burn),burnAccounts=accounts(burn);
    need(address(q.programIdIndex)===role('quote_token_program')&&qBytes.length===10&&qBytes[0]===12&&qBytes[9]===9&&qBytes.readBigUInt64LE(1).toString()===used&&qAccounts.length===4&&qAccounts[0]===role('boost_vault')&&qAccounts[1]===sol&&qAccounts[2]===role('pool_quote_token_account')&&qAccounts[3]===authority,'QUOTE_TRANSFER');
    need(address(burn.programIdIndex)===role('base_token_program')&&burnBytes.length===9&&burnBytes[0]===8&&burnBytes.readBigUInt64LE(1).toString()===burned&&burnAccounts.length===3&&burnAccounts[0]===role('pool_base_token_account')&&burnAccounts[1]===input.mint&&burnAccounts[2]===input.pool,'BASE_BURN');
    const identity={signature:input.signature,program,outerInstructionIndex:outer,protocolInnerInstructionIndex:null,buyEventInnerInstructionIndex:2,boostEventInnerInstructionIndex:3},identityKey=[input.signature,program,outer,'protocol-boost',2,3].join(':');
    const content={identity,mint:input.mint,pool:input.pool,actor:{kind:'protocol-boost-vault-authority' as const,authorityPda:authority,invokingAuthority:role('authority'),ordinaryBuyer:false as const},amounts:{requestedQuoteLamports:requested,usedQuoteLamports:used,burnedBaseUnits:burned,minimumBurnedBaseUnits:minimum},accounts:Object.fromEntries(definition.accounts.map((r,i)=>[r.name,roles[i]!])),fees,transfers:{quote:{innerInstructionIndex:0,amount:used,source:qAccounts[0]!,mint:sol,destination:qAccounts[2]!,authority,decimals:9 as const},burn:{innerInstructionIndex:1,amount:burned,source:burnAccounts[0]!,mint:input.mint,authority:input.pool}},events:{buyEventSha256:createHash('sha256').update(buy.bytes).digest('hex'),boostEventSha256:createHash('sha256').update(boost.bytes).digest('hex'),eventTimestamp:decimal(p.timestamp,true),virtualQuoteReserves:decimal(p.virtual_quote_reserves,true),realQuoteReservesAfter:decimal(p.real_quote_reserves_after),baseReservesAfter:decimal(p.base_reserves_after),boostVaultRemaining:decimal(p.boost_vault_remaining)},slot:tx.slot as number};
    result.push({...content,version:'pump-boost-offline-v1-unadopted',mode:'OFFLINE_EVIDENCE_COMPONENT',classification:'protocol-buy-and-burn',identityKey,chainBlockTime:tx.blockTime,commitment:input.commitment,providerReceivedAt:input.providerReceivedAt,recordedRpcAvailableAt:input.availableAt,offlineDecodedAt:decodedAt,fingerprint:digest(content),normalizedForStrategy:false,transactionCompleteness:'NOT_ESTABLISHED_BY_THIS_COMPONENT',limitations:['Offline decoder only; old unsupported-window results remain unchanged.','Boost-vault debit is verified; historical fee funding provenance was not traced.','No ordinary buyer, user token transfer or strategy flow is inferred.','Only exact top-level four-child zero-fee Boost shapes have retained real evidence.','Event timestamp, RPC block time, recorded RPC availability and offline decoding time remain distinct.','Protocol price effects, actor/amount convention and complete mixed-window coverage require a separately versioned integration.']});
  }
  return result;
}
