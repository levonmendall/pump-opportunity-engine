import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {PublicKey} from '@solana/web3.js';
import {decodeMigrationIdentity,type MigrationIdentityInput} from '../src/migration-identity.js';
import {canonicalPumpPoolPda} from '../src/sdk.js';

const require=createRequire(import.meta.url),idl=JSON.parse(readFileSync(join(dirname(require.resolve('@pump-fun/pump-swap-sdk')),'../src/idl/pump_amm.json'),'utf8')) as Idl,coder=new BorshCoder(idl);
function recorded(path:string){return readFileSync(path,'utf8').trim().split('\n').map(x=>JSON.parse(x));}
const currentRows=recorded('evidence/overnight-20261027/04-active/observations.ndjson');
const currentRecord=currentRows.find(r=>r.kind==='migration-transaction')!;
const custom=currentRecord.data,hint=currentRows.find(r=>r.kind==='migration-verification-unavailable')!.data.hint;
const solRows=recorded('evidence/integration-2026-10-26T23-32-41.255Z.ndjson'),solRecord=solRows.find(r=>r.kind==='migration-transaction')!,sol=solRecord.data;
const context=(tx:any,availableAt:number,feedMint?:string):MigrationIdentityInput=>({signature:tx.transaction.signatures[0],commitment:'confirmed',availableAt,...(feedMint===undefined?{}:{feedMint})});
const customInput=context(custom,currentRecord.recordedAt,hint.mint),solInput=context(sol,Date.parse(solRecord.receivedAt),'2suCpXe3HaSqCZ2Bb4dgmRrJjuDDRqwYDUTEJ3Kypump');
const copy=<T>(x:T)=>structuredClone(x);
function actualCreation(tx:any){
  const g=tx.meta.innerInstructions.find((g:any)=>g.instructions.some((ix:any)=>coder.instruction.decode(Buffer.from(bs58.decode(ix.data)))?.name==='create_pool'));
  const ix=g.instructions.find((ix:any)=>coder.instruction.decode(Buffer.from(bs58.decode(ix.data)))?.name==='create_pool');
  const event=g.instructions.find((ix:any)=>{const b=Buffer.from(bs58.decode(ix.data));return b.subarray(0,8).toString('hex')==='e445a52e51cb9a1d'&&coder.events.decode(b.subarray(8).toString('base64'))?.name==='CreatePoolEvent';});
  return {g,ix,event};
}

test('actual custom migration identifies base/quote roles and rejects the custom quote instead of deriving from feed mint',()=>{
  const result=decodeMigrationIdentity(copy(custom),customInput);assert.equal(result.ok,true);if(!result.ok)return;
  const i=result.identity;assert.equal(i.classification,'EXCLUDED_CUSTOM_QUOTE');assert.equal(i.reason,'CUSTOM_QUOTE_OUTSIDE_SCOPE');assert.equal(i.feedHintRole,'quote');
  assert.equal(i.baseMint,'E83ScbK5cTJA7efZoHTig8E6ph723AgDJJAzG2zWpump');assert.equal(i.quoteMint,hint.mint);assert.equal(i.pool,'GVYUCmUUSAM8wKyLLV2WSihwboXBpePpPAQhDm7cgnUf');
  assert.notEqual(i.pool,canonicalPumpPoolPda(new PublicKey(hint.mint)).toBase58());assert.equal(i.migration.name,'migrate_v2');assert.equal(i.creation.innerInstructionIndex,23);assert.equal(i.event.innerInstructionIndex,35);
  assert.equal(i.currentPoolStateVerified,false);assert.equal(i.currentMintVaultFeeAndExtensionSupportVerified,false);assert.equal(i.entryEligibilityVerified,false);assert.equal(i.availableAt,currentRecord.recordedAt);
});

test('retained real SOL migration returns actual canonical identity but never claims current support or entry eligibility',()=>{
  const result=decodeMigrationIdentity(copy(sol),solInput);assert.equal(result.ok,true);if(!result.ok)return;
  const i=result.identity;assert.equal(i.classification,'SOL_IDENTITY_REQUIRES_CURRENT_SUPPORT');assert.equal(i.reason,null);assert.equal(i.feedHintRole,'base');assert.equal(i.baseMint,solInput.feedMint);assert.equal(i.quoteMint,'So11111111111111111111111111111111111111112');
  assert.equal(i.pool,'DtcDNMjNQjkqS2qBrB3xbHbQWy3jwYXq6BYLFhKQ2MVD');assert.equal(i.baseTokenProgram,'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');assert.equal(i.quoteTokenProgram,'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.equal(i.event.exactPackagedLayout,true);assert.equal(i.currentPoolStateVerified,false);assert.equal(i.confirmationProvenance,'caller-declared-RPC-request-commitment');
  for(const [feedMint,role]of [[undefined,'missing'],[i.quoteMint,'quote'],[hint.mint,'other']] as const){const r=decodeMigrationIdentity(copy(sol),context(sol,solInput.availableAt,feedMint));assert.equal(r.ok,true);if(r.ok){assert.equal(r.identity.feedHintRole,role);assert.equal(r.identity.pool,i.pool);}}
});

test('retry-only migrate, failed status, missing fields and unrelated same-outer creation cannot establish identity',()=>{
  const retry=recorded('evidence/integration-2026-10-26T19-42-16.130Z.ndjson').find(r=>r.kind==='migration-transaction')!;
  assert.deepEqual(decodeMigrationIdentity(retry.data,context(retry.data,Date.parse(retry.receivedAt))),{ok:false,reason:'MIGRATION_IDENTITY_CREATION_CPI_NOT_VERIFIED'});
  const bad=copy(sol);bad.meta.err={InstructionError:[2,'failed']};assert.match((decodeMigrationIdentity(bad,solInput)as{reason:string}).reason,/UNSUCCESSFUL/);
  const missing=copy(sol);delete missing.meta.innerInstructions;assert.deepEqual(decodeMigrationIdentity(missing,solInput),{ok:false,reason:'MIGRATION_IDENTITY_INNER_INSTRUCTIONS'});
  const noTime=copy(sol);noTime.blockTime=null;assert.deepEqual(decodeMigrationIdentity(noTime,solInput),{ok:false,reason:'MIGRATION_IDENTITY_CHAIN_CONTEXT'});
  assert.deepEqual(decodeMigrationIdentity(copy(sol),{...solInput,availableAt:sol.blockTime*1000-1}),{ok:false,reason:'MIGRATION_IDENTITY_INFORMATION_BACKDATED'});
  const unrelated=copy(sol);actualCreation(unrelated).g.index=0;assert.deepEqual(decodeMigrationIdentity(unrelated,solInput),{ok:false,reason:'MIGRATION_IDENTITY_CREATION_CPI_NOT_VERIFIED'});
  assert.deepEqual(decodeMigrationIdentity(copy(sol),{...solInput,commitment:'processed' as 'confirmed'}),{ok:false,reason:'MIGRATION_IDENTITY_REQUEST_CONTEXT'});
  assert.match((decodeMigrationIdentity(copy(sol),{...solInput,signature:customInput.signature})as{reason:string}).reason,/SIGNATURE_MISMATCH/);
});

test('event authority/layout/roles, index, canonical PDA and creator cannot be inferred or bypassed',()=>{
  const wrongAuthority=copy(sol),a=actualCreation(wrongAuthority);a.event.accounts[0]=0;
  assert.deepEqual(decodeMigrationIdentity(wrongAuthority,solInput),{ok:false,reason:'MIGRATION_IDENTITY_EVENT_AUTHORITY'});
  const noEvent=copy(sol),n=actualCreation(noEvent);n.g.instructions.splice(n.g.instructions.indexOf(n.event),1);
  assert.deepEqual(decodeMigrationIdentity(noEvent,solInput),{ok:false,reason:'MIGRATION_IDENTITY_CREATE_EVENT_UNAVAILABLE'});
  const nonzero=copy(sol),ix=actualCreation(nonzero).ix,raw=Buffer.from(bs58.decode(ix.data));raw.writeUInt16LE(1,8);ix.data=bs58.encode(raw);
  assert.deepEqual(decodeMigrationIdentity(nonzero,solInput),{ok:false,reason:'MIGRATION_IDENTITY_NONCANONICAL_INDEX'});
  for(const field of ['pool','creator'] as const){
    const tx=copy(sol),{ix,event}=actualCreation(tx),definition=idl.instructions.find(i=>i.name==='create_pool')!,roleIndex=definition.accounts.findIndex(a=>a.name===field),keys=[...tx.transaction.message.accountKeys,...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])];
    ix.accounts[roleIndex]=0;const b=Buffer.from(bs58.decode(event.data)),decoded=coder.events.decode(b.subarray(8).toString('base64'))!;(decoded.data as any)[field]=new PublicKey(keys[0]);event.data=bs58.encode(Buffer.concat([b.subarray(0,16),coder.types.encode(decoded.name,decoded.data)]));
    assert.deepEqual(decodeMigrationIdentity(tx,solInput),{ok:false,reason:field==='pool'?'MIGRATION_IDENTITY_NONCANONICAL_POOL':'MIGRATION_IDENTITY_CREATOR_AUTHORITY'});
  }
});

test('multiple genuine creations are ambiguous and legacy discriminator support is explicitly synthetic',()=>{
  const duplicate=copy(sol),g=actualCreation(duplicate).g;g.instructions.push(...copy(g.instructions));assert.deepEqual(decodeMigrationIdentity(duplicate,solInput),{ok:false,reason:'MIGRATION_IDENTITY_AMBIGUOUS_CREATIONS'});
  // Actual retained sources above are MigrateV2. This mutation checks only
  // dispatch of the legacy discriminator, not a natural legacy migration.
  const legacy=copy(sol),outer=legacy.transaction.message.instructions[2],old=Buffer.from(bs58.decode(outer.data));outer.data=bs58.encode(Buffer.concat([createHash('sha256').update('global:migrate').digest().subarray(0,8),old.subarray(8)]));
  const result=decodeMigrationIdentity(legacy,solInput);assert.equal(result.ok,true);if(result.ok)assert.equal(result.identity.migration.name,'migrate');
});
