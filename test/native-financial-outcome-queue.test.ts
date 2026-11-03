import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {MarketRegistry} from '../src/market-registry.js';
import {NativeCandidateRunner,NATIVE_FINANCIAL_OUTCOME_OBSERVATION_POLICY,type NativeRunnerOptions} from '../src/native-candidate-runner.js';
import {NativeSlotProductivity} from '../src/native-slot-productivity.js';
import {NativeFinancialHandoff} from '../src/native-financial-handoff.js';
import {nativePaperFeaturesSha256} from '../src/native-paper-contract.js';
import {FlowWindow} from '../src/strategy.js';
import {PERSISTENT_OBSERVABLE_MARKET_POLICY} from '../src/observation-age.js';

const START=Date.parse('2026-11-03T15:00:00Z'),MINT='11111111111111111111111111111111';
function fixture(t:TestContext){
 let at=START,allowed=true;const dir=mkdtempSync(join(tmpdir(),'poe-OFFLINE-outcome-queue-')),path=join(dir,'registry.sqlite'),registry=new MarketRegistry(path,{now:()=>at,concurrentIntake:true}),writer=new Database(path);
 t.after(()=>{if(writer.inTransaction)writer.exec('ROLLBACK');writer.close();registry.close();rmSync(dir,{recursive:true,force:true});});
 const forbidden=()=>{throw Error('OFFLINE_OUTCOME_TRANSPORT_FORBIDDEN');};
 const flow={usage:()=>({candidates:0,retiring:0,nextServiceAt:at+20000,nextServiceDomain:'control',nextServiceAction:'heartbeat'}),snapshot:()=>null,addCandidate:forbidden,removeCandidate:forbidden,notificationLedger:forbidden,requestSupportRefresh:forbidden,requestHeartbeat:forbidden,service:forbidden,stop:forbidden} as unknown as NativeRunnerOptions['flow'];
 const rpc={usage:()=>({waitingOrOperating:false,inFlight:0,closed:false,fatal:null,dispatchWindow:{readyAt:at,physicalBusy:false,waitMs:0}}),cooldownUntil:()=>0,call:forbidden} as unknown as NativeRunnerOptions['rpc'];
 const runner=new NativeCandidateRunner({registry,flow,rpc,runId:'offline-outcome-run',maximumDeep:4,observationAgePolicy:PERSISTENT_OBSERVABLE_MARKET_POLICY.version,now:()=>at,sourceWorkAdmission:()=>allowed,record:()=>{}}),tracker=(runner as unknown as {productivity:NativeSlotProductivity}).productivity;
 tracker.allocated(MINT,at,at,0);
 return {registry,writer,runner,tracker,at:()=>at,advance:(ms:number)=>{at+=ms;},admit:(value:boolean)=>{allowed=value;}};
}

test('real SQLITE_BUSY retains actual outcome receipts and original assignment outside the financial callback',t=>{
 const f=fixture(t);f.advance(10);const originalAt=f.at(),scope=f.runner.slotProductivity().sourceInstanceId,primary={mint:MINT,kind:'primary-evaluated' as const,at:originalAt,key:'closed-window'};
 const before=f.registry.health().transactions;f.writer.exec('BEGIN IMMEDIATE');
 assert.equal(f.runner.onFinancialOutcome(primary),'queued');assert.equal(f.runner.onFinancialOutcome(primary),'duplicate');assert.equal(f.runner.onFinancialOutcome({...primary,kind:'qualified'}),'queued');
 assert.deepEqual(f.registry.health().transactions,before,'callbacks enqueue without requesting any SQLite transaction');assert.equal(f.runner.economicDecisionCount(),0);
 assert.equal(f.runner.drainFinancialOutcomes(),false);assert.equal(f.runner.financialOutcomeObservations().pending,2);assert.equal(f.runner.financialOutcomeObservations().contentionDeferrals,1);assert.equal(f.registry.health().storageFailures,0);assert.equal(f.registry.health().available,true);assert.equal(f.runner.economicDecisionCount(),0);assert.equal(f.runner.slotProductivity().counts.distinctPrimaryEvaluated,0);
 f.writer.exec('ROLLBACK');f.advance(10);f.tracker.retired(MINT,f.at(),'OFFLINE completed observation');f.advance(10);f.tracker.allocated(MINT,f.at(),f.at(),1);
 assert.equal(f.runner.drainFinancialOutcomes(),true);assert.equal(f.runner.economicDecisionCount(),1);assert.equal(f.runner.slotProductivity().counts.distinctPrimaryEvaluated,1);assert.equal(f.runner.slotProductivity().counts.qualified,1);assert.equal(f.runner.financialOutcomeObservations().pending,0);
 const receipt=f.registry.getMetadata<any>(scope+':slot-productivity:financial:primary-evaluated:'+MINT+':closed-window');assert.equal(receipt.at,originalAt);assert.equal(receipt.assignment,1,'a later assignment cannot inherit the earlier financial event');assert.equal(receipt.financialPermission,false);
 f.runner.onFinancialOutcome(primary);f.runner.drainFinancialOutcomes();assert.equal(f.runner.economicDecisionCount(),1);assert.equal(f.runner.slotProductivity().counts.distinctPrimaryEvaluated,1,'durable identity prevents replay after the pending queue has cleared');
});

test('handoff counts the genuine matching decision while optional registry persistence is busy',t=>{
 const f=fixture(t),features=new FlowWindow(MINT,START-60000).features(START),c={mint:MINT,openedAt:START-60000,windowEndAt:START,admittedAt:START,deadlineAt:START+9999,featuresSha256:nativePaperFeaturesSha256(features)},handoff=new NativeFinancialHandoff('offline-outcome-run',START,4);
 handoff.observe(START,[c]);handoff.dispatch(c,START);f.advance(10);f.writer.exec('BEGIN IMMEDIATE');
 const event={version:'poe-opportunity-evaluation-v1',runId:'offline-outcome-run',stage:'execution-economics',at:f.at(),mint:MINT,features:{...features,asOf:f.at()},technicalFailure:false,decision:{kind:'strategy-rejection',qualified:false}};
 assert.equal(handoff.observeEconomicDecision('native-opportunity-evaluation',event),true);f.runner.onFinancialOutcome({mint:MINT,kind:'primary-evaluated',at:event.at,key:String(START)});assert.equal(f.runner.drainFinancialOutcomes(),false);
 handoff.complete(c,f.at(),1,f.runner.economicDecisionCount());assert.equal(handoff.usage(f.at()).financialEvaluations,1);assert.equal(handoff.usage(f.at()).economicDecisions,1);assert.equal(f.runner.economicDecisionCount(),0,'optional metadata is visibly pending');
 f.writer.exec('ROLLBACK');f.runner.drainFinancialOutcomes();assert.equal(f.runner.economicDecisionCount(),1);assert.equal(handoff.usage(f.at()).economicDecisions,1,'later optional persistence does not count the same handoff again');
});

test('one admitted drain is bounded and report snapshots never drain or refresh queued receipts',t=>{
 const f=fixture(t),limit=NATIVE_FINANCIAL_OUTCOME_OBSERVATION_POLICY.maximumPending;f.advance(1);
 for(let n=0;n<limit+2;n++)assert.equal(f.runner.onFinancialOutcome({mint:MINT,kind:'primary-evaluated',at:f.at(),key:'window-'+n}),n<limit?'queued':'overflow');
 const before=f.registry.health().transactions.writeCommits;f.runner.status();assert.equal(f.registry.health().transactions.writeCommits,before);assert.equal(f.runner.financialOutcomeObservations().pending,limit);assert.equal(f.runner.financialOutcomeObservations().overflowed,2);assert.equal(f.runner.financialOutcomeObservations().complete,false);
 f.admit(false);f.runner.drainFinancialOutcomes();assert.equal(f.registry.health().transactions.writeCommits,before);assert.equal(f.runner.financialOutcomeObservations().pending,limit);
 f.admit(true);f.runner.drainFinancialOutcomes();assert.equal(f.runner.economicDecisionCount(),NATIVE_FINANCIAL_OUTCOME_OBSERVATION_POLICY.maximumPerTurn);assert.equal(f.runner.financialOutcomeObservations().pending,limit-NATIVE_FINANCIAL_OUTCOME_OBSERVATION_POLICY.maximumPerTurn);assert.equal(f.runner.financialOutcomeObservations().oldestEventAt,START+1);assert.equal(f.runner.financialOutcomeObservations().complete,false,'overflow remains an explicit observation gap after successful retries');
});

test('rolled-back optional writes cannot split pipeline and slot counters or masquerade as retriable contention',t=>{
 const f=fixture(t);f.advance(1);f.runner.onFinancialOutcome({mint:MINT,kind:'primary-evaluated',at:f.at(),key:'rollback'});const mark=f.registry.markDistinct.bind(f.registry),failure=Error('OFFLINE arbitrary metadata failure');let calls=0;
 f.registry.markDistinct=((...args:Parameters<typeof mark>)=>{const result=mark(...args);if(args[0].endsWith(':pipeline-primary')){calls++;throw failure;}return result;}) as typeof f.registry.markDistinct;
 assert.throws(()=>f.runner.drainFinancialOutcomes(),error=>error===failure);f.registry.markDistinct=mark;
 assert.equal(f.runner.economicDecisionCount(),0);assert.equal(f.runner.slotProductivity().counts.distinctPrimaryEvaluated,0);assert.equal(f.runner.financialOutcomeObservations().pending,1);assert.equal(f.runner.financialOutcomeObservations().failure,'REGISTRY_WRITE_FAILED');assert.equal(f.runner.financialOutcomeObservations().contentionDeferrals,0);
 assert.equal(f.runner.drainFinancialOutcomes(),false);assert.equal(calls,1,'an arbitrary callback failure is surfaced and is not automatically replayed as SQLITE_BUSY');
});
