import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PUMP_AMM_PROGRAM_ID} from '../src/sdk.js';
import {nativeRefusedLogShape,nativeRefusedLogShapeKey,NATIVE_REFUSED_NOTIFICATION_DIAGNOSTICS} from '../src/native-notification-diagnostics.js';

const program=PUMP_AMM_PROGRAM_ID.toBase58();
test('refused payload diagnostics distinguish observed shapes without establishing harmlessness or execution',()=>{
 const event=Buffer.alloc(16,9).toString('base64'),logs=[`Program ${program} invoke [1]`,'Program log: Instruction: BoostBuyAndBurn',`Program data: ${event}`,`Program ${program} success`];
 const shape=nativeRefusedLogShape(logs);
 assert.equal(shape.envelopeWithinBounds,true);assert.equal(shape.invocationStack,'complete');assert.equal(shape.boostInstructionMarkers,1);assert.equal(shape.swapInstructionMarkers,0);
 assert.deepEqual(shape.eventDiscriminators,['0909090909090909']);assert.equal(shape.economicMeaningEstablished,false);assert.equal(shape.qualificationEvidence,false);
 assert.equal(shape.meaning,'UNVERIFIED_LOG_SHAPE');assert.match(nativeRefusedLogShapeKey(shape),/^[a-f0-9]{64}$/);
 const swap=nativeRefusedLogShape(logs.map(line=>line.replace('BoostBuyAndBurn','Buy')));
 assert.equal(swap.swapInstructionMarkers,1);assert.notEqual(nativeRefusedLogShapeKey(swap),nativeRefusedLogShapeKey(shape));
 assert.equal(nativeRefusedLogShape([...logs,'Log truncated']).truncationMarker,true);
 assert.equal(nativeRefusedLogShape(logs.slice(0,-1)).invocationStack,'incomplete');
 assert.equal(nativeRefusedLogShape([`Program ${program} invoke [2]`]).invocationStack,'malformed');
});

test('diagnostic shape bounds reject oversized/untyped logs and never copy arbitrary log contents',()=>{
 const marker='PRIVATE_TEXT_NOT_A_DIAGNOSTIC_FIELD';
 const shape=nativeRefusedLogShape([`Program ${program} invoke [1]`,`Program log: Instruction: ${marker}`,`Program log: ${marker}`,`Program ${program} success`]);
 assert.equal(shape.otherAmmInstructionMarkers,1);assert.equal(JSON.stringify(shape).includes(marker),false);
 for(const logs of [undefined,null,{},[1],Array(4097).fill(''),['x'.repeat(32769)],Array(17).fill('x'.repeat(32768))])assert.equal(nativeRefusedLogShape(logs).envelopeWithinBounds,false);
 const many=Array.from({length:16},(_,i)=>'Program data: '+Buffer.alloc(16,i).toString('base64')),bounded=nativeRefusedLogShape(many);
 assert.equal(bounded.eventDiscriminators.length,NATIVE_REFUSED_NOTIFICATION_DIAGNOSTICS.maximumDiscriminators);assert.equal(bounded.omittedDiscriminatorRecords,8);
});
