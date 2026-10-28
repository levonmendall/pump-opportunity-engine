/** Historical compiled evidence and explicit offline mutations. No source window
 * is repaired retroactively and no financial/trading permission is created. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {verifyBoostVaultCleanupTransaction,type BoostVaultCleanupInput} from '../src/protocol-pool-effects.js';
const file='evidence/native-shape-review-20261028/compiled-cleanup/boost-close-actual.json',bytes=readFileSync(file),actual=JSON.parse(bytes.toString());
const input=(tx=actual):BoostVaultCleanupInput=>({signature:tx.transaction.signatures[0],slot:tx.slot,pool:'DTv86qoU5tLwCyL4gfrArkjy1o7UeWcVNQmKuWzqDZJa',mint:'GwvVsrECK5dajqMQhh6FT5PcPX4ao5QipuZMbWQHpump',logs:tx.meta.logMessages});
const clone=()=>structuredClone(actual),children=(tx:any)=>tx.meta.innerInstructions.find((g:any)=>g.index===2).instructions;
function changed(mut:(tx:any)=>void){const tx=clone();mut(tx);return tx;}

test('actual drained boost close is compiled-role and SPL verified without creating an ordinary buyer',()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'9701cc3c6e6c3f52dfb0ca3acfd8b53920d2e2d96edd4f2f172d883ac8043aba');
 const before=JSON.stringify(actual),proof=verifyBoostVaultCleanupTransaction(actual,input());
 assert.equal(proof.version,'compiled-drained-boost-vault-cleanup-v1');assert.equal(proof.outerInstructionIndex,2);assert.equal(proof.closeInnerInstructionIndex,4);
 assert.equal(proof.quoteLamports,'604925295');assert.equal(proof.baseUnits,'8981894354501');assert.equal(proof.minimumBaseUnits,'8785124403407');assert.equal(proof.boostRemaining,'0');assert.equal(proof.reclaimedAccountLamports,'1488440');
 assert.equal(proof.boostActor,'9hwzihq1bk9Yunx2FWLQf4LTSaxWEDWJYSGdxvXV5bbw');assert.equal(proof.boostVault,'B9WHK2YvXR31SNt7WesmSPCYoyNrQZVffzywMveZGnvs');assert.equal(proof.closeDestination,proof.instructionAuthority);assert.notEqual(proof.boostActor,proof.instructionAuthority);
 assert.deepEqual(proof.transferChecks,{quoteTransfer:true,baseBurn:true,drainedVaultClose:true});assert.equal(proof.ordinaryBuyer,false);assert.equal(proof.normalizedForStrategy,false);assert.equal(Object.isFrozen(proof),true);assert.equal(Object.isFrozen(proof.transferChecks),true);assert.equal(JSON.stringify(actual),before);
});

for(const [label,mutate,reason] of [
 ['close source',(tx:any)=>{children(tx)[4].accounts[0]=4;},'EXACT_DRAINED_CLOSE'],
 ['close destination',(tx:any)=>{children(tx)[4].accounts[1]=6;},'EXACT_DRAINED_CLOSE'],
 ['close authority',(tx:any)=>{children(tx)[4].accounts[2]=0;},'EXACT_DRAINED_CLOSE'],
 ['close token program',(tx:any)=>{children(tx)[4].programIdIndex=12;},'EXACT_DRAINED_CLOSE'],
 ['close opcode',(tx:any)=>{children(tx)[4].data=bs58.encode(Buffer.from([8]));},'EXACT_DRAINED_CLOSE'],
 ['close data trailing bytes',(tx:any)=>{children(tx)[4].data=bs58.encode(Buffer.from([9,0]));},'EXACT_DRAINED_CLOSE'],
 ['extra token instruction',(tx:any)=>{children(tx).push(structuredClone(children(tx)[4]));},'FIVE_DIRECT_CHILDREN'],
 ['missing close',(tx:any)=>{children(tx).pop();},'FIVE_DIRECT_CHILDREN'],
 ['nested close',(tx:any)=>{children(tx)[4].stackHeight=3;},'FIVE_DIRECT_CHILDREN'],
 ['fee-like transfer after events',(tx:any)=>{children(tx)[4]=structuredClone(children(tx)[0]);},'EXACT_DRAINED_CLOSE'],
 ['incorrect transfer amount',(tx:any)=>{const b=Buffer.from(bs58.decode(children(tx)[0].data));b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);children(tx)[0].data=bs58.encode(b);},'ROOT_AMOUNTS'],
 ['incorrect burn amount',(tx:any)=>{const b=Buffer.from(bs58.decode(children(tx)[1].data));b.writeBigUInt64LE(b.readBigUInt64LE(1)+1n,1);children(tx)[1].data=bs58.encode(b);},'EVENT_AMOUNTS'],
 ['event order',(tx:any)=>{[children(tx)[2],children(tx)[3]]=[children(tx)[3],children(tx)[2]];},'EVENT_LAYOUT'],
 ['base token owner',(tx:any)=>{tx.transaction.message.instructions[2].accounts[9]=13;},'POOL_ROLES'],
 ['authority not transaction signer',(tx:any)=>{tx.transaction.message.header.numRequiredSignatures=0;},'AUTHORITY_SIGNER'],
 ['closed account still funded',(tx:any)=>{tx.meta.postBalances[5]=1;},'CLOSED_ACCOUNT_BALANCES'],
 ['base post reserve',(tx:any)=>{tx.meta.postTokenBalances[0].uiTokenAmount.amount='1';},'BASE_BALANCES'],
 ['wrong source token balance',(tx:any)=>{tx.meta.preTokenBalances[2].owner=tx.transaction.message.accountKeys[0];},'TOKEN_BALANCE_ROLES'],
 ['recreated boost token balance',(tx:any)=>{tx.meta.postTokenBalances.push({...tx.meta.preTokenBalances[2],uiTokenAmount:{amount:'0',decimals:9}});},'BOOST_BALANCES'],
] as const)test('compiled close proof rejects '+label,()=>{const tx=changed(mutate);assert.throws(()=>verifyBoostVaultCleanupTransaction(tx,input(tx)),new RegExp('BOOST_CLEANUP_'+reason));});

test('unsynced SOL deposits before or after the root cannot inflate an apparently exact cleanup refund',()=>{
 const transfer=()=>{const b=Buffer.alloc(12);b.writeUInt32LE(2,0);b.writeBigUInt64LE(1000000000n,4);return {accounts:[0,5],programIdIndex:15,data:bs58.encode(b),stackHeight:1};};
 const before=clone();before.transaction.message.instructions[0]=transfer();assert.throws(()=>verifyBoostVaultCleanupTransaction(before,input(before)),/VAULT_ACCESSED_OUTSIDE_ROOT/);
 const after=clone();after.transaction.message.instructions.push(transfer());assert.throws(()=>verifyBoostVaultCleanupTransaction(after,input(after)),/VAULT_ACCESSED_OUTSIDE_ROOT/);
});

test('proof cannot be transferred to a different source packet, unsuccessful transaction or unverified identity',()=>{
 assert.throws(()=>verifyBoostVaultCleanupTransaction(actual,{...input(),logs:[...actual.meta.logMessages,'Program log: changed']}),/LOG_BINDING/);
 assert.throws(()=>verifyBoostVaultCleanupTransaction(actual,{...input(),slot:actual.slot+1}),/SUCCESS_IDENTITY/);
 assert.throws(()=>verifyBoostVaultCleanupTransaction(actual,{...input(),signature:bs58.encode(Buffer.alloc(64,1))}),/SUCCESS_IDENTITY/);
 assert.throws(()=>verifyBoostVaultCleanupTransaction(actual,{...input(),mint:'5TdjfgA5eJUFD4xQp8ZRvtZAQZVXZHq1dtB4pEg8pump'}),/CANONICAL_POOL/);
 const failed=changed(tx=>{tx.meta.err={InstructionError:[2,{Custom:1}]};});assert.throws(()=>verifyBoostVaultCleanupTransaction(failed,input(failed)),/SUCCESS_IDENTITY/);
 const large=changed(tx=>{tx.untrustedPadding='x'.repeat(2*1024*1024);});assert.throws(()=>verifyBoostVaultCleanupTransaction(large,input(large)),/TRANSACTION_SIZE/);
});

test('the independent helper refuses legacy four-child proof rather than broadening the existing logs-only grammar',()=>{
 const old=JSON.parse(readFileSync('evidence/protocol-pool-effects-20261028/boost-actual.json','utf8'));
 assert.throws(()=>verifyBoostVaultCleanupTransaction(old,{signature:old.transaction.signatures[0],slot:old.slot,pool:'5ALPjDC4WUfReszwbmZLpwwbvfyqbjWgJw4t4K6LvE2k',mint:'5TdjfgA5eJUFD4xQp8ZRvtZAQZVXZHq1dtB4pEg8pump',logs:old.meta.logMessages}),/BOOST_CLEANUP_/);
});
