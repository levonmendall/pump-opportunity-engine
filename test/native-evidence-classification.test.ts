import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePaperEssentialEvidence,nativePaperEssentialEvidenceLazy} from '../src/native-evidence-classification.js';
const kinds=['native-flow-notification','native-flow-validated-events','native-flow-refusal','native-candidate-quality-gap','native-opportunity-evaluation','pilot-entry-local-reprice','trader-input','trader-predictive-assessment','trader-candidate-evidence-deferred','trader-quote-deferred','trader-context','trader-context-reuse','trader-held-evaluation','trader-decision','paper-unsigned-pumpswap','paper-execution-failed','native-paper-protection-dispatch-yield','trader-candidate-financial-evaluation-failed','trader-financial-maintenance-failed','trader-config','trader-execution','trader-quote','trader-pilot-execution-attempt','trader-pilot-entry-deposit','research-clock-response','pool-state','price-response','sdk-state','rent-context','pilot-entry-cost-preparation','rpc-market-quote','native-paper-start','native-paper-stop','native-paper-recovery','native-paper-entry-proof-pinned','other-unknown'];
test('lazy ownership exactly preserves every evidence classification and reads current state only when needed',()=>{
 for(const work of ['idle','candidate','pending','protection'])for(const kind of kinds)for(const owned of [false,true])for(const stage of ['qualified','exit-reserved','rejected',undefined]){
  let reads=0;const data={stage},expected=nativePaperEssentialEvidence(kind,work,owned,data);
  assert.equal(nativePaperEssentialEvidenceLazy(kind,work,()=>{reads++;return owned;},data),expected,`${kind}/${work}/${owned}/${stage}`);
  assert.equal(reads,nativePaperEssentialEvidence(kind,work,false,data)===nativePaperEssentialEvidence(kind,work,true,data)?0:1);
 }
});
test('ordinary selected-flow records do not open/read the financial ledger even during candidate work',()=>{
 let reads=0;for(let i=0;i<10000;i++)for(const kind of kinds.slice(0,4))assert.equal(nativePaperEssentialEvidenceLazy(kind,'candidate',()=>{reads++;throw Error('ledger must not be read');}),false);
 assert.equal(reads,0);
});
test('ownership-dependent essential evidence never caches ownership or suppresses a financial state failure',()=>{
 let owned=false,reads=0;const current=()=>{reads++;return owned;};
 assert.equal(nativePaperEssentialEvidenceLazy('trader-context','protection',current),false);owned=true;
 assert.equal(nativePaperEssentialEvidenceLazy('trader-context','protection',current),true);assert.equal(reads,2);
 assert.throws(()=>nativePaperEssentialEvidenceLazy('trader-context','protection',()=>{throw Error('STATE_UNAVAILABLE');}),/STATE_UNAVAILABLE/);
});
