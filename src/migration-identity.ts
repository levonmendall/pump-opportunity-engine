/** Pure identity extraction from one already obtained confirmed transaction.
 * Feed mint roles are hints. Current pool/mint/vault/fee/extension validation
 * remains mandatory before quoting or admission. No provider or wallet client.
 */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {NATIVE_MINT,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {canonicalPumpPoolPda,pumpPoolAuthorityPda,lpMintPda,PUMP_AMM_PROGRAM_ID,PUMP_PROGRAM_ID} from './sdk.js';

const require=createRequire(import.meta.url);
const idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl;
const coder=new BorshCoder(idl),PUMP=PUMP_PROGRAM_ID.toBase58(),AMM=PUMP_AMM_PROGRAM_ID.toBase58();
const EVENT_PREFIX=Buffer.from('e445a52e51cb9a1d','hex');
const AUTHORITY=PublicKey.findProgramAddressSync([Buffer.from('__event_authority')],PUMP_AMM_PROGRAM_ID)[0].toBase58();
const migrationNames=new Map(['migrate','migrate_v2'].map(name=>[createHash('sha256').update('global:'+name).digest().subarray(0,8).toString('hex'),name]));
type Position={outerInstructionIndex:number;innerInstructionIndex:number|null;stackHeight:number};
type Frame={ix:any;position:Position;program:string;migrationName?:string;creation?:Creation};
type Creation={position:Position;migration:Position&{name:string};roles:Record<string,string>;index:number;event?:{position:Position;data:any}};
export type MigrationIdentityInput={signature:string;feedMint?:string;commitment:'confirmed'|'finalized';availableAt:number};
export type MigrationIdentity={
  classification:'SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT'|'EXCLUDED_CUSTOM_QUOTE'|'EXCLUDED_TOKEN_PROGRAM';
  reason:'CUSTOM_QUOTE_OUTSIDE_SCOPE'|'TOKEN_PROGRAM_OUTSIDE_SCOPE'|null;
  signature:string;slot:number;chainBlockTime:number;commitment:'confirmed'|'finalized';availableAt:number;
  confirmationProvenance:'caller-declared-RPC-request-commitment';
  pool:string;baseMint:string;quoteMint:string;creator:string;lpMint:string;baseVault:string;quoteVault:string;
  baseTokenProgram:string;quoteTokenProgram:string;feedHintRole:'base'|'quote'|'other'|'missing';
  migration:Position&{name:string};creation:Position;event:Position&{name:'CreatePoolEvent';exactPackagedLayout:true};
  proof:{canonicalActualQuotePda:true;index:0;pumpCreatorAuthority:true;canonicalLpMint:true;eventRoleAgreement:true;eventAuthority:true;sdk:'@pump-fun/pump-swap-sdk@2.2.0'};
  currentPoolStateVerified:false;currentMintVaultFeeAndExtensionSupportVerified:false;entryEligibilityVerified:false;
};
export type MigrationIdentityResult={ok:true;identity:MigrationIdentity}|{ok:false;reason:string};
function need(v:unknown,reason:string):asserts v {if(!v)throw Error('MIGRATION_IDENTITY_'+reason);}
function bytes(ix:any){need(typeof ix?.data==='string'&&ix.data.length<=4096,'INSTRUCTION_BYTES');try{return Buffer.from(bs58.decode(ix.data));}catch{throw Error('MIGRATION_IDENTITY_INSTRUCTION_BYTES');}}
function publicKey(value:unknown){need(typeof value==='string'&&value.length<=44,'ACCOUNT_KEY');try{return new PublicKey(value);}catch{throw Error('MIGRATION_IDENTITY_ACCOUNT_KEY');}}

/** Returns exactly one unambiguous creation under a genuine migrate/migrate_v2
 * invocation and its self-CPI CreatePoolEvent. Other transaction instructions
 * are not promoted into migration evidence merely by sharing an outer index.
 */
export function decodeMigrationIdentity(tx:any,input:MigrationIdentityInput):MigrationIdentityResult{
  try{
    need(input&&['confirmed','finalized'].includes(input.commitment)&&Number.isSafeInteger(input.availableAt)&&input.availableAt>=0,'REQUEST_CONTEXT');
    need(typeof input.signature==='string'&&input.signature.length<=100,'SIGNATURE');
    try{need(bs58.decode(input.signature).length===64,'SIGNATURE');}catch{throw Error('MIGRATION_IDENTITY_SIGNATURE');}
    if(input.feedMint!==undefined)publicKey(input.feedMint);
    need(tx&&tx.meta?.err===null&&['legacy',0,1].includes(tx.version),'UNSUCCESSFUL_OR_UNSUPPORTED_TRANSACTION');
    need(tx.transaction?.signatures?.[0]===input.signature,'SIGNATURE_MISMATCH');
    need(Number.isSafeInteger(tx.slot)&&tx.slot>=0&&Number.isSafeInteger(tx.blockTime)&&tx.blockTime>0,'CHAIN_CONTEXT');
    need(tx.blockTime<=Math.floor(input.availableAt/1000),'INFORMATION_BACKDATED');
    const message=tx.transaction.message;
    need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128,'COMPILED_MESSAGE');
    need(tx.meta.loadedAddresses===undefined||Array.isArray(tx.meta.loadedAddresses.writable)&&Array.isArray(tx.meta.loadedAddresses.readonly),'LOADED_ADDRESSES');
    const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
    need(keys.length<=256&&keys.every(k=>typeof k==='string'),'ACCOUNT_KEYS');keys.forEach(publicKey);
    const address=(index:unknown)=>{need(Number.isSafeInteger(index)&&Number(index)>=0&&Number(index)<keys.length,'ACCOUNT_INDEX');return keys[Number(index)] as string;};
    const groups=new Map<number,any[]>();need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128,'INNER_INSTRUCTIONS');
    for(const group of tx.meta.innerInstructions){need(Number.isSafeInteger(group.index)&&group.index>=0&&group.index<message.instructions.length&&!groups.has(group.index)&&Array.isArray(group.instructions)&&group.instructions.length<=512,'INNER_GROUP');groups.set(group.index,group.instructions);}
    const creations:Creation[]=[];let migrationCount=0,pumpInvocationCount=0,ammInvocationCount=0;
    const frame=(ix:any,position:Position):Frame=>{
      const program=address(ix?.programIdIndex),f:Frame={ix,position,program};
      if(program===PUMP)pumpInvocationCount++;if(program===AMM)ammInvocationCount++;
      if(program===PUMP){const name=migrationNames.get(bytes(ix).subarray(0,8).toString('hex'));if(name){need(Array.isArray(ix.accounts),'MIGRATION_ACCOUNTS');ix.accounts.forEach(address);f.migrationName=name;migrationCount++;}}
      return f;
    };
    for(let outer=0;outer<message.instructions.length;outer++){
      const stack=new Map<number,Frame>([[1,frame(message.instructions[outer],{outerInstructionIndex:outer,innerInstructionIndex:null,stackHeight:1})]]);
      const inner=groups.get(outer)??[];
      for(let i=0;i<inner.length;i++){
        const ix=inner[i],depth=ix.stackHeight;need(Number.isSafeInteger(depth)&&depth>=2&&depth<=8,'STACK_HEIGHT');
        for(const level of stack.keys())if(level>=depth)stack.delete(level);
        const parent=stack.get(depth-1);need(parent,'INSTRUCTION_PARENT');
        const f=frame(ix,{outerInstructionIndex:outer,innerInstructionIndex:i,stackHeight:depth});stack.set(depth,f);
        if(f.program!==AMM)continue;
        const raw=bytes(ix);
        if(raw.subarray(0,8).equals(EVENT_PREFIX)){
          const event=coder.events.decode(raw.subarray(8).toString('base64'));
          if(event?.name!=='CreatePoolEvent')continue;
          // An event elsewhere in the transaction is not the creation's event.
          if(!parent.creation)continue;
          need(parent.program===AMM&&Array.isArray(ix.accounts)&&ix.accounts.length===1&&address(ix.accounts[0])===AUTHORITY,'EVENT_AUTHORITY');
          need(coder.types.encode(event.name,event.data).equals(raw.subarray(16)),'EVENT_LAYOUT');
          need(!parent.creation.event,'DUPLICATE_CREATE_EVENT');parent.creation.event={position:f.position,data:event.data};continue;
        }
        let decoded;try{decoded=coder.instruction.decode(raw);}catch{continue;}
        if(decoded?.name!=='create_pool')continue;
        if(parent.program!==PUMP||!parent.migrationName)continue;
        need(coder.instruction.encode(decoded.name,decoded.data).equals(raw),'CREATE_INSTRUCTION_LAYOUT');
        const definition=idl.instructions.find(x=>x.name===decoded.name);need(definition&&Array.isArray(ix.accounts),'CREATE_ACCOUNTS');
        const roles:Record<string,string>={};for(let j=0;j<definition.accounts.length;j++){const role=definition.accounts[j]!;need(!('accounts'in role),'NESTED_IDL_ROLES');roles[role.name]=address(ix.accounts[j]);}
        need(roles.program===AMM&&roles.event_authority===AUTHORITY,'CREATE_PROGRAM_AUTHORITY');
        const index=(decoded.data as {index?:unknown}).index;need(typeof index==='number'&&Number.isSafeInteger(index)&&index===0,'NONCANONICAL_INDEX');
        const creation:Creation={position:f.position,migration:{...parent.position,name:parent.migrationName},roles,index};f.creation=creation;creations.push(creation);
      }
    }
    // An observed migration from an unrelated protocol is a raw-seed scope
    // exclusion, not a transient missing Pump origin or a ban on its mint hint.
    // Classify only after all existing structural/success/context checks; an
    // unknown Pump/AMM invocation retains its original unverified refusal.
    need(migrationCount>0||pumpInvocationCount>0||ammInvocationCount>0,'OUTSIDE_PUMP_PROGRAM_FAMILY');
    need(migrationCount>0,'MIGRATION_INSTRUCTION_NOT_VERIFIED');need(creations.length>0,'CREATION_CPI_NOT_VERIFIED');need(creations.length===1,'AMBIGUOUS_CREATIONS');
    const c=creations[0]!,r=c.roles;need(c.event,'CREATE_EVENT_UNAVAILABLE');const e=c.event.data;
    for(const name of ['pool','creator','base_mint','quote_mint','lp_mint','user_base_token_account','user_quote_token_account'])need(e[name]?.toBase58?.()===r[name],'EVENT_ROLE_MISMATCH');
    need(e.index===0,'NONCANONICAL_EVENT_INDEX');
    const mint=publicKey(r.base_mint),quote=publicKey(r.quote_mint),pool=publicKey(r.pool);
    need(!mint.equals(quote)&&!mint.equals(PublicKey.default)&&!quote.equals(PublicKey.default),'MINT_IDENTITY');
    need(canonicalPumpPoolPda(mint,quote).equals(pool),'NONCANONICAL_POOL');need(pumpPoolAuthorityPda(mint).toBase58()===r.creator,'CREATOR_AUTHORITY');need(lpMintPda(pool).toBase58()===r.lp_mint,'LP_MINT');
    const migrationFrame=c.migration.innerInstructionIndex===null?message.instructions[c.migration.outerInstructionIndex]:groups.get(c.migration.outerInstructionIndex)![c.migration.innerInstructionIndex];
    need([r.pool,r.base_mint,r.quote_mint].every(key=>migrationFrame.accounts.some((i:number)=>address(i)===key)),'MIGRATION_SCOPE_ACCOUNTS');
    const isSol=quote.equals(NATIVE_MINT),baseProgram=r.base_token_program!,quoteProgram=r.quote_token_program!,programsSupported=[TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(baseProgram)&&quoteProgram===TOKEN_PROGRAM_ID.toBase58();
    const classification=!isSol?'EXCLUDED_CUSTOM_QUOTE':!programsSupported?'EXCLUDED_TOKEN_PROGRAM':'SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT';
    return {ok:true,identity:{classification,reason:!isSol?'CUSTOM_QUOTE_OUTSIDE_SCOPE':!programsSupported?'TOKEN_PROGRAM_OUTSIDE_SCOPE':null,signature:input.signature,slot:tx.slot,chainBlockTime:tx.blockTime,commitment:input.commitment,availableAt:input.availableAt,confirmationProvenance:'caller-declared-RPC-request-commitment',pool:r.pool!,baseMint:r.base_mint!,quoteMint:r.quote_mint!,creator:r.creator!,lpMint:r.lp_mint!,baseVault:r.pool_base_token_account!,quoteVault:r.pool_quote_token_account!,baseTokenProgram:baseProgram,quoteTokenProgram:quoteProgram,feedHintRole:input.feedMint===undefined?'missing':input.feedMint===r.base_mint?'base':input.feedMint===r.quote_mint?'quote':'other',migration:c.migration,creation:c.position,event:{...c.event.position,name:'CreatePoolEvent',exactPackagedLayout:true},proof:{canonicalActualQuotePda:true,index:0,pumpCreatorAuthority:true,canonicalLpMint:true,eventRoleAgreement:true,eventAuthority:true,sdk:'@pump-fun/pump-swap-sdk@2.2.0'},currentPoolStateVerified:false,currentMintVaultFeeAndExtensionSupportVerified:false,entryEligibilityVerified:false}};
  }catch(error){const reason=error instanceof Error?error.message:'';return {ok:false,reason:/^MIGRATION_IDENTITY_[A-Z0-9_]+$/.test(reason)?reason:'MIGRATION_IDENTITY_UNVERIFIED_LAYOUT_OR_ROLE'};}
}
