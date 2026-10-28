/** Narrow compiled proof for the separately observed drained boost-vault cleanup.
 * This validates a supplied successful transaction; it never fetches, builds or
 * submits one. Logs alone cannot authorize the additional token instruction. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import BN from 'bn.js';
import bs58 from 'bs58';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import {PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {canonicalPumpPoolPda,PUMP_AMM_PROGRAM_ID,GLOBAL_CONFIG_PDA} from './sdk.js';

const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
const PROGRAM=PUMP_AMM_PROGRAM_ID.toBase58(),CLASSIC=TOKEN_PROGRAM_ID.toBase58(),TOKEN2022=TOKEN_2022_PROGRAM_ID.toBase58(),SOL=NATIVE_MINT.toBase58();
const EVENT_PREFIX=Buffer.from('e445a52e51cb9a1d','hex');
const EVENT_AUTHORITY=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
const definition=idl.instructions.find(i=>i.name==='boost_buy_and_burn')!;
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
function need(v:unknown,reason:string):asserts v {if(!v)throw Error('BOOST_CLEANUP_'+reason);}
const uint=(v:unknown)=>{need(BN.isBN(v),'EVENT_INTEGER');const s=v.toString(10);need(/^(0|[1-9][0-9]*)$/.test(s),'EVENT_INTEGER');return s;};
const eventKey=(v:any)=>{need(v&&typeof v.toBase58==='function','EVENT_KEY');return v.toBase58() as string;};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export type BoostVaultCleanupInput={signature:string;slot:number;pool:string;mint:string;logs:readonly string[]};
export type VerifiedBoostVaultCleanup={
 version:'compiled-drained-boost-vault-cleanup-v1';signature:string;slot:number;pool:string;mint:string;
 logsSha256:string;rawNotificationSha256:string;transactionSha256:string;
 outerInstructionIndex:number;transferInnerInstructionIndex:0;burnInnerInstructionIndex:1;
 buyEventInnerInstructionIndex:2;boostEventInnerInstructionIndex:3;closeInnerInstructionIndex:4;
 instructionAuthority:string;boostActor:string;boostVault:string;closeDestination:string;baseTokenProgram:string;quoteTokenProgram:string;
 quoteLamports:string;baseUnits:string;minimumBaseUnits:string;boostRemaining:'0';reclaimedAccountLamports:string;
 buyEventBytesSha256:string;boostEventBytesSha256:string;transferChecks:{quoteTransfer:true;baseBurn:true;drainedVaultClose:true};
 ordinaryBuyer:false;normalizedForStrategy:false;
};

export function verifyBoostVaultCleanupTransaction(value:unknown,input:BoostVaultCleanupInput):VerifiedBoostVaultCleanup{
 need(value&&typeof value==='object'&&!Array.isArray(value),'TRANSACTION');const tx=value as any,transactionJson=JSON.stringify(tx);need(Buffer.byteLength(transactionJson)<=2*1024*1024,'TRANSACTION_SIZE');
 need(typeof input.signature==='string'&&bs58.decode(input.signature).length===64&&integer(input.slot),'IDENTITY');
 need(Array.isArray(input.logs)&&input.logs.length<=4096&&input.logs.every(l=>typeof l==='string')&&Buffer.byteLength(JSON.stringify(input.logs))<=512*1024,'LOG_BOUNDS');
 need(tx.meta?.err===null&&['legacy',0,1].includes(tx.version)&&tx.slot===input.slot&&tx.transaction?.signatures?.[0]===input.signature,'SUCCESS_IDENTITY');
 need(JSON.stringify(tx.meta.logMessages)===JSON.stringify(input.logs),'LOG_BINDING');
 need(canonicalPumpPoolPda(new PublicKey(input.mint)).toBase58()===input.pool,'CANONICAL_POOL');
 const message=tx.transaction.message;
 need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'MESSAGE');
 need(tx.meta.loadedAddresses===undefined||Array.isArray(tx.meta.loadedAddresses.writable)&&Array.isArray(tx.meta.loadedAddresses.readonly),'LOADED_KEYS');
 const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
 need(keys.length<=256&&keys.every(k=>typeof k==='string'),'KEYS');
 const address=(i:unknown)=>{need(integer(i)&&i<keys.length,'ACCOUNT_INDEX');return keys[i] as string;};
 const raw=(ix:any)=>{need(typeof ix?.data==='string'&&ix.data.length<=4096,'INSTRUCTION_BYTES');const b=Buffer.from(bs58.decode(ix.data));need(b.length<=4096,'INSTRUCTION_BYTES');return b;};
 const accounts=(ix:any)=>{need(Array.isArray(ix.accounts)&&ix.accounts.length<=256,'INSTRUCTION_ACCOUNTS');return ix.accounts.map(address) as string[];};
 const selected:Array<{index:number;ix:any;args:any;roles:Record<string,string>}>=[];
 for(let index=0;index<message.instructions.length;index++){
  const ix=message.instructions[index];if(address(ix.programIdIndex)!==PROGRAM)continue;const b=raw(ix);
  if(!b.subarray(0,8).equals(Buffer.from(definition.discriminator)))continue;
  const aa=accounts(ix);need(aa.length===definition.accounts.length,'ROOT_ACCOUNTS');
  const roles=Object.fromEntries(definition.accounts.map((a,i)=>[a.name,aa[i]!])) as Record<string,string>;
  if(roles.pool!==input.pool)continue;
  const decoded=coder.instruction.decode(b);need(decoded?.name==='boost_buy_and_burn'&&coder.instruction.encode(decoded.name,decoded.data).equals(b),'ROOT_LAYOUT');
  need(ix.stackHeight===undefined||ix.stackHeight===1,'ROOT_DEPTH');selected.push({index,ix,args:decoded.data,roles});
 }
 need(selected.length===1,'UNIQUE_ROOT');const root=selected[0]!,r=root.roles;
 const actor=PublicKey.findProgramAddressSync([Buffer.from('boost_vault'),new PublicKey(input.pool).toBuffer()],PUMP_AMM_PROGRAM_ID)[0].toBase58();
 const vault=getAssociatedTokenAddressSync(NATIVE_MINT,new PublicKey(actor),true,TOKEN_PROGRAM_ID).toBase58();
 need(r.pool===input.pool&&r.base_mint===input.mint&&r.quote_mint===SOL&&r.base_token_program===TOKEN2022&&r.quote_token_program===CLASSIC,'POOL_ROLES');
 need(r.global_config===GLOBAL_CONFIG_PDA.toBase58()&&r.event_authority===EVENT_AUTHORITY&&r.program===PROGRAM,'PROGRAM_ROLES');
 need(r.boost_vault_authority===actor&&r.boost_vault===vault,'BOOST_ROLES');
 // The exact recovered account-lamport amount is only attributable when no
 // other outer instruction can pass this vault into another CPI. A native SOL
 // deposit without SyncNative would otherwise leave token balances unchanged.
 need(message.instructions.every((ix:any,index:number)=>index===root.index||!accounts(ix).includes(vault)),'VAULT_ACCESSED_OUTSIDE_ROOT');
 need(r.pool_base_token_account===getAssociatedTokenAddressSync(new PublicKey(input.mint),new PublicKey(input.pool),true,TOKEN_2022_PROGRAM_ID).toBase58()&&r.pool_quote_token_account===getAssociatedTokenAddressSync(NATIVE_MINT,new PublicKey(input.pool),true,TOKEN_PROGRAM_ID).toBase58(),'VAULT_ROLES');
 need(integer(message.header?.numRequiredSignatures)&&message.header.numRequiredSignatures>0&&message.header.numRequiredSignatures<=message.accountKeys.length&&message.accountKeys.slice(0,message.header.numRequiredSignatures).includes(r.authority),'AUTHORITY_SIGNER');
 need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'INNER_GROUPS');const groups=new Set<number>();let group:any;
 for(const g of tx.meta.innerInstructions){need(integer(g.index)&&g.index<message.instructions.length&&!groups.has(g.index)&&Array.isArray(g.instructions)&&g.instructions.length<=512,'INNER_GROUP');groups.add(g.index);if(g.index===root.index)group=g.instructions;}
 need(Array.isArray(group)&&group.length===5&&group.every((ix:any)=>ix.stackHeight===2),'FIVE_DIRECT_CHILDREN');
 const quote=raw(group[0]),burn=raw(group[1]),close=raw(group[4]);
 need(address(group[0].programIdIndex)===CLASSIC&&quote.length===10&&quote[0]===12&&quote[9]===9&&JSON.stringify(accounts(group[0]))===JSON.stringify([vault,SOL,r.pool_quote_token_account,actor]),'QUOTE_TRANSFER');
 need(address(group[1].programIdIndex)===TOKEN2022&&burn.length===9&&burn[0]===8&&JSON.stringify(accounts(group[1]))===JSON.stringify([r.pool_base_token_account,input.mint,input.pool]),'BASE_BURN');
 need(address(group[4].programIdIndex)===CLASSIC&&close.length===1&&close[0]===9&&JSON.stringify(accounts(group[4]))===JSON.stringify([vault,r.authority,actor]),'EXACT_DRAINED_CLOSE');
 function eventAt(index:number,name:string){const ix=group[index],b=raw(ix);need(address(ix.programIdIndex)===PROGRAM&&JSON.stringify(accounts(ix))===JSON.stringify([EVENT_AUTHORITY])&&b.subarray(0,8).equals(EVENT_PREFIX),'EVENT_CPI');const encoded=b.subarray(8).toString('base64'),event=coder.events.decode(encoded);need(event?.name===name&&coder.types.encode(name,event.data).equals(b.subarray(16)),'EVENT_LAYOUT');need(input.logs.filter(l=>l==='Program data: '+encoded).length===1,'EVENT_LOG_IDENTITY');return {data:event.data as any,bytes:b.subarray(8)};}
 const buy=eventAt(2,'BuyEvent'),boost=eventAt(3,'BoostBuyAndBurnEvent'),e=buy.data,b=boost.data;
 const quoteLamports=quote.readBigUInt64LE(1).toString(),baseUnits=burn.readBigUInt64LE(1).toString(),minimumBaseUnits=uint(root.args.min_base_amount_burned);
 need(BigInt(quoteLamports)>0n&&BigInt(baseUnits)>0n&&BigInt(minimumBaseUnits)>0n&&BigInt(baseUnits)>=BigInt(minimumBaseUnits)&&uint(root.args.quote_amount_in)===quoteLamports,'ROOT_AMOUNTS');
 need(eventKey(e.pool)===input.pool&&eventKey(b.pool)===input.pool&&eventKey(b.mint)===input.mint&&eventKey(b.authority)===r.authority,'EVENT_SCOPE');
 need(eventKey(e.user)===actor&&eventKey(e.user_quote_token_account)===vault&&eventKey(e.user_base_token_account)===PublicKey.default.toBase58()&&uint(e.user_base_token_reserves)==='0','EVENT_ACTOR');
 need(e.ix_name==='buy_exact_quote_in'&&e.track_volume===false&&e.can_boost===true&&eventKey(e.protocol_fee_recipient)===PublicKey.default.toBase58()&&eventKey(e.protocol_fee_recipient_token_account)===PublicKey.default.toBase58(),'EVENT_CONVENTION');
 need(['lp_fee','protocol_fee','coin_creator_fee','cashback','buyback_fee','holder_rewards','quote_transfer_fee','lp_fee_basis_points','protocol_fee_basis_points','coin_creator_fee_basis_points','cashback_fee_basis_points','buyback_fee_basis_points','holder_rewards_bps'].every(k=>uint(e[k])==='0'),'ZERO_FEES');
 need(['max_quote_amount_in','quote_amount_in','quote_amount_in_with_lp_fee','user_quote_amount_in'].every(k=>uint(e[k])===quoteLamports)&&['quote_amount_in_requested','quote_amount_in_used'].every(k=>uint(b[k])===quoteLamports)&&uint(e.base_amount_out)===baseUnits&&uint(b.base_amount_burned)===baseUnits&&uint(e.min_base_amount_out)===minimumBaseUnits,'EVENT_AMOUNTS');
 need(uint(e.timestamp)===uint(b.timestamp)&&uint(e.virtual_quote_reserves)===uint(b.virtual_quote_reserves)&&uint(b.boost_vault_remaining)==='0','EVENT_TIME_DRAINED');
 need(BigInt(uint(e.pool_base_token_reserves))-BigInt(uint(b.base_reserves_after))===BigInt(baseUnits)&&BigInt(uint(b.real_quote_reserves_after))-BigInt(uint(e.pool_quote_token_reserves))===BigInt(quoteLamports)&&BigInt(uint(e.user_quote_token_reserves))===BigInt(quoteLamports),'EVENT_RESERVES');
 const index=(key:string)=>keys.indexOf(key),tokenBalance=(rows:unknown,key:string,owner:string,mint:string,program:string)=>{need(Array.isArray(rows),'TOKEN_BALANCES');const matches=rows.filter((x:any)=>x.accountIndex===index(key));need(matches.length===1,'TOKEN_BALANCE_IDENTITY');const x=matches[0];need(x.owner===owner&&x.mint===mint&&x.programId===program&&/^(0|[1-9][0-9]*)$/.test(x.uiTokenAmount?.amount),'TOKEN_BALANCE_ROLES');return x.uiTokenAmount.amount as string;};
 need(tokenBalance(tx.meta.preTokenBalances,r.pool_base_token_account!,input.pool,input.mint,TOKEN2022)===uint(e.pool_base_token_reserves)&&tokenBalance(tx.meta.postTokenBalances,r.pool_base_token_account!,input.pool,input.mint,TOKEN2022)===uint(b.base_reserves_after),'BASE_BALANCES');
 need(tokenBalance(tx.meta.preTokenBalances,r.pool_quote_token_account!,input.pool,SOL,CLASSIC)===uint(e.pool_quote_token_reserves)&&tokenBalance(tx.meta.postTokenBalances,r.pool_quote_token_account!,input.pool,SOL,CLASSIC)===uint(b.real_quote_reserves_after),'QUOTE_BALANCES');
 need(tokenBalance(tx.meta.preTokenBalances,vault,actor,SOL,CLASSIC)===quoteLamports&&Array.isArray(tx.meta.postTokenBalances)&&!tx.meta.postTokenBalances.some((x:any)=>x.accountIndex===index(vault)),'BOOST_BALANCES');
 need(Array.isArray(tx.meta.preBalances)&&Array.isArray(tx.meta.postBalances)&&tx.meta.preBalances.length===keys.length&&tx.meta.postBalances.length===keys.length&&integer(tx.meta.preBalances[index(vault)])&&tx.meta.postBalances[index(vault)]===0,'CLOSED_ACCOUNT_BALANCES');
 const reclaimed=BigInt(tx.meta.preBalances[index(vault)])-BigInt(quoteLamports);need(reclaimed>0n,'CLOSE_RECLAIM');
 return Object.freeze({version:'compiled-drained-boost-vault-cleanup-v1',signature:input.signature,slot:input.slot,pool:input.pool,mint:input.mint,logsSha256:hash(JSON.stringify(input.logs)),rawNotificationSha256:hash(JSON.stringify({signature:input.signature,slot:input.slot,err:null,logs:input.logs})),transactionSha256:hash(transactionJson),outerInstructionIndex:root.index,transferInnerInstructionIndex:0,burnInnerInstructionIndex:1,buyEventInnerInstructionIndex:2,boostEventInnerInstructionIndex:3,closeInnerInstructionIndex:4,instructionAuthority:r.authority!,boostActor:actor,boostVault:vault,closeDestination:r.authority!,baseTokenProgram:TOKEN2022,quoteTokenProgram:CLASSIC,quoteLamports,baseUnits,minimumBaseUnits,boostRemaining:'0',reclaimedAccountLamports:reclaimed.toString(),buyEventBytesSha256:hash(buy.bytes),boostEventBytesSha256:hash(boost.bytes),transferChecks:Object.freeze({quoteTransfer:true as const,baseBurn:true as const,drainedVaultClose:true as const}),ordinaryBuyer:false,normalizedForStrategy:false});
}
