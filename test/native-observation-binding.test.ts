/** Retained real pool/mint bytes with synthetic mutations and timing. No RPC,
 * financial account, observed market performance, or executable claim. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PublicKey} from '@solana/web3.js';
import {ExtensionType,NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PUMP_AMM_SDK,type Pool} from '../src/sdk.js';
import {decodeSupportedPoolAccounts,type PoolWireAccount} from '../src/pool.js';
import {decodeNativeObservationBinding} from '../src/native-observation-binding.js';

const run='2026-10-26T23-32-41.255Z';
const proof=JSON.parse(readFileSync(`evidence/integration-proof-${run}.json`,'utf8'));
const retained=readFileSync(`evidence/integration-${run}.ndjson`,'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(row=>row.kind==='pool-state').data;
const name=(n:number)=>new PublicKey(Buffer.alloc(32,n));
function info(wire:PoolWireAccount){return {...wire,owner:new PublicKey(wire.owner),data:Buffer.from(wire.data[0],'base64')};}
function fixture(){
 const values=structuredClone(retained.value)as Array<PoolWireAccount|null>,mint=new PublicKey(proof.quote.mint),key=new PublicKey(proof.quote.pool),at=Date.parse(proof.quote.validatedAt),requestedAt=new Date(at-10).toISOString(),receivedAt=new Date(at-1).toISOString(),context={slot:retained.context.slot};
 const first=PUMP_AMM_SDK.decodePool(info(values[0]!));
 const observe=()=>decodeNativeObservationBinding(mint,key,[values[0]!,values[3]!],context,requestedAt,receivedAt,at);
 const financial=()=>decodeSupportedPoolAccounts(mint,key,first,values,context,requestedAt,receivedAt);
 const changeMint=(fn:(bytes:Buffer)=>void)=>{const bytes=Buffer.from(values[3]!.data[0],'base64');fn(bytes);values[3]!.data[0]=bytes.toString('base64');};
 const changePool=async(patch:Partial<Pool>)=>{const decoded=PUMP_AMM_SDK.decodePool(info(values[0]!)),data=await (PUMP_AMM_SDK as any).offlineProgram.coder.accounts.encode('pool',{...decoded,...patch});values[0]!.data[0]=data.toString('base64');};
 return {values,mint,key,at,requestedAt,receivedAt,context,first,observe,financial,changeMint,changePool};
}

test('passive binding validates actual canonical identity and token program with no quote fields or financial approval',()=>{
 const f=fixture(),before=structuredClone(f.values),bound=f.observe();assert.ok(f.financial());
 assert.equal(bound.summary.mode,'OBSERVATION_BINDING_ONLY');assert.equal(bound.summary.financialSupportVerified,false);
 assert.equal(bound.summary.mint,f.mint.toBase58());assert.equal(bound.summary.pool,f.key.toBase58());assert.equal(bound.summary.tokenProgram,TOKEN_2022_PROGRAM_ID.toBase58());assert.equal(bound.summary.slot,f.context.slot);assert.equal(bound.summary.commitment,'confirmed');
 assert.deepEqual(bound.dependencyHints,{baseVault:f.first.poolBaseTokenAccount.toBase58(),quoteVault:f.first.poolQuoteTokenAccount.toBase58()});
 for(const field of ['feeBps','rawBaseReserve','rawQuoteReserve','effectiveQuoteReserve','buy','sell','supply','decimals','baseAssociatedAccount','quoteAssociatedAccount','migrationSlot','migrationAt'])assert.equal(Object.hasOwn(bound.summary,field),false,field+' is not passive binding evidence');
 assert.deepEqual(f.values,before);
});

test('missing fee/config, native-mint or vault balances cannot block observation while financial decoding still refuses',()=>{
 for(const index of [1,2,4,5,6]){
  const f=fixture();f.values[index]=null;const bound=f.observe();assert.equal(bound.summary.financialSupportVerified,false);assert.throws(f.financial,Error,'financial decoder still requires account '+index);
 }
 for(const index of [1,2,4,5,6]){
  const f=fixture();f.values[index]!.data=['AA==','base64'];assert.ok(f.observe());assert.throws(f.financial,Error,'financial decoder still validates account '+index);
 }
 const zero=fixture(),base=Buffer.from(zero.values[5]!.data[0],'base64');base.writeBigUInt64LE(0n,64);zero.values[5]!.data[0]=base.toString('base64');assert.ok(zero.observe());assert.throws(zero.financial,/NONPOSITIVE_EFFECTIVE_RESERVES/);
});

test('mint/freeze authorities and disabled quote instructions do not invalidate faithful passive binding',async()=>{
 for(const authority of ['mint','freeze']as const){
  const f=fixture();f.changeMint(bytes=>{const offset=authority==='mint'?0:46;bytes.writeUInt32LE(1,offset);name(51).toBuffer().copy(bytes,offset+4);});
  assert.ok(f.observe());assert.throws(f.financial,/UNSAFE_OR_UNINITIALIZED_MINT/);
 }
 const disabled=fixture(),wire=disabled.values[1]!,config=PUMP_AMM_SDK.decodeGlobalConfig(info(wire));
 const bytes=await (PUMP_AMM_SDK as any).offlineProgram.coder.accounts.encode('globalConfig',{...config,disableFlags:1});wire.data[0]=bytes.toString('base64');
 assert.ok(disabled.observe());assert.throws(disabled.financial,/POOL_PROGRAM_DISABLED_FLAGS/);
 const mode=fixture();await mode.changePool({isMayhemMode:true,isCashbackCoin:true,isHolderReward:true});assert.ok(mode.observe());assert.equal(Object.hasOwn(mode.observe().summary,'poolFlags'),false,'mode flags are not observation acceptance or financial approval');
});

test('fresh actual mint program determines canonical vault links for both legacy and Token-2022 layouts',async()=>{
 const f=fixture();f.values[3]!.owner=TOKEN_PROGRAM_ID.toBase58();f.values[3]!.data[0]=Buffer.from(f.values[3]!.data[0],'base64').subarray(0,82).toString('base64');
 const legacyBase=getAssociatedTokenAddressSync(f.mint,f.key,true,TOKEN_PROGRAM_ID);await f.changePool({poolBaseTokenAccount:legacyBase});
 const bound=f.observe();assert.equal(bound.summary.tokenProgram,TOKEN_PROGRAM_ID.toBase58());assert.equal(bound.dependencyHints.baseVault,legacyBase.toBase58());assert.equal(bound.dependencyHints.quoteVault,getAssociatedTokenAddressSync(NATIVE_MINT,f.key,true,TOKEN_PROGRAM_ID).toBase58());
 f.values[3]!.owner=TOKEN_2022_PROGRAM_ID.toBase58();assert.throws(f.observe,/BAD_VAULT_ADDRESS/,'an old owner/address hint cannot override the actual current mint owner');
});

test('wrong pool program, canonical mint/index/creator/LP or vault links are always refused',async()=>{
 for(const patch of [{index:1},{baseMint:name(50)},{quoteMint:name(51)},{creator:name(52)},{lpMint:name(53)},{poolBaseTokenAccount:name(54)},{poolQuoteTokenAccount:name(55)}]){
  const f=fixture();await f.changePool(patch);assert.throws(f.observe);
 }
 const f=fixture();f.values[0]!.owner=TOKEN_PROGRAM_ID.toBase58();assert.throws(f.observe,/BAD_POOL_OWNER/);
 const wrongKey=fixture();assert.throws(()=>decodeNativeObservationBinding(wrongKey.mint,name(56),[wrongKey.values[0]!,wrongKey.values[3]!],wrongKey.context,wrongKey.requestedAt,wrongKey.receivedAt,wrongKey.at),/BAD_POOL_IDENTITY/);
});

test('an absent canonical pool is distinguished from an existing wrong-owner pool without admitting either',()=>{
 const f=fixture();assert.throws(()=>decodeNativeObservationBinding(f.mint,f.key,[null,f.values[3]!],f.context,f.requestedAt,f.receivedAt,f.at),/^Error: NATIVE_OBSERVATION_POOL_MISSING$/);
 const wrong=fixture();wrong.values[0]!.owner=TOKEN_PROGRAM_ID.toBase58();assert.throws(wrong.observe,/^Error: BAD_POOL_OWNER$/);
 assert.equal(Object.hasOwn(f.observe().summary,'financialQuote'),false);
});

test('unsupported transfer semantics and malformed or uninitialized mint layout are refused',()=>{
 for(const extension of [ExtensionType.TransferFeeConfig,ExtensionType.TransferHook,ExtensionType.PermanentDelegate,ExtensionType.NonTransferable]){
  const f=fixture();f.changeMint(bytes=>bytes.writeUInt16LE(extension,166));assert.throws(f.observe,/UNMODELED_BASE_EXTENSION/);
 }
 const uninitialized=fixture();uninitialized.changeMint(bytes=>{bytes[45]=0;});assert.throws(uninitialized.observe,/MINT_UNINITIALIZED/);
 for(const offset of [0,46]){const f=fixture();f.changeMint(bytes=>bytes.writeUInt32LE(2,offset));assert.throws(f.observe,/MINT_LAYOUT/);}
 const owner=fixture();owner.values[3]!.owner=name(57).toBase58();assert.throws(owner.observe,/UNSUPPORTED_TOKEN_PROGRAM/);
 const short=fixture();short.values[3]!.data[0]=Buffer.alloc(20).toString('base64');assert.throws(short.observe);
 const accountType=fixture();accountType.changeMint(bytes=>{bytes[165]=2;});assert.throws(accountType.observe);
 const truncatedTlv=fixture();truncatedTlv.changeMint(bytes=>bytes.writeUInt16LE(65535,168));assert.throws(truncatedTlv.observe,/MINT_TLV_LAYOUT/);
 const duplicateTlv=fixture();duplicateTlv.changeMint(bytes=>bytes.writeUInt16LE(ExtensionType.MetadataPointer,234));assert.throws(duplicateTlv.observe,/MINT_TLV_LAYOUT/);
});

test('malformed wire bytes, executable accounts and invalid local context cannot become fresh binding evidence',()=>{
 for(const index of [0,3])for(const mutate of [
  (wire:PoolWireAccount)=>{wire.executable=true;},
  (wire:PoolWireAccount)=>{wire.data[1]='base58';},
  (wire:PoolWireAccount)=>{wire.data[0]+='!';},
  (wire:PoolWireAccount)=>{wire.data[0]='';}
 ]){const f=fixture();mutate(f.values[index]!);assert.throws(f.observe,/NATIVE_OBSERVATION_ACCOUNT_ENCODING/);}
 const f=fixture();for(const patch of [{slot:-1},{slot:1.5},{slot:NaN}])assert.throws(()=>decodeNativeObservationBinding(f.mint,f.key,[f.values[0]!,f.values[3]!],patch,f.requestedAt,f.receivedAt,f.at),/SOURCE_CONTEXT/);
 for(const [requested,received,now]of [[f.at+1,f.at+2,f.at],[f.at,f.at-1,f.at],[f.at-4000,f.at-3000,f.at]])assert.throws(()=>decodeNativeObservationBinding(f.mint,f.key,[f.values[0]!,f.values[3]!],f.context,new Date(requested!).toISOString(),new Date(received!).toISOString(),now),/SOURCE_CONTEXT/);
 assert.throws(()=>decodeNativeObservationBinding(f.mint,f.key,[f.values[0]!,f.values[3]!],f.context,'invalid',f.receivedAt,f.at),/SOURCE_CONTEXT/);
});
