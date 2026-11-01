/** Owner-requested PAPER admission scope. Mint creation is not pool migration,
 * discovery, a subscription ACK, or the first transaction in a truncated page. */
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';

export const TOKEN_AGE_POLICY=Object.freeze({
 version:'finalized-pump-token-creation-24h-v1',maximumAgeMs:86_400_000,
 basis:'successful-finalized-Pump-create-with-child-mint-initialization',
 boundary:'inclusive-at-exactly-24-hours',unknown:'ineligible-until-verified',
 acquisition:'one-selected-creation-signature; no-history-scan; existing-provider-budget',
 existingPositions:'unchanged-exit-policy; never-force-liquidate-on-age',
});
export type TokenCreationProof={
 version:typeof TOKEN_AGE_POLICY.version;mint:string;signature:string;slot:number;
 createdAt:number;availableAt:number;commitment:'finalized';
 instruction:'create'|'create_v2';transactionSha256:string;
};
export type TokenAgeDecision={allowed:boolean;reason:'TOKEN_AGE_WITHIN_24H'|'TOKEN_AGE_UNVERIFIED'|'TOKEN_AGE_INVALID'|'TOKEN_AGE_EXCEEDS_24H';createdAt:number|null;ageMs:number|null;expiresAt:number|null;proof?:TokenCreationProof};
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const key=(v:unknown):v is string=>{try{return typeof v==='string'&&v.length<=44&&new PublicKey(v).toBase58()===v;}catch{return false;}};
const signature=(v:unknown):v is string=>{try{return typeof v==='string'&&v.length<=100&&bs58.decode(v).length===64;}catch{return false;}};
export function validTokenCreationProof(value:unknown):value is TokenCreationProof{
 const p=value as TokenCreationProof|undefined;
 return !!p&&p.version===TOKEN_AGE_POLICY.version&&key(p.mint)&&signature(p.signature)&&integer(p.slot)&&integer(p.createdAt)&&p.createdAt>0&&p.createdAt%1000===0&&integer(p.availableAt)&&p.availableAt>=p.createdAt&&p.commitment==='finalized'&&['create','create_v2'].includes(p.instruction)&&typeof p.transactionSha256==='string'&&/^[a-f0-9]{64}$/.test(p.transactionSha256);
}
export function tokenAgeDecision(mint:string,at:number,proof:unknown):TokenAgeDecision{
 if(proof===null||proof===undefined)return {allowed:false,reason:'TOKEN_AGE_UNVERIFIED',createdAt:null,ageMs:null,expiresAt:null};
 if(!integer(at)||!validTokenCreationProof(proof)||proof.mint!==mint||proof.availableAt>at||proof.createdAt>at)return {allowed:false,reason:'TOKEN_AGE_INVALID',createdAt:null,ageMs:null,expiresAt:null};
 const ageMs=at-proof.createdAt,expiresAt=proof.createdAt+TOKEN_AGE_POLICY.maximumAgeMs;
 return {allowed:ageMs<=TOKEN_AGE_POLICY.maximumAgeMs,reason:ageMs<=TOKEN_AGE_POLICY.maximumAgeMs?'TOKEN_AGE_WITHIN_24H':'TOKEN_AGE_EXCEEDS_24H',createdAt:proof.createdAt,ageMs,expiresAt,proof};
}
const PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const TOKENS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const createNames=new Map(['create','create_v2'].map(name=>[createHash('sha256').update('global:'+name).digest().subarray(0,8).toString('hex'),name as 'create'|'create_v2']));
function need(value:unknown):asserts value{if(!value)throw Error('TOKEN_CREATION_PROOF_INVALID');}
/** Decode only a real RPC transaction requested at finalized commitment. Pump's
 * public IDL puts mint at account 0 and bonding_curve at account 2 for create
 * and create_v2. Require an actual child SPL InitializeMint/InitializeMint2;
 * a migration, same-mint transfer, forged log, or unrelated CPI cannot pass.
 * Definition: pump-fun/pump-public-docs/idl/pump.json (reviewed 2026-10-31). */
export function decodeTokenCreationProof(tx:any,input:{mint:string;signature:string;availableAt:number;commitment:'finalized'}):TokenCreationProof|null{
 try{
  need(input.commitment==='finalized'&&key(input.mint)&&signature(input.signature)&&integer(input.availableAt));
  need(tx&&tx.meta?.err===null&&['legacy',0,1].includes(tx.version)&&tx.transaction?.signatures?.[0]===input.signature&&integer(tx.slot)&&integer(tx.blockTime)&&tx.blockTime>0&&tx.blockTime*1000<=input.availableAt);
  const message=tx.transaction.message;need(Array.isArray(message?.accountKeys)&&Array.isArray(message.instructions)&&message.instructions.length<=128);
  need(tx.meta.loadedAddresses===undefined||Array.isArray(tx.meta.loadedAddresses.writable)&&Array.isArray(tx.meta.loadedAddresses.readonly));
  const keys=[...message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];need(keys.length<=256&&keys.every(key));
  const address=(n:unknown)=>{need(integer(n)&&n<keys.length);return keys[n] as string;};
  const curve=PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),new PublicKey(input.mint).toBuffer()],new PublicKey(PUMP))[0].toBase58();
  type Create={name:'create'|'create_v2';initialized:boolean};type Frame={program:string;creation?:Create};
  const creations:Create[]=[];
  const decode=(ix:any,parent?:Frame):Frame=>{
   need(Array.isArray(ix?.accounts)&&typeof ix.data==='string'&&ix.data.length<=16384);ix.accounts.forEach(address);
   const program=address(ix.programIdIndex),data=Buffer.from(bs58.decode(ix.data)),frame:Frame={program};
   if(program===PUMP){const name=createNames.get(data.subarray(0,8).toString('hex'));if(name&&address(ix.accounts[0])===input.mint){need(address(ix.accounts[2])===curve);const c:Create={name,initialized:false};creations.push(c);frame.creation=c;}}
   if(TOKENS.has(program)&&parent?.program===PUMP&&parent.creation&&[0,20].includes(data[0]??-1)&&address(ix.accounts[0])===input.mint){need(data.length>=35);parent.creation.initialized=true;}
   return frame;
  };
  need(Array.isArray(tx.meta.innerInstructions)&&tx.meta.innerInstructions.length<=128);const groups=new Map<number,any[]>();
  for(const group of tx.meta.innerInstructions){need(integer(group.index)&&group.index<message.instructions.length&&!groups.has(group.index)&&Array.isArray(group.instructions)&&group.instructions.length<=512);groups.set(group.index,group.instructions);}
  for(let outer=0;outer<message.instructions.length;outer++){
   const stack=new Map<number,Frame>([[1,decode(message.instructions[outer])]]);
   for(const ix of groups.get(outer)??[]){const depth=ix.stackHeight;need(integer(depth)&&depth>=2&&depth<=8);for(const d of stack.keys())if(d>=depth)stack.delete(d);const parent=stack.get(depth-1);need(parent);stack.set(depth,decode(ix,parent));}
  }
  need(creations.length===1&&creations[0]!.initialized);
  const proof:TokenCreationProof={version:TOKEN_AGE_POLICY.version,mint:input.mint,signature:input.signature,slot:tx.slot,createdAt:tx.blockTime*1000,availableAt:input.availableAt,commitment:'finalized',instruction:creations[0]!.name,transactionSha256:createHash('sha256').update(JSON.stringify(tx)).digest('hex')};
  need(validTokenCreationProof(proof));return proof;
 }catch{return null;}
}
