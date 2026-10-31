/** Minimum passive program-event binding. Prices, executable reserves, fees,
 * account costs and financial approval remain the full quote decoder's work. */
import {PublicKey,type AccountInfo} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,MintLayout,ExtensionType,unpackMint,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_AMM_PROGRAM_ID,PUMP_AMM_SDK,type Pool} from './sdk.js';
import {assertCanonicalPumpPoolIdentity,checkMintExtensions,type PoolWireAccount} from './pool.js';

export type NativeObservationBindingSummary={
 pool:string;mint:string;slot:number;commitment:'confirmed';requestedAt:string;receivedAt:string;tokenProgram:string;
 mode:'OBSERVATION_BINDING_ONLY';financialSupportVerified:false;
};
export type NativeObservationBinding={pool:Pool;summary:NativeObservationBindingSummary;dependencyHints:{baseVault:string;quoteVault:string}};
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
function need(value:unknown,reason:string):asserts value{if(!value)throw Error(reason);}
function account(wire:PoolWireAccount|null|undefined):AccountInfo<Buffer>{
 need(wire&&wire.executable===false&&Array.isArray(wire.data)&&wire.data.length===2&&typeof wire.data[0]==='string'&&wire.data[1]==='base64','NATIVE_OBSERVATION_ACCOUNT_ENCODING');
 const data=Buffer.from(wire.data[0],'base64');need(data.length>0&&data.toString('base64')===wire.data[0],'NATIVE_OBSERVATION_ACCOUNT_ENCODING');
 return {...wire,data,owner:new PublicKey(wire.owner)};
}
function supportedMintLayout(raw:Buffer,tlv:Buffer,program:PublicKey){
 // COption discriminants and initialization are layout/interpretation facts.
 // A non-null mint or freeze authority is a financial eligibility concern,
 // not evidence that an actual program event cannot be observed faithfully.
 need(raw.length>=MintLayout.span&&[0,1].includes(raw.readUInt32LE(0))&&[0,1].includes(raw.readUInt32LE(46)),'NATIVE_OBSERVATION_MINT_LAYOUT');
 need(raw[45]===1,'NATIVE_OBSERVATION_MINT_UNINITIALIZED');
 if(program.equals(TOKEN_PROGRAM_ID))need(raw.length===MintLayout.span,'NATIVE_OBSERVATION_LEGACY_MINT_LAYOUT');
 const types:ExtensionType[]=[];
 for(let offset=0;offset<tlv.length;){
  // Unallocated trailing extension space carries no transfer semantics.
  if(tlv.subarray(offset).every(byte=>byte===0))break;
  need(offset+4<=tlv.length,'NATIVE_OBSERVATION_MINT_TLV_LAYOUT');
  const type=tlv.readUInt16LE(offset),length=tlv.readUInt16LE(offset+2);
  need(offset+4+length<=tlv.length&&!types.includes(type),'NATIVE_OBSERVATION_MINT_TLV_LAYOUT');
  types.push(type);offset+=4+length;
 }
 // Metadata extensions do not change token movement. Transfer fees/hooks,
 // delegates, non-transferable or unknown semantics need explicit modeling.
 checkMintExtensions(types);
}

/** The caller obtains both accounts and Clock in one confirmed RPC batch,
 * validates that common Clock once, and rechecks age/admission after recording.
 * This pure decoder never requests vault balances, fee/config accounts, rent,
 * transaction history, prices, or a test buy/sell. Returned Pool fields are
 * decoded ABI data; only identity and address links are validated here. */
export function decodeNativeObservationBinding(mint:PublicKey,key:PublicKey,values:readonly [PoolWireAccount|null,PoolWireAccount|null],context:{slot:number},requestedAt:string,receivedAt:string,at=Date.now()):NativeObservationBinding{
 const requested=Date.parse(requestedAt),received=Date.parse(receivedAt);
 need(integer(at)&&integer(context?.slot)&&integer(requested)&&integer(received)&&requested<=received&&received<=at&&at-received<=2000,'NATIVE_OBSERVATION_SOURCE_CONTEXT');
 need(Array.isArray(values)&&values.length===2,'NATIVE_OBSERVATION_ACCOUNT_COUNT');
 const [poolWire,mintWire]=values;
 need(poolWire?.owner===PUMP_AMM_PROGRAM_ID.toBase58(),'BAD_POOL_OWNER');
 need(mintWire&&(mintWire.owner===TOKEN_PROGRAM_ID.toBase58()||mintWire.owner===TOKEN_2022_PROGRAM_ID.toBase58()),'UNSUPPORTED_TOKEN_PROGRAM');
 const poolInfo=account(poolWire),mintInfo=account(mintWire),pool=PUMP_AMM_SDK.decodePool(poolInfo);
 assertCanonicalPumpPoolIdentity(pool,mint,key);
 const baseMint=unpackMint(mint,mintInfo,mintInfo.owner);supportedMintLayout(mintInfo.data,baseMint.tlvData,mintInfo.owner);
 need(baseMint.isInitialized,'NATIVE_OBSERVATION_MINT_UNINITIALIZED');
 const baseVault=getAssociatedTokenAddressSync(mint,key,true,mintInfo.owner),quoteVault=getAssociatedTokenAddressSync(NATIVE_MINT,key,true,TOKEN_PROGRAM_ID);
 need(pool.poolBaseTokenAccount.equals(baseVault)&&pool.poolQuoteTokenAccount.equals(quoteVault),'BAD_VAULT_ADDRESS');
 return {pool,summary:{pool:key.toBase58(),mint:mint.toBase58(),slot:context.slot,commitment:'confirmed',requestedAt,receivedAt,tokenProgram:mintInfo.owner.toBase58(),mode:'OBSERVATION_BINDING_ONLY',financialSupportVerified:false},dependencyHints:{baseVault:baseVault.toBase58(),quoteVault:quoteVault.toBase58()}};
}
