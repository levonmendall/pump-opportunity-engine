import {test} from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import {canonicalTransactionSignature,DEFAULT_TRANSACTION_SIGNATURE} from '../src/transaction-signature.js';
import {parseProgramLogActivity,parseProgramLogEvidence,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '../src/program-log-mapping.js';
import {retained,tx,signature,scope,clone} from './native-flow-fixture.js';

test('canonical transaction identity rejects the SDK unsigned sentinel and malformed encodings',()=>{
 assert.equal(DEFAULT_TRANSACTION_SIGNATURE,bs58.encode(Buffer.alloc(64)));
 for(const value of [undefined,null,1,{},'',DEFAULT_TRANSACTION_SIGNATURE,'1'.repeat(63),'1'.repeat(65),'0'.repeat(64),'x'.repeat(101)])assert.equal(canonicalTransactionSignature(value),false,String(value));
 assert.equal(canonicalTransactionSignature(signature),true);assert.equal(canonicalTransactionSignature(bs58.encode(Buffer.alloc(64,1))),true);
});

test('both program-log parsers independently reject unsigned default identity before producing economic events',()=>{
 const input={signature:DEFAULT_TRANSACTION_SIGNATURE,slot:tx.slot,err:null,logs:clone(tx.meta.logMessages),commitment:'confirmed' as const,receivedAt:retained.data.rpcAvailableAt,availableAt:retained.data.rpcAvailableAt},scopes=[{...scope,supportedPoolEvidence:'OFFLINE retained fixture'}];
 assert.throws(()=>parseProgramLogEvidence(input,scopes),/LOG_NATIVE_SIGNATURE/);
 assert.throws(()=>parseProgramLogActivity(input,scopes,{dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}),/LOG_NATIVE_SIGNATURE/);
 assert.equal(parseProgramLogEvidence({...input,signature},scopes).length,1,'valid retained signed identity keeps its original economics');
});
