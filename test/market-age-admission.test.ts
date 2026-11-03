import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PumpSwapTokenAgeAdmission} from '../src/market-age-admission.js';
import {TOKEN_AGE_POLICY,type TokenCreationProof} from '../src/token-age-policy.js';
import bs58 from 'bs58';

const mint=bs58.encode(Buffer.alloc(32,12)),createdAt=1793652000000;
const proof:TokenCreationProof={version:TOKEN_AGE_POLICY.version,mint,signature:bs58.encode(Buffer.alloc(64,27)),slot:123,createdAt,availableAt:createdAt+1000,commitment:'finalized',instruction:'create',transactionSha256:'a'.repeat(64)};

test('only a validated creation scope admits discovery and exact 24h is inclusive',()=>{
 const gate=new PumpSwapTokenAgeAdmission();assert.equal(gate.decision(mint,createdAt+2000),'unknown');
 gate.observeProof(proof);assert.equal(gate.decision(mint,createdAt),'unavailable');
 assert.equal(gate.decision(mint,proof.availableAt),'eligible');
 assert.equal(gate.decision(mint,createdAt+TOKEN_AGE_POLICY.maximumAgeMs),'eligible');
 assert.equal(gate.decision(mint,createdAt+TOKEN_AGE_POLICY.maximumAgeMs+1),'expired');
 assert.equal(gate.decision(mint,NaN),'unavailable');
});

test('retained old proofs deny cheaply, while migration timestamps cannot replace birth',()=>{
 const gate=new PumpSwapTokenAgeAdmission([{mint,createdAt,availableAt:proof.availableAt,expiresAt:createdAt+TOKEN_AGE_POLICY.maximumAgeMs}]);
 assert.equal(gate.decision(mint,createdAt+2*TOKEN_AGE_POLICY.maximumAgeMs),'expired');
 assert.throws(()=>gate.observeProof({...proof,createdAt:createdAt+TOKEN_AGE_POLICY.maximumAgeMs,availableAt:createdAt+TOKEN_AGE_POLICY.maximumAgeMs}),/SCOPE_CONFLICT/);
 assert.throws(()=>gate.observeProof({...proof,instruction:'migrate'} as unknown as TokenCreationProof),/CREATION_PROOF_REQUIRED/);
 assert.equal(gate.scope(mint)?.createdAt,createdAt);
});

test('startup scopes and exposed cache values cannot extend verified eligibility',()=>{
 const scope={mint,createdAt,availableAt:proof.availableAt,expiresAt:createdAt+TOKEN_AGE_POLICY.maximumAgeMs};
 const gate=new PumpSwapTokenAgeAdmission([scope]);scope.expiresAt+=86400000;
 assert.equal(gate.decision(mint,createdAt+TOKEN_AGE_POLICY.maximumAgeMs+1),'expired');
 assert.throws(()=>{(gate.scope(mint) as any).expiresAt+=86400000;},TypeError);
 assert.throws(()=>new PumpSwapTokenAgeAdmission([scope]),/SCOPE_INVALID/);
 assert.throws(()=>new PumpSwapTokenAgeAdmission([{...scope,mint:'provider-only-identity'}]),/SCOPE_INVALID/);
});
