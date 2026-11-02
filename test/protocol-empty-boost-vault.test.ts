/** Exact forward refusal recovered later by its original packet hash.
 * Historical compiled proof does not authorize logs-only source admission. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import bs58 from 'bs58';
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {parseProgramLogActivity,parseProgramLogActivityWithCleanup,recognizeProgramLogCleanup,CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '../src/program-log-mapping.js';
import {verifyBoostVaultCleanupTransaction} from '../src/protocol-pool-effects.js';

const directory='evidence/protocol-empty-boost-vault-20261102';
const raw=readFileSync(directory+'/transaction-response.json'),tx=JSON.parse(raw.toString('utf8')).result;
const provenance=JSON.parse(readFileSync(directory+'/provenance.json','utf8')),prior=provenance.originalRefusal;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const mint='CmEk1uNV3uF2mVUSp12Mstm3r7srvD7AjhdG5a1Xpump',pool='7fwtyQKJQQL1W2F27hqk3v6S9s2wtqsDjDv9svxNPgSh';
const sourceInput=()=>({signature:prior.signature,slot:prior.slot,err:null,logs:structuredClone(tx.meta.logMessages),
 commitment:'confirmed' as const,receivedAt:prior.receivedAt,availableAt:prior.availableAt});
const proofInput=()=>({signature:prior.signature,slot:prior.slot,mint,pool,logs:structuredClone(tx.meta.logMessages)});

test('historical transaction reconstructs the exact original refused notification without changing its availability',()=>{
 assert.equal(hash(raw),'0206674f754b36d325d9ccd49444622606303e8f06edfcbcdbaf9d20b86babaa');
 assert.equal(provenance.responseSha256,hash(raw));assert.equal(tx.transaction.signatures[0],prior.signature);
 assert.equal(tx.slot,464643415);assert.equal(tx.meta.err,null);assert.equal(tx.meta.logMessages.length,28);
 assert.equal(prior.reason,'LOG_NATIVE_PROTOCOL_CHILD_SHAPE');
 const envelope={signature:tx.transaction.signatures[0],slot:tx.slot,err:tx.meta.err,logs:tx.meta.logMessages};
 assert.equal(hash(JSON.stringify(envelope)),'afecd011162a3104228373a3aefdfa2984dac5d814f4769b5b4b86965e4053a8');
 assert.equal(hash(JSON.stringify(envelope)),prior.rawHash);
 assert.equal(provenance.historicalDiagnosisOnly,true);assert.equal(provenance.originalDecisionTimeEvidenceChanged,false);
 assert.equal(provenance.financialQualificationAuthorized,false);
 const receiptRaw=readFileSync(directory+'/retrieval.json'),receipt=JSON.parse(receiptRaw.toString('utf8'));
 assert.equal(hash(receiptRaw),provenance.retrievalReceiptSha256);assert.equal(receipt.matchesOriginalNotification,true);
 assert.equal(receipt.runtimeDispatchUsed,false);assert.ok(Date.parse(receipt.startedAt)>prior.availableAt);
});

test('existing strict compiled verifier proves exact empty-boost close roles, amounts and reclaimed rent',()=>{
 const before=JSON.stringify(tx),proof=verifyBoostVaultCleanupTransaction(tx,proofInput());
 assert.equal(proof.rawNotificationSha256,prior.rawHash);assert.equal(proof.outerInstructionIndex,2);assert.equal(proof.closeInnerInstructionIndex,4);
 assert.equal(proof.quoteLamports,'627840843');assert.equal(proof.baseUnits,'4940714254625');assert.equal(proof.minimumBaseUnits,'4693678541893');
 assert.equal(proof.boostRemaining,'0');assert.equal(proof.reclaimedAccountLamports,'1488440');
 assert.equal(proof.boostActor,'Czec9X3wLuEv2hdpLZdv8WZgxSsa8AzW4FNYj1WURJmd');
 assert.equal(proof.boostVault,'6pTcgTE5ZFo7DnXnsaQdNKhbq46NMCiyCc94bE78Das3');
 assert.equal(proof.closeDestination,proof.instructionAuthority);assert.notEqual(proof.closeDestination,proof.boostActor);
 assert.deepEqual(proof.transferChecks,{quoteTransfer:true,baseBurn:true,drainedVaultClose:true});
 assert.equal(proof.ordinaryBuyer,false);assert.equal(proof.normalizedForStrategy,false);assert.equal(JSON.stringify(tx),before);
});

test('the actual source parser still refuses the fifth unlabeled token child without a forward compiled proof path',()=>{
 const value=sourceInput(),scope={mint,pool,baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),
  supportedPoolEvidence:'OFFLINE_HASH_MATCHED_PACKET_AND_HISTORICAL_TRANSACTION_ONLY'};
 assert.throws(()=>parseProgramLogActivity(value,[scope],{dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW}),/LOG_NATIVE_PROTOCOL_CHILD_SHAPE/);
});

test('same log shape and notification hash cannot prove close opcode, source, destination or authority',()=>{
 for(const mutation of ['opcode','source','destination','authority','transfer']){
  const changed=structuredClone(tx),group=changed.meta.innerInstructions.find((g:any)=>g.index===2).instructions,close=group[4];
  if(mutation==='opcode')close.data=bs58.encode(Buffer.from([8]));
  if(mutation==='source')close.accounts[0]=4;
  if(mutation==='destination')close.accounts[1]=6;
  if(mutation==='authority')close.accounts[2]=0;
  if(mutation==='transfer')group[4]=structuredClone(group[0]);
  assert.deepEqual(changed.meta.logMessages,tx.meta.logMessages);
  assert.equal(hash(JSON.stringify({signature:prior.signature,slot:prior.slot,err:null,logs:changed.meta.logMessages})),prior.rawHash);
  assert.throws(()=>verifyBoostVaultCleanupTransaction(changed,proofInput()),/BOOST_CLEANUP_EXACT_DRAINED_CLOSE/);
 }
});

test('pure cleanup recognition exposes only a bounded request; full supplied transaction is still mandatory',()=>{
 const input=sourceInput(),scope={mint,pool,baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),supportedPoolEvidence:'OFFLINE_CAPTURE_SCOPE'};
 const request=recognizeProgramLogCleanup(input,[scope]);
 assert.deepEqual(request,{signature:prior.signature,slot:prior.slot,mint,pool,rawNotificationSha256:prior.rawHash,programClockTimestamp:'1793654266',affectedMints:[mint]});
 assert.equal('trades' in request!,false);assert.equal('protocolEffects' in request!,false);
 const activity=parseProgramLogActivityWithCleanup(input,[scope],tx);
 assert.equal(activity.trades.length,0);assert.equal(activity.protocolEffects.length,1);
 assert.equal(activity.protocolEffects[0]!.compiledCleanup?.rawNotificationSha256,prior.rawHash);
 assert.equal(activity.protocolEffects[0]!.quoteLamportsIn,'627840843');
 assert.equal(activity.financialQualificationAllowed,false);assert.equal(activity.protocolEffects[0]!.normalizedForStrategy,false);
 assert.throws(()=>parseProgramLogActivityWithCleanup(input,[scope],activity.protocolEffects[0]!.compiledCleanup),/BOOST_CLEANUP_SUCCESS_IDENTITY/);
});

test('cleanup recognition validates the complete log stack and full-proof path rejects another version or packet',()=>{
 const scope={mint,pool,baseTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),supportedPoolEvidence:'OFFLINE_CAPTURE_SCOPE'};
 const broken=sourceInput();broken.logs.push('Program '+pool+' invoke [1]');
 assert.throws(()=>recognizeProgramLogCleanup(broken,[scope]),/LOG_NATIVE_INCOMPLETE_LOG_STACK/);
 const version=structuredClone(tx);version.version=2;
 assert.throws(()=>parseProgramLogActivityWithCleanup(sourceInput(),[scope],version),/BOOST_CLEANUP_SUCCESS_IDENTITY/);
 const changed=structuredClone(tx);changed.meta.logMessages[0]+=' changed';
 assert.throws(()=>parseProgramLogActivityWithCleanup(sourceInput(),[scope],changed),/BOOST_CLEANUP_LOG_BINDING/);
});
