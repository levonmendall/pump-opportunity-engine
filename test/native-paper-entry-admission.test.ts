import test from 'node:test';
import assert from 'node:assert/strict';
import {NativePaperEntryAdmission,NATIVE_PAPER_ENTRY_ADMISSION_POLICY} from '../src/native-paper-entry-admission.js';

const input={mint:'candidate-mint',windowEndAt:10000,deadlineAt:19999,at:10001,fullyAdmitted:true};
test('entry scope requires full admission and bounds charged starts without a repeated fresh six-start demand',()=>{
 const admission=new NativePaperEntryAdmission(6);
 assert.equal(NATIVE_PAPER_ENTRY_ADMISSION_POLICY.maximumAccountedStarts,9);
 assert.equal(admission.begin({...input,fullyAdmitted:false}),null);
 const token=admission.begin(input)!;assert.ok(token);assert.equal(Object.isFrozen(token),true);
 assert.equal(admission.begin({...input,mint:'competing-candidate'}),null);
 for(let used=1;used<=6;used++){
  assert.equal(admission.recordAccountedStarts(token,1,10001+used),true);
  assert.equal(admission.remaining(token,10001+used),6-used);
 }
 assert.equal(admission.valid(token,10008),true,'completed preparation retains identity for final authority checks');
 assert.equal(admission.view(token,10008)?.spent,6);
 assert.equal(admission.recordAccountedStarts(token,1,10009),false,'a seventh charged start invalidates, never grows the admitted bound');
 assert.equal(admission.valid(token,10009),false);
});

test('zero-accounted-unit calls do not consume scope or manufacture a refund',()=>{
 const admission=new NativePaperEntryAdmission(6),token=admission.begin(input)!;
 assert.equal(admission.recordAccountedStarts(token,2,10002),true);
 for(let at=10003;at<10010;at++)assert.equal(admission.recordAccountedStarts(token,0,at),true);
 assert.deepEqual({spent:admission.view(token,10010)?.spent,remaining:admission.remaining(token,10010)},{spent:2,remaining:4});
 assert.equal(admission.recordAccountedStarts(token,-1,10011),false);
 assert.equal(admission.valid(token,10011),false,'negative deltas cannot refund admission');
});

test('late closed or copied tokens cannot alter a later candidate scope',()=>{
 const admission=new NativePaperEntryAdmission(6),old=admission.begin(input)!;
 assert.equal(admission.close(old),true);
 const token=admission.begin({...input,mint:'next-mint',at:10002})!;
 assert.ok(token);assert.notEqual(token,old);
 assert.equal(admission.recordAccountedStarts(old,6,10003),false);
 assert.equal(admission.close(old),false);
 const copied={...token};assert.equal(admission.recordAccountedStarts(copied,6,10004),false);
 assert.equal(admission.close(copied),false);
 assert.equal(admission.remaining(token,10005),6);
 assert.equal(admission.close(token),true);
 assert.equal(admission.valid(token,10006),false);
 assert.equal(admission.recordAccountedStarts(token,0,10006),false);
});

test('expiry, invalid counters and time regression invalidate authority instead of reusing a stale entry scope',()=>{
 for(const delta of [NaN,Infinity,1.5,7,Number.MAX_SAFE_INTEGER]){
  const admission=new NativePaperEntryAdmission(6),token=admission.begin(input)!;
  assert.equal(admission.recordAccountedStarts(token,delta,10002),false);
  assert.equal(admission.remaining(token,10002),0);
 }
 const admission=new NativePaperEntryAdmission(),token=admission.begin(input)!;
 assert.equal(admission.valid(token,19999),true);
 assert.equal(admission.valid(token,20000),false);
 assert.equal(admission.valid(token,19999),false,'returning to the old deadline cannot reactivate an expired scope');
 const next=admission.begin({...input,windowEndAt:20000,deadlineAt:29999,at:20001})!;
 assert.ok(next);assert.equal(admission.valid(next,20000),false);
 assert.equal(admission.valid(next,20001),false,'clock regression cannot reactivate the original token');
 assert.equal(admission.begin({...input,at:10001}),null,'a new token cannot convert a clock regression into authority');
 const fresh=admission.begin({...input,windowEndAt:30000,deadlineAt:39999,at:30001});assert.ok(fresh);
 assert.equal(admission.begin({...input,at:10001}),null);assert.equal(admission.valid(fresh,30001),false,'regressing activation cannot leave an earlier scope armed');
});

test('malformed initial identities and bounds never begin an entry scope',()=>{
 for(const maximum of [0,-1,10,NaN,1.5])assert.throws(()=>new NativePaperEntryAdmission(maximum),/START_BOUND/);
 const admission=new NativePaperEntryAdmission();
 for(const change of [{mint:''},{mint:'bad\nidentifier'},{windowEndAt:10002},{deadlineAt:10000},{at:NaN},{at:9999},{deadlineAt:Infinity}])assert.equal(admission.begin({...input,...change}),null);
 assert.equal(admission.begin(input)!==null,true);
});

test('scope-specific measured workflow bounds include all charged context work and cannot expand later',()=>{
 const admission=new NativePaperEntryAdmission();
 assert.equal(admission.maximumAccountedStarts,9);
 for(const maximumAccountedStarts of [0,-1,10,NaN,1.5])assert.equal(admission.begin({...input,maximumAccountedStarts}),null);
 const flat=admission.begin({...input,maximumAccountedStarts:7})!;
 assert.equal(admission.remaining(flat,10002),7);
 assert.equal(admission.recordAccountedStarts(flat,4,10003),true,'cold dependency/state and rent preparation consumes four charged starts');
 assert.equal(admission.recordAccountedStarts(flat,3,10004),true,'the decision quote consumes three further starts');
 assert.equal(admission.view(flat,10005)?.limit,7);assert.equal(admission.remaining(flat,10005),0);
 assert.equal(admission.recordAccountedStarts(flat,1,10006),false,'default global bound cannot expand a narrower admitted scope');
 const held=admission.begin({...input,at:10007,maximumAccountedStarts:9})!;
 assert.equal(admission.recordAccountedStarts(held,7,10008),true);
 assert.equal(admission.recordAccountedStarts(held,2,10009),true,'two separately prioritized protective context reads remain charged to total workflow accounting');
 assert.equal(admission.remaining(held,10010),0);assert.equal(admission.valid(held,10010),true);
});
